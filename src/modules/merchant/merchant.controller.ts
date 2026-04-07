import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantService } from './merchant.service';
import { UpdateMerchantAssetsDto } from './dto/merchant.dto';

@Controller('merchant')
@UseGuards(JwtAuthGuard)
export class MerchantController {
  constructor(private readonly merchantService: MerchantService) {}

  @Get('assets')
  getAssets(@CurrentUser() user: { userId: string }) {
    return this.merchantService.getAssets(user.userId);
  }

  @Put('assets')
  updateAssets(@CurrentUser() user: { userId: string }, @Body() dto: UpdateMerchantAssetsDto) {
    return this.merchantService.updateAssets(user.userId, dto);
  }

  @Post('api-key/regenerate')
  regenerateApiKey(@CurrentUser() user: { userId: string }) {
    return this.merchantService.regenerateApiKey(user.userId);
  }
}
