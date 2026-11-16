// 概念抽取：切块、prompt、按句子 id 取原话、跨集合并。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const src = readFileSync(new URL('../src/concepts.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(src, ctx);
const C = ctx.BnConcept;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

function sents(n, from) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ sid: 100 + i, from: (from || 0) + i * 5, to: (from || 0) + i * 5 + 4, content: '第' + i + '句 讲 skills 和判据' });
  return out;
}

// 1) 切块：120 句一块
const ch = C.chunks(sents(250));
ok('250 句切成 3 块', ch.length === 3, ch.length);
ok('第一块 120 句', ch[0].length === 120, ch[0].length);
ok('最后一块 10 句', ch[2].length === 10, ch[2].length);
ok('空输入不崩', C.chunks([]).length === 0 && C.chunks(null).length === 0);
ok('坏句子被过滤', C.chunks([null, {}, { sid: 1, content: 'x' }])[0].length === 1);

// 2) prompt：必须含 json 字样（DeepSeek 的 json_object 要求）
const p = C.buildPrompt(ch[0], { index: 21, title: 'S2-6 别再手动帮 AI 点测试了' });
ok('prompt 两段', p.length === 2 && p[0].role === 'system');
ok('system 里有 json 字样', /json/i.test(p[0].content));
ok('user 里带句子 id 和原句', p[1].content.indexOf('100|第0句') >= 0, p[1].content.slice(0, 60));
ok('user 里带集号', p[1].content.indexOf('S2-6') >= 0);
ok('规定了每块最多 6 个概念', p[0].content.indexOf('最多 6 个') >= 0);
ok('要求只给 sid 不自己写引文', p[0].content.indexOf('不要自己写引文') >= 0);

// 3) epLabel
ok('从标题取 S2-6', C.epLabel({ index: 1, title: 'S2-6 别再手动帮 AI 点测试了' }) === 'S2-6');
ok('没有集号退回第 N 集', C.epLabel({ index: 7, title: '随便什么标题' }) === '第 7 集');

// 4) normalize：引文只取本地原句
const chunk = sents(5);
const raw = {
  concepts: [
    { name: 'skills', kind: '工具', def: '可复用的流程包', aliases: ['技能', 'skill'], sids: [101, 999, 102] },
    { name: '', def: '没名字', sids: [100] },
    { name: 'skills', def: '重复', sids: [103] },
    { name: '判据', kind: '胡说', def: '', sids: [] },
  ],
};
const n = C.normalize(raw, chunk, { index: 3, title: 'S1-3 有电脑才能学 AI 吗' });
ok('只留下有名字且能对上句子的概念', n.length === 1, n.map((x) => x.name));
ok('引文逐字取自原句', n[0].anchors[0].quote.indexOf('第1句') >= 0, n[0].anchors[0]);
ok('时间戳由句子 from 算出', n[0].anchors[0].t === 5, n[0].anchors[0].t);
ok('不存在的 sid 被丢掉', n[0].anchors.length === 2, n[0].anchors.length);
ok('别名去重并保留', n[0].aliases.join(',') === '技能,skill', n[0].aliases);
ok('未知 kind 退回「概念」', C.normalize({ concepts: [{ name: 'X 概念', kind: '胡说', sids: [100] }] }, chunk, { index: 1 })[0].kind === '概念');
ok('一块最多 6 个概念', C.normalize({ concepts: Array.from({ length: 10 }, (_, i) => ({ name: '概念' + i, sids: [100] })) }, chunk, { index: 1 }).length === 6);
ok('一个概念最多 3 个锚点', C.normalize({ concepts: [{ name: '多锚', sids: [100, 101, 102, 103, 104] }] }, chunk, { index: 1 })[0].anchors.length === 3);
ok('字符串输入也能解析', C.normalize('```json\n{"concepts":[{"name":"甲概念","sids":[100]}]}\n```', chunk, { index: 1 }).length === 1);
ok('坏 JSON 返回空数组', C.normalize('不是 json', chunk, { index: 1 }).length === 0);

// 5) conceptKey
ok('大小写与空格无关', C.conceptKey('Skills 调用') === C.conceptKey('skills调用'));
ok('标点无关', C.conceptKey('判据（test）') === C.conceptKey('判据test'));

// 6) merge：跨集合并、锚点去重、别名归并
const merged = C.merge([
  { name: 'skills', kind: '工具', def: '可复用的流程包', aliases: ['技能'], anchors: [{ ep: 2, t: 442, quote: 'a', epLabel: 'S2-6', url: 'u' }] },
  { name: 'skills', def: '', anchors: [{ ep: 2, t: 443, quote: 'b' }, { ep: 5, t: 10, quote: 'c' }] },
  { name: '判据', def: '凭什么说它对了', anchors: [{ ep: 3, t: 1, quote: 'd' }] },
  { name: '技能', def: '别名指向同一个', anchors: [{ ep: 9, t: 2, quote: 'e' }] },
]);
ok('同名合并成一个', merged.filter((x) => x.name === 'skills').length === 1, merged.map((x) => x.name));
ok('同集 3 秒内锚点去重', merged[0].anchors.filter((a) => a.ep === 2).length === 1, merged[0].anchors);
ok('跨集锚点累加', merged[0].anchors.length === 3, merged[0].anchors.length);
ok('锚点按集与时间排序', merged[0].anchors[0].ep === 2 && merged[0].anchors[1].ep === 5 && merged[0].anchors[2].ep === 9);
ok('别名归并到已有概念而不是新建', merged.length === 2, merged.map((x) => x.name));
ok('保留第一条定义', merged[0].def === '可复用的流程包', merged[0].def);
ok('按锚点数排序（多的在前）', merged[0].anchors.length >= merged[1].anchors.length);
ok('锚点上限 12', C.merge(Array.from({ length: 20 }, (_, i) => ({ name: '甲概念', anchors: [{ ep: 1, t: i * 10, quote: 'q' }] })))[0].anchors.length === 12);
ok('空输入返回空数组', C.merge(null).length === 0 && C.merge([]).length === 0);

console.log('\nconcepts: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
