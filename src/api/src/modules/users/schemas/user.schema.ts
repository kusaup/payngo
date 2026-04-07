import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
class AcceptedAsset {
  @Prop({ required: true })
  coin!: string;

  @Prop({ type: [String], required: true })
  networks!: string[];
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  mnemonicHash!: string;

  @Prop()
  apiKeyHash?: string;

  @Prop({ type: [AcceptedAsset], default: [] })
  acceptedAssets!: AcceptedAsset[];
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ createdAt: -1 });
