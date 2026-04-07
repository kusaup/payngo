import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtTtl: process.env.JWT_TTL || '7d',
  encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY,
  platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT || '0'),
  paymentPageBaseUrl: process.env.PAYMENT_PAGE_BASE_URL,
  priceFreshnessSeconds: Number(process.env.PRICE_FRESHNESS_SECONDS || 300),
  mnemonicWords: Number(process.env.MNEMONIC_WORDS || 12),
}));

export function validateEnv(config: Record<string, unknown>) {
  const required = [
    'MONGO_URI',
    'REDIS_URL',
    'JWT_SECRET',
    'ENCRYPTION_MASTER_KEY',
    'PAYMENT_PAGE_BASE_URL',
    'PLATFORM_FEE_PERCENT',
  ];
  required.forEach((key) => {
    if (!config[key]) throw new Error(`Missing env ${key}`);
  });
  return config;
}
