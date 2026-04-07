const { ethers } = require("ethers");
const axios = require('axios'); // Keep axios if needed for other parts, otherwise remove
const {
  validateAddress: evmValidateAddress,
  generateWallet: evmGenerateWallet,
  getNativeBalance: evmGetNativeBalance,
  getFeeData: evmGetFeeData
} = require('./common/evm_base');
const dotenv = require('dotenv');
const {
  InsufficientFundsError: CommonInsufficientFundsError,
  InvalidAddressError: CommonInvalidAddressError,
  TransactionError: CommonTransactionError,
  NetworkError
} = require('./common/errors');

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' ? 'https://sepolia.infura.io/v3/' + process.env.INFURA_API_KEY  :  'https://mainnet.infura.io/v3/' + process.env.INFURA_API_KEY;

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

// Re-export aliased common errors for potential external use if needed
const InsufficientFundsError = CommonInsufficientFundsError;
const InvalidAddressError = CommonInvalidAddressError;
const TransactionError = CommonTransactionError;

// Use validateAddress from evm_base directly
const validateAddress = evmValidateAddress;

// Core Functions

/**
 * Generate a new Ethereum wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  // Use the EVM base helper
  return evmGenerateWallet("m/44'/60'/0'/0/0");
};

/**
 * Get Ethereum balance for a given address
 * @param {string} walletAddress - Ethereum wallet address
 * @returns {number} Balance in ETH
 */
const getBalance = async (walletAddress) => {
  // Use the EVM base helper
  return evmGetNativeBalance(walletAddress, PROVIDER, 'ETH');
};

/**
 * Transfer Ethereum from one address to another
 * @param {string} senderAddress - Sender's Ethereum address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's Ethereum address
 * @param {number} amount - Amount to send in ETH
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountETH
) => {
  try {
    // Validate inputs
    if (!validateAddress(senderAddress)) {
      throw new CommonInvalidAddressError(senderAddress, 'ETH');
    }
    if (!validateAddress(receiverAddress)) {
      throw new CommonInvalidAddressError(receiverAddress, 'ETH');
    }

    // Create wallet instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);

    // Verify address match
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new CommonTransactionError('Private key does not match sender address');
    }

    // Get balances and fee data using helpers
    const [balanceWei, feeData, nonce] = await Promise.all([
      PROVIDER.getBalance(senderAddress),
      evmGetFeeData(PROVIDER, '10'),
      PROVIDER.getTransactionCount(senderAddress, 'latest')
    ]);

    // Calculate gas costs
    const gasLimit = 21000;
    let gasPriceInfo = {};
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      gasPriceInfo = {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      };
    } else if (feeData.gasPrice) {
      gasPriceInfo = { gasPrice: feeData.gasPrice };
    } else {
      gasPriceInfo = { gasPrice: ethers.parseUnits('10', 'gwei') };
    }
    const feeWei = (gasPriceInfo.maxFeePerGas || gasPriceInfo.gasPrice) * BigInt(gasLimit);

    // Convert amount to fixed decimal string first to prevent scientific notation
    const amountStr = Number(amountETH).toFixed(18);
    const amountWeiRaw = ethers.parseEther(amountStr);
    
    // Get balance in ETH for comparison
    const balanceETH = parseFloat(ethers.formatEther(balanceWei));
    
    // Check if this is a full balance transfer by comparing with a small epsilon
    // This handles floating point precision issues better than exact BigInt comparison
    const isFullBalanceTransfer = Math.abs(parseFloat(amountETH) - balanceETH) < 0.000001;
    
    // Calculate send amount
    let amountWei;
    if (isFullBalanceTransfer) {
      // When sending full balance, subtract gas fees
      amountWei = balanceWei - feeWei;
      
      // Ensure we're not sending dust (very small amounts)
      if (amountWei <= 0) {
        throw new CommonInsufficientFundsError(
          `Balance too low after fees. Available: ${balanceETH.toFixed(8)} ETH, Fee: ${ethers.formatEther(feeWei)} ETH`,
          { balance: balanceETH, required: amountETH, fee: ethers.formatEther(feeWei) }
        );
      }
    } else {
      amountWei = amountWeiRaw;
    }

    // Final validation
    if (amountWei + feeWei > balanceWei) {
      const missing = ethers.formatEther(amountWei + feeWei - balanceWei);
      throw new CommonInsufficientFundsError(
        `Available: ${ethers.formatEther(balanceWei)} ETH, Required: ${ethers.formatEther(amountWei + feeWei)} ETH`,
        {
          balance: ethers.formatEther(balanceWei),
          required: ethers.formatEther(amountWei + feeWei),
          fee: ethers.formatEther(feeWei)
        }
      );
    }

    // Send transaction
    const tx = await wallet.sendTransaction({
      to: receiverAddress,
      value: amountWei,
      maxFeePerGas: gasPriceInfo.maxFeePerGas || undefined,
      maxPriorityFeePerGas: gasPriceInfo.maxPriorityFeePerGas || undefined,
      gasPrice: gasPriceInfo.gasPrice || undefined,
      gasLimit,
      nonce,
      chainId: await PROVIDER.getNetwork().then(n => n.chainId)
    });

    return tx.hash;

  } catch (error) {
    if (error instanceof CommonInsufficientFundsError || error instanceof CommonInvalidAddressError) {
      throw error;
    }
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR' || error.code === 'TIMEOUT') {
      throw new NetworkError(`Transfer failed: ${error.message}`, { code: error.code, underlyingError: error });
    } else {
      throw new CommonTransactionError(`Transfer failed: ${error.message}`, { underlyingError: error });
    }
  }
};

// Change to uppercase PROVIDER
const getTransactionStatus = async (txHash) => {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    return receipt ? 'confirmed' : 'pending';
};

// Placeholder functions for compatibility
const needAlimentation = async () => false;
const alimentGasFees = async () => null;

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus,
  needAlimentation,
  alimentGasFees,
  // Expose common errors under a consistent namespace if needed elsewhere
  errors: {
    InsufficientFundsError: CommonInsufficientFundsError,
    InvalidAddressError: CommonInvalidAddressError,
    TransactionError: CommonTransactionError,
    NetworkError
  }
};