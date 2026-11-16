import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

// 注意：仓库 package.json 是 type:module，src/*.js 直接用 require() 会按 ESM 解释、拿不到 window.BnBudget。
// 统一按「浏览器里的普通脚本」加载：造一个 window 再执行源码。
const root = fileURLToPath(new URL('..', import.meta.url));
const ctx = { window: {}, console };
createContext(ctx);
runInContext(readFileSync(root + 'src/budget.js', 'utf8'), ctx);
const B = ctx.window.BnBudget;
// vm 里造出来的对象原型和本 realm 不同，deepStrictEqual 会假红；比 JSON 文本。
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
test('usageOf 认 OpenAI 与 DeepSeek 两套字段', () => {
  same(B.usageOf({ prompt_tokens: 100, completion_tokens: 20 }), { in: 100, out: 20, hit: 0, miss: 100 });
  same(B.usageOf({ input_tokens: 80, output_tokens: 10 }), { in: 80, out: 10, hit: 0, miss: 80 });
  same(B.usageOf({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 60 }), { in: 100, out: 5, hit: 60, miss: 40 });
  same(B.usageOf(null), { in: 0, out: 0, hit: 0, miss: 0 });
});

test('缓存命中数不会超过输入总量（脏数据不炸账）', () => {
  const u = B.usageOf({ prompt_tokens: 10, prompt_cache_hit_tokens: 999 });
  assert.equal(u.hit, 10);
  assert.equal(u.miss, 0);
});

test('costOf 按 输入2/命中0.2/输出3 算，命中比未命中便宜十倍', () => {
  assert.ok(Math.abs(B.costOf({ miss: 1e6, out: 0 }) - 2) < 1e-9);
  assert.ok(Math.abs(B.costOf({ hit: 1e6, out: 0 }) - 0.2) < 1e-9);
  assert.ok(Math.abs(B.costOf({ miss: 0, out: 1e6 }) - 3) < 1e-9);
  assert.ok(Math.abs(B.costOf({ miss: 500000, hit: 500000, out: 100000 }) - (1 + 0.1 + 0.3)) < 1e-9);
  assert.equal(B.costOf(null), 0);
});

test('fmtCost 按量级换小数位，不出现 ¥0.0000 这种噪声', () => {
  assert.equal(B.fmtCost(0), '¥0');
  assert.equal(B.fmtCost(0.0002), '¥0.0002');
  assert.equal(B.fmtCost(0.0123), '¥0.012');
  assert.equal(B.fmtCost(1.234), '¥1.23');
});

test('fmtTokens：千位一位小数，万位取整', () => {
  assert.equal(B.fmtTokens(0), '0');
  assert.equal(B.fmtTokens(950), '950');
  assert.equal(B.fmtTokens(1234), '1.2k');
  assert.equal(B.fmtTokens(121200), '121k');
});

test('label 给出总量、金额与每段成本', () => {
  const s = B.label({ in: 900, out: 300, hit: 0 }, 1);
  assert.match(s, /^1\.2k ≈ ¥0\.003/);
  const s2 = B.label({ in: 900, out: 300 }, 3);
  assert.match(s2, /每段 ¥0\.0009/);
  assert.equal(B.label(null), '');
  assert.equal(B.label({ in: 0, out: 0 }), '');
});

test('dayKey 用本地日期，跨天自然换键', () => {
  const k = B.dayKey(new Date(2026, 10, 16, 23, 59));
  assert.equal(k, 'bntok:2026-11-16');
  assert.equal(B.dayKey(new Date(2026, 0, 2, 0, 1)), 'bntok:2026-01-02');
});

test('caps 缺省与 0（0 = 不限）', () => {
  same(B.caps(), { video: 120000, day: 600000 });
  same(B.caps({ video: 0, day: 5000 }), { video: 0, day: 5000 });
  same(B.caps({ video: 'abc' }), { video: 120000, day: 600000 });
});

test('blocked：视频上限先判，其次当天上限；0 表示不限', () => {
  assert.equal(B.blocked(1000, 1000, { video: 5000, day: 50000 }), null);
  const v = B.blocked(5000, 6000, { video: 5000, day: 50000 });
  assert.equal(v.reason, 'video');
  assert.match(v.text, /这个视频已经花了 5\.0k token/);
  const d = B.blocked(10, 50000, { video: 0, day: 50000 });
  assert.equal(d.reason, 'day');
  assert.equal(B.blocked(999999, 999999, { video: 0, day: 0 }), null);
});

test('estimate 与实测口径一致（1010 token/块）', () => {
  const e = B.estimate(10);
  assert.equal(e.tokens, 10100);
  assert.ok(Math.abs(e.cost - 0.0233) < 0.001);
  assert.equal(B.estimate(0).blocks, 1);
  assert.equal(B.estimateText(55), '56k token ≈ ¥0.13');
});

test('estimateText 能拼前缀后缀（按钮文案）', () => {
  assert.equal(B.estimateText(3, '约 ', '，用你自己的额度').endsWith('，用你自己的额度'), true);
  assert.match(B.estimateText(3, '约 '), /^约 3\.0k token ≈ ¥0\.007/);
});
