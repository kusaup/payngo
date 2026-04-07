const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const nacl = require('tweetnacl');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? `https://api.devnet.solana.com`
  : `https://api.mainnet-beta.solana.com`;

const CONNECTION = new Connection(RPC_URL, 'confirmed');

// Custom Errors (similar to ETH/POL)
class InsufficientFundsError extends Error {
  constructor(balanceSOL, feeSOL, requiredSOL) {
    super(`Insufficient funds. Available: ${balanceSOL} SOL, Required: ${requiredSOL} SOL`);
    this.name = 'InsufficientFundsError';
    this.details = {
      fee: feeSOL,
      balance: balanceSOL,
      required: requiredSOL
    };
  }
}

class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid Solana address: ${address}`);
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
const validateAddress = (address) => {
  try {
    new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
};

const getRecentBlockhash = async () => {
  try {
    const { blockhash } = await CONNECTION.getLatestBlockhash('finalized');
    return blockhash;
  } catch (error) {
    throw new TransactionError(`Failed to get recent blockhash: ${error.message}`);
  }
};

const getFeeForMessage = async (transaction) => {
  try {
    const { value } = await CONNECTION.getFeeForMessage(
      transaction.compileMessage(),
      'confirmed'
    );
    return value || 5000; // Default fee if estimation fails
  } catch (error) {
    return 5000; // Default fee
  }
};

// Core Functions

/**
 * Generate a new Solana wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  const mnemonic = bip39.generateMnemonic();
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derivationPath = "m/44'/501'/0'/0'";
  const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    address: keypair.publicKey.toString(),
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
    mnemonic
  };
};

/**
 * Get Solana balance for a given address
 * @param {string} walletAddress - Solana wallet address
 * @returns {number} Balance in SOL
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const publicKey = new PublicKey(walletAddress);
    const balanceLamports = await CONNECTION.getBalance(publicKey);
    return balanceLamports / LAMPORTS_PER_SOL;
  } catch (error) {
    throw new TransactionError(
      `Balance check failed: ${error.message}\n` +
      `Verify RPC endpoint: ${RPC_URL}`
    );
  }
};

/**
 * Transfer SOL from one address to another
 * @param {string} senderAddress - Sender's Solana address
 * @param {string} senderPrivateKey - Sender's private key (hex encoded)
 * @param {string} receiverAddress - Receiver's Solana address
 * @param {number} amountSOL - Amount to send in SOL
 * @returns {string} Transaction signature
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountSOL
) => {
  try {
    console.log('sol_sol 1')
    // Validate inputs
    if (!validateAddress(senderAddress)) throw new InvalidAddressError(senderAddress);
    if (!validateAddress(receiverAddress)) throw new InvalidAddressError(receiverAddress);
    console.log('sol_sol 2')
    // Create keypair from private key
    const secretKey = Buffer.from(senderPrivateKey, 'hex');
    const keypair = Keypair.fromSecretKey(secretKey);
    console.log('sol_sol 3')
    // Verify address match
    if (keypair.publicKey.toString() !== senderAddress) {
      throw new TransactionError('Private key mismatch');
    }
    console.log('sol_sol 4')
    // Get sender balance
    const senderPublicKey = new PublicKey(senderAddress);
    const receiverPublicKey = new PublicKey(receiverAddress);
    const balanceLamports = await CONNECTION.getBalance(senderPublicKey);
    const balanceSOL = balanceLamports / LAMPORTS_PER_SOL;
    console.log('sol_sol 5')
    // Convert amount to lamports
    const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
    console.log('sol_sol 6')
    // Create transaction
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: senderPublicKey,
        toPubkey: receiverPublicKey,
        lamports: amountLamports
      })
    );
    console.log('sol_sol 7')
    // Get recent blockhash
    const blockhash = await getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = senderPublicKey;
    console.log('sol_sol 8')
    // Estimate fee
    const fee = await getFeeForMessage(transaction);
    const feeSol = fee / LAMPORTS_PER_SOL;
    console.log('sol_sol 9')
    // Check if this is a full balance transfer
    const isFullBalanceTransfer = Math.abs(amountSOL - balanceSOL) < 0.00001;
    console.log('sol_sol 10')
    // Adjust amount if sending full balance
    if (isFullBalanceTransfer) {
      const adjustedLamports = balanceLamports - fee;
      if (adjustedLamports <= 0) {
        throw new InsufficientFundsError(
          balanceSOL.toFixed(9),
          feeSol.toFixed(9),
          balanceSOL.toFixed(9)
        );
      }
      console.log('sol_sol 11')
      // Replace the transfer instruction with adjusted amount
      transaction.instructions = [];
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: senderPublicKey,
          toPubkey: receiverPublicKey,
          lamports: adjustedLamports
        })
      );
      console.log('sol_sol 12')
    } else {
      // Check if balance is sufficient for regular transfer
      if (balanceLamports < amountLamports + fee) {
        throw new InsufficientFundsError(
          balanceSOL.toFixed(9),
          feeSol.toFixed(9),
          (amountSOL + feeSol).toFixed(9)
        );
      }
    }
    console.log('sol_sol 13')
    let signature;
    try {
      signature = await CONNECTION.sendTransaction(transaction, [keypair]);
      console.log("Transaction sent, signature:", signature);
    } catch (sendErr) {
      throw new TransactionError(`Failed to send transaction: ${sendErr.message}`);
    }

    // Confirm manually with retries
    let confirmed = false;
    for (let i = 0; i < 5; i++) {
      const status = await CONNECTION.getSignatureStatus(signature);
      if (status?.value?.confirmationStatus === 'confirmed') {
        confirmed = true;
        break;
      }
      console.log(`Waiting for confirmation... attempt ${i + 1}`);
      await new Promise(res => setTimeout(res, 2000));
    }

    if (!confirmed) {
      throw new TransactionError(`Transaction ${signature} not confirmed in time.`);
    }
    
    console.log('sol_sol 14')
    return signature;
  } catch (error) {
    if (error instanceof InsufficientFundsError || 
        error instanceof InvalidAddressError) {
      throw error;
    }
    throw new TransactionError(`Transfer failed: ${error.message}`);
  }
};

const getTransactionStatus = async (signature) => {
  try {
    const tx = await CONNECTION.getTransaction(signature, {
      commitment: 'confirmed',
    });
    return tx ? 'confirmed' : 'pending';
  } catch (error) {
    return 'pending';
  }
};

// Placeholder functions for compatibility
const needAlimentation = async () => false;
const alimentGasFees = async () => null;

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
    TransactionError
  }
};