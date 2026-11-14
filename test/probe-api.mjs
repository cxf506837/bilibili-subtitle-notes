// 未登录上下文里，B站字幕接口到底返回什么（定位「检查字幕 1/3」卡住）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = process.env.BN_CHROME;
const PORT = 9334;
const URL_ = process.argv[2] || 'https://www.bilibili.com/video/BV1GJ411x7h7';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'bn-probe-'));
const chrome = spawn(CHROME, ['--window-position=-2400,-2400','--window-size=1280,900','--no-first-run','--no-default-browser-check','--user-data-dir=' + profile,'--remote-debugging-port=' + PORT,'about:blank'], { stdio: 'ignore' });
let v = null;
for (let i = 0; i < 40; i++) { try { v = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch { await sleep(500); } }
if (!v) { console.log('FAIL launch'); process.exit(1); }
const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let idc = 0;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++idc; const t = setTimeout(() => reject(new Error('timeout ' + method)), 60000);
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { clearTimeout(t); ws.removeEventListener('message', h); resolve(m.result); } };
  ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }));
});
await rpc('Runtime.enable', {});
await sleep(6000);
const expr = `(async () => {
  const out = {};
  const t = (k, ms) => { out[k] = ms; };
  let t0 = performance.now();
  const bv = 'BV1GJ411x7h7';
  const view = await (await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv, { credentials: 'include' })).json();
  t('viewMs', Math.round(performance.now() - t0));
  out.view = { code: view.code, aid: view.data && view.data.aid, cid: view.data && view.data.cid, dur: view.data && view.data.duration };
  t0 = performance.now();
  const pv = await (await fetch('https://api.bilibili.com/x/player/v2?aid=' + out.view.aid + '&cid=' + out.view.cid, { credentials: 'include' })).json();
  t('playerMs', Math.round(performance.now() - t0));
  const sub = pv.data && pv.data.subtitle;
  out.player = { code: pv.code, need_login: sub && sub.need_login_subtitle, n: sub && sub.subtitles ? sub.subtitles.length : null };
  const first = sub && sub.subtitles && sub.subtitles[0];
  out.track = first ? { lan: first.lan, lan_doc: first.lan_doc, host: first.subtitle_url.slice(0, 60) } : null;
  if (first) {
    const url = first.subtitle_url.startsWith('//') ? 'https:' + first.subtitle_url : first.subtitle_url;
    t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const txt = await r.text();
      t('fileMs', Math.round(performance.now() - t0));
      out.file = { status: r.status, bytes: txt.length, head: txt.slice(0, 60) };
    } catch (e) { t('fileMs', Math.round(performance.now() - t0)); out.file = { error: String(e).slice(0, 120) }; }
  }
  return JSON.stringify(out);
})()`;
const r = await rpc('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(r.result.value || JSON.stringify(r).slice(0, 500));
chrome.kill();
process.exit(0);
