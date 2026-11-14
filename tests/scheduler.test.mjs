import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS} from '../extension/schedule.js';
import {runnableEvents,preflightEvents,recordingHasPriority,startDeadline} from '../desktop/scheduler.mjs';
const settings={...DEFAULTS,enabled:true};
const time=s=>new Date('2026-11-16T'+s+'+08:00');
test('Monday 09:50 preflight and 09:55 start',()=>{assert.equal(preflightEvents(settings,{},time('09:50:00'))[0].kind,'morning');assert.equal(runnableEvents(settings,{}, {},time('09:55:00'))[0].kind,'morning');});
test('failed starts retry after 30 seconds; confirmed starts never repeat',()=>{const id='2026-11-16:morning',a={[id]:time('09:55:00').getTime()};assert.equal(runnableEvents(settings,{},a,time('09:55:20')).length,0);assert.equal(runnableEvents(settings,{},a,time('09:55:30')).length,1);assert.equal(runnableEvents(settings,{[id]:1},a,time('11:56:00')).length,0);});
test('wake after 10:00 and 14:00 catches up, but lunch/evening never starts recording',()=>{
 for(const s of ['09:59:50','10:00:00','11:59:59'])assert.equal(runnableEvents(settings,{}, {},time(s))[0].kind,'morning');
 for(const s of ['14:00:00','17:59:59'])assert.equal(runnableEvents(settings,{}, {},time(s))[0].kind,'afternoon');
 for(const s of ['12:00:00','12:09:00','13:54:59','18:00:00','23:00:00'])assert.deepEqual(runnableEvents(settings,{}, {},time(s)),[]);
 assert.equal(startDeadline({kind:'morning',date:'2026-11-16'}),time('12:00:00').getTime());
});
test('end reminders remain 12:10 and 18:10',()=>{assert.equal(runnableEvents(settings,{}, {},time('12:10:00'))[0].kind,'noon');assert.equal(runnableEvents(settings,{}, {},time('18:10:00'))[0].kind,'evening');});
test('preflight failures retry; success completes the preflight',()=>{const id='2026-11-16:preflight:morning';assert.deepEqual(preflightEvents(settings,{[id]:1},time('09:51:00')),[]);assert.deepEqual(preflightEvents(settings,{},time('09:50:20'),{[id]:time('09:50:00').getTime()}),[]);assert.equal(preflightEvents(settings,{},time('09:51:00'),{[id]:time('09:50:00').getTime()}).length,1);});
test('recording takes priority over naming while a class start remains unconfirmed',()=>{
 assert.equal(recordingHasPriority(settings,{},time('09:49:59')),false);
 assert.equal(recordingHasPriority(settings,{},time('09:50:00')),true);
 assert.equal(recordingHasPriority(settings,{},time('10:05:00')),true);
 assert.equal(recordingHasPriority(settings,{'2026-11-16:morning':1},time('10:05:00')),false);
});
test('all five weekdays run and weekends/paused schedules never catch up',()=>{
 for(let day=16;day<=20;day++)assert.equal(runnableEvents(settings,{}, {},new Date(`2026-11-${day}T10:03:00+08:00`)).length,1);
 for(const day of [14,15,21,22])assert.deepEqual(runnableEvents(settings,{}, {},new Date(`2026-11-${day}T10:03:00+08:00`)),[]);
 assert.deepEqual(runnableEvents(DEFAULTS,{}, {},time('10:03:00')),[]);
});

test('display wake assertion is scoped to weekday classroom hours',async()=>{
 const {keepDisplayAwake}=await import('../desktop/scheduler.mjs');
 assert.equal(keepDisplayAwake(settings,time('09:50:00')),true);assert.equal(keepDisplayAwake(settings,time('12:00:00')),false);
 assert.equal(keepDisplayAwake(settings,time('13:50:00')),true);assert.equal(keepDisplayAwake(settings,time('18:00:00')),false);
 assert.equal(keepDisplayAwake(DEFAULTS,time('10:00:00')),false);
});
