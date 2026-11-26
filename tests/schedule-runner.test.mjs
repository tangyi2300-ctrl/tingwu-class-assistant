import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduleCycle} from '../desktop/schedule-runner.mjs';
import {DEFAULTS} from '../extension/schedule.js';
import {SCHEDULE_POLL_MS} from '../desktop/scheduler.mjs';
const when=s=>new Date('2026-11-16T'+s+'+08:00');
function harness(time='09:55:00'){
 let clock=when(time),persisted;
 const h={state:{settings:{...DEFAULTS,enabled:true}},starts:0,reminders:0,notices:[],preflights:0,logs:[],
 now:()=>clock,advance:s=>clock=when(s),save:async()=>{persisted=structuredClone(h.state);},reload:()=>{h.state=structuredClone(persisted);},
 start:async()=>{h.starts++;return {confirmed:true,elapsedSeconds:3};},preflight:async()=>{h.preflights++;},
 remind:async()=>{h.reminders++;},notice:async(m,u)=>h.notices.push({m,u}),log:async(m,l)=>h.logs.push({m,l}),cycle:()=>runScheduleCycle(h)};
 return h;
}
test('failed reminder launch retries without marking it complete or starting a recording',async()=>{
 const h=harness('12:15:00');h.state.settings.noon='12:15';h.state.completed={'2026-11-16:morning':1};
 let attempts=0;h.remind=async()=>{attempts++;if(attempts===1)throw Error('提醒程序未启动');};
 await h.cycle();assert.equal(attempts,1);assert.equal(h.state.completed['2026-11-16:noon'],undefined);assert.equal(h.starts,0);
 h.advance('12:15:20');await h.cycle();assert.equal(attempts,1);
 h.advance('12:15:31');await h.cycle();assert.equal(attempts,2);assert.ok(h.state.completed['2026-11-16:noon']);assert.equal(h.starts,0);
});
test('opening the computer at 09:55 or later starts on the first resumed cycle and survives restart without duplication',async()=>{
 for(const openAt of ['09:55:00','09:56:00','09:58:00','09:59:00','09:59:58','10:00:00']){
  const h=harness('09:54:58');await h.cycle();assert.equal(h.starts,0);
  h.advance(openAt);await h.cycle();
  assert.equal(h.starts,1,openAt);
  assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'confirmed',openAt);
  assert.equal(h.state.sessionRuns['2026-11-16:morning'].confirmedAt,when(openAt).getTime());
  h.reload();h.advance('10:01:00');await h.cycle();assert.equal(h.starts,1,openAt);
 }
});
test('production polling retries a failed attempt within six seconds and catches up after sleep',async()=>{
 const h=harness('09:59:50');
 h.start=async()=>{h.starts++;throw Error('connection restoring');};await h.cycle();
 h.start=async()=>{h.starts++;return {confirmed:true,elapsedSeconds:3};};
 for(let delta=SCHEDULE_POLL_MS;delta<=6000;delta+=SCHEDULE_POLL_MS){
  h.advance(`09:59:${50+delta/1000}`);await h.cycle();
  assert.equal(h.starts,delta<5000?1:2);
 }
 assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'confirmed');
 const wake=harness('09:55:00');
 wake.start=async()=>{wake.starts++;wake.advance('09:58:00');throw Error('attempt expired during sleep');};
 await wake.cycle();wake.reload();wake.advance('09:58:02');
 wake.start=async()=>{wake.starts++;return {confirmed:true,elapsedSeconds:3};};await wake.cycle();
 assert.equal(wake.starts,2);assert.equal(wake.state.sessionRuns['2026-11-16:morning'].status,'confirmed');
});
test('failed start persists and still retries after restart past 10:00',async()=>{
 const h=harness('09:59:00');h.start=async()=>{h.starts++;throw Error('target page unavailable');};
 await h.cycle();assert.equal(h.state.completed['2026-11-16:morning'],undefined);
 h.reload();h.advance('10:02:00');h.start=async()=>{h.starts++;return {confirmed:true,elapsedSeconds:8};};await h.cycle();
 assert.equal(h.starts,2);assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'confirmed');
 h.reload();h.advance('10:20:00');await h.cycle();assert.equal(h.starts,2);
});
test('paused or unverified timer never marks a session completed',async()=>{
 const h=harness();h.start=async()=>({confirmed:false,paused:true});await h.cycle();
 assert.equal(h.state.completed['2026-11-16:morning'],undefined);assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'retrying');
});
test('preflight failure is retried instead of being marked completed',async()=>{
 const h=harness('09:50:00');h.preflight=async()=>{h.preflights++;throw Error('not found');};await h.cycle();
 assert.equal(h.state.completed['2026-11-16:preflight:morning'],undefined);h.advance('09:50:40');h.preflight=async()=>{h.preflights++;};await h.cycle();assert.equal(h.preflights,2);assert.ok(h.state.completed['2026-11-16:preflight:morning']);
});
test('missed class creates one persistent alert and never starts after class',async()=>{
 const h=harness('12:01:00');await h.cycle();h.advance('12:02:00');await h.cycle();
 assert.equal(h.starts,0);assert.equal(h.notices.length,1);assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'missed');
});
test('recording failure at class start triggers a prominent warning once',async()=>{
 const h=harness('10:01:00');h.start=async()=>{throw Error('locked');};await h.cycle();h.advance('10:02:00');await h.cycle();
 assert.equal(h.notices.filter(n=>n.u).length,1);assert.equal(h.state.sessionRuns['2026-11-16:morning'].status,'retrying');
});
test('manual end after confirmed start is not followed by another start; reminders stay separate',async()=>{
 const h=harness();await h.cycle();h.advance('11:50:00');await h.cycle();h.advance('12:10:00');await h.cycle();await h.cycle();
 assert.equal(h.starts,1);assert.equal(h.reminders,1);
});
test('pause while an attempt is running cancels completion and later attempts',async()=>{
 const h=harness();h.start=async()=>{h.starts++;h.state.settings.enabled=false;return {cancelled:true};};h.cancelled=()=>!h.state.settings.enabled;
 await h.cycle();h.advance('10:05:00');await h.cycle();assert.equal(h.starts,1);assert.equal(h.state.completed['2026-11-16:morning'],undefined);
});

test('all five weekday afternoons preflight at 13:45 and start at 13:50 before 14:00',async()=>{
 for(let day=16;day<=20;day++){
  const h=harness();let current=new Date(`2026-11-${day}T13:45:00+08:00`);h.now=()=>current;
  await h.cycle();assert.equal(h.preflights,1);assert.equal(h.starts,0);
  current=new Date(`2026-11-${day}T13:50:00+08:00`);h.start=async()=>{h.starts++;return {confirmed:true,source:'automatic',elapsedSeconds:3,startClickedAt:current.getTime()};};await h.cycle();
  const run=h.state.sessionRuns[`2026-11-${day}:afternoon`];assert.equal(run.source,'automatic');assert.equal(run.status,'confirmed');assert.ok(run.confirmedAt<new Date(`2026-11-${day}T14:00:00+08:00`).getTime());
  h.reload();current=new Date(`2026-11-${day}T13:59:00+08:00`);await h.cycle();assert.equal(h.starts,1);
 }
});
test('late afternoon wake and temporary failures retry before and after 14:00',async()=>{
 for(const at of ['13:50:00','13:52:00','13:58:00','13:59:50','14:00:00']){const h=harness(at);await h.cycle();assert.equal(h.starts,1);assert.equal(h.state.sessionRuns['2026-11-16:afternoon'].status,'confirmed');}
 const h=harness('13:57:00');h.start=async()=>{h.starts++;throw Error('loading');};await h.cycle();h.advance('13:57:04');await h.cycle();assert.equal(h.starts,1);h.advance('13:57:06');h.start=async()=>{h.starts++;return {confirmed:true,source:'automatic',elapsedSeconds:4};};await h.cycle();assert.equal(h.starts,2);
});
test('13:58 warning arrives before class even when the next attempt fails',async()=>{
 const h=harness('13:58:00');h.start=async()=>{assert.ok(h.notices.some(n=>n.u&&n.m.includes('不足两分钟')));throw Error('offline');};await h.cycle();assert.ok(h.state.alerted['2026-11-16:afternoon:before-class']);
});
test('an existing manual recording is not logged as an automatic start',async()=>{
 const h=harness('13:50:00');h.start=async()=>({confirmed:true,source:'existing',elapsedSeconds:50});await h.cycle();assert.equal(h.state.sessionRuns['2026-11-16:afternoon'].source,'existing');assert.ok(h.logs.some(x=>x.m.includes('本次未自动点击')));assert.ok(!h.logs.some(x=>x.m.includes('自动开启成功')));
});
test('30-second preclass health checks detect a stop without restarting a manually ended recording',async()=>{
 const h=harness('13:50:00');let checks=0;h.verifyRecording=async()=>{checks++;return {status:'recording',elapsedSeconds:40};};await h.cycle();h.advance('13:50:10');await h.cycle();assert.equal(checks,0);h.advance('13:50:30');await h.cycle();assert.equal(checks,1);
 h.advance('13:51:00');h.verifyRecording=async()=>{checks++;return {status:'not-recording',message:'已结束'};};await h.cycle();assert.equal(h.starts,1);assert.ok(h.state.completed['2026-11-16:afternoon']);assert.equal(h.state.sessionRuns['2026-11-16:afternoon'].health.status,'not-recording');assert.ok(h.notices.some(n=>n.m.includes('复查未通过')));
 h.advance('13:58:00');await h.cycle();assert.ok(h.state.alerted['2026-11-16:afternoon:before-class']);assert.equal(h.starts,1);h.advance('14:02:00');const previous=checks;await h.cycle();assert.equal(checks,previous+1);assert.equal(h.starts,1);
});

test('midclass interruption is logged and notified once, without restarting; recovery and class cutoff are observed',async()=>{
 for(const [kind,start,stop,repeat,recover,end] of [['morning','09:55:00','10:55:00','11:05:00','11:06:00','12:00:00'],['afternoon','13:50:00','14:49:40','15:00:00','15:01:00','18:00:00']]){
  const h=harness(start);let checks=0;
  h.verifyRecording=async()=>{checks++;return {status:'attention',issueKind:'limit',elapsedSeconds:3498,message:'听悟提示：录音时长已达上限'};};
  await h.cycle();const before=h.notices.length;
  h.advance(stop);await h.cycle();assert.equal(checks,1);assert.equal(h.starts,1);assert.equal(h.notices.length,before+1);
  assert.ok(h.logs.some(l=>l.m.includes('3498')&&l.m.includes('录音时长已达上限')));
  h.reload();h.advance(repeat);await h.cycle();assert.equal(h.notices.length,before+1,'same incident must not repeatedly interrupt work');assert.equal(h.starts,1);
  h.verifyRecording=async()=>{checks++;return {status:'recording',elapsedSeconds:70,message:'已复查录音计时持续增加'};};
  h.advance(recover);await h.cycle();assert.equal(h.state.sessionRuns['2026-11-16:'+kind].health.status,'recording');assert.ok(h.logs.some(l=>l.m.includes('已恢复')));
  const prior=checks;h.advance(end);await h.cycle();assert.equal(checks,prior);assert.equal(h.starts,1);
 }
});
test('a manually paused or ended class stays stopped while monitoring continues',async()=>{
 const h=harness('13:50:00');await h.cycle();
 for(const [time,status] of [['14:30:00','paused'],['15:00:00','not-recording']]){
  h.verifyRecording=async()=>({status,message:'用户已暂停或结束'});h.advance(time);await h.cycle();
  assert.equal(h.starts,1);assert.ok(h.state.completed['2026-11-16:afternoon']);
 }
});
