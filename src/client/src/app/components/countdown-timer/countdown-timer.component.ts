import { Component, Input, OnInit } from '@angular/core';

@Component({ selector: 'app-countdown-timer', template: `<div>Time left: {{remaining}}</div>` })
export class CountdownTimerComponent implements OnInit {
  @Input() expiresAt!: string;
  remaining = '05:00';
  ngOnInit() { setInterval(() => { const ms = new Date(this.expiresAt).getTime() - Date.now(); const s = Math.max(Math.floor(ms/1000),0); const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); this.remaining=`${m}:${ss}`; }, 1000); }
}
