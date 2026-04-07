import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Price } from './schemas/price.schema';

@Injectable()
export class PriceService {
  constructor(
    @InjectModel(Price.name) private readonly priceModel: Model<Price>,
    private readonly config: ConfigService,
  ) {}

  async upsertPrice(coin: string, usdPrice: number, source: string) {
    await this.priceModel.updateOne({ coin }, { $set: { usdPrice, source, fetchedAt: new Date() } }, { upsert: true });
  }

  async getFreshPriceOrThrow(coin: string) {
    const freshness = this.config.get<number>('app.priceFreshnessSeconds') || 300;
    const minDate = new Date(Date.now() - freshness * 1000);
    const price = await this.priceModel.findOne({ coin, fetchedAt: { $gte: minDate } }).lean();
    if (!price) throw new ServiceUnavailableException('No fresh price available');
    return price.usdPrice;
  }
}
