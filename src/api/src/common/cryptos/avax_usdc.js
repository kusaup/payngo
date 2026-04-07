const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');
const avaxMiddleware = require('./avax_avax');
const Network = require('../models/networkModels')
const AdminWallet = require('../models/adminWalletModels')

const Security = require('../middlewares/securityMiddleware')
const securityMiddleware = new Security() 

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? 'https://api.avax-test.network/ext/bc/C/rpc' // Avalanche Fuji testnet
  : 'https://api.avax.network/ext/bc/C/rpc'; // Avalanche C-Chain mainnet

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);
const USDC_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0x5425890298aed601595a70AB815c96711a31Bc65' // Fuji testnet USDC (mock)
  : '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // Avalanche C-Chain USDC

const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Custom Errors
class InsufficientFundsError extends Error {
  constructor(balanceAVAX, feeAVAX, requiredAVAX) {
    super(`Insufficient funds. Available: ${balanceAVAX} AVAX, Required: ${requiredAVAX} AVAX`);
    this.name = 'InsufficientFundsError';
    this.details = {
      fee: feeAVAX,
      balance: balanceAVAX,
      required: requiredAVAX
    };
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Avalanche address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

class TransactionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransactionError';
  }
}

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient USDC balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

// Network configuration
const AVAX_CHAIN_ID = process.env.APP_MOD === 'dev' ? 43113 : 43114; // Fuji: 43113, Mainnet: 43114

// Gas configuration
const MIN_GAS_BALANCE = ethers.parseUnits('0.001', 'ether'); // 0.001 AVAX
const GAS_LIMIT_ERC20 = 100000n;

// Helpers
const validateAddress = (address) => ethers.isAddress(address);

const getGasPrice = async () => {
  try {
    const feeData = await PROVIDER.getFeeData();
    return feeData.gasPrice || ethers.parseUnits('25', 'gwei');
  } catch (error) {
    return ethers.parseUnits('25', 'gwei');
  }
};

// Core Functions

/**
 * Generate a new Avalanche wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  const mnemonic = bip39.generateMnemonic();
  const derivationPath = "m/44'/60'/0'/0/0";
  const wallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    derivationPath
  );

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic
  };
};


/**
 * Get USDC balance for a given address
 * @param {string} walletAddress - Avalanche wallet address
 * @returns {number} Balance in USDC
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, PROVIDER);
    const balance = await contract.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 6)); // USDC on Avalanche uses 6 decimals
  } catch (error) {
    throw new TransactionError(`USDC balance check failed: ${error.message}`);
  }
};

/**
 * Check if wallet needs gas fee alimentation
 * @param {string} walletAddress - Avalanche wallet address
 * @returns {boolean} True if needs gas funding
 */
const needAlimentation = async (walletAddress) => {
  try {
    const avaxBalance = await avaxMiddleware.getBalance(walletAddress);
    return avaxBalance < parseFloat(ethers.formatEther(MIN_GAS_BALANCE));
  } catch (error) {
    throw new TransactionError(`Gas check failed: ${error.message}`);
  }
};

/**
 * Fund wallet with AVAX for gas fees
 * @param {string} targetAddress - Address to fund
 * @param {number} amountAVAX - Amount of AVAX to send
 * @returns {string} Transaction hash
 */
const alimentGasFees = async (targetAddress, amountAVAX) => {
  try {
    // Find the AVAX network and admin wallet
    const targetNetwork = await Network.findOne({ symbol: 'AVAX' })
    if (!targetNetwork) {
      throw new TransactionError('AVAX network not found in database');
    }
    
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id })
    if (!adminWallet || !adminWallet.address || !adminWallet.privateKey) {
      throw new TransactionError('Admin wallet not found or invalid');
    }

    if(adminWallet.address === targetAddress){
      return;
    }

    // Get current gas price
    const gasPrice = await getGasPrice();
    
    // Calculate exact gas needed for the USDC transfer
    const estimatedFee = gasPrice * GAS_LIMIT_ERC20;
    // Calculate exact amount needed plus 10% buffer for price fluctuations
    const totalAvaxNeeded = parseFloat(ethers.formatEther(estimatedFee * 11n / 10n));

    // Check admin wallet balance
    const adminBalance = await avaxMiddleware.getBalance(adminWallet.address);
    if (adminBalance < totalAvaxNeeded) {
      throw new InsufficientFundsError(
        adminBalance,
        totalAvaxNeeded,
        totalAvaxNeeded
      );
    }

    // Use avax_avax middleware to send AVAX for gas
    const txHash = await avaxMiddleware.transferFunds(
      adminWallet.address,
      securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey),
      targetAddress,
      totalAvaxNeeded
    );

    return txHash;
  } catch (error) {
    throw new TransactionError(`Gas funding failed: ${error.message}`);
  }
};

/**
 * Transfer USDC between addresses
 * @param {string} senderAddress - Sender's Avalanche address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's Avalanche address
 * @param {number} amountUSDC - Amount to send in USDC
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountUSDC
) => {
  try {
    // Validate addresses
    [senderAddress, receiverAddress].forEach(address => {
      if (!validateAddress(address)) throw new InvalidAddressError(address);
    });

    // Create wallet instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, wallet);

    // Verify address match
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key mismatch');
    }

    // Check if AVAX is needed for gas
    if (await needAlimentation(senderAddress)) {
      await alimentGasFees(senderAddress, MIN_GAS_BALANCE);
    }

    // Convert amount to USDC units (6 decimals)
    const amount = ethers.parseUnits(amountUSDC.toString(), 6);

    // Check USDC balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 6),
        ethers.formatUnits(amount, 6)
      );
    }

    // Send USDC transaction
    const gasPrice = await getGasPrice();
    const nonce = await PROVIDER.getTransactionCount(senderAddress, 'latest');

    const tx = await contract.transfer.populateTransaction(
      receiverAddress,
      amount
    );

    const sentTx = await wallet.sendTransaction({
      ...tx,
      gasPrice,
      gasLimit: GAS_LIMIT_ERC20,
      nonce,
      chainId: AVAX_CHAIN_ID
    });

    return sentTx.hash;
  } catch (error) {
    if (error instanceof InsufficientTokenBalanceError || 
        error instanceof InvalidAddressError ||
        error instanceof InsufficientFundsError) {
      throw error;
    }
    throw new TransactionError(`Transaction failed: ${error.message}`);
  }
};

// Get transaction status
const getTransactionStatus = async (txHash) => {
  const receipt = await PROVIDER.getTransactionReceipt(txHash);
  return receipt ? 'confirmed' : 'pending';
};

// Export the module
module.exports = {
  generateWallet,
  getBalance,
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