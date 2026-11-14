import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const sumSrc = readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8');
const ctx = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
ctx.globalThis = ctx;
runInContext(sumSrc, ctx);
const S = ctx.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

console.log('小节标题 prompt');
const items = [
  { oneThing: 'git 就是一个能回档的存档点', summary: '讲者用游戏存档类比 git' },
  { oneThing: '改坏了一键回到上一个存档' },
  { oneThing: '每个节点都要写清楚改了什么' },
];
const pr = S.sectionPrompt(items, '0:00', '8:30');
ok('返回 system+user 两条', pr.length === 2 && pr[0].role === 'system' && pr[1].role === 'user');
const sys = pr[0].content;
ok('system 要求只输出 JSON', sys.includes('只输出 JSON'));
ok('system 限制标题 12 字', sys.includes('12 个字'));
ok('system 禁评价词', sys.includes('不许写评价性的话'));
ok('system 禁止空话标题', sys.includes('本节讲'));
const user = pr[1].content;
ok('user 带时间范围', user.includes('0:00') && user.includes('8:30'));
ok('user 带每段一句话', user.includes('git 就是一个能回档的存档点') && user.includes('每个节点都要写清楚改了什么'));
ok('user 给了输出结构', user.includes('"title"') && user.includes('"one_line"'));
const empty = S.sectionPrompt([{ oneThing: '' }, {}], '0:00', '1:00');
ok('没有可用一句话也不炸', empty.length === 2 && typeof empty[1].content === 'string');

console.log('小节标题校验');
ok('正常标题保留', (function () { const v = S.validateSection('{"title":"存档与回档","one_line":"改坏能回去"}'); return v && v.title === '存档与回档' && v.oneLine === '改坏能回去'; })());
ok('剥掉尾部句号', (function () { const v = S.validateSection('{"title":"存档与回档。","one_line":"x"}'); return v && v.title === '存档与回档'; })());
ok('超长（>28 字）丢弃', S.validateSection('{"title":"这是一个明显超过二十八个字长度的垃圾标题内容真的太长了实在不行","one_line":"x"}') === null);
ok('18~28 字截到 18 字', (function () { const v = S.validateSection('{"title":"Git 的本质就是一个能给代码回档的存档点","one_line":"x"}'); return v && v.title.length === 18; })());
ok('「本节讲」前缀被剥掉', (function () { const v = S.validateSection('{"title":"本节讲：存档与回档","one_line":"x"}'); return v && v.title === '存档与回档'; })());
ok('「第一部分」前缀被剥掉', (function () { const v = S.validateSection('{"title":"第一部分 存档","one_line":"x"}'); return v && v.title === '存档'; })());
ok('空标题丢弃', S.validateSection('{"title":"","one_line":"x"}') === null);
ok('只剩空话前缀时丢弃', S.validateSection('{"title":"本节讲：","one_line":"x"}') === null);
ok('带评价词丢弃', S.validateSection('{"title":"非常重要的核心结论","one_line":"x"}') === null);
ok('坏 JSON 丢弃', S.validateSection('不是 json') === null);
ok('代码块包裹也能取', (function () { const v = S.validateSection('好的：\n\u0060\u0060\u0060json\n{"title":"存档点","one_line":"回档"}\n\u0060\u0060\u0060'); return v && v.title === '存档点'; })());

console.log('讲解层 prompt 的口语化规则');
const block = { sids: [0, 1], start: 0, end: 5, text: '这个 git 啊它其实就是存档点，改坏了就回去',
  lines: [{ sid: 0, from: 0, content: '这个 git 啊它其实就是存档点' }, { sid: 1, from: 2.5, content: '改坏了就回去' }] };
const p2 = S.promptFor(block, '', null, {});
const s2 = p2[0].content;
ok('要求用「解决什么问题」开头', s2.includes('解决什么问题'));
ok('给了反例正例', s2.includes('反例') && s2.includes('正例'));
ok('反例明确标为「不要这样写」', s2.includes('不要这样写'));
ok('仍要求术语不确定就直说', s2.includes('不确定指什么'));
ok('plain 长度限制还在', s2.includes('单句不超过 25 字'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
