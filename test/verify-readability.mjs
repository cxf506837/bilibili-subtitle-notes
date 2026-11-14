
// 验证「字幕疑似机翻」在真机面板上真的显示（用调试钩子置结论，不花模型钱）
const PORT = 9333, EXT = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const DIST = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\dist\\';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
function connect() {
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  const st = { ws, pend: new Map(), ctxs: new Map(), id: 0 };
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && st.pend.has(m.id)) { const p = st.pend.get(m.id); st.pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    if (m.method === 'Runtime.executionContextCreated') { const l = st.ctxs.get(m.sessionId) || []; l.push(m.params.context); st.ctxs.set(m.sessionId, l); } });
  st.ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  st.send = (method, params = {}, sessionId) => { const mid = ++st.id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => st.pend.set(mid, { res, rej })); };
  return st;
}
const conn = connect(); await conn.ready;
const send = conn.send;

// ---- 重载扩展（和 tmp-reload.mjs 同一套：等 options 页加载完再 reload） ----
{
  const t = await http('/json/new?' + encodeURIComponent('chrome-extension://' + EXT + '/src/options.html'), 'PUT');
  const sid = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await sleep(1500);
  const v = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().version', returnByValue: true }, sid);
  console.log('扩展版本', JSON.stringify(v.result && v.result.value));
  await send('Runtime.evaluate', { expression: 'setTimeout(function(){chrome.runtime.reload();},60); "sent"', returnByValue: true }, sid);
  conn.ws.close();
  await sleep(9000);
}

const conn2 = connect(); await conn2.ready;
const send2 = conn2.send;
const tab = await http('/json/new?' + encodeURIComponent('https://www.bilibili.com/video/BV1w6ZEYrEsb'), 'PUT');
const sid = (await send2('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send2('Runtime.enable', {}, sid); await send2('Page.enable', {}, sid);
const evalMain = async (expr) => { const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; };
const evalIso = async (expr) => { for (let i = 0; i < 25; i++) { const c = (conn2.ctxs.get(sid) || []).find((x) => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; } await sleep(300); } return null; };
await sleep(3000);
for (let i = 0; i < 100; i++) { const s = await evalIso('(function(){var S=window.__bnState; return S?{v:S.verdict,b:S.blocks.length,r:S.readability}:null;})()'); if (s && s.b > 0) { console.log('闸门通过', JSON.stringify({ verdict: s.v, blocks: s.b, readability: s.r })); break; } await sleep(1000); }
const PANEL = "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return null; var s=h.shadowRoot; var rn=s.getElementById('rnote'); return {status:(s.getElementById('statusText')||{}).textContent, rnote:!rn?'no-node':(rn.className.indexOf('hidden')>=0?'(隐藏)':rn.textContent), title:(rn&&rn.title)||''};})()";
const clean = await evalMain(PANEL);
console.log('正常中文字幕', JSON.stringify(clean));
const showM = await evalIso("(function(){ return window.__bnRead ? window.__bnRead.show('machine','matlab 这类词对不上') : 'NO_HOOK'; })()");
const mach = await evalMain(PANEL);
console.log('置成 machine', JSON.stringify({ showM, mach }));
const showS = await evalIso("window.__bnRead.show('suspect','')");
const susp = await evalMain(PANEL);
console.log('置成 suspect', JSON.stringify({ showS, susp }));
const ok = clean && clean.rnote === '(隐藏)' && typeof mach.rnote === 'string' && mach.rnote.indexOf('机器翻译') >= 0 && String(mach.status).indexOf('疑似机翻') >= 0 && susp.rnote.indexOf('翻译痕迹') >= 0;
console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');
const shot = await send2('Page.captureScreenshot', { format: 'png' }, sid);
const fs = await import('node:fs/promises');
await fs.writeFile(DIST + 'v054-machine.png', Buffer.from(shot.data, 'base64'));
console.log('shot dist/v054-machine.png');
await http('/json/close/' + tab.id).catch(() => {});
conn2.ws.close(); process.exit(ok ? 0 : 1);
