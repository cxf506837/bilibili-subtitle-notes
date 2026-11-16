// 诊断信息：出问题时用户一键复制这段贴到 issue。格式错、或者把 Key 带出去，都是事故。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const ctx = { window: {}, URL };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'src/summarize.js'), 'utf8'), ctx);
const S = ctx.window.BnSum;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const info = {
  version: '0.7.3',
  url: 'https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999&vd_source=abc&p=2',
  title: '测试标题',
  verdict: 'stable',
  votes: 4,
  sentences: 412,
  trackLan: 'ai-zh',
  totalPages: 5,
  page: 2,
  status: 'bad',
  detail: '没有字幕',
  endpoint: 'api.deepseek.com',
  model: 'deepseek-chat',
  hasKey: true,
  ocr: true,
  at: '2026-11-14T12:00:00.000Z',
  apiKey: 'sk-should-never-appear',
};
const t = S.diagText(info);

ok('第一行是版本 + 时间', t.startsWith('bili-notes 0.7.3 · 2026-11-14T12:00:00.000Z'), t.split('\n')[0]);
ok('带页面地址', t.indexOf('页面: https://www.bilibili.com/video/BV1xx411c7mD?p=2（P2/5）') > 0, t);
ok('去掉推广参数', t.indexOf('spm_id_from') < 0 && t.indexOf('vd_source') < 0);
ok('带标题', t.indexOf('标题: 测试标题') > 0);
ok('带字幕状态与取样', t.indexOf('字幕: stable · 4 次取样一致 · ai-zh · 412 句') > 0, t);
ok('带端点与模型', t.indexOf('端点: api.deepseek.com · 模型 deepseek-chat · Key 已填') > 0, t);
ok('带 OCR 可用', t.indexOf('本机 OCR: 可用') > 0);
ok('带状态与详情', t.indexOf('状态: bad · 没有字幕') > 0, t);
ok('绝不包含 Key', t.indexOf('sk-') < 0 && t.indexOf('apiKey') < 0);

const noKey = S.diagText({ version: '0.7.3', hasKey: false, model: 'm', endpoint: 'host' });
ok('没填 Key 时写明未填', noKey.indexOf('Key 未填') > 0, noKey);
ok('没有 ocr 字段就不写这一行', noKey.indexOf('本机 OCR') < 0);
ok('ocr 为 false 时写明不可用', S.diagText({ ocr: false }).indexOf('不可用') > 0);

const single = S.diagText({ version: '0.7.3', url: 'https://www.bilibili.com/video/BV1xx', title: 'T', verdict: 'single', sentences: 3, totalPages: 1, page: 1 });
ok('单 P 不写 P1/1', single.indexOf('（P') < 0, single);
ok('单次取样不编造次数', single.indexOf('次取样一致') < 0);
ok('缓存恢复的字幕会说明来源', S.diagText({ version: '1.4.8', verdict: 'stable', cache: 'yes' }).indexOf('字幕来源: 上次存下来的') > 0);
ok('现取的字幕不写来源', S.diagText({ version: '1.4.8', verdict: 'stable', cache: 'no' }).indexOf('字幕来源') < 0);

const messy = S.diagText({ version: '0.7.3', title: 'A\nB   C', detail: 'line1\nline2' });
ok('标题与详情里的换行被压平', messy.indexOf('标题: A B C') > 0 && messy.indexOf('line1 line2') > 0, messy);

const longTitle = 'x'.repeat(300);
ok('超长标题截到 160', S.diagText({ version: '1', title: longTitle }).indexOf('x'.repeat(161)) < 0);
ok('超长详情截到 200', S.diagText({ version: '1', status: 'bad', detail: 'y'.repeat(400) }).indexOf('y'.repeat(201)) < 0);
ok('空对象不崩', typeof S.diagText({}) === 'string' && S.diagText({}).startsWith('bili-notes ?'));
ok('undefined 不崩', typeof S.diagText() === 'string');
ok('坏 URL 原样保留不抛', S.diagText({ url: 'not a url' }).indexOf('页面: not a url') > 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
