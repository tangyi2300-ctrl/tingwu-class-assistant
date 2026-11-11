import {DEFAULTS, LABELS, validate, nextEvent} from './schedule.js';
const live = Boolean(globalThis.chrome?.runtime?.id), $=s=>document.querySelector(s);
let settings={...DEFAULTS}, toastTimer;
function toast(text) {$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function render() {
  for(const k of ['morning','noon','afternoon','evening']) $('#'+k).value=settings[k];
  $('#status-title').textContent=settings.enabled?'课表已启用，课前自动检查':'计划已暂停，等待你的检查';
  $('#status-dot').classList.toggle('on',settings.enabled);
  $('#toggle').textContent=settings.enabled?'暂停课表':'启用课表';
  const next=nextEvent(settings);
  $('#next').textContent=settings.enabled?`下一次：${new Date(next.when).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${LABELS[next.kind]}`:'检查版不会自动开始录音';
}
async function send(type,data={}) {
  if(!live) {toast('这是界面预览。安装扩展并通过检查后，才可执行真实操作。');return false;}
  const result=await chrome.runtime.sendMessage({type,...data});
  if(!result?.ok) throw Error(result?.error || '操作未完成');return true;
}
async function save(enabled=settings.enabled) {
  const next=validate({...settings,enabled,...Object.fromEntries(['morning','noon','afternoon','evening'].map(k=>[k,$('#'+k).value]))});
  if(!await send('save',{settings:next})) return;
  settings=next;render();toast(enabled?'已保存并启用课表':'已保存，课表处于暂停状态');
}
function on(selector,fn) {$(selector).addEventListener('click',async()=>{const b=$(selector);b.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{b.disabled=false;}});}
$('#schedule-form').addEventListener('submit',async e=>{e.preventDefault();try{await save();}catch(e){toast(e.message);}});
on('#toggle',async()=>{
  if(!settings.enabled && live && !confirm('启用后，工作日课前将尝试启动真实麦克风录音。请确认已登录听悟、允许麦克风并完成启动测试。现在启用吗？'))return;
  await save(!settings.enabled);
});
on('#open',()=>send('open'));
on('#test-start',async()=>{
  if(!live) return send('testStart');
  if(confirm('现在尝试启动真实麦克风录音？测试结束后，请你本人在通义听悟中手动结束。')) {
    toast('正在检查听悟，请等待约 30 秒');await send('testStart');await loadLogs();
  }
});
on('#test-reminder',async()=>{
  if(live) await send('testReminder');
  else window.open('index.html?notice=end','tingwu-reminder-preview','width=540,height=560');
});
const notice=new URLSearchParams(location.search).get('notice');
if(notice) {
  $('#dashboard').hidden=true;$('#notice').hidden=false;
  if(notice==='failed') {
    $('#notice-title').textContent='录音还需要你确认';$('#notice-text').textContent='工具尚未确认录音启动。请检查登录状态、麦克风权限，以及听悟的计时和转写。';
    $('#go-recording').textContent='前往听悟，检查并手动开始';$('#dismiss').textContent='稍后处理';$('#notice small').textContent='打开网页不代表录音已经开始。';
  }
}
on('#go-recording',()=>send('open'));
on('#dismiss',()=>{if(live) window.close();else location.href='index.html';});
async function loadLogs() {
  if(!live) return;
  const {logs=[]}=await chrome.storage.local.get('logs');
  if(!logs.length)return;
  $('#logs').replaceChildren(...logs.slice(0,8).map(item=>{
    const li=document.createElement('li');li.className=item.level;
    li.textContent=`${new Date(item.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}　${item.message}`;return li;
  }));
}
if(live) {settings=validate((await chrome.storage.local.get('settings')).settings || DEFAULTS);chrome.storage.onChanged.addListener(()=>loadLogs());await loadLogs();}
render();
