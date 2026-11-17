// 合集页里点工具栏「导出」只导出当前这一集；点它时要在状态条上提醒一次「交给 agent」在哪。
// 这层 UI 逻辑要真浏览器才有意义（见 docs/evidence.md 第四十二节），
// 但「有没有接上、有没有守门、是不是只提醒一次」这类回归可以用源码断言拦住。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

ok("工具栏导出接到带提醒的包装函数", src.indexOf("addEventListener('click', exportMarkdownFromButton)") > 0);
ok("包装函数先导出、再提醒", src.indexOf("function exportMarkdownFromButton() {") > 0 && src.indexOf("exportMarkdown();") > 0);
ok("只对合集/多P 提醒", src.indexOf("if (!m || m.kind === 'single') return;") > 0);
ok("少于两集不提醒", src.indexOf("if (n < 2) return;") > 0);
ok("导出失败时不抢更急的提示", src.indexOf("if (state.status === 'bad') return;") > 0);
ok("同一集只提醒一次（按 bvid 记）", src.indexOf("bn.packHint.") > 0);
ok("提醒里点名按钮文案", src.indexOf("交给 agent（N 集）") > 0);
ok("提醒里说明学习包前缀", src.indexOf("文件名以 bn-study- 开头") > 0);
ok("用状态条而不是弹窗", src.indexOf("alert(") < 0);

console.log("exporthint: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
