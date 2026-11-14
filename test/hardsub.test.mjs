import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const hsSrc = readFileSync(new URL('../src/hardsub.js', import.meta.url), 'utf8');
const sumSrc = readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8');
const ctx = createContext({ console, setTimeout, clearTimeout });
ctx.globalThis = ctx;
runInContext(hsSrc, ctx);
runInContext(sumSrc, ctx);
const H = ctx.BnHardsub;
const S = ctx.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

console.log('行清洗');
ok('保留中文行', H.pickText('大家好，今天我们讲三角形') === '大家好，今天我们讲三角形');
ok('丢掉纯时间行', H.pickText('12:05') === '');
ok('丢掉 bilibili 水印', H.pickText('bilibili') === '');
ok('丢掉单字符乱码行', H.pickText('啊啊啊啊啊啊') === '');
ok('保留英文', H.pickText('matlab 在左边完成') === 'matlab 在左边完成');
ok('多行保留换行', H.pickText('第一行字幕\n12:05\n第二行字幕') === '第一行字幕\n第二行字幕');
ok('isNoiseLine 处理空串', H.isNoiseLine('') === true);
// 双语硬字幕（耶鲁公开课那种：中文一行、英文一行）：只留中文，别让每句话重复一遍意思
ok('双语只留中文', H.pickText('就是说，如果死亡就是终结，死亡是坏的吗？当然，\nis if death is the end, is death bad? Now,') === '就是说，如果死亡就是终结，死亡是坏的吗？当然，');
ok('纯外语帧仍保留外文', H.pickText('is if death is the end, is death bad? Now,') === 'is if death is the end, is death bad? Now,');
ok('中文行里夹英文保留整行', H.pickText('如果 death 就是终结\nif death is the end') === '如果 death 就是终结');
// 水印文字（耶鲁公开课右下角 logo）会和字幕挤在同一行，OCR 认成 UniverSity / nIVerSIty / aleUniversity
ok('挖掉水印 UniverSity', H.pickText('不透露自己持什么观点。UniverSity这是第一种方式') === '不透露自己持什么观点。 这是第一种方式');
ok('挖掉水印 nIVerSIty', H.pickText('我认为 nIVerSIty 这门课') === '我认为 这门课');
ok('挖掉水印 aleUniversity', H.pickText('我想先描述一套看法。aleUniversity我先给你们一组观点') === '我想先描述一套看法。 我先给你们一组观点');
ok('挖掉水印 e1Sity', H.pickText('采用就很不一样了e1Sity') === '采用就很不一样了');
ok('单独一行 Yale University 被清空', H.pickText('Yale University') === '');
ok('整行只剩水印时不出字', H.pickText('UniverSity') === '');
ok('正常英文术语不误杀', H.pickText('这里用 matlab 演示') === '这里用 matlab 演示');
ok('正常英文单词不小写误杀', H.pickText('这是一门 philosophy 课') === '这是一门 philosophy 课');
ok('isNoiseLine 不误杀公式行', H.isNoiseLine('a < bsinA') === false);

console.log('字幕带裁切');
const r1 = H.bandRect(1920, 1080);
ok('默认从 58% 开始', r1.sy === Math.round(1080 * 0.58), r1);
ok('高度约占 40%', Math.abs(r1.sh - Math.round(1080 * 0.405)) <= 1, r1);
ok('宽度不变', r1.sw === 1920 && r1.sx === 0);
const r2 = H.bandRect(1000, 500, { top: 0.8, bottom: 1.0 });
ok('自定义范围', r2.sy === 400 && r2.sh === 100, r2);
const r3 = H.bandRect(100, 40, { top: 0.9, bottom: 1.2 });
ok('越界被夹住', r3.sy >= 0 && r3.sy + r3.sh <= 40, r3);

console.log('相似度');
ok('完全相同 = 1', H.similarity('今天讲三角形', '今天讲三角形') === 1);
ok('OCR 抖一个字仍很像', H.similarity('今天讲三角形', '今天讲三角型') > 0.6);
ok('不同句子很低', H.similarity('今天讲三角形', '接下来做练习题') < 0.2);

console.log('cue 聚合');
{
  const tr = H.createTracker();
  tr.push(10, '大家好，今天我们讲三角形');
  tr.push(11.2, '大家好，今天我们讲三角形');
  tr.push(12.4, '大家好，今天我们讲三角形');
  const cues = tr.cues();
  ok('同一句只出一个 cue', cues.length === 0, cues); // 还在 pending
  tr.flush(13.2);
  const cs = tr.cues();
  ok('flush 后落成 cue', cs.length === 1, cs);
  ok('cue 起点 = 第一次看到', cs[0] && cs[0].from === 10, cs[0]);
  ok('cue 终点 = 最后一次看到', cs[0] && cs[0].to === 13.2, cs[0]);
}
{
  const tr = H.createTracker();
  tr.push(10, '在三角形ABC中，已知a，b，A');
  tr.push(11.2, '在三角形ABC中，已知a，b，B');
  tr.flush(11.4);
  ok('OCR 抖一个字母仍算同一句', tr.cues().length === 1, tr.cues());
}
{
  const tr = H.createTracker();
  tr.push(10, '第一句字幕');
  tr.push(12, '第二句字幕');
  tr.push(14, '第二句字幕');
  tr.flush(14);
  const cs = tr.cues();
  ok('换句产生两个 cue', cs.length === 2, cs);
  ok('第二句起点正确', cs[1] && cs[1].from === 12, cs[1]);
}
{
  const tr = H.createTracker();
  tr.push(10, '一句字幕');
  tr.push(14, ''); // 中间有 4 秒没字
  const cs = tr.cues();
  ok('空帧超过 2.2 秒会收掉 cue', cs.length === 1, cs);
  ok('收掉的 cue 终点停在最后一次有字', cs[0] && cs[0].to === 10, cs[0]);
}
{
  const tr = H.createTracker();
  tr.push(10, '好');
  tr.push(10.6, ''); // 单个字、一闪而过
  tr.flush(10.7);
  ok('单字一闪而过丢掉', tr.cues().length === 0, tr.cues());
}
{
  const tr = H.createTracker();
  // 台标：短文本持续 30 秒
  for (let t = 0; t <= 30; t += 3) tr.push(t, '某某频道');
  tr.flush(31);
  ok('短文本长时间不变 → 当台标丢掉', tr.cues().length === 0, tr.cues());
  ok('台标被计入 overlay', tr.stats().overlay >= 1, tr.stats());
  // 之后再出现同样的台标，直接忽略
  tr.push(40, '某某频道');
  tr.flush(41);
  ok('台标再次出现不再进 cue', tr.cues().length === 0, tr.cues());
}
{
  const tr = H.createTracker();
  tr.push(20, '第二十分钟的一句');
  tr.push(10, '往回拖看到的旧句子');
  const st = tr.stats();
  ok('往回拖不重复记', tr.pending() === null || tr.pending().from === 20, tr.pending());
  ok('往回拖计入 drops', st.drops.rewind === 1, st);
}
{
  const tr = H.createTracker();
  tr.push(5, '长句一\n长句二');
  tr.push(6, '长句一\n长句二\n长句三');
  tr.flush(6.5);
  const cs = tr.cues();
  ok('OCR 后来多认出一行 → 取更全的版本', cs.length === 1 && cs[0].text.indexOf('长句三') >= 0, cs);
}

console.log('cue → 句子');
{
  const cues = [
    { from: 0, to: 2, text: '大家好' },
    { from: 2, to: 4, text: '今天我们讲三角形' },
    { from: 4, to: 6, text: '核心题型是解的个数问题。' },
    { from: 20, to: 22, text: '先看第一种情况' },
  ];
  const sents = H.cuesToSentences(cues);
  ok('停顿 14 秒会断句', sents.length === 2, sents);
  ok('第一句把前三个 cue 拼起来', sents[0] && sents[0].content.indexOf('大家好') === 0 && sents[0].content.indexOf('核心题型') > 0, sents[0]);
  ok('句子时间取首尾', sents[0] && sents[0].from === 0 && sents[0].to === 6, sents[0]);
  ok('sid 从 0 递增', sents[1] && sents[1].sid === 1, sents[1]);
}
{
  const cues = [{ from: 0, to: 1, text: '嗯' }, { from: 1, to: 2, text: '好' }];
  ok('只有两三个字的碎片不成句', H.cuesToSentences(cues).length === 0);
}
{
  const cues = [{ from: 0, to: 2, text: 'hello' }, { from: 2, to: 3, text: 'world 用法' }];
  const sents = H.cuesToSentences(cues);
  ok('英文单词之间留空格', /hello world/.test(sents[0].content), sents[0]);
}
{
  const cues = [{ from: 0, to: 30, text: '这是一句特别特别长的字幕它应该被自动切开因为已经超过了三十六个字的上限而且后面还有更多内容继续往下说才能触发自动断句的逻辑' }];
  const sents = H.cuesToSentences(cues);
  ok('超长 cue 会被切成多句', sents.length >= 2, sents.map((s) => s.content.length));
  ok('切开后时间按字数分给各句', sents.every((s) => s.to >= s.from) && sents[sents.length - 1].to === 30, sents.map((s) => [s.from, s.to]));
}

console.log('识别质量评估');
ok('空结果 → too-little', H.assess([]).reason === 'too-little');
ok('只有两句 → too-little', H.assess([{ from: 0, to: 1, content: '一句完整的话' }, { from: 1, to: 2, content: '另一句完整的话' }]).reason === 'too-little');
const goodS = [];
for (let i = 0; i < 8; i++) goodS.push({ from: i * 5, to: i * 5 + 4, content: '这是一句比较正常的字幕内容用来测试评估' });
ok('八句正常字幕 → ok', H.assess(goodS).ok === true, H.assess(goodS));
ok('评估返回字数与时长', H.assess(goodS).stats.chars >= 80 && H.assess(goodS).stats.dur > 0, H.assess(goodS).stats);

console.log('接上切块管线');
{
  const cues = [];
  let t = 0;
  const lines = ['大家好', '今天讲解三角形', '先看三角形解的个数问题', '已知两边一角',
    '讨论解的个数', '第一种情况 a 小于 bsinA', '这时候没有解', '第二种情况 a 等于 bsinA',
    '恰好一个解', '第三种情况 bsinA 小于 a', '有两个解', '最后一种情况 a 大于等于 b',
    '再来看测量问题', '已知边长与角度', '用正弦定理和余弦定理', '先算第三边', '再算另一个角',
    '注意钝角的情况', '最后检查三角形是否存在', '不满足两边之和大于第三边就没有解',
    '多三角形问题要先拆成两个三角形', '分别求解再合并', '最值与范围问题用函数求导',
    '最后总结这五类题型'];
  for (const l of lines) {
    cues.push({ from: t, to: t + 3, text: l });
    t += 4;
  }
  const sents = H.cuesToSentences(cues);
  const blocks = S.chunkSentences(sents);
  ok('能切出块', blocks.length >= 2, blocks.length);
  ok('每块都有文字', blocks.every((b) => String(b.text).length > 0));
  ok('块时间单调', blocks.every((b, i) => i === 0 || b.start >= blocks[i - 1].start), blocks.map((b) => b.start));
}

console.log('端到端模拟：一帧帧喂 OCR 结果');
{
  const tr = H.createTracker();
  const subs = [
    { from: 0, to: 4, text: '大家好，这一节我们讲变态心理学的工作重点' },
    { from: 5, to: 9, text: '首先是描述，异常的表现和正常现象的区别' },
    { from: 10, to: 14, text: '第二是病程，也就是这个症状持续了多久' },
    { from: 15, to: 19, text: '第三是严重程度，是否影响了正常生活' },
    { from: 20, to: 24, text: '最后是预后，也就是将来会往哪个方向发展' },
    { from: 25, to: 29, text: '这四条合起来就是判断异常的标准' },
  ];
  for (let t = 0; t <= 30; t += 1.2) {
    const hit = subs.find((s) => t >= s.from && t <= s.to);
    tr.push(t, hit ? hit.text : '');
  }
  tr.flush(30);
  const sents = H.cuesToSentences(tr.cues());
  const a = H.assess(sents);
  ok('模拟 30 秒至少得到 3 句（每句上限 36 字，会合并短 cue）', sents.length >= 3, sents.map((s) => s.content));
  ok('模拟结果通过评估', a.ok === true, a);
  ok('句子时间不重叠', sents.every((s, i) => i === 0 || s.from >= sents[i - 1].to - 0.01), sents.map((s) => [s.from, s.to]));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);