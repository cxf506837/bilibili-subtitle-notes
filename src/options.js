'use strict';

const $ = (id) => document.getElementById(id);
const msg = $('msg');

function show(text, bad) {
  msg.textContent = text;
  msg.style.color = bad ? '#e74c3c' : '#2ecc71';
}

chrome.storage.local.get(['apiBase', 'model', 'apiKey', 'maxTokens', 'bn.awayEnabled', 'bn.visualEnabled', 'bn.audioEnabled'], (r) => {
  $('apiBase').value = r.apiBase || 'https://api.deepseek.com/v1';
  $('model').value = r.model || 'deepseek-chat';
  $('apiKey').value = r.apiKey || '';
  $('maxTokens').value = r.maxTokens || 700;
  $('awayEnabled').checked = r['bn.awayEnabled'] !== false;
  $('visualEnabled').checked = r['bn.visualEnabled'] !== false;
  $('audioEnabled').checked = r['bn.audioEnabled'] === true;
});

$('save').addEventListener('click', () => {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const model = $('model').value.trim();
  const apiKey = $('apiKey').value.trim();
  const maxTokens = Number($('maxTokens').value) || 700;
  if (!apiBase || !model) return show('API Base 和模型都要填', true);
  const awayEnabled = $('awayEnabled').checked;
  const visualEnabled = $('visualEnabled').checked;
  const audioEnabled = $('audioEnabled').checked;
  chrome.storage.local.set({ apiBase, model, apiKey, maxTokens, 'bn.awayEnabled': awayEnabled, 'bn.visualEnabled': visualEnabled, 'bn.audioEnabled': audioEnabled }, () => {
    show('已保存。回到 B站 视频页刷新即可生效。');
  });
});

$('test').addEventListener('click', () => {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const model = $('model').value.trim();
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) return show('先填 API Key', true);
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
