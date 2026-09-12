// Set an existing YouTube video's visibility through the running CDP Chrome (synced profile).
import puppeteer from "/Users/mike/dev/tac/mcp/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const VIDEO_ID = process.argv[2];
const VIS = (process.argv[3] || "PUBLIC").toUpperCase();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: { width: 1400, height: 1000 } });
const page = await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
const shot = async (n) => page.screenshot({ path: `/Users/mike/dev/hackathon/video/out/ytv-${n}.png` });
await page.goto(`https://studio.youtube.com/video/${VIDEO_ID}/edit`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise(r => setTimeout(r, 7000));
const skip = await page.evaluateHandle(() => [...document.querySelectorAll('a,button,div,span')].find(e => /SKIP TO YOUTUBE STUDIO/i.test(e.textContent) && e.children.length === 0));
if (skip && skip.asElement()) { await skip.asElement().click(); await new Promise(r => setTimeout(r, 4000)); await page.goto(`https://studio.youtube.com/video/${VIDEO_ID}/edit`, { waitUntil: "domcontentloaded" }); await new Promise(r => setTimeout(r, 7000)); }
log("url", page.url());
await shot("01");
// Open the visibility dropdown in the right rail
await page.mouse.click(1168, 662);  // Visibility card in the right rail
log("clicked visibility card");
await new Promise(r => setTimeout(r, 1500));
await shot("02");
const radio = await page.waitForSelector(`pierce/tp-yt-paper-radio-button[name="${VIS}"]`, { timeout: 20000 });
await radio.click();
await new Promise(r => setTimeout(r, 800));
const done = await page.$('pierce/#save-button');
if (done) { await done.click(); log("clicked dropdown save"); await new Promise(r => setTimeout(r, 1500)); }
await shot("03");
// Page-level Save
for (let i = 0; i < 20; i++) {
  const b = await page.$('pierce/#save');
  const disabled = !b || await b.evaluate(e => e.hasAttribute('disabled'));
  if (b && !disabled) { await b.click(); log("clicked page save"); break; }
  await new Promise(r => setTimeout(r, 1000));
}
await new Promise(r => setTimeout(r, 4000));
await shot("04");
const state = await page.evaluate(() => { const walk=(r)=>{ for (const el of r.querySelectorAll('*')) { if (/^(Public|Unlisted|Private)$/.test((el.textContent||'').trim()) && el.children.length===0) return el.textContent.trim(); if (el.shadowRoot) { const x=walk(el.shadowRoot); if (x) return x; } } }; return walk(document); });
log("visibility now", state);
await page.close(); await browser.disconnect();
