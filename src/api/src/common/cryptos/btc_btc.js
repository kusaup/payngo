const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1'); // Required dependency
const { ECPairFactory } = require('ecpair');
const axios = require('axios');
const dotenv = require('dotenv');

// Initialize BIP32 and ECPair with ECC library
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const {
  InsufficientFundsError: CommonInsufficientFundsError, // Alias to avoid conflict
  InvalidAddressError: CommonInvalidAddressError, // Alias to avoid conflict
  TransactionError: CommonTransactionError, // Alias to avoid conflict
  NetworkError
} = require('./common/errors');

dotenv.config();

// Configuration
const NETWORK = process.env.APP_MOD === 'dev' 
  ? bitcoin.networks.testnet 
  : bitcoin.networks.bitcoin;
const API_URL = process.env.APP_MOD === 'dev'
  ? 'https://blockstream.info/testnet/api'
  : 'https://blockstream.info/api';
const FEE_RATE_URL = 'https://mempool.space/api/v1/fees/recommended';
const DEFAULT_FEE_RATE = 20; // sat/vbyte (fallback)
const DUST_LIMIT = 546; // Minimum satoshis for valid output

// Re-export aliased common errors for potential external use if needed
const InsufficientFundsError = CommonInsufficientFundsError;
const InvalidAddressError = CommonInvalidAddressError;
const TransactionError = CommonTransactionError;

// Helpers
const validateAddress = (address) => {
  try {
    bitcoin.address.toOutputScript(address, NETWORK);
    return true;
  } catch {
    return false;
  }
};

const fetchFeeRate = async () => {
  try {
    const response = await axios.get(FEE_RATE_URL);
    return process.env.APP_MOD === 'dev' 
      ? DEFAULT_FEE_RATE 
      : response.data.hourFee || DEFAULT_FEE_RATE;
  } catch {
    return DEFAULT_FEE_RATE;
  }
};

const calculateVSize = (inputCount, outputCount) => {
  const baseSize = 10.5; // Base transaction size
  const inputSize = 68;   // SegWit input size
  const outputSize = 31;  // Output size
  return Math.ceil(baseSize + (inputCount * inputSize) + (outputCount * outputSize));
};

// Core Functions

/**
 * Generate a new Bitcoin wallet
 * @returns {Object} Wallet details (address, privateKey, mnemonic)
 */
const generateWallet = async () => {
  const mnemonic = bip39.generateMnemonic();
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, NETWORK); // Now using properly initialized bip32
  
  const coinType = process.env.APP_MOD === 'dev' ? 1 : 0;
  const derivationPath = `m/84'/${coinType}'/0'/0/0`;
  
  const keyPair = root.derivePath(derivationPath);
  const { address } = bitcoin.payments.p2wpkh({ 
    pubkey: Buffer.from(keyPair.publicKey), 
    network: NETWORK 
  });

  if (!validateAddress(address)) {
    throw new TransactionError('Failed to generate valid address');
  }

  return {
    address,
    privateKey: keyPair.toWIF(),
    mnemonic
  };
};

/**
 * Get Bitcoin balance for a given address
 * @param {string} walletAddress - Bitcoin wallet address
 * @returns {number} Balance in BTC
 */
const getBalance = async (walletAddress) => {
  if (!validateAddress(walletAddress)) {
    throw new CommonInvalidAddressError(walletAddress, 'BTC');
  }

  try {
    const { data: utxos } = await axios.get(`${API_URL}/address/${walletAddress}/utxo`);
    

    const confirmed = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
    
    return confirmed / 1e8;
  } catch (error) {
    throw new NetworkError(`Balance check failed: ${error.message}`, { underlyingError: error });
  }
};

/**
 * Transfer Bitcoin from one address to another
 * @param {string} senderAddress - Sender's Bitcoin address
 * @param {string} senderPrivateKey - Sender's private key (WIF format)
 * @param {string} receiverAddress - Receiver's Bitcoin address
 * @param {number} amountBTC - Amount to send in BTC
 * @returns {string} Transaction hash
 */
/**
 * Transfer Bitcoin from one address to another
 * @param {string} senderAddress - Sender's Bitcoin address
 * @param {string} senderPrivateKey - Sender's private key (WIF format)
 * @param {string} receiverAddress - Receiver's Bitcoin address
 * @param {number} amountBTC - Amount to send in BTC
 * @returns {string} Transaction hash
 */
const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountBTC
) => {
  try {
    // Validate addresses
    if (!validateAddress(senderAddress)) throw new InvalidAddressError('Invalid sender address');
    if (!validateAddress(receiverAddress)) throw new InvalidAddressError('Invalid receiver address');

    // Convert amount to satoshis
    const amountSat = Math.floor(amountBTC * 1e8);
    if (amountSat < DUST_LIMIT) throw new TransactionError(`Amount must be at least ${DUST_LIMIT} satoshi`);

    // Initialize key pair with buffer conversion
    const keyPair = ECPair.fromWIF(senderPrivateKey, NETWORK);
    if (!keyPair.privateKey) throw new TransactionError('Invalid private key');

    // Create payment object with explicit buffer handling
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: NETWORK
    });
    if (payment.address !== senderAddress) throw new TransactionError('Address/key mismatch');

    // Fetch and prepare UTXOs
    const { data: utxos } = await axios.get(`${API_URL}/address/${senderAddress}/utxo`);

    const confirmedUtxos = utxos.filter(u => u.status?.confirmed);
    if (confirmedUtxos.length === 0) throw new InsufficientFundsError('No confirmed UTXOs');

    // Enrich UTXOs with full transaction data
    const utxosWithPrevTx = await Promise.all(
      confirmedUtxos.map(async utxo => ({
        ...utxo,
        prevTxHex: (await axios.get(`${API_URL}/tx/${utxo.txid}/hex`)).data
      }))
    );

    const sortedUtxos = utxosWithPrevTx.sort((a, b) => b.value - a.value);
    const totalInput = sortedUtxos.reduce((sum, utxo) => sum + utxo.value, 0);

    // Fee calculation logic
    const feeRate = process.env.APP_MOD === 'dev' ? 2 : await fetchFeeRate();
    const isFullBalance = Math.abs(amountBTC - (totalInput / 1e8)) < 1e-8;

    // Dynamic fee calculation
    let outputCount = 2;
    let vsize = calculateVSize(sortedUtxos.length, outputCount);
    let fee = Math.ceil(vsize * feeRate);
    let finalAmount = amountSat;
    let changeAmount = totalInput - finalAmount - fee;

    // Full balance handling
    if (isFullBalance) {
      outputCount = 1;
      vsize = calculateVSize(sortedUtxos.length, outputCount);
      fee = Math.ceil(vsize * feeRate);
      finalAmount = totalInput - fee;
      changeAmount = 0;
      
      if (finalAmount < DUST_LIMIT) throw new InsufficientFundsError('Resulting amount is dust');
    }

    // Final validation
    if (totalInput < finalAmount + fee) {
      throw new InsufficientFundsError(
        `Need ${(finalAmount + fee)/1e8} BTC (Have ${totalInput/1e8} BTC)`
      );
    }

    // Build PSBT
    const psbt = new bitcoin.Psbt({ network: NETWORK });

    // Add inputs with full context
    sortedUtxos.forEach(utxo => {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: payment.output,
          value: utxo.value
        },
        nonWitnessUtxo: Buffer.from(utxo.prevTxHex, 'hex')
      });
    });

    // Add outputs
    psbt.addOutput({
      address: receiverAddress,
      value: finalAmount
    });

    if (changeAmount >= DUST_LIMIT) {
      psbt.addOutput({
        address: senderAddress,
        value: changeAmount
      });
    }

    // Custom signer with explicit Buffer conversions
    const customSigner = {
      publicKey: Buffer.from(keyPair.publicKey), // Convert Uint8Array to Buffer
      sign: (hash) => {
        const signature = keyPair.sign(hash);
        return Buffer.from(signature); // Convert signature to Buffer
      }
    };

    // Sign each input
    sortedUtxos.forEach((_, index) => {
      psbt.signInput(index, customSigner, [bitcoin.Transaction.SIGHASH_ALL]);
    });

    // Convert partialSig entries to Buffers
    psbt.data.inputs.forEach(input => {
      if (input.partialSig) {
        input.partialSig = input.partialSig.map(sig => ({
          pubkey: Buffer.isBuffer(sig.pubkey) ? sig.pubkey : Buffer.from(sig.pubkey),
          signature: Buffer.isBuffer(sig.signature) ? sig.signature : Buffer.from(sig.signature)
        }));
      }
    });

    // Custom validator
    const validator = (pubkey, msghash, signature) => {
      return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
    };

    if (!psbt.validateSignaturesOfAllInputs(validator)) {
      throw new TransactionError('Signature validation failed');
    }

    psbt.finalizeAllInputs();

    // Broadcast transaction
    const tx = psbt.extractTransaction();
    const { data: txId } = await axios.post(`${API_URL}/tx`, tx.toHex());

    return txId;

  } catch (error) {
    // Enhanced error logging
    console.error('Transaction Error Details:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });

    if (error instanceof InsufficientFundsError || error instanceof InvalidAddressError) {
      throw error;
    }
    throw new TransactionError(`Transfer failed: ${error.message}`);
  }
};


const getTransactionStatus = async (txHash) => {
  const { data } = await axios.get(`${API_URL}/tx/${txHash}/status`);
  return data.confirmed ? 'confirmed' : 'pending';
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
  // Expose common errors under a consistent namespace if needed elsewhere
  errors: {
    InsufficientFundsError: CommonInsufficientFundsError,
    InvalidAddressError: CommonInvalidAddressError,
    TransactionError: CommonTransactionError,
    NetworkError
  }
};