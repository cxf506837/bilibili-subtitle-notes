// 批量看几个视频能不能过字幕闸门（每开一个 tab，读完就关）
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bvs = process.argv.slice(2);
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); } });
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(()=>{}); return sid; }
async function evalIso(sid, expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 200) }; return r.result.value; } await sleep(300); } return null; }
for (const bv of bvs) {
  const tab = await http('/json/new?' + encodeURIComponent('https://www.bilibili.com/video/' + bv), 'PUT');
  const sid = await attach(tab.id);
  let st = null;
  for (let i = 0; i < 35; i++) { st = await evalIso(sid, '(function(){var S=window.__bnState; if(!S) return null; return {verdict:S.verdict, sentences:S.sentences.length, blocks:S.blocks.length, dur:Math.round(document.querySelector("video").duration)};})()'); if (st && st.verdict && (st.sentences > 0 || st.verdict !== 'ok')) break; await sleep(1000); }
  console.log(bv, JSON.stringify(st));
  await http('/json/close/' + tab.id).catch(() => {});
}
ws.close(); process.exit(0);
