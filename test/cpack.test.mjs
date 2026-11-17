// 「交给 agent」/「导出选中」在没勾集数时也要有反应（不能是 disabled 静默死键）。
// 真机行为见 docs/evidence.md 第四十三节；这里拦住「又把按钮设成 disabled」这类回归。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } }

ok("清单底部两个按钮都不设 disabled", src.indexOf("pk.disabled") < 0 && src.indexOf("btn.disabled = !n") < 0);
ok("没勾集数时能给出可操作提示", src.indexOf("还没勾集数") > 0 && src.indexOf("勾 1~2 集") > 0);
ok("导出选中也走同一条守卫", (src.split("还没勾集数").length - 1) === 2);
ok("按钮文案仍随勾选更新", src.indexOf("交给 agent（") > 0);

console.log("cpack: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
