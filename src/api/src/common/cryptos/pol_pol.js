// pol_pol.js
const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');

dotenv.config();

// ################################
// # Configuration Section
// ################################
const NETWORK_CONFIG = {
  mainnet: {
    rpcEndpoints: [
      `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://polygon-rpc.com',
    ],
    chainId: 137,
    networkName: 'polygon'
  },
  testnet: {
    rpcEndpoints: [
      `https://polygon-amoy.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://rpc-amoy.polygon.technology'
    ],
    chainId: 80002,
    networkName: 'polygon-amoy'
  }
};

const CURRENT_NETWORK = process.env.APP_MOD === 'prod' ? 'mainnet' : 'testnet';
const CONFIG = NETWORK_CONFIG[CURRENT_NETWORK];

// ################################
// # Provider Setup
// ################################
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

let activeProvider = createProvider();

// ################################
// # Custom Errors
// ################################
class InsufficientFundsError extends Error {
  constructor(balance, required) {
    super(`Insufficient MATIC. Available: ${balance}, Required: ${required}`);
    this.name = 'InsufficientFundsError';
    this.details = { balance, required };
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Polygon address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

class RpcConnectionError extends Error {
  constructor() {
    super(`Failed to connect to ${CONFIG.networkName} RPC endpoints`);
    this.name = 'RpcConnectionError';
    this.details = { endpoints: CONFIG.endpoints };
  }
}

class TransactionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransactionError';
  }
}

// ################################
// # Core Functions
// ################################

// -------------- Wallet Generation --------------
const generateWallet = async () => {
  try {
    const mnemonic = bip39.generateMnemonic();
    const wallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      CONFIG.derivationPath
    );

    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic,
      network: CONFIG.networkName
    };
  } catch (error) {
    throw new TransactionError(`Wallet generation failed: ${error.message}`);
  }
};

// -------------- Balance Check --------------
const getBalance = async (address) => {
  try {
    if (!ethers.isAddress(address)) {
      throw new InvalidAddressError(address);
    }

    const balanceWei = await activeProvider.getBalance(address);
    return parseFloat(ethers.formatEther(balanceWei));
  } catch (error) {
    activeProvider = createProvider(); // Rotate provider
    throw new RpcConnectionError();
  }
};

// -------------- Funds Transfer --------------
const transferFunds = async (senderAddress, privateKey, recipientAddress, amountMATIC) => {
  try {
    // Validate addresses
    [senderAddress, recipientAddress].forEach(address => {
      if (!ethers.isAddress(address)) {
        throw new InvalidAddressError(address);
      }
    });

    // Create wallet instance
    const wallet = new ethers.Wallet(privateKey, activeProvider);
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key/address mismatch');
    }

    // Get current gas data
    const feeData = await activeProvider.getFeeData();
    const nonce = await activeProvider.getTransactionCount(senderAddress);

    // Calculate gas parameters
    const gasLimit = 21000; // Standard gas limit for simple transfers
    const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('30', 'gwei');
    const estimatedFee = (maxFeePerGas + maxPriorityFeePerGas) * BigInt(gasLimit);

    // Get sender balance
    const balanceWei = await activeProvider.getBalance(senderAddress);
    const balanceMATIC = parseFloat(ethers.formatEther(balanceWei));

    // Auto-detect full balance transfer
    const isFullBalanceTransfer = parseFloat(amountMATIC) === balanceMATIC;

    // Calculate transfer amount
    let amountWei;
    if (isFullBalanceTransfer) {
      // Deduct gas fees from total balance
      amountWei = balanceWei - estimatedFee;
      
      // Ensure we don't try to send negative value
      if (amountWei < 0) {
        throw new InsufficientFundsError(
          balanceMATIC,
          ethers.formatEther(estimatedFee)
        );
      }
    } else {
      // Convert specified amount to wei
      amountWei = ethers.parseEther(amountMATIC.toString());
      
      // Validate available balance for amount + fees
      if (amountWei + estimatedFee > balanceWei) {
        throw new InsufficientFundsError(
          balanceMATIC,
          ethers.formatEther(amountWei + estimatedFee)
        );
      }
    }

    // Send transaction
    const tx = await wallet.sendTransaction({
      to: recipientAddress,
      value: amountWei,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit,
      nonce,
      chainId: CONFIG.chainId
    });

    return tx.hash;
  } catch (error) {
    activeProvider = createProvider(); // Rotate provider on failure
    throw new TransactionError(error.message);
  }
};

// -------------- Transaction Status --------------
const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await activeProvider.getTransactionReceipt(txHash);
    return receipt?.status === 1 ? 'confirmed' : 
           receipt?.status === 0 ? 'failed' : 
           'pending';
  } catch (error) {
    throw new RpcConnectionError();
  }
};

// ################################
// # Export Module
// ################################
module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    RpcConnectionError,
    TransactionError
  }
};