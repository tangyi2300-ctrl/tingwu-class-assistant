import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRecordingDeletion} from '../desktop/recording-deletion.mjs';
import {createLocalUploads} from '../desktop/local-uploads.mjs';
import {createNoteSync} from '../desktop/note-sync.mjs';
import {validateRequest} from '../desktop/tingwu-api.mjs';
import {atomicJSON} from '../desktop/local-recorder.mjs';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'tingwu-delete-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const f={dir,rows:[{transId:'cloud-one',title:'第一堂课',status:0,url:'https://tingwu.aliyun.com/doc/transcripts/cloud-one'}],local:[{id:'local-one',status:'saved',startedAt:1795485000000}],active:{recording:false},upload:{status:'uploaded',stage:'done',transId:'cloud-one'},calls:[],time:1,fail:false,keep:false,failRead:false};
 f.recorder={records:async()=>f.local,status:async()=>f.active};f.uploads={localIdFor:async()=>f.local[0]?.id,deletionTarget:async()=>f.upload};
 f.list=async()=>{if(f.failRead)throw Error('读取失败');return structuredClone(f.rows);};f.request=async b=>{f.calls.push(b);if(!f.keep)f.rows=[];if(f.fail)throw Error('请求超时');return {success:true};};
 f.make=()=>createRecordingDeletion({...f,now:()=>f.time});f.service=await f.make();return f;
}
const cloud={transId:'cloud-one'};
test('delete request only accepts one exact ID and explicitly forbids permanent/bulk deletion',()=>{
 const b={action:'delTrans',version:'1.0',transIds:['cloud-one'],deletePermanently:false};assert.equal(validateRequest(b),'/api/trans/request?delTrans');
 for(const change of [{deletePermanently:true},{deletePermanently:undefined},{transIds:['one','two']},{transIds:[]},{transIds:['../bad']},{userId:'other'}])assert.throws(()=>validateRequest({...b,...change}));
 for(const action of ['delTrashes','delAllTrashes','revertTrashes'])assert.throws(()=>validateRequest({action,...{transId:'cloud-one'}}));
});
test('prepare/cancel is read-only; confirmation is single-use, bound to one record and durable',async t=>{
 const f=await fixture(t),p=await f.service.prepare(cloud);assert.equal(f.calls.length,0);assert.equal(p.title,'第一堂课');
 await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:false}));assert.equal(f.calls.length,0);
 const done=await f.service.remove({confirmation:p.confirmation,confirmed:true});assert.equal(done.transId,'cloud-one');assert.deepEqual(f.calls,[{action:'delTrans',version:'1.0',transIds:['cloud-one'],deletePermanently:false}]);
 await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:true}));assert.equal(f.calls.length,1);
 const restarted=await f.make();assert.ok(restarted.deleted('local-one'));assert.ok(restarted.suppressed(null,'cloud-one'));
});
test('renaming or changing upload identity while confirmation is open requires review again',async t=>{
 const f=await fixture(t),p=await f.service.prepare(cloud);f.rows[0].title='用户刚改的标题';await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:true}),/已变化/);assert.equal(f.calls.length,0);
 const local=await f.service.prepare({localId:'local-one'});f.upload={status:'waiting',stage:'pending'};await assert.rejects(f.service.remove({confirmation:local.confirmation,confirmed:true}),/已变化/);assert.equal(f.calls.length,0);
});
test('protects active, stale-active, and unfinished upload records, including at confirm time',async t=>{
 const f=await fixture(t),p=await f.service.prepare(cloud);f.active={recording:true,active:{id:'local-one'}};await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:true}),/仍在录制/);assert.equal(f.calls.length,0);
 f.active={stale:true,active:{id:'local-one'}};await assert.rejects(f.service.prepare(cloud),/状态未确认/);
 f.active={};f.local[0].status='recording';await assert.rejects(f.service.prepare(cloud));f.local[0].status='saved';
 for(const upload of [{status:'uploading',stage:'upload',transId:'cloud-one'},{status:'attention',stage:'creating'},{status:'retrying',stage:'notify',transId:'cloud-one'}]){f.upload=upload;await assert.rejects(f.service.prepare({localId:'local-one'}),/上传/);}
});
test('expired, forged, missing and malformed targets never reach the cloud',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.prepare({transId:'bad/../id'}));await assert.rejects(f.service.prepare({...cloud,localId:'local-one'}));await assert.rejects(f.service.remove({confirmation:'fake',confirmed:true}));
 const p=await f.service.prepare(cloud);f.time+=300001;await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:true}));f.rows=[];await assert.rejects(f.service.prepare(cloud));assert.equal(f.calls.length,0);
});
test('a lost response is verified by list readback without issuing a second deletion',async t=>{
 const f=await fixture(t);f.fail=true;const p=await f.service.prepare(cloud);await f.service.remove({confirmation:p.confirmation,confirmed:true});assert.equal(f.calls.length,1);assert.ok(f.service.deleted('local-one'));
});
test('success response with record still present remains visible, paused, and retryable after restart',async t=>{
 const f=await fixture(t);f.keep=true;let p=await f.service.prepare(cloud);await assert.rejects(f.service.remove({confirmation:p.confirmation,confirmed:true}),/未确认/);
 assert.equal(f.service.deleted('local-one'),false);assert.ok(f.service.suppressed('local-one'));assert.match(f.service.records(f.rows)[0].deletionWarning,/未确认/);
 const restarted=await f.make();assert.equal(f.calls.length,1);f.keep=false;p=await restarted.prepare(cloud);await restarted.remove({confirmation:p.confirmation,confirmed:true});assert.equal(f.calls.length,2);
});
test('ambiguous readback retains the row; explicit retry only verifies an already absent record',async t=>{
 const f=await fixture(t);
 const service=await createRecordingDeletion({...f,request:async()=>{f.rows=[];f.failRead=true;}});
 // A new service has its own confirmation tokens.
 const target=await service.prepare(cloud);await assert.rejects(service.remove({confirmation:target.confirmation,confirmed:true}),/读取失败/);
 f.failRead=false;assert.equal(service.records([]).length,1);const restarted=await f.make(),retry=await restarted.prepare(cloud);
 await restarted.remove({confirmation:retry.confirmation,confirmed:true});assert.equal(f.calls.length,0);assert.ok(restarted.deleted('local-one'));
});
test('deleting never-uploaded audio preserves bytes and stops discovery, retry and future upload',async t=>{
 const f=await fixture(t);f.upload=null;const audio=path.join(f.dir,'local-one.wav');await writeFile(audio,'original audio backup');
 const p=await f.service.prepare({localId:'local-one'});assert.equal(p.transId,null);await f.service.remove({confirmation:p.confirmation,confirmed:true});assert.equal(f.calls.length,0);assert.equal(await readFile(audio,'utf8'),'original audio backup');
 const restart=await f.make(),u=createLocalUploads({dir:f.dir,recorder:f.recorder,isSuppressed:id=>restart.suppressed(id),isDeleted:id=>restart.deleted(id),request:async()=>assert.fail('must not upload')});await u.tick();assert.deepEqual((await u.status()).jobs,[]);await assert.rejects(u.retry('local-one'));
});
test('retained old upload and note jobs cannot upload or overwrite cloud notes after deletion',async t=>{
 const f=await fixture(t),p=await f.service.prepare(cloud);await f.service.remove({confirmation:p.confirmation,confirmed:true});
 await atomicJSON(path.join(f.dir,'uploads.json'),{'local-one':{id:'local-one',status:'waiting',stage:'pending'}});
 const u=createLocalUploads({dir:f.dir,recorder:f.recorder,isSuppressed:id=>f.service.suppressed(id),isDeleted:id=>f.service.deleted(id),request:async()=>assert.fail('deleted upload resumed')});await u.tick();assert.deepEqual((await u.status()).jobs,[]);
 await atomicJSON(path.join(f.dir,'note-sync.json'),{'local-one':{id:'local-one',transId:'cloud-one',status:'pending'}});
 const sync=createNoteSync({dir:f.dir,classroom:{noteIds:async()=>['local-one'],notes:async()=>({text:'私有笔记',revision:1})},uploads:{},isSuppressed:id=>f.service.suppressed(id),request:async()=>assert.fail('deleted notes synced')});await sync.tick();await assert.rejects(sync.queue('local-one'));
 const restored=[{transId:'cloud-one',title:'在听悟恢复的录音'}];assert.equal(f.service.records(restored).length,1,'cloud restores may reappear without reactivating local automation');assert.equal(f.service.cachedRecords(restored,0).length,0);assert.equal(f.service.cachedRecords(restored,2).length,1,'freshly restored cache survives restart');
});
