// 画面文字通道：prompt 拼接 + 校验放宽（数字可以来自画面，但 quote 仍然只能来自字幕）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'src/summarize.js'), 'utf8');
const ctx = { window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const S = ctx.window.BnSum || ctx.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const sentences = [
  { sid: 1, from: 0, to: 4.9, content: '在三角形ABC中，已知a，b，A，讨论三角形解的个数。' },
  { sid: 2, from: 5, to: 9.9, content: '这时候要看a和bsinA的大小关系。' },
];
const block = S.toPromptLines({ id: 1, start: 0, end: 9.9, sids: [1, 2], text: sentences.map(s => s.content).join('') }, sentences);
const visual = [{ t: 125, text: 'a < bsinA 0个\na = bsinA 1个\nbsinA < a 2个\n练习 30 道' }];

// 1) prompt 里带画面文字，且标明不得写进 quote
const msgs = S.promptFor(block, '', visual);
const sys = msgs[0].content;
const user = msgs[1].content;
ok('prompt 提到画面文字是 OCR', /OCR/.test(sys));
ok('prompt 禁止把画面文字写进 quote', /quote 必须来自字幕原句/.test(sys));
ok('user 里有 [画面 2:05] 前缀', user.includes('[画面 2:05]'), user.slice(-200));
ok('没有画面文字时不出现该段', !S.promptFor(block, '', null)[1].content.includes('画面文字'));

// 2) 数字只在画面里：允许（PPT 上的「0个/1个/2个」）
const raw = JSON.stringify({
  block_summary: '按 a 与 bsinA 的大小分情况',
  points: [{ sentence_ids: [2], plain: '这一节配了 30 道练习', kind: 'conclusion' }],
  one_thing: '看 a 和 bsinA',
});
const noVis = S.validate(raw, block, sentences, null);
ok('不给画面文字时，只出现在画面里的数字会被丢弃', noVis.points.length === 0, JSON.stringify(noVis.points));
const withVis = S.validate(raw, block, sentences, visual);
ok('给了画面文字后，同一条保留', withVis.points.length === 1, JSON.stringify(withVis.points));
ok('quote 仍然是字幕原句', withVis.points[0] && withVis.points[0].quote.includes('bsinA'), withVis.points[0] && withVis.points[0].quote);

// 3) 编造的 quote 仍然被丢弃（画面文字不能给 quote 背书）
const bad = JSON.stringify({
  block_summary: 'x',
  points: [{ sentence_ids: [1], quote: '三角形的面积等于底乘高的一半', plain: '面积公式', kind: 'definition' }],
});
const badRes = S.validate(bad, block, sentences, visual);
ok('画面文字不能为编造的 quote 背书', badRes.points.length === 0, JSON.stringify(badRes.points));

// 4) 时间戳仍由 sentence_ids 推导
ok('时间戳按 sids 推导（0~9.9）', withVis.points[0] && withVis.points[0].start === 5 && withVis.points[0].end === 9.9, JSON.stringify(withVis.points[0]));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
