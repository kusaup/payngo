import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class WebhookDelivery {
  @Prop({ required: true, index: true })
  paymentId!: string;
  @Prop({ required: true })
  url!: string;
  @Prop({ default: 'GET' })
  method!: string;
  @Prop({ default: 'PENDING', index: true })
  status!: string;
  @Prop({ default: 0 })
  attempts!: number;
  @Prop()
  lastResponseCode?: number;
  @Prop()
  lastError?: string;
}

export const WebhookDeliverySchema = SchemaFactory.createForClass(WebhookDelivery);
WebhookDeliverySchema.index({ status: 1, updatedAt: 1 });
