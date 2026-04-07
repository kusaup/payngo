import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AcceptedAssetDto {
  @IsString()
  coin!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  networks!: string[];
}

export class UpdateMerchantAssetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptedAssetDto)
  assets!: AcceptedAssetDto[];
}
