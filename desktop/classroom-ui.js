// The transcript never replaces the note editor. Drafts belong to a recording, not a page.
export function createClassroomUI({api}){
 const $=s=>document.querySelector(s),editor=$('#classroom-notes'),sessions=new Map();
 let current=null,visible=false,pollTimer,generation=0,following=true;
 const stamp=n=>{const s=Math.max(0,Math.floor(n||0));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,'0')).join(':');};
 const dirty=s=>s.loaded&&s.text!==s.base;
 const draftKey=id=>'tingwu-classroom-draft:'+id;
 function backup(s){
  if(!s.loaded)return;
  try{if(dirty(s))sessionStorage.setItem(draftKey(s.id),JSON.stringify({text:s.text,revision:s.revision,base:s.base}));else sessionStorage.removeItem(draftKey(s.id));s.storageError=false;}
  catch{s.storageError=true;}
 }
 function setText(s,text){s.text=text;if(current===s){const start=editor.selectionStart,end=editor.selectionEnd;editor.value=text;editor.setSelectionRange(Math.min(start,text.length),Math.min(end,text.length));}}
 function noteStatus(s){
  if(current!==s)return;
  const message=s.conflict?'另一页面已修改，请对照下方内容合并':s.error?'保存失败，输入已保留':s.saving?'正在保存…':dirty(s)?s.storageError?'尚未保存，请保持页面打开':'待保存 · 草稿已保留':s.loaded?'已自动保存到本机':'正在读取笔记…';
  $('#notes-save-state').textContent=message;$('#notes-save-state').classList.toggle('warning',!!s.conflict||!!s.error||!!s.storageError);
  $('#notes-retry').hidden=!s.error||!!s.conflict;$('#notes-conflict').hidden=!s.conflict;
  $('#notes-conflict-saved').textContent=s.conflict?.text||'（已保存版本为空）';
  const sync=s.noteSync;$('#notes-sync-state').textContent=dirty(s)||s.saving?'修改保存后将自动同步听悟':sync?.message||'笔记先存本机，录音上传后自动同步听悟';
  $('#notes-sync-retry').textContent=sync?.status==='conflict'?'已合并，同步到听悟':'重试同步';
  $('#notes-sync-state').classList.toggle('warning',['retrying','conflict'].includes(sync?.status));$('#notes-sync-retry').hidden=!['retrying','conflict'].includes(sync?.status);$('#notes-sync-error').textContent=sync?.error||'';$('#notes-sync-error').hidden=!sync?.error;
  $('#notes-save-error').textContent=s.error||'';$('#notes-save-error').hidden=!s.error;
 }
 function ingest(s,note){
  if(!s.loaded){
   s.loaded=true;s.revision=note.revision;s.base=note.text;setText(s,note.text);
   try{const d=JSON.parse(sessionStorage.getItem(draftKey(s.id))||'null');if(d&&typeof d.text==='string'&&d.text!==note.text){setText(s,d.text);if(d.revision!==note.revision&&d.base!==note.text){s.revision=d.revision;s.base=typeof d.base==='string'?d.base:'';s.conflict=note;}}}
   catch{}
  }else if(note.revision>s.revision&&!s.saving){
   if(dirty(s)&&s.text!==note.text)s.conflict=note;
   else{s.revision=note.revision;s.base=note.text;setText(s,note.text);s.conflict=null;}
  }
  backup(s);if(current===s)editor.disabled=false;noteStatus(s);
  if(dirty(s)&&!s.conflict&&!s.error&&!s.saving&&!s.composing)scheduleSave(s);
 }
 function scheduleSave(s){if(s.timer)return;s.timer=setTimeout(()=>{s.timer=null;save(s);},500);}
 async function save(s){
  if(!dirty(s)||s.saving||s.composing||s.conflict)return;
  clearTimeout(s.timer);s.timer=null;s.saving=true;s.error='';noteStatus(s);
  const text=s.text,revision=s.revision;
  try{const saved=await api('classroom-notes',{id:s.id,text,revision});s.revision=saved.revision;s.base=saved.text;s.error='';s.noteSync=saved.noteSync;}
  catch(e){s.error=e.message;if(e.status===409){s.conflict={text:'正在读取另一页面保存的内容…',revision:null};try{const result=await api('classroom',{id:s.id});s.conflict=result.notes;}catch{}}}
  finally{s.saving=false;backup(s);noteStatus(s);if(dirty(s)&&!s.error&&!s.conflict&&!s.composing)scheduleSave(s);}
 }
 function edited(){if(!current?.loaded)return;current.text=editor.value;current.error='';backup(current);noteStatus(current);if(!current.composing)scheduleSave(current);}
 editor.addEventListener('input',edited);
 editor.addEventListener('compositionstart',()=>{if(current){current.composing=true;clearTimeout(current.timer);current.timer=null;}});
 editor.addEventListener('compositionend',()=>{if(current){current.composing=false;edited();}});
 $('#notes-sync-retry').onclick=async()=>{const s=current;if(!s)return;try{s.noteSync=await api('classroom-sync',{id:s.id,merge:s.noteSync?.status==='conflict'});}catch(e){s.noteSync={status:'retrying',message:'同步暂未完成',error:e.message};}noteStatus(s);};
 $('#notes-retry').onclick=()=>{if(current)save(current);};
 $('#notes-merge').onclick=()=>{const s=current;if(!s?.conflict||!Number.isInteger(s.conflict.revision))return;s.revision=s.conflict.revision;s.base=s.conflict.text;s.conflict=null;s.error='';backup(s);save(s);noteStatus(s);};
 const pane=$('#live-transcript-scroll'),list=$('#live-transcript-list');
 function scrollLatest(){pane.scrollTop=pane.scrollHeight;}
 pane.addEventListener('scroll',()=>{following=pane.scrollHeight-pane.scrollTop-pane.clientHeight<70;$('#transcript-follow').hidden=following;},{passive:true});
 $('#transcript-follow').onclick=()=>{following=true;scrollLatest();$('#transcript-follow').hidden=true;};
 function renderTranscript(t,record){
  const segments=[...(t.segments||[])];if(t.partial?.text)segments.push({...t.partial,partial:true});
  const existing=new Map([...list.children].map(e=>[e.dataset.key,e]));let cursor=list.firstChild;
  for(const segment of segments){
   const key=segment.partial?'partial':String(segment.start);let row=existing.get(key);existing.delete(key);
   if(!row){row=document.createElement('div');row.className='live-text-row';row.dataset.key=key;row.append(document.createElement('time'),document.createElement('p'));}
   row.classList.toggle('is-partial',!!segment.partial);row.firstChild.textContent=stamp(segment.start);
   if(row.lastChild.textContent!==segment.text)row.lastChild.textContent=segment.text;
   if(row!==cursor)list.insertBefore(row,cursor);cursor=row.nextSibling;
  }
  for(const row of existing.values())row.remove();
  $('#live-transcript-empty').hidden=segments.length>0;
  $('#live-transcript-empty').textContent=t.phase==='error'?'转写暂不可用，录音文件仍保存在电脑。':t.phase==='complete'?'这段音频没有识别出文字。':'听到讲话后，文字会显示在这里。';
  const delay=Math.max(0,(record.durationSeconds||0)-(t.processedThrough||0));
  $('#transcript-state').textContent=t.phase==='error'?(t.error||'转写暂不可用；本地录音不受影响'):t.phase==='preparing'?'正在准备中文转写模型…':t.phase==='complete'?'转写已完成':delay>15?`正在补齐已录内容 · 已处理至 ${stamp(t.processedThrough)}`:record.status==='recording'?'正在实时转写':'正在整理最后一段文字…';
  $('#transcript-state').classList.toggle('warning',t.phase==='error');
  if(following)scrollLatest();
 }
 async function poll(s,g){
  if(!visible||current!==s||generation!==g)return;
  try{
   const result=await api('classroom',{id:s.id});if(!visible||current!==s||generation!==g)return;
   $('#classroom-date').textContent=new Date(result.record.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long',hour:'2-digit',minute:'2-digit'});
   $('#classroom-title').textContent=result.record.status==='recording'?'正在听课':'课堂文字与笔记';
   s.noteSync=result.noteSync;ingest(s,result.notes);renderTranscript(result.transcript,result.record);
  }catch(e){if(current===s&&generation===g)$('#transcript-state').textContent='暂时无法更新：'+e.message;}
  finally{if(visible&&current===s&&generation===g)pollTimer=setTimeout(()=>poll(s,g),1000);}
 }
 function close(){visible=false;generation++;clearTimeout(pollTimer);if(current){backup(current);save(current);}}
 function open(id){
  close();visible=true;following=true;$('#transcript-follow').hidden=true;list.replaceChildren();
  $('#classroom-empty').hidden=!!id;$('#classroom-workspace').hidden=!id;$('#classroom-date').textContent='';$('#classroom-title').textContent='实时课堂';
  if(!id){current=null;return;}
  let s=sessions.get(id);if(!s){s={id,loaded:false,text:'',base:'',revision:0};sessions.set(id,s);}current=s;
  editor.value=s.text;editor.disabled=!s.loaded;$('#live-transcript-empty').hidden=false;$('#live-transcript-empty').textContent='正在读取课堂文字…';$('#transcript-state').textContent='正在连接…';noteStatus(s);
  poll(s,generation);
 }
 window.addEventListener('beforeunload',e=>{if([...sessions.values()].some(dirty)){for(const s of sessions.values())backup(s);e.preventDefault();e.returnValue='';}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const s of sessions.values()){backup(s);save(s);}});
 return {open,close,get id(){return current?.id;}};
}
