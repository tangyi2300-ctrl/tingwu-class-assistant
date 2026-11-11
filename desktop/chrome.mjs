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
