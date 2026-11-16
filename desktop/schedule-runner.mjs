import {START_KINDS,sessions,runnableEvents,preflightEvents} from './scheduler.mjs';
import {clockParts} from '../extension/schedule.js';
// The production timer and tests use this same persisted state machine.
export async function runScheduleCycle({state,now=()=>new Date(),save,start,preflight,verifyRecording,remind,notice,log,cancelled=()=>false}){
 for(const field of ['completed','attempts','preflightAttempts','sessionRuns','alerted'])state[field]??={};
 const cutoff=clockParts(new Date(now().getTime()-8*86400000)).date;
 for(const field of ['completed','attempts','preflightAttempts','sessionRuns','alerted'])state[field]=Object.fromEntries(Object.entries(state[field]).filter(([id])=>id.slice(0,10)>=cutoff));
 async function warn(id,message,urgent=false){
  const last=state.alerted[id]||0;
  if(now().getTime()-last<300000)return;
  state.alerted[id]=now().getTime();await save();await notice(message,urgent);
 }
 async function earlyWarning(e,message){
  const time=now().getTime(),id=e.id+':before-class';
  if(time>=Math.max(e.plannedAt,e.classAt-120000)&&time<e.classAt&&!state.alerted[id]){
   state.alerted[e.id]=time;state.alerted[e.id+':health']=time;
   await warn(id,message,true);return true;
  }
  return false;
 }
 for(const e of preflightEvents(state.settings,state.completed,now(),state.preflightAttempts)){
  if(cancelled())return;
  state.preflightAttempts[e.id]=now().getTime();await save();
  try{await preflight();state.completed[e.id]=now().getTime();await log('课前连接检查通过，等待计划时间自动录制');}
  catch(err){await log('课前检查未通过：'+err.message,'warning');await warn(e.id,err.message,true);}
 }
 // Recheck a confirmed session every 30 seconds until one minute into class.
 // Losing confirmation never clears completion: a manual stop must stay stopped.
 if(verifyRecording)for(const e of sessions(state.settings,now())){
  const run=state.sessionRuns[e.id],time=now().getTime();
  if(!state.completed[e.id]||!run||time<e.plannedAt||time>=e.classAt+60000||time-(run.lastHealthAttemptAt||run.health?.checkedAt||0)<30000)continue;
  if(cancelled())return;
  run.lastHealthAttemptAt=time;await save();
  try{run.health={...await verifyRecording(),checkedAt:now().getTime()};}
  catch(error){run.health={status:'unknown',message:error.message,checkedAt:now().getTime()};}
  await save();
  if(run.health.status!=='recording'){
   const message='课前录音复查未通过：'+run.health.message+'；保留已有录音及手动结束状态，不会重复新建录音。';
   if(now().getTime()>=e.classAt&&!state.alerted[e.id+':class-start']){
    state.alerted[e.id+':health']=now().getTime();
    await warn(e.id+':class-start','已经上课，录音状态仍未通过复查，请查看听悟页面。',true);
   }else if(!await earlyWarning(e,message))await warn(e.id+':health',message,true);
  }
 }
 for(const e of runnableEvents(state.settings,state.completed,state.attempts,now())){
  if(cancelled())return;
  if(!START_KINDS.includes(e.kind)){await remind();state.completed[e.id]=now().getTime();await save();continue;}
  await earlyWarning(e,'距离上课不足两分钟，仍未确认录音开始。程序正在继续重试，请检查听悟登录、麦克风和网络。');
  const old=state.sessionRuns[e.id]||{};
  const run=state.sessionRuns[e.id]={...old,kind:e.kind,date:e.date,plannedAt:e.plannedAt,status:'starting',attemptCount:(old.attemptCount||0)+1,lastAttemptAt:now().getTime()};
  state.attempts[e.id]=now().getTime();await save();
  try{
   const result=await start(e.id,e.deadline);
   if(cancelled() || result?.cancelled){run.status='cancelled';await save();return;}
   if(!result?.confirmed)throw Error('尚未确认听悟录音计时持续增加');
   Object.assign(run,{status:'confirmed',confirmedAt:now().getTime(),elapsedSeconds:result.elapsedSeconds,error:null,source:result.source||'unknown',startClickedAt:result.startClickedAt??null,estimatedStartedAt:result.estimatedStartedAt||null,health:{status:'recording',checkedAt:result.checkedAt||now().getTime(),elapsedSeconds:result.elapsedSeconds,message:'已核对录音计时持续增加'}});
   state.completed[e.id]=run.confirmedAt;await save();
   await log(run.source==='automatic'?(run.confirmedAt>=e.classAt?'课内补自动开启成功':'定时自动开启成功')+'：已自动点击开始，并核对听悟录音计时持续增加':run.source==='existing'?'检测到已有录音：计时持续增加，本次未自动点击开始':'已确认录音在进行；本次未记录启动来源');
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
