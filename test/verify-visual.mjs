// 真机验证「画面文字」：直接驱动 9333 上的 Edge（专用 profile，B站 登录态与 Key 都在）
// 用法: node test/verify-visual.mjs [url] [force|natural] [seek秒] [wait秒] [截图名]
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GyZYYNErW';
const MODE = process.argv[3] || 'force';
const SEEK = Number(process.argv[4] || 0);
const WAIT = Number(process.argv[5] || 60);
const SHOT = process.argv[6] || 'v040-visual.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function http(path, method = 'GET') {
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0;
const pend = new Map();
const ctxs = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const list = ctxs.get(m.sessionId) || []; list.push(m.params.context); ctxs.set(m.sessionId, list); }
});
function send(method, params = {}, sessionId) {
  const mid = ++id; const msg = { id: mid, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pend.set(mid, { res, rej }));
}
async function attach(targetId) {
  const r = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = r.sessionId;
  await send('Runtime.enable', {}, sid).catch(() => {});
  await send('Page.enable', {}, sid).catch(() => {});
  return sid;
}
async function evalOn(sid, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function evalIso(sid, expr) {
  for (let i = 0; i < 20; i++) {
    const list = ctxs.get(sid) || [];
    const ctx = list.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension'));
    if (ctx) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx.id }, sid);
      if (r.exceptionDetails) throw new Error('evalIso: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    }
    await sleep(300);
  }
  return null;
}

// 1) 重载扩展（新 manifest / frames.js / offscreen 生效）
const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const optSid = await attach(opt.id);
await evalOn(optSid, "chrome.storage.local.set({'bn.visualEnabled': true}).then(()=>'on')");
const manifest = await evalOn(optSid, 'chrome.runtime.getManifest().name + " " + chrome.runtime.getManifest().version');
await evalOn(optSid, 'setTimeout(()=>chrome.runtime.reload(),30); "reload-queued"');
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});
log('extension', manifest);

// 2) 新标签页（不碰用户自己的 tab）
const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = await attach(tab.id);
log('tab', tab.id, URL_);
await sleep(2500);
log('video', await evalOn(sid, "document.querySelector('video') ? JSON.stringify({dur: Math.round(document.querySelector('video').duration), h: document.querySelector('video').videoHeight}) : 'none'"));

// 3) 等字幕闸门（有字幕的视频才有笔记；没字幕不影响画面通道）
let ready = null;
for (let i = 0; i < 60; i++) {
  ready = await evalIso(sid, '(function(){var S=window.__bnState; if(!S) return null; return {verdict:S.verdict, sentences:S.sentences.length, blocks:S.blocks.length};})()');
  if (ready && (ready.blocks > 0 || ready.verdict)) break;
  await sleep(1000);
}
log('subtitle', JSON.stringify(ready));

// 4) seek + 起播
await evalOn(sid, "(function(){var v=document.querySelector('video');"
  + " v.muted=false; if(" + SEEK + ">0) v.currentTime=" + SEEK + "; v.play(); return v.currentTime;})()");
if (MODE === 'force') { await sleep(3000); log('force', await evalIso(sid, 'window.__bnVisual.force()')); }

// 5) 等 OCR
let stats = null;
for (let i = 0; i < WAIT; i++) {
  stats = await evalIso(sid, 'window.__bnVisual ? window.__bnVisual.stats() : null');
  if (stats && stats.ocr >= 1) break;
  if (i % 10 === 0) log('  waiting', i + 's', JSON.stringify(stats));
  await sleep(1000);
}
log('stats', JSON.stringify(stats));

const blocks = await evalIso(sid, 'window.__bnVisual.blocks().filter(function(b){return (b.visual||[]).length;})');
log('blocksWithVisual', JSON.stringify(blocks, null, 1));

const viewExpr = "(function(){var sr=document.getElementById('bn-root').shadowRoot;"
  + "return {status: sr.getElementById('statusText').textContent, cost: sr.getElementById('cost').textContent,"
  + " vnote: sr.getElementById('vnote').textContent, notes: sr.querySelectorAll('.note').length,"
  + " vsum: Array.from(sr.querySelectorAll('.vsum')).map(function(e){return e.textContent;}),"
  + " t: Math.round(document.querySelector('video').currentTime)};})()";
log('panel', JSON.stringify(await evalOn(sid, viewExpr)));

await send('Page.captureScreenshot', { format: 'png' }, sid)
  .then((r) => writeFileSync('dist/' + SHOT, Buffer.from(r.data, 'base64')))
  .catch(() => {});
await http('/json/close/' + tab.id).catch(() => {});
ws.close();
process.exit(0);
