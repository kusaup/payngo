import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  readonly cards = [
    { title: 'BTC Wallet', value: '2.483 BTC', change: '+4.2% today' },
    { title: 'ETH Wallet', value: '18.92 ETH', change: '+1.1% today' },
    { title: 'USDT Vault', value: '$42,800', change: 'Stable reserve' }
  ];
}
