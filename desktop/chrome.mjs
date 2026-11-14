import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import path from 'node:path';
const runFile=promisify(execFile);
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {nativeStatus,pickRecordingTab} from './native-status.mjs';
import {chromeCall} from './chrome-process.mjs';
import {readRecordingMetadata,writeTitleWithAPI} from './tingwu-api.mjs';
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
async function locate(){return pickRecordingTab(await namingTabs());}
// Background-only mode: never activate Chrome, change the front window or
// select a different tab. A visible target can still be read through AX.
async function focus(tab){
 const url=await chromeCall('url',tab);
 if(!url.startsWith('https://tingwu.aliyun.com/'))throw Error('原标签页已离开听悟');
 tab.url=url;return tab;
}
export async function openTingwu(){
 let tab=await locate();
 if(!tab){
  const running=await chromeCall('hasBrowser');
  if(running)throw Error('请保留一个已登录的听悟标签页；静默模式不会在前台新建窗口');
  let profile='Default';
  try{const p=JSON.parse(await readFile(path.join(homedir(),'Library/Application Support/TingwuClassAssistant/data/session-preferences.json'),'utf8'));if(/^(Default|Profile \d+)$/.test(p.profileDirectory))profile=p.profileDirectory;}catch{}
  await runFile('/usr/bin/open',['-g','-j','-a','Google Chrome','--args','--profile-directory='+profile,'https://tingwu.aliyun.com/home']);
  for(let i=0;i<15 && !tab;i++){await new Promise(r=>setTimeout(r,700));try{tab=await locate();}catch{}}
 }
 if(!tab)throw Error('后台尚未找到听悟窗口，请保留已登录的听悟页面');
 return focus(tab);
}
const nativePath=fileURLToPath(new URL('../native/tingwu-ui',import.meta.url));
async function native(args){
 let stdout;
 try{({stdout}=await runFile(nativePath,args,{timeout:10000,env:{...process.env,TINGWU_CHROME_PID:String(await chromeCall('pid'))}}));}
 catch(e){
  let detail;try{detail=JSON.parse(e.stdout||'{}').error;}catch{}
  throw Error(detail || (e.killed?'听悟页面读取超时，将重新定位窗口后重试':'听悟辅助功能操作失败，请检查 Chrome 和辅助功能权限'));
 }
 const result=JSON.parse(stdout);if(result.error)throw Error(result.error);return result;
}
async function scanTab(tab){
 let snapshot;
 for(let i=0;i<3;i++){
  await focus(tab);
  snapshot=await native(['scan',tab.url]);
  if(!snapshot.noTab)break;
  await new Promise(r=>setTimeout(r,700));
 }
 return {...nativeStatus(snapshot),tabId:tab.tabId,windowId:tab.windowId};
}
async function evaluateTab(tab,expression){
 const js=agent+'\nJSON.stringify('+expression+')';
 const result=await chromeCall('script',{...tab,script:js});
 if(!result)throw Error('听悟页面正在加载');
 return JSON.parse(result);
}
function scriptStatus(raw,tab){return {...nativeStatus(raw),microphone:raw.microphone,tabId:tab.tabId,windowId:tab.windowId,controlMode:'background-script',backgroundReady:true,action:raw.action,label:raw.label};}
export async function controlStatus(){
 const tab=await locate();if(!tab)return {noTab:true,browserClosed:!await chromeCall('hasBrowser')};
 try{return scriptStatus(await evaluateTab(tab,'window.__tingwuClassDesktopV3.status()'),tab);}
 catch(e){if(!/允许 Apple|JavaScript/.test(e.message))throw e;return {...await scanTab(tab),backgroundReady:false};}
}
export async function controlStep(id,deadline=Infinity){
 const tab=await openTingwu();let s;
 try{s=scriptStatus(await evaluateTab(tab,`window.__tingwuClassDesktopV3.step(${JSON.stringify(id)},${Number.isFinite(deadline)?deadline:'Infinity'})`),tab);}
 catch(e){
  if(!/允许 Apple|JavaScript/.test(e.message))throw e;
  const existing=await scanTab(tab);
  if(existing.ongoing)return {...existing,backgroundReady:false,action:'ongoing'};
  throw Error('静默启动需要 Chrome「允许 Apple 事件中的 JavaScript」权限；程序不会切换窗口或移动鼠标');
 }
 if(s.noTab)throw Error('后台暂未读取到听悟，将重试');
 if(s.microphoneDenied && !s.ongoing)throw Error('听悟麦克风权限未开启，请允许 Chrome 使用麦克风');
 if(s.action==='waiting' && ((s.path.startsWith('/doc/') && s.path!=='/doc/record') || s.path.startsWith('/folders/'))){
  await chromeCall('navigate',{...tab,url:'https://tingwu.aliyun.com/home'});
 }
 return s;
}
export async function showTingwu(){const tab=await openTingwu();await chromeCall('show',tab);}
export async function evaluate(expression){const tab=await locate();return tab?evaluateTab(tab,expression):{noTab:true};}
export async function notify(title,message) {
  await apple(`display notification ${quote(message)} with title ${quote(title)}`).catch(()=>{});
}
export async function askEnd() {
  const response=await apple(`display dialog "下课了，现在结束录音吗？\\n\\n请亲自在通义听悟中点击结束录音。若还在上课，可以继续录制。" with title "听课搭子" buttons {"继续录制", "前往听悟"} default button "继续录制" giving up after 300`,310000);
  if(response.includes('button returned:前往听悟')) await showTingwu();
}

export async function askProblem(message){await notify('听课搭子：录音尚未确认',message);}
export async function namingTabs(){return chromeCall('tabs');}
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
 return readRecordingMetadata(job);
}
export async function openNamingRecord(job){await chromeCall('show',await namingTab(job));}
export async function writeRecordingTitle(job){
 return writeTitleWithAPI(job);
}
