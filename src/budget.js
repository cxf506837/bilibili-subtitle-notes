(function (root) {
  'use strict';
  // 花的是用户自己的钱：所有价格与阈值都集中在这一处，别散落到界面里。
  // 价格按 DeepSeek 官方档位（元/百万 token）：输入缓存未命中 2、命中 0.2、输出 3。
  // 别家服务商价格不同，这里给的是「量级参考」——面板写 ≈ 而不是 =。
  const PRICE = { miss: 2, hit: 0.2, out: 3 };
  const DEFAULT = { capVideo: 120000, capDay: 600000 };
  const PREFIX = 'bntok:';
  const PER_BLOCK_TOKENS = 1010; // 实测：BV1GyZYYNErW 120 段 / 121.2k token

  function num(v, d) { const n = Number(v); return isFinite(n) && n >= 0 ? n : d; }

  // usage 兼容 OpenAI / DeepSeek 两种字段；缓存命中数只有 DeepSeek 给。
  function usageOf(usage) {
    if (!usage) return { in: 0, out: 0, hit: 0, miss: 0 };
    const input = num(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens, 0);
    const out = num(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens, 0);
    const hitRaw = num(usage.prompt_cache_hit_tokens, -1);
    const hit = hitRaw < 0 ? 0 : Math.min(hitRaw, input);
    return { in: input, out: out, hit: hit, miss: Math.max(0, input - hit) };
  }

  // 传 {miss,hit,out} 或 {in,hit,out} 都行：调用方常常只有总量（比如按块数估价）。
  function costOf(u) {
    const t = u || {};
    const hit = num(t.hit, 0);
    const miss = t.miss != null ? num(t.miss, 0) : Math.max(0, num(t.in, 0) - hit);
    return (miss * PRICE.miss + hit * PRICE.hit + num(t.out, 0) * PRICE.out) / 1e6;
  }

  function fmtCost(c) {
    const v = num(c, 0);
    if (!v) return '¥0';
    if (v < 0.001) return '¥' + v.toFixed(4);
    if (v < 0.1) return '¥' + v.toFixed(3);
    return '¥' + v.toFixed(2);
  }

  function fmtTokens(n) {
    const v = num(n, 0);
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  // 成本标签：面板状态条那一条。「≈」是刻意的：价格随服务商与缓存命中浮动。
  function label(tok, blocks) {
    const t = tok || {};
    const total = num(t.in, 0) + num(t.out, 0);
    if (!total) return '';
    const c = costOf(t);
    let s = fmtTokens(total) + ' ≈ ' + fmtCost(c);
    if (blocks && blocks > 1 && c > 0) s += ' · 每段 ' + fmtCost(c / blocks);
    return s;
  }

  function dayKey(d) {
    const t = d ? new Date(d) : new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return PREFIX + t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  function caps(cfg) {
    const c = cfg || {};
    return { video: num(c.video, DEFAULT.capVideo), day: num(c.day, DEFAULT.capDay) };
  }

  // 预算判定：返回 null 表示还能继续；否则给人话原因。
  function blocked(videoUsed, dayUsed, cfg) {
    const c = caps(cfg);
    if (c.video > 0 && num(videoUsed, 0) >= c.video) {
      return { reason: 'video', used: num(videoUsed, 0), cap: c.video,
        text: '这个视频已经花了 ' + fmtTokens(videoUsed) + ' token（' + fmtCost(costOf({ in: videoUsed, out: 0 })) + ' 量级），到上限了' };
    }
    if (c.day > 0 && num(dayUsed, 0) >= c.day) {
      return { reason: 'day', used: num(dayUsed, 0), cap: c.day,
        text: '今天已经花了 ' + fmtTokens(dayUsed) + ' token，到上限了' };
    }
    return null;
  }

  // 估价：块数 → token / 金额（给按钮和空态卡片用，别再各写一套）
  function estimate(blocks) {
    const n = Math.max(1, Math.round(num(blocks, 0)));
    const tokens = n * PER_BLOCK_TOKENS;
    // 输入约占 70%、输出 30%：与实测 1010 token/块 的分项一致
    return { blocks: n, tokens: tokens, cost: costOf({ miss: tokens * 0.7, out: tokens * 0.3 }) };
  }

  function estimateText(blocks, prefix, suffix) {
    const e = estimate(blocks);
    return (prefix || '') + fmtTokens(e.tokens) + ' token ≈ ' + fmtCost(e.cost) + (suffix || '');
  }

  const api = {
    PRICE: PRICE, DEFAULT: DEFAULT, PREFIX: PREFIX, PER_BLOCK_TOKENS: PER_BLOCK_TOKENS,
    usageOf: usageOf, costOf: costOf, fmtCost: fmtCost, fmtTokens: fmtTokens, label: label,
    dayKey: dayKey, caps: caps, blocked: blocked, estimate: estimate, estimateText: estimateText,
  };
  root.BnBudget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
