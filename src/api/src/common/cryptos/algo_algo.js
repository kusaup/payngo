// algo_algo.js - Complete Revised Middleware
const algosdk = require('algosdk');
const dotenv = require('dotenv');
const {
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError,
  NetworkError
} = require('./common/errors');

dotenv.config();

// ================= Configuration =================
const NETWORK_CONFIG = {
  testnet: {
    algod: 'https://testnet-api.algonode.cloud',
    indexer: 'https://testnet-idx.algonode.cloud',
    port: 443,
    token: ''
  },
  mainnet: {
    algod: 'https://mainnet-api.algonode.cloud',
    indexer: 'https://mainnet-idx.algonode.cloud',
    port: 443,
    token: ''
  }
};

// ================= Client Initialization =================
const getNetworkConfig = () => {
  const isTestnet = process.env.APP_MOD === 'dev';
  return isTestnet ? NETWORK_CONFIG.testnet : NETWORK_CONFIG.mainnet;
};

const getAlgodClient = () => {
  const { algod, port, token } = getNetworkConfig();
  return new algosdk.Algodv2(token, algod, port);
};

const getIndexerClient = () => {
  const { indexer, port, token } = getNetworkConfig();
  return new algosdk.Indexer(token, indexer, port);
};

// ================= Core Functions =================
const generateWallet = async () => {
  try {
    const account = algosdk.generateAccount();
    
    // Extract public key directly from secret key (64 bytes: 32 priv + 32 pub)
    const publicKey = account.sk.slice(32, 64);
    const address = algosdk.encodeAddress(publicKey);

    return {
      address: address,
      privateKey: Buffer.from(account.sk).toString('hex'),
      mnemonic: algosdk.secretKeyToMnemonic(account.sk)
    };
  } catch (error) {
    throw new TransactionError(`Wallet generation failed: ${error.message}`);
  }
};

const validateAddress = (address) => {
  if (!address || typeof address !== 'string' || address.trim() === '') {
    return false;
  }
  try {
    return algosdk.isValidAddress(address);
  } catch (error) {
    return false;
  }
};

const getBalance = async (address) => {
  try {
    if (!validateAddress(address)) {
      throw new InvalidAddressError(address, 'ALGO');
    }

    // Try to get balance from algod first (more up-to-date)
    try {
      const algodClient = getAlgodClient();
      const accountInfo = await algodClient.accountInformation(address).do();
      return Number(accountInfo.amount) / 1_000_000;
    } catch (algodError) {
      // If algod fails, fall back to indexer
      console.log(`Algod balance check failed, falling back to indexer: ${algodError.message}`);
      
      const indexer = getIndexerClient();
      const accountInfo = await indexer.lookupAccountByID(address).do();

      // Handle new accounts that haven't done any transactions
      if (!accountInfo || !accountInfo.account) {
        return 0; // Return 0 instead of throwing error
      }

      return Number(accountInfo.account.amount) / 1_000_000;
    }
  } catch (error) {
    // Handle 404 specifically for new accounts
    if (error.response?.status === 404) {
      return 0;
    }
    
    // Log the error for debugging
    console.error(`Balance check error for address ${address}: ${error.message}`);
    
    throw new NetworkError(
      `Balance check failed: ${error.message}`, 
      { status: error.response?.status, address }
    );
  }
};

const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amount
) => {
  let algodClient;
  try {
    // Initialize client early to avoid undefined reference
    algodClient = getAlgodClient();
    
    // Validate addresses
    if (!validateAddress(senderAddress)) {
      throw new InvalidAddressError(senderAddress, 'ALGO');
    }
    
    if (!validateAddress(receiverAddress)) {
      throw new InvalidAddressError(receiverAddress, 'ALGO');
    }

    // Sanitize addresses
    const sanitizedSender = senderAddress.trim();
    const sanitizedReceiver = receiverAddress.trim();
    
    // Process and validate private key
    let secretKey;
    
    // Check if it's a mnemonic (contains spaces)
    if (senderPrivateKey.includes(' ')) {
      try {
        // Handle mnemonic
        const trimmedMnemonic = senderPrivateKey.trim();
        secretKey = algosdk.mnemonicToSecretKey(trimmedMnemonic).sk;
      } catch (error) {
        throw new TransactionError(`Invalid mnemonic phrase: ${error.message}`);
      }
    } else {
      // Handle hex key - support both 64 and 128 character formats
      const hexKey = senderPrivateKey.startsWith('0x') 
        ? senderPrivateKey.slice(2) 
        : senderPrivateKey;
      
      // Validate hex format
      if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
        throw new TransactionError('Invalid hex format (contains non-hex characters)');
      }
      
      try {
        // Support both 64-char (32 bytes) and 128-char (64 bytes) formats
        if (hexKey.length === 64) {
          // 64 chars = 32 bytes (standard private key)
          secretKey = new Uint8Array(Buffer.from(hexKey, 'hex'));
        } else if (hexKey.length === 128) {
          // 128 chars = 64 bytes (full key pair: private + public)
          // For Algorand, we need to create a proper secret key
          // The first 32 bytes are the private key, the next 32 bytes are the public key
          const privateKeyBytes = Buffer.from(hexKey.substring(0, 64), 'hex');
          const publicKeyBytes = Buffer.from(hexKey.substring(64, 128), 'hex');
          
          // Create a proper Algorand secret key (private key + public key)
          secretKey = new Uint8Array(64); // 64 bytes total
          secretKey.set(new Uint8Array(privateKeyBytes), 0); // First 32 bytes: private key
          secretKey.set(new Uint8Array(publicKeyBytes), 32); // Last 32 bytes: public key
        } else {
          throw new TransactionError(`Invalid private key length: ${hexKey.length} chars (must be 64 or 128 hex characters)`);
        }
      } catch (error) {
        if (error instanceof TransactionError) {
          throw error;
        }
        throw new TransactionError(`Private key processing failed: ${error.message}`);
      }
    }
    
    // Verify the private key can be used to derive a valid address
    try {
      // For verification only - create a dummy transaction object
      const dummyParams = {
        fee: 1000,
        firstRound: 1,
        lastRound: 1000,
        genesisID: 'mainnet-v1.0',
        genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
      };
      
      // Create a transaction object using the proper factory method
      const dummyTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: sanitizedSender,
        to: sanitizedSender,
        amount: 0,
        suggestedParams: dummyParams
      });
      
      // This will throw if the key is invalid
      const signedTxn = algosdk.signTransaction(dummyTxn, secretKey);
      
      // Additional verification - check if we can decode the signed transaction
      algosdk.decodeSignedTransaction(signedTxn.blob);
    } catch (error) {
      // Provide more specific error messages based on the error type
      if (error.message.includes('bad secret key size')) {
        throw new TransactionError(`Invalid private key format: The key must be exactly 32 bytes (64 hex characters). Current key length: ${secretKey.length} bytes.`);
      } else if (error.message.includes('should be a Uint8Array')) {
        throw new TransactionError('Invalid private key format: The key must be a proper binary array.');
      } else {
        throw new TransactionError(`Private key validation failed: ${error.message}`);
      }
    }

    // Prepare Transaction Parameters
    const params = await algodClient.getTransactionParams().do();
    const microAmount = Math.floor(Number(amount) * 1_000_000);
    
    if (isNaN(microAmount) || microAmount < 1000) {
      throw new TransactionError('Invalid amount (minimum 0.001 ALGO)');
    }
    
    // Check sender's balance before proceeding
    const senderBalance = await getBalance(sanitizedSender);
    const microBalance = Math.floor(senderBalance * 1_000_000);
    let minFee = Math.max(Number(params.fee), 1000); // Ensure minimum fee
    
    // Define Algorand minimum balance requirement (0.1 ALGO = 100,000 microALGO)
    const MIN_BALANCE_REQUIREMENT = 100000; // 0.1 ALGO in microALGO
    
    // Special case: If amount equals the entire balance, adjust to account for fees and min balance
    const isFullBalanceTransfer = Math.abs(senderBalance - amount) < 0.0001; // Allow for small floating point differences
    let adjustedMicroAmount = microAmount;
    
    if (isFullBalanceTransfer) {
      // For full balance transfers, we need to leave the minimum balance (0.1 ALGO) plus the fee
      adjustedMicroAmount = microBalance - minFee - MIN_BALANCE_REQUIREMENT;
      
      // Ensure the adjusted amount is still valid
      if (adjustedMicroAmount < 1000) { // Minimum 0.001 ALGO
        throw new InsufficientFundsError(
          `Insufficient ALGO balance for this transaction. After accounting for the minimum balance requirement (0.1 ALGO) and fee (${minFee / 1_000_000} ALGO), the remaining amount (${adjustedMicroAmount / 1_000_000} ALGO) is below the minimum transfer amount (0.001 ALGO).`,
          {
            balance: senderBalance,
            required: 0.001 + (minFee + MIN_BALANCE_REQUIREMENT) / 1_000_000,
            fee: minFee / 1_000_000,
            minBalanceRequirement: MIN_BALANCE_REQUIREMENT / 1_000_000
          }
        );
      }
      
      console.log(`Full balance transfer detected. Adjusted amount from ${microAmount / 1_000_000} to ${adjustedMicroAmount / 1_000_000} ALGO to account for fee and minimum balance requirement.`);
    } else {
      // Regular case: Check if sender has enough balance (amount + fee) while maintaining min balance
      const remainingBalance = microBalance - microAmount - minFee;
      
      if (remainingBalance < MIN_BALANCE_REQUIREMENT) {
        throw new InsufficientFundsError(
          `Insufficient ALGO balance for this transaction. The account must maintain a minimum balance of 0.1 ALGO. Available: ${senderBalance} ALGO, Required: ${(microAmount + minFee + MIN_BALANCE_REQUIREMENT) / 1_000_000} ALGO (including fee and minimum balance).`,
          {
            balance: senderBalance,
            required: (microAmount + minFee + MIN_BALANCE_REQUIREMENT) / 1_000_000,
            fee: minFee / 1_000_000,
            minBalanceRequirement: MIN_BALANCE_REQUIREMENT / 1_000_000
          }
        );
      }
      
      // Regular check if sender has enough balance for the transaction itself
      if (microBalance < microAmount + minFee) {
        throw new InsufficientFundsError(
          `Insufficient ALGO balance for this transaction. Available: ${senderBalance} ALGO, Required: ${(microAmount + minFee) / 1_000_000} ALGO (including fee)`,
          {
            balance: senderBalance,
            required: (microAmount + minFee) / 1_000_000,
            fee: minFee / 1_000_000
          }
        );
      }
    }

    // Create and Sign Transaction
    // Calculate the minimum fee required
    minFee = Math.max(Number(params.fee), 1000); // Ensure minimum fee of 0.001 ALGO
    
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: sanitizedSender,
      to: sanitizedReceiver,
      amount: isFullBalanceTransfer ? adjustedMicroAmount : microAmount,
      suggestedParams: {
        ...params,
        fee: minFee,
        flatFee: true // Use flat fee instead of per-byte fee
      }
    });
    
    // Log transaction details for debugging
    const finalAmount = isFullBalanceTransfer ? adjustedMicroAmount : microAmount;
    console.log(`Transaction prepared: ${sanitizedSender} -> ${sanitizedReceiver}, Amount: ${finalAmount/1_000_000} ALGO, Fee: ${minFee/1_000_000} ALGO`);
    if (isFullBalanceTransfer) {
      console.log(`Note: This is a full balance transfer. Amount was adjusted to account for the transaction fee and minimum balance requirement of 0.1 ALGO.`);
    }
    

    // Sign transaction with validated secret key
    // The signTransaction function expects a 64-byte secret key for Algorand
    let signedTxn;
    try {
      signedTxn = algosdk.signTransaction(txn, secretKey);
    } catch (error) {
      if (error.message.includes('bad secret key size')) {
        throw new TransactionError('Invalid secret key format: Algorand requires a 64-byte secret key (private + public key pair)');
      }
      throw new TransactionError(`Transaction signing failed: ${error.message}`);
    }

    // Send and Confirm
    const { txId } = await algodClient.sendRawTransaction(signedTxn.blob).do();
    const result = await algosdk.waitForConfirmation(algodClient, txId, 4);

    if (result['pool-error']) {
      throw new TransactionError(`Network rejection: ${result['pool-error']}`);
    }

    return txId;

  } catch (error) {
    // Handle specific error types
    if (error instanceof InvalidAddressError || error instanceof TransactionError) {
      // Re-throw already formatted errors
      throw error;
    }
    
    if (error.message && error.message.includes('overspend')) {
      // Extract account address and available balance from error message if possible
      let accountAddress = '';
      let availableBalance = 0;
      
      try {
        // Try to parse the account address from the error message
        const addressMatch = error.message.match(/account ([A-Z0-9]+),/);
        if (addressMatch && addressMatch[1]) {
          accountAddress = addressMatch[1];
        }
        
        // Try to parse the available balance from the error message
        const balanceMatch = error.message.match(/MicroAlgos:\{Raw:([0-9]+)\}/);
        if (balanceMatch && balanceMatch[1]) {
          availableBalance = parseInt(balanceMatch[1]) / 1_000_000;
        }
      } catch (parseError) {
        // Ignore parsing errors and use default error message
      }
      
      throw new InsufficientFundsError(
        `Insufficient ALGO balance for this transaction. Available: ${availableBalance || 'unknown'} ALGO, Required: ${amount} ALGO plus transaction fee`,
        { 
          balance: availableBalance || null,
          required: amount,
          account: accountAddress || sanitizedSender,
          details: error.message 
        }
      );
    }
    
    if (error.message && error.message.includes('below min')) {
      // Handle the specific minimum balance requirement error
      if (error.message.includes('balance 0 below min 100000')) {
        throw new TransactionError(`Transaction failed: Account must maintain a minimum balance of 0.1 ALGO (100,000 microALGO). Please ensure you leave at least 0.1 ALGO in the account.`);
      } else {
        throw new TransactionError(`Transaction amount too small: ${error.message}`);
      }
    }
    
    // Generic error handling
    throw new TransactionError(`Transaction failed: ${error.message}`);
  }
};

/**
 * Get the status of a transaction by its hash/ID
 * @param {string} txId - Transaction ID/hash
 * @returns {string} Transaction status: 'confirmed', 'pending', 'failed', or 'unknown'
 */
const getTransactionStatus = async (txId) => {
  try {
    if (!txId || typeof txId !== 'string' || txId.trim() === '') {
      throw new TransactionError('Invalid transaction ID');
    }

    const sanitizedTxId = txId.trim();
    const indexer = getIndexerClient();
    
    // Query the indexer for transaction information
    const txInfo = await indexer.lookupTransactionByID(sanitizedTxId).do();
    
    // If transaction is found in the indexer, it's confirmed
    if (txInfo && txInfo.transaction) {
      // Log full transaction details for debugging if needed
      console.log(`Transaction ${sanitizedTxId} found in indexer: confirmed`);
      return 'confirmed';
    }
    
    // If not found in indexer, check if it's pending
    try {
      const algodClient = getAlgodClient();
      const pendingTxInfo = await algodClient.pendingTransactionInformation(sanitizedTxId).do();
      
      if (pendingTxInfo) {
        console.log(`Transaction ${sanitizedTxId} found in pending pool`);
        return 'pending';
      }
    } catch (pendingError) {
      // If not found in pending either, it might not exist or be very recent
      console.log(`Transaction ${sanitizedTxId} not found in pending: ${pendingError.message}`);
    }
    
    // If we reach here, the transaction was not found in either indexer or pending pool
    console.log(`Transaction ${sanitizedTxId} not found in any source`);
    return 'unknown';
  } catch (error) {
    // Handle specific error types
    if (error.response?.status === 404) {
      console.log(`Transaction ${txId} returned 404 status`);
      return 'unknown';
    }
    
    // Log the error for debugging
    console.error(`Transaction status check error for txId ${txId}: ${error.message}`);
    
    // For any other errors, return 'failed' status
    return 'failed';
  }
};

// ================= Exports =================
module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  validateAddress,
  getTransactionStatus,
  errors: {
    InsufficientFundsError,
    InvalidAddressError,
    TransactionError,
    NetworkError
  }
};