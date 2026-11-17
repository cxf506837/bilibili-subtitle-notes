// 学习包：JSON 结构 + Markdown 版面 + 文件名。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const src = readFileSync(new URL('../src/study.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(src, ctx);
const S = ctx.BnStudy;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

const input = {
  course: { id: 'season:8719249', title: '【从零开始的 AI 学习】', kind: 'season', url: 'https://www.bilibili.com/video/BV1BgH36DE7y', episodesTotal: 24, durationSec: 10655 },
  scope: 'S2',
  goal: '三周内能独立用 DSH 跑通一个自动化任务',
  generatedAt: '2026-11-16T04:30:00.000Z',
  episodes: [
    {
      index: 15, title: 'S2-0 什么是 Agent', bvid: 'BV1aa', cid: 'c1', url: 'https://www.bilibili.com/video/BV1aa',
      duration: 300, verdict: 'stable', votes: 3, track: 'ai-zh',
      notes: [{ start: 442, one: '测试是 AI 改代码的底气', summary: '总结' }, { start: 65, one: '先写会失败的测试', summary: '' }],
      concepts: ['skills', '判据'],
    }, {
      index: 16, title: 'S2-1 有电脑才能学 AI 吗', bvid: 'BV1bb', cid: 'c2', url: 'https://www.bilibili.com/video/BV1bb',
      duration: 200, verdict: 'single', votes: 1, track: 'ai-zh', notes: [],
    },
  ],
  concepts: [
    {
      name: 'skills', kind: '工具', def: '可复用的流程包', aliases: ['技能'],
      anchors: [
        { ep: 15, epLabel: 'S2-0', epTitle: '什么是 Agent', t: 442, quote: '技能就是提前写好的流程', url: 'https://www.bilibili.com/video/BV1aa' },
        { ep: 16, epLabel: 'S2-1', epTitle: '有电脑才能学 AI 吗', t: 5, quote: '第二集的引文', url: 'https://www.bilibili.com/video/BV1bb' },
      ],
    },
    { name: '判据', kind: '概念', def: '凭什么说它对了', aliases: [], anchors: [{ ep: 15, t: 120, quote: '判据要能跑', url: 'https://www.bilibili.com/video/BV1aa' }] },
  ],
  failed: [{ index: 17, title: 'S2-2 装环境', verdict: 'no-subs', reason: '这一 P 没有中文 AI 字幕' }],
};

const pack = S.build(input);
ok('spec 版本号固定', pack.spec === 'bn-study-pack/1', pack.spec);
ok('JSON 能解析', (() => { try { return !!JSON.parse(pack.json); } catch (e) { return false; } })());
const doc = JSON.parse(pack.json);
ok('计数：集数', doc.counts.episodes === 2, doc.counts);
ok('计数：笔记条数', doc.counts.notes === 2, doc.counts.notes);
ok('计数：概念数', doc.counts.concepts === 2, doc.counts.concepts);
ok('计数：锚点数', doc.counts.anchors === 3, doc.counts.anchors);
ok('学习目标进 JSON', doc.goal.indexOf('三周') >= 0);
ok('课程元信息进 JSON', doc.course.id === 'season:8719249' && doc.course.episodes_total === 24, doc.course);
ok('集笔记按时间排序', doc.episodes[0].notes[0].t === 65 && doc.episodes[0].notes[1].t === 442, doc.episodes[0].notes);
ok('集上有概念名', doc.episodes[0].concepts.join(',') === 'skills,判据', doc.episodes[0].concepts);
ok('时间锚点带可点链接', doc.concepts[0].anchors[0].url === 'https://www.bilibili.com/video/BV1aa?t=442', doc.concepts[0].anchors[0].url);
ok('时间锚点有人话时间', doc.concepts[0].anchors[0].at === '7:22', doc.concepts[0].anchors[0].at);
ok('没填 url 时不拼出裸 t=', S.jump('', 12) === '');
ok('已有问号用 &', S.jump('https://a/b?p=2', 10) === 'https://a/b?p=2&t=10');
ok('0 秒不拼参数', S.jump('https://a/b', 0) === 'https://a/b');

// Markdown 版面
const md = pack.md;
ok('md frontmatter 带 spec', md.indexOf('spec: bn-study-pack/1') >= 0);
ok('md frontmatter 带 scope', md.indexOf('scope: S2') >= 0);
ok('md frontmatter 带计数', md.indexOf('episodes: 2') >= 0 && md.indexOf('concepts: 2') >= 0 && md.indexOf('notes: 2') >= 0);
ok('md frontmatter 带 tags', md.indexOf('tags: [bilibili, 视频笔记, 学习包]') >= 0);
ok('md 有学习目标一节', md.indexOf('## 学习目标') >= 0 && md.indexOf('三周内') >= 0);
ok('md 概念索引带定义', md.indexOf('### 1. skills（也叫 技能）') >= 0 && md.indexOf('可复用的流程包') >= 0);
ok('md 概念锚点带集号与链接', md.indexOf('S2-0 · [7:22](https://www.bilibili.com/video/BV1aa?t=442)') >= 0, md.split('\n').filter((l) => l.indexOf('S2-0 ·') >= 0)[0]);
ok('md 概念锚点带逐字引文', md.indexOf('「技能就是提前写好的流程」') >= 0);
ok('md 分集标题带集号', md.indexOf('### 第 15 集 · S2-0 什么是 Agent') >= 0);
ok('md 分集字幕标注取样稳定度', md.indexOf('两次取样一致') >= 0 && md.indexOf('单次取样（未复核）') >= 0);
ok('md 笔记带时间戳', md.indexOf('  - 7:22 测试是 AI 改代码的底气') >= 0);
ok('md 空笔记给的是人话', md.indexOf('这一集还没整理（只验证了字幕）') >= 0);
ok('md 有没导出的集与原因', md.indexOf('## 没导出的集（1）') >= 0 && md.indexOf('这一 P 没有中文 AI 字幕') >= 0);
ok('文件名带固定前缀/课程名/范围/集数', pack.baseName === 'bn-study-【从零开始的 AI 学习】（S2 · 2 集学习包）', pack.baseName);
ok('前缀是为了让 agent 按「最新 + 前缀」找', pack.baseName.indexOf('bn-study-') === 0, pack.baseName);

// 边界
const bare = S.build({});
ok('空输入不崩', bare.spec === 'bn-study-pack/1' && bare.doc.counts.episodes === 0);
ok('没有概念时说清为什么', bare.md.indexOf('这次没抽概念') >= 0);
ok('没学习目标就不出这一节', bare.md.indexOf('## 学习目标') < 0);
ok('文件名清洗非法字符', S.safeName('a/b:c*?"<>|d', 'x') === 'a b c d', S.safeName('a/b:c*?"<>|d', 'x'));
ok('空名字用兜底', S.safeName('', 'bilibili-course') === 'bilibili-course');
ok('没有集号标题退回第 N 集', S.epLabel({ index: 9, title: '随便' }) === '第 9 集');

console.log('\nstudy: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
