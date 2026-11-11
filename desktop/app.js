const $=s=>document.querySelector(s), token=$('meta[name="tingwu-token"]').content;
let state=null,toastTimer;
const LABELS={morning:'上午课前',noon:'中午下课',afternoon:'下午课前',evening:'下午下课'};
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
async function api(name,data={}){
 const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Tingwu-Token':token},body:JSON.stringify(data)});
 const result=await r.json();if(!r.ok)throw Error(result.error||'操作失败');return result.result;
}
function render(fields=false){
 if(!state)return;
 if(fields)for(const k of ['morning','noon','afternoon','evening'])$('#'+k).value=state.settings[k];
 const on=state.settings.enabled;
 $('#status-title').textContent=on?'自动课表已启用':'自动课表已暂停';$('#toggle').textContent=on?'暂停课表':'启用课表';$('#status-dot').classList.toggle('on',on);
 $('#next').textContent=on?`下一次：${new Date(state.next.when).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${LABELS[state.next.kind]}`:'完成登录与连接检查后，可启用自动录音';
 const c=state.connection;
 let message='点击「检查登录与自动点击」确认准备状态';
 if(c){message=!c.ok?c.error:c.browserClosed?'Chrome 尚未打开':c.noTab?'请先打开通义听悟':c.loginRequired?'听悟需要登录验证，请在 Chrome 完成':c.ongoing?'检测到录音界面，请核对听悟计时和转写':c.homeReady?'已连接听悟工作台，自动点击功能可用':'已连接浏览器，等待听悟工作台加载';}
 $('#connection').textContent=message;$('#connection').classList.toggle('warning',!!c&&(!c.ok||c.loginRequired||c.noTab));
 $('#logs').replaceChildren(...(state.logs.length?state.logs.slice(0,8):[{message:'还没有运行记录。'}]).map(item=>{const li=document.createElement('li');li.className=item.level||'';li.textContent=(item.time?new Date(item.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'　':'')+item.message;return li;}));
}
async function refresh(fields=false){const r=await fetch('/api/status');if(!r.ok)throw Error('桌面服务未连接');state=await r.json();render(fields);}
function on(selector,fn){$(selector).addEventListener('click',async()=>{const b=$(selector);b.disabled=true;try{await fn();await refresh();}catch(e){toast(e.message);}finally{b.disabled=false;}});}
async function save(enabled=state.settings.enabled){const settings={enabled,...Object.fromEntries(['morning','noon','afternoon','evening'].map(k=>[k,$('#'+k).value]))};const result=await api('save',{settings});toast(result.message);await refresh(true);}
$('#schedule-form').addEventListener('submit',async e=>{e.preventDefault();try{await save();}catch(e){toast(e.message);}});
on('#toggle',()=>save(!state.settings.enabled));
on('#open',async()=>{const r=await api('open');toast(r.message);});
on('#check',async()=>{await api('check');toast('检查已完成');});
on('#test-start',async()=>{if(confirm('现在启动真实麦克风录音？录音结束后，需要你亲自在通义听悟中点击结束。')){toast('正在进入听悟并自动点击录制…');const r=await api('start');toast(r.message);}});
on('#test-reminder',async()=>{const r=await api('remind');toast(r.message);});
await refresh(true);
setInterval(()=>refresh().catch(()=>toast('桌面服务暂时不可用，请重新双击桌面应用')),5000);
