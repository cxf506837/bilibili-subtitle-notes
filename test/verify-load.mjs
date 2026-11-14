// 用真浏览器加载扩展，验证：manifest 能装、content script 注入、浮层渲染、service worker 起来、options 页能开
// 用法: BN_CHROME=<path> node test/verify-load.mjs [视频URL]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.BN_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = 'C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes';
const PORT = 9333;
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GyZYYNErW';
const profile = mkdtempSync(join(tmpdir(), 'bn-verify-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  // headless=new 里扩展不加载（Chrome 156 实测）；离屏窗口会被冻结，必须放可见位置
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
for (let i = 0; i < 40; i++) {
  try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; }
  catch (e) { await sleep(500); }
}
if (!version) { console.log('FAIL: CDP 端口没起来'); chrome.kill(); process.exit(1); }
console.log('browser:', version['Browser']);

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const timer = setTimeout(() => reject(new Error('rpc timeout ' + method)), 20000);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === myId) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  return { ws, rpc };
}
const evaluate = async (con, expr) => {
  const r = await con.rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
};

// 找我们自己的 service worker：Edge 自带 'Gemini in Chrome' 也有 background.js，必须按名字认领
let mine = null, swCon = null;
for (let i = 0; i < 30; i++) {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  for (const t of list.filter(x => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))) {
    try {
      const con = await connect(t.webSocketDebuggerUrl);
      await con.rpc('Runtime.enable', {});
      const name = await evaluate(con, 'chrome.runtime.getManifest().name');
      if (name && name.includes('可核对笔记')) { mine = t; swCon = con; break; }
      con.ws.close();
    } catch (e) {}
  }
  if (mine) break;
  await sleep(500);
}
console.log(mine ? 'service_worker: OK ' + mine.url : 'service_worker: MISSING');

// 视频页
const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
const pg = await connect(tab.webSocketDebuggerUrl);
await pg.rpc('Runtime.enable', {});
const events = [];
pg.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    events.push('[' + m.params.type + '] ' + txt.slice(0, 300));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    events.push('[EXCEPTION] ' + String(d.exception && (d.exception.description || d.exception.value) || d.text || '').slice(0, 300));
  }
});

const probe = () => evaluate(pg, `(() => {
  const h = document.getElementById('bn-root');
  const r = h && h.shadowRoot;
  const t = r ? r.getElementById('statusText') : null;
  return { ready: document.readyState, hasHost: !!h, status: t ? t.textContent : null,
           detail: t ? t.title : null, notes: r ? r.querySelectorAll('.note').length : 0,
           title: document.title.slice(0, 40) };
})()`);

let state = null;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  state = await probe();
  if (state && state.hasHost && state.status) break;
}
console.log('page:', JSON.stringify(state));
for (let i = 0; i < 25; i++) {
  if (!state || !/取字幕|检查字幕/.test(state.status)) break;
  await sleep(1000);
  state = await probe();
}
console.log('final:', JSON.stringify(state));
const extCtx = await evaluate(pg, 'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id ? chrome.runtime.id : null');
console.log('runtime.id in page:', extCtx);

// options 页
if (mine) {
  const extId = new URL(mine.url).host;
  const opt = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('chrome-extension://' + extId + '/src/options.html'), { method: 'PUT' })).json();
  const optCon = await connect(opt.webSocketDebuggerUrl);
  await optCon.rpc('Runtime.enable', {});
  await sleep(1200);
  console.log('options page:', await evaluate(optCon, 'JSON.stringify({ href: location.href.slice(0, 60), inputs: [...document.querySelectorAll("input")].map(i => i.id), storage: typeof chrome.storage })'));
}

console.log('--- console/exception events ---');
console.log(events.filter(e => e.includes('[BN]') || e.startsWith('[EXCEPTION]') || e.startsWith('[error]')).join('\n') || '(none)');
chrome.kill();
process.exit(0);