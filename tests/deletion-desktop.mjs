import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'tingwu-delete-ui-')),origin='http://127.0.0.1:18773';
const child=spawn(process.execPath,[path.join(root,'desktop/server.mjs')],{env:{...process.env,TINGWU_PORT:'18773',TINGWU_DATA_DIR:dir,TINGWU_PREVIEW:'1'},stdio:'pipe'});
let browser;
try{
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('server exited')));setTimeout(()=>reject(Error('timeout')),5000).unref();});
 for(const endpoint of ['recording-delete','recording-delete-prepare'])assert.equal((await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const html=await(await fetch(origin)).text(),token=html.match(/name="tingwu-token" content="([^"]+)"/)[1];
 const preview=await fetch(origin+'/api/recording-delete',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Tingwu-Token':token},body:JSON.stringify({confirmation:'fake',confirmed:true})});assert.equal(preview.status,400);assert.match((await preview.json()).error,/审查预览/);
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],calls=[],previews=new Map();page.on('pageerror',e=>errors.push(e.message));
 const status=await(await fetch(origin+'/api/status')).json();status.preview=false;
 status.library={records:[{transId:'one',title:'2026-11-24｜09:55｜镜头语言与叙事',status:0,duration:3600,url:'https://tingwu.aliyun.com/doc/transcripts/one'},{transId:'two',title:'<img src=x onerror="window.hacked=true">',status:0,duration:7200,url:'https://tingwu.aliyun.com/doc/transcripts/two'}],updatedAt:Date.now()};
 status.local={enabled:true,permission:'authorized',recording:false,stale:false,uploads:{jobs:[{id:'local-only',startedAt:Date.now(),durationSeconds:30,status:'waiting'},{id:'uploading',startedAt:Date.now(),status:'uploading'}]}};
 let failure=false,delayPrepare=false;
 await page.route('**/api/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;if(pathname==='/api/status')return route.fulfill({json:status});
  const body=route.request().postDataJSON();calls.push({pathname,body});
  if(pathname==='/api/recording-delete-prepare'){
   const result={confirmation:'confirmation-'+calls.length,transId:body.transId||null,localId:body.localId||null,title:body.transId?status.library.records.find(r=>r.transId===body.transId).title:'11月24日本地录音',message:body.transId?'将同步移入通义听悟回收站。':'将取消这条录音的自动上传。',backup:'原始音频、文字和笔记备份保留。'};previews.set(result.confirmation,result);if(delayPrepare)await new Promise(r=>setTimeout(r,600));return route.fulfill({json:{ok:true,result}});
  }
  if(pathname==='/api/recording-delete'){
   assert.equal(body.confirmed,true);const target=previews.get(body.confirmation);assert.ok(target);await new Promise(r=>setTimeout(r,300));
   if(failure)return route.fulfill({status:400,json:{error:'删除未确认：网络不可用；本机备份保留'}});
   status.library.records=status.library.records.filter(r=>r.transId!==target.transId);status.local.uploads.jobs=status.local.uploads.jobs.filter(j=>j.id!==target.localId);return route.fulfill({json:{ok:true,result:{...target,message:'删除已同步，本机备份保留'}}});
  }
  return route.fulfill({json:{ok:true,result:{}}});
 });
 await page.goto(origin+'/#library');await page.locator('.recording-row').first().waitFor();
 const deletes=()=>calls.filter(c=>c.pathname==='/api/recording-delete');
 await page.locator('[data-recording-id="one"] .recording-delete').click();await page.locator('#delete-confirm').filter({hasText:'删除并同步听悟'}).waitFor();
 assert.equal(await page.locator('#delete-recording-title').textContent(),status.library.records[0].title);assert.equal(await page.locator('#delete-cancel').evaluate(e=>e===document.activeElement),true);await page.locator('#delete-cancel').click();assert.equal(deletes().length,0);
 await page.locator('[data-recording-id="one"] .recording-delete').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#delete-dialog').isVisible(),false);assert.equal(deletes().length,0);
 delayPrepare=true;await page.locator('[data-recording-id="one"] .recording-delete').click();await page.locator('#delete-cancel').click();await page.waitForTimeout(700);assert.equal(await page.locator('#delete-dialog').isVisible(),false);delayPrepare=false;
 await page.locator('[data-recording-id="two"] .recording-delete').click();await page.locator('#delete-confirm').filter({hasText:'删除并同步听悟'}).waitFor();assert.equal(await page.locator('#delete-recording-title img').count(),0);assert.equal(await page.evaluate(()=>window.hacked),undefined);await page.locator('#delete-cancel').click();
 failure=true;await page.locator('[data-recording-id="one"] .recording-delete').click();await page.locator('#delete-confirm').filter({hasText:'删除并同步听悟'}).click();await page.locator('#delete-confirm').filter({hasText:'重新核对'}).waitFor();assert.match(await page.locator('#delete-error').textContent(),/网络不可用/);assert.equal(await page.locator('.recording-row').count(),2);
 failure=false;await page.locator('#delete-confirm').click();await page.locator('#delete-confirm').filter({hasText:'删除并同步听悟'}).waitFor();
 await page.waitForTimeout(5200);assert.match(await page.locator('#delete-recording-title').textContent(),/镜头语言/);
 const evidence=path.join(root,'review-backup/2026-11-24-delete');await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'delete-dialog.png'),fullPage:false});
 await page.locator('#delete-confirm').evaluate(e=>{e.click();e.click();});await page.waitForFunction(()=>!document.querySelector('#delete-dialog').open);assert.equal(deletes().length,2);assert.equal(await page.locator('[data-recording-id="one"]').count(),0);
 const localRows=page.locator('.local-upload-row');await page.locator('details:has(#local-upload-list)').evaluate(e=>e.open=true);
 assert.equal(await localRows.nth(1).locator('.recording-delete').isDisabled(),true);
 await localRows.first().locator('.recording-delete').click();await page.locator('#delete-confirm').filter({hasText:'删除并取消上传'}).waitFor();assert.match(await page.locator('#delete-effect').textContent(),/取消/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('#delete-dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);await page.locator('#delete-confirm').click();await page.waitForFunction(()=>!document.querySelector('#delete-dialog').open);assert.equal(deletes().length,3);assert.equal(await localRows.count(),1);
 assert.deepEqual(errors,[]);console.log('Deletion UI passed: cancel/Escape, safe titles, explicit target confirmation, polling, failure/retry, double click, local/cloud lists, mobile, CSRF and preview guards.');
}finally{await browser?.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
