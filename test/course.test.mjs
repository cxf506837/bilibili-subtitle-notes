// 课程目录：合集 / 多 P / 单视频 → 「课程 → 集」，以及进度与「继续上次」。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const src = readFileSync(new URL('../src/course.js', import.meta.url), 'utf8');
const ctx = createContext({ console });
ctx.globalThis = ctx;
runInContext(src, ctx);
const C = ctx.BnCourse;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

const seasonMeta = {
  bvid: 'BV1BgH36DE7y',
  title: '【Re:从零开始的AI学习】 别再手动帮 AI 点测试了！',
  cid: '43030022264',
  pageDur: 585,
  pageList: [{ cid: '43030022264', page: 1, part: '', duration: 585 }],
  season: {
    id: 8719249,
    title: '【从零开始的 AI 学习】',
    eps: [
      { bvid: 'BV1TDGT6vEqC', cid: '42722657079', page: 1, title: 'S1-0 引言：AI 这三年，到底什么变了？', duration: 191 },
      { bvid: 'BV1BgH36DE7y', cid: '43030022264', page: 1, title: 'S1-21 别再手动帮 AI 点测试了！', duration: 585 },
      { bvid: 'BV18JWJ6eEgJ', cid: '43438377764', page: 1, title: 'S1-24 大模型跑分的水有多深', duration: 499 },
    ],
  },
};

// 1. 合集
const course = C.build(seasonMeta);
ok('合集：kind=season', course.kind === 'season', course.kind);
ok('合集：id 带 season 前缀', course.id === 'season:8719249', course.id);
ok('合集：标题取合集名', course.title === '【从零开始的 AI 学习】', course.title);
ok('合集：集数 3', course.episodes.length === 3, course.episodes.length);
ok('合集：总时长 191+585+499', course.total === 1275, course.total);
ok('合集：每集带序号', course.episodes[0].index === 1 && course.episodes[2].index === 3);
ok('合集：cid 是字符串', course.episodes[1].cid === '43030022264', course.episodes[1].cid);

// 2. 多 P
const pagesMeta = {
  bvid: 'BV1LpD3YsETa',
  title: '【教学】b站视频 手机怎么分集分p',
  cid: '111',
  pageDur: 60,
  pageList: [
    { cid: '111', page: 1, part: '第一 P', duration: 60 },
    { cid: '222', page: 2, part: '第二 P', duration: 90 },
  ],
};
const pc = C.build(pagesMeta);
ok('多P：kind=pages', pc.kind === 'pages', pc.kind);
ok('多P：两集', pc.episodes.length === 2);
ok('多P：第 2 集带 ?p=2', pc.episodes[1].url === 'https://www.bilibili.com/video/BV1LpD3YsETa?p=2', pc.episodes[1].url);
ok('多P：第 1 集不带 p', pc.episodes[0].url === 'https://www.bilibili.com/video/BV1LpD3YsETa', pc.episodes[0].url);
ok('多P：标题取 part', pc.episodes[1].title === '第二 P', pc.episodes[1].title);

// 3. 单视频
const sc = C.build({ bvid: 'BV1GyZYYNErW', title: '我的世界克苏鲁全集', cid: '29139732641', pageDur: 4235, pageList: [] });
ok('单集：kind=single', sc.kind === 'single', sc.kind);
ok('单集：只有一集', sc.episodes.length === 1);
ok('单集：标题兜底为本集', sc.episodes[0].title === '我的世界克苏鲁全集');

// 4. 空值
ok('空 meta 返回 null', C.build(null) === null && C.build({}) === null);

// 5. 跳转参数
ok('时间点用 &t=', C.episodeUrl({ bvid: 'BV1BgH36DE7y', page: 1, sec: 95 }) === 'https://www.bilibili.com/video/BV1BgH36DE7y?t=95', C.episodeUrl({ bvid: 'BV1BgH36DE7y', page: 1, sec: 95 }));
ok('多P + 时间点', C.episodeUrl({ bvid: 'BV1X', page: 2, sec: 7 }) === 'https://www.bilibili.com/video/BV1X?p=2&t=7', C.episodeUrl({ bvid: 'BV1X', page: 2, sec: 7 }));
ok('没有 bvid 返回空串', C.episodeUrl({}) === '');

// 6. 时长格式化
ok('fmtDur 45 秒', C.fmtDur(45) === '45 秒', C.fmtDur(45));
ok('fmtDur 125 秒', C.fmtDur(125) === '2 分 5 秒', C.fmtDur(125));
ok('fmtDur 750 秒', C.fmtDur(750) === '12 分 30 秒', C.fmtDur(750));
ok('fmtDur 10655 秒', C.fmtDur(10655) === '2 小时 57 分', C.fmtDur(10655));
ok('fmtDur 0', C.fmtDur(0) === '0 秒', C.fmtDur(0));

// 7. 进度与「看过」判据
const map = { '42722657079': 191, '43030022264': 300, '43438377764': 499 };
ok('看满算看过', C.isWatched(course.episodes[0], map) === true);
ok('看到一半不算看过', C.isWatched(course.episodes[1], map) === false);
ok('刚点开 5 秒不算看过', C.isWatched(course.episodes[2], { '43438377764': 5 }) === false);
ok('没记录不算看过', C.isWatched(course.episodes[0], {}) === false);
ok('时长未知时 60 秒以上算看过', C.isWatched({ cid: 'x', duration: 0 }, { x: 61 }) === true);
const pr = C.progress(course, map);
ok('progress: 已看 2 集', pr.watched === 2, pr.watched);
ok('progress: 总集数 3', pr.count === 3);
ok('progress: 总时长 1275', pr.totalSec === 1275, pr.totalSec);
ok('progress: 已看秒数封顶在时长', pr.watchedSec === 191 + 300 + 499, pr.watchedSec);
ok('progress: 剩余秒数 = 总时长 - 已看秒数', pr.remainingSec === 285, pr.remainingSec);
ok('progress: flags 与集一一对应', pr.flags.length === 3 && pr.flags[1] === false, pr.flags);

// 8. 当前集与继续上次
ok('currentIndex 按 cid 命中第 2 集', C.currentIndex(course, 'BV1BgH36DE7y', '43030022264') === 1);
ok('currentIndex 只按 bvid 也能命中', C.currentIndex(course, 'BV18JWJ6eEgJ', 'nope') === 2);
ok('currentIndex 找不到返回 -1', C.currentIndex(course, 'BV0', '0') === -1);
const nx = C.nextUnwatched(course, map, 0);
ok('nextUnwatched 从第 1 集之后找 → 第 2 集', nx && nx.index === 2, nx && nx.index);
const nx2 = C.nextUnwatched(course, map, 1);
ok('nextUnwatched 从第 2 集之后：第 3 集已看完 → 回绕到没看完的第 2 集', nx2 && nx2.index === 2, nx2 && nx2.index);
const allDone = C.nextUnwatched(course, { '42722657079': 191, '43030022264': 585, '43438377764': 499 }, 0);
ok('全部看完返回 null', allDone === null);
const wrapAround = C.nextUnwatched(course, { '42722657079': 191 }, 2);
ok('末尾之后回绕到未看的第 2 集', wrapAround && wrapAround.index === 2, wrapAround && wrapAround.index);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
