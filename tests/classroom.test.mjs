import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createClassroom} from '../desktop/classroom.mjs';
import {buildRecordingDetail,withLocalNotes} from '../desktop/recording-detail.mjs';
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'tingwu-classroom-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'one.wav'),'fixture');const records=[{id:'one',file:path.join(dir,'one.wav'),status:'recording'},{id:'two',file:'/unused/two.wav',status:'saved'}];const recorder={records:async()=>records,status:async()=>({recording:true,active:{id:'one'}})};return {dir,recorder,enabled:false};}
test('notes survive restart, keep exact Chinese text, and isolate recordings',async t=>{
 const args=await fixture(t),c=createClassroom(args),text='# 课堂重点\n构图与光线 🎬\n<script>保持原文</script>';
 const saved=await c.saveNotes('one',{text,revision:0});assert.equal(saved.revision,1);
 const next=createClassroom(args);assert.equal((await next.get('one')).notes.text,text);assert.equal((await next.get('two')).notes.text,'');
 assert.equal((await stat(path.join(args.dir,'one.notes.json'))).mode&0o777,0o600);
 assert.equal((await next.saveNotes('one',{text,revision:0})).revision,1);
 await next.saveNotes('one',{text:'',revision:1});assert.equal((await next.notes('one')).text,'');
});
test('simultaneous edits reject stale versions instead of losing the other editor',async t=>{
 const c=createClassroom(await fixture(t));const result=await Promise.allSettled([c.saveNotes('one',{text:'第一份',revision:0}),c.saveNotes('one',{text:'第二份',revision:0})]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.find(x=>x.status==='rejected').reason.statusCode,409);
 assert.equal((await c.notes('one')).text,result.find(x=>x.status==='fulfilled').value.text);
});
test('notes reject unknown recordings, traversal and invalid payloads',async t=>{
 const c=createClassroom(await fixture(t));for(const id of ['missing','../escape'])await assert.rejects(c.saveNotes(id,{text:'x',revision:0}));
 for(const args of [{text:42,revision:0},{text:'a',revision:-1},{text:'x'.repeat(100001),revision:0}])await assert.rejects(c.saveNotes('one',args));
});
test('polls reuse an active transcriber and never issue microphone commands',async t=>{
 const args=await fixture(t),launches=[],child=new EventEmitter();const c=createClassroom({...args,enabled:true,launch:a=>{launches.push(a);return child;}});
 await c.monitor();await c.get('one');await c.monitor();assert.equal(launches.length,1);assert.deepEqual(launches[0].slice(0,2),[path.join(args.dir,'one.wav'),path.join(args.dir,'one.json')]);
 child.emit('exit',0);await writeFile(path.join(args.dir,'one.transcript.json'),JSON.stringify({phase:'complete',segments:[]}));await c.get('one');assert.equal(launches.length,1);
});
test('local notes supplement the outline without changing or replacing cloud notes',()=>{
 const cloud=buildRecordingDetail({transId:'cloud',title:'课堂'}, {lab:{},transcript:{result:JSON.stringify({pg:[{sc:[{tc:'构图与镜头语言决定画面重点。',bt:0,et:5000}]}]})},notes:{content:'<p>听悟原笔记</p>'}});
 const snapshot=structuredClone(cloud),local={text:'构图与镜头语言需要反复练习。\n明天带雨伞。',updatedAt:10};const result=withLocalNotes(cloud,local);
 assert.deepEqual(cloud,snapshot);assert.equal(result.notes.items.length,cloud.notes.items.length+2);assert.equal(result.notes.localCount,2);
 assert.ok(result.notes.unmatched.some(n=>n.text==='明天带雨伞。'));assert.ok(result.notes.items.some(n=>n.source==='local'));
 const updated=withLocalNotes(cloud,{text:'改过的内容',updatedAt:11});assert.equal(updated.notes.localCount,1);assert.ok(!updated.notes.items.some(n=>n.text===local.text));
 assert.deepEqual(withLocalNotes(cloud,{text:'',updatedAt:12}),cloud);
});
