import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PaymentApiService {
  private readonly base = environment.apiBaseUrl;

  constructor(private readonly http: HttpClient) {}

  getPublic(paymentId: string) {
    return this.http.get(`${this.base}/payments/${paymentId}/public`);
  }

  selectAsset(paymentId: string, coin: string, network: string) {
    return this.http.post(`${this.base}/payments/${paymentId}/select-asset`, { coin, network });
  }

  getStatus(paymentId: string) {
    return this.http.get(`${this.base}/payments/${paymentId}/status`);
  }
}
