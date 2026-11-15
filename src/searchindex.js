// 跨视频笔记检索用的「轻量索引」：面板里生成笔记时，把每条笔记压成一小段写进
// chrome.storage.local（内容脚本的笔记在 bilibili.com 的 IndexedDB 里，扩展弹窗读不到，
// 所以必须另存一份到扩展自己的存储）。这里只放纯函数，方便离线测。
(function () {
  'use strict';
  const PREFIX = 'bnidx:';
  const MAX_NOTES = 2000;   // 单个视频最多索引这么多条（老视频全文 1000+ 条，够了）
  const TRIM = 160;         // 每条摘要截多长

  function trim(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    n = n || TRIM;
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function pageUrlOf(bvid, page, totalPages) {
    const base = 'https://www.bilibili.com/video/' + bvid;
    return (Number(totalPages) > 1 && Number(page) > 0) ? base + '?p=' + page : base;
  }

  // 笔记对象 -> 可检索的紧凑条目
  function build(bvid, meta, notes) {
    meta = meta || {};
    const list = [];
    (notes || []).forEach(function (n) {
      if (!n || typeof n.start !== 'number') return;
      const points = n.points || [];
      const plains = points.map(function (p) { return trim(p.plain, 120); }).filter(Boolean);
      const quotes = points.map(function (p) { return trim(p.quote, 120); }).filter(Boolean);
      list.push({
        t: Math.max(0, Math.floor(n.start)),
        summary: trim(n.blockSummary || ''),
        one: trim(n.oneThing || ''),
        plain: trim(plains.join(' / '), 400),
        quote: trim(quotes.slice(0, 2).join(' / '), 220),
      });
    });
    list.sort(function (a, b) { return a.t - b.t; });
    return {
      bvid: bvid,
      cid: Number(meta.cid) || 0,
      title: trim(meta.title || bvid, 120),
      part: trim(meta.part || '', 60),
      page: Number(meta.page) || 0,
      totalPages: Number(meta.pages) || 0,
      url: pageUrlOf(bvid, meta.page, meta.pages),
      count: list.length,
      updated: Number(meta.updated) || Date.now(),
      notes: list.slice(0, MAX_NOTES),
    };
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  // 空格分开的多个词按 AND 匹配（「损失 函数」两个词都得出现）
  function tokens(q) {
    return norm(q).split(/\s+/).filter(Boolean);
  }

  function hitOf(note, tk) {
    const fields = [note.summary, note.one, note.plain, note.quote];
    const hay = fields.map(norm);
    for (let i = 0; i < tk.length; i++) {
      let ok = false;
      for (let f = 0; f < hay.length; f++) if (hay[f].indexOf(tk[i]) >= 0) { ok = true; break; }
      if (!ok) return null;
    }
    // 命中的那一段原样回给界面，让人知道为什么它被搜出来
    for (let f = 0; f < fields.length; f++) if (fields[f] && norm(fields[f]).indexOf(tk[0]) >= 0) return fields[f];
    return note.summary || note.plain || '';
  }

  // entries: 索引对象数组；返回按视频分组前先拍平，界面自己分组
  function search(entries, q, limit) {
    const tk = tokens(q);
    const out = [];
    if (!tk.length) return out;
    (entries || []).forEach(function (e) {
      if (!e || !e.notes || !e.notes.length) return;
      e.notes.forEach(function (n) {
        const hit = hitOf(n, tk);
        if (hit === null) return;
        out.push({
          bvid: e.bvid, title: e.title, part: e.part || '', page: e.page || 0, totalPages: e.totalPages || 0,
          url: e.url, t: n.t, summary: n.summary, hit: hit,
        });
      });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(0, limit || 50);
  }

  // 没输入时给「最近攒下笔记的视频」
  function recent(entries, n) {
    const list = (entries || []).filter(function (e) { return e && e.count > 0; });
    list.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    return list.slice(0, n || 8).map(function (e) {
      return { bvid: e.bvid, title: e.title, part: e.part || '', count: e.count, url: e.url, updated: e.updated || 0 };
    });
  }

  function jump(url, t) {
    const u = String(url || '');
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.max(0, Math.floor(Number(t) || 0));
  }

  // 从 chrome.storage.local 的整份 dump 里挑出索引
  function fromStorage(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(PREFIX) !== 0) return;
      const v = all[k];
      if (v && typeof v === 'object' && Array.isArray(v.notes)) out.push(v);
    });
    return out;
  }

  // 同一 bvid 的多个分 P 合成一条（弹窗底部「最近」按视频算，不是按 P）
  function groupVideos(results) {
    const map = {};
    const order = [];
    results.forEach(function (r) {
      const key = r.bvid;
      if (!map[key]) { map[key] = { bvid: key, title: r.title, items: [] }; order.push(key); }
      map[key].items.push(r);
    });
    return order.map(function (k) { return map[k]; });
  }

  const api = {
    PREFIX: PREFIX,
    build: build,
    search: search,
    recent: recent,
    jump: jump,
    fromStorage: fromStorage,
    groupVideos: groupVideos,
    trim: trim,
    tokens: tokens,
  };
  if (typeof window !== 'undefined') window.BnIndex = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
