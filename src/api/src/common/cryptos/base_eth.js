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
      `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://mainnet.base.org'
    ],
    chainId: 8453,
    gasLimit: 21000n,
    minGasBalance: ethers.parseUnits('0.001', 'ether'),
    derivationPath: "m/44'/60'/0'/0/0"
  },
  testnet: {
    rpcEndpoints: [
      `https://base-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://sepolia.base.org'
    ],
    chainId: 84532,
    gasLimit: 21000n,
    minGasBalance: ethers.parseUnits('0.0005', 'ether'),
    derivationPath: "m/44'/1'/0'/0/0"
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
      name: `base-${CURRENT_NETWORK}`,
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

// ################################
// # Custom Errors
// ################################
class InsufficientFundsError extends Error {
  constructor(balanceETH, requiredETH) {
    super(`Insufficient ETH for gas. Available: ${balanceETH} ETH, Required: ${requiredETH} ETH`);
    this.name = 'InsufficientFundsError';
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Base address: ${address}`);
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

    // Refresh fee data and nonce
    const [feeData, nonce, balanceWei] = await Promise.all([
      activeProvider.getFeeData(),
      activeProvider.getTransactionCount(senderAddress),
      activeProvider.getBalance(senderAddress)
    ]);

    // Apply 200% buffer to fees to account for potential gas price spikes
    const bufferMultiplier = BigInt(20); // 2x buffer
    const divisor = BigInt(10);
    const maxFee = (feeData.maxFeePerGas || feeData.gasPrice) * bufferMultiplier / divisor;
    const priorityFee = (feeData.maxPriorityFeePerGas || BigInt(0)) * bufferMultiplier / divisor;

    // Add 20% buffer to gas limit for fee estimation
    const estimatedGasLimit = CONFIG.gasLimit * BigInt(12) / BigInt(10); // 25200
    const estimatedFee = maxFee * estimatedGasLimit;

    const isMaxSend = parseFloat(amountETH) === parseFloat(ethers.formatEther(balanceWei));
    const maxSendableAmount = balanceWei - estimatedFee;

    // Ensure we have enough for gas
    if (maxSendableAmount <= 0n) {
      throw new InsufficientFundsError(
        ethers.formatEther(balanceWei),
        ethers.formatEther(estimatedFee)
      );
    }

    let amountWei;
    if (isMaxSend) {
      // When sending max amount, leave room for gas price fluctuations
      amountWei = maxSendableAmount;
      console.log(`Max send: ${ethers.formatEther(amountWei)} ETH`);
    } else {
      amountWei = ethers.parseEther(amountETH.toString());
      // Verify total cost (amount + gas) is covered
      if (amountWei + estimatedFee > balanceWei) {
        throw new InsufficientFundsError(
          ethers.formatEther(balanceWei),
          ethers.formatEther(amountWei + estimatedFee)
        );
      }
    }

    // Submit transaction with original gasLimit (21000) but buffered fees
    const tx = await wallet.sendTransaction({
      to: receiverAddress,
      value: amountWei,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priorityFee,
      gasLimit: CONFIG.gasLimit, // Still 21000
      nonce,
      type: 2
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
    TransactionError
  }
};