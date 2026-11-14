// 验证：自然取帧的 OCR 文字进入模型 prompt，并渲染成笔记（跑到块结束为止）
const [,, url0, seekStr, waitStr, shotName] = process.argv;
const URL_ = url0 || 'https://www.bilibili.com/video/BV1twZ4YzEmv';
const SEEK = Number(seekStr || 620), WAIT = Number(waitStr || 150), SHOT = shotName || 'v040-note.png';
const PORT = 9333, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); } });
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
async function evalMain(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }
async function evalIso(expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; } await sleep(300); } return null; }
await sleep(2500);
for (let i = 0; i < 40; i++) { const s = await evalIso('(function(){var S=window.__bnState; return S? {verdict:S.verdict, blocks:S.blocks.length}:null;})()'); if (s && s.blocks > 0) { console.log('subtitle', JSON.stringify(s)); break; } await sleep(1000); }
await evalMain('(function(){var v=document.querySelector("video"); if(!v) return "no-video"; v.currentTime=' + SEEK + '; v.play(); return v.duration;})()');
const PANEL = "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return null; var s=h.shadowRoot; return {status:(s.getElementById('statusText')||{}).textContent, cost:(s.getElementById('cost')||{}).textContent, vsum:Array.from(s.querySelectorAll('.vsum')).map(function(x){return x.textContent.trim();}), vtext:Array.from(s.querySelectorAll('.vtext')).map(function(x){return x.textContent.trim().slice(0,200);}), notes:s.querySelectorAll('.note').length, t:(document.querySelector('video')||{}).currentTime};})()";
let last = null;
for (let i = 0; i <= WAIT; i += 5) {
  last = await evalMain(PANEL);
  const st = await evalIso('(function(){var S=window.__bnState; var V=window.__bnVisual; return {frames:V?V.stats().frames:0, ocr:V?V.stats().ocr:0, notes:S?S.notes.length:0, t:S?Math.round(S.lastTime||0):0, withVisual:S?S.notes.filter(function(n){return n.visual&&n.visual.length;}).length:0};})()');
  console.log('t+' + i + 's', JSON.stringify({ st, panel: last }));
  if (st && st.withVisual > 0 && last && last.vsum.length > 0) break;
  await sleep(5000);
}
const detail = await evalIso('(function(){var S=window.__bnState; return S.notes.filter(function(n){return n.visual&&n.visual.length;}).map(function(n){return {start:n.start, summary:n.blockSummary, visual:n.visual.map(function(v){return [v.t, v.text.slice(0,120)];}), plain:(n.points||[]).map(function(p){return p.plain;}).slice(0,4), quotes:(n.points||[]).map(function(p){return p.quote;}).slice(0,2)};});})()');
console.log('notesWithVisual', JSON.stringify(detail, null, 1));
const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
const fs = await import('node:fs/promises');
await fs.writeFile('C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\dist\\' + SHOT, Buffer.from(shot.data, 'base64'));
console.log('shot dist/' + SHOT);
await http('/json/close/' + tab.id).catch(() => {});
ws.close(); process.exit(0);
