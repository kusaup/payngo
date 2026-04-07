import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { WebhookDelivery, WebhookDeliverySchema } from '../webhooks/schemas/webhook-delivery.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
    ]),
  ],
  controllers: [AdminController],
})
export class AdminModule {}
