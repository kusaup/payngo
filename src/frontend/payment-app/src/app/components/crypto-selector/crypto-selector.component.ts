import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({ selector: 'app-crypto-selector', template: `<div *ngFor="let a of assets"><strong>{{a.coin}}</strong><div class="networks"><button *ngFor="let n of a.networks" (click)="choose(a.coin,n)">{{n}}</button></div></div>`, styles:[`.networks{display:flex;flex-wrap:wrap;gap:8px}button{min-height:40px}`] })
export class CryptoSelectorComponent {
  @Input() assets: any[] = [];
  @Output() selected = new EventEmitter<{ coin: string; network: string }>();
  choose(coin: string, network: string) { this.selected.emit({ coin, network }); }
}
