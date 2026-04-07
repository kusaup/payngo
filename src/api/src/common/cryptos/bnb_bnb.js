const { ethers } = require("ethers");
const dotenv = require('dotenv');
const {
  InsufficientFundsError: CommonInsufficientFundsError,
  InvalidAddressError: CommonInvalidAddressError,
  TransactionError: CommonTransactionError,
  NetworkError
} = require('./common/errors');
const {
  validateAddress: evmValidateAddress,
  generateWallet: evmGenerateWallet,
  getNativeBalance: evmGetNativeBalance,
  getFeeData: evmGetFeeData
} = require('./common/evm_base');

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? 'https://data-seed-prebsc-1-s1.binance.org:8545' // BSC Testnet
  : 'https://bsc-dataseed.binance.org/'; // BSC Mainnet

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);
const EXPLORER_URL = process.env.APP_MOD === 'dev'
  ? 'https://testnet.bscscan.com'
  : 'https://bscscan.com';

// Re-export aliased common errors
const InsufficientFundsError = CommonInsufficientFundsError;
const InvalidAddressError = CommonInvalidAddressError;
const TransactionError = CommonTransactionError;

// Network configuration
const BSC_CHAIN_ID = process.env.APP_MOD === 'dev' ? 97 : 56;

// Gas configuration
const DEFAULT_GAS_PRICE = ethers.parseUnits('5', 'gwei');
const GAS_LIMIT = 21000n;

// Use helpers from evm_base
const validateAddress = evmValidateAddress;

// Core Functions

/**
 * Generate a new BNB wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  // Use the EVM base helper with BNB derivation path
  return evmGenerateWallet("m/44'/714'/0'/0/0");
};

/**
 * Get BNB balance for a given address
 * @param {string} walletAddress - BNB wallet address
 * @returns {number} Balance in BNB
 */
const getBalance = async (walletAddress) => {
  // Use the EVM base helper
  return evmGetNativeBalance(walletAddress, PROVIDER, 'BNB');
};

/**
 * Transfer BNB from one address to another
 * @param {string} senderAddress - Sender's BNB address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's BNB address
 * @param {number} amount - Amount to send in BNB
 * @returns {string} Transaction hash
 */
const transferFunds = async (
    senderAddress,
    senderPrivateKey,
    receiverAddress,
    amountBNB
  ) => {
    try {
      // Validate addresses
      [senderAddress, receiverAddress].forEach(address => {
        if (!validateAddress(address)) throw new CommonInvalidAddressError(address, 'BNB');
      });
  
      // Create wallet instance
      const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
  
      // Verify address match
      if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
        throw new CommonTransactionError('Private key does not match sender address');
      }
  
      // Get balance, fee data, and nonce using helpers
      const [balanceWei, feeData, nonce] = await Promise.all([
        PROVIDER.getBalance(senderAddress), // Keep direct call for atomicity
        evmGetFeeData(PROVIDER, '5'), // Use helper, provide default Gwei (BSC uses 5 Gwei typically)
        PROVIDER.getTransactionCount(senderAddress, 'latest')
      ]);

      // Determine gas price (BSC typically uses legacy)
      const gasPrice = feeData.gasPrice;
      if (!gasPrice) {
        throw new NetworkError('Could not determine gas price for transaction.');
      }
  
      // Convert amounts
      const balanceBNB = parseFloat(ethers.formatEther(balanceWei));
      const isFullBalance = amountBNB === balanceBNB;
      
      // Calculate maximum possible amount
      const feeWei = gasPrice * GAS_LIMIT;
      const feeBNB = parseFloat(ethers.formatEther(feeWei));
      
      let amountWei = ethers.parseEther(amountBNB.toString());
      
      // Auto-adjust for full balance transfers
      if (isFullBalance) {
        amountWei = balanceWei - feeWei;
        
        // Verify remaining amount is above dust limit
        if (amountWei <= 0) {
          throw new CommonInsufficientFundsError(
            `Balance too low after fees. Available: ${balanceBNB.toFixed(8)} BNB, Fee: ${feeBNB.toFixed(8)} BNB`,
            { balance: balanceBNB, required: amountBNB, fee: feeBNB }
          );
        }
      }
  
      // Final validation
      const totalCostWei = amountWei + feeWei;
      if (balanceWei < totalCostWei) {
        const available = ethers.formatEther(balanceWei);
        const required = ethers.formatEther(totalCostWei);
        throw new CommonInsufficientFundsError(
          `Available: ${available} BNB, Required: ${required} BNB`,
          {
            balance: parseFloat(available),
            required: parseFloat(required),
            fee: parseFloat(ethers.formatEther(feeWei))
          }
        );
      }
  
      // Send transaction
      const tx = await wallet.sendTransaction({
        to: receiverAddress,
        value: amountWei,
        gasPrice,
        gasLimit: GAS_LIMIT,
        nonce,
        chainId: BSC_CHAIN_ID
      });
  
      return tx.hash;
  
    } catch (error) {
      // Handle specific errors first
    if (error instanceof CommonInsufficientFundsError || error instanceof CommonInvalidAddressError) {
      throw error;
    }
    // Catch potential network or API errors from ethers.js
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR' || error.code === 'TIMEOUT') {
      throw new NetworkError(`Transfer failed: ${error.message}`, { code: error.code, underlyingError: error });
    } else {
      // General transaction error
      throw new CommonTransactionError(`Transfer failed: ${error.message}`, { underlyingError: error });
    }
    }
};

/**
 * Check transaction status
 * @param {string} txHash - Transaction hash
 * @returns {string} Status: pending/confirmed/failed/unknown
 */
const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    
    if (!receipt) return 'pending';
    return receipt.status === 1 ? 'confirmed' : 'failed';
  } catch (error) {
    return 'unknown';
  }
};

// Placeholder functions for compatibility
const needAlimentation = async () => false;
const alimentGasFees = async () => null;

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  needAlimentation,
  alimentGasFees,
  getTransactionStatus,
  // Expose common errors under a consistent namespace if needed elsewhere
  errors: {
    InsufficientFundsError: CommonInsufficientFundsError,
    InvalidAddressError: CommonInvalidAddressError,
    TransactionError: CommonTransactionError,
    NetworkError
  }
};