import { Component, Input } from '@angular/core';

@Component({ selector: 'app-status-screen', template: `<div *ngIf="status==='CONFIRMED'" class="ok">{{t.success}} {{t.redirecting}}</div><div *ngIf="status==='FAIL'" class="bad">{{t.failed}} {{t.redirecting}}</div><div *ngIf="status==='PENDING'">{{t.waiting}}</div>`, styles:[`.ok{color:green}.bad{color:red}`] })
export class StatusScreenComponent { @Input() status='PENDING'; @Input() t:any={}; }
