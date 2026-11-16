// 课程目录：把一个合集（ugc_season）/ 一个多 P 视频 / 单个视频，统一成「课程 → 集」。
// 纯函数，无 DOM、无 chrome，node 里可直接测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnCourse = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  // 秒 → 人话时长：2 小时 58 分 / 12 分 30 秒 / 45 秒
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(num(sec)));
    if (!s) return '0 秒';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return h + ' 小时' + (m ? ' ' + m + ' 分' : '');
    if (m) return m + ' 分' + (r ? ' ' + r + ' 秒' : '');
    return r + ' 秒';
  }

  // 跳转地址：多 P 要带 ?p=N，时间点用 &t=秒（B站 认 t 参数）
  function episodeUrl(e) {
    const bvid = String((e && e.bvid) || '');
    if (!bvid) return '';
    let url = 'https://www.bilibili.com/video/' + bvid;
    const q = [];
    if (num(e.page) > 1) q.push('p=' + Math.floor(num(e.page)));
    if (num(e.sec) >= 1) q.push('t=' + Math.floor(num(e.sec)));
    return q.length ? url + '?' + q.join('&') : url;
  }

  function normalizeEp(e, i, kind) {
    const ep = {
      index: i + 1,
      bvid: String(e.bvid || ''),
      aid: String(e.aid || ''),
      cid: String(e.cid || ''),
      page: num(e.page) || 1,
      title: String(e.title || e.part || ('第 ' + (i + 1) + ' 集')).trim(),
      duration: num(e.duration),
      sec: num(e.sec),
      kind: kind,
    };
    if (e.section) {
      ep.section = String(e.section);
      ep.sectionIndex = Number(e.sectionIndex) || 0;
    }
    ep.url = episodeUrl(ep);
    return ep;
  }

  // meta 来自 gate.resolveVideo：合集在 meta.season，多 P 在 meta.pageList
  function build(meta) {
    if (!meta || !meta.bvid) return null;
    const season = meta.season;
    if (season && Array.isArray(season.eps) && season.eps.length) {
      const episodes = season.eps.map(function (e, i) { return normalizeEp(e, i, 'season'); });
      return summarize({
        kind: 'season',
        id: 'season:' + (season.id || meta.bvid),
        title: String(season.title || meta.title || '').trim(),
        episodes: episodes,
      });
    }
    const list = Array.isArray(meta.pageList) ? meta.pageList : [];
    if (list.length > 1) {
      const episodes = list.map(function (p, i) {
        return normalizeEp({ bvid: meta.bvid, cid: p.cid, page: p.page || i + 1, title: p.part || ('P' + (i + 1)), duration: p.duration }, i, 'pages');
      });
      return summarize({
        kind: 'pages',
        id: 'video:' + meta.bvid,
        title: String(meta.title || '').trim(),
        episodes: episodes,
      });
    }
    const single = normalizeEp({ bvid: meta.bvid, cid: meta.cid, page: 1, title: meta.title || '本集', duration: meta.pageDur }, 0, 'single');
    return summarize({ kind: 'single', id: 'video:' + meta.bvid, title: String(meta.title || '').trim(), episodes: [single] });
  }

  // 集标题里的分段前缀：'S2-6 别再手动帮 AI 点测试了' → 'S2'
  function prefixOf(title) {
    const m = /^\s*([A-Za-z]{1,4}\d{1,3})\s*[-_\u2014\u2013:\.]\s*\S/.exec(String(title || ''));
    return m ? m[1].toUpperCase() : '';
  }

  // 分组：优先后台给的 section（S1/S2 分段页签），
  // 只有一个 section（常见：整季都是「正片」）时，退回按标题前缀 S1/S2 分组。
  function groupSections(course) {
    const eps = course.episodes;
    const secTitles = [];
    eps.forEach(function (ep) {
      const t = String(ep.section || '').trim();
      if (t && secTitles.indexOf(t) < 0) secTitles.push(t);
    });
    const groups = [];
    function put(key, title, ep) {
      let g = null;
      for (let i = 0; i < groups.length; i++) if (groups[i].key === key) { g = groups[i]; break; }
      if (!g) { g = { key: key, title: title, episodes: [] }; groups.push(g); }
      g.episodes.push(ep);
    }
    if (secTitles.length > 1) {
      eps.forEach(function (ep) {
        const t = String(ep.section || '').trim() || '其他';
        put('s' + (ep.sectionIndex || 0), t, ep);
      });
      return groups;
    }
    const pref = eps.map(function (ep) { return prefixOf(ep.title); });
    const distinct = [];
    pref.forEach(function (x) { if (x && distinct.indexOf(x) < 0) distinct.push(x); });
    const hit = pref.filter(function (x) { return !!x; }).length;
    if (distinct.length > 1 && hit >= Math.ceil(eps.length * 0.6)) {
      const base = secTitles[0] || '';
      eps.forEach(function (ep, i) {
        const k = pref[i] || base || '其他';
        put('p' + k, k, ep);
      });
      return groups;
    }
    eps.forEach(function (ep) { put('all', secTitles[0] || '', ep); });
    return groups;
  }

  function summarize(course) {
    let total = 0;
    course.episodes.forEach(function (e) { total += e.duration; });
    course.total = total;
    course.sections = groupSections(course);
    return course;
  }

  // map: { cid: 看到第几秒 }；一集算「看过」= 看到 max(30 秒, 90% 时长)
  function isWatched(ep, map) {
    const t = num(map && map[ep.cid]);
    if (!t) return false;
    const d = num(ep.duration);
    if (!d) return t >= 60;
    return t >= Math.max(30, d * 0.9);
  }

  function progress(course, map) {
    if (!course) return null;
    let watched = 0, totalSec = 0, watchedSec = 0;
    const flags = course.episodes.map(function (ep) {
      const d = num(ep.duration);
      totalSec += d;
      const seen = num(map && map[ep.cid]);
      const got = d ? Math.min(seen, d) : seen;
      watchedSec += got;
      const done = isWatched(ep, map);
      if (done) watched++;
      return done;
    });
    return {
      watched: watched,
      count: course.episodes.length,
      totalSec: totalSec,
      watchedSec: watchedSec,
      remainingSec: Math.max(0, totalSec - watchedSec),
      flags: flags,
    };
  }

  // 当前播到第几集（按 bvid + cid 匹配，分 P 时 cid 唯一）
  function currentIndex(course, bvid, cid) {
    if (!course) return -1;
    for (let i = 0; i < course.episodes.length; i++) {
      const e = course.episodes[i];
      if (String(e.bvid) === String(bvid) && String(e.cid) === String(cid)) return i;
    }
    for (let i = 0; i < course.episodes.length; i++) {
      if (String(course.episodes[i].bvid) === String(bvid)) return i;
    }
    return -1;
  }

  // 「继续上次」：先找当前集之后第一个没看过的；没有就找全课第一个没看过的
  function nextUnwatched(course, map, fromIndex) {
    if (!course) return null;
    const eps = course.episodes;
    const from = typeof fromIndex === 'number' && fromIndex >= 0 ? fromIndex + 1 : 0;
    for (let i = from; i < eps.length; i++) if (!isWatched(eps[i], map)) return eps[i];
    for (let i = 0; i < eps.length; i++) if (!isWatched(eps[i], map)) return eps[i];
    return null;
  }

  return {
    fmtDur: fmtDur,
    episodeUrl: episodeUrl,
    build: build,
    progress: progress,
    isWatched: isWatched,
    currentIndex: currentIndex,
    nextUnwatched: nextUnwatched,
    prefixOf: prefixOf,
  };
});
