// 导出学习包之后，面板上必须有一张看得见的结果卡（含文件名 + 两个按钮）。
// 真机证据见 docs/evidence.md 第四十四节；这里拦住「又退回只改一行状态条」和「自动下第二份 .md」。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } }

ok("面板里有结果卡片容器", src.indexOf('class="packout hidden" id="packOut"') > 0);
ok("卡片带文件名一行", src.indexOf('id="packOutName"') > 0);
ok("卡片带「复制交给 agent 的话」按钮", src.indexOf('id="packOutCopy"') > 0);
ok("卡片带「存 Markdown」按钮", src.indexOf('id="packOutMd"') > 0);
ok("导出成功后必须调 showPackOut", src.indexOf("showPackOut({") > 0);
ok("卡片里给的是 .json 文件名", src.indexOf("name: pack.baseName + '.json'") > 0);
ok("不再用 setTimeout 自动下第二份（会被浏览器静默拦掉）", src.indexOf("setTimeout(function () { downloadMarkdown(") < 0);
ok("把 .md 存进 packMd，等用户点按钮", src.indexOf("packMd = { text: pack.md, name: pack.baseName + '.md' }") > 0);
ok("「存 Markdown」按钮真去调 downloadMarkdown", /packOutMdEl\.addEventListener\(\s*'click'[\s\S]{0,400}downloadMarkdown\(packMd\.text, packMd\.name\)/.test(src));
ok("没勾集数时仍然是可操作提示，不是死键", src.indexOf("还没勾集数") > 0 && src.indexOf("pk.disabled") < 0);

console.log("packcard: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
