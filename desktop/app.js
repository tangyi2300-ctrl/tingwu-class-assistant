import {createClassroomUI} from './classroom-ui.js';
import {createDeletionUI} from './deletion-ui.js';
const $=s=>document.querySelector(s);
let token=$('meta[name="tingwu-token"]').content;
const homeClockFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',weekday:'long',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function updateHomeClock(){
 const now=new Date(),p=Object.fromEntries(homeClockFormat.formatToParts(now).map(x=>[x.type,x.value]));
 $('#today-caption').textContent=`今天 · ${p.year} 年 · 北京时间`;
 $('#today-date').textContent=`${p.month}月${p.day}日`;
 $('#today-date').dateTime=`${p.year}-${p.month.padStart(2,'0')}-${p.day.padStart(2,'0')}`;
 $('#today-weekday').textContent=p.weekday;
 $('#today-clock').textContent=`${p.hour}:${p.minute}:${p.second}`;
 $('#today-clock').dateTime=now.toISOString();
}
updateHomeClock();
setInterval(updateHomeClock,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateHomeClock();});
window.addEventListener('pageshow',updateHomeClock);
let state=null,toastTimer;
let libraryViewKey='',libraryDeferred=false,libraryRequest=false,libraryAttemptAt=0,libraryRequestError='';
const LABELS={morning:'上午课前',noon:'中午下课',afternoon:'下午课前',evening:'下午下课'};
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
async function api(name,data={}){
 const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Tingwu-Token':token},body:JSON.stringify(data)});
 const result=await r.json();if(!r.ok){const e=Error(result.error||'操作失败');e.status=r.status;throw e;}return result.result;
}
const classroomUI=createClassroomUI({api});
const deletionUI=createDeletionUI({api,onDeleted:async result=>{toast(result.message);if(location.hash===('#recording/'+result.transId)||location.hash===('#classroom/'+result.localId))location.hash='library';await refresh();}});
function render(fields=false){
 if(!state)return;
 $('#app-version').textContent=state.preview?'界面预览':`桌面版 · v${state.version||'0.9'}`;
 if(fields)for(const k of ['morning','noon','afternoon','evening'])$('#'+k).value=state.settings[k];
 const on=state.settings.enabled;
 $('#status-title').textContent=on?'自动课表已启用':'自动课表已暂停';$('#toggle').textContent=on?'暂停课表':'启用课表';$('#status-dot').classList.toggle('on',on);
 $('#next').textContent=on&&state.next?`下一次：${new Date(state.next.when).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${LABELS[state.next.kind]}`:state.local?.enabled?'授权麦克风后，可启用自动录音':'完成登录与连接检查后，可启用自动录音';
 $('#schedule-summary').textContent=`周一至周五 · ${state.settings.morning} / ${state.settings.afternoon}`;
 const c=state.connection;
 let message='点击「检查听悟上传连接」确认上传准备状态';
 if(c){message=!c.ok?c.error:c.browserClosed?'Chrome 尚未打开':c.noTab?'请先打开通义听悟':c.loginRequired?'听悟需要登录验证，请在 Chrome 完成':c.recordingIssue?'听悟提示：'+c.recordingIssue.message:c.paused?'已有录音已暂停，请在听悟手动恢复':c.ongoing?'已连接录音页面，计时 '+(c.elapsedSeconds??'待确认')+' 秒':c.homeReady?'已连接听悟工作台，自动点击功能可用':'已连接浏览器，等待听悟工作台加载';}
 $('#connection').textContent=message;$('#connection').classList.toggle('warning',!!c&&(!c.ok||c.loginRequired||c.noTab||c.recordingIssue));
 const pending=(state.sessions||[]).find(s=>['starting','retrying','pending','missed'].includes(s.status));
 const confirmed=(state.sessions||[]).filter(s=>s.status==='confirmed');
 const blocked=!state.local?.enabled&&state.connection && !state.connection.ok;
 const healthIssue=confirmed.find(s=>s.health&&!['recording','ended'].includes(s.health.status)&&Date.now()-s.health.checkedAt<300000);
 const recent=[...confirmed].sort((a,b)=>(b.health?.checkedAt||b.confirmedAt||0)-(a.health?.checkedAt||a.confirmedAt||0))[0];
 const checkedTime=recent?.health?.checkedAt?new Date(recent.health.checkedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}):'';
 const sourceLabel=['automatic','local'].includes(recent?.source)?'已自动开启':recent?.source==='existing'?'已有录音，本次未自动点击开始':'已确认开始，启动来源未记录';
 $('#run-health').textContent=!on?'':healthIssue?`${LABELS[healthIssue.kind]}：${healthIssue.health.message}；请查看录音状态。`:blocked?'自动启动需要检查，请在「课表与设置 → 连接与权限」查看。':pending?`${LABELS[pending.kind]}：${pending.status==='missed'?'本节课未确认录音':pending.status==='starting'?'正在启动并核对计时':'尚未确认录音，正在重试'}${pending.error?' · '+pending.error:''}`:recent?`${LABELS[recent.kind]}${sourceLabel}${checkedTime?' · 最近核对 '+checkedTime:''}`:'';
 $('#run-health').classList.toggle('warning',!!pending||!!blocked||!!healthIssue);
 $('#run-health').classList.toggle('session-evidence',!!recent);
 renderLocalRecorder();
 renderTodaySchedule();
 renderNaming();
 renderLibrary();
 $('#logs').replaceChildren(...(state.logs.length?state.logs.slice(0,8):[{message:'还没有运行记录。'}]).map(item=>{const li=document.createElement('li');li.className=item.level||'';li.textContent=(item.time?new Date(item.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'　':'')+item.message;return li;}));
}
function localTime(seconds){const n=Math.max(0,Math.floor(seconds||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':');}
function updateLocalTimer(){
 const local=state?.local;if(!local?.enabled)return;
 const delay=Date.now()-(local.updatedAt||0),elapsed=local.active?.durationSeconds||0;
 $('#local-timer').textContent=localTime(elapsed+(local.recording&&delay<6000?Math.max(0,delay/1000):0));
}
setInterval(updateLocalTimer,1000);
function renderLocalRecorder(){
 const local=state.local;$('#local-recorder').hidden=!local?.enabled;if(!local?.enabled)return;
 const recording=local.recording,ready=local.permission==='authorized'&&!local.stale;
 $('#local-title').textContent=recording?'正在录音 · 临时缓存中':!ready?'需要准备麦克风':'本地录音已就绪';
 $('#local-recorder').classList.toggle('is-recording',recording);
 $('#local-description').textContent=local.error|| (recording?'下课点击「结束并上传」。录音结束后上传听悟，核验成功后清理临时音频。':ready?'按课表自动开始，也可以现在开始。确认已存入听悟后，自动清理本机音频。':'点击授权麦克风，在系统提示中选择允许。');
 $('#local-permission').hidden=local.permission==='authorized';
 $('#local-start').hidden=recording;$('#local-start').disabled=!ready||state.busy;
 $('#local-stop').hidden=!recording;
 updateLocalTimer();
 const jobs=local.uploads?.jobs||[];$('#local-upload-count').textContent=jobs.length?`· ${jobs.filter(j=>j.status!=='uploaded').length} 条待上传`:'';
 const list=$('#local-upload-list');list.replaceChildren();
 if(!jobs.length){list.append(element('p','hint','结束录音后，这里会显示上传结果和临时音频清理状态。'));return;}
 for(const job of jobs){
  const row=element('article','local-upload-row'),info=element('div');
  info.append(element('strong','',new Date(job.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · '+localTime(job.durationSeconds)));
  const labels={waiting:'等待上传',uploading:`正在上传 ${Math.round((job.progress||0)*100)}%`,uploaded:job.audioRemovedAt?'已存听悟 · 本机音频已清理':'已上传听悟 · 正在核对并清理临时音频',retrying:'上传暂未完成 · 将自动重试',attention:'需要检查 · 本地音频保留'};
  info.append(element('p','hint',(job.interrupted?'录音曾中断，请核对完整性。 ':'')+(job.deletionWarning||job.error||job.audioCleanupError||labels[job.status]||'等待上传')));
  const actions=element('div','local-file-actions'),download=element('a','text-button','下载音频');download.href=`/api/local-audio/${encodeURIComponent(job.id)}?token=${encodeURIComponent(token)}`;download.download='';download.referrerPolicy='no-referrer';if(!job.audioRemovedAt)actions.append(download);const notes=element('a','text-button','文字与笔记');notes.href='#classroom/'+encodeURIComponent(job.id);if(!job.deletionWarning)actions.prepend(notes);
  if(job.url){const link=element('a','text-button','在听悟查看 ↗');link.href=job.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
  if(!job.deletionWarning&&['retrying','attention'].includes(job.status)){const retry=element('button','secondary','重试上传');retry.onclick=async()=>{retry.disabled=true;try{toast((await api('local-retry',{id:job.id})).message);await refresh();}catch(e){toast(e.message);}finally{retry.disabled=false;}};actions.append(retry);}
  const deletion=deletionUI.button({localId:job.id},info.querySelector('strong').textContent);deletion.disabled=job.status==='uploading';actions.append(deletion);
  row.append(info,actions);list.append(row);
 }
}
function renderTodaySchedule(){
 const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date());
 const weekend=weekday==='Sat'||weekday==='Sun';
 for(const kind of ['morning','afternoon']){
  $('#'+kind+'-start-display').textContent=state.settings[kind];
  const run=(state.sessions||[]).find(s=>s.kind===kind),label=$('#'+kind+'-session-state');
  let text=weekend?'周末不启动':!state.settings.enabled?'课表已暂停':'等待启动',tone='';
  if(!weekend&&state.settings.enabled&&run){
   if(run.status==='confirmed'){
    text=['automatic','local'].includes(run.source)?'已自动开启':run.source==='existing'?'检测到已有录音':'已确认开始';tone='confirmed';
    if(run.health?.status==='ended')text='已手动结束';
    if(run.health&&!['recording','ended'].includes(run.health.status)&&Date.now()-run.health.checkedAt<300000){text='状态需检查';tone='warning';}
   }else if(['starting','pending','retrying','missed'].includes(run.status)){text={starting:'正在启动',pending:'等待确认',retrying:'正在重试',missed:'未确认开始'}[run.status];tone='warning';}
  }
  label.textContent=text;label.className='session-state'+(tone?' '+tone:'');
  label.title=run?.confirmedAt?'启动确认于 '+new Date(run.confirmedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})+'；不代表当前仍在录音。':'';
 }
}
const recordingDateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'long',hourCycle:'h23'});
function recordingView(record){
 const rawTitle=String(record.title||'未命名录音');
 const match=rawTitle.match(/^(\d{4}-\d{2}-\d{2})｜([0-2]\d:[0-5]\d)｜(.+)$/s);
 let date=Number.isFinite(record.recordedAt)?new Date(record.recordedAt):null,title=rawTitle;
 if(match){const parsed=new Date(`${match[1]}T${match[2]}:00+08:00`);if(Number.isFinite(parsed.getTime())){
  const p=Object.fromEntries(recordingDateFormat.formatToParts(parsed).map(v=>[v.type,v.value]));
  if(`${p.year}-${p.month}-${p.day}`===match[1]){date=parsed;title=match[3];}
 }}
 const parts=date&&Number.isFinite(date.getTime())?Object.fromEntries(recordingDateFormat.formatToParts(date).map(v=>[v.type,v.value])):null;
 const seconds=Number.isFinite(record.duration)&&record.duration>=0?Math.floor(record.duration):null;
 const duration=seconds===null?'时长待更新':seconds>=3600?`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`:seconds>=60?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${seconds} 秒`;
 let url=null;try{const u=new URL(record.url);if(u.origin==='https://tingwu.aliyun.com'&&/^\/doc\/transcripts\/[\w-]+\/?$/.test(u.pathname))url=u.origin+u.pathname;}catch{}
 return {...record,title,rawTitle,parts,duration,url,sortTime:date?.getTime()||0,searchText:[rawTitle,parts&&`${parts.year}-${parts.month}-${parts.day}`,parts&&`${Number(parts.month)}月${Number(parts.day)}日`,parts&&`${parts.hour}:${parts.minute}`].filter(Boolean).join(' ').toLocaleLowerCase()};
}
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function renderLibrary(){
 if(!state)return;
 const library=state.library||{records:[],updatedAt:null};
 const records=(library.records||[]).map(recordingView).sort((a,b)=>b.sortTime-a.sortTime||String(a.transId).localeCompare(String(b.transId)));
 const query=$('#recording-search').value.trim().toLocaleLowerCase();
 const visible=records.filter(r=>!query||query.split(/\s+/).every(term=>r.searchText.includes(term)));
 const syncing=libraryRequest||state.runtime?.libraryBusy;
 const error=libraryRequestError||library.error;
 $('#recording-count').textContent=library.updatedAt?`${records.length} 条`:'—';
 $('#recordings-refresh').disabled=!!syncing;
 $('#recording-list').setAttribute('aria-busy',String(!!syncing));
 $('#library-results').textContent=query?`找到 ${visible.length} 条`:'最新在前';
 let health=library.updatedAt?`已同步听悟 · ${new Date(library.updatedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} 更新`:'正在读取听悟录音…';
 if(syncing)health=records.length?'正在更新听悟列表，下面仍可查看…':'正在同步听悟录音…';
 else if(error)health=`暂时无法更新：${error}${records.length?'；以下显示上次同步的记录。':''}`;
 else if(libraryDeferred&&!library.updatedAt)health='正在等待同步，列表会自动更新。';
 else if(libraryDeferred&&Date.now()-library.updatedAt>=60000)health='已显示上次同步的记录，稍后自动更新。';
 $('#library-health').textContent=health;$('#library-health').classList.toggle('warning',!!error);
 const jobs=new Map((state.naming?.jobs||[]).map(j=>[j.url,j]));
 const key=JSON.stringify([visible.map(r=>[r.transId,r.rawTitle,r.sortTime,r.duration,r.url,r.deletionWarning,jobs.get(r.url)?.status]),query,!!library.updatedAt,!!error]);
 if(key===libraryViewKey)return;libraryViewKey=key;
 const list=$('#recording-list'),fragment=document.createDocumentFragment();let groupKey=null,groupList=null;
 for(const record of visible){
  const dateKey=record.parts?`${record.parts.year}-${record.parts.month}-${record.parts.day}`:'unknown';
  if(dateKey!==groupKey){
   groupKey=dateKey;const group=element('section','recording-group'),heading=element('h2','recording-group-heading');
   if(record.parts){heading.append(element('span','recording-month',`${Number(record.parts.month)}月`),element('strong','recording-day',record.parts.day),element('span','','日'),element('span','recording-weekday',`${record.parts.weekday} · ${record.parts.year}`));}
   else heading.append(element('span','','日期待确认'));
   heading.append(element('span','group-count',`${visible.filter(r=>(r.parts?`${r.parts.year}-${r.parts.month}-${r.parts.day}`:'unknown')===dateKey).length} 条录音`));
   groupList=element('div','recording-group-list');group.append(heading,groupList);fragment.append(group);
  }
  const row=element('article','recording-row');row.dataset.recordingId=record.transId;
  const stamp=element('div','recording-date');
  stamp.append(element('span','recording-period',record.parts?(Number(record.parts.hour)<12?'上午':Number(record.parts.hour)<18?'下午':'晚上'):'时间待确认'),element('span','recording-time',record.parts?`${record.parts.hour}:${record.parts.minute}`:'—'));
  const content=element('div','recording-content'),meta=element('div','recording-meta');
  meta.append(element('span','recording-duration',record.duration));
  const job=jobs.get(record.url);if(job&&['waiting','draft','applying'].includes(job.status))meta.append(element('span','recording-state','标题整理中'));
  const heading=element('h3','recording-title');
  if(record.url){const link=element('a','recording-link',record.title);link.href='#recording/'+encodeURIComponent(record.transId);link.title='查看内容大纲：'+record.rawTitle;heading.append(link);}else heading.textContent=record.title;
  const trailing=element('div','recording-action');if(record.url){
   const original=element('a','recording-open','听悟回放 ↗');original.href=record.url;original.target='_blank';original.rel='noopener noreferrer';original.setAttribute('aria-label',`在听悟回放：${record.rawTitle}`);meta.append(element('span','meta-separator','·'),original);
   const outline=element('a','recording-outline','查看大纲 →');outline.href='#recording/'+encodeURIComponent(record.transId);outline.setAttribute('aria-label',`查看大纲：${record.title}`);trailing.append(outline);
  }
  trailing.append(deletionUI.button({transId:record.transId},record.rawTitle));
  content.append(heading,meta);if(record.deletionWarning)content.append(element('p','deletion-warning',record.deletionWarning));
  row.append(stamp,content,trailing);groupList.append(row);
 }
 if(!visible.length){const empty=element('div','library-empty');empty.append(element('strong','',query?'没有找到这条录音':error?'暂时还没读到录音':library.updatedAt?'还没有已保存的录音':'正在连接你的听悟'),element('p','',query?'换个标题关键词，或试试录音日期。':error?'请保留一个已登录的听悟标签页，再点击「刷新列表」。':library.updatedAt?'在听悟结束并保存后，录音会出现在这里。':'第一次同步需要一点时间，之后打开就能看到记录。'));fragment.append(empty);}
 list.replaceChildren(fragment);
}
function showPage(name){
 const isLibrary=name==='library';
 if(name!=='classroom')classroomUI.close();
 for(const page of ['library','settings','detail','classroom'])$('#'+page+'-page').hidden=page!==name;
 if(name!=='detail'){detailSelected=null;detailGeneration++;clearTimeout(detailTimer);}
 for(const [id,selected] of [['#library-tab',name==='library'||name==='detail'],['#settings-tab',name==='settings'],['#classroom-tab',name==='classroom']]){const button=$(id);button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 document.title=name==='classroom'?'听课搭子 · 实时课堂':name==='detail'?'听课搭子 · 录音大纲':isLibrary?'听课搭子 · 我的录音':'听课搭子 · 课表与设置';
 window.scrollTo(0,isLibrary?libraryScroll:0);
}
async function requestLibraryRefresh(manual=false){
 if(libraryRequest||state?.runtime?.libraryBusy)return;
 libraryRequest=true;libraryAttemptAt=Date.now();libraryRequestError='';renderLibrary();
 try{const result=await api('recordings-refresh');libraryDeferred=!!result.deferred;await refresh();}
 catch(error){libraryRequestError=error.message;if(manual)toast(error.message);}
 finally{libraryRequest=false;renderLibrary();}
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
function showServiceDisconnected(){
 $('#service-alert').hidden=false;
 $('#status-title').textContent='后台连接中断';$('#status-dot').classList.remove('on');
 $('#run-health').textContent='自动录音状态待确认，正在等待后台恢复。';$('#run-health').classList.add('warning');
 $('#next').textContent='课表设置已保留，恢复连接后继续执行。';
 for(const kind of ['morning','afternoon']){const label=$('#'+kind+'-session-state');label.textContent='服务待恢复';label.className='session-state warning';}
}
async function refresh(fields=false){
 try{
  const r=await fetch('/api/status',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('桌面服务未连接');const nextState=await r.json();
  if(!state||state.runtime?.startedAt!==nextState.runtime?.startedAt){
   // A recovered service has a new request token; keep existing app tabs usable.
   const response=await fetch('/',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('桌面服务正在恢复');
   const fresh=new DOMParser().parseFromString(await response.text(),'text/html').querySelector('meta[name="tingwu-token"]')?.content;
   if(!fresh)throw Error('尚未取得新的连接信息');token=fresh;$('meta[name="tingwu-token"]').content=fresh;
  }
  const first=!state;state=nextState;$('#service-alert').hidden=true;render(fields||first);
 }catch(error){showServiceDisconnected();throw error;}
}
function on(selector,fn){$(selector).addEventListener('click',async()=>{const b=$(selector);b.disabled=true;try{await fn();await refresh();}catch(e){toast(e.message);}finally{b.disabled=false;}});}
async function save(enabled=state.settings.enabled){const settings={enabled,...Object.fromEntries(['morning','noon','afternoon','evening'].map(k=>[k,$('#'+k).value]))};const result=await api('save',{settings});toast(result.message);await refresh(true);}
let detailSelected=null,detailGeneration=0,detailTimer,detailData=null,detailRenderKey='',detailView='map',libraryScroll=0;
function timeLabel(seconds){if(!Number.isFinite(seconds))return '';const n=Math.floor(seconds);return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
// Mind-map nodes keep their full source text; compact labels never replace it.
const mindmapState={root:null,nodes:[],collapsed:new Set(),zoom:1,width:0,height:0,needsFit:true,autoWidth:true,selected:null,drawFrame:0};
function compactMapLabel(text,max=30){
 const value=String(text||'').replace(/\s+/g,' ').trim();if(value.length<=max)return value;
 const clause=value.split(/[，,；;。！？]/)[0];return (clause.length>=10&&clause.length<=max?clause:value.slice(0,max))+'…';
}
function buildMindmap(detail,title){
 const noteNode=(note,key,color)=>({key,kind:'note',color,text:note.text,label:compactMapLabel(note.text,32),source:(note.source==='local'?'本机笔记':'听悟笔记')+(note.matchedBy==='time'?' · 按时间对应':note.matchedBy==='keywords'?' · 按关键词对应':''),children:[]});
 const children=detail.chapters.map((chapter,i)=>{
  const key='topic-'+i,color=i%6,points=chapter.points.map((point,j)=>({key:key+'-point-'+j,kind:'point',color,text:point,label:compactMapLabel(point),source:chapter.source==='transcript'?'转写原文摘录':'录音要点',children:[]}));
  if(chapter.notes.length)points.push({key:key+'-notes',kind:'note-group',color,text:'你的笔记',label:`你的笔记 · ${chapter.notes.length} 段`,source:'课堂笔记',children:chapter.notes.map(n=>noteNode(n,key+'-'+n.id,color))});
  return {key,kind:'topic',color,text:chapter.title,label:chapter.title,source:`第 ${i+1} 章`,children:points};
 });
 if(detail.notes.unmatched.length)children.push({key:'supplement',kind:'topic',color:children.length%6,text:'笔记补充',label:'笔记补充',source:'暂未对应具体章节的笔记',children:detail.notes.unmatched.map(n=>noteNode(n,'supplement-'+n.id,children.length%6))});
 mindmapState.root={key:'root',kind:'root',color:0,text:title,label:title,source:'课堂主题',children};
 mindmapState.needsFit=true;mindmapState.autoWidth=true;mindmapState.selected=null;$('#mindmap-inspector').hidden=true;
 $('#mindmap-count').textContent=`${detail.chapters.length} 个章节 · ${detail.notes.items.length} 段笔记`;
}
function mapVisibleChildren(node){return mindmapState.collapsed.has(node.key)?[]:node.children;}
function mapExpandableNodes(node=mindmapState.root){if(!node)return [];return [...(node.kind!=='root'&&node.children.length?[node]:[]),...node.children.flatMap(n=>mapExpandableNodes(n))];}
function updateExpandLabel(){
 const expanded=detailView==='map'?mapExpandableNodes().some(n=>!mindmapState.collapsed.has(n.key)):[...document.querySelectorAll('.map-branch')].some(e=>e.open);
 $('#detail-expand').textContent=expanded?'收起全部':'展开全部';
}
function closeMapInspector(restoreFocus=false){
 const key=mindmapState.selected;mindmapState.selected=null;$('#mindmap-inspector').hidden=true;
 for(const node of mindmapState.nodes)node.button?.classList.remove('is-selected');
 if(restoreFocus)mindmapState.nodes.find(n=>n.key===key)?.button.focus({preventScroll:true});
}
function selectMapNode(node){
 mindmapState.selected=node.key;for(const n of mindmapState.nodes)n.button.classList.toggle('is-selected',n.key===node.key);
 $('#mindmap-inspector-source').textContent=node.source;$('#mindmap-inspector-title').textContent=node.kind==='root'?'课堂主题':node.kind==='point'?'录音要点':node.kind==='note'?'你的笔记':node.text;
 const body=$('#mindmap-inspector-content');body.replaceChildren(element('p','',node.text));
 if(node.children.length){const list=element('ul','');for(const child of node.children)list.append(element('li','',child.text));body.append(list);}
 $('#mindmap-inspector').hidden=false;$('#mindmap-inspector-title').focus({preventScroll:true});
}
function scheduleMindmapDraw(){
 cancelAnimationFrame(mindmapState.drawFrame);mindmapState.drawFrame=requestAnimationFrame(()=>{if(detailView==='map'&&!$('#detail-page').hidden)drawMindmap();});
}
function drawMindmap(anchorKey=null){
 const m=mindmapState,v=$('#mindmap-viewport');if(!m.root||!v.clientWidth)return;
 const oldAnchor=m.nodes.find(n=>n.key===anchorKey),anchor=oldAnchor?{x:(oldAnchor.x+oldAnchor.width/2)*m.zoom-v.scrollLeft,y:(oldAnchor.y+oldAnchor.height/2)*m.zoom-v.scrollTop}:null;
 const focusKey=document.activeElement?.dataset.mapToggle;
 const layer=$('#mindmap-nodes'),svg=$('#mindmap-lines');layer.replaceChildren();svg.replaceChildren();m.nodes=[];
 const walk=(node,depth)=>{
  node.depth=depth;node.width=node.kind==='root'?232:node.kind==='topic'?238:node.kind==='note-group'?220:274;
  const button=element('button',`mind-node mind-${node.kind} map-color-${node.color}`);button.dataset.mapKey=node.key;button.title=node.text;button.setAttribute('aria-label',node.source+'：'+node.text+'。查看全文');button.style.width=node.width+'px';
  if(node.kind==='note')button.append(element('span','mind-note-icon','✎'));
  button.classList.toggle('is-selected',m.selected===node.key);button.append(element('span','mind-node-label',node.label));button.onclick=()=>selectMapNode(node);layer.append(button);node.button=button;
  node.height=button.offsetHeight;node.x=[38,352,674,1028][depth]??(1028+(depth-3)*352);m.nodes.push(node);
  const kids=mapVisibleChildren(node);for(const child of kids)walk(child,depth+1);
  node.gap=node.kind==='root'?34:12;
  node.childrenHeight=kids.reduce((total,c)=>total+c.span,0)+Math.max(0,kids.length-1)*node.gap;
  node.span=Math.max(node.height,node.childrenHeight);
 };
 walk(m.root,0);
 const place=(node,top)=>{
  node.y=top+(node.span-node.height)/2;node.button.style.left=node.x+'px';node.button.style.top=node.y+'px';
  let next=top+(node.span-node.childrenHeight)/2;for(const child of mapVisibleChildren(node)){place(child,next);next+=child.span+node.gap;}
 };
 place(m.root,36);m.width=Math.max(...m.nodes.map(n=>n.x+n.width))+40;m.height=m.root.span+72;
 svg.setAttribute('width',m.width);svg.setAttribute('height',m.height);svg.setAttribute('viewBox',`0 0 ${m.width} ${m.height}`);
 for(const parent of m.nodes){
  for(const child of mapVisibleChildren(parent)){
   const path=document.createElementNS('http://www.w3.org/2000/svg','path'),x1=parent.x+parent.width,y1=parent.y+parent.height/2,x2=child.x,y2=child.y+child.height/2,bend=Math.min(76,(x2-x1)*.58);
   path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);path.setAttribute('class',`mind-edge map-color-${child.color}${parent.kind==='root'?' main-edge':''}`);svg.append(path);
  }
  if(parent.kind!=='root'&&parent.children.length){
   const closed=m.collapsed.has(parent.key),toggle=element('button',`mind-toggle map-color-${parent.color}`,closed?'+':'−');toggle.dataset.mapToggle=parent.key;toggle.style.left=(parent.x+parent.width+7)+'px';toggle.style.top=(parent.y+parent.height/2-11)+'px';toggle.setAttribute('aria-expanded',String(!closed));toggle.setAttribute('aria-label',(closed?'展开':'收起')+'分支：'+parent.text);
   toggle.onclick=()=>{closeMapInspector();if(closed)m.collapsed.delete(parent.key);else m.collapsed.add(parent.key);drawMindmap(parent.key);};layer.append(toggle);
  }
 }
 $('#mindmap-canvas').style.width=m.width+'px';$('#mindmap-canvas').style.height=m.height+'px';
 if(m.needsFit){m.needsFit=false;fitMindmap('auto');}else{applyMindmapZoom(m.zoom,false);if(anchor){const updated=m.nodes.find(n=>n.key===anchorKey);if(updated){v.scrollLeft=(updated.x+updated.width/2)*m.zoom-anchor.x;v.scrollTop=(updated.y+updated.height/2)*m.zoom-anchor.y;}}}
 if(focusKey)[...layer.querySelectorAll('[data-map-toggle]')].find(e=>e.dataset.mapToggle===focusKey)?.focus({preventScroll:true});
 updateExpandLabel();
}
function applyMindmapZoom(value,keepCenter=true){
 const m=mindmapState,v=$('#mindmap-viewport');if(!m.root)return;
 const center={x:(v.scrollLeft+v.clientWidth/2)/m.zoom,y:(v.scrollTop+v.clientHeight/2)/m.zoom};
 m.zoom=Math.max(.02,Math.min(2.5,value));$('#mindmap-canvas').style.transform=`scale(${m.zoom})`;$('#mindmap-space').style.width=Math.ceil(m.width*m.zoom)+'px';$('#mindmap-space').style.height=Math.ceil(m.height*m.zoom)+'px';
 $('#map-zoom-reset').textContent=Math.round(m.zoom*100)+'%';$('#map-zoom-out').disabled=m.zoom<=.02;$('#map-zoom-in').disabled=m.zoom>=2.5;
 if(keepCenter){v.scrollLeft=center.x*m.zoom-v.clientWidth/2;v.scrollTop=center.y*m.zoom-v.clientHeight/2;}
}
function fitMindmap(mode='auto'){
 const m=mindmapState,v=$('#mindmap-viewport');if(!m.width||!v.clientWidth)return;
 const width=(v.clientWidth-16)/m.width,height=(v.clientHeight-16)/m.height;
 m.autoWidth=mode==='width'||mode==='auto';const scale=mode==='all'?Math.min(width,height):mode==='auto'&&v.clientWidth<600?Math.max(.65,width):width;applyMindmapZoom(Math.min(1,scale),false);
 v.scrollLeft=0;v.scrollTop=mode==='all'?0:Math.max(0,(m.root.y+m.root.height/2)*m.zoom-v.clientHeight/2);
}
function zoomMindmap(factor){mindmapState.autoWidth=false;applyMindmapZoom(mindmapState.zoom*factor);}
$('#map-zoom-in').onclick=()=>zoomMindmap(1.2);$('#map-zoom-out').onclick=()=>zoomMindmap(1/1.2);
$('#map-zoom-reset').onclick=()=>{mindmapState.autoWidth=false;applyMindmapZoom(1);};$('#map-fit-width').onclick=()=>fitMindmap('width');$('#map-fit-all').onclick=()=>fitMindmap('all');
$('#mindmap-inspector-close').onclick=()=>closeMapInspector(true);
$('#detail-map').addEventListener('keydown',e=>{if(e.key==='Escape')closeMapInspector(true);});
const mapViewport=$('#mindmap-viewport');let mapDrag=null;
mapViewport.addEventListener('pointerdown',e=>{
 if(e.pointerType!=='mouse'||e.button!==0||e.target.closest('button'))return;
 mapDrag={id:e.pointerId,x:e.clientX,y:e.clientY,left:mapViewport.scrollLeft,top:mapViewport.scrollTop};mapViewport.setPointerCapture(e.pointerId);mapViewport.classList.add('is-dragging');mapViewport.focus({preventScroll:true});e.preventDefault();
});
mapViewport.addEventListener('pointermove',e=>{if(mapDrag&&mapDrag.id===e.pointerId){mapViewport.scrollLeft=mapDrag.left-(e.clientX-mapDrag.x);mapViewport.scrollTop=mapDrag.top-(e.clientY-mapDrag.y);}});
function endMapDrag(){mapDrag=null;mapViewport.classList.remove('is-dragging');}
mapViewport.addEventListener('pointerup',endMapDrag);mapViewport.addEventListener('pointercancel',endMapDrag);mapViewport.addEventListener('lostpointercapture',endMapDrag);
mapViewport.addEventListener('keydown',e=>{
 if(e.target!==mapViewport)return;
 const moves={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]};
 if(moves[e.key]){e.preventDefault();mapViewport.scrollBy(...moves[e.key]);}else if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fitMindmap();else zoomMindmap(e.key==='-'?1/1.2:1.2);}
});
mapViewport.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoomMindmap(e.deltaY<0?1.08:1/1.08);}},{passive:false});
let mapResizeWidth=0;
new ResizeObserver(()=>{const w=mapViewport.clientWidth;if(w&&w!==mapResizeWidth){mapResizeWidth=w;if(mindmapState.needsFit)scheduleMindmapDraw();else if(mindmapState.autoWidth)fitMindmap();}}).observe(mapViewport);

function setDetailView(view){
 detailView=view;
 for(const name of ['map','outline','notes','transcript']){const tab=$('#'+name+'-tab');tab.classList.toggle('selected',name===view);tab.setAttribute('aria-selected',String(name===view));tab.tabIndex=name===view?0:-1;}
 const tree=view==='map'||view==='outline';$('#detail-map').hidden=view!=='map';$('#detail-tree').hidden=view!=='outline';if(view==='map')scheduleMindmapDraw();
 $('#detail-notes').hidden=view!=='notes';$('#detail-transcript').hidden=view!=='transcript';$('#detail-expand').hidden=!tree;updateExpandLabel();
}
function noteElement(note,associated=false){
 const item=element('div','outline-note');item.dataset.noteId=note.id;
 item.append(element('span','note-label',(note.source==='local'?'本机笔记':'听悟笔记')+(associated?' · '+(note.matchedBy==='time'?'按时间对应':'按关键词对应'):'')),element('p','',note.text));return item;
}
function branchElement(chapter,index,extra=false){
 const branch=element('details','map-branch'+(extra?' extra-notes':''));branch.open=true;branch.id=chapter.id;
 const head=element('summary','branch-heading');head.append(element('span','branch-number',extra?'✎':String(index+1).padStart(2,'0')),element('h3','',chapter.title),element('span','branch-toggle','⌄'));branch.append(head);
 const content=element('div','branch-content');
 if(chapter.start!==null&&chapter.start!==undefined)content.append(element('span','branch-time',`${timeLabel(chapter.start)}${Number.isFinite(chapter.end)?' — '+timeLabel(chapter.end):''}`));
 if(chapter.points?.length){const list=element('ul','branch-points');for(const point of chapter.points)list.append(element('li','',point));content.append(list);}
 for(const note of chapter.notes||[])content.append(noteElement(note,!extra));
 branch.append(content);branch.addEventListener('toggle',()=>{if(detailView==='outline')updateExpandLabel();});return branch;
}
function renderDetailData(detail){
 const key=JSON.stringify([detail.transId,detail.updatedAt,detail.title,detail.notes.localUpdatedAt,detail.notes.localCount]);if(key===detailRenderKey)return;detailRenderKey=key;detailData=detail;
 const title=recordingView(detail).title;$('#detail-title').textContent=title;document.title=title+' · 听课搭子';
 $('#detail-content').hidden=false;$('#detail-empty').hidden=true;
 $('#detail-summary-text').textContent=detail.summary||(detail.chapters.length?'听悟暂未生成全文概要，下面已按完整转写分段摘录，可展开查看原文。':'这条录音暂时没有可整理的转写内容，笔记仍可查看。');
 const notes=detail.notes;
 const editNotes=$('#detail-classroom');editNotes.hidden=!detail.localRecordId;if(detail.localRecordId)editNotes.href='#classroom/'+encodeURIComponent(detail.localRecordId);
 $('#detail-note-badge').textContent=notes.status==='error'?'笔记待同步':notes.items.length?`已结合 ${notes.matched} 段笔记 · 共 ${notes.items.length} 段`:'未记录笔记 · 根据录音整理';
 $('#detail-source').textContent=detail.mode==='tingwu'?'依据听悟全文概要与全部章节整理。笔记按时间或关键词归入章节，未对应的笔记单独保留。':'听悟章节尚未生成，当前为转写分段摘录；全文保留在「转写原文」中。';
 buildMindmap(detail,title);
 $('#detail-warnings').hidden=!detail.warnings.length;$('#detail-warnings').replaceChildren(...detail.warnings.map(w=>element('p','',w)));
 const branches=detail.chapters.map((c,i)=>branchElement(c,i));
 if(notes.unmatched.length)branches.push(branchElement({id:'notes-supplement',title:'笔记补充 · 暂未对应具体章节',notes:notes.unmatched,points:[]},branches.length,true));
 if(!branches.length)branches.push(element('div','library-empty','暂时没有可展示的大纲。听悟生成转写后，可以点「重新整理」。'));
 $('#map-branches').replaceChildren(...branches);
 const noteRows=[element('h2','',`课堂笔记 · ${notes.items.length} 段`)];
 noteRows.push(element('p','detail-source',notes.status==='error'?'笔记区读取失败：'+notes.error:notes.items.length?'保留听悟笔记与本机课堂笔记，按来源标明；本机笔记可点击上方按钮继续编辑。':'这条录音没有文字笔记，已根据录音内容整理大纲。'));
 for(const note of notes.items)noteRows.push(noteElement(note));$('#detail-notes').replaceChildren(...noteRows);
 const transcriptRows=[element('h2','',`转写原文 · ${detail.paragraphs.length} 段`)];
 if(!detail.paragraphs.length)transcriptRows.push(element('p','detail-source','暂未读到转写原文，可重新整理或在听悟查看。'));
 for(const p of detail.paragraphs){const row=element('div','transcript-row');row.append(element('span','transcript-time',timeLabel(p.start)||'—'),element('p','',p.text));transcriptRows.push(row);}$('#detail-transcript').replaceChildren(...transcriptRows);
 setDetailView(detailView);
}
async function loadDetail({refresh=false,poll=false}={}){
 const id=detailSelected,generation=detailGeneration;if(!id)return;
 clearTimeout(detailTimer);
 try{
  const result=await api('recording-detail',{transId:id,refresh,poll});
  if(detailSelected!==id||generation!==detailGeneration)return;
  if(result.detail)renderDetailData(result.detail);
  const waiting=['loading','deferred'].includes(result.status);
  $('#detail-refresh').disabled=waiting;$('#detail-content').setAttribute('aria-busy',String(waiting));
  let health=result.detail?`已整理 · ${new Date(result.detail.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:'';
  if(waiting)health=result.status==='deferred'?'正在等待后台空闲，自动录音优先；稍后自动整理。':result.detail?'正在同步最新内容与笔记，下面可先查看上次整理…':'正在读取整条录音和听悟笔记，首次整理需要一点时间…';
  if(result.error)health=`暂时无法更新：${result.error}${result.detail?'；以下为上次整理。':''}`;
  $('#detail-health').textContent=health;$('#detail-health').classList.toggle('warning',!!result.error);
  if(!result.detail){$('#detail-empty').hidden=false;$('#detail-empty').textContent=result.error?'这次未能读到录音内容，请点击「重新整理」重试。':health;}
  if(waiting)detailTimer=setTimeout(()=>loadDetail({poll:true}),1800);
 }catch(e){if(detailSelected!==id||generation!==detailGeneration)return;$('#detail-refresh').disabled=false;$('#detail-health').textContent='读取失败：'+e.message;$('#detail-health').classList.add('warning');if(!detailData){$('#detail-empty').hidden=false;$('#detail-empty').textContent='请保留一个已登录的听悟标签页，再点击「重新整理」。';}}
}
function openDetail(record){
 if(detailSelected===record.transId&&!$('#detail-page').hidden)return;
 if(!$('#library-page').hidden)libraryScroll=window.scrollY;
 detailGeneration++;clearTimeout(detailTimer);detailSelected=record.transId;detailData=null;detailRenderKey='';detailView='map';mindmapState.collapsed.clear();mindmapState.root=null;closeMapInspector();
 showPage('detail');const r=recordingView(record);$('#detail-title').textContent=r.title;$('#detail-title').focus({preventScroll:true});
 $('#detail-meta').textContent=[r.parts&&`${r.parts.year} 年 ${Number(r.parts.month)} 月 ${Number(r.parts.day)} 日 · ${r.parts.hour}:${r.parts.minute}`,r.duration].filter(Boolean).join('　/　');
 const original=$('#detail-original');original.hidden=!r.url;if(r.url)original.href=r.url;else original.removeAttribute('href');
 $('#detail-classroom').hidden=true;$('#detail-health').textContent='正在读取整条录音和听悟笔记…';$('#detail-health').classList.remove('warning');$('#detail-warnings').hidden=true;$('#detail-content').hidden=true;$('#detail-empty').hidden=false;$('#detail-empty').textContent='正在准备这堂课的内容地图…';$('#detail-refresh').disabled=true;
 loadDetail();
}
function routeView(){
 const live=location.hash.match(/^#classroom(?:\/([\w-]+))?$/);
 if(live){showPage('classroom');classroomUI.open(live[1]||state?.local?.active?.id);return;}
 const match=location.hash.match(/^#recording\/([\w-]+)$/);
 if(match){const record=state?.library?.records.find(r=>r.transId===match[1]);if(record){openDetail(record);return;}toast('录音尚未同步到列表，请刷新后再打开。');}
 showPage(location.hash==='#settings'?'settings':'library');
}
window.addEventListener('hashchange',routeView);
$('#detail-back').addEventListener('click',()=>{location.hash='library';});
$('#detail-refresh').addEventListener('click',()=>{if(detailSelected){$('#detail-refresh').disabled=true;loadDetail({refresh:true});}});
for(const view of ['map','outline','notes','transcript'])$('#'+view+'-tab').addEventListener('click',()=>setDetailView(view));
$('.detail-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const views=['map','outline','notes','transcript'];let i=views.indexOf(detailView);i=event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowRight'?1:3))%4;setDetailView(views[i]);$('#'+views[i]+'-tab').focus();});
$('#detail-expand').addEventListener('click',()=>{
 if(detailView==='map'){const nodes=mapExpandableNodes(),collapse=nodes.some(n=>!mindmapState.collapsed.has(n.key));for(const node of nodes){if(collapse)mindmapState.collapsed.add(node.key);else mindmapState.collapsed.delete(node.key);}closeMapInspector();mindmapState.needsFit=true;drawMindmap();}
 else{const rows=[...document.querySelectorAll('.map-branch')],open=!rows.some(e=>e.open);for(const row of rows)row.open=open;updateExpandLabel();}
});

$('#schedule-form').addEventListener('submit',async e=>{e.preventDefault();try{await save();}catch(e){toast(e.message);}});
on('#naming-toggle',async()=>{toast((await api('naming-toggle',{enabled:!state.naming.enabled})).message);});
on('#naming-inspect',async()=>{toast((await api('naming-inspect')).message);});
on('#toggle',()=>save(!state.settings.enabled));
on('#open',async()=>{const r=await api('open');toast(r.message);});
on('#check',async()=>{await api('check');toast('检查已完成');});
on('#test-start',async()=>{toast((await api('start')).message);});
on('#local-start',async()=>{toast((await api('start')).message);await refresh();location.hash='classroom';routeView();});
on('#local-stop',async()=>{const id=state.local?.active?.id;if(id)toast((await api('local-stop',{id})).message);});
on('#local-permission',async()=>{toast((await api('local-permission')).message);});
on('#test-reminder',async()=>{const r=await api('remind');toast(r.message);});
$('#classroom-tab').addEventListener('click',()=>{if(location.hash==='#classroom')routeView();else location.hash='classroom';});
$('#library-tab').addEventListener('click',()=>{location.hash='library';});
$('#settings-tab').addEventListener('click',()=>{location.hash='settings';});
$('#recording-search').addEventListener('input',renderLibrary);
$('#recordings-refresh').addEventListener('click',()=>requestLibraryRefresh(true));
try{await refresh(true);if(!location.hash&&state.local?.recording)history.replaceState(null,'','#classroom');routeView();if(!state.preview)requestLibraryRefresh();}catch{}
setInterval(async()=>{try{const first=!state;await refresh();if(first)routeView();if(location.hash==='#classroom'&&state.local?.recording&&classroomUI.id!==state.local.active.id)routeView();if(!state.preview&&!document.hidden&&!$('#library-page').hidden&&!state.runtime?.libraryBusy&&Date.now()-libraryAttemptAt>=10000&&(libraryDeferred||Date.now()-(state.library?.updatedAt||0)>=60000))requestLibraryRefresh();}catch{}},5000);
