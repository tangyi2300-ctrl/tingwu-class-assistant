export function pickRecordingTab(tabs){
 const rank=t=>{try{const p=new URL(t.url).pathname;return p==='/doc/record'?0:p==='/home'?1:p.startsWith('/folders/')?2:3;}catch{return 4;}};
 return [...tabs].sort((a,b)=>rank(a)-rank(b))[0]||null;
}
export function nativeStatus(snapshot={}){
 const labels=(snapshot.controls||[]).map(c=>c.text.trim());
 const paused=labels.some(t=>['暂停中','暂停中...','暂停中…','已暂停','录音已暂停','继续录音','恢复录音'].includes(t));
 const live=labels.some(t=>['录音中','录音中...','录音中…'].includes(t));
 const ongoing=paused || live || labels.some(t=>['结束录音','停止录音','暂停录音'].includes(t));
 const loginRequired=labels.some(t=>['立即登录','登录','手机号登录','密码登录','短信登录'].includes(t));
 const timers=snapshot.timerLabels||[];
 const seconds=t=>t.split(':').map(Number).reduce((a,n)=>a*60+n,0);
 // Tingwu places transcript timestamps before the elapsed/maximum duration pair.
 const timer=timers.find(t=>t.includes('/')) || (timers.length>=2 && seconds(timers.at(-1))>=1800?timers.at(-2):timers.at(-1));
 const parts=timer?.split('/')[0].trim().split(':').map(Number);
 const elapsedSeconds=parts?.length>=2 && parts.every(Number.isFinite)?parts.reduce((a,n)=>a*60+n,0):null;
 return {ongoing,live,paused,elapsedSeconds,loginRequired,microphoneDenied:!!snapshot.microphoneDenied || labels.some(t=>/麦克风权限/.test(t)),homeReady:!!snapshot.homeReady || labels.some(t=>['开启实时记录','开始录音','开始记录'].includes(t)),path:snapshot.url?new URL(snapshot.url).pathname:'',url:snapshot.url||'',noTab:!!snapshot.noTab,browserClosed:!!snapshot.browserClosed,locked:!!snapshot.locked,controlMode:'accessibility',labels};
}
export function recordingAdvanced(before,after){
 return !!before && !after.paused && after.live && after.path==='/doc/record' && before.tabId===after.tabId && before.windowId===after.windowId && before.elapsedSeconds!==null && after.elapsedSeconds!==null && after.elapsedSeconds>before.elapsedSeconds;
}
export function connectionProblem(c){
 if(c.backgroundReady===false)return 'Chrome 后台脚本权限未开启，无法在切换标签页后静默启动';
 if(c.locked)return '电脑已锁屏，请解锁；课内将继续重试';
 if(c.browserClosed)return 'Chrome 尚未打开或正在启动';
 if(c.noTab)return '尚未读取到对应听悟页面，将重新定位窗口';
 if(c.loginRequired)return '听悟登录已失效，请在 Chrome 完成登录验证';
 if(c.microphoneDenied)return '听悟麦克风权限未开启';
 if(c.ok===false)return c.error||'听悟连接失败';
 return '';
}
