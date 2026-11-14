// 直接从页面隔离世界调 background 的 ocr 通道，看真实响应（排查「帧有、ocr 无」）
const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); }
});
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(()=>{}); await send('Page.enable', {}, sid).catch(()=>{}); return sid; }
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; }
async function evalIso(sid, expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; } await sleep(300); } return null; }

const tab = await http('/json/new?' + encodeURIComponent('https://www.bilibili.com/video/BV1GyZYYNErW'), 'PUT');
const sid = await attach(tab.id);
await sleep(4000);
await evalOn(sid, "(function(){var v=document.querySelector('video'); v.muted=false; if(v.currentTime<10) v.currentTime=300; v.play(); return 'ok';})()");
await sleep(4000);
const expr = "(async () => { if (window.__probe) return 'busy'; window.__probe = 1; const t0 = Date.now(); try { "
  + "const v = document.querySelector('video'); const c = document.createElement('canvas'); const w = 1280; "
  + "c.width = w; c.height = Math.round(w * v.videoHeight / v.videoWidth); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); "
  + "const d = c.toDataURL('image/jpeg', 0.9); "
  + "const r = await new Promise((res) => { const t = setTimeout(() => res({ timeout: true }), 70000); chrome.runtime.sendMessage({ type: 'ocr', dataUrl: d }, (x) => { clearTimeout(t); res({ x: x, err: (chrome.runtime.lastError || {}).message }); }); }); "
  + "return { ms: Date.now() - t0, kb: Math.round(d.length / 1024), r: r }; } catch (e) { return { ms: Date.now() - t0, exc: String((e && e.message) || e) }; } })()";
console.log('ocr', JSON.stringify(await evalIso(sid, expr), null, 1));

const list = await http('/json/list');
console.log('targets', JSON.stringify((list || []).map(t => ({ type: t.type, url: (t.url||'').slice(0, 90) })), null, 1));
await http('/json/close/' + tab.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
