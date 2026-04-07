import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class PaymentApiService {
  constructor(private readonly http: HttpClient) {}

  getPublic(paymentId: string) {
    return this.http.get(`/api/payments/${paymentId}/public`);
  }

  selectAsset(paymentId: string, coin: string, network: string) {
    return this.http.post(`/api/payments/${paymentId}/select-asset`, { coin, network });
  }

  getStatus(paymentId: string) {
    return this.http.get(`/api/payments/${paymentId}/status`);
  }
}
