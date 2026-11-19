# 安装与排错

## 装到自己的浏览器（推荐）

1. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`）。
2. 打开右上角「开发人员模式」。
3. 点「加载解压缩的扩展」，选**本仓库根目录**（有 `manifest.json` 的那一层）。
4. 点地址栏右边的拼图图标（`⋮⋮`），把「B站字幕笔记」钉到工具栏。
5. 打开任意 B站 视频页，点图标（或等浮层自己出来），点面板里的「设置」填 API。

升级：拉新版本覆盖目录 → 在该扩展卡片上点「重新加载」。

> 报 issue 前先点一次面板上的「复制诊断」（状态条不是绿色时会出现），把复制到的文字贴进 issue。它包含版本、页面 BV 号、字幕判定、端点域名，**不包含 API Key**。

## 装不上时按这个顺序查（Edge 157 实测）

- **命令行走不通**：`msedge --load-extension=...` 从 Edge 136 起会把扩展记成「不支持的命令行扩展」并禁用（`disable_reasons` 里是 1<<24）；Chrome 137 起同样忽略这个参数（157 实测加了 `--enable-unsafe-extension-debugging` 也还是不加载，targets 里连扩展的 service worker 都没有）。别再试，只能走「加载解压缩的扩展」。
- **只在 Edge 上验过四步**：上面第 1–4 步是我在 Edge 157 + 干净用户目录里按顺序真机走通的；Chrome 同属 MV3、代码路径一样，但我没有在 Chrome 真机上装过（它拦了命令行加载，只能手点），遇到问题请开 issue。
- **选了目录却没反应**：同一个路径以前加载过、又被 Edge 记成损坏条目时，再用这个路径加载会静默失败。把目录**复制成新名字**（比如 `bili-notes-my`）再选——解压缩扩展的 id 由路径算出，换路径就是换 id。
- **换路径后 Key「丢了」**：storage 是按扩展 id 存的。把 `Local Extension Settings/<旧id>` 整个拷到 `Local Extension Settings/<新id>`，再点「重新加载」；重填也只要 30 秒。
- **图标钉不上工具栏**：先把窗口最大化再点拼图图标。
- **长期挂一条黄条「此扩展不是来自任何已知来源」**：正常（未上架时都有），别点「删除」。

## 两个包

| 包 | 大小 | 说明 |
| --- | --- | --- |
| 完整包 | 约 11.2 MB（42 个文件） | 带本地 OCR 运行时（`vendor/ocr`，解压后 29 MB），「画面文字」「画面字幕」可用 |
| 轻量包 | 约 161 KB（36 个文件） | 不含本地 OCR，只做「跟着字幕写笔记」；界面上**不会出现**那两个按钮（启动时探一次文件在不在） |

自己打包：

```bash
node test/zip.mjs          # 完整（缺 OCR 资源会直接报错，不会打出残缺包）
node test/zip.mjs --lite   # 轻量
```

> `vendor/ocr` 体积大（约 29 MB）不进 git。两种拿法：直接下载 [https://github.com/cxf506837/bilibili-subtitle-notes/releases](https://github.com/cxf506837/bilibili-subtitle-notes/releases) 里打好的完整包；或者下载其中的 `ocr-assets.zip` 解压到 `vendor/ocr/` 再自己打包。缺文件时 `zip.mjs` 会明确告诉你缺哪个，不会静默打出一个没有 OCR 的"完整包"。

## 需要的前置条件

- **登录 B站**：未登录时字幕接口返回 0 轨（`need_login_subtitle: true`）。这不是可选优化。
- **不填 API 也行**：字幕抓稳之后直接点「导出」，拿到的是逐句字幕全文（每句一个时间戳、可点回原句），只是没有 AI 整理出来的结论。想升级成带引文的笔记，再回来填 Key，不用重抓字幕。
- **一个 OpenAI 兼容的 API**：设置页第一项是「服务商预设」，选一家会自动填好 API Base（到 `/v1` 为止）和模型名，你只需要填 Key。预设 6 家：DeepSeek / OpenAI / 通义千问（`dashscope.aliyuncs.com/compatible-mode/v1`）/ 智谱 GLM（`open.bigmodel.cn/api/paas/v4`）/ Moonshot / 本机 Ollama（`http://localhost:11434/v1`）。Key 只存 `chrome.storage.local`，只发给你填的端点。
- **为什么不能顺手填别家的域名**：浏览器扩展只能连 `manifest.json` 里声明过的域名。对没声明的域名发请求，MV3 只会给你一句 `TypeError: Failed to fetch`，和断网、DNS 错、Key 错**长得一模一样**。所以保存时就会拦下来，并告诉你现在允许哪几家——而不是让你去猜那句「请求失败」是什么意思。要加服务商请开 issue。
- **画面文字 / 画面字幕要 720p 以上**：截的是视频解码像素（不是屏幕截图，面板和弹幕不会被截进去），但 360p 正文只有 8~10 像素高，OCR 认不出来；480p 会被明确拒绝。未登录时 B站 最高 480p。
