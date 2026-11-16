// 概念视图：把按集缓存的概念卡拼成「这门课的概念」——合并、去噪标记、按集分组、掌握度。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const src = readFileSync(new URL('../src/conceptview.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(src, ctx);
const V = ctx.BnConceptView;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

function con(name, ep, t, extra) {
  return Object.assign({
    name: name, kind: '概念', def: '', aliases: [],
    anchors: [{ ep: ep, epLabel: 'S2-' + ep, epTitle: '第 ' + ep + ' 集标题', t: t, quote: '原话 ' + name, url: 'https://www.bilibili.com/video/BV1x?p=' + ep }],
  }, extra || {});
}

// 1. collect 只取这门课（这些 cid）的
const all = {
  'bnc:111': { v: 'a', concepts: [con('甲', 1, 10), con('乙', 1, 20)] },
  'bnc:222': { v: 'b', concepts: [con('甲', 2, 5)] },
  'bnc:333': { v: 'c', concepts: [con('别人的', 3, 5)] },
  'bnidx:BV1x:111': { count: 1 },
  'bnc:444': { v: 'd' },
  'bnc:555': { v: 'e', concepts: [{ name: '' }, con('  ', 1, 1)] },
  'bntok:2026-11-16': 3274,
};
const got = V.collect(all, ['111', '222', '444', '555']);
ok('collect：只取 bnc: 且 cid 在这门课里', got.length === 3, got.length);
ok('collect：不吃别的课的 cid', got.every(function (c) { return c.name !== '别人的'; }));
ok('collect：跳过没有 concepts 数组的项', got.every(function (c) { return c.name; }));
ok('collect：空 cid 列表返回空', V.collect(all, []).length === 0);
ok('collect：无名概念被过滤', V.collect(all, ['555']).length === 0);

// 2. 跨集合并
const g = V.group(V.collect(all, ['111', '222']), {
  titles: ['第 1 集标题', '第 2 集标题'],
});
const jia = g.list.filter(function (x) { return x.name === '甲'; })[0];
ok('合并：同名概念只剩一条', g.list.filter(function (x) { return x.name === '甲'; }).length === 1);
ok('合并：锚点跨两集', jia.eps.length === 2, jia.eps);
ok('合并：cross=true', jia.cross === true);
ok('合并：锚点按 (集, 秒) 排序', jia.anchors[0].ep === 1 && jia.anchors[1].ep === 2, jia.anchors);
ok('合并：first 是最早那一处', jia.first.ep === 1 && jia.first.t === 10, jia.first);
ok('合并：没有锚点的概念被丢掉', V.group([{ name: '空', anchors: [] }], {}).totals.concepts === 0);

// 3. 去噪标记（只标灰，不删）
const solo = V.group([con('宽体金线蛭', 8, 3)], { titles: ['感觉模型降智了怎么办？'] });
ok('去噪：单集且标题无重合 → suspect', solo.list[0].suspect === true);
const gitc = V.group([con('Git', 4, 3)], { titles: ['让 AI 可以回档的神器——Git'] });
ok('去噪：标题里有同一个词 → 不标灰', gitc.list[0].suspect === false);
ok('去噪：跨集出现 → 不标灰', jia.suspect === false);
const solo2 = V.group([con('prove-it', 6, 3, { def: '交互式规则校验' })], { titles: ['别再手动帮 AI 点测试了'] });
ok('去噪：单集且字面不重合也会标灰（提示而非删除）', solo2.list[0].suspect === true);
ok('去噪：概念仍然在列表里', solo2.list.length === 1);

// 4. 掌握度
const mast = V.group([con('甲', 1, 10), con('乙', 1, 20)], {
  titles: [],
  mastery: { '甲': 'understood' },
});
const byName = {};
mast.list.forEach(function (x) { byName[x.name] = x; });
ok('掌握度：按名字挂上状态', byName['甲'].status === 'understood');
ok('掌握度：没记录的是空串', byName['乙'].status === '');

// 5. 分组
const grp = V.group([con('乙', 2, 5), con('丙', 1, 9), con('甲', 1, 10)], { titles: [] });
ok('分组：组按集号升序', grp.groups[0].ep === 1 && grp.groups[1].ep === 2, grp.groups.map(function (x) { return x.ep; }));
ok('分组：第 1 集两条', grp.groups[0].items.length === 2);
ok('分组：组标签取锚点的集标签', grp.groups[0].label === 'S2-1', grp.groups[0].label);
ok('分组：组标题取锚点的集标题', grp.groups[0].title === '第 1 集标题', grp.groups[0].title);
ok('分组：totals 概念数', grp.totals.concepts === 3, grp.totals);
ok('分组：totals 锚点数', grp.totals.anchors === 3, grp.totals);
ok('分组：空输入不炸', V.group([], {}).groups.length === 0 && V.group(null, {}).totals.concepts === 0);

// 6. 时间与跳转
ok('fmtClock：0 秒', V.fmtClock(0) === '0:00', V.fmtClock(0));
ok('fmtClock：65 秒', V.fmtClock(65) === '1:05', V.fmtClock(65));
ok('fmtClock：1 小时 2 分 5 秒', V.fmtClock(3725) === '1:02:05', V.fmtClock(3725));
ok('withT：没有 ? 时用 ?t=', V.withT('https://www.bilibili.com/video/BV1x', 15) === 'https://www.bilibili.com/video/BV1x?t=15');
ok('withT：已有 ? 时用 &t=', V.withT('https://www.bilibili.com/video/BV1x?p=2', 15) === 'https://www.bilibili.com/video/BV1x?p=2&t=15');
ok('withT：0 秒不加参', V.withT('https://www.bilibili.com/video/BV1x', 0) === 'https://www.bilibili.com/video/BV1x');

// 7. 关键词
ok('tokensOf：英文转小写整词', !!V.tokensOf('用 Git 存档').git);
ok('tokensOf：纯虚词不产生 token', Object.keys(V.tokensOf('的了着过')).length === 0);
ok('hitTitle：标题里的英文词能命中', V.hitTitle('agents.md', '', ['顺便把规则写进 AGENTS.md']) === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
