import {START_KINDS,sessions,runnableEvents,preflightEvents} from './scheduler.mjs';
import {clockParts} from '../extension/schedule.js';
// The production timer and tests use this same persisted state machine.
export async function runScheduleCycle({state,now=()=>new Date(),save,start,preflight,remind,notice,log,cancelled=()=>false}){
 for(const field of ['completed','attempts','preflightAttempts','sessionRuns','alerted'])state[field]??={};
 const cutoff=clockParts(new Date(now().getTime()-8*86400000)).date;
 for(const field of ['completed','attempts','preflightAttempts','sessionRuns','alerted'])state[field]=Object.fromEntries(Object.entries(state[field]).filter(([id])=>id.slice(0,10)>=cutoff));
 async function warn(id,message,urgent=false){
  const last=state.alerted[id]||0;
  if(now().getTime()-last<300000)return;
  state.alerted[id]=now().getTime();await save();await notice(message,urgent);
 }
 for(const e of preflightEvents(state.settings,state.completed,now(),state.preflightAttempts)){
  if(cancelled())return;
  state.preflightAttempts[e.id]=now().getTime();await save();
  try{await preflight();state.completed[e.id]=now().getTime();await log('课前连接检查通过，等待计划时间自动录制');}
  catch(err){await log('课前检查未通过：'+err.message,'warning');await warn(e.id,err.message,true);}
 }
 for(const e of runnableEvents(state.settings,state.completed,state.attempts,now())){
  if(cancelled())return;
  if(!START_KINDS.includes(e.kind)){await remind();state.completed[e.id]=now().getTime();await save();continue;}
  const old=state.sessionRuns[e.id]||{};
  const run=state.sessionRuns[e.id]={...old,kind:e.kind,date:e.date,plannedAt:e.plannedAt,status:'starting',attemptCount:(old.attemptCount||0)+1,lastAttemptAt:now().getTime()};
  state.attempts[e.id]=now().getTime();await save();
  try{
   const result=await start(e.id,e.deadline);
   if(cancelled() || result?.cancelled){run.status='cancelled';await save();return;}
   if(!result?.confirmed)throw Error('尚未确认听悟录音计时持续增加');
   Object.assign(run,{status:'confirmed',confirmedAt:now().getTime(),elapsedSeconds:result.elapsedSeconds,error:null});
   state.completed[e.id]=run.confirmedAt;await save();
   await log((run.confirmedAt>=e.classAt?'课内补启动成功':'定时启动成功')+'：已核对听悟录音计时持续增加');
  }catch(err){
   const changed=run.error!==err.message;run.status='retrying';run.error=err.message;run.lastFailureAt=now().getTime();await save();
   if(changed || run.attemptCount===1)await log('自动录音未确认，将在课内继续重试：'+err.message,'warning');
   await warn(e.id,err.message);
  }
 }
 for(const e of sessions(state.settings,now())){
  if(state.completed[e.id])continue;
  if(now().getTime()>=e.deadline){
   if(state.sessionRuns[e.id]?.status==='missed')continue;
   state.sessionRuns[e.id]={...state.sessionRuns[e.id],kind:e.kind,date:e.date,plannedAt:e.plannedAt,status:'missed',error:'本节课结束前未能确认自动录音，请检查运行记录'};
   await save();await log('本节课未确认自动录音：'+e.kind,'warning');await warn(e.id+':missed','本节课未确认自动录音，已停止补开，请查看运行记录',true);
  }else if(now().getTime()>=e.classAt){
   const id=e.id+':class-start';
   if(!state.alerted[id])await warn(id,'已经到上课时间，仍未确认录音开始。程序正在继续重试，请检查听悟页面。',true);
  }
 }
}
