// 验证：多 P 的冷启动路径（IndexedDB 清空 → 两个分 P 各自跑闸门、笔记互不串）
const [,, bv0] = process.argv;
const BV = bv0 || 'BV1rH4y1N7BW';
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const PORT = 9333, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\dist\\';
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); } });
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }

const opt = await http('/json/new?' + encodeURIComponent('chrome-extension://' + EXT_ID + '/src/options.html'), 'PUT');
const sid0 = (await send('Target.attachToTarget', { targetId: opt.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid0);
console.log('ext version', (await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().version', returnByValue: true }, sid0)).result.value);
await send('Runtime.evaluate', { expression: 'setTimeout(function(){chrome.runtime.reload();},30)' }, sid0);
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});

const tab = await http('/json/new?' + encodeURIComponent('https://www.bilibili.com/video/' + BV + '?p=2'), 'PUT');
const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
async function evMain(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }
// 页面 reload 之后旧 contextId 会失效：取最新的隔离世界 context，并容忍 evaluate 抛错重试
async function evIso(expr) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const l = ctxs.get(sid) || [];
    const list = l.filter(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension'));
    const c = list[list.length - 1];
    if (c) {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid);
        if (!r.exceptionDetails) return r.result.value;
        last = { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) };
      } catch (e) { /* 旧上下文，等新的 */ }
    }
    await sleep(300);
  }
  return last;
}
await sleep(3000);
// 清空本地缓存 → 冷启动，两个分 P 都要自己跑一遍闸门
// 扩展自己开着库，deleteDatabase 会被 block；改成直接清空 object store
console.log('wipe db', JSON.stringify(await evMain('(function(){ return new Promise(function(res){ var o=indexedDB.open("bn-notes"); o.onsuccess=function(){ var db=o.result; var tx=db.transaction("videos","readwrite"); tx.objectStore("videos").clear(); tx.oncomplete=function(){ db.close(); res("cleared"); }; tx.onerror=function(){ res("tx-err"); }; }; o.onerror=function(){ res("open-err"); }; }); })()')));
await send('Page.reload', { ignoreCache: true }, sid);
await sleep(4000);
const STATE = "(function(){var S=window.__bnState; if(!S) return null; var h=document.getElementById('bn-root'); var sr=h&&h.shadowRoot; var pl=sr?sr.getElementById('pLabel'):null; var st=sr?sr.getElementById('statusText'):null; return {page:S.meta?S.meta.page:null, cid:S.meta?S.meta.cid:null, dur:S.meta?S.meta.pageDur:null, part:S.meta?S.meta.part:null, verdict:S.verdict, blocks:S.blocks.length, notes:S.notes.length, pLabel:pl?pl.textContent:null, status:st?st.textContent:null, p:S.p, gateLog:S.gateLog};})()";
let s = null;
for (let i = 0; i < 90; i++) { s = await evIso(STATE); if (s && s.blocks > 0) break; await sleep(1000); }
console.log('P2 fresh', JSON.stringify(s));
// 播 30 秒，出 1~2 条真笔记
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await sleep(500);
await evMain('(function(){var v=document.querySelector("video"); if(!v) return "no-video"; v.muted=false; v.volume=0.15; v.currentTime=300; return v.play().then(function(){return 1;}).catch(function(e){return "play-fail:"+e.message;});})()');
for (let i = 0; i < 12; i++) { await sleep(5000); const q = await evIso(STATE); if (q && q.notes >= 1) { s = q; break; } s = q; }
console.log('P2 notes', JSON.stringify(s));
await evMain('(function(){var v=document.querySelector("video"); if(v) v.pause(); return 1;})()');

// 切到 P1（真点列表）
const rect = await evMain(`(function(){var it=document.querySelectorAll('.video-pod__item'); for(var i=0;i<it.length;i++){ if(it[i].dataset.key==='1519829483'){ var r=it[i].getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; } } return null;})()`);
console.log('click P1', JSON.stringify(rect));
if (rect && rect.x) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sid);
}
let s1 = null;
for (let i = 0; i < 90; i++) { s1 = await evIso(STATE); if (s1 && s1.cid === 1519829483 && s1.blocks > 0) break; await sleep(1000); }
console.log('P1 fresh', JSON.stringify(s1));
const fs = await import('node:fs/promises');
const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
await fs.writeFile(OUT + 'v051-p1.png', Buffer.from(shot.data, 'base64'));
console.log('TAB_ID ' + tab.id);
ws.close(); process.exit(0);