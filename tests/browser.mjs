import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
const page=await browser.newPage({viewport:{width:1400,height:1240},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('file://'+root+'/preview/听课搭子-界面预览.html');
assert.match(await page.locator('#status-title').innerText(),/暂停/);
await page.locator('#toggle').click();assert.match(await page.locator('#toast').innerText(),/界面预览/);
assert.match(await page.locator('#status-title').innerText(),/暂停/);
await page.waitForTimeout(5600);
await page.screenshot({path:root+'/preview/主界面.png',fullPage:true});
await page.goto('file://'+root+'/preview/听课搭子-界面预览.html?notice=end');
assert.match(await page.locator('#notice-title').innerText(),/现在结束录音吗/);
await page.setViewportSize({width:540,height:560});
await page.screenshot({path:root+'/preview/下课提醒.png',fullPage:true});
await page.goto('file://'+root+'/preview/听课搭子-界面预览.html');
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.deepEqual(errors,[]);
// DOM integration fixtures: real content script, mocked Tingwu page and runtime only.
await page.route('https://tingwu.aliyun.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
async function fixture(html){
 await page.goto('https://tingwu.aliyun.com/home');
 await page.evaluate(html=>{document.body.innerHTML=html;window.chrome={runtime:{onMessage:{addListener(fn){window.receiver=fn;}}}};window.clicks=[];document.addEventListener('click',e=>window.clicks.push(e.target.textContent));},html);
 await page.addScriptTag({path:root+'/extension/content.js'});
}
const call=type=>page.evaluate(type=>new Promise(resolve=>window.receiver({type},{},resolve)),type);
await fixture('<button>新建</button><button hidden id="begin">开启实时记录</button>');
await page.evaluate(()=>{
 document.querySelector('button').addEventListener('mouseover',()=>document.querySelector('#begin').hidden=false);
 document.querySelector('#begin').onclick=()=>window.postMessage({source:'tingwu-class-mic',active:true},location.origin);
});
assert.equal((await call('start')).state,'microphone');
assert.deepEqual(await page.evaluate(()=>window.clicks),['开启实时记录']);
assert.equal((await call('start')).state,'existing');
assert.deepEqual(await page.evaluate(()=>window.clicks),['开启实时记录']);
await fixture('<button>结束录音</button>');
assert.equal((await call('start')).state,'existing');
await call('remind');assert.equal(await page.locator('#tingwu-class-banner').count(),1);
assert.deepEqual(await page.evaluate(()=>window.clicks),[]);
await fixture('<p>短信登录</p>');assert.equal((await call('start')).state,'attention');
await fixture('<button>开启实时记录</button><button>开启实时记录</button>');
await page.clock.install();const pending=call('start');await page.clock.runFor(21000);assert.equal((await pending).state,'attention');
assert.deepEqual(await page.evaluate(()=>window.clicks),[]);
console.log('PASS: desktop/mobile preview, reminder, hover/start flow, duplicate guard, manual stop boundary, login failure, ambiguous controls.');
} finally {await browser.close();}
