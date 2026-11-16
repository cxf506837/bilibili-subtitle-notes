// 课程存档：把看过的课、看到第几集、掌握度存成一条，弹窗据此给「接着学」。
// 复用 course.js 造真实课程形状，避免自己编结构。
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function load(file) {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ctx = createContext({ console });
  ctx.globalThis = ctx;
  runInContext(src, ctx);
  return ctx;
}
const S = load('coursestore.js').BnCourseStore;
const C = load('course.js').BnCourse;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

const meta = {
  bvid: 'BV1BgH36DE7y', title: 'S2-6 别再手动帮 AI 点测试了！', cid: 'c3', pageDur: 585,
  pageList: [{ cid: 'c3', page: 1, part: '', duration: 585 }],
  season: {
    id: 8719249, title: '【从零开始的 AI 学习】',
    eps: [
      { bvid: 'BV1TDGT6vEqC', cid: 'c1', page: 1, title: 'S1-0 引言', duration: 191 },
      { bvid: 'BV1BgH36DE7y', cid: 'c2', page: 1, title: 'S2-0 自动写代码', duration: 300 },
      { bvid: 'BV1BgH36DE7y', cid: 'c3', page: 1, title: 'S2-1 别再手动点测试', duration: 585 },
      { bvid: 'BV1BgH36DE7y', cid: 'c4', page: 1, title: 'S2-2 感觉降智了', duration: 482 },
    ],
  },
};
const course = C.build(meta);

// record
const rec = S.record(course);
ok('record：键带 bnc 前缀', rec && rec.key === 'bnc:season:8719249', rec && rec.key);
ok('record：存了 4 集', rec && rec.value.episodes.length === 4, rec && rec.value.episodes.length);
ok('record：总时长照抄', rec && rec.value.total === 191 + 300 + 585 + 482, rec && rec.value.total);
ok('record：集里不带 url（省地方）', rec && rec.value.episodes[0].url === undefined);
ok('record：没有 id 返回 null', S.record({ episodes: [] }) === null);
ok('record：没有集返回 null', S.record({ id: 'x', episodes: [] }) === null);

// 时间戳：由调用方给，用来排序「最近在看」
const again = S.record(course, '2030-01-01T00:00:00.000Z');
ok('record：采用调用方给的时间', again.value.updated_at === '2030-01-01T00:00:00.000Z', again.value.updated_at);
const auto = S.record(course);
ok('record：不给时间就用当前时间', /^20\d\d-/.test(String(auto.value.updated_at)), auto.value.updated_at);
const more = C.build(meta);
more.episodes = more.episodes.slice(0, 3);
ok('record：集数变少也照样存', S.record(more).value.episodes.length === 3);

// fromStorage / progressOf
const all = {};
all[rec.key] = rec.value;
all['bnp:c1'] = 191;
all['bnp:c2'] = 250;
all['bnp:c3'] = 200;
all['bnstudy:season:8719249'] = { spec: 'bn-study-state/1', course_id: 'season:8719249', progress: { understood: 5, shaky: 11, unknown: 75 } };
all['bnidx:BV1:1'] = { notes: [] };
const courses = S.fromStorage(all);
ok('fromStorage：只挑 bnc 前缀', courses.length === 1 && courses[0].id === 'season:8719249', courses.length);
ok('fromStorage：丢掉没有 episodes 的坏数据', S.fromStorage({ 'bnc:x': { id: 'x' } }).length === 0);
const prog = S.progressOf(all);
ok('progressOf：取 bnp 的秒数', prog.c1 === 191 && prog.c3 === 200, prog);
ok('progressOf：不把 bnc 当进度', prog['season:8719249'] === undefined);

// status
const st = S.status(rec.value, prog, [all['bnstudy:season:8719249']]);
ok('status：c1 看完、c2 没看完（250 < 300*0.9）', st.watched === 1, st.watched);
ok('status：下一集是第 2 集', st.next && st.next.index === 2, st.next && st.next.index);
ok('status：下一集带上看到的位置', st.next && st.next.at === 250, st.next && st.next.at);
ok('status：跳转地址代入了时间', st.next && st.next.url.indexOf('t=250') > 0, st.next && st.next.url);
ok('status：掌握度带出来', st.mastery && st.mastery.understood === 5 && st.mastery.unknown === 75, st.mastery);
ok('status：百分比不会超过 100', st.pct <= 100, st.pct);
ok('status：剩余时长 = 总时长 - 已看', st.remaining === st.total - st.seen, { r: st.remaining, t: st.total, s: st.seen });

// 全部看完
const doneProg = { c1: 191, c2: 300, c3: 585, c4: 482 };
const st2 = S.status(rec.value, doneProg, []);
ok('status：全看完时 next 为 null', st2.next === null, st2.next);
ok('status：全看完 watched = 4', st2.watched === 4, st2.watched);
ok('status：没有掌握度时为 null', st2.mastery === null);

// masteryOf
ok('masteryOf：course_id 必须全等', S.masteryOf([{ course_id: 'video:BV1' }], 'season:8719249') === null);
ok('masteryOf：顶层字段也认', S.masteryOf([{ course_id: 'x', understood: 2, shaky: 1, unknown: 0 }], 'x').understood === 2);

// list + 文案
const rows = S.list(all, [all['bnstudy:season:8719249']]);
ok('list：返回一行', rows.length === 1 && rows[0].id === 'season:8719249', rows.length);
ok('list：标题保留', rows[0].title === '【从零开始的 AI 学习】', rows[0].title);
const metaLine = S.metaLine(rows[0]);
ok('metaLine：已看 1/4', metaLine.indexOf('已看 1/4') === 0, metaLine);
ok('metaLine：含掌握度', metaLine.indexOf('懂 5 · 半懂 11 · 没考 75') > 0, metaLine);
ok('metaLine：含总时长', metaLine.indexOf('小时') > 0 || metaLine.indexOf('分') > 0, metaLine);
const nl = S.nextLine(rows[0]);
ok('nextLine：继续第 2 集 + 时间', nl.indexOf('继续 第 2 集') === 0 && nl.indexOf('4:10') > 0, nl);
ok('nextLine：看完时说已看完', S.nextLine({ next: null }) === '已看完');

// 排序与上限
const all2 = JSON.parse(JSON.stringify(all));
const rec2 = JSON.parse(JSON.stringify(rec.value));
rec2.id = 'video:BV9'; rec2.title = '另一门课'; rec2.updated_at = '2030-01-01T00:00:00.000Z';
all2['bnc:video:BV9'] = rec2;
const rows2 = S.list(all2, []);
ok('list：按最近打开排序', rows2[0].id === 'video:BV9', rows2.map(function (r) { return r.id; }));
ok('list：limit 生效', S.list(all2, [], 1).length === 1);

// studystate.fromStorage 返回的是 {key, state} 包装（弹窗曾因此丢掌握度）
const wrapped = [{ key: 'bnstudy:season:8719249', state: all['bnstudy:season:8719249'] }];
const wrappedRow = S.list(all, wrapped)[0];
ok('list：studystate 的包装也能认出掌握度', S.metaLine(wrappedRow).indexOf('懂 5 · 半懂 11 · 没考 75') > 0, S.metaLine(wrappedRow));
const rows3 = S.list(all2, []).length;
all2['bnc:123'] = { id: '123', title: '坏记录', episodes: [] };
ok('list：没有集的记录不显示', S.list(all2, []).length === rows3, S.list(all2, []).length + ' vs ' + rows3);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
