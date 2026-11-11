import {DEFAULTS, validate, dueEvents, LABELS, clockParts} from './schedule.js';
const URL = 'https://tingwu.aliyun.com/home', ALARM = 'tingwu-class-check';
let queue = Promise.resolve();
const serialize = fn => {const job = queue.then(fn); queue = job.catch(console.error); return job;};
async function settings() { return validate((await chrome.storage.local.get('settings')).settings || DEFAULTS); }
async function log(message, level = 'info') {
  const {logs=[]} = await chrome.storage.local.get('logs');
  await chrome.storage.local.set({logs:[{time:Date.now(),message,level},...logs].slice(0,80)});
}
async function notify(title,message) {
  try { await chrome.notifications.create({type:'basic',iconUrl:'icon.png',title,message,priority:2,requireInteraction:true}); }
  catch(e) { await log('系统通知不可用：'+e.message,'warning'); }
}
async function tabs() {return chrome.tabs.query({url:'https://tingwu.aliyun.com/*'});}
async function focus(tab) {await chrome.tabs.update(tab.id,{active:true}); await chrome.windows.update(tab.windowId,{focused:true});}
async function openTingwu() {
  const existing = await tabs();
  // Prefer an existing microphone session and never navigate or close it.
  for(const tab of existing) {
    try {if((await chrome.tabs.sendMessage(tab.id,{type:'status'})).ongoing) {await focus(tab); return tab;}} catch {}
  }
  const tab=existing[0] || await chrome.tabs.create({url:URL});
  await focus(tab); return tab;
}
async function start() {
  try {
    const existing = await tabs();
    for(const tab of existing) {
      let s;
      try {s = await chrome.tabs.sendMessage(tab.id,{type:'status'});} catch {
        await focus(tab);
        throw Error('已有听悟页面暂时无法检查。为避免重复录音，请先查看页面；安装扩展后需手动刷新听悟');
      }
      if(s.ongoing) {await focus(tab); await log('已有录音或麦克风占用，保留当前会话'); return {state:'existing'};}
    }
    const tab = await openTingwu();
    let ready = false;
    for(let i=0; i<12; i++) {
      try {await chrome.tabs.sendMessage(tab.id,{type:'status'});ready=true;break;} catch {await new Promise(r=>setTimeout(r,600));}
    }
    if(!ready) throw Error('听悟页面尚未就绪，请检查网络或刷新页面');
    const result = await chrome.tabs.sendMessage(tab.id,{type:'start'});
    await log(result.message || '检查当前录音',result.state==='attention'?'warning':'info');
    await notify(result.state==='attention'?'录音需要你处理':'听悟启动检查',result.message);
    if(result.state==='attention') await chrome.windows.create({url:chrome.runtime.getURL('index.html?notice=failed'),type:'popup',width:540,height:560});
    return result;
  } catch(e) {
    await log(e.message,'warning'); await notify('录音未确认启动',e.message);
    await chrome.windows.create({url:chrome.runtime.getURL('index.html?notice=failed'),type:'popup',width:540,height:560});
    return {state:'attention',message:e.message};
  }
}
async function remind() {
  for(const tab of await tabs()) {try {await chrome.tabs.sendMessage(tab.id,{type:'remind'});} catch {}}
  await chrome.windows.create({url:chrome.runtime.getURL('index.html?notice=end'),type:'popup',width:540,height:560});
  await notify('下课了，现在结束录音吗？','请亲自在通义听悟中结束录音。如果还在上课，可以继续录制。');
  await log('已发出下课提醒；未执行停止录音操作');
}
async function tick() {
  const s = await settings();
  const {completed={}}=await chrome.storage.local.get('completed');
  for(const event of dueEvents(s,completed)) {
    completed[event.id]=Date.now();
    // Persist before browser actions: a restarted worker never duplicates a start.
    const date = clockParts().date;
    await chrome.storage.local.set({completed:Object.fromEntries(Object.entries(completed).filter(([key])=>key.startsWith(date)))});
    await log(`${LABELS[event.kind]} · 执行计划`);
    if(['morning','afternoon'].includes(event.kind)) await start(); else await remind();
  }
}
async function sync() {
  const s = await settings();
  if(s.enabled) {
    if(!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM,{periodInMinutes:1});
  } else await chrome.alarms.clear(ALARM);
  await chrome.action.setBadgeText({text:s.enabled?'ON':''});
  await chrome.action.setBadgeBackgroundColor({color:'#216653'});
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM) serialize(tick);});
chrome.runtime.onInstalled.addListener(()=>serialize(sync));
chrome.runtime.onStartup.addListener(()=>serialize(async()=>{await sync(); await tick();}));
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.notifications.onClicked.addListener(()=>openTingwu());
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  // Settings and explicit test actions can only originate in extension pages.
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const actions = {
    save:async()=>{const s=validate(m.settings);await chrome.storage.local.set({settings:s});await sync();return {ok:true};},
    open:openTingwu,
    testStart:start,
    testReminder:remind
  };
  if(!actions[m.type]) return;
  serialize(actions[m.type]).then(result=>reply({ok:true,result})).catch(e=>reply({ok:false,error:e.message}));
  return true;
});
// Rebuild a lost alarm on service-worker restart; default paused creates none.
serialize(sync);
