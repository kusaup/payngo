import { IsNumber, IsString, IsUrl, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsString()
  coin!: string;

  @IsString()
  network!: string;

  @IsNumber()
  @Min(0.0000001)
  amount!: number;

  @IsString()
  destinationAddress!: string;
}
