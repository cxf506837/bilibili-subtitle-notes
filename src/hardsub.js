// 硬字幕兜底：把画面底部「烧进视频里」的字幕条用本地 OCR 一帧帧读出来，
// 先按时间聚成 cue（同一句话持续多久），再拼成句子，交给现有的切块/总结管线。
// 纯函数，挂在 window.BnHardsub 上，可在 Node 里测。
(function (root) {
  'use strict';
  if (root.BnHardsub) return;

  const HS = {
    BAND_TOP: 0.58,        // 字幕带在画面高度上的起点（底部字幕一般在 78%~95%，留点余量）
    BAND_BOTTOM: 0.985,
    MIN_SAMPLE_GAP: 1.0,   // 两次取样至少隔多少视频秒
    SIMILAR: 0.82,         // 两次 OCR 文本相似度 ≥ 它 = 同一句字幕
    SIMILAR_LOOSE: 0.5,    // 上一帧就在刚才（≤2.5s）时放宽：OCR 抖一两个字也算同一句
    LOOSE_WINDOW: 4.0,
    CUE_MERGE_SEC: 4.0,    // 没字之后多久关掉当前 cue（OCR 慢/标签页限速时取样会稀疏）
    STATIC_SEC: 25,        // 同一段文字持续超过它、且很短 → 当台标/水印丢掉
    STATIC_MAX_CHARS: 16,
    MAX_SENT_GAP: 2.5,     // cue 之间停超过它 = 断句
    SENT_MAX_CHARS: 36,
    MIN_CUE_CHARS: 2,
    MIN_SENT_CHARS: 4,
    MIN_TRANSCRIPT_CUES: 3,
    MIN_TRANSCRIPT_CHARS: 60,
  };

  // 归一化：只留中英文数字。相似度比较、重复判定都用这个。
  function normText(s) {
    return String(s || '').replace(/\s+/g, '').replace(/[，。、；：""''（）()【】\[\]《》:：,.;!?！？·…—\-~\x60"'|/\\]/g, '');
  }

  function tidyLine(s) {
    let t = String(s || '').replace(/\u00a0/g, ' ').replace(/[\t\u3000]/g, ' ').trim();
    t = t.replace(/ {2,}/g, ' ');
    t = t.replace(/^[\s·•\-—–_=~|]+/, '').replace(/[\s·•\-—–_=~|]+$/, '');
    return t.trim();
  }

  // 单行是不是噪声：纯标点、纯数字时间、太短、几乎全是符号。
  function isNoiseLine(line) {
    const t = tidyLine(line);
    if (!t) return true;
    const cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
    if (cn === 0 && alnum < 3) return true;
    if (cn + alnum < 2) return true;
    if (/^[\d:.\s/\-–—]+$/.test(t)) return true;
    if (/^(bilibili|www\.bilibili\.com)$/i.test(t)) return true;
    return false;
  }

  // OCR 返回的多行 → 拼成一段（行间用 \n，句子拼接时再拍平）
  // 双语字幕（中文一行、英文一行）只留中文那行：英文是译文，两行都留会让每句话重复一遍意思。
  // 整帧没有任何中文时才留外文行（纯外语视频的硬字幕也能用）。
  function pickText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const keep = [];
    for (const l of lines) {
      if (isNoiseLine(l)) continue;
      const clean = tidyLine(scrubLine(l));
      if (isNoiseLine(clean)) continue;
      keep.push(clean);
    }
    const cn = keep.filter((l) => /[\u4e00-\u9fa5]/.test(l));
    const chosen = cn.length ? cn : keep;
    // 一行里全是同一字符（OCR 常见的乱码）也丢掉
    const out = chosen.filter((l) => {
      const n = normText(l);
      return n.length >= 2 && new Set(n.split('')).size > 1;
    });
    return out.join('\n');
  }

  // 台标/水印文字经常和字幕挤在同一行（耶鲁公开课右下角的 Yale University），
  // OCR 会把它认成形形色色的样子（UniverSity / nIVerSIty / aleUniversity / e1Sity）。
  // 这里按「像不像水印词」把这种 token 挖掉，剩下的才是真正的字幕。
  const MARK_WORDS = ['university', 'bilibili', 'yale'];
  function looksLikeMark(tok) {
    const lc = tok.toLowerCase();
    if (lc.length < 4) return false;
    for (const w of MARK_WORDS) {
      if (lc === w) return true;
      if (w.length >= 5 && similarity(lc, w) >= 0.62) return true;
      if (w.length === 4 && similarity(lc, w) >= 0.8) return true;
    }
    if (/^[a-z0-9]*sity$/.test(lc)) return true;        // e1Sity / versity
    if (/^[a-z0-9]+$/.test(lc) && /[a-z]/.test(lc) && /\d/.test(lc)) {
      // 英数混排的碎屑（e1Sity 的变体）；纯数字/纯字母不算
      if (/[a-z]\d|\d[a-z]/i.test(lc) && (tok.match(/[A-Z]/g) || []).length >= 1) return true;
    }
    return false;
  }

  function scrubLine(line) {
    let t = String(line || '');
    t = t.replace(/￥|¥|©|®|™/g, ' ');
    t = t.replace(/[A-Za-z0-9]{4,}/g, function (tok) {
      return looksLikeMark(tok) ? ' ' : tok;
    });
    t = t.replace(/ {2,}/g, ' ').replace(/^[\s，。、；：,.!?！？]+/, '').trim();
    return t;
  }

  // 底部字幕带在原帧里的裁切区域（drawImage 的源矩形）
  function bandRect(w, h, opts) {
    const o = opts || {};
    const top = typeof o.top === 'number' ? o.top : HS.BAND_TOP;
    const bottom = typeof o.bottom === 'number' ? o.bottom : HS.BAND_BOTTOM;
    const hh = Math.max(1, Math.round(h * (bottom - top)));
    const sy = Math.max(0, Math.min(h - hh, Math.round(h * top)));
    return { sx: 0, sy: sy, sw: w, sh: hh };
  }

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  // 字符 bigram 的 Jaccard 相似度：中文短句上比编辑距离稳，也不怕语序小抖动
  function similarity(a, b) {
    const A = bigrams(normText(a));
    const B = bigrams(normText(b));
    if (!A.size && !B.size) return 1;
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach(function (g) { if (B.has(g)) hit++; });
    return hit / (A.size + B.size - hit);
  }

  function joinText(a, b) {
    if (!a) return b;
    if (!b) return a;
    // 英文单词之间要留空格，中文直接拼
    return /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? a + ' ' + b : a + b;
  }

  function createTracker(opts) {
    const o = opts || {};
    const cfg = Object.assign({}, HS, o);
    const list = [];
    const overlay = [];   // 台标 / 水印 / 固定角标
    let cur = null;
    let lastSeen = -1;
    let samples = 0;
    const drops = { rewind: 0, overlay: 0, empty: 0, short: 0 };

    function isOverlayText(text) {
      const n = normText(text);
      for (const x of overlay) if (similarity(x, n) >= cfg.SIMILAR) return true;
      return false;
    }

    function closeCue() {
      if (!cur) return;
      const dur = cur.to - cur.from;
      const chars = normText(cur.text).length;
      const overlayish = dur >= cfg.STATIC_SEC && chars <= cfg.STATIC_MAX_CHARS;
      if (overlayish) {
        drops.overlay++;
        overlay.push(normText(cur.text));
        if (overlay.length > 20) overlay.shift();
      } else if (dur <= 0 && chars < 3) {
        // 只被采样到一次、又只有一两个字：多半是角标/噪点
        drops.short++;
      } else {
        list.push({ from: cur.from, to: cur.to, text: cur.text });
      }
      cur = null;
    }

    function push(t, raw) {
      t = Number(t);
      if (!isFinite(t)) return { ignored: 'time' };
      // 往回拖不重复记：保持 cue 时间单调，否则同一句会出现两次
      if (t < lastSeen - 0.6) { drops.rewind++; return { ignored: 'rewind' }; }
      samples++;
      lastSeen = Math.max(lastSeen, t);
      const text = pickText(raw);
      if (!text) {
        drops.empty++;
        if (cur && t - cur.to >= cfg.CUE_MERGE_SEC) closeCue();
        return { text: '', added: false, closed: null };
      }
      if (isOverlayText(text)) { drops.overlay++; return { text: text, added: false, closed: null, ignored: 'overlay' }; }
      const near = cur && (t - cur.to) <= cfg.CUE_MERGE_SEC;
      if (cur && near) {
        const sim = similarity(cur.text, text);
        const loose = (t - cur.to) <= cfg.LOOSE_WINDOW;
        if (sim >= cfg.SIMILAR || (loose && sim >= cfg.SIMILAR_LOOSE)) {
          // 同一句：延长时间；OCR 这次认出更多字就用更长的版本
          cur.to = t;
          if (normText(text).length > normText(cur.text).length) cur.text = text;
          return { text: text, added: false, closed: null };
        }
      }
      closeCue();
      if (normText(text).length < cfg.MIN_CUE_CHARS) { drops.short++; return { text: text, added: false, closed: null }; }
      cur = { from: t, to: t, text: text };
      return { text: text, added: true, closed: null };
    }

    function flush(t) {
      if (!cur) return;
      const tt = Number(t);
      if (isFinite(tt)) cur.to = Math.max(cur.to, tt);
      closeCue();
    }

    return {
      push: push,
      flush: flush,
      cues: function () { return list.slice(); },
      pending: function () { return cur; },
      stats: function () {
        return { samples: samples, cues: list.length, overlay: overlay.length, drops: Object.assign({}, drops) };
      },
    };
  }

  // 长句按标点/长度切开：一条 cue 本身就是一大段时，别让它变成一句读不完的话
  function splitLongText(text, maxChars) {
    const pieces = [];
    let rest = String(text || '').trim();
    function normCount(s) { return (s.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || []).length; }
    while (normCount(rest) > maxChars) {
      let seen = 0, cut = rest.length;
      for (let i = 0; i < rest.length; i++) {
        if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(rest[i])) seen++;
        if (seen >= maxChars) { cut = i + 1; break; }
      }
      for (let i = cut; i > Math.max(0, cut - 12); i--) {
        if (/[，。、；：！？,.!?;:]/.test(rest[i - 1])) { cut = i; break; }
      }
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  // cue → 句子：连续字幕拼成一句，句末标点 / 太长 / 停顿太久 就断句
  function cuesToSentences(cues, opts) {
    const o = opts || {};
    const maxGap = typeof o.maxGap === 'number' ? o.maxGap : HS.MAX_SENT_GAP;
    const maxChars = typeof o.maxChars === 'number' ? o.maxChars : HS.SENT_MAX_CHARS;
    const out = [];
    let cur = null;
    function flush() {
      if (!cur) return;
      const t = cur.content.trim();
      if (t && normText(t).length >= HS.MIN_SENT_CHARS) {
        out.push({ sid: out.length, from: cur.from, to: cur.to, content: t });
      }
      cur = null;
    }
    for (const c of cues || []) {
      if (!c || !c.text) continue;
      // 一条 cue 太长就在内部切开，时间按字数比例分
      const pieces = splitLongText(c.text, maxChars);
      const totalChars = pieces.reduce(function (a, p) { return a + normText(p).length; }, 0) || 1;
      const span = Math.max(0, (c.to || 0) - (c.from || 0));
      let acc = 0;
      for (const piece of pieces) {
        const text = String(piece).replace(/\s*\n\s*/g, '').trim();
        if (!text) continue;
        const n = normText(text).length;
        const from = c.from + span * (acc / totalChars);
        acc += n;
        const to = c.from + span * (acc / totalChars);
        if (cur && from - cur.to > maxGap) flush();
        if (!cur) cur = { from: from, to: to, content: text };
        else { cur.content = joinText(cur.content, text); cur.to = Math.max(cur.to, to); }
        if (/[。！？!?]$/.test(text) || normText(cur.content).length >= maxChars) flush();
      }
    }
    flush();
    return out;
  }

  // 识别结果够不够拿来总结：太少就明说，不要硬编笔记
  function assess(sentences, opts) {
    const o = opts || {};
    const minCues = o.minCues || HS.MIN_TRANSCRIPT_CUES;
    const minChars = o.minChars || HS.MIN_TRANSCRIPT_CHARS;
    const list = sentences || [];
    let chars = 0;
    let dur = 0;
    for (const s of list) {
      chars += normText(s.content).length;
      dur += Math.max(0, (s.to || 0) - (s.from || 0));
    }
    const stats = { cues: list.length, chars: chars, dur: dur };
    if (list.length < minCues) return { ok: false, reason: 'too-little', stats: stats };
    if (chars < minChars) return { ok: false, reason: 'too-little', stats: stats };
    if (chars / list.length < 3) return { ok: false, reason: 'too-short-lines', stats: stats };
    return { ok: true, reason: 'ok', stats: stats };
  }

  root.BnHardsub = {
    HS: HS,
    normText: normText,
    tidyLine: tidyLine,
    isNoiseLine: isNoiseLine,
    pickText: pickText,
    scrubLine: scrubLine,
    looksLikeMark: looksLikeMark,
    bandRect: bandRect,
    similarity: similarity,
    joinText: joinText,
    createTracker: createTracker,
    cuesToSentences: cuesToSentences,
    assess: assess,
  };
})(typeof window !== 'undefined' ? window : globalThis);