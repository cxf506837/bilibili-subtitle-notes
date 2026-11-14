// 把真机上采到的音量包络 + 字幕句子 dump 成 fixture，用来离线校准打分函数
const [,, url0, seekStr, waitStr, out] = process.argv;
const URL_ = url0 || 'https://www.bilibili.com/video/BV1twZ4YzEmv';
const SEEK = Number(seekStr || 200), WAIT = Number(waitStr || 90), OUT = out || 'audio-real.json';
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
// 先重载扩展（SW 会读磁盘上的新文件），否则跑的还是上一版 content.js
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const opt = await http('/json/new?' + encodeURIComponent('chrome-extension://' + EXT_ID + '/src/options.html'), 'PUT');
const sid0 = (await send('Target.attachToTarget', { targetId: opt.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid0);
await send('Runtime.evaluate', { expression: 'setTimeout(function(){chrome.runtime.reload();},30)' }, sid0);
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});

const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
async function evalMain(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }
async function evalIso(expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; } await sleep(300); } return null; }
await sleep(2500);
for (let i = 0; i < 60; i++) { const s = await evalIso('(function(){var S=window.__bnState; return S?{blocks:S.blocks.length, sent:S.sentences.length}:null;})()'); if (s && s.blocks > 0) { console.log('subtitle', JSON.stringify(s)); break; } await sleep(1000); }
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await sleep(500);
await evalMain('(function(){var v=document.querySelector("video"); v.muted=false; v.volume=1; v.currentTime=' + SEEK + '; v.play(); return 1;})()');
for (let i = 0; i < WAIT; i += 10) { await sleep(10000); console.log('t+' + (i + 10) + 's', JSON.stringify(await evalIso('(function(){return window.__bnAudio.stats();})()'))); }
const dump = await evalIso('(function(){var A=window.__bnAudio, S=window.__bnState; return {url:location.href, audio:A.samples(), res:A.res(), stats:A.stats(), sentences:S.sentences.map(function(x){return {from:x.from,to:x.to,content:x.content};})};})()');
console.log('dump-head', JSON.stringify({n:dump.audio.length, sent:dump.sentences.length, res:dump.res}).slice(0, 400));
const fs = await import('node:fs/promises');
await fs.writeFile('C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\test\\fixtures\\' + OUT, JSON.stringify({ sentences: dump.sentences, audio: dump.audio, stats: dump.stats }, null, 0));
console.log('wrote fixtures/' + OUT, 'sentences', dump.sentences.length, 'audio', dump.audio.length);
ws.close(); process.exit(0);
