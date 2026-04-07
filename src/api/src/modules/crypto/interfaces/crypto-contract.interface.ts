export interface LegacyCryptoProvider {
  generateWallet: () => Promise<{ address: string; privateKey: string }>;
  getBalance: (address: string) => Promise<{ balance: string | number } | string | number>;
  transferFunds: (
    senderAddress: string,
    senderPrivateKey: string,
    receiverAddress: string,
    amount: string | number,
  ) => Promise<{ txHash?: string; hash?: string; txid?: string } | string>;
  getTransactionStatus: (txHash: string) => Promise<{ status?: string; confirmations?: number } | string>;
  validateAddress?: (address: string) => Promise<boolean> | boolean;
}

export interface CryptoOperationContext {
  symbol: string;
  network?: string;
}
