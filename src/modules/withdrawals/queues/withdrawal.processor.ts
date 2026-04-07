import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Withdrawal, WithdrawalStatus } from '../schemas/withdrawal.schema';
import { CryptoAdapterService } from '../../crypto-adapter/crypto-adapter.service';

@Processor('withdrawal-exec')
export class WithdrawalProcessor extends WorkerHost {
  constructor(
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    private readonly cryptoAdapter: CryptoAdapterService,
  ) {
    super();
  }

  async process(job: Job<{ withdrawalId: string }>) {
    const wd = await this.withdrawalModel.findById(job.data.withdrawalId);
    if (!wd || wd.status === WithdrawalStatus.SENT) return;

    await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.PROCESSING } });
    try {
      const tx = await this.cryptoAdapter.transfer(wd.coin, wd.network, wd.amount, wd.destinationAddress);
      await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.SENT, txHash: tx.txHash } });
    } catch (error: any) {
      await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.FAILED, failureReason: error.message } });
      throw error;
    }
  }
}
