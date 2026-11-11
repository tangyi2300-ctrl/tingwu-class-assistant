(() => {
  let micActive = false, busy = false;
  window.addEventListener('message', e => {
    if (e.source === window && e.origin === location.origin && e.data?.source === 'tingwu-class-mic') micActive = e.data.active === true;
  });
  const sleep = ms => new Promise(r => setTimeout(r,ms));
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim().replace(/\s+/g,'');
  function findExact(texts) {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], li, span, div')]
      .filter(e => !e.closest('#tingwu-class-banner') && visible(e) && !e.disabled && texts.includes(label(e)));
    // Only leaf-most matches. Never pick an ambiguous button or a broad text container.
    const leaves = candidates.filter(e => !candidates.some(c => c !== e && e.contains(c)));
    return leaves.length === 1 ? leaves[0] : null;
  }
  function status() {
    const text = document.body?.innerText || '';
    return {micActive, ongoing:micActive || Boolean(findExact(['结束录音','停止录音','暂停录音'])) || /录音中，/.test(text), login: /扫码登录|短信登录|密码登录/.test(text)};
  }
  async function start() {
    if(busy) return {state:'busy', message:'正在尝试启动，请勿重复操作'};
    busy = true;
    try {
      if (status().ongoing) return {state:'existing', message:'检测到已有录音或麦克风占用，保留当前录音，请查看听悟状态'};
      const clicked = new Set();
      for(let step = 0; step < 28; step++) {
        const s = status();
        if(s.micActive) return {state:'microphone', message:'已检测到听悟使用麦克风，请核对页面中的计时和转写'};
        if(s.login) return {state:'attention', message:'请先登录通义听悟，再手动开始本次录音'};
        if(s.ongoing) return {state:'existing', message:'检测到录音界面，请核对计时和转写'};
        let target = findExact(['开启实时记录', '开始录音']);
        // Current public Tingwu UI exposes recording through the hover “新建” menu.
        if(!target && !clicked.has('新建')) {
          const menu = findExact(['新建']);
          if(menu) { menu.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); menu.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false})); clicked.add('新建'); }
        }
        if(target && !clicked.has(label(target))) {
          clicked.add(label(target)); target.click();
        }
        await sleep(700);
      }
      return {state:'attention', message:'未确认录音启动。请检查登录、麦克风权限和听悟页面，并手动开始本次录音'};
    } finally {busy = false;}
  }
  function banner() {
    document.getElementById('tingwu-class-banner')?.remove();
    const host = document.createElement('div'); host.id = 'tingwu-class-banner';
    host.style.cssText='position:fixed;top:22px;right:22px;z-index:2147483647';
    const root = host.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{font:15px system-ui;color:#173c37}.box{width:300px;background:#fffdf5;padding:24px;border:1px solid #b5c8ba;border-radius:20px;box-shadow:0 12px 45px #132f3033}h3{margin:0 0 10px}p{line-height:1.7}button{padding:10px 18px;border:0;border-radius:10px;background:#17594c;color:white;cursor:pointer}</style><div class="box"><h3>下课了，现在结束录音吗？</h3><p>请在通义听悟中亲自点击结束录音。若还在上课，可以继续录制。</p><button>知道了，保持手动控制</button></div>';
    root.querySelector('button').onclick=()=>host.remove(); document.documentElement.append(host);
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if(m.type === 'status') {reply(status()); return;}
    if(m.type === 'start') {start().then(reply).catch(e=>reply({state:'attention',message:e.message})); return true;}
    if(m.type === 'remind') {banner(); reply({ok:true});}
  });
})();
