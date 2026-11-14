
// 看这个视频真实产出的笔记（内容对不对，是不是人话）。
// 用法：$env:BN_EXT='<id>'; node test/probe-notes.mjs [bvid] [seek秒] [跑多少秒]
import fs from 'node:fs/promises';
const PORT = 9333;
const DIST = 'C:/Users/Admin/Documents/deepseek-harness/default-workspace/bili-notes/dist/';
const BVID = process.argv[2] || 'BV1JynA6aEug';
const SEEK = Number(process.argv[3] || 0);
const RUN = Number(process.argv[4] || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const EXT = process.env.BN_EXT || 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
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
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function openTab(url) { const tab = await http('/json/new?' + encodeURIComponent(url), 'PUT'); const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId; await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid); return { tabId: tab.id, sid }; }
async function evalMain(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); return r.exceptionDetails ? { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) } : r.result.value; }
async function evalIso(sid, expr) {
  for (let i = 0; i < 40; i++) {
    const list = ctxs.get(sid) || [];
    const c = [...list].reverse().find((x) => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension'));
    if (c) {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid);
        return r.exceptionDetails ? { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) } : r.result.value;
      } catch (e) { ctxs.set(sid, (ctxs.get(sid) || []).filter((x) => x.id !== c.id)); }
    }
    await sleep(300);
  }
  return null;
}
const { tabId, sid } = await openTab('https://www.bilibili.com/video/' + BVID);
await sleep(3000);
for (let i = 0; i < 60; i++) {
  const s = await evalIso(sid, '(function(){var S=window.__bnState; return S?{v:S.verdict,b:S.blocks.length}:null;})()');
  if (s && s.b > 0) break;
  await sleep(1000);
}
await evalMain(sid, '(function(){var v=document.querySelector("video"); if(!v) return 0; v.muted=false; v.playbackRate=2; v.currentTime=' + SEEK + '; v.play(); return Math.round(v.currentTime);})()');
const t0 = Date.now();
while (Date.now() - t0 < RUN * 1000) {
  const n = await evalIso(sid, '(function(){var S=window.__bnState; return S?S.notes.length:0;})()');
  if (n >= 3) break;
  await sleep(3000);
}
const out = await evalIso(sid, '(function(){var S=window.__bnState; return {verdict:S.verdict,votes:S.votes,tokens:S.tokens,notes:(S.notes||[]).map(function(n){return {start:Math.round(n.start),sum:n.blockSummary,one:n.oneThing,pts:(n.points||[]).map(function(p){return {q:(p.quote||"").slice(0,60),plain:p.plain,kind:p.kind};})};})};})()');
console.log('闸门 ' + JSON.stringify({ verdict: out && out.verdict, votes: out && out.votes, tokens: out && out.tokens }));
console.log(JSON.stringify(out && out.notes, null, 1).slice(0, 4000));
console.log('异常 ' + JSON.stringify(errs.slice(0, 3)));
const s2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
await fs.writeFile(DIST + 'probe-notes.png', Buffer.from(s2.data, 'base64'));
console.log('TAB_ID ' + tabId);
ws.close(); process.exit(0);
