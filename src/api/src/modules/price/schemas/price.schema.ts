import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Price {
  @Prop({ required: true, unique: true, index: true })
  coin!: string;
  @Prop({ required: true })
  usdPrice!: number;
  @Prop({ required: true })
  source!: string;
  @Prop({ required: true, index: true })
  fetchedAt!: Date;
}

export const PriceSchema = SchemaFactory.createForClass(Price);
PriceSchema.index({ fetchedAt: -1 });
