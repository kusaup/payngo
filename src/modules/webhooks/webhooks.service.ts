import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { WebhookDelivery } from './schemas/webhook-delivery.schema';
import { Payment } from '../payments/schemas/payment.schema';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectModel(WebhookDelivery.name) private readonly deliveryModel: Model<WebhookDelivery>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly http: HttpService,
  ) {}

  async deliver(paymentId: string) {
    const payment = await this.paymentModel.findById(paymentId).lean();
    if (!payment) return;
    const signature = createHmac('sha256', process.env.WEBHOOK_SIGNING_SECRET || 'dev-secret')
      .update(`${payment._id}:${payment.status}:${payment.receivedAmount}`)
      .digest('hex');

    const url = new URL(payment.webhook);
    url.searchParams.set('paymentId', String(payment._id));
    url.searchParams.set('status', payment.status);
    url.searchParams.set('expectedAmount', String(payment.expectedAmount || 0));
    url.searchParams.set('receivedAmount', String(payment.receivedAmount || 0));
    url.searchParams.set('coin', payment.selectedCoin || '');
    url.searchParams.set('network', payment.selectedNetwork || '');
    url.searchParams.set('txHash', payment.txHash || '');
    url.searchParams.set('signature', signature);

    const delivery = await this.deliveryModel.findOneAndUpdate(
      { paymentId },
      { $setOnInsert: { url: payment.webhook, method: 'GET', status: 'PENDING', attempts: 0 } },
      { upsert: true, new: true },
    );

    try {
      const res = await firstValueFrom(this.http.get(url.toString(), { timeout: 10_000 }));
      await this.deliveryModel.updateOne({ _id: delivery._id }, { $set: { status: 'SUCCESS', lastResponseCode: res.status }, $inc: { attempts: 1 } });
    } catch (error: any) {
      this.logger.warn(`Webhook failed for payment ${paymentId}`);
      await this.deliveryModel.updateOne({ _id: delivery._id }, { $set: { status: 'FAILED', lastError: error?.message }, $inc: { attempts: 1 } });
      throw error;
    }
  }
}
