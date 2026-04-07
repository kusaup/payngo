import { Module } from '@nestjs/common';
import { CryptoAdapter } from './adapters/crypto.adapter';
import { CryptoService } from './services/crypto.service';

@Module({
  providers: [CryptoAdapter, CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
