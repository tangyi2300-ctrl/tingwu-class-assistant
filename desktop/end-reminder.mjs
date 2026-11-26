import {spawn} from 'node:child_process';

const script = 'display dialog "下课了，现在结束录音吗？\n\n请打开听课搭子，手动点击「结束并上传」。还在上课可以继续录制。" with title "听课搭子 · 下课提醒" buttons {"知道了"} default button "知道了" giving up after 7200';

// Wait only for the helper to start. The scheduler must keep running while the
// reminder remains on screen, and dismissing it never stops the recorder.
export function showEndReminder({launch=spawn,onError=()=>{}}={}) {
 return new Promise((resolve,reject)=>{
  const child=launch('/usr/bin/osascript',['-e',script],{stdio:'ignore'});
  let started=false;
  child.once('spawn',()=>{started=true;resolve();});
  child.once('error',error=>{if(started)onError(error);else reject(error);});
  child.once('exit',code=>{if(started&&code!==0)onError(Error(`提醒窗口退出（${code}）`));});
 });
}
