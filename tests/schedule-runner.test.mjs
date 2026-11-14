import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduleCycle} from '../desktop/schedule-runner.mjs';
import {DEFAULTS} from '../extension/schedule.js';
const when=s=>new Date('2026-11-16T'+s+'+08:00');
function harness(time='09:55:00'){
 let clock=when(time),persisted;
 const h={state:{settings:{...DEFAULTS,enabled:true}},starts:0,reminders:0,notices:[],preflights:0,logs:[],
 now:()=>clock,advance:s=>clock=when(s),save:async()=>{persisted=structuredClone(h.state);},reload:()=>{h.state=structuredClone(persisted);},
 start:async()=>{h.starts++;return {confirmed:true,elapsedSeconds:3};},preflight:async()=>{h.preflights++;},
 remind:async()=>{h.reminders++;},notice:async(m,u)=>h.notices.push({m,u}),log:async(m,l)=>h.logs.push({m,l}),cycle:()=>runScheduleCycle(h)};
 return h;
}
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
