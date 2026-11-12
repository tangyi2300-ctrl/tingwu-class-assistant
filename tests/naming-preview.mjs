import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
// Synthetic fixture: this public demo never reads personal recordings.
const real={id:'demo',url:'https://tingwu.aliyun.com/doc/transcripts/demo',originalTitle:'2026-01-12 10:00 记录',status:'draft',candidate:'2026-01-12｜10:00｜项目规划与任务拆解',reason:'示例：保留原录音日期、开始时间，并补充主要内容。',previewSource:'虚构课程示例 · 不会修改真实录音'};
const demo={preview:true,settings:{enabled:false,morning:'09:55',noon:'12:10',afternoon:'13:55',evening:'18:10'},logs:[],connection:null,naming:{enabled:true,mode:'auto',jobs:[real]}};
const css=await readFile(new URL('desktop/style.css',root),'utf8'),app=await readFile(new URL('desktop/app.js',root),'utf8');
let html=await readFile(new URL('desktop/index.html',root),'utf8');
const bridge=`const demoState=${JSON.stringify(demo)};
const demoOriginal=structuredClone(demoState.naming.jobs[0]);
window.fetch=async(url,options={})=>{
 if(options.method!=='POST')return {ok:true,json:async()=>structuredClone(demoState)};
 const body=JSON.parse(options.body||'{}'),name=url.split('/').pop();
 const job=demoState.naming.jobs[0];let message='这是审查预览，不会操作真实录音。';
 if(name==='naming-toggle'){demoState.naming.enabled=body.enabled;message='已切换演示开关，真实自动命名尚未启用。';}
 if(name==='naming-apply'){job.candidate=body.candidate;job.status='renamed';job.reason='演示效果：正式启用后，新标题会写入听悟并重新加载核对。';message='已展示改名完成效果，真实录音没有变化。';}
 if(name==='naming-skip'){job.status='skipped';job.reason='演示效果：本条保留原标题。';}
 if(name==='naming-inspect'){demoState.naming.jobs=[structuredClone(demoOriginal)];message='已重新显示虚构课程的标题候选。';}
 return {ok:true,json:async()=>({result:{message}})};
};`;
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}.review-banner{padding:15px 20px;background:#285c47;color:white;text-align:center;font-size:12px;line-height:1.8}.review-banner button{background:#ffffff18;border:1px solid #ffffff50;color:#fff;padding:6px 13px;margin:5px}.preview-footnote{font-size:11px;color:#8c987e}</style>`)
.replace('<body>','<body><div class="review-banner">v0.6 自动命名 · 审查预览<br>使用虚构课程示例 · 不会修改原录音<br><button data-demo="draft">查看改名前后</button><button data-demo="renamed">查看完成效果</button><button data-demo="attention">查看内容不足</button></div>')
.replace('<script type="module" src="app.js"></script>',`<script type="module">${bridge}\n${app}\ndocument.querySelectorAll('[data-demo]').forEach(button=>button.onclick=()=>{titleEdits.clear();const status=button.dataset.demo;demoState.naming.jobs=[structuredClone(demoOriginal)];const j=demoState.naming.jobs[0];j.status=status;if(status==='renamed')j.reason='演示效果：正式启用后，标题会写入听悟并重新加载核对。';if(status==='attention'){delete j.candidate;j.reason='有效内容不足，保留原标题，等待你补充主题。';j.previewSource='异常状态演示 · 非真实录音的处理结果';}refresh();});</script>`);
const output=new URL('preview/自动命名演示.html',root);await writeFile(output,html);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1360,height:1150},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(output.href);await page.locator('.candidate-input').waitFor();assert.equal(await page.locator('.candidate-input').inputValue(),real.candidate);
 await page.screenshot({path:fileURLToPath(new URL('preview/自动命名演示.jpg',root)),type:'jpeg',quality:72,fullPage:true});
 await page.locator('.naming-card').screenshot({path:fileURLToPath(new URL('preview/自动命名-公开卡片.png',root))});
 await page.locator('.candidate-input').fill('2026-01-12｜10:00｜项目规划与团队协作');
 await page.getByRole('button',{name:'采用这个标题',exact:true}).click();await page.locator('.naming-badge.renamed').waitFor();
 assert.match(await page.locator('.new-title').textContent(),/项目规划与团队协作/);
 await page.getByRole('button',{name:'查看内容不足',exact:true}).click();await page.locator('.naming-badge.attention').waitFor();assert.equal(await page.locator('.candidate-input').count(),0);
 await page.getByRole('button',{name:'查看改名前后',exact:true}).click();await page.locator('.candidate-input').waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:fileURLToPath(new URL('preview/自动命名-公开手机.png',root)),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: synthetic-title preview, editable candidate, simulated apply, insufficient-content state, mobile layout, no script errors.');
}finally{await browser.close();}
