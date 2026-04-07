import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { InitPaymentDto, SelectAssetDto } from './dto/payment.dto';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import { User } from '../users/schemas/user.schema';
import { AssetsService } from '../assets/assets.service';
import { PriceService } from '../price/price.service';
import { CryptoService } from '../crypto/services/crypto.service';
import { AesEncryptionUtil } from '../../common/utils/crypto.util';

@Injectable()
export class PaymentsService {
  private encryption: AesEncryptionUtil;

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectQueue('payment-monitor') private readonly monitorQueue: Queue,
    private readonly assetsService: AssetsService,
    private readonly priceService: PriceService,
    private readonly cryptoService: CryptoService,
    private readonly config: ConfigService,
  ) {
    this.encryption = new AesEncryptionUtil(this.config.get<string>('app.encryptionMasterKey')!);
  }

  async init(dto: InitPaymentDto) {
    const users = await this.userModel.find({ apiKeyHash: { $exists: true, $ne: null } }).lean();
    const user = await this.findUserByApiKey(users, dto.sk);
    if (!user) throw new BadRequestException('Invalid API key');

    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const payment = await this.paymentModel.create({
      userId: String(user._id),
      amountUSD: dto.amountUSD,
      language: dto.language,
      logo: dto.logo,
      description: dto.description,
      webhook: dto.webhook,
      successUri: dto.success_uri,
      failUri: dto.fail_uri,
      expiresAt,
      status: PaymentStatus.PENDING,
    });

    return {
      paymentId: payment._id,
      hostedUrl: `${this.config.get<string>('app.paymentPageBaseUrl')}/${payment._id}`,
      expiresAt,
    };
  }

  async getPublic(id: string) {
    const payment = await this.paymentModel.findById(id).lean();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.PENDING || new Date(payment.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Payment expired');
    }
    const merchant = await this.userModel.findById(payment.userId).select('acceptedAssets').lean();
    return { payment, acceptedAssets: merchant?.acceptedAssets ?? [] };
  }

  async selectAsset(id: string, dto: SelectAssetDto) {
    const payment = await this.paymentModel.findById(id).lean();
    if (!payment || payment.status !== PaymentStatus.PENDING) throw new NotFoundException('Invalid payment');
    const valid = await this.assetsService.assertSupported(dto.coin, dto.network);
    if (!valid) throw new BadRequestException('Unsupported asset');

    const rate = await this.priceService.getFreshPriceOrThrow(dto.coin);
    const expectedAmount = payment.amountUSD / rate;
    const wallet = await this.cryptoService.generateWallet(`${dto.coin}_${dto.network}`);

    await this.paymentModel.updateOne(
      { _id: id, status: PaymentStatus.PENDING },
      {
        $set: {
          selectedCoin: dto.coin,
          selectedNetwork: dto.network,
          lockedRate: rate,
          expectedAmount,
          depositAddress: wallet.address,
          encryptedPrivateKey: this.encryption.encrypt(wallet.privateKey),
        },
      },
    );

    await this.monitorQueue.add('monitor-payment', { paymentId: id }, { jobId: `pay:${id}`, attempts: 20, backoff: { type: 'exponential', delay: 3000 } });
    return { expectedAmount, depositAddress: wallet.address, expiresAt: payment.expiresAt };
  }

  getStatus(id: string) {
    return this.paymentModel.findById(id).select('status expectedAmount receivedAmount selectedCoin selectedNetwork txHash successUri failUri').lean();
  }

  private async findUserByApiKey(users: any[], sk: string) {
    for (const user of users) {
      if (user.apiKeyHash && (await bcrypt.compare(sk, user.apiKeyHash))) return user;
    }
    return null;
  }
}
