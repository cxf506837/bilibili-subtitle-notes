// 学习状态（study-state.json）：剪贴板解析、哪些算懂、存哪、怎么对上课程。
// 这一层决定「agent 拷打完的结果能不能回到面板」，解析错了就会静默丢数据。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'src/studystate.js'), 'utf8');
const ctx = {};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const S = ctx.BnStudyState;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function mk(over) {
  const base = {
    spec: 'bn-study-state/1',
    course: '【从零开始的 AI 学习】',
    course_id: 'season:8719249',
    goal: '',
    updated_at: '2026-11-16T05:11:47.291Z',
    concepts: [
      { name: '指路牌', status: 'understood', asked: 1, correct: 1, last_quote: 'AGENTS.md 就是指路牌', last_url: 'https://www.bilibili.com/video/BV1pwnj6BEMP?t=32' },
      { name: '做减法', status: 'shaky', asked: 2, correct: 0, last_quote: '删掉多余元素', last_url: 'https://www.bilibili.com/video/BV1TtpL6SEvg?t=227' },
      { name: '第一版功能收敛', status: 'unknown', asked: 0, correct: 0, last_quote: '', last_url: '' },
    ],
    next: [{ name: '做减法', url: 'https://www.bilibili.com/video/BV1TtpL6SEvg?t=227', reason: '上次没讲清，再考一次' }],
  };
  return Object.assign({}, base, over || {});
}
const text = JSON.stringify(mk());

// ---- 解析 ----
const a = S.parse(text);
ok('整段 JSON 能解析', a.ok && a.state.concepts.length === 3);
ok('解析后补上 progress', a.ok && a.state.progress.understood === 1 && a.state.progress.shaky === 1 && a.state.progress.unknown === 1 && a.state.progress.total === 3);
ok('解析后记下 applied_at', a.ok && !!a.state.applied_at);

const wrapped = '拷打完了，结果如下：\n\n\u0060\u0060\u0060json\n' + text + '\n\u0060\u0060\u0060\n';
const b = S.parse(wrapped);
ok('包在代码块和说明文字里也能认出来', b.ok && b.state.course_id === 'season:8719249');

ok('空剪贴板报人话', !S.parse('').ok && S.parse('').error.indexOf('空') >= 0);
ok('不是 JSON 报人话', !S.parse('随便写点什么').ok);
ok('spec 不对就说读到什么', !S.parse(JSON.stringify({ spec: 'bn-study-pack/1', concepts: [{ name: 'x' }] })).ok);
ok('spec 不对时不误判成功', S.parse('{}').ok === false);
ok('缺 course_id 会拒', !S.parse(JSON.stringify(mk({ course_id: '' }))).ok);
ok('concepts 空会拒', !S.parse(JSON.stringify(mk({ concepts: [] }))).ok);
ok('没有名字的概念被丢掉', S.parse(JSON.stringify(mk({ concepts: [{ status: 'understood' }, { name: '有名字' }] }))).state.concepts.length === 1);
ok('未知 status 归到 unknown', S.parse(JSON.stringify(mk({ concepts: [{ name: 'x', status: 'mastered' }] }))).state.concepts[0].status === 'unknown');
ok('status 缺失也归 unknown', S.parse(JSON.stringify(mk({ concepts: [{ name: 'x' }] }))).state.concepts[0].status === 'unknown');
ok('长引文被截断到 400 字', S.parse(JSON.stringify(mk({ concepts: [{ name: 'x', last_quote: 'a'.repeat(900) }] }))).state.concepts[0].last_quote.length === 400);
ok('next 里没名字的条目被丢掉', S.parse(JSON.stringify(mk({ next: [{ url: 'u' }, { name: '留着' }] }))).state.next.length === 1);
ok('缺 updated_at 时补一个', !!S.parse(JSON.stringify(mk({ updated_at: '' }))).state.updated_at);

// ---- 汇总 ----
const st = a.state;
ok('line 用「懂 / 半懂 / 没考」', S.line(st) === '懂 1 · 半懂 1 · 没考 1');
ok('line 在没有懂的时候不写 0', S.line({ concepts: [{ name: 'x', status: 'unknown' }] }) === '没考 1');
ok('summarize 数字对', S.summarize(st).total === 3);
ok('byStatus 取出半懂', S.byStatus(st, 'shaky').length === 1 && S.byStatus(st, 'shaky')[0].name === '做减法');
ok('byStatus 支持 limit', S.byStatus(st, 'unknown', 1).length === 1);
ok('nextList 按顺序', S.nextList(st)[0].name === '做减法');

// ---- 存哪 / 对哪门课 ----
ok('存储键带前缀和 course_id', S.storageKey('season:8719249') === 'bnstudy:season:8719249');
ok('能从 storage 全量里挑出来', S.fromStorage({ 'bnstudy:season:8719249': st, 'bnp:123': 40 }).length === 1);
ok('坏数据不会被当成学状态', S.fromStorage({ 'bnstudy:x': { spec: 'nope' } }).length === 0);
ok('course_id 一致才算同一门课', S.match(st, 'season:8719249') === true);
ok('course_id 不同不匹配', S.match(st, 'season:111') === false);
ok('单视频 course_id 也能对', S.match({ course_id: 'video:BV1xxxx' }, 'video:BV1xxxx') === true);
ok('空 courseId 不匹配', S.match(st, '') === false);

console.log('');
console.log((fail ? 'FAILED ' : 'ok ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
