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
  ? `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
  : `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`;

const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);
const DAI_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0x68194a729C2450ad26072b3D33ADaCbcef39D574' // Sepolia testnet DAI
  : '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // Mainnet DAI

const DAI_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Reuse existing errors from ETH middleware
const { 
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError 
} = ethMiddleware.errors;

// Gas configuration
const MIN_GAS_BALANCE = ethers.parseUnits('0.001', 'ether'); // 0.001 ETH
const GAS_LIMIT_ERC20 = 100000n;

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient DAI balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

// Helpers
const validateAddress = (address) => ethers.isAddress(address);

const getGasPrice = async () => {
  try {
    const feeData = await PROVIDER.getFeeData();
    return feeData.maxFeePerGas || feeData.gasPrice;
  } catch (error) {
    return ethers.parseUnits('10', 'gwei');
  }
};

// Core Functions
const generateWallet = async () => ethMiddleware.generateWallet();

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

const needAlimentation = async (walletAddress) => {
  try {
    const ethBalance = await ethMiddleware.getBalance(walletAddress);
    return ethBalance < parseFloat(ethers.formatUnits(MIN_GAS_BALANCE, 'ether'));
  } catch (error) {
    throw new TransactionError(`Gas check failed: ${error.message}`);
  }
};

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

    // Check gas balance first
    const needsGas = await needAlimentation(senderAddress);
    if (needsGas) {
      const gasPrice = await getGasPrice();
      const estimatedFeeWei = gasPrice * GAS_LIMIT_ERC20;
      const amountETH = parseFloat(ethers.formatUnits(estimatedFeeWei * 15n / 10n, 'ether'));
      await alimentGasFees(senderAddress, amountETH);
    }

    // Create wallet and contract instance
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    const contract = new ethers.Contract(DAI_CONTRACT_ADDRESS, DAI_ABI, wallet);

    // Convert amount to DAI units (18 decimals)
    const amount = ethers.parseUnits(amountDAI.toString(), 18);

    // Check token balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 18),
        ethers.formatUnits(amount, 18)
      );
    }

    // Build and send transaction
    const feeData = await PROVIDER.getFeeData();
    const nonce = await PROVIDER.getTransactionCount(senderAddress, 'latest');

    // Estimate gas for this specific transaction
    const gasEstimate = await contract.transfer.estimateGas(receiverAddress, amount);
    const adjustedGasLimit = gasEstimate * 12n / 10n; // Add 20% buffer

    const tx = await contract.transfer.populateTransaction(
      receiverAddress,
      amount
    );

    const sentTx = await wallet.sendTransaction({
      ...tx,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: adjustedGasLimit,
      nonce,
      type: 2 // Explicitly set EIP-1559 transaction type
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

const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';

    // Create contract interface with full ABI
    const contract = new ethers.Contract(
      DAI_CONTRACT_ADDRESS,
      [
        ...DAI_ABI,
        "event Transfer(address indexed from, address indexed to, uint256 value)"
      ],
      PROVIDER
    );

    // Check for Transfer events
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
    console.error('Status check error:', error);
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