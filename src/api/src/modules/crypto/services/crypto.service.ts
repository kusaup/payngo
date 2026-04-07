import { Injectable } from '@nestjs/common';
import { CryptoAdapter } from '../adapters/crypto.adapter';

@Injectable()
export class CryptoService {
  constructor(private readonly adapter: CryptoAdapter) {}

  generateWallet(symbol: string) {
    return this.adapter.generateWallet(symbol);
  }

  getBalance(symbol: string, address: string) {
    return this.adapter.getBalance(symbol, address);
  }

  transferFunds(
    symbol: string,
    senderAddress: string,
    senderPrivateKey: string,
    receiverAddress: string,
    amount: number,
  ) {
    return this.adapter.transferFunds(symbol, senderAddress, senderPrivateKey, receiverAddress, amount);
  }

  getTransactionStatus(symbol: string, txHash: string) {
    return this.adapter.getTransactionStatus(symbol, txHash);
  }

  validateAddress(symbol: string, address: string) {
    return this.adapter.validateAddress(symbol, address);
  }
}
