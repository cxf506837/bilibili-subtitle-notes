#!/usr/bin/env node
// 学习包收件端：bili-notes 扩展把学习包 POST 到本机 127.0.0.1:8791，
// 这里落盘到你指定的目录，并留下 latest.json 给 agent 读。
//
// 只绑回环地址，不发任何外部网络。协议见 docs/agent-integration.md（spec bn-agent-hook/1）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const SPEC = 'bn-agent-hook/1';
export const MAX_BODY = 8 * 1024 * 1024;
const HOST = '127.0.0.1';

function argOf(argv, name, dflt) {
  const hit = argv.find((a) => a === name || a.startsWith(name + '='));
  if (!hit) return dflt;
  if (hit.indexOf('=') >= 0) return hit.slice(hit.indexOf('=') + 1);
  const i = argv.indexOf(hit);
  return argv[i + 1] || dflt;
}

export function dataDir() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local');
  return path.join(root, 'bn-agent-bridge');
}

// 文件名来自别处（浏览器下载可能带「 (1)」或奇怪字符），落盘前必须收紧。
export function safeName(name) {
  let n = String(name || '').split(/[\\/]/).pop();
  n = n.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  if (!n || n === '.' || n === '..') n = 'bn-study-pack.json';
  if (!n.toLowerCase().endsWith('.json')) n += '.json';
  if (n.length > 180) {
    const ext = '.json';
    n = n.slice(0, 180 - ext.length) + ext;
  }
  return n;
}

// 同名不覆盖：后到的加「 (2)」「 (3)」——同一个学习包重发很常见，别把上一份吃掉。
export function uniquePath(dir, name) {
  const base = name.replace(/\.json$/i, '');
  let p = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(p)) {
    i += 1;
    p = path.join(dir, base + ' (' + i + ').json');
  }
  return p;
}

function logLine(msg) {
  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'bridge.log');
    try {
      const st = fs.statSync(file);
      if (st.size > 200 * 1024) fs.renameSync(file, file + '.1');
    } catch (e) {}
    const t = new Date().toLocaleString('sv-SE').replace('T', ' ');
    fs.appendFileSync(file, t + '  ' + msg + '\r\n', 'utf8');
  } catch (e) {}
}

function focusAgent(here) {
  const ps = path.join(here, 'focus-dsh.ps1');
  if (!fs.existsSync(ps)) return;
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
  } catch (e) {}
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// 落盘只做「写文件」，不解析学习包内容：那是 agent 的事，收件端多懂一点就多一处会坏。
export function savePack({ pack, inbox, now }) {
  const file = (pack && pack.file) || {};
  const name = safeName(file.name || 'bn-study-pack.json');
  fs.mkdirSync(inbox, { recursive: true });
  const target = uniquePath(inbox, name);
  const json = JSON.stringify(pack && pack.pack !== undefined ? pack.pack : pack, null, 0);
  fs.writeFileSync(target, json, 'utf8');
  const rec = {
    spec: SPEC,
    savedAt: new Date(now || Date.now()).toISOString(),
    source: (pack && pack.source) || 'bili-notes',
    course: (pack && pack.course) || {},
    scope: (pack && pack.scope) || '',
    counts: (pack && pack.counts) || {},
    file: target,
    bytes: Buffer.byteLength(json, 'utf8'),
    text: (pack && pack.text) || '',
  };
  fs.writeFileSync(path.join(inbox, 'latest.json'), JSON.stringify(rec, null, 2), 'utf8');
  return rec;
}

export function createServer(opts = {}) {
  const inbox = opts.inbox || path.join(dataDir(), 'inbox');
  const here = opts.here || process.cwd();
  const focus = opts.focus !== false;
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.split('?')[0] === '/bn-ping') {
      return send(res, 200, { ok: true, spec: SPEC, inbox, pid: process.pid });
    }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/bn-pack') {
      return send(res, 404, { ok: false, error: 'POST /bn-pack' });
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, { ok: false, error: '学习包太大（上限 8MB）' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (e) {
        return send(res, 400, { ok: false, error: '不是合法 JSON' });
      }
      if (!body || body.spec !== SPEC) {
        return send(res, 400, { ok: false, error: 'spec 应为 ' + SPEC });
      }
      if (!body.pack || !body.pack.course) {
        return send(res, 400, { ok: false, error: '缺少学习包内容' });
      }
      try {
        const rec = savePack({ pack: body, inbox });
        logLine('收到学习包 ' + rec.file + '（' + (rec.counts.episodes || 0) + ' 集）');
        if (focus) focusAgent(here);
        return send(res, 200, { ok: true, saved: rec.file, counts: rec.counts, bytes: rec.bytes });
      } catch (e) {
        logLine('保存失败：' + (e && e.message));
        return send(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 200) });
      }
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const port = Number(argOf(process.argv, '--port', '8791')) || 8791;
  const inbox = argOf(process.argv, '--inbox', '');
  const noFocus = process.argv.includes('--no-focus');
  const here = path.dirname(path.resolve(process.argv[1]));
  const server = createServer({ inbox: inbox || path.join(dataDir(), 'inbox'), here, focus: !noFocus });
  server.listen(port, HOST, () => {
    console.log('bn-agent-hook 在 http://' + HOST + ':' + port + '/bn-pack 等学习包');
    console.log('落盘目录：' + (inbox || path.join(dataDir(), 'inbox')));
    console.log('只监听本机回环；Ctrl+C 退出');
  });
  server.on('error', (e) => {
    console.error('起不来：' + (e && e.message));
    process.exit(1);
  });
}
