// trx_usdt.js - Complete Fixed Middleware
const TronWeb = require('tronweb');
const dotenv = require('dotenv');
const trxMiddleware = require('./trx_trx');
dotenv.config();


// 1. Configuration ===================================================
const USDT_CONTRACT_ADDRESS = process.env.APP_MOD === 'dev'
  ? 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' // Nile testnet
  : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // Mainnet

const FULL_NODE = process.env.APP_MOD === 'dev' 
  ? 'https://nile.trongrid.io'
  : 'https://api.trongrid.io';


  class TransactionError extends Error {
    constructor(message) {
      super(message);
      this.name = 'TransactionError';
    }
  }

// Contract ABI
const USDT_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {"name": "to", "type": "address"},
      {"name": "value", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const tronWeb = new TronWeb({
  fullHost: FULL_NODE, 
  headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY }, 
  privateKey: process.env.TRX_WALLET_PRIVATE_KEY
});

// 3. Core Functions ==================================================
const getBalance = async (walletAddress) => {
  try {
    // Validate address
    if (!TronWeb.isAddress(walletAddress)) {
      throw new Error(`Invalid TRON address: ${walletAddress}`);
    }  
    const contract = await tronWeb.contract(USDT_ABI, USDT_CONTRACT_ADDRESS);
    
    // Use the actual wallet address parameter instead of undefined base58 variable
    const balanceHex = await contract.balanceOf(walletAddress).call();
    const balanceWei = tronWeb.toBigNumber(balanceHex.toString());
    
    return balanceWei.dividedBy(1e6).toNumber();
  } catch (error) {
    console.error('Balance Check Failed:', error.message);
    throw new Error(`USDT balance check failed: ${error.message}`);
  }
};

const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountUSDT
) => {
  try {
    console.log('transferFunds 1');
    // Validate addresses
    if (!TronWeb.isAddress(senderAddress)) {
      throw new Error(`Invalid sender TRON address: ${senderAddress}`);
    }
    if (!TronWeb.isAddress(receiverAddress)) {
      throw new Error(`Invalid receiver TRON address: ${receiverAddress}`);
    }
    console.log('transferFunds 2');
    // Get admin wallet to pay for gas fees
    const Network = require('../models/networkModels');
    const AdminWallet = require('../models/adminWalletModels');
    const Security = require('../middlewares/securityMiddleware');
    const securityMiddleware = new Security();
    console.log('transferFunds 3');
    // Get admin wallet for TRX network
    const targetNetwork = await Network.findOne({ symbol: 'TRX' });
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id });
    const adminPrivateKey = securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey);
    console.log('transferFunds 4');
    // Set up TronWeb instance with sender's private key for checking balance
    const senderTronWeb = new TronWeb({
      fullHost: FULL_NODE,
      privateKey: senderPrivateKey
    });
    
    // Set up TronWeb instance with admin's private key for paying gas
    const adminTronWeb = new TronWeb({
      fullHost: FULL_NODE,
      privateKey: adminPrivateKey
    });
    console.log('transferFunds 5');
    // Check sender's TRX balance for gas fees
    const senderTrxBalance = await senderTronWeb.trx.getBalance(senderAddress);
    const senderTrxBalanceInTRX = parseFloat(senderTronWeb.fromSun(senderTrxBalance));
    console.log(`Sender TRX balance: ${senderTrxBalanceInTRX} TRX`);
    console.log('transferFunds 6');
    // Define optimized TRX needed for a token transfer based on actual usage data
    // Typical USDT transfer on TRON uses ~0.35 TRX, we'll use tiered approach for different transaction sizes
    let requiredTrxForGas;
    
    // Tiered gas calculation based on transaction size
   if (amountUSDT < 100) {
      requiredTrxForGas = 50; // Small transactions need minimal gas
    } else if (amountUSDT < 1000) {
      requiredTrxForGas = 60; // Medium transactions
    } else {
      requiredTrxForGas = 70; // Large transactions may need more gas
    }
    console.log('transferFunds 7');
    // Add small buffer for network congestion (0.5 TRX instead of 5 TRX)
    const MIN_TRX_FOR_TOKEN_TRANSFER = 50;
    const BUFFER_TRX = 0.5;
    
    // If sender has insufficient TRX for gas, fund their wallet from admin wallet
    if (senderTrxBalanceInTRX < MIN_TRX_FOR_TOKEN_TRANSFER) {
      console.log(`Sender has insufficient TRX for gas fees. Auto-funding from admin wallet...`);
      // Calculate exact amount needed with smaller buffer
      const amountToFund = 50; // Reduced buffer
      
      await trxMiddleware.transferFunds(
        adminWallet.address,
        adminPrivateKey,
        senderAddress,
        amountToFund
      )
    }
    console.log('transferFunds 8');
    // Check sender's USDT balance
    const contract = await senderTronWeb.contract(USDT_ABI, USDT_CONTRACT_ADDRESS);
    const balanceHex = await contract.balanceOf(senderAddress).call();
    const balanceUSDT = senderTronWeb.toBigNumber(balanceHex.toString()).dividedBy(1e6).toNumber();
    console.log('transferFunds 9');
    if (balanceUSDT < amountUSDT) {
      throw new Error(`Insufficient USDT balance. Available: ${balanceUSDT}, Required: ${amountUSDT}`);
    }
    
    console.log(`Sender USDT balance: ${balanceUSDT}, Sending amount: ${amountUSDT}`);
    
    // Prepare token transfer parameters
    const parameter = [
      { type: 'address', value: receiverAddress },
      { type: 'uint256', value: amountUSDT * 1e6 } // Convert USDT to SUN (USDT has 6 decimals)
    ];

    // Optimize fee limit based on transaction size (1 TRX = 1,000,000 SUN)
    // Typical USDT transfers use ~0.35 TRX, so we can optimize this
    let feeLimit;
    if (amountUSDT < 100) {
      feeLimit = 50_000_000; // 20 TRX for small transactions
    } else if (amountUSDT < 1000) {
      feeLimit = 60_000_000; // 30 TRX for medium transactions
    } else {
      feeLimit = 70_000_000; // 40 TRX for large transactions
    }
    
    const options = {
      feeLimit: feeLimit, // Optimized fee limit based on transaction size
      callValue: 0
    };
    
    console.log(`Using optimized fee limit of ${feeLimit/1_000_000} TRX for ${amountUSDT} USDT transfer`);
    console.log('transferFunds 10');
    // Build the transaction using sender's TronWeb instance
    // This ensures the transaction is created with the correct permissions
    const tx = await senderTronWeb.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT_ADDRESS,
      'transfer(address,uint256)',
      options,
      parameter,
      senderAddress
    );
    console.log('transferFunds 11');
    if (!tx.result || !tx.result.result) {
      throw new Error(`Failed to build transaction: ${tx.transaction.txID}`);
    }
    
    // Sign with sender's private key only
    // The transaction only needs one signature since we're not using multi-signature permissions
    const signedTx = await senderTronWeb.trx.sign(tx.transaction, senderPrivateKey);
    console.log('transferFunds 12');
    // Broadcast the transaction
    // Use the same TronWeb instance that was used to sign the transaction
    const result = await senderTronWeb.trx.sendRawTransaction(signedTx);
    console.log('transferFunds 13');
    // If we get a SIGERROR, log detailed information for debugging
    if (result.code === 'SIGERROR') {
      console.error('Signature Error Details:', {
        error: result,
        decodedMessage: Buffer.from(result.message, 'hex').toString('utf8')
      });
      throw new Error(`Signature validation error: ${result.message}`);
    }

    console.log('transferFunds 14');
    console.log('Broadcast Result:', result);
    
    // Get transaction ID
    const txID = result.txid || result.transaction.txID;
    
    // Track actual gas usage for future optimization
    try {
      // Wait a bit for the transaction to be processed
      await new Promise(res => setTimeout(res, 3000));
      
      // Get transaction info to see actual resource consumption
      const txInfo = await senderTronWeb.trx.getTransactionInfo(txID);
      
      if (txInfo && txInfo.receipt) {
        const energyUsed = txInfo.receipt.energy_usage || 0;
        const energyFee = txInfo.receipt.energy_fee || 0;
        const netUsed = txInfo.receipt.net_usage || 0;
        const netFee = txInfo.receipt.net_fee || 0;
        
        // Calculate total TRX cost
        const totalCost = senderTronWeb.fromSun(energyFee + netFee);
        
        console.log('Transaction Resource Usage:');
        console.log(`- Energy Used: ${energyUsed}`);
        console.log(`- Energy Fee: ${senderTronWeb.fromSun(energyFee)} TRX`);
        console.log(`- Bandwidth Used: ${netUsed}`);
        console.log(`- Bandwidth Fee: ${senderTronWeb.fromSun(netFee)} TRX`);
        console.log(`- Total Cost: ${totalCost} TRX`);
        console.log(`- Gas Efficiency: Funded with ${MIN_TRX_FOR_TOKEN_TRANSFER + BUFFER_TRX} TRX, Used ${totalCost} TRX`);
      }
    } catch (error) {
      // Don't throw error if we can't get gas usage, just log it
      console.log('Could not retrieve gas usage information:', error.message);
    }
    
    return txID;
   
  } catch (error) {
    console.error('Error sending USDT:', error);
    throw new Error(`USDT transfer failed: ${error.message}`);
  }
};



// 5. Exports =========================================================
module.exports = {
  generateWallet: trxMiddleware.generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus: trxMiddleware.getTransactionStatus,
  errors: {
    ...trxMiddleware.errors,
    InsufficientTokenBalanceError: class extends Error {
      constructor(balance, amount) {
        super(`Insufficient USDT balance. Available: ${balance}, Required: ${amount}`);
        this.name = 'InsufficientTokenBalanceError';
      }
    },
    InsufficientResourcesError: class extends Error {
      constructor(message) {
        super(message || 'Insufficient TRON network resources (bandwidth/energy)');
        this.name = 'InsufficientResourcesError';
      }
    }
  }
};