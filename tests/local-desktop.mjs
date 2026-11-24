import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'tingwu-local-ui-'));
const child=spawn(process.execPath,[path.join(root,'desktop/server.mjs')],{env:{...process.env,TINGWU_PORT:'18769',TINGWU_DATA_DIR:dir,TINGWU_PREVIEW:'1'},stdio:'pipe'});
let browser;
try{
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('server exited')));setTimeout(()=>reject(Error('timeout')),5000).unref();});
 const origin='http://127.0.0.1:18769';
 for(const endpoint of ['local-stop','local-permission','local-retry'])assert.equal((await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(origin+'/api/local-audio/example')).status,403);
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const status=await (await fetch(origin+'/api/status')).json();status.preview=false;
 status.local={enabled:true,permission:'notDetermined',recording:false,stale:false,updatedAt:Date.now(),uploads:{busy:false,jobs:[]}};
 const calls=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/status')return route.fulfill({json:status});
  calls.push({path:url.pathname,body:route.request().postDataJSON()});
  if(url.pathname==='/api/local-permission')status.local.permission='authorized';
  if(url.pathname==='/api/start')Object.assign(status.local,{recording:true,updatedAt:Date.now(),active:{id:'demo-recording',startedAt:Date.now()-3723000,durationSeconds:3723}});
  if(url.pathname==='/api/local-stop'){assert.equal(route.request().postDataJSON().id,'demo-recording');status.local.recording=false;status.local.uploads={busy:false,jobs:[{id:'demo-recording',startedAt:Date.now()-3723000,durationSeconds:3723,status:'retrying',error:'网络暂不可用，本地音频已保留'}]};}
  return route.fulfill({json:{ok:true,result:{message:'操作完成'}}});
 });
 await page.goto(origin);await page.locator('#local-permission').waitFor();
 assert.equal(await page.locator('#local-start').isDisabled(),true);assert.equal(await page.locator('#local-stop').isVisible(),false);
 await page.locator('#local-permission').click();await page.waitForFunction(()=>!document.querySelector('#local-start').disabled);
 await page.locator('#local-start').click();await page.locator('#local-stop').waitFor();assert.match(await page.locator('#local-timer').textContent(),/^01:02:/);
 await mkdir(path.join(root,'review-backup/2026-11-23-local-recording'),{recursive:true});
 await page.screenshot({path:path.join(root,'review-backup/2026-11-23-local-recording/home-ui.png'),fullPage:true});
 await page.locator('#settings-tab').click();assert.equal(await page.locator('#local-stop').isVisible(),true);
 assert.equal(calls.filter(c=>c.path==='/api/local-stop').length,0);
 await page.locator('#local-stop').click();await page.waitForFunction(()=>document.querySelector('#local-stop').hidden);
 await page.locator('#local-files summary').click();assert.match(await page.locator('#local-upload-list').textContent(),/本地音频已保留/);assert.equal(await page.getByText('下载音频',{exact:true}).count(),1);
 const job=status.local.uploads.jobs[0];Object.assign(job,{status:'uploaded',error:null,transId:'cloud-fixture',url:'https://tingwu.aliyun.com/doc/transcripts/cloud-fixture',audioCleanupError:'云端核对暂未完成，临时音频保留'});
 await page.waitForFunction(()=>document.querySelector('#local-upload-list').textContent.includes('云端核对暂未完成'));assert.equal(await page.getByText('下载音频',{exact:true}).count(),1);
 job.audioCleanupError=null;job.audioRemovedAt=Date.now();await page.waitForFunction(()=>document.querySelector('#local-upload-list').textContent.includes('本机音频已清理'));
 assert.equal(await page.getByText('下载音频',{exact:true}).count(),0);assert.equal(await page.getByText('文字与笔记',{exact:true}).count(),1);assert.equal(await page.locator('#local-upload-list').getByText('在听悟查看 ↗',{exact:true}).getAttribute('href'),job.url);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: microphone permission, explicit start/stop, no automatic stop, saved-audio download, upload error, verified cloud storage and local cleanup, notes retained, mobile layout, request protection.');
}finally{await browser?.close();child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
