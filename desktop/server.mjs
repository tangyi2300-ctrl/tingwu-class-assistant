import http from 'node:http';
import {spawn} from 'node:child_process';
import {runnableEvents,preflightEvents,startDeadline} from './scheduler.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DEFAULTS,validate,dueEvents,nextEvent,clockParts} from '../extension/schedule.js';
import {openTingwu,controlStatus,controlStep,notify,askEnd} from './chrome.mjs';
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
let writeQueue=Promise.resolve();
function save(){const snapshot=JSON.stringify(state,null,2);writeQueue=writeQueue.catch(()=>{}).then(async()=>{await writeFile(stateFile+'.tmp',snapshot,{mode:0o600});await rename(stateFile+'.tmp',stateFile);});return writeQueue;}
async function log(message,level='info'){state.logs=[{time:Date.now(),message,level},...(state.logs||[])].slice(0,80);await save();}
const token=randomBytes(32).toString('hex');
let busy=false,stopping=false,awakeProcess=null;
function syncAwake(){
 if(state.settings.enabled && !awakeProcess){
  awakeProcess=spawn('/usr/bin/caffeinate',['-i','-s','-w',String(process.pid)],{stdio:'ignore'});
  awakeProcess.once('error',e=>{awakeProcess=null;console.error('防休眠不可用：'+e.message);});
  awakeProcess.once('exit',()=>{awakeProcess=null;});
 }else if(!state.settings.enabled && awakeProcess){awakeProcess.kill();awakeProcess=null;}
}
process.on('SIGTERM',()=>{awakeProcess?.kill();process.exit(0);});
process.on('SIGINT',()=>{awakeProcess?.kill();process.exit(0);});
async function check(){
 try {const status=await controlStatus();state.connection={...status,checkedAt:Date.now(),ok:true};}
 catch(e){state.connection={ok:false,error:e.message,checkedAt:Date.now()};}
 return state.connection;
}
async function startRecording(attemptId=null,deadline=Infinity){
 if(busy)throw Error('正在处理启动，请稍候');
 busy=true;stopping=false;
 try {
  await openTingwu();
  const id=attemptId || randomBytes(12).toString('hex');
  for(let i=0;i<45;i++){
   if(Date.now()>=deadline)throw Error('已到课前启动截止时间，不再补开录音，请手动检查听悟');
   if(stopping){await log('已取消尚未完成的自动启动；已有录音未被停止');return;}
   let result;
   try {result=await controlStep(id,deadline);}
   catch(e){if(i<3 && !/允许 Apple|未授权|not authorized/.test(e.message)){await new Promise(r=>setTimeout(r,1000));continue;}throw e;}
   if(result.action==='ongoing'){
    state.connection={...result,ok:true,checkedAt:Date.now()};
    const message=result.paused?'检测到已有录音处于暂停状态，请在听悟手动恢复':'已确认听悟显示录音中，保留本次录音；请在下课时手动结束';
    await log(message);await notify('听悟录音检查',message);return {message};
   }
   if(result.action==='login-required')throw Error('听悟登录已失效。请在 Chrome 完成登录验证；登录有效后可自动进入并录制');
   if(result.action==='clicked')await log('已自动点击「'+result.label+'」');
   await new Promise(r=>setTimeout(r,850));
  }
  throw Error('未确认录音启动，请在听悟页面检查麦克风权限和开始录音按钮');
 } catch(e){await log(e.message,'warning');await notify('录音需要你处理',e.message);throw e;}
 finally {busy=false;}
}
async function reminder(){
 await log('已询问是否结束录音；未执行停止操作');
 await notify('下课了，现在结束录音吗？','请在通义听悟中亲自结束录音。');
 askEnd().catch(e=>log('提醒窗口：'+e.message,'warning'));
 return {message:'已显示下课询问，录音由你本人结束'};
}
let ticking=false;
async function tick(){
 if(ticking || busy)return;
 ticking=true;syncAwake();
 try {
  const today=clockParts().date;
  state.completed=Object.fromEntries(Object.entries(state.completed||{}).filter(([key])=>key.startsWith(today)));
  state.attempts=Object.fromEntries(Object.entries(state.attempts||{}).filter(([key])=>key.startsWith(today)));
  for(const e of preflightEvents(state.settings,state.completed)){
   state.completed[e.id]=Date.now();await save();
   try{
    await openTingwu();const c=await check();
    if(!c.ok || c.loginRequired || c.noTab || c.browserClosed)throw Error(c.error || '听悟需要重新登录');
    await log('课前连接检查通过，等待计划时间自动录制');
   }catch(err){await log('课前检查：'+err.message,'warning');await notify('请检查听悟，距离自动录音还有几分钟',err.message);}
  }
  for(const event of runnableEvents(state.settings,state.completed,state.attempts)){
   if(['morning','afternoon'].includes(event.kind)){
    state.attempts[event.id]=Date.now();await save();
    try{
     await startRecording(event.id,startDeadline(event,state.settings));
     if(!stopping){state.completed[event.id]=Date.now();await save();}
    }catch(err){console.error(err.message);}
   }else{
    state.completed[event.id]=Date.now();await save();await reminder();
   }
  }
 }catch(e){console.error(e.message);}finally{ticking=false;}
}
const files={'/':'index.html','/style.css':'style.css','/app.js':'app.js','/icon.png':'../extension/icon.png'};
function respond(res,code,body,type='application/json'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`${HOST}:${PORT}`)return respond(res,403,{error:'invalid host'});
  const url=new URL(req.url,origin);
  if(req.method==='GET' && url.pathname==='/api/status')return respond(res,200,{...state,busy,keepAwake:!!awakeProcess,next:nextEvent(state.settings),version:'0.4.0',mode:'desktop'});
  if(req.method==='POST' && url.pathname.startsWith('/api/')){
   if(req.headers.origin!==origin || req.headers['x-tingwu-token']!==token || req.headers['content-type']!=='application/json')return respond(res,403,{error:'请求来源无效'});
   let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return respond(res,413,{error:'请求过大'});}
   const body=JSON.parse(raw||'{}');let result;
   switch(url.pathname){
    case '/api/save':
     const updated=validate(body.settings);if(updated.enabled){const c=await check();if(!c.ok || c.loginRequired || c.noTab || c.browserClosed || (!c.homeReady && !c.ongoing && !c.path?.startsWith('/doc/')))throw Error(c.error || '请先打开听悟并登录，完成连接检查后再启用');}state.settings=updated;if(!state.settings.enabled)stopping=true;await save();syncAwake();result={message:state.settings.enabled?'自动课表已启用':'课表已暂停，已有录音保持不变'};await log(result.message);break;
    case '/api/open':await openTingwu();result={message:'已打开听悟，使用 Chrome 保存的登录状态'};break;
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
setInterval(tick,20000);
// Opening the application is not an instruction to begin recording immediately.
// Scheduler only evaluates weekday events when explicitly enabled.
