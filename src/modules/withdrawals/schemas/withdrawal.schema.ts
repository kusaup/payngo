import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class Withdrawal {
  @Prop({ required: true, index: true })
  userId!: string;
  @Prop({ required: true })
  coin!: string;
  @Prop({ required: true })
  network!: string;
  @Prop({ required: true })
  amount!: number;
  @Prop({ required: true })
  destinationAddress!: string;
  @Prop({ enum: WithdrawalStatus, default: WithdrawalStatus.PENDING, index: true })
  status!: WithdrawalStatus;
  @Prop()
  txHash?: string;
  @Prop()
  failureReason?: string;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);
WithdrawalSchema.index({ userId: 1, createdAt: -1 });
