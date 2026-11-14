import {randomUUID} from 'node:crypto';
import {chromeCall} from './chrome-process.mjs';
import {savedURL} from './naming.mjs';

const routes={getTransList:'/api/trans/request?getTransList',getTransResult:'/api/trans/getTransResult',getTransTag:'/api/tag/request?getTransTag',getAllLabInfo:'/api/lab/getAllLabInfo',syncTransTag:'/api/tag/request?syncTransTag'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function validateRequest(body){
 if(!routes[body.action])throw Error('不支持的听悟操作');
 if(body.action!=='getTransList' && !/^[\w-]{1,80}$/.test(body.transId||''))throw Error('无效录音编号');
 if(body.action==='syncTransTag' && (Object.keys(body.tag||{}).join(',')!=='showName' || typeof body.tag.showName!=='string' || body.tag.showName.length>100 || /[\r\n\t]/.test(body.tag.showName)))throw Error('只能更新单条录音的标题');
 return routes[body.action];
}
// Requests run inside the existing signed-in tab. No cookies leave Chrome, and
// the browser stays on its current page with its current keyboard focus.
export async function requestTingwu(body){
 const route=validateRequest(body),tab=(await chromeCall('tabs'))[0];
 if(!tab)throw Error('请保留一个已登录的听悟标签页，后台命名会自动恢复');
 const key=randomUUID();
 const script=`(()=>{const tasks=window.__tingwuNamingRequests??=(Object.create(null));const key=${JSON.stringify(key)};tasks[key]={pending:true};const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);fetch(${JSON.stringify(route)},{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body))},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('听悟请求失败 HTTP '+r.status);return r.json();}).then(data=>tasks[key]={data}).catch(e=>tasks[key]={error:e.message}).finally(()=>clearTimeout(timer));return 'started';})()`;
 await chromeCall('script',{...tab,script});
 const deadline=Date.now()+20000;
 try{
  while(Date.now()<deadline){
   const raw=await chromeCall('script',{...tab,script:`JSON.stringify(window.__tingwuNamingRequests?.[${JSON.stringify(key)}]||{error:'听悟页面已重新加载，请稍后重试'})`});
   const result=JSON.parse(raw);
   if(result.pending){await sleep(200);continue;}
   if(result.error)throw Error(result.error);
   if(String(result.data?.code)!=='0' || result.data?.success===false)throw Error('听悟：'+(result.data?.message||'未确认操作成功'));
   return result.data;
  }
  throw Error('听悟请求超时，稍后自动核对');
 }finally{await chromeCall('script',{...tab,script:`delete window.__tingwuNamingRequests?.[${JSON.stringify(key)}];'cleaned'`}).catch(()=>{});}
}
export function normalizeRecord(r){
 if(!/^[\w-]{1,80}$/.test(r.transId||''))throw Error('听悟返回的录音编号无效');
 return {transId:r.transId,url:`https://tingwu.aliyun.com/doc/transcripts/${r.transId}`,title:r.tag?.showName||'',fileType:r.tag?.fileType,status:r.status,recordedAt:r.showTime,duration:r.duration,wordCount:r.wordCount,keywords:Array.isArray(r.yakeKeyWord)?r.yakeKeyWord:[]};
}
export async function listSavedRecordings(){
 const rows=[],seen=new Set();
 for(let pageNo=1;pageNo<=100;pageNo++){
  const r=await requestTingwu({action:'getTransList',version:'1.0',filter:{status:[0],fileTypes:[],beginTime:'',endTime:'',showName:'',read:'',lang:'',client:''},preview:1,pageNo,pageSize:100});
  if(!Array.isArray(r.data)||!Number.isFinite(r.total))throw Error('听悟记录列表格式已变化');
  for(const raw of r.data){const record=normalizeRecord(raw);if(!seen.has(record.transId)){rows.push(record);seen.add(record.transId);}}
  if(rows.length>=r.total)return rows;
  if(!r.data.length)throw Error('听悟记录列表尚未完整返回');
 }
 throw Error('历史记录超过本次扫描上限，尚未完成清点');
}
function recordId(job){const url=savedURL(job.url);if(!url)throw Error('缺少已保存录音的有效链接');return url.split('/').filter(Boolean).at(-1);}
export function metadataFromLab(job,title,data){
 const cards=Object.values(data?.labCardsMap||{}).flat();
 const card=key=>cards.find(c=>c.key===key);
 const values=c=>(c?.contents||[]).flatMap(x=>x.contentValues||[]);
 const summaryTexts=['关键词',...values(card('keyWordsExtractor')).map(x=>x.value),'全文概要',...values(card('fullSummary')).map(x=>x.value),'章节速览'];
 for(const item of values(card('agendaSummary'))){if(item.title)summaryTexts.push('00:00',item.title,item.value||'');}
 const summaryCards=[card('fullSummary'),card('agendaSummary')].filter(Boolean);
 return {url:job.url,title,summaryTexts:summaryTexts.filter(x=>typeof x==='string'),recordedAt:job.recordedAt,duration:job.duration,wordCount:job.wordCount,keywords:job.keywords||[],summaryStatuses:summaryCards.map(c=>c.status)};
}
export async function readRecordingMetadata(job){
 const transId=recordId(job);
 const [tag,lab]=await Promise.all([requestTingwu({action:'getTransTag',version:'1.0',transId}),requestTingwu({action:'getAllLabInfo',content:['labInfo','labSummaryInfo'],transId})]);
 if(!tag.data?.showName)throw Error('未读取到录音原标题');
 return metadataFromLab(job,tag.data.showName,lab.data);
}
// Read before write and read again afterward. A user edit always wins.
export async function writeTitleWithAPI(job,request=requestTingwu){
 const transId=recordId(job),read=async()=>{const r=await request({action:'getTransTag',version:'1.0',transId});return r.data?.showName;};
 const before=await read();
 if(before===job.candidate)return {title:before,persisted:true};
 if(before!==job.originalTitle)throw Error('标题已被修改，保留当前标题');
 await request({action:'syncTransTag',version:'1.0',transId,tag:{showName:job.candidate}});
 for(let i=0;i<4;i++){if(i)await sleep(400);const after=await read();if(after===job.candidate)return {title:after,persisted:true};if(after!==before)throw Error('标题被其他操作修改，请检查当前标题');}
 throw Error('听悟尚未返回已保存的新标题');
}
