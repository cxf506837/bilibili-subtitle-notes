// 端到端：真扩展 + 真 B站登录态 + 真字幕文件 + 本地假模型
// 用法: BN_CHROME=edge BN_COOKIES=<json> node test/verify-e2e.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const CHROME = process.env.BN_CHROME;
const COOKIES = process.env.BN_COOKIES;
const SRC_EXT = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes';
const PORT = 9336;
const MOCK_PORT = 8791;
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GyZYYNErW';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- 1) 复制扩展并放行本机假模型 ----
const extDir = mkdtempSync(join(tmpdir(), 'bn-ext-'));
mkdirSync(join(extDir, 'src'));
cpSync(join(SRC_EXT, 'src'), join(extDir, 'src'), { recursive: true });
const mf = JSON.parse(readFileSync(join(SRC_EXT, 'manifest.json'), 'utf8'));
mf.host_permissions = (mf.host_permissions || []).concat(['http://127.0.0.1/*']);
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(mf, null, 2), 'utf8');

// ---- 2) 假模型服务 ----
const calls = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push(body.length);
    let lines = [];
    try {
      const payload = JSON.parse(body);
      const user = payload.messages.filter(m => m.role === 'user').pop().content;
      lines = user.split('\n').filter(l => /^\\d+\\|/.test(l.trim())).map(l => l.trim().split('|'));
    } catch (e) {}
    const pts = lines.slice(0, 2).map((l) => ({
      quote: l[2], sentence_ids: [Number(l[0])], start: Number(l[1]), end: Number(l[1]) + 1.5,
      plain: '测试用的解释', kind: 'conclusion', terms: [], analogy: null,
    }));
    const content = JSON.stringify({ block_summary: '这一段在讲测试内容', points: pts, one_thing: '测试用的一句话' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', choices: [{ index: 0, message: { role: 'assistant', content } }], usage: { total_tokens: 120 } }));
  });
});
await new Promise(r => server.listen(MOCK_PORT, '127.0.0.1', r));

// ---- 3) 启动浏览器 ----
const profile = mkdtempSync(join(tmpdir(), 'bn-e2e-'));
const chrome = spawn(CHROME, [
  '--window-position=80,80', '--window-size=1280,900',
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--load-extension=' + extDir,
  '--disable-extensions-except=' + extDir,
  '--remote-debugging-port=' + PORT,
  'about:blank',
], { stdio: 'ignore' });

let version = null;
for (let i = 0; i < 40; i++) { try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch { await sleep(500); } }
if (!version) { console.log('FAIL chrome'); process.exit(1); }

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const t = setTimeout(() => reject(new Error('timeout ' + method)), 60000);
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === myId) { clearTimeout(t); ws.removeEventListener('message', h); resolve(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  return { ws, rpc };
}

// cookie
const br = await connect(version.webSocketDebuggerUrl);
const cookies = JSON.parse(readFileSync(COOKIES, 'utf8'));
await br.rpc('Storage.setCookies', { cookies });
console.log('cookies:', cookies.length);

// 等 service worker：注意 Edge 自带的 "Gemini in Chrome" 也有 background.js，
// 必须按 getManifest().name 认领，否则连错扩展（之前就错连了 admccj... 那个）
let sw = null, swCon = null;
for (let i = 0; i < 40; i++) {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const cands = list.filter(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
  for (const c of cands) {
    try {
      const con = await connect(c.webSocketDebuggerUrl);
      await con.rpc('Runtime.enable', {});
      const r = await con.rpc('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true });
      const name = r.result && r.result.value;
      if (name && name.includes('可核对笔记')) { sw = c; swCon = con; break; }
      con.ws.close();
    } catch (e) {}
  }
  if (sw) break;
  await sleep(500);
}
if (!sw) { console.log('FAIL: no service worker'); process.exit(1); }
console.log('our sw:', sw.url);
// 配置写进 storage：直接在 service worker 里 evaluate（同步 fire-and-forget，不 awaitPromise 以免挂住）
const probeSw = await swCon.rpc('Runtime.evaluate', { expression: 'typeof chrome.storage + " | " + chrome.runtime.getURL("src/options.html")', returnByValue: true });
console.log('sw probe:', probeSw.result && probeSw.result.value);
const mfProbe = await swCon.rpc('Runtime.evaluate', { expression: 'JSON.stringify({name: chrome.runtime.getManifest().name, perms: chrome.runtime.getManifest().permissions, keys: Object.keys(chrome).slice(0,20), id: chrome.runtime.id})', returnByValue: true });
console.log('sw manifest:', mfProbe.result && mfProbe.result.value);
const fired = await swCon.rpc('Runtime.evaluate', {
  expression: 'chrome.storage.local.set({ apiBase: ' + JSON.stringify('http://127.0.0.1:' + MOCK_PORT + '/v1') + ', apiKey: "mock-key", model: "mock-model", maxTokens: 700 }); "fired"',
  returnByValue: true,
});
console.log('set:', fired.result && fired.result.value, fired.exceptionDetails ? JSON.stringify(fired.exceptionDetails).slice(0, 200) : '');
await sleep(1000);
const got = await swCon.rpc('Runtime.evaluate', {
  expression: 'new Promise((res) => chrome.storage.local.get(null, (v) => res(JSON.stringify(v))))',
  awaitPromise: true, returnByValue: true,
});
console.log('config:', got.result && got.result.value, got.exceptionDetails ? 'ERR' : '');

// ---- 4) 打开视频 ----
const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
const pg = await connect(tab.webSocketDebuggerUrl);
await pg.rpc('Runtime.enable', {});
const events = [];
pg.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    if (txt.includes('[BN]') || m.params.type === 'error') events.push('[' + m.params.type + '] ' + txt.slice(0, 160));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    events.push('[EXCEPTION] ' + String(d.exception && (d.exception.description || d.exception.value) || d.text).slice(0, 240));
  }
});
const evalIn = async (expr) => { const r = await pg.rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; };
const probe = () => evalIn(`(() => {
  const host = document.getElementById('bn-root');
  if (!host || !host.shadowRoot) return { status: null, detail: null, notes: 0, firstQuote: '', firstTime: '' };
  const r = host.shadowRoot;
  const t = r.getElementById('statusText');
  return { status: t.textContent, detail: t.title, notes: r.querySelectorAll('.note').length,
           firstQuote: (r.querySelector('.note .q') || {}).textContent || '', firstTime: (r.querySelector('.note .t') || {}).textContent || '' };
})()`);

const seen = [];
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const st = (await probe()) || { status: null, detail: null, notes: 0, firstQuote: '', firstTime: '' };
  if (!st.status) continue;
  if (!seen.includes(st.status)) { seen.push(st.status); console.log('  status@' + i + 's:', st.status, '|', st.detail); }
  if (/等待播放/.test(st.status)) break;
  if (i > 3 && /失败|不可用|没有字幕|请先登录/.test(st.status)) break;
}

// 推到 120 秒让队列跑起来
await evalIn('(function(){ var v=document.querySelector("video"); if(!v) return "no-video"; v.muted=false; v.currentTime=400; v.play().catch(function(){}); return v.currentTime; })()');
let st = null;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  st = await probe();
  if (st.notes > 0) break;
}
console.log('notes:', st.notes, '| status:', st.status, '| first:', st.firstTime, st.firstQuote.slice(0, 30));

// SPA 跳走再回来：应该走会话缓存直接还原，不重跑闸门、不丢笔记
if (st.notes > 0) {
  const keep = st.notes;
  await evalIn("history.pushState({}, '', '/video/BV1GJ411x7h7'); 1");
  await sleep(9000);
  const mid = await probe();
  console.log('after nav away:', mid.status, '| notes', mid.notes);
  await evalIn("history.pushState({}, '', '/video/BV1GyZYYNErW'); 1");
  let back = null;
  for (let i = 0; i < 15; i++) { await sleep(1000); back = await probe(); if (/已恢复/.test(back.status || '')) break; }
  console.log('after nav back:', back.status, '| notes', back.notes, '(was', keep + ')');
}

// 点第一条笔记的时间戳，看是否跳转
if (st.notes > 0) {
  const before = await evalIn('document.querySelector("video").currentTime');
  await evalIn(`(() => { const r = document.getElementById('bn-root').shadowRoot; r.querySelector('.note .t').click(); return 1; })()`);
  await sleep(1500);
  const after = await evalIn('document.querySelector("video").currentTime');
  console.log('click-to-seek:', Math.round(before), '->', Math.round(after));
}
console.log('mock calls:', calls.length);
console.log('events:', events.length ? events.slice(0, 8).join('\n  ') : '(none)');
chrome.kill(); server.close();
process.exit(0);
