// 本地 agent 接口：端点只许本机 / 请求体形状 / 失败文案，以及收件端真的能收。
// 这套断言的意义：这份请求体里有整份学习包，发错地址等于把用户的学习资料送出本机。
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function load(file) {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ctx = createContext({ console });
  ctx.globalThis = ctx;
  runInContext(src, ctx);
  return ctx;
}
const H = load('agenthook.js').BnAgentHook;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

// ---- 端点：只许本机 ----
ok('127.0.0.1 + 端口 + 路径', H.isLocalEndpoint('http://127.0.0.1:8791/bn-pack') === true);
ok('127.0.0.1 裸地址', H.isLocalEndpoint('http://127.0.0.1') === true);
ok('localhost', H.isLocalEndpoint('http://localhost:8791/bn-pack') === true);
ok('127.x.y.z 整段', H.isLocalEndpoint('http://127.1.2.3:9000/bn-pack') === true);
ok('[::1]', H.isLocalEndpoint('http://[::1]:8791/bn-pack') === true);
ok('前后空格会被去掉', H.isLocalEndpoint('  http://127.0.0.1:8791/bn-pack  ') === true);
ok('外部域名拒绝', H.isLocalEndpoint('https://example.com/bn-pack') === false);
ok('127.0.0.1.evil.com 拒绝（前缀骗术）', H.isLocalEndpoint('http://127.0.0.1.evil.com/bn-pack') === false);
ok('localhost.evil.com 拒绝', H.isLocalEndpoint('http://localhost.evil.com/bn-pack') === false);
ok('非 http 拒绝', H.isLocalEndpoint('ftp://127.0.0.1/bn-pack') === false);
ok('https 到回环也不收（收件端只跑 http）', H.isLocalEndpoint('https://127.0.0.1:8791/bn-pack') === false);
ok('端口越界拒绝', H.isLocalEndpoint('http://127.0.0.1:70000/bn-pack') === false);
ok('空值拒绝', H.isLocalEndpoint('') === false && H.isLocalEndpoint(null) === false && H.isLocalEndpoint(undefined) === false);
ok('cleanEndpoint 合法原样返回', H.cleanEndpoint(' http://127.0.0.1:8791/bn-pack ') === 'http://127.0.0.1:8791/bn-pack');
ok('cleanEndpoint 非法返回空串', H.cleanEndpoint('https://example.com/x') === '');

// ---- 请求体 ----
const packWrap = {
  doc: {
    spec: 'bn-study-pack/1',
    course: { id: 'season:8719249', title: '从零开始的 AI 学习' },
    scope: 'S2',
    counts: { episodes: 9, notes: 46, concepts: 91, anchors: 215 },
  },
  json: '{"spec":"bn-study-pack/1"}',
  md: '# md',
  baseName: 'bn-study-x',
};
const p = H.buildPayload({ pack: packWrap, text: '去读最新的', file: { name: 'a.json', size: 123 }, now: Date.UTC(2026, 10, 17, 7, 0, 0) });
ok('spec 固定', p.spec === 'bn-agent-hook/1', p.spec);
ok('发的是学习包文档本身，不是 {doc,json,md} 包装', p.pack && p.pack.spec === 'bn-study-pack/1' && p.pack.course.id === 'season:8719249');
ok('course 摘要', p.course.id === 'season:8719249' && p.course.title === '从零开始的 AI 学习');
ok('counts 归一', p.counts.episodes === 9 && p.counts.anchors === 215);
ok('file 带着文件名', p.file.name === 'a.json' && p.file.size === 123);
ok('人话原样带过去', p.text === '去读最新的');
ok('sentAt 是 ISO', p.sentAt === '2026-11-17T07:00:00.000Z', p.sentAt);
const p2 = H.buildPayload({});
ok('空输入不炸，counts 全是 0', p2.counts.episodes === 0 && p2.counts.notes === 0 && p2.course.id === '');

// ---- 卡片上的那一行 ----
ok('成功带集数与路径', H.resultLine({ ok: true, saved: 'D:\\inbox\\a.json', counts: { episodes: 2 } }) === '已经送到本地 agent（2 集）：D:\\inbox\\a.json');
ok('成功但没集数', H.resultLine({ ok: true, saved: 'x.json' }) === '已经送到本地 agent：x.json');
ok('没填端点', H.resultLine({ ok: false, reason: 'no-endpoint' }).indexOf('127.0.0.1:8791') >= 0);
ok('超时', H.resultLine({ ok: false, reason: 'timeout' }).indexOf('3 秒超时') >= 0);
ok('连不上', H.resultLine({ ok: false, reason: 'network' }).indexOf('收件端没启动') >= 0);
ok('回包看不懂', H.resultLine({ ok: false, reason: 'bad-response' }).indexOf('日志') >= 0);
ok('未知原因带上原文', H.resultLine({ ok: false, error: 'boom' }).indexOf('boom') >= 0);

// ---- 收件端：真的收一次 ----
const mod = await import(new URL('../tools/agent-bridge/bn-agent-hook.mjs', import.meta.url));
ok('文件名去掉路径', mod.safeName('../../etc/passwd.json') === 'passwd.json', mod.safeName('../../etc/passwd.json'));
ok('非法字符替换掉', mod.safeName('a:b?c*.json') === 'a_b_c_.json', mod.safeName('a:b?c*.json'));
ok('没有扩展名补 .json', mod.safeName('bn-study-x') === 'bn-study-x.json');
ok('空文件名兜底', mod.safeName('') === 'bn-study-pack.json');

const inbox = join(tmpdir(), 'bn-hook-test-' + process.pid + '-' + Date.now());
const port = 18000 + (process.pid % 900);
const child = spawn(process.execPath, [
  new URL('../tools/agent-bridge/bn-agent-hook.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '--port', String(port), '--inbox', inbox, '--no-focus',
], { stdio: 'ignore' });
const base = 'http://127.0.0.1:' + port;
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { const r = await fetch(base + '/bn-ping'); up = r.ok; } catch (e) {}
}
ok('收件端能起来', up);
if (up) {
  const ping = await fetch(base + '/bn-ping').then((r) => r.json());
  ok('ping 报 spec 与目录', ping.ok && ping.spec === 'bn-agent-hook/1' && ping.inbox === inbox, ping);
  const body = H.buildPayload({ pack: packWrap, text: '去读最新的', file: { name: 'bn-study-【课】（S2 · 9 集学习包）.json', size: 10 } });
  const r1 = await fetch(base + '/bn-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j1 = await r1.json();
  ok('投递成功', r1.status === 200 && j1.ok === true, j1);
  ok('落盘文件名就是学习包名', /bn-study-【课】（S2 · 9 集学习包）\.json$/.test(j1.saved), j1.saved);
  ok('落盘内容是学习包本身', existsSync(j1.saved) && JSON.parse(readFileSync(j1.saved, 'utf8')).spec === 'bn-study-pack/1');
  ok('目录里有 latest.json', existsSync(join(inbox, 'latest.json')));
  const latest = JSON.parse(readFileSync(join(inbox, 'latest.json'), 'utf8'));
  ok('latest 指向刚那份 + 带 counts', latest.file === j1.saved && latest.counts.episodes === 9, latest);
  const r2 = await fetch(base + '/bn-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j2 = await r2.json();
  ok('同名重发不覆盖上一份', j2.saved !== j1.saved && / \(2\)\.json$/.test(j2.saved), j2.saved);
  ok('两份都在', readdirSync(inbox).filter((f) => f.endsWith('.json') && f !== 'latest.json').length === 2);
  const bad = await fetch(base + '/bn-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: 'wrong' }) });
  ok('spec 不对直接 400', bad.status === 400 && (await bad.json()).ok === false);
  const notJson = await fetch(base + '/bn-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
  ok('非 JSON 400', notJson.status === 400);
  const wrongPath = await fetch(base + '/whatever', { method: 'POST', body: '{}' });
  ok('别的路径 404', wrongPath.status === 404);
}
child.kill();
try { rmSync(inbox, { recursive: true, force: true }); } catch (e) {}

// 自动发现：从收件端地址推出 /bn-ping。推导错了只表现成「连不上」，所以单独测。
ok('pingUrl：带路径的地址只留 origin', H.pingUrl('http://127.0.0.1:8791/bn-pack') === 'http://127.0.0.1:8791/bn-ping');
ok('pingUrl：只有 origin 也行', H.pingUrl('http://127.0.0.1:8791') === 'http://127.0.0.1:8791/bn-ping');
ok('pingUrl：多级路径切在第一个斜杠', H.pingUrl('http://localhost:9000/a/b') === 'http://localhost:9000/bn-ping');
ok('pingUrl：非回环推导出空串', H.pingUrl('https://example.com/x') === '' && H.pingUrl('http://evil.com/x') === '');
ok('pingUrl：空值不炸', H.pingUrl('') === '' && H.pingUrl(null) === '');
console.log('agenthook: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
