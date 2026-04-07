const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');
const ethMiddleware = require('./eth_eth');
const Network = require('../models/networkModels')
const AdminWallet = require('../models/adminWalletModels')

const Security = require('../middlewares/securityMiddleware')
const securityMiddleware = new Security() 

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? 'https://sepolia.infura.io/v3/' + process.env.INFURA_API_KEY 
  : 'https://mainnet.infura.io/v3/' + process.env.INFURA_API_KEY;

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);
const AAVE_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0x88541670E55cC00bEEFD87eB59EDd1b7C511AC9a' // Sepolia testnet AAVE (mock)
  : '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'; // Mainnet AAVE

const AAVE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient AAVE balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

const { 
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError,   
} = ethMiddleware.errors;

// Network configuration
const ETH_CHAIN_ID = process.env.APP_MOD === 'dev' ? 11155111 : 1; // Sepolia: 11155111, Mainnet: 1

// Gas configuration
const MIN_GAS_BALANCE = ethers.parseUnits('0.01', 'ether'); // 0.01 ETH
const GAS_LIMIT_ERC20 = 100000n;

// Helpers
const validateAddress = (address) => ethers.isAddress(address);

const getGasPrice = async () => {
  try {
    const feeData = await PROVIDER.getFeeData();
    return feeData.gasPrice || ethers.parseUnits('10', 'gwei');
  } catch (error) {
    return ethers.parseUnits('10', 'gwei');
  }
};

// Core Functions

/**
 * Generate a new Ethereum wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  // Reuse ETH wallet generation
  return ethMiddleware.generateWallet();
};

/**
 * Get AAVE balance for a given address
 * @param {string} walletAddress - Ethereum wallet address
 * @returns {number} Balance in AAVE
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const contract = new ethers.Contract(AAVE_CONTRACT_ADDRESS, AAVE_ABI, PROVIDER);
    const balance = await contract.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 18)); // AAVE uses 18 decimals
  } catch (error) {
    throw new TransactionError(`AAVE balance check failed: ${error.message}`);
  }
};

/**
 * Check if wallet needs gas fee alimentation
 * @param {string} walletAddress - Ethereum wallet address
 * @returns {boolean} True if needs gas funding
 */
const needAlimentation = async (walletAddress) => {
  try {
    const ethBalance = await ethMiddleware.getBalance(walletAddress);
    return ethBalance < parseFloat(ethers.formatEther(MIN_GAS_BALANCE));
  } catch (error) {
    throw new TransactionError(`Gas check failed: ${error.message}`);
  }
};

/**
 * Fund wallet with ETH for gas fees
 * @param {string} targetAddress - Address to fund
 * @param {number} amountETH - Amount of ETH to send
 * @returns {string} Transaction hash
 */
const alimentGasFees = async (targetAddress, amountETH) => {
  try {
    const targetNetwork = await Network.findOne({ symbol: 'ETH' })
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id })
    if(adminWallet.address === targetAddress){
      return;
    }


    // Calculate gas needed with a buffer (1.5x)
    const gasPrice = await getGasPrice();
    const estimatedGasWei = gasPrice * GAS_LIMIT_ERC20 * 15n / 10n;
    const gasAmountETH = parseFloat(ethers.formatEther(estimatedGasWei));

    // Ensure we're sending enough gas
    const finalGasAmount = Math.max(amountETH, gasAmountETH);

    // Transfer gas from admin wallet
    return ethMiddleware.transferFunds(
      adminWallet.address,
      securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey),
      targetAddress,
      finalGasAmount
    );
  } catch (error) {
    throw new TransactionError(`Gas funding failed: ${error.message}`);
  }
};

/**
 * Transfer AAVE between addresses
 * @param {string} senderAddress - Sender's Ethereum address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's Ethereum address
 * @param {number} amountAAVE - Amount to send in AAVE
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountAAVE
) => {
  try {
    // Validate addresses
    [senderAddress, receiverAddress].forEach(address => {
      if (!validateAddress(address)) throw new InvalidAddressError(address);
    });

    // Create wallet instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    const contract = new ethers.Contract(AAVE_CONTRACT_ADDRESS, AAVE_ABI, wallet);

    // Verify address match
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key mismatch');
    }

    // Check if ETH is needed for gas
    const needsGas = await needAlimentation(senderAddress);
    if (needsGas) {
      const gasPrice = await getGasPrice();
      const estimatedFeeWei = gasPrice * GAS_LIMIT_ERC20;
      const amountETH = parseFloat(ethers.formatUnits(estimatedFeeWei * 15n / 10n, 'ether'));
      await alimentGasFees(senderAddress, amountETH);
    }

    // Convert amount to AAVE units (18 decimals)
    const amount = ethers.parseUnits(amountAAVE.toString(), 18);

    // Check AAVE balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 18),
        ethers.formatUnits(amount, 18)
      );
    }

    // Send AAVE transaction
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
      chainId: ETH_CHAIN_ID
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

const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';

    const contract = new ethers.Contract(
      AAVE_CONTRACT_ADDRESS,
      AAVE_ABI,
      PROVIDER
    );

    const transferEvents = receipt.logs
      .filter(log => log.address.toLowerCase() === AAVE_CONTRACT_ADDRESS.toLowerCase())
      .map(log => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(event => event?.name === 'Transfer');

    return transferEvents.length > 0 ? 'confirmed' : 'failed';
    
  } catch (error) {
    console.error('Status check error:', error);
    return 'unknown';
  }
};

// Export the module
module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  needAlimentation,
  alimentGasFees,
  getTransactionStatus,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    TransactionError,
    InsufficientTokenBalanceError
  }
};