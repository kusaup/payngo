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
const USDT_TOKEN_ADDRESS = process.env.APP_MOD === 'dev'
  ? 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS' // Devnet USDT (example, replace with actual)
  : 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'; // Mainnet USDT

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
    super(`Insufficient USDT balance. Available: ${balance}, Required: ${amount}`);
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
    const tokenPublicKey = new PublicKey(USDT_TOKEN_ADDRESS);
    
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
    
    // USDT on Solana typically has 6 decimals
    return parseFloat(tokenBalance.uiAmountString);
  } catch (error) {
    throw new TransactionError(`USDT balance check failed: ${error.message}`);
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

const transferFunds = async (senderAddress, senderPrivateKey, receiverAddress, amountUSDT) => {
  console.log(`Starting USDT transfer from ${senderAddress} to ${receiverAddress} for ${amountUSDT} USDT`);
  try {
    // Validate addresses
    console.log('sol_usdt 1')
    // Validate addresses
    if (!validateAddress(senderAddress)) throw new InvalidAddressError(senderAddress);
    if (!validateAddress(receiverAddress)) throw new InvalidAddressError(receiverAddress);
  

    console.log('sol_usdt 2')
    // Convert private key
    const keypair = await handlePrivateKey(senderPrivateKey, senderAddress);
    
    console.log('sol_usdt 3')
    // Check and fund SOL balance with confirmation
    await ensureSolBalance(keypair);
    console.log('sol_usdt 4')
    // Token setup
    const tokenMint = new PublicKey(USDT_TOKEN_ADDRESS);
    const receiverPublicKey = new PublicKey(receiverAddress);
    console.log('sol_usdt 5')
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
    console.log('sol_usdt 6')
    // Validate balances
    await validateUsdtBalance(senderTokenAccount, amountUSDT);
    console.log('sol_usdt 7')
    // Execute transfer
    return executeUsdtTransfer(
      senderTokenAccount.address,
      receiverTokenAccount.address,
      keypair,
      amountUSDT
    );
    
  } catch (error) {
    console.error('Transfer error:', error);
    if (error.name in module.exports.errors) throw error;
    throw new TransactionError(`USDT transfer failed: ${error.message}`);
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

const validateUsdtBalance = async (senderAccount, amount) => {
  const info = await CONNECTION.getParsedAccountInfo(senderAccount.address);
  const { uiAmount } = info.value.data.parsed.info.tokenAmount;
  
  if (uiAmount < amount) {
    throw new InsufficientTokenBalanceError(uiAmount, amount);
  }
};

const executeUsdtTransfer = async (from, to, keypair, amount) => {
  const decimals = 6;
  const transferAmount = BigInt(amount * 10 ** decimals);

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

  // Set recent blockhash and fee payer manually for control
  tx.recentBlockhash = (await CONNECTION.getLatestBlockhash()).blockhash;
  tx.feePayer = keypair.publicKey;

  // Send the transaction and capture the signature
  let signature;
  try {
    signature = await CONNECTION.sendTransaction(tx, [keypair]);
    console.log("USDT transaction sent, signature:", signature);
  } catch (sendErr) {
    throw new TransactionError(`Failed to send USDT transaction: ${sendErr.message}`);
  }

  // Manually confirm with retries
  let confirmed = false;
  for (let i = 0; i < 5; i++) {
    const status = await CONNECTION.getSignatureStatus(signature);
    if (status?.value?.confirmationStatus === 'confirmed') {
      confirmed = true;
      break;
    }
    console.log(`Waiting for USDT confirmation... attempt ${i + 1}`);
    await new Promise(res => setTimeout(res, 2000));
  }

  if (!confirmed) {
    throw new TransactionError(`USDT transaction ${signature} not confirmed in time.`);
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