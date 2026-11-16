// 学习包（study pack）：把「课程 → 集 → 笔记 → 概念锚点」拼成一份 agent 能直接吃的包。
// 输出两份：一份 JSON（机器读），一份 Markdown（人读、也能直接丢给模型）。
// spec 是公开接口，改格式必须升 SPEC 版本并在 docs/agent-integration.md 里写明。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnStudy = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPEC = 'bn-study-pack/1';

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(num(sec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  }

  function safeName(v, fb) {
    const s = String(v || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    return s || String(fb || 'bilibili');
  }

  function epLabel(ep) {
    if (!ep) return '';
    if (ep.label) return String(ep.label);
    const m = String(ep.title || '').match(/^\s*([Ss]\d+\s*[-－]\s*\d+)/);
    if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace('－', '-');
    return '第 ' + num(ep.index) + ' 集';
  }

  function jump(url, t) {
    const u = String(url || '');
    const s = Math.max(0, Math.floor(num(t)));
    if (!u) return '';
    if (s < 1) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + s;
  }

  function cleanNotes(list) {
    return (Array.isArray(list) ? list : [])
      .filter(function (n) { return n && typeof n.start === 'number'; })
      .map(function (n) {
        return {
          t: Math.max(0, Math.floor(num(n.start))),
          one: String(n.one || '').slice(0, 200),
          summary: String(n.summary || '').slice(0, 240),
        };
      })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function cleanConcept(c) {
    if (!c || !c.name) return null;
    const anchors = (Array.isArray(c.anchors) ? c.anchors : [])
      .filter(function (a) { return a && typeof a.t === 'number'; })
      .map(function (a) {
        return {
          ep: num(a.ep),
          ep_label: String(a.epLabel || ''),
          ep_title: String(a.epTitle || ''),
          t: Math.max(0, Math.floor(num(a.t))),
          at: fmtClock(a.t),
          url: jump(a.url, a.t),
          quote: String(a.quote || '').slice(0, 160),
        };
      });
    return {
      name: String(c.name),
      kind: String(c.kind || '概念'),
      def: String(c.def || ''),
      aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
      anchors: anchors,
    };
  }

  // input: { course, scope, goal, generatedAt, episodes, concepts }
  function build(input) {
    const it = input || {};
    const c = it.course || {};
    const episodes = (Array.isArray(it.episodes) ? it.episodes : []).map(function (e) {
      const notes = cleanNotes(e.notes);
      return {
        index: num(e.index),
        label: epLabel(e),
        section: String(e.section || ''),
        title: String(e.title || ''),
        bvid: String(e.bvid || ''),
        cid: String(e.cid || ''),
        url: String(e.url || ''),
        duration: Math.max(0, Math.floor(num(e.duration))),
        verdict: String(e.verdict || ''),
        votes: num(e.votes),
        track: String(e.track || ''),
        notes_n: notes.length,
        notes: notes,
        concepts: (Array.isArray(e.concepts) ? e.concepts : []).map(String),
      };
    });
    const concepts = (Array.isArray(it.concepts) ? it.concepts : []).map(cleanConcept).filter(Boolean);
    const doc = {
      spec: SPEC,
      generated_at: String(it.generatedAt || ''),
      goal: String(it.goal || ''),
      course: {
        id: String(c.id || ''),
        title: String(c.title || ''),
        kind: String(c.kind || ''),
        url: String(c.url || ''),
        episodes_total: num(c.episodesTotal),
        duration_sec: Math.max(0, Math.floor(num(c.durationSec))),
      },
      scope: String(it.scope || ''),
      episodes: episodes,
      concepts: concepts,
      counts: {
        episodes: episodes.length,
        notes: episodes.reduce(function (a, e) { return a + e.notes_n; }, 0),
        concepts: concepts.length,
        anchors: concepts.reduce(function (a, x) { return a + x.anchors.length; }, 0),
      },
    };

    const md = [];
    md.push('---');
    md.push('spec: ' + SPEC);
    md.push('course: ' + safeName(doc.course.title, 'B站 课程'));
    if (doc.course.id) md.push('course_id: ' + doc.course.id);
    if (doc.course.kind) md.push('kind: ' + doc.course.kind);
    if (doc.scope) md.push('scope: ' + doc.scope);
    md.push('episodes: ' + doc.counts.episodes);
    md.push('notes: ' + doc.counts.notes);
    md.push('concepts: ' + doc.counts.concepts);
    md.push('generated: ' + doc.generated_at);
    md.push('tags: [bilibili, 视频笔记, 学习包]');
    md.push('---');
    md.push('');
    md.push('# ' + (doc.course.title || 'B站 课程'));
    md.push('');
    if (doc.goal) {
      md.push('## 学习目标');
      md.push('');
      md.push(doc.goal);
      md.push('');
    }
    md.push('## 概念索引（' + doc.counts.concepts + '）');
    md.push('');
    if (!concepts.length) {
      md.push('- 这次没抽概念（没填 API Key，或所选集数太少）。字幕与笔记仍在下面的分集里。');
      md.push('');
    } else {
      concepts.forEach(function (x, i) {
        md.push('### ' + (i + 1) + '. ' + x.name + (x.aliases.length ? '（也叫 ' + x.aliases.join(' / ') + '）' : ''));
        if (x.def) md.push('', x.def);
        x.anchors.forEach(function (a) {
          const tag = a.ep_label || ('第 ' + a.ep + ' 集');
          const link = a.url ? '[' + a.at + '](' + a.url + ')' : a.at;
          md.push('- ' + tag + ' · ' + link + (a.quote ? ' 「' + a.quote + '」' : ''));
        });
        md.push('');
      });
    }
    md.push('## 分集（' + doc.counts.episodes + '）');
    md.push('');
    episodes.forEach(function (e) {
      const head = e.title.indexOf(e.label) === 0 ? e.title : (e.label + ' ' + e.title);
      md.push('### 第 ' + e.index + ' 集 · ' + head);
      md.push('');
      md.push('- 视频：' + (e.url || ''));
      const v = e.verdict === 'stable' ? '两次取样一致' : e.verdict === 'single' ? '单次取样（未复核）' : (e.verdict || '未知');
      md.push('- 字幕：' + (e.duration ? fmtClock(e.duration) + ' · ' : '') + v + (e.track ? ' · ' + e.track : ''));
      if (e.concepts.length) md.push('- 本集概念：' + e.concepts.join(' / '));
      if (!e.notes_n) {
        md.push('- 笔记：这一集还没整理（只验证了字幕）。');
      } else {
        md.push('- 笔记（' + e.notes_n + '）：');
        e.notes.forEach(function (n) {
          md.push('  - ' + fmtClock(n.t) + ' ' + (n.one || n.summary));
        });
      }
      md.push('');
    });
    if (it.failed && it.failed.length) {
      md.push('## 没导出的集（' + it.failed.length + '）');
      md.push('');
      it.failed.forEach(function (f) {
        md.push('- 第 ' + num(f.index) + ' 集 · ' + String(f.title || '') + '：' + String(f.reason || f.verdict || '字幕没取到'));
      });
      md.push('');
    }
    const base = safeName(doc.course.title, 'bilibili-course') + ('（' + (doc.scope ? doc.scope + ' · ' : '') + doc.counts.episodes + ' 集学习包）');
    return {
      spec: SPEC,
      doc: doc,
      json: JSON.stringify(doc, null, 2),
      md: md.join('\n'),
      baseName: base,
    };
  }

  return { SPEC: SPEC, build: build, fmtClock: fmtClock, jump: jump, epLabel: epLabel, safeName: safeName };
});
