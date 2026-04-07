import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), AssetsModule],
  controllers: [MerchantController],
  providers: [MerchantService],
  exports: [MerchantService],
})
export class MerchantModule {}
