const $=s=>document.querySelector(s), token=$('meta[name="tingwu-token"]').content;
let state=null,toastTimer;
let libraryViewKey='',libraryDeferred=false,libraryRequest=false,libraryAttemptAt=0,libraryRequestError='';
const LABELS={morning:'上午课前',noon:'中午下课',afternoon:'下午课前',evening:'下午下课'};
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
async function api(name,data={}){
 const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Tingwu-Token':token},body:JSON.stringify(data)});
 const result=await r.json();if(!r.ok)throw Error(result.error||'操作失败');return result.result;
}
function render(fields=false){
 if(!state)return;
 $('#app-version').textContent=state.preview?'界面预览':`桌面版 · v${state.version||'0.9'}`;
 if(fields)for(const k of ['morning','noon','afternoon','evening'])$('#'+k).value=state.settings[k];
 const on=state.settings.enabled;
 $('#status-title').textContent=on?'自动课表已启用':'自动课表已暂停';$('#toggle').textContent=on?'暂停课表':'启用课表';$('#status-dot').classList.toggle('on',on);
 $('#next').textContent=on&&state.next?`下一次：${new Date(state.next.when).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${LABELS[state.next.kind]}`:'完成登录与连接检查后，可启用自动录音';
 $('#schedule-summary').textContent=`周一至周五 · ${state.settings.morning} / ${state.settings.afternoon}`;
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
 renderLibrary();
 $('#logs').replaceChildren(...(state.logs.length?state.logs.slice(0,8):[{message:'还没有运行记录。'}]).map(item=>{const li=document.createElement('li');li.className=item.level||'';li.textContent=(item.time?new Date(item.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'　':'')+item.message;return li;}));
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
 $('#library-results').textContent=query?`找到 ${visible.length} 条`:`共 ${records.length} 条录音`;
 let health=library.updatedAt?`已同步听悟 · ${new Date(library.updatedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} 更新`:'正在读取听悟录音…';
 if(syncing)health=records.length?'正在更新听悟列表，下面仍可查看…':'正在同步听悟录音…';
 else if(error)health=`暂时无法更新：${error}${records.length?'；以下显示上次同步的记录。':''}`;
 else if(libraryDeferred&&!library.updatedAt)health='正在等待同步，列表会自动更新。';
 else if(libraryDeferred&&Date.now()-library.updatedAt>=60000)health='已显示上次同步的记录，稍后自动更新。';
 $('#library-health').textContent=health;$('#library-health').classList.toggle('warning',!!error);
 const jobs=new Map((state.naming?.jobs||[]).map(j=>[j.url,j]));
 const key=JSON.stringify([visible.map(r=>[r.transId,r.rawTitle,r.sortTime,r.duration,r.url,jobs.get(r.url)?.status]),query,!!library.updatedAt,!!error]);
 if(key===libraryViewKey)return;libraryViewKey=key;
 const list=$('#recording-list'),fragment=document.createDocumentFragment();
 for(const record of visible){
  const row=element('article','recording-row');row.dataset.recordingId=record.transId;
  const stamp=element('div','recording-date');
  stamp.append(element('span','recording-month',record.parts?`${record.parts.year} 年 ${Number(record.parts.month)} 月`:'日期待确认'),element('strong','recording-day',record.parts?record.parts.day:'—'),element('span','recording-weekday',record.parts?.weekday||'已保存录音'));
  const content=element('div','recording-content'),meta=element('div','recording-meta');
  meta.append(element('span','recording-time',record.parts?`${record.parts.hour}:${record.parts.minute} 开始`:'开始时间待确认'),element('span','meta-separator','·'),element('span','recording-duration',record.duration));
  const job=jobs.get(record.url);if(job&&['waiting','draft','applying'].includes(job.status))meta.append(element('span','recording-state','标题整理中'));
  const heading=element('h2','recording-title');
  if(record.url){const link=element('a','recording-link',record.title);link.href='#recording/'+encodeURIComponent(record.transId);link.title='查看内容大纲：'+record.rawTitle;heading.append(link);}else heading.textContent=record.title;
  content.append(meta,heading);
  const trailing=element('div','recording-action');if(record.url){const link=element('a','recording-open','打开听悟 ↗');link.href=record.url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`打开录音：${record.rawTitle}`);trailing.append(link);}
  row.append(stamp,content,trailing);fragment.append(row);
 }
 if(!visible.length){const empty=element('div','library-empty');empty.append(element('strong','',query?'没有找到这条录音':error?'暂时还没读到录音':library.updatedAt?'还没有已保存的录音':'正在连接你的听悟'),element('p','',query?'换个标题关键词，或试试录音日期。':error?'请保留一个已登录的听悟标签页，再点击「刷新列表」。':library.updatedAt?'在听悟结束并保存后，录音会出现在这里。':'第一次同步需要一点时间，之后打开就能看到记录。'));fragment.append(empty);}
 list.replaceChildren(fragment);
}
function showPage(name){
 const isLibrary=name==='library';
 for(const page of ['library','settings','detail'])$('#'+page+'-page').hidden=page!==name;
 if(name!=='detail'){detailSelected=null;detailGeneration++;clearTimeout(detailTimer);}
 for(const [id,selected] of [['#library-tab',name!=='settings'],['#settings-tab',name==='settings']]){const button=$(id);button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 document.title=name==='detail'?'听课搭子 · 录音大纲':isLibrary?'听课搭子 · 我的录音':'听课搭子 · 课表与设置';
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
async function refresh(fields=false){const r=await fetch('/api/status');if(!r.ok)throw Error('桌面服务未连接');state=await r.json();render(fields);}
function on(selector,fn){$(selector).addEventListener('click',async()=>{const b=$(selector);b.disabled=true;try{await fn();await refresh();}catch(e){toast(e.message);}finally{b.disabled=false;}});}
async function save(enabled=state.settings.enabled){const settings={enabled,...Object.fromEntries(['morning','noon','afternoon','evening'].map(k=>[k,$('#'+k).value]))};const result=await api('save',{settings});toast(result.message);await refresh(true);}
let detailSelected=null,detailGeneration=0,detailTimer,detailData=null,detailRenderKey='',detailView='map',libraryScroll=0;
function timeLabel(seconds){if(!Number.isFinite(seconds))return '';const n=Math.floor(seconds);return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function setDetailView(view){
 detailView=view;
 for(const name of ['map','outline','notes','transcript']){const tab=$('#'+name+'-tab');tab.classList.toggle('selected',name===view);tab.setAttribute('aria-selected',String(name===view));tab.tabIndex=name===view?0:-1;}
 const tree=view==='map'||view==='outline';$('#detail-tree').hidden=!tree;$('#detail-tree').classList.toggle('outline-view',view==='outline');$('#detail-tree').setAttribute('aria-labelledby',view==='map'?'map-tab':'outline-tab');
 $('#detail-notes').hidden=view!=='notes';$('#detail-transcript').hidden=view!=='transcript';$('#detail-expand').hidden=!tree;
}
function noteElement(note,associated=false){
 const item=element('div','outline-note');item.dataset.noteId=note.id;
 item.append(element('span','note-label',associated?'你的笔记 · '+(note.matchedBy==='time'?'按时间对应':'按关键词对应'):'你的笔记'),element('p','',note.text));return item;
}
function branchElement(chapter,index,extra=false){
 const branch=element('details','map-branch'+(extra?' extra-notes':''));branch.open=true;branch.id=chapter.id;
 const head=element('summary','branch-heading');head.append(element('span','branch-number',extra?'✎':String(index+1).padStart(2,'0')),element('h3','',chapter.title),element('span','branch-toggle','⌄'));branch.append(head);
 const content=element('div','branch-content');
 if(chapter.start!==null&&chapter.start!==undefined)content.append(element('span','branch-time',`${timeLabel(chapter.start)}${Number.isFinite(chapter.end)?' — '+timeLabel(chapter.end):''}`));
 if(chapter.points?.length){const list=element('ul','branch-points');for(const point of chapter.points)list.append(element('li','',point));content.append(list);}
 for(const note of chapter.notes||[])content.append(noteElement(note,!extra));
 branch.append(content);branch.addEventListener('toggle',()=>{$('#detail-expand').textContent=[...document.querySelectorAll('.map-branch')].some(e=>e.open)?'收起全部':'展开全部';});return branch;
}
function renderDetailData(detail){
 const key=JSON.stringify([detail.transId,detail.updatedAt,detail.title]);if(key===detailRenderKey)return;detailRenderKey=key;detailData=detail;
 const title=recordingView(detail).title;$('#detail-title').textContent=title;document.title=title+' · 听课搭子';
 $('#detail-content').hidden=false;$('#detail-empty').hidden=true;
 $('#detail-summary-text').textContent=detail.summary||(detail.chapters.length?'听悟暂未生成全文概要，下面已按完整转写分段摘录，可展开查看原文。':'这条录音暂时没有可整理的转写内容，笔记仍可查看。');
 const notes=detail.notes;
 $('#detail-note-badge').textContent=notes.status==='error'?'笔记待同步':notes.items.length?`已结合 ${notes.matched} 段笔记 · 共 ${notes.items.length} 段`:'未记录笔记 · 根据录音整理';
 $('#detail-source').textContent=detail.mode==='tingwu'?'依据听悟全文概要与全部章节整理。笔记按时间或关键词归入章节，未对应的笔记单独保留。':'听悟章节尚未生成，当前为转写分段摘录；全文保留在「转写原文」中。';
 $('#map-root-title').textContent=title;$('#map-root-count').textContent=`${detail.chapters.length} 个章节 · ${notes.items.length} 段笔记`;
 $('#detail-warnings').hidden=!detail.warnings.length;$('#detail-warnings').replaceChildren(...detail.warnings.map(w=>element('p','',w)));
 const branches=detail.chapters.map((c,i)=>branchElement(c,i));
 if(notes.unmatched.length)branches.push(branchElement({id:'notes-supplement',title:'笔记补充 · 暂未对应具体章节',notes:notes.unmatched,points:[]},branches.length,true));
 if(!branches.length)branches.push(element('div','library-empty','暂时没有可展示的大纲。听悟生成转写后，可以点「重新整理」。'));
 $('#map-branches').replaceChildren(...branches);
 const noteRows=[element('h2','',`听悟笔记 · ${notes.items.length} 段`)];
 noteRows.push(element('p','detail-source',notes.status==='error'?'笔记区读取失败：'+notes.error:notes.items.length?'保留你在通义听悟笔记区保存的内容与顺序。修改笔记后，点击「重新整理」即可更新。':'这条录音的听悟笔记区没有文字笔记，已根据录音内容整理大纲。'));
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
 detailGeneration++;clearTimeout(detailTimer);detailSelected=record.transId;detailData=null;detailRenderKey='';detailView='map';
 showPage('detail');const r=recordingView(record);$('#detail-title').textContent=r.title;$('#detail-title').focus({preventScroll:true});
 $('#detail-meta').textContent=[r.parts&&`${r.parts.year} 年 ${Number(r.parts.month)} 月 ${Number(r.parts.day)} 日 · ${r.parts.hour}:${r.parts.minute}`,r.duration].filter(Boolean).join('　/　');
 const original=$('#detail-original');original.hidden=!r.url;if(r.url)original.href=r.url;else original.removeAttribute('href');
 $('#detail-health').textContent='正在读取整条录音和听悟笔记…';$('#detail-health').classList.remove('warning');$('#detail-warnings').hidden=true;$('#detail-content').hidden=true;$('#detail-empty').hidden=false;$('#detail-empty').textContent='正在准备这堂课的内容地图…';$('#detail-refresh').disabled=true;
 loadDetail();
}
function routeView(){
 const match=location.hash.match(/^#recording\/([\w-]+)$/);
 if(match){const record=state?.library?.records.find(r=>r.transId===match[1]);if(record){openDetail(record);return;}toast('录音尚未同步到列表，请刷新后再打开。');}
 showPage(location.hash==='#settings'?'settings':'library');
}
window.addEventListener('hashchange',routeView);
$('#detail-back').addEventListener('click',()=>{location.hash='library';});
$('#detail-refresh').addEventListener('click',()=>{if(detailSelected){$('#detail-refresh').disabled=true;loadDetail({refresh:true});}});
for(const view of ['map','outline','notes','transcript'])$('#'+view+'-tab').addEventListener('click',()=>setDetailView(view));
$('.detail-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const views=['map','outline','notes','transcript'];let i=views.indexOf(detailView);i=event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowRight'?1:3))%4;setDetailView(views[i]);$('#'+views[i]+'-tab').focus();});
$('#detail-expand').addEventListener('click',()=>{const rows=[...document.querySelectorAll('.map-branch')],open=!rows.some(e=>e.open);for(const row of rows)row.open=open;$('#detail-expand').textContent=open?'收起全部':'展开全部';});

$('#schedule-form').addEventListener('submit',async e=>{e.preventDefault();try{await save();}catch(e){toast(e.message);}});
on('#naming-toggle',async()=>{toast((await api('naming-toggle',{enabled:!state.naming.enabled})).message);});
on('#naming-inspect',async()=>{toast((await api('naming-inspect')).message);});
on('#toggle',()=>save(!state.settings.enabled));
on('#open',async()=>{const r=await api('open');toast(r.message);});
on('#check',async()=>{await api('check');toast('检查已完成');});
on('#test-start',async()=>{if(confirm('现在启动真实麦克风录音？录音结束后，需要你亲自在通义听悟中点击结束。')){toast('正在进入听悟并自动点击录制…');const r=await api('start');toast(r.message);}});
on('#test-reminder',async()=>{const r=await api('remind');toast(r.message);});
$('#library-tab').addEventListener('click',()=>{location.hash='library';});
$('#settings-tab').addEventListener('click',()=>{location.hash='settings';});
$('#recording-search').addEventListener('input',renderLibrary);
$('#recordings-refresh').addEventListener('click',()=>requestLibraryRefresh(true));
await refresh(true);
routeView();
if(!state.preview)requestLibraryRefresh();
setInterval(async()=>{try{await refresh();if(!state.preview&&!document.hidden&&!$('#library-page').hidden&&!state.runtime?.libraryBusy&&Date.now()-libraryAttemptAt>=10000&&(libraryDeferred||Date.now()-(state.library?.updatedAt||0)>=60000))requestLibraryRefresh();}catch{toast('桌面服务暂时不可用，请重新双击桌面应用');}},5000);
