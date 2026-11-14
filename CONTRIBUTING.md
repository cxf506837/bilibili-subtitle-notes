# 贡献 / Contributing

先说清楚这个项目的维护边界，免得你白花时间。

## 会认真看的

- **数据错误**：字幕拿错了别的视频的、闸门误判（该过的没过 / 不该过的过了）、引文和原句对不上。这类请用 [字幕错配](.github/ISSUE_TEMPLATE/wrong-subtitle.yml) 模板提 issue，必须带 BV 号。
- **装了用不了**：按 README 四步装不上、面板不出来、设置存不住。带上浏览器版本和截图。

## 可能不收的

- 新功能（尤其是要加服务器、加账号、加云同步的）。这个扩展的硬约束是**全本地、无后端、作者一个人维护**，任何一条改动如果让"长期不维护也能用"变成"得有人盯着"，就不收。
- 大重构 / 换框架 / 加构建步骤。现在的技术栈是刻意选的（MV3 + 原生 JS，clone 下来就能加载）。
- 只改文案没改行为的 PR。

功能类想法请先开 issue 说清"你遇到什么问题"，**不要直接提 PR**。作者不承诺响应时间。

## 本地开发

```bash
node test/run-all.mjs     # 全部离线测试，不需要网络
node test/preview-server.mjs 8799   # 预览页：http://127.0.0.1:8799/video/BV1TESTPREVIEW
```

真机验收（要 Edge + 已登录 B站 + 自己的 API Key）：

```bash
node test/accept.mjs
```

提交前钩子会扫密钥和个人路径：`git config core.hooksPath .githooks`。没装 Node 的机器上钩子会跳过并打印提示。

## 许可

提交的代码按 MIT 授权。
