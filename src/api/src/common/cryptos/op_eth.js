const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');

dotenv.config();

// ################################
// # Network Configuration
// ################################
const NETWORK_CONFIG = {
  mainnet: {
    rpcEndpoints: [
      `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://mainnet.optimism.io'
    ],
    chainId: 10,
    gasLimit: 21000n,
    minGasBalance: ethers.parseUnits('0.001', 'ether'),
    derivationPath: "m/44'/60'/0'/0/0",
    tokenAddress: "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF" // Add this line
  },
  testnet: {
    rpcEndpoints: [
      `https://optimism-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://sepolia.optimism.io'
    ],
    chainId: 11155420,
    gasLimit: 21000n,
    minGasBalance: ethers.parseUnits('0.0005', 'ether'),
    derivationPath: "m/44'/1'/0'/0/0",
    tokenAddress: "0x74A4A85C611679B73F402B36c0F84A7D2CcdFDa3" // Add this line
  }
};



const CURRENT_NETWORK = process.env.APP_MOD === 'prod' ? 'mainnet' : 'testnet';
const CONFIG = NETWORK_CONFIG[CURRENT_NETWORK];

// ################################
// # Provider Setup
// ################################
let activeProvider;

const createProvider = () => {
  const providers = CONFIG.rpcEndpoints.map(url => 
    new ethers.JsonRpcProvider(url, {
      name: `ethereum-${CURRENT_NETWORK}`,
      chainId: CONFIG.chainId
    })
  );

  return new ethers.FallbackProvider(providers.map((provider, index) => ({
    provider,
    priority: index + 1,
    weight: 1,
    stallTimeout: 3000
  })));
};

activeProvider = createProvider();
const TOKEN_CONTRACT = new ethers.Contract(
  CONFIG.tokenAddress,
  [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 value) returns (bool)"
  ],
  activeProvider
);

// ################################
// # Custom Errors
// ################################
class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient ARB balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

class InsufficientFundsError extends Error {
  constructor(balanceETH, requiredETH) {
    super(`Insufficient ETH for gas. Available: ${balanceETH} ETH, Required: ${requiredETH} ETH`);
    this.name = 'InsufficientFundsError';
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Ethereum address: ${address}`);
    this.name = 'InvalidAddressError';
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

const getBalance = async (walletAddress) => {
    if (!ethers.isAddress(walletAddress)) {
      throw new InvalidAddressError(walletAddress);
    }
  
    try {
      const balanceWei = await activeProvider.getBalance(walletAddress);
      return parseFloat(ethers.formatEther(balanceWei));
    } catch (error) {
      activeProvider = createProvider();
      throw new TransactionError(`Balance check failed: ${error.message}`);
    }
};

const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountETH) => {
  try {
    // Validate addresses
    if (!ethers.isAddress(senderAddress)) throw new InvalidAddressError(senderAddress);
    if (!ethers.isAddress(receiverAddress)) throw new InvalidAddressError(receiverAddress);

    const wallet = new ethers.Wallet(senderPrivateKey, activeProvider);
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key mismatch');
    }

    const [feeData, nonce, balanceWei] = await Promise.all([
      activeProvider.getFeeData(),
      activeProvider.getTransactionCount(senderAddress),
      activeProvider.getBalance(senderAddress)
    ]);

    const maxFee = feeData.maxFeePerGas || feeData.gasPrice;
    const estimatedFee = maxFee * CONFIG.gasLimit;
    const BUFFER_PERCENTAGE = 15n; // Increased buffer to 15%
    const bufferedEstimatedFee = estimatedFee + (estimatedFee * BUFFER_PERCENTAGE) / 100n;
    
    // Parse the amount to Wei for comparison
    let amountWei;
    
    // Check if attempting to send entire balance (either exact match or very close)
    // We'll consider it a max send if:
    // 1. The user explicitly entered the exact balance amount
    // 2. The user entered a value that's very close to the balance (within 0.0001 ETH)
    // 3. The user entered a special value like -1 or 'max' to indicate sending all funds
    const isMaxSend = 
      amountETH.toString() === '-1' || 
      amountETH.toString().toLowerCase() === 'max' ||
      Math.abs(parseFloat(amountETH) - parseFloat(ethers.formatEther(balanceWei))) < 0.0001;
    
    // If it's a max send, we'll calculate the transfer amount by subtracting the gas fee
    if (isMaxSend) {
      // Check if there's enough balance to cover at least the gas fee
      if (balanceWei <= bufferedEstimatedFee) {
        throw new InsufficientFundsError(
          ethers.formatEther(balanceWei),
          ethers.formatEther(bufferedEstimatedFee)
        );
      }
      
      // Calculate the maximum amount that can be sent (balance minus gas fee with buffer)
      amountWei = balanceWei - bufferedEstimatedFee;
    } else {
      // For regular transfers, parse the amount normally
      amountWei = ethers.parseEther(amountETH.toString());
      
      // Check if there's enough balance for both the amount and gas fee
      if (amountWei + estimatedFee > balanceWei) {
        throw new InsufficientFundsError(
          ethers.formatEther(balanceWei),
          ethers.formatEther(amountWei + estimatedFee)
        );
      }
    }

    // Send the transaction with the calculated amount
    const tx = await wallet.sendTransaction({
      to: receiverAddress,
      value: amountWei,
      maxFeePerGas: maxFee,
      gasLimit: CONFIG.gasLimit,
      nonce
    });

    return tx.hash;
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`ETH transfer failed: ${error.message}`);
  }
};

const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await activeProvider.getTransactionReceipt(txHash);
    return receipt?.status === 1 ? 'confirmed' : 'pending';
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`Status check failed: ${error.message}`);
  }
};

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus,
  needAlimentation: async () => false,
  alimentGasFees: async () => null,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    TransactionError,
    InsufficientTokenBalanceError
  }
};