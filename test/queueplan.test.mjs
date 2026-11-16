import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function load() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'src/queueplan.js'), 'utf8'), ctx);
  return ctx.window.BnQueue;
}
const Q = load();
const block = (o) => Object.assign({ start: 0, end: 60 }, o);

test('todo: 只挑没笔记也没排队的块', () => {
  const a = block({});
  const b = block({ noteIndex: 0 });
  const c = block({ queued: true });
  const d = block({ noteIndex: 0, queued: true });
  assert.equal(Q.todo([a, b, c, d]).length, 1);
  assert.equal(Q.todo([a, b, c, d])[0], a);
});

test('todo: noteIndex 0 也算已出笔记（不能被当假值漏掉）', () => {
  assert.equal(Q.todo([block({ noteIndex: 0 })]).length, 0);
});

test('todo: 空输入与脏数据不炸', () => {
  assert.equal(Q.todo([]).length, 0);
  assert.equal(Q.todo(null).length, 0);
  assert.equal(Q.todo([null, undefined, 1, 'x']).length, 0);
});

test('label: 没跑时带段数', () => {
  assert.equal(Q.label(8, false), '整理全片（8 段）');
});

test('label: 跑起来是停止', () => {
  assert.equal(Q.label(8, true), '停止整理');
});

test('label: 0 段不写括号', () => {
  assert.equal(Q.label(0, false), '整理全片');
});

test('doneText/stopText: 数字进句子', () => {
  assert.match(Q.doneText(7, 9), /这次写了 7 段/);
  assert.match(Q.doneText(7, 9), /全片共 9 段/);
  assert.equal(Q.doneText(7), '全片整理完了：这次写了 7 段');
  assert.match(Q.stopText(3), /还有 3 段/);
});

test('cta: 全片都没笔记时给两个动作与花费', () => {
  const c = Q.cta([block({}), block({}), block({})]);
  assert.equal(c.title, '这个视频还没整理过');
  assert.match(c.text, /全片 3 段/);
  assert.equal(c.primary, '整理全片（3 段）');
  assert.equal(c.secondary, '只导出字幕全文');
  assert.match(c.cost, /2k token/);
  assert.match(c.cost, /¥0\.003/);
  assert.equal(c.todo, 3);
});

test('cta: 已经有笔记就不出现', () => {
  assert.equal(Q.cta([block({ noteIndex: 0 })]), null);
});

test('cta: 正在排队的块不算待整理（否则文案数字虚高）', () => {
  assert.equal(Q.cta([block({ queued: true })]), null);
  const c = Q.cta([block({ queued: true }), block({})]);
  assert.equal(c.todo, 1);
  assert.equal(c.primary, '整理全片（1 段）');
});

test('cta: 空输入与脏数据不炸', () => {
  assert.equal(Q.cta([]), null);
  assert.equal(Q.cta(null), null);
  assert.equal(Q.cta([null, 1, 'x']), null);
});

test('cta: 花费至少 1k，不说 ¥0.000', () => {
  const c = Q.cta([block({})]);
  assert.match(c.cost, /1k token/);
  assert.doesNotMatch(c.cost, /0k token/);
});

test('cta: 已经有几段笔记时改口径，不谎称"还没整理过"', () => {
  const c = Q.cta([block({ noteIndex: 0 }), block({}), block({})], { notes: 1 });
  assert.equal(c.title, '还有 2 段没整理');
  assert.match(c.text, /已经写了 1 段/);
  assert.equal(c.todo, 2);
});

test('cta: notes 传脏数据当 0 处理', () => {
  const c = Q.cta([block({})], { notes: 'x' });
  assert.equal(c.title, '这个视频还没整理过');
});
