import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus } from '../schemas/payment.schema';
import { CryptoAdapterService } from '../../crypto-adapter/crypto-adapter.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Processor('payment-monitor')
export class PaymentMonitorProcessor extends WorkerHost {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly cryptoAdapter: CryptoAdapterService,
    private readonly config: ConfigService,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ paymentId: string }>) {
    const payment = await this.paymentModel.findById(job.data.paymentId);
    if (!payment || payment.status !== PaymentStatus.PENDING || !payment.depositAddress) return;

    if (payment.expiresAt.getTime() <= Date.now()) {
      await this.finalize(payment, 0, undefined);
      return;
    }

    const chain = await this.cryptoAdapter.getReceived(payment.selectedCoin!, payment.selectedNetwork!, payment.depositAddress);
    if ((chain.totalReceived || 0) <= 0) {
      throw new Error('No payment yet');
    }

    await this.finalize(payment, chain.totalReceived, chain.txHash);
  }

  private async finalize(payment: Payment & { _id: any }, received: number, txHash?: string) {
    const expected = payment.expectedAmount || 0;
    const feePercent = Number(this.config.get<number>('app.platformFeePercent') || 0);
    const feeAmount = expected * feePercent / 100;
    const confirmed = received >= expected && expected > 0;
    const extraAmount = Math.max(received - expected, 0);
    const merchantNetAmount = confirmed ? Math.max(expected - feeAmount, 0) : 0;

    await this.paymentModel.updateOne(
      { _id: payment._id, status: PaymentStatus.PENDING },
      {
        $set: {
          status: confirmed ? PaymentStatus.CONFIRMED : PaymentStatus.FAIL,
          receivedAmount: received,
          feeAmount,
          extraAmount,
          merchantNetAmount,
          txHash,
        },
      },
    );

    await this.webhookQueue.add('deliver-webhook', { paymentId: String(payment._id) }, { attempts: 8, backoff: { type: 'exponential', delay: 2_000 } });
  }
}
