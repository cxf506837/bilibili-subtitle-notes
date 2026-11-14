import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// 取样投票：同一个 (aid,cid) 会随机返回别的视频的字幕文件，
// 所以不能取「第一个通过的」，要按哈希计票。（2026-11-13 BV1JynA6aEug 实测 8 次出 4 种文件）
const fixture = readFileSync(new URL('./fixtures/sub-BV1GyZYYNErW.json', import.meta.url), 'utf8');
const gateSrc = readFileSync(new URL('../src/gate.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// 造一份「能过闸门但内容不同」的字幕文件：时长结构不动，只改文字
function variant(tag) {
  const j = JSON.parse(fixture);
  j.body = j.body.map((b) => ({ ...b, content: tag + b.content }));
  return JSON.stringify(j);
}
// 造一份「过不了闸门」的文件：把时长砍到 40%
function truncated() {
  const j = JSON.parse(fixture);
  j.body = j.body.filter((b) => b.to < 4236 * 0.4);
  return JSON.stringify(j);
}
const FILES = {
  A: variant('甲'),
  B: variant('乙'),
  C: variant('丙'),
  D: variant('丁'),
  E: variant('戊'),
  T: truncated(),
  HTML: '<!DOCTYPE html><html><body>error</body></html>',
};

async function run(plan) {
  let i = 0;
  const ctx = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
  ctx.globalThis = ctx;
  ctx.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { setTimeout(() => cb({ ok: true, status: 200, text: FILES[plan[plan.length - 1]] }), 1); } } };
  ctx.fetch = async (url) => {
    if (url.includes('/x/web-interface/view')) {
      return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1GyZYYNErW', aid: 1, cid: 2, title: '测试', duration: 4236, pages: [{ cid: 2, duration: 4236 }] } }) };
    }
    if (url.includes('/x/player/v2')) {
      const k = plan[Math.min(i, plan.length - 1)];
      return { ok: true, json: async () => ({ code: 0, data: { subtitle: { need_login_subtitle: false, subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/x?k=' + k }] } } }) };
    }
    if (url.includes('/aisubtitle')) {
      const k = plan[Math.min(i, plan.length - 1)];
      i += 1;
      return { ok: true, text: async () => FILES[k] };
    }
    throw new Error('unexpected url ' + url);
  };
  runInContext(gateSrc, ctx);
  const meta = await ctx.BnGate.resolveVideo('BV1GyZYYNErW');
  return ctx.BnGate.gateSubtitle(meta, () => {});
}

console.log('字幕取样投票');
let r = await run(['A', 'A', 'B', 'A', 'B']);
ok('三票一致 → stable', r.verdict === 'stable', r.verdict);
ok('票数被记下来（>=3）', r.votes >= 3, r.votes);
ok('拿到的是占多数的那份（甲）', r.sentences[0].content.startsWith('甲'), r.sentences[0].content.slice(0, 6));

r = await run(['A', 'B', 'C', 'A', 'B']);
ok('两种文件票数相同 → 不猜，判 ambiguous', r.verdict === 'rejected' && r.reason === 'ambiguous', { v: r.verdict, reason: r.reason });
ok('ambiguous 时列出候选', Array.isArray(r.candidates) && r.candidates.length >= 2, r.candidates);

r = await run(['A', 'B', 'C', 'D', 'E']);
ok('全是不同文件 → ambiguous', r.verdict === 'rejected' && r.reason === 'ambiguous', { v: r.verdict, reason: r.reason });

r = await run(['A', 'T', 'T', 'T', 'T']);
ok('只有一份通过 → single', r.verdict === 'single', r.verdict);

r = await run(['HTML', 'A', 'A', 'A', 'A']);
ok('CDN 返回 HTML 当失败处理，不抛异常', r.verdict === 'stable', r.verdict);
ok('HTML 那次被记成 bad-json', r.attempts.some((a) => a.state === 'bad-json'), r.attempts.map((a) => a.state));

r = await run(['T', 'T', 'T', 'T', 'T']);
ok('全被闸门拒绝 → rejected', r.verdict === 'rejected' && r.reason !== 'ambiguous', { v: r.verdict, reason: r.reason });

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
