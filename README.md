# B站 可核对笔记

[![test](https://github.com/cxf506837/bilibili-subtitle-notes/actions/workflows/test.yml/badge.svg)](https://github.com/cxf506837/bilibili-subtitle-notes/actions/workflows/test.yml) 269 条离线测试 · MIT

跟播放头边看边写；每条结论都带**逐字引文 + 可点的时间**，点一下跳回原句。浏览器扩展（Edge / Chrome，MV3）。

![面板截图](docs/screenshot.png)

<sub>真机截图：左边是视频，右边每条结论都带蓝色引文竖条和时间戳；顶部的「两次取样一致 · 本地缓存 121.2k ≈ ¥0.182」就是闸门判定和这次花的钱。</sub>

## 为什么不缺一个「AI 总结视频」

B站 字幕接口**同一个视频多刷几次会返回不同文件**：作者自己的 401 秒课程连取 8 次，拿到 4 种不同内容（正确那份只出现 5 次，其余是电动车、超长字幕、HTML 错误页）。所以字幕进模型之前先过闸门——最多取样 5 次、按哈希投票，票数不够就判「不确定」让你重试，绝不拿一份可能属于别的视频的字幕去写笔记。

- 每条结论都能点回**原字幕句**，不是模型复述
- 拿不准就说拿不准：「两次取样一致」只说明取样稳定，不说明内容是这个视频的，所以界面不写"已验证"
- 你填的 API Key 只在本机，直连你自己填的端点，没有中间服务器

实测数据（60 条视频可用率、8 次取样 4 种文件、269 条离线测试）见 [docs/evidence.md](docs/evidence.md)；隐私说明见 [PRIVACY.md](PRIVACY.md)。

## 装（约 3 分钟）

1. 先**登录 B站**（未登录时字幕接口返回 0 轨）。
2. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`），打开右上角「开发人员模式」。
3. 点「加载解压缩的扩展」，选本仓库根目录（有 `manifest.json` 的那一层）。
4. 点工具栏拼图图标把「B站可核对笔记」钉出来；打开任意视频页点它，按「设置」选一家服务商（预设会自动填好 API Base 和模型），再填 Key。
   不想申请 Key 也行：字幕抓稳后直接点「导出」，得到逐句字幕全文（第 4 步之外的部分照常用）。

设置页内置 6 家预设：DeepSeek / OpenAI / 通义千问 / 智谱 GLM / Moonshot / 本机 Ollama。填**别的**域名会在保存时被挡——浏览器扩展只能连 `manifest.json` 里声明过的域名，没声明的域名在 MV3 里只会报一句 `TypeError: Failed to fetch`，分不清是断网、Key 错还是没权限，所以干脆在保存那一步就说清楚。想加服务商请开 issue。不想自己打包的话，[Releases](https://github.com/cxf506837/bilibili-subtitle-notes/releases) 里有打好的 zip（完整版带本地 OCR，轻量版 60 KB）。装不上、图标灰着、Key 存不住 → [docs/install.md](docs/install.md)。

## 用

- 面板跟着播放头走：跨过一段末尾才写这一段，没看过的地方不写、不剧透
- 跳过的区间画成虚线占位条：要么「总结这段」（花钱），要么「去看这段」
- 「导出」出 Markdown（frontmatter + 时间戳 + 可点链接），直接进 Obsidian
- **没填 API Key 也能用**：抓完字幕直接点「导出」，拿到的是逐句字幕全文（每句一个时间戳、可点回原句），只是没有 AI 整理的结论
- 关掉页面再打开，笔记从 IndexedDB 原样恢复，不重跑闸门、不重复花钱
- 失败会说清是哪一种：没有字幕 / 字幕只有一部分 / 字幕和视频对不上 / 没登录 / 清晰度太低 …
- 状态条不是绿色时会多出一个「复制诊断」：一键拿到版本 / 页面 / 字幕判定 / 端点（不含 Key），贴进 issue 就能复现

## 不做

- 只做 B站 桌面网页 `bilibili.com/video/`（含多 P 分集）。直播回放、番剧、课程不做
- 不上传视频、不建账号、没有服务器、不做云同步
- 「画面文字」「画面字幕兜底」在本机跑 OCR（约 29 MB，打包进完整版），识别一定有错字，别当原话

## 费用

70 分钟视频约 120 块 ≈ 6~7 万 input token，几分钱到一毛钱（按 ¥1/百万 token 的模型算）。面板右上角实时显示已花 token。

## 开发

```bash
node test/run-all.mjs             # 269 条离线测试，不需要网络、不花钱
node test/preview-server.mjs 8799 # 预览页 http://127.0.0.1:8799/video/BV1TESTPREVIEW
node test/zip.mjs [--lite]        # 打包
```

真机验收（要 Edge + 已登录 B站 + 自己的 Key）：`node test/accept.mjs`。

贡献边界见 [CONTRIBUTING.md](CONTRIBUTING.md)；为什么这么设计、每次真机跑出什么问题，见 [docs/decisions-bilibili-video-summary.md](docs/decisions-bilibili-video-summary.md)。

MIT
