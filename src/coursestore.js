// 课程存档：把「我看过哪些课、看到第几集、掌握度如何」存下来，
// 这样点扩展图标（哪怕当前不在视频页）也能接着学。纯函数，无 DOM、无 chrome。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnCourseStore = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFIX = 'bnc:';
  const MAX_EPS = 300;
  const MAX_ROWS = 6;

  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

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

  function clock(sec) {
    const s = Math.max(0, Math.floor(num(sec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
  }

  // 一集算「看过」的阈值必须和 course.js 一致：看到 max(30 秒, 90% 时长)
  function watchedAt(ep, map) {
    const t = num(map && map[ep.cid]);
    if (!t) return false;
    const d = num(ep.duration);
    if (!d) return t >= 60;
    return t >= Math.max(30, d * 0.9);
  }

  function episodeUrl(ep, sec) {
    const bvid = String((ep && ep.bvid) || '');
    if (!bvid) return '';
    let url = 'https://www.bilibili.com/video/' + bvid;
    const q = [];
    if (num(ep.page) > 1) q.push('p=' + Math.floor(num(ep.page)));
    if (num(sec) >= 1) q.push('t=' + Math.floor(num(sec)));
    return q.length ? url + '?' + q.join('&') : url;
  }

  // 存一条课程。时间戳由调用方给（同一页面只写一次，避免播放中反复写盘）。
  function record(course, now) {
    if (!course || !course.id || !Array.isArray(course.episodes) || !course.episodes.length) return null;
    const eps = course.episodes.slice(0, MAX_EPS).map(function (e) {
      return {
        index: Number(e.index) || 0,
        bvid: String(e.bvid || ''),
        cid: String(e.cid || ''),
        page: num(e.page) || 1,
        title: String(e.title || '').trim(),
        duration: num(e.duration),
      };
    });
    const stamp = String(now || new Date().toISOString());
    return {
      key: PREFIX + course.id,
      value: {
        id: String(course.id),
        kind: String(course.kind || ''),
        title: String(course.title || '').trim(),
        ep_count: eps.length,
        total: num(course.total),
        episodes: eps,
        updated_at: stamp,
      },
    };
  }

  function fromStorage(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(PREFIX) !== 0) return;
      const v = all[k];
      if (!v || !v.id || !Array.isArray(v.episodes) || !v.episodes.length) return;
      out.push(v);
    });
    return out;
  }

  function progressOf(all) {
    const map = {};
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf('bnp:') !== 0) return;
      map[k.slice(4)] = num(all[k]);
    });
    return map;
  }

  function status(course, map, studies) {
    const eps = (course && course.episodes) || [];
    let watched = 0;
    let seen = 0;
    let total = num(course && course.total);
    let next = null;
    let nextAt = 0;
    let sum = 0;
    eps.forEach(function (ep) {
      sum += num(ep.duration);
      const t = num(map && map[ep.cid]);
      if (watchedAt(ep, map)) {
        watched++;
        seen += num(ep.duration) || t;
        return;
      }
      if (!next) { next = ep; nextAt = t; }
    });
    if (!total) total = sum;
    const pct = total ? Math.min(100, Math.round((seen / total) * 100)) : 0;
    const st = masteryOf(studies, course && course.id);
    return {
      watched: watched,
      count: eps.length,
      total: total,
      seen: seen,
      remaining: Math.max(0, total - seen),
      pct: pct,
      next: next ? {
        index: next.index,
        title: next.title,
        bvid: next.bvid,
        page: next.page,
        at: nextAt,
        url: episodeUrl(next, nextAt),
      } : null,
      mastery: st ? { understood: Number(st.understood) || 0, shaky: Number(st.shaky) || 0, unknown: Number(st.unknown) || 0 } : null,
    };
  }

  function masteryOf(studies, id) {
    if (!id) return null;
    const list = Array.isArray(studies) ? studies : [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!raw) continue;
      const s = raw.state || raw;
      if (String(s.course_id || '') === String(id)) {
        const p = s.progress || {};
        return {
          understood: Number(p.understood || s.understood) || 0,
          shaky: Number(p.shaky || s.shaky) || 0,
          unknown: Number(p.unknown || s.unknown) || 0,
        };
      }
    }
    return null;
  }

  // 弹窗要展示的行：按最近打开倒序，最多 6 门课
  function list(all, studies, limit) {
    const courses = fromStorage(all);
    const map = progressOf(all);
    const rows = courses.map(function (c) {
      const st = status(c, map, studies);
      return {
        id: c.id,
        kind: c.kind,
        title: c.title,
        ep_count: c.ep_count,
        total: st.total,
        updated_at: c.updated_at,
        watched: st.watched,
        pct: st.pct,
        remaining: st.remaining,
        next: st.next,
        mastery: st.mastery,
      };
    });
    rows.sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
    return rows.slice(0, num(limit) || MAX_ROWS);
  }

  // 弹窗里那行副标题：已看 3/24 · 2 小时 57 分 · 懂 5/半懂 11/没考 75
  function metaLine(row) {
    const bits = [];
    bits.push('已看 ' + row.watched + '/' + row.ep_count);
    if (row.total) bits.push(fmtDur(row.total));
    const m = row.mastery;
    if (m && (m.understood + m.shaky + m.unknown) > 0) {
      bits.push('懂 ' + m.understood + ' · 半懂 ' + m.shaky + ' · 没考 ' + m.unknown);
    }
    return bits.join(' · ');
  }

  function nextLine(row) {
    if (!row || !row.next) return '已看完';
    const nx = row.next;
    return '继续 第 ' + nx.index + ' 集' + (nx.at ? ' · ' + clock(nx.at) : '');
  }

  return {
    PREFIX: PREFIX,
    MAX_ROWS: MAX_ROWS,
    fmtDur: fmtDur,
    clock: clock,
    watchedAt: watchedAt,
    episodeUrl: episodeUrl,
    record: record,
    fromStorage: fromStorage,
    progressOf: progressOf,
    status: status,
    masteryOf: masteryOf,
    list: list,
    metaLine: metaLine,
    nextLine: nextLine,
  };
});
