import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';
import { Withdrawal, WithdrawalStatus } from './schemas/withdrawal.schema';
import { CryptoService } from '../crypto/services/crypto.service';

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    @InjectQueue('withdrawal-exec') private readonly withdrawalQueue: Queue,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(userId: string, dto: CreateWithdrawalDto) {
    const isValidAddress = await this.cryptoService.validateAddress(`${dto.coin}_${dto.network}`, dto.destinationAddress);
    if (!isValidAddress) throw new BadRequestException('Invalid destination address for selected network');

    const doc = await this.withdrawalModel.create({ ...dto, userId, status: WithdrawalStatus.PENDING });
    await this.withdrawalQueue.add('execute-withdrawal', { withdrawalId: String(doc._id) }, { attempts: 6, backoff: { type: 'exponential', delay: 3_000 } });
    return doc;
  }

  list(userId: string) {
    return this.withdrawalModel.find({ userId }).sort({ createdAt: -1 }).lean();
  }
}
