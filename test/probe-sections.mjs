
// 验证「小节标题」：真浏览器 + 真扩展 + 真模型，播到 8 块出笔记后应出现一个小节。
// 用法：node test/probe-sections.mjs [bvid] [最多跑多少秒]
import fs from 'node:fs/promises';
const PORT = 9333;
const DIST = 'C:/Users/Admin/Documents/deepseek-harness/default-workspace/bili-notes/dist/';
const EXT_PATH = 'C:/Users/Admin/Documents/deepseek-harness/default-workspace/bili-notes';
const BVID = process.argv[2] || 'BV1JynA6aEug';
const RUN = Number(process.argv[3] || 420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') {
  const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map(); const errs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String((m.params.exceptionDetails.exception || {}).description || '').slice(0, 160));
});
function send(method, params = {}, sessionId) {
  const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej }));
}
async function openTab(url) {
  const tab = await http('/json/new?' + encodeURIComponent(url), 'PUT');
  const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
  return { tabId: tab.id, sid };
}
// 页面被 B站 换掉/刷新时，旧 context 上的 evaluate 永远不返回 ⇒ 必须自己加超时
function withTimeout(p, ms) {
  return Promise.race([p, sleep(ms).then(() => ({ __timeout: true }))]);
}
async function evalMain(sid, expr) {
  const r = await withTimeout(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid), 5000);
  if (!r || r.__timeout) return null;
  return r.exceptionDetails ? { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) } : r.result.value;
}
async function evalIso(sid, expr) {
  for (let i = 0; i < 40; i++) {
    const list = ctxs.get(sid) || [];
    const c = [...list].reverse().find((x) => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension'));
    if (c) {
      try {
        const r = await withTimeout(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid), 5000);
        if (!r || r.__timeout) return null;
        return r.exceptionDetails ? { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) } : r.result.value;
      } catch (e) { ctxs.set(sid, (ctxs.get(sid) || []).filter((x) => x.id !== c.id)); }
    }
    await sleep(300);
  }
  return null;
}
// 先确保扩展在（profile 重启后未打包扩展不会自动回来）
let extId = process.env.BN_EXT || '';
const boot = await openTab('https://www.bilibili.com/');
try {
  const r = await send('Extensions.loadUnpacked', { path: EXT_PATH }, boot.sid);
  if (r && r.id) extId = r.id;
} catch (e) { /* 已加载过也没关系 */ }
console.log('扩展 ' + (extId || '?'));
await http('/json/close/' + boot.tabId);

const { tabId, sid } = await openTab('https://www.bilibili.com/video/' + BVID + '/?p=1');
await sleep(3500);
if (process.argv.includes('--fresh')) {
  await evalMain(sid, 'new Promise(function(r){var rq=indexedDB.deleteDatabase("bn-notes");rq.onsuccess=function(){r("ok");};rq.onerror=function(){r("err");};setTimeout(function(){r("timeout");},3000);})');
  await send('Page.reload', {}, sid);
  await sleep(4000);
}
for (let i = 0; i < 90; i++) {
  const s = await evalIso(sid, '(function(){var S=window.__bnState; return S?{v:S.verdict,b:S.blocks.length}:null;})()');
  if (s && s.b > 0) break;
  await sleep(1000);
}
await evalMain(sid, '(function(){var v=document.querySelector("video"); if(!v) return 0; v.muted=false; v.playbackRate=2; v.currentTime=0; v.play(); return 1;})()');
const t0 = Date.now();
let last = -1;
while (Date.now() - t0 < RUN * 1000) {
  const s = await evalIso(sid, '(function(){var S=window.__bnState; return S?{n:S.notes.length,sec:(S.sections||[]).length,b:S.blocks.length,t:Math.round((S.lastTime||0))}:null;})()');
  if (s) {
    if (s.n !== last) { console.log('进度 notes=' + s.n + '/' + s.b + ' 小节=' + s.sec + ' 播放头=' + s.t + 's'); last = s.n; }
    if (s.sec >= 1) break;
  }
  await sleep(4000);
}
const out = await evalIso(sid, '(function(){var S=window.__bnState; var sh=document.getElementById("bn-root")&&document.getElementById("bn-root").shadowRoot; var items=sh?sh.querySelectorAll("#outline .item"):[]; var rows=[]; for(var i=0;i<items.length;i++) rows.push(items[i].className+" :: "+items[i].textContent); return {sections:(S.sections||[]).map(function(s){return {title:s.title,one:s.oneLine,from:Math.round(s.from),to:Math.round(s.to)};}), notes:S.notes.length, blocks:S.blocks.length, tokens:S.tokens, rows:rows.slice(0,16)};})()');
console.log('小节 ' + JSON.stringify(out && out.sections));
console.log('提纲 ' + JSON.stringify(out && out.rows));
console.log('统计 notes=' + (out && out.notes) + ' blocks=' + (out && out.blocks) + ' tokens=' + (out && out.tokens));
console.log('异常 ' + JSON.stringify(errs.slice(0, 3)));
const s2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
await fs.writeFile(DIST + 'v070-sections.png', Buffer.from(s2.data, 'base64'));
console.log('TAB_ID ' + tabId);
ws.close(); process.exit(0);
