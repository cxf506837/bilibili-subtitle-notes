# 学习包 → agent 的桥

扩展导出学习包（文件名以 `bn-study-` 开头）后，「交给 agent」那句话已经在剪贴板里。
这个目录里的脚本只再做一件事：**新学习包落盘的瞬间，把 DeepSeek Harness 窗口拉到前面**。
不点击、不输入、不发送——你的动作只剩两步：**Ctrl+V → Enter**。

## 为什么不做「自动发送」

本机 DSH 的 web 接口带鉴权（`http://127.0.0.1:<port>/api/*` 无 token 一律 401），
要么去 CDP 里捞 boot token、要么做 UI 自动化；两者都会在你不知情时把消息发出去，
而且 DSH 一升级就可能失效。把动作停在「窗口到前面、文字在剪贴板」，既稳又不会替你按下回车。

## 装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

它做三件事：往「启动」文件夹放一个快捷方式（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\bn-agent-bridge.lnk`）、
停掉旧的监听进程、在后台起一个新的（`-WindowStyle Hidden`，不弹窗）。

卸载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

## 只想试一下

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File focus-dsh.ps1 -Test   # 只报告找到哪个窗口
powershell -NoProfile -ExecutionPolicy Bypass -File focus-dsh.ps1          # 真把它拉到前面
powershell -NoProfile -ExecutionPolicy Bypass -File bn-agent-bridge.ps1 -RunOnce   # 跑一次就退出
```

## 日志

`%LOCALAPPDATA%\bn-agent-bridge\bridge.log`（超过 200 KB 轮转到 `bridge.log.1`）。
正常一行长这样：

```
2026-11-17 14:02:11  已拉到前面（新文件 bn-study-【从零开始的 AI 学习】（正片 · 25 集学习包）.json）· DeepSeek Harness
```

## 它的边界

- 只认**文件名前缀 + 下载目录**（默认 `%USERPROFILE%\Downloads`，可用 `-DownloadsDir` 改），不看内容。
- 8 秒内只拉一次（浏览器下载会连续触发几个文件事件）。
- 找不到窗口时只写日志、不报错（agent 没开、进程名不叫 DeepSeek 都会这样；用 `-ProcessLike` 改匹配）。
- 拉窗口会**抢走焦点**——这就是它的用途，但如果你正在打字，它会打断你。
