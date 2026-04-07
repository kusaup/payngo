/**
 * Common Custom Error Classes for Crypto Modules
 */

class InsufficientFundsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InsufficientFundsError';
    this.details = details; // e.g., { balance, required, fee }
  }
}

class InvalidAddressError extends Error {
  constructor(address, chain = 'Unknown') {
    super(`Invalid ${chain} address: ${address}`);
    this.name = 'InvalidAddressError';
    this.details = { address, chain };
  }
}

class TransactionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TransactionError';
    this.details = details; // e.g., { txHash, underlyingError }
  }
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

class NetworkError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NetworkError';
    this.details = details; // e.g., { url, status }
  }
}

module.exports = {
  InsufficientFundsError,
  InvalidAddressError,
  TransactionError,
  ConfigurationError,
  NetworkError,
};