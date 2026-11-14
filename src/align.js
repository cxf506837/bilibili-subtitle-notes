// 音画对齐（L2-A）：不需要 ASR，只用「播放时采到的音量包络」和「字幕时间轴」互相印证。
// 用途：判断字幕是不是整体早了/晚了（恒定偏移）、是不是越走越偏（重剪后字幕按旧版），
// 以及在两者都成立时，给字幕时间一个到音频时间的映射 f(t) = a + b*t。
// 纯函数，不碰 DOM，方便 Node 里单测。
(function () {
  'use strict';

  var GRID = 0.2;            // 采样栅格：0.2 秒一个 bucket
  var SCAN_MIN = -10, SCAN_MAX = 10, SCAN_STEP = 0.1;
  var MIN_SPEECH_SEC = 20;   // 至少采到 20 秒语音才敢下结论
  var MIN_SCORE = 0.55;      // 最佳偏移的得分低于这个值就不下结论
  var ALIGN_TOL = 0.5;       // |δ| 小于半秒视为对齐
  var RESID_TOL = 1.5;       // 分段残差超过这个值说明不是恒定偏移
  var FIT_TOL = 1.5;         // 线性拟合后的残差上限
  // 字幕时间轴把采样窗口盖住了多少。B站 AI 字幕实测覆盖 97%~99%（几乎句句相接），
  // 这种情况下「语音落在字幕区间里」对任何 δ 都成立，打分没有分辨力 —— 必须明说判不出来，
  // 不能给出一个假的「已对齐」。
  var MAX_CUE_COVERAGE = 0.9;

  // samples: [{t, rms}] 原始采样（可乱序、可重复时间）→ 0.2 秒栅格，取桶内最大音量
  function toBuckets(samples) {
    var m = Object.create(null), keys = [];
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!s || !isFinite(s.t) || !isFinite(s.rms)) continue;
      var k = Math.round(s.t / GRID);
      if (!(k in m)) { m[k] = 0; keys.push(k); }
      if (s.rms > m[k]) m[k] = s.rms;
    }
    keys.sort(function (a, b) { return a - b; });
    return keys.map(function (k) { return { t: k * GRID, rms: m[k] }; });
  }

  function pct(arr, q) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)));
    return a[i];
  }

  // 合并字幕句子成时间区间（相邻/重叠的并起来，少做无用的区间判断）
  function cueSpans(cues) {
    var sp = [];
    for (var i = 0; i < cues.length; i++) {
      var f = Number(cues[i].from), t = Number(cues[i].to);
      if (!isFinite(f) || !isFinite(t) || t < f) continue;
      sp.push([f, t]);
    }
    sp.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    for (var j = 0; j < sp.length; j++) {
      var last = out[out.length - 1];
      if (last && sp[j][0] <= last[1] + 0.01) { if (sp[j][1] > last[1]) last[1] = sp[j][1]; }
      else out.push([sp[j][0], sp[j][1]]);
    }
    return out;
  }

  function covered(spans, p) {
    var lo = 0, hi = spans.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (p < spans[mid][0]) hi = mid - 1;
      else if (p > spans[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  // δ = 把字幕时间整体平移多少才能对上音频里的说话时间
  function scoreDelta(buckets, spans, delta) {
    var hit = 0, speech = 0, miss = 0, quiet = 0;
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i], p = b.t - delta;
      var inCue = covered(spans, p);
      if (b.rms > scoreDelta._thr) { speech++; if (inCue) hit++; }
      else { quiet++; if (!inCue) miss++; }
    }
    var cover = speech ? hit / speech : 0;
    var rest = quiet ? miss / quiet : 1;
    return { score: cover - 0.4 * (1 - rest), cover: cover, quietGap: rest, speech: speech };
  }

  // 扫描候选偏移。字幕句之间有准周期性（每句差不多长、间隔差不多），所以得分曲线会出现
  // 好几个几乎一样高的峰；拿不准时优先选离 ref 近的那个峰（ref 默认 0，分段时传上一段的 δ）。
  function scan(buckets, spans, thr, lo, hi, ref) {
    scoreDelta._thr = thr;
    ref = ref == null ? 0 : ref;
    var best = null, s, d;
    for (d = lo; d <= hi + 1e-9; d += SCAN_STEP) {
      s = scoreDelta(buckets, spans, d);
      var cand = { delta: Math.round(d * 10) / 10, score: s.score, cover: s.cover, speech: s.speech };
      if (!best) { best = cand; continue; }
      if (cand.score > best.score + 0.01) best = cand;
      else if (cand.score > best.score - 0.01 && Math.abs(cand.delta - ref) < Math.abs(best.delta - ref)) best = cand;
    }
    return best || { delta: 0, score: -9 };
  }

  function linfit(pts) {
    // pts: [{t, d, w}] 加权最小二乘 d = a + b*t
    var sw = 0, st = 0, sd = 0;
    for (var i = 0; i < pts.length; i++) { sw += pts[i].w; st += pts[i].t * pts[i].w; sd += pts[i].d * pts[i].w; }
    if (!sw) return { a: 0, b: 0 };
    var mt = st / sw, md = sd / sw, num = 0, den = 0;
    for (var j = 0; j < pts.length; j++) {
      var dt = pts[j].t - mt;
      num += pts[j].w * dt * (pts[j].d - md);
      den += pts[j].w * dt * dt;
    }
    var b = den > 1e-9 ? num / den : 0;
    return { a: md - b * mt, b: b };
  }

  function analyze(samples, cues, opts) {
    opts = opts || {};
    var buckets = toBuckets(samples), spans0 = cueSpans(cues || []);
    if (!buckets.length) return { verdict: 'no-audio', samples: 0, cues: spans0.length };
    if (!spans0.length) return { verdict: 'no-cues', samples: buckets.length, cues: 0 };
    var first = spans0[0][0], last = spans0[spans0.length - 1][1];
    buckets = buckets.filter(function (b) { return b.t >= first - 12 && b.t <= last + 12; });
    var rms = buckets.map(function (b) { return b.rms; });
    var p20 = pct(rms, 0.2), p90 = pct(rms, 0.9);
    if (p90 < 0.008) return { verdict: 'no-audio', samples: buckets.length, cues: spans0.length, p90: p90 };
    var thr = p20 + 0.25 * (p90 - p20);
    var speechSec = buckets.filter(function (b) { return b.rms > thr; }).length * GRID;
    var need = opts.minSpeechSec || MIN_SPEECH_SEC;
    if (speechSec < need) return { verdict: 'too-little', samples: buckets.length, cues: spans0.length, speechSec: speechSec, thr: thr };

    // 先看这段字幕有没有「空隙」可供对齐：几乎连续的字幕对不出偏移
    var winFrom = buckets[0].t, winTo = buckets[buckets.length - 1].t, union = 0, gaps = [];
    for (var g = 0; g < spans0.length; g++) {
      var s0 = Math.max(spans0[g][0], winFrom), s1 = Math.min(spans0[g][1], winTo);
      if (s1 > s0) union += s1 - s0;
      if (g > 0) {
        // 只数落在采样窗口里的空隙：窗口外的停顿不能拿来当「有停顿可对齐」的证据
        var gA = spans0[g - 1][1], gB = spans0[g][0];
        if (gB > gA && gB > winFrom && gA < winTo) gaps.push(gB - gA);
      }
    }
    var spanLen = Math.max(1e-6, winTo - winFrom), cueCoverage = Math.min(1, union / spanLen);
    var maxCover = opts.maxCueCoverage == null ? MAX_CUE_COVERAGE : opts.maxCueCoverage;
    var bigGaps = gaps.filter(function (x) { return x >= 0.5; }).length;
    if (cueCoverage > maxCover) {
      return {
        verdict: 'no-gaps', cueCoverage: Math.round(cueCoverage * 1000) / 1000, gaps: bigGaps,
        samples: buckets.length, cues: spans0.length, speechSec: Math.round(speechSec * 10) / 10, thr: thr,
      };
    }

    var best = scan(buckets, spans0, thr, SCAN_MIN, SCAN_MAX);
    var out = {
      verdict: '', delta: best.delta, slope: 0, residual: 0, score: best.score,
      cover: best.cover, speechSec: Math.round(speechSec * 10) / 10, samples: buckets.length,
      cues: spans0.length, thr: thr, segs: [], cueCoverage: Math.round(cueCoverage * 1000) / 1000,
    };
    // 注意顺序：分段必须在「全局得分够不够」之前做。
    // 逐步漂移时本来就不存在一个能让整片对上的 δ，全局得分注定偏低（实测 0.49），
    // 先按 MIN_SCORE 判死会把漂移这种最该报出来的情况漏掉。

    // 分段再估一次：恒定偏移时各段 δ 应该一致；逐步漂移时各段 δ 会连成一条斜线
    var t0 = buckets[0].t, t1 = buckets[buckets.length - 1].t, N = 3, span = (t1 - t0) / N, pts = [];
    for (var i = 0; i < N; i++) {
      var a = t0 + i * span, b2 = a + span;
      var seg = buckets.filter(function (x) { return x.t >= a && x.t < b2; });
      if (seg.length < 50) continue;
      var nb = scan(seg, spans0, thr, SCAN_MIN, SCAN_MAX, pts.length ? pts[pts.length - 1].d : best.delta);
      if (nb.score < 0.45) continue;
      pts.push({ t: (a + b2) / 2, d: nb.delta, w: nb.speech, s: nb.score, cover: nb.cover });
      out.segs.push({ t: Math.round((a + b2) / 2), delta: nb.delta, score: Math.round(nb.score * 100) / 100 });
    }
    if (pts.length >= 2) {
      var avgSeg = pts.reduce(function (s2, p) { return s2 + p.s; }, 0) / pts.length;
      var fit = linfit(pts);
      var maxResid = 0;
      for (var j = 0; j < pts.length; j++) maxResid = Math.max(maxResid, Math.abs(pts[j].d - (fit.a + fit.b * pts[j].t)));
      out.fitA = Math.round(fit.a * 100) / 100;
      out.fitB = Math.round(fit.b * 100000) / 100000;
      out.residual = Math.round(maxResid * 100) / 100;
      var spread = Math.max.apply(null, pts.map(function (p) { return p.d; })) - Math.min.apply(null, pts.map(function (p) { return p.d; }));
      // 判「漂移」要三个条件同时成立：至少三段、每段自己是对得上的（平均得分 ≥0.6）、
      // 段间 δ 连成一条斜线。只看「各段 δ 不同」会把纯噪声判成漂移（实测过）。
      if (pts.length >= 3 && avgSeg >= 0.6 && spread >= 1.0 && maxResid <= FIT_TOL && Math.abs(fit.b) > 0.0005 && best.score >= 0.45) {
        out.verdict = 'drift'; out.delta = Math.round((fit.a + fit.b * ((t0 + t1) / 2)) * 10) / 10; out.slope = fit.b;
        return out;
      }
      if (maxResid > RESID_TOL && best.score < 0.75) { out.verdict = 'unreliable'; return out; }
    }
    if (best.score < (opts.minScore || MIN_SCORE)) { out.verdict = 'unreliable'; return out; }
    out.verdict = Math.abs(best.delta) < ALIGN_TOL ? 'aligned' : 'offset';
    if (out.verdict === 'aligned') { out.delta = best.delta; out.slope = 0; }
    return out;
  }

  // 字幕时间 → 音频时间。aligned/unreliable 时原样返回。
  function shiftFor(res, t) {
    if (!res) return 0;
    if (res.verdict === 'drift') return (res.fitA || 0) + (res.fitB || 0) * t;
    if (res.verdict === 'offset') return res.delta;
    return 0;
  }

  function describe(res) {
    if (!res) return '';
    var d = Math.abs(res.delta || 0).toFixed(1);
    switch (res.verdict) {
      case 'aligned': return '音画对齐 · 偏差 ' + d + 's';
      case 'offset': return '字幕比音频' + (res.delta > 0 ? '早' : '晚') + ' ' + d + 's（时间已按音频校正）';
      case 'drift': return '字幕逐步漂移（拟合斜率 ' + res.slope.toFixed(4) + '，已按漂移校正）';
      case 'unreliable': return '音画对齐检查不可靠（噪声或语音太少）';
      case 'too-little': return '音画对齐：采到的语音还不够（' + Math.round(res.speechSec || 0) + 's）';
      case 'no-audio': return '音画对齐：没采到声音';
      case 'no-gaps': return '音画对齐：这段字幕几乎不停顿（覆盖 ' + Math.round((res.cueCoverage || 0) * 100) + '%），判不出时间偏移';
      case 'no-cues': return '';
      default: return '';
    }
  }

  window.BnAlign = {
    GRID: GRID, MIN_SPEECH_SEC: MIN_SPEECH_SEC, ALIGN_TOL: ALIGN_TOL,
    toBuckets: toBuckets, cueSpans: cueSpans, analyze: analyze, shiftFor: shiftFor, describe: describe,
  };
})();
