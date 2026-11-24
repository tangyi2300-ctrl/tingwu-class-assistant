import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {clearUploadedAudio,probeCloudAudio} from '../desktop/audio-retention.mjs';
import {createLocalUploads} from '../desktop/local-uploads.mjs';
import {createClassroom} from '../desktop/classroom.mjs';
import {atomicJSON} from '../desktop/local-recorder.mjs';
const id='test-saved-audio',transId='test-cloud-audio';
function wav(){const b=Buffer.alloc(64044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(64000,40);b.fill(14,44);return b;}
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'tingwu-retention-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'Recordings'));
 const file=path.join(dir,'Recordings',id+'.wav'),meta=file.replace('.wav','.json');await writeFile(file,wav());const record={id,status:'saved',durationSeconds:2,file};await atomicJSON(meta,record);
 const f={dir,file,meta,record,active:{recording:false},job:{id,transId,status:'uploaded',stage:'done',durationSeconds:2},cloud:{transId,taskId:'local-'+id,status:0,fileSize:64044,duration:2,playback:'https://sample.oss-cn-shanghai.aliyuncs.com/audio'},proofs:[],probes:0};
 f.recorder={status:async()=>f.active,records:async()=>[JSON.parse(await readFile(meta,'utf8'))]};f.request=async b=>{assert.equal(b.action,'getTransResult');assert.equal(b.transId,transId);return {data:f.cloud};};f.probe=async()=>{f.probes++;};f.persistEvidence=async proof=>{f.proofs.push(proof);Object.assign(f.job,proof);};return f;
}
test('verified cloud identity, full size, duration and readable playback permit removing only that WAV',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.dir,'notes.json'),'preserved notes');const result=await clearUploadedAudio(f);
 await assert.rejects(stat(f.file),{code:'ENOENT'});assert.equal(f.probes,1);assert.equal(f.proofs.length,1);assert.ok(result.audioRemovedAt);assert.equal(result.bytes,64044);
 const meta=JSON.parse(await readFile(f.meta));assert.equal(meta.id,id);assert.equal(meta.cloudTransId,transId);assert.equal(meta.status,'saved');assert.equal(await readFile(path.join(f.dir,'notes.json'),'utf8'),'preserved notes');
});
test('no cleanup for an upload still waiting, uploading, failed or ambiguous',async t=>{
 for(const status of ['waiting','uploading','attention','retrying']){const f=await fixture(t);f.job.status=status;await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());assert.equal(f.probes,0);}
});
test('cloud mismatch, incomplete processing, missing playback, or network failure keeps the only local copy',async t=>{
 for(const change of [{transId:'other'},{taskId:'local-other'},{status:1},{fileSize:30000},{duration:1/0},{duration:0}]){const f=await fixture(t);Object.assign(f.cloud,change);await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());assert.equal(f.probes,0);}
 for(const which of ['request','probe']){const f=await fixture(t);f[which]=async()=>{throw Error('offline');};await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());}
});
test('active or stale-active recordings remain protected, including a change during cloud verification',async t=>{
 for(const state of [{recording:true,active:{id}},{stale:true,active:{id}}]){const f=await fixture(t);f.active=state;await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());}
 const f=await fixture(t);f.probe=async()=>{f.active={recording:true,active:{id}};};await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());
});
test('file changes, symlinks, wrong metadata and unsafe IDs cannot cause unrelated deletion',async t=>{
 const f=await fixture(t);f.probe=async()=>writeFile(f.file,Buffer.concat([wav(),Buffer.from('new')]));await assert.rejects(clearUploadedAudio(f),/变化/);assert.ok((await stat(f.file)).size>64044);
 const linked=await fixture(t),outside=path.join(linked.dir,'keep.wav');await writeFile(outside,wav());await unlink(linked.file);await symlink(outside,linked.file);await assert.rejects(clearUploadedAudio(linked),/异常/);assert.deepEqual(await readFile(outside),wav());
 const wrong=await fixture(t);await atomicJSON(wrong.meta,{...wrong.record,id:'other'});await assert.rejects(clearUploadedAudio(wrong));assert.deepEqual(await readFile(wrong.file),wav());
 const unsafe=await fixture(t);unsafe.job.id='../elsewhere';await assert.rejects(clearUploadedAudio(unsafe));assert.deepEqual(await readFile(unsafe.file),wav());
});
test('proof must be durable before unlink; restart after unlink completes without another upload',async t=>{
 const f=await fixture(t);f.persistEvidence=async()=>{throw Error('disk write failed');};await assert.rejects(clearUploadedAudio(f));assert.deepEqual(await readFile(f.file),wav());
 const crashed=await fixture(t);Object.assign(crashed.job,{audioVerifiedAt:1000,audioVerifiedBytes:64044});await unlink(crashed.file);await clearUploadedAudio(crashed);assert.ok(JSON.parse(await readFile(crashed.meta)).audioRemovedAt);
});
test('the playback probe rejects redirects, missing bytes, HTML, unsafe hosts and signed-URL errors without leaking them',async()=>{
 for(const url of ['http://sample.oss-cn-shanghai.aliyuncs.com/a','https://evil.example/a','https://user:password@sample.oss-cn-shanghai.aliyuncs.com/a'])await assert.rejects(probeCloudAudio(url,()=>assert.fail('unexpected request')));
 const url='https://sample.oss-cn-shanghai.aliyuncs.com/a?signature=secret';
 for(const response of [new Response('audio',{status:200}),new Response('bad',{status:206,headers:{'content-type':'text/html','content-range':'bytes 0-2/3'}}),new Response('',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-0/1'}})])await assert.rejects(probeCloudAudio(url,async()=>response));
 await assert.rejects(probeCloudAudio(url,async()=>{throw Error(url);}),e=>!e.message.includes('secret'));
 let options;await probeCloudAudio(url,async(_u,o)=>{options=o;return new Response('abc',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-2/3'}});});assert.equal(options.redirect,'error');assert.equal(options.headers.Range,'bytes=0-1023');
});
test('uploader cleans old uploaded files and restart does not re-upload or re-clean',async t=>{
 const f=await fixture(t);await atomicJSON(path.join(f.dir,'uploads.json'),{[id]:f.job});let calls=0;
 const args={dir:f.dir,recorder:f.recorder,request:f.request,clearAudio:async options=>{calls++;return clearUploadedAudio({...options,probe:f.probe});}};
 const queue=createLocalUploads(args);await queue.tick();const job=(await queue.status()).jobs[0];assert.ok(job.audioRemovedAt);assert.equal(job.status,'uploaded');
 await createLocalUploads(args).tick();assert.equal(calls,1);assert.ok(!(JSON.stringify(await queue.status())).includes('playback'));
});
test('failed cleanup is visible and does not block other uploaded recordings',async t=>{
 const f=await fixture(t);await atomicJSON(path.join(f.dir,'uploads.json'),{[id]:f.job,two:{...f.job,id:'two'}});let calls=0;
 const queue=createLocalUploads({dir:f.dir,recorder:f.recorder,clearAudio:async({job})=>{calls++;if(job.id===id)throw Error('云端暂不可读取');return {audioRemovedAt:1000};}});
 await queue.tick();assert.match((await queue.forLocal(id)).audioCleanupError,/云端/);await queue.tick();assert.ok((await queue.forLocal('two')).audioRemovedAt);assert.equal(calls,2);assert.deepEqual(await readFile(f.file),wav());
});
test('classroom cleanup waits for readers and retained transcript/notes still work after removal',async t=>{
 const f=await fixture(t),dir=path.join(f.dir,'Classrooms');await mkdir(dir);await atomicJSON(path.join(dir,id+'.transcript.json'),{phase:'listening',pid:process.pid,segments:[]});
 let launches=0;const classroom=createClassroom({dir,recorder:f.recorder,executable:'/unused',launch:()=>{launches++;throw Error('must not launch');}});
 await assert.rejects(classroom.withAudioCleanup(id,()=>assert.fail('reader in use')),/课堂文字/);
 await atomicJSON(path.join(dir,id+'.transcript.json'),{phase:'complete',segments:[{text:'课堂文字'}]});await classroom.saveNotes(id,{text:'继续保留的笔记',revision:0});
 await classroom.withAudioCleanup(id,()=>clearUploadedAudio(f));const data=await classroom.get(id);assert.equal(data.notes.text,'继续保留的笔记');assert.equal(data.transcript.segments[0].text,'课堂文字');await classroom.saveNotes(id,{text:'清理后仍可编辑',revision:1});assert.equal(launches,0);
});
