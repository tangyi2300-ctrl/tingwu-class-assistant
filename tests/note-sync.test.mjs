import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openNoteDocument,prepareNoteUpdate,NOTE_START,NOTE_END} from '../desktop/note-document.mjs';
import {createNoteSync} from '../desktop/note-sync.mjs';
import {validateRequest} from '../desktop/tingwu-api.mjs';
import {buildRecordingDetail,withLocalNotes} from '../desktop/recording-detail.mjs';
const p=s=>['p',{},['span',{'data-type':'text'},['span',{'data-type':'leaf'},s]]];
const root=(...nodes)=>JSON.stringify(['root',{},...nodes]);
test('DingDoc sync preserves original rich notes and changes only the managed block',()=>{
 const original=['p',{style:'color:red'},['img',{src:'https://example.invalid/image'}],['span',{},'原有笔记']];const first=prepareNoteUpdate(root(original),'我的笔记\n\n<script>文字</script> 🎬');
 assert.deepEqual(JSON.parse(first.content)[2],original);assert.equal(openNoteDocument(first.content).text,'我的笔记\n\n<script>文字</script> 🎬');
 const next=prepareNoteUpdate(first.content,'修改后','我的笔记\n\n<script>文字</script> 🎬');assert.deepEqual(JSON.parse(next.content)[2],original);assert.equal(openNoteDocument(next.content).text,'修改后');
 const cleared=prepareNoteUpdate(next.content,'','修改后');assert.equal(cleared.content,root(original));
});
test('Lake HTML sync keeps existing bytes, escapes text, and preserves outside additions',()=>{
 const original='<!doctype lake><p class="x"><b>原笔记 &amp; 强调</b></p><img src="x.png">';const first=prepareNoteUpdate(original,'<script>alert(1)</script> & 测试');assert.ok(first.content.startsWith(original));assert.ok(first.content.includes('&lt;script&gt;'));
 const withExtra=first.content+'<p>网页后补的内容</p>',next=prepareNoteUpdate(withExtra,'新版','<script>alert(1)</script> & 测试');assert.ok(next.content.endsWith('<p>网页后补的内容</p>'));assert.equal(openNoteDocument(next.content).text,'新版');
 const cleared=prepareNoteUpdate(next.content,'','新版');assert.equal(cleared.content,original+'<p>网页后补的内容</p>');
});
test('manual edits, deleted markers and complex content in the managed block halt overwrite',()=>{
 const first=prepareNoteUpdate('','App 内容').content;
 assert.throws(()=>prepareNoteUpdate(first.replace('App 内容','网页改动'),'App 新版','App 内容'),e=>e.conflict);
 assert.throws(()=>prepareNoteUpdate('', 'App 新版','App 内容'),e=>e.conflict);
 assert.throws(()=>prepareNoteUpdate(root(p(NOTE_START),['img',{src:'x'}],p(NOTE_END)),'新版',''),e=>e.conflict);
 assert.throws(()=>prepareNoteUpdate(root(p(NOTE_START)),'新版'),e=>e.conflict);
 assert.throws(()=>prepareNoteUpdate('broken','新版'));
 assert.throws(()=>prepareNoteUpdate('',NOTE_START));
});
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'tingwu-note-sync-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let local={revision:1,text:'本机课堂笔记',updatedAt:1},upload=null,content=root(p('原有听悟笔记')),clock=100000,saves=0,gets=0,saveHook=null,readHook=null;
 const args={dir,classroom:{notes:async()=>({...local}),noteIds:async()=>['lesson']},uploads:{forLocal:async()=>upload},now:()=>clock,request:async body=>{validateRequest(body);if(body.action==='getTransDocEdit'){gets++;await readHook?.(gets);return {code:'0',data:{content}};}assert.equal(body.action,'saveTransDocEdit');saves++;content=body.content;await saveHook?.();return {code:'0',success:true};}};
 return {args,get local(){return local;},set local(v){local=v;},get content(){return content;},set content(v){content=v;},get saves(){return saves;},get gets(){return gets;},advance(){clock+=600000;},uploaded(){upload={status:'uploaded',transId:'cloud-1'};},onSave(fn){saveHook=fn;},onRead(fn){readHook=fn;}};
}
test('notes wait for matching upload, persist across restart and sync exactly once',async t=>{
 const f=await fixture(t);let c=createNoteSync(f.args);await c.tick();assert.equal(f.saves,0);assert.equal((await c.status('lesson')).status,'waiting');
 f.uploaded();await c.tick();assert.equal(f.saves,1);assert.equal((await c.status('lesson')).status,'synced');assert.equal(openNoteDocument(f.content).text,f.local.text);
 assert.ok(f.content.includes('原有听悟笔记'));c=createNoteSync(f.args);await c.tick();assert.equal(f.saves,1);assert.equal((await c.status('lesson')).syncedRevision,1);
 const backup=JSON.parse(await readFile(path.join(f.args.dir,'NoteSyncBackups/lesson.json'),'utf8'));assert.ok(backup.before.includes('原有听悟笔记'));
});
test('ambiguous success is recovered by readback after restart without duplicated notes',async t=>{
 const f=await fixture(t);f.uploaded();let c=createNoteSync(f.args);f.onSave(()=>{throw Error('network timeout after save');});await c.tick();assert.equal((await c.status('lesson')).status,'retrying');assert.equal(f.saves,1);
 f.onSave(null);f.advance();c=createNoteSync(f.args);await c.tick();assert.equal(f.saves,1);assert.equal((await c.status('lesson')).status,'synced');assert.equal(JSON.parse(f.content).filter(n=>Array.isArray(n)&&JSON.stringify(n).includes(NOTE_START)).length,1);
});
test('editing locally during an upload queues the newer revision',async t=>{
 const f=await fixture(t);f.uploaded();const c=createNoteSync(f.args);f.onSave(async()=>{f.local={...f.local,revision:2,text:'后来补充的新笔记'};await c.queue('lesson');f.onSave(null);});
 await c.tick();assert.equal((await c.status('lesson')).status,'pending');assert.equal(openNoteDocument(f.content).text,'本机课堂笔记');f.advance();await c.tick();assert.equal(openNoteDocument(f.content).text,'后来补充的新笔记');assert.equal((await c.status('lesson')).syncedRevision,2);
});
test('a concurrent remote edit between the two reads prevents a stale write',async t=>{
 const f=await fixture(t);f.uploaded();const c=createNoteSync(f.args);f.onRead(n=>{if(n===2)f.content=root(p('刚新增的网页笔记'));});await c.tick();assert.equal(f.saves,0);assert.equal((await c.status('lesson')).status,'retrying');f.onRead(null);f.advance();await c.tick();assert.ok(f.content.includes('刚新增的网页笔记'));assert.equal(f.saves,1);
});
test('manual cloud changes stay intact until the user merges them into local notes',async t=>{
 const f=await fixture(t);f.uploaded();const c=createNoteSync(f.args);await c.tick();f.content=f.content.replace('本机课堂笔记','听悟改过的内容');f.local={...f.local,revision:2,text:'本机的新改动'};await c.queue('lesson');f.advance();await c.tick();assert.equal((await c.status('lesson')).status,'conflict');assert.equal(f.saves,1);assert.ok(f.content.includes('听悟改过的内容'));
 f.local={...f.local,revision:3,text:'听悟改过的内容\n本机的新改动'};await c.queue('lesson');f.advance();await c.tick();assert.equal((await c.status('lesson')).status,'conflict');assert.equal(f.saves,1);await c.retry('lesson',{merge:true});await c.tick();assert.equal((await c.status('lesson')).status,'synced');assert.equal(f.saves,2);assert.equal(openNoteDocument(f.content).text,'听悟改过的内容\n本机的新改动');
});
test('outline displays synced local notes once, while retaining unrelated cloud notes',()=>{
 const original='\n  本机内容  \n\n下一段\n',synced=prepareNoteUpdate(root(p('原有听悟笔记'),p('')),original);
 const content=synced.content;
 const detail=buildRecordingDetail({transId:'cloud-1'},{lab:{},transcript:{result:'{"pg":[]}'},notes:{content}});
 const combined=withLocalNotes(detail,{text:original,updatedAt:2},synced.text);
 assert.deepEqual(combined.notes.items.map(n=>n.text),['原有听悟笔记','  本机内容  ','下一段']);
 assert.equal(combined.notes.originalText,'原有听悟笔记\n');
 assert.equal(combined.notes.localOriginalText,original);
 assert.equal(detail.notes.items.length,5);
});
test('write endpoint rejects malformed ids, formats and unrelated tag mutations',()=>{
 const valid={action:'saveTransDocEdit',version:'1.0',transId:'class-1',content:root(p('笔记')),tag:{docEditFormat:'dingDoc',hasNote:true}};assert.match(validateRequest(valid),/saveTransDocEdit&transId=class-1$/);
 for(const bad of [{...valid,transId:'../other'},{...valid,content:null},{...valid,tag:{...valid.tag,showName:'overwrite'}},{...valid,baseVer:-1}])assert.throws(()=>validateRequest(bad));
});
