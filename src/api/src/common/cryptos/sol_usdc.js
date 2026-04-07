const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, createTransferInstruction } = require('@solana/spl-token');
const bip39 = require('bip39');
const dotenv = require('dotenv');
const solMiddleware = require('./sol_sol');
const Network = require('../models/networkModels');
const AdminWallet = require('../models/adminWalletModels');
const Security = require('../middlewares/securityMiddleware');
const securityMiddleware = new Security();
const bs58 = require('bs58'); // MUST be at top of file

dotenv.config();

// Configuration
const RPC_URL = process.env.APP_MOD === 'dev' 
  ? `https://api.devnet.solana.com`
  : `https://api.mainnet-beta.solana.com`;

const CONNECTION = new Connection(RPC_URL, 'confirmed');
const USDC_TOKEN_ADDRESS = process.env.APP_MOD === 'dev'
  ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' // Devnet USDC (example, replace with actual)
  : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Mainnet USDC

// Reuse existing errors from SOL middleware
const { 
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError 
} = solMiddleware.errors;

// Gas configuration
const MIN_SOL_BALANCE = 0.003 * LAMPORTS_PER_SOL; // 0.002 SOL

class InsufficientTokenBalanceError extends Error {
  constructor(balance, amount) {
    super(`Insufficient USDC balance. Available: ${balance}, Required: ${amount}`);
    this.name = 'InsufficientTokenBalanceError';
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

// Core Functions
const generateWallet = solMiddleware.generateWallet;

const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress);
  }

  try {
    const walletPublicKey = new PublicKey(walletAddress);
    const tokenPublicKey = new PublicKey(USDC_TOKEN_ADDRESS);
    
    // Find the associated token account
    const tokenAccounts = await CONNECTION.getParsedTokenAccountsByOwner(
      walletPublicKey,
      { mint: tokenPublicKey }
    );
    
    // If no token account exists, balance is 0
    if (tokenAccounts.value.length === 0) {
      return 0;
    }
    
    // Get balance from the first associated token account
    const tokenAccount = tokenAccounts.value[0];
    const tokenBalance = tokenAccount.account.data.parsed.info.tokenAmount;
    
    // USDC on Solana typically has 6 decimals
    return parseFloat(tokenBalance.uiAmountString);
  } catch (error) {
    throw new TransactionError(`USDC balance check failed: ${error.message}`);
  }
};

const needAlimentation = async (walletAddress) => {
  try {
    const solBalance = await solMiddleware.getBalance(walletAddress);
    return solBalance * LAMPORTS_PER_SOL < MIN_SOL_BALANCE;
  } catch (error) {
    throw new TransactionError(`SOL balance check failed: ${error.message}`);
  }
};

const alimentGasFees = async (targetAddress, amountSOL) => {
  try {
    const targetNetwork = await Network.findOne({ symbol: 'SOL' });
    const adminWallet = await AdminWallet.findOne({ network: targetNetwork._id });

    if(adminWallet.address === targetAddress){
      return;
    }


    // Ensure we're sending enough SOL for fees
    const finalAmount = Math.max(amountSOL, 0.002); // Minimum 0.002 SOL

    // Transfer SOL from admin wallet
    return solMiddleware.transferFunds(
      adminWallet.address,
      securityMiddleware.two_way_aes_decrypt(adminWallet.privateKey),
      targetAddress,
      finalAmount
    );
  } catch (error) {
    throw new TransactionError(`SOL funding failed: ${error.message}`);
  }
};

const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountUSDC) => {
  console.log(`Starting USDC transfer from ${senderAddress} to ${receiverAddress} for ${amountUSDC} USDC`);
  try {
    // Validate addresses
    console.log('sol_usdc 1')
    // Validate addresses
    if (!validateAddress(senderAddress)) throw new InvalidAddressError(senderAddress);
    if (!validateAddress(receiverAddress)) throw new InvalidAddressError(receiverAddress);
  

    console.log('sol_usdc 2')
    // Convert private key
    const keypair = await handlePrivateKey(senderPrivateKey, senderAddress);
    
    console.log('sol_usdc 3')
    // Check and fund SOL balance with confirmation
    await ensureSolBalance(keypair);
    console.log('sol_usdc 4')
    // Token setup
    const tokenMint = new PublicKey(USDC_TOKEN_ADDRESS);
    const receiverPublicKey = new PublicKey(receiverAddress);
    console.log('sol_usdc 5')
    // Get token accounts with retries
    const [senderTokenAccount, receiverTokenAccount] = await Promise.all([
      getOrCreateAssociatedTokenAccount(
        CONNECTION,
        keypair,
        tokenMint,
        keypair.publicKey
      ),
      createReceiverTokenAccountWithRetry(CONNECTION, keypair, tokenMint, receiverPublicKey)
    ]);
    console.log('sol_usdc 6')
    // Validate balances
    await validateUsdcBalance(senderTokenAccount, amountUSDC);
    console.log('sol_usdc 7')
    // Execute transfer
    return executeUsdcTransfer(
      senderTokenAccount.address,
      receiverTokenAccount.address,
      keypair,
      amountUSDC
    );
    
  } catch (error) {
    console.error('Transfer error:', error);
    if (error.name in module.exports.errors) throw error;
    throw new TransactionError(`USDC transfer failed: ${error.message}`);
  }
};

// Helper functions

const handlePrivateKey = async (privateKey, senderAddress) => {
  try {
    if (!privateKey || typeof privateKey !== 'string') {
      throw new Error('Private key is undefined or not a string');
    }

    // Directly convert hex private key to Buffer
    const secretKey = Buffer.from(privateKey, 'hex');
    const keypair = Keypair.fromSecretKey(secretKey);

    // Verify address match
    if (keypair.publicKey.toString() !== senderAddress) {
      throw new TransactionError('Private key mismatch');
    }

    return keypair;
  } catch (error) {
    throw new TransactionError(`Key handling failed: ${error.message}`);
  }
};


const ensureSolBalance = async (keypair) => {
  let balance = await CONNECTION.getBalance(keypair.publicKey);
  if (balance >= MIN_SOL_BALANCE) return;

  const fundingTx = await alimentGasFees(
    keypair.publicKey.toString(),
    0.01 // Fund 0.01 SOL to cover account creation
  );
  
  // Wait for confirmation
  await CONNECTION.confirmTransaction(fundingTx);
  
  let retries = 0;
  while (retries < 5) {
    balance = await CONNECTION.getBalance(keypair.publicKey);
    if (balance >= MIN_SOL_BALANCE) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
    retries++;
  }
  
  if (balance < MIN_SOL_BALANCE) {
    throw new InsufficientFundsError(
      balance / LAMPORTS_PER_SOL,
      MIN_SOL_BALANCE / LAMPORTS_PER_SOL
    );
  }
};

const createReceiverTokenAccountWithRetry = async (connection, payer, mint, receiver) => {
  let retries = 0;
  while (retries < 3) {
    try {
      return await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        receiver
      );
    } catch (error) {
      if (retries === 2) {
        console.error('Receiver account creation failed:', {
          error: error.message,
          receiver: receiver.toString()
        });
        throw new TransactionError(`Failed to create receiver account: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      retries++;
    }
  }
};

const validateUsdcBalance = async (senderAccount, amount) => {
  const info = await CONNECTION.getParsedAccountInfo(senderAccount.address);
  const { uiAmount } = info.value.data.parsed.info.tokenAmount;
  
  if (uiAmount < amount) {
    throw new InsufficientTokenBalanceError(uiAmount, amount);
  }
};

const executeUsdcTransfer = async (from, to, keypair, amount) => {
  const decimals = 6;
  const transferAmount = BigInt(amount * 10**decimals);
  
  const tx = new Transaction().add(
    createTransferInstruction(
      from,
      to,
      keypair.publicKey,
      transferAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  let signature;
    try {
      signature =  sendAndConfirmTransaction(
        CONNECTION,
        tx,
        [keypair],
        { commitment: 'confirmed' }
      );
    } catch (e) {
      console.warn("sendAndConfirmTransaction failed:", e.message);

      // Try to check if it was actually confirmed
      const result = await CONNECTION.getSignatureStatus(signature || e.signature || '');
      if (result?.value?.confirmationStatus === 'confirmed') {
        console.warn("Transaction was confirmed despite error.");
        return signature;
      }

      throw new TransactionError(`Transfer failed: ${e.message}`);
    }

  return signature;
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