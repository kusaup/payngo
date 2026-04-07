import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Price, PriceSchema } from './schemas/price.schema';
import { PriceService } from './price.service';
import { PriceSyncCron } from './cron/price-sync.cron';

@Module({
  imports: [MongooseModule.forFeature([{ name: Price.name, schema: PriceSchema }])],
  providers: [PriceService, PriceSyncCron],
  exports: [PriceService],
})
export class PriceModule {}
