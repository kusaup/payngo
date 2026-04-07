import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { InitPaymentDto, PaymentParamDto, SelectAssetDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(ThrottlerGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('init')
  init(@Body() dto: InitPaymentDto) {
    return this.paymentsService.init(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':id/public')
  getPublic(@Param() params: PaymentParamDto) {
    return this.paymentsService.getPublic(params.id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':id/select-asset')
  selectAsset(@Param() params: PaymentParamDto, @Body() dto: SelectAssetDto) {
    return this.paymentsService.selectAsset(params.id, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get(':id/status')
  getStatus(@Param() params: PaymentParamDto) {
    return this.paymentsService.getStatus(params.id);
  }
}
