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
