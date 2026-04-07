const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');
const baseMiddleware = require('./base_eth');
const Network = require('../models/networkModels')
const AdminWallet = require('../models/adminWalletModels')

const Security = require('../middlewares/securityMiddleware')
const securityMiddleware = new Security() 

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
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base mainnet
    chainId: 8453,
    gasLimit: 100000n,
    minGasBalance: ethers.parseUnits('0.001', 'ether'),
    derivationPath: "m/44'/60'/0'/0/0",
    tokenDecimals: 6
  },
  testnet: {
    rpcEndpoints: [
      `https://base-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://sepolia.base.org'
    ],
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Testnet USDC address
    chainId: 84532,
    gasLimit: 150000n,
    minGasBalance: ethers.parseUnits('0.0005', 'ether'),
    derivationPath: "m/44'/1'/0'/0/0",
    tokenDecimals: 6
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
      name: `ethereum-${CURRENT_NETWORK}`,
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
const TOKEN_CONTRACT = new ethers.Contract(
  CONFIG.tokenAddress,
  [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 value) returns (bool)"
  ],
  activeProvider
);

// ################################
// # Custom Errors
// ################################
class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient USDC balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
  }
}

class InsufficientFundsError extends Error {
  constructor(balanceETH, requiredETH) {
    super(`Insufficient ETH for gas. Available: ${balanceETH} ETH, Required: ${requiredETH} ETH`);
    this.name = 'InsufficientFundsError';
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Ethereum address: ${address}`);
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
      const balance = await TOKEN_CONTRACT.balanceOf(walletAddress);
      return parseFloat(ethers.formatUnits(balance, CONFIG.tokenDecimals));
    } catch (error) {
      activeProvider = createProvider();
      throw new TransactionError(`USDC balance check failed: ${error.message}`);
    }
};

const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountUSDC) => {
    try {
      [senderAddress, receiverAddress].forEach(address => {
        if (!ethers.isAddress(address)) throw new InvalidAddressError(address);
      });
  
      const wallet = new ethers.Wallet(senderPrivateKey, activeProvider);
      if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
        throw new TransactionError('Private key mismatch');
      }
  
      const [tokenBalance, feeData, nonce] = await Promise.all([
        TOKEN_CONTRACT.balanceOf(senderAddress),
        activeProvider.getFeeData(),
        activeProvider.getTransactionCount(senderAddress)
      ]);

      const amountWei = ethers.parseUnits(amountUSDC.toString(), CONFIG.tokenDecimals);
      if (tokenBalance < amountWei) {
        throw new InsufficientTokenBalanceError(
          ethers.formatUnits(tokenBalance, CONFIG.tokenDecimals),
          amountUSDC
        );
      }

      const maxFee = feeData.maxFeePerGas || feeData.gasPrice;
      const estimatedFee = maxFee * CONFIG.gasLimit;
      const needsGas = await needAlimentation(senderAddress);
      console.log('needsGas', needsGas)
      if (needsGas) {
        await alimentGasFees(senderAddress, estimatedFee);
      }
  
      const tx = await TOKEN_CONTRACT.connect(wallet).transfer(
        receiverAddress,
        amountWei,
        {
          maxFeePerGas: maxFee,
          gasLimit: CONFIG.gasLimit,
          nonce
        }
      );
  
      return tx.hash;
    } catch (error) {
      activeProvider = createProvider();
      throw new TransactionError(`USDC transfer failed: ${error.message}`);
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


const needAlimentation = async (walletAddress) => {
  try {
    const [feeData] = await Promise.all([
      activeProvider.getFeeData()
    ]);

    const maxFee = feeData.maxFeePerGas || feeData.gasPrice;
    const minGasAmount = ethers.formatEther(CONFIG.minGasBalance);
    const ethBalance = await baseMiddleware.getBalance(walletAddress);
    console.log('ETH balance:', ethBalance, 'ETH');

    return ethBalance < minGasAmount;
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`Gas fee check failed: ${error.message}`);
  }
};

const alimentGasFees = async (targetAddress, amountETH) => {
  try {
    // Find the ETH network and admin wallet
    const targetNetwork = await Network.findOne({ symbol: 'BASE' })
    if (!targetNetwork) {
      throw new TransactionError('ETH network not found in database');
    }
    
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id })
    if (!adminWallet || !adminWallet.address || !adminWallet.privateKey) {
      throw new TransactionError('Admin wallet not found or invalid');
    }

    if(adminWallet.address === targetAddress){
      return;
    }

    // Use network's minimum gas balance as base amount
    const minGasAmount = ethers.formatEther(CONFIG.minGasBalance);
    console.log('Sending minimum gas fee:', minGasAmount, 'ETH to', targetAddress);

    return await baseMiddleware.transferFunds(
      adminWallet.address,
      securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey),
      targetAddress,
      minGasAmount
    );
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`Gas fee alimentation failed: ${error.message}`);
  }
};

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