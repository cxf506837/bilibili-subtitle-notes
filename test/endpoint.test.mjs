// 设置页的端点白名单：MV3 里没授权域名的 fetch 只抛 TypeError，事后分不清，必须在保存时拦。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'src/endpoint.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
// vm 的新上下文里没有 Node 的 URL，要显式注入，否则 bnParseOrigin 会静默返回 null
const ctx = { URL };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const allowed = (b) => vm.runInContext('bnOriginAllowed', ctx)(b, manifest.host_permissions);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// 预设里的每一家都必须真在 manifest 里，否则用户选了预设还是保存不了
for (const p of vm.runInContext('BN_PRESETS', ctx)) {
  ok('预设可用：' + p.label, allowed(p.apiBase).ok, p.apiBase);
}
ok('DeepSeek 通过', allowed('https://api.deepseek.com/v1').ok);
ok('OpenAI 通过', allowed('https://api.openai.com/v1').ok);
ok('通义 compatible-mode 通过', allowed('https://dashscope.aliyuncs.com/compatible-mode/v1').ok);
ok('智谱 /api/paas/v4 通过', allowed('https://open.bigmodel.cn/api/paas/v4').ok);
ok('Moonshot 通过', allowed('https://api.moonshot.cn/v1').ok);
ok('本机 Ollama 通过', allowed('http://localhost:11434/v1').ok);
ok('127.0.0.1 通过', allowed('http://127.0.0.1:8000/v1').ok);
ok('端口不影响判定', allowed('https://api.deepseek.com:8443/v1').ok);

const evil = allowed('https://api.example.com/v1');
ok('没授权的域名被拦', evil.ok === false && evil.reason === 'no-permission');
ok('拦的时候带回 origin 供报错', evil.origin === 'https://api.example.com', evil.origin);
ok('协议不符也拦（只有 https 权限时 http 不放行）', allowed('http://api.deepseek.com/v1').ok === false);
ok('后缀伪装不放行：api.deepseek.com.evil.com', allowed('https://api.deepseek.com.evil.com/v1').ok === false);
ok('前缀伪装不放行：evilapi.deepseek.com', allowed('https://evilapi.deepseek.com/v1').ok === false);
const bad = allowed('api.deepseek.com');
ok('没有协议的写法判 bad-url', bad.ok === false && bad.reason === 'bad-url');
ok('空串判 bad-url', allowed('').reason === 'bad-url');
ok('ftp 判 bad-url', allowed('ftp://api.deepseek.com/v1').reason === 'bad-url');

const hosts = vm.runInContext('bnHostMatches', ctx);
ok('通配子域命中', hosts('*.deepseek.com', 'api.deepseek.com') === true);
ok('通配也命中裸域', hosts('*.deepseek.com', 'deepseek.com') === true);
ok('通配不吃伪装域', hosts('*.deepseek.com', 'deepseek.com.evil.com') === false);
ok('通配不吃相邻域', hosts('*.deepseek.com', 'notdeepseek.com') === false);

const labels = vm.runInContext('bnAllowedPresetLabels', ctx)(manifest.host_permissions);
ok('报错文案里能列出可选服务商', labels.length >= 5 && labels.includes('DeepSeek'), labels.join(','));
const onlyLocal = vm.runInContext('bnAllowedPresetLabels', ctx)(['http://localhost/*']);
ok('只给 localhost 权限时只列本机那一项', onlyLocal.length === 1 && onlyLocal[0].indexOf('Ollama') >= 0, onlyLocal.join(','));

// manifest 里不许有重复 / 忘删的规则；bilibili 自身的域名也算（抓字幕用）
const hp = manifest.host_permissions;
ok('host_permissions 无重复', new Set(hp).size === hp.length, hp.join(' '));
ok('B站 域名仍在', hp.some((h) => h.indexOf('bilibili.com') >= 0) && hp.some((h) => h.indexOf('hdslb.com') >= 0));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
