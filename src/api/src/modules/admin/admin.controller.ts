import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment } from '../payments/schemas/payment.schema';
import { Withdrawal } from '../withdrawals/schemas/withdrawal.schema';
import { WebhookDelivery } from '../webhooks/schemas/webhook-delivery.schema';

@Controller('admin')
export class AdminController {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    @InjectModel(WebhookDelivery.name) private readonly webhookModel: Model<WebhookDelivery>,
  ) {}

  @Get('payments')
  payments() {
    return this.paymentModel.find().sort({ createdAt: -1 }).lean();
  }

  @Get('profits')
  async profits() {
    const agg = await this.paymentModel.aggregate([
      { $group: { _id: null, totalFees: { $sum: '$feeAmount' }, totalExtra: { $sum: '$extraAmount' }, totalReceived: { $sum: '$receivedAmount' } } },
    ]);
    return agg[0] || { totalFees: 0, totalExtra: 0, totalReceived: 0 };
  }

  @Get('withdrawals')
  withdrawals() {
    return this.withdrawalModel.find().sort({ createdAt: -1 }).lean();
  }

  @Get('webhooks')
  webhooks() {
    return this.webhookModel.find().sort({ createdAt: -1 }).lean();
  }
}
