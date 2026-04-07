import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PriceService } from '../price.service';

@Injectable()
export class PriceSyncCron {
  private readonly logger = new Logger(PriceSyncCron.name);
  constructor(private readonly priceService: PriceService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sync() {
    try {
      // Replace with real provider call.
      const feed = [
        { coin: 'BTC', usdPrice: 70000 },
        { coin: 'ETH', usdPrice: 3500 },
        { coin: 'USDT', usdPrice: 1 },
      ];
      await Promise.all(feed.map((item) => this.priceService.upsertPrice(item.coin, item.usdPrice, 'providerX')));
    } catch (err) {
      this.logger.error('Price sync failed', err as any);
    }
  }
}
