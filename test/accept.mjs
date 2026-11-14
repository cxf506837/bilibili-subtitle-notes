
// 用户路径验收：真 Edge + 真扩展 + 真模型。
// 3 个不同分区的视频（拖进度 → 出笔记 → 点时间跳转 → 导出） + 1 次切走回来 + 1 个无字幕视频。
// 控制台抛错即失败；任何一条不过，退出码非 0。
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = 9333;
// 调试档目录：默认落在仓库根的 dist/，可用 BN_DIST 覆盖
const DIST = process.env.BN_DIST || fileURLToPath(new URL('../dist/', import.meta.url));
const PROFILE_PREFS = DIST + 'edge-profile\\Default\\Preferences';
const VIDEOS = [
  { bvid: 'BV1GyZYYNErW', zone: '游戏区', seek: 300, minNotes: 1 },
  { bvid: 'BV1twZ4YzEmv', zone: '影视区', seek: 620, minNotes: 1 },
  { bvid: 'BV1w6ZEYrEsb', zone: '美食区', seek: 200, minNotes: 1 },
];
const NO_SUB = { bvid: 'BV1BtZJYBE4G', zone: '知识区（无字幕样本）' };
const AWAY_MS = 95000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400)));
}

async function http(p, m = 'GET') {
  const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

// ---- 扩展 id：从 Edge 配置里按路径找，别信硬编码 ----
let extId = null;
for (const file of [PROFILE_PREFS, PROFILE_PREFS.replace('Preferences', 'Secure Preferences')]) {
  try {
    const prefs = JSON.parse(await fs.readFile(file, 'utf8'));
    const settings = (prefs.extensions && prefs.extensions.settings) || {};
    for (const [id, v] of Object.entries(settings)) if (String(v.path || '').includes('bili-notes')) extId = extId || id;
  } catch (e) { console.log('读取 Edge 配置失败（' + file.split('\\').pop() + '）：' + e.message); }
}
if (!extId) { console.log('FAIL 找不到已加载的扩展，请先运行 start-edge.ps1'); process.exit(1); }
console.log('扩展 id ' + extId);

// ---- CDP ----
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const ctxs = new Map();
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.executionContextCreated') { const l = ctxs.get(m.sessionId) || []; l.push(m.params.context); ctxs.set(m.sessionId, l); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    const cf = (d.stackTrace && d.stackTrace.callFrames) || [];
    pageErrors.push({ kind: 'exception', url: (cf[0] && cf[0].url) || d.url || '', text: String((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 240) });
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const cf = (m.params.stackTrace && m.params.stackTrace.callFrames) || [];
    pageErrors.push({ kind: 'console.error', url: (cf[0] && cf[0].url) || '', text: m.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' ').slice(0, 240) });
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    pageErrors.push({ kind: 'log', url: m.params.entry.url || '', text: String(m.params.entry.text).slice(0, 240) });
  }
});
function send(method, params = {}, sessionId) {
  const mid = ++id; const msg = { id: mid, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pend.set(mid, { res, rej }));
}

async function openTab(url) {
  const tab = await http('/json/new?' + encodeURIComponent(url), 'PUT');
  const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid); await send('Log.enable', {}, sid); await send('Page.enable', {}, sid);
  return { tabId: tab.id, sid };
}
async function evalMain(sid, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) };
  return r.result.value;
}
// 只认「我们自己那个扩展」的 isolated world：调试档里还装着沉浸式翻译、Bili SyncPlay 等，
// 它们也会各注入一个 chrome-extension:// 的 isolated context，按前缀取第一个就会拿到别人的
// （2026-11-14 实测：取到沉浸式翻译的 context，__bnState 永远 undefined → 三个视频全判 0 块）。
async function evalIso(sid, expr) {
  const want = 'chrome-extension://' + extId;
  for (let i = 0; i < 25; i++) {
    const c = (ctxs.get(sid) || []).find((x) => x.auxData && x.auxData.type === 'isolated' && x.origin === want);
    if (c) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid);
      if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) };
      return r.result.value;
    }
    await sleep(300);
  }
  return null;
}
async function shot(sid, name) {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  await fs.writeFile(DIST + name, Buffer.from(s.data, 'base64'));
}
const status = (sid) => evalMain(sid, "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return null; var s=h.shadowRoot; return {status:((s.getElementById('statusText')||{}).textContent||'').trim(), note:(s.getElementById('rnote')||{}).textContent||'', notes:s.querySelectorAll('.note').length};})()");

// ---- 0. 配置在不在 ----
{
  const t = await openTab('chrome-extension://' + extId + '/src/options.html');
  await sleep(1200);
  const cfg = await evalMain(t.sid, "new Promise(function(res){ chrome.storage.local.get(['apiBase','apiKey','model','maxTokens'], function(v){ res(v); }); })");
  check('扩展配置里有 API key 与模型', cfg && cfg.apiKey && cfg.apiKey.length >= 10 && cfg.apiBase && cfg.model, { apiBase: cfg && cfg.apiBase, model: cfg && cfg.model });
  await http('/json/close/' + t.tabId).catch(() => {});
}

// ---- 1. 三个分区：拖进度 → 出笔记 → 点时间跳转 → 导出 ----
const opened = [];
for (const v of VIDEOS) {
  const url = 'https://www.bilibili.com/video/' + v.bvid;
  const { tabId, sid } = await openTab(url);
  opened.push(tabId);
  await sleep(3000);
  let st = null; let blocks = 0;
  for (let i = 0; i < 120; i++) {
    const s = await evalIso(sid, '(function(){var S=window.__bnState; if(!S) return null; return {verdict:S.verdict, blocks:S.blocks.length, notes:S.notes.length};})()');
    if (s && s.verdict) { st = s.verdict; blocks = s.blocks || 0; }
    if (s && (s.blocks > 0 || s.verdict === 'need-login')) break;
    await sleep(1000);
  }
  check(v.zone + ' ' + v.bvid + ' 字幕通过闸门（' + blocks + ' 块）', blocks > 0, { verdict: st, blocks });
  if (blocks > 0) {
    await evalMain(sid, '(function(){var v=document.querySelector("video"); if(!v) return 0; v.currentTime=' + v.seek + '; v.play(); return v.currentTime;})()');
    let notes = 0;
    for (let i = 0; i < 90; i++) {
      notes = await evalIso(sid, '(function(){var S=window.__bnState; return S?S.notes.length:0;})()');
      if (typeof notes === 'number' && notes >= v.minNotes) break;
      await sleep(2000);
    }
    check(v.zone + ' 播到 ' + v.seek + 's 后出了笔记', typeof notes === 'number' && notes >= v.minNotes, { notes });
    await shot(sid, 'accept-' + v.bvid + '.png');

    // 点第一条笔记的时间戳 → 视频应该跳过去
    const jump = await evalMain(sid, [
      "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return null;",
      "var s=h.shadowRoot; var a=s.querySelector('.note .t a')||s.querySelector('.note .t');",
      "if(!a) return 'no-time-link'; var before=document.querySelector('video').currentTime; a.click();",
      "return {before:before, after:document.querySelector('video').currentTime, href:(a.getAttribute&&a.getAttribute('href'))||''};})()"
    ].join(''));
    const jumped = jump && typeof jump.after === 'number' && Math.abs(jump.after - jump.before) > 0.5;
    check(v.zone + ' 点笔记时间戳能跳转', jumped, jump);

    // 导出：点按钮（下载被拒），再核对 Markdown 内容
    try { await send('Page.setDownloadBehavior', { behavior: 'deny' }, sid); } catch (e) { /* 下载拦截失败不影响验收 */ }
    const clicked = await evalMain(sid, "(function(){var h=document.getElementById('bn-root'); if(!h||!h.shadowRoot) return 'no-panel'; var b=h.shadowRoot.getElementById('btnExport'); if(!b) return 'no-btn'; b.click(); return 'ok';})()");
    const md = await evalIso(sid, '(function(){ try { return window.__bnMarkdown ? window.__bnMarkdown() : ""; } catch(e) { return "ERR:" + e; } })()');
    const mdOk = typeof md === 'string' && md.length > 400 && /^---/m.test(md) && /\]\(https:\/\/www\.bilibili\.com\/video\//.test(md);
    check(v.zone + ' 导出按钮可用且 Markdown 有内容', clicked === 'ok' && mdOk, { clicked, len: typeof md === 'string' ? md.length : md });
  }
  if (v.zone === '游戏区' && blocks > 0) {
    // ---- 2. 切走 95 秒再回来 ----
    await evalIso(sid, "new Promise(function(res){ chrome.storage.local.remove('bn.awaySeen', function(){ res(1); }); })");
    const awayTab = await http('/json/new?' + encodeURIComponent('about:blank'), 'PUT');
    await send('Target.activateTarget', { targetId: awayTab.id });
    await sleep(AWAY_MS);
    await send('Target.activateTarget', { targetId: tabId });
    await sleep(2500);
    const away = await evalIso(sid, '(function(){var A=window.__bnAway; if(!A) return null; var h=document.getElementById("bn-root"); var s=h&&h.shadowRoot; return {spans:A.spans().length, banner:s?!!s.querySelector(".away"):false, text:s?((s.getElementById("awayText")||{}).textContent||"").trim():""};})()');
    check('切走 95 秒回来有补课提示', away && away.spans >= 1, away);
    await shot(sid, 'accept-away.png');
    await http('/json/close/' + awayTab.id).catch(() => {});
  }
}

// ---- 3. 无字幕视频：必须明确说不可用 ----
{
  const { tabId, sid } = await openTab('https://www.bilibili.com/video/' + NO_SUB.bvid);
  opened.push(tabId);
  let s = null; let verdict = '';
  for (let i = 0; i < 120; i++) {
    s = await status(sid);
    const v = await evalIso(sid, '(function(){var S=window.__bnState; return S?S.verdict:"";})()');
    if (typeof v === 'string' && v) verdict = v;
    if (verdict) break;
    await sleep(1000);
  }
  // 这个 profile 是已登录的，所以「请先登录」不算通过——那说明登录态掉了，验收要红。
  // 判据：verdict 必须是明确的失败结论，且状态条写出一句具体的人话（≥4 字）。
  // 「字幕和视频对不上」「字幕只有一部分」「这个视频没有字幕」都算合格拒绝；
  // 但登录态相关提示不算——那是环境问题，不是「这个视频没字幕」。
  const NO_SUB_VERDICTS = ['noSubs', 'rejected', 'truncated', 'overflow', 'malformed', 'empty', 'emptyUrl', 'ambiguous', 'timeout'];
  const statusText = ((s && s.status) || '').trim();
  const noteText = ((s && s.note) || '').trim();
  const loginLost = verdict === 'need-login' || /请先登录|登录后|未登录|need-login/i.test(statusText + ' ' + noteText);
  const saysNo = !loginLost && NO_SUB_VERDICTS.includes(verdict) && statusText.length >= 4;
  check(NO_SUB.zone + ' 无字幕要有明确提示（不能静默）', saysNo, { verdict, status: statusText, note: noteText, loginLost });
  await shot(sid, 'accept-nosub.png');
}

// ---- 4. 控制台 ----
// 只认「我们自己的代码」抛的错：B站 自己的播放器 tracker WebSocket 断连是环境噪声，
// 但扩展的 isolated world 里任何异常/console.error 都算失败。
const ours = pageErrors.filter((e) => String(e.url || '').includes('chrome-extension://' + extId) || /chrome-extension:\/\/[a-p]{32}/.test(e.text || ''));
const noise = pageErrors.filter((e) => ours.indexOf(e) < 0);
if (noise.length) console.log('（忽略 ' + noise.length + ' 条第三方/bilibili 站点噪声，例如 ' + JSON.stringify(noise[0]).slice(0, 160) + '）');
check('扩展自己没抛异常 / 没打 console.error', ours.length === 0, ours.slice(0, 5));

for (const t of opened) await http('/json/close/' + t).catch(() => {});
ws.close();
console.log('');
console.log('通过 ' + results.filter((r) => r.ok).length + ' / 失败 ' + failed);
console.log('截图：dist/accept-*.png');
process.exit(failed ? 1 : 0);
