// Dialog state lives outside the polled recording lists; polling never changes its target.
export function createDeletionUI({api,onDeleted}){
 const $=s=>document.querySelector(s),dialog=$('#delete-dialog'),confirm=$('#delete-confirm'),cancel=$('#delete-cancel');
 let target=null,preview=null,pending=false,deleting=false,generation=0;
 function close(){if(deleting)return;generation++;pending=false;target=null;preview=null;dialog.close();}
 cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 async function prepare(){
  const current=++generation;preview=null;pending=true;confirm.disabled=true;cancel.disabled=false;
  $('#delete-error').textContent='正在核对这条录音…';
  try{
   const result=await api('recording-delete-prepare',target);
   if(current!==generation)return;
   preview=result;$('#delete-recording-title').textContent=result.title;$('#delete-effect').textContent=result.message;$('#delete-backup').textContent=result.backup;$('#delete-error').textContent='';confirm.textContent=result.transId?'删除并同步听悟':'删除并取消上传';
  }catch(e){if(current===generation){$('#delete-error').textContent=e.message;confirm.textContent='重新核对';}}
  finally{if(current===generation){pending=false;confirm.disabled=false;cancel.disabled=false;}}
 }
 async function open(selector,title){
  if(dialog.open)return;target=selector;$('#delete-recording-title').textContent=title;$('#delete-effect').textContent='确认前将核对录音和上传状态。';$('#delete-backup').textContent='已清理的音频没有本机备份；未确认上传的临时音频及文字、笔记缓存仍保留。';
  dialog.showModal();cancel.focus();await prepare();
 }
 confirm.onclick=async()=>{
  if(pending)return;
  if(!preview){await prepare();return;}
  pending=true;deleting=true;confirm.disabled=true;cancel.disabled=true;$('#delete-error').textContent='正在同步删除，请稍候…';
  try{
   const result=await api('recording-delete',{confirmation:preview.confirmation,confirmed:true});
   pending=false;deleting=false;close();await onDeleted(result);
  }catch(e){preview=null;$('#delete-error').textContent=e.message;confirm.textContent='重新核对';}
  finally{pending=false;deleting=false;confirm.disabled=false;cancel.disabled=false;}
 };
 return {button(selector,title){const b=document.createElement('button');b.className='recording-delete';b.textContent='删除';b.setAttribute('aria-label','删除录音：'+title);b.onclick=()=>open(selector,title);return b;}};
}
