// 本地 agent 接口：导出学习包之后，「自动送到」用户自己跑的那台 agent。
// 这里只管三件纯函数的事——端点是否合法（只许本机）、请求体长什么样、失败怎么用人话讲。
// 真发请求的地方在 content.js；收件端在 tools/agent-bridge/bn-agent-hook.mjs。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnAgentHook = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPEC = 'bn-agent-hook/1';
  var DEFAULT_ENDPOINT = 'http://127.0.0.1:8791/bn-pack';

  // 只允许本机回环地址：这份请求体里有整份学习包，绝不能发给任何外部域名。
  // 之所以连 http 都敢收：目标是 127.0.0.1，出不了这台机器。
  function isLocalEndpoint(url) {
    var s = String(url === null || url === undefined ? '' : url).trim();
    if (!s) return false;
    var m = /^http:\/\/([^\/?#]+)([\/][^\s]*)?$/i.exec(s);
    if (!m) return false;
    var host = m[1].toLowerCase();
    if (!/^[a-z0-9.:\[\]-]+$/.test(host)) return false;
    var name = host.charAt(0) === '[' ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    var port = host.indexOf(':') >= 0 && host.charAt(0) !== '[' ? host.split(':').pop() : '';
    if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return false;
    if (name === '127.0.0.1' || name === 'localhost' || name === '[::1]') return true;
    // 允许 127.x.y.z 整段，但拒绝 127.0.0.1.evil.com 这种
    return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(name);
  }

  function cleanEndpoint(url) {
    var s = String(url === null || url === undefined ? '' : url).trim();
    return isLocalEndpoint(s) ? s : '';
  }

  // 请求体：agent 侧一次拿到「这份包是什么、从哪来、给谁用、原话在哪」。
  // pack 是完整的学习包 JSON（可能几百 KB），不裁剪——agent 需要锚点原话来出题。
  function buildPayload(opts) {
    var o = opts || {};
    var pack = o.pack || {};
    var doc = pack.doc || {};
    var course = doc.course || {};
    var counts = doc.counts || {};
    var file = o.file || {};
    return {
      spec: SPEC,
      sentAt: new Date(typeof o.now === 'number' ? o.now : Date.now()).toISOString(),
      source: 'bili-notes',
      course: { id: String(course.id || ''), title: String(course.title || '') },
      scope: String(doc.scope || ''),
      counts: {
        episodes: Number(counts.episodes) || 0,
        notes: Number(counts.notes) || 0,
        concepts: Number(counts.concepts) || 0,
        anchors: Number(counts.anchors) || 0,
      },
      file: { name: String(file.name || ''), size: Number(file.size) || 0 },
      text: String(o.text || ''),
      // 只发 spec 文档本身（bn-study-pack/1），别把 {doc,json,md,baseName} 这层包装也塞过去：
      // 收件端会把它原样落盘，agent 拿到手就该是一份能直接读的学习包。
      pack: pack.doc || pack,
    };
  }

  // 卡片上那一行字：成 / 败都要说人话，并且给出下一步。
  function resultLine(res) {
    var r = res || {};
    if (r.ok) {
      var got = Number(r.counts && r.counts.episodes) || 0;
      return '已经送到本地 agent' + (got ? '（' + got + ' 集）' : '') + (r.saved ? '：' + r.saved : '');
    }
    var why = String(r.error || '').trim();
    if (r.reason === 'no-endpoint') return '本地 agent 接口没填或不在本机：设置里填 http://127.0.0.1:8791/bn-pack';
    if (r.reason === 'timeout') return '本地 agent 没响应（3 秒超时）：先确认收件端在跑';
    if (r.reason === 'network') return '连不上本地 agent：收件端没启动，或端口不对';
    if (r.reason === 'bad-response') return '本地 agent 回了看不懂的内容：看一眼收件端日志';
    return '没送到本地 agent' + (why ? '：' + why : '');
  }

  return {
    SPEC: SPEC,
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    isLocalEndpoint: isLocalEndpoint,
    cleanEndpoint: cleanEndpoint,
    buildPayload: buildPayload,
    resultLine: resultLine,
  };
});
