export function nativeStatus(snapshot){
 const labels=(snapshot.controls||[]).map(c=>c.text);
 const paused=labels.some(t=>['暂停中','暂停中...','暂停中…'].includes(t));
 const ongoing=paused || labels.some(t=>['录音中','录音中...','录音中…','结束录音','停止录音','暂停录音'].includes(t));
 const loginRequired=labels.some(t=>['立即登录','登录','手机号登录','密码登录'].includes(t));
 return {ongoing,paused,microphone:false,loginRequired,homeReady:labels.some(t=>['开启实时记录','开始录音','开始记录'].includes(t)),path:snapshot.url?new URL(snapshot.url).pathname:'',noTab:!!snapshot.noTab,browserClosed:!!snapshot.browserClosed,controlMode:'accessibility',labels};
}
