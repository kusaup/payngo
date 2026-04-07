const { ethers } = require("ethers");
const bip39 = require('bip39');
const dotenv = require('dotenv');

dotenv.config();

// ################################
// # Network Configuration
// ################################
const NETWORK_CONFIG = {
  mainnet: {
    rpcEndpoints: [
      `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://arb1.arbitrum.io/rpc'
    ],
    chainId: 42161,
    gasLimit: 100000n,
    minGasBalance: ethers.parseUnits('0.001', 'ether'),
    derivationPath: "m/44'/60'/0'/0/0",
  },
  testnet: {
    rpcEndpoints: [
      `https://arbitrum-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      'https://sepolia-rollup.arbitrum.io/rpc'
    ],
    chainId: 421614,
    gasLimit: 150000n,
    minGasBalance: ethers.parseUnits('0.0005', 'ether'),
    derivationPath: "m/44'/1'/0'/0/0"
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
      name: `arbitrum-${CURRENT_NETWORK}`,
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

// ################################
// # Custom Errors
// ################################
class InsufficientFundsError extends Error {
  constructor(balanceETH, requiredETH) {
    super(`Insufficient ETH for gas. Available: ${balanceETH} ETH, Required: ${requiredETH} ETH`);
    this.name = 'InsufficientFundsError';
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Arbitrum address: ${address}`);
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
    const balanceWei = await activeProvider.getBalance(walletAddress);
    return parseFloat(ethers.formatEther(balanceWei));
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`Balance check failed: ${error.message}`);
  }
};

const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountETH) => {
  try {
    console.log('catshed')
    console.log('amountETH', amountETH)
    console.log('senderAddress', senderAddress)
    console.log('senderPrivateKey', senderPrivateKey)
    console.log('receiverAddress', receiverAddress)
    

    // Validate inputs
    if (!ethers.isAddress(senderAddress)) {
      throw new InvalidAddressError(address);
    }
    if (!ethers.isAddress(receiverAddress)) {
      throw new InvalidAddressError(address);
    }
    console.log('catshed 0')
    const wallet = new ethers.Wallet(senderPrivateKey, activeProvider);
    if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
      throw new TransactionError('Private key mismatch');
    }

    const [feeData, nonce] = await Promise.all([
      activeProvider.getFeeData(),
      activeProvider.getTransactionCount(senderAddress)
    ]);
    console.log('catshed 1')
    const maxFee = feeData.maxFeePerGas || feeData.gasPrice;
    const estimatedFee = maxFee * CONFIG.gasLimit;
    const balanceWei = await activeProvider.getBalance(senderAddress);
    
    // Check if this is a 'max send' (sending entire balance)
    const isMaxSend = parseFloat(amountETH) === parseFloat(ethers.formatEther(balanceWei));
    console.log('catshed 2')
    // If sending max, automatically deduct the gas fee
    let amountWei;
    if (isMaxSend) {
      if (balanceWei <= estimatedFee) {
        throw new InsufficientFundsError(
          ethers.formatEther(balanceWei),
          ethers.formatEther(estimatedFee)
        );
      }
      amountWei = balanceWei - estimatedFee;
      console.log(`Max send detected. Deducting gas fee. Sending: ${ethers.formatEther(amountWei)} ETH`);
    } else {
      amountWei = ethers.parseEther(amountETH.toString());
      if (amountWei + estimatedFee > balanceWei) {
        throw new InsufficientFundsError(
          ethers.formatEther(balanceWei),
          ethers.formatEther(amountWei + estimatedFee)
        );
      }
    }

    console.log('catshed 3')
    const tx = await wallet.sendTransaction({
      to: receiverAddress,
      value: amountWei,
      maxFeePerGas: maxFee,
      gasLimit: CONFIG.gasLimit,
      nonce
    });
    console.log(tx);
    console.log(`Transaction hash: ${tx.hash}`);
    return tx.hash;
  } catch (error) {
    activeProvider = createProvider();
    throw new TransactionError(`ETH transfer failed: ${error.message}`);
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

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus,
  needAlimentation: async () => false,
  alimentGasFees: async () => null,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    TransactionError
  }
};