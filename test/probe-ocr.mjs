// 直接在 offscreen.html 里跑一次 OCR 初始化，排查「帧取到了但 ocr 永远为 0」
const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Log.entryAdded') logs.push('LOG ' + m.params.entry.level + ': ' + m.params.entry.text.slice(0, 300));
});
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid); await send('Log.enable', {}, sid).catch(()=>{}); return sid; }
async function evalOn(sid, expr, timeout = 90000) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; }

const tab = await http('/json/new?chrome-extension://' + EXT_ID + '/src/offscreen.html', 'PUT');
const sid = await attach(tab.id);
await sleep(2000);
console.log('PPU', JSON.stringify(await evalOn(sid, 'typeof window.PPU + "/" + Object.keys(window.PPU||{}).join(",") + " ort=" + (window.PPU && window.PPU.ort ? window.PPU.ort.version : "-")')));
const expr = "(async () => { "
  + "const t0 = performance.now(); "
  + "const lim = new Promise((r) => setTimeout(() => r({ok:false, err:'timeout-75s'}), 75000)); "
  + "const run = (async () => { try { "
  + "const {PaddleOcrService, ort} = window.PPU; "
  + "ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ocr/ort/'); ort.env.wasm.numThreads = 1; "
  + "const svc = new PaddleOcrService({ model: { detection: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_det.ort'), recognition: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_rec.ort'), charactersDictionary: chrome.runtime.getURL('vendor/ocr/models/ppocrv6_tiny_dict.txt') }, session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }, recognition: { mainThreadYieldMs: 0 } }); "
  + "await svc.initialize(); window.__svc = svc; return { ok: true, ms: Math.round(performance.now() - t0) }; } catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), err: String((e && e.message) || e).slice(0, 400) }; } })(); "
  + "return await Promise.race([run, lim]); })()";
console.log('init', JSON.stringify(await evalOn(sid, expr)));
console.log('LOGS', JSON.stringify(logs.slice(-15), null, 1));
// 再用一张真实帧跑识别
const shot = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
console.log('ocr-small', JSON.stringify(await evalOn(sid, "(async()=>{ try { if(!window.__svc) return 'no-svc'; const img=new Image(); img.src='data:image/jpeg;base64," + shot + "'; await img.decode(); const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext('2d').drawImage(img,0,0); const r=await window.__svc.recognize(c); return {lines:(r.lines||[]).length}; } catch(e){ return 'ERR '+String(e&&e.message||e).slice(0,300);} })()")));
await http('/json/close/' + tab.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
