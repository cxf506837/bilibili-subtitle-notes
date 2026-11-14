'use strict';

// 端点预设 + host 权限白名单。设置页和测试共用；不依赖 DOM / chrome 对象，纯函数，可以直接单测。
// 为什么要有这个文件：MV3 里对没授权的域名 fetch 只会抛 TypeError: Failed to fetch，
// 和断网 / DNS 错 / key 错是同一句话，事后无法区分。所以必须在「保存设置」那一刻就拦下来。

const BN_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', apiBase: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'dashscope', label: '通义千问（阿里云百炼）', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'bigmodel', label: '智谱 GLM', apiBase: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'moonshot', label: 'Moonshot（Kimi）', apiBase: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'ollama', label: '本机 Ollama / vLLM', apiBase: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

// 从 apiBase 里取 scheme / host / port；不是 http(s) 就返回 null。
function bnParseOrigin(apiBase) {
  try {
    const u = new URL(String(apiBase == null ? '' : apiBase).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return { scheme: u.protocol.slice(0, -1), host: u.hostname.toLowerCase(), port: u.port || '' };
  } catch (e) {
    return null;
  }
}

// manifest 的匹配规则：*.example.com 同时吃 example.com 和它的子域。
function bnHostMatches(patternHost, host) {
  if (patternHost === host) return true;
  if (patternHost.slice(0, 2) === '*.' ) {
    const base = patternHost.slice(2);
    return host === base || host.slice(-(base.length + 1)) === '.' + base;
  }
  return false;
}

// 返回值故意做成对象而不是 boolean：调用方要拿 origin 去拼人话报错。
function bnOriginAllowed(apiBase, patterns) {
  const o = bnParseOrigin(apiBase);
  if (!o) return { ok: false, reason: 'bad-url' };
  const list = Array.isArray(patterns) ? patterns : [];
  for (const p of list) {
    const m = /^(https?):\/\/([^/]+)\//.exec(String(p));
    if (!m) continue;
    if (m[1] !== o.scheme) continue;
    const ph = m[2].toLowerCase();
    if (ph === '*' || bnHostMatches(ph, o.host)) return { ok: true, matched: p };
  }
  return { ok: false, reason: 'no-permission', origin: o.scheme + '://' + o.host + (o.port ? ':' + o.port : '') };
}

// 报错时列「能用哪些」，按预设顺序，只列 manifest 里真给了权限的。
function bnAllowedPresetLabels(patterns) {
  return BN_PRESETS.filter((p) => bnOriginAllowed(p.apiBase, patterns).ok).map((p) => p.label);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BN_PRESETS, bnParseOrigin, bnHostMatches, bnOriginAllowed, bnAllowedPresetLabels };
}
