import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';
import { WithdrawalsService } from './withdrawals.service';

@Controller('merchant/withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.withdrawalsService.list(user.userId);
  }
}
