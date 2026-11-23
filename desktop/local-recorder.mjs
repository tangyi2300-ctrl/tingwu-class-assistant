import {readFile,writeFile,rename,mkdir,readdir,stat,open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function atomicJSON(file,value){await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);}
export async function readJSON(file,fallback=null){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
// Repair only our PCM WAV's length fields after an unclean recorder exit.
// Audio bytes are never changed, and a malformed/non-PCM file is left untouched.
export async function inspectWav(file,{repair=false}={}){
 const fd=await open(file,repair?'r+':'r');
 try{
  const {size}=await fd.stat(),header=Buffer.alloc(Math.min(65536,size));await fd.read(header,0,header.length,0);
  if(header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WAVE')throw Error('不是可恢复的 WAV 音频，已保留原文件');
  let rate=0,align=0,dataOffset=-1,declared=0;
  for(let pos=12;pos+8<=header.length;){
   const kind=header.toString('ascii',pos,pos+4),n=header.readUInt32LE(pos+4);
   if(kind==='fmt '){if(n<16||pos+24>header.length||header.readUInt16LE(pos+8)!==1)throw Error('音频格式不受支持，已保留原文件');rate=header.readUInt32LE(pos+16);align=header.readUInt16LE(pos+20);}
   if(kind==='data'){dataOffset=pos+8;declared=n;break;}pos+=8+n+(n%2);
  }
  if(dataOffset<0||!rate||!align)throw Error('WAV 文件头不完整，已保留原文件');
  const available=Math.floor((size-dataOffset)/align)*align;
  const bytes=repair?available:Math.min(declared,available);
  if(bytes<=0)throw Error('录音没有可用音频，请检查麦克风');
  if(repair){const length=Buffer.alloc(4);length.writeUInt32LE(bytes);await fd.write(length,0,4,dataOffset-4);length.writeUInt32LE(dataOffset+bytes-8);await fd.write(length,0,4,4);await fd.sync();}
  return {durationSeconds:bytes/rate,bytes:size};
 }finally{await fd.close();}
}
export function createLocalRecorder({dir,app,enabled=true,launch=()=>run('/usr/bin/open',['-g','-j',app,'--args',dir],{timeout:10000})}){
 let queue=Promise.resolve(),lastLaunch=0;
 async function status(){
  if(!enabled)return {enabled:false,recording:false,permission:'unavailable'};
  const value=await readJSON(path.join(dir,'status.json'),{}),stale=Date.now()-(value.updatedAt||0)>6000;
  return {...value,enabled:true,stale,recording:!stale&&value.recording===true,error:stale?'本地录音进程未响应':value.error};
 }
 async function ensure(){
  if(!enabled)throw Error('此环境未安装本地录音器');
  await mkdir(path.join(dir,'Recordings'),{recursive:true,mode:0o700});
  if(!(await status()).stale)return;
  if(Date.now()-lastLaunch>5000){lastLaunch=Date.now();await launch();}
  for(let i=0;i<30;i++){await sleep(200);if(!(await status()).stale)return;}
  throw Error('本地录音器尚未启动，请重新打开听课搭子');
 }
 function command(action,recordId,deadline=Date.now()+30000){
  const work=queue.catch(()=>{}).then(async()=>{
   await ensure();const id=randomUUID(),expiresAt=Math.min(deadline,Date.now()+(action==='permission'?120000:30000));
   await atomicJSON(path.join(dir,'command.json'),{id,action,recordId,expiresAt});
   while(Date.now()<expiresAt){const reply=await readJSON(path.join(dir,'reply.json'));if(reply?.id===id){if(!reply.ok)throw Error(reply.message);return reply;}await sleep(200);}
   throw Error('录音器尚未确认操作，请查看当前状态后重试');
  });queue=work;return work;
 }
 async function start(_attemptId,deadline=Infinity){
  await ensure();const before=await status();
  if(!before.recording)await command('start',randomUUID(),deadline);
  const a=await status();await sleep(2500);const b=await status();
  const file=b.active?.id&&path.join(dir,'Recordings',b.active.id+'.wav');
  if(!b.recording||!a.active||a.active.id!==b.active?.id||!(b.active.durationSeconds>a.active.durationSeconds)||!file||(await stat(file)).size<=44)throw Error(b.error||'尚未确认本地音频持续写入');
  return {confirmed:true,recordId:b.active.id,source:before.recording?'existing':'local',elapsedSeconds:b.active.durationSeconds,checkedAt:Date.now(),estimatedStartedAt:b.active.startedAt,message:'本地录音已开始，音频正在写入电脑；请在听课搭子结束并上传'};
 }
 async function health(){
  const s=await status();
  if(!s.recording)return {status:s.stale?'unknown':'stopped',message:s.error||'本地录音已结束',elapsedSeconds:s.active?.durationSeconds};
  const file=path.join(dir,'Recordings',s.active.id+'.wav'),a=await stat(file);await sleep(3000);const b=await stat(file),next=await status();
  return {status:next.recording&&b.size>a.size?'recording':'attention',message:next.recording&&b.size>a.size?'本地音频持续写入':'本地音频未持续写入，请检查麦克风',elapsedSeconds:next.active?.durationSeconds};
 }
 async function records(){
  if(!enabled)return [];
  let names;try{names=await readdir(path.join(dir,'Recordings'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const result=[];
  for(const name of names.filter(n=>/^[a-zA-Z0-9-]{1,80}\.json$/.test(n))){const item=await readJSON(path.join(dir,'Recordings',name));if(item?.id===name.slice(0,-5))result.push({...item,file:path.join(dir,'Recordings',item.id+'.wav')});}
  return result.sort((a,b)=>b.startedAt-a.startedAt);
 }
 return {status,ensure,start,health,records,permission:()=>command('permission'),stop:async id=>command('stop',id),preflight:async()=>{await ensure();const s=await status();if(s.permission!=='authorized')throw Error('请在听课搭子授权麦克风，本地录音不需要听悟在线');}};
}
