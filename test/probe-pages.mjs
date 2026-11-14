// 验证：多 P（分 P）——按 ?p=N 取对分 P、SPA 切 P 不刷新也能换字幕/笔记、笔记按分 P 分开存
// 用法：node test/probe-pages.mjs [BV] [起始p]
const [,, bv0, p0] = process.argv;
const BV = bv0 || 'BV1rH4y1N7BW';
const P = Number(p0 || 2);
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const PORT = 9333, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\dist\\';
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push(((d.exception && d.exception.description) || d.text || '').slice(0, 160) + ' @' + String(d.url || '').split('/').pop() + ':' + d.lineNumber); }
});
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }

// 1) 重载扩展，确保跑的是磁盘上的 content.js
const opt = await http('/json/new?' + encodeURIComponent('chrome-extension://' + EXT_ID + '/src/options.html'), 'PUT');
const sid0 = (await send('Target.attachToTarget', { targetId: opt.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid0);
const info = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().version', returnByValue: true }, sid0);
console.log('ext version', info.result.value);
await send('Runtime.evaluate', { expression: 'setTimeout(function(){chrome.runtime.reload();},30)' }, sid0);
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});

// 2) 开 P2
const url = 'https://www.bilibili.com/video/' + BV + '?p=' + P;
const tab = await http('/json/new?' + encodeURIComponent(url), 'PUT');
const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
async function evMain(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }
async function evIso(expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; } await sleep(300); } return null; }
const STATE = "(function(){var S=window.__bnState; if(!S) return null; var h=document.getElementById('bn-root'); var sr=h&&h.shadowRoot; var pl=sr?sr.getElementById('pLabel'):null; var st=sr?sr.getElementById('statusText'):null; return {page:S.meta?S.meta.page:null, cid:S.meta?S.meta.cid:null, dur:S.meta?S.meta.pageDur:null, part:S.meta?S.meta.part:null, total:S.meta?S.meta.pages:null, verdict:S.verdict, blocks:S.blocks.length, notes:S.notes.length, pLabel:pl?pl.textContent:null, pLabelHidden:pl?pl.classList.contains('hidden'):null, status:st?st.textContent:null, bvid:S.bvid, p:S.p, gateLog:S.gateLog};})()";

let s = null; let prevKey = '';
for (let i = 0; i < 100; i++) {
  s = await evIso(STATE);
  const key = s ? (String(s.cid) + '|' + s.blocks + '|' + s.status) : 'null';
  if (key !== prevKey) { console.log('  t+' + i + 's ' + JSON.stringify({cid:s&&s.cid, blocks:s&&s.blocks, status:s&&s.status, p:s&&s.p})); prevKey = key; }
  if (s && s.blocks > 0) break;
  await sleep(1000);
}
console.log('P' + P + ' state', JSON.stringify(s));
if (!s || !s.blocks) {
  const diag = await evIso(`(async function(){ var G=window.BnGate, S=window.__bnState; if(!S.meta) return {err:'no-meta'}; try { var t0=Date.now(); var tr=await G.fetchTracks(S.meta.aid, S.meta.cid); return {ms:Date.now()-t0, needLogin:tr.needLogin, tracks:(tr.tracks||[]).length}; } catch(e) { return {err:String(e).slice(0,120)}; } })()`);
  console.log('diag fetchTracks now', JSON.stringify(diag));
}

// 3) 播一会儿，让 P2 出几条真笔记
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await sleep(500);
await evMain('(function(){var v=document.querySelector("video"); if(!v) return "no-video"; v.muted=false; v.volume=0.2; v.currentTime=120; return v.play().then(function(){return 1;}).catch(function(e){return "play-fail:"+e.message;});})()');
for (let i = 0; i < 14; i++) { await sleep(5000); const q = await evIso(STATE); if (q && q.notes >= 2) { s = q; break; } s = q; }
console.log('P' + P + ' after play', JSON.stringify(s));
await evMain('(function(){var v=document.querySelector("video"); if(v) v.pause(); return 1;})()');
const shot1 = await send('Page.captureScreenshot', { format: 'png' }, sid);
const fs = await import('node:fs/promises');
await fs.writeFile(OUT + 'v051-p2.png', Buffer.from(shot1.data, 'base64'));

// 4) 真点分 P 列表里的下一 P（SPA 切，不刷新）
await evMain('window.__bnMark = 1; 1');
const rect = await evMain(`(function(){var it=document.querySelectorAll('.video-pod__item'); for(var i=0;i<it.length;i++){ if(!it[i].classList.contains('active')){ var r=it[i].getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), key:it[i].dataset.key, txt:(it[i].textContent||'').trim().slice(0,30)}; } } return null;})()`);
console.log('next item', JSON.stringify(rect));
if (rect && rect.x) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sid);
}
let s2 = null;
for (let i = 0; i < 60; i++) { s2 = await evIso(STATE); if (s2 && s2.cid && s2.cid !== s.cid) break; await sleep(1000); }
for (let i = 0; i < 40; i++) { const q = await evIso(STATE); if (q && q.blocks > 0) { s2 = q; break; } await sleep(1000); }
console.log('after switch', JSON.stringify(s2));
console.log('no-reload', JSON.stringify(await evMain('(function(){return {mark:window.__bnMark===1, url:location.href};})()')));
const shot2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
await fs.writeFile(OUT + 'v051-switch.png', Buffer.from(shot2.data, 'base64'));

// 5) 切回原来的 P：笔记应该从 IndexedDB 恢复
const back = await evMain(`(function(){var it=document.querySelectorAll('.video-pod__item'); var want='` + s.cid + `'; for(var i=0;i<it.length;i++){ if(it[i].dataset.key===want){ var r=it[i].getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; } } return null;})()`);
console.log('back item', JSON.stringify(back));
if (back && back.x) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: back.x, y: back.y, button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: back.x, y: back.y, button: 'left', clickCount: 1 }, sid);
}
let s3 = null;
for (let i = 0; i < 60; i++) { s3 = await evIso(STATE); if (s3 && s3.cid === s.cid && s3.blocks > 0) break; await sleep(1000); }
console.log('back state', JSON.stringify(s3));
console.log('errors', JSON.stringify(errs));
console.log('TAB_ID ' + tab.id);
ws.close(); process.exit(0);