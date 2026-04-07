const axios = require('axios'); // Keep if needed for other parts
const { ethers } = require('ethers');
const {
  validateAddress: evmValidateAddress,
  generateWallet: evmGenerateWallet,
  getNativeBalance: evmGetNativeBalance,
  getFeeData: evmGetFeeData
} = require('./common/evm_base');
const dotenv = require('dotenv');
const {
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError,
  NetworkError
} = require('./common/errors');

dotenv.config();

// Configuration
const NETWORK = process.env.APP_MOD === 'dev' 
  ? 'https://api.avax-test.network/ext/bc/C/rpc' // Fuji Testnet
  : 'https://api.avax.network/ext/bc/C/rpc';     // Mainnet
const CHAIN_ID = process.env.APP_MOD === 'dev' ? 43113 : 43114;
const EXPLORER_API = process.env.APP_MOD === 'dev'
  ? 'https://api-testnet.snowtrace.io/api'
  : 'https://api.snowtrace.io/api';
const GAS_LIMIT = 21000;
const GAS_PRICE_GWEI = 25; // Default gas price in GWEI

// Use validateAddress from evm_base directly
const validateAddress = evmValidateAddress;

// Create provider instance
const PROVIDER = new ethers.JsonRpcProvider(NETWORK);

/**
 * Generate a new Avalanche wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  // Use the EVM base helper with Avalanche's derivation path if different, or default
  // Assuming default ETH path is okay for AVAX C-Chain for now, adjust if needed.
  return evmGenerateWallet(); 
};

/**
 * Get Avalanche balance for a given address
 * @param {string} walletAddress - Avalanche wallet address
 * @returns {number} Balance in AVAX
 */
const getBalance = async (walletAddress) => {
  // Use the EVM base helper
  return evmGetNativeBalance(walletAddress, PROVIDER, 'AVAX');
};

/**
 * Transfer AVAX from one address to another
 * @param {string} senderAddress - Sender's Avalanche address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's Avalanche address
 * @param {number} amount - Amount to send in AVAX
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountAVAX
) => {
  try {
    console.log('Starting AVAX transfer...');
    console.log(senderAddress, senderPrivateKey, receiverAddress, amountAVAX)
    // Validate addresses
    if (!validateAddress(senderAddress) || !validateAddress(receiverAddress)) {
      throw new InvalidAddressError(senderAddress === receiverAddress ? senderAddress : `${senderAddress} or ${receiverAddress}`, 'AVAX');
    }
    console.log('catshed1')
    // Use the shared PROVIDER instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    console.log(wallet)
    // Verify wallet address matches sender address
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key does not match sender address'); // Keep this specific error
    }
    console.log('catshed2')
    // Get balance, fee data, and nonce
    const [balanceWei, feeData, nonce] = await Promise.all([
      PROVIDER.getBalance(senderAddress),
      evmGetFeeData(PROVIDER, GAS_PRICE_GWEI.toString()), // Use helper
      PROVIDER.getTransactionCount(senderAddress, 'latest')
    ]);
    const balance = Number(ethers.formatEther(balanceWei));
    console.log('catshed3')
    // Determine gas price strategy (assuming legacy for AVAX C-Chain, adjust if EIP-1559 needed)
    const gasPrice = feeData.gasPrice;
    if (!gasPrice) {
        throw new NetworkError('Could not determine gas price for transaction.');
    }
    const gasCost = Number(ethers.formatEther(gasPrice * BigInt(GAS_LIMIT)));
    
    // Check if this is a max send (sending entire balance)
    const isMaxSend = Math.abs(balance - amountAVAX) < 0.000001; // Compare with small epsilon for float comparison
    let finalAmount;
    console.log('catshed4')
    if (isMaxSend) {
      // When sending max amount, subtract gas cost from total balance
      finalAmount = balance - gasCost;
      if (finalAmount <= 0) {
        throw new InsufficientFundsError(
          `Insufficient balance for gas fees. Available: ${balance} AVAX, Gas cost: ${gasCost} AVAX`,
          { balance, required: gasCost, fee: gasCost }
        );
      }
    } else {
      // Normal send - check if balance is sufficient for amount + gas
      finalAmount = amountAVAX;
      if (balance < amountAVAX + gasCost) {
        throw new InsufficientFundsError(
          `Available: ${balance} AVAX, Required: ${amountAVAX + gasCost} AVAX`,
          { balance, required: amountAVAX + gasCost, fee: gasCost }
        );
      }
    }
    console.log('catshed5')
    // Create transaction
    const tx = {
      to: receiverAddress,
      value: ethers.parseEther(finalAmount.toString()),
      gasLimit: GAS_LIMIT,
      gasPrice: gasPrice, // Use determined gasPrice
      nonce: nonce, // Include nonce
      chainId: CHAIN_ID
    };

    // Send transaction
    const transaction = await wallet.sendTransaction(tx);
    const receipt = await transaction.wait();
    console.log('success avax_avax transaction', receipt.hash);
    return receipt.hash;
  } catch (error) {
    if (error instanceof InsufficientFundsError || 
        error instanceof InvalidAddressError) {
      throw error;
    }
    // Catch potential network or API errors
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR') {
      throw new NetworkError(`Transaction failed: ${error.message}`, { underlyingError: error });
    } else {
      throw new TransactionError(`Transaction failed: ${error.message}`, { underlyingError: error });
    }
  }
};

// Get transaction status
const getTransactionStatus = async (txHash) => {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    return receipt ? 'confirmed' : 'pending';
};

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus
};