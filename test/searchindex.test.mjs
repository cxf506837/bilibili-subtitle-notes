// 跨视频笔记检索：索引怎么压、关键词怎么匹配、跳回链接怎么拼。
// 弹窗读不到 bilibili.com 的 IndexedDB，所以这套索引是唯一的数据源，压坏了就等于搜不到。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'src/searchindex.js'), 'utf8');
const ctx = {};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const B = ctx.BnIndex;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const notes = [
  { start: 130, blockSummary: '损失函数与梯度下降', oneThing: '梯度指向上升最快的方向', points: [
    { plain: '交叉熵衡量两个分布的差异', quote: '交叉熵就是衡量两个分布离得多远' },
    { plain: '学习率太大会震荡', quote: '学习率一大，它就开始震荡了' }] },
  { start: 12.7, blockSummary: '课程介绍', oneThing: '', points: [{ plain: '这门课讲 Transformer', quote: '我们这门课主要讲 Transformer' }] },
  { start: 300, blockSummary: '注意力机制', oneThing: 'QKV 三件套', points: [{ plain: 'Q 和 K 算相似度', quote: 'Query 和 Key 做点积' }] },
];

const idx = B.build('BV1xx411c7mD', { title: '从零开始的大模型课', cid: 88, page: 2, pages: 6, part: '第二讲' }, notes);
ok('索引带 bvid', idx.bvid === 'BV1xx411c7mD');
ok('索引带标题', idx.title === '从零开始的大模型课');
ok('条数对得上', idx.count === 3, idx.count);
ok('按时间排序（12.7 在 130 前面）', idx.notes[0].t === 12 && idx.notes[1].t === 130, JSON.stringify(idx.notes.map(n => n.t)));
ok('秒取整', idx.notes[1].t === 130);
ok('多 P 时 url 带 ?p=', idx.url === 'https://www.bilibili.com/video/BV1xx411c7mD?p=2', idx.url);

const single = B.build('BV1yy411c7mE', { title: '单 P', cid: 1, page: 1, pages: 1 }, notes);
ok('单 P 时 url 不带 ?p=', single.url === 'https://www.bilibili.com/video/BV1yy411c7mE', single.url);

// 查询
const entries = [idx];
ok('按摘要搜得到', B.search(entries, '梯度', 10).length === 1);
ok('按引文搜得到', B.search(entries, '点积', 10).length === 1);
ok('按要点搜得到', B.search(entries, '交叉熵', 10).length === 1);
ok('大小写不敏感', B.search(entries, 'transformer', 10).length === 1);
ok('多词 AND：两个词都得有', B.search(entries, '损失 震荡', 10).length === 1);
ok('多词 AND：缺一个就不给', B.search(entries, '损失 微积分', 10).length === 0);
ok('搜不到就是空', B.search(entries, '量子力学', 10).length === 0);
ok('空查询不返回任何东西', B.search(entries, '   ', 10).length === 0);
ok('结果带命中片段', (B.search(entries, '震荡', 10)[0] || {}).hit.indexOf('震荡') >= 0, JSON.stringify(B.search(entries, '震荡', 10)[0]));
ok('结果带时间点', (B.search(entries, '震荡', 10)[0] || {}).t === 130);
ok('结果带视频标题（弹窗要显示）', (B.search(entries, '震荡', 10)[0] || {}).title === '从零开始的大模型课');

// limit 生效
const many = [];
for (let i = 0; i < 80; i++) many.push({ start: i, blockSummary: '同一句', points: [] });
const bigIdx = B.build('BV1zz411c7mF', { title: '很多条', cid: 9, page: 1, pages: 1 }, many);
ok('limit 截断', B.search([bigIdx], '同一句', 20).length === 20);

// 跳回链接
ok('跳转带 t=', B.jump('https://www.bilibili.com/video/BV1xx', 130) === 'https://www.bilibili.com/video/BV1xx?t=130');
ok('已有参数时用 &', B.jump('https://www.bilibili.com/video/BV1xx?p=2', 130) === 'https://www.bilibili.com/video/BV1xx?p=2&t=130');
ok('时间取整且不为负', B.jump('u', -5) === 'u?t=0');

// storage dump -> 索引
const all = {};
all['bnidx:BV1xx:88'] = idx;
all['bn.width'] = 380;
all['bnidx:BV1yy:1'] = single;
all['bad'] = { notes: 'not-an-array' };
all['bnidx:BV1broken:1'] = { notes: [] };
const picked = B.fromStorage(all);
ok('只挑 bnidx: 开头的', picked.length === 3, picked.length);
ok('跳过坏数据（notes 不是数组）', picked.every(e => Array.isArray(e.notes)));
ok('空笔记的索引也留着（条数为 0，recent 会滤掉）', picked.length === 3);

// 最近视频
const recent = B.recent(picked, 8);
ok('最近只给有条目的', recent.length === 2, recent.length);
ok('最近带条数', recent.every(r => r.count > 0));
const older = B.build('BV1old', { title: '老的', cid: 1, page: 1, pages: 1, updated: 1000 }, notes);
const newer = B.build('BV1new', { title: '新的', cid: 1, page: 1, pages: 1, updated: 9999999999999 }, notes);
ok('最近按时间倒序', B.recent([older, newer], 8)[0].bvid === 'BV1new');

// 分组渲染（弹窗按视频分组）
const hits = B.search([idx, bigIdx], '同一句', 50);
const groups = B.groupVideos(hits);
ok('分组按视频聚合', groups.length === 1 && groups[0].items.length === 50, groups.length);

// 压字数
ok('长文本截断带省略号', B.trim('x'.repeat(500), 10) === 'xxxxxxxxxx…');
ok('空白压缩成单空格', B.trim('a   \n b') === 'a b');

// 空标题兜底：没有标题就用 bvid
const noTitle = B.build('BV1bare411c7mG', { cid: 1 }, []);
ok('没标题时用 bvid', noTitle.title === 'BV1bare411c7mG');
ok('没有笔记也能建索引', noTitle.count === 0 && Array.isArray(noTitle.notes));

const otherP = B.build('BV1xx411c7mD', { title: '同一个视频的第三讲', cid: 89, page: 3, pages: 6, part: '第三讲', updated: 1 }, notes);

// 弹窗顶部「当前在看哪一集」：从地址认 bvid / 分 P，挑回对应索引
ok('从视频页地址取 bvid', B.bvidOf('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333') === 'BV1xx411c7mD');
ok('从 ?p= 地址取 bvid', B.bvidOf('https://www.bilibili.com/video/BV1xx411c7mD?p=3') === 'BV1xx411c7mD');
ok('不是视频页就没有 bvid', B.bvidOf('https://www.bilibili.com/') === '');
ok('搜索页不算视频页', B.bvidOf('https://search.bilibili.com/all?keyword=BV1xx411c7mD') === '');
ok('取分 P 号', B.pageOf('https://www.bilibili.com/video/BV1xx411c7mD?p=3') === 3);
ok('没有 p 就是 0（当成整片）', B.pageOf('https://www.bilibili.com/video/BV1xx411c7mD/') === 0);
ok('pickEntry 优先同一分 P', B.pickEntry([idx, otherP], 'BV1xx411c7mD', 2) === idx);
ok('pickEntry 分 P 对不上就退最近一条', B.pickEntry([idx, otherP], 'BV1xx411c7mD', 5).bvid === 'BV1xx411c7mD');
ok('pickEntry 没这个视频就 null', B.pickEntry([idx], 'BV9zz', 1) === null);
ok('标题去掉站点后缀', B.cleanTitle('某个视频_哔哩哔哩_bilibili', 'BV1') === '某个视频');
ok('标题去掉短后缀', B.cleanTitle('某个视频 - 哔哩哔哩', 'BV1') === '某个视频');
ok('空标题退回 bvid', B.cleanTitle('', 'BV1xx') === 'BV1xx');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
