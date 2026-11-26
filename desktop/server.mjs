import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {createLocalRecorder} from './local-recorder.mjs';
import {createLocalUploads} from './local-uploads.mjs';
import {createClassroom} from './classroom.mjs';
import {createNoteSync} from './note-sync.mjs';
import {showEndReminder} from './end-reminder.mjs';
import {createRecordingDeletion} from './recording-deletion.mjs';
import {spawn} from 'node:child_process';
import {DEFAULT_NAMING,reconcileSavedRecordings,prepareTitle,canAutoApply,applyTitle,validateCandidate,savedURL} from './naming.mjs';
import {listSavedRecordings} from './tingwu-api.mjs';
import {createRecordingLibrary} from './recording-library.mjs';
import {readRecordingDetail,withLocalNotes} from './recording-detail.mjs';
import {createRecordingDetails} from './recording-details-store.mjs';
import {recordingHasPriority,dailyRuns,keepDisplayAwake,SCHEDULE_POLL_MS} from './scheduler.mjs';
import {runScheduleCycle} from './schedule-runner.mjs';
import {connectionProblem} from './native-status.mjs';
import {ensureRecordingStarted,verifyRecordingHealth} from './recording-start.mjs';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DEFAULTS,validate,dueEvents,nextEvent,clockParts} from '../extension/schedule.js';
import {openTingwu,showTingwu,controlStatus,controlStep,notify,askEnd,askProblem,namingTabs,readNamingMetadata,writeRecordingTitle,openNamingRecord} from './chrome.mjs';
const PORT=Number(process.env.TINGWU_PORT || 18766), HOST='127.0.0.1', origin=`http://${HOST}:${PORT}`;
const root=fileURLToPath(new URL('..',import.meta.url));
const data=process.env.TINGWU_DATA_DIR || path.join(homedir(),'Library/Application Support/TingwuClassAssistant/data');
await mkdir(data,{recursive:true,mode:0o700});
const stateFile=path.join(data,'state.json');
let state;
try {state=JSON.parse(await readFile(stateFile,'utf8'));state.settings=validate(state.settings);} catch(e) {
 if(e.code!=='ENOENT') console.error('配置不可用，恢复暂停状态：',e.message);
 state={settings:{...DEFAULTS},completed:{},logs:[],connection:null};
}
state.naming??=structuredClone(DEFAULT_NAMING);
state.library??={records:[],updatedAt:null,error:null};
for(const j of state.naming.jobs){if(j.status==='applying'){j.status='attention';j.reason='上次改名期间服务中断，请检查听悟实际标题后重试。';}}
const preview=process.env.TINGWU_PREVIEW==='1';
const localEnabled=!preview&&(!process.env.TINGWU_DATA_DIR||!!process.env.TINGWU_LOCAL_RECORDER_APP);
const localDir=path.join(data,'local');
if(localEnabled)await mkdir(localDir,{recursive:true,mode:0o700});
const recorder=createLocalRecorder({dir:localDir,app:process.env.TINGWU_LOCAL_RECORDER_APP||path.join(root,'native/听课搭子录音.app'),enabled:localEnabled});
const classroom=createClassroom({dir:path.join(localDir,'Classrooms'),recorder,executable:path.join(root,'native/tingwu-live-transcriber'),enabled:localEnabled});
let deletions;
const uploads=createLocalUploads({dir:localDir,recorder,log,withAudioCleanup:classroom.withAudioCleanup,isSuppressed:id=>deletions?.suppressed(id),isDeleted:id=>deletions?.deleted(id),deletionWarning:id=>deletions?.warning(id),canUpload:()=>!busy&&!ticking&&!namingBusy&&!library.busy&&!details.busy&&!recordingHasPriority(state.settings,state.completed),onUploaded:async()=>{await library.refresh();}});
deletions=await createRecordingDeletion({dir:localDir,recorder,uploads});
state.library.records=deletions.cachedRecords(state.library.records,state.library.updatedAt);
const namingAllowed=job=>!deletions.suppressed(null,job.url?.split('/').filter(Boolean).at(-1));
state.naming.jobs=state.naming.jobs.filter(namingAllowed);
let namingBusy=false;
let writeQueue=Promise.resolve();
function save(){const snapshot=JSON.stringify(state,null,2);writeQueue=writeQueue.catch(()=>{}).then(async()=>{await writeFile(stateFile+'.tmp',snapshot,{mode:0o600});await rename(stateFile+'.tmp',stateFile);});return writeQueue;}
const library=createRecordingLibrary({read:async()=>deletions.records(await listSavedRecordings()),get:()=>state.library,set:value=>state.library=value,save});
const details=createRecordingDetails({dir:path.join(data,'recording-details'),read:readRecordingDetail,canRead:()=>!busy&&!ticking&&!namingBusy&&!library.busy&&!recordingHasPriority(state.settings,state.completed)});
async function log(message,level='info'){state.logs=[{time:Date.now(),message,level},...(state.logs||[])].slice(0,80);await save();}
const noteSync=createNoteSync({dir:localDir,classroom,uploads,isSuppressed:id=>deletions.suppressed(id),canSync:()=>!busy&&!ticking&&!namingBusy&&!library.busy&&!details.busy&&!uploads.busy&&!recordingHasPriority(state.settings,state.completed)});
const token=randomBytes(32).toString('hex');
let busy=false,stopping=false,awakeProcess=null,displayProcess=null;
const runtime={startedAt:Date.now(),lastTickAt:null,tickFinishedAt:null,schedulePollMs:SCHEDULE_POLL_MS};
function syncAwake(){
 if(!preview && state.settings.enabled && !awakeProcess){
  awakeProcess=spawn('/usr/bin/caffeinate',['-i','-s','-w',String(process.pid)],{stdio:'ignore'});
  awakeProcess.once('error',e=>{awakeProcess=null;console.error('防休眠不可用：'+e.message);});
  awakeProcess.once('exit',()=>{awakeProcess=null;});
 }else if(!state.settings.enabled && awakeProcess){awakeProcess.kill();awakeProcess=null;}
 if(!preview && !localEnabled && keepDisplayAwake(state.settings) && !displayProcess){
  displayProcess=spawn('/usr/bin/caffeinate',['-d','-w',String(process.pid)],{stdio:'ignore'});
  displayProcess.once('error',()=>{displayProcess=null;});displayProcess.once('exit',()=>{displayProcess=null;});
 }else if((localEnabled||!keepDisplayAwake(state.settings)) && displayProcess){displayProcess.kill();displayProcess=null;}
}
process.on('SIGTERM',()=>{awakeProcess?.kill();displayProcess?.kill();process.exit(0);});
process.on('SIGINT',()=>{awakeProcess?.kill();displayProcess?.kill();process.exit(0);});
async function check(){
 try {const status=await controlStatus();const error=connectionProblem(status);state.connection={...status,checkedAt:Date.now(),ok:!error,...(error?{error}:{})};}
 catch(e){state.connection={ok:false,error:e.message,checkedAt:Date.now()};}
 return state.connection;
}
async function startRecording(attemptId=null,deadline=Infinity){
 if(busy)throw Error('正在处理录音任务，请稍候');
 busy=true;
 try{const result=await recorder.start(attemptId,deadline);await log(result.message);return result;}
 finally{busy=false;}
}
async function verifyScheduledRecording(){return recorder.health();}
async function reminder(){
 await showEndReminder({onError:error=>log('下课提醒窗口发生错误：'+error.message,'warning').catch(()=>{})});
 await log('已请求显示下课提醒窗口，请手动结束录音');
 return {message:'已请求显示下课提醒，请在听课搭子手动结束并上传'};
}
let ticking=false;
async function tick(){
 runtime.lastTickAt=Date.now();syncAwake();
 if(preview || ticking || busy || namingBusy)return;
 ticking=true;
 try{
  await runScheduleCycle({state,save,start:startRecording,remind:reminder,log,
   cancelled:()=>!state.settings.enabled || stopping,
   verifyRecording:verifyScheduledRecording,
   preflight:()=>recorder.preflight(),
   notice:async(message,urgent)=>{await notify(urgent?'听课搭子：录音尚未确认':'听课搭子：自动录音需要检查',message);}
  });
 }catch(e){console.error(e.message);}finally{ticking=false;runtime.tickFinishedAt=Date.now();}
}
async function storeNamingJob(job){
 state.naming.jobs=[job,...state.naming.jobs.filter(j=>j.id!==job.id)];await save();
}
async function commitNamingJob(job){
 if(!namingAllowed(job))throw Error('该录音已删除或删除结果待核对，已暂停命名');
 const result=await applyTitle(job,{write:writeRecordingTitle,save:storeNamingJob});
 await log(result.status==='renamed'?'录音已自动命名：'+result.candidate:result.reason,result.status==='renamed'?'info':'warning');
 if(result.status==='renamed'){
  const record=state.library.records.find(r=>r.url===result.url);
  if(record){record.title=result.candidate;await save();}
  await notify('课堂录音已命名',result.candidate);
 }
 return result;
}
async function monitorNaming(){
 if(preview || busy || ticking || namingBusy || library.busy || details.busy || !state.naming.enabled || recordingHasPriority(state.settings,state.completed))return;
 namingBusy=true;
 try{
  // Defer naming while a live/paused recording page is open.
  const current=await controlStatus();if(current.ongoing || current.path==='/doc/record')return;
  if(Date.now()-(state.naming.lastScannedAt||0)>=60000)state.naming=reconcileSavedRecordings(state.naming,(await library.refresh()).filter(r=>!deletions.suppressed(null,r.transId)));
  state.naming.lastCheckedAt=Date.now();delete state.naming.error;await save();
  const pending=state.naming.jobs.filter(j=>j.status==='waiting' && Date.now()-(j.checkedAt||0)>60000).sort((a,b)=>(a.checkedAt||0)-(b.checkedAt||0))[0];
  if(pending){
   await storeNamingJob({...pending,checkedAt:Date.now()});const prepared=await prepareTitle(pending,readNamingMetadata);await storeNamingJob(prepared);
  }
  const ready=state.naming.jobs.find(j=>canAutoApply(j,state.naming));
  if(ready && !recordingHasPriority(state.settings,state.completed))await commitNamingJob(ready);
 }catch(e){state.naming.error=e.message;await save();}
 finally{namingBusy=false;}
}
const files={'/':'index.html','/style.css':'style.css','/app.js':'app.js','/classroom-ui.js':'classroom-ui.js','/deletion-ui.js':'deletion-ui.js','/icon.png':'../extension/icon.png'};
function respond(res,code,body,type='application/json'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`${HOST}:${PORT}`)return respond(res,403,{error:'invalid host'});
  const url=new URL(req.url,origin);
  if(req.method==='GET' && url.pathname==='/api/status')return respond(res,200,{...state,busy,keepAwake:!!awakeProcess,keepDisplayAwake:!!displayProcess,next:nextEvent(state.settings),version:'0.16.3',local:{...await recorder.status(),uploads:await uploads.status()},runtime:{...runtime,busy,ticking,namingBusy,libraryBusy:library.busy,detailBusy:details.busy},sessions:dailyRuns(state.settings,state),mode:'desktop',preview});
  if(req.method==='GET' && /^\/api\/local-audio\/[a-zA-Z0-9-]{1,80}$/.test(url.pathname)){
   if(url.searchParams.get('token')!==token)return respond(res,403,{error:'下载权限无效，请刷新页面'});
   const id=url.pathname.split('/').at(-1),record=(await recorder.records()).find(r=>r.id===id&&['saved','interrupted'].includes(r.status));
   if(!record)return respond(res,404,{error:'没有已保存的音频'});
   if((await uploads.forLocal(id))?.audioRemovedAt)return respond(res,410,{error:'音频已存听悟，本机临时文件已清理，请在听悟回放'});
   const info=await stat(record.file);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':info.size,'Content-Disposition':`attachment; filename="${id}.wav"`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
   const stream=createReadStream(record.file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
  }
  if(req.method==='POST' && url.pathname.startsWith('/api/')){
   if(req.headers.origin!==origin || req.headers['x-tingwu-token']!==token || req.headers['content-type']!=='application/json')return respond(res,403,{error:'请求来源无效'});
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>(url.pathname==='/api/classroom-notes'?650000:16384))return respond(res,413,{error:'请求过大'});chunks.push(c);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');let result;
   if(preview)throw Error('这是审查预览，不会修改听悟录音或正式设置');
   if(['/api/recording-delete-prepare','/api/recording-delete'].includes(url.pathname)){
    if(busy||ticking||namingBusy||library.busy||details.busy||uploads.busy||noteSync.busy||recordingHasPriority(state.settings,state.completed))throw Error('正在处理课堂任务，请稍后再删除');
    busy=true;let removed=null;
    try{
     const result=url.pathname.endsWith('-prepare')?await deletions.prepare(body):await deletions.remove(body);
     if(!url.pathname.endsWith('-prepare'))removed=result;
     return respond(res,200,{ok:true,result});
    }finally{
     state.library.records=deletions.records(state.library.records.filter(r=>r.transId!==removed?.transId));
     state.naming.jobs=state.naming.jobs.filter(namingAllowed);
     try{await save();}finally{busy=false;}
    }
   }
   if(['/api/classroom','/api/classroom-notes','/api/classroom-sync','/api/local-retry'].includes(url.pathname)&&(deletions.busy||deletions.suppressed(body.id)))throw Error('这条录音已删除或正在核对删除结果，请返回录音列表');
   if(url.pathname==='/api/classroom'){const result=await classroom.get(body.id);result.noteSync=await noteSync.status(body.id);return respond(res,200,{ok:true,result});}
   if(url.pathname==='/api/classroom-notes'){const result=await classroom.saveNotes(body.id,body);result.noteSync=await noteSync.queue(body.id);return respond(res,200,{ok:true,result});}
   if(url.pathname==='/api/classroom-sync'){await classroom.notes(body.id);return respond(res,200,{ok:true,result:await noteSync.retry(body.id,{merge:body.merge===true})});}
   // Stopping is always available, even while naming/upload/schedule checks run.
   if(url.pathname==='/api/local-stop'){
    await recorder.stop(body.id);
    for(const run of Object.values(state.sessionRuns||{}))if(run.recordId===body.id){run.manuallyEndedAt=Date.now();run.health={status:'ended',message:'已由你手动结束并保存',checkedAt:Date.now()};}
    await save();await uploads.discover();uploads.tick().catch(e=>log(e.message,'warning'));
    return respond(res,200,{ok:true,result:{message:'录音已临时保存，正在上传听悟；确认成功后自动清理本机音频'}});
   }
   if(url.pathname==='/api/local-permission')return respond(res,200,{ok:true,result:await recorder.permission()});
   if(url.pathname==='/api/local-retry')return respond(res,200,{ok:true,result:await uploads.retry(body.id)});
   if(url.pathname==='/api/recording-detail'){
    const record=state.library.records.find(r=>r.transId===body.transId);
    if(!record)return respond(res,404,{error:'录音不在已同步的列表中，请先刷新列表'});
    const result=await details.get(record,{refresh:body.refresh===true,poll:body.poll===true}),localId=await uploads.localIdFor(record.transId);
    if(result.detail&&localId&&!deletions.suppressed(localId))result.detail={...withLocalNotes(result.detail,await classroom.notes(localId),await noteSync.syncedText(localId)),localRecordId:localId};
    return respond(res,200,{ok:true,result});
   }
   if(url.pathname==='/api/recordings-refresh'){
    const deferred=busy || ticking || namingBusy || details.busy || recordingHasPriority(state.settings,state.completed);
    if(!deferred)library.refresh().catch(()=>{});
    return respond(res,200,{ok:true,result:{deferred,refreshing:library.busy}});
   }
   if((busy || ticking || namingBusy) && !(url.pathname==='/api/save' && body.settings?.enabled===false))throw Error('正在处理听悟任务，请稍后重试');
   switch(url.pathname){
    case '/api/naming-toggle':
     if(typeof body.enabled!=='boolean')throw Error('开关参数无效');
     state.naming.enabled=body.enabled;state.naming.mode='auto';await save();result={message:body.enabled?'已开启保存后自动命名':'自动命名已关闭'};break;
    case '/api/naming-inspect':
     if(busy || ticking)throw Error('正在处理课表任务，请稍候');
     namingBusy=true;
     try{
      if(!body.id){
       const records=await library.refresh();state.naming=reconcileSavedRecordings(state.naming,records.filter(r=>!deletions.suppressed(null,r.transId)));await save();
       result={message:`已核对 ${records.length} 条已保存记录，${state.naming.jobs.filter(j=>j.status==='waiting').length} 条等待命名`};break;
      }
      const job=state.naming.jobs.find(j=>j.id===body.id);
      if(!job)throw Error('未找到指定录音');
      if(!job.url)throw Error('尚未确认保存，请先打开已保存的录音详情');
      if(job.status==='renamed'){result={message:'该录音已完成命名'};break;}
      const prepared=await prepareTitle({...job,reviewOnly:true,savedAt:Date.now()},readNamingMetadata);await storeNamingJob(prepared);
      result={message:prepared.candidate?'已生成标题候选，可在下方审查':prepared.reason};
     }finally{namingBusy=false;}break;
    case '/api/naming-apply':
     if(busy || ticking)throw Error('正在处理课表任务，请稍候');
     const job=state.naming.jobs.find(j=>j.id===body.id);
     if(!job?.url || !['draft','attention'].includes(job.status))throw Error('当前记录不支持改名');
     const candidate=validateCandidate(body.candidate,job.originalTitle);
     namingBusy=true;
     try{const done=await commitNamingJob({...job,candidate});result={message:done.reason};}finally{namingBusy=false;}break;
    case '/api/naming-open':
     const selected=state.naming.jobs.find(j=>j.id===body.id);
     if(!selected?.url)throw Error('尚未确认录音已保存');
     await openNamingRecord(selected);result={message:'已打开对应听悟录音'};break;
    case '/api/naming-skip':
     const skipped=state.naming.jobs.find(j=>j.id===body.id);
     if(!skipped || ['applying','renamed'].includes(skipped.status))throw Error('该记录不能跳过');
     await storeNamingJob({...skipped,status:'skipped',reason:'本条录音保留原标题。'});result={message:'已保留原标题'};break;
    case '/api/save':
     const updated=validate(body.settings);if(updated.enabled)await recorder.preflight();state.settings=updated;stopping=!state.settings.enabled;await save();syncAwake();result={message:state.settings.enabled?'自动课表已启用':'课表已暂停，已有录音保持不变'};await log(result.message);break;
    case '/api/open':await showTingwu();result={message:'已打开听悟，使用 Chrome 保存的登录状态'};break;
    case '/api/check':result=await check();break;
    case '/api/start':result=await startRecording();break;
    case '/api/remind':result=await reminder();break;
    default:return respond(res,404,{error:'not found'});
   }
   return respond(res,200,{ok:true,result});
  }
  if(req.method==='GET' && files[url.pathname]){
   let body=await readFile(new URL(files[url.pathname],import.meta.url));
   if(url.pathname==='/')body=Buffer.from(body.toString().replace('TOKEN_PLACEHOLDER',token));
   const type=url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.png')?'image/png':'text/html; charset=utf-8';
   return respond(res,200,body,type);
  }
  respond(res,404,{error:'not found'});
 }catch(e){respond(res,e.statusCode||400,{error:e.message});}
});
server.on('error',e=>{console.error(e);process.exit(1);});
server.listen(PORT,HOST,()=>console.log('听课搭子已启动：'+origin));
await save();syncAwake();
setInterval(tick,SCHEDULE_POLL_MS);
if(!preview)setTimeout(tick,500);
if(!preview){setTimeout(monitorNaming,1500);setInterval(monitorNaming,15000);}
// On startup or wake, retry an unconfirmed session only inside its weekday class window.

if(localEnabled){recorder.ensure().catch(e=>log(e.message,'warning'));setTimeout(()=>uploads.tick().catch(()=>{}),4000);setInterval(()=>uploads.tick().catch(()=>{}),10000);}
if(localEnabled){setTimeout(()=>classroom.monitor().catch(()=>{}),2000);setInterval(()=>classroom.monitor().catch(()=>{}),4000);}

if(localEnabled){setTimeout(()=>noteSync.tick().catch(()=>{}),5000);setInterval(()=>noteSync.tick().catch(()=>{}),10000);}
