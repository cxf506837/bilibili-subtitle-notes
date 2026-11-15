// 合集 / 多 P 批量导出：一份文件里塞几十 P 的字幕，格式错一处用户就读不下去。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const ctx = { window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'src/summarize.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'src/batch.js'), 'utf8'), ctx);
const B = ctx.window.BnBatch;
const NL = String.fromCharCode(10);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const good = [
  { page: 1, part: '序章', duration: 300, verdict: 'stable', votes: 2, trackLan: 'ai-zh', sentences: [
    { from: 3, to: 6, content: '第一句  这里' + NL + '有换行' },
    { from: 65, to: 70, content: '第二句' },
  ] },
  { page: 3, part: '', duration: 200, verdict: 'single', votes: 1, trackLan: 'ai-zh', sentences: [
    { from: 12, to: 15, content: 'P3 的一句' },
  ] },
];
const bad = [
  { page: 2, part: '下半场', verdict: 'truncated', reason: 'cover-low', cover: 0.471 },
  { page: 4, part: '', verdict: 'rejected', reason: 'ambiguous', cover: null },
  { page: 5, part: '', verdict: 'need-login', reason: '', cover: null },
];
const meta = { url: 'https://www.bilibili.com/video/BV1XyZ', title: '合集标题', bvid: 'BV1XyZ', totalPages: 5, exportedAt: '2026-11-15T00:00:00.000Z' };
const md = B.batchMarkdown(good, bad, meta);

ok('有 frontmatter 起止', md.startsWith('---' + NL) && md.indexOf(NL + '---' + NL) > 0);
ok('带 source / title / bvid', md.indexOf('source: https://www.bilibili.com/video/BV1XyZ') > 0 && md.indexOf('title: 合集标题') > 0 && md.indexOf('bvid: BV1XyZ') > 0);
ok('写了总 P 数', md.indexOf('pages: 5') > 0);
ok('写了导出了几 P', md.indexOf('exported_parts: 2/5') > 0);
ok('写了交叉确认了几 P', md.indexOf('verified_parts: 1/5') > 0);
ok('tags 用多行写法', md.indexOf('tags:' + NL + '  - bilibili' + NL + '  - 视频笔记' + NL + '  - 合集') > 0);
ok('导出时间可复现', md.indexOf('exported: 2026-11-15T00:00:00.000Z') > 0);
ok('开头交代了几 P 有字幕、几 P 没有', md.indexOf('共 5 P，这份文件里有 2 P 的字幕') > 0 && md.indexOf('3 P 没有导出') > 0);
ok('P 标题带分 P 名', md.indexOf('## P1 · 序章') > 0 && md.indexOf('## P3' + NL) > 0, md.split(NL).filter((l) => l.indexOf('## P3') >= 0).join(''));
ok('每 P 标明取样结论', md.indexOf('_字幕 2 句 · 两次取样一致 · ai-zh_') > 0 && md.indexOf('_字幕 1 句 · 单次取样') > 0);
ok('句内换行被压成一行', md.indexOf('- [00:03](https://www.bilibili.com/video/BV1XyZ?p=1&t=3) 第一句 这里 有换行') > 0);
ok('P3 的跳转带 p=3', md.indexOf('(https://www.bilibili.com/video/BV1XyZ?p=3&t=12)') > 0);
ok('未导出的 P 单列一节', md.indexOf('## 未导出的 P（3）') > 0);
ok('失败原因翻成人话', md.indexOf('P2 · 下半场：字幕只有一部分（时长对不上这一 P）（时长覆盖 0.471）') > 0, md.split(NL).filter((l) => l.indexOf('P2') >= 0).join(''));
ok('每次都不一样要说「不敢猜」', md.indexOf('每次取到的字幕都不一样，不敢猜') > 0);
ok('要登录直说', md.indexOf('需要先登录 B站') > 0);

// 只有失败的 P：也得是一份能读的文件，而不是空壳
const allBad = B.batchMarkdown([], bad, meta);
ok('全失败时仍是合法 Markdown', allBad.startsWith('---') && allBad.indexOf('# 合集标题') > 0);
ok('全失败时写明 0 P', allBad.indexOf('exported_parts: 0/5') > 0 && allBad.indexOf('有 0 P 的字幕') > 0);
const emptyMd = B.batchMarkdown(null, null, meta);
ok('parts/failed 为 null 不抛异常', typeof emptyMd === 'string' && emptyMd.indexOf('exported_parts: 0/5') > 0);

// 文件名：Windows 非法字符、结尾点、合集后缀
ok('文件名去掉非法字符', B.batchFileName({ title: 'a/b:c*d?e"f<g>h|i', totalPages: 1 }) === 'a_b_c_d_e_f_g_h_i.md', B.batchFileName({ title: 'a/b:c*d?e"f<g>h|i', totalPages: 1 }));
ok('合集后缀', B.batchFileName({ title: '课', bvid: 'BV1', totalPages: 12 }) === '课（合集12P）.md', B.batchFileName({ title: '课', bvid: 'BV1', totalPages: 12 }));
ok('标题为空时退回 bvid', B.batchFileName({ title: '', bvid: 'BV1abc', totalPages: 1 }) === 'BV1abc.md');
ok('结尾的点被去掉', B.batchFileName({ title: '标题...', totalPages: 1 }) === '标题.md', B.batchFileName({ title: '标题...', totalPages: 1 }));

// 跳转链接拼接
ok('已有 ? 时用 & 接 p', B.partUrl('https://x/video/BV1?p=2', 4) === 'https://x/video/BV1?p=2&p=4');
ok('没有 ? 时用 ? 接 p', B.partUrl('https://x/video/BV1', 1) === 'https://x/video/BV1?p=1');
ok('空 url 退化成锚点', B.partJump('', 1, 9) === '#t=9');

// 原因映射：没见过的 verdict 也不能吐 undefined
ok('未知 verdict 有兜底文案', B.reasonText('weird', '') === '没取到可用的字幕');
ok('reason 优先于 verdict', B.reasonText('truncated', 'ambiguous') === '每次取到的字幕都不一样，不敢猜');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);