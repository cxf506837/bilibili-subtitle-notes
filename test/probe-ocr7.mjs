// 看 recognize 返回的 lines 结构（真机报 Cannot read properties of undefined (reading 'y')）
const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(()=>{}); return sid; }
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; }

const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const osid = await attach(opt.id);
await evalOn(osid, "chrome.runtime.sendMessage({target:'offscreen', type:'ocr-warmup'}).catch(()=>0); 'fired'");
await sleep(2500);
const list = await http('/json/list');
const off = (list || []).find(t => t.url.includes('/src/offscreen.html'));
if (!off) { console.log('no offscreen'); process.exit(0); }
const sid = await attach(off.id);
const expr = "(async () => { const c = document.createElement('canvas'); c.width = 700; c.height = 200; const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,700,200); g.fillStyle='#000'; g.font='48px serif'; g.fillText('\u5b9e\u9a8c \u5149\u5408\u4f5c\u7528 12:05', 20, 110);"
  + " const {PaddleOcrService, ort} = window.PPU; if (!window.__svc) { ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ocr/ort/'); ort.env.wasm.numThreads = 1; const s = new PaddleOcrService({ model: { detection: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_det.ort'), recognition: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_rec.ort'), charactersDictionary: chrome.runtime.getURL('vendor/ocr/models/ppocrv6_tiny_dict.txt') }, session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }, recognition: { mainThreadYieldMs: 0 } }); await s.initialize(); window.__svc = s; }"
  + " const r = await window.__svc.recognize(c); return { keys: Object.keys(r), text: r.text, n: (r.lines||[]).length, l0: JSON.stringify((r.lines||[])[0]).slice(0, 400) }; })()";
console.log('shape', JSON.stringify(await evalOn(sid, expr), null, 1));
await http('/json/close/' + opt.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
