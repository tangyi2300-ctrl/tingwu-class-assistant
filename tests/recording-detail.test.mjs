import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseNotes,parseTranscript,buildRecordingDetail,readRecordingDetail} from '../desktop/recording-detail.mjs';
import {createRecordingDetails} from '../desktop/recording-details-store.mjs';
const record={transId:'class-1',title:'课堂内容',duration:1800,url:'https://tingwu.aliyun.com/doc/transcripts/class-1'};
const paragraph=(text,start=0)=>({pi:String(start),sc:[{tc:text,bt:start*1000,et:(start+20)*1000}]});
const transcript={result:JSON.stringify({pg:[paragraph('镜头通过景别和构图表达人物情绪。'),paragraph('背景音乐与音效共同塑造节奏。',700)]})};
const card=(key,contentValues)=>({key,status:0,contents:[{contentValues}]});
const lab={labCardsMap:{summary:[card('fullSummary',[{value:'课程讲解镜头语言与声音设计。'}]),card('agendaSummary',[{title:'镜头语言与构图',value:'景别和构图影响人物情绪。调整镜头距离传递信息。'},{title:'声音设计与混音',value:'背景音乐与音效共同塑造节奏。人声与配乐保持平衡。'}])]}};
const notes=(...texts)=>({content:JSON.stringify(['root',{},...texts.map(t=>['p',{},['span',{'data-type':'text'},['span',{'data-type':'leaf'},t]]])])});
test('actual DingDoc note structure preserves every paragraph, formatting and safe text',()=>{
 const d=parseNotes(notes('构图先找主体。  ','<script>alert(1)</script>','', '　第二段'));assert.deepEqual(d.items.map(x=>x.text),['构图先找主体。  ','<script>alert(1)</script>','　第二段']);assert.equal(d.status,'ready');
 assert.equal(d.originalText,'构图先找主体。  \n<script>alert(1)</script>\n\n　第二段');
});
test('missing and malformed notes are distinct from an empty note area',()=>{
 assert.equal(parseNotes({content:null}).status,'empty');assert.equal(parseNotes(notes('')).status,'empty');
 assert.throws(()=>parseNotes({}));assert.throws(()=>parseNotes({content:'[broken'}));
 const d=buildRecordingDetail(record,{lab,transcript,notes:{}});assert.equal(d.notes.status,'error');assert.match(d.warnings.join(''),/尚未结合/);
});
test('Lake notes decode text safely and mark image notes without claiming recognition',()=>{
 const d=parseNotes({content:'<!doctype lake><p><b>构图</b> &amp; 光线</p><p><br></p><p>&lt;安全文本&gt;<br>  笔记</p><img src="https://example.invalid/a.jpg">'});
 assert.equal(d.attachments,1);assert.match(d.items.map(x=>x.text).join(''),/构图 & 光线/);assert.match(d.items.at(-1).text,/在听悟查看/);
 assert.equal(d.originalText,'构图 & 光线\n\n<安全文本>\n  笔记\n〔图片或附件笔记，请在听悟查看〕');
});
test('transcript preserves English spaces, all paragraphs and millisecond timestamps',()=>{
 const d=parseTranscript({result:JSON.stringify({pg:[{pi:'x',sc:[{tc:'Hello ',bt:1000,et:1100},{tc:'world.',bt:1100,et:2500}]}]})});
 assert.equal(d[0].text,'Hello world.');assert.equal(d[0].start,1);assert.equal(d[0].end,2.5);
});
test('full agenda retained, matching notes integrated and unrelated notes never lost',()=>{
 const d=buildRecordingDetail(record,{lab,transcript,notes:notes('调整镜头距离，注意人物情绪和构图。','明天带雨伞。')});
 assert.equal(d.chapters.length,2);assert.equal(d.chapters[0].points.length,2);assert.equal(d.chapters[0].notes[0].text,'调整镜头距离，注意人物情绪和构图。');
 assert.equal(d.notes.unmatched[0].text,'明天带雨伞。');assert.equal(d.notes.matched+d.notes.unmatched.length,d.notes.items.length);assert.equal(d.paragraphs.length,2);
});
test('without notes the same full outline is built from recording summaries',()=>{
 const d=buildRecordingDetail(record,{lab,transcript,notes:notes()});assert.equal(d.chapters.length,2);assert.equal(d.notes.status,'empty');assert.deepEqual(d.warnings,[]);
});
test('fallback segments span the entire transcript, including the last part',()=>{
 const pg=Array.from({length:21},(_,i)=>paragraph(`第${i}部分的课堂讲解内容，讨论不同的主题。`,i*610));
 const d=buildRecordingDetail(record,{lab:{},transcript:{result:JSON.stringify({pg})},notes:notes()});
 assert.equal(d.mode,'transcript');assert.equal(d.chapters.length,21);assert.match(d.chapters.at(-1).points.join(''),/第20部分/);assert.equal(d.paragraphs.length,21);
});
test('short or empty recordings do not invent summaries',()=>{
 const d=buildRecordingDetail(record,{lab:{},transcript:{result:'{"pg":[]}'},notes:notes()});assert.equal(d.summary,'');assert.equal(d.chapters.length,0);
});
test('reader is read-only, handles partial note failure and rejects all-source failure',async()=>{
 const calls=[];const d=await readRecordingDetail(record,async body=>{calls.push(body.action);if(body.action==='getTransDocEdit')throw Error('网络异常');return {data:body.action==='getAllLabInfo'?lab:transcript};});
 assert.deepEqual(calls.sort(),['getAllLabInfo','getTransDocEdit','getTransResult'].sort());assert.equal(d.notes.status,'error');assert.equal(d.chapters.length,2);
 await assert.rejects(()=>readRecordingDetail(record,async()=>{throw Error('已离线');}),/无法读取录音/);
});
test('unavailable transcript does not discard a valid generated outline',async()=>{
 const d=await readRecordingDetail(record,async body=>({data:body.action==='getAllLabInfo'?lab:body.action==='getTransResult'?{result:'broken'}:notes()}));assert.equal(d.chapters.length,2);assert.match(d.warnings.join(''),/转写原文暂未读到/);
});
async function settle(store,record){for(let i=0;i<30;i++){const r=await store.get(record,{poll:true});if(!['loading','deferred'].includes(r.status))return r;await new Promise(r=>setTimeout(r,5));}throw Error('store did not finish');}
test('detail cache single-flights, refreshes notes, persists privately and retains data on network error',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tingwu-details-'));let count=0,fail=false,clock=100;
 try{
 const store=createRecordingDetails({dir,now:()=>clock,read:async()=>{count++;await new Promise(r=>setTimeout(r,10));if(fail)throw Error('offline');return buildRecordingDetail(record,{lab,transcript,notes:notes('笔记版本 '+count)});}});
 await Promise.all([store.get(record),store.get(record)]);let result=await settle(store,record);assert.equal(count,1);assert.equal(result.detail.notes.items[0].text,'笔记版本 1');
 clock=200;await store.get(record,{refresh:true});result=await settle(store,record);assert.equal(result.detail.notes.items[0].text,'笔记版本 2');
 fail=true;await store.get(record,{refresh:true});result=await settle(store,record);assert.equal(result.status,'error');assert.equal(result.detail.notes.items[0].text,'笔记版本 2');
 const cached=JSON.parse(await readFile(path.join(dir,record.transId+'.json'),'utf8'));assert.equal(cached.updatedAt,200);assert.equal(cached.transId,record.transId);
 const restarted=createRecordingDetails({dir,now:()=>clock,read:()=>{throw Error('must not read');}});assert.equal((await restarted.get(record,{poll:true})).detail.notes.items[0].text,'笔记版本 2');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('recording start has priority; detail reads defer until idle and invalid IDs cannot access disk',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tingwu-details-'));let priority=true,count=0;
 try{const store=createRecordingDetails({dir,canRead:()=>!priority,read:async()=>{count++;return buildRecordingDetail(record,{lab,transcript,notes:notes()});}});
 assert.equal((await store.get(record)).status,'deferred');assert.equal(count,0);priority=false;await settle(store,record);assert.equal(count,1);
 await assert.rejects(()=>store.get({...record,transId:'../other'}),/无效录音/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('image-only notes are not mistaken for an empty note area',()=>{
 const ding=parseNotes({content:JSON.stringify(['root',{},['card',{name:'image',value:'private-image-reference'}]])});
 const lake=parseNotes({content:'<!doctype lake><card name="image" value="private-image-reference"></card>'});
 for(const d of [ding,lake]){assert.equal(d.status,'ready');assert.equal(d.attachments,1);assert.match(d.items[0].text,/在听悟查看/);assert.doesNotMatch(d.items[0].text,/private-image-reference/);}
});
