import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { LegacyCryptoProvider } from '../interfaces/crypto-contract.interface';

@Injectable()
export class CryptoAdapter {
  private readonly logger = new Logger(CryptoAdapter.name);
  private readonly registry: Record<string, LegacyCryptoProvider>;

  constructor() {
    this.registry = this.loadLegacyRegistry();
  }

  async generateWallet(symbol: string) {
    const provider = this.getProvider(symbol);
    try {
      const wallet = await provider.generateWallet();
      return { address: wallet.address, privateKey: wallet.privateKey };
    } catch (error) {
      throw this.mapError(error, 'generateWallet', symbol);
    }
  }

  async getBalance(symbol: string, address: string) {
    if (!address) throw new BadRequestException('Address is required');
    const provider = this.getProvider(symbol);
    try {
      const result = await provider.getBalance(address);
      if (typeof result === 'object') return Number((result as any).balance ?? 0);
      return Number(result || 0);
    } catch (error) {
      throw this.mapError(error, 'getBalance', symbol);
    }
  }

  async transferFunds(
    symbol: string,
    senderAddress: string,
    senderPrivateKey: string,
    receiverAddress: string,
    amount: number,
  ) {
    if (!receiverAddress) throw new BadRequestException('Receiver address is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Amount must be greater than 0');
    const provider = this.getProvider(symbol);
    try {
      const result = await provider.transferFunds(senderAddress, senderPrivateKey, receiverAddress, amount);
      if (typeof result === 'string') return { txHash: result };
      return { txHash: result.txHash || result.hash || result.txid || '' };
    } catch (error) {
      throw this.mapError(error, 'transferFunds', symbol);
    }
  }

  async getTransactionStatus(symbol: string, txHash: string) {
    if (!txHash) throw new BadRequestException('Transaction hash is required');
    const provider = this.getProvider(symbol);
    try {
      const result = await provider.getTransactionStatus(txHash);
      if (typeof result === 'string') return { status: result };
      return { status: result.status || 'UNKNOWN', confirmations: result.confirmations || 0 };
    } catch (error) {
      throw this.mapError(error, 'getTransactionStatus', symbol);
    }
  }

  async validateAddress(symbol: string, address: string) {
    if (!address) throw new BadRequestException('Address is required');
    const provider = this.getProvider(symbol);
    try {
      if (!provider.validateAddress) return true;
      return Boolean(await provider.validateAddress(address));
    } catch (error) {
      throw this.mapError(error, 'validateAddress', symbol);
    }
  }

  private getProvider(symbol: string): LegacyCryptoProvider {
    const key = symbol.toUpperCase();
    const provider = this.registry[key];
    if (!provider) throw new NotFoundException(`Unsupported crypto symbol/network: ${symbol}`);
    return provider;
  }

  private loadLegacyRegistry(): Record<string, LegacyCryptoProvider> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../../../common/cryptos');
      const registry = mod.default || mod.registry || mod;
      if (!registry || typeof registry !== 'object') {
        throw new Error('common/cryptos export is not a registry object');
      }
      return registry;
    } catch {
      this.logger.error('Unable to load legacy crypto registry from src/common/cryptos');
      return {};
    }
  }

  private mapError(error: unknown, operation: string, symbol: string) {
    const message = error instanceof Error ? error.message : 'Unknown provider error';
    this.logger.warn(`Crypto ${operation} failed for ${symbol}: ${message}`);
    return new InternalServerErrorException(`Crypto operation failed: ${operation}`);
  }
}
