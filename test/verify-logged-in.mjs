// 登录态下的真扩展验证：把 B站 cookie 注入独立测试 profile，跑真实字幕链路
// 用法: BN_CHROME=edge.msedge.exe BN_COOKIES=<json> node test/verify-logged-in.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.BN_CHROME;
const COOKIES = process.env.BN_COOKIES;
const EXT = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes';
const PORT = 9335;
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GJ411x7h7';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'bn-login-'));

const chrome = spawn(CHROME, [
  '--window-position=80,80', '--window-size=1280,900',
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--load-extension=' + EXT,
  '--disable-extensions-except=' + EXT,
  '--remote-debugging-port=' + PORT,
  'about:blank',
], { stdio: 'ignore' });

let version = null;
for (let i = 0; i < 40; i++) { try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch { await sleep(500); } }
if (!version) { console.log('FAIL: chrome not up'); chrome.kill(); process.exit(1); }

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

// 1) 浏览器级 CDP 注入 cookie
const br = await connect(version.webSocketDebuggerUrl);
const cookies = JSON.parse(readFileSync(COOKIES, 'utf8'));
const setRes = await br.rpc('Storage.setCookies', { cookies });
console.log('cookies injected:', cookies.length, 'err:', JSON.stringify(setRes || {}).slice(0, 200));

// 2) 开页面
const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
const pg = await connect(tab.webSocketDebuggerUrl);
await pg.rpc('Runtime.enable', {});
await pg.rpc('Page.enable', {});
const events = [];
pg.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    if (txt.includes('[BN]') || m.params.type === 'error') events.push('[' + m.params.type + '] ' + txt.slice(0, 200));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    events.push('[EXCEPTION] ' + String(d.exception && (d.exception.description || d.exception.value) || d.text).slice(0, 300));
  }
});
const evalIn = async (expr, id) => {
  const r = await pg.rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
};

const probe = (id) => evalIn(`(() => {
  const h = document.getElementById('bn-root');
  const r = h && h.shadowRoot;
  const t = r ? r.getElementById('statusText') : null;
  return { hasHost: !!h, status: t && t.textContent, detail: t && t.title,
           notes: r ? r.querySelectorAll('.note').length : 0 };
})()`, id);

let st = null;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  st = await probe(1000 + i);
  if (st && st.status && !/取字幕|检查字幕/.test(st.status)) break;
  if (i % 10 === 0) console.log('  ...', JSON.stringify(st));
}
console.log('final:', JSON.stringify(st));

// 直接把播放头推到 120 秒，看队列是否能出笔记
if (st && /等待播放/.test(st.status || '')) {
  await evalIn('(function(){ var v=document.querySelector("video"); if(!v) return "no-video"; v.currentTime=120; return v.currentTime; })()', 2000);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    st = await probe(3000 + i);
    if (st.notes > 0) break;
  }
  console.log('after seek:', JSON.stringify(st));
}
console.log('events:', events.length ? events.join(' | ') : '(none)');
chrome.kill();
process.exit(0);
