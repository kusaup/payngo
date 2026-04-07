import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PaymentApiService } from '../../services/payment-api.service';
import { PaymentStatusService } from '../../services/payment-status.service';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';

@Component({ selector: 'app-payment-container', templateUrl: './payment-container.component.html', styleUrls: ['./payment-container.component.css'] })
export class PaymentContainerComponent implements OnInit, OnDestroy {
  loading = true;
  payment: any;
  acceptedAssets: any[] = [];
  status = 'PENDING';
  t: any = en;
  selected?: { coin: string; network: string };
  cryptoQuote?: any;
  private sub?: Subscription;

  constructor(private readonly route: ActivatedRoute, private readonly api: PaymentApiService, private readonly statusSvc: PaymentStatusService) {}

  ngOnInit() {
    const paymentId = this.route.snapshot.paramMap.get('id')!;
    this.api.getPublic(paymentId).subscribe((res: any) => {
      this.payment = res.payment;
      this.acceptedAssets = res.acceptedAssets;
      this.t = this.payment.language === 'fr' ? fr : en;
      this.loading = false;
    });
  }

  onAssetSelected(event: { coin: string; network: string }) {
    this.selected = event;
    const paymentId = this.payment._id;
    this.api.selectAsset(paymentId, event.coin, event.network).subscribe((quote) => {
      this.cryptoQuote = quote;
      this.sub?.unsubscribe();
      this.sub = this.statusSvc.poll(paymentId).subscribe((s: any) => {
        this.status = s.status;
        if (s.status === 'CONFIRMED' || s.status === 'FAIL') {
          setTimeout(() => {
            window.location.href = s.status === 'CONFIRMED' ? s.successUri : s.failUri;
          }, 1500);
        }
      });
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }
}
