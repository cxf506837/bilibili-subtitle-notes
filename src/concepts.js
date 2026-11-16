// 概念抽取：把一集字幕切块，问模型「这几分钟里出现了哪些后面还会用到的概念」，
// 只让模型指句子 id，引文与时间一律由本地按句取原话 —— 概念卡也要能点回原句。
// 纯函数，无 DOM、无 chrome，node 里可直接测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnConcept = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMIT = { SENTENCES: 120, PER_CHUNK: 6, NAME: 30, DEF: 60, ALIASES: 4, ANCHORS: 3, TOTAL: 12 };
  const KINDS = { '概念': 1, '方法': 1, '人物': 1, '工具': 1, '结论': 1 };

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
  }

  function sentencesOf(list) {
    return (Array.isArray(list) ? list : []).filter(function (s) {
      return s && s.content && typeof s.sid !== 'undefined';
    });
  }

  // 切成 120 句一块：一块一次模型调用，太多块就是几十次调用，太长的块模型会漏。
  function chunks(list) {
    const sents = sentencesOf(list);
    const out = [];
    for (let i = 0; i < sents.length; i += LIMIT.SENTENCES) out.push(sents.slice(i, i + LIMIT.SENTENCES));
    return out;
  }

  function epLabel(ep) {
    const e = ep || {};
    const m = String(e.title || '').match(/^\s*([Ss]\d+\s*[-－]\s*\d+)/);
    if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace('－', '-');
    return '第 ' + (Number(e.index) || 0) + ' 集';
  }

  function buildPrompt(chunk, ep) {
    const label = epLabel(ep);
    const head = [
      '你在给一门课抽概念卡。读者会在几周后回来看这些概念，所以只收「后面还会用到」的东西。',
      '只输出 JSON，不要任何解释文字。',
      '规则：',
      '1. 概念 = 后面几集还会用到的术语 / 方法 / 人物 / 工具 / 结论。一次性的例子、寒暄、广告不算。',
      '2. name 用视频里的实际叫法（2~20 字），不要自己造词，也不要翻译。',
      '3. def 一句人话（≤40 字），优先写「它解决什么问题」，不要堆名词。',
      '4. anchors 只给句子 id（每行行首的数字），不要自己写引文、不要自己算时间。',
      '5. 一块最多 6 个概念；宁可少，不要凑数。',
      '输出格式：{"concepts":[{"name":"","kind":"概念|方法|人物|工具|结论","def":"","aliases":[],"sids":[12,13]}]}',
    ].join('\n');
    const body = chunk.map(function (s) { return s.sid + '|' + String(s.content).replace(/\s+/g, ' ').trim(); }).join('\n');
    return [
      { role: 'system', content: head },
      { role: 'user', content: '本集：' + label + '' + String((ep && ep.title) || '') + '\n\n' + body },
    ];
  }

  function parse(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : text); } catch (e) { return null; }
  }

  function cleanName(v) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return s.length >= 2 && s.length <= LIMIT.NAME ? s : '';
  }

  function cleanDef(v) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return s.length > LIMIT.DEF ? s.slice(0, LIMIT.DEF) : s;
  }

  // 模型给的是句子 id；引文必须逐字取原句，不能信模型复述（本项目的老规矩）。
  function normalize(resp, chunk, ep) {
    const j = (typeof resp === 'string') ? parse(resp) : resp;
    if (!j || !Array.isArray(j.concepts)) return [];
    const byId = {};
    sentencesOf(chunk).forEach(function (s) { byId[String(s.sid)] = s; });
    const out = [];
    const seen = {};
    j.concepts.forEach(function (c) {
      if (!c) return;
      const name = cleanName(c.name);
      if (!name) return;
      const key = conceptKey(name);
      if (seen[key]) return;
      const sids = Array.isArray(c.sids) ? c.sids : [];
      const anchors = [];
      sids.forEach(function (sid) {
        if (anchors.length >= LIMIT.ANCHORS) return;
        const s = byId[String(sid)];
        if (!s) return;
        if (anchors.some(function (a) { return a.sid === s.sid; })) return;
        anchors.push({ sid: s.sid, t: Math.max(0, Math.floor(Number(s.from) || 0)), quote: String(s.content).replace(/\s+/g, ' ').trim().slice(0, 140) });
      });
      if (!anchors.length) return;
      seen[key] = 1;
      const aliases = [];
      (Array.isArray(c.aliases) ? c.aliases : []).forEach(function (a) {
        const s = cleanName(a);
        if (s && conceptKey(s) !== key && aliases.length < LIMIT.ALIASES && aliases.indexOf(s) < 0) aliases.push(s);
      });
      out.push({
        name: name,
        kind: KINDS[String(c.kind || '')] ? String(c.kind) : '概念',
        def: cleanDef(c.def),
        aliases: aliases,
        anchors: anchors,
        ep: Number((ep && ep.index) || 0),
        epLabel: epLabel(ep),
        epTitle: String((ep && ep.title) || ''),
      });
      if (out.length >= LIMIT.PER_CHUNK) return;
    });
    return out.slice(0, LIMIT.PER_CHUNK);
  }

  function conceptKey(name) {
    return String(name || '')
      .replace(/\s+/g, '')
      .replace(/[，。！？、；：""''（）《》【】…—,.!?;:\"'()\[\]<>\/\\`~@#$%^&*+=|-]/g, '')
      .toLowerCase();
  }

  // 跨集合并：同名 / 别名指向同一个概念，时间锚点累加（同一集 3 秒内算同一条）。
  function merge(items) {
    const out = [];
    const byKey = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      const name = cleanName(it.name);
      if (!name) return;
      const key = conceptKey(name);
      let hit = byKey[key];
      if (!hit) {
        const aliases = Array.isArray(it.aliases) ? it.aliases : [];
        for (let i = 0; i < aliases.length; i++) {
          const ak = conceptKey(aliases[i]);
          if (ak && byKey[ak]) { hit = byKey[ak]; break; }
        }
      }
      if (!hit) {
        hit = { name: name, kind: it.kind || '概念', def: cleanDef(it.def), aliases: [], anchors: [] };
        byKey[key] = hit;
        out.push(hit);
      }
      if (!hit.def && it.def) hit.def = cleanDef(it.def);
      (Array.isArray(it.aliases) ? it.aliases : []).forEach(function (a) {
        const s = cleanName(a);
        if (!s) return;
        const ak = conceptKey(s);
        if (!ak || ak === conceptKey(hit.name) || byKey[ak] === hit) return;
        if (byKey[ak] && byKey[ak] !== hit) return; // 已经被别的概念占了，不抢
        if (hit.aliases.indexOf(s) < 0 && hit.aliases.length < LIMIT.ALIASES) hit.aliases.push(s);
        byKey[ak] = hit;
      });
      (Array.isArray(it.anchors) ? it.anchors : []).forEach(function (a) {
        if (!a || typeof a.t !== 'number') return;
        const ep = Number(a.ep || it.ep || 0);
        if (!ep) return;
        if (hit.anchors.some(function (x) { return x.ep === ep && Math.abs(x.t - a.t) < 3; })) return;
        hit.anchors.push({
          ep: ep,
          epLabel: a.epLabel || it.epLabel || '',
          epTitle: a.epTitle || it.epTitle || '',
          t: Math.max(0, Math.floor(a.t)),
          quote: String(a.quote || '').slice(0, 140),
          url: a.url || it.url || '',
        });
      });
    });
    out.forEach(function (h) {
      h.anchors.sort(function (a, b) { return a.ep - b.ep || a.t - b.t; });
      if (h.anchors.length > LIMIT.TOTAL) h.anchors = h.anchors.slice(0, LIMIT.TOTAL);
    });
    out.sort(function (a, b) {
      return b.anchors.length - a.anchors.length || String(a.name).localeCompare(String(b.name), 'zh');
    });
    return out;
  }

  return {
    LIMIT: LIMIT,
    fmtClock: fmtClock,
    epLabel: epLabel,
    chunks: chunks,
    buildPrompt: buildPrompt,
    parse: parse,
    normalize: normalize,
    conceptKey: conceptKey,
    merge: merge,
  };
});
