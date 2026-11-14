import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const gateSrc = readFileSync(new URL('../src/gate.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(gateSrc, ctx);
const G = ctx.BnGate;

const probePath = new URL('./fixtures/probe-results.json', import.meta.url);
const rows = JSON.parse(readFileSync(probePath, 'utf8'));

// 用探测记录里的 lines / lastTo / chars 合成等间距字幕，只回归「时长闸」这一层。
function synth(row) {
  const { lines, lastTo, chars } = row.track;
  const step = lastTo / lines;
  const per = Math.max(3, Math.round(chars / lines));
  const text = '字'.repeat(per);
  const out = [];
  for (let i = 0; i < lines; i++) {
    out.push({ sid: i, from: i * step, to: (i + 1) * step - 0.05, content: text });
  }
  return out;
}

let pass = 0, fail = 0, skipped = 0;
const mismatch = [];
for (const row of rows) {
  if (!row.track) { skipped++; continue; }
  const subs = synth(row);
  const v = G.judge(subs, row.pageDur);
  const cover = row.track.cover;
  const expected = cover < 0.85 ? 'truncated' : cover > 1.10 ? 'overflow' : 'ok';
  const got = v.ok ? 'ok' : v.verdict;
  if (got === expected) { pass++; }
  else { fail++; mismatch.push({ bvid: row.bvid, cover: +cover.toFixed(3), expected, got, reason: v.reason }); }
}

console.log('真实数据回归（60 条，40 条有字幕文件）');
console.log('  match ' + pass + ' / mismatch ' + fail + ' / 无字幕跳过 ' + skipped);
mismatch.slice(0, 8).forEach((m) => console.log('   · ' + JSON.stringify(m)));

// 记录本次实测的分布，写进 README 用
const bucket = { lt06: 0, mid: 0, ok: 0, over15: 0 };
for (const row of rows) {
  if (!row.track) continue;
  const c = row.track.cover;
  if (c < 0.6) bucket.lt06++;
  else if (c < 0.85) bucket.mid++;
  else if (c <= 1.1) bucket.ok++;
  else bucket.over15++;
}
console.log('  cover 分布: <0.6 ' + bucket.lt06 + ' / 0.6~0.85 ' + bucket.mid + ' / 0.85~1.10 ' + bucket.ok + ' / >1.10 ' + bucket.over15);
process.exit(fail ? 1 : 0);
