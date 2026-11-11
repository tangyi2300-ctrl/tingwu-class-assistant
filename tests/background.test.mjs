import test from 'node:test';
import assert from 'node:assert/strict';
const state={}, alarms=new Map(), messages=[], windows=[];
const listener=()=>({addListener(fn){this.fn=fn;}});
globalThis.chrome={
 storage:{local:{async get(key){return {[key]:state[key]};},async set(value){Object.assign(state,value);}}},
 alarms:{async get(k){return alarms.get(k);},async create(k,v){alarms.set(k,v);},async clear(k){alarms.delete(k);},onAlarm:listener()},
 action:{async setBadgeText(){},async setBadgeBackgroundColor(){},onClicked:listener()},
 runtime:{getURL:p=>'chrome-extension://test/'+p,onInstalled:listener(),onStartup:listener(),onMessage:listener()},
 tabs:{async query(){return [{id:1,windowId:1}];},async sendMessage(id,m){messages.push(m.type);return {ongoing:false};},async update(){},async create(){return {id:1,windowId:1};}},
 windows:{async create(v){windows.push(v);},async update(){}},notifications:{async create(){},onClicked:listener()}
};
await import('../extension/background.js');
const flush=()=>new Promise(r=>setImmediate(r));
const request=(m,url='chrome-extension://test/index.html')=>new Promise(resolve=>chrome.runtime.onMessage.fn(m,{url},resolve));
test('install/restart stays paused and creates no alarms',async()=>{await flush();assert.equal(alarms.size,0);assert.equal(windows.length,0);});
test('enable creates alarm; pause removes it',async()=>{await request({type:'save',settings:{enabled:true}});assert.equal(alarms.size,1);await request({type:'save',settings:{enabled:false}});assert.equal(alarms.size,0);});
test('reminder sends no start or stop command and asks user in popup',async()=>{await request({type:'testReminder'});assert.deepEqual(messages,['remind']);assert.match(windows[0].url,/notice=end/);});
test('web pages cannot activate extension or start recording',()=>{let replied=false;const result=chrome.runtime.onMessage.fn({type:'testStart'},{url:'https://tingwu.aliyun.com/home',tab:{id:1}},()=>replied=true);assert.equal(result,undefined);assert.equal(replied,false);});
