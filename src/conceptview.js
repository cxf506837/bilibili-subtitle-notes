// 概念视图：把「一集一集抽出来的概念卡」拼成「这门课有哪些概念、每个概念落在哪几集第几秒」。
// 纯函数，无 DOM、无 chrome：合并 / 去噪标记 / 按集分组 / 掌握度，都能在 node 里直接测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnConceptView = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY_PREFIX = 'bnc:';
  const PARTICLES = '的了着过吗呢吧啊呀哦哈是在和与就都而及或把被让给对从到用能会要来去这那他她它我你您咱们有没不也很还只个些上下里为以及之其所以为';

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
  }

  function withT(url, t) {
    const u = String(url || '');
    if (!u) return '';
    const sec = Math.max(0, Math.floor(Number(t) || 0));
    if (!sec) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + sec;
  }

  function keyOf(name) {
    return String(name || '')
      .replace(/\s+/g, '')
      .replace(/[，。！？、；：""''（）《》【】…—,.!?;:\"'()\[\]<>\/\\`~@#$%^&*+=|-]/g, '')
      .toLowerCase();
  }

  // 关键词：中文取 2 字滑窗（滤掉纯虚词），英文取整词。只用来判断「概念和集标题有没有字面重合」。
  function tokensOf(text) {
    const out = {};
    const s = String(text || '');
    const latin = s.match(/[A-Za-z][A-Za-z0-9_.\-]{1,}/g) || [];
    latin.forEach(function (w) { out[w.toLowerCase()] = 1; });
    const runs = s.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    runs.forEach(function (run) {
      for (let i = 0; i + 2 <= run.length; i++) {
        const g = run.slice(i, i + 2);
        if (PARTICLES.indexOf(g[0]) >= 0 && PARTICLES.indexOf(g[1]) >= 0) continue;
        out[g] = 1;
      }
    });
    return out;
  }

  function hitTitle(name, def, titles) {
    const mine = tokensOf(String(name || '') + ' ' + String(def || ''));
    const keys = Object.keys(mine);
    if (!keys.length) return false;
    for (let i = 0; i < titles.length; i++) {
      const tt = tokensOf(titles[i]);
      for (let k = 0; k < keys.length; k++) {
        if (tt[keys[k]]) return true;
      }
    }
    return false;
  }

  // chrome.storage.local 里 bnc:<cid> = { v, concepts:[...] }；只取属于这门课（或这一个视频）的。
  function collect(all, cids) {
    const want = {};
    (Array.isArray(cids) ? cids : []).forEach(function (c) { if (c) want[String(c)] = 1; });
    const keys = Object.keys(want);
    const out = [];
    if (!keys.length) return out;
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(KEY_PREFIX) !== 0) return;
      if (!want[k.slice(KEY_PREFIX.length)]) return;
      const v = all[k];
      if (!v || !Array.isArray(v.concepts)) return;
      v.concepts.forEach(function (c) { if (c && String(c.name || '').trim()) out.push(c); });
    });
    return out;
  }

  // 没有 BnConcept 时的兜底合并：同名合一条，锚点去重。
  function mergePlain(items) {
    const out = [];
    const by = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      const name = String(it.name || '').trim();
      if (!name) return;
      const k = keyOf(name);
      let hit = by[k];
      if (!hit) { hit = { name: name, kind: it.kind || '概念', def: it.def || '', aliases: [], anchors: [] }; by[k] = hit; out.push(hit); }
      if (!hit.def && it.def) hit.def = it.def;
      (Array.isArray(it.anchors) ? it.anchors : []).forEach(function (a) {
        if (!a || typeof a.t !== 'number') return;
        const ep = Number(a.ep || it.ep || 0);
        if (!ep) return;
        if (hit.anchors.some(function (x) { return x.ep === ep && Math.abs(x.t - a.t) < 3; })) return;
        hit.anchors.push({ ep: ep, epLabel: a.epLabel || it.epLabel || '', epTitle: a.epTitle || it.epTitle || '', t: a.t, quote: a.quote || '', url: a.url || it.url || '' });
      });
    });
    return out;
  }

  // opts = { keyOf, merge, titles, mastery }
  function group(all, opts) {
    const o = opts || {};
    const kf = typeof o.keyOf === 'function' ? o.keyOf : keyOf;
    const merged = typeof o.merge === 'function' ? o.merge(all) : mergePlain(all);
    const titles = Array.isArray(o.titles) ? o.titles.filter(Boolean) : [];
    const mastery = o.mastery || {};
    const list = [];
    merged.forEach(function (c) {
      const anchors = (Array.isArray(c.anchors) ? c.anchors : [])
        .filter(function (a) { return a && typeof a.t === 'number' && Number(a.ep) > 0; })
        .slice()
        .sort(function (a, b) { return Number(a.ep) - Number(b.ep) || Number(a.t) - Number(b.t); });
      if (!anchors.length) return;
      const eps = [];
      const labels = {};
      anchors.forEach(function (a) {
        const e = Number(a.ep);
        if (eps.indexOf(e) < 0) { eps.push(e); labels[e] = a.epLabel || c.epLabel || ('第 ' + e + ' 集'); }
      });
      const first = anchors[0];
      const status = mastery[kf(c.name)] || '';
      list.push({
        name: c.name,
        kind: c.kind || '概念',
        def: c.def || '',
        aliases: Array.isArray(c.aliases) ? c.aliases : [],
        anchors: anchors,
        eps: eps,
        labels: labels,
        first: { ep: Number(first.ep), t: Number(first.t), epLabel: labels[Number(first.ep)] || '', quote: first.quote || '', url: first.url || '' },
        cross: eps.length > 1,
        suspect: eps.length < 2 && !hitTitle(c.name, c.def, titles),
        status: status,
      });
    });
    // 跨集的概念排前面（它们才是「知识点之间的连接」），其次锚点多，其次最早出现
    list.sort(function (a, b) {
      return (b.eps.length - a.eps.length) || (b.anchors.length - a.anchors.length) ||
        (a.first.ep - b.first.ep) || (a.first.t - b.first.t);
    });
    const groups = [];
    const byEp = {};
    list.forEach(function (it) {
      const e = it.first.ep;
      let g = byEp[e];
      if (!g) {
        g = { ep: e, label: it.first.epLabel || ('第 ' + e + ' 集'), title: '', items: [] };
        byEp[e] = g;
        groups.push(g);
      }
      if (!g.title) {
        const hit = it.anchors.filter(function (a) { return Number(a.ep) === e && a.epTitle; })[0];
        if (hit) g.title = String(hit.epTitle);
      }
      g.items.push(it);
    });
    groups.sort(function (a, b) { return a.ep - b.ep; });
    let anchorN = 0;
    list.forEach(function (x) { anchorN += x.anchors.length; });
    return {
      groups: groups,
      list: list,
      totals: {
        concepts: list.length,
        groups: groups.length,
        anchors: anchorN,
        cross: list.filter(function (x) { return x.cross; }).length,
        suspect: list.filter(function (x) { return x.suspect; }).length,
      },
    };
  }

  return { KEY_PREFIX: KEY_PREFIX, fmtClock: fmtClock, withT: withT, keyOf: keyOf, tokensOf: tokensOf, hitTitle: hitTitle, collect: collect, group: group };
});
