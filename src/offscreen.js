// offscreen 文档：跑本地 PP-OCRv6 tiny（wasm）。每帧约 1.3~1.5 秒，串行执行。
'use strict';

const MODEL = {
  detection: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_det.ort'),
  recognition: chrome.runtime.getURL('vendor/ocr/models/PP-OCRv6_tiny_rec.ort'),
  charactersDictionary: chrome.runtime.getURL('vendor/ocr/models/ppocrv6_tiny_dict.txt'),
};

let svcPromise = null;
let chain = Promise.resolve();

function getService() {
  if (svcPromise) return svcPromise;
  svcPromise = (async () => {
    const { PaddleOcrService, ort } = window.PPU;
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ocr/ort/');
    ort.env.wasm.numThreads = 1; // 扩展页面没有 crossOriginIsolated，多线程会起不来
    const svc = new PaddleOcrService({
      model: MODEL,
      session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
      recognition: { mainThreadYieldMs: 0 },
    });
    await svc.initialize();
    return svc;
  })();
  return svcPromise;
}

// offscreen 文档不参与渲染，img.decode() 在这里永远不 resolve（实测 20 秒超时），
// 必须用 createImageBitmap 显式解码。
async function dataUrlToCanvas(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('not-a-data-url');
  const type = m[1] || 'image/jpeg';
  const bin = atob(m[3]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: type }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  cv.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return cv;
}

// 按 box 的行高把识别结果重排：PP-OCR 的返回顺序在「左标题 + 右侧列表」这种版式上会交错
// recognize() 返回的 lines 可能是「每张图一个数组」的嵌套结构，先拍平
function flattenLines(lines) {
  const out = [];
  for (const l of lines || []) {
    if (Array.isArray(l)) out.push(...l);
    else if (l) out.push(l);
  }
  return out;
}

function orderLines(lines) {
  if (!lines || lines.length < 2) return lines || [];
  const arr = lines.slice().sort((a, b) => (a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2));
  const rows = [];
  for (const l of arr) {
    const cy = l.box.y + l.box.height / 2;
    const tol = Math.max(8, l.box.height * 0.6);
    let row = null;
    for (const r of rows) if (Math.abs(r.cy - cy) <= tol) { row = r; break; }
    if (!row) { row = { cy: cy, items: [] }; rows.push(row); }
    row.items.push(l);
  }
  rows.sort((a, b) => a.cy - b.cy);
  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.box.x - b.box.x);
    for (const l of r.items) out.push(l);
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + '-timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function ocr(dataUrl) {
  const svc = await withTimeout(getService(), 30000, 'ocr-init');
  const cv = await withTimeout(dataUrlToCanvas(dataUrl), 10000, 'ocr-decode');
  const res = await withTimeout(svc.recognize(cv), 20000, 'ocr-run');
  const lines = orderLines(flattenLines(res.lines));
  const text = lines.map((l) => l.text).join('\n');
  return { ok: true, text: text, lines: lines.length, confidence: res.confidence || 0 };
}

function enqueue(dataUrl) {
  const run = chain.then(() => ocr(dataUrl)).catch((e) => ({ ok: false, error: String((e && e.message) || e).slice(0, 200) }));
  chain = run.then(() => null, () => null);
  return run;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'ocr') {
    enqueue(msg.dataUrl).then(sendResponse);
    return true;
  }
  if (msg.type === 'ocr-warmup') {
    getService().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  return false;
});
