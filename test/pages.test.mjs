import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// 多 P（分 P）解析：B站 view 接口一次给全部分 P，但 data.cid 永远是默认 P（通常 P1）。
// 只按 data.cid 取会导致「切到 P2 却拿到 P1 的字幕和时长」——闸门会用错误的时长比对，
// 表现是突然「字幕时长超出视频」或者干脆没字幕。这里锁住按 ?p=N 选 P 的行为。

const gateSrc = readFileSync(new URL('../src/gate.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

const PAGES = [
  { cid: 11, page: 1, part: '第一讲', duration: 100 },
  { cid: 22, page: 2, part: '第二讲', duration: 200 },
  { cid: 33, page: 3, part: '第三讲', duration: 300 },
];
const ctx = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
ctx.globalThis = ctx;
ctx.chrome = { runtime: { lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 1); } } };
ctx.fetch = async (url) => {
  if (url.includes('/x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1MULTIPAGE', aid: 9, cid: 11, title: '多 P 课程', duration: 100, pages: PAGES } }) };
  }
  if (url.includes('/x/player/v2')) {
    return { ok: true, json: async () => ({ code: 0, data: { subtitle: { need_login_subtitle: false, subtitles: [] } } }) };
  }
  throw new Error('unexpected url ' + url);
};
runInContext(gateSrc, ctx);
const G = ctx.BnGate;

console.log('多 P：按 ?p=N 选分 P');
const p1 = await G.resolveVideo('BV1MULTIPAGE');
ok('不给 p 时取默认 P1 的 cid', p1.cid === 11, p1);
ok('不给 p 时 page=1、pageDur=100', p1.page === 1 && p1.pageDur === 100, p1);
ok('返回全部分 P 列表', Array.isArray(p1.pageList) && p1.pageList.length === 3, p1.pageList);
ok('pages 是总 P 数', p1.pages === 3, p1.pages);
ok('part 带上了分 P 名', p1.part === '第一讲', p1.part);
ok('aid 与原视频一致', p1.aid === 9, p1.aid);

const p2 = await G.resolveVideo('BV1MULTIPAGE', 2);
ok('p=2 取到第二 P 的 cid', p2.cid === 22, p2);
ok('p=2 的时长是第二 P 的', p2.pageDur === 200, p2.pageDur);
ok('p=2 的 page=2', p2.page === 2, p2.page);
ok('p=2 的 part=第二讲', p2.part === '第二讲', p2.part);

const p2b = await G.resolveVideo('BV1MULTIPAGE', '2');
ok('p 传字符串也能认', p2b.cid === 22, p2b.cid);

const p9 = await G.resolveVideo('BV1MULTIPAGE', 9);
ok('p 超出范围时退回默认 P（不报错）', p9.cid === 11, p9);

const p0 = await G.resolveVideo('BV1MULTIPAGE', 0);
ok('p=0 视为没给', p0.cid === 11, p0);

// 单 P 视频：pages 只有 1 条，?p=2 也不能乱跳
const ctx2 = createContext({ console, setTimeout, clearTimeout, AbortController, AbortSignal });
ctx2.globalThis = ctx2;
ctx2.chrome = ctx.chrome;
ctx2.fetch = async (url) => {
  if (url.includes('/x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1SINGLE', aid: 3, cid: 5, title: '单片', duration: 60, pages: [{ cid: 5, page: 1, part: '', duration: 60 }] } }) };
  }
  throw new Error('unexpected url ' + url);
};
runInContext(gateSrc, ctx2);
const G2 = ctx2.BnGate;
const s1 = await G2.resolveVideo('BV1SINGLE', 5);
ok('单 P 视频传了不存在的 p 仍然拿到那一片', s1.cid === 5 && s1.pages === 1, s1);
ok('单 P 视频 pageDur 正确', s1.pageDur === 60, s1.pageDur);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
