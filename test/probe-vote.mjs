
// 投票闸门真机探针：同一个 (aid,cid) 会返回不同文件，检查扩展现在挑的是哪份。
// 用法：$env:BN_EXT='<id>'; node test/probe-vote.mjs [bvid] [--fresh]
import fs from 'node:fs/promises';
const PORT = 9333;
const DIST = 'C:/Users/Admin/Documents/deepseek-harness/default-workspace/bili-notes/dist/';
const BVID = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'BV1JynA6aEug';
const FRESH = process.argv.includes('--fresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
let extId = process.env.BN_EXT || null;
if (!extId) {
  for (const f of [DIST + 'edge-profile/Default/Preferences', DIST + 'edge-profile/Default/Secure Preferences']) {
    try { const p = JSON.parse(await fs.readFile(f, 'utf8')); for (const [id, v] of Object.entries((p.extensions || {}).settings || {})) if (String(v.path || '').includes('bili-notes')) extId = extId || id; } catch {}
  }
}
if (!extId) { console.log('FAIL 扩展没加载（先运行 start-edge.ps1，或设 BN_EXT=<扩展id>）'); process.exit(1); }

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
      } catch (e) {
        // 页面重载后旧 context 会失效，剔掉再找新的
        const cur = ctxs.get(sid) || [];
        ctxs.set(sid, cur.filter((x) => x.id !== c.id));
      }
    }
    await sleep(300);
  }
  return null;
}

const { tabId, sid } = await openTab('https://www.bilibili.com/video/' + BVID);
await sleep(2500);
if (FRESH) {
  // 清掉字幕缓存，逼它重新取样（否则会直接命中本地缓存，看不到投票过程）
  await evalMain(sid, "new Promise(function(res){ var r=indexedDB.deleteDatabase('bn-notes'); r.onsuccess=function(){res(1);}; r.onerror=function(){res(0);}; r.onblocked=function(){res(-1);}; })");
  await send('Page.reload', {}, sid);
  await sleep(3000);
}
let st = null;
for (let i = 0; i < 120; i++) {
  st = await evalIso(sid, '(function(){var S=window.__bnState; if(!S) return null; return {verdict:S.verdict, votes:S.votes||0, blocks:S.blocks.length, sents:S.sentences.length, first:(S.sentences[0]||{}).content||"", log:(S.gateLog||[]).map(function(a){return a.state+":"+(a.cover===undefined?"":a.cover)+":"+(a.votes||"");})};})()');
  if (st && st.verdict) break;
  await sleep(1000);
}
const ui = await evalMain(sid, "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return null; var s=h.shadowRoot; return {status:((s.getElementById('statusText')||{}).textContent||'').trim(), empty:((s.getElementById('emptyHint')||{}).textContent||'').trim().slice(0,90)};})()");
console.log('BVID ' + BVID + (FRESH ? '（已清缓存）' : '（用现有缓存）'));
console.log('状态 ' + JSON.stringify(ui));
console.log('闸门 ' + JSON.stringify(st && { verdict: st.verdict, votes: st.votes, blocks: st.blocks, sents: st.sents }));
console.log('取样过程 ' + JSON.stringify(st && st.log));
console.log('首句 ' + (st && st.first));
console.log('异常 ' + JSON.stringify(errs.slice(0, 3)));
const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
await fs.writeFile(DIST + 'probe-vote.png', Buffer.from(s.data, 'base64'));
console.log('TAB_ID ' + tabId);
ws.close(); process.exit(0);
