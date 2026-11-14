export function savedURL(value){try{const u=new URL(value);return u.origin==='https://tingwu.aliyun.com' && /^\/doc\/transcripts\/[\w-]+\/?$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}
export const DEFAULT_NAMING={enabled:false,mode:'auto',jobs:[]};
const clean=value=>String(value||'').replace(/[\r\n\t]+/g,' ').replace(/[<>"\\/|:*?]/g,'').trim();
export function recordingDate(title){
 const normalized=String(title).replace(/^(\d{4})年(\d{1,2})月(\d{1,2})日/,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
 const m=normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?!\d)/);
 if(!m)return null;
 const [y,month,d,h,min]=m.slice(1).map(Number),date=new Date(Date.UTC(y,month-1,d));
 if(y<2000 || month<1 || month>12 || date.getUTCDate()!==d || h>23 || min>59)return null;
 return {date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};
}
export function defaultTitle(title){return /^(?:\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日)\s+\d{2}:\d{2}\s+记录$/.test(String(title).trim()) && !!recordingDate(title);}
export function stampFromRecord(title,recordedAt){
 const stamp=recordingDate(title);if(stamp)return stamp;
 if(!Number.isFinite(recordedAt)||recordedAt<946684800000)return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(recordedAt)).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function titleFromMetadata(snapshot,originalTitle){
 const texts=(snapshot.summaryTexts||[]).map(t=>String(t).trim()).filter(Boolean);
 const keywordIndex=texts.indexOf('关键词'),overviewIndex=texts.indexOf('全文概要'),chapterIndex=texts.indexOf('章节速览');
 const overview=overviewIndex>=0?texts.slice(overviewIndex+1,chapterIndex>overviewIndex?chapterIndex:undefined).filter(t=>!/^展开|^\.\.\.$/.test(t) && !['收起','复制','重新生成','点赞','点踩'].includes(t)).join(''):'';
 const chapters=[];
 for(let i=Math.max(0,chapterIndex+1);chapterIndex>=0 && i<texts.length-1;i++){
  if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(texts[i]) && texts[i+1].length>=6 && !/^展开|生成|加载/.test(texts[i+1]) && !/^\d[\d:]+$/.test(texts[i+1]))chapters.push(texts[i+1]);
 }
 const ready=chapters.length>0 || (overview.length>=40 && !/内容太短|生成中|处理中|生成失败|无总结/.test(overview));
 if(!ready){
  if(texts.some(t=>/内容太短|内容不足|字数不足|无总结内容/.test(t)))return {status:'attention',reason:'有效内容不足，保留原标题，等待你补充主题。'};
  if(texts.some(t=>/生成失败|处理失败/.test(t)))return {status:'attention',reason:'听悟内容分析失败，保留原标题。'};
  return {status:'waiting',reason:'等待听悟的概要或章节内容，暂不改名。'};
 }
 const stamp=stampFromRecord(originalTitle,snapshot.recordedAt);
 if(!stamp)return {status:'attention',reason:'原标题没有可确认的录音日期和时间，请手动填写，避免用当前时间代替。'};
 const generic=new Set(['内容','视频','平台','用户','时间','老师','问题','今天','大家','事情','记录','发言人','展开全部']);
 const keywords=keywordIndex>=0 && overviewIndex>keywordIndex?texts.slice(keywordIndex+1,overviewIndex):[];
 const ranked=[...new Set(keywords.map(clean))].filter(t=>t.length>=2 && t.length<=12 && !generic.has(t) && !/展开|生成|加载/.test(t))
 .map((word,index)=>({word,index,score:chapters.filter(c=>c.includes(word)).length*3+(overview.includes(word)?2:0)}))
 .filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.index-b.index);
 const picked=[];
 for(const item of ranked){if(picked.some(w=>w.includes(item.word)||item.word.includes(w)))continue;picked.push(item.word);if(picked.length===3)break;}
 // Prefer the summary's stated subject over a bag of frequent keywords.
 const firstSentence=overview.split(/[，。；！!]/)[0]||'';
 const subjectPrefix=/^(?:本次|此次|这次|本节|这节|本堂|该|这段)?(?:课程|课堂|讨论|对话|会议|讲座|录音|内容|分享)?(?:主要)?(?:围绕|涵盖了?|探讨了?|介绍了?|讲解了?|讲述了?|讨论了?|聚焦于|涉及了?|主题是)/;
 const subject=clean(firstSentence.replace(subjectPrefix,'')
  .replace(/(?:的多个方面|的各个方面|的相关内容|等多个方面|等方面|展开)$/,''));
 const usableSubject=subjectPrefix.test(firstSentence) && subject.length>=5 && subject.length<=30;
 let topic=usableSubject?subject:clean(chapters[0]||'');
 if(!topic && picked.length>=2)topic=picked.join('、');
 if(usableSubject){
  const names=[...new Set((overview.match(/\b[A-Z][A-Za-z0-9.+-]{1,12}\b/g)||[]))].filter(n=>!topic.includes(n)).slice(0,2);
  if(names.length)topic+=`（${names.join('、')}）`;
 }
 if(!topic)return {status:'attention',reason:'尚未提取到明确主题，保留原标题，等待你补充。'};
 topic=Array.from(topic).slice(0,42).join('');
 return {status:'draft',candidate:`${stamp.date}｜${stamp.time}｜${topic}`,topic,reason:'根据听悟概要、章节标题和关键词提炼；日期时间取自原录音标题。',customTitle:!defaultTitle(originalTitle)};
}
export function observeRecordings(previous,tabs,now=Date.now()){
 const state=structuredClone(previous||DEFAULT_NAMING);
 state.jobs??=[];
 for(const tab of tabs){
  const key=`${tab.windowId}:${tab.tabId}`;
  const active=state.jobs.find(j=>j.tabKey===key && j.status==='recording');
  if(tab.url==='https://tingwu.aliyun.com/doc/record'){
   if(!active)state.jobs.unshift({id:`${key}:${now}`,tabKey:key,tabId:tab.tabId,windowId:tab.windowId,originalTitle:tab.title.replace(/ - 通义听悟$/,''),status:'recording',createdAt:now,reason:'录音结束保存后，自动提炼主题并命名。'});
  }else if(active && savedURL(tab.url)){
   const url=savedURL(tab.url);
   // The immutable saved URL is the identity; duplicate tabs never mean two writes.
   if(state.jobs.some(j=>j!==active && j.url===url)){state.jobs=state.jobs.filter(j=>j!==active);continue;}
   Object.assign(active,{url,status:'waiting',savedAt:now,reason:'录音已保存，等待听悟生成可用内容。'});
  }else if(active){Object.assign(active,{status:'attention',reason:'录音页面已离开，未确认保存结果，请打开已保存记录后检查。'});}
 }
 for(const j of state.jobs){if(j.status==='recording' && !tabs.some(t=>`${t.windowId}:${t.tabId}`===j.tabKey))Object.assign(j,{status:'attention',reason:'录音标签页已关闭，未确认保存结果，请在听悟检查。'});}
 // Never discard pending work to make room for history.
 state.jobs=[...state.jobs.filter(j=>!['renamed','skipped'].includes(j.status)),...state.jobs.filter(j=>['renamed','skipped'].includes(j.status)).slice(0,50)];
 return state;
}
export async function prepareTitle(job,read,now=Date.now()){
 const meta=await read(job);
 if(savedURL(meta.url)!==job.url || !meta.title)throw Error('未读取到对应的已保存录音');
 if(meta.title!==job.originalTitle)return {...job,status:'attention',currentTitle:meta.title,reason:'标题已被修改，保留当前标题，不自动覆盖。',checkedAt:now};
 let proposal=titleFromMetadata(meta,job.originalTitle);
 if(proposal.status==='waiting' && Number.isFinite(meta.wordCount) && meta.wordCount<50 && now-job.savedAt>=60000 && meta.summaryStatuses?.length && meta.summaryStatuses.every(s=>[0,3].includes(s))){
  const stamp=stampFromRecord(job.originalTitle,meta.recordedAt),topic=meta.wordCount===0?'空录音（无有效内容）':'内容较少待补充主题';
  if(stamp)proposal={status:'draft',candidate:`${stamp.date}｜${stamp.time}｜${topic}`,topic,customTitle:!defaultTitle(job.originalTitle),reason:'已保存的有效文字较少，使用明确标注，不猜测课程主题。'};
 }
 if(proposal.status==='attention' && /内容不足/.test(proposal.reason) && meta.summaryStatuses?.includes(0)){
  const stamp=stampFromRecord(job.originalTitle,meta.recordedAt);
  if(stamp)proposal={status:'draft',candidate:`${stamp.date}｜${stamp.time}｜内容不足待补充主题`,topic:'内容不足待补充主题',customTitle:!defaultTitle(job.originalTitle),reason:'听悟已完成分析，但有效内容不足；使用明确占位标题，不猜测主题。'};
 }
 if(proposal.status==='waiting' && now-job.savedAt>60*60*1000)proposal.reason='听悟内容仍在整理，保留任务并继续后台重试。';
 return {...job,...proposal,checkedAt:now};
}

// Reconcile persisted records instead of relying on a brief tab URL transition.
export function reconcileSavedRecordings(previous,records,now=Date.now()){
 const state=structuredClone(previous||DEFAULT_NAMING);state.jobs??=[];
 for(const record of records){
  if(record.status!==0||!savedURL(record.url))continue;
  let job=state.jobs.find(j=>j.url===record.url);
  if(job && record.title===job.candidate && job.candidate){Object.assign(job,{status:'renamed',currentTitle:record.title,renamedAt:job.renamedAt||now,reason:'已从听悟重新读取并确认标题保存。'});continue;}
  if(!defaultTitle(record.title)){
   if(job && !['renamed','skipped'].includes(job.status))Object.assign(job,{status:'attention',currentTitle:record.title,reason:'当前标题已修改，保留现有标题。'});
   continue;
  }
  if(!job){job={id:'saved:'+record.url,url:record.url,originalTitle:record.title,status:'waiting',createdAt:now,savedAt:now,reason:'已从已保存记录发现待命名录音，等待概要。'};state.jobs.unshift(job);}
  if(job.status==='skipped'||job.reviewOnly)continue;
  if(job.originalTitle!==record.title){
   if(['','首页','通义听悟'].includes(job.originalTitle)){job.originalTitle=record.title;job.status='waiting';delete job.candidate;}
   else{Object.assign(job,{status:'attention',currentTitle:record.title,reason:'原标题已变化，保留当前标题。'});continue;}
  }
  Object.assign(job,{recordedAt:record.recordedAt,duration:record.duration,wordCount:record.wordCount,keywords:record.keywords||[],lastSeenAt:now});
  if(job.status==='attention' && job.candidate && job.attemptedAt && now-job.attemptedAt>=Math.min(900000,60000*2**Math.min(job.renameAttempts||1,4))){
   try{validateCandidate(job.candidate,record.title);job.status='draft';job.reason='重新核对原标题仍未变化，稍后重试保存同一标题。';}catch{}
  }
  // A title is still unchanged: old parse/closed-tab failures can safely be read again.
  if(job.status==='attention' && !job.attemptedAt && !job.candidate && !job.currentTitle){job.status='waiting';job.checkedAt=0;}
 }
 const byURL=new Set();
 state.jobs=state.jobs.filter(j=>{if(!j.url)return true;if(byURL.has(j.url))return false;byURL.add(j.url);return true;});
 state.lastScannedAt=now;state.savedRecordCount=records.length;
 return state;
}
export function canAutoApply(job,settings){return settings.enabled && settings.mode==='auto' && job.status==='draft' && !job.reviewOnly && !job.customTitle && defaultTitle(job.originalTitle);}
export function validateCandidate(title,original){
 const stamp=recordingDate(original),prefix=stamp?`${stamp.date}｜${stamp.time}｜`:null;
 if(typeof title!=='string' || title.length>100 || /[\r\n\t]/.test(title) || (prefix && !title.startsWith(prefix)) || !/^\d{4}-\d{2}-\d{2}｜\d{2}:\d{2}｜\S.+/.test(title))throw Error('请使用「原录音日期｜开始时间｜主要内容」格式，长度不超过 100 字');
 if(!recordingDate(title.replaceAll('｜',' ')))throw Error('日期或时间无效');
 return title.trim();
}
// Persist intent before touching the website; only confirmed persistence counts.
export async function applyTitle(job,{write,save,now=Date.now()}){
 validateCandidate(job.candidate,job.originalTitle);
 const applying={...job,status:'applying',reason:'正在提交标题并从听悟重新读取确认保存。',attemptedAt:now,renameAttempts:(job.renameAttempts||0)+1};
 await save(applying);
 try{
  const result=await write(applying);
  if(result.title!==job.candidate || !result.persisted)throw Error('未确认新标题已保存');
  const complete={...applying,status:'renamed',renamedAt:Date.now(),reason:'已在通义听悟改名，并重新读取确认保存。'};await save(complete);return complete;
 }catch(e){const uncertain={...applying,status:'attention',reason:`改名结果需要检查：${e.message}。下次先读取当前标题，再决定是否重试。`};await save(uncertain);return uncertain;}
}
