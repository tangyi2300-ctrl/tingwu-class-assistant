import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeStatus} from '../desktop/native-status.mjs';
const snapshot=(labels,url='https://tingwu.aliyun.com/doc/record')=>({url,controls:labels.map(text=>({text}))});
test('live and paused sessions are preserved without creating another recording',()=>{
 for(const marker of ['录音中','录音中...','录音中…','结束录音'])assert.equal(nativeStatus(snapshot([marker])).ongoing,true);
 const paused=nativeStatus(snapshot(['暂停中...']));assert.equal(paused.ongoing,true);assert.equal(paused.paused,true);
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
 assert.equal(nativeStatus(snapshot(['开始录音'])).homeReady,true);
 assert.equal(nativeStatus({noTab:true}).noTab,true);
 assert.equal(nativeStatus({browserClosed:true}).browserClosed,true);
});
