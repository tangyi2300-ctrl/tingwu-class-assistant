(() => {
  if (window.__tingwuClassDesktopV2) return;
  let active = false;
  const tracks = new Set();
  const media = navigator.mediaDevices;
  if (media?.getUserMedia) {
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (...args) => {
      const stream = await original(...args);
      stream.getAudioTracks().forEach(t => tracks.add(t));
      return stream;
    };
  }
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim().replace(/\s+/g,'');
  function exact(texts) {
    const matches = [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,span,div')]
      .filter(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && texts.includes(label(e)));
    const leaves = matches.filter(e => !matches.some(c => c !== e && e.contains(c)));
    return leaves.length === 1 ? leaves[0] : null;
  }
  function status() {
    active = [...tracks].some(t => t.readyState === 'live');
    const text = document.body?.innerText || '';
    return {
      microphone: active,
      ongoing: active || !!exact(['结束录音','停止录音','暂停录音']) || /录音中，/.test(text),
      loginRequired: !!exact(['立即登录']) || /扫码登录|短信登录|密码登录|手机号登录/.test(text) || /\/login(?:\/|$)/.test(location.pathname),
      homeReady: !!exact(['新建','开启实时记录','开始录音']),
      path: location.pathname
    };
  }
  const attempts = new Map();
  function step(id, deadline = Infinity) {
    if(Date.now() >= deadline) return {...status(),action:"deadline"};
    if(!attempts.has(id)) attempts.set(id,new Set());
    const clicked = attempts.get(id), s = status();
    if(s.ongoing) return {...s,action:'ongoing'};
    if(s.loginRequired) return {...s,action:'login-required'};
    const labels = ['/doc/record','/record'].some(p=>location.pathname.startsWith(p))
      ? ['开启实时记录','开始录音','开始记录'] : ['开启实时记录','开始录音'];
    const target = exact(labels);
    if(target && !clicked.has(label(target))) {
      const text=label(target);clicked.add(text);target.click();return {...s,action:'clicked',label:text};
    }
    const menu=exact(['新建']);
    if(menu && !clicked.has('新建')) {
      clicked.add('新建');menu.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      menu.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));return {...s,action:'menu'};
    }
    const login=exact(['登录','立即体验','免费体验']);
    if(login && !clicked.has('登录入口')) {
      clicked.add('登录入口');login.click();return {...s,action:'login-entry'};
    }
    return {...s,action:'waiting'};
  }
  window.__tingwuClassDesktopV2={status,step};
})();
