// 学习页（整门课一屏）用的纯函数：挑课程、算进度、算掌握度、数笔记、按词过滤概念。
// 不碰 DOM、不碰 chrome，页面自己渲染，这样能单测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnStudyPage = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFIX = 'bnc:';
  const STATE_PREFIX = 'bnstudy:';
  const IDX_PREFIX = 'bnidx:';

  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function str(v) { return String(v == null ? '' : v); }

  // 课程存档（coursestore 写的 bnc:<courseId>）——只认「有 id 和 episodes」的形状，
  // 因为概念缓存也用 bnc: 前缀（bnc:<cid>），两者靠形状区分。
  function courses(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(PREFIX) !== 0) return;
      const v = all[k];
      if (!v || !v.id || !Array.isArray(v.episodes) || !v.episodes.length) return;
      out.push(v);
    });
    out.sort(function (a, b) { return str(b.updated_at).localeCompare(str(a.updated_at)); });
    return out;
  }

  function pick(list, id) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return null;
    if (!id) return arr[0];
    for (let i = 0; i < arr.length; i++) if (str(arr[i].id) === str(id)) return arr[i];
    return arr[0];
  }

  function cidsOf(course) {
    return ((course && course.episodes) || []).map(function (e) { return str(e.cid); }).filter(Boolean);
  }

  function progressMap(all) {
    const map = {};
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf('bnp:') !== 0) return;
      map[k.slice(4)] = num(all[k]);
    });
    return map;
  }

  function watched(ep, map) {
    const t = num((map || {})[str(ep && ep.cid)]);
    if (!t) return false;
    const d = num(ep && ep.duration);
    if (!d) return t >= 60;
    return t >= Math.max(30, d * 0.9);
  }

  // 掌握度：直接读 agent 回流的 bnstudy:<courseId>，只数状态。
  function masteryOf(all, courseId) {
    const raw = (all || {})[STATE_PREFIX + str(courseId)];
    const st = raw && (raw.state || raw);
    const list = (st && Array.isArray(st.concepts)) ? st.concepts : [];
    const out = { understood: 0, shaky: 0, unknown: 0, total: list.length, updated_at: str(st && st.updated_at) };
    list.forEach(function (c) {
      const s = str(c && c.status);
      if (s === 'understood') out.understood++;
      else if (s === 'shaky') out.shaky++;
      else out.unknown++;
    });
    return out;
  }

  function line(m) {
    if (!m || !m.total) return '还没考过';
    const parts = [];
    if (m.understood) parts.push('懂 ' + m.understood);
    if (m.shaky) parts.push('半懂 ' + m.shaky);
    parts.push('没考 ' + m.unknown);
    return parts.join(' · ');
  }

  // 每集有多少条笔记：检索索引里每条 {bvid, cid, count}。
  function notesMap(all) {
    const map = {};
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(IDX_PREFIX) !== 0) return;
      const v = all[k];
      if (!v) return;
      const cid = str(v.cid || (k.split(':')[2] || ''));
      if (!cid) return;
      map[cid] = num(v.count) || (Array.isArray(v.notes) ? v.notes.length : 0);
    });
    return map;
  }

  // 一门课的总览：几集看过、还剩多久、有几条笔记、掌握度如何。
  function overview(all, course) {
    const eps = (course && course.episodes) || [];
    const pm = progressMap(all);
    const nm = notesMap(all);
    let seen = 0, total = 0, notes = 0, watchedCount = 0, next = null;
    eps.forEach(function (e) {
      const d = num(e.duration);
      total += d;
      if (watched(e, pm)) { seen += d; watchedCount++; }
      else if (!next) next = e;
      notes += num(nm[str(e.cid)]);
    });
    const m = masteryOf(all, course && course.id);
    return {
      count: eps.length, watched: watchedCount, seen: seen, total: total,
      pct: total ? Math.min(100, Math.round((seen / total) * 100)) : 0,
      notes: notes, mastery: m, masteryLine: line(m), next: next,
    };
  }

  // 一个概念在整门课里的所有出现处（同一集里相隔 3 秒内的重复锚点算一处）。
  // 学习页拿它做「出现在 3 集 · 6 处」的展开：每个概念都能顺着引文跳回 B站 那一秒。
  const OCC_GAP = 3;
  function occurrences(item) {
    const anchors = Array.isArray(item && item.anchors) ? item.anchors : [];
    const rows = [];
    anchors.forEach(function (a) {
      if (!a || typeof a.t !== 'number' || !(Number(a.ep) > 0)) return;
      const ep = Number(a.ep);
      rows.push({
        ep: ep, t: Number(a.t),
        label: str(a.epLabel || (item && item.epLabel) || ('第 ' + ep + ' 集')),
        title: str(a.epTitle || ''),
        quote: str(a.quote || ''),
        url: str(a.url || ''),
      });
    });
    rows.sort(function (x, y) { return x.ep - y.ep || x.t - y.t; });
    const out = [];
    rows.forEach(function (a) {
      const last = out[out.length - 1];
      if (last && last.ep === a.ep && Math.abs(last.t - a.t) < OCC_GAP) {
        if (!last.quote && a.quote) last.quote = a.quote;
        if (!last.title && a.title) last.title = a.title;
        if (!last.url && a.url) last.url = a.url;
        return;
      }
      out.push(a);
    });
    return out;
  }

  function occSummary(item) {
    const list = occurrences(item);
    const eps = [];
    list.forEach(function (a) { if (eps.indexOf(a.ep) < 0) eps.push(a.ep); });
    return { count: list.length, eps: eps.length, list: list };
  }

  function tokens(q) {
    return str(q).toLowerCase().split(/\s+/).filter(Boolean);
  }

  // 概念过滤：空格分词、各词都要命中（名字 / 定义 / 任一原话）。分组内全被过滤掉的组不返回。
  function filterGroups(groups, q) {
    const ts = tokens(q);
    if (!ts.length) return Array.isArray(groups) ? groups : [];
    const hit = function (item) {
      const hay = [str(item && item.name), str(item && item.def)]
        .concat(((item && item.anchors) || []).map(function (a) { return str(a && a.quote); }))
        .join('\n').toLowerCase();
      return ts.every(function (t) { return hay.indexOf(t) >= 0; });
    };
    const out = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g) {
      const items = ((g && g.items) || []).filter(hit);
      if (items.length) out.push({ ep: g.ep, label: g.label, title: g.title, items: items });
    });
    return out;
  }

  return {
    PREFIX: PREFIX, courses: courses, pick: pick, cidsOf: cidsOf, progressMap: progressMap,
    watched: watched, masteryOf: masteryOf, line: line, notesMap: notesMap, overview: overview,
    filterGroups: filterGroups, occurrences: occurrences, occSummary: occSummary,
  };
});
