import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';

@Controller('merchant')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(@InjectModel(Payment.name) private readonly paymentModel: Model<Payment>) {}

  @Get('dashboard')
  async dashboard(@CurrentUser() user: { userId: string }) {
    const [confirmed, fail] = await Promise.all([
      this.paymentModel.countDocuments({ userId: user.userId, status: PaymentStatus.CONFIRMED }),
      this.paymentModel.countDocuments({ userId: user.userId, status: PaymentStatus.FAIL }),
    ]);
    return { confirmed, fail };
  }

  @Get('payments')
  payments(@CurrentUser() user: { userId: string }) {
    return this.paymentModel.find({ userId: user.userId }).sort({ createdAt: -1 }).lean();
  }

  @Get('wallets')
  async wallets(@CurrentUser() user: { userId: string }) {
    const rows = await this.paymentModel.aggregate([
      { $match: { userId: user.userId, status: PaymentStatus.CONFIRMED } },
      { $group: { _id: { coin: '$selectedCoin', network: '$selectedNetwork' }, balance: { $sum: '$merchantNetAmount' } } },
    ]);
    return rows;
  }
}
