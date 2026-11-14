(() => {
  if (window.__tingwuClassDesktopV3?.revision===2) return;
  const tracks=new Set(),media=navigator.mediaDevices;
  if(media?.getUserMedia){const original=media.getUserMedia.bind(media);media.getUserMedia=async(...args)=>{const stream=await original(...args);stream.getAudioTracks().forEach(t=>tracks.add(t));return stream;};}
  function visible(e){
    if(!e?.getClientRects().length)return false;
    const rect=e.getBoundingClientRect();let left=rect.left,right=rect.right,top=rect.top,bottom=rect.bottom;
    if(right<=left || bottom<=top)return false;
    for(let a=e;a;a=a.parentElement){
      const s=getComputedStyle(a);
      if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||Number(s.opacity)===0)return false;
      if(a===e)continue;
      const r=a.getBoundingClientRect();
      if(/^(hidden|clip|auto|scroll)$/.test(s.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}
      if(/^(hidden|clip|auto|scroll)$/.test(s.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}
      if(right<=left||bottom<=top)return false;
    }
    return true;
  }
  const label=e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim().replace(/\s+/g,'');
  function exact(texts){
    const matches=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,span,div')].filter(e=>texts.includes(label(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&visible(e));
    const leaves=matches.filter(e=>!matches.some(c=>c!==e&&e.contains(c)));
    return leaves.length===1?leaves[0]:null;
  }
  const markers=['开启实时记录','开始录音','开始记录','录音中','录音中...','录音中…','暂停中','暂停中...','暂停中…','已暂停','录音已暂停','结束录音','停止录音','暂停录音','继续录音','恢复录音','立即登录','手机号登录','短信登录','密码登录'];
  function status(){
    const controls=markers.filter(t=>exact([t])).map(text=>({text}));
    const timerLabels=[];
    if(location.pathname==='/doc/record'){
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node,seen=0;
      while((node=walker.nextNode())&&seen++<25000){const t=node.textContent.trim();if(t.length<45&&/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?)?$/.test(t)&&visible(node.parentElement))timerLabels.push(t);}
    }
    const text=document.body?.innerText||'';
    const microphoneDenied=/未开启麦克风权限|麦克风权限未开启|麦克风权限被拒绝|无法获取麦克风权限|请允许使用麦克风/.test(text);
    const ongoing=[...tracks].some(t=>t.readyState==='live')||controls.some(c=>/^(录音中|暂停中|已暂停|录音已暂停|结束录音|停止录音|暂停录音|继续录音|恢复录音)/.test(c.text));
    const loginRequired=controls.some(c=>/登录/.test(c.text))||/扫码登录|短信登录|密码登录|手机号登录/.test(text)||/^\/login/.test(location.pathname);
    if(loginRequired&&!controls.some(c=>/登录/.test(c.text)))controls.push({text:'立即登录'});
    return {url:location.href,path:location.pathname,controls,timerLabels,ongoing,loginRequired,microphoneDenied,homeReady:!!exact(['新建','开启实时记录','开始录音']),microphone:[...tracks].some(t=>t.readyState==='live')};
  }
  const attempts=new Map();
  function step(id,deadline=Infinity){
    const s=status();
    if(s.ongoing)return {...s,action:'ongoing'};
    if(s.loginRequired)return {...s,action:'login-required'};
    if(Date.now()>=deadline)return {...s,action:'deadline'};
    if(!attempts.has(id))attempts.set(id,new Map());if(attempts.size>50)attempts.delete(attempts.keys().next().value);
    const clicked=attempts.get(id),target=exact(['开启实时记录','开始录音','开始记录']);
    if(target&&Date.now()-(clicked.get(label(target))||0)>=5000){const text=label(target);clicked.set(text,Date.now());target.click();return {...s,action:'clicked',label:text};}
    const menu=exact(['新建']);
    if(menu&&Date.now()-(clicked.get('新建')||0)>=5000){clicked.set('新建',Date.now());menu.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));menu.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));return {...s,action:'menu'};}
    return {...s,action:'waiting'};
  }
  function titleField(expected){
    if(!/^\/doc\/transcripts\/[\w-]+\/?$/.test(location.pathname))throw Error('只能处理已保存的听悟录音');
    const fields=[...document.querySelectorAll('input')].filter(e=>visible(e)&&!e.disabled&&!e.readOnly&&e.value.trim()&&['text','search',''].includes(e.type));
    const matching=fields.filter(e=>e.value===expected);
    if(matching.length===1)return matching[0];
    if(fields.length===1)return fields[0];
    throw Error('无法唯一识别录音标题输入框');
  }
  function metadata(expected){
    const field=titleField(expected),lines=(document.body.innerText||'').split(/\n/).map(t=>t.trim()).filter(Boolean);
    const begin=lines.findIndex(t=>['关键词','全文概要','章节速览'].includes(t));
    const end=lines.findIndex((t,i)=>i>begin&&(t==='原文'||t.startsWith('智能内容由 AI')));
    return {url:location.href,title:field.value,summaryTexts:begin<0?[]:lines.slice(begin,end<0?undefined:end).slice(0,1500)};
  }
  function writeTitle(expected,newTitle){
    const field=titleField(expected);if(field.value!==expected)throw Error('标题已变化，保留当前标题');
    if(typeof newTitle!=='string'||newTitle.length<10||newTitle.length>100||/[\r\n]/.test(newTitle))throw Error('标题格式无效');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(field,newTitle);
    field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    field.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
    return {submitted:field.value===newTitle};
  }
  window.__tingwuClassDesktopV3={revision:2,status,step,metadata,writeTitle};
  window.__tingwuClassDesktopV2=window.__tingwuClassDesktopV3;
})();
