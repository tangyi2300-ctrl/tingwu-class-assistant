import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {atomicJSON,readJSON} from './local-recorder.mjs';
import {listSavedRecordings,requestTingwu} from './tingwu-api.mjs';

// A deletion journal also prevents retained audio/notes from being uploaded again.
// Failed/ambiguous mutations require another explicit confirmation; never replay them on startup.
export async function createRecordingDeletion({dir,recorder,uploads,list=listSavedRecordings,request=requestTingwu,now=Date.now}){
 await mkdir(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'recording-deletions.json'),jobs=await readJSON(file,{}),previews=new Map();let busy=false;
 const save=()=>atomicJSON(file,jobs),valid=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
 const entries=()=>Object.values(jobs);
 const matching=(localId,transId)=>entries().filter(j=>localId&&j.localId===localId||transId&&j.transId===transId);
 const suppressed=(localId,transId)=>matching(localId,transId).length>0;
 const deleted=(localId,transId)=>matching(localId,transId).some(j=>j.status==='deleted');
 const warning=(localId,transId)=>matching(localId,transId).find(j=>j.status!=='deleted')?.error||'';
 async function protect(localId){
  if(!localId)return;
  const s=await recorder.status(),record=(await recorder.records()).find(r=>r.id===localId);
  if(record?.status==='recording'||s.active?.id===localId&&(s.recording||s.stale))throw Error('这条录音仍在录制或状态未确认，请先手动结束并保存');
  if(record&&!['saved','interrupted'].includes(record.status))throw Error('录音尚未保存，不能删除');
 }
 async function resolve(selector,previous){
  const {localId,transId}=selector;
  if((!!localId===!!transId)||localId&&!valid(localId)||transId&&!valid(transId))throw Error('请选择一条有效录音');
  let targetLocal=localId||await uploads.localIdFor(transId),remoteId=transId,record;
  await protect(targetLocal);
  if(targetLocal){
   const upload=await uploads.deletionTarget(targetLocal);
   if(upload&&!(upload.status==='uploaded'||upload.stage==='pending'&&!upload.transId))throw Error('这条录音仍在上传或上传结果未确认，请完成上传后再删除');
   if(localId){
    const local=(await recorder.records()).find(r=>r.id===localId);
    if(!local||!['saved','interrupted'].includes(local.status)||deleted(localId))throw Error('没有可删除的已保存录音');
    remoteId=upload?.transId||null;
    record={title:new Date(local.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · 本地录音',recordedAt:local.startedAt};
   }
  }
  let absent=false;
  if(remoteId){
   const rows=await list();record=rows.find(r=>r.transId===remoteId);
   if(!record){
    const prior=previous||matching(null,remoteId).find(j=>j.status!=='deleted');
    if(!prior)throw Error('这条录音不在听悟已保存列表中，请刷新列表');
    record=prior.record;absent=true;
   }else if(record.status!==0)throw Error('听悟录音尚未保存完成，不能删除');
  }
  return {localId:targetLocal||null,transId:remoteId||null,title:record.title,record,absent};
 }
 async function prepare(selector){
  if(busy)throw Error('正在删除录音，请稍候');busy=true;
  try{
   for(const [key,value] of previews)if(value.expiresAt<now())previews.delete(key);
   const target=await resolve(selector),confirmation=randomUUID();
   previews.set(confirmation,{...target,selector,expiresAt:now()+300000});
   return {confirmation,title:target.title,localId:target.localId,transId:target.transId,message:target.transId?'将从 App 列表移除，并同步移入通义听悟回收站。':'将从 App 列表移除，并取消这条录音的自动上传。',backup:'电脑上已有的原始音频、文字和笔记备份会保留。'};
  }finally{busy=false;}
 }
 async function remove({confirmation,confirmed}){
  if(busy)throw Error('正在删除录音，请稍候');
  const preview=previews.get(confirmation);
  if(confirmed!==true||!preview||preview.expiresAt<now())throw Error('删除确认已失效，请重新选择录音');
  previews.delete(confirmation);busy=true;
  try{
   const target=await resolve(preview.selector,preview);
   if(target.localId!==preview.localId||target.transId!==preview.transId||target.title!==preview.title)throw Error('录音标题或上传状态已变化，请重新核对后删除');
   const key=target.transId?'cloud:'+target.transId:'local:'+target.localId;
   const job=jobs[key]={...target,status:'pending',requestedAt:now(),error:'删除结果待核对，请点击删除重新确认；已暂停本条自动上传和笔记同步'};
   await save();
   try{
    if(target.transId&&!target.absent){
     let failure;
     try{await request({action:'delTrans',version:'1.0',transIds:[target.transId],deletePermanently:false});}catch(e){failure=e;}
     // A successful response alone is insufficient. A lost response is recovered
     // by checking the complete saved list, without issuing another mutation.
     if((await list()).some(r=>r.transId===target.transId))throw failure||Error('听悟列表仍有这条录音，暂未确认删除，请稍后重试');
    }
    job.status='deleted';job.deletedAt=now();delete job.error;await save();
    return {localId:target.localId,transId:target.transId,message:target.transId?'已从 App 移除，并核对听悟列表已移除；本机备份保留':'已从 App 移除，已取消自动上传；本机备份保留'};
   }catch(e){job.status='pending';job.error='删除未确认：'+e.message+'；本机备份保留，请重新核对';await save();throw Error(job.error);}
  }finally{busy=false;}
 }
 function records(rows){
  const result=rows.map(r=>({...r,deletionWarning:warning(null,r.transId)}));
  for(const j of entries())if(j.status!=='deleted'&&j.transId&&!result.some(r=>r.transId===j.transId))result.push({...j.record,deletionWarning:j.error});
  return result;
 }
 const cachedRecords=(rows,updatedAt=0)=>records(rows.filter(r=>!entries().some(j=>j.transId===r.transId&&j.status==='deleted'&&j.deletedAt>=(updatedAt||0))));
 return {prepare,remove,suppressed,deleted,warning,records,cachedRecords,get busy(){return busy;}};
}
