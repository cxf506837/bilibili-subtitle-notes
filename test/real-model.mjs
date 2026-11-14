// 真模型冒烟：真字幕 fixture → 切块 → 真 DeepSeek 调用 → 校验。用来量真实延迟/通过率/质量。
// 用法: BN_KEY=sk-... node test/real-model.mjs [模型] [块数]
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const MODEL = process.argv[2] || 'deepseek-flash';
const NBLOCKS = Number(process.argv[3] || 3);
const key = process.env.BN_KEY || '';
if (!key) { console.error('缺 BN_KEY 环境变量（随便一家 OpenAI 兼容服务的 key 都行）'); process.exit(2); }
const fixture = readFileSync(new URL('./fixtures/sub-BV1GyZYYNErW.json', import.meta.url), 'utf8');
const sumSrc = readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(sumSrc, ctx);
const S = ctx.BnSum;

const raw = JSON.parse(fixture).body.map((s, i) => ({ sid: i, from: +s.from, to: +s.to, content: String(s.content || '') }));
const blocks = S.chunkSentences(raw);
console.log('块数', blocks.length, '| 模型', MODEL);

const bySid = new Map(raw.map((s) => [s.sid, s]));
let totalIn = 0, totalOut = 0, okPts = 0, dropped = 0, sumMs = 0;
let prev = '';
for (let i = 0; i < NBLOCKS; i++) {
  const b = blocks[i + 1]; // 跳过开头那块（常是片头）
  const msgs = S.promptFor(S.toPromptLines(b, raw), prev);
  const t0 = Date.now();
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: MODEL, messages: msgs, temperature: 0.3, max_tokens: Number(process.env.BN_MAXTOK || 1200), response_format: { type: 'json_object' }, ...(process.env.BN_THINK === '1' ? {} : { thinking: { type: 'disabled' } }) }),
    signal: AbortSignal.timeout(60000),
  });
  const dt = Date.now() - t0;
  const j = await r.json();
  if (!r.ok) { console.log('HTTP', r.status, JSON.stringify(j).slice(0, 300)); break; }
  const content = j.choices[0].message.content;
  const u = j.usage || {};
  totalIn += u.prompt_tokens || 0; totalOut += u.completion_tokens || 0; sumMs += dt;
  let parsed = null;
  try { parsed = JSON.parse(content); } catch (e) { console.log('块' + (i+1), 'JSON 解析失败:', content.slice(0, 200)); continue; }
  const res = S.validate(parsed, b, raw);
  okPts += (res.points || []).length; dropped += (res.dropped || 0);
  console.log('--- 块' + (i + 1) + ' ' + Math.round(b.start) + 's-' + Math.round(b.end) + 's  ' + dt + 'ms  in ' + (u.prompt_tokens||0) + ' out ' + (u.completion_tokens||0));
  console.log('  总纲:', parsed.block_summary);
  console.log('  通过 ' + (res.points||[]).length + ' 条 / 丢弃 ' + (res.dropped||0) + ' 条');
  (res.points || []).forEach((p) => {
    console.log('  · [' + Math.round(p.start) + 's][' + p.kind + '] ' + p.plain);
    console.log('    原话: ' + p.quote.slice(0, 60));
  });
  if (res.dropped) console.log('  丢弃样本:', JSON.stringify((res.reasons || []).slice(0, 2)).slice(0, 300));
  prev = parsed.one_thing || '';
}
console.log('=== 合计: ' + NBLOCKS + ' 块, 平均 ' + Math.round(sumMs / Math.max(1, NBLOCKS)) + 'ms, in ' + totalIn + ' / out ' + totalOut + ' token, 通过 ' + okPts + ' 条, 丢弃 ' + dropped + ' 条');