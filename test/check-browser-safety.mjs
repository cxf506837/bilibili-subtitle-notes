#!/usr/bin/env node
/**
 * 拦住「杀用户 Edge」的写法。
 *
 * 背景：2026-11-14 我用 Get-Process msedge | Stop-Process -Force 关浏览器，
 * 导致未落盘的 cookie 回滚、用户 B站 登录态丢失（物证：Default\Preferences 里
 * profile.exit_type = "Crashed"）。规则见 AGENTS.md「碰用户的浏览器」。
 *
 * 允许：按 PID 精确杀（例如只杀 --user-data-dir=dist\edge-profile 的调试档进程）。
 * 禁止：按名字批量杀 msedge，或 taskkill /F /IM msedge.exe。
 *
 * 用法：
 *   node test/check-browser-safety.mjs            # 扫全仓
 *   node test/check-browser-safety.mjs --self-test # 用假样本验证检查本身有效
 *   node test/check-browser-safety.mjs a.ps1 b.mjs # 只扫指定文件（给提交钩子用）
 * 退出码：0 = 干净，1 = 有违规（或自检失败）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = fileURLToPath(import.meta.url); // 本文件自带违规样本（自检数据），不扫自己
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'edge-profile', 'backups']);
const EXTS = ['.ps1', '.mjs', '.cjs', '.js'];

const RULES = [
  {
    name: '按名字批量杀 Edge（同一行 Get-Process msedge + Stop-Process -Force，且没有按 CommandLine 筛过）',
    test: (line) => {
      if (!/Get-Process/.test(line) || !/msedge/i.test(line)) return false;
      if (!/Stop-Process/.test(line) || !/-Force/i.test(line)) return false;
      if (/CommandLine/i.test(line)) return false;
      return true;
    },
  },
  {
    name: 'Stop-Process -Name msedge -Force',
    test: (line) =>
      /Stop-Process/i.test(line) &&
      /-Force/i.test(line) &&
      /(?:-Name|-ProcessName)\s+['"]?msedge/i.test(line),
  },
  {
    name: 'taskkill /F /IM msedge.exe',
    test: (line) =>
      /taskkill/i.test(line) &&
      /\/IM\s+['"]?msedge/i.test(line) &&
      /\/[Ff]\b/.test(line),
  },
];

export function scanText(text, file = '<memory>') {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(#|\/\/|\*)/.test(line)) return; // 纯注释不算
    for (const r of RULES) {
      if (r.test(line)) hits.push({ file, line: i + 1, rule: r.name, text: line.trim().slice(0, 160) });
    }
  });
  return hits;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (EXTS.some((x) => e.name.endsWith(x))) acc.push(full);
  }
  return acc;
}

const SELF_TEST = [
  { src: 'Get-Process msedge | Stop-Process -Force', want: true, why: '按名字批量强杀' },
  { src: 'Stop-Process -Name msedge -Force -ErrorAction SilentlyContinue', want: true, why: '-Name 强杀' },
  { src: 'taskkill /F /IM msedge.exe', want: true, why: 'taskkill 强杀' },
  { src: 'taskkill /IM msedge.exe /F', need: true, why: '参数顺序反过来也要拦' },
  { src: '# 绝不 Stop-Process -Force msedge', want: false, why: '纯注释不误报' },
  {
    src: "Get-Process msedge | Where-Object { $_.CommandLine -like '*dist\\edge-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    want: false,
    why: '只杀调试档（按命令行筛过）是允许的',
  },
  { src: 'taskkill /F /PID 1234', want: false, why: '按 PID 精确杀是允许的' },
];

function selfTest() {
  let bad = 0;
  SELF_TEST.forEach((c, i) => {
    const hits = scanText(c.src);
    const got = hits.length > 0;
    const want = c.want ?? c.need ?? false;
    if (got !== want) {
      bad++;
      console.log(`  FAIL 样例 ${i + 1}（${c.why}）预期 ${want ? '报错' : '放行'}，实际 ${got ? '报错' : '放行'}`);
    } else {
      console.log(`  ok   样例 ${i + 1} ${c.why} → ${want ? '拦下' : '放行'}`);
    }
  });
  console.log(bad === 0 ? `\n自检通过：${SELF_TEST.length}/${SELF_TEST.length}` : `\n自检失败：${bad}/${SELF_TEST.length} 不符合预期`);
  return bad === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test') || args.includes('--selftest')) return process.exit(selfTest());

  const explicit = args.filter((a) => !a.startsWith('--'));
  const files = explicit.length
    ? explicit.map((f) => resolve(process.cwd(), f)).filter((f) => {
        try {
          return statSync(f).isFile();
        } catch {
          return false;
        }
      })
    : walk(ROOT).filter((f) => !f.replace(/\\/g, '/').includes('/test/ocr/') && f !== SELF);

  const hits = [];
  for (const f of files) {
    let text = '';
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    hits.push(...scanText(text, relative(ROOT, f)));
  }

  if (hits.length === 0) {
    console.log(`ok 扫了 ${files.length} 个脚本，没有「杀用户 Edge」的写法`);
    return process.exit(0);
  }
  console.log(`发现 ${hits.length} 处会杀掉用户 Edge 的写法：\n`);
  for (const h of hits) console.log(`  ${h.file}:${h.line}  [${h.rule}]\n    ${h.text}\n`);
  console.log('改用按 PID 精确杀（只杀 dist\\edge-profile 的调试档），见 edge-safe.ps1。');
  return process.exit(1);
}

main();
