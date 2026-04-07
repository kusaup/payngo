import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalProcessor } from './queues/withdrawal.processor';
import { CryptoAdapterModule } from '../crypto-adapter/crypto-adapter.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'withdrawal-exec' }),
    MongooseModule.forFeature([{ name: Withdrawal.name, schema: WithdrawalSchema }]),
    CryptoAdapterModule,
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService, WithdrawalProcessor],
})
export class WithdrawalsModule {}
