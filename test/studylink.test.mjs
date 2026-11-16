// 学习页链接：课程 id + 视角 → 扩展页 URL（面板徽标 / 「学习页」按钮都走这里）。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function load(file) {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ctx = createContext({ console });
  ctx.globalThis = ctx;
  runInContext(src, ctx);
  return ctx;
}
const L = load('studylink.js').BnStudyLink;
const BASE = 'chrome-extension://mdpphognlfhkeenfmpfopbbgmpdhafpfp/src/study.html';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 只有课程
ok('只有课程', L.studyUrl(BASE, 'season:8719249', '') === BASE + '?course=season%3A8719249', L.studyUrl(BASE, 'season:8719249', ''));
// 课程 + 跨集视角
ok('课程 + 跨集', L.studyUrl(BASE, 'season:8719249', 'cross') === BASE + '?course=season%3A8719249&view=cross', L.studyUrl(BASE, 'season:8719249', 'cross'));
// 课程 + 没看过
ok('课程 + 没看过', L.studyUrl(BASE, 'season:8719249', 'unwatched') === BASE + '?course=season%3A8719249&view=unwatched', L.studyUrl(BASE, 'season:8719249', 'unwatched'));
// 只有视角（弹窗里没有当前课程时也要能开）
ok('只有视角', L.studyUrl(BASE, '', 'cross') === BASE + '?view=cross', L.studyUrl(BASE, '', 'cross'));
// 什么都不给：不带问号
ok('空课程空视角', L.studyUrl(BASE, '', '') === BASE, L.studyUrl(BASE, '', ''));
ok('null 课程 / null 视角', L.studyUrl(BASE, null, null) === BASE, L.studyUrl(BASE, null, null));
ok('undefined 课程', L.studyUrl(BASE, undefined, undefined) === BASE, L.studyUrl(BASE, undefined, undefined));
// 视角大小写 / 路径串 / 未知值一律不认（避免把任何字符串塞进 query）
ok('大写 Cross 不认', L.studyUrl(BASE, 'season:1', 'Cross') === BASE + '?course=season%3A1', L.studyUrl(BASE, 'season:1', 'Cross'));
ok('all 不认', L.studyUrl(BASE, 'season:1', 'all') === BASE + '?course=season%3A1', L.studyUrl(BASE, 'season:1', 'all'));
ok('路径串不认', L.studyUrl(BASE, 'season:1', 'view=cross&x=1') === BASE + '?course=season%3A1', L.studyUrl(BASE, 'season:1', 'view=cross&x=1'));
ok('带空格不认', L.studyUrl(BASE, 'season:1', ' cross') === BASE + '?course=season%3A1', L.studyUrl(BASE, 'season:1', ' cross'));
// 课程 id 必须编码（season: 里的冒号、多 P 里的 # 都见过）
ok('课程 id 编码', L.studyUrl(BASE, 'p:123#frag', '') === BASE + '?course=p%3A123%23frag', L.studyUrl(BASE, 'p:123#frag', ''));
// 数字课程 id 也能用
ok('数字课程 id', L.studyUrl(BASE, 8719249, '') === BASE + '?course=8719249', L.studyUrl(BASE, 8719249, ''));
// VIEWS 只暴露两种，学习页 parseView 与它保持一致（studypage.test.mjs 单独测）
ok('VIEWS 只有两种', L.VIEWS.length === 2 && L.VIEWS.indexOf('cross') >= 0 && L.VIEWS.indexOf('unwatched') >= 0, L.VIEWS);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
