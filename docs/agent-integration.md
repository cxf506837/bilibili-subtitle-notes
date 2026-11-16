# 交给 agent 的学习包（spec bn-study-pack/1）

课程条里勾几集 → 点「交给 agent」，会下载两个文件：

- `课程名（S2 · 9 集学习包）.json` —— 机器读，这个文件就是本 spec 的实现
- `课程名（S2 · 9 集学习包）.md` —— 人读，内容与 JSON 一致

这份包不是「视频摘要」。它是**结构 + 锚点**：哪几集、每集多久、字幕可不可信、每个概念在第几集第几秒被讲到、原话是什么。
有了它，agent 不用看视频，也能知道自己该让学生学什么、从哪一段开始讲、讲完怎么考。

## 1. 顶层结构

```json
{
  "spec": "bn-study-pack/1",
  "generated_at": "2026-11-16T04:25:42.920Z",
  "goal": "三周内能独立用 DSH 跑通一个自动化任务",
  "course": { "id": "season:8719249", "title": "【从零开始的 AI 学习】", "kind": "season",
              "url": "https://www.bilibili.com/video/BV1BgH36DE7y",
              "episodes_total": 24, "duration_sec": 10655 },
  "scope": "S2",
  "episodes": [ /* 见 2 */ ],
  "concepts": [ /* 见 3 */ ],
  "counts": { "episodes": 2, "notes": 0, "concepts": 24, "anchors": 54 }
}
```

| 字段 | 说明 |
| --- | --- |
| `spec` | 格式版本。**读到不认识的版本就停下来**，不要猜字段含义 |
| `goal` | 用户在设置页填的学习目标；没填是空字符串。agent 应按它裁剪，而不是把全部概念都教一遍 |
| `course.title` / `course.id` | 课程名 / 合集 id（不是 B 站视频 id） |
| `course.kind` | `season`（合集）/ `pages`（多 P）/ `single` |
| `course.duration_sec` | 整个课程的总时长，单位秒 |
| `scope` | 这次导出的是哪一段：`S2` / `选中 3 集` / `全部 24 集` |
| `counts` | 便于快速判断包有多大，不要靠它做业务判断（以数组长度为准） |

## 2. `episodes[]`

```json
{
  "index": 15,
  "label": "S2-0",
  "section": "正片",
  "title": "S2-0 给你一个学 AI 的理由",
  "bvid": "BV1pwnj6BEMP",
  "cid": "43030022264",
  "url": "https://www.bilibili.com/video/BV1pwnj6BEMP",
  "duration": 346,
  "verdict": "single",
  "votes": 1,
  "track": "ai-zh",
  "notes_n": 0,
  "notes": [],
  "concepts": ["AI coding", "许愿式编程"]
}
```

- `verdict` 是这份字幕的**可信度**，不是质量评分：
  - `stable`：多次取样拿到同一份文件（可用）
  - `single`：只拿到一份、没能复核（可用，但要在学习材料里标明）
  - 其它值不会出现在 `episodes[]` 里 —— 没过闸门的集会写进 Markdown 末尾的「没导出的集」
- `notes[]`：用户在看这一集时已经整理过的要点，`t` 是秒，`one` 是一句话结论，`summary` 是那一段在讲什么。**很多集是 0 条**（只验证了字幕，没看过），这是正常的。
- `concepts[]`：本集抽到的概念名，指向顶层 `concepts[]` 里的条目。

## 3. `concepts[]`：这一版的核心

```json
{
  "name": "程序是AI最趁手的工具",
  "kind": "概念",
  "def": "让 agent 写脚本处理重复操作，比让大模型逐张看图省 token",
  "aliases": ["脚本优先"],
  "anchors": [
    { "ep": 15, "ep_label": "S2-0", "ep_title": "S2-0 给你一个学 AI 的理由",
      "t": 98, "at": "1:38",
      "url": "https://www.bilibili.com/video/BV1pwnj6BEMP?t=98",
      "quote": "程序才是 AI 最趁手的工具" }
  ]
}
```

规矩（这些是这个项目的立身之本，不是可选项）：

1. **`quote` 是字幕原句，逐字**。模型只被允许给句子 id，引文和时间戳都由本地按 id 取，所以它不能编。
2. **`url` 能直接点回那一秒**（`?t=秒`），agent 想让学生「去听原话」时用它。
3. 同名 / 别名概念已经合并，`anchors` 是跨集的全部出现位置（同一集 3 秒内算一条，最多 12 条）。
4. `name` 是视频里的实际叫法，可能是口语（`GH`、`star`）；`def` 是一句人话，不是百科定义。
5. 概念只从**这次勾选的集**里抽；没勾的集不会有概念，也不会凭空补。

## 4. agent 应该怎么用

最小闭环（阶段 C 会按这个做出 skill）：

1. 读 JSON，按 `goal` 先判断：这份课里哪些概念是必须的、哪些可以跳过（`anchors.length` 少且不在目标路径上的，可以直接丢）。
2. 用 `concepts[].anchors[].ep` 建依赖图（Mermaid `graph TD`）：同一概念出现在多集，就是一个天然的「前面讲过、后面用到」的边。
3. 排出学习顺序：同一概念第一次出现的 `ep`/`t` 是要先学的点，后面的 `ep`/`t` 是复习点。
4. 讲完一个概念，就用 `quote` 出题（「这句话里的 `X` 指什么」）；答不出来就退回 `url` 那一秒重看。
5. 学完写 `study-state.json`（格式见阶段 D；现在还没做回流，先落成文件即可）。

需要**逐句原文**时，配合同一次勾选导出的字幕文件（课程条「导出选中」）一起给 agent：学习包负责结构，字幕文件负责全文。

## 5. 现在做不到的（别替它吹）

- 包里的概念是**模型抽的**，可能漏、可能用词怪；`quote` 与时间戳不会错，`def` 会。
- 没有 ASR：没有字幕的视频、纯音乐、画面里才有字（没点「画面字幕」）的集，包是空的。
- `notes[]` 只有用户看过的集才有；把没看过的集当「已经整理过」会得出错误结论。
- 时间戳来自字幕的起始秒，不是逐帧对齐；用它跳回 ±1 秒是正常的。

## 6. 版本

- `bn-study-pack/1`：2026-11-16 首版（课程 → 集 → 概念 → 锚点）。
- 加字段不升版本；删字段、改语义、改单位必须升到 `/2`，并在本文件顶部写明迁移方式。

## 7. 附带的 agent skill：skills/bili-study

仓库里带了一个可以直接装进 agent 的 skill（Claude Code / DSH / 任何读 SKILL.md 的宿主）：

- skills/bili-study/SKILL.md —— 流程：看懂包 → 按目标裁剪 → 审跳过清单 → 一次讲一个概念 → 用逐字原话拷打 → 记掌握度
- skills/bili-study/tools/study.mjs —— 确定性部分（不调模型）：切词、打分、裁剪、救回、出 Mermaid、写状态

装法（DSH）：把 skills/bili-study 整个目录复制到 ~/.dsh/skills/。其它宿主按各自 skill 目录放。

```bash
node skills/bili-study/tools/study.mjs plan  <学习包.json> --goal "<目标>" --out ./study/<课程>
node skills/bili-study/tools/study.mjs state <学习包.json> --goal "<目标>" --out ./study/<课程>
node skills/bili-study/tools/study.mjs mark  ./study/<课程>/study-state.json "<概念>" understood --quote "<原话>" --url "<链接>"
```

裁剪规则（可解释、可反驳）：

1. 命中目标（名字 ×3、定义 ×2、原话 ×1）或**跨集复用**的概念必留；
2. 其余按分数补到「总数的 60%」；没填目标就全留（不替用户瞎删）；
3. **救回**：某个留下的概念，其定义或原话里点到的名字，不能被丢掉（最多迭代两轮）。

图的边只是「同一集里按讲课顺序相邻」，不是因果。

## 8. 掌握度回流：bn-study-state/1

agent 拷打完写到 study-state.json，再让插件面板读它，标出「哪些懂、哪些半懂、下次从哪继续」。

**回流怎么走（已实现，v1.4.3 起）**：agent 收尾时把整个 JSON 复制到系统剪贴板（Windows：`Get-Content study-state.json -Raw | Set-Clipboard`；macOS：`pbcopy < study-state.json`），告诉用户「点扩展图标 → 应用到面板」。用户点开弹窗后，弹窗读一次剪贴板、校验 spec，显示「课程名 · 懂 X · 半懂 Y · 没考 Z」，点「应用到面板」写进 `chrome.storage.local` 的 `bnstudy:<course_id>`；B站 页面上的面板立刻（不用刷新）在课程条下面出现「掌握度」，点开是「接着学」三条（带跳转秒数）和「已经能讲清」。

```json
{
  "spec": "bn-study-state/1",
  "course": "【从零开始的 AI 学习】",
  "course_id": "season:8719249",
  "goal": "三周内能独立用 agent 跑通一个自动化任务",
  "updated_at": "2026-11-16T04:32:29.195Z",
  "concepts": [
    { "name": "agent", "status": "understood", "asked": 1, "correct": 1,
      "last_quote": "能替你写代码、跑脚本的AI执行者",
      "last_url": "https://www.bilibili.com/video/BV1pwnj6BEMP?t=110",
      "updated_at": "2026-11-16T04:32:29.195Z" }
  ],
  "next": [ { "name": "回滚", "url": "…?t=…", "reason": "上次没讲清，再考一次" } ],
  "progress": { "understood": 1, "shaky": 0, "unknown": 16, "total": 17 }
}
```

- status 只有三档：understood（能自己说清 + 知道什么时候用）、shaky（方向对但有漏洞）、unknown（说错或没考）。
- asked / correct 是拷打次数与答对次数，用来算同一个概念是不是卡住了（连续两次 shaky 就该回去看视频，而不是继续考）。
- last_quote 必须是**那次判分时贴给用户的原话**，last_url 是它的时间戳链接 —— 回流到面板后，用户点「这个我不太懂」能直接跳回那一秒。
- 字段只加不改；改语义升 /2。
- 面板只认 `course_id` 一致的那一份：合集是 `season:<合集id>`，多 P / 单视频是 `video:<BV号>`。写错 course_id 会「应用成功但面板不显示」。
- 同一门课只留最后一次应用的版本（按 updated_at 显示「已经应用过了」），不做历史合并。
