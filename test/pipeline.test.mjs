import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const fixture = readFileSync(new URL('./fixtures/sub-BV1GyZYYNErW.json', import.meta.url), 'utf8');
const gateSrc = readFileSync(new URL('../src/gate.js', import.meta.url), 'utf8');
const sumSrc = readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// ---- 用真实字幕文件 mock 掉扩展的两个外部依赖 ----
const TRACK = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/fake?auth_key=1';
const ctx = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
ctx.globalThis = ctx;
ctx.chrome = {
  runtime: {
    lastError: null,
    sendMessage(msg, cb) {
      setTimeout(() => cb({ ok: true, status: 200, text: fixture, hash: 'h' + fixture.length, bytes: fixture.length }), 5);
    },
  },
};
ctx.fetch = async (url) => {
  if (url.includes('/x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1GyZYYNErW', aid: 1, cid: 2, title: '我的世界克苏鲁全集', duration: 4236, pages: [{ cid: 2, duration: 4236 }] } }) };
  }
  if (url.includes('/x/player/v2')) {
    return { ok: true, json: async () => ({ code: 0, data: { subtitle: { need_login_subtitle: false, subtitles: [{ lan: 'ai-zh', lan_doc: '中文', subtitle_url: TRACK }] } } }) };
  }
  if (url.includes('/aisubtitle')) return { ok: true, text: async () => fixture };
  throw new Error('unexpected url ' + url);
};
runInContext(gateSrc, ctx);
runInContext(sumSrc, ctx);
const G = ctx.BnGate, S = ctx.BnSum;

console.log('真实字幕文件端到端（mock 网络，真实解析/闸门/切块）');
ok('字幕文件能解析出 2132 句', JSON.parse(fixture).body.length === 2132);

const meta = await G.resolveVideo('BV1GyZYYNErW');
ok('resolveVideo 拿到 aid/cid/时长', meta.aid === 1 && meta.cid === 2 && meta.pageDur === 4236, meta);

const r = await G.gateSubtitle(meta, () => {});
ok('三次取样同哈希 → stable', r.verdict === 'stable', r.verdict);
ok('取样记录 3 次', Array.isArray(r.attempts) && r.attempts.length >= 2, r.attempts);
ok('句子带 sid/from/to/content', r.sentences.length === 2132 && typeof r.sentences[0].from === 'number' && typeof r.sentences[0].content === 'string');

const blocks = S.chunkSentences(r.sentences);
ok('切成 120 块', blocks.length === 120, blocks.length);
ok('块覆盖全部句子', blocks.reduce((n, b) => n + b.sids.length, 0) === 2132);
ok('块时长下限 >= 15s（末块除外）', blocks.slice(0, -1).every((b) => b.end - b.start >= 15), blocks.slice(0, 3).map((b) => +(b.end - b.start).toFixed(1)));

const lines = S.toPromptLines(blocks[0], r.sentences);
const msgs = S.promptFor(lines, '');
const promptChars = msgs.reduce((n, m) => n + m.content.length, 0);
// v0.7.0 给讲解层加了「解决什么问题开头」+ 反例正例，system 长约 +300 字，上限放到 1200
ok('单块 prompt 在 400~1200 字之间', promptChars > 400 && promptChars < 1200, promptChars);
ok('prompt 里带了句子 id 与时间', msgs[1].content.includes('|') && msgs[1].content.includes('本段字幕'));

// 校验层：拿第一条句子造一个合格要点，确认能过
const s0 = r.sentences[0];
const goodRaw = JSON.stringify({ block_summary: '开头讲铁傀儡', points: [{ quote: s0.content, sentence_ids: [0], start: s0.from, end: s0.to, plain: '铁傀儡的祖宗叫恩迪', kind: 'definition' }], one_thing: '恩迪是铁傀儡祖先' });
const v = S.validate(goodRaw, lines, r.sentences);
ok('真实句子造出的要点通过校验', v.points.length === 1, v);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
