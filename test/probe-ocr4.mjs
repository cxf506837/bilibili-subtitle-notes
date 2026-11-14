// 直接在 offscreen 文档里跑一次真图 OCR，看是「消息没到」还是「OCR 卡住」
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
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 240));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
});
function send(method, params = {}, sessionId) { const mid = ++id; const msg = { id: mid, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pend.set(mid, { res, rej })); }
async function attach(t) { const r = await send('Target.attachToTarget', { targetId: t, flatten: true }); const sid = r.sessionId; await send('Runtime.enable', {}, sid).catch(()=>{}); await send('Page.enable', {}, sid).catch(()=>{}); return sid; }
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 400) }; return r.result.value; }

// 让 offscreen 文档存在：先开 options 页唤醒 SW，再调一次 ocr-warmup（不等结果）
const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const osid = await attach(opt.id);
await evalOn(osid, "chrome.runtime.sendMessage({type:'ocr'}).catch(()=>0); 'fired'");
await sleep(3000);
const list = await http('/json/list');
const off = (list || []).find(t => t.url.includes('/src/offscreen.html'));
console.log('offscreen target', off ? off.type : 'none');
if (!off) { console.log('done-no-target'); process.exit(0); }
const sid = await attach(off.id);
await sleep(1000);
console.log('env', JSON.stringify(await evalOn(sid, '({ppu: typeof window.PPU, keys: window.PPU ? Object.keys(window.PPU) : null, hasSvc: typeof window.__svc, vis: document.visibilityState, url: location.href.slice(0,80)})')));
const expr = "(async () => { const t0 = performance.now(); const lim = new Promise(r => setTimeout(() => r({ok:false, err:'timeout-30s', ms:30000}), 30000)); const run = (async () => { try { "
  + "const svc = window.__svc || (window.__svcP = (async()=>{ const {PaddleOcrService, ort} = window.PPU; ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ocr/ort/'); ort.env.wasm.numThreads = 1; const s = new PaddleOcrService({ model: { detection: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_det.ort'), recognition: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_rec.ort'), charactersDictionary: chrome.runtime.getURL('vendor/ocr/models/ppocrv6_tiny_dict.txt') }, session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }, recognition: { mainThreadYieldMs: 0 } }); await s.initialize(); window.__svc = s; return s; })()); "
  + "const s = await svc; const c = document.createElement('canvas'); c.width = 700; c.height = 200; const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,700,200); g.fillStyle='#000'; g.font='48px serif'; g.fillText('光合作用 光反应 12:05', 20, 110); "
  + "const res = await s.recognize(c); return { ok:true, ms: Math.round(performance.now()-t0), text: res.text }; } catch(e) { return { ok:false, ms: Math.round(performance.now()-t0), err: String((e&&e.message)||e).slice(0,300) }; } })(); return await Promise.race([run, lim]); })()";
console.log('direct', JSON.stringify(await evalOn(sid, expr)));
console.log('logs', JSON.stringify(logs.slice(-10), null, 1));
await http('/json/close/' + opt.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
