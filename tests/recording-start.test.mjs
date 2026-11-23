import test from 'node:test';import assert from 'node:assert/strict';
import {ensureRecordingStarted,verifyRecordingHealth} from '../desktop/recording-start.mjs';
const base=Date.parse('2026-11-17T13:50:00+08:00');
const live=seconds=>({action:'ongoing',ongoing:true,live:true,paused:false,path:'/doc/record',elapsedSeconds:seconds,tabId:1,windowId:1});
function run(sequence,extra={}){let clock=base,index=0;const clicks=[];return {clicks,go:()=>ensureRecordingStarted({attemptId:'afternoon-test',now:()=>clock,wait:async ms=>{clock+=ms;},prepare:async()=>{},step:async()=>sequence[Math.min(index++,sequence.length-1)],onClick:async action=>clicks.push(action),...extra})};}
test('already-running manual recording is confirmed as existing, never automatic',async()=>{
 const h=run([live(50),live(51)]),result=await h.go();assert.equal(result.confirmed,true);assert.equal(result.source,'existing');assert.equal(result.startClickedAt,null);assert.equal(h.clicks.length,0);
});
test('actual start click plus growing timer records automatic origin and click evidence',async()=>{
 const h=run([{action:'clicked',label:'开启实时记录'},{action:'clicked',label:'开始录音'},live(1),live(2)]),result=await h.go();assert.equal(result.source,'automatic');assert.equal(result.startClickedAt,base+1000);assert.equal(h.clicks.filter(c=>c.isStart).length,1);
});
test('opening a recording menu alone is not proof that the app started the microphone',async()=>{
 const result=await run([{action:'clicked',label:'开启实时记录'},live(50),live(51)]).go();assert.equal(result.source,'existing');
});
test('persisted click evidence survives retries only when it belongs to the current recording',async()=>{
 assert.equal((await run([live(5),live(6)],{priorStartClickedAt:base-5000}).go()).source,'automatic');
 assert.equal((await run([live(50),live(51)],{priorStartClickedAt:base-5000}).go()).source,'existing');
 assert.equal((await run([live(5),live(6)],{priorStartClickedAt:base-120000}).go()).source,'existing','a much later manual start cannot inherit a failed automatic click');
});
test('paused, frozen and implausibly jumping timers cannot mark automatic success',async()=>{
 await assert.rejects(()=>run([{...live(5),paused:true}]).go(),/暂停/);
 await assert.rejects(()=>run([live(5)]).go(),/尚未确认/);
 await assert.rejects(()=>run([live(1),live(3600)]).go(),/尚未确认/);
});
test('cancelled or expired attempts never click recording controls',async()=>{
 const cancelled=await run([],{cancelled:()=>true,step:()=>{throw Error('must not click');}}).go();assert.equal(cancelled.cancelled,true);
 await assert.rejects(()=>run([],{deadline:base,step:()=>{throw Error('must not click');}}).go(),/尚未确认/);
});
test('health checks use two advancing samples and never execute recording actions',async()=>{
 let reads=0;const active=await verifyRecordingHealth({read:async()=>live(++reads),wait:async()=>{}});assert.equal(active.status,'recording');assert.equal(reads,2);
 assert.equal((await verifyRecordingHealth({read:async()=>({...live(10),paused:true}),wait:async()=>{}})).status,'paused');
 assert.equal((await verifyRecordingHealth({read:async()=>({...live(10),ongoing:false}),wait:async()=>{}})).status,'not-recording');
 assert.equal((await verifyRecordingHealth({read:async()=>live(10),wait:async()=>{}})).status,'stalled');
});
test('a Tingwu limit or network alert overrides an advancing timer without claiming a confirmed stop',async()=>{
 for(const kind of ['limit','network','quota']){
  const recordingIssue={kind,message:'录音时长已达上限'};let reads=0;
  const result=await verifyRecordingHealth({read:async()=>({...live(++reads),recordingIssue}),wait:async()=>{}});
  assert.equal(result.status,'attention');assert.equal(result.issueKind,kind);assert.equal(result.elapsedSeconds,1);assert.equal(reads,1);
  reads=0;const later=await verifyRecordingHealth({read:async()=>({...live(++reads),...(reads===2?{recordingIssue}:{})}),wait:async()=>{}});
  assert.equal(later.status,'attention');assert.equal(reads,2);
  await assert.rejects(()=>run([{...live(1),recordingIssue},{...live(2),recordingIssue}]).go(),/录音时长已达上限/);
 }
});
