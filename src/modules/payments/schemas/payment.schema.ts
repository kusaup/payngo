import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum PaymentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAIL = 'FAIL',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ required: true, index: true })
  userId!: string;
  @Prop({ required: true })
  amountUSD!: number;
  @Prop({ required: true })
  language!: string;
  @Prop()
  logo?: string;
  @Prop()
  description?: string;
  @Prop({ required: true })
  webhook!: string;
  @Prop({ required: true })
  successUri!: string;
  @Prop({ required: true })
  failUri!: string;
  @Prop({ enum: PaymentStatus, default: PaymentStatus.PENDING, index: true })
  status!: PaymentStatus;
  @Prop({ required: true, index: true })
  expiresAt!: Date;
  @Prop()
  selectedCoin?: string;
  @Prop()
  selectedNetwork?: string;
  @Prop()
  lockedRate?: number;
  @Prop()
  expectedAmount?: number;
  @Prop({ default: 0 })
  receivedAmount!: number;
  @Prop({ default: 0 })
  feeAmount!: number;
  @Prop({ default: 0 })
  extraAmount!: number;
  @Prop({ default: 0 })
  merchantNetAmount!: number;
  @Prop()
  depositAddress?: string;
  @Prop()
  encryptedPrivateKey?: string;
  @Prop()
  txHash?: string;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PaymentEvent {
  @Prop({ required: true, index: true })
  paymentId!: string;
  @Prop({ required: true })
  eventType!: string;
  @Prop({ type: Object, default: {} })
  payload!: Record<string, unknown>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);
