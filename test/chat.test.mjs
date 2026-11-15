// 回归：后台 chat() 的请求体与错误映射。
// 背景是 2026-11-15 用户报「提问失败：HTTP 400」：问答走了 response_format=json_object，
// DeepSeek 要求 prompt 里含 "json" 才允许，于是被 400 拒掉；而 400 只显示状态码，看不出原因。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(root, 'src/background.js'), 'utf8');

function load({ cfg = {}, fetchImpl } = {}) {
  const store = Object.assign({ apiBase: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat', maxTokens: 700 }, cfg);
  const calls = [];
  const handler = { fn: null };
  const noop = () => {};
  const chain = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });
  const chrome = {
    runtime: {
      onMessage: { addListener: (f) => { handler.fn = f; } },
      onInstalled: chain(),
      onStartup: chain(),
      getURL: (p) => 'chrome-extension://test/' + p,
      getManifest: () => ({ host_permissions: [] }),
      lastError: null,
      sendMessage: async () => ({ ok: false }),
    },
    storage: { local: { get: async (keys) => {
      const out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
      return out;
    }, set: async () => {} } },
    action: { onClicked: chain(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { onUpdated: chain(), onActivated: chain(), query: async () => [], sendMessage: async () => null },
    scripting: { executeScript: async () => [] },
    offscreen: { createDocument: async () => {}, hasDocument: async () => false, closeDocument: async () => {} },
    permissions: { contains: async () => true, request: async () => true },
    alarms: { onAlarm: chain(), create: noop, clear: noop },
  };
  const ctx = {
    chrome,
    navigator: { userAgent: 'test-agent' },
    fetch: (url, opts) => { calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null }); return fetchImpl(url, opts); },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout, AbortController, URL, console, JSON, Promise, Math, Date, Object, Array, String, Number, Error, RegExp,
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'background.js' });
  const send = (msg) => new Promise((resolve) => {
    const ret = handler.fn(msg, {}, resolve);
    if (ret !== true && ret !== undefined) resolve(ret);
  });
  return { send, calls };
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const okRes = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 12 } }),
});
const badRes = (status, text) => ({ ok: false, status, text: async () => text });

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// 1) 自由文本：不能带 response_format（这就是 400 的根因）
{
  const { send, calls } = load({ fetchImpl: async () => okRes('1+1 等于 2。') });
  const r = await send({ type: 'chat', json: false, messages: [{ role: 'user', content: '1+1 等于几？' }] });
  const b = calls[0] && calls[0].body;
  ok('json:false 请求成功', r.ok === true && r.content === '1+1 等于 2。', JSON.stringify(r));
  ok('只发一次请求', calls.length === 1, String(calls.length));
  ok('打到 /chat/completions', calls[0].url === 'https://api.deepseek.com/v1/chat/completions', calls[0].url);
  ok('json:false 不带 response_format', b && !has(b, 'response_format'));
  ok('模型与上限照配置', b.model === 'deepseek-chat' && b.max_tokens === 700, JSON.stringify(b));
  ok('DeepSeek 端点关推理', b.thinking && b.thinking.type === 'disabled', JSON.stringify(b.thinking));
  ok('用量回传', r.usage && r.usage.total_tokens === 12);
}

// 2) 结构化：默认仍带 response_format
{
  const { send, calls } = load({ fetchImpl: async () => okRes('{"a":1}') });
  await send({ type: 'chat', messages: [{ role: 'user', content: '请返回 json' }] });
  ok('默认带 response_format=json_object', JSON.stringify(calls[0].body.response_format) === '{"type":"json_object"}');
}

// 3) payload 包一层时 json 标志同样生效
{
  const { send, calls } = load({ fetchImpl: async () => okRes('好') });
  await send({ type: 'chat', payload: { json: false, messages: [{ role: 'user', content: '你好' }] } });
  ok('payload 里的 json:false 生效', !has(calls[0].body, 'response_format'));
}

// 4) 400：把服务商的原因写进 error
{
  const detail = JSON.stringify({ error: { message: "Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'." } });
  const { send } = load({ fetchImpl: async () => badRes(400, detail) });
  const r = await send({ type: 'chat', messages: [{ role: 'user', content: '你好' }] });
  ok('400 判失败且保留状态码', r.ok === false && r.code === 'http' && r.status === 400);
  ok('400 文案带服务商原因', /^HTTP 400：Prompt must contain the word 'json'/.test(r.error), r.error);
  ok('原始响应留在 detail', r.detail === detail);
}

// 5) 400 但响应不是 JSON：退回旧文案，不崩
{
  const { send } = load({ fetchImpl: async () => badRes(400, 'Bad Request') });
  const r = await send({ type: 'chat', messages: [{ role: 'user', content: '你好' }] });
  ok('非 JSON 400 退回 HTTP 400', r.error === 'HTTP 400', r.error);
  ok('非 JSON 400 仍留 detail', r.detail === 'Bad Request');
}

// 6) 没填 Key 不发请求
{
  const { send, calls } = load({ cfg: { apiKey: '' }, fetchImpl: async () => okRes('') });
  const r = await send({ type: 'chat', messages: [{ role: 'user', content: '你好' }] });
  ok('没 Key 直接报 no-key', r.code === 'no-key');
  ok('没 Key 不发网络请求', calls.length === 0);
}

// 7) 401 映射
{
  const { send } = load({ fetchImpl: async () => badRes(401, '{}') });
  const r = await send({ type: 'chat', messages: [{ role: 'user', content: '你好' }] });
  ok('401 报 bad-key', r.code === 'bad-key' && r.status === 401);
}

// 8) 非 DeepSeek 端点不加 thinking（别家会因未知参数报错）
{
  const { send, calls } = load({ cfg: { apiBase: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }, fetchImpl: async () => okRes('hi') });
  await send({ type: 'chat', json: false, messages: [{ role: 'user', content: 'hi' }] });
  ok('OpenAI 端点不加 thinking', !has(calls[0].body, 'thinking'), JSON.stringify(calls[0].body));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
