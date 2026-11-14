// 音频通道（L2-A 音画对齐用）：把播放中的音频接进 AudioContext，读音量包络。
// 只采「正在播放、页面可见」的时间窗，记下每个时间点的音量，供 align.js 与字幕时间轴比对。
// 注意：createMediaElementSource 会接管声音输出，所以必须把节点接回 ctx.destination，
//       否则用户会突然听不到声音（这是这套 API 唯一的硬坑）。
(function () {
  'use strict';

  var SAMPLE_MS = 100;      // 每 100ms 读一次 analyser
  var BUCKET = 0.2;          // 0.2 秒一个桶，取桶内最大 RMS
  var FFT = 2048;

  function create(getVideo, opts) {
    opts = opts || {};
    var ctx = null, analyser = null, buf = null;
    var srcEl = null, srcNode = null, nodes = new WeakMap();
    var buckets = Object.create(null);   // k → rms
    var timer = null, state = 'off';
    var zeros = 0, nonzero = 0;

    function ensureCtx() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { state = 'failed'; return null; }
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0;
      buf = new Float32Array(analyser.fftSize);
      return ctx;
    }

    // 把当前 <video> 接进音频图。同一个元素只能建一次 MediaElementSource，所以缓存。
    function attach() {
      var v = getVideo && getVideo();
      if (!v) return false;
      if (!ensureCtx()) return false;
      if (v === srcEl && srcNode) return true;
      var node = nodes.get(v);
      if (!node) {
        try { node = ctx.createMediaElementSource(v); }
        catch (e) { state = 'failed'; return false; }
        nodes.set(v, node);
      }
      if (srcNode) { try { srcNode.disconnect(); } catch (e2) {} }
      srcNode = node; srcEl = v;
      try { srcNode.connect(analyser); analyser.connect(ctx.destination); }
      catch (e3) { state = 'failed'; return false; }
      return true;
    }

    function sample() {
      if (!ctx || ctx.state !== 'running') { state = ctx && ctx.state === 'suspended' ? 'suspended' : state; return; }
      var v = getVideo && getVideo();
      if (!v || v.paused || v.ended) return;
      if (opts.shouldRun && !opts.shouldRun()) return;
      if (!attach()) return;
      analyser.getFloatTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      var rms = Math.sqrt(sum / buf.length);
      if (rms > 1e-4) nonzero++; else zeros++;
      var t = v.currentTime;
      if (!isFinite(t)) return;
      var k = Math.round(t / BUCKET);
      if (!(k in buckets) || rms > buckets[k]) buckets[k] = rms;
      state = 'running';
    }

    function tick() { sample(); }

    return {
      start: function () {
        if (timer) return;
        if (!attach()) return false;
        // 用户点过播放（有手势），可以放心 resume
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
        timer = setInterval(tick, SAMPLE_MS);
        return true;
      },
      stop: function () {
        if (timer) { clearInterval(timer); timer = null; }
        state = 'off';
      },
      resume: function () { if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {}); },
      samples: function () {
        var out = [];
        for (var k in buckets) out.push({ t: Number(k) * BUCKET, rms: buckets[k] });
        return out;
      },
      stats: function () {
        var n = 0; for (var k in buckets) n++;
        return {
          state: state,
          ctx: ctx ? ctx.state : 'none',
          buckets: n,
          seconds: Math.round(n * BUCKET),
          zeros: zeros, nonzero: nonzero,
          attached: !!(srcNode && srcEl && srcEl.isConnected),
        };
      },
      reset: function () { buckets = Object.create(null); zeros = 0; nonzero = 0; },
    };
  }

  window.BnAudio = { create: create, SAMPLE_MS: SAMPLE_MS, BUCKET: () => BUCKET };
})();
