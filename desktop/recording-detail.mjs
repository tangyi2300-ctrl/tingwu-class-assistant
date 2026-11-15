// Read-only projections of Tingwu's transcript, generated summaries and note editor.
// Source text is data, never executable HTML or instructions for this application.
import {requestTingwu} from './tingwu-api.mjs';
const clean=v=>typeof v==='string'?v.replace(/\r\n?/g,'\n').trim():'';
const sentences=text=>clean(text).match(/[^。！？!?\n]+[。！？!?]?/g)?.map(clean).filter(Boolean)||[];
const cards=data=>Object.values(data?.labCardsMap||{}).flat();
const values=(data,key)=>cards(data).filter(c=>c.key===key&&Number(c.status)===0).flatMap(c=>(c.contents||[]).flatMap(x=>x.contentValues||[]));
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function parseTranscript(data){
 let result=data?.result;
 if(typeof result==='string'){try{result=JSON.parse(result||'{"pg":[]}');}catch{throw Error('听悟转写格式无法识别');}}
 if(!result||!Array.isArray(result.pg))throw Error('听悟尚未返回可读取的转写原文');
 return result.pg.map((p,i)=>{
  if(!Array.isArray(p.sc))throw Error('听悟转写段落格式已变化');
  const words=p.sc;const starts=words.map(w=>number(w.bt)).filter(x=>x!==null),ends=words.map(w=>number(w.et)).filter(x=>x!==null);
  return {id:String(p.pi??i),text:words.map(w=>typeof w.tc==='string'?w.tc:'').join('').trim(),start:starts.length?Math.min(...starts)/1000:null,end:ends.length?Math.max(...ends)/1000:null};
 }).filter(p=>p.text);
}
function decodeEntities(s){return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(m,n)=>{const map={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(map[n])return map[n];try{return String.fromCodePoint(parseInt(n.slice(n[1].toLowerCase()==='x'?2:1),n[1].toLowerCase()==='x'?16:10));}catch{return m;}});}
export function parseNotes(data){
 if(!data||!Object.hasOwn(data,'content'))throw Error('未读到听悟笔记区，请稍后重试');
 const content=data.content;
 if(content===null||content==='')return {status:'empty',items:[],attachments:0};
 if(typeof content!=='string'||content.length>2_000_000)throw Error('笔记格式或长度暂不支持，请在听悟查看');
 let blocks=[],attachments=0;
 const add=(text,heading=false,time=null)=>{text=clean(text);if(text)blocks.push({text,heading,time});};
 if(content.trimStart().startsWith('[')){
  let tree;try{tree=JSON.parse(content);}catch{throw Error('听悟笔记数据不完整，请重新同步');}
  if(!Array.isArray(tree)||tree[0]!=='root')throw Error('听悟笔记格式已变化');
  function textOf(node){
   if(typeof node==='string')return node;
   if(!Array.isArray(node))return '';
   const [tag,attrs,...children]=node;
   if(/^(script|style)$/i.test(tag))return '';
   if(tag==='img'||/image|attachment|video|audio/i.test([attrs?.['data-type'],attrs?.['data-inline-type'],attrs?.['data-card-type'],attrs?.name].filter(Boolean).join(' '))){attachments++;return '〔图片或附件笔记，请在听悟查看〕';}
   if(tag==='br')return '\n';
   return children.map(textOf).join('');
  }
  function visit(node){
   if(!Array.isArray(node))return;
   const [tag,attrs,...children]=node;
   if(/^(p|h[1-6]|li|blockquote|pre|tr)$/.test(tag)){
    const time=number(attrs?.['data-time']);add(textOf(node),/^h[1-6]$/.test(tag),time);return;
   }
   if(tag==='img'||tag==='card'){add(textOf(node));return;}
   for(const child of children)visit(child);
  }
  visit(tree);
  // Some editor versions put inline text directly under root.
  if(!blocks.length){const text=tree.slice(2).map(textOf).join('');add(text);}
 }else if(/^\s*(<!doctype lake>|<)/i.test(content)){
  attachments=(content.match(/<(?:img|video|audio)\b|<card\b[^>]*name=["'](?:image|file)/gi)||[]).length;
  const plain=content.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<(?:img|video|audio)\b[^>]*>/gi,'〔图片或附件笔记，请在听悟查看〕').replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'');
  decodeEntities(plain).split('\n').forEach(line=>add(line));
  if(attachments&&!blocks.length)add('〔图片或附件笔记，请在听悟查看〕');
  if(!blocks.length&&content.replace(/<[^>]*>/g,'').trim())throw Error('笔记内容暂时无法完整解析');
 }else{content.split('\n').forEach(line=>add(line));}
 blocks=blocks.map((b,i)=>({...b,id:`note-${i+1}`}));
 return {status:blocks.length||attachments?'ready':'empty',items:blocks,attachments};
}
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const stop=new Set('这个 那个 一个 我们 你们 他们 可以 需要 就是 然后 以及 进行 通过 如何 关于 相关 内容 讨论 对话 强调 提及 同时 重要 使用 还有 什么 这里 自己 时候'.split(' '));
function terms(text){return new Set([...segmenter.segment(text.toLowerCase())].filter(x=>x.isWordLike&&x.segment.length>1&&!stop.has(x.segment)).map(x=>x.segment));}
function noteMatch(note,chapters,context=''){
 if(note.time!==null){const i=chapters.findIndex(c=>c.start!==null&&c.end!==null&&note.time>=c.start&&note.time<c.end);if(i>=0)return {index:i,matchedBy:'time'};}
 const tokens=terms(note.text),contextTokens=terms(context);const frequencies=new Map();
 const chapterTokens=chapters.map(c=>terms(c.title+' '+c.points.join(' ')));
 for(const set of chapterTokens)for(const t of set)frequencies.set(t,(frequencies.get(t)||0)+1);
 const score=(tokens,set)=>{let s=0,count=0;for(const t of tokens)if(set.has(t)){s+=1+Math.log((chapters.length+1)/(frequencies.get(t)+1));count++;}return {score:s/Math.sqrt(Math.max(tokens.size,1)),count};};
 const ranked=chapterTokens.map((set,i)=>{const direct=score(tokens,set),hint=score(contextTokens,set);return {index:i,score:direct.score+hint.score*.2,count:direct.count};}).sort((a,b)=>b.score-a.score);
 const best=ranked[0],second=ranked[1];
 // Conservative lexical association. Ambiguous/unrelated notes stay visible separately.
 if(best&&best.count>=2&&best.score>=1.3&&(!second||best.score-second.score>=.35))return {index:best.index,matchedBy:'keywords'};
 return null;
}
function transcriptChapters(paragraphs){
 const groups=[];let current=null;
 for(const p of paragraphs){
  if(!current||(p.start!==null&&current.start!==null&&p.start-current.start>=600)||current.characters>=4000){current={id:`chapter-${groups.length+1}`,title:'',points:[],start:p.start,end:p.end,paragraphs:[],characters:0,source:'transcript',notes:[]};groups.push(current);}
  current.paragraphs.push(p);current.characters+=p.text.length;current.end=p.end;
 }
 return groups.map((g,i)=>{
  // Extract across every time segment, retaining the full original below. No invented summary.
  const selected=[...new Set([0,Math.floor(g.paragraphs.length/3),Math.floor(g.paragraphs.length*2/3),g.paragraphs.length-1])].map(n=>g.paragraphs[n]).filter(Boolean);
  const points=selected.map(p=>{const s=sentences(p.text).find(x=>x.length>=8)||p.text;return s.length>240?s.slice(0,240)+'…':s;});
  return {id:g.id,title:`第 ${i+1} 段 · ${points[0]?.slice(0,28)||'录音内容'}${points[0]?.length>28?'…':''}`,points,start:g.start,end:g.end,source:'transcript',notes:[]};
 });
}
export function buildRecordingDetail(record,{lab,transcript,notes,errors={}},now=Date.now()){
 const paragraphs=transcript?parseTranscript(transcript):[];
 const summary=values(lab,'fullSummary').map(v=>clean(v.value)).filter(Boolean).join('\n');
 const agenda=values(lab,'agendaSummary').filter(v=>clean(v.title)||clean(v.value));
 let chapters=agenda.map((v,i)=>({id:`chapter-${i+1}`,title:clean(v.title)||`第 ${i+1} 个主题`,points:sentences(v.value),start:null,end:null,source:'tingwu',notes:[]}));
 const mode=chapters.length?'tingwu':'transcript';
 if(!chapters.length)chapters=transcriptChapters(paragraphs);
 if(!chapters.length&&summary)chapters=[{id:'chapter-1',title:'这条录音讲了什么',points:sentences(summary),start:null,end:null,source:'tingwu',notes:[]}];
 let noteData;try{noteData=errors.notes?{status:'error',error:errors.notes,items:[],attachments:0}:parseNotes(notes);}catch(e){noteData={status:'error',error:e.message,items:[],attachments:0};}
 const unmatched=[];let context='';
 for(const note of noteData.items){
  if(note.heading||/^(第.{1,5}[天章节课]|[一二三四五六七八九十]+[、，,.：:]|\d+[、，.：:])/.test(note.text))context=note.text;
  const match=noteMatch(note,chapters,context);
  if(match)chapters[match.index].notes.push({...note,matchedBy:match.matchedBy});else unmatched.push(note);
 }
 const warnings=[];
 if(errors.lab)warnings.push('听悟概要暂未读到，当前按转写原文分段摘录。');
 if(errors.transcript)warnings.push('转写原文暂未读到；当前显示听悟已生成的概要和章节。');
 if(noteData.status==='error')warnings.push('笔记区读取失败，当前整理尚未结合你的笔记：'+noteData.error);
 if(noteData.attachments)warnings.push('图片或附件笔记暂不识别内容，请在听悟查看原件。');
 return {schema:1,transId:record.transId,title:record.title,url:record.url,recordedAt:record.recordedAt,duration:record.duration,updatedAt:now,summary,chapters,mode,paragraphs,notes:{...noteData,matched:noteData.items.length-unmatched.length,unmatched},warnings};
}
export async function readRecordingDetail(record,request=requestTingwu){
 const results=await Promise.allSettled([
  request({action:'getAllLabInfo',content:['labInfo','labSummaryInfo'],transId:record.transId}),
  request({action:'getTransResult',version:'1.0',transId:record.transId}),
  request({action:'getTransDocEdit',version:'1.0',transId:record.transId})
 ]);
 const sources={},errors={};
 ['lab','transcript','notes'].forEach((key,i)=>{const r=results[i];if(r.status==='fulfilled')sources[key]=r.value.data;else errors[key]=r.reason?.message||'暂时无法读取';});
 // A malformed transcript must not discard a valid generated outline.
 if(sources.transcript){try{parseTranscript(sources.transcript);}catch(e){errors.transcript=e.message;delete sources.transcript;}}
 if(!sources.lab&&!sources.transcript)throw Error('暂时无法读取录音内容：'+(errors.transcript||errors.lab));
 return buildRecordingDetail(record,{...sources,errors});
}
