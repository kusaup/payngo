import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Withdrawal, WithdrawalStatus } from '../schemas/withdrawal.schema';
import { CryptoService } from '../../crypto/services/crypto.service';

@Processor('withdrawal-exec')
export class WithdrawalProcessor extends WorkerHost {
  constructor(
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    private readonly cryptoService: CryptoService,
  ) {
    super();
  }

  async process(job: Job<{ withdrawalId: string }>) {
    const wd = await this.withdrawalModel.findById(job.data.withdrawalId);
    if (!wd || wd.status === WithdrawalStatus.SENT) return;

    await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.PROCESSING } });
    try {
      const tx = await this.cryptoService.transferFunds(`${wd.coin}_${wd.network}`, process.env.HOT_WALLET_ADDRESS || "", process.env.HOT_WALLET_PRIVATE_KEY || "", wd.destinationAddress, wd.amount);
      await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.SENT, txHash: tx.txHash } });
    } catch (error: any) {
      await this.withdrawalModel.updateOne({ _id: wd._id }, { $set: { status: WithdrawalStatus.FAILED, failureReason: error.message } });
      throw error;
    }
  }
}
