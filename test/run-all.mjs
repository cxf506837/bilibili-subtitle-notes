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
  'endpoint.test.mjs',    // 设置页端点白名单
  'options.test.mjs',     // 设置页真实代码路径（假 DOM）
  'transcript.test.mjs', // 无 Key 时的字幕全文导出
  'batch.test.mjs',      // 合集/多 P 批量导出
  'diag.test.mjs',      // 一键复制的诊断信息
  'chat.test.mjs',      // 后台请求体 / 400 错误映射（提问走 json:false）
  'searchindex.test.mjs', // 跨视频笔记检索（索引压缩 / 关键词匹配 / 跳回）
  'studystate.test.mjs',  // 学习状态：剪贴板解析 / 掌握度 / 对应课程
  'course.test.mjs',      // 课程目录：合集/多P/单集、进度、继续上次
  'coursestore.test.mjs', // 课程存档：点图标时的「接着学」列表
  'queueplan.test.mjs',   // 整理全片：挑哪些块、按钮文案
  'budget.test.mjs',      // 花的是用户的钱：分项计费 / 上限闸 / 估价
  'season.test.mjs',      // 课程选择性导出：只拼勾中的集
  'concepts.test.mjs',    // 概念抽取：切块 / 只认句子 id / 跨集合并
  'conceptview.test.mjs', // 概念视图：跨集合并 / 去噪标记 / 按集分组 / 掌握度
  'study.test.mjs',       // 学习包：JSON 结构 + Markdown 版面
  'packhandoff.test.mjs', // 交给 agent 的那句话：文件名 / 找不到就问 / spec 校验
  'studypage.test.mjs', // 学习页：挑课程 / 进度 / 掌握度 / 笔记数 / 按词过滤概念
  'studylink.test.mjs', // 学习页链接：课程 id + 视角 → 扩展页 URL
  'studyplan.test.mjs',   // agent 侧：裁剪 / 救回 / 图 / 掌握度状态机
  'cpack.test.mjs', // 「交给 agent」没勾集数时也必须给反应
  'exporthint.test.mjs', // 合集页点「导出」时提醒一次「交给 agent」在哪
  'packcard.test.mjs', // 导出学习包后的结果卡片：文件名 + 复制 + 存 Markdown
  'agentbridge.test.mjs', // 小助手：盯下载目录 → 把 agent 窗口拉到前面
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
