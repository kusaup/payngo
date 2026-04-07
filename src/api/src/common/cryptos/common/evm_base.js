const { ethers } = require("ethers");
const bip39 = require('bip39');
const {
  InvalidAddressError,
  TransactionError,
  NetworkError
} = require('./errors');

/**
 * Validates an EVM-compatible address.
 * @param {string} address - The address to validate.
 * @returns {boolean} True if the address is valid, false otherwise.
 */
const validateAddress = (address) => {
  return ethers.isAddress(address);
};

/**
 * Generates a new EVM-compatible wallet.
 * @param {string} derivationPath - The HD path (e.g., "m/44'/60'/0'/0/0" for ETH).
 * @returns {object} Wallet details { address, privateKey, mnemonic }.
 */
const generateWallet = (derivationPath = "m/44'/60'/0'/0/0") => {
  try {
    const mnemonic = bip39.generateMnemonic();
    const wallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      derivationPath
    );
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic
    };
  } catch (error) {
    throw new TransactionError(`Failed to generate wallet: ${error.message}`);
  }
};

/**
 * Gets the native token balance for a given EVM address.
 * @param {string} walletAddress - The wallet address.
 * @param {ethers.JsonRpcProvider} provider - The ethers JSON RPC provider instance.
 * @param {string} chainSymbol - The symbol of the chain (e.g., 'ETH', 'AVAX').
 * @returns {Promise<number>} The balance in the native token unit (e.g., ETH, AVAX).
 */
const getNativeBalance = async (walletAddress, provider, chainSymbol = 'Native Token') => {
  if (!validateAddress(walletAddress)) {
    throw new InvalidAddressError(walletAddress, chainSymbol);
  }
  try {
    const balanceWei = await provider.getBalance(walletAddress);
    return parseFloat(ethers.formatEther(balanceWei));
  } catch (error) {
    throw new NetworkError(
      `Balance check failed for ${chainSymbol}: ${error.shortMessage || error.message}`,
      { underlyingError: error, rpcUrl: provider.connection?.url }
    );
  }
};

/**
 * Fetches the current gas price information.
 * @param {ethers.JsonRpcProvider} provider - The ethers JSON RPC provider instance.
 * @param {string} defaultGasPriceGwei - Default gas price in Gwei if fetch fails.
 * @returns {Promise<object>} Fee data object (e.g., { gasPrice, maxFeePerGas, maxPriorityFeePerGas }).
 */
const getFeeData = async (provider, defaultGasPriceGwei = '10') => {
  try {
    const feeData = await provider.getFeeData();
    // Ensure at least gasPrice is available, fallback to default if needed
    if (!feeData.gasPrice && !feeData.maxFeePerGas) {
        console.warn(`Could not fetch fee data, using default: ${defaultGasPriceGwei} Gwei`);
        feeData.gasPrice = ethers.parseUnits(defaultGasPriceGwei, 'gwei');
    }
    return feeData;
  } catch (error) {
    console.warn(`Error fetching fee data, using default: ${defaultGasPriceGwei} Gwei. Error: ${error.message}`);
    return { gasPrice: ethers.parseUnits(defaultGasPriceGwei, 'gwei') };
  }
};

module.exports = {
  validateAddress,
  generateWallet,
  getNativeBalance,
  getFeeData,
};