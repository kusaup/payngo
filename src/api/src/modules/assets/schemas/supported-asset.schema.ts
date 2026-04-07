import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class SupportedCoin {
  @Prop({ required: true, unique: true })
  symbol!: string;
  @Prop({ required: true })
  name!: string;
  @Prop()
  logo?: string;
  @Prop({ default: true })
  isActive!: boolean;
}

@Schema({ timestamps: true })
export class SupportedNetwork {
  @Prop({ required: true, unique: true })
  symbol!: string;
  @Prop({ required: true })
  name!: string;
  @Prop({ default: true })
  isActive!: boolean;
}

@Schema({ timestamps: true })
export class SupportedCoinNetwork {
  @Prop({ required: true })
  coinId!: string;
  @Prop({ required: true })
  networkId!: string;
  @Prop({ required: true, unique: true })
  symbol!: string;
  @Prop({ default: true })
  isActive!: boolean;
}

export const SupportedCoinSchema = SchemaFactory.createForClass(SupportedCoin);
export const SupportedNetworkSchema = SchemaFactory.createForClass(SupportedNetwork);
export const SupportedCoinNetworkSchema = SchemaFactory.createForClass(SupportedCoinNetwork);
SupportedCoinNetworkSchema.index({ coinId: 1, networkId: 1 }, { unique: true });
