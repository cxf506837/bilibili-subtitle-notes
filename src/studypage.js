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

  // 「先看哪个」的分：右栏「今天先看这几个」和中栏「还没弄懂」共用这一套，
  // 免得右栏说「先看这个」、中栏里它却排在第十屏。
  //   shaky（半懂）   200 —— 差一点就会，回看收益最高
  //   unknown / ''    100 —— 没考过，先看一眼也值
  //   understood       40 —— 懂了，排最后
  //   跨集 +12、锚点多 +1/处（封顶 +10）、只在一集且和集标题没字面重合（suspect）−15
  function conceptScore(c) {
    const o = c || {};
    const status = str(o.status);
    const anchors = Array.isArray(o.anchors) ? o.anchors : (Array.isArray(o.list) ? o.list : []);
    let score = status === 'shaky' ? 200 : status === 'understood' ? 40 : 100;
    if (o.cross) score += 12;
    if (o.suspect) score -= 15;
    score += Math.min(10, anchors.length);
    const eps = Array.isArray(o.eps) ? o.eps.length : (num(o.eps) || 0);
    const reason = status === 'shaky' ? '半懂——最容易忘'
      : status === 'understood' ? '已经懂了，隔几天回看'
        : (o.cross ? '没考过，而且跨 ' + eps + ' 集' : '还没考过');
    return { score: score, status: status, reason: reason };
  }

  // 把一批概念按同一套「先看哪个」重排（返回新数组，不动入参）。
  // 中栏打开「还没弄懂」时用它：第一屏就是右栏推荐的那几个。
  function sortByReview(cards) {
    const arr = (Array.isArray(cards) ? cards : []).slice();
    const cache = new Map();
    const sc = function (c) {
      if (!cache.has(c)) cache.set(c, conceptScore(c));
      return cache.get(c);
    };
    arr.sort(function (a, b) {
      const d = sc(b).score - sc(a).score;
      if (d) return d;
      const ea = Array.isArray(a && a.eps) ? a.eps.length : (num(a && a.eps) || 0);
      const eb = Array.isArray(b && b.eps) ? b.eps.length : (num(b && b.eps) || 0);
      if (eb !== ea) return eb - ea;
      const na = str(a && a.name), nb = str(b && b.name);
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    return arr;
  }

  // 今天先看哪几个：拿到「合并后的概念列表」（CV.group(...).list，每项带 status/cross/suspect/anchors）
  // 之后按 conceptScore 排序，取前 limit 个。
  function reviewQueue(list, opts) {
    const o = opts || {};
    const limit = Math.max(1, num(o.limit) || 6);
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!c) return;
      const name = str(c.name).trim();
      if (!name) return;
      const anchors = Array.isArray(c.anchors) ? c.anchors : [];
      if (!anchors.length) return;
      const sc = conceptScore(c);
      const a = anchors[0];
      out.push({
        name: name, status: sc.status, score: sc.score, reason: sc.reason,
        ep: num(a && a.ep), t: num(a && a.t),
        epLabel: str(a && a.epLabel) || ('第 ' + num(a && a.ep) + ' 集'),
        cross: !!c.cross,
      });
    });
    out.sort(function (a, b) { return (b.score - a.score) || (a.ep - b.ep) || (a.t - b.t); });
    return out.slice(0, limit);
  }

  // 内嵌播放器的地址：只放 B站 官方 player.html 需要的参数（bvid 必有，cid/page 有才带，t 取整）。
  // 单独拎成纯函数，是因为「参数拼错」在真机上只表现为「画面不动」，日志里看不出来。
  function playerSrc(ep, t) {
    const e = ep || null;
    if (!e || !e.bvid) return '';
    const qs = ['bvid=' + encodeURIComponent(String(e.bvid)), 'autoplay=1', 'danmaku=0', 'high_quality=1'];
    if (Number(e.cid)) qs.push('cid=' + encodeURIComponent(String(e.cid)));
    if (Number(e.page) > 1) qs.push('page=' + Number(e.page));
    if (Number(t) >= 1) qs.push('t=' + Math.floor(Number(t)));
    return 'https://player.bilibili.com/player.html?' + qs.join('&');
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

  // 视角参数（?view=...）→ 三档之一。URL 里写错 / 写成别的值一律退回 all，
  // 免得「按钮写着全部、内容却空着」这种自相矛盾的状态出现在用户眼前。
  function parseView(v) {
    const s = String(v == null ? '' : v).trim();
    return (s === 'unwatched' || s === 'cross') ? s : 'all';
  }

  // 中栏的两个视角（纯函数，方便在 node 里测）：
  //   unwatched —— 只看还没看过的集（接着学的时候少滚一点）
  //   cross     —— 只看跨集概念（它们才是「知识点之间的连接」）
  function filterByView(groups, mode, watchedEps) {
    const arr = Array.isArray(groups) ? groups : [];
    const w = {};
    (Array.isArray(watchedEps) ? watchedEps : []).forEach(function (e) { if (e != null) w[Number(e)] = 1; });
    if (mode === 'unwatched') {
      return arr.filter(function (g) { return !w[Number(g && g.ep)]; });
    }
    if (mode === 'cross') {
      const out = [];
      arr.forEach(function (g) {
        const items = ((g && g.items) || []).filter(function (it) { return it && it.cross; });
        if (items.length) out.push({ ep: g.ep, label: g.label, title: g.title, items: items });
      });
      return out;
    }
    return arr.slice();
  }

  // 「按概念」视角（纯函数）：把一个概念在整门课里的每一处并到一张卡上，
  // 按「出现在几集」降序排——跨集多的正是最该把它们连起来看的那些。
  //   dropWatched —— 只看没看过的集里的出现处（看完的集讲了什么，这一屏先不占地方）
  //   一处都不剩的概念整条丢掉，免得留下一张空卡
  function byConcept(groups, opts) {
    const o = opts || {};
    const w = {};
    (Array.isArray(o.watchedEps) ? o.watchedEps : []).forEach(function (e) { if (e != null) w[Number(e)] = 1; });
    const drop = !!o.dropWatched;
    const out = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g) {
      ((g && g.items) || []).forEach(function (it) {
        if (!it) return;
        let list = occurrences(it);
        if (drop) list = list.filter(function (a) { return !w[a.ep]; });
        if (!list.length) return;
        const eps = [];
        list.forEach(function (a) { if (eps.indexOf(a.ep) < 0) eps.push(a.ep); });
        out.push({
          name: str(it.name), def: str(it.def), status: str(it.status),
          cross: !!it.cross, suspect: !!it.suspect,
          list: list, count: list.length, eps: eps.length,
        });
      });
    });
    out.sort(function (a, b) {
      return (b.eps - a.eps) || (b.count - a.count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return out;
  }
  // 掌握度过滤：cards 是 byConcept 的产物（每张带 status）。
  // 'weak' 只留还没弄懂的（半懂 / 没考过 / 没有状态），'unknown' 只留没考过的；不认识的口径原样返回拷贝。
  function filterByMastery(cards, how) {
    const list = Array.isArray(cards) ? cards : [];
    if (how !== 'weak' && how !== 'unknown') return list.slice();
    return list.filter(function (c) {
      const s = str(c && c.status);
      if (how === 'unknown') return !s || s === 'unknown';
      return s !== 'understood';
    });
  }

  // 这一批概念里懂 / 半懂 / 没考过各有几个，给按钮上的数字和「有没有导入掌握度」用。
  function masteryStats(cards) {
    const out = { total: 0, understood: 0, shaky: 0, unknown: 0, weak: 0 };
    (Array.isArray(cards) ? cards : []).forEach(function (c) {
      out.total++;
      const s = str(c && c.status);
      if (s === 'understood') out.understood++;
      else if (s === 'shaky') out.shaky++;
      else out.unknown++;
      if (s !== 'understood') out.weak++;
    });
    return out;
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
    filterGroups: filterGroups, filterByView: filterByView, parseView: parseView, byConcept: byConcept,
    filterByMastery: filterByMastery, masteryStats: masteryStats, reviewQueue: reviewQueue,
    conceptScore: conceptScore, sortByReview: sortByReview, occurrences: occurrences, occSummary: occSummary, playerSrc: playerSrc,
  };
});
