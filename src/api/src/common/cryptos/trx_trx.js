// trx_trx.js - Tron Native Coin Middleware
const TronWeb = require('tronweb');
const dotenv = require('dotenv');

dotenv.config();

// Tron Network Configuration
const FULL_NODE = process.env.APP_MOD === 'dev' 
  ? 'https://nile.trongrid.io'
  : 'https://api.trongrid.io';

  const tronWeb = new TronWeb({
    fullHost: FULL_NODE, 
    headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY }, 
    privateKey: process.env.TRX_WALLET_PRIVATE_KEY
  });

// Custom Errors
class InsufficientEnergyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsufficientEnergyError';
  }
}

class InsufficientBandwidthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsufficientBandwidthError';
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid TRON address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

class TransactionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransactionError';
  }
}

// Helpers
const validateAddress = (address) => TronWeb.isAddress(address);

const getAccountResources = async (address) => {
  try {
    return await tronWeb.trx.getAccountResources(address);
  } catch (error) {
    throw new TransactionError(`Resource check failed: ${error.message}`);
  }
};

// Core Functions

/**
 * Generate a new TRON wallet
 * @returns {Object} Wallet details (address, privateKey)
 */
const generateWallet = async () => {
  const account = await tronWeb.createAccount();
  return {
    address: account.address.base58,
    privateKey: account.privateKey,
    mnemonic: ''
  };
};

/**
 * Get TRX balance and resources
 * @param {string} walletAddress - TRON wallet address
 * @returns {Object} Balance and resources
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const balance = await tronWeb.trx.getBalance(walletAddress);
    return parseFloat(tronWeb.fromSun(balance));
  } catch (error) {
    throw new TransactionError(`Balance check failed: ${error.message}`);
  }
};

const isFreeTransfer = async (address) => {
  try {
    const resources = await tronWeb.trx.getAccountResources(address);
    return (
      resources.freeNetUsed < resources.freeNetLimit && // Free bandwidth available
      resources.EnergyUsed < resources.EnergyLimit       // Energy available
    );
  } catch (e) {
    console.warn('[isFreeTransfer] Resource check failed:', e.message);
    return false;
  }
};

const freezeBalance = async (walletAddress, amount) => {
  try {
    // Validate address
    if (!tronWeb.isAddress(walletAddress)) {
      throw new Error(`Invalid TRON address: ${walletAddress}`);
    }

    // Validate amount
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
    }

    
  
    // Convert amount to SUN (TRON's smallest unit)
    const amountSun = tronWeb.toSun(amount);
    
    // Use freezeBalanceV2 instead of freezeBalance
    // This is the updated method that doesn't have the 3-day restriction
    const transaction = await tronWeb.transactionBuilder.freezeBalanceV2(
      amountSun,           // Amount in SUN
      'ENERGY',            // Resource type
    );
    
    // Sign the transaction
    const signedTx = await tronWeb.trx.sign(transaction);
    
    // Broadcast the transaction
    const freezeResult = await tronWeb.trx.sendRawTransaction(signedTx);
    
    console.log('Transaction ID:', freezeResult.txid || freezeResult.transaction.txID);  
    console.log('Balance frozen successfully.');
    
    return freezeResult;
  } catch (error) {
    console.error('Freeze Balance Failed:', error);
    throw new Error(`Freeze Balance failed: ${error.message || error}`);
  }
};


const unfreezeBalance = async (walletAddress, amount, resourceType = 'ENERGY') => {
  try {
    // Validate address
    if (!tronWeb.isAddress(walletAddress)) {
      throw new Error(`Invalid TRON address: ${walletAddress}`);
    }

    // Validate amount
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
    }
    
    // Validate resource type
    if (!['ENERGY', 'BANDWIDTH'].includes(resourceType)) {
      throw new Error(`Invalid resource type: ${resourceType}. Must be 'ENERGY' or 'BANDWIDTH'.`);
    }

    // Convert amount to SUN (TRON's smallest unit)
    const amountSun = tronWeb.toSun(amount);
    
    // Create the unfreeze transaction
    const transaction = await tronWeb.transactionBuilder.unfreezeBalanceV2(
      amountSun,           // Amount in SUN
      resourceType,        // Resource type
      walletAddress        // Owner address
    );
    
    // Sign the transaction
    const signedTx = await tronWeb.trx.sign(transaction);
    
    // Broadcast the transaction
    const unfreezeResult = await tronWeb.trx.sendRawTransaction(signedTx);
    
    console.log('Unfreeze result:', unfreezeResult);
    console.log('Transaction ID:', unfreezeResult.txid || unfreezeResult.transaction.txID);  
    console.log('Balance unfrozen successfully.');
    
    return unfreezeResult;
  } catch (error) {
    console.error('Unfreeze Balance Failed:', error);
    throw new Error(`Unfreeze Balance failed: ${error.message || error}`);
  }
};

const delegateEnergy = async (adminPrivateKey, recipientAddress, energyAmount) => {
  try {
    const adminTronWeb = new TronWeb({
      fullHost: FULL_NODE,
      headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY },
      privateKey: adminPrivateKey,
    });

    const adminAddress = adminTronWeb.address.fromPrivateKey(adminPrivateKey);

    // Check FreezeEnergyV2 balance
    const accountInfo = await adminTronWeb.trx.getAccount(adminAddress);
    const freezeEnergyV2 = accountInfo.frozenV2?.find(f => f.type === 'ENERGY')?.amount || 0;
    console.log('[delegateEnergy] Available FreezeEnergyV2:', freezeEnergyV2);

    if (freezeEnergyV2 < energyAmount) {
      throw new Error(`Admin has ${freezeEnergyV2} energy staked (needs ${energyAmount})`);
    }

    // Delegate energy
    const tx = await adminTronWeb.transactionBuilder.delegateResource(
      energyAmount,      // Raw energy amount (NO SUN CONVERSION)
      recipientAddress,  // Test wallet address
      "ENERGY",
      adminAddress,      // Admin address
      false,
      {}
    );

    const signedTx = await adminTronWeb.trx.sign(tx);
    const result = await adminTronWeb.trx.sendRawTransaction(signedTx);

    if (!result.result) {
      throw new Error(`Delegation failed: ${result.message}`);
    }

    return result.txid;
  } catch (error) {
    console.error('[delegateEnergy] Error:', error.message);
    throw new TransactionError(`Energy delegation failed: ${error.message}`);
  }
};

const undelegateEnergy = async (adminPrivateKey, recipientAddress) => {
  try {
    console.log('undelegateEnergy 1')
    const adminTronWeb = new TronWeb({
      fullHost: FULL_NODE,
      headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY },
      privateKey: adminPrivateKey,
    });
    console.log('undelegateEnergy 2')
    
    // Get admin address from the private key
    const account = adminTronWeb.address.fromPrivateKey(adminPrivateKey);
    console.log(`[undelegateEnergy] Admin address: ${account}`);
    
    // Use the correct parameter format for unfreezeBalanceV2
    // We don't specify an amount because we want to unfreeze all delegated resources
    const tx = await adminTronWeb.transactionBuilder.unfreezeBalanceV2(
      0, // Amount to unfreeze (0 means all)
      "ENERGY",
      account,
      {
        receiverAddress: recipientAddress
      }
    );
  console.log('undelegateEnergy 3')
  const signedTx = await adminTronWeb.trx.sign(tx);
  console.log('undelegateEnergy 4')
  const result = await adminTronWeb.trx.sendRawTransaction(signedTx);
  console.log('[undelegateEnergy] Raw result:', result);
  
  console.log('undelegateEnergy 5')
  if (!result.result) {
    let errorMessage = result?.message || 'Unknown undelegation failure';
    
    // Decode if it's hex
    if (/^[0-9a-fA-F]+$/.test(errorMessage)) {
      try {
        errorMessage = Buffer.from(errorMessage, 'hex').toString('utf8');
      } catch (decodeErr) {
        console.warn('[undelegateEnergy] Failed to decode hex error:', decodeErr.message);
      }
    }
    
    throw new TransactionError(`Energy undelegation failed: ${errorMessage}`);
  }

  console.log(`[undelegateEnergy] Success. TXID: ${result.txid}`);
  return result.txid;
  } catch (error) {
    console.error('[undelegateEnergy] Error:', error.message);
    throw new TransactionError(`Energy undelegation failed: ${error.message}`);
  }
};

/**
 * Transfer TRX between addresses
 * @param {string} senderAddress - Sender's TRON address
 * @param {string} senderPrivateKey - Sender's private key
 * @param {string} receiverAddress - Receiver's TRON address
 * @param {number} amountTRX - Amount to send in TRX
 * @returns {string} Transaction ID
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountTRX
) => {
  console.log('trx_trx 1');
  // Define variables at function scope level so they're accessible in catch blocks
  let balanceTRX2 = 0;
  let balanceSun = 0;
  let isFullTransfer = false;
  
  try {
    console.log('[transferFunds] Starting transfer:', { senderAddress, receiverAddress, amountTRX });

    // Validate addresses
    [senderAddress, receiverAddress].forEach(address => {
      if (!validateAddress(address)) throw new InvalidAddressError(address);
    });
    console.log('trx_trx 2');
    // Check and fund gas/resources before transfer
    /*const MIN_TRX_BALANCE = 5;
    const estimateFee = 2; // 2 TRX buffer
    const balanceTRX = await getBalance(senderAddress);

    if (balanceTRX < (amountTRX + estimateFee)) {
      console.log('[Funding] Initiating admin funding for sender');
      
      const Network = require('../models/networkModels');
      const AdminWallet = require('../models/adminWalletModels');
      const Security = require('../middlewares/securityMiddleware');
      const securityMiddleware = new Security();
      
      // Get admin wallet details
      const targetNetwork = await Network.findOne({ symbol: 'TRX' });
      const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id });
      const needed = (amountTRX + estimateFee) - balanceTRX + MIN_TRX_BALANCE;

      // Verify admin balance
      const adminBalance = await tronWeb.trx.getBalance(adminWallet.address);
      const neededSun = tronWeb.toSun(needed);
      console.log('[Funding] Admin balance:', tronWeb.fromSun(adminBalance), 'TRX');

      if (Number(adminBalance) < neededSun) {
        throw new TransactionError(
          `Admin wallet needs ${needed} TRX but has ${tronWeb.fromSun(adminBalance)}`
        );
      }

      // Send funding transaction
      console.log(`[Funding] Sending ${needed} TRX from admin ${adminWallet.address} to ${senderAddress}`);
      const tx = await tronWeb.trx.sendTransaction(
        senderAddress,
        neededSun.toString()
      );

      if (!tx?.txid) {
        throw new TransactionError('Funding transaction failed to broadcast');
      }

      console.log('[Funding] Transaction ID:', tx.txid);

      // Enhanced confirmation check
      let confirmed = false;
      let confirmationInfo = null;
      const MAX_ATTEMPTS = 25; // 25 * 5s = 125s total
      
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise(res => setTimeout(res, 5000));
        try {
          confirmationInfo = await tronWeb.trx.getTransactionInfo(tx.txid);
          console.log(`[Funding] Check ${i+1}/${MAX_ATTEMPTS}:`, 
            confirmationInfo?.result || 'Pending confirmation');

          if (confirmationInfo?.blockNumber) {
            confirmed = true;
            break;
          }
          
          if (confirmationInfo?.result === 'FAILED') {
            throw new TransactionError(
              `Funding failed: ${confirmationInfo.resMessage || 'Unknown reason'}`
            );
          }
        } catch (error) {
          console.error(`[Funding] Check error:`, error.message);
        }
      }

      if (!confirmed) {
        throw new TransactionError(
          `Funding not confirmed after ${MAX_ATTEMPTS} attempts. ` +
          `Verify TX: https://tronscan.org/#/transaction/${tx.txid}`
        );
      }

      console.log('[Funding] Transaction confirmed in block:', confirmationInfo.blockNumber);
    }*/

    // Get updated sender balance
    balanceSun = await tronWeb.trx.getBalance(senderAddress);
    balanceTRX2 = tronWeb.fromSun(balanceSun);
    console.log('[transferFunds] Post-funding balance:', balanceTRX2, 'TRX');
    console.log('trx_trx 3');
    // Fee calculation logic - optimized for more accurate transfers, especially for small amounts
    isFullTransfer = amountTRX >= balanceTRX2;
    console.log('trx_trx 4');
    // Reduced base fee for small transactions
    const baseFee = BigInt(300_000); // 0.3 TRX in SUN (reduced from 0.5 TRX)
    // Calculate dynamic fee based on transaction amount rather than total balance
    // For smaller transactions, use smaller fees with more precise calculation
    const txAmountSUN = isFullTransfer ? BigInt(balanceSun) : BigInt(Math.floor(Number(amountTRX) * 1_000_000));
    // More precise dynamic fee calculation with lower maximum for small transfers
    const dynamicFee = BigInt(Math.floor(Math.min(
      // For very small amounts (< 5 TRX), use minimal dynamic fee
      Number(txAmountSUN) < 5_000_000 ? Number(txAmountSUN) / 500 : Number(txAmountSUN) / 300, 
      1_000_000))); // Max 1.0 TRX, reduced from 1.5 TRX
    let feeSUN = baseFee + dynamicFee;
    let feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));

    if (await isFreeTransfer(senderAddress)) {
      console.log('[transferFunds] Transfer is free using bandwidth.');
      feeSUN = BigInt(0);
      feeTRX = 0;
    } else {
      // Calculate fees normally (Bandwidth/Energy cost)
      feeSUN = baseFee + dynamicFee;
      feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));
    }
    console.log('trx_trx 5');
    // For very small balances, use an even more minimal fee to maximize transfer amount
    // Special handling for micro-balances (< 1 TRX)
    if (balanceTRX2 < 1 && isFullTransfer) {
      // Use absolute minimum fee that will still allow transaction to succeed
      // For micro-balances, use an ultra-minimal fee
      const ultraMinimalFeeSUN = BigInt(100_000); // 0.1 TRX ultra minimum for micro-balances
      console.log('[transferFunds] Using ultra-minimal fee for micro-balance transfer');
      feeSUN = ultraMinimalFeeSUN;
      feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));
    }
    // For small balances (1-2 TRX)
    else if (balanceTRX2 < 2 && isFullTransfer) {
      // Use absolute minimum fee that will still allow transaction to succeed
      const minimalFeeSUN = BigInt(200_000); // 0.2 TRX absolute minimum (reduced from 0.25)
      if (feeSUN > minimalFeeSUN) {
        console.log('[transferFunds] Using minimal fee for small balance transfer');
        feeSUN = minimalFeeSUN;
        feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));
      }
    }
    console.log('trx_trx 6');
    console.log('[transferFunds] Fee calculation:', { 
      baseFee: tronWeb.fromSun(baseFee.toString()), 
      dynamicFee: tronWeb.fromSun(dynamicFee.toString()), 
      totalFee: feeTRX 
    });

    // Amount calculation logic - optimized for accurate transfers with special handling for small amounts
    let amountToSendSUN;
    if (isFullTransfer) {
      // For full transfers, send entire balance minus fee with precision handling
      // Use exact calculation to maximize the transfer amount
      amountToSendSUN = BigInt(balanceSun) - feeSUN - BigInt(100_000); // 0.1 TRX buffer
      
      // For very small balances, ensure we're not leaving dust behind
      if (balanceTRX2 < 1) {
        // For micro-balances (< 1 TRX), use ultra-minimal fee to maximize transfer
        const ultraMinimalFeeSUN = BigInt(100_000); // 0.1 TRX ultra minimum
        const maxPossibleAmount = BigInt(balanceSun) - ultraMinimalFeeSUN;
        
        console.log('[transferFunds] Optimizing micro-balance transfer to maximize amount');
        amountToSendSUN = maxPossibleAmount;
        feeSUN = ultraMinimalFeeSUN;
        feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));
      }
      else if (balanceTRX2 < 2) {
        // For small balances (1-2 TRX), use minimal fee
        const minimalFeeSUN = BigInt(200_000); // 0.2 TRX minimum (reduced from 0.25)
        const maxPossibleAmount = BigInt(balanceSun) - minimalFeeSUN;
        
        if (maxPossibleAmount > amountToSendSUN) {
          console.log('[transferFunds] Optimizing small balance transfer to minimize dust');
          amountToSendSUN = maxPossibleAmount;
          feeSUN = minimalFeeSUN;
          feeTRX = parseFloat(tronWeb.fromSun(feeSUN.toString()));
        }
      }
      
      if (amountToSendSUN <= 0) {
        throw new TransactionError(
          `Insufficient balance after fees. Available: ${balanceTRX2} TRX, Fee: ${feeTRX} TRX`
        );
      }
      console.log('[transferFunds] Full transfer amount:', tronWeb.fromSun(amountToSendSUN.toString()), 'TRX');
    } else {
      // For partial transfers, ensure we send exactly what was requested
      // Convert TRX to SUN with proper precision handling - use floor to avoid overestimation
      amountToSendSUN = BigInt(Math.floor(Number(amountTRX) * 1_000_000));
      
      // For small amounts, ensure precision by using exact calculation
      if (amountTRX < 5) {
        // Use more precise calculation for small amounts
        const preciseSUN = BigInt(Math.floor(Number(amountTRX) * 1_000_000));
        amountToSendSUN = preciseSUN;
      }
      
      // Check if we have enough balance
      if (BigInt(balanceSun) < (amountToSendSUN + feeSUN)) {
        throw new TransactionError(
          `Insufficient balance. Available: ${balanceTRX2} TRX, Required: ${amountTRX + feeTRX} TRX`
        );
      }
      console.log('[transferFunds] Partial transfer amount:', tronWeb.fromSun(amountToSendSUN.toString()), 'TRX');
    }
    console.log('trx_trx 7');
    // Log the final amounts for verification
    console.log('[transferFunds] Summary:', {
      requestedAmount: amountTRX,
      sendingAmount: tronWeb.fromSun(amountToSendSUN.toString()),
      fee: feeTRX,
      availableBalance: balanceTRX2
    });

    // Create and send main transaction
    console.log('[transferFunds] Creating main transaction');
    
    // For micro-balances, use special transaction parameters
    let txOptions = {};
    if (balanceTRX2 < 0.6) {
      // For extremely small balances, use minimal transaction parameters
      // This helps ensure the transaction can succeed with minimal resources
      console.log('[transferFunds] Using micro-balance transaction optimization');
      txOptions = {
        permissionId: 0,
        extraData: '0x', // Minimal extra data
        shouldPollResponse: false // Don't wait for polling response
      };
    }
    console.log('trx_trx 8');
    const transaction = await tronWeb.transactionBuilder.sendTrx(
      receiverAddress,
      amountToSendSUN.toString(),
      senderAddress,
      txOptions
    );
    console.log('trx_trx 9');
    // Sign and broadcast with optimized fee limit
    // Lower feeLimit to reduce the amount of energy reserved for the transaction
    // This helps ensure more of the requested amount is actually transferred
    // For small transactions, use an even smaller feeLimit
    let feeLimit;
    if (balanceTRX2 < 0.6) {
      // Ultra-minimal feeLimit for micro-balances (< 0.6 TRX)
      feeLimit = 15_000; // Absolute minimum for transaction to succeed
    } else if (balanceTRX2 < 2) {
      // Very small feeLimit for small balances (< 2 TRX)
      feeLimit = 25_000;
    } else {
      // Standard reduced feeLimit for normal transactions
      feeLimit = 100_000;
    }
    
    console.log('[transferFunds] Using feeLimit:', feeLimit);
    const signedTx = await tronWeb.trx.sign(transaction, senderPrivateKey, feeLimit);
    console.log('trx_trx 10');
    const result = await tronWeb.trx.sendRawTransaction(signedTx);
    console.log('trx_trx 11');
    if (!result?.result) {
      let errorMessage = result?.message || 'No error message provided';
      
      // Decode hex error message if present (common in TRON errors)
      if (errorMessage && /^[0-9a-fA-F]+$/.test(errorMessage)) {
        try {
          // Convert hex to readable text
          const decodedError = Buffer.from(errorMessage, 'hex').toString('utf8');
          console.error('[transferFunds] Decoded error:', decodedError);
          errorMessage = `${decodedError} (hex: ${errorMessage})`;
        } catch (decodeErr) {
          console.error('[transferFunds] Failed to decode error message:', decodeErr.message);
        }
      }
      
      console.error('[transferFunds] Transaction failed:', errorMessage);
      throw new TransactionError(`Main transaction failed: ${errorMessage}`);
    }

    console.log('[transferFunds] Transaction successful. TXID:', result.txid);
    return result.txid;

  } catch (error) {
    console.error('[transferFunds] Critical Error:', error);
    
    // Special handling for micro-balance failures
    // If this is a micro-balance transfer (< 0.6 TRX) and we got a balance error,
    // try one more time with even more aggressive optimization
    if (balanceTRX2 < 0.6 && isFullTransfer && 
        (error.message.includes('balance is not sufficient') || 
         error.message.includes('Contract validate error'))) {
      
      try {
        console.log('[transferFunds] Micro-balance transfer failed, attempting emergency retry with minimal parameters');
        
        // Use absolute minimum fee possible
        const emergencyFeeSUN = BigInt(50_000); // 0.05 TRX absolute minimum emergency fee
        const emergencyAmountToSendSUN = BigInt(balanceSun) - emergencyFeeSUN;
        
        if (emergencyAmountToSendSUN <= 0) {
          throw new Error('Balance too small even for emergency parameters');
        }
        
        console.log('[transferFunds] Emergency retry amount:', tronWeb.fromSun(emergencyAmountToSendSUN.toString()), 'TRX');
        
        // Create transaction with minimal parameters
        const emergencyTxOptions = {
          permissionId: 0,
          extraData: '0x',
          shouldPollResponse: false
        };
        
        const emergencyTx = await tronWeb.transactionBuilder.sendTrx(
          receiverAddress,
          emergencyAmountToSendSUN.toString(),
          senderAddress,
          emergencyTxOptions
        );
        
        // Use minimal feeLimit
        const emergencyFeeLimit = 10_000; // Absolute minimum
        const emergencySignedTx = await tronWeb.trx.sign(emergencyTx, senderPrivateKey, emergencyFeeLimit);
        const emergencyResult = await tronWeb.trx.sendRawTransaction(emergencySignedTx);
        
        if (!emergencyResult?.result) {
          throw new Error('Emergency retry failed');
        }
        
        console.log('[transferFunds] Emergency retry successful. TXID:', emergencyResult.txid);
        return emergencyResult.txid;
      } catch (retryError) {
        console.error('[transferFunds] Emergency retry failed:', retryError);
        // Fall through to original error
      }
    }
    
    throw new TransactionError(`TRX transfer failed: ${error.message}`);
  }
};

/**
 * Check transaction status
 * @param {string} txID - Transaction ID
 * @returns {string} Status: pending/confirmed/failed
 */
const getTransactionStatus = async (txID) => {
  try {
    const transaction = await tronWeb.trx.getTransactionInfo(txID);
    if (!transaction || !transaction.blockNumber) return 'pending';
    
    // Transaction is in a block but check receipt
    if (!transaction.receipt) return 'pending';
    
    // Check net fee to confirm transaction was processed
    if (transaction.receipt.net_fee) {
      return 'confirmed';
    }
    
    return 'failed';
  } catch (error) {
    return 'unknown';
  }
};

module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  freezeBalance,
  unfreezeBalance,
  delegateEnergy,
  undelegateEnergy,
  getTransactionStatus,
  validateAddress,
  errors: {
    InsufficientEnergyError,
    InsufficientBandwidthError,
    InvalidAddressError,
    TransactionError
  }
};