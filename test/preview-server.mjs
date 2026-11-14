import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const port = Number(process.argv[2] || 8799);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.ort': 'application/octet-stream', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url.endsWith('/') ? '/test/preview.html' : url;
  try {
    const body = readFileSync(join(root, file.replace(/^\//, '')));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    // 任何 /video/xxx 路径都回预览页，让 content.js 能取到 bvid
    try {
      // /video/BV1TESTHARD 走硬字幕预览，其它 /video/xxx 走主预览
      const page = /BV1TESTHARD/.test(url) ? 'test/preview-hard.html' : 'test/preview.html';
      const body = readFileSync(join(root, page));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch (e2) {
      res.writeHead(404); res.end('not found');
    }
  }
}).listen(port, '127.0.0.1', () => console.log('preview http://127.0.0.1:' + port + '/video/BV1TESTPREVIEW'));
