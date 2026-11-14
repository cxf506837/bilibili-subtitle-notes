// 画面通道：从 <video> 截帧（canvas 取解码像素，不带弹幕/播放器 UI），
// 只在画面「稳定下来」时取一帧，同一张幻灯片不重复取。
// 本文件只负责取样与截帧，OCR 交给 offscreen 文档，见 background.js。
(function () {
  'use strict';
  if (window.BnFrames) return;

  const CFG = {
    SAMPLE_MS: 1200,        // 取样间隔
    SIG_W: 40, SIG_H: 24,   // 指纹分辨率
    STABLE_DIFF: 3.5,       // 相邻两帧平均灰度差小于它 = 画面没动
    SCENE_DIFF: 14,         // 大于它 = 换页/切场景
    SETTLE_SAMPLES: 2,      // 连续 2 次「没动」才认为稳定下来（约 2.4 秒）
    MIN_CAPTURE_GAP_MS: 2500,
    MAX_PER_MINUTE: 20,
    CAPTURE_W: 1280,        // 截帧最长边（1080p 源缩到 1280 宽，OCR 仍够用）
    JPEG_Q: 0.9,
    MIN_HEIGHT: 720,        // 低于 720p 的中文字太小，OCR 只会产出噪声
    MIN_SIG_DIFF: 4,        // 与上次截帧的指纹差小于它 = 同一张画面，不重复取
  };

  function makeCanvas(w, h, readFreq) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', readFreq ? { willReadFrequently: true } : undefined);
    return { canvas: c, ctx: ctx };
  }

  // 用 40x24 灰度值当指纹；返回 { sig, diff }
  function signature(video, small) {
    small.ctx.drawImage(video, 0, 0, CFG.SIG_W, CFG.SIG_H);
    const d = small.ctx.getImageData(0, 0, CFG.SIG_W, CFG.SIG_H).data;
    const sig = new Float32Array(CFG.SIG_W * CFG.SIG_H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      sig[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return sig;
  }

  function sigDiff(a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  function create(getVideo, opts) {
    opts = opts || {};
    const small = makeCanvas(CFG.SIG_W, CFG.SIG_H, true);
    let timer = null;
    let prevSig = null;
    let lastCapturedSig = null;
    let stableStreak = 0;
    let scenePending = false;
    let lastCaptureAt = 0;
    let captureTimes = [];
    let captured = 0;
    let skipped = 0;
    let tooSmall = false;
    let stopped = false;

    function rateOk(now) {
      captureTimes = captureTimes.filter(function (t) { return now - t < 60000; });
      return captureTimes.length < CFG.MAX_PER_MINUTE;
    }

    function capture(v, reason) {
      const now = Date.now();
      if (now - lastCaptureAt < CFG.MIN_CAPTURE_GAP_MS) { skipped++; return null; }
      if (!rateOk(now)) { skipped++; return null; }
      const vw = v.videoWidth, vh = v.videoHeight;
      const scale = Math.min(1, CFG.CAPTURE_W / Math.max(1, vw));
      const w = Math.max(2, Math.round(vw * scale)), h = Math.max(2, Math.round(vh * scale));
      const shot = makeCanvas(w, h, false);
      shot.ctx.drawImage(v, 0, 0, w, h);
      let dataUrl = '';
      try { dataUrl = shot.canvas.toDataURL('image/jpeg', CFG.JPEG_Q); } catch (e) { return null; }
      lastCaptureAt = now;
      captureTimes.push(now);
      captured++;
      return { t: v.currentTime, dataUrl: dataUrl, reason: reason || 'stable', w: w, h: h };
    }

    function tick() {
      if (stopped) return;
      // 没有字幕/没有块时不取帧：取到的文字也无处可挂（帧编码本身也要花钱）
      if (opts.shouldRun && !opts.shouldRun()) { stableStreak = 0; prevSig = null; return; }
      const v = getVideo && getVideo();
      if (!v || v.readyState < 2) { stableStreak = 0; return; }
      if (v.videoHeight && v.videoHeight < CFG.MIN_HEIGHT) {
        if (!tooSmall) {
          tooSmall = true;
          if (opts.onUnsupported) opts.onUnsupported('低分辨率（' + v.videoWidth + 'x' + v.videoHeight + '）画面文字太小，跳过');
        }
        return;
      }
      if (v.paused) { stableStreak = 0; prevSig = null; return; }
      const sig = signature(v, small);
      const diff = sigDiff(sig, prevSig);
      prevSig = sig;
      if (diff >= CFG.SCENE_DIFF) { scenePending = true; stableStreak = 0; return; }
      if (diff > CFG.STABLE_DIFF) { stableStreak = 0; return; }
      stableStreak++;
      if (stableStreak !== CFG.SETTLE_SAMPLES) return;
      // 稳定下来了：和上次截的那张比，一样就不重复取
      if (lastCapturedSig && sigDiff(sig, lastCapturedSig) < CFG.MIN_SIG_DIFF) {
        scenePending = false;
        return;
      }
      const shot = capture(v, scenePending ? 'scene' : 'stable');
      if (shot) {
        lastCapturedSig = sig;
        scenePending = false;
        if (opts.onFrame) opts.onFrame(shot);
      }
    }

    return {
      start: function () {
        if (timer || stopped) return;
        timer = setInterval(tick, CFG.SAMPLE_MS);
      },
      stop: function () {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
      },
      // 字幕里出现「这个图 / 这里 / 如图」时立刻取一张，不等稳定
      force: function (reason) {
        const v = getVideo && getVideo();
        if (!v || v.readyState < 2) return null;
        if (v.videoHeight && v.videoHeight < CFG.MIN_HEIGHT) return null;
        const shot = capture(v, reason || 'deixis');
        if (shot) { lastCapturedSig = prevSig; scenePending = false; if (opts.onFrame) opts.onFrame(shot); }
        return shot;
      },
      stats: function () {
        return { captured: captured, skipped: skipped, tooSmall: tooSmall, lastAt: lastCaptureAt };
      },
    };
  }

  window.BnFrames = { create: create, CFG: CFG };
})();
