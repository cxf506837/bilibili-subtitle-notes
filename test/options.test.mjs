// 设置页真实代码路径测试：用最小假 DOM + 假 chrome 跑 options.js，
// 验证「预设能填、没权限的域名在保存那一刻就被拦、测试连接也走同一道校验」。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function makeEl(id) {
  return {
    id,
    value: '',
    textContent: '',
    checked: false,
    style: {},
    children: [],
    listeners: {},
    appendChild(c) { this.children.push(c); },
    addEventListener(t, f) { this.listeners[t] = f; },
  };
}

let els, saved, sent, lastConfig;
function fresh(opts) {
  opts = opts || {};
  els = {};
  saved = null;
  sent = null;
  lastConfig = opts.saved || {};
  const document = {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    createElement(tag) { const e = makeEl(''); e.tag = tag; return e; },
  };
  const chrome = {
    runtime: {
      getManifest() { return manifest; },
      sendMessage(msg, cb) { sent = msg; if (cb) cb({ ok: true, content: 'ok' }); },
    },
    storage: {
      local: {
        get(keys, cb) { cb(lastConfig); },
        set(obj, cb) { saved = obj; if (cb) cb(); },
      },
    },
  };
  const ctx = { document, chrome, URL, console, URLSearchParams };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'src/endpoint.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(root, 'src/options.js'), 'utf8'), ctx);
  return ctx;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// 1) 空配置打开：默认 DeepSeek，预设下拉里有 6 家
fresh({});
ok('默认 API Base 是 DeepSeek', els.apiBase.value === 'https://api.deepseek.com/v1', els.apiBase.value);
ok('默认模型 deepseek-chat', els.model.value === 'deepseek-chat', els.model.value);
ok('默认预设自动选中 deepseek', els.preset.value === 'deepseek', els.preset.value);
ok('预设下拉列出全部 6 家', els.preset.children.length === 6, String(els.preset.children.length));

// 2) 选预设会填 apiBase + model，但不碰 key
fresh({ saved: { apiKey: 'sk-existing', apiBase: 'https://api.openai.com/v1' } });
els.preset.value = 'ollama';
els.preset.listeners.change();
ok('选 Ollama 后 apiBase 跟着变', els.apiBase.value === 'http://localhost:11434/v1', els.apiBase.value);
ok('选 Ollama 后模型跟着变', els.model.value === 'qwen2.5:7b', els.model.value);
ok('已填的 key 不被预设覆盖', els.apiKey.value === 'sk-existing', els.apiKey.value);

// 3) 没权限的域名：保存被拦，且报错是人话
fresh({});
els.apiBase.value = 'https://api.example.com/v1';
els.model.value = 'gpt-4o-mini';
els.save.listeners.click();
ok('没权限时没有写入 storage', saved === null, JSON.stringify(saved));
ok('报错里点名了那个域名', els.msg.textContent.indexOf('https://api.example.com') >= 0, els.msg.textContent);
ok('报错里说清原因（没有权限）', els.msg.textContent.indexOf('没有权限') >= 0);
ok('报错里列出可选服务商', els.msg.textContent.indexOf('DeepSeek') >= 0);

// 4) 合法域名：正常保存
fresh({});
els.apiBase.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1/';
els.model.value = 'qwen-plus';
els.apiKey.value = 'sk-abc';
els.save.listeners.click();
ok('合法域名写入 storage', saved && saved.apiBase === 'https://dashscope.aliyuncs.com/compatible-mode/v1', JSON.stringify(saved));
ok('尾部斜杠被去掉', saved && saved.apiBase.slice(-1) !== '/');
ok('保存后给的是绿色提示', els.msg.style.color === '#2ecc71', els.msg.style.color);

// 5) 测试连接也要过同一道校验，不能拿没权限的域名去撞 TypeError
fresh({});
els.apiBase.value = 'https://totally-not-allowed.example/';
els.model.value = 'x';
els.apiKey.value = 'sk-abc';
els.test.listeners.click();
ok('没权限时不去发请求', sent === null);
ok('测试连接同样给出人话报错', els.msg.textContent.indexOf('没有权限') >= 0, els.msg.textContent);

fresh({});
els.apiBase.value = 'https://api.deepseek.com/v1';
els.model.value = 'deepseek-chat';
els.apiKey.value = 'sk-abc';
els.test.listeners.click();
ok('有权限时真的发了请求', sent && sent.type === 'chat');
ok('请求带的是当前填的 apiBase', sent.override.apiBase === 'https://api.deepseek.com/v1', JSON.stringify(sent && sent.override));
ok('测试成功显示连接正常', els.msg.textContent.indexOf('连接正常') >= 0, els.msg.textContent);

// 6) 空 key 时测试连接先报 key，不浪费一次请求
fresh({});
els.apiBase.value = 'https://api.deepseek.com/v1';
els.model.value = 'deepseek-chat';
els.test.listeners.click();
ok('空 key 时不发请求', sent === null);
ok('空 key 时提示先填 key', els.msg.textContent.indexOf('API Key') >= 0, els.msg.textContent);

// 7) 面板主题：默认 auto、已存值回显、保存时写进 storage
fresh({});
ok('主题默认 auto', els.theme.value === 'auto', els.theme.value);
fresh({ saved: { 'bn.theme': 'ink' } });
ok('已存主题回显 ink', els.theme.value === 'ink', els.theme.value);
fresh({});
els.theme.value = 'forest';
els.apiBase.value = 'https://api.deepseek.com/v1';
els.model.value = 'deepseek-chat';
els.save.listeners.click();
ok('保存时写入 bn.theme', !!(saved && saved['bn.theme'] === 'forest'), JSON.stringify(saved && saved['bn.theme']));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
