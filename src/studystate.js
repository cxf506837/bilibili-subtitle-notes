// 学习状态（study-state.json）：agent 拷打完之后写出来的「哪些懂、哪些半懂」。
// 纯函数，无 DOM、无 chrome，node 里可直接测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnStudyState = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPEC = 'bn-study-state/1';
  const STATUS = ['understood', 'shaky', 'unknown'];
  const KEY_PREFIX = 'bnstudy:';

  function str(v, max) {
    const s = String(v == null ? '' : v).trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }

  // 剪贴板里可能混了说明文字或代码块围栏，所以找不到整段 JSON 时退一步取第一个 { 到最后一个 }
  function pickJson(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return '';
    if (t.charAt(0) === '{') return t;
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return t.slice(a, b + 1);
    return t;
  }

  function normalizeConcept(c) {
    const status = STATUS.indexOf(String(c && c.status)) >= 0 ? String(c.status) : 'unknown';
    return {
      name: str(c && c.name, 120),
      status: status,
      asked: num(c && c.asked),
      correct: num(c && c.correct),
      last_quote: str(c && c.last_quote, 400),
      last_url: str(c && c.last_url, 500),
    };
  }

  function count(list) {
    const out = { understood: 0, shaky: 0, unknown: 0, total: list.length };
    list.forEach(function (c) { out[c.status] += 1; });
    return out;
  }

  // 返回 { ok, state } 或 { ok:false, error }；error 是用来直接给人看的一句话
  function parse(text) {
    const raw = pickJson(text);
    if (!raw) return { ok: false, error: '剪贴板是空的' };
    let json = null;
    try { json = JSON.parse(raw); } catch (e) { return { ok: false, error: '剪贴板里不是 JSON（前 40 个字：' + raw.slice(0, 40) + '）' }; }
    if (!json || typeof json !== 'object') return { ok: false, error: '剪贴板里不是学习状态对象' };
    if (json.spec !== SPEC) return { ok: false, error: '不是 ' + SPEC + ' 的学习状态（读到 ' + str(json.spec || '空') + '）' };
    const list = Array.isArray(json.concepts) ? json.concepts.filter(function (c) { return c && str(c.name); }) : [];
    if (!list.length) return { ok: false, error: '学习状态里没有概念（concepts 是空的）' };
    const concepts = list.map(normalizeConcept);
    const courseId = str(json.course_id, 200);
    if (!courseId) return { ok: false, error: '学习状态缺少 course_id，没法对上是哪门课' };
    const next = (Array.isArray(json.next) ? json.next : []).map(function (n) {
      return { name: str(n && n.name, 120), url: str(n && n.url, 500), reason: str(n && n.reason, 200) };
    }).filter(function (n) { return !!n.name; });
    return {
      ok: true,
      state: {
        spec: SPEC,
        course: str(json.course, 200),
        course_id: courseId,
        goal: str(json.goal, 500),
        updated_at: str(json.updated_at) || new Date().toISOString(),
        concepts: concepts,
        next: next,
        progress: count(concepts),
        applied_at: new Date().toISOString(),
      },
    };
  }

  function summarize(state) {
    const p = state && state.progress ? state.progress : count((state && state.concepts) || []);
    return { understood: p.understood || 0, shaky: p.shaky || 0, unknown: p.unknown || 0, total: p.total || 0 };
  }

  // 「懂 5 · 半懂 11 · 没考 75」
  function line(state) {
    const p = summarize(state);
    const bits = [];
    if (p.understood) bits.push('懂 ' + p.understood);
    if (p.shaky) bits.push('半懂 ' + p.shaky);
    bits.push('没考 ' + p.unknown);
    return bits.join(' · ');
  }

  function storageKey(courseId) { return KEY_PREFIX + str(courseId, 200); }

  function fromStorage(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(KEY_PREFIX) !== 0) return;
      const v = all[k];
      if (!v || v.spec !== SPEC || !Array.isArray(v.concepts)) return;
      out.push({ key: k, state: v });
    });
    return out;
  }

  function match(state, courseId) {
    if (!state || !courseId) return false;
    return !!state.course_id && state.course_id === courseId;
  }

  function byStatus(state, status, limit) {
    const want = STATUS.indexOf(status) >= 0 ? status : 'unknown';
    const list = ((state && state.concepts) || []).filter(function (c) { return c.status === want; });
    return limit ? list.slice(0, limit) : list;
  }

  function nextList(state, limit) {
    const list = ((state && state.next) || []).filter(function (n) { return !!n.name; });
    return limit ? list.slice(0, limit) : list;
  }

  return {
    SPEC: SPEC,
    STATUS: STATUS,
    KEY_PREFIX: KEY_PREFIX,
    parse: parse,
    summarize: summarize,
    line: line,
    storageKey: storageKey,
    fromStorage: fromStorage,
    match: match,
    byStatus: byStatus,
    nextList: nextList,
  };
});
