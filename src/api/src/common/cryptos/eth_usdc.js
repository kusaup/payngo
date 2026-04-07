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
const USDC_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' // Sepolia testnet USDC
  : '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Mainnet USDC

const USDC_ABI = [
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

// Gas configuration (same as USDT)
const MIN_GAS_BALANCE = ethers.parseUnits('0.001', 'ether');
const GAS_LIMIT_ERC20 = 100000n;

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient USDC balance. Available: ${balance}, Required: ${amount}`);
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
const generateWallet = ethMiddleware.generateWallet;

const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, PROVIDER);
    const balance = await contract.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 6)); // USDC uses 6 decimals
  } catch (error) {
    throw new TransactionError(`USDC balance check failed: ${error.message}`);
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
  amountUSDC
) => {
  try {
    // Validate addresses
    [senderAddress, receiverAddress].forEach(address => {
      if (!validateAddress(address)) throw new InvalidAddressError(address);
    });

    // Check gas balance
    const needsGas = await needAlimentation(senderAddress);
    if (needsGas) {
      const gasPrice = await getGasPrice();
      const estimatedFeeWei = gasPrice * GAS_LIMIT_ERC20;
      const amountETH = parseFloat(ethers.formatUnits(estimatedFeeWei * 15n / 10n, 'ether'));
      await alimentGasFees(senderAddress, amountETH);
    }

    // Create wallet and contract
    const wallet = new ethers.Wallet(senderPrivateKey, PROVIDER);
    const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, wallet);

    // Convert amount to USDC units
    const amount = ethers.parseUnits(amountUSDC.toString(), 6);

    // Check balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 6),
        ethers.formatUnits(amount, 6)
      );
    }

    // Prepare transaction
    const feeData = await PROVIDER.getFeeData();
    const nonce = await PROVIDER.getTransactionCount(senderAddress, 'latest');

    const tx = await contract.transfer.populateTransaction(
      receiverAddress,
      amount
    );

    // Send transaction
    const sentTx = await wallet.sendTransaction({
      ...tx,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: GAS_LIMIT_ERC20,
      nonce
    });

    return sentTx.hash;

  } catch (error) {
    throw new TransactionError(
      error instanceof InsufficientFundsError ||
      error instanceof InsufficientTokenBalanceError
        ? error.message
        : `USDC transfer failed: ${error.message}`
    );
  }
};

const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';

    const contract = new ethers.Contract(
      USDC_CONTRACT_ADDRESS,
      USDC_ABI,
      PROVIDER
    );

    const transferEvents = receipt.logs
      .filter(log => log.address.toLowerCase() === USDC_CONTRACT_ADDRESS.toLowerCase())
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