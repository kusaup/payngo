const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');
const bnbMiddleware = require('./bnb_bnb');
const Network = require('../models/networkModels')
const AdminWallet = require('../models/adminWalletModels')

const Security = require('../middlewares/securityMiddleware')
const securityMiddleware = new Security() 

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? 'https://data-seed-prebsc-1-s1.binance.org:8545' // BSC Testnet
  : 'https://bsc-dataseed.binance.org/'; // BSC Mainnet

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);
const DAI_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0xEC5dCb5Dbf4B114C9d0F65BcCAb49EC54F6A0867' // BSC Testnet DAI (mock)
  : '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'; // BSC Mainnet DAI

const DAI_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient DAI balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

const { 
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError,   
} = bnbMiddleware.errors;

// Network configuration
const BSC_CHAIN_ID = process.env.APP_MOD === 'dev' ? 97 : 56;

// Gas configuration
const MIN_GAS_BALANCE = ethers.parseUnits('0.001', 'ether'); // 0.001 BNB
const GAS_LIMIT_BEP20 = 100000n;

// Helpers
const validateAddress = (address) => ethers.isAddress(address);

const getGasPrice = async () => {
  try {
    return await PROVIDER.getGasPrice();
  } catch (error) {
    return ethers.parseUnits('5', 'gwei');
  }
};

// Core Functions

/**
 * Generate a new BSC wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  // Reuse BNB wallet generation
  return bnbMiddleware.generateWallet();
};

/**
 * Get DAI balance for a given address
 * @param {string} walletAddress - BSC wallet address
 * @returns {number} Balance in DAI
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const contract = new ethers.Contract(DAI_CONTRACT_ADDRESS, DAI_ABI, PROVIDER);
    const balance = await contract.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 18)); // DAI uses 18 decimals
  } catch (error) {
    throw new TransactionError(`DAI balance check failed: ${error.message}`);
  }
};

/**
 * Check if wallet needs gas fee alimentation
 * @param {string} walletAddress - BSC wallet address
 * @returns {boolean} True if needs gas funding
 */
const needAlimentation = async (walletAddress) => {
  try {
    const bnbBalance = await bnbMiddleware.getBalance(walletAddress);
    return bnbBalance < MIN_GAS_BALANCE;
  } catch (error) {
    throw new TransactionError(`Gas check failed: ${error.message}`);
  }
};

/**
 * Fund wallet with BNB for gas fees
 * @param {string} targetAddress - Address to fund
 * @param {number} amountBNB - Amount of BNB to send
 * @returns {string} Transaction hash
 */
const alimentGasFees = async (targetAddress, amountBNB) => {
  try {
    const targetNetwork = await Network.findOne({ symbol: 'BNB' })
    const adWallet = await AdminWallet.findOne({ network: targetNetwork._id })
    if(adWallet.address === targetAddress){
      return;
    }


    const adminWallet = new ethers.Wallet(
      securityMiddleware.two_way_aes_decrypt(adWallet.privateKey),
      PROVIDER
    );

    const tx = await adminWallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(amountBNB.toString()),
      gasLimit: 21000,
      gasPrice: await getGasPrice(),
      chainId: BSC_CHAIN_ID
    });

    return tx.hash;
  } catch (error) {
    throw new TransactionError(`Gas funding failed: ${error.message}`);
  }
};

/**
 * Transfer DAI between addresses
 * @param {string} senderAddress - Sender's BSC address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's BSC address
 * @param {number} amountDAI - Amount to send in DAI
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountDAI
) => {
  try {
    // Validate addresses
    [senderAddress, receiverAddress].forEach(address => {
      if (!validateAddress(address)) throw new InvalidAddressError(address);
    });

    // Create wallet instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    const contract = new ethers.Contract(DAI_CONTRACT_ADDRESS, DAI_ABI, wallet);

    // Verify address match
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key mismatch');
    }

    // Check and fund gas if needed
    if (await needAlimentation(senderAddress)) {
      const gasPrice = await getGasPrice();
      const estimatedFee = gasPrice * GAS_LIMIT_BEP20;
      // Calculate exact amount needed plus 10% buffer for price fluctuations
      const amountBNB = parseFloat(ethers.formatUnits(estimatedFee * 11n / 10n, 'ether'));
      await alimentGasFees(senderAddress, amountBNB);
    }

    // Convert amount to DAI units (18 decimals)
    const amount = ethers.parseUnits(amountDAI.toString(), 18);

    // Check DAI balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 18),
        ethers.formatUnits(amount, 18)
      );
    }

    // Send DAI transaction
    const gasPrice = await getGasPrice();
    const nonce = await PROVIDER.getTransactionCount(senderAddress, 'latest');

    const tx = await contract.transfer.populateTransaction(
      receiverAddress,
      amount
    );

    const sentTx = await wallet.sendTransaction({
      ...tx,
      gasPrice,
      gasLimit: GAS_LIMIT_BEP20,
      nonce,
      chainId: BSC_CHAIN_ID
    });

    return sentTx.hash;

  } catch (error) {
    throw new TransactionError(
      error instanceof InsufficientFundsError ||
      error instanceof InsufficientTokenBalanceError
        ? error.message
        : `DAI transfer failed: ${error.message}`
    );
  }
};

/**
 * Get transaction status
 * @param {string} txHash - Transaction hash
 * @returns {string} Status: pending/confirmed/failed/unknown
 */
const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';

    const contract = new ethers.Contract(
      DAI_CONTRACT_ADDRESS,
      DAI_ABI,
      PROVIDER
    );

    const transferEvents = receipt.logs
      .filter(log => log.address.toLowerCase() === DAI_CONTRACT_ADDRESS.toLowerCase())
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
    return 'unknown';
  }
};

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