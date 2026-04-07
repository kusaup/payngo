import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SupportedCoin, SupportedCoinNetwork, SupportedNetwork } from './schemas/supported-asset.schema';

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(SupportedCoin.name) private readonly coinModel: Model<SupportedCoin>,
    @InjectModel(SupportedNetwork.name) private readonly networkModel: Model<SupportedNetwork>,
    @InjectModel(SupportedCoinNetwork.name) private readonly pairModel: Model<SupportedCoinNetwork>,
  ) {}

  async listSupported() {
    const [coins, networks, pairs] = await Promise.all([
      this.coinModel.find({ isActive: true }).lean(),
      this.networkModel.find({ isActive: true }).lean(),
      this.pairModel.find({ isActive: true }).lean(),
    ]);
    return { coins, networks, pairs };
  }

  async assertSupported(coin: string, network: string) {
    const symbol = `${coin}_${network}`;
    const exists = await this.pairModel.exists({ symbol, isActive: true });
    return Boolean(exists);
  }
}
