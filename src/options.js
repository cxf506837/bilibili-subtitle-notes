'use strict';

const $ = (id) => document.getElementById(id);
const msg = $('msg');

function show(text, bad) {
  msg.textContent = text;
  msg.style.color = bad ? '#e74c3c' : '#2ecc71';
}

// 白名单的唯一来源是 manifest 的 host_permissions：加权限只改一处，这里自动跟上。
const PATTERNS = (function () {
  try {
    return (chrome.runtime.getManifest().host_permissions) || [];
  } catch (e) {
    return [];
  }
})();

// 人话报错：不能只说「请求失败」——用户分不清是断网、key 错还是域名没权限。
function originError(r) {
  if (r.reason === 'bad-url') return 'API Base 不是合法的 http(s) 地址，形如 https://api.deepseek.com/v1';
  const ok = bnAllowedPresetLabels(PATTERNS);
  return '这个域名扩展没有权限：' + r.origin + '\n' +
    '浏览器扩展只能连 manifest 里声明过的域名，现在允许：' + (ok.length ? ok.join(' / ') : '（无）') + '。\n' +
    '用这几家里的任意一家都不用改；想用别的请在 GitHub 开 issue（要改 host_permissions）。';
}

function renderPresets() {
  const sel = $('preset');
  for (const p of BN_PRESETS) {
    if (!bnOriginAllowed(p.apiBase, PATTERNS).ok) continue;
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label + ' · ' + p.model;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const p = BN_PRESETS.find((x) => x.id === sel.value);
    if (!p) return;
    $('apiBase').value = p.apiBase;
    $('model').value = p.model;
    show('已填入 ' + p.label + '。Key 还是要你自己填，填完点保存。');
  });
}

function presetIdFor(apiBase) {
  const norm = String(apiBase || '').trim().replace(/\/+$/, '');
  const p = BN_PRESETS.find((x) => x.apiBase.replace(/\/+$/, '') === norm);
  return p ? p.id : '';
}

renderPresets();

chrome.storage.local.get(['apiBase', 'model', 'apiKey', 'maxTokens', 'bn.awayEnabled', 'bn.visualEnabled', 'bn.goal', 'bn.autoNotes', 'bn.capVideo', 'bn.capDay'], (r) => {
  const apiBase = r.apiBase || 'https://api.deepseek.com/v1';
  $('apiBase').value = apiBase;
  $('model').value = r.model || 'deepseek-chat';
  $('preset').value = presetIdFor(apiBase);
  $('apiKey').value = r.apiKey || '';
  $('maxTokens').value = r.maxTokens || 700;
  $('awayEnabled').checked = r['bn.awayEnabled'] !== false;
  $('visualEnabled').checked = r['bn.visualEnabled'] !== false;
  $('goal').value = r['bn.goal'] || '';
  $('autoNotes').checked = r['bn.autoNotes'] === true;
  $('capVideo').value = Number(r['bn.capVideo']) >= 0 ? Number(r['bn.capVideo']) : 120000;
  $('capDay').value = Number(r['bn.capDay']) >= 0 ? Number(r['bn.capDay']) : 600000;
});

$('save').addEventListener('click', () => {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const model = $('model').value.trim();
  const apiKey = $('apiKey').value.trim();
  const maxTokens = Number($('maxTokens').value) || 700;
  if (!apiBase || !model) return show('API Base 和模型都要填', true);
  const allow = bnOriginAllowed(apiBase, PATTERNS);
  if (!allow.ok) return show(originError(allow), true);
  const awayEnabled = $('awayEnabled').checked;
  const visualEnabled = $('visualEnabled').checked;
  const goal = $('goal').value.trim();
  const autoNotes = $('autoNotes').checked;
  const capVideo = Math.max(0, Number($('capVideo').value) || 0);
  const capDay = Math.max(0, Number($('capDay').value) || 0);
  chrome.storage.local.set({ apiBase, model, apiKey, maxTokens, 'bn.awayEnabled': awayEnabled, 'bn.visualEnabled': visualEnabled, 'bn.goal': goal, 'bn.autoNotes': autoNotes, 'bn.capVideo': capVideo, 'bn.capDay': capDay }, () => {
    show('已保存。回到 B站 视频页刷新即可生效。');
  });
});

$('test').addEventListener('click', () => {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const model = $('model').value.trim();
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) return show('先填 API Key', true);
  const allow = bnOriginAllowed(apiBase, PATTERNS);
  if (!allow.ok) return show(originError(allow), true);
  show('测试中…');
  chrome.runtime.sendMessage({
    type: 'chat',
    messages: [
      { role: 'system', content: '只回一个词：ok' },
      { role: 'user', content: 'ping' },
    ],
    override: { apiBase, model, apiKey, maxTokens: 16 },
  }, (r) => {
    if (!r) return show('没有响应（扩展后台没起来？）', true);
    if (r.ok) return show('连接正常，模型回了：' + String(r.content).slice(0, 40));
    show('失败：' + (r.error || '') + (r.detail ? '\n' + String(r.detail).slice(0, 300) : ''), true);
  });
});
