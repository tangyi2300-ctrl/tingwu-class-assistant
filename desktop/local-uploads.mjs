// Upload API shape follows faceair/TingwuMeetingAgent (Apache-2.0).
// Cookies stay in the signed-in Chrome tab. Short-lived OSS tickets stay private.
import OSS from 'ali-oss';
import {atomicJSON,readJSON,inspectWav} from './local-recorder.mjs';
import {requestTingwu} from './tingwu-api.mjs';
import {stampFromRecord} from './naming.mjs';
import path from 'node:path';
import {clearUploadedAudio} from './audio-retention.mjs';
export function safeUploadDiagnostic(error,ticket){
 let message=String(error?.message||error?.name||'UnknownError');
 for(const value of Object.values(ticket?.sts||{}))if(typeof value==='string'&&value.length>5)message=message.split(value).join('[hidden]');
 return message.replace(/https?:\/\/[^\s"'<>]+/g,'[upload URL]').replace(/[\r\n\t]+/g,' ').slice(0,400);
}
export function uploadBody(record,bytes){
 const stamp=stampFromRecord('',record.startedAt);
 if(!stamp)throw Error('录音开始时间不可用');
 return {action:'generatePutLink',version:'1.0',taskId:'local-'+record.id,useSts:1,fileSize:bytes,dirId:0,fileContentType:'audio/wav',tag:{showName:`${stamp.date} ${stamp.time} 记录`,fileFormat:'wav',fileType:'local',lang:'fspk',roleSplitNum:0,translateSwitch:0,transTargetValue:0,originalTag:'{"isVideo":0}',client:'web'}};
}
export function clientOptions(ticket){
 const s=ticket?.sts,u=new URL(s?.endpoint?.includes('://')?s.endpoint:'https://'+s?.endpoint);
 if(u.protocol!=='https:'||!/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname)||u.port||u.username||u.password||!s?.bucket||!s?.fileKey||!s?.accessKeyId||!s?.accessKeySecret||!s?.securityToken)throw Error('听悟上传凭证无效');
 return {endpoint:u.origin,region:u.hostname.split('.')[0],bucket:s.bucket,accessKeyId:s.accessKeyId,accessKeySecret:s.accessKeySecret,stsToken:s.securityToken,secure:true,timeout:60000};
}
export function createLocalUploads({dir,recorder,request=requestTingwu,makeClient=options=>new OSS(options),onUploaded=async()=>{},log=async()=>{},canUpload=()=>true,isSuppressed=()=>false,isDeleted=()=>false,deletionWarning=()=>'',withAudioCleanup=async(_id,work)=>work(),clearAudio=clearUploadedAudio}){
 const file=path.join(dir,'uploads.json');let jobs={},busy=false,initialized=false,write=Promise.resolve();
 const save=()=>{const snapshot=structuredClone(jobs);write=write.catch(()=>{}).then(()=>atomicJSON(file,snapshot));return write;};
 async function init(){if(!initialized){jobs=await readJSON(file,{});initialized=true;}}
 async function discover(){
  await init();let changed=false;
  for(const record of await recorder.records())if(['saved','interrupted'].includes(record.status)&&!jobs[record.id]&&!record.audioRemovedAt&&!isSuppressed(record.id)){
   jobs[record.id]={id:record.id,startedAt:record.startedAt,status:'waiting',stage:'pending',progress:0,attempts:0,interrupted:record.status==='interrupted'};changed=true;
  }
  if(changed)await save();
 }
 function publicJob(j){return {audioRemovedAt:j.audioRemovedAt||null,audioCleanupError:j.audioCleanupError||null,deletionWarning:deletionWarning(j.id),id:j.id,startedAt:j.startedAt,status:j.status,progress:j.progress,error:j.error,durationSeconds:j.durationSeconds,interrupted:j.interrupted,transId:j.transId,url:j.transId?`https://tingwu.aliyun.com/doc/transcripts/${j.transId}`:null};}
 async function status(){await init();return {busy,jobs:Object.values(jobs).filter(j=>!isDeleted(j.id)).sort((a,b)=>b.startedAt-a.startedAt).slice(0,30).map(publicJob)};}
 async function processOne(job){
  const record=(await recorder.records()).find(r=>r.id===job.id&&['saved','interrupted'].includes(r.status));
  if(!record)throw Error('找不到已保存的本地录音');
  const wav=await inspectWav(record.file,{repair:record.status==='interrupted'});job.durationSeconds=wav.durationSeconds;job.fileSize=wav.bytes;
  if(job.durationSeconds>21600)throw Error('本地音频已完整保留，但超过听悟单文件 6 小时范围，请手动分段上传');
  if(job.stage==='creating')throw Error('上次创建上传任务的结果未确认；为避免重复记录，已暂停。请检查听悟列表后重试');
  if(!job.ticket){
   // Check login/network before creating any remote recording.
   await request({action:'getTransList',version:'1.0',pageNo:1,pageSize:1,filter:{status:[0]}});
   // Persist before the remote mutation. An ambiguous timeout never creates again silently.
   job.stage='creating';await save();
   const response=await request(uploadBody(record,wav.bytes));
   if(!response.data?.transId||!response.data?.getLink)throw Error('听悟没有返回上传任务，音频仍在本机');
   job.ticket={transId:response.data.transId,getLink:response.data.getLink,sts:response.data.sts};job.transId=response.data.transId;job.stage='upload';await save();
  }
  if(job.stage==='upload'){
   const options=clientOptions(job.ticket),client=makeClient(options),key=job.ticket.sts.fileKey;
   // Tingwu grants write-only OSS credentials: HEAD/GetObject is forbidden.
   // Keep a checkpoint and accept only the upload service's success response.
   const result=await client.multipartUpload(key,record.file,{mime:'audio/wav',parallel:2,partSize:5*1024*1024,checkpoint:job.checkpoint,progress:async(p,checkpoint)=>{job.progress=p;if(checkpoint)job.checkpoint=checkpoint;await save();}});
   if(result?.res?.status!==200)throw Error('远端上传结果未确认，本地音频保留');
   job.stage='notify';job.progress=1;delete job.checkpoint;await save();
  }
  if(job.stage==='notify'){
   await request({action:'syncPutLink',version:'1.0',fileLink:job.ticket.getLink,fileSize:wav.bytes,transId:job.transId,duration:Math.floor(wav.durationSeconds)});
   job.stage='done';job.status='uploaded';job.uploadedAt=Date.now();delete job.ticket;delete job.error;await save();
   await log('录音已上传听悟，核对云端音频后自动清理本机临时文件');
   await onUploaded(publicJob(job)).catch(()=>{});
  }
 }
 async function cleanupOne(){
  const job=Object.values(jobs).find(j=>j.status==='uploaded'&&!j.audioRemovedAt&&!isSuppressed(j.id)&&(!j.audioCleanupNextAt||Date.now()>=j.audioCleanupNextAt));
  if(!job)return;
  try{
   const result=await withAudioCleanup(job.id,()=>clearAudio({dir,job,recorder,request,persistEvidence:async evidence=>{Object.assign(job,evidence);await save();}}));
   job.audioRemovedAt=result.audioRemovedAt;delete job.audioCleanupError;delete job.audioCleanupNextAt;await save();
   await log('录音已存入听悟，已清理本机临时音频');
  }catch(e){
   job.audioCleanupError=/^(听悟|云端|录音|本机|临时|正在)/.test(e.message||'')?e.message:'云端核对或本机清理尚未完成，临时录音保留';
   job.audioCleanupNextAt=Date.now()+60000;await save();
  }
 }
 async function tick(){
  if(busy)return;busy=true;
  try{
   await discover();if(!canUpload())return;
   const job=Object.values(jobs).find(j=>!isSuppressed(j.id)&&j.status!=='uploaded'&&j.status!=='attention'&&(!j.nextAttemptAt||Date.now()>=j.nextAttemptAt));
   if(!job){await cleanupOne();return;}job.status='uploading';job.attempts++;delete job.error;await save();
   try{await processOne(job);}catch(error){
    // Do not leak signed URLs, tokens, or SDK request objects into status/logs.
    const known=/^(请|听悟|本地|录音|上次|找不到|不是|音频|WAV|远端|Chrome)/.test(error.message||'');
    const code=String(error.code||error.name||error.status||'NetworkError').replace(/[^\w-]/g,'').slice(0,50)||'NetworkError';
    job.error=known?error.message:'上传暂未完成（'+code+'），本地音频已保留';
    job.diagnostic=safeUploadDiagnostic(error,job.ticket);
    if(error.code==='NoSuchUpload')job.error='远端分片上传结果未确认，请检查听悟记录后处理，本地音频已保留';
    job.status=job.stage==='creating'||/InvalidAccessKeyId|SecurityTokenExpired|AccessDenied|NoSuchUpload/.test(error.code||'')?'attention':'retrying';
    job.nextAttemptAt=Date.now()+Math.min(900000,30000*2**Math.min(job.attempts-1,5));await save();await log(job.error,'warning');
   }
  }finally{busy=false;}
 }
 async function retry(id){
  await init();if(isSuppressed(id))throw Error('该录音已删除或删除结果待核对，不能重新上传');if(busy)throw Error('正在上传，请稍候');const job=jobs[id];if(!job||job.status==='uploaded')throw Error('没有待重试的录音');
  if(job.stage==='creating')job.stage='pending';
  // Expired credentials cannot safely be replaced with a new remote recording.
  if(job.ticket?.sts?.expiration&&Date.parse(job.ticket.sts.expiration)<=Date.now())throw Error('上传凭证已过期，请从本地音频下载文件后在听悟手动上传，避免重复创建记录');
  job.status='waiting';job.nextAttemptAt=0;await save();return {message:'已排队重试，本地音频保留'};
 }
 return {tick,status,discover,retry,deletionTarget:async id=>{await init();const j=jobs[id];return j?{status:j.status,stage:j.stage,transId:j.transId}:null;},forLocal:async id=>{await init();return jobs[id]?publicJob(jobs[id]):null;},localIdFor:async transId=>{await init();return Object.values(jobs).find(j=>j.transId===transId)?.id||null;},get busy(){return busy;}};
}
