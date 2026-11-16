// 课程选择性导出：只拼勾中的集，按 S1/S2 分段，跳转链接落到那一集的那一秒。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(readFileSync(new URL('../src/summarize.js', import.meta.url), 'utf8'), ctx);
runInContext(readFileSync(new URL('../src/batch.js', import.meta.url), 'utf8'), ctx);
const B = ctx.BnBatch;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

const eps = [
  { index: 8, section: 'S2', title: 'S2-6 别再手动帮 AI 点测试了', url: 'https://www.bilibili.com/video/BV1BgH36DE7y', verdict: 'stable', trackLan: 'ai-zh', sentences: [
    { from: 0, to: 3, content: '第一句' },
    { from: 65.4, to: 70, content: '第二句  有  多余空格' },
  ] },
  { index: 9, section: 'S2', title: 'S2-7 最后一集', url: 'https://www.bilibili.com/video/BV1BgH36DE7y?p=2', verdict: 'single', sentences: [
    { from: 5, to: 8, content: '第三句' },
  ] },
];
const bad = [{ index: 10, section: 'S2', title: 'S2-8 没字幕', verdict: 'rejected', reason: 'no-subs', cover: null }];
const md = B.seasonMarkdown(eps, bad, { courseTitle: '【从零开始的 AI 学习】', courseId: 'season:8719249', url: 'https://www.bilibili.com/video/BV1BgH36DE7y', total: 3, scope: 'S2', exportedAt: '2026-11-16T00:00:00.000Z' });

ok('frontmatter：course', md.indexOf('course: 【从零开始的 AI 学习】') >= 0);
ok('frontmatter：kind season', md.indexOf('kind: season') >= 0);
ok('frontmatter：导出 2/3', md.indexOf('exported_episodes: 2/3') >= 0);
ok('frontmatter：verified 1/3', md.indexOf('verified_episodes: 1/3') >= 0);
ok('frontmatter：scope', md.indexOf('scope: S2') >= 0);
ok('正文只有勾中的两集', md.indexOf('### 第 8 集') >= 0 && md.indexOf('### 第 9 集') >= 0 && md.indexOf('### 第 10 集') < 0);
ok('按段标题只出现一次', md.split('## S2').length === 2, md.split('## S2').length);
ok('时间戳 00:00 + 跳转带 ?t=', md.indexOf('- [00:00](https://www.bilibili.com/video/BV1BgH36DE7y?t=0) 第一句') >= 0, md.split('\n').filter(function (l) { return l.indexOf('第一句') >= 0; }));
ok('已有 ?p= 时用 &t=', md.indexOf('?p=2&t=5') >= 0);
ok('65 秒排版成 01:05', md.indexOf('- [01:05]') >= 0);
ok('正文空白被压成一个空格', md.indexOf('第二句 有 多余空格') >= 0);
ok('未导出段列出原因', md.indexOf('## 未导出的集（1）') >= 0 && md.indexOf('这一 P 没有中文 AI 字幕') >= 0);
ok('单次取样有标注', md.indexOf('单次取样') >= 0);
ok('两次取样一致有标注', md.indexOf('两次取样一致') >= 0);

const fname = B.seasonFileName({ courseTitle: '【从零开始的 AI 学习】', scope: 'S2', count: 2 });
ok('文件名带范围与集数', fname === '【从零开始的 AI 学习】（S2 · 2 集）.md', fname);
const fname2 = B.seasonFileName({ courseTitle: 'a/b:c', scope: '', count: 3 });
ok('文件名里的非法字符被替换', fname2.indexOf('/') < 0 && fname2.indexOf(':') < 0, fname2);

const empty = B.seasonMarkdown([], bad, { courseTitle: 'x', total: 1 });
ok('一集都没导出来：不崩，still 列出原因', typeof empty === 'string' && empty.indexOf('未导出的集') >= 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
