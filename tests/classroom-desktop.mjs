import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'tingwu-classroom-ui-'));
const port=18772,origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[path.join(root,'desktop/server.mjs')],{env:{...process.env,TINGWU_PORT:String(port),TINGWU_DATA_DIR:dir,TINGWU_PREVIEW:'1'},stdio:'pipe'});
const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');};
let browser;
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(Error('server exited')));setTimeout(()=>reject(Error('server timeout')),5000).unref();});
 for(const name of ['classroom','classroom-notes'])assert.equal((await fetch(origin+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const status=await (await fetch(origin+'/api/status')).json();status.preview=false;status.local={enabled:true,permission:'authorized',recording:true,stale:false,updatedAt:Date.now(),active:{id:'one',startedAt:Date.now()-600000,durationSeconds:600},uploads:{jobs:[]}};
 const notes={one:{text:'',revision:0,updatedAt:null},two:{text:'第二堂课的独立笔记',revision:1,updatedAt:Date.now()}};let polls=0,slowSave=true,noteSync={status:'waiting',message:'笔记已保存，录音上传后自动同步听悟'};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/api/status')return route.fulfill({json:status});
  const body=route.request().postDataJSON();calls.push({path:url.pathname,body});
  if(url.pathname==='/api/classroom'){
   polls++;return route.fulfill({json:{ok:true,result:{record:{id:body.id,startedAt:Date.now()-600000,durationSeconds:600,status:body.id==='one'?'recording':'saved'},notes:{...notes[body.id]},noteSync,transcript:{phase:'listening',processedThrough:600,segments:[{start:0,end:12,text:'今天讨论镜头语言。景别决定观众与人物的距离，构图决定画面中的视觉重点。'},{start:12,end:30,text:'使用近景时，要观察人物的表情和眼神。远景则更适合交代环境与人物的关系。'},{start:30,end:45,text:'课堂练习：先确定想表达的情绪，再选择合适的景别和机位。'}],partial:{start:45,end:50+polls,text:'接下来我们结合具体画面，分析光线怎样影响叙事。'}}}}});
  }
  if(url.pathname==='/api/classroom-notes'){
   if(slowSave){slowSave=false;await new Promise(r=>setTimeout(r,850));}
   const n=notes[body.id];if(n.revision!==body.revision)return route.fulfill({status:409,json:{error:'另一页面已修改，请合并'}});
   notes[body.id]={text:body.text,revision:n.revision+1,updatedAt:Date.now()};return route.fulfill({json:{ok:true,result:notes[body.id]}});
  }
  if(url.pathname==='/api/classroom-sync'){noteSync={status:'pending',message:'已保存到本机 · 等待同步听悟'};return route.fulfill({json:{ok:true,result:noteSync}});}
  return route.fulfill({json:{ok:true,result:{message:'完成'}}});
 });
 await page.goto(origin);await page.locator('#classroom-workspace').waitFor();const editor=page.locator('#classroom-notes');await until(()=>editor.isEnabled());
 const left=await page.locator('.live-panel').boundingBox(),right=await page.locator('.notes-panel').boundingBox();assert.ok(left.x+left.width<right.x);
 await editor.focus();await editor.dispatchEvent('compositionstart');await editor.fill('镜头语言：先确定情绪');await page.waitForTimeout(1200);assert.equal(calls.filter(c=>c.path==='/api/classroom-notes').length,0);
 await editor.dispatchEvent('compositionend');await until(()=>calls.some(c=>c.path==='/api/classroom-notes'));
 await editor.fill('镜头语言：先确定情绪，再选择景别。\n我的疑问：怎样用光线突出主体？');
 const expected=await editor.inputValue();await until(()=>notes.one.text===expected);await page.waitForTimeout(5200);
 assert.equal(await editor.inputValue(),expected);assert.equal(await editor.evaluate(e=>e===document.activeElement),true);assert.ok(polls>=4);
 assert.equal(calls.filter(c=>c.path==='/api/local-stop').length,0);assert.equal(await page.locator('#local-stop').isVisible(),true);
 const evidence=path.join(root,'review-backup/2026-11-24-live-notes');await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'classroom-ui.png'),fullPage:true});
 await page.reload();await until(async()=>await editor.inputValue()===expected);assert.match(await page.locator('#notes-save-state').textContent(),/已自动保存/);
 // Concurrent edits must never silently overwrite the other page, even after refresh.
 notes.one={text:'另一页面的补充内容',revision:notes.one.revision+1,updatedAt:Date.now()};await editor.fill(expected+'\n这页新补充');
 await page.locator('#notes-conflict').waitFor();const conflicted=await editor.inputValue();await page.reload();await page.locator('#notes-conflict').waitFor();assert.equal(await editor.inputValue(),conflicted);assert.equal(notes.one.text,'另一页面的补充内容');
 await editor.fill(conflicted+'\n另一页面的补充内容');const merged=await editor.inputValue();await page.locator('#notes-merge').click();await until(()=>notes.one.text===merged);
 // A pending save belongs to the old recording when the user switches pages.
 slowSave=true;await editor.fill(merged+'\n继续补充');await until(()=>calls.filter(c=>c.path==='/api/classroom-notes').at(-1).body.text.endsWith('继续补充'));
 await page.evaluate(()=>location.hash='classroom/two');await until(async()=>await editor.inputValue()==='第二堂课的独立笔记');await until(()=>notes.one.text.endsWith('继续补充'));assert.equal(await editor.inputValue(),'第二堂课的独立笔记');
 await page.evaluate(()=>location.hash='classroom/one');await until(async()=>await editor.inputValue()===notes.one.text);
 noteSync={status:'synced',message:'已同步到通义听悟'};await until(async()=>await page.locator('#notes-sync-state').textContent()==='已同步到通义听悟');
 noteSync={status:'retrying',message:'暂未同步到听悟 · 将自动重试',error:'网络暂不可用'};await page.locator('#notes-sync-retry').waitFor();assert.equal(await editor.inputValue(),notes.one.text);await page.locator('#notes-sync-retry').click();await until(async()=>/等待同步/.test(await page.locator('#notes-sync-state').textContent()));
 noteSync={status:'conflict',message:'听悟笔记有改动',error:'请合并后同步'};await page.locator('#notes-sync-retry').waitFor();await until(async()=>await page.locator('#notes-sync-retry').textContent()==='已合并，同步到听悟');await page.locator('#notes-sync-retry').click();assert.equal(calls.filter(c=>c.path==='/api/classroom-sync').at(-1).body.merge,true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);const result={passed:true,checks:['live updates','side by side','IME composition','autosave during typing','focus preserved','refresh recovery','revision conflict recovery','record isolation','mobile layout','no stop command','request protection','cloud sync status','cloud retry preserves editor']};await writeFile(path.join(evidence,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});}
