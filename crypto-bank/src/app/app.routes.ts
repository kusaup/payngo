import { Routes } from '@angular/router';
import { AuthComponent } from './pages/auth/auth.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', redirectTo: 'signin', pathMatch: 'full' },
  { path: 'signin', component: AuthComponent, data: { mode: 'signin' } },
  { path: 'signup', component: AuthComponent, data: { mode: 'signup' } },
  { path: 'dashboard', component: DashboardComponent },
  { path: '**', redirectTo: 'signin' }
];
