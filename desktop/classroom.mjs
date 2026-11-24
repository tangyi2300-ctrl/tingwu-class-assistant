import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const validId=id=>/^[a-zA-Z0-9-]{1,80}$/.test(id||'');
async function readJSON(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}}
export function createClassroom({dir,recorder,executable,enabled=true,launch=(args)=>spawn('/usr/bin/nice',['-n','10',executable,...args],{stdio:'ignore'})}){
 const children=new Map(),writes=new Map();let monitoring=false;
 const transcriptFile=id=>path.join(dir,id+'.transcript.json');
 const noteFile=id=>path.join(dir,id+'.notes.json');
 async function record(id){if(!validId(id))throw Error('课堂编号无效');const r=(await recorder.records()).find(x=>x.id===id);if(!r)throw Error('没有找到对应的本地录音');return r;}
 async function notes(id){if(!validId(id))throw Error('课堂编号无效');return readJSON(noteFile(id),{recordId:id,revision:0,text:'',updatedAt:null});}
 async function saveNotes(id,{text,revision}){
  if(typeof text!=='string'||text.length>100000||!Number.isSafeInteger(revision)||revision<0)throw Error('笔记内容或版本无效');
  await record(id);await mkdir(dir,{recursive:true,mode:0o700});
  const work=(writes.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
   const current=await notes(id);
   if(current.text===text)return current; // A lost success response is safe to retry.
   if(current.revision!==revision){const error=Error('这条笔记已在另一页面修改，已保留你的输入，请重新载入后合并');error.statusCode=409;throw error;}
   const next={recordId:id,text,revision:revision+1,updatedAt:Date.now()};
   await writeFile(noteFile(id)+'.tmp',JSON.stringify(next),{mode:0o600});await rename(noteFile(id)+'.tmp',noteFile(id));return next;
  });writes.set(id,work);return work;
 }
 async function ensure(r){
  if(!enabled)return;
  await mkdir(dir,{recursive:true,mode:0o700});
  const old=await readJSON(transcriptFile(r.id),null);
  if(old?.phase==='complete'||children.has(r.id)||alive(old?.pid))return;
  if(old?.phase==='error'&&Date.now()-old.updatedAt<60000)return;
  const child=launch([r.file,r.file.replace(/\.wav$/,'.json'),transcriptFile(r.id)]);children.set(r.id,child);
  child.once('exit',async code=>{
   children.delete(r.id);
   if(!code)return;
   try{
    const value=await readJSON(transcriptFile(r.id),old||{});
    if(value.phase==='error'||value.phase==='complete'||alive(value.pid))return;
    Object.assign(value,{phase:'error',error:'实时转写进程未能运行，本地录音不受影响',updatedAt:Date.now()});
    await writeFile(transcriptFile(r.id)+'.tmp',JSON.stringify(value),{mode:0o600});await rename(transcriptFile(r.id)+'.tmp',transcriptFile(r.id));
   }catch{}
  });
  child.once('error',async()=>{
   children.delete(r.id);
   const value={...(old||{}),phase:'error',error:'实时转写暂不可用，本地录音仍继续',updatedAt:Date.now()};
   await writeFile(transcriptFile(r.id)+'.tmp',JSON.stringify(value),{mode:0o600}).then(()=>rename(transcriptFile(r.id)+'.tmp',transcriptFile(r.id))).catch(()=>{});
  });
 }
 async function get(id){const r=await record(id);await ensure(r);const s=await recorder.status();return {record:{id:r.id,startedAt:r.startedAt,status:r.status,durationSeconds:s.active?.id===id?s.active.durationSeconds:r.durationSeconds},notes:await notes(id),transcript:await readJSON(transcriptFile(id),{phase:'preparing',segments:[],partial:null,processedThrough:0})};}
 async function monitor(){
  if(!enabled||monitoring)return;monitoring=true;
  try{const s=await recorder.status();if(s.recording&&s.active?.id){const r=await record(s.active.id);await ensure(r);}}
  finally{monitoring=false;}
 }
 async function noteIds(){try{return (await readdir(dir)).filter(n=>/^[a-zA-Z0-9-]{1,80}\.notes\.json$/.test(n)).map(n=>n.slice(0,-11));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 return {get,notes,saveNotes,monitor,noteIds};
}
