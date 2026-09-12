import { chromium } from 'playwright';
import { conferenceUrl } from '../extension/src/calendar.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const token = process.env.AMBIGUOUS_API_KEY;
if (!token) throw Error('Provide an authorized AMBIGUOUS_API_KEY in the test process.');
const eventId = 'd1b6e604-c7e3-4a96-aa39-ef415a13ce4e';
const report = { startedAt: new Date().toISOString(), checks: [], requests: [], sourceSha256: {} };
const evidence = path.resolve('.evidence/zoom-import'); await mkdir(evidence,{recursive:true});
for (const file of ['extension/src/calendar.ts','extension/foundation/background.js','tests/calendar.test.ts']) report.sourceSha256[file] = createHash('sha256').update(await readFile(file)).digest('hex');
function pass(name) { report.checks.push(name); console.log('PASS',name); }
async function eventually(fn) { const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for import state.'); }
let browser, panel;
try {
 const response=await fetch(`https://app.ambiguous.ai/api/calendars/events/${eventId}`,{headers:{Authorization:`Bearer ${token}`,'API-Version':'1'}});
 assert.equal(response.status,200); const event=await response.json(); assert.equal(event.id,eventId); assert.equal(event.conference_url,null);
 const expected=conferenceUrl(event); const url=new URL(expected); assert.equal(url.protocol,'https:'); assert.equal(url.hostname,'us05web.zoom.us');
 report.event={id:eventId,title:event.title,canonicalAbsent:true,joinHost:url.hostname,joinPathShape:'/j/<meeting-id>',queryRetained:!!url.search};
 pass('Real Logo event GET supplies one distinct Zoom join link despite duplicate Markdown');
 const extension=path.resolve('extension');
 browser=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'carry-zoom-import-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:800,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const id=new URL(worker.url()).host;report.chrome=browser.browser().version();
 browser.on('response',res=>{if(res.request().serviceWorker()?.url()===worker.url()&&res.url().startsWith('https://app.ambiguous.ai/api/'))report.requests.push({method:res.request().method(),status:res.status(),path:new URL(res.url()).pathname});});
 panel=browser.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
 const state=()=>panel.evaluate(async()=>(await chrome.runtime.sendMessage({type:'state'})).value);
 await panel.getByRole('button',{name:'Meeting',exact:true}).click();assert(await panel.locator('#import-event').isDisabled());
 await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#workspace-label').fill('Spark Zoom meeting');await panel.locator('#api-token').fill(token);await panel.getByRole('button',{name:'Save connection settings',exact:true}).click();await eventually(async()=>(await state()).credentialsConfigured);
 await panel.locator('#sync-mode').selectOption('sync');await eventually(async()=>(await state()).settings.syncMode==='sync');
 await panel.getByRole('button',{name:'Meeting',exact:true}).click();await panel.locator('#event-id').fill(eventId);await panel.locator('#import-event').click();
 await eventually(async()=>(await state()).meetings.some(m=>m.remote?.eventId===eventId));
 const meeting=(await state()).meetings.find(m=>m.remote?.eventId===eventId);assert(meeting.joinUrl===expected,'Imported URL must exactly match the parser result, including its query.');
 report.localId=meeting.id;pass('Real extension event-ID UI import persists the exact Zoom URL with passcode retained locally');
 await panel.screenshot({path:path.join(evidence,'logo-imported.png'),fullPage:true});
 await panel.reload();await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
 assert((await state()).meetings.find(m=>m.id===meeting.id).joinUrl===expected,'Reload must retain the exact imported URL.');
 assert(report.requests.every(r=>r.method==='GET'));pass('Reload readback retains the imported meeting; all remote operations are GET only');
 report.result='PASS';
} catch(error) { report.result='FAIL'; report.error=error instanceof Error ? error.message : 'Import failed.'; console.error('Zoom import check failed; see redacted receipt.');process.exitCode=1; }
finally { if(browser)await browser.close();report.finishedAt=new Date().toISOString();const content=JSON.stringify(report,null,2);assert(!content.includes(token));await writeFile(path.join(evidence,'report.json'),content);console.log('RESULT:',report.result); }
