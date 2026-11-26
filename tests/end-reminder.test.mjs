import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {showEndReminder} from '../desktop/end-reminder.mjs';

test('reminder launches a manual acknowledgement without blocking the scheduler',async()=>{
 const child=new EventEmitter(),calls=[];
 const pending=showEndReminder({launch:(...args)=>{calls.push(args);return child;}});
 child.emit('spawn');await pending;
 assert.equal(calls[0][0],'/usr/bin/osascript');assert.match(calls[0][1][1],/手动点击「结束并上传」/);
 assert.match(calls[0][1][1],/buttons \{"知道了"\}/);assert.doesNotMatch(calls[0][1][1],/do shell script|tell application/);
});
test('failed launches reject and later failures are reported',async()=>{
 const first=new EventEmitter(),pending=showEndReminder({launch:()=>first});first.emit('error',Error('launch failed'));await assert.rejects(pending,/launch failed/);
 const second=new EventEmitter(),errors=[];const started=showEndReminder({launch:()=>second,onError:e=>errors.push(e.message)});second.emit('spawn');await started;second.emit('exit',1);assert.equal(errors.length,1);
});
