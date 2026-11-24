import {parseFragment} from 'parse5';
export const NOTE_START='【听课搭子笔记】',NOTE_END='【听课搭子笔记结束】';
export const noteText=s=>String(s??'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.trimEnd()).join('\n').trim();
export function conflict(message='听悟中的同步笔记已被修改，已保留两端内容。请把听悟改动合并到本机笔记，再点「已合并，同步到听悟」。'){const e=Error(message);e.conflict=true;return e;}
const paragraph=text=>['p',{},['span',{'data-type':'text'},['span',{'data-type':'leaf'},text]]];
function treeText(n){return typeof n==='string'?n:Array.isArray(n)?n[0]==='br'?'\n':n.slice(2).map(treeText).join(''):'';}
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function markers(items,text){
 const a=items.map((n,i)=>text(n).trim()===NOTE_START?i:-1).filter(i=>i>=0),b=items.map((n,i)=>text(n).trim()===NOTE_END?i:-1).filter(i=>i>=0);
 if(!a.length&&!b.length)return null;
 if(a.length!==1||b.length!==1||a[0]>=b[0])throw conflict('听悟的笔记同步标记已变化，暂缓同步以保留原内容。');
 return {start:a[0],end:b[0]};
}
// Only the delimited section belongs to this app. All other rich content is retained.
export function openNoteDocument(content){
 if(content===null||content===undefined)content='';
 if(typeof content!=='string'||content.length>2_000_000)throw Error('听悟笔记内容过大或格式不可用');
 if(/^\s*<!doctype lake>/i.test(content)){
  const root=parseFragment(content,{sourceCodeLocationInfo:true});
  const text=n=>n.nodeName==='#text'?n.value:n.nodeName==='br'?'\n':(n.childNodes||[]).map(text).join('');
  const rows=[];function walk(n){if(/^(p|h[1-6])$/.test(n.tagName))rows.push(n);else for(const c of n.childNodes||[])walk(c);}walk(root);
  const range=markers(rows,text),start=range&&rows[range.start],end=range&&rows[range.end];
  if(range&&(!start.sourceCodeLocation||!end.sourceCodeLocation||start.parentNode!==end.parentNode))throw conflict();
  const body=range?content.slice(start.sourceCodeLocation.endOffset,end.sourceCodeLocation.startOffset):'';
  if(/<(img|card|video|audio|table)\b/i.test(body))throw conflict('听悟同步区新增了图片或其他内容，已保留，暂缓覆盖。');
  return {format:'yuque',text:range?noteText(rows.slice(range.start+1,range.end).map(text).join('\n')):null,
   replace(value){const section=value?[NOTE_START,...value.split('\n'),NOTE_END].map(t=>`<p>${escape(t)}</p>`).join(''):'';return range?content.slice(0,start.sourceCodeLocation.startOffset)+section+content.slice(end.sourceCodeLocation.endOffset):content+section;}};
 }
 let tree;
 if(!content.trim())tree=['root',{}];
 else if(content.trimStart().startsWith('[')){try{tree=JSON.parse(content);}catch{throw Error('听悟笔记数据不完整，暂不写入');}}
 else throw Error('这条听悟笔记格式暂不支持同步，原内容和本机笔记均已保留');
 if(!Array.isArray(tree)||tree[0]!=='root'||!tree[1]||typeof tree[1]!=='object')throw Error('听悟笔记结构已变化，暂不写入');
 const rows=tree.slice(2),range=markers(rows,treeText),body=range?rows.slice(range.start+1,range.end):[];
 function safe(n){return typeof n==='string'||Array.isArray(n)&&['p','span','br','strong','b','em','i','u','s','a'].includes(n[0])&&n.slice(2).every(safe);}
 if(body.some(n=>!safe(n)))throw conflict('听悟同步区新增了复杂内容，已保留，暂缓覆盖。');
 return {format:'dingDoc',text:range?noteText(body.map(treeText).join('\n')):null,
  replace(value){const next=structuredClone(tree),nodes=value?[NOTE_START,...value.split('\n'),NOTE_END].map(paragraph):[];next.splice(range?range.start+2:next.length,range?range.end-range.start+1:0,...nodes);return JSON.stringify(next);}};
}
export function prepareNoteUpdate(content,text,previousText){
 const wanted=noteText(text);if(wanted.split('\n').some(s=>[NOTE_START,NOTE_END].includes(s.trim())))throw Error('笔记中包含同步区分隔标题，请修改该行后重试');
 const doc=openNoteDocument(content);
 if(doc.text===wanted||(!wanted&&doc.text===null))return {content,format:doc.format,unchanged:true,text:wanted};
 if(doc.text!==null&&doc.text!==previousText||doc.text===null&&previousText)throw conflict();
 return {content:doc.replace(wanted),format:doc.format,unchanged:false,text:wanted};
}
