import test from 'node:test';import assert from 'node:assert/strict';
import {runServiceGuard,serviceHealthy} from '../desktop/service-guard.mjs';
const time=Date.parse('2026-11-19T09:50:00+08:00');
const healthy={mode:'desktop',runtime:{startedAt:time-3600000,lastTickAt:time-1000}};
function harness(extra={}){const calls=[];return {calls,run:options=>runServiceGuard({enabled:true,loaded:true,now:()=>time,probe:async()=>healthy,recover:async args=>calls.push(args),...extra,...options})};}
test('healthy service is left alone; scheduled and completed sessions are never changed',async()=>{
 const state={...healthy,settings:{enabled:true},completed:{'2026-11-19:morning':time-1}};
 const copy=structuredClone(state),h=harness({probe:async()=>state});assert.equal((await h.run()).status,'healthy');assert.deepEqual(state,copy);assert.equal(h.calls.length,0);
});
test('a removed launch task is loaded on the first check',async()=>{
 const h=harness({loaded:false,probe:async()=>{throw Error('connection refused');}});const result=await h.run();assert.equal(result.status,'recovering');assert.deepEqual(h.calls,[{restart:false}]);assert.equal(result.recoveryCount,1);
});
test('transient HTTP failure does not restart a loaded service; repeated failure does',async()=>{
 const h=harness({probe:async()=>{throw Error('timeout');}});const first=await h.run();assert.equal(first.status,'checking');assert.equal(h.calls.length,0);
 const next=await h.run({previous:first,now:()=>time+30000});assert.equal(next.status,'recovering');assert.deepEqual(h.calls,[{restart:true}]);
});
test('an old failure after sleep must be checked again before a restart',async()=>{
 const h=harness({probe:async()=>null});const result=await h.run({previous:{checkedAt:time-600000,failures:1}});assert.equal(result.status,'checking');assert.equal(h.calls.length,0);
});
test('stale heartbeat is detected even if the HTTP server still responds',async()=>{
 const h=harness({probe:async()=>({...healthy,runtime:{...healthy.runtime,lastTickAt:time-60000}})});const first=await h.run();await h.run({previous:first,now:()=>time+30000});assert.deepEqual(h.calls,[{restart:true}]);
 assert.equal(serviceHealthy({...healthy,runtime:{startedAt:time-1000,lastTickAt:null}},time),true);
 assert.equal(serviceHealthy({...healthy,runtime:{startedAt:time-20000,lastTickAt:null}},time),false);
});
test('paused schedule and explicitly disabled launch task stay stopped',async()=>{
 for(const options of [{enabled:false},{disabled:true}]){const h=harness({probe:()=>{throw Error('must not inspect');}});const result=await h.run(options);assert.ok(['paused','disabled'].includes(result.status));assert.equal(h.calls.length,0);}
});
test('recovery failures are recorded and throttled instead of causing a restart loop',async()=>{
 let attempts=0;const h=harness({loaded:false,probe:async()=>null,recover:async()=>{attempts++;throw Error('bootstrap unavailable');}});const first=await h.run();assert.equal(first.status,'error');assert.equal(first.reason,'bootstrap unavailable');const second=await h.run({previous:first,now:()=>time+30000});assert.equal(second.status,'cooldown');assert.equal(attempts,1);
 await h.run({previous:second,now:()=>time+61000});assert.equal(attempts,2);
});
test('a healthy response clears previous failures and preserves the recovery audit',async()=>{
 const h=harness();const result=await h.run({previous:{failures:2,recoveryCount:3,recoveryAttemptAt:time-60000}});assert.equal(result.failures,0);assert.equal(result.recoveryCount,3);assert.equal(h.calls.length,0);
});
