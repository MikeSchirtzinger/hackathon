// Upload a video to YouTube as Unlisted through the already running CDP Chrome (browser-start --as-me).
import puppeteer from "/Users/mike/dev/tac/mcp/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const FILE = process.argv[2];
const TITLE = process.argv[3] || "Spark concept demo";
const DESC = process.argv[4] || "";
if (!fs.existsSync(FILE)) throw new Error("missing file " + FILE);

const DEEP = `(function(){ const out=[]; const walk=(root)=>{ for (const el of root.querySelectorAll('*')) { if (el.tagName==='A' && /youtu\\.be|youtube\\.com\\/watch/.test(el.href||'')) out.push(el.href); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out[0]||null; })()`;
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: { width: 1400, height: 1000 } });
const page = await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = async (n) => { await page.screenshot({ path: `/Users/mike/dev/hackathon/video/out/yt-${n}.png` }); };

await page.goto("https://www.youtube.com/upload", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));
log("url", page.url());
await shot("01-landing");
const skip = await page.evaluateHandle(() => [...document.querySelectorAll('a,button,div,span')].find(e => /SKIP TO YOUTUBE STUDIO/i.test(e.textContent) && e.children.length === 0));
if (skip && skip.asElement()) { await skip.asElement().click(); log("skipped browser interstitial"); await new Promise(r => setTimeout(r, 5000)); await page.goto("https://www.youtube.com/upload", { waitUntil: "domcontentloaded", timeout: 60000 }); await new Promise(r => setTimeout(r, 6000)); await shot("01b-after-skip"); log("url", page.url()); }
if (/accounts\.google\.com/.test(page.url())) { log("NOT LOGGED IN"); await browser.disconnect(); process.exit(2); }

// Studio may open a channel-creation dialog or the upload dialog directly.
const fileInput = await page.waitForSelector('pierce/input[type=file]', { timeout: 30000 });
await fileInput.uploadFile(FILE);
log("file submitted");
await new Promise(r => setTimeout(r, 8000));
await shot("02-after-upload");

// Title and description
const titleBox = await page.waitForSelector('pierce/#textbox', { timeout: 60000 });
await titleBox.click({ clickCount: 3 });
await page.keyboard.down("Meta"); await page.keyboard.press("a"); await page.keyboard.up("Meta");
await page.keyboard.type(TITLE, { delay: 5 });
const boxes = await page.$$('pierce/#textbox');
if (boxes.length > 1 && DESC) { await boxes[1].click(); await page.keyboard.type(DESC, { delay: 3 }); }
log("title set");

// Audience: not made for kids
const notKids = await page.$('pierce/tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
if (notKids) { await notKids.click(); log("audience set"); }
await shot("03-details");

// Next x3
for (let i = 0; i < 3; i++) {
  const next = await page.waitForSelector('pierce/#next-button', { timeout: 30000 });
  await next.click();
  await new Promise(r => setTimeout(r, 1800));
}
await shot("04-visibility");
// Unlisted
const unlisted = await page.waitForSelector('pierce/tp-yt-paper-radio-button[name="UNLISTED"]', { timeout: 30000 });
await unlisted.click();
await new Promise(r => setTimeout(r, 800));
// Read the share link before finishing
let link = await page.evaluate(DEEP);
log("link (pre-done)", link);
// Wait for upload/processing enough that Done is enabled
for (let i = 0; i < 60; i++) {
  const b = await page.$('pierce/#done-button'); const disabled = !b || await b.evaluate(e => e.hasAttribute('disabled'));
  const st = await page.$('pierce/.progress-label'); const status = st ? await st.evaluate(e => e.textContent.trim()) : '';
  if (!disabled) break;
  if (i % 5 === 0) log("waiting", status);
  await new Promise(r => setTimeout(r, 3000));
}
await shot("05-before-done");
const doneBtn = await page.$('pierce/#done-button'); await doneBtn.click();
await new Promise(r => setTimeout(r, 4000));
await shot("06-done");
if (!link) link = await page.evaluate(DEEP);
log("FINAL_LINK", link);
await page.close();
await browser.disconnect();
