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
 if(c){message=!c.ok?c.error:c.browserClosed?'Chrome 尚未打开':c.noTab?'请先打开通义听悟':c.loginRequired?'听悟需要登录验证，请在 Chrome 完成':c.paused?'已有录音已暂停，请在听悟手动恢复':c.ongoing?'已连接录音页面，计时 '+(c.elapsedSeconds??'待确认')+' 秒':c.homeReady?'已连接听悟工作台，自动点击功能可用':'已连接浏览器，等待听悟工作台加载';}
 $('#connection').textContent=message;$('#connection').classList.toggle('warning',!!c&&(!c.ok||c.loginRequired||c.noTab));
 const pending=(state.sessions||[]).find(s=>['starting','retrying','pending','missed'].includes(s.status));
 const confirmed=(state.sessions||[]).filter(s=>s.status==='confirmed');
 const blocked=state.connection && !state.connection.ok;
 $('#run-health').textContent=!on?'':blocked?'课表已启用，但自动启动尚未就绪，请查看连接提示。':pending?`${LABELS[pending.kind]}：${pending.status==='missed'?'本节课未确认录音':pending.status==='starting'?'正在启动并核对录音计时':'尚未确认录音，课内自动重试'}${pending.error?' · '+pending.error:''}`:confirmed.length?`今天已确认 ${confirmed.length} 次启动；手动结束后不会重复开启。`:'后台已就绪 · 到点启动并核对计时 · 失败会提醒并在课内重试';
 $('#run-health').classList.toggle('warning',!!pending||!!blocked);
 renderNaming();
 $('#logs').replaceChildren(...(state.logs.length?state.logs.slice(0,8):[{message:'还没有运行记录。'}]).map(item=>{const li=document.createElement('li');li.className=item.level||'';li.textContent=(item.time?new Date(item.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'　':'')+item.message;return li;}));
}
const NAMING_LABELS={recording:'录音中',waiting:'正在整理',draft:'标题候选',applying:'正在改名',renamed:'命名完成',attention:'需要检查',skipped:'保留原名'};
const titleEdits=new Map();
function renderNaming(){
 const n=state.naming||{enabled:false,jobs:[]};
 $('#naming-toggle').textContent=n.enabled?'关闭自动命名':'启用自动命名';
 $('#naming-toggle').setAttribute('aria-pressed',String(n.enabled));
 $('#naming-health').textContent=state.preview?'审查预览 · 此处展示标题效果，不会修改真实录音':n.error?'连接待恢复：'+n.error:n.enabled?'自动命名已开启 · 每分钟补查已保存记录，返回首页也可处理':'尚未启用 · 开启后补查未改名录音，并持续处理后续保存';
 // Preserve a title being edited while the rest of the dashboard polls.
 if(document.activeElement?.matches('.candidate-input'))return;
 const container=$('#naming-jobs');container.replaceChildren();
 if(!n.jobs.length){const p=document.createElement('p');p.className='naming-empty';p.textContent='下一次录音保存后，原标题和新标题会显示在这里。';container.append(p);return;}
 for(const job of n.jobs.slice(0,6)){
  const card=document.createElement('article');card.className='naming-job';
  const top=document.createElement('div');top.className='job-top';
  const label=document.createElement('span');label.textContent=job.previewSource||'通义听悟 · 课堂录音';
  const badge=document.createElement('span');badge.className='naming-badge '+job.status;badge.textContent=NAMING_LABELS[job.status]||'待检查';top.append(label,badge);card.append(top);
  const old=document.createElement('div');old.className='old-title';const oldLabel=document.createElement('small');oldLabel.textContent='原标题';const oldValue=document.createElement('span');oldValue.textContent=job.originalTitle;old.append(oldLabel,oldValue);card.append(old);
  if(job.currentTitle){const p=document.createElement('p');p.className='job-reason';p.textContent='听悟当前标题：'+job.currentTitle;card.append(p);}
  if(job.candidate){const next=document.createElement('div');next.className='new-title';const caption=document.createElement('small');caption.textContent=job.status==='renamed'?'已保存的新标题':'新标题';next.append(caption);
   if(['draft','attention'].includes(job.status)){const input=document.createElement('input');input.className='candidate-input';input.setAttribute('aria-label','编辑录音新标题');input.maxLength=100;input.value=titleEdits.get(job.id)||job.candidate;input.oninput=()=>titleEdits.set(job.id,input.value);next.append(input);}else{const value=document.createElement('strong');value.textContent=job.candidate;next.append(value);}card.append(next);
  }
  const reason=document.createElement('p');reason.className='job-reason';reason.textContent=job.reason;card.append(reason);
  const actions=document.createElement('div');actions.className='naming-actions';
  function button(text,action,data={},primary=false){const b=document.createElement('button');b.className=primary?'primary':'secondary';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{toast((await api(action,{id:job.id,...data,...(action==='naming-apply'?{candidate:titleEdits.get(job.id)||job.candidate}:{})})).message);await refresh();}catch(e){toast(e.message);}finally{b.disabled=false;}};actions.append(b);}
  if(job.candidate && ['draft','attention'].includes(job.status))button('采用这个标题','naming-apply',{},true);
  if(job.url){const open=document.createElement('button');open.className='secondary';open.textContent='在听悟查看 ↗';open.onclick=()=>window.open(job.url,'_blank','noopener');actions.append(open);}
  if(job.status==='attention' && job.url)button('重新检查','naming-inspect');
  if(['draft','attention','waiting'].includes(job.status))button('保留原标题','naming-skip');
  card.append(actions);container.append(card);
 }
}
async function refresh(fields=false){const r=await fetch('/api/status');if(!r.ok)throw Error('桌面服务未连接');state=await r.json();render(fields);}
function on(selector,fn){$(selector).addEventListener('click',async()=>{const b=$(selector);b.disabled=true;try{await fn();await refresh();}catch(e){toast(e.message);}finally{b.disabled=false;}});}
async function save(enabled=state.settings.enabled){const settings={enabled,...Object.fromEntries(['morning','noon','afternoon','evening'].map(k=>[k,$('#'+k).value]))};const result=await api('save',{settings});toast(result.message);await refresh(true);}
$('#schedule-form').addEventListener('submit',async e=>{e.preventDefault();try{await save();}catch(e){toast(e.message);}});
on('#naming-toggle',async()=>{toast((await api('naming-toggle',{enabled:!state.naming.enabled})).message);});
on('#naming-inspect',async()=>{toast((await api('naming-inspect')).message);});
on('#toggle',()=>save(!state.settings.enabled));
on('#open',async()=>{const r=await api('open');toast(r.message);});
on('#check',async()=>{await api('check');toast('检查已完成');});
on('#test-start',async()=>{if(confirm('现在启动真实麦克风录音？录音结束后，需要你亲自在通义听悟中点击结束。')){toast('正在进入听悟并自动点击录制…');const r=await api('start');toast(r.message);}});
on('#test-reminder',async()=>{const r=await api('remind');toast(r.message);});
await refresh(true);
setInterval(()=>refresh().catch(()=>toast('桌面服务暂时不可用，请重新双击桌面应用')),5000);
