import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import path from 'node:path';
const runFile=promisify(execFile);
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {nativeStatus} from './native-status.mjs';
const agent=await readFile(new URL('./page-agent.js',import.meta.url),'utf8');
export const quote = value => '"'+String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n').replaceAll('\r','\\r')+'"';
export function apple(script, timeout=20000) {
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/osascript',['-'],{stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Chrome 响应超时，请确认浏览器没有未处理的弹窗'));},timeout);
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(Error(/JavaScript.*关闭|Apple.*JavaScript|JavaScript from Apple/.test(err)?'请开启 Chrome「显示（或查看）→ 开发者 → 允许 Apple 事件中的 JavaScript」':err.trim() || 'Chrome 操作失败'));});
    child.stdin.end(script);
  });
}
async function locate(){
 const raw=await apple(`tell application "Google Chrome"
set foundTab to 0
set foundWindow to 0
set foundIndex to 0
repeat with w in windows
 repeat with i from 1 to count of tabs of w
  set candidate to tab i of w
  if URL of candidate starts with "https://tingwu.aliyun.com/" then
   if foundTab is 0 or URL of candidate contains "/doc/record" then
    set foundTab to id of candidate
    set foundWindow to id of w
    set foundIndex to i as integer
   end if
  end if
 end repeat
end repeat
return (foundWindow as text) & ":" & (foundTab as text) & ":" & (foundIndex as text)
end tell`);
 const [windowId,tabId,index]=raw.split(':').map(Number);
 return tabId?{windowId,tabId,index}:null;
}
async function focus(tab){
 await apple(`tell application "Google Chrome"
set active tab index of window id ${tab.windowId} to ${tab.index}
set index of window id ${tab.windowId} to 1
activate
end tell`);
 await new Promise(r=>setTimeout(r,250));
}
export async function openTingwu(){
 const running=await apple('if application "Google Chrome" is running then return "running"');
 if(running!=='running'){
  let profile='Default';
  try{const p=JSON.parse(await readFile(path.join(homedir(),'Library/Application Support/TingwuClassAssistant/data/session-preferences.json'),'utf8'));if(/^(Default|Profile \d+)$/.test(p.profileDirectory))profile=p.profileDirectory;}catch{}
  await runFile('/usr/bin/open',['-a','Google Chrome','--args','--profile-directory='+profile,'https://tingwu.aliyun.com/home']);
  await new Promise(r=>setTimeout(r,1500));
 }
 let tab=await locate();
 if(!tab){await apple(`tell application "Google Chrome"
set recordingWindow to make new window
set URL of active tab of recordingWindow to "https://tingwu.aliyun.com/home"
end tell`);tab=await locate();}
 if(!tab)throw Error('未找到听悟窗口');
 await focus(tab);return tab;
}
const nativePath=fileURLToPath(new URL('../native/tingwu-ui',import.meta.url));
async function native(args){
 let stdout;
 try{({stdout}=await runFile(nativePath,args,{timeout:15000}));}
 catch(e){try{const result=JSON.parse(e.stdout);if(result.error)throw Error(result.error);}catch(parsed){if(parsed instanceof SyntaxError)throw e;throw parsed;}throw e;}
 const result=JSON.parse(stdout);if(result.error)throw Error(result.error);return result;
}
export async function controlStatus(){
 const tab=await locate();if(!tab)return {noTab:true};
 await focus(tab);const raw=await native(['scan']);return nativeStatus(raw);
}
const clicked=new Map();
export async function controlStep(id,deadline=Infinity){
 const tab=await openTingwu(), snapshot=await native(['scan']);
 const s=nativeStatus(snapshot);
 if(s.noTab)throw Error('听悟页面尚未就绪，等待重试');
 if(s.ongoing)return {...s,action:'ongoing'};
 if(s.loginRequired)return {...s,action:'login-required'};
 if(Date.now()>=deadline)return {...s,action:'deadline'};
 if(!clicked.has(id))clicked.set(id,new Map());
 if(clicked.size>50)clicked.delete(clicked.keys().next().value);
 for(const label of ['开启实时记录','开始录音','开始记录']){
  if(s.labels.includes(label) && Date.now()-(clicked.get(id).get(label)||0)>=5000){
   const result=await native(['press',label,String(deadline)]);
   if(result.clicked){clicked.get(id).set(label,Date.now());return {...s,action:'clicked',label};}
   throw Error('未能点击听悟录音按钮');
  }
 }
 if(s.path.startsWith('/doc/') && s.path!=='/doc/record'){
  await apple(`tell application "Google Chrome" to set URL of tab id ${tab.tabId} of window id ${tab.windowId} to "https://tingwu.aliyun.com/home"`);
 }
 return {...s,action:'waiting'};
}
export async function evaluate(expression) {
  const tab=await locate();if(!tab)return {noTab:true};
  const js=agent+'\nJSON.stringify('+expression+')';
  const result=await apple(`tell application "Google Chrome" to execute tab id ${tab.tabId} of window id ${tab.windowId} javascript ${quote(js)}`);
  if(!result) throw Error('听悟页面正在加载，请稍后重试');
  return JSON.parse(result);
}
export async function notify(title,message) {
  await apple(`display notification ${quote(message)} with title ${quote(title)}`).catch(()=>{});
}
export async function askEnd() {
  const response=await apple(`display dialog "下课了，现在结束录音吗？\\n\\n请亲自在通义听悟中点击结束录音。若还在上课，可以继续录制。" with title "听课搭子" buttons {"继续录制", "前往听悟"} default button "继续录制" giving up after 300`,310000);
  if(response.includes('button returned:前往听悟')) await openTingwu();
}

export async function namingTabs(){
 if(await apple('if application "Google Chrome" is running then return "running"')!=='running')return [];
 const raw=await apple(`tell application "Google Chrome"
set rows to ""
repeat with w in windows
 repeat with i from 1 to count of tabs of w
  set t to tab i of w
  if URL of t starts with "https://tingwu.aliyun.com/" then set rows to rows & (id of w as text) & (character id 9) & (id of t as text) & (character id 9) & (i as text) & (character id 9) & URL of t & (character id 9) & title of t & linefeed
 end repeat
end repeat
return rows
end tell`);
 return raw.split('\n').filter(Boolean).map(row=>{const [windowId,tabId,index,url,...title]=row.split('\t');return {windowId:Number(windowId),tabId:Number(tabId),index:Number(index),url,title:title.join(' ')};}).filter(t=>Number.isInteger(t.tabId)&&t.url);
}
async function namingTab(job){
 const {savedURL}=await import('./naming.mjs');
 if(!savedURL(job.url))throw Error('缺少已保存录音的有效链接');
 const tabs=await namingTabs();
 const tab=tabs.find(t=>t.tabId===job.tabId && savedURL(t.url)===job.url)||tabs.find(t=>savedURL(t.url)===job.url);
 if(!tab)throw Error('请先在 Chrome 打开本条听悟录音');
 await focus(tab);
 await new Promise(r=>setTimeout(r,500));
 return tab;
}
export async function readNamingMetadata(job){
 const tab=await namingTab(job);
 const result=await native(['title-read',tab.url]);
 if(result.noTab)throw Error('听悟记录页尚未就绪或已切换，请稍后重试');
 return result;
}
export async function openNamingRecord(job){await namingTab(job);}
export async function writeRecordingTitle(job){
 const tab=await namingTab(job),before=await native(['title-read',tab.url]);
 if(before.title!==job.originalTitle && before.title!==job.candidate)throw Error('标题已被修改，保留现有标题');
 // A previous interrupted attempt may have left the desired value in the
 // input without committing it. Submit that exact value before reloading.
 const submitted=await native(['title-write',tab.url,before.title,job.candidate]);
 if(!submitted.submitted)throw Error('未确认标题提交');
 await new Promise(r=>setTimeout(r,2000));
 // A displayed input value alone is not evidence of server persistence.
 const current=(await namingTabs()).find(t=>t.tabId===tab.tabId&&t.windowId===tab.windowId);
 if(current?.url!==tab.url)throw Error('页面已切换，停止验证');
 await apple(`tell application "Google Chrome" to reload tab id ${tab.tabId} of window id ${tab.windowId}`);
 for(let i=0;i<8;i++){
  await new Promise(r=>setTimeout(r,1000));
  try{
   const loading=await apple(`tell application "Google Chrome" to get loading of tab id ${tab.tabId} of window id ${tab.windowId}`);
   if(loading!=='false')continue;
   const after=await native(['title-read',tab.url]);if(after.title===job.candidate)return {title:after.title,persisted:true};
  }catch{}
 }
 throw Error('重新加载后未读到新标题，请在听悟核对');
}
