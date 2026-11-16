// 切块 + 讲解层 prompt + 输出校验。纯函数部分挂在 BnSum 上，可在 Node 里测。
(function (root) {
  'use strict';

  const CHUNK = {
    TARGET_SENTENCES: 8,
    MIN_SENTENCES: 4,
    MAX_SECONDS: 45,
    MIN_SECONDS: 15,
    GAP_BREAK_SECONDS: 1.2,
  };

  const MARKERS = ['那么', '接下来', '首先', '其次', '最后', '总结一下', '我们来看', '举个例子', '换句话说', '所以', '但是', '不过'];
  const BANNED = ['非常重要', '极其关键', '至关重要', '深刻', '核心', '重大意义', '具有重要意义', '极大', '举足轻重', '深远影响', '不可忽视', '充分体现'];
  const COND = ['只', '仅', '如果', '当', '因为', '否则', '除非'];

  function normalize(s) {
    return String(s || '').replace(/\s+/g, '').replace(/[，。！？、；："'（）《》…—,.!?;:()]/g, '');
  }

  function startsWithMarker(text) {
    const t = String(text || '').trim();
    return MARKERS.some((m) => t.startsWith(m));
  }

  // 切块：边界只落在句子之间；优先长停顿/话语标记/疑问句结尾。
  function chunkSentences(sentences) {
    const blocks = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      blocks.push({
        id: cur[0].sid,
        start: cur[0].from,
        end: cur[cur.length - 1].to,
        sids: cur.map((s) => s.sid),
        text: cur.map((s) => s.content).join(''),
      });
      cur = [];
    };
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      cur.push(s);
      const next = sentences[i + 1];
      if (!next) break;
      const dur = s.to - cur[0].from;
      const gap = next.from - s.to;
      const strong = gap >= CHUNK.GAP_BREAK_SECONDS || /[？?]$/.test(String(s.content).trim()) || startsWithMarker(next.content);
      const tooLong = dur >= CHUNK.MAX_SECONDS;
      const bigEnough = cur.length >= CHUNK.TARGET_SENTENCES && dur >= CHUNK.MIN_SECONDS;
      const minimumMet = dur >= CHUNK.MIN_SECONDS && cur.length >= CHUNK.MIN_SENTENCES;
      if (tooLong || (bigEnough && strong) || (minimumMet && gap >= 3)) flush();
    }
    flush();
    return blocks;
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  // visual: [{t, text}] 或纯文本；统一成「[画面 12:05] 文字」若干行
  function visualLines(visual) {
    if (!visual) return [];
    if (typeof visual === 'string') return visual.trim() ? [visual.trim()] : [];
    return visual
      .filter((v) => v && String(v.text || '').trim())
      .map((v) => '[画面 ' + fmtClock(v.t) + '] ' + String(v.text).replace(/\s*\n\s*/g, ' / ').trim());
  }

  function promptFor(block, prevOneThing, visual, opts) {
    const o = opts || {};
    const maxPoints = o.maxPoints === 2 ? 2 : 4;
    const vlines = visualLines(visual);
    const sys = [
      '你在给一段视频做笔记。读者没看过视频，必须能独立读懂。',
      '只输出 JSON，不要任何解释文字。',
      'sentence_ids 写上这条要点依据的句子 id，可以多个；时间戳不用你算。',
      'quote 可以省略（系统会用这些句子原句自动拼好）；若要写就必须逐字照抄，可跨句用「……」省略。',
      'plain 是给人看的人话解释，单句不超过 25 字，不要堆名词。',
      '能用「它在解决什么问题」开头就别用「它是什么」开头；能用动词就别把动作变成名词。',
      'block_summary 写这一段在讲什么，不要写「讲者说明了…」这种把说话当内容的话。',
      '反例（不要这样写）：「讲师深入阐述了协方差矩阵的统计学意义，揭示了变量间的协同变化规律。」',
      '  毛病：拔高、名词堆砌、等于什么都没说。',
      '正例：「它只回答一个问题：两个东西是不是一起动。」',
      '不要写评价性的话（很重要/深刻/核心/重大意义），只写内容本身。',
      'plain 里的人名、数字、专有名词必须在原话或本段字幕中出现过，不许新增。',
      '遇到你不确定意思的专名、缩写、软件名（比如 matlab 这类），就在 plain 里直说「提到了 X，但不确定指什么」；',
      '  绝对不许编一个听起来合理的定义（这是最容易误导人的错）。',
      '每段最多 ' + maxPoints + ' 条 points；全是废话就返回空数组。',
    ];
    if (o.machine) {
      sys.push('注意：这段字幕疑似从外语机器翻译过来，句子本身可能不通顺。');
      sys.push('plain 只做最小改写，句子不通就直说「这句字幕不通顺」，不要为了通顺补内容、不要替讲者编逻辑。');
      sys.push('只能归纳字幕里确实说出来的事；拿不准的地方说「不确定」。');
    }
    if (vlines.length) {
      sys.push('另外给了「画面文字」：那是从讲课画面里 OCR 出来的 PPT/板书，可能有错字。');
      sys.push('画面文字只用来帮你理解（公式、列表、标题），quote 必须来自字幕原句，绝不写画面文字；两者冲突时以字幕为准。');
      sys.push('画面里有、字幕里没提但确实关键的内容（比如「0个/1个/2个」这种结论），可以写进 plain。');
    }
    const sysText = sys.join('\n');
    const schema = {
      block_summary: '本段一句话总纲，不超过 40 字',
      points: [{
        sentence_ids: [0],
        quote: '(可省略)',
        plain: '人话解释',
        kind: 'conclusion|definition|example|step|question',
        terms: [{ term: '术语', plain: '一句人话' }],
        analogy: null,
      }],
      one_thing: '如果只记一件事',
    };
    const user = [
      prevOneThing ? '上一段的一句话：' + prevOneThing : '',
      '本段字幕（每行：id|起始秒|内容）：',
      block.lines.map((l) => l.sid + '|' + l.from.toFixed(1) + '|' + l.content).join('\n'),
      vlines.length ? '本段画面文字（OCR，可能有错字）：' : '',
      vlines.length ? vlines.join('\n') : '',
      '',
      '输出 JSON，结构如下（points 数组最多 ' + maxPoints + ' 条）：',
      JSON.stringify(schema),
    ].filter(Boolean).join('\n');
    return [
      { role: 'system', content: sysText },
      { role: 'user', content: user },
    ];
  }

  // claimed 的二字片段有多大比例能在原文里找到；用来区分「轻微改写」和「另编一句」
  function bigramCoverage(claimedNorm, canonNorm) {
    if (claimedNorm.length < 2 || !canonNorm) return 0;
    let hit = 0;
    let total = 0;
    for (let i = 0; i < claimedNorm.length - 1; i++) {
      total++;
      if (canonNorm.includes(claimedNorm.slice(i, i + 2))) hit++;
    }
    return total ? hit / total : 0;
  }

  function hasConditional(tail) {
    return COND.some((c) => tail.includes(c));
  }

  // 校验单条要点；不合格返回 null（直接丢弃，不试图修）。
  function validatePoint(p, block, bySid, visualNorm) {
    if (!p || typeof p !== 'object') return null;
    const plain = String(p.plain || '').trim();
    if (!plain) return null;
    if (plain.length > 80) return null;
    // 时间戳一律由 sentence_ids 推导，不采信模型给的数字（模型只会给近似值）
    const sids = Array.isArray(p.sentence_ids) ? p.sentence_ids.filter((x) => bySid.has(x)) : [];
    if (!sids.length) return null;
    const lo = Math.min.apply(null, sids.map((x) => bySid.get(x).from));
    const hi = Math.max.apply(null, sids.map((x) => bySid.get(x).to));
    // quote 也由字幕原文生成：模型抄对了就采信（可能更简洁），抄错/改写就用原句拼接
    const canonical = sids.map((x) => String(bySid.get(x).content || '').trim()).filter(Boolean).join('……');
    const nCanon = normalize(canonical.replace(/……/g, ''));
    if (nCanon.length < 4) return null;
    const claimed = String(p.quote || '').trim();
    let quote = canonical;
    if (claimed) {
      const parts = claimed.split(/……|\.\.\./).map(normalize).filter(Boolean);
      if (parts.length && parts.every((part) => nCanon.includes(part))) {
        quote = claimed;
      } else if (bigramCoverage(normalize(claimed), nCanon) < 0.5) {
        // 抄写与所选句子基本对不上 ⇒ 这多半是照着别的句子编的，丢掉
        return null;
      }
    }
    const nQuote = normalize(quote.replace(/……|\.\.\./g, ''));
    if (nQuote.length < 4) return null;
    const blockNorm = normalize(block.text);
    const chunks = plain.split(/[，。；！？,.;!?]/).filter((x) => x.trim());
    if (chunks.some((c) => c.length > 25)) return null;
    for (const w of BANNED) {
      let idx = plain.indexOf(w);
      while (idx !== -1) {
        const tail = plain.slice(idx + w.length, idx + w.length + 20);
        if (!hasConditional(tail)) return null;
        idx = plain.indexOf(w, idx + 1);
      }
    }
    // 数字/英文 token 允许出现在画面文字里（PPT 上的「0个/1个/2个」「sinA」这类）
    const ctx = blockNorm + normalize(quote) + (visualNorm || '');
    const tokens = (plain.match(/[0-9]+(?:\.[0-9]+)?|[A-Za-z][A-Za-z0-9.+\-]*/g) || []);
    if (tokens.some((t) => t.length > 1 && !ctx.includes(t))) return null;
    const terms = Array.isArray(p.terms) ? p.terms.filter((t) => t && t.term && t.plain).slice(0, 4) : [];
    return {
      quote,
      plain,
      sids,
      start: lo,
      end: hi,
      kind: ['conclusion', 'definition', 'example', 'step', 'question'].includes(p.kind) ? p.kind : 'conclusion',
      terms,
      analogy: p.analogy ? String(p.analogy).slice(0, 120) : null,
    };
  }

  function validate(raw, block, sentences, visual, opts) {
    const maxPoints = opts && opts.maxPoints === 2 ? 2 : 4;
    const bySid = new Map(sentences.map((s) => [s.sid, s]));
    const visualNorm = normalize(visualLines(visual).join(''));
    let parsed = raw;
    if (typeof raw === 'string') {
      const m = raw.match(/\{[\s\S]*\}/);
      try { parsed = JSON.parse(m ? m[0] : raw); } catch (e) { return { ok: false, points: [], reason: 'bad-json' }; }
    }
    const pts = Array.isArray(parsed && parsed.points) ? parsed.points : [];
    const kept = [];
    let dropped = 0;
    for (const p of pts) {
      const v = validatePoint(p, block, bySid, visualNorm);
      if (v) kept.push(v); else dropped++;
    }
    kept.sort((a, b) => a.start - b.start);
    const limited = kept.slice(0, maxPoints);
    return {
      ok: true,
      blockSummary: String((parsed && parsed.block_summary) || '').slice(0, 60),
      oneThing: String((parsed && parsed.one_thing) || '').slice(0, 80),
      points: limited,
      dropped: dropped + (kept.length - limited.length),
    };
  }

  // 用一次很便宜的模型调用判断「这份字幕是不是机翻」。本地特征只敢说「疑似」，
  // 这个判断直接决定界面要不要写「笔记可能不通顺」。样本 20 句，成本约 300 token。
  function readabilityPrompt(sentences, sampleN) {
    const n = sampleN || 20;
    const list = Array.isArray(sentences) ? sentences : [];
    const step = Math.max(1, Math.floor(list.length / n));
    const picked = [];
    for (let i = 0; i < list.length && picked.length < n; i += step) {
      const t = String(list[i].content || '').trim();
      if (t) picked.push(t);
    }
    const sys = '你在判断视频字幕的来源。只输出 JSON，不要解释文字：{"machine_translation": true 或 false, "why": "一句话"}。' +
      '判据：句子像逐词翻译、缺主语、语序别扭、中文里夹音译人名或英文原名（如「被马特离开一会儿」「matlab 在左边完成」），就是机器翻译；' +
      '句子是自然中文口语或书面语，就是正常转写。';
    const user = '下面是从一个 B站 视频的字幕里等距抽出的 ' + picked.length + ' 句：\n\n' + picked.join('\n') + '\n\n这些字幕是「外语内容的机器翻译」，还是「中文口播的正常转写」？输出 JSON。';
    return [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
  }


  // 小节：每 8 块合成一个标题，只喂这 8 块的「一句话」，不再喂全片摘要
  // （喂全片会让模型拿结论倒推，写出后见之明式的小节名）。
  function sectionPrompt(items, from, to) {
    const lines = (items || []).map((it, i) => (i + 1) + '. ' + String(it.oneThing || it.summary || '').trim()).filter((s) => s.length > 3);
    const sys = [
      '你在给一段视频的连续几段笔记起一个小节标题。读者没看过视频，靠标题要知道「这里在讲什么」。',
      '只输出 JSON，不要解释文字。',
      'title：不超过 12 个字，说这一节的主题，不要写「本节讲…」「第一部分」这种空话。',
      'one_line：不超过 30 个字，说这一节最后落在哪个结论上。',
      '不许写评价性的话（重要/核心/关键），不许编造这几句里没出现的内容。',
    ].join('\n');
    const user = [
      '这一节的时间范围：' + from + ' 到 ' + to,
      '这几段各自的一句话：',
      lines.join('\n'),
      '',
      '输出 JSON：{"title":"小节标题","one_line":"这一节落在哪"}',
    ].join('\n');
    return [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
  }

  // 小节标题的校验：长度、空话、不许带评价词
  function validateSection(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
      const m = raw.match(/\{[\s\S]*\}/);
      try { parsed = JSON.parse(m ? m[0] : raw); } catch (e) { return null; }
    }
    let title = String((parsed && parsed.title) || '').replace(/["'“”「」]/g, '').replace(/[。；，,;：:]$/, '').trim();
    const one = String((parsed && parsed.one_line) || '').trim();
    // 模型爱写「本节讲…」「第一部分…」这种空话前缀，剥掉而不是整条丢弃
    title = title.replace(/^(这一节|本节|第[一二三四五六七八九]部分|第一[部章节]|第二[部章节]|小节)\s*(讲|说|介绍|的内容)?\s*[：:，,]?\s*/, '').trim();
    if (!title) return null;
    // 太长的截断而不是丢掉（真机上「标题 26 字」把整节丢了，等于白花一次调用）
    if (title.length > 28) return null;
    if (title.length > 18) title = title.slice(0, 18);
    if (BANNED.some((w) => title.includes(w))) return null;
    return { title, oneLine: one.slice(0, 40) };
  }


  // 没配 API Key 时的导出：字幕全文（逐句 + 时间戳 + 可点链接），不经模型。
  // 放在纯函数层是为了能单测：输出格式一旦错，用户就会拿到一份没人看得懂的 Markdown。
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function transcriptMarkdown(sentences, meta) {
    const m = meta || {};
    const list = Array.isArray(sentences) ? sentences : [];
    const jump = typeof m.jumpUrl === 'function' ? m.jumpUrl : (t) => '#t=' + Math.floor(Number(t) || 0);
    const out = [];
    out.push('---');
    out.push('source: ' + (m.url || ''));
    out.push('title: ' + (m.title || ''));
    if (m.bvid) out.push('bvid: ' + m.bvid);
    if (Number(m.totalPages) > 1) {
      out.push('page: ' + Number(m.page) + '/' + Number(m.totalPages));
      if (m.part) out.push('part: ' + m.part);
    }
    out.push('subtitle_source: ' + (m.trackLan || ''));
    if (m.ocr) out.push('subtitle_note: 画面字幕识别，可能有错字');
    out.push('verified: ' + (m.verified || 'single-sample'));
    out.push('notes: transcript-only');
    // Obsidian 认 properties 里的 tags：多行写法和行内 [a, b] 都支持，多行更不容易被特殊字符搞坏。
    out.push('tags:');
    out.push('  - bilibili');
    out.push('  - 视频笔记');
    out.push('  - 字幕');
    out.push('exported: ' + (m.exportedAt || new Date().toISOString()));
    out.push('---');
    out.push('');
    out.push('# ' + (m.title || ''));
    out.push('');
    out.push('> 这份是**字幕全文**，没有经过 AI 整理。每行是播放器里的一句话，点时间回到原句。');
    out.push('> 在扩展设置里填一个 API Key 之后，同一份字幕会变成带逐字引文、能核对来源的结论。');
    out.push('');
    out.push('## 字幕全文（' + list.length + ' 句）');
    out.push('');
    if (!list.length) {
      out.push('（这个视频没有可导出的字幕：可能未登录 B站、作者没开 AI 字幕，或字幕接口这次没返回。）');
      out.push('');
    }
    list.forEach((s) => {
      const text = String((s && s.content) || '').replace(/\s+/g, ' ').trim();
      out.push('- [' + fmtTime(s && s.from) + '](' + jump(s && s.from) + ') ' + text);
    });
    out.push('');
    return out.join('\n');
  }

  // 出问题时让用户一键复制这段，贴到 issue 里：版本、页面、字幕状态、端点。
  // 不含 Key；URL 只留 origin + pathname + p（spm_id_from 之类的推广参数不往外带）。
  function diagText(info) {
    const i = info || {};
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const out = [];
    out.push('bili-notes ' + (clean(i.version) || '?') + (i.at ? ' · ' + clean(i.at) : ''));
    let url = clean(i.url);
    if (url) {
      try {
        const u = new URL(url);
        const pg = u.searchParams.get('p');
        url = u.origin + u.pathname + (pg ? '?p=' + pg : '');
      } catch (e) { /* 不是完整 URL 就原样保留 */ }
      out.push('页面: ' + url + (Number(i.totalPages) > 1 ? '（P' + Number(i.page) + '/' + Number(i.totalPages) + '）' : ''));
    }
    if (i.title) out.push('标题: ' + clean(i.title).slice(0, 160));
    const v = clean(i.verdict);
    if (v) {
      const parts = [v];
      if (i.votes) parts.push(String(i.votes) + ' 次取样一致');
      if (i.trackLan) parts.push(clean(i.trackLan));
      parts.push(String(Number(i.sentences) || 0) + ' 句');
      out.push('字幕: ' + parts.join(' · '));
    }
    if (i.titleOverlap) out.push('字幕与标题重合: ' + clean(i.titleOverlap) + (String(i.titleOverlap).indexOf('0/')===0 ? '（一个词都对不上）' : ''));
    if (i.endpoint || i.model) {
      const ep = [];
      if (i.endpoint) ep.push(clean(i.endpoint));
      if (i.model) ep.push('模型 ' + clean(i.model));
      ep.push(i.hasKey ? 'Key 已填' : 'Key 未填');
      out.push('端点: ' + ep.join(' · '));
    }
    if (i.ocr !== undefined && i.ocr !== null) out.push('本机 OCR: ' + (i.ocr ? '可用' : '不可用（轻量包或缺文件）'));
    const st = clean(i.status);
    const det = clean(i.detail);
    if (st || det) out.push('状态: ' + (st || '?') + (det ? ' · ' + det.slice(0, 200) : ''));
    return out.join('\n');
  }
  function toPromptLines(block, sentences) {
    const byId = new Map(sentences.map((s) => [s.sid, s]));
    const lines = block.sids.map((sid) => {
      const s = byId.get(sid);
      return { sid, from: s.from, content: s.content };
    });
    return Object.assign({}, block, { lines });
  }

  root.BnSum = { CHUNK, chunkSentences, promptFor, validate, validatePoint, toPromptLines, readabilityPrompt, sectionPrompt, validateSection, normalize, transcriptMarkdown, fmtTime, diagText };
})(typeof window !== 'undefined' ? window : globalThis);