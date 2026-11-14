// 从扩展页直接给 offscreen 发消息（绕开 background），验证监听器本身
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
async function evalOn(sid, expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.exceptionDetails) return { exc: JSON.stringify(r.exceptionDetails).slice(0, 300) }; return r.result.value; }

const opt = await http('/json/new?chrome-extension://' + EXT_ID + '/src/options.html', 'PUT');
const sid = await attach(opt.id);
await sleep(1500);
const mk = "(function(){var c=document.createElement('canvas');c.width=700;c.height=200;var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,700,200);g.fillStyle='#000';g.font='48px serif';g.fillText('\u5149\u5408\u4f5c\u7528 \u5149\u53cd\u5e94 12:05',20,110);return c.toDataURL('image/jpeg',0.9);})()";
const dataUrl = await evalOn(sid, mk);
console.log('dataUrl kb', Math.round(String(dataUrl).length / 1024));
const probe = (payload, ms) => "(async()=>{const t0=Date.now(); const r = await new Promise(res=>{ const t=setTimeout(()=>res({timeout:true})," + ms + "); chrome.runtime.sendMessage(" + payload + ", x=>{clearTimeout(t); res({x:x, err:(chrome.runtime.lastError||{}).message});}); }); return {ms:Date.now()-t0, r:r};})()";
console.log('warmup', JSON.stringify(await evalOn(sid, probe("{target:'offscreen', type:'ocr-warmup'}", 20000))));
const pay = "{target:'offscreen', type:'ocr', dataUrl: '" + dataUrl + "'}";
const r = await evalOn(sid, probe(pay, 30000));
if (r && r.r && r.r.x) r.r.x.text = String(r.r.x.text || '').slice(0, 200);
console.log('ocr-direct', JSON.stringify(r));
await http('/json/close/' + opt.id).catch(() => {});
ws.close();
console.log('done');
process.exit(0);
