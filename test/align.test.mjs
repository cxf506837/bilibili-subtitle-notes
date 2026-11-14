// 音画对齐（align.js）单测：合成「字幕 + 语音包络」，看能不能把已知的偏移/漂移估出来
// 注意：字幕句长和句间停顿必须是**不规则**的；如果用「每 3 秒一句」这种周期性数据，
// 偏移 ±1 句长的得分几乎一样，任何算法都分不出来（这不是 bug，是数据本身有歧义）。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/align.js'), 'utf8'), ctx);
const A = ctx.window.BnAlign;

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }

function rnd(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// 不规则字幕：句长 1.2~3.6 秒，句间停顿 0.3~1.9 秒
function makeCues(duration, seed = 7) {
  const r = rnd(seed), cues = [];
  let t = 1 + r();
  while (t + 1.4 < duration) {
    const len = 1.2 + r() * 2.4;
    cues.push({ from: +t.toFixed(2), to: +(t + len).toFixed(2) });
    t += len + 0.3 + r() * 1.6;
  }
  return cues;
}

function makeSamples(cues, shiftFn, opts = {}) {
  const duration = opts.duration ?? 300, noise = opts.noise ?? 0.01, out = [];
  for (let d = 0; d <= duration; d += 0.2) out.push({ t: +d.toFixed(2), rms: noise });
  for (const c of cues) {
    const s = c.from + (shiftFn ? shiftFn(c.from) : 0), len = c.to - c.from;
    for (let d = s; d <= s + len; d += 0.2) {
      if (d < 0 || d > duration) continue;
      const i = Math.round(d / 0.2);
      if (out[i]) out[i].rms = 0.12 + 0.05 * Math.sin(d);
    }
  }
  return out;
}

console.log('align: 基本');
{
  const cues = makeCues(300);
  const r = A.analyze(makeSamples(cues, null), cues);
  ok('无偏移判 aligned', r.verdict === 'aligned', r);
  ok('|δ| < 0.5', Math.abs(r.delta) < 0.5, r.delta);
  ok('描述里有「音画对齐」', /音画对齐/.test(A.describe(r)));
  ok('shiftFor 对齐时为 0', A.shiftFor(r, 100) === 0);
}

console.log('align: 恒定偏移');
for (const trueD of [1.3, -2.0, 4.5]) {
  const cues = makeCues(300);
  const r = A.analyze(makeSamples(cues, () => trueD), cues);
  ok('偏移 ' + trueD + 's 判 offset', r.verdict === 'offset', r);
  ok('偏移 ' + trueD + 's 估出 ±0.3', Math.abs(r.delta - trueD) <= 0.3, { got: r.delta, want: trueD });
  ok('偏移 ' + trueD + 's 的 shiftFor 就是 δ', Math.abs(A.shiftFor(r, 50) - trueD) <= 0.3);
  ok('描述写「字幕比音频' + (trueD > 0 ? '早' : '晚') + '」', A.describe(r).includes('字幕比音频' + (trueD > 0 ? '早' : '晚')));
}
ok('半秒以内不校正（δ=0.3）', (() => { const c = makeCues(300); return A.analyze(makeSamples(c, () => 0.3), c).verdict === 'aligned'; })());

console.log('align: 逐步漂移');
{
  const cues = makeCues(600);
  const rate = 0.008; // 每秒多偏 8ms → 600 秒漂 4.8 秒
  const r = A.analyze(makeSamples(cues, (t) => rate * t, { duration: 600 }), cues);
  ok('判 drift', r.verdict === 'drift', r);
  ok('斜率接近 0.008', Math.abs(r.slope - rate) <= 0.003, { got: r.slope, want: rate });
  ok('残差 ≤ 1.5', r.residual <= 1.5, r.residual);
  const lo = A.shiftFor(r, 30), hi = A.shiftFor(r, 570);
  ok('shiftFor 随 t 变大', hi - lo > 2, { lo, hi });
  ok('结尾处 shift ≈ 4.6', Math.abs(hi - rate * 570) <= 1.5, { hi, want: rate * 570 });
}

console.log('align: 不该下结论的情况');
ok('没采样 → no-audio', A.analyze([], makeCues(100)).verdict === 'no-audio');
ok('全静音 → no-audio', A.analyze(Array.from({ length: 500 }, (_, i) => ({ t: i * 0.2, rms: 0.001 })), makeCues(100)).verdict === 'no-audio');
ok('没字幕 → no-cues', A.analyze([{ t: 0, rms: 0.2 }], []).verdict === 'no-cues');
ok('语音太少 → too-little', A.analyze(Array.from({ length: 100 }, (_, i) => ({ t: i * 0.2, rms: 0.2 })), makeCues(30), { minSpeechSec: 40 }).verdict === 'too-little');
ok('全程有噪声没有句子结构 → 不判 aligned/offset', (() => {
  const cues = makeCues(300);
  const s = Array.from({ length: 1500 }, (_, i) => ({ t: i * 0.2, rms: 0.05 + 0.04 * Math.sin(i * 1.7) }));
  return ['unreliable'].includes(A.analyze(s, cues).verdict);
})(), (() => { const cues = makeCues(300); const s = Array.from({ length: 1500 }, (_, i) => ({ t: i * 0.2, rms: 0.05 + 0.04 * Math.sin(i * 1.7) })); return A.analyze(s, cues); })());
console.log('align: 字幕几乎连续时只能判「判不出来」');
{
  // B站 AI 字幕实测覆盖 97%~99%（1390 句 / 2613 秒只有 21 个停顿点）：任何 δ 都能让语音落在区间里，
  // 必须明说对不出来，绝不能给出一个假的「已对齐」。
  const cues = [];
  for (let t = 0; t < 300; t += 1.9) cues.push({ from: +t.toFixed(2), to: +(t + 1.86).toFixed(2) });
  const s = [];
  for (let d = 0; d <= 300; d += 0.2) s.push({ t: +d.toFixed(2), rms: 0.08 + 0.03 * Math.sin(d * 3) });
  const r = A.analyze(s, cues);
  ok('连续字幕 → no-gaps', r.verdict === 'no-gaps', r);
  ok('no-gaps 不给出偏移校正', A.shiftFor(r, 100) === 0);
  ok('描述写「判不出时间偏移」', /判不出时间偏移/.test(A.describe(r)), A.describe(r));
}
{
  // 真机素材回归：BV1twZ4YzEmv 采到的 426 个 0.2s 桶 + 1390 句字幕
  const fx = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/audio-real.json'), 'utf8'));
  const r = A.analyze(fx.audio, fx.sentences);
  ok('真机素材（字幕覆盖 97%+）→ no-gaps', r.verdict === 'no-gaps', r);
  ok('真机素材算出的覆盖率 > 0.9', (r.cueCoverage || 0) > 0.9, r.cueCoverage);
}

{
  const b = A.toBuckets([{ t: 0, rms: 0.1 }, { t: 0.08, rms: 0.3 }, { t: 0.6, rms: 0.2 }]);
  ok('toBuckets 同桶取最大、栅格对齐', b.length === 2 && b[0].rms === 0.3 && b[0].t === 0 && Math.abs(b[1].t - 0.6) < 1e-9, b);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
