import { IsMongoId, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class InitPaymentDto {
  @IsString()
  sk!: string;

  @IsNumber()
  @Min(0.0000001)
  amountUSD!: number;

  @IsString()
  language!: string;

  @IsOptional()
  @IsUrl()
  logo?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl({ require_tld: false })
  webhook!: string;

  @IsUrl({ require_tld: false })
  success_uri!: string;

  @IsUrl({ require_tld: false })
  fail_uri!: string;
}

export class SelectAssetDto {
  @IsString()
  coin!: string;
  @IsString()
  network!: string;
}

export class PaymentParamDto {
  @IsMongoId()
  id!: string;
}
