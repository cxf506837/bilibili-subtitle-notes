import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const gateSrc = readFileSync(new URL('../src/gate.js', import.meta.url), 'utf8');
const sumSrc = readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8');
const ctx = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
ctx.globalThis = ctx;
runInContext(gateSrc, ctx);
runInContext(sumSrc, ctx);
const G = ctx.BnGate;
const S = ctx.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 造一段时长 dur、覆盖 cover 的字幕
function makeSubs(dur, cover, opts) {
  opts = opts || {};
  const lines = opts.lines || 20;
  const end = dur * cover;
  const step = end / lines;
  const out = [];
  for (let i = 0; i < lines; i++) {
    out.push({ sid: i, from: i * step, to: (i + 1) * step - 0.1, content: opts.text || '这是一句测试用的字幕内容比较长的哦' });
  }
  return out;
}

console.log('闸门：时长');
ok('cover 1.00 通过', G.judge(makeSubs(600, 1.0), 600).ok);
ok('cover 0.99 通过', G.judge(makeSubs(600, 0.99), 600).verdict === 'ok');
ok('cover 0.50 → truncated', G.judge(makeSubs(600, 0.5), 600).verdict === 'truncated');
ok('cover 1.73 → overflow', G.judge(makeSubs(600, 1.73), 600).verdict === 'overflow');
ok('cover 27 → overflow', G.judge(makeSubs(60, 27), 60).verdict === 'overflow');

console.log('闸门：结构');
ok('3 行 → malformed', G.judge(makeSubs(600, 1.0, { lines: 3 }), 600).reason === 'too-few-lines');
ok('全短句 → lines-too-short', G.judge(makeSubs(600, 1.0, { text: '啊' }), 600).reason === 'too-few-chars' || G.judge(makeSubs(600, 1.0, { text: '啊啊啊啊啊啊啊啊啊啊' }), 600).reason === 'lines-too-short');
ok('空数组 → empty', G.judge([], 600).verdict === 'empty');
ok('无时长 → no-duration', G.judge(makeSubs(600, 1.0), 0).reason === 'no-duration');

// 中间挖一个 200 秒的大空档（600 秒视频，阈值 max(90, 60) = 90）
const holed = makeSubs(600, 1.0).filter((s) => s.from < 200 || s.from > 400);
ok('大空档 → gap-too-large', G.judge(holed, 600).reason === 'gap-too-large', G.judge(holed, 600));

// 重叠字幕：sumDur 远超时长
const overlap = [];
for (let i = 0; i < 20; i++) overlap.push({ sid: i, from: i * 30, to: i * 30 + 59, content: '重叠的字幕一句一句地说着话' });
ok('重叠 → cues-overlap', G.judge(overlap, 600).reason === 'cues-overlap', G.judge(overlap, 600).stats);

console.log('轨道选择');
ok('优先人工 zh', (G.pickTrack([{ lan: 'ai-zh', subtitle_url: 'u1' }, { lan: 'zh', subtitle_url: 'u2' }]) || {}).lan === 'zh');
ok('无人工取 ai-zh', (G.pickTrack([{ lan: 'ai-zh', subtitle_url: 'u1' }]) || {}).lan === 'ai-zh');
ok('忽略英文轨', G.pickTrack([{ lan: 'en', subtitle_url: 'u' }]) === null);

console.log('切块');
const subs = [];
let t = 0;
for (let i = 0; i < 40; i++) {
  const d = 3;
  subs.push({ sid: i, from: t, to: t + d, content: '第' + i + '句，这是一句正常长度的字幕内容。' });
  t += d + (i % 5 === 4 ? 1.5 : 0.1);
}
const blocks = S.chunkSentences(subs);
ok('切出多块', blocks.length > 1, { n: blocks.length });
ok('块时长不超 45s', blocks.every((b) => b.end - b.start <= 45.001), blocks.map((b) => +(b.end - b.start).toFixed(1)));
ok('块 id = 首句 sid', blocks.every((b) => b.id === b.sids[0]));
ok('句子不重复不丢失', blocks.reduce((n, b) => n + b.sids.length, 0) === subs.length);

console.log('要点校验');
const block = { id: 0, start: 0, end: 9, sids: [0, 1, 2], text: '这是一句正常长度的字幕内容。第二句话在这里出现。第三句话讲了一个数字 42 。' };
const sent = [
  { sid: 0, from: 0, to: 3, content: '这是一句正常长度的字幕内容。' },
  { sid: 1, from: 3, to: 6, content: '第二句话在这里出现。' },
  { sid: 2, from: 6, to: 9, content: '第三句话讲了一个数字 42 。' },
];
const lines = S.toPromptLines(block, sent);
const good = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '第二句讲的是这件事', kind: 'conclusion' }], block_summary: '总纲', one_thing: '记住这句' };
let v = S.validate(good, lines, sent);
ok('合格要点保留', v.points.length === 1, v);

const fakeQuote = { points: [{ quote: '这句话字幕里没有', sentence_ids: [1], start: 3, end: 6, plain: '瞎编' }] };
v = S.validate(fakeQuote, lines, sent);
ok('编造 quote 被丢弃', v.points.length === 0);

const badTime = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 30, end: 33, plain: '模型给的时间是约数' }] };
v = S.validate(badTime, lines, sent);
ok('时间戳改由 sids 推导', v.points.length === 1 && v.points[0].start === 3 && v.points[0].end === 6, v.points);

const paraphrased = { points: [{ quote: '第二句话在这里出现了吧', sentence_ids: [1], plain: '模型把原话轻微改写' }] };
v = S.validate(paraphrased, lines, sent);
ok('引用被改写时改用原文', v.points.length === 1 && v.points[0].quote === '第二句话在这里出现。', v.points);

const noQuote = { points: [{ sentence_ids: [0, 2], plain: '这两句放一起说' }] };
v = S.validate(noQuote, lines, sent);
ok('不给 quote 时自动拼接', v.points.length === 1 && v.points[0].quote === '这是一句正常长度的字幕内容。……第三句话讲了一个数字 42 。', v.points);

const banned = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '这非常重要' }] };
v = S.validate(banned, lines, sent);
ok('空评价被丢弃', v.points.length === 0);

const bannedOk = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '它非常重要，因为这决定了后面的步骤' }] };
v = S.validate(bannedOk, lines, sent);
ok('带理由的评价保留', v.points.length === 1, v.points);

const bannedNoReason = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '这一点非常非常重要' }] };
v = S.validate(bannedNoReason, lines, sent);
ok('光秃秃的评价丢弃', v.points.length === 0);

const newEntity = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '提到了 99 这个数字' }] };
v = S.validate(newEntity, lines, sent);
ok('新增数字被丢弃', v.points.length === 0);

const five = { points: [1, 2, 3, 4, 5].map((i) => ({ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '第' + i + '条要点内容' })) };
v = S.validate(five, lines, sent);
ok('最多保留 4 条', v.points.length === 4);

const longPlain = { points: [{ quote: '第二句话在这里出现', sentence_ids: [1], start: 3, end: 6, plain: '这一条解释写得实在是太长了长到超过了二十五个字的上限所以必须被丢掉才行' }] };
v = S.validate(longPlain, lines, sent);
ok('超长句被丢弃', v.points.length === 0);

console.log('字幕可读性（机翻检测）');
// 用户真机截图里的原句：句子本身就不通，「被马特离开一会儿」是机翻的典型错位
const machineSubs = [
  { sid: 0, from: 0, to: 4, content: '现在下一步......所以这一步是向前的......消除该步骤已完成' },
  { sid: 1, from: 4, to: 7, content: '下一步是向前走，这一步已经完成。' },
  { sid: 2, from: 7, to: 11, content: '右手边呢.....要我抬右手边吗就像被抬着走一样' },
  { sid: 3, from: 11, to: 15, content: '实际上matlab是在左边完成的......然后回到右边' },
  { sid: 4, from: 15, to: 19, content: '我可能需要被马特离开一会儿，然后那样做' },
  { sid: 5, from: 19, to: 23, content: '也许我会被马特离开一会儿，然后那样做' },
];
let rd = G.readability(machineSubs, { MIN_LINES: 5 });
ok('机翻样本 → machine', rd.verdict === 'machine', rd);
ok('机翻样本带出证据', rd.flags.nameSents >= 2 && rd.flags.oddNamePassive >= 1, rd.flags);

const cleanSubs = [];
for (let i = 0; i < 40; i++) {
  cleanSubs.push({ sid: i, from: i * 3, to: i * 3 + 2.8, content: '接下来我们看这一节的重点，先把条件写清楚，再一步步推导结论。' });
}
rd = G.readability(cleanSubs);
ok('正常中文口播 → clean', rd.verdict === 'clean', rd);

const oneNameSubs = cleanSubs.map((s) => Object.assign({}, s));
oneNameSubs[10].content = '这里杰克举了一个例子，说明这个概率怎么算。';
rd = G.readability(oneNameSubs);
ok('只提一个人名不算 machine', rd.verdict !== 'machine', rd);

// 真机回归：2132 句正常中文口播（我的世界克苏鲁全集）里「史蒂夫」出现 7 次、
// 「被安放 / 被叫做 / 被派遣」各一次，早期规则会把它误判成机翻。
const realZh = [];
for (let i = 0; i < 24; i++) realZh.push({ sid: i, from: i * 3, to: i * 3 + 2.8, content: '多头史蒂夫瞬间出现在他的附近，骷髅使者被安放在阿克斯的附近。' });
rd = G.readability(realZh);
ok('角色名 + 正常被动不算 machine', rd.verdict === 'clean', rd);

const tooFew = G.readability(machineSubs);
ok('句数太少 → unknown', tooFew.verdict === 'unknown', tooFew);

console.log('机翻字幕的 prompt');
const mBlock = { id: 0, start: 0, end: 9, sids: [0, 1], text: '被马特离开了。' };
const mSent = [{ sid: 0, from: 0, to: 3, content: '被马特离开了。' }, { sid: 1, from: 3, to: 6, content: '然后那样做。' }];
const mLines = S.toPromptLines(mBlock, mSent);
const msgs = S.promptFor(mLines, '', null, { machine: true, maxPoints: 2 });
const sysText = msgs[0].content;
ok('提示字幕疑似机翻', sysText.includes('机器翻译'), sysText.slice(0, 200));
ok('禁止编造不确定术语的定义', sysText.includes('不确定'), sysText.slice(-200));
ok('机翻时最多 2 条', sysText.includes('最多 2 条'), sysText.slice(0, 400));
const rp = S.readabilityPrompt(cleanSubs, 20);
ok('自检 prompt 抽 20 句', (rp[1].content.match(/。$/gm) || []).length >= 10, rp[1].content.length);

const twoPts = { points: [1, 2, 3, 4].map((i) => ({ quote: '第二句话在这里出现', sentence_ids: [1], plain: '第' + i + '条要点内容' })) };
v = S.validate(twoPts, lines, sent, null, { maxPoints: 2 });
ok('机翻时校验层也砍到 2 条', v.points.length === 2, v.points.length);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
