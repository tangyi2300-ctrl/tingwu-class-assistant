import {recordingAdvanced} from './native-status.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const startLabels=new Set(['开始录音','开始记录']);
// Production and tests share the same start/confirmation loop. Seeing a growing
// timer proves a recording exists; only a recorded start click establishes origin.
export async function ensureRecordingStarted({attemptId,deadline=Infinity,prepare,step,now=Date.now,wait=sleep,cancelled=()=>false,onClick=async()=>{},onSample=async()=>{},priorStartClickedAt=null}){
 const until=Math.min(deadline,now()+45000);let previous=null,previousAt=null,lastError=null,startClickedAt=priorStartClickedAt;
 await prepare();
 while(now()<until){
  if(cancelled())return {cancelled:true};
  let result;try{result=await step(attemptId,until);lastError=null;}catch(error){lastError=error;await wait(1500);continue;}
  const observedAt=now();
  if(result.recordingIssue)throw Error('听悟提示：'+result.recordingIssue.message);
  if(result.action==='ongoing'){
   await onSample(result);
   if(result.paused)throw Error('已有录音处于暂停状态，请手动恢复；不会把暂停当作录音成功');
   const plausible=previousAt!==null&&result.elapsedSeconds-previous.elapsedSeconds<=(observedAt-previousAt)/1000+5;
   if(recordingAdvanced(previous,result)&&plausible){
    const estimatedStartedAt=observedAt-result.elapsedSeconds*1000;
    const source=Number.isFinite(startClickedAt)&&estimatedStartedAt>=startClickedAt-5000&&estimatedStartedAt<=startClickedAt+15000?'automatic':'existing';
    return {confirmed:true,source,startClickedAt:source==='automatic'?startClickedAt:null,estimatedStartedAt,elapsedSeconds:result.elapsedSeconds,checkedAt:observedAt};
   }
   previous=result;previousAt=observedAt;
  }else{
   previous=null;previousAt=null;
   if(result.action==='login-required')throw Error('听悟登录已失效，请在 Chrome 完成登录验证；恢复后会在课内自动重试');
   if(result.action==='clicked'){
    if(startLabels.has(result.label))startClickedAt=observedAt;
    await onClick({label:result.label,at:observedAt,isStart:startLabels.has(result.label)});
   }
  }
  await wait(1000);
 }
 throw lastError||Error('尚未确认录音计时持续增加，将重新定位后重试');
}
export async function verifyRecordingHealth({read,wait=sleep}){
 const issue=s=>s.recordingIssue?{status:'attention',elapsedSeconds:s.elapsedSeconds,issueKind:s.recordingIssue.kind,message:'听悟提示：'+s.recordingIssue.message}:null;
 const before=await read();
 if(issue(before))return issue(before);
 if(before.paused)return {status:'paused',elapsedSeconds:before.elapsedSeconds,message:'听悟录音已暂停，需要你手动恢复'};
 if(!before.ongoing)return {status:'not-recording',message:'听悟当前未显示正在录音，请检查页面'};
 await wait(2200);const after=await read();
 if(issue(after))return issue(after);
 if(after.paused)return {status:'paused',elapsedSeconds:after.elapsedSeconds,message:'听悟录音已暂停，需要你手动恢复'};
 if(!after.ongoing)return {status:'not-recording',message:'听悟当前未显示正在录音，请检查页面'};
 if(recordingAdvanced(before,after))return {status:'recording',elapsedSeconds:after.elapsedSeconds,message:'已复查录音计时持续增加'};
 return {status:'stalled',elapsedSeconds:after.elapsedSeconds,message:'听悟录音计时未确认继续增加，请检查页面'};
}
