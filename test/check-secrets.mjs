#!/usr/bin/env node
// 提交前敏感信息扫描：只看 git 索引里的文件（= 会进仓库的东西）。
// 命中密钥 = 退出 1（阻断提交）；命中个人路径 = 只告警。
// 跳过检查：git commit --no-verify；git 不在 PATH 时用 BN_GIT 指定绝对路径。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
const SKIP_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.wasm', '.ort', '.woff2', '.zip', '.bundle'];
const SELF = 'check-secrets.mjs';

const SECRETS = [
  { name: 'API key (sk-)', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
const WARNINGS = [
  { name: '个人绝对路径', re: /[A-Z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z0-9._-]+/i },
  { name: 'macOS 家目录路径', re: /(?<![A-Za-z]:)\/Users\/[A-Za-z0-9._-]+\// },
];

// git 的可执行文件：优先 BN_GIT，其次 PATH，最后从 GIT_EXEC_PATH 推断（Windows 版 Git）
function resolveGit() {
  if (process.env.BN_GIT) return process.env.BN_GIT;
  const execPath = process.env.GIT_EXEC_PATH;
  if (execPath) {
    const root = dirname(dirname(execPath));
    const guess = join(root, 'cmd', 'git.exe');
    if (existsSync(guess)) return guess;
  }
  return 'git';
}

function trackedFiles(git) {
  const out = execFileSync(git, ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean);
}

const git = resolveGit();
let files;
try {
  files = trackedFiles(git);
} catch (err) {
  console.error('[check-secrets] 读不到 git 索引，无法确认仓库里没有密钥，已阻断提交。');
  console.error('  git 不在 PATH 时用 BN_GIT 指定绝对路径；不在 git 仓库里跑这个检查没有意义。');
  console.error('  ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
if (files.length === 0) {
  console.error('[check-secrets] git 索引为空，已阻断提交（防止在错误目录提交）。');
  process.exit(1);
}

const fails = [];
const warns = [];
for (const rel of files) {
  if (rel.endsWith(SELF)) continue;
  const lower = rel.toLowerCase();
  if (SKIP_EXT.some((ext) => lower.endsWith(ext))) continue;
  let text;
  try {
    const buf = readFileSync(rel);
    if (buf.length > MAX_BYTES) continue;
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  const shown = rel.replace(/\\/g, '/');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const r of SECRETS) if (r.re.test(line)) fails.push(shown + ':' + (i + 1) + '  [' + r.name + ']');
    for (const r of WARNINGS) if (r.re.test(line)) warns.push(shown + ':' + (i + 1) + '  [' + r.name + ']');
  }
}

if (warns.length) {
  console.log('[check-secrets] 告警 ' + warns.length + ' 处在「' + WARNINGS.map((w) => w.name).join('/') + '」：');
  for (const w of warns.slice(0, 10)) console.log('  ' + w);
  if (warns.length > 10) console.log('  …… 另有 ' + (warns.length - 10) + ' 处');
}
if (fails.length) {
  console.error('\n[check-secrets] 发现 ' + fails.length + ' 处密钥，已阻断提交：');
  for (const f of fails) console.error('  ' + f);
  console.error('\n改用环境变量或本地未跟踪的 key 文件；确认泄露后请立刻吊销该 key。');
  process.exit(1);
}
console.log('[check-secrets] 已扫描 ' + files.length + ' 个受控文件，未发现密钥。');
