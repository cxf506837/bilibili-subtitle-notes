// 后台：唯一能绕过 CORS 抓 aisubtitle 的地方，也是唯一调 LLM 的地方。
'use strict';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const TIMEOUT = { subtitle: 12000, chat: 90000 };

// 所有出网请求都带超时：没有超时的话网络一卡，界面就永远停在半路。
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSubtitleFile(url) {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': navigator.userAgent, Referer: 'https://www.bilibili.com/' },
    credentials: 'omit',
  }, TIMEOUT.subtitle);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, hash: fnv1a(text), bytes: text.length };
}

async function readConfig(override) {
  const cfg = await chrome.storage.local.get(['apiBase', 'apiKey', 'model', 'maxTokens']);
  const apiBase = (override && override.apiBase) || cfg.apiBase || 'https://api.openai.com/v1';
  return {
    apiBase: String(apiBase).replace(/\/+$/, ''),
    apiKey: (override && override.apiKey) || cfg.apiKey || '',
    model: (override && override.model) || cfg.model || 'gpt-4o-mini',
    maxTokens: Number((override && override.maxTokens) || cfg.maxTokens || 1000),
  };
}

async function chat(payload) {
  payload = payload || {};
  const cfg = await readConfig(payload.override);
  if (!cfg.apiKey) return { ok: false, code: 'no-key', error: '没有填 API Key（点扩展的 ⚙ 设置）' };
  const body = {
    model: cfg.model,
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.3,
    max_tokens: payload.maxTokens || cfg.maxTokens,
    messages: payload.messages,
  };
  if (payload.json !== false) body.response_format = { type: 'json_object' };
  // DeepSeek 系默认开推理：reasoning 会把 max_tokens 吃光，content 变成空串。
  // 只在 DeepSeek 的 endpoint 上加，别家（OpenAI 等）会因未知参数报错。
  if (/deepseek/i.test(cfg.apiBase) && cfg.disableThinking !== false) body.thinking = { type: 'disabled' };
  let res;
  try {
    res = await fetchWithTimeout(cfg.apiBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
    }, TIMEOUT.chat);
  } catch (e) {
    const aborted = String(e && e.name) === 'AbortError';
    return { ok: false, code: aborted ? 'timeout' : 'network', error: aborted ? '模型响应超时（' + Math.round(TIMEOUT.chat / 1000) + ' 秒）' : '网络异常：' + String(e).slice(0, 120) };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: 'bad-key', status: res.status, error: 'API Key 无效或没有权限（' + res.status + '）' };
  }
  if (res.status === 429) {
    return { ok: false, code: 'rate-limit', status: 429, error: '被限流了（429），过一会儿再试' };
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (e) {}
    return { ok: false, code: 'http', status: res.status, error: 'HTTP ' + res.status, detail };
  }
  let j;
  try { j = await res.json(); } catch (e) { return { ok: false, code: 'bad-json', error: '返回不是 JSON' }; }
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return { ok: true, content, text: content, usage: j.usage || null };
}

// ---- 画面文字：OCR 只能跑在有 DOM/canvas 的 offscreen 文档里（service worker 没有 canvas）----
const OCR_TIMEOUT = 60000;
let offscreenPending = null;

function createOffscreen() {
  return chrome.offscreen
    .createDocument({
      url: 'src/offscreen.html',
      reasons: ['BLOBS'],
      justification: '本地 OCR 识别视频画面里的 PPT/板书文字',
    })
    .catch((e) => {
      // 并发建两次会报「Only a single offscreen document」，已经建好就不算错
      if (!/single offscreen/i.test(String(e))) throw e;
    });
}

// 扩展重载后可能留下「文档还在、监听器已死」的僵尸，所以建好之后还要探活一次
async function ensureOffscreen() {
  if (offscreenPending) return offscreenPending;
  offscreenPending = (async () => {
    let has = false;
    try { has = await chrome.offscreen.hasDocument(); } catch (e) {}
    if (!has) await createOffscreen();
    const alive = await withTimeout(
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr-warmup' }),
      5000,
      { ok: false }
    );
    if (alive && alive.ok) return;
    try { await chrome.offscreen.closeDocument(); } catch (e) {}
    await createOffscreen();
    await withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr-warmup' }), 20000, { ok: false });
  })().finally(() => { offscreenPending = null; });
  return offscreenPending;
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    });
  });
}

async function ocrFrame(dataUrl) {
  await ensureOffscreen();
  const r = await withTimeout(
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr', dataUrl: dataUrl }),
    OCR_TIMEOUT,
    { ok: false, error: 'ocr-timeout' }
  );
  return r || { ok: false, error: 'no-response' };
}

// 轻量安装包（不带 vendor/ocr）里没有本地 OCR 运行时。内容脚本自己 fetch chrome-extension:// 会被
// web_accessible_resources / 页面 CSP 挡住（实测拿不到），所以由 SW（扩展源）代探一次。
// 判据必须是「真正会被加载的那几个大文件」：dict.txt 只有 26KB 且在 git 里（clone 下来就有），
// 只探它会得出「OCR 可用」的错误结论，用户点了按钮才失败 —— 这比没有按钮更糟。
const OCR_MARKERS = [
  'vendor/ocr/models/PP-OCRv6_tiny_det.ort',
  'vendor/ocr/models/PP-OCRv6_tiny_rec.ort',
  'vendor/ocr/ort/ort-wasm-simd-threaded.jsep.wasm',
  'vendor/ocr/ort/ort-wasm-simd-threaded.jsep.mjs',
  'vendor/ocr/ocr-bundle.js',
];
function ocrAvailable() {
  return Promise.all(OCR_MARKERS.map((p) => fetch(chrome.runtime.getURL(p))
    .then((r) => !!(r && r.ok), () => false))).then((rs) => rs.every(Boolean));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'probeOcr') {
    ocrAvailable()
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'fetchSubtitleFile') {
    fetchSubtitleFile(msg.url)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, status: 0, error: String(e).slice(0, 200) }));
    return true;
  }
  if (msg && msg.type === 'ocr') {
    ocrFrame(msg.dataUrl)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e).slice(0, 200) }));
    return true;
  }
  if (msg && msg.type === 'chat') {
    chat(msg.payload || msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, code: 'exception', error: String(e).slice(0, 200) }));
    return true;
  }
  return false;
});

// ---- 工具栏图标：点一下就能用 ----
// v0.7.3 之前 manifest 里没有 action，装完根本找不到「用」的入口（只能在视频页等面板自己出来）。
const VIDEO_URL = /^https:\/\/www\.bilibili\.com\/video\//;
const CONTENT_FILES = [
  'src/gate.js', 'src/summarize.js', 'src/hardsub.js', 'src/frames.js', 'src/content.js',
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function askPanel(tabId, type) {
  try { return await chrome.tabs.sendMessage(tabId, { type: type || 'bnOpenPanel' }); } catch (e) { return null; }
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeText({ tabId: tabId, text: text || '' });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#ff6b35' });
  } catch (e) {}
}

// 装完扩展没刷新页面时内容脚本还不在。直接补注入一次，别让人以为「点了没反应」。
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT_FILES });
  } catch (e) {
    return false;
  }
  await sleep(400);
  return true;
}

async function openPanelForTab(tab) {
  const tabId = tab && tab.id;
  const url = (tab && tab.url) || '';
  if (typeof tabId !== 'number' || tabId < 0) return { ok: false, code: 'no-tab' };
  if (!VIDEO_URL.test(url)) {
    // 不在视频页：直接把 B站 打开，别让人对着一个没反应的图标猜
    try { await chrome.tabs.create({ url: 'https://www.bilibili.com' }); } catch (e) {}
    return { ok: false, code: 'not-video', opened: 'https://www.bilibili.com' };
  }
  const first = await askPanel(tabId);
  if (first && first.ok) { await setBadge(tabId, ''); return Object.assign({ via: 'panel' }, first); }
  if (await ensureContentScript(tabId)) {
    const second = await askPanel(tabId);
    if (second && second.ok) { await setBadge(tabId, ''); return Object.assign({ via: 'injected' }, second); }
  }
  await setBadge(tabId, '↻');
  return { ok: false, code: 'not-ready' };
}

chrome.action.onClicked.addListener(function (tab) { openPanelForTab(tab); });

// 换了页面就把「需要刷新」的角标清掉，免得一直挂着
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info && (info.url || info.status === 'loading')) setBadge(tabId, '');
  });
}

// 验收脚本从这里调同一条路径（点图标本身没法用 CDP 触发）
self.__bnOpenPanel = openPanelForTab;
self.__bnAskPanel = askPanel;
