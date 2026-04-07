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
const SHIB_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? '0x79AEE81e6863A223793bd59C9b3497599B995C26' // Replace with actual testnet contract
  : '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE'; // Mainnet SHIB

const SHIB_ABI = [
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

// Gas configuration (adjusted for typical SHIB transactions)
const MIN_GAS_BALANCE = ethers.parseUnits('0.001', 'ether');
const GAS_LIMIT_ERC20 = 100000n;

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient SHIB balance. Available: ${balance}, Required: ${amount}`);
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
    const contract = new ethers.Contract(SHIB_CONTRACT_ADDRESS, SHIB_ABI, PROVIDER);
    const balance = await contract.balanceOf(walletAddress);
    return parseFloat(ethers.formatUnits(balance, 18)); // SHIB uses 18 decimals
  } catch (error) {
    throw new TransactionError(`SHIB balance check failed: ${error.message}`);
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
  amountSHIB
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
    const contract = new ethers.Contract(SHIB_CONTRACT_ADDRESS, SHIB_ABI, wallet);

    // Convert amount to SHIB units (18 decimals)
    const amount = ethers.parseUnits(amountSHIB.toString(), 18);

    // Check balance
    const balance = await contract.balanceOf(senderAddress);
    if (balance < amount) {
      throw new InsufficientTokenBalanceError(
        ethers.formatUnits(balance, 18),
        ethers.formatUnits(amount, 18)
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
        : `SHIB transfer failed: ${error.message}`
    );
  }
};

const getTransactionStatus = async (txHash) => {
  try {
    const receipt = await PROVIDER.getTransactionReceipt(txHash);
    
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';

    const contract = new ethers.Contract(
      SHIB_CONTRACT_ADDRESS,
      SHIB_ABI,
      PROVIDER
    );

    const transferEvents = receipt.logs
      .filter(log => log.address.toLowerCase() === SHIB_CONTRACT_ADDRESS.toLowerCase())
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