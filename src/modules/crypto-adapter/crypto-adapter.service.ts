import { Injectable, Logger } from '@nestjs/common';

export interface ExternalCryptoService {
  generateWallet(input: { coin: string; network: string }): Promise<{ address: string; privateKey: string }>;
  getAddressReceived(input: { coin: string; network: string; address: string }): Promise<{ totalReceived: number; txHash?: string }>;
  transfer(input: { coin: string; network: string; amount: number; to: string }): Promise<{ txHash: string }>;
  validateAddress(input: { coin: string; network: string; address: string }): Promise<boolean>;
}

@Injectable()
export class CryptoAdapterService {
  private readonly logger = new Logger(CryptoAdapterService.name);

  // Replace with actual imported existing Node.js cryptoService implementation.
  private readonly cryptoService!: ExternalCryptoService;

  async createDepositWallet(coin: string, network: string) {
    return this.cryptoService.generateWallet({ coin, network });
  }

  async getReceived(coin: string, network: string, address: string) {
    return this.cryptoService.getAddressReceived({ coin, network, address });
  }

  async transfer(coin: string, network: string, amount: number, to: string) {
    return this.cryptoService.transfer({ coin, network, amount, to });
  }

  async validateAddress(coin: string, network: string, address: string) {
    return this.cryptoService.validateAddress({ coin, network, address });
  }
}
