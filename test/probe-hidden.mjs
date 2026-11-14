// 只测「切走 95 秒」这一条，并把 __bnAwayDebug 的现场打出来
// 用法: node test/probe-hidden.mjs [url]
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GyZYYNErW';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
async function http(path, method = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + path, { method }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); } });
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(targetId) { const r = await send('Target.attachToTarget', { targetId, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(() => {}); await send('Page.enable', {}, sid).catch(() => {}); return sid; }
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; }
async function evalIso(sid, expr) { await sleep(300); const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (!c) throw new Error('no iso ctx'); const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) throw new Error('iso: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; }

const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const optSid = await attach(opt.id);
await evalOn(optSid, 'setTimeout(()=>chrome.runtime.reload(),30); "ok"');
await evalOn(optSid, "chrome.storage.local.remove('bn.awaySeen').then(()=>'cleared-awaySeen')");
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});
log('reloaded');

const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = await attach(tab.id);
await sleep(3000);
for (let i = 0; i < 40; i++) {
  const ok = await evalOn(sid, "(function(){var r=document.getElementById('bn-root'); if(!r) return false; var s=r.shadowRoot.getElementById('statusText'); return !!s && s.textContent.indexOf('字幕')>=0;})()");
  if (ok) break;
  await sleep(1000);
}
await evalOn(sid, "(function(){var v=document.querySelector('video'); v.muted=false; v.play(); return 1;})()");
await sleep(12000);
log('base', JSON.stringify(await evalIso(sid, '(function(){var S=window.__bnState; return {spans:S.away.spans, lastTime:+S.lastTime.toFixed(2), spansEnabled:S.away.enabled};})()')));

const awayTab = await http('/json/new?about:blank', 'PUT');
await attach(awayTab.id);
await send('Target.activateTarget', { targetId: awayTab.id });
await sleep(1000);
log('vis', await evalOn(sid, 'document.visibilityState'));
await sleep(95000);
await send('Target.activateTarget', { targetId: tab.id });
await sleep(4000);
log('after', JSON.stringify(await evalOn(sid, `(function(){var sr=document.getElementById('bn-root').shadowRoot; return {
  t: Math.round(document.querySelector('video').currentTime), vids: document.querySelectorAll('video').length,
  bannerShown: !sr.getElementById('away').classList.contains('hidden'), bannerText: sr.getElementById('awayText').textContent,
  miniShown: !sr.getElementById('awayMini').classList.contains('hidden'), miniText: sr.getElementById('awayMini').textContent,
  awayTags: Array.from(sr.querySelectorAll('.awaytag')).map(function(e){return e.textContent;}) };})()`)));
const st = await evalIso(sid, '(function(){var S=window.__bnState; return {spans:S.away.spans, lastTime:+S.lastTime.toFixed(2), dbg:window.__bnAwayDebug};})()');
log('spans', JSON.stringify(st.spans));
log('dbg', JSON.stringify(st.dbg, null, 1));
await send('Page.captureScreenshot', { format: 'png' }, sid).then(r => writeFileSync('dist/probe-hidden.png', Buffer.from(r.data, 'base64'))).catch(() => {});
await http('/json/close/' + awayTab.id).catch(() => {});
log('TAB_ID', tab.id);
ws.close(); process.exit(0);
