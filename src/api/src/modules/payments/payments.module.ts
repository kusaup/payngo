import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AssetsModule } from '../assets/assets.module';
import { PriceModule } from '../price/price.module';
import { CryptoAdapterModule } from '../crypto-adapter/crypto-adapter.module';
import { PaymentMonitorProcessor } from './queues/payment-monitor.processor';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BullModule.registerQueue({ name: 'payment-monitor' }, { name: 'webhook-delivery' }),
    AssetsModule,
    PriceModule,
    CryptoAdapterModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentMonitorProcessor],
  exports: [PaymentsService],
})
export class PaymentsModule {}
