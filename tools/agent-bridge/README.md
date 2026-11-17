# 学习包 → agent 的桥

两条路，选一条（也可以都装）：

| 路 | 你要做什么 | 效果 | 需要 node |
|---|---|---|---|
| **A. 收件端**（推荐） | 装一次收件端，扩展设置里勾「导出后自动送到本机 agent」 | 导出即投递：学习包落到本机目录，并把 agent 窗口拉到前面 | 要 |
| **B. 下载目录监听** | 装一次监听脚本 | 只把 agent 窗口拉到前面；文件本来就在下载目录 | 不要 |

## A. 收件端：导出即投递（1.4.33 起）

扩展把整份学习包 `POST` 到 `http://127.0.0.1:8791/bn-pack`（**只许 127.0.0.1 / localhost**，填外部域名会被设置页拒绝）。
收件端把它写进 `%LOCALAPPDATA%\bn-agent-bridge\inbox\`，同时更新 `latest.json`。

```powershell
# 装成开机自动跑（隐藏窗口），并立刻起一个
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Hook

# 只想手动跑一次
powershell -NoProfile -ExecutionPolicy Bypass -File start-hook.ps1

# 自测
Invoke-RestMethod http://127.0.0.1:8791/bn-ping
```

然后在扩展设置页勾上「导出学习包后自动送到我本机跑的 agent」，保存。之后每次点「交给 agent（N 集）」，面板卡片上会多一行：

```
已经送到本地 agent（2 集）：%LOCALAPPDATA%\bn-agent-bridge\inbox\bn-study-…json
```

收件端只做一件事：**把文件落盘**。它不解析、不调用模型、不联网。`latest.json` 里带 `course / scope / counts / file / text`，你的 agent 读它就知道「最新那份是什么、给谁用、原话在哪」。

协议（`spec: bn-agent-hook/1`）：

```
POST /bn-pack   {spec, sentAt, source, course:{id,title}, scope, counts:{episodes,notes,concepts,anchors}, file:{name,size}, text, pack}
               → 200 {ok:true, saved:"<绝对路径>", counts, bytes}
               → 400 spec 不对 / 不是 JSON / 缺 pack；413 超过 8MB
GET  /bn-ping  → 200 {ok:true, spec, inbox, pid}
```

### 让 agent 自己接

任何能读文件、能收 HTTP 的 agent 都能接：

1. 最简单：让 agent「读 `%LOCALAPPDATA%\bn-agent-bridge\inbox\latest.json`，再读里面的 `file`」。
2. 或者你自己起一个兼容 `/bn-pack` 的服务，把端口填进扩展设置。
3. 端口不是 8791 也行：设置里改地址，`start-hook.ps1 -Port 9000` 对应改。

## B. 下载目录监听：只把窗口拉到前面

扩展导出学习包（文件名以 `bn-study-` 开头）后，「交给 agent」那句话已经在剪贴板里。
这个目录里的 `bn-agent-bridge.ps1` 只再做一件事：**新学习包落盘的瞬间，把 DeepSeek Harness 窗口拉到前面**。
不点击、不输入、不发送——你的动作只剩两步：**Ctrl+V → Enter**。

## 为什么以前不做「自动发送」，现在又做了

以前说的是**替用户往 DSH 会话里发消息**：那需要 token 或 UI 自动化，会越过「用户按回车」这一步，DSH 一升级就失效。实测本机 DSH 的 web 接口（`http://127.0.0.1:62029/api/health`、`/api/sessions`）不带 token 一律 **401**，想「自动发一条消息」就只能去偷 token 或者模拟键盘——这两件都不做：前者等于冒充用户，后者一升级就失效。
现在做的是**往用户自己起的本机收件端点投递文件**：协议是公开的、地址只能是 127.0.0.1、收件端由用户自己跑（或你自己写一个）。发什么、发给谁，用户完全掌控。两者的区别是「替用户操作他的工具」和「把东西放在用户指定的门口」。

## 装（B 路）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

它做三件事：往「启动」文件夹放一个快捷方式、停掉旧的监听进程、在后台起一个新的（`-WindowStyle Hidden`，不弹窗）。

卸载（两条路一起卸）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

## 只想试一下（B 路）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File focus-dsh.ps1 -Test   # 只报告找到哪个窗口
powershell -NoProfile -ExecutionPolicy Bypass -File focus-dsh.ps1          # 真把它拉到前面
powershell -NoProfile -ExecutionPolicy Bypass -File bn-agent-bridge.ps1 -RunOnce   # 跑一次就退出
```

## 日志

`%LOCALAPPDATA%\bn-agent-bridge\bridge.log`（超过 200 KB 轮转到 `bridge.log.1`）。两条路都写这一个文件。

```
2026-11-17 14:02:11  已拉到前面（新文件 bn-study-【从零开始的 AI 学习】（正片 · 25 集学习包）.json）· DeepSeek Harness
2026-11-17 15:41:02  收到学习包 %LOCALAPPDATA%\bn-agent-bridge\inbox\bn-study-….json（2 集）
```

## 它的边界

- 收件端只绑 `127.0.0.1`，不接受外部连接；请求体上限 8MB。
- 同名文件不覆盖，后到的加「 (2)」——同一个包重发很常见。
- B 路只认**文件名前缀 + 下载目录**（默认 `%USERPROFILE%\Downloads`，可用 `-DownloadsDir` 改），不看内容。
- 8 秒内只拉一次（浏览器下载会连续触发几个文件事件）。
- 找不到窗口时只写日志、不报错（agent 没开、进程名不叫 DeepSeek 都会这样；用 `-ProcessLike` 改匹配）。
- 拉窗口会**抢走焦点**——这就是它的用途，但如果你正在打字，它会打断你。
