import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingDate,defaultTitle,stampFromRecord,reconcileSavedRecordings,prepareTitle,canAutoApply} from '../desktop/naming.mjs';
import {metadataFromLab,writeTitleWithAPI,validateRequest} from '../desktop/tingwu-api.mjs';
const url='https://tingwu.aliyun.com/doc/transcripts/example';
const record={url,transId:'example',title:'2026年11月13日 15:06 记录',status:0,recordedAt:1794553614000,duration:120,wordCount:200};
const candidate='2026-11-13｜15:06｜视频制作与封面设计';
test('Chinese date names and old classroom suffixes preserve the original time',()=>{
 assert.deepEqual(recordingDate(record.title),{date:'2026-11-13',time:'15:06'});
 assert.equal(defaultTitle(record.title),true);
 assert.deepEqual(recordingDate('2026-11-10 14:38下午上课 记录'),{date:'2026-11-10',time:'14:38'});
 assert.equal(defaultTitle('2026-11-10 14:38下午上课 记录'),false);
 assert.equal(recordingDate('2026年2月30日 15:06 记录'),null);
 assert.deepEqual(stampFromRecord('2026-11-09下午录音',1794210092000),{date:'2026-11-09',time:'15:41'});
});
test('saved-record scan discovers files even without a saved tab transition, once only',()=>{
 let s=reconcileSavedRecordings({enabled:true,mode:'auto',jobs:[]},[record],100);
 s=reconcileSavedRecordings(s,[record],200);
 assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].originalTitle,record.title);assert.equal(s.jobs[0].status,'waiting');
 assert.equal(s.jobs[0].recordedAt,record.recordedAt);
 assert.equal(reconcileSavedRecordings(s,[{...record,url:url+'2',title:'我自己起的名字'}],300).jobs.length,1);
});
test('old home-title snapshots and transient read failures recover without overwriting user edits',()=>{
 const s={jobs:[{id:'old',url,originalTitle:'首页',status:'attention',savedAt:1}]};
 const j=reconcileSavedRecordings(s,[record],100).jobs[0];assert.equal(j.originalTitle,record.title);assert.equal(j.status,'waiting');
 const edited=reconcileSavedRecordings({jobs:[{...j,status:'waiting'}]},[{...record,title:'用户自己修改的课程'}],200).jobs[0];
 assert.equal(edited.status,'attention');assert.equal(edited.currentTitle,'用户自己修改的课程');
 const skipped=reconcileSavedRecordings({jobs:[{...j,status:'skipped'}]},[record],200).jobs[0];assert.equal(skipped.status,'skipped');
});
test('an interrupted successful write is reconciled by the actual stored title',()=>{
 const s={jobs:[{id:'old',url,originalTitle:record.title,candidate,status:'attention',attemptedAt:1}]};
 assert.equal(reconcileSavedRecordings(s,[{...record,title:candidate}],100).jobs[0].status,'renamed');
 assert.equal(reconcileSavedRecordings(s,[record],130000).jobs[0].status,'draft');
 assert.equal(reconcileSavedRecordings(s,[{...record,title:'用户刚刚改的名字'}],130000).jobs[0].status,'attention');
});
test('API summary cards map to real keywords, whole summary and chapter titles',()=>{
 const card=(key,values)=>({key,status:0,contents:[{contentValues:values}]});
 const meta=metadataFromLab(record,record.title,{labCardsMap:{labInfo:[card('keyWordsExtractor',[{value:'视频'}])],labSummaryInfo:[card('fullSummary',[{value:'本次课程讲解视频制作。'}]),card('agendaSummary',[{title:'封面设计与比例',value:'使用不同的比例。'}])]}});
 assert.deepEqual(meta.summaryTexts,['关键词','视频','全文概要','本次课程讲解视频制作。','章节速览','00:00','封面设计与比例','使用不同的比例。']);
});
test('pending content remains retryable after an hour; empty recordings get an honest title',async()=>{
 const job={url,originalTitle:record.title,savedAt:0};
 const read=async()=>({url,title:record.title,summaryTexts:[],summaryStatuses:[0,0]});
 assert.equal((await prepareTitle(job,read,7200000)).status,'waiting');
 const empty=await prepareTitle(job,async()=>({...await read(),wordCount:0,duration:0}),7200000);
 assert.equal(empty.candidate,'2026-11-13｜15:06｜空录音（无有效内容）');
});
test('saved short recordings above 50 words complete automatic naming without a summary',async()=>{
 const short={...record,wordCount:129};
 const meta=metadataFromLab(short,short.title,{labCardsMap:{labSummaryInfo:[{key:'fullSummary',status:3},{key:'agendaSummary',status:3}]}});
 const job={url,originalTitle:short.title,savedAt:1000};
 assert.equal((await prepareTitle(job,async()=>meta,60000)).status,'waiting');
 const prepared=await prepareTitle(job,async()=>meta,61000);
 assert.equal(prepared.candidate,'2026-11-13｜15:06｜内容不足待补充主题');
 assert.equal(canAutoApply(prepared,{enabled:true,mode:'auto'}),true);
});
test('partial, loading, failed, and unknown summary states never trigger the short-content fallback',async()=>{
 const job={url,originalTitle:record.title,savedAt:0};
 for(const summaryStatuses of [[],[3],[3,1],[3,2],[3,5],[3,99],[0,3]]){
  const prepared=await prepareTitle(job,async()=>({url,title:record.title,summaryTexts:[],wordCount:129,summaryStatuses}),120000);
  assert.equal(prepared.status,'waiting',JSON.stringify(summaryStatuses));
  assert.equal(prepared.candidate,undefined);
 }
});
test('short-content fallback preserves user titles and uses usable summary content first',async()=>{
 const job={url,originalTitle:record.title,savedAt:0};
 const meta={url,title:record.title,wordCount:129,summaryStatuses:[3,3],summaryTexts:[]};
 assert.equal((await prepareTitle(job,async()=>({...meta,title:'我自己的标题'}),120000)).status,'attention');
 const prepared=await prepareTitle(job,async()=>({...meta,summaryTexts:['章节速览','00:00','儿童游戏观察与课堂活动设计']}),120000);
 assert.match(prepared.candidate,/儿童游戏观察与课堂活动设计$/);
});
test('title writes compare current value, change only showName, and re-read persistence',async()=>{
 let title=record.title;const calls=[];
 const request=async body=>{calls.push(body);if(body.action==='syncTransTag'){title=body.tag.showName;return {code:'0'};}return {data:{showName:title}};};
 const job={url,originalTitle:record.title,candidate};
 assert.deepEqual(await writeTitleWithAPI(job,request),{title:candidate,persisted:true});
 assert.deepEqual(calls.map(c=>c.action),['getTransTag','syncTransTag','getTransTag']);
 assert.deepEqual(calls[1].tag,{showName:candidate});
 calls.length=0;await writeTitleWithAPI(job,request);assert.deepEqual(calls.map(c=>c.action),['getTransTag']);
 await assert.rejects(()=>writeTitleWithAPI(job,async()=>({data:{showName:'用户新标题'}})),/已被修改/);
});
test('browser request bridge rejects unrelated actions and non-title mutations',()=>{
 assert.throws(()=>validateRequest({action:'stopMeeting',transId:'example'}),/不支持/);
 assert.throws(()=>validateRequest({action:'syncTransTag',transId:'example',tag:{showName:candidate,read:1}}),/只能更新/);
 assert.throws(()=>validateRequest({action:'getTransTag',transId:'../other'}),/编号/);
});
