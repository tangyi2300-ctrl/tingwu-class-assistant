import http from 'node:http';
import {spawn} from 'node:child_process';
import {DEFAULT_NAMING,reconcileSavedRecordings,prepareTitle,canAutoApply,applyTitle,validateCandidate,savedURL} from './naming.mjs';
import {listSavedRecordings} from './tingwu-api.mjs';
import {recordingHasPriority,dailyRuns,keepDisplayAwake} from './scheduler.mjs';
import {runScheduleCycle} from './schedule-runner.mjs';
import {recordingAdvanced,connectionProblem} from './native-status.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DEFAULTS,validate,dueEvents,nextEvent,clockParts} from '../extension/schedule.js';
import {openTingwu,showTingwu,controlStatus,controlStep,notify,askEnd,askProblem,namingTabs,readNamingMetadata,writeRecordingTitle,openNamingRecord} from './chrome.mjs';
const PORT=Number(process.env.TINGWU_PORT || 18766), HOST='127.0.0.1', origin=`http://${HOST}:${PORT}`;
const root=path.resolve(new URL('..',import.meta.url).pathname);
const data=process.env.TINGWU_DATA_DIR || path.join(homedir(),'Library/Application Support/TingwuClassAssistant/data');
await mkdir(data,{recursive:true,mode:0o700});
const stateFile=path.join(data,'state.json');
let state;
try {state=JSON.parse(await readFile(stateFile,'utf8'));state.settings=validate(state.settings);} catch(e) {
 if(e.code!=='ENOENT') console.error('配置不可用，恢复暂停状态：',e.message);
 state={settings:{...DEFAULTS},completed:{},logs:[],connection:null};
}
state.naming??=structuredClone(DEFAULT_NAMING);
for(const j of state.naming.jobs){if(j.status==='applying'){j.status='attention';j.reason='上次改名期间服务中断，请检查听悟实际标题后重试。';}}
const preview=process.env.TINGWU_PREVIEW==='1';
let namingBusy=false;
let writeQueue=Promise.resolve();
function save(){const snapshot=JSON.stringify(state,null,2);writeQueue=writeQueue.catch(()=>{}).then(async()=>{await writeFile(stateFile+'.tmp',snapshot,{mode:0o600});await rename(stateFile+'.tmp',stateFile);});return writeQueue;}
async function log(message,level='info'){state.logs=[{time:Date.now(),message,level},...(state.logs||[])].slice(0,80);await save();}
const token=randomBytes(32).toString('hex');
let busy=false,stopping=false,awakeProcess=null,displayProcess=null;
const runtime={startedAt:Date.now(),lastTickAt:null,tickFinishedAt:null};
function syncAwake(){
 if(!preview && state.settings.enabled && !awakeProcess){
  awakeProcess=spawn('/usr/bin/caffeinate',['-i','-s','-w',String(process.pid)],{stdio:'ignore'});
  awakeProcess.once('error',e=>{awakeProcess=null;console.error('防休眠不可用：'+e.message);});
  awakeProcess.once('exit',()=>{awakeProcess=null;});
 }else if(!state.settings.enabled && awakeProcess){awakeProcess.kill();awakeProcess=null;}
 if(!preview && keepDisplayAwake(state.settings) && !displayProcess){
  displayProcess=spawn('/usr/bin/caffeinate',['-d','-w',String(process.pid)],{stdio:'ignore'});
  displayProcess.once('error',()=>{displayProcess=null;});displayProcess.once('exit',()=>{displayProcess=null;});
 }else if(!keepDisplayAwake(state.settings) && displayProcess){displayProcess.kill();displayProcess=null;}
}
process.on('SIGTERM',()=>{awakeProcess?.kill();displayProcess?.kill();process.exit(0);});
process.on('SIGINT',()=>{awakeProcess?.kill();displayProcess?.kill();process.exit(0);});
async function check(){
 try {const status=await controlStatus();const error=connectionProblem(status);state.connection={...status,checkedAt:Date.now(),ok:!error,...(error?{error}:{})};}
 catch(e){state.connection={ok:false,error:e.message,checkedAt:Date.now()};}
 return state.connection;
}
async function startRecording(attemptId=null,deadline=Infinity){
 if(busy || namingBusy)throw Error('正在处理听悟任务，请稍候');
 busy=true;stopping=false;
 const until=Math.min(deadline,Date.now()+90000);
 let previous=null,lastError=null;
 try {
  await openTingwu();
  const id=attemptId || randomBytes(12).toString('hex');
  while(Date.now()<until){
   if(stopping)return {cancelled:true};
   let result;
   try{result=await controlStep(id,until);lastError=null;}
   catch(e){lastError=e;await new Promise(r=>setTimeout(r,1500));continue;}
   if(result.action==='ongoing'){
    state.connection={...result,ok:!connectionProblem(result),error:connectionProblem(result)||undefined,checkedAt:Date.now()};
    if(result.paused)throw Error('已有录音处于暂停状态，请手动恢复；不会把暂停当作录音成功');
    if(recordingAdvanced(previous,result)){
     const message='已核对听悟录音计时持续增加，请在下课时手动结束';
     if(!attemptId)await log(message);
     await notify('听悟已开始录音',message);
     return {message,confirmed:true,elapsedSeconds:result.elapsedSeconds};
    }
    previous=result;
   }else{
    previous=null;
    if(result.action==='login-required')throw Error('听悟登录已失效，请在 Chrome 完成登录验证；恢复后会在课内自动重试');
    if(result.action==='clicked')await log('已自动点击「'+result.label+'」，正在核对录音计时');
   }
   await new Promise(r=>setTimeout(r,1000));
  }
  throw lastError || Error('尚未确认录音计时持续增加，将重新定位后重试');
 }catch(e){if(!attemptId){await log(e.message,'warning');await notify('录音需要处理',e.message);}throw e;}
 finally{busy=false;}
}
async function reminder(){
 await log('已询问是否结束录音；未执行停止操作');
 await notify('下课了，现在结束录音吗？','请在通义听悟中亲自结束录音。');
 askEnd().catch(e=>log('提醒窗口：'+e.message,'warning'));
 return {message:'已显示下课询问，录音由你本人结束'};
}
let ticking=false;
async function tick(){
 runtime.lastTickAt=Date.now();syncAwake();
 if(preview || ticking || busy || namingBusy)return;
 ticking=true;
 try{
  await runScheduleCycle({state,save,start:startRecording,remind:reminder,log,
   cancelled:()=>!state.settings.enabled || stopping,
   preflight:async()=>{await openTingwu();const c=await check();const problem=connectionProblem(c);if(problem)throw Error(problem);},
   notice:async(message,urgent)=>{await notify(urgent?'听课搭子：录音尚未确认':'听课搭子：自动录音需要检查',message);}
  });
 }catch(e){console.error(e.message);}finally{ticking=false;runtime.tickFinishedAt=Date.now();}
}
async function storeNamingJob(job){
 state.naming.jobs=[job,...state.naming.jobs.filter(j=>j.id!==job.id)];await save();
}
async function commitNamingJob(job){
 const result=await applyTitle(job,{write:writeRecordingTitle,save:storeNamingJob});
 await log(result.status==='renamed'?'录音已自动命名：'+result.candidate:result.reason,result.status==='renamed'?'info':'warning');
 if(result.status==='renamed')await notify('课堂录音已命名',result.candidate);
 return result;
}
async function monitorNaming(){
 if(preview || busy || ticking || namingBusy || !state.naming.enabled || recordingHasPriority(state.settings,state.completed))return;
 namingBusy=true;
 try{
  // Defer naming while a live/paused recording page is open.
  const current=await controlStatus();if(current.ongoing || current.path==='/doc/record')return;
  if(Date.now()-(state.naming.lastScannedAt||0)>=60000)state.naming=reconcileSavedRecordings(state.naming,await listSavedRecordings());
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
const files={'/':'index.html','/style.css':'style.css','/app.js':'app.js','/icon.png':'../extension/icon.png'};
function respond(res,code,body,type='application/json'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`${HOST}:${PORT}`)return respond(res,403,{error:'invalid host'});
  const url=new URL(req.url,origin);
  if(req.method==='GET' && url.pathname==='/api/status')return respond(res,200,{...state,busy,keepAwake:!!awakeProcess,keepDisplayAwake:!!displayProcess,next:nextEvent(state.settings),version:'0.8.1',runtime:{...runtime,busy,ticking,namingBusy},sessions:dailyRuns(state.settings,state),mode:'desktop',preview});
  if(req.method==='POST' && url.pathname.startsWith('/api/')){
   if(req.headers.origin!==origin || req.headers['x-tingwu-token']!==token || req.headers['content-type']!=='application/json')return respond(res,403,{error:'请求来源无效'});
   let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return respond(res,413,{error:'请求过大'});}
   const body=JSON.parse(raw||'{}');let result;
   if(preview)throw Error('这是审查预览，不会修改听悟录音或正式设置');
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
       const records=await listSavedRecordings();state.naming=reconcileSavedRecordings(state.naming,records);await save();
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
     const updated=validate(body.settings);if(updated.enabled){const c=await check();if(!c.ok || c.loginRequired || c.noTab || c.browserClosed || (!c.homeReady && !c.ongoing && !c.path?.startsWith('/doc/')))throw Error(c.error || '请先打开听悟并登录，完成连接检查后再启用');}state.settings=updated;stopping=!state.settings.enabled;await save();syncAwake();result={message:state.settings.enabled?'自动课表已启用':'课表已暂停，已有录音保持不变'};await log(result.message);break;
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
 }catch(e){respond(res,400,{error:e.message});}
});
server.on('error',e=>{console.error(e);process.exit(1);});
server.listen(PORT,HOST,()=>console.log('听课搭子已启动：'+origin));
await save();syncAwake();
setInterval(tick,10000);
if(!preview)setTimeout(tick,500);
if(!preview){setTimeout(monitorNaming,1500);setInterval(monitorNaming,15000);}
// On startup or wake, retry an unconfirmed session only inside its weekday class window.
