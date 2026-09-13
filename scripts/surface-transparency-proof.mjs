import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const phase = process.env.SPARK_PROOF_PHASE || 'fixed';
assert(['baseline','fixed'].includes(phase));
const evidence = path.resolve('.evidence/surface-transparency',phase); await mkdir(evidence,{recursive:true});
const report = { phase, startedAt:new Date().toISOString(), checks:[], sourceSha256:{} };
for (const file of ['extension/src/surfaces.ts','extension/surface.css','extension/concept.css','extension/manifest.json','extension/foundation/background.js']) report.sourceSha256[file] = createHash('sha256').update(await readFile(file)).digest('hex');
const server = createServer((req,res)=>{const dark=req.url.startsWith('/dark');res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html style="color-scheme:${dark?'dark':'light'}"><meta name="color-scheme" content="light dark"><title>Surface ${dark?'dark':'light'} host</title><style>body{margin:0;padding:60px;min-height:100vh;background:${dark?'#101722':'#d2e1f0'};color:${dark?'#dce1eb':'#172433'};font:18px system-ui}textarea{display:block;width:400px;height:80px}h1{font:42px Georgia}</style><h1>Continue your work</h1><p>Capture this real page without changing its theme or focus.</p><textarea id="focus">My current thought</textarea></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const extension=path.resolve('extension');const context=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-transparency-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1280,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--use-mock-keychain','--remote-debugging-port=19334']});
async function eventually(fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Surface did not reach the expected state.');}
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');report.chrome=context.browser().version();const id=new URL(worker.url()).host;
 const panel=context.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
 const page=await context.newPage();const state=async()=>panel.evaluate(async()=>(await chrome.runtime.sendMessage({type:'state'})).value);
 const pixels=async(image,points)=>page.evaluate(async({data,points})=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return points.map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));},{data:image.toString('base64'),points});
 for (const preferred of ['light','dark']) for (const hostScheme of ['light','dark']) {
  await page.emulateMedia({colorScheme:preferred,reducedMotion:'reduce'});await page.goto(`${origin}/${hostScheme}`);await page.locator('#focus').focus();await page.bringToFront();const savedBefore=(await state()).contexts.length;
  const before=await page.screenshot();const cdp=await context.newCDPSession(page);for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',nativeVirtualKeyCode:16,windowsVirtualKeyCode:89,isSystemKey:true});await cdp.detach();
  await eventually(async()=>{const f=page.frames().find(f=>f.url().includes('/surface.html#'));return !!f&&await f.locator('#surface').evaluate(n=>getComputedStyle(n).visibility==='visible');});
  const frame=page.frames().find(f=>f.url().includes('/surface.html#'));await frame.getByText('Context saved',{exact:true}).waitFor();
  const rect=await page.locator('[data-spark-surface="card"]').boundingBox();const points=[[rect.x,rect.y],[rect.x+rect.width-1,rect.y],[rect.x,rect.y+rect.height-1],[rect.x+rect.width-1,rect.y+rect.height-1]].map(p=>p.map(Math.floor));
  const after=await page.screenshot({path:path.join(evidence,`${hostScheme}-host-${preferred}-preference.png`)});const underlying=await pixels(before,points);const rendered=await pixels(after,points);const deltas=rendered.map((rgba,i)=>Math.max(...rgba.slice(0,3).map((v,c)=>Math.abs(v-underlying[i][c]))));
  const styles=await frame.evaluate(()=>({rootScheme:getComputedStyle(document.documentElement).colorScheme,rootBackground:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,cardBackground:getComputedStyle(document.querySelector('.spark-card')).backgroundColor,cardRadius:getComputedStyle(document.querySelector('.spark-card')).borderRadius}));
  assert.equal(styles.cardBackground,'rgb(22, 25, 36)');assert.equal(styles.cardRadius,'12px');assert.equal(rect.width,380);assert.equal(await page.evaluate(()=>document.activeElement.id),'focus');assert.equal((await state()).contexts.length,savedBefore+1);assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});
  const pass=deltas.every(d=>d<=16);report.checks.push({hostScheme,preferredScheme:preferred,pass,rect,styles,cornerCoordinates:points,hostPixels:underlying,renderedPixels:rendered,maxChannelDifferences:deltas});console.log(pass?'PASS':'FAIL',`${hostScheme} host / ${preferred} preference`,deltas);
  await eventually(async()=>await page.locator('[data-spark-surface="card"]').count()===0,5000);
 }
 for (const preferred of ['light','dark']) {
  await page.emulateMedia({colorScheme:preferred,reducedMotion:'reduce'}); await page.goto('https://github.com/MikeSchirtzinger/spark',{waitUntil:'domcontentloaded'}); await page.bringToFront();
  const before=await page.screenshot(); const focusBefore=await page.evaluate(()=>document.activeElement.tagName);
  const cdp=await context.newCDPSession(page); for(const type of ['rawKeyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',nativeVirtualKeyCode:16,windowsVirtualKeyCode:89,isSystemKey:true}); await cdp.detach();
  await page.locator('[data-spark-surface="card"]').waitFor(); await page.waitForTimeout(600);
  const frame=page.frames().find(f=>f.url().includes('/surface.html#')); await frame.getByText('Context saved',{exact:true}).waitFor(); const rect=await page.locator('[data-spark-surface="card"]').boundingBox();
  const points=[[rect.x,rect.y],[rect.x+rect.width-1,rect.y],[rect.x,rect.y+rect.height-1],[rect.x+rect.width-1,rect.y+rect.height-1]].map(p=>p.map(Math.floor));
  const after=await page.screenshot({path:path.join(evidence,`github-${preferred}.png`)}); const underlying=await pixels(before,points); const rendered=await pixels(after,points); const deltas=rendered.map((rgba,i)=>Math.max(...rgba.slice(0,3).map((v,c)=>Math.abs(v-underlying[i][c]))));
  const documentStyle=await page.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,meta:document.querySelector('meta[name="color-scheme"]')?.content,theme:document.documentElement.getAttribute('data-color-mode')}));
  const frameStyle=await frame.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,background:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor}));
  const mounted=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const m=globalThis.sparkMounts?.card;if(!m)return;return {hostScheme:getComputedStyle(m.node).colorScheme,hostBackground:getComputedStyle(m.node).backgroundColor};}});return r.result;});
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),focusBefore); const pass=deltas.every(d=>d<=16); report.checks.push({site:'https://github.com/MikeSchirtzinger/spark',preferredScheme:preferred,pass,rect,documentStyle,frameStyle,mounted,hostPixels:underlying,renderedPixels:rendered,maxChannelDifferences:deltas});console.log(pass?'PASS':'FAIL',`GitHub / ${preferred} preference`,deltas);
  await eventually(async()=>await page.locator('[data-spark-surface="card"]').count()===0,5000);
 }
 report.result=report.checks.every(c=>c.pass)?'PASS':'FAIL';if(report.result==='FAIL')process.exitCode=1;
} catch(error){report.result='FAIL';report.error=String(error.stack);console.error(report.error);process.exitCode=1;}
finally{await context.close();server.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('RESULT:',report.result);}
