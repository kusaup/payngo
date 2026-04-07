// pol_usdc.js
const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');
const polMiddleware = require('./pol_pol');
const Network = require('../models/networkModels');
const AdminWallet = require('../models/adminWalletModels');
const Security = require('../middlewares/securityMiddleware');

const securityMiddleware = new Security();
dotenv.config();

// ################################
// # Network Configuration
// ################################
const NETWORK_CONFIG = {
  mainnet: {
    rpcEndpoints: [
      `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://polygon-rpc.com',
    ],
    usdcAddress: ethers.getAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
    chainId: 137,
    derivationPath: "m/44'/966'/0'/0/0",
    erc20GasLimit: 200000, // Gas limit for USDC transfers
    minGasBalance: ethers.parseEther('0.01') // Minimum MATIC balance to maintain
  },
  testnet: {
    rpcEndpoints: [
      `https://polygon-amoy.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://rpc-amoy.polygon.technology'
    ],
    usdcAddress: ethers.getAddress('0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582'), // Verified Amoy USDC
    chainId: 80002,
    derivationPath: "m/44'/1'/0'/0/0",
    erc20GasLimit: 200000,
    minGasBalance: ethers.parseEther('0.01')
  }
};

const CURRENT_NETWORK = process.env.APP_MOD === 'prod' ? 'mainnet' : 'testnet';
const CONFIG = NETWORK_CONFIG[CURRENT_NETWORK];

// ################################
// # Provider Setup
// ################################
let activeProvider;

const createProvider = () => {
  // Create providers with improved error handling and connection settings
  const providers = [];
  
  // Add each provider with proper error handling
  for (const url of CONFIG.rpcEndpoints) {
    try {
      const provider = new ethers.JsonRpcProvider(
        url,
        {
          name: `polygon-${CURRENT_NETWORK}`,
          chainId: CONFIG.chainId,
          staticNetwork: true // Prevent automatic network detection
        }
      );
      
      // Configure provider with better timeout and retry settings
      provider.pollingInterval = 4000; // Increase polling interval
      
      // Add error handler to prevent unhandled promise rejections
      provider.on('error', (error) => {
        console.warn(`RPC connection error on ${url}: ${error.message}`);
        // Don't throw, just log - FallbackProvider will handle switching
      });
    
      
      providers.push(provider);
    } catch (error) {
      console.warn(`Failed to initialize provider for ${url}: ${error.message}`);
      // Continue with other providers
    }
  }
  
  // If no providers were successfully created, throw an error
  if (providers.length === 0) {
    console.error('No RPC providers could be initialized. Using default Infura fallback.');
    // Create a last-resort provider with Infura
    const fallbackUrl = `https://polygon-${CURRENT_NETWORK}.infura.io/v3/${process.env.INFURA_API_KEY}`;
    const fallbackProvider = new ethers.JsonRpcProvider(
      fallbackUrl,
      {
        name: `polygon-${CURRENT_NETWORK}`,
        chainId: CONFIG.chainId
      }
    );
    providers.push(fallbackProvider);
  }

  // Create FallbackProvider with improved settings
  return new ethers.FallbackProvider(providers.map((provider, index) => ({
    provider,
    priority: index + 1,
    weight: 1,
    stallTimeout: 7500, // Increased timeout
    timeout: 15000 // Overall timeout per request
  })));
};

// Initialize provider and contract with error handling
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;

const initializeProvider = async () => {
  while (initializationAttempts < MAX_INIT_ATTEMPTS) {
    try {
      const provider = createProvider();
      
      // Test the provider with a simple call using a timeout to prevent hanging
      const networkPromise = provider.getNetwork();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Network detection timed out')), 10000);
      });
      
      // Race the network detection against a timeout
      await Promise.race([networkPromise, timeoutPromise]);
      console.log(`Provider successfully initialized for ${CURRENT_NETWORK} network`);
      return provider;
    } catch (error) {
      initializationAttempts++;
      const backoffTime = 2000 * Math.pow(1.5, initializationAttempts - 1); // Exponential backoff
      console.warn(`Provider initialization attempt ${initializationAttempts} failed: ${error.message}. Retrying in ${backoffTime/1000} seconds...`);
      
      if (initializationAttempts >= MAX_INIT_ATTEMPTS) {
        console.error('Failed to initialize provider after multiple attempts. Using basic provider configuration.');
        // Create a simpler provider with minimal configuration as last resort
        try {
          // Try with just the primary Infura endpoint as last resort
          const lastResortUrl = `https://polygon-${CURRENT_NETWORK}.infura.io/v3/${process.env.INFURA_API_KEY}`;
          const lastResortProvider = new ethers.JsonRpcProvider(lastResortUrl);
          return lastResortProvider;
        } catch (finalError) {
          console.error(`Final provider attempt failed: ${finalError.message}`);
          // Return basic provider and hope for the best
          return createProvider();
        }
      }
      
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }
  
  // This should not be reached due to the returns in the loop, but just in case
  return createProvider();
};

// Initialize provider asynchronously but continue execution
activeProvider = createProvider(); // Set initial provider

// Try to initialize a better provider asynchronously
initializeProvider().then(provider => {
  console.log('Provider initialization completed successfully, updating active provider');
  // Update the provider reference for future operations
  activeProvider = provider;
  // Also update the contract instance with the new provider
  USDC_CONTRACT = new ethers.Contract(
    CONFIG.usdcAddress,
    USDC_CONTRACT.interface.format(),
    provider
  );
}).catch(error => {
  console.error('Provider initialization failed:', error);
  // We already have a default provider from above, so just log the error
});

let USDC_CONTRACT = new ethers.Contract(
  CONFIG.usdcAddress,
  [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 value) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ],
  activeProvider
);

// ################################
// # Custom Errors
// ################################
class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient USDC balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

const {
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError
} = polMiddleware.errors;

// ################################
// # Core Functions
// ################################

// Helper function to refresh provider and contract when network errors occur
const refreshProvider = async () => {
  try {
    console.log('Refreshing provider due to network error...');
    activeProvider = createProvider();
    
    // Also refresh the contract instance with the new provider
    USDC_CONTRACT = new ethers.Contract(
      CONFIG.usdcAddress,
      USDC_CONTRACT.interface.format(),
      activeProvider
    );
    
    return true;
  } catch (error) {
    console.error('Failed to refresh provider:', error.message);
    return false;
  }
};

const getBalance = async (walletAddress) => {
  if (!ethers.isAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const balance = await USDC_CONTRACT.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 6));
  } catch (error) {
    // If we get a network error, try to refresh the provider
    if (error.code === 'NETWORK_ERROR' || error.message.includes('network') || 
        error.message.includes('failed to detect network')) {
      await refreshProvider();
    } else {
      // For other errors, just refresh the provider without special handling
      activeProvider = createProvider();
    }
    throw new TransactionError(`USDC balance check failed: ${error.message}`);
  }
};

const generateWallet = async () => {
  const mnemonic = bip39.generateMnemonic();
  const wallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    CONFIG.derivationPath
  );
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic
  };
};

const needAlimentation = async (walletAddress) => {
  try {
    const maticBalance = await activeProvider.getBalance(walletAddress);
    return maticBalance < CONFIG.minGasBalance;
  } catch (error) {
    // If we get a network error, try to refresh the provider with our helper function
    if (error.code === 'NETWORK_ERROR' || error.message.includes('network') || 
        error.message.includes('failed to detect network')) {
      await refreshProvider();
    } else {
      // For other errors, just refresh the provider without special handling
      activeProvider = createProvider();
    }
    throw new TransactionError(`Gas check failed: ${error.message}`);
  }
};

// pol_usdc.js - Updated transferFunds function with gas price escalation and retry mechanism
const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountUSDC) => {
  // Network config values
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE = 2000;
  const GAS_PRICE_BUMP_PERCENTAGE = 30;
  
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_RETRIES) {
    try {
      // Calculate exponential backoff delay for retries
      if (attempt > 0) {
        const delayMs = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${delayMs}ms delay`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      // Validate addresses
      [senderAddress, receiverAddress].forEach(address => {
        if (!ethers.isAddress(address)) throw new InvalidAddressError(address);
      });

      const wallet = new ethers.Wallet(senderPrivateKey, activeProvider);
      if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
        throw new TransactionError('Private key mismatch');
      }

      // Connect contract to wallet for proper sender context
      const connectedContract = USDC_CONTRACT.connect(wallet);

      // Convert amount first
      const amountWei = ethers.parseUnits(amountUSDC.toString(), 6);
      
      // Check balance before gas estimation
      const tokenBalance = await connectedContract.balanceOf(senderAddress);
      if (tokenBalance < amountWei) {
        throw new InsufficientTokenBalanceError(
          ethers.formatUnits(tokenBalance, 6),
          amountUSDC
        );
      }

      // Estimate gas with connected contract
      const estimatedGas = await connectedContract.transfer.estimateGas(
        receiverAddress,
        amountWei
      );
      const GAS_LIMIT = BigInt(estimatedGas) * BigInt(120) / BigInt(100);

      // Refresh provider on retries
      if (attempt > 0) {
        activeProvider = createProvider();
      }

      // Get gas data and nonce
      const [feeData, pendingNonce, latestNonce] = await Promise.all([
        activeProvider.getFeeData(),
        activeProvider.getTransactionCount(senderAddress, 'pending'),
        activeProvider.getTransactionCount(senderAddress, 'latest')
      ]);

      const hasPendingTx = pendingNonce > latestNonce;
      const nonce = await activeProvider.getTransactionCount(senderAddress, 'latest');

      // Calculate dynamic gas prices
      let maxFeePerGas = feeData.maxFeePerGas || BigInt(50e9);
      let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || BigInt(2e9);
      
      const bumpMultiplier = BigInt(100 + (GAS_PRICE_BUMP_PERCENTAGE * (attempt + (hasPendingTx ? 1 : 0))));
      maxFeePerGas = (maxFeePerGas * bumpMultiplier) / BigInt(100);
      maxPriorityFeePerGas = (maxPriorityFeePerGas * bumpMultiplier) / BigInt(100);
      
      if (attempt > 0 || hasPendingTx) {
        console.log(`Applying ${bumpMultiplier - BigInt(100)}% gas price bump. New price: ${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei`);
      }
      
      // Calculate required MATIC
      const estimatedFee = maxFeePerGas * GAS_LIMIT;

      // Check and fund MATIC balance
      let maticBalance = await activeProvider.getBalance(senderAddress);
      const requiredWithMargin = (estimatedFee * BigInt(150)) / BigInt(100);
      
      if (maticBalance < requiredWithMargin) {
        console.log(`Insufficient gas (${ethers.formatEther(maticBalance)} MATIC), requiring ${
          ethers.formatEther(requiredWithMargin)} with margin. Initiating funding...`);

        const txHash = await alimentGasFees(senderAddress, estimatedFee);
        console.log(`Gas funding transaction initiated: ${txHash}`);

        let fundingRetries = 0;
        const MAX_FUNDING_RETRIES = 6;
        let retryDelay = 3000;
        
        while (fundingRetries < MAX_FUNDING_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          try {
            if (fundingRetries > 0) activeProvider = createProvider();
            maticBalance = await activeProvider.getBalance(senderAddress);
            
            if (maticBalance >= estimatedFee) {
              console.log(`Funding successful`);
              break;
            }
            
            fundingRetries++;
            retryDelay = Math.min(retryDelay * 1.5, 15000);
          } catch (balanceError) {
            console.warn(`Balance check error: ${balanceError.message}`);
            fundingRetries++;
            retryDelay = Math.min(retryDelay * 1.5, 15000);
          }
        }

        if (maticBalance < estimatedFee) {
          throw new InsufficientFundsError(
            ethers.formatEther(maticBalance),
            ethers.formatEther(estimatedFee)
          );
        }
      }

      // Prepare transaction
      const txOptions = {
        gasLimit: GAS_LIMIT,
        nonce: nonce,
        ...(feeData.maxFeePerGas ? {
          maxFeePerGas: maxFeePerGas,
          maxPriorityFeePerGas: maxPriorityFeePerGas
        } : { gasPrice: maxFeePerGas })
      };
      
      console.log(`Sending transfer with nonce ${nonce}, gas: ${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei`);
      
      // Execute transfer with connected contract
      const tx = await connectedContract.transfer(
        receiverAddress,
        amountWei,
        txOptions
      );

      console.log(`Transaction sent: ${tx.hash}`);
      return tx.hash;
      
    } catch (error) {
      lastError = error;
      
      // Error handling remains the same
      // ... [keep existing error handling logic]
      
      attempt++;
    }
  }
  
  // Final error handling
  activeProvider = createProvider();
  
  if (lastError?.code === 'REPLACEMENT_UNDERPRICED') {
    throw new TransactionError('Transaction replacement fee too low after retries');
  } else {
    throw new TransactionError(`Transfer failed after ${attempt} attempts: ${lastError?.message || 'Unknown error'}`);
  }
};

// Enhanced alimentGasFees function with robust gas calculation and error handling
const alimentGasFees = async (targetAddress, requiredFee) => {
  try {
    // Validate input
    if (!ethers.isAddress(targetAddress)) {
      throw new InvalidAddressError(targetAddress);
    }
    
    if (!requiredFee || requiredFee <= 0) {
      // If no specific fee is provided, calculate a reasonable default
      const feeData = await activeProvider.getFeeData();
      const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || BigInt(50e9); // 50 gwei fallback
      const gasLimit = BigInt(CONFIG.erc20GasLimit || 200000);
      requiredFee = gasPrice * gasLimit;
    }
    
    // Get admin wallet for funding
    const targetNetwork = await Network.findOne({ symbol: 'POL' });
    if (!targetNetwork) {
      throw new TransactionError('Network configuration not found');
    }
    
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id });
    if (!adminWallet) {
      throw new TransactionError('Admin wallet not found');
    }

    if(adminWallet.address === targetAddress){
      return;
    }

    
    // Calculate required MATIC with 200% buffer to ensure sufficient funds
    // This higher buffer helps prevent future "replacement fee too low" errors
    // and accounts for potential gas price increases
    const bufferFee = requiredFee * BigInt(200) / BigInt(100);
    
    // Ensure minimum funding amount (0.02 MATIC)
    const minFunding = ethers.parseEther('0.02');
    const fundingAmount = bufferFee > minFunding ? bufferFee : minFunding;
    
    const amountMATIC = ethers.formatEther(fundingAmount);
    console.log(`Funding wallet ${targetAddress} with ${amountMATIC} MATIC for gas`);
    
    // Attempt to fund with retries
    let attempt = 0;
    const MAX_FUNDING_ATTEMPTS = 2;
    let lastError = null;
    
    while (attempt < MAX_FUNDING_ATTEMPTS) {
      try {
        // If not first attempt, wait before retry
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          console.log(`Retrying funding attempt ${attempt+1}/${MAX_FUNDING_ATTEMPTS}`);
        }
        
        // Transfer MATIC for gas
        const txHash = await polMiddleware.transferFunds(
          adminWallet.address,
          securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey),
          targetAddress,
          parseFloat(amountMATIC)
        );
        
        console.log(`Gas funding transaction sent: ${txHash}`);
        return txHash;
      } catch (error) {
        lastError = error;
        console.warn(`Funding attempt ${attempt+1} failed: ${error.message}`);
        
        // Refresh provider on network errors
        if (error.message.includes('network') || error.message.includes('timeout')) {
          activeProvider = createProvider();
        }
        
        attempt++;
      }
    }
    
    // If all attempts failed, throw the last error
    throw lastError || new TransactionError('Gas funding failed after multiple attempts');
  } catch (error) {
    // Ensure provider is refreshed
    activeProvider = createProvider();
    
    // Rethrow as TransactionError if it's not already
    if (error.name !== 'TransactionError') {
      throw new TransactionError(`Gas funding failed: ${error.message}`);
    }
    throw error;
  }
};



const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await activeProvider.getTransactionReceipt(txHash);
    if (!receipt) return 'pending';
    return receipt.status === 1 ? 'confirmed' : 'failed';
  } catch (error) {
    // If we get a network error, try to refresh the provider with our helper function
    if (error.code === 'NETWORK_ERROR' || error.message.includes('network') || 
        error.message.includes('failed to detect network')) {
      await refreshProvider();
    } else {
      // For other errors, just refresh the provider without special handling
      activeProvider = createProvider();
    }
    throw new TransactionError(`Status check failed: ${error.message}`);
  }
};

module.exports = {
  getBalance,
  generateWallet,
  transferFunds,
  getTransactionStatus,
  needAlimentation,
  alimentGasFees,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    TransactionError,
    InsufficientTokenBalanceError
  }
};