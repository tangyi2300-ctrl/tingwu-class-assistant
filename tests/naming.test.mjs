import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingDate,defaultTitle,savedURL,titleFromMetadata,observeRecordings,prepareTitle,canAutoApply,validateCandidate,applyTitle} from '../desktop/naming.mjs';
const url='https://tingwu.aliyun.com/doc/transcripts/example',title='2026-01-12 10:00 记录';
const summary=['关键词','项目规划','任务','协作','全文概要','收起','本次课程讲解了项目规划与任务拆解，包括目标定义、优先级和团队分工。示例介绍了使用Excel整理任务清单，并通过看板持续跟踪团队的执行进度。','章节速览','00:00','项目目标定义与任务分解方法','介绍了如何把项目目标拆成可执行的任务。'];
const meta={url,title,summaryTexts:summary};
const job={id:'test',url,originalTitle:title,status:'waiting',savedAt:100};
test('dates use the original recording and reject impossible dates',()=>{
 assert.deepEqual(recordingDate(title),{date:'2026-01-12',time:'10:00'});
 for(const t of ['2026-02-30 10:00 记录','2026-13-01 10:00 记录','2026-01-12 24:00 记录','我的课程'])assert.equal(recordingDate(t),null);
 assert.equal(defaultTitle(title),true);assert.equal(defaultTitle('2026-01-12 10:00 我自己命名'),false);
});
test('summary style becomes a whole-recording topic, not incidental keywords',()=>{
 const result=titleFromMetadata(meta,title);
 assert.equal(result.candidate,'2026-01-12｜10:00｜项目规划与任务拆解（Excel）');
 assert.equal(result.status,'draft');assert.equal(result.customTitle,false);
});
test('missing or short content does not invent a topic',()=>{
 assert.equal(titleFromMetadata({summaryTexts:['章节速览']},title).status,'waiting');
 assert.equal(titleFromMetadata({summaryTexts:['全文概要','抱歉，全文内容太短了，无总结内容哦']},title).status,'attention');
 assert.equal(titleFromMetadata(meta,'我自己起的名字').status,'attention');
});
test('a real chapter title is a fallback when no full overview is available',()=>{
 const r=titleFromMetadata({summaryTexts:['章节速览','00:00','儿童游戏观察与课堂活动设计']},title);
 assert.equal(r.candidate,'2026-01-12｜10:00｜儿童游戏观察与课堂活动设计');
});
test('saved-document identity rejects foreign domains and recording pages',()=>{
 for(const u of ['javascript:alert(1)','https://tingwu.aliyun.com.evil.test/doc/transcripts/a','https://tingwu.aliyun.com/doc/record'])assert.equal(savedURL(u),null);
 assert.equal(savedURL(url+'?view=1'),url);
});
test('recordings are followed by exact tab, then deduplicated by saved URL',()=>{
 const t={tabId:1,windowId:1,url:'https://tingwu.aliyun.com/doc/record',title};
 let s=observeRecordings(null,[t],100);
 assert.equal(s.jobs[0].status,'recording');
 s=observeRecordings(JSON.parse(JSON.stringify(s)),[t,{...t,tabId:2,url}],200);
 assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].status,'recording');
 s=observeRecordings(s,[{...t,url}],300);assert.equal(s.jobs[0].url,url);assert.equal(s.jobs[0].status,'waiting');
 assert.equal(observeRecordings(s,[{...t,url}],400).jobs.length,1);
 s=observeRecordings(s,[t],500);s=observeRecordings(s,[{...t,url}],600);assert.equal(s.jobs.length,1);
});
test('closing a recording never counts as a saved file',()=>{
 const s=observeRecordings(null,[{tabId:1,windowId:1,url:'https://tingwu.aliyun.com/doc/record',title}],100);
 const closed=observeRecordings(s,[],200);assert.equal(closed.jobs[0].status,'attention');assert.equal(closed.jobs[0].url,undefined);
});
test('title changed by the user or a wrong document blocks preparation',async()=>{
 const r=await prepareTitle(job,async()=>({...meta,title:'我的课堂'}));assert.equal(r.status,'attention');assert.equal(r.candidate,undefined);
 await assert.rejects(()=>prepareTitle(job,async()=>({...meta,url:url+'wrong'})),/对应/);
});
test('custom titles and explicit previews cannot be auto-applied',()=>{
 const p={...job,...titleFromMetadata(meta,title)};
 assert.equal(canAutoApply(p,{enabled:true,mode:'auto'}),true);
 for(const changes of [{customTitle:true},{reviewOnly:true},{status:'attention'}])assert.equal(canAutoApply({...p,...changes},{enabled:true,mode:'auto'}),false);
 assert.equal(canAutoApply(p,{enabled:false,mode:'auto'}),false);
});
test('edited candidates preserve recording date and time',()=>{
 assert.equal(validateCandidate('2026-01-12｜10:00｜账号定位与选题',title),'2026-01-12｜10:00｜账号定位与选题');
 for(const value of ['2026-01-13｜10:00｜账号定位','2026-01-12｜11:00｜账号定位','2026-01-12｜10:00｜','2026-01-12｜10:00｜注入\n新行'])assert.throws(()=>validateCandidate(value,title));
});
test('intent is durable before write; successful save requires reload confirmation',async()=>{
 const p={...job,...titleFromMetadata(meta,title)},events=[];
 const result=await applyTitle(p,{save:async j=>events.push(j.status),write:async j=>{assert.deepEqual(events,['applying']);return {title:j.candidate,persisted:true};}});
 assert.deepEqual(events,['applying','renamed']);assert.equal(result.status,'renamed');
});
test('a visible input or write failure is not reported as a persisted rename',async()=>{
 const p={...job,...titleFromMetadata(meta,title)};
 for(const write of [async()=>({title:p.candidate,persisted:false}),async()=>{throw Error('连接中断');}]){
  const states=[];const r=await applyTitle(p,{write,save:async j=>states.push(j.status)});assert.equal(r.status,'attention');assert.deepEqual(states,['applying','attention']);assert.equal(canAutoApply(r,{enabled:true,mode:'auto'}),false);
 }
});
