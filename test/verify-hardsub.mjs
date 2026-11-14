// 真机验证硬字幕兜底：B站 无字幕轨的视频，用本地 OCR 读画面里的字幕
// 用法: node test/verify-hardsub.mjs [url] [秒数]
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1ut411n7Bd';
const RUN = Number(process.argv[3] || 100);
const RATE = Number(process.argv[4] || 1.5);
const SHOT = process.argv[5] || 'v060-hard-real.png';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  if (m.method === 'Runtime.executionContextCreated') {
    const list = ctxs.get(m.sessionId) || [];
    list.push(m.params.context);
    ctxs.set(m.sessionId, list);
  }
});
function send(method, params = {}, sessionId) {
  const mid = ++id;
  const msg = { id: mid, method, params };
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
  await sleep(300);
  const list = ctxs.get(sid) || [];
  const ctx = list.find(c => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension'));
  if (!ctx) throw new Error('isolated context not found');
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx.id }, sid);
  if (r.exceptionDetails) throw new Error('evalIso: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
const PANEL = `(function(){
  var sr = document.getElementById('bn-root') && document.getElementById('bn-root').shadowRoot;
  if (!sr) return { noRoot: true };
  return {
    status: (sr.getElementById('statusText') || {}).textContent,
    cost: (sr.getElementById('cost') || {}).textContent,
    notes: sr.querySelectorAll('.note').length,
    hardTags: sr.querySelectorAll('.hstag').length,
    vnote: (sr.getElementById('vnote') || {}).textContent,
    empty: (sr.getElementById('empty') || {}).innerText,
    hardBtn: (sr.getElementById('btnHard') || {}).textContent,
    hardHidden: sr.getElementById('btnHard') ? sr.getElementById('btnHard').classList.contains('hidden') : null,
    hasHard2: !!sr.getElementById('bnHard2'),
    t: Math.round(document.querySelector('video') ? document.querySelector('video').currentTime : -1)
  };
})()`;

// 1) 重载扩展，让新的 content.js 生效
const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const optSid = await attach(opt.id);
await evalOn(optSid, 'setTimeout(()=>chrome.runtime.reload(),30); "reload-queued"');
await sleep(6000);
log('extension', await evalOn(optSid, 'chrome.runtime.getManifest().version').catch(e => 'n/a ' + e.message));
await http('/json/close/' + opt.id).catch(() => {});

// 2) 新标签页打开无字幕视频
const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = await attach(tab.id);
log('tab', tab.id);
await sleep(4000);
log('video', JSON.stringify(await evalOn(sid, "document.querySelector('video') ? {dur: Math.round(document.querySelector('video').duration), paused: document.querySelector('video').paused} : {v:0}")));

// 3) 等闸门结论（应该报「该视频没有字幕」）并出现「用画面字幕试试」
let gate = null;
for (let i = 0; i < 90; i++) {
  gate = await evalOn(sid, PANEL);
  // 必须等到「用画面字幕试试」真的渲染出来再点：闸门要跑 3~5 次取样，可能 30 秒以上
  if (gate && gate.hasHard2) break;
  await sleep(1000);
}
log('gate', JSON.stringify(gate));

// 4) 起播（静音起播，硬字幕只看画面）并点「用画面字幕试试」
await evalOn(sid, "(function(){var v=document.querySelector('video'); v.muted=true; v.playbackRate=" + RATE + "; v.play(); return 'play';})()");
await sleep(1500);
const clicked = await evalOn(sid, "(function(){var sr=document.getElementById('bn-root').shadowRoot; var b=sr.getElementById('bnHard2'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()");
log('click', clicked);

// 5) 跑一段时间，每 20 秒报一次进度
for (let i = 0; i < Math.ceil(RUN / 20); i++) {
  await sleep(20000);
  const p = await evalOn(sid, PANEL);
  const h = await evalIso(sid, '(function(){var H=window.__bnState.hard; return {samples:H.samples, cues:H.cues, blocks:H.blocks, note:H.note, emptyRun:H.emptyRun, active:H.active, sents: window.__bnState.sentences.length, blocksArr: window.__bnState.blocks.length, notes: window.__bnState.notes.length, queue: window.__bnState.queue.length, verdict: window.__bnState.verdict};})()').catch(e => ({ err: e.message }));
  log('t+' + ((i + 1) * 20) + 's', JSON.stringify(p), JSON.stringify(h));
}

// 6) 停止识别，看是否能收尾成正常面板
const stop = await evalOn(sid, "(function(){var sr=document.getElementById('bn-root').shadowRoot; var b=sr.getElementById('btnHard'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()");
await sleep(3000);
log('stop', stop, JSON.stringify(await evalOn(sid, PANEL)));

// 7) 头两条笔记的内容（引文必须来自画面识别的文本）
const notes = await evalOn(sid, `(function(){
  var sr = document.getElementById('bn-root').shadowRoot;
  var arr = Array.prototype.slice.call(sr.querySelectorAll('.note')).slice(0, 2);
  return arr.map(function(n){
    return { tag: !!n.querySelector('.hstag'), text: n.innerText.slice(0, 300) };
  });
})()`);
log('notes', JSON.stringify(notes, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
writeFileSync('dist/' + SHOT, Buffer.from(shot.data, 'base64'));
log('shot dist/' + SHOT);
log('TAB_ID ' + tab.id);
ws.close();
process.exit(0);