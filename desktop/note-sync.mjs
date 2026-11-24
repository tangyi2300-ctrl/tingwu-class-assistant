import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {requestTingwu} from './tingwu-api.mjs';
import {openNoteDocument,prepareNoteUpdate,noteText,conflict} from './note-document.mjs';
import {parseNotes} from './recording-detail.mjs';
export function createNoteSync({dir,classroom,uploads,request=requestTingwu,canSync=()=>true,isSuppressed=()=>false,now=Date.now}){
 const file=path.join(dir,'note-sync.json');let jobs={},initializing,busy=false,writes=Promise.resolve();
 const init=()=>initializing??=(async()=>{await mkdir(dir,{recursive:true,mode:0o700});try{jobs=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}})();
 function persist(){const data=JSON.stringify(jobs);writes=writes.catch(()=>{}).then(async()=>{await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file);});return writes;}
 function view(j,local){
  if(!j)return {status:'empty',message:'笔记先存本机，录音上传后自动同步听悟'};
  const status=j.status==='synced'&&j.syncedRevision!==local.revision?'pending':j.status;
  const messages={waiting:'笔记已保存，录音上传后自动同步听悟',pending:'已保存到本机 · 等待同步听悟',syncing:'已保存到本机 · 正在同步听悟…',synced:'已同步到通义听悟',retrying:'暂未同步到听悟 · 将自动重试',conflict:'听悟笔记有改动 · 请合并后重试'};
  return {status,message:messages[status],error:j.error||null,syncedAt:j.syncedAt,syncedRevision:j.syncedRevision,url:j.transId?`https://tingwu.aliyun.com/doc/transcripts/${j.transId}`:null};
 }
 async function queue(id){
  await init();if(isSuppressed(id))throw Error('该录音已删除或删除结果待核对，笔记同步已暂停');const local=await classroom.notes(id);let j=jobs[id];
  if(!j&&!noteText(local.text))return view(null,local);
  let changed=false;if(!j){j=jobs[id]={id,status:'waiting',desiredRevision:local.revision,attempts:0};changed=true;}
  if(j.desiredRevision!==local.revision){j.desiredRevision=local.revision;j.nextAttemptAt=now()+1500;j.status=j.transId?'pending':'waiting';j.error=null;j.attempts=0;changed=true;}
  const upload=await uploads.forLocal(id);
  if(upload?.status==='uploaded'&&upload.transId){
   if(j.transId&&j.transId!==upload.transId)throw Error('笔记对应的听悟记录发生变化，停止同步');
   if(!j.transId){j.transId=upload.transId;j.status='pending';changed=true;}
  }
  if(changed)await persist();return view(j,local);
 }
 async function readRemote(j){const r=await request({action:'getTransDocEdit',version:'1.0',transId:j.transId});if(!r.data||!Object.hasOwn(r.data,'content'))throw Error('听悟尚未返回笔记内容');return {...r.data,content:r.data.content??''};}
 async function syncOne(j){
  const local=await classroom.notes(j.id);let before=await readRemote(j),managed=openNoteDocument(before.content);
  // Recover a lost success response before considering a newer local edit.
  if(j.pending&&(managed.text===j.pending.text||!j.pending.text&&managed.text===null)){
   j.syncedText=j.pending.text;j.syncedRevision=j.pending.revision;j.syncedAt=now();delete j.pending;await persist();
  }
  const next=prepareNoteUpdate(before.content,local.text,j.mergeRevision===local.revision?managed.text:j.syncedText);
  if(!next.unchanged){
   const check=await readRemote(j);
   if(check.content!==before.content)throw Error('听悟笔记刚有更新，稍后重新合并');
   j.pending={revision:local.revision,text:next.text,before:before.content,content:next.content,format:next.format};await persist();
   const backups=path.join(dir,'NoteSyncBackups');await mkdir(backups,{recursive:true,mode:0o700});await writeFile(path.join(backups,j.id+'.json'),JSON.stringify({transId:j.transId,at:now(),...j.pending}),{mode:0o600});
   const body={action:'saveTransDocEdit',version:'1.0',transId:j.transId,content:next.content,tag:{docEditFormat:next.format,hasNote:parseNotes({content:next.content}).items.length>0}};
   const ver=before.ver??before.baseVer;if(Number.isSafeInteger(ver)&&ver>=0)body.baseVer=ver;
   await request(body);
   const after=await readRemote(j);
   if(after.content!==next.content)throw conflict('听悟保存后的内容与本次不同，已保留本机笔记，请核对后重试。');
  }
  j.syncedText=next.text;j.syncedRevision=local.revision;j.syncedAt=now();delete j.pending;delete j.mergeRevision;delete j.error;j.attempts=0;
  j.status=j.desiredRevision===local.revision?'synced':'pending';await persist();
 }
 async function tick(){
  if(busy)return;busy=true;
  try{
   await init();for(const id of await classroom.noteIds())if(!isSuppressed(id))await queue(id);
   if(!canSync())return;
   const j=Object.values(jobs).find(j=>!isSuppressed(j.id)&&j.transId&&!['synced','conflict'].includes(j.status)&&(!j.nextAttemptAt||now()>=j.nextAttemptAt));if(!j)return;
   j.status='syncing';j.error=null;await persist();
   try{await syncOne(j);}catch(e){j.status=e.conflict?'conflict':'retrying';j.attempts++;j.nextAttemptAt=now()+Math.min(300000,15000*2**Math.min(j.attempts-1,4));j.error=e.message;await persist();}
  }finally{busy=false;}
 }
 async function retry(id,{merge=false}={}){await queue(id);const j=jobs[id];if(j&&merge)j.mergeRevision=(await classroom.notes(id)).revision;if(j&&j.status!=='syncing'){j.status=j.transId?'pending':'waiting';j.nextAttemptAt=0;j.error=null;await persist();}return view(j,await classroom.notes(id));}
 return {queue,tick,retry,status:async id=>{await init();return view(jobs[id],await classroom.notes(id));},syncedText:async id=>{await init();return jobs[id]?.syncedText;},get busy(){return busy;}};
}
