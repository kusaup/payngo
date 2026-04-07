import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalProcessor } from './queues/withdrawal.processor';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'withdrawal-exec' }),
    MongooseModule.forFeature([{ name: Withdrawal.name, schema: WithdrawalSchema }]),
    CryptoModule,
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService, WithdrawalProcessor],
})
export class WithdrawalsModule {}
