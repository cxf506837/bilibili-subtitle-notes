// 真机验证走神补课：直接驱动已在 9333 跑着的 Edge（用专用 profile，登录态/Key 都在）
// 用法: node test/verify-away.mjs [url]
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GyZYYNErW';
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
const ctxs = new Map(); // sessionId -> [executionContext]
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
// 主世界（页面自己的 JS）
async function evalOn(sid, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
// 扩展 content script 的隔离世界：只有这里能读到 __bnState / __bnAway
async function evalIso(sid, expr) {
  await sleep(300);
  const list = ctxs.get(sid) || [];
  const ctx = list.find(c => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension'));
  if (!ctx) throw new Error('isolated context not found: ' + list.map(c => c.origin + '/' + (c.auxData && c.auxData.type)).join(','));
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx.id }, sid);
  if (r.exceptionDetails) throw new Error('evalIso: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

// 1) 让扩展重新加载（新 content.js 才会注入新开的页面）
const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const optSid = await attach(opt.id);
await evalOn(optSid, 'setTimeout(()=>chrome.runtime.reload(),30); "reload-queued"');
// 清掉 24 小时去重记录，保证这次能看到横幅（真实使用时它是有意保留的）
await evalOn(optSid, "chrome.storage.local.remove('bn.awaySeen').then(()=>'cleared')");
await sleep(6000);
const optInfo = await evalOn(optSid, 'chrome.runtime.getManifest().name + " " + chrome.runtime.getManifest().version').catch(e => 'n/a ' + e.message);
await http('/json/close/' + opt.id).catch(() => {});
log('extension reloaded', optInfo);

// 2) 开一个新标签页（不碰用户自己的 tab）
const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = await attach(tab.id);
log('tab', tab.id);
await sleep(3000);
const v = await evalOn(sid, "document.querySelector('video') ? {v:1, dur: Math.round(document.querySelector('video').duration)} : {v:0}");
log('video', JSON.stringify(v));

// 3) 等字幕 + 起播
for (let i = 0; i < 40; i++) {
  const ok = await evalOn(sid, "(function(){var r=document.getElementById('bn-root'); if(!r) return false; var s=r.shadowRoot.getElementById('statusText'); return s ? s.textContent.indexOf('字幕')>=0 || s.textContent.indexOf('段')>=0 : false;})()");
  if (ok) break;
  await sleep(1000);
}
await evalOn(sid, "(function(){var v=document.querySelector('video'); v.muted=false; v.play(); return 'play';})()");
await sleep(20000);
const base = await evalOn(sid, `(function(){
  var sr=document.getElementById('bn-root').shadowRoot;
  return { status: sr.getElementById('statusText').textContent, cost: sr.getElementById('cost').textContent,
           notes: sr.querySelectorAll('.note').length, t: Math.round(document.querySelector('video').currentTime),
           videos: document.querySelectorAll('video').length };
})()`);
log('baseline', JSON.stringify(base));

// 4) 真的切走 95 秒（另开一个空白 tab 并激活它 → 原 tab 变 hidden，视频继续播）
const awayTab = await http('/json/new?about:blank', 'PUT');
await attach(awayTab.id);
await send('Target.activateTarget', { targetId: awayTab.id });
await sleep(1000);
const ourVis = await evalOn(sid, 'document.visibilityState');
log('visibility after switching', ourVis);
await sleep(95000);
await send('Target.activateTarget', { targetId: tab.id });
await sleep(4000);
const afterAway = await evalOn(sid, `(function(){
  var sr=document.getElementById('bn-root').shadowRoot;
  return { status: sr.getElementById('statusText').textContent, notes: sr.querySelectorAll('.note').length,
           t: Math.round(document.querySelector('video').currentTime),
           videos: document.querySelectorAll('video').length,
           bannerShown: !sr.getElementById('away').classList.contains('hidden'),
           bannerText: sr.getElementById('awayText').textContent,
           miniShown: !sr.getElementById('awayMini').classList.contains('hidden'),
           awayTags: Array.from(sr.querySelectorAll('.awaytag')).map(function(e){return e.textContent;}),
           vis: document.visibilityState };
})()`);
log('afterAway', JSON.stringify(afterAway));
const st = await evalIso(sid, '(function(){var S=window.__bnState; return {spans:S.away.spans, lastTime:S.lastTime, covered:S.covered, notes:S.notes.length};})()');
log('state', JSON.stringify(st));
const sp = st.spans[st.spans.length - 1];
if (sp) log('SPAN_CHECK', JSON.stringify({ a: +sp.a.toFixed(1), b: +sp.b.toFixed(1), span: +(Math.max(sp.a, sp.b) - Math.min(sp.a, sp.b)).toFixed(1), reason: sp.reason, ms: sp.ms }));
await send('Page.captureScreenshot', { format: 'png' }, sid).then(r => writeFileSync('dist/v031-away.png', Buffer.from(r.data, 'base64'))).catch(() => {});

// 5) 打开补课看看
await evalOn(sid, "document.getElementById('bn-root').shadowRoot.getElementById('awayOpen').click()");
await sleep(600);
const catchup = await evalOn(sid, `(function(){var sr=document.getElementById('bn-root').shadowRoot;
  return { head: (sr.querySelector('.catchup .ch')||{}).textContent, rows: Array.from(sr.querySelectorAll('.catchup .row')).map(function(r){return r.textContent.trim();}).slice(0,6) };})()`);
log('catchup', JSON.stringify(catchup));
await evalOn(sid, "(function(){var b=document.getElementById('bn-root').shadowRoot.querySelector('.catchup .cf .btn'); if(b) b.click(); return 1;})()");
await sleep(300);

// 6) 真暂停 125 秒再回来
await evalOn(sid, "(function(){document.querySelector('video').pause(); return 'paused';})()");
await sleep(125000);
const pausedSpan = await evalIso(sid, '(function(){var S=window.__bnState; return {spans:S.away.spans, lastTime:S.lastTime};})()');
await evalOn(sid, "(function(){document.querySelector('video').play(); return 'resumed';})()");
await sleep(5000);
const afterPause = await evalOn(sid, `(function(){var sr=document.getElementById('bn-root').shadowRoot;
  return { notes: sr.querySelectorAll('.note').length, t: Math.round(document.querySelector('video').currentTime),
           bannerShown: !sr.getElementById('away').classList.contains('hidden'),
           bannerText: sr.getElementById('awayText').textContent,
           miniShown: !sr.getElementById('awayMini').classList.contains('hidden'),
           miniText: sr.getElementById('awayMini').textContent };})()`);
log('afterPause', JSON.stringify(afterPause));
const st2 = await evalIso(sid, '(function(){var S=window.__bnState; return {spans:S.away.spans, lastTime:S.lastTime};})()');
log('state2', JSON.stringify(st2));
await send('Page.captureScreenshot', { format: 'png' }, sid).then(r => writeFileSync('dist/v031-away-pause.png', Buffer.from(r.data, 'base64'))).catch(() => {});
log('TAB_ID', tab.id);
ws.close();
process.exit(0);
