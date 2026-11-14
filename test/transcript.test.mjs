// 没配 Key 时的导出：字幕全文。格式化错一个字符，用户拿到的就是看不懂的 Markdown。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const ctx = { window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'src/summarize.js'), 'utf8'), ctx);
const S = ctx.window.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const sents = [
  { sid: 0, from: 5, to: 8, content: '我们先看第一个问题' },
  { sid: 1, from: 61.4, to: 70, content: '  这里\n有两个 要点  ' },
  { sid: 2, from: 3725, to: 3730, content: '最后一句话' },
];
const jump = (t) => 'https://www.bilibili.com/video/BV1X?p=2&t=' + Math.floor(Number(t) || 0);
const md = S.transcriptMarkdown(sents, {
  url: 'https://www.bilibili.com/video/BV1X?p=2',
  title: '测试标题（P2/5 · 下半场）',
  totalPages: 5, page: 2, part: '下半场',
  trackLan: 'ai-zh', verified: 'two-samples-agree',
  jumpUrl: jump, exportedAt: '2026-11-14T00:00:00.000Z',
});

ok('有 frontmatter 起止', md.startsWith('---\n') && md.indexOf('\n---\n') > 0);
ok('标了这是纯字幕导出', md.indexOf('notes: transcript-only') > 0);
ok('带了 source', md.indexOf('source: https://www.bilibili.com/video/BV1X?p=2') > 0);
ok('多 P 时写 page / part', md.indexOf('page: 2/5') > 0 && md.indexOf('part: 下半场') > 0);
ok('verified 原样透传', md.indexOf('verified: two-samples-agree') > 0);
ok('导出的时间戳是传入的（可复现）', md.indexOf('exported: 2026-11-14T00:00:00.000Z') > 0);
ok('标题写成 h1', md.indexOf('# 测试标题（P2/5 · 下半场）') > 0);
ok('明确说了没经 AI 整理', md.indexOf('没有经过 AI 整理') > 0);
ok('句数标在标题里', md.indexOf('## 字幕全文（3 句）') > 0);
ok('每句一行、带可点时间', (md.match(/^- \[/gm) || []).length === 3);
ok('秒数进位到 mm:ss', md.indexOf('(https://www.bilibili.com/video/BV1X?p=2&t=61) 这里 有两个 要点') > 0, md.split('\n').filter((l) => l.indexOf('这里') >= 0).join(''));
ok('超过一小时用分钟数继续涨，不写成 01:02:05', md.indexOf('t=3725) 最后一句话') > 0 && md.indexOf('[62:05]') > 0, md.split('\n').filter((l) => l.indexOf('最后') >= 0).join(''));
ok('句内换行被压成一行（否则 Markdown 列表会被截断）', md.indexOf('这里 有两个 要点') > 0 && md.indexOf('这里\n') < 0);
ok('首句时间戳补零', md.indexOf('[00:05]') > 0);

// 画面字幕：必须带错字警告，不能让用户把 OCR 结果当原话
const ocrMd = S.transcriptMarkdown(sents, { title: 't', ocr: true, jumpUrl: jump });
ok('OCR 来源带错字警告', ocrMd.indexOf('subtitle_note: 画面字幕识别，可能有错字') > 0);
const plainMd = S.transcriptMarkdown(sents, { title: 't', jumpUrl: jump });
ok('普通字幕不带错字警告', plainMd.indexOf('subtitle_note') < 0);
ok('没传 verified 时按单次取样写', plainMd.indexOf('verified: single-sample') > 0);
ok('单 P 不写 page/part', plainMd.indexOf('\npage:') < 0);

// 空字幕：不能崩，也不能给一份空白文件
const emptyMd = S.transcriptMarkdown([], { title: '空的', jumpUrl: jump });
ok('空字幕说明原因', emptyMd.indexOf('0 句') > 0 && emptyMd.indexOf('没有可导出的字幕') > 0);
ok('空字幕也还是合法 Markdown', emptyMd.indexOf('# 空的') > 0 && emptyMd.startsWith('---'));
const nullMd = S.transcriptMarkdown(null, { title: 'null' });
ok('sentences 为 null 时不抛异常', typeof nullMd === 'string' && nullMd.indexOf('## 字幕全文（0 句）') > 0);
ok('没给 jumpUrl 时退化成页内锚点而不是 undefined', S.transcriptMarkdown(sents, {}).indexOf('(#t=5)') > 0);

// fmtTime 单独暴露，方便别处复用
ok('fmtTime 0 秒', S.fmtTime(0) === '00:00', S.fmtTime(0));
ok('fmtTime 59 秒', S.fmtTime(59) === '00:59', S.fmtTime(59));
ok('fmtTime 60 秒进位', S.fmtTime(60) === '01:00', S.fmtTime(60));
ok('fmtTime 负数当 0', S.fmtTime(-5) === '00:00', S.fmtTime(-5));
ok('fmtTime 非数字当 0', S.fmtTime('abc') === '00:00', S.fmtTime('abc'));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
