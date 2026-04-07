import { Module } from '@nestjs/common';
import { CryptoAdapterService } from './crypto-adapter.service';

@Module({ providers: [CryptoAdapterService], exports: [CryptoAdapterService] })
export class CryptoAdapterModule {}
