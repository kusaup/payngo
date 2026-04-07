const bitcoin = require('bitcoinjs-lib');
const dashcore = require('dashcore-lib');
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1'); // Required dependency
const { ECPairFactory } = require('ecpair');
const axios = require('axios');
const dotenv = require('dotenv');

// Initialize BIP32 and ECPair with ECC library
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
// Custom Errors
class InvalidAddressError extends Error {
  constructor(address) {
    super(`Invalid DASH address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

class InsufficientFundsError extends Error {
  constructor(balance, required) {
    super(`Insufficient funds. Available: ${balance} DASH, Required: ${required} DASH`);
    this.name = 'InsufficientFundsError';
  }
}

class TransactionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransactionError';
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Initialize environment
dotenv.config();


// ================= Configuration =================
const NETWORK_CONFIG = process.env.APP_MOD === 'dev' ? {
  // Testnet Configuration (Fixed)
  network: {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: 'sdash', // Added bech32 prefix
    bip32: {
      public: 0x043587cf, // Correct testnet public
      private: 0x04358394 // Correct testnet private
    },
    pubKeyHash: 0x8c, // y... addresses
    scriptHash: 0x13,  // Fixed script hash
    wif: 0xef          // Testnet WIF prefix
  },
  apiUrl: 'https://insight.testnet.networks.dash.org/insight-api',
  derivationPath: "m/44'/1'/0'/0/0" // BIP44 testnet path
} : {
  // Mainnet Configuration (Fixed)
  network: {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: 'dash', // Added bech32 prefix
    bip32: {
      public: 0x0488b21e, // Correct mainnet public
      private: 0x0488ade4 // Correct mainnet private
    },
    pubKeyHash: 0x4c, // X... addresses
    scriptHash: 0x10,  // Fixed script hash
    wif: 0xcc          // Mainnet WIF prefix
  },
  apiUrl: 'https://insight.dash.org/insight-api',
  derivationPath: "m/44'/5'/0'/0/0" // BIP44 mainnet path (Dash uses 5')
};
const FEE_PER_BYTE = 3; // You can make this dynamic later
const DUST_LIMIT = 546; // Dash dust limit
const FEE_RATE = 1000; // 0.00001 DASH per byte

// ================= Helpers =================
const validateAddress = (address) => {
  try {
    const patterns = process.env.APP_MOD === 'dev' ? {
      legacy: /^y[1-9A-HJ-NP-Za-km-z]{33}$/,
      cashaddr: /^dashtest:[qp][a-z0-9]{41}$/i
    } : {
      legacy: /^X[1-9A-HJ-NP-Za-km-z]{33}$/,
      cashaddr: /^dash:[qp][a-z0-9]{41}$/i
    };
    
    return Object.values(patterns).some(pattern => pattern.test(address));
  } catch {
    return false;
  }
};

const axiosRetry = async (url, retries = 5) => {
  try {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Node.js Wallet Service'
          }
        });
        return response.data;
      } catch (error) {
        if (i === retries - 1) throw error;
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
  } catch (error) {
    throw new NetworkError(
      `API request failed after ${retries} attempts: ${error.message}`
    );
  }
};

// ================= Core Functions =================
const generateWallet = async () => {
  try {
    const mnemonic = bip39.generateMnemonic();
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, NETWORK_CONFIG.network); // Fixed BIP32 usage
    const keyPair = root.derivePath(NETWORK_CONFIG.derivationPath);
    
    const { address } = bitcoin.payments.p2pkh({
      pubkey: keyPair.publicKey,
      network: NETWORK_CONFIG.network
    });

    return {
      address,
      privateKey: keyPair.toWIF(),
      mnemonic
    };
  } catch (error) {
    throw new TransactionError(`Wallet generation failed: ${error.message}`);
  }
};

const getBalance = async (address) => {
  try {
    if (!validateAddress(address)) {
      throw new InvalidAddressError(address);
    }

    // Use direct balance endpoint
    const data = await axiosRetry(
      `${NETWORK_CONFIG.apiUrl}/addr/${address}/balance`
    );
    
    return (data || 0) / 1e8; // Convert satoshis to DASH
  } catch (error) {
    if (error.response?.status === 404) return 0;
    throw new NetworkError(
      `Balance check failed for ${address}: ${error.message}`
    );
  }
};

const transferFunds = async (
  senderAddress,
  senderPrivateKey,
  receiverAddress,
  amountDash
) => {
  try {
    const amountSatoshis = Math.floor(amountDash * 1e8);

    const privateKey = dashcore.PrivateKey.fromWIF(senderPrivateKey);
    const publicAddress = privateKey.toAddress().toString();

    if (publicAddress !== senderAddress) {
      throw new Error('Private key does not match sender address.');
    }

    const utxosResponse = await axios.get(`${NETWORK_CONFIG.apiUrl}/addr/${senderAddress}/utxo`);
    const utxos = utxosResponse.data;

    if (!utxos.length) throw new Error('No UTXOs found for address');

    const inputs = utxos.map(utxo => ({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      address: senderAddress,
      script: dashcore.Script.fromAddress(senderAddress).toHex(),
      satoshis: utxo.satoshis
    }));

    const totalAvailable = inputs.reduce((sum, utxo) => sum + utxo.satoshis, 0);

    // Estimate fee assuming 1 output (no change)
    const estimatedSize = (inputs.length * 180) + (1 * 34) + 10;
    let fee = Math.ceil(estimatedSize * FEE_PER_BYTE);

    // Enforce a minimum fee floor (e.g., 700 sat)
    const MIN_FEE = 700;
    if (fee < MIN_FEE) {
      fee = MIN_FEE;
    }

    if (amountSatoshis === totalAvailable) {
      // User wants to send full balance — deduct fee from total
      if (totalAvailable <= fee || (totalAvailable - fee) < DUST_LIMIT) {
        throw new Error('Not enough balance after fee deduction');
      }

      const sendAmount = totalAvailable - fee;

      const transaction = new dashcore.Transaction()
        .from(inputs)
        .to(receiverAddress, sendAmount)
        .fee(fee)
        .sign(privateKey);

      const rawTx = transaction.serialize();

      const broadcast = await axios.post(`${NETWORK_CONFIG.apiUrl}/tx/send`, {
        rawtx: rawTx
      });

      return broadcast.data.txid;
    }

    // Regular case: amount < total
    if (amountSatoshis + fee > totalAvailable) {
      throw new Error(`Insufficient funds: need ${amountSatoshis + fee}, have ${totalAvailable}`);
    }

    const change = totalAvailable - amountSatoshis - fee;

    const transaction = new dashcore.Transaction()
      .from(inputs)
      .to(receiverAddress, amountSatoshis)
      .fee(fee)
      .change(senderAddress)
      .sign(privateKey);

    const rawTx = transaction.serialize();

    const broadcast = await axios.post(`${NETWORK_CONFIG.apiUrl}/tx/send`, {
      rawtx: rawTx
    });

    return broadcast.data.txid;

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
  try {
    const { data } = await axios.get(`${NETWORK_CONFIG.apiUrl}/tx/${txHash}`);

    // Insight API returns blockheight when confirmed
    return data.blockheight && data.blockheight > 0 ? 'confirmed' : 'pending';
  } catch (error) {
    console.error('Error fetching transaction status:', error.response?.data || error.message);
    throw new Error('Failed to fetch transaction status');
  }
};

// ================= Exports =================
module.exports = {
  generateWallet,
  getBalance,
  transferFunds,
  getTransactionStatus,
  errors: {
    InvalidAddressError,
    InsufficientFundsError,
    TransactionError,
    NetworkError
  }
};