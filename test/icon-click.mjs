// 工具栏图标（v0.7.3）真机验证：点一下图标 -> 面板唤出。
// 前置：powershell -NoProfile -ExecutionPolicy Bypass -File start-edge.ps1
//       （端口 9333、--load-extension 指向本仓库目录）
// 用法：node test/icon-click.mjs
//
// 两个必须知道的实现细节（踩过）：
// 1) CDP 点不到浏览器工具栏按钮，所以这里直接调 chrome.action.onClicked 绑的那条
//    openPanelForTab（background 导出成 self.__bnOpenPanel），走的是同一条链路。
// 2) 面板挂在 #bn-root 的 **shadow root** 里，主世界 document.querySelector('#btnFold')
//    永远是 null，必须 document.getElementById('bn-root').shadowRoot.querySelector(...)。
const PORT = 9333;
const VIDEO = 'https://www.bilibili.com/video/BV1GyZYYNErW';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}, sessionId) => {
  const mid = ++id; const msg = { id: mid, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pend.set(mid, { res, rej }));
};
const evalIn = async (sessionId, expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
// 面板是 shadow DOM，这里统一从 shadow root 里取 #btnFold / .wrap
const SR = "document.getElementById('bn-root').shadowRoot";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); };

// ---- 1. 找本扩展的 service worker（/json/list 里还有别的扩展和 Edge NTP 的 SW）
const { targetInfos } = await send('Target.getTargets');
const sw = targetInfos.find(t => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/src\/background\.js/.test(t.url));
if (!sw) { console.log('FAIL 没有找到本扩展的 service worker（扩展没加载？先跑 start-edge.ps1）'); process.exit(1); }
const extId = sw.url.split('/')[2];
ok('扩展已加载', true, extId);
const swSid = (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
await send('Runtime.enable', {}, swSid);
await sleep(200);

const mf = await evalIn(swSid, 'chrome.runtime.getManifest()');
ok('manifest 版本 0.7.3', mf.version === '0.7.3', mf.version);
ok('manifest.action 存在', !!mf.action);
ok('onClicked 有监听器', await evalIn(swSid, 'chrome.action.onClicked.hasListeners()'));
ok('标题正确', (await evalIn(swSid, 'chrome.action.getTitle({})')) === 'B站可核对笔记 · 点一下打开面板');
ok('__bnOpenPanel 可调用', await evalIn(swSid, "typeof self.__bnOpenPanel === 'function'"));

// ---- 2. 开一个视频页（全新标签，验证“装完扩展点图标就能用”这条日常路径）
const tab = JSON.parse(await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(VIDEO), { method: 'PUT' })).text());
const pageSid = (await send('Target.attachToTarget', { targetId: tab.id, flatten: true })).sessionId;
await send('Runtime.enable', {}, pageSid);

let mounted = null;
for (let i = 0; i < 60 && !mounted; i++) {
  await sleep(500);
  mounted = await evalIn(pageSid, `(function(){ var r = document.getElementById('bn-root'); if (!r || !r.shadowRoot) return null; var sr = r.shadowRoot; var w = sr.querySelector('.wrap'); if (!w) return null; return { cls: w.className, txt: (sr.textContent||'').replace(/\\s+/g,' ').trim().slice(0,50) }; })()`);
}
ok('面板已挂载（视频页，shadow root 里 render 出来）', !!mounted, mounted);
if (!mounted) { await send('Target.closeTarget', { targetId: tab.id }); console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail); ws.close(); process.exit(1); }

// ---- 3. 先点成收起态，再走图标链路唤出
await evalIn(pageSid, SR + ".querySelector('#btnFold').click()");
await sleep(700);
const folded = await evalIn(pageSid, `(function(){ var sr = ${SR}; var w = sr.querySelector('.wrap'); return { cls: w.className, w: Math.round(w.getBoundingClientRect().width), label: sr.querySelector('#btnFold').textContent }; })()`);
ok('前置：面板已收起', /\bcollapsed\b/.test(folded.cls), folded);

// 传真实的 Tab 对象（onClicked 拿到的就是这个）；CDP 的 targetId 是字符串，不能用，
// 所以按 URL 从 chrome.tabs 里取最新打开的那个（id 最大）。
const res = await evalIn(swSid, `(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/BV1GyZYYNErW*' });
  if (!tabs.length) return { ok: false, code: 'no-such-tab' };
  const t = tabs.sort((a, b) => b.id - a.id)[0];
  return await self.__bnOpenPanel(t);
})()`);
ok('点图标 -> 唤出返回 ok', !!res && res.ok === true && res.via === 'panel', res);
await sleep(900);
const after = await evalIn(pageSid, `(function(){ var sr = ${SR}; var w = sr.querySelector('.wrap'); return { cls: w.className, flash: w.classList.contains('flash'), w: Math.round(w.getBoundingClientRect().width) }; })()`);
ok('唤出后面板展开', !/\bcollapsed\b/.test(after.cls), after);
ok('唤出时闪一下（flash 类）', after.flash === true, after);

// ---- 4. 非视频页：应开一个 B站 首页标签，而不是点了没反应
const r2 = await evalIn(swSid, "self.__bnOpenPanel({ id: 999999, url: 'https://www.bilibili.com/' })");
ok('非视频页 -> 打开 B站首页', !!r2 && r2.ok === false && r2.code === 'not-video' && !!r2.opened, r2);

await send('Target.closeTarget', { targetId: tab.id });
console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
ws.close();
process.exit(fail ? 1 : 0);
