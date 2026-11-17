// tools/agent-bridge 的三个脚本：能装、能盯、能把窗口拉到前面。
// 这里只做静态检查（真机行为在 docs/evidence.md 第四十一节），因为 CI 上没有 Windows 桌面。
import { readFileSync, existsSync } from "node:fs";

const base = new URL("../tools/agent-bridge/", import.meta.url);
const read = (f) => readFileSync(new URL(f, base), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " :: " + JSON.stringify(extra) : "")); }
}

for (const f of ["focus-dsh.ps1", "bn-agent-bridge.ps1", "install.ps1", "README.md"]) {
  ok(f + " 存在", existsSync(new URL(f, base)));
}

// PowerShell 5.1 会按 ANSI 读没有 BOM 的文件，中文全变乱码
for (const f of ["focus-dsh.ps1", "bn-agent-bridge.ps1", "install.ps1"]) {
  const src = read(f);
  ok(f + " 带 UTF-8 BOM", src.charCodeAt(0) === 0xfeff);
  ok(f + " 用 CRLF", src.indexOf("\r\n") > 0);
}

const focus = read("focus-dsh.ps1");
ok("focus：先敲 ALT 解锁前台", focus.indexOf("keybd_event(0x12, 0, 0") > 0);
ok("focus：再 SetForegroundWindow", focus.indexOf("SetForegroundWindow") > 0);
ok("focus：兜底 AppActivate", focus.indexOf("AppActivate") > 0);
ok("focus：最小化先还原", focus.indexOf("ShowWindow($h, 9)") > 0);
ok("focus：-Test 只报告不抢焦点", focus.indexOf("if ($Test)") > 0 && focus.indexOf("exit 0") > 0);

const bridge = read("bn-agent-bridge.ps1");
ok("bridge：默认只认 bn-study-*.json", bridge.indexOf("[string]$Pattern = \"bn-study-*.json\"") > 0);
ok("bridge：监听文件名与写入时间", bridge.indexOf("FileName, LastWrite, CreationTime") > 0);
ok("bridge：防抖 + 冷却", bridge.indexOf("$DebounceMs") > 0 && bridge.indexOf("$CooldownSec") > 0);
ok("bridge：只拉窗口、不输入", bridge.indexOf("SendKeys") < 0 && bridge.indexOf("SendWait") < 0);
ok("bridge：日志会轮转", bridge.indexOf("bridge.log.1") > 0 || bridge.indexOf(".1\"") > 0);
ok("bridge：-RunOnce 跑一次就退", bridge.indexOf("if ($RunOnce)") > 0);

const install = read("install.ps1");
ok("install：写 Startup 快捷方式", install.indexOf("\"Startup\"") > 0 && install.indexOf("bn-agent-bridge.lnk") > 0);
ok("install：不弹窗", install.indexOf("-WindowStyle Hidden") > 0);
ok("install：用 WMI 启动，别跟着父进程死", install.indexOf("Win32_Process") > 0 && install.indexOf("MethodName Create") > 0);
ok("install：-Uninstall 会删快捷方式并停进程", install.indexOf("$Uninstall") > 0 && install.indexOf("Remove-Item $lnk") > 0);
ok("install：挑进程时排除自己的查询命令", install.indexOf("-notlike \"*-Command*\"") > 0);

const readme = read("README.md");
ok("README：写清用户只按 Ctrl+V → Enter", readme.indexOf("Ctrl+V") > 0);
ok("README：说明为什么不做自动发送", readme.indexOf("401") > 0);

console.log("agentbridge: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
