// 学习页的纯函数：挑课程、算进度、算掌握度、数笔记、按词过滤概念。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function load(file) {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ctx = createContext({ console });
  ctx.globalThis = ctx;
  runInContext(src, ctx);
  return ctx;
}
const P = load('studypage.js').BnStudyPage;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

const course = {
  id: 'season:9', kind: 'season', title: '【从零开始的 AI 学习】', ep_count: 3, total: 900,
  updated_at: '2026-11-16T10:00:00.000Z',
  episodes: [
    { index: 1, bvid: 'BV1', cid: 'c1', page: 1, title: 'S1-0 引言', duration: 200 },
    { index: 2, bvid: 'BV2', cid: 'c2', page: 1, title: 'S2-0 自动写代码', duration: 300 },
    { index: 3, bvid: 'BV3', cid: 'c3', page: 1, title: 'S2-1 别再手动点测试', duration: 400 },
  ],
};
const other = { id: 'video:BV9', kind: 'single', title: '单集', ep_count: 1, total: 60,
  updated_at: '2026-11-15T10:00:00.000Z', episodes: [{ index: 1, bvid: 'BV9', cid: 'c9', page: 1, title: '单集', duration: 60 }] };

const all = {
  'bnc:season:9': course,
  'bnc:video:BV9': other,
  // 概念缓存也用 bnc: 前缀，必须被 courses() 排除
  'bnc:c1': { v: '3:1:3', concepts: [{ name: 'x' }], savedAt: 1 },
  'bnp:c1': 190,        // 200 秒的 95% ⇒ 算看过
  'bnp:c2': 120,        // 300 秒的 40% ⇒ 没看过
  'bnp:c3': 0,
  'bnstudy:season:9': { spec: 'bn-study-state/1', course_id: 'season:9', updated_at: '2026-11-16T11:00:00.000Z',
    concepts: [{ name: 'a', status: 'understood' }, { name: 'b', status: 'shaky' }, { name: 'c', status: 'unknown' }, { name: 'd', status: 'shaky' }] },
  // 掌握度也可能以 { key, state } 包装出现（BnStudyState.fromStorage 的返回形状）
  'bnstudy:video:BV9': { key: 'bnstudy:video:BV9', state: { course_id: 'video:BV9', concepts: [{ name: 'z', status: 'unknown' }] } },
  'bnidx:BV1:c1': { bvid: 'BV1', cid: 'c1', count: 4 },
  'bnidx:BV2:c2': { bvid: 'BV2', cid: 'c2', count: 7 },
  'bnidx:BV3:c3': { bvid: 'BV3', cid: 'c3', notes: [{}, {}, {}] },
};

ok('courses 只认课程形状（排除概念缓存）', P.courses(all).length === 2);
ok('courses 按 updated_at 倒序', P.courses(all)[0].id === 'season:9');
ok('pick 按 id 取', P.pick(P.courses(all), 'video:BV9').id === 'video:BV9');
ok('pick 找不到给第一个', P.pick(P.courses(all), 'nope').id === 'season:9');
ok('pick 空列表给 null', P.pick([], 'x') === null);
ok('cidsOf', JSON.stringify(P.cidsOf(course)) === JSON.stringify(['c1', 'c2', 'c3']));
ok('cidsOf 空课程', P.cidsOf(null).length === 0);
ok('进度表只收 bnp:', Object.keys(P.progressMap(all)).length === 3 && P.progressMap(all).c1 === 190);
ok('看过阈值 90%', P.watched(course.episodes[0], { c1: 190 }) === true);
ok('没到 90% 不算看过', P.watched(course.episodes[1], { c2: 120 }) === false);
ok('没时长时 60 秒算看过', P.watched({ cid: 'x', duration: 0 }, { x: 61 }) === true);
const m = P.masteryOf(all, 'season:9');
ok('掌握度计数', m.understood === 1 && m.shaky === 2 && m.unknown === 1 && m.total === 4, m);
ok('掌握度行文案', P.line(m) === '懂 1 · 半懂 2 · 没考 1', P.line(m));
ok('没考过时的文案', P.line({ total: 0 }) === '还没考过');
ok('包装形状也认', P.masteryOf(all, 'video:BV9').total === 1);
const nm = P.notesMap(all);
ok('笔记数按 count', nm.c1 === 4 && nm.c2 === 7);
ok('笔记数退回 notes 数组长度', nm.c3 === 3);
const ov = P.overview(all, course);
ok('overview 集数', ov.count === 3);
ok('overview 看过集数', ov.watched === 1, ov.watched);
ok('overview 笔记合计', ov.notes === 14, ov.notes);
ok('overview 百分比按已看时长', ov.pct === Math.round((200 / 900) * 100), ov.pct);
ok('overview 下一集是没看的第一集', ov.next && ov.next.cid === 'c2');
ok('overview 带掌握度行', ov.masteryLine === '懂 1 · 半懂 2 · 没考 1');
const groups = [
  { ep: 1, label: 'S1-0', title: '引言', items: [{ name: 'agent', def: '能替你写代码的东西', anchors: [{ quote: '直接让 agent 写几十行' }] }] },
  { ep: 2, label: 'S2-0', title: '自动写代码', items: [{ name: 'Git', def: '版本管理', anchors: [{ quote: '用 git 存档' }] }] },
];
ok('空查询原样返回', P.filterGroups(groups, '').length === 2);
ok('按名字命中', P.filterGroups(groups, 'agent').length === 1);
ok('按定义命中', P.filterGroups(groups, '版本管理')[0].items[0].name === 'Git');
ok('按原话命中', P.filterGroups(groups, '存档')[0].items[0].name === 'Git');
ok('大小写不敏感', P.filterGroups(groups, 'GIT').length === 1);
ok('多词全部命中才留', P.filterGroups(groups, 'git 存档').length === 1);
ok('多词有一项不中就空', P.filterGroups(groups, 'git agent').length === 0);
ok('被过滤空的分组不返回', P.filterGroups(groups, 'agent').every(g => g.items.length > 0));
ok('对 null 安全', P.filterGroups(null, 'x').length === 0);

// —— 一个概念在整门课里的所有出现处（学习页「出现在 N 集 · M 处」） ——
const conceptA = { name: 'harness', anchors: [
  { ep: 2, t: 300, epLabel: 'S2-1', epTitle: 'S2-1 别再手动点', quote: '第二集的引文', url: 'https://www.bilibili.com/video/BV2' },
  { ep: 1, t: 128, epLabel: 'S1-0', quote: '最早的引文', url: 'https://www.bilibili.com/video/BV1' },
  { ep: 1, t: 130, quote: '差 2 秒，算同一处的重复' },
  { ep: 1, t: 200, quote: '差 70 秒，是另一处' },
  { ep: 2, t: 'x', quote: '没有时间，丢掉' },
  { ep: 0, t: 10, quote: '没有集号，丢掉' },
  null,
] };
const occA = P.occurrences(conceptA);
ok('出现处按集再按时间排', occA.map(x => x.ep + '@' + x.t).join(',') === '1@128,1@200,2@300', occA);
ok('同集 3 秒内合并成一处', occA.length === 3);
ok('合并时保留先到的那条引文', occA[0].quote === '最早的引文');
ok('缺 t / 缺集号的锚点被丢掉', occA.every(x => typeof x.t === 'number' && x.ep > 0));
ok('集标签沿用锚点上的 epLabel', occA[2].label === 'S2-1');
const occNoLabel = P.occurrences({ anchors: [{ ep: 7, t: 5 }] });
ok('没有标签时兜底「第 N 集」', occNoLabel[0].label === '第 7 集');
const sumA = P.occSummary(conceptA);
ok('统计处数', sumA.count === 3);
ok('统计跨几集', sumA.eps === 2);
const soloSum = P.occSummary({ anchors: [{ ep: 1, t: 5 }] });
ok('只有一处的概念不显示「出现在」', soloSum.count === 1 && soloSum.eps === 1);
ok('没有锚点时是 0 处', P.occSummary({}).count === 0);
ok('对 null 安全', P.occurrences(null).length === 0 && P.occSummary(null).count === 0);

// —— 内嵌播放器地址（参数拼错在真机上只表现为「画面不动」） ——
const src1 = P.playerSrc({ bvid: 'BV1TDGT6vEqC', cid: '42722657079', page: 1 }, 72);
ok('默认带 autoplay/danmaku/high_quality', src1.indexOf('autoplay=1') > 0 && src1.indexOf('danmaku=0') > 0 && src1.indexOf('high_quality=1') > 0);
ok('bvid 与 cid 都带上', src1.indexOf('bvid=BV1TDGT6vEqC') > 0 && src1.indexOf('cid=42722657079') > 0);
ok('t 取整', src1.indexOf('t=72') > 0);
ok('page=1 不写', src1.indexOf('page=') < 0);
ok('t<1 不写', P.playerSrc({ bvid: 'BV1' }, 0).indexOf('t=') < 0);
ok('多 P 才写 page', P.playerSrc({ bvid: 'BV1', page: 3 }, 5).indexOf('page=3') > 0);
ok('没有 bvid 就没有地址', P.playerSrc({ cid: '1' }, 5) === '');
ok('null 安全', P.playerSrc(null, 5) === '');
ok('域名固定 player.bilibili.com', src1.indexOf('https://player.bilibili.com/player.html?') === 0);

// —— 中栏视角：只看没看过的集 / 只看跨集概念 ——
const gA = { ep: 1, label: 'S1-0', items: [{ concept: 'a', cross: true }, { concept: 'b' }] };
const gB = { ep: 2, label: 'S1-1', items: [{ concept: 'c' }] };
const gC = { ep: 3, label: 'S1-2', items: [{ concept: 'd', cross: true }] };
const all3 = [gA, gB, gC];
ok('all 原样返回', P.filterByView(all3, 'all', [1]).length === 3);
ok('unwatched 去掉看过的集', P.filterByView(all3, 'unwatched', [1]).map(function (g) { return g.ep; }).join(',') === '2,3');
ok('unwatched 全看过就是空', P.filterByView(all3, 'unwatched', [1, 2, 3]).length === 0);
ok('watchedEps 传字符串也能比', P.filterByView(all3, 'unwatched', ['1']).length === 2);
const crossOnly = P.filterByView(all3, 'cross', []);
ok('cross 只留跨集概念', crossOnly.length === 2 && crossOnly[0].items.length === 1 && crossOnly[1].items[0].concept === 'd');
ok('cross 把只看过一集的概念整组丢掉', crossOnly.some(function (g) { return g.ep === 2; }) === false);
ok('cross 不改原数组', all3[0].items.length === 2);
ok('空输入安全', P.filterByView(null, 'cross', null).length === 0 && P.filterByView([], 'unwatched', null).length === 0);
ok('未知视角当 all', P.filterByView(all3, 'x', [1]).length === 3);

// —— 今天先看哪几个（半懂优先、跨集加权、suspect 降权）——
function card(name, extra) {
  const c = { name: name, anchors: [{ ep: 1, t: 10, epLabel: 'S1-0' }], eps: [1], cross: false, suspect: false, status: '' };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
const rq = P.reviewQueue([
  card('懂了的概念', { status: 'understood' }),
  card('半懂的概念', { status: 'shaky' }),
  card('没考过普通', { status: '' }),
  card('没考过跨集', { status: '', cross: true, eps: [1, 4] }),
  card('没考过但可疑', { status: '', suspect: true }),
], { limit: 9 });
ok('半懂排第一', rq[0].name === '半懂的概念');
ok('跨集的没考过排在普通没考过前面', rq.findIndex(function (x) { return x.name === '没考过跨集'; }) < rq.findIndex(function (x) { return x.name === '没考过普通'; }));
ok('可疑的排在同分的普通没考过后面', rq.findIndex(function (x) { return x.name === '没考过但可疑'; }) > rq.findIndex(function (x) { return x.name === '没考过普通'; }));
ok('懂了排最后', rq[rq.length - 1].name === '懂了的概念');
ok('理由写清楚', rq[0].reason.indexOf('半懂') === 0 && rq.find(function (x) { return x.name === '没考过跨集'; }).reason.indexOf('跨 2 集') > 0);
ok('limit 生效', P.reviewQueue([card('a'), card('b'), card('c')], { limit: 2 }).length === 2);
ok('默认 6 个', P.reviewQueue(new Array(20).fill(0).map(function (_, i) { return card('c' + i); })).length === 6);
ok('没有锚点的概念不进来', P.reviewQueue([{ name: 'x', anchors: [] }]).length === 0);
ok('名字空的不进来', P.reviewQueue([{ name: ' ', anchors: [{ ep: 1, t: 5 }] }]).length === 0);
ok('空输入安全', P.reviewQueue(null).length === 0 && P.reviewQueue([]).length === 0);
const rqOne = P.reviewQueue([card('带标签', { anchors: [{ ep: 3, t: 75, epLabel: 'S2-1' }] })]);
ok('带出集标签与秒数', rqOne[0].ep === 3 && rqOne[0].t === 75 && rqOne[0].epLabel === 'S2-1');
const rqNoLabel = P.reviewQueue([card('无标签', { anchors: [{ ep: 7, t: 5 }] })]);
ok('缺集标签兜底「第 N 集」', rqNoLabel[0].epLabel === '第 7 集');

console.log('studypage: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
