import {spawn} from 'node:child_process';
// Address Apple events to the normal browser PID. Addressing only the app name
// can connect to a Playwright/headless Chrome registered by another task.
export async function chromeCall(operation,payload={},timeout=15000){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const value=await chromeCallOnce(operation,payload,timeout);
   if(attempt<2 && ((operation==='tabs' && value.length===0)||(operation==='hasBrowser' && value===false))){await new Promise(r=>setTimeout(r,300));continue;}
   return value;
  }catch(e){
   // macOS can briefly omit a running app from its process registry. Retry only
   // this pre-execution failure; never replay an ambiguous script timeout.
   if(attempt===2 || !e.message.includes('日常 Chrome 尚未运行'))throw e;
   await new Promise(r=>setTimeout(r,300));
  }
 }
}
function chromeCallOnce(operation,payload={},timeout=15000){
 const script=`JSON.stringify((function(){
 ObjC.import('AppKit');
 const running=$.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.google.Chrome');
 const candidates=[];
 for(let i=0;i<running.count;i++){const a=running.objectAtIndex(i);if(Number(a.activationPolicy)===0&&!a.terminated)candidates.push({pid:Number(a.processIdentifier),active:Boolean(a.active)});}
 const choice=candidates.find(a=>a.active)||candidates[0];
 const op=${JSON.stringify(operation)},arg=${JSON.stringify(payload)};
 if(op==='hasBrowser')return !!choice;
 if(!choice){if(op==='tabs')return [];throw Error('日常 Chrome 尚未运行');}
 if(op==='pid')return choice.pid;
 const chrome=Application(choice.pid);
 if(op==='tabs'){
  const rows=[];
  for(const w of chrome.windows()){try{const wid=Number(w.id());for(const t of w.tabs()){try{const url=t.url();if(url.indexOf('https://tingwu.aliyun.com/')===0)rows.push({windowId:wid,tabId:Number(t.id()),url:url,title:t.title()});}catch(e){}}}catch(e){}}
  return rows;
 }
 const w=chrome.windows().find(w=>Number(w.id())===arg.windowId);
 if(!w)throw Error('听悟窗口已关闭');
 const tab=w.tabs().find(t=>Number(t.id())===arg.tabId);
 if(!tab)throw Error('听悟标签页已关闭');
 if(tab.url().indexOf('https://tingwu.aliyun.com/')!==0)throw Error('原标签页已离开听悟');
 if(op==='url')return tab.url();
 // Used only after an explicit dashboard click or the user's end-reminder choice.
 if(op==='show'){w.minimized=false;w.activeTabIndex=w.tabs().findIndex(t=>Number(t.id())===arg.tabId)+1;w.index=1;chrome.activate();return true;}
 if(op==='script')return tab.execute({javascript:arg.script});
 if(op==='navigate'){
  if(tab.url().indexOf('/doc/record')>=0)throw Error('保留当前录音页面，不执行导航');
  if(arg.url!=='https://tingwu.aliyun.com/home')throw Error('无效导航目标');
  tab.url=arg.url;return true;
 }
 if(op==='reload'){
  if(tab.url()!==arg.expectedURL||tab.url().indexOf('/doc/transcripts/')<0)throw Error('录音页面已变化，不执行刷新');
  tab.reload();return true;
 }
 if(op==='loading')return Boolean(tab.loading());
 throw Error('未知浏览器操作');
})())`;
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/osascript',['-l','JavaScript','-'],{stdio:['pipe','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{child.kill();reject(Error('日常 Chrome 响应超时，将在后台重试'));},timeout);
  child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error(/JavaScript.*关闭|Apple.*JavaScript|JavaScript from Apple/.test(err)?'请开启 Chrome「显示 → 开发者 → 允许 Apple 事件中的 JavaScript」':err.trim()||'Chrome 操作失败'));try{resolve(JSON.parse(out));}catch{reject(Error('Chrome 返回的数据无效'));}});
  child.stdin.end(script);
 });
}
