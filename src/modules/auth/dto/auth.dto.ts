import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class SignupDto {
  @IsOptional()
  @IsIn([12, 24])
  words?: 12 | 24;
}

export class LoginDto {
  @IsString()
  @Matches(/^[a-zA-Z\s]+$/)
  mnemonic!: string;
}
