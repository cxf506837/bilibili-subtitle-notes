# bili-notes 项目规则

## 交差（每次说「做好了 / 已验证」之前）

1. 单元测试：`node test/gate.test.mjs && node test/pipeline.test.mjs && node test/realdata.test.mjs && node test/align.test.mjs && node test/pages.test.mjs && node test/visual.test.mjs && node test/hardsub.test.mjs && node test/vote.test.mjs && node test/section.test.mjs` → 必须 0 失败。
2. 用户路径验收：`node test/accept.mjs`（真 Edge + 真扩展 + 真模型，随机挑 3 个不同分区视频 → 拖进度 → 切走回来 → 导出 → 无字幕视频看提示），控制台抛异常即失败，退出码非 0 不许交差。
3. 交差格式四行（prove-it）：做了什么 / 测试命令与通过数 / 截图路径 / 没验证到的。
4. 「已知问题」不是验收判据。样本里出现过的失败类型（无字幕、机翻字幕、硬字幕）必须有一条验收断言守着。

| 规则 | 由什么拦住 |
|---|---|
| 交差前跑通测试，附截图 | `test/*.test.mjs` + `test/accept.mjs` |
| 不许把「我自己挑的样本通过」当成「用户路径通过」 | `test/accept.mjs` 固定 3 个不同分区 + 1 个无字幕输入 |
| 字幕不是人话时必须显式说出来 | `BnGate.readability` + 状态条「疑似机翻」 |
| 字幕烧在画面里时不许只给一句「做不了」 | 失败面板必须给「用画面字幕试试」（本地 OCR 兜底） |
| 不许把「第一次取样通过」当成「字幕属于这个视频」 | `BnGate.gateSubtitle` 按哈希投票（`test/vote.test.mjs` 10 条） |
| 笔记看不懂就得先怀疑字幕、再怀疑模型 | 闸门投票 + 可读性闸 + 讲解层 prompt 的「解决什么问题开头」+ 反例正例（`test/section.test.mjs`） |

## 存档纪律（git，2026-11-14 起）

- 本仓库 **2026-11-14 才有第一版 git**（之前零历史，改崩了只能凭印象重写）。命令行统一用 `git`；没装 git 可用便携版 MinGit，把它的 `cmd` 目录加进 PATH（**已开着的终端要重开才认**）。
- **每完成一个小功能、且测试为绿 → 先跟用户确认，再 `git commit`。严禁在未存档的情况下大改。**
- 改崩了第一反应是 `git restore <文件>` 或 `git log` 找回上一个存档点，**不许**「照印象重新编一份」——那是视频里主角翻车的原样。
- 二进制大文件（图片/音频/视频/模型）不进存档，已有的 `.gitignore` 已排除 `dist/`、`test/ocr/build/`、`node_modules/`、`*.log`。

## 碰用户的浏览器（硬规则，违反就会丢 B站 登录态）

- **绝不** `Stop-Process -Force msedge`、也不 `taskkill /F`。`Default\Network\Cookies` 在运行中被独占锁，硬杀会让未落盘的 cookie 提交回滚，用户下次打开 B站 就是未登录（物证：`Default\Preferences` 的 `profile.exit_type = "Crashed"`）。
- 关浏览器只允许 `CloseMainWindow()` + 轮询进程自己退干净（≤60 秒）；超时就停手，让用户手动关。脚本：`edge-safe.ps1 -Close`。
- Edge 157 **有**「关闭 Microsoft Edge 后继续运行后台扩展和应用」这个设置：设置 → 系统和性能 → 系统，就在「启动增强」**下面第二行**。2026-11-14 实测截图 `dist/live-settings-system.png`：这个开关**开着**、「启动增强」**关着**；窗口全关后仍剩 7 个 msedge 进程，根进程命令行带 `--no-startup-window /prefetch:5`。要让 `-Backup` 成功，先让用户关掉这个开关，再关窗口。
- **别用「Preferences 里没有这个键」推断「UI 里没有这个设置」**：Chromium 的偏好只在值和默认不同时才落盘，默认值根本不写，键名也可能不叫你以为的那个。判断某个开关在不在，打开 UI 看实时状态并截图，不许凭记忆或凭文件缺失下结论（这条是我 2026-11-14 犯过的错，反证就是上面那张截图）。
- **开发者模式必须常开**：「加载解压缩的扩展」只在开发人员模式打开时启用，关掉等于停用扩展（卡片还在、图标没了）。这不是 bug，别去「修复」。
- 升级路径不碰进程：改源码 → `sync-my-edge.ps1`（同步到 `bili-notes-my/`）→ `edge://extensions` 点「重新加载」→ 视频页 F5。
- 详见 `docs/decisions-bilibili-video-summary.md` 的「v0.7.4 补充（2026-11-14）」。

| 规则 | 由什么拦住 |
|---|---|
| 绝不强杀 msedge | 有 git 了，可建 `check-browser-safety.mjs` 挂 `.git/hooks/pre-commit`（待建）；目前只靠 `edge-safe.ps1` 是唯一入口 |
| 关于用户机器的断言（设置项在不在、开关状态、版本号）必须现场取证 | 暂无自动检查 → 交差时附现场截图/命令输出，没有就不许下结论 |
