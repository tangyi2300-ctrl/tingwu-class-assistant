import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordingLibrary} from '../desktop/recording-library.mjs';
import {listSavedRecordings} from '../desktop/tingwu-api.mjs';

test('homepage and naming share one read and only expose a complete refreshed list',async()=>{
 let state={records:[{title:'旧记录'}],updatedAt:1},resolve,reads=0,saves=0;
 const cache=createRecordingLibrary({read:()=>{reads++;return new Promise(r=>resolve=r);},get:()=>state,set:v=>state=v,save:async()=>{saves++;},now:()=>10});
 const first=cache.refresh(),second=cache.refresh();
 assert.equal(first,second);assert.equal(cache.busy,true);assert.equal(reads,1);
 assert.equal(state.records[0].title,'旧记录');
 resolve([{title:'完整记录一'},{title:'完整记录二'}]);await first;
 assert.equal(state.records.length,2);assert.equal(state.updatedAt,10);assert.equal(saves,1);assert.equal(cache.busy,false);
});
test('failed refresh keeps cached recordings and a later success clears the error',async()=>{
 let state={records:[{title:'已保存的录音'}],updatedAt:1},fail=true;
 const cache=createRecordingLibrary({read:async()=>{if(fail)throw Error('离线');return [{title:'新标题'}];},get:()=>state,set:v=>state=v,save:async()=>{},now:()=>20});
 await assert.rejects(cache.refresh(),/离线/);
 assert.equal(state.records[0].title,'已保存的录音');assert.equal(state.updatedAt,1);assert.equal(state.error,'离线');assert.equal(cache.busy,false);
 fail=false;await cache.refresh();assert.equal(state.records[0].title,'新标题');assert.equal(state.error,null);
});
test('a successful empty account replaces previous cached records',async()=>{
 let state={records:[{title:'已删除录音'}],updatedAt:1};
 const cache=createRecordingLibrary({read:async()=>[],get:()=>state,set:v=>state=v,save:async()=>{},now:()=>20});
 await cache.refresh();assert.deepEqual(state.records,[]);assert.equal(state.updatedAt,20);
});
test('malformed list cannot clear the last complete recording cache',async()=>{
 let state={records:[{title:'已有录音'}],updatedAt:1};
 const cache=createRecordingLibrary({read:async()=>null,get:()=>state,set:v=>state=v,save:async()=>{}});
 await assert.rejects(cache.refresh(),/格式无效/);assert.equal(state.records.length,1);
});
test('all saved recordings are paged, including records beyond the naming history limit',async()=>{
 const rows=Array.from({length:103},(_,i)=>({transId:`example-${i}`,tag:{showName:`录音 ${i}`},status:0,showTime:1700000000000+i,duration:60}));
 const pages=[];const records=await listSavedRecordings(async body=>{pages.push(body.pageNo);return {data:rows.slice((body.pageNo-1)*100,body.pageNo*100),total:rows.length};});
 assert.deepEqual(pages,[1,2]);assert.equal(records.length,103);assert.equal(records.at(-1).title,'录音 102');
});
test('incomplete pagination rejects instead of reporting a partial account list as complete',async()=>{
 await assert.rejects(listSavedRecordings(async body=>({total:2,data:body.pageNo===1?[{transId:'example',tag:{showName:'录音'}}]:[]})),/尚未完整返回/);
});
