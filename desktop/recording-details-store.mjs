import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
export function createRecordingDetails({dir,read,canRead=()=>true,now=Date.now}){
 const entries=new Map();let active=null;
 async function entry(id){
  if(!/^[\w-]{1,80}$/.test(id||''))throw Error('无效录音编号');
  if(!entries.has(id))entries.set(id,(async()=>{let detail=null;try{const c=JSON.parse(await readFile(path.join(dir,id+'.json'),'utf8'));if(c.schema===1&&c.transId===id)detail=c;}catch{}return {detail,status:detail?'ready':'idle',error:null,pending:null};})());
  return entries.get(id);
 }
 async function start(record,e){
  if(active||!canRead()){e.status='deferred';return;}
  active=record.transId;e.status='loading';e.error=null;
  e.pending=(async()=>{
   try{
    const detail=await read(record);detail.updatedAt=now();
    await mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,record.transId+'.json');await writeFile(file+'.tmp',JSON.stringify(detail),{mode:0o600});await rename(file+'.tmp',file);
    e.detail=detail;e.status='ready';
   }catch(error){e.error=error.message;e.status='error';}
   finally{e.pending=null;active=null;}
  })();
 }
 return {
  get busy(){return !!active;},
  async get(record,{refresh=false,poll=false}={}){
   const e=await entry(record.transId);
   if(!e.pending&&(e.status==='deferred'||(!poll&&(refresh||!e.detail||now()-e.detail.updatedAt>=60000))))await start(record,e);
   return {status:e.status,error:e.error,detail:e.detail?{...e.detail,title:record.title}:null};
  }
 };
}
