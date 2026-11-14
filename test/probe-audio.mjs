// 验证：音频通道接进扩展，采样在涨、且能给出音画对齐结论
const [,, url0, seekStr, waitStr, shotName] = process.argv;
const URL_ = url0 || 'https://www.bilibili.com/video/BV1twZ4YzEmv';
const SEEK = Number(seekStr || 200), WAIT = Number(waitStr || 60), SHOT = shotName || 'v050-audio.png';
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
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

// 1) 先重载扩展，确保跑的是磁盘上刚改的 content.js / audio.js
const opt = await http('/json/new?' + encodeURIComponent('chrome-extension://' + EXT_ID + '/src/options.html'), 'PUT');
const sid0 = (await send('Target.attachToTarget', { targetId: opt.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid0);
const optInfo = await send('Runtime.evaluate', { expression: '(function(){var c=document.getElementById("audioEnabled"); var m=chrome.runtime.getManifest(); return {name:m.name, version:m.version, audioToggle:!!c, checked:c?c.checked:null};})()', returnByValue: true }, sid0);
console.log('options', JSON.stringify(optInfo.result.value));
await send('Runtime.evaluate', { expression: 'setTimeout(function(){chrome.runtime.reload();},30)' }, sid0);
await sleep(6000);
await http('/json/close/' + opt.id).catch(() => {});

// 2) 打开视频页
const tab = await http('/json/new?' + encodeURIComponent(URL_), 'PUT');
const sid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
async function evalMain(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }
async function evalIso(expr) { for (let i = 0; i < 20; i++) { const l = ctxs.get(sid) || []; const c = l.find(x => x.auxData && x.auxData.type === 'isolated' && x.origin && x.origin.startsWith('chrome-extension')); if (c) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: c.id }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; } await sleep(300); } return null; }
await sleep(2500);
for (let i = 0; i < 60; i++) { const s = await evalIso('(function(){var S=window.__bnState; return S?{verdict:S.verdict, blocks:S.blocks.length, sent:S.sentences.length}:null;})()'); if (s && s.blocks > 0) { console.log('subtitle', JSON.stringify(s)); break; } await sleep(1000); }
// 先给一次真实点击（拿播放手势，否则浏览器把带声音的播放拦成静音播放）
console.log('enable', JSON.stringify(await evalIso('(function(){return window.__bnAudio.enabled(true);})()')));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 400, button: 'left', clickCount: 1 }, sid);
await sleep(600);
console.log('click', JSON.stringify(await evalMain('(function(){var v=document.querySelector("video"); return v?{paused:v.paused, muted:v.muted, volume:v.volume, t:Math.round(v.currentTime)}:null;})()')));
console.log('play', JSON.stringify(await evalMain('(function(){var v=document.querySelector("video"); if(!v) return "no-video"; v.muted=false; v.volume=1; v.currentTime=' + SEEK + '; return v.play().then(function(){return {dur:v.duration, paused:v.paused, muted:v.muted};}).catch(function(e){return "play-fail:"+e.message;});})()')));
await sleep(1500);
console.log('after-play', JSON.stringify(await evalMain('(function(){var v=document.querySelector("video"); return {paused:v.paused, muted:v.muted, volume:v.volume, t:Math.round(v.currentTime)};})()')));

const STAT = "(function(){var A=window.__bnAudio, S=window.__bnState; var st=A?A.stats():null; var h=document.getElementById('bn-root'); var tag=h&&h.shadowRoot?h.shadowRoot.getElementById('audioTag'):null; return {stats:st, res:A?A.res():null, samples:A?A.count():0, enabled:S?S.audio.enabled:null, tag:tag?tag.textContent:null, hidden:tag?tag.classList.contains('hidden'):null, t:Math.round((document.querySelector('video')||{}).currentTime||0)};})()";
for (let i = 0; i <= WAIT; i += 10) {
  console.log('t+' + i + 's', JSON.stringify(await evalIso(STAT)));
  if (i === 20) console.log('tick@20s', JSON.stringify(await evalIso('(function(){return window.__bnAudio.tick();})()')));
  await sleep(10000);
}
console.log('after', JSON.stringify(await evalIso(STAT)));
const res = await evalIso('(function(){return window.__bnAudio.res();})()');
console.log('res', JSON.stringify(res));
const samples = await evalIso('(function(){return window.__bnAudio.stats();})()');
console.log('stats', JSON.stringify(samples));
// 切走标签页，看 AudioContext 会不会被挂起
await send('Target.createTarget', { url: 'about:blank' });
await sleep(6000);
console.log('after-blur', JSON.stringify(await evalIso('(function(){return {st:window.__bnAudio.stats(), ctx:(window.__bnAudio.stats()||{}).ctx};})()')));
const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
const fs = await import('node:fs/promises');
await fs.writeFile('C:\\Users\\Admin\\Documents\\deepseek-harness\\default-workspace\\bili-notes\\dist\\' + SHOT, Buffer.from(shot.data, 'base64'));
console.log('shot dist/' + SHOT, 'tab', tab.id);
ws.close(); process.exit(0);
