import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import {
  SupportedCoin,
  SupportedCoinNetwork,
  SupportedCoinNetworkSchema,
  SupportedCoinSchema,
  SupportedNetwork,
  SupportedNetworkSchema,
} from './schemas/supported-asset.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportedCoin.name, schema: SupportedCoinSchema },
      { name: SupportedNetwork.name, schema: SupportedNetworkSchema },
      { name: SupportedCoinNetwork.name, schema: SupportedCoinNetworkSchema },
    ]),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
