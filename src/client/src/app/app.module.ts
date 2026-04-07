import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule, Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { PaymentContainerComponent } from './components/payment-container/payment-container.component';
import { CryptoSelectorComponent } from './components/crypto-selector/crypto-selector.component';
import { PaymentDetailsComponent } from './components/payment-details/payment-details.component';
import { CountdownTimerComponent } from './components/countdown-timer/countdown-timer.component';
import { StatusScreenComponent } from './components/status-screen/status-screen.component';

const routes: Routes = [{ path: ':id', component: PaymentContainerComponent }];

@NgModule({
  declarations: [
    AppComponent,
    PaymentContainerComponent,
    CryptoSelectorComponent,
    PaymentDetailsComponent,
    CountdownTimerComponent,
    StatusScreenComponent,
  ],
  imports: [BrowserModule, HttpClientModule, RouterModule.forRoot(routes)],
  bootstrap: [AppComponent],
})
export class AppModule {}
