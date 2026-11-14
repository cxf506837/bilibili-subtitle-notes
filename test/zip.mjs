import { readFileSync, readdirSync, mkdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// 仓库根目录：从本文件位置推导，别写死绝对路径（写死的话 clone 到别人机器上打包就崩）
const base = fileURLToPath(new URL('..', import.meta.url));
// 源码清单不再手写：从 manifest 里推导（content_scripts 的注入顺序 + service worker + options 页 + offscreen），
// 这样新加一个文件不用记得改这里（v0.5.0 手写清单漏过文件就是这么发生的）。
// vendor/ 单独递归收集（本地 OCR 的 wasm/模型，约 29MB，不进 git）。
const mf0 = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
const fixed = ['manifest.json'];
const push = (p) => { if (p && !fixed.includes(p)) fixed.push(p); };
for (const cs of mf0.content_scripts || []) for (const p of cs.js || []) push(p);
if (mf0.background && mf0.background.service_worker) push(mf0.background.service_worker);
if (mf0.options_page) push(mf0.options_page);
// 图标（manifest.icons + action.default_icon）也要进包，否则装了扩展工具栏是空白方块
for (const p of Object.values(mf0.icons || {})) push(p);
for (const p of Object.values((mf0.action || mf0.browser_action || {}).default_icon || {})) push(p);
for (const p of walk('src').filter((f) => !fixed.includes(f)).sort()) push(p);
function walk(dir, out = []) {
  for (const e of readdirSync(join(base, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

// 静态检查：清单里的文件必须真的在磁盘上。缺一个就停，不要打出一个「看起来完整」的包。
const missing = fixed.filter((f) => !existsSync(join(base, f)));
if (missing.length) {
  console.error('[zip] 清单里的文件不存在：\n  ' + missing.join('\n  '));
  process.exit(1);
}

// 本地 OCR 运行时：--lite 会主动剔除，完整包则必须齐全（这些文件不进 git，要从 Release 附件取）。
const OCR_REQUIRED = [
  'vendor/ocr/ocr-bundle.js',
  'vendor/ocr/ort/ort-wasm-simd-threaded.jsep.mjs',
  'vendor/ocr/ort/ort-wasm-simd-threaded.jsep.wasm',
  'vendor/ocr/models/PP-OCRv6_tiny_det.ort',
  'vendor/ocr/models/PP-OCRv6_tiny_rec.ort',
  'vendor/ocr/models/ppocrv6_tiny_dict.txt',
];

// --lite：不带本地 OCR 运行时（vendor/ocr，约 29MB），给只想用平台字幕的人一个 1MB 以内的包。
// 缺文件时 background 的 probeOcr() 会探到并让「画面字幕」按钮消失，不会给用户一个点了就报错的按钮。
const LITE = process.argv.includes('--lite');
const CHECK_ONLY = process.argv.includes('--check');

const vendor = walk('vendor').sort();
const vendorKept = LITE ? vendor.filter((p) => !p.startsWith('vendor/ocr/')) : vendor;

if (!LITE) {
  const lack = OCR_REQUIRED.filter((f) => !existsSync(join(base, f)));
  if (lack.length) {
    console.error('[zip] 完整包缺本地 OCR 运行时，不打包。缺这些文件：\n  ' + lack.join('\n  '));
    console.error('\n从仓库的 Release 附件下载 ocr-assets.zip 解压到 vendor/ocr/ 后再试；');
    console.error('只想出轻量包就用：node test/zip.mjs --lite');
    process.exit(1);
  }
}

const files = [...fixed, ...vendorKept];
if (CHECK_ONLY) {
  const bytes = files.reduce((s, f) => s + statSync(join(base, f)).size, 0);
  console.log('[zip] 检查通过：' + files.length + ' 个文件 / ' + mb(bytes) + '（' + (LITE ? 'light' : 'full') + '），未写盘');
  process.exit(0);
}

const crcTable = (() => { const t = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const parts = []; const central = []; let offset = 0; let raw = 0;
for (const f of files) {
  const src = readFileSync(join(base, f));
  const packed = deflateRawSync(src, { level: 9 });
  const useDeflate = packed.length < src.length;
  const body = useDeflate ? packed : src;
  const method = useDeflate ? 8 : 0;
  raw += src.length;
  const name = Buffer.from(f.split(sep).join('/'), 'utf8');
  const crc = crc32(src);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(src.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  parts.push(local, name, body);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(method, 10); cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(src.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
  cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += local.length + name.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
mkdirSync(join(base, 'dist'), { recursive: true });
const version = mf0.version;
const out = join(base, 'dist', 'bili-notes-v' + version + (LITE ? '-lite' : '') + '.zip');
writeFileSync(out, Buffer.concat([...parts, cd, end]));

// 自检：回读文件尾部，确认 EOCD 存在且条目数对得上（writeFileSync 出错/被截断时这条能拦住）
const bytes = readFileSync(out);
const tail = bytes.subarray(bytes.length - 22);
if (tail.readUInt32LE(0) !== 0x06054b50) { console.error('[zip] 自检失败：没有找到 ZIP 目录结尾'); process.exit(1); }
if (tail.readUInt16LE(10) !== files.length) { console.error('[zip] 自检失败：条目数 ' + tail.readUInt16LE(10) + ' ≠ ' + files.length); process.exit(1); }
if (!LITE && bytes.length < 5 * 1024 * 1024) { console.error('[zip] 自检失败：完整包只有 ' + mb(bytes.length) + '，OCR 资源可能没进包'); process.exit(1); }
if (LITE && bytes.length > 1024 * 1024) { console.error('[zip] 自检失败：轻量包 ' + mb(bytes.length) + '，超过 1MB（vendor/ocr 没剔干净？）'); process.exit(1); }

if (LITE) console.log('lite: 排除 vendor/ocr 下的 ' + (vendor.length - vendorKept.length) + ' 个文件');
console.log('zip: ' + out + ' · ' + mb(bytes.length) + ' / ' + files.length + ' files / raw ' + mb(raw));

function mb(n) { return (n / 1024 / 1024).toFixed(2) + ' MB'; }
