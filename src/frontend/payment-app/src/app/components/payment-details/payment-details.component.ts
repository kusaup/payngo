import { Component, Input } from '@angular/core';

@Component({ selector: 'app-payment-details', template: `<div class="box"><div>USD: {{usdAmount}}</div><div *ngIf="quote">Crypto: {{quote.expectedAmount}}</div><div *ngIf="quote">Address: {{quote.depositAddress}}</div></div>`, styles:[`.box{border:1px solid #ddd;padding:12px;border-radius:8px;word-break:break-word}`] })
export class PaymentDetailsComponent { @Input() usdAmount!: number; @Input() quote?: any; }
