// 跑全部离线测试（不碰 Edge、不碰 B站、不花钱）。CI 和本地都用这一条。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILES = [
  'gate.test.mjs',        // 字幕闸门判据
  'vote.test.mjs',        // 多份字幕按哈希投票
  'pages.test.mjs',       // 分 P 解析
  'section.test.mjs',     // 小节标题 + 讲解层 prompt
  'visual.test.mjs',      // 画面文字挂载
  'hardsub.test.mjs',     // 画面字幕：裁带 / 清洗 / 拼句
  'pipeline.test.mjs',    // 切块 → prompt → 校验
  'realdata.test.mjs',    // 60 条真实样本回归
];

let failed = 0;
for (const f of FILES) {
  const p = fileURLToPath(new URL('./' + f, import.meta.url));
  const r = spawnSync(process.execPath, [p], { encoding: 'utf8' });
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0] || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f.padEnd(22) + tail);
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
console.log(failed ? failed + ' 个测试文件失败' : '全部通过');
process.exit(failed ? 1 : 0);
