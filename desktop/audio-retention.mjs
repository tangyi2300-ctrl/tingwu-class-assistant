import {lstat,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {inspectWav,readJSON,atomicJSON} from './local-recorder.mjs';
import {requestTingwu} from './tingwu-api.mjs';

// Signed playback URLs are used in memory only. Never download another local copy.
export async function probeCloudAudio(value,fetcher=fetch){
 let url;try{url=new URL(value);}catch{}
 if(!url||url.protocol!=='https:'||url.port||url.username||url.password||!/^[-\w]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))throw Error('听悟尚未提供可验证的云端音频');
 let response,reader;
 try{
  response=await fetcher(url.href,{headers:{Range:'bytes=0-1023'},redirect:'error',signal:AbortSignal.timeout(10000)});
  reader=response.body?.getReader();
  if(response.status!==206||!/^bytes 0-\d+\/[1-9]\d*$/.test(response.headers.get('content-range')||'')||!/^audio\//i.test(response.headers.get('content-type')||'')||!reader)throw Error();
  const first=await reader.read();if(!first.value?.byteLength)throw Error();
 }catch{throw Error('云端音频暂不可读取，保留临时录音，稍后再核对');}
 finally{if(reader)await reader.cancel().catch(()=>{});else await response?.body?.cancel().catch(()=>{});}
}
export async function clearUploadedAudio({dir,job,recorder,request=requestTingwu,probe=probeCloudAudio,persistEvidence=async()=>{},now=Date.now}){
 if(job.status!=='uploaded'||!/^[a-zA-Z0-9-]{1,80}$/.test(job.id||'')||!/^[\w-]{1,80}$/.test(job.transId||''))throw Error('未确认上传成功，不能清理临时录音');
 const folder=path.join(await realpath(dir),'Recordings'),file=path.join(folder,job.id+'.wav'),meta=path.join(folder,job.id+'.json');
 if(await realpath(folder)!==folder)throw Error('临时音频目录异常，已停止清理');
 async function protect(){
  const s=await recorder.status(),r=(await recorder.records()).find(r=>r.id===job.id);
  if(!r||!['saved','interrupted'].includes(r.status)||s.active?.id===job.id&&(s.recording||s.stale))throw Error('录音尚未结束或状态未确认，不能清理');
  return r;
 }
 const metadata=await readJSON(meta);if(metadata&&metadata.id!==job.id)throw Error('录音元数据编号不一致');
 await protect();
 let before;try{before=await lstat(file);}catch(e){if(e.code!=='ENOENT'||!job.audioVerifiedAt||!job.audioVerifiedBytes)throw e;}
 if(before&&(!before.isFile()||before.isSymbolicLink()))throw Error('临时音频文件异常，已停止清理');
 const wav=before?await inspectWav(file):{bytes:job.audioVerifiedBytes,durationSeconds:job.durationSeconds};
 const response=await request({action:'getTransResult',version:'1.0',transId:job.transId}),cloud=response.data;
 if(!cloud||cloud.transId!==job.transId||cloud.taskId!=='local-'+job.id||cloud.status!==0||cloud.fileSize!==wav.bytes||!Number.isFinite(wav.durationSeconds)||wav.durationSeconds<=0||!Number.isFinite(cloud.duration)||Math.abs(cloud.duration-Math.floor(wav.durationSeconds))>1)throw Error('听悟音频尚未完整确认，临时录音继续保留');
 await probe(cloud.playback);
 // Durable proof permits recovery if the service exits after unlink, before completion.
 await persistEvidence({audioVerifiedAt:now(),audioVerifiedBytes:wav.bytes,durationSeconds:wav.durationSeconds});
 await protect();
 if(before){
  const after=await lstat(file);
  if(!after.isFile()||after.isSymbolicLink()||['ino','dev','size','mtimeMs'].some(k=>before[k]!==after[k]))throw Error('本机音频刚有变化，已取消清理');
  await unlink(file);
 }
 const removedAt=now();
 if(metadata){await atomicJSON(meta,{...metadata,audioRemovedAt:removedAt,cloudTransId:job.transId});}
 return {audioRemovedAt:removedAt,bytes:wav.bytes};
}
