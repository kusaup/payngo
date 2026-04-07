import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhookDelivery, WebhookDeliverySchema } from './schemas/webhook-delivery.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { WebhookProcessor } from './queues/webhook.processor';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({ name: 'webhook-delivery' }),
    MongooseModule.forFeature([
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  providers: [WebhooksService, WebhookProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
