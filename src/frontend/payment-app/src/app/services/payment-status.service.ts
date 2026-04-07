import { Injectable } from '@angular/core';
import { interval, switchMap } from 'rxjs';
import { PaymentApiService } from './payment-api.service';

@Injectable({ providedIn: 'root' })
export class PaymentStatusService {
  constructor(private readonly api: PaymentApiService) {}

  poll(paymentId: string) {
    return interval(3000).pipe(switchMap(() => this.api.getStatus(paymentId)));
  }
}
