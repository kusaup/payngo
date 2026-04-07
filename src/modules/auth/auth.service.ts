import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bip39 from 'bip39';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private normalizeMnemonic(m: string) {
    return m.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async signup(words: 12 | 24 = this.config.get<number>('app.mnemonicWords') === 24 ? 24 : 12) {
    const strength = words === 24 ? 256 : 128;
    const mnemonic = bip39.generateMnemonic(strength);
    const mnemonicHash = await bcrypt.hash(this.normalizeMnemonic(mnemonic), 12);
    const user = await this.userModel.create({ mnemonicHash, acceptedAssets: [] });
    const accessToken = await this.jwtService.signAsync({ sub: String((user as any)._id) });
    return { mnemonic, accessToken, userId: (user as any)._id };
  }

  async login(mnemonic: string) {
    const normalized = this.normalizeMnemonic(mnemonic);
    const users = await this.userModel.find().select('_id mnemonicHash').lean();
    for (const user of users) {
      if (await bcrypt.compare(normalized, user.mnemonicHash)) {
        return { accessToken: await this.jwtService.signAsync({ sub: String(user._id) }) };
      }
    }
    throw new UnauthorizedException('Invalid mnemonic');
  }
}
