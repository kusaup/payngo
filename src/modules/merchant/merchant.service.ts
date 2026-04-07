import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User } from '../users/schemas/user.schema';
import { UpdateMerchantAssetsDto } from './dto/merchant.dto';
import { AssetsService } from '../assets/assets.service';

@Injectable()
export class MerchantService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly assetsService: AssetsService,
  ) {}

  getAssets(userId: string) {
    return this.userModel.findById(userId).select('acceptedAssets').lean();
  }

  async updateAssets(userId: string, dto: UpdateMerchantAssetsDto) {
    for (const asset of dto.assets) {
      for (const network of asset.networks) {
        const valid = await this.assetsService.assertSupported(asset.coin, network);
        if (!valid) throw new NotFoundException(`Unsupported pair: ${asset.coin}/${network}`);
      }
    }
    await this.userModel.updateOne({ _id: userId }, { $set: { acceptedAssets: dto.assets } });
    return { success: true };
  }

  async regenerateApiKey(userId: string) {
    const plain = `sk_live_${randomBytes(24).toString('hex')}`;
    const hash = await bcrypt.hash(plain, 12);
    await this.userModel.updateOne({ _id: userId }, { $set: { apiKeyHash: hash } });
    return { apiKey: plain };
  }
}
