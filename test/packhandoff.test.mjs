// 交给 agent 的那句话：文件名、「找不到就问我」、spec 校验、课程与目标，四件都要在。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function load(file) {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ctx = createContext({ console });
  ctx.globalThis = ctx;
  runInContext(src, ctx);
  return ctx;
}
const H = load('packhandoff.js').BnPackHandoff;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 1. 文件名：和 content.js 里 downloadMarkdown 用的两个名字必须一致
const n = H.names('【从零开始的 AI 学习】（S2 · 9 集学习包）');
ok('json 名带 .json 后缀', n.json.endsWith('.json'), n);
ok('md 名带 .md 后缀', n.md.endsWith('.md'), n);
ok('两个名字去掉后缀后相同', n.json.slice(0, -5) === n.md.slice(0, -3), n);
ok('空名字有兜底', H.names('').json === 'bilibili-course.json', H.names(''));

// 2. 那句话：四件关键信息缺一不可
const base = '【从零开始的 AI 学习】（S2 · 9 集学习包）';
const t = H.text({ baseName: base, course: '【从零开始的 AI 学习】', scope: 'S2', episodes: 9, goal: '三周内能独立用 agent 跑通一个自动化任务' });
ok('带上了 json 文件名', t.indexOf(base + '.json') >= 0, t);
ok('提到同目录还有 md（现在是同名 .md，不再逐个点名）', t.indexOf('同名 .md') >= 0, t);
ok('说了找不到就问用户', t.indexOf('问我路径') >= 0, t);
ok('说了默认在下载目录', t.indexOf('Downloads') >= 0, t);
ok('要求校验 spec', t.indexOf('bn-study-pack/1') >= 0, t);
ok('点了 bili-study 这个 skill', t.indexOf('bili-study') >= 0, t);
ok('带上了课程名', t.indexOf('【从零开始的 AI 学习】') >= 0, t);
ok('带上了范围与集数', t.indexOf('S2 · 9 集') >= 0, t);
ok('带上了目标原文', t.indexOf('三周内能独立用 agent 跑通一个自动化任务') >= 0, t);
ok('目标占一行（能整段粘）', t.split('\n').some(function (l) { return l.indexOf('目标：') === 0; }), t);

// 3. 没写目标时不能编一个目标，要反过来问
const t2 = H.text({ baseName: base, course: 'C' });
ok('没目标时让 agent 先问', t2.indexOf('还没写') >= 0 && t2.indexOf('问我') >= 0, t2);
ok('没集数时不写「0 集」', t2.indexOf('0 集') < 0, t2);
ok('没范围时不写空括号', t2.indexOf('（）') < 0 && t2.indexOf('（ · ') < 0, t2);
ok('还没写也照样能粘（有文件名）', t2.indexOf(base + '.json') >= 0, t2);

// 4. 记录与「只自动复制一次」
const rec = H.record({ baseName: base, course: 'C', scope: 'S2', episodes: 9, goal: 'g', text: t, at: '2026-11-16T12:00:00.000Z' });
ok('record 带 at', rec.at === '2026-11-16T12:00:00.000Z', rec);
ok('record 带两个文件名', rec.jsonName === base + '.json' && rec.mdName === base + '.md', rec);
ok('record 带集数', rec.episodes === 9, rec);
ok('record 默认 copiedAt 为空', rec.copiedAt === '', rec);
ok('新导出应该自动复制', H.shouldAutoCopy(rec) === true, rec);
const copied = H.markedCopied(rec, '2026-11-16T12:00:05.000Z');
ok('复制过之后不再自动复制', H.shouldAutoCopy(copied) === false, copied);
ok('markedCopied 保留原 at', copied.at === rec.at, copied);
ok('markedCopied 不会把文件名弄丢', copied.jsonName === base + '.json' && copied.mdName === base + '.md', copied);
ok('markedCopied 记下时间', copied.copiedAt === '2026-11-16T12:00:05.000Z', copied);

// 5. 弹窗读回来的记录：坏数据不能把弹窗搞崩
ok('空对象返回 null', H.parsePending({}) === null, H.parsePending({}));
ok('没有 text 返回 null', H.parsePending({ at: 'x', jsonName: 'a.json' }) === null);
ok('null 返回 null', H.parsePending(null) === null);
ok('字符串返回 null', H.parsePending('x') === null);
const back = H.parsePending({ baseName: base, course: 'C', text: t, at: '2026-11-16T12:00:00.000Z' });
ok('好数据能读回来', back && back.text === t && back.jsonName === base + '.json', back);
ok('读回来时也算「没复制过」', back && H.shouldAutoCopy(back) === true, back);

// 5b. 文件名有固定前缀，提示里教 agent「按前缀找最新」而不是精确名字
ok('前缀常量', H.PREFIX === 'bn-study-', H.PREFIX);
ok('通配符常量', H.PATTERN === 'bn-study-*.json', H.PATTERN);
const withPrefix = H.text({ baseName: 'bn-study-测试课（S1 · 2 集学习包）', course: '测试课', episodes: 2 });
ok('提示里点名通配符', withPrefix.indexOf('bn-study-*.json') >= 0, withPrefix);
ok('提示里说「最新的」', withPrefix.indexOf('最新的') >= 0, withPrefix);
ok('提示里交代 (1) 重名', withPrefix.indexOf('(1)') >= 0, withPrefix);
ok('仍然要求校验 spec', withPrefix.indexOf('bn-study-pack/1') >= 0, withPrefix);
ok('没有绝对路径就不会骗人', withPrefix.indexOf('C:') < 0 && withPrefix.indexOf('\\Users') < 0, withPrefix);
// 6. 长文本不会无限膨胀（剪贴板里塞几万字不合适）
const long = H.text({ baseName: base, course: 'C', goal: new Array(400).join('很长的目标') });
ok('文本有上限', long.length <= H.MAX_TEXT + 1, long.length);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
