import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WebhooksService } from '../webhooks.service';

@Processor('webhook-delivery')
export class WebhookProcessor extends WorkerHost {
  constructor(private readonly webhooksService: WebhooksService) {
    super();
  }

  async process(job: Job<{ paymentId: string }>) {
    await this.webhooksService.deliver(job.data.paymentId);
  }
}
