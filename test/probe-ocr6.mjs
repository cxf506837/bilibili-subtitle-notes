// 在 offscreen 文档里逐步跑：建 svc → decode dataUrl → recognize，看卡在哪一步
const PORT = 9333;
const EXT_ID = 'mdpphognlfhkeenfmpopbbgmpdhafpfp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(p, m = 'GET') { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: m }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
const ver = await http('/json/version');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 200));
});
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(()=>{}); return sid; }
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; }

const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const osid = await attach(opt.id);
await evalOn(osid, "chrome.runtime.sendMessage({target:'offscreen', type:'ocr-warmup'}).catch(()=>0); 'fired'");
await sleep(2500);
const list = await http('/json/list');
const off = (list || []).find(t => t.url.includes('/src/offscreen.html'));
console.log('offscreen', off ? off.type : 'none');
const sid = await attach(off.id);
await sleep(800);
const expr = "(async () => { const out = {}; const t0 = performance.now();"
  + " const c = document.createElement('canvas'); c.width = 700; c.height = 200; const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,700,200); g.fillStyle='#000'; g.font='48px serif'; g.fillText('\u5149\u5408\u4f5c\u7528 \u5149\u53cd\u5e94 12:05', 20, 110);"
  + " const d = c.toDataURL('image/jpeg', 0.9); out.dataKb = Math.round(d.length/1024);"
  + " const race = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r('TIMEOUT'), ms))]);"
  + " try { const s = await race((async()=>{ const {PaddleOcrService, ort} = window.PPU; ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ocr/ort/'); ort.env.wasm.numThreads = 1; const sv = new PaddleOcrService({ model: { detection: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_det.ort'), recognition: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_rec.ort'), charactersDictionary: chrome.runtime.getURL('vendor/ocr/models/ppocrv6_tiny_dict.txt') }, session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }, recognition: { mainThreadYieldMs: 0 } }); await sv.initialize(); return sv; })(), 40000);"
  + " if (s === 'TIMEOUT') { out.init = 'TIMEOUT'; return out; } out.initMs = Math.round(performance.now()-t0);"
  + " const t1 = performance.now(); const r1 = await race(s.recognize(c), 40000); out.recCanvas = r1 === 'TIMEOUT' ? 'TIMEOUT' : { ms: Math.round(performance.now()-t1), text: r1.text };"
  + " const t2 = performance.now(); const img = new Image(); img.src = d; const dec = await race(img.decode(), 20000); out.decode = dec === 'TIMEOUT' ? 'TIMEOUT' : Math.round(performance.now()-t2);"
  + " if (out.decode !== 'TIMEOUT') { const c2 = document.createElement('canvas'); c2.width = img.naturalWidth; c2.height = img.naturalHeight; c2.getContext('2d').drawImage(img,0,0); const t3 = performance.now(); const r2 = await race(s.recognize(c2), 40000); out.recDataUrl = r2 === 'TIMEOUT' ? 'TIMEOUT' : { ms: Math.round(performance.now()-t3), text: r2.text, lines: (r2.lines||[]).length }; }"
  + " } catch (e) { out.err = String((e && e.stack) || e).slice(0, 400); } return out; })()";
console.log('steps', JSON.stringify(await evalOn(sid, expr), null, 1));
console.log('logs', JSON.stringify(logs.slice(-6), null, 1));
await http('/json/close/' + opt.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
