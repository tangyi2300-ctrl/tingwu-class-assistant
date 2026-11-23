import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,mkdir,appendFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const runFile=promisify(execFile);
export const SERVICE_LABEL='com.tangyi.tingwuclassassistant.agent';
export const GUARD_LABEL='com.tangyi.tingwuclassassistant.guard';
export function serviceHealthy(status,now=Date.now()){
 if(status?.mode!=='desktop'||!Number.isFinite(status.runtime?.startedAt))return false;
 const runtime=status.runtime;
 if(runtime.lastTickAt===null)return now-runtime.startedAt>=0&&now-runtime.startedAt<15000;
 return Number.isFinite(runtime.lastTickAt)&&now-runtime.lastTickAt>=-5000&&now-runtime.lastTickAt<15000;
}
// This process only supervises the local service. It never controls Chrome,
// records audio, changes the schedule, or clears completed recording sessions.
export async function runServiceGuard({enabled,disabled=false,loaded,probe,recover,previous={},now=()=>Date.now()}){
 const checkedAt=now(),base={...previous,checkedAt};
 if(!enabled)return {...base,status:'paused',failures:0,reason:'课表已暂停，不自动恢复服务'};
 if(disabled)return {...base,status:'disabled',failures:0,reason:'系统已明确禁用此后台项，保留禁用状态'};
 let current,error;
 try{current=await probe();}catch(e){error=e.message;}
 if(serviceHealthy(current,now()))return {...base,status:'healthy',failures:0,reason:null,serviceStartedAt:current.runtime.startedAt};
 const failures=checkedAt-(previous.checkedAt||0)<120000?(previous.failures||0)+1:1;
 if(loaded&&failures<2)return {...base,status:'checking',failures,reason:error||'等待再次核对服务心跳'};
 if(previous.recoveryAttemptAt&&checkedAt-previous.recoveryAttemptAt<60000)return {...base,status:'cooldown',failures,reason:error||'等待上一次恢复完成'};
 const reason=loaded?'服务连续两次未响应或课表心跳停止':'后台任务已移除，重新加载';
 try{
  await recover({restart:loaded});
  return {...base,status:'recovering',failures:0,recoveryAttemptAt:checkedAt,recoveryCount:(previous.recoveryCount||0)+1,reason};
 }catch(e){return {...base,status:'error',failures,recoveryAttemptAt:checkedAt,reason:e.message};}
}

async function main(){
 const base=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
 const data=path.join(base,'data'),guardFile=path.join(data,'service-guard.json');
 const domain=`gui/${process.getuid()}`,target=domain+'/'+SERVICE_LABEL;
 const plist=path.join(homedir(),'Library/LaunchAgents',SERVICE_LABEL+'.plist');
 const launch=async args=>(await runFile('/bin/launchctl',args,{timeout:10000,maxBuffer:1024*1024})).stdout;
 const isLoaded=async()=>{
  try{await launch(['print',target]);return true;}
  catch(e){if(/Could not find service|Could not find specified service/.test(e.stderr||''))return false;throw e;}
 };
 let previous={};try{previous=JSON.parse(await readFile(guardFile,'utf8'));}catch{}
 const state=JSON.parse(await readFile(path.join(data,'state.json'),'utf8'));
 let disabled=false,loaded=false;
 if(state.settings?.enabled){
  const overrides=await launch(['print-disabled',domain]);
  disabled=overrides.split('\n').some(line=>line.includes('"'+SERVICE_LABEL+'"')&&/=>\s*disabled/.test(line));
  if(!disabled)loaded=await isLoaded();
 }
 const result=await runServiceGuard({enabled:state.settings?.enabled===true,disabled,loaded,previous,
  probe:async()=>{
   const response=await fetch('http://127.0.0.1:18766/api/status',{signal:AbortSignal.timeout(4000)});
   if(!response.ok)throw Error('本机服务返回 '+response.status);
   return response.json();
  },
  recover:async({restart})=>{
   // Re-read immediately before recovery so a recent pause wins over this check.
   const latest=JSON.parse(await readFile(path.join(data,'state.json'),'utf8'));
   if(latest.settings?.enabled!==true)throw Error('课表刚刚暂停，取消恢复');
   if(restart){await launch(['kickstart','-k',target]);return;}
   try{await launch(['bootstrap',domain,plist]);}
   catch(e){if(!await isLoaded())throw e;}
   await launch(['kickstart',target]);
  }
 });
 await mkdir(data,{recursive:true,mode:0o700});
 const temporary=guardFile+'.'+process.pid+'.tmp';
 await writeFile(temporary,JSON.stringify(result,null,2),{mode:0o600});await rename(temporary,guardFile);
 if(result.status!==previous.status||result.recoveryCount!==previous.recoveryCount){
  await mkdir(path.join(base,'logs'),{recursive:true});
  await appendFile(path.join(base,'logs/service-guard.log'),`${new Date().toISOString()} ${result.status}: ${result.reason||'服务与课表心跳正常'}\n`,{mode:0o600});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
