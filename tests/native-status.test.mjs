import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeStatus} from '../desktop/native-status.mjs';
const snapshot=(labels,url='https://tingwu.aliyun.com/doc/record')=>({url,controls:labels.map(text=>({text}))});
test('live and paused sessions are preserved without creating another recording',()=>{
 for(const marker of ['录音中','录音中...','录音中…','结束录音'])assert.equal(nativeStatus(snapshot([marker])).ongoing,true);
 for(const marker of ['暂停中...','已暂停','录音已暂停']){const paused=nativeStatus(snapshot([marker]));assert.equal(paused.ongoing,true);assert.equal(paused.paused,true);}
});
test('finished transcript and recording titles are not active recording evidence',()=>{
 const s=nativeStatus(snapshot(['上课录音记录','2026-11-11 23:17 记录'],'https://tingwu.aliyun.com/doc/transcripts/test'));
 assert.equal(s.ongoing,false);assert.equal(s.homeReady,false);
});
test('login prompt overrides an apparently ready home page in caller checks',()=>{
 const s=nativeStatus(snapshot(['立即登录','开启实时记录'],'https://tingwu.aliyun.com/home'));
 assert.equal(s.loginRequired,true);assert.equal(s.homeReady,true);
});
test('start control is required for readiness; missing browser is explicit',()=>{
 assert.equal(nativeStatus(snapshot(['新建'])).homeReady,false);
 assert.equal(nativeStatus({...snapshot(['新建']),homeReady:true}).homeReady,true);
 assert.equal(nativeStatus(snapshot(['开始录音'])).homeReady,true);
 assert.equal(nativeStatus({noTab:true}).noTab,true);
 assert.equal(nativeStatus({browserClosed:true}).browserClosed,true);
});

test('recording is confirmed only when the timer advances in the same session',async()=>{
 const {recordingAdvanced}=await import('../desktop/native-status.mjs');
 const a={...nativeStatus({...snapshot(['录音中...']),timerLabels:['00:00:02 / 06:00:00']}),tabId:1,windowId:2};
 const b={...a,elapsedSeconds:3};
 assert.equal(recordingAdvanced(a,b),true);
 assert.equal(recordingAdvanced(a,a),false);
 assert.equal(recordingAdvanced(a,{...b,paused:true}),false);
 assert.equal(recordingAdvanced(a,{...b,tabId:9}),false);
 assert.equal(recordingAdvanced(a,{...b,live:false}),false);
 assert.equal(recordingAdvanced({...a,elapsedSeconds:null},b),false);
});
test('wrong tab is not a login failure and active record is preferred over saved documents',async()=>{
 const {connectionProblem,pickRecordingTab}=await import('../desktop/native-status.mjs');
 assert.match(connectionProblem({noTab:true}),/页面/);assert.doesNotMatch(connectionProblem({noTab:true}),/登录/);
 const tabs=[{tabId:1,url:'https://tingwu.aliyun.com/doc/transcripts/test'},{tabId:2,url:'https://tingwu.aliyun.com/home'},{tabId:3,url:'https://tingwu.aliyun.com/doc/record'}];
 assert.equal(pickRecordingTab(tabs).tabId,3);assert.equal(pickRecordingTab(tabs.slice(0,2)).tabId,2);
});

test('Tingwu transcript timestamp does not hide the actual elapsed timer',()=>{
 const s=nativeStatus({...snapshot(['录音中…']),timerLabels:['00:00','00:10','06:00:00']});assert.equal(s.elapsedSeconds,10);
});
