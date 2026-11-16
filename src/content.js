// B站字幕笔记 · 页面内浮层。依赖 gate.js / summarize.js 先注入。
(function () {
  'use strict';
  if (window.__bnLoaded) return;
  window.__bnLoaded = true;

  const G = window.BnGate;
  const S = window.BnSum;

  const state = {
    bvid: '', p: 1, meta: null, sentences: [], blocks: [], notes: [],
    verdict: '', trackLan: '', status: 'init', detail: '',
    // 内容级提示：字幕正文与标题一个词都对不上（时长闸门挡不住「长度像但内容无关」）
    titleCheck: null,
    // 这份字幕是从本地缓存恢复的（不是这轮现取的）：界面给一个「重新核对」入口
    fromCache: false,
    // 有没有填 API Key：null=还不知道（storage 读回来之前别误报），没填时点「总结这段 / 整理全片」直接引到设置
    hasKey: null,
    tokens: 0, cost: 0, gateLog: [], queue: [], busy: false, width: 380, collapsed: false, autoHidden: false, lastTime: 0,
    // 合集批量导出：running 防重入，cancel 让「停止导出」在下一 P 前生效
    batch: { running: false, cancel: false },
    // 整理全片：一键把还没笔记的块全排进队列；allPrev 记下动手前这些块的覆盖状态，停止时好还原
    allRun: false, allPrev: null, allTodo: 0, curBlock: null,
    covered: [], lastTick: null, emptyHint: '', follow: true, queueHold: false,
    // 默认关：B站 AI 字幕几乎连续，判不出偏移；还要接管一次音频输出，不值当默认开
    // 走神补课：spans 记「你不在这段」的区间；shown 表示这次播放里已经弹过横幅
    away: { enabled: true, spans: [], last: null, shown: false, seen: {}, catchup: null, bannerSpan: null, skew: 0 },
    // 画面通道：从视频帧 OCR 出来的 PPT/板书文字。本地跑，不花钱。
    visual: { enabled: true, frames: 0, ocr: 0, seen: [], note: '' },
    hard: { active: false, samples: 0, cues: 0, consumed: 0, blocks: 0, lastT: -1, emptyRun: 0, note: '', tracker: null, busy: false },
    // 字幕可读性：本地特征 + 一次模型判断，决定要不要说「这份字幕像机翻」
    readability: { verdict: '', source: '', flags: null, note: '' },
    // 小节：每 8 块合成一个标题（只喂这 8 块的「一句话」，不喂全片，免得拿结论倒推）
    sections: [], sectionTried: {}, sectionTry: {}, sectionBusy: false, sectionDbg: null,
  };
  // 调试用：扩展里内容脚本跑在隔离世界，页面脚本读不到；预览页（普通 <script>）里可直接看状态
  window.__bnState = state;

  const host = document.createElement('div');
  host.id = 'bn-root';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const CSS = [
    ':host { all: initial; }',
    // 配色直接取 B站 自己的一套：白底、#18191c 正文、#9499a0 次要、#e3e5e7 描边、#00aeec 强调
    ':host { --bnbg: #ffffff; --bnfg: #18191c; --bnmuted: #9499a0; --bnline: #e3e5e7; --bnline2: #c9ccd0; --bnfill: #f1f2f3; --bnfill2: #e3e5e7; --bnaccent: #00aeec; --bnaccentInk: #0091c5; --bnaccentSoft: rgba(0,174,236,.10); --bnquote: rgba(0,174,236,.55); }',
    '.wrap { position: fixed; top: 0; right: 0; width: 380px; height: 100vh; z-index: 2147483000;',
    '  display: flex; font: 13px/1.6 -apple-system, PingFang SC, Microsoft YaHei, sans-serif;',
    '  color: var(--bnfg); background: var(--bnbg); box-shadow: -2px 0 12px rgba(0,0,0,.12);',
    '  transition: width .15s ease; }',
    '.wrap.dark { --bnbg: #1f2022; --bnfg: #e3e5e7; --bnmuted: #8a8f96; --bnline: #33363b; --bnline2: #45484d; --bnfill: #26282b; --bnfill2: #33363b; --bnaccent: #00aeec; --bnaccentInk: #55cdf3; --bnaccentSoft: rgba(0,174,236,.16); --bnquote: rgba(0,174,236,.55); box-shadow: -2px 0 12px rgba(0,0,0,.5); }',
    '.wrap.dark .btn { background: #26282b; border-color: #33363b; color: #e3e5e7; }',
    '.wrap.dark .btn:hover { background: #33363b; }',
    '.wrap.collapsed { width: 52px !important; cursor: pointer; }',
    // 点工具栏图标唤出面板时闪一下，让人确认「是它开了」
    '.wrap.flash { animation: bnflash 1.1s ease-out; }',
    '@keyframes bnflash { 0% { box-shadow: -2px 0 12px rgba(0,0,0,.12); } 30% { box-shadow: -16px 0 38px rgba(0,174,236,.8); } 100% { box-shadow: -2px 0 12px rgba(0,0,0,.12); } }',
    '.handle { width: 6px; cursor: col-resize; background: transparent; flex: 0 0 6px; }',
    '.handle:hover { background: rgba(128,128,128,.3); }',
    '.body { flex: 1; min-width: 0; display: flex; flex-direction: column; }',
    '.bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px 6px; font-size: 12px; }',
    '.acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; padding: 0 10px 8px; border-bottom: 1px solid var(--bnline); }',
    '.acts { position: relative; }',
    '.more { display: none; position: absolute; top: 100%; right: 6px; z-index: 30; min-width: 132px; padding: 4px; background: var(--bnbg); border: 1px solid var(--bnline); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.14); }',
    '.more.open { display: flex; flex-direction: column; gap: 4px; }',
    '.more .btn { text-align: left; justify-content: flex-start; }',
    '#btnMore { min-width: 34px; padding: 0 8px; letter-spacing: 1px; }',
    '#btnMore.has { color: var(--bnaccentInk); border-color: var(--bnaccent); }',
    '.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bnmuted); flex: 0 0 7px; }',
    '.dot.ok { background: #2ecc71; } .dot.warn { background: #f0a020; } .dot.bad { background: #e74c3c; }',
    '.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    // 多 P 标记：只占一小格，标题里写「第 2 P · 分P 名字」，不跟状态文字抢位置
    '.plabel { flex: 0 0 auto; font-size: 11px; line-height: 1; padding: 2px 5px; border-radius: 4px; background: var(--bnline); opacity: .9; }',
    '.plabel.hidden { display: none; }',
    '.btn { cursor: pointer; border: 1px solid var(--bnline2); background: var(--bnfill); color: inherit;',
    '  font-size: 12px; line-height: 1; padding: 5px 9px; border-radius: 6px; flex: 0 0 auto; white-space: nowrap;',
    '  display: inline-flex; align-items: center; gap: 4px; transition: background .12s, border-color .12s, color .12s; }',
    '.btn:hover { background: var(--bnfill2); border-color: var(--bnline2); }',
    '.btn:active { transform: translateY(1px); }',
    '.btn:focus-visible { outline: 2px solid var(--bnaccent); outline-offset: 1px; }',
    '.btn.accent { border-color: var(--bnaccent); color: var(--bnaccentInk); background: var(--bnaccentSoft); font-weight: 600; }',
    '.btn.accent:hover { background: var(--bnaccentSoft); border-color: var(--bnaccent); }',
    '.wrap.dark .btn.accent { color: #4fd2ff; }',
    '.wrap.collapsed .bar { display: none !important; }',
    '.wrap.collapsed .acts { flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px; height: 100%; padding: 10px 0 12px; border-bottom: 0; }',
    '.wrap.collapsed .acts > *:not(#btnFold):not(.foldonly) { display: none !important; }',
    '.wrap.collapsed .outline, .wrap.collapsed .stream, .wrap.collapsed .ask { display: none !important; }',
    // 收起态：一整条显眼的蓝色贴边标签。之前的 44px 灰字在深色页面上几乎看不见（用户当面提过两次）
    '.foldonly { display: none; }',
    '.wrap.collapsed .foldonly { display: flex; align-items: center; justify-content: center; }',
    '.wrap.collapsed .foldbrand { writing-mode: vertical-rl; letter-spacing: 3px; font-size: 13px; font-weight: 700; color: var(--bnaccentInk); padding: 2px 0; }',
    '.wrap.dark .wrap.collapsed .foldbrand, .wrap.collapsed.dark .foldbrand { color: #4fd2ff; }',
    '.wrap.collapsed .foldcount { margin-top: auto; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px;',
    '  background: var(--bnaccent); color: #fff; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.wrap.collapsed .foldcount.zero { background: rgba(128,128,128,.35); }',
    '.wrap.collapsed #btnFold { writing-mode: vertical-rl; letter-spacing: 2px; padding: 22px 8px; font-size: 13px;',
    '  background: var(--bnaccent); border-color: var(--bnaccent); color: #fff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.18); }',
    '.wrap.collapsed:hover #btnFold { filter: brightness(1.06); }',
    '.outline { padding: 8px 10px; border-bottom: 1px solid var(--bnline); max-height: 34vh; overflow: auto; }',
    '.outline.hidden { display: none; }',
    '.outline .item { cursor: pointer; padding: 2px 0; opacity: .8; display: flex; gap: 6px; }',
    '.outline .item:hover { opacity: 1; }',
    '.outline .t { color: var(--bnmuted); font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
    '.stream { flex: 1; overflow-y: auto; padding: 4px 0 12px; }',
    '.note { padding: 8px 10px; border-bottom: 1px dashed var(--bnline); }',
    '.note .h { display: flex; gap: 8px; align-items: baseline; }',
    '.note .t { color: var(--bnaccent); cursor: pointer; font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
    '.note .t:hover { text-decoration: underline; }',
    '.note .h { cursor: pointer; }',
    '.note .sum { font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.note.open .sum { -webkit-line-clamp: 3; }',
    '.note .chev { margin-left: auto; flex: 0 0 auto; font-size: 10px; opacity: .3; }',
    '.note.open .chev { opacity: .55; transform: rotate(90deg); }',
    '.note .chev { transition: transform .12s ease; }',
  '.note .t:focus-visible, .note .h:focus-visible { outline: 2px solid var(--bnaccent); outline-offset: -2px; border-radius: 4px; }',
    '.note .one { font-size: 12px; opacity: .62; margin-top: 4px; }',
    '.note:not(.open) .pt, .note:not(.open) .vwrap, .note:not(.open) .one { display: none; }',
    '.pt { margin: 6px 0 0; }',
    '.pt .q { border-left: 2px solid var(--bnquote); padding-left: 8px; opacity: .75; font-size: 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }',
    '.pt .p { margin-top: 2px; }',
    '.pt .kind { font-size: 11px; opacity: .55; margin-left: 4px; }',
    '.ask { border-top: 1px solid var(--bnline); padding: 8px; display: flex; gap: 6px; }',
    '.ask input { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--bnline2);',
    '  background: transparent; color: inherit; font-size: 13px; outline: none; }',
    '.empty { padding: 22px 14px; text-align: left; opacity: .78; font-size: 12px; line-height: 1.85; }',
    '.empty .et { display: block; font-size: 13px; font-weight: 600; opacity: .95; margin-bottom: 6px; }',
  '.empty.cta { opacity: 1; padding: 18px 14px; }',
  '.empty.cta .ep { margin: 0 0 6px; font-size: 13px; line-height: 1.7; }',
  '.empty.cta .ec { margin: 0 0 10px; font-size: 12px; opacity: .6; }',
  '.empty.cta .eb { display: flex; gap: 8px; flex-wrap: wrap; }',
  '.empty.cta .eb .btn { flex: 1 1 auto; }',
  '.empty.cta .eh { margin: 10px 0 0; font-size: 12px; opacity: .6; line-height: 1.7; }',
    '.mono { font-variant-numeric: tabular-nums; opacity: .6; font-size: 11px; }',
    '.btn.sm { padding: 3px 8px; font-size: 11px; }',
    '.streamwrap { position: relative; flex: 1; min-height: 0; display: flex; }',
    '.jump { position: absolute; right: 10px; bottom: 10px; z-index: 2; box-shadow: 0 2px 8px rgba(0,0,0,.18); }',
    '.jump.hidden { display: none; }',
    '.gap { margin: 4px 10px; padding: 6px 8px; border: 1px dashed var(--bnline2); border-radius: 6px; }',
    '.gap .gt { font-size: 12px; opacity: .7; display: flex; align-items: center; gap: 6px; }',
    '.gap .gt .tt { font-variant-numeric: tabular-nums; }',
    '.gap .gb { display: flex; gap: 6px; margin-top: 6px; }',
    '.pending { margin: 4px 10px; padding: 6px 8px; font-size: 12px; opacity: .55; display: flex; align-items: center; gap: 6px; }',
    '.pending .d1 { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }',
    '.outline .item .b { opacity: 0; flex: 0 0 auto; }',
    '.outline .item.active { opacity: 1; font-weight: 600; }',
    '.outline .item.sec { opacity: 1; font-weight: 600; margin: 8px 0 2px; padding-top: 4px;',
    '  border-top: 1px dashed var(--bnline2); }',
    '.outline .item.sec .s { color: var(--bnaccent); }',
    '.outline .item.sec:first-child { border-top: 0; margin-top: 0; }',
    '.outline .item.active .b { opacity: 1; }',
    // 走神横幅 / 小挂件 / 补课视图
    '.away { display: flex; align-items: center; gap: 8px; margin: 8px 10px 0; padding: 6px 8px; border-radius: 6px;',
    '  background: rgba(240,160,32,.14); border: 1px solid rgba(240,160,32,.45); font-size: 12px; }',
    '.away.hidden { display: none; }',
    '.away .at { flex: 1; min-width: 0; }',
    '.away .ab { display: flex; gap: 6px; flex: 0 0 auto; }',
    '.awaymini { margin: 8px 10px 0; align-self: flex-start; }',
    '.awaymini.hidden { display: none; }',
    '.catchup { padding: 8px 10px; }',
    '.catchup .ch { font-weight: 600; margin-bottom: 6px; }',
    '.catchup .row { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-bottom: 1px dashed var(--bnline); }',
    '.catchup .row .t { color: #00aeec; cursor: pointer; font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
    '.catchup .row .s { flex: 1; min-width: 0; }',
    '.catchup .cf { margin-top: 10px; display: flex; gap: 6px; }',
    '.catchup .ce { opacity: .6; font-size: 12px; padding: 6px 0; }',
    '.note.awayn { opacity: .8; }',
    '.note .awaytag { font-size: 11px; opacity: .55; margin-left: 6px; }',
    // 画面文字（OCR）
    '.vwrap { margin-top: 6px; }',
    '.vsum { cursor: pointer; font-size: 11px; opacity: .6; user-select: none; }',
    '.vsum:hover { opacity: .9; }',
    '.vtext { font-size: 12px; opacity: .72; white-space: pre-wrap; margin-top: 3px; padding-left: 8px;',
    '  border-left: 2px solid rgba(148,153,160,.5); display: none; }',
    '.vwrap.open .vtext { display: block; }',
    '.vnote { margin: 6px 10px 0; font-size: 11px; opacity: .6; }',
    // 音画对齐的结果（只在开启音频自检、且真的采到声音之后出现）
    '.vnote.hidden { display: none; }',
    '.btn.hidden { display: none; }',
    '.note .hstag { font-size: 11px; opacity: .55; margin-left: 6px; font-weight: 400; }',
    '.vnote.bad { opacity: .95; color: #c0392b; }',
    '.wrap.dark .vnote.bad { color: #ff8a80; }',
  // 自动收起态：22px 贴边细条，别压住 B站 右侧推荐区（用户反馈：面板一展开就点不到新视频）
  '.wrap.autohide { width: 22px !important; cursor: pointer; }',
  '.wrap.autohide .handle, .wrap.autohide .body { display: none !important; }',
  '.slim { display: none; }',
  '.wrap.autohide .slim { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;',
  '  height: 100%; padding: 12px 0; background: var(--bnaccent); color: #fff; box-shadow: -2px 0 10px rgba(0,0,0,.18); }',
  '.wrap.autohide .slim .st { writing-mode: vertical-rl; letter-spacing: 2px; font-size: 11px; font-weight: 700; }',
  '.wrap.autohide .slim .sc { font-size: 10px; font-variant-numeric: tabular-nums; opacity: .92; }',
  '.wrap.autohide .slim .sk { font-size: 11px; opacity: .85; }',
  '.wrap.autohide.dark .slim { background: #0b7fa3; }',
  // 课程条：合集 / 多 P 视频显示「课程 → 集」，点一集直接跳过去
  '.course { margin: 6px 10px 0; border: 1px solid var(--bnline); border-radius: 6px; overflow: hidden; background: var(--bnfill); }',
  '.course.hidden { display: none; }',
  // 课程条和掌握度是同一个东西的两半：贴成一张卡（上半灰底、下半白底），别让面板顶上叠三个横条
  '.course:not(.hidden):has(+ .mast:not(.hidden)) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }',
  '.course:not(.hidden):has(+ .mast:not(.hidden)) + .mast { margin-top: -1px; border-top-left-radius: 0; border-top-right-radius: 0; }',
  '.mast { margin: 6px 10px 0; border: 1px solid var(--bnline); border-radius: 6px; background: var(--bnbg); padding: 7px 9px; }',
  '.mast.hidden { display: none; }',
  '.mast .mh { display: flex; align-items: center; gap: 6px; cursor: pointer; }',
  '.mast .mt { font-size: 11px; font-weight: 600; color: var(--bnfg); flex: 0 0 auto; }',
  '.mast .mm { font-size: 11px; color: var(--bnmuted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.mast .mrow { display: none; margin-top: 5px; }',
  '.mast.open .mrow { display: block; }',
  '.mast .mr { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; cursor: pointer; font-size: 12px; line-height: 1.55; }',
  '.mast .mr:hover .mn { color: var(--bnaccentInk); }',
  '.mast .mn { color: var(--bnfg); flex: 1; min-width: 0; }',
  '.mast .mw { font-size: 11px; color: var(--bnaccentInk); flex: 0 0 auto; }',
  '.mast .mf { font-size: 11px; color: var(--bnmuted); margin-top: 4px; line-height: 1.55; }',
  '.chd { padding: 6px 8px; cursor: pointer; }',
  '.chd .c1 { display: flex; align-items: center; gap: 6px; }',
  '.chd .c2 { display: flex; align-items: center; gap: 6px; margin-top: 2px; }',
  '.chd:hover { background: var(--bnfill2); }',
  '.chd .ct { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.chd .cm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.chd .cm { font-size: 11px; color: var(--bnmuted); font-variant-numeric: tabular-nums; }',
  '.chd .next { flex: 0 0 auto; }',
  '.chd .cx { flex: 0 0 auto; font-size: 11px; color: var(--bnmuted); }',
  '.chd .cx.open { transform: rotate(180deg); }',
  '.clist { display: none; max-height: 210px; overflow-y: auto; border-top: 1px solid var(--bnline); }',
  '.clist.open { display: block; }',
  '.crow { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 5px 8px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; }',
  '.crow:hover { background: var(--bnfill2); }',
  '.crow .ci { flex: 0 0 22px; font-size: 11px; color: var(--bnmuted); font-variant-numeric: tabular-nums; }',
  '.crow .cet { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.crow .cd { flex: 0 0 auto; font-size: 11px; color: var(--bnmuted); font-variant-numeric: tabular-nums; }',
  '.crow.done .cet { color: var(--bnmuted); }',
  '.crow.done .ci { color: #00a56b; }',
  '.crow.cur { background: var(--bnaccentSoft); }',
  '.crow.cur .cet { font-weight: 600; }',
  '.crow .cpick { flex: 0 0 auto; margin: 0 2px 0 0; align-self: center; cursor: pointer; }',
  '.csection { display: flex; align-items: center; gap: 6px; padding: 6px 8px 2px; font-size: 11px; color: var(--bnmuted); border-top: 1px solid var(--bnline); background: var(--bnfill); }',
  '.csection .cst { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.csection .csall { flex: 0 0 auto; border: 0; background: transparent; color: var(--bnaccent); font: inherit; font-size: 11px; cursor: pointer; padding: 0 2px; }',
  '.csection .csall:hover { text-decoration: underline; }',
  '.cfoot { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--bnline); }',
  '.cfoot .cnum { flex: 1; min-width: 0; font-size: 11px; color: var(--bnmuted); }',
  ].join('');

  const HTML = [
    '<div class="wrap" id="wrap">',
    '<div class="handle" id="handle"></div>',
    '<div class="slim" id="slim" title="鼠标移上来展开笔记面板">',
    '<span class="st">笔记</span>',
    '<span class="sc" id="slimCount">0</span>',
    '<span class="sk">‹</span>',
    '</div>',
    '<div class="body">',
    '<div class="bar">',
    '<span class="dot" id="dot"></span>',
    '<span class="plabel hidden" id="pLabel"></span>',
    '<span class="grow" id="statusText">初始化…</span>',
    '<span class="mono" id="cost"></span>',
    '</div>',
    '<div class="acts">',
    '<button class="btn" id="btnOutline" title="展开 / 收起全片大纲">大纲 ▸</button>',
    '<button class="btn" id="btnExport" title="导出 Markdown：有笔记时导出笔记，没配 API Key 时导出字幕全文">导出</button>',
    '<button class="btn hidden" id="btnAll" title="把全片所有段落一次整理完">整理全片</button>',
    '<button class="btn" id="btnMore" title="更多：设置 / 重新核对字幕 / 画面字幕 / 导出全部 P / 诊断">⋯</button>',
    '<div class="more" id="more">',
    '<button class="btn sm" id="btnOpt" title="API 设置（Base / 模型 / Key）">设置</button>',
    '<button class="btn sm hidden" id="btnVerify" title="这份字幕只取到过一份、没交叉核对：再取一次，两次一致才算核过">再取样</button>',
    '<button class="btn sm hidden" id="btnHard" title="B站 没有字幕轨时，用本地 OCR 读画面里的硬字幕（慢，需要保持播放）">画面字幕</button>',
    '<button class="btn sm hidden" id="btnMulti" title="这是合集 / 多 P：逐 P 取样并过闸门，把有字幕的那些拼成一份 Markdown。慢，会显示进度">导出全部 P</button>',
    '<button class="btn sm hidden" id="btnDiag" title="复制诊断信息（版本 / 页面 / 字幕状态 / 端点），贴到 issue 里；不含 API Key">诊断</button>',
    '</div>',
    '<button class="btn accent" id="btnFold" title="收起右侧笔记面板">收起 ▸</button>',
    '<div class="foldonly foldbrand" id="foldBrand" title="展开右侧笔记面板">笔记</div>',
    '<div class="foldonly foldcount zero" id="foldCount" title="已生成的笔记条数">0</div>',
    '</div>',
    '<div class="vnote hidden" id="rnote"></div>',
    '<div class="course hidden" id="course">',
    '<div class="chd" id="courseHead" title="这是合集 / 多 P：点开看清单，点一集直接跳过去">',
    '<div class="c1">',
    '<span class="ct" id="courseTitle"></span>',
    '<span class="cx" id="courseToggle">▾</span>',
    '</div>',
    '<div class="c2">',
    '<span class="cm" id="courseMeta"></span>',
    '<button class="btn sm next hidden" id="courseNext" title="跳到下一集没看过的">继续</button>',
    '</div>',
    '</div>',
    '<div class="clist" id="courseList"></div>',
    '</div>',
    '<div class="mast hidden" id="mast">',
    '<div class="mh" id="mastHead" title="agent 拷打完的结果：点开看接下来该学哪几个">',
    '<span class="mt">掌握度</span>',
    '<span class="mm" id="mastMeta"></span>',
    '<button class="btn sm hidden" id="mastNext">接着学</button>',
    '</div>',
    '<div class="mrow" id="mastRows"></div>',
    '</div>',
    '<div class="away hidden" id="away">',
    '<span class="at" id="awayText"></span>',
    '<span class="ab">',
    '<button class="btn sm accent" id="awayOpen">展开补课</button>',
    '<button class="btn sm" id="awayIgnore">忽略</button>',
    '<button class="btn sm" id="awayX" title="收起这条提示">✕</button>',
    '</span>',
    '</div>',
    '<button class="btn sm awaymini hidden" id="awayMini">补课</button>',
    '<div class="vnote hidden" id="vnote"></div>',
    '<div class="outline hidden" id="outline"></div>',
    '<div class="streamwrap">',
    '<div class="stream" id="stream"></div>',
    '<button class="btn jump hidden" id="jumpBtn" title="回到最新一条笔记">回到最新 ↓</button>',
    '</div>',
    '<div class="ask"><input id="askInput" placeholder="问点什么（回车发送）" /></div>',
    '</div></div>',
  ].join('');
  shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;

  const $ = function (id) { return shadow.getElementById(id); };
  const wrap = $('wrap');
  const stream = $('stream');
  const outline = $('outline');
  const statusText = $('statusText');
  const dot = $('dot');
  const costEl = $('cost');

  const rnote = $('rnote');

  // ---- 课程目录（合集 / 多 P）：课程 → 集，点一集直接跳过去 ----
  const courseEl = $('course');
  const courseHead = $('courseHead');
  const courseTitleEl = $('courseTitle');
  const courseMetaEl = $('courseMeta');
  const courseNextEl = $('courseNext');
  const courseToggleEl = $('courseToggle');
  const courseListEl = $('courseList');
  let courseModel = null;
  let courseProgress = {};
  let courseCur = -1;
  let courseLastWatched = -1;
  let coursePick = {};
  let progWroteAt = 0;

  // 进度：一条一集，键 bnp:<cid> = 看到第几秒。放 chrome.storage.local，换视频 / 关页面都还在。
  function loadCourseProgress() {
    try {
      chrome.storage.local.get(null, function (all) {
        const map = {};
        Object.keys(all || {}).forEach(function (k) {
          if (k.indexOf('bnp:') === 0) map[k.slice(4)] = Number(all[k]) || 0;
        });
        courseProgress = map;
        refreshCourse();
      });
    } catch (e) {}
  }

  // 把课程存一份「看过什么、看到哪」，供工具栏弹窗（不在视频页时）列「接着学」。
  // 同一页面只写一次；换集/换课会重新写，时间戳因此就是「最近在看」。
  let courseSavedSig = '';
  function saveCourseRecord(m) {
    try {
      if (!m || !window.BnCourseStore) return;
      const sig = m.id + '|' + m.episodes.length + '|' + (m.title || '');
      if (sig === courseSavedSig) return;
      courseSavedSig = sig;
      const rec = window.BnCourseStore.record(m);
      if (!rec) return;
      const obj = {};
      obj[rec.key] = rec.value;
      chrome.storage.local.set(obj);
    } catch (e) {}
  }

  function saveCourseProgress(t) {
    const m = state.meta;
    if (!m || !m.cid || !window.BnCourse) return;
    const cid = String(m.cid);
    const sec = Math.floor(t);
    if (!(sec > 0)) return;
    const prev = Number(courseProgress[cid]) || 0;
    if (sec <= prev + 4) return;
    if (Date.now() - progWroteAt < 5000) return;
    progWroteAt = Date.now();
    courseProgress[cid] = sec;
    try {
      const obj = {};
      obj['bnp:' + cid] = sec;
      chrome.storage.local.set(obj);
    } catch (e) {}
    // 正好跨过「这一集算看完」的门槛时，把课程条刷新一下
    if (courseModel) {
      const pr = window.BnCourse.progress(courseModel, courseProgress);
      if (pr.watched !== courseLastWatched) refreshCourse();
    }
  }

  function refreshCourse() {
    try {
      const meta = state.meta;
      if (!window.BnCourse || !meta) {
        courseEl.classList.add('hidden');
        courseModel = null;
        return;
      }
      const m = window.BnCourse.build(meta);
      if (!m || m.kind === 'single') {
        courseEl.classList.add('hidden');
        courseModel = null;
        return;
      }
      courseModel = m;
      saveCourseRecord(m);
      const pr = window.BnCourse.progress(m, courseProgress);
      courseLastWatched = pr.watched;
      courseCur = window.BnCourse.currentIndex(m, state.bvid, meta.cid);
      courseEl.classList.remove('hidden');
      courseTitleEl.textContent = m.title || (m.kind === 'season' ? '合集' : '本视频分 P');
      courseTitleEl.title = m.title || '';
      const bits = [];
      bits.push((m.kind === 'season' ? '合集 ' : '分 P ') + m.episodes.length + (m.kind === 'season' ? ' 集' : ' 个'));
      bits.push(window.BnCourse.fmtDur(m.total));
      bits.push('已看 ' + pr.watched + ' 集');
      courseMetaEl.textContent = bits.join(' · ');
      renderCourseList();
      const nx = window.BnCourse.nextUnwatched(m, courseProgress, courseCur);
      courseNextEl.classList.toggle('hidden', !nx);
      if (nx) courseNextEl.title = '跳到第 ' + nx.index + ' 集：' + nx.title;
      refreshStudy();
    } catch (e) {
      courseEl.classList.add('hidden');
    }
  }

  function pickedEps() {
    const m = courseModel;
    if (!m) return [];
    return m.episodes.filter(function (ep) { return !!coursePick[ep.cid]; });
  }

  function syncPickLabel() {
    const foot = courseListEl.querySelector('.cfoot');
    if (!foot) return;
    const n = pickedEps().length;
    const num = foot.querySelector('.cnum');
    const btn = foot.querySelector('.cexp');
    if (num) num.textContent = n ? '已选 ' + n + ' 集' : '勾选集数后可只导出这几集';
    if (btn) {
      btn.textContent = n ? '导出选中（' + n + ' 集）' : '导出选中';
      btn.disabled = !n;
      btn.classList.toggle('accent', n > 0);
    }
    const pk = foot.querySelector('.cpack');
    if (pk) {
      pk.textContent = n ? '交给 agent（' + n + ' 集）' : '交给 agent';
      pk.disabled = !n;
    }
  }

  function renderCourseList() {
    const m = courseModel;
    if (!m) return;
    const frag = document.createDocumentFragment();
    const multi = m.kind === 'season';
    const groups = (m.sections && m.sections.length) ? m.sections : [{ title: '', episodes: m.episodes }];
    let pos = -1;
    groups.forEach(function (g) {
      if (multi && groups.length > 1) {
        const sh = document.createElement('div');
        sh.className = 'csection';
        const st = document.createElement('span');
        st.className = 'cst';
        st.textContent = (g.title || '其他') + '（' + g.episodes.length + ' 集）';
        const sa = document.createElement('button');
        sa.type = 'button';
        sa.className = 'csall';
        sa.textContent = '全选';
        sa.addEventListener('click', function (ev) {
          ev.stopPropagation();
          const all = g.episodes.every(function (ep) { return !!coursePick[ep.cid]; });
          g.episodes.forEach(function (ep) {
            if (all) delete coursePick[ep.cid]; else coursePick[ep.cid] = true;
          });
          renderCourseList();
        });
        sh.appendChild(st);
        sh.appendChild(sa);
        frag.appendChild(sh);
      }
      g.episodes.forEach(function (ep) {
        pos = m.episodes.indexOf(ep);
        const row = document.createElement('div');
        row.className = 'crow' + (pos === courseCur ? ' cur' : '') + (window.BnCourse.isWatched(ep, courseProgress) ? ' done' : '');
        row.dataset.i = String(pos);
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.title = ep.title + (ep.url ? '' : '（没有跳转地址）');
        if (multi) {
          const ck = document.createElement('input');
          ck.type = 'checkbox';
          ck.className = 'cpick';
          ck.checked = !!coursePick[ep.cid];
          ck.title = '勾上就参与「导出选中」/「交给 agent」';
          ck.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (ck.checked) coursePick[ep.cid] = true; else delete coursePick[ep.cid];
            syncPickLabel();
          });
          row.appendChild(ck);
        }
        const ci = document.createElement('span');
        ci.className = 'ci';
        ci.textContent = window.BnCourse.isWatched(ep, courseProgress) ? '✓' : String(ep.index);
        const ct = document.createElement('span');
        ct.className = 'cet';
        ct.textContent = ep.title;
        const cd = document.createElement('span');
        cd.className = 'cd';
        cd.textContent = window.BnCourse.fmtDur(ep.duration);
        row.appendChild(ci);
        row.appendChild(ct);
        row.appendChild(cd);
        frag.appendChild(row);
      });
    });
    if (multi) {
      const foot = document.createElement('div');
      foot.className = 'cfoot';
      const num = document.createElement('span');
      num.className = 'cnum';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn sm';
      clear.textContent = '清空';
      clear.addEventListener('click', function (ev) {
        ev.stopPropagation();
        coursePick = {};
        renderCourseList();
      });
      const exp = document.createElement('button');
      exp.type = 'button';
      exp.className = 'btn sm cexp';
      exp.addEventListener('click', function (ev) {
        ev.stopPropagation();
        exportSelected();
      });
      const packBtn = document.createElement('button');
      packBtn.type = 'button';
      packBtn.className = 'btn sm cpack';
      packBtn.textContent = '交给 agent';
      packBtn.title = '导出学习包（JSON + Markdown）：课程结构 + 笔记 + 概念卡，格式见 docs/agent-integration.md';
      packBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        makeStudyPack();
      });
      foot.appendChild(num);
      foot.appendChild(clear);
      foot.appendChild(exp);
      foot.appendChild(packBtn);
      frag.appendChild(foot);
    }
    courseListEl.textContent = '';
    courseListEl.appendChild(frag);
    syncPickLabel();
  }

  // 取样 + 过闸门：导出字幕、导出学习包走同一条路。
  // 结尾再试一轮：B站 字幕接口会抖（同一 (aid,cid) 连取几次可能返回不同文件），一次不成立不代表这集没字幕。
  async function collectSubs(picks, tag) {
    const good = [];
    const bad = [];
    const courseUrl = 'https://www.bilibili.com/video/' + state.bvid;
    for (let i = 0; i < picks.length; i++) {
      if (state.batch.cancel) break;
      const ep = picks[i];
      setStatus('warn', tag + ' ' + (i + 1) + '/' + picks.length + ' · 第 ' + ep.index + ' 集 ' + String(ep.title).slice(0, 12), '每集取样 2~4 次过闸门');
      let r = null;
      try {
        r = await G.gateSubtitle({ aid: ep.aid || (state.meta && state.meta.aid), cid: ep.cid, pageDur: ep.duration || 0 }, function (pg) {
          if (pg && pg.state === 'probing') {
            setStatus('warn', tag + ' ' + (i + 1) + '/' + picks.length + ' · 第 ' + ep.index + ' 集 取样 ' + pg.attempt + '/' + pg.total);
          }
        }, { attempts: 4, earlyVotes: 2 });
      } catch (e) {
        r = { verdict: 'api-error', reason: String(e).slice(0, 60) };
      }
      if (r && r.sentences && r.sentences.length && (r.verdict === 'stable' || r.verdict === 'single')) {
        good.push({
          index: ep.index, section: ep.section || '', title: ep.title,
          bvid: ep.bvid || state.bvid, cid: ep.cid, url: ep.url || courseUrl, duration: ep.duration || 0,
          verdict: r.verdict, votes: r.votes || 1,
          trackLan: (r.track && r.track.lan) || '',
          sentences: r.sentences,
        });
      } else {
        bad.push({
          index: ep.index, section: ep.section || '', title: ep.title,
          bvid: ep.bvid || state.bvid,
          verdict: (r && r.verdict) || 'no-attempt',
          reason: (r && r.reason) || '',
          cover: (r && r.stats && typeof r.stats.cover === 'number') ? Number(r.stats.cover.toFixed(3)) : null,
          aid: ep.aid || '', cid: ep.cid, duration: ep.duration || 0, url: ep.url || courseUrl,
        });
      }
    }
    if (bad.length && !state.batch.cancel) {
      const retry = bad.slice();
      for (let i = 0; i < retry.length; i++) {
        if (state.batch.cancel) break;
        const f = retry[i];
        setStatus('warn', '再试一次 ' + (i + 1) + '/' + retry.length + ' · 第 ' + f.index + ' 集 ' + String(f.title).slice(0, 12), '第一次没过闸门，重新取样');
        let r2 = null;
        try {
          r2 = await G.gateSubtitle({ aid: f.aid || (state.meta && state.meta.aid), cid: f.cid, pageDur: f.duration || 0 }, null, { attempts: 5, earlyVotes: 2 });
        } catch (e) {
          r2 = null;
        }
        if (r2 && r2.sentences && r2.sentences.length && (r2.verdict === 'stable' || r2.verdict === 'single')) {
          good.push({
            index: f.index, section: f.section, title: f.title, bvid: f.bvid, cid: f.cid, url: f.url, duration: f.duration || 0,
            verdict: r2.verdict, votes: r2.votes || 1,
            trackLan: (r2.track && r2.track.lan) || '',
            sentences: r2.sentences,
          });
          bad.splice(bad.indexOf(f), 1);
        }
      }
      good.sort(function (x, y) { return Number(x.index) - Number(y.index); });
    }
    return { good: good, bad: bad };
  }

  // 用户按「S2-0 …」这种集号勾选时，文件名 / scope 用 S2 比用后台 section 名（例如「正片」）更贴近他选的东西。
  function pickScope(picks, m) {
    const secTitles = [];
    const prefixes = [];
    picks.forEach(function (ep) {
      if (ep.section && secTitles.indexOf(ep.section) < 0) secTitles.push(ep.section);
      const p = (window.BnCourse && window.BnCourse.prefixOf) ? window.BnCourse.prefixOf(ep.title) : '';
      if (p && prefixes.indexOf(p) < 0) prefixes.push(p);
    });
    if (prefixes.length === 1) return prefixes[0];
    if (secTitles.length === 1) return secTitles[0];
    return picks.length === m.episodes.length ? '全部 ' + m.episodes.length + ' 集' : '选中 ' + picks.length + ' 集';
  }

  async function exportSelected() {
    const m = courseModel;
    if (!m) return;
    const picks = pickedEps();
    if (!picks.length) { setStatus('warn', '先在课程清单里勾选集数'); return; }
    if (state.batch && state.batch.running) {
      state.batch.cancel = true;
      setStatus('warn', '正在停止…', '这一集跑完就停，已导出的仍会落盘');
      return;
    }
    state.batch = { running: true, cancel: false };
    let r = null;
    try {
      r = await collectSubs(picks, '导出选中');
    } finally {
      state.batch.running = false;
    }
    const good = r.good;
    const bad = r.bad;
    const stopped = !!state.batch.cancel;
    if (!good.length) {
      setStatus('bad', '选中这几集的字幕都没过闸门', '多半是没登录 B站，或这些集没有 AI 字幕');
      return;
    }
    const scope = pickScope(picks, m);
    const text = window.BnBatch.seasonMarkdown(good, bad, {
      courseTitle: m.title || 'B站 课程',
      courseId: m.id || '',
      url: 'https://www.bilibili.com/video/' + state.bvid,
      total: picks.length,
      scope: scope,
    });
    downloadMarkdown(text, window.BnBatch.seasonFileName({ courseTitle: m.title || 'B站 课程', scope: scope, count: good.length }));
    const stableN = good.filter(function (x) { return x.verdict === 'stable'; }).length;
    setStatus(bad.length ? 'warn' : 'ok',
      (stopped ? '已停止：导出了 ' : '已导出 ') + good.length + '/' + picks.length + ' 集（' + stableN + ' 集两次取样一致）',
      bad.length ? '没导出的集和原因写在文件末尾' : '可以直接交给 agent / Obsidian');
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (v) { resolve(v || {}); }); } catch (e) { resolve({}); }
    });
  }
  function storageSet(obj) {
    try { chrome.storage.local.set(obj); } catch (e) {}
  }

  // 学习目标：全局一份（设置页里填），写进学习包，agent 才知道要往哪裁。
  async function studyGoal() {
    const v = await storageGet(['bn.goal']);
    return String(v['bn.goal'] || '').trim();
  }

  // 一集的概念：每 120 句问一次模型；结果按「句子数 + 首尾 sid」缓存，重复导出不再花钱。
  // 引文与时间戳一律由本地按 sid 取原句 —— 不让模型复述。
  async function conceptsForEpisode(g, onProgress) {
    if (!window.BnConcept) return [];
    const sents = g.sentences || [];
    const list = window.BnConcept.chunks(sents);
    const hash = sents.length + ':' + (sents[0] ? sents[0].sid : 0) + ':' + (sents.length ? sents[sents.length - 1].sid : 0);
    const key = 'bnc:' + g.cid;
    const cached = await storageGet([key]);
    const hit = cached[key];
    if (hit && hit.v === hash && Array.isArray(hit.concepts)) return hit.concepts;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (state.batch && state.batch.cancel) break;
      if (onProgress) onProgress(i + 1, list.length);
      const res = await callWithRetry(window.BnConcept.buildPrompt(list[i], g));
      if (!res || !res.ok) break;
      addCost(res.usage);
      const one = window.BnConcept.normalize(res.content, list[i], g);
      one.forEach(function (c) {
        c.ep = g.index;
        c.epLabel = window.BnConcept.epLabel(g);
        c.epTitle = g.title;
        c.url = g.url;
        (c.anchors || []).forEach(function (a) {
          a.ep = g.index; a.epLabel = c.epLabel; a.epTitle = g.title; a.url = g.url;
        });
        out.push(c);
      });
    }
    if (out.length) {
      const patch = {};
      patch[key] = { v: hash, concepts: out, savedAt: Date.now() };
      storageSet(patch);
    }
    return out;
  }

  // 学习包：课程结构 + 笔记 + 概念卡，导出 JSON（机器读）与 Markdown（人读）。
  async function makeStudyPack() {
    const m = courseModel;
    if (!m) return;
    const picks = pickedEps();
    if (!picks.length) { setStatus('warn', '先在课程清单里勾选集数'); return; }
    if (!window.BnStudy || !window.BnConcept) { setStatus('bad', '学习包脚本没加载', '重新加载扩展再试'); return; }
    if (state.batch && state.batch.running) {
      state.batch.cancel = true;
      setStatus('warn', '正在停止…', '当前这一集跑完就停');
      return;
    }
    state.batch = { running: true, cancel: false };
    let good = [];
    let bad = [];
    const conceptsAll = [];
    try {
      const r = await collectSubs(picks, '学习包');
      good = r.good;
      bad = r.bad;
      if (!good.length) {
        setStatus('bad', '选中这几集的字幕都没过闸门', '多半是没登录 B站，或这些集没有 AI 字幕');
        return;
      }
      const st = await storageGet(['apiKey']);
      const hasKey = !!(st.apiKey && String(st.apiKey).trim());
      if (!hasKey) {
        setStatus('warn', '没填 API Key：学习包里只有字幕统计和笔记，没有概念卡', '设置 → 填 Key 后再点一次，概念会补上');
      } else {
        for (let i = 0; i < good.length; i++) {
          if (state.batch.cancel) break;
          const g = good[i];
          setStatus('warn', '抽概念 ' + (i + 1) + '/' + good.length + ' · 第 ' + g.index + ' 集 ' + String(g.title).slice(0, 12), '一块 120 句；结果缓存，重复导出不花钱');
          const cs = await conceptsForEpisode(g, function (k, total) {
            setStatus('warn', '抽概念 ' + (i + 1) + '/' + good.length + ' · 第 ' + g.index + ' 集 第 ' + k + '/' + total + ' 块');
          });
          g.concepts = cs.map(function (c) { return c.name; });
          cs.forEach(function (c) { conceptsAll.push(c); });
        }
      }
      // 其它集的笔记：同源 IndexedDB 里存过就带上（键 bvid:cid）
      for (let i = 0; i < good.length; i++) {
        const g = good[i];
        const rec = await dbGet(String(g.bvid) + ':' + String(g.cid));
        const notes = (rec && Array.isArray(rec.notes)) ? rec.notes : [];
        g.notes = notes.map(function (n) {
          return {
            start: Number(n.start) || 0,
            one: String(n.oneThing || ''),
            summary: String(n.blockSummary || ''),
          };
        });
      }
      const goal = await studyGoal();
      const scope = pickScope(picks, m);
      const pack = window.BnStudy.build({
        course: {
          id: m.id || '', title: m.title || 'B站 课程', kind: m.kind || '',
          url: 'https://www.bilibili.com/video/' + state.bvid,
          episodesTotal: m.episodes.length, durationSec: m.total || 0,
        },
        scope: scope,
        goal: goal,
        generatedAt: new Date().toISOString(),
        episodes: good,
        concepts: window.BnConcept.merge(conceptsAll),
        failed: bad,
      });
      downloadMarkdown(pack.json, pack.baseName + '.json');
      setTimeout(function () { downloadMarkdown(pack.md, pack.baseName + '.md'); }, 600);
      const n = pack.doc.counts;
      const conceptMsg = n.concepts ? (n.concepts + ' 个概念 / ' + n.anchors + ' 个时间锚点') : '没抽概念';
      setStatus(bad.length ? 'warn' : 'ok',
        '学习包已导出 · ' + n.episodes + ' 集 · ' + n.notes + ' 条笔记 · ' + conceptMsg,
        bad.length ? '没导出的集写在包末尾' : 'JSON 给 agent，Markdown 自己看；格式见 docs/agent-integration.md');
    } finally {
      state.batch.running = false;
    }
  }

  // ---- 掌握度：agent 拷打完把 study-state 复制到剪贴板，点扩展图标「应用」后存在这里 ----
  const mastEl = $('mast');
  const mastHeadEl = $('mastHead');
  const mastMetaEl = $('mastMeta');
  const mastNextEl = $('mastNext');
  const mastRowsEl = $('mastRows');
  let studyStates = [];
  let mastSeen = '';

  function loadStudyStates() {
    try {
      chrome.storage.local.get(null, function (all) {
        studyStates = (window.BnStudyState ? window.BnStudyState.fromStorage(all) : [])
          .map(function (x) { return x.state; });
        refreshStudy();
      });
    } catch (e) {}
  }

  function currentStudy() {
    const m = courseModel;
    if (!m || !window.BnStudyState) return null;
    for (let i = 0; i < studyStates.length; i++) {
      if (window.BnStudyState.match(studyStates[i], m.id)) return studyStates[i];
    }
    return null;
  }

  // 跳到「那一集那一秒」：同一条视频就 seek，别整页刷新
  function openStudyUrl(url) {
    const u = String(url || '');
    if (!u) return;
    const bv = (/\/video\/(BV[0-9A-Za-z]+)/.exec(u) || [])[1] || '';
    const t = Number((/[?&]t=(\d+)/.exec(u) || [])[1] || 0);
    if (bv && bv === String(state.bvid)) {
      const v = getVideo();
      if (v) { try { v.currentTime = Math.max(0, t); v.play(); } catch (e) {} }
      return;
    }
    location.href = u;
  }

  function studyRow(name, tail, url, title) {
    const row = document.createElement('div');
    row.className = 'mr';
    if (title) row.title = title;
    const n = document.createElement('span');
    n.className = 'mn';
    n.textContent = name;
    const w = document.createElement('span');
    w.className = 'mw';
    w.textContent = tail || '';
    row.appendChild(n);
    row.appendChild(w);
    if (url) {
      row.addEventListener('click', function (ev) { ev.stopPropagation(); openStudyUrl(url); });
    }
    return row;
  }

  function refreshStudy() {
    try {
      const st = currentStudy();
      if (!st) {
        mastEl.classList.add('hidden');
        return;
      }
      const p = window.BnStudyState.summarize(st);
      mastEl.classList.remove('hidden');
      if (mastSeen !== st.course_id) { mastSeen = st.course_id; mastEl.classList.toggle('open', mastOpenPref() === true); }
      mastMetaEl.textContent = '懂 ' + p.understood + ' · 半懂 ' + p.shaky + ' · 没考 ' + p.unknown;
      mastMetaEl.title = (st.course || '') + ' · 共 ' + p.total + ' 个概念 · agent 拷打的结果';
      const nx = window.BnStudyState.nextList(st, 3);
      mastNextEl.classList.toggle('hidden', !nx.length);
      mastNextEl.textContent = nx.length ? '接着学' : '';
      mastNextEl.title = nx.length ? '跳到「' + nx[0].name + '」那一段' : '';
      mastNextEl.onclick = function (ev) {
        ev.stopPropagation();
        if (nx.length) openStudyUrl(nx[0].url);
      };
      mastRowsEl.textContent = '';
      nx.forEach(function (n) { mastRowsEl.appendChild(studyRow(n.name, n.reason || '再考一次', n.url)); });
      const known = window.BnStudyState.byStatus(st, 'understood', 6).map(function (c) { return c.name; });
      if (known.length) {
        const f = document.createElement('div');
        f.className = 'mf';
        f.textContent = '已经能讲清：' + known.join('、');
        mastRowsEl.appendChild(f);
      }
    } catch (e) {
      mastEl.classList.add('hidden');
    }
  }

  // 掌握度默认收起：展开只是「看哪三个概念没讲清」，不该每次开页都占半屏；用户展开过一次就记住
  function mastOpenPref() {
    try { const v = localStorage.getItem('bn.mastOpen'); return v === null ? false : v === '1'; } catch (e) { return false; }
  }
  function setMastOpen(on) {
    mastEl.classList.toggle('open', !!on);
    try { localStorage.setItem('bn.mastOpen', on ? '1' : '0'); } catch (e) {}
  }
  mastHeadEl.addEventListener('click', function (ev) {
    if (ev.target && ev.target.id === 'mastNext') return;
    setMastOpen(!mastEl.classList.contains('open'));
  });

  function openEpisode(i) {
    const m = courseModel;
    if (!m || !m.episodes[i]) return;
    const ep = m.episodes[i];
    const same = String(ep.bvid) === String(state.bvid) && state.meta && String(ep.cid) === String(state.meta.cid);
    if (same) {
      const v = getVideo();
      if (v) { try { v.currentTime = Math.max(0, ep.sec || 0); v.play(); } catch (e) {} }
      return;
    }
    if (ep.url) location.href = ep.url;
  }

  courseHead.addEventListener('click', function (ev) {
    if (ev.target && ev.target.id === 'courseNext') return;
    const open = !courseListEl.classList.contains('open');
    courseListEl.classList.toggle('open', open);
    courseToggleEl.classList.toggle('open', open);
  });
  courseListEl.addEventListener('click', function (ev) {
    const row = ev.target && ev.target.closest ? ev.target.closest('.crow') : null;
    if (!row) return;
    openEpisode(Number(row.dataset.i));
  });
  courseNextEl.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (!courseModel) return;
    const nx = window.BnCourse.nextUnwatched(courseModel, courseProgress, courseCur);
    if (!nx) return;
    openEpisode(nx.index - 1);
  });
  loadCourseProgress();
  loadStudyStates();

  // 「这份字幕像机翻」必须写在界面上，不能只留在代码里。
  // 宁可说「仅供参考」，也不能让用户以为笔记不顺是因为模型笨。
  function renderReadability() {
    const r = state.readability || {};
    if (r.verdict === 'machine') {
      rnote.className = 'vnote bad';
      rnote.textContent = '字幕疑似机器翻译' + (r.note ? '（' + r.note + '）' : '') + '，笔记可能不通顺；对照原话看。';
      rnote.title = '本地特征：' + JSON.stringify(r.flags || {});
    } else if (r.verdict === 'suspect') {
      rnote.className = 'vnote';
      rnote.textContent = '字幕可能有翻译痕迹，笔记仅供参考。';
      rnote.title = '本地特征：' + JSON.stringify(r.flags || {});
    } else {
      rnote.className = 'vnote hidden';
      rnote.textContent = '';
    }
  }

  function parseJsonLoose(s) {
    const m = String(s || '').match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : s); } catch (e) { return null; }
  }

  // 本地特征先给一个结论（免费、立刻）；再花一次约 300 token 的模型调用确认。
  // 模型说不是机翻，就把本地的 machine 降成 suspect——别硬冤枉正常字幕。
  async function checkReadability() {
    const seq = bootSeq;
    const local = G.readability(state.sentences);
    let verdict = local.verdict;
    let source = 'local';
    let note = '';
    // 本地判成「干净」就不再花模型钱；只有本地怀疑机翻时才值得花一次调用确认。
    if (local.verdict === 'machine' || local.verdict === 'suspect') {
      const res = await callModel(S.readabilityPrompt(state.sentences, 20));
      if (res && res.ok) {
        addCost(res.usage);
        const j = parseJsonLoose(res.content);
        if (j && typeof j.machine_translation === 'boolean') {
          verdict = j.machine_translation ? 'machine' : (local.verdict === 'machine' ? 'suspect' : local.verdict);
          source = 'model';
          note = String(j.why || '').slice(0, 80);
        }
      }
    }
    // 这次判定是给哪条字幕做的：模型回包期间换了视频就作废，别把结论/缓存写到新视频头上
    if (seq !== bootSeq) return;
    state.readability = { verdict, source, flags: local.flags, note };
    renderReadability();
    // 缓存恢复出来的字幕不要重写记录（否则 savedAt 会一直刷新，看起来永远像「刚取的」）；
    // 也不能在这里清 fromCache——那会让「重新核对」入口刚出现就消失。
    if (state.meta && state.sentences.length && !state.fromCache) {
      dbPut('sub|' + state.bvid + ':' + state.meta.cid, {
        sentences: state.sentences, trackLan: state.trackLan, verdict: state.verdict,
        readability: state.readability, savedAt: Date.now(),
      });
    }
    if (state.sentences.length) {
      setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + (state.notes.length ? '' : ' · 等待播放'));
    }
  }

  function setStatus(kind, text, detail) {
    state.status = kind;
    state.detail = detail || '';
    statusText.textContent = text;
    statusText.title = detail || text;
    dot.className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'bad' ? 'bad' : '');
    // 「诊断」常显：原来只在 warn/bad 时出现，结果用户碰到空白面板 / 崩了的时候，按钮根本不在。
    // 平时是灰色小按钮，真出问题（warn/bad）时点亮，一眼能看到。
    const db = $('btnDiag');
    if (db) {
      db.classList.remove('hidden');
      db.classList.toggle('accent', kind === 'warn' || kind === 'bad');
    }
    syncVerifyBtn();
  }

  // 单次取样 = 只取到过一份、没交叉核对。用户实测遇到过「内容其实是另一个视频的」，
  // 时长闸门拦不住这种；给一个显式的「再取样」，两次一致才算核过。
  // 次要动作收进「⋯」：同一行挤 7 个按钮会换行，看着乱（1.4.10）
  function syncMore() {
    const box = $('more'); const b = $('btnMore');
    if (!box || !b) return;
    let any = false, urgent = false;
    box.querySelectorAll('.btn').forEach(function (k) {
      if (k.classList.contains('hidden')) return;
      any = true;
      if (k.id === 'btnVerify') urgent = true;
    });
    b.classList.toggle('hidden', !any);
    b.classList.toggle('has', urgent);
    if (!any) box.classList.remove('open');
  }

  // 哪些状态下「再取一次」是有意义的：
  //   single     —— 只取到过一份，没交叉核对；
  //   fromCache  —— 现在用的是很久以前存下的那份，可能根本不属于这个视频；
  //   rejected   —— 这次取到的字幕对不上。B站 同一个 (aid,cid) 连取几次会返回不同文件，
  //                 重跑一次有可能拿到对的那份（实测 9 集批量里 5 集是这么救回来的）。
  // 不该出现的：need-login / no-subs / empty-url —— 重跑一百次也是同一个结果，给了按钮等于骗人。
  function verifyReasons() {
    const out = [];
    if (state.fromCache) out.push('cache');
    if (state.verdict === 'single') out.push('single');
    if (state.verdict === 'rejected') out.push('rejected');
    return out;
  }

  function syncVerifyBtn() {
    const b = $('btnVerify');
    if (!b) return;
    const why = verifyReasons();
    const show = !state.batch.running && !state.hard.active && why.length > 0;
    b.classList.toggle('hidden', !show);
    syncMore();
    if (!show) return;
    // 缓存恢复出来的字幕可能是很久以前那一份（甚至内容不是这个视频的）：
    // 明说「重新核对」，点了就丢掉缓存重取一份对照，取不到会退回原来那份。
    const rejected = why.indexOf('rejected') >= 0;
    b.textContent = state.fromCache ? '重新核对' : (rejected ? '再试一次' : '再取样');
    b.title = state.fromCache
      ? '现在用的是上次存下的字幕。点一下重新取一份对照：两次一致才算核过；取不到还会用上次那份'
      : (rejected
        ? '这次取到的字幕和视频对不上（时长或内容不一致）。B站 同一集连取几次会返回不同文件，重取一次可能拿到对的那份'
        : '这份字幕只取到过一份、没交叉核对：再取一次，两次一致才算核过');
  }

  // 剪贴板：扩展页/内容脚本的权限模型不一样，先试 navigator.clipboard，失败退到 execCommand。
  function copyText(text) {
    function fallback(t) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallback(text)); });
          return;
        }
      } catch (e) { /* 落到兜底 */ }
      resolve(fallback(text));
    });
  }

  function copyDiag() {
    const m = state.meta || {};
    const base = {
      version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
      url: location.href,
      title: m.title || document.title,
      verdict: state.verdict,
      votes: state.votes,
      sentences: state.sentences.length,
      trackLan: state.trackLan,
      totalPages: Number(m.pages) || 0,
      page: Number(m.page) || 0,
      status: state.status,
      detail: state.detail,
      titleOverlap: state.titleCheck ? (state.titleCheck.hits + '/' + state.titleCheck.tokens) : '',
      cache: state.fromCache ? 'yes' : 'no',
      at: new Date().toISOString(),
    };
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'diag' }, function (r) {
        if (r && r.ok) {
          base.endpoint = r.endpoint;
          base.model = r.model;
          base.hasKey = r.hasKey;
          base.ocr = r.ocr;
        }
        const text = S.diagText(base);
        copyText(text).then(function (ok) {
          setStatus(ok ? 'ok' : 'bad', ok ? '诊断信息已复制，贴到 issue 里就行' : '复制失败：请截图这段面板状态');
          if (!ok) console.log('[bili-notes diag]\n' + text);
          resolve(text);
        });
      });
    });
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  // B站 会在切回标签页 / 悬停预览时临时插入第二个 <video>（paused、currentTime=0），
  // 直接 querySelector('video') 会抓到它：时间对不上、覆盖断开、暂停信号错乱。
  // 按「面积大 + 时长长 + 在播」给每个 video 打分，取分最高的当正片。
  function videoScore(v) {
    if (!v) return -1;
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    let s = 0;
    if (area >= 200000) s += 6; else if (area >= 80000) s += 3; else if (area >= 20000) s += 1;
    if (!v.paused) s += 2;
    const d = Number(v.duration) || 0;
    if (d >= 600) s += 3; else if (d >= 120) s += 2; else if (d >= 30) s += 1;
    if (v.readyState >= 2) s += 1;
    if (/bpx-player/.test(v.className || '')) s += 1;
    return s;
  }
  function getVideo() {
    const list = document.querySelectorAll('video');
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    let best = null, bs = -1;
    for (let i = 0; i < list.length; i++) {
      const s = videoScore(list[i]);
      if (s > bs) { bs = s; best = list[i]; }
    }
    return best;
  }

  function seekTo(sec) {
    const v = getVideo();
    if (!v) return;
    // 字幕整体偏移时，要跳到「声音真的在那里」的位置
    v.currentTime = sec;
    if (v.paused) v.play().catch(function () {});
  }

  function renderEmpty(html) {
    stream.innerHTML = '<div class="empty">' + html + '</div>';
  }

  // 展开的笔记（按开始秒数记，重渲染后保持）
  const openNotes = {};

  function noteEl(note) {
    const el = document.createElement('div');
    el.className = 'note';
    el.dataset.start = String(note.start);
    const h = document.createElement('div');
    h.className = 'h';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = fmt(note.start);
    t.title = '跳到这一秒';
    t.setAttribute('role', 'link');
    t.tabIndex = 0;
    t.addEventListener('click', function () { seekTo(note.start); });
    t.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();
      seekTo(note.start);
    });
    const sum = document.createElement('span');
    sum.className = 'sum';
    sum.textContent = note.blockSummary || note.oneThing || '';
    h.appendChild(t);
    h.appendChild(sum);
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '\u25B6';
    h.appendChild(chev);
    const openNow = !!openNotes[String(note.start)];
    if (openNow) el.classList.add('open');
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    h.setAttribute('aria-expanded', openNow ? 'true' : 'false');
    h.setAttribute('aria-label', fmt(note.start) + ' ' + (note.blockSummary || note.oneThing || '这一段的笔记') + '（可展开/收起）');
    function toggleOpen() {
      const k = String(note.start);
      if (openNotes[k]) delete openNotes[k]; else openNotes[k] = true;
      const on = !!openNotes[k];
      el.classList.toggle('open', on);
      h.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    h.addEventListener('click', function (ev) {
      if (ev.target === t) return;
      toggleOpen();
    });
    h.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      toggleOpen();
    });
    if (note.hardsub) {
      const hs = document.createElement('span');
      hs.className = 'hstag';
      hs.textContent = '· 画面字幕（识别）';
      hs.title = '这句笔记来自画面里烧进去的字幕，由本地 OCR 读出，可能有错字。';
      sum.appendChild(hs);
    }
    if (note.away) {
      el.classList.add('awayn');
      const tag = document.createElement('span');
      tag.className = 'awaytag';
      tag.textContent = note.away === 'paused' ? '· 你当时暂停着' : '· 你当时不在页面上';
      sum.appendChild(tag);
    }
    el.appendChild(h);
    (note.points || []).forEach(function (p) {
      const d = document.createElement('div');
      d.className = 'pt';
      const q = document.createElement('div');
      q.className = 'q';
      q.textContent = p.quote;
      q.title = p.quote;
      const pl = document.createElement('div');
      pl.className = 'p';
      pl.textContent = p.plain;
      const k = document.createElement('span');
      k.className = 'kind';
      k.textContent = { conclusion: '结论', definition: '定义', example: '举例', step: '步骤', question: '提问' }[p.kind] || '';
      pl.appendChild(k);
      d.appendChild(q);
      d.appendChild(pl);
      if (p.terms && p.terms.length) {
        const tm = document.createElement('div');
        tm.className = 'q';
        tm.textContent = p.terms.map(function (x) { return x.term + '：' + x.plain; }).join(' · ');
        d.appendChild(tm);
      }
      el.appendChild(d);
    });
    if (note.visual && note.visual.length) {
      const vw = document.createElement('div');
      vw.className = 'vwrap';
      const vs = document.createElement('div');
      vs.className = 'vsum';
      vs.textContent = '画面文字 · ' + note.visual.map(function (v) { return fmt(v.t); }).join(' / ');
      vs.title = '从视频画面 OCR 出来的 PPT/板书，可能有错字。点开看原文。';
      const vt = document.createElement('div');
      vt.className = 'vtext';
      vt.textContent = note.visual.map(function (v) { return '[' + fmt(v.t) + '] ' + v.text; }).join('\n');
      vs.addEventListener('click', function () { vw.classList.toggle('open'); });
      vw.appendChild(vs);
      vw.appendChild(vt);
      el.appendChild(vw);
    }
    if (note.oneThing && note.oneThing !== (note.blockSummary || '')) {
      const one = document.createElement('div');
      one.className = 'one';
      one.textContent = note.oneThing;
      el.appendChild(one);
    }
    return el;
  }

  function gapEl(from, to, count, indexes) {
    const el = document.createElement('div');
    el.className = 'gap';
    const h = document.createElement('div');
    h.className = 'gt';
    // 正在看的这一段也算「还没生成笔记」，但别写成「未观看」
    const watching = state.lastTime >= from - 0.5 && state.lastTime <= to + 0.5;
    const tt = document.createElement('span');
    tt.className = 'tt';
    tt.textContent = (watching ? '正在看 ' : '未观看 ') + fmt(from) + '–' + fmt(to);
    const cnt = document.createElement('span');
    cnt.textContent = '· ' + count + ' 段';
    h.appendChild(tt);
    h.appendChild(cnt);
    const bs = document.createElement('div');
    bs.className = 'gb';
    const sum = document.createElement('button');
    sum.className = 'btn sm';
    sum.textContent = '总结这段';
    sum.title = '会照常调用模型，约 ' + Math.max(1, Math.round(count * 0.6)) + 'k token';
    sum.addEventListener('click', function () { forceBlocks(indexes); });
    const go = document.createElement('button');
    go.className = 'btn sm';
    go.textContent = '去看这段';
    go.title = '跳到 ' + fmt(from) + ' 开始看';
    go.addEventListener('click', function () { seekTo(from); });
    bs.appendChild(sum);
    bs.appendChild(go);
    el.appendChild(h);
    el.appendChild(bs);
    return el;
  }

  // 用户主动要求「把没看的那段也总结掉」：把这些块标成已覆盖并入队
  function forceBlocks(indexes) {
    if (state.hasKey === false) return needKey();
    state.queueHold = false;
    indexes.forEach(function (i) {
      const b = state.blocks[i];
      if (!b || b.queued) return;
      b.covered = true;
      b.forced = true;
      b.queued = true;
      state.queue.push(b);
    });
    renderStream();
    runQueue();
  }

  // 队列编排是纯函数（src/queueplan.js），页面里注入顺序万一不对也别让按钮凭空消失
  const Q = window.BnQueue || {
    todo: function (blocks) {
      return (Array.isArray(blocks) ? blocks : []).filter(function (b) { return b && b.noteIndex == null && !b.queued; });
    },
    label: function (n, running) { return running ? '停止整理' : '整理全片' + (n > 0 ? '（' + n + ' 段）' : ''); },
    doneText: function (n, total) { return '全片整理完了：这次写了 ' + n + ' 段' + (total > 0 ? '，全片共 ' + total + ' 段' : ''); },
    stopText: function (n) { return '已停止：还有 ' + n + ' 段没整理'; },
    cta: function (blocks) {
      const list = Array.isArray(blocks) ? blocks : [];
      const left = list.filter(function (b) { return b && b.noteIndex == null && !b.queued; }).length;
      if (!list.length || left <= 0) return null;
      const k = Math.max(1, Math.round(left * 0.6));
      return {
        title: '这个视频还没整理过',
        text: '全片 ' + list.length + ' 段。可以现在整理一遍，也可以先只看字幕——不花一分钱。',
        primary: '整理全片（' + left + ' 段）',
        secondary: '只导出字幕全文',
        cost: '整理约 ' + k + 'k token ≈ ¥' + (k * 1000 / 1e6 * 1.5).toFixed(3) + '，用你自己的额度',
        todo: left,
      };
    },
  };

  // 「整理全片」：不看也会写——用户点之前就该知道这是剧透 + 要花钱，所以文案把两件事都说出来。
  function syncAllBtn() {
    const b = $('btnAll');
    if (!b) return;
    const todo = Q.todo(state.blocks);
    const show = state.allRun || (state.blocks.length > 0 && todo.length > 0 && !state.batch.running);
    b.classList.toggle('hidden', !show);
    b.textContent = Q.label(todo.length, state.allRun);
    if (state.allRun) {
      b.title = '点一下停止：当前这段会做完，剩下的还原回「未观看」';
    } else {
      const n = todo.length;
      b.title = '把全片 ' + n + ' 段一次整理完（约 ' + Math.max(1, Math.round(n * 0.6)) + 'k token）。注意：没看过的段落也会写出来，等于剧透';
    }
    b.classList.toggle('accent', !!state.allRun);
    syncMore();
  }

  function startAll() {
    if (state.hasKey === false) return needKey();
    // 正在请求的那一块不算「待整理」：它马上会自己出笔记
    const todo = Q.todo(state.blocks).filter(function (b) { return b !== state.curBlock; });
    if (!todo.length) return;
    state.queueHold = false;
    state.allRun = true;
    state.allTodo = todo.length;
    state.allPrev = todo.map(function (b) { return { b: b, covered: !!b.covered, forced: !!b.forced }; });
    todo.forEach(function (b) {
      b.covered = true;
      b.forced = true;
      b.queued = true;
      state.queue.push(b);
    });
    renderStream();
    runQueue();
  }

  function stopAll() {
    state.allRun = false;
    state.queue.length = 0;
    // 还没出笔记的块还原成动手前的样子：否则它们停在 covered=true、queued=true，
    // 既不会再被播放覆盖重新排队，也不会显示「总结这段」按钮，等于从界面上消失。
    (state.allPrev || []).forEach(function (it) {
      const b = it.b;
      if (!b || b.noteIndex != null) return;
      b.covered = it.covered;
      b.forced = it.forced;
      b.queued = false;
    });
    state.allPrev = null;
    const left = state.blocks.filter(function (b) { return b.noteIndex == null; }).length;
    setStatus('warn', Q.stopText(left));
    renderStream();
  }

  // 长视频（120 块）里每出一块就整体重排一次 DOM + 写一次 IndexedDB 是 O(n²) 的活：
  // 屏幕上看不出差别，但 CPU 一直占着、视频开始掉帧。这里把「连着来的一串」合成一帧。
  let renderTimer = 0;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () { renderTimer = 0; renderStream(); }, 120);
  }
  let saveTimer = 0;
  let savePending = false;
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    if (savePending || state.notes.length) { savePending = false; saveNow(); }
  }

  // 空面板不是死路：给两个能立刻做的事（整理一遍 / 只导字幕），并把大概花多少钱写出来。
  // 装完打开一个没整理过的视频，原来只有一行「共 N 句、M 段」，等于没有下一步。
  function emptyCard() {
    if (!Q.cta || !state.blocks.length) return null;
    const c = Q.cta(state.blocks, { notes: state.notes.length });
    if (!c) return null;
    const box = document.createElement('div');
    box.className = 'empty cta';
    const t = document.createElement('span');
    t.className = 'et';
    t.textContent = c.title;
    const pp = document.createElement('p');
    pp.className = 'ep';
    pp.textContent = c.text;
    const cost = document.createElement('p');
    cost.className = 'ec';
    cost.textContent = c.cost;
    const row = document.createElement('div');
    row.className = 'eb';
    const b1 = document.createElement('button');
    b1.className = 'btn accent';
    b1.textContent = c.primary;
    b1.title = '没看过的段落也会写出来，等于剧透';
    b1.addEventListener('click', function () { startAll(); });
    const b2 = document.createElement('button');
    b2.className = 'btn';
    b2.textContent = c.secondary;
    b2.title = '把这份字幕逐句导成 .md，不用 API Key，不花钱';
    b2.addEventListener('click', exportMarkdown);
    row.appendChild(b1);
    row.appendChild(b2);
    box.appendChild(t);
    box.appendChild(pp);
    box.appendChild(cost);
    box.appendChild(row);
    if (state.emptyHint) {
      const hint = document.createElement('p');
      hint.className = 'eh';
      hint.innerHTML = state.emptyHint;
      box.appendChild(hint);
    }
    return box;
  }

  function renderStream() {
    // 补课视图接管笔记流（不弹窗、不另开页）：看完了再回正常流
    if (state.away.catchup) {
      stream.innerHTML = '';
      stream.appendChild(catchupEl(state.away.catchup));
      stream.scrollTop = 0;
      renderOutline();
      updateJump();
      return;
    }
    const box = stream;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const frag = document.createDocumentFragment();
    let i = 0;
    let pending = 0;
    while (i < state.blocks.length) {
      const b = state.blocks[i];
      if (b.noteIndex != null) {
        const n = state.notes[b.noteIndex];
        if (n && typeof n.start === 'number') { frag.appendChild(noteEl(n)); i++; continue; }
        b.noteIndex = null; // 索引失效就按未出笔记处理，别渲染出空条目
      }
      if (!b.covered) {
        let j = i;
        const idx = [];
        while (j < state.blocks.length && state.blocks[j].noteIndex == null && !state.blocks[j].covered) { idx.push(j); j++; }
        frag.appendChild(gapEl(state.blocks[i].start, state.blocks[j - 1].end, j - i, idx));
        i = j;
        continue;
      }
      pending++;
      i++;
    }
    if (!frag.childNodes.length && !pending) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.innerHTML = state.emptyHint || '';
      frag.appendChild(e);
    } else if (pending) {
      const p = document.createElement('div');
      p.className = 'pending';
      const d = document.createElement('span');
      d.className = 'd1';
      const s = document.createElement('span');
      s.textContent = state.busy ? '正在整理 ' + pending + ' 段…' : (state.queueHold ? '停下来了，还有 ' + pending + ' 段没整理' : '还有 ' + pending + ' 段待整理');
      p.appendChild(d);
      p.appendChild(s);
      // 彻底失败后队列被「扣住」：给一个不用去找别的按钮的恢复入口
      if (state.queueHold && state.queue.length) {
        const rs = document.createElement('button');
        rs.className = 'btn sm';
        rs.textContent = '继续整理';
        rs.title = '上一次调用失败了；点这里重试剩下的 ' + state.queue.length + ' 段';
        rs.addEventListener('click', function () { state.queueHold = false; runQueue(); });
        p.appendChild(rs);
      }
      frag.appendChild(p);
    }
    // 大半个片子还没整理时，最上面先给「现在能做什么」：不填 Key 的人也能先拿字幕，
    // 想一次看完的人点一下就整片整理。笔记过半之后就不再挡路了。
    if (!state.allRun && state.notes.length * 2 < state.blocks.length) {
      const card = emptyCard();
      if (card) frag.insertBefore(card, frag.firstChild);
    }
    box.innerHTML = '';
    box.appendChild(frag);
    if (state.follow || nearBottom) box.scrollTop = box.scrollHeight;
    renderOutline();
    updateJump();
    syncFold();
    syncAllBtn();
  }

  // 提纲一律按时间排序：笔记可能是「补总结」时后补的，state.notes 的追加顺序不等于时间顺序
  function sortedNotes() {
    return state.notes.slice().sort(function (a, b) { return a.start - b.start; });
  }

  function renderOutline() {
    const keep = outline.scrollTop;
    outline.innerHTML = '';
    const secs = (state.sections || []).slice().sort(function (a, b) { return a.from - b.from; });
    let lastSec = null;
    function row(cls, t, s, cb) {
      const d = document.createElement('div');
      d.className = cls;
      const tt = document.createElement('span');
      tt.className = 't';
      tt.textContent = t;
      const st = document.createElement('span');
      st.className = 's';
      st.textContent = s;
      const b = document.createElement('span');
      b.className = 'b';
      b.textContent = '●';
      d.appendChild(tt);
      d.appendChild(st);
      d.appendChild(b);
      if (cb) d.addEventListener('click', cb);
      outline.appendChild(d);
      return d;
    }
    let noteIdx = 0;
    sortedNotes().forEach(function (n) {
      let sec = null;
      for (let i = 0; i < secs.length; i++) {
        if (n.start >= secs[i].from - 0.01 && n.start < secs[i].to - 0.01) { sec = secs[i]; break; }
      }
      if (sec && sec !== lastSec) {
        const from = sec.from, to = sec.to;
        const d = row('item sec', fmt(from) + '–' + fmt(to), sec.title || '这一节', function () { seekTo(from); });
        d.dataset.from = String(from);
        d.dataset.to = String(to);
        d.title = (sec.oneLine ? sec.oneLine + '\n' : '') + '点一下跳到这一节开头';
        lastSec = sec;
      }
      const nr = row('item', fmt(n.start), n.blockSummary || n.oneThing || '', function () { seekTo(n.start); scrollToNote(n.start); });
      nr.dataset.idx = String(noteIdx++);
    });
    outline.scrollTop = keep;
    markOutline();
  }

  function markOutline() {
    const t = state.lastTime || 0;
    const items = outline.querySelectorAll('.item');
    const list = sortedNotes();
    let cur = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].start <= t + 0.01) cur = i; else break;
    }
    for (let i = 0; i < items.length; i++) {
      const di = items[i].dataset.idx;
      items[i].classList.toggle('active', di !== undefined && Number(di) === cur);
    }
    const act = cur >= 0 ? list[cur] : null;
    const secs = outline.querySelectorAll('.item.sec');
    for (let i = 0; i < secs.length; i++) {
      const from = Number(secs[i].dataset.from);
      const to = Number(secs[i].dataset.to);
      secs[i].classList.toggle('active', !!act && act.start >= from && act.start < to);
    }
  }
  function scrollToNote(start) {
    const list = stream.querySelectorAll('.note');
    for (let i = 0; i < list.length; i++) {
      if (Number(list[i].dataset.start) === Number(start)) {
        openNotes[String(start)] = true;
        list[i].classList.add('open');
        list[i].scrollIntoView({ block: 'center' });
        return;
      }
    }
  }

  function updateJump() {
    const b = shadow.getElementById('jumpBtn');
    if (!b) return;
    b.classList.toggle('hidden', state.follow);
  }

  // 冷启动 / 切换回来：把已存笔记挂回对应的块上（块对象没变，索引重排）
  function linkNotes(notes) {
    // 先清掉旧的索引：切回分 P 时 blocks 是原对象，里面还留着上一轮的 noteIndex，
    // 不清就会出现「索引指向 state.notes 里不存在的项」→ 渲染到 undefined 笔记。
    state.blocks.forEach(function (b) { b.noteIndex = null; });
    state.notes = [];
    (notes || []).forEach(function (n) {
      if (!n || typeof n.start !== 'number') return;
      // 按 start 就近找块（±0.5 秒）：字幕文件偶尔会重新取到一份，块边界可能整体差一点点
      let i = -1, bd = 0.5;
      state.blocks.forEach(function (bb, k) {
        const d = Math.abs(Number(bb.start) - n.start);
        if (d <= bd) { bd = d; i = k; }
      });
      if (i < 0) return;
      const b = state.blocks[i];
      if (b.noteIndex != null) return;
      b.noteIndex = state.notes.length;
      b.covered = true;
      b.queued = true;
      state.notes.push(n);
    });
  }

  // ---- 走神补课：你离开 / 暂停的那一段，回来后给一条可展开的补课入口 ----
  // 数据模型跟决策文档一致：spans = [{a, b, reason, ms, at}]，reason ∈ hidden | paused。
  // 只记时间戳与原因，不记你去了哪里。
  const AWAY = { HIDDEN_MIN_MS: 90000, PAUSE_MIN_MS: 120000, MINI_AFTER_MS: 8000, COOLDOWN_MS: 86400000 };
  let awayTimer = null;

  function nowMs() { return Date.now() + (state.away.skew || 0); }

  // 现场记录：真机上排查「明明切走了却没记 span」时看 window.__bnAwayDebug
  const awayDbg = [];
  function dbg(tag, extra) {
    try {
      const bound = videoBound && videoBound.isConnected ? videoBound : null;
      awayDbg.push(Object.assign({
        tag: tag, mt: Date.now(), vis: document.visibilityState, lastTime: +state.lastTime.toFixed(2),
        bound: bound ? { t: +bound.currentTime.toFixed(2), paused: bound.paused } : null,
        vids: Array.from(document.querySelectorAll('video')).map(function (v) {
          const r = v.getBoundingClientRect();
          return { t: +v.currentTime.toFixed(2), p: v.paused, w: Math.round(r.width), h: Math.round(r.height), d: Math.round(v.duration || 0) };
        })
      }, extra || {}));
      if (awayDbg.length > 40) awayDbg.shift();
    } catch (e) {}
  }
  window.__bnAwayDebug = awayDbg;

  // 只要笔记覆盖的区间与 [a,b] 有交集就算「这段记过」；
  // 只比 start 会漏掉「笔记从 22 秒开始、覆盖到 68 秒，而离开区间是 31~31」这种情况。
  function notesInSpan(a, b) {
    const lo = Math.min(a, b) - 0.6;
    const hi = Math.max(a, b) + 0.6;
    return state.notes.filter(function (n) {
      const s = Number(n.start) || 0;
      const e = n.end != null ? Number(n.end) : s;
      return s <= hi && e >= lo;
    });
  }

  // 某个时间点落在哪次「你不在」的区间里（用来给后到的笔记补上淡标记）
  function awaySpanFor(t) {
    for (let i = state.away.spans.length - 1; i >= 0; i--) {
      const sp = state.away.spans[i];
      if (t >= Math.min(sp.a, sp.b) - 0.6 && t <= Math.max(sp.a, sp.b) + 0.6) return sp;
    }
    return null;
  }

  // 横幅先弹出来，段数是后到的：笔记每生成一条就重算一次文案
  function refreshAwayBanner() {
    const sp = state.away.bannerSpan;
    const el = $('away');
    if (!sp || !el || el.classList.contains('hidden')) return;
    const n = notesInSpan(sp.a, sp.b).length;
    $('awayText').textContent = awayHead(sp) + ' · ' + (n ? '这段记了 ' + n + ' 段' : '这段还没记');
  }

  function spanRange(sp) { return sp.a === sp.b ? fmt(sp.a) : fmt(sp.a) + '–' + fmt(sp.b); }

  function awayHead(sp) {
    const dur = fmt(Math.round(sp.ms / 1000));
    return (sp.reason === 'paused' ? '你暂停了 ' : '你离开了 ') + dur;
  }

  // 这段里还没出笔记的连续块（用于「总结这段」）
  function uncoveredRunsIn(a, b) {
    const lo = Math.min(a, b) - 0.6;
    const hi = Math.max(a, b) + 0.6;
    const runs = [];
    let cur = null;
    for (let i = 0; i < state.blocks.length; i++) {
      const blk = state.blocks[i];
      if (blk.end < lo || blk.start > hi) continue;
      const uncovered = blk.noteIndex == null && !blk.covered;
      if (!uncovered) { cur = null; continue; }
      if (cur && cur.to >= blk.start - 0.6) { cur.to = blk.end; cur.count++; cur.idx.push(i); }
      else { cur = { from: blk.start, to: blk.end, count: 1, idx: [i] }; runs.push(cur); }
    }
    return runs;
  }

  function recordAway(a, b, reason, ms) {
    if (!state.away.enabled) return;
    const min = reason === 'paused' ? AWAY.PAUSE_MIN_MS : AWAY.HIDDEN_MIN_MS;
    if (ms < min) return;
    const sp = { a: a, b: Math.max(a, b), reason: reason, ms: ms, at: Date.now() };
    state.away.spans.push(sp);
    state.away.last = sp;
    state.away.catchup = null;
    const hit = notesInSpan(a, b);
    hit.forEach(function (n) { n.away = reason; });
    if (hit.length) renderStream();
    // 同一次播放只自动弹一次；关掉后同一视频 24 小时内不再弹，只留小挂件
    const seen = state.away.seen || (state.away.seen = {});
    const fresh = !seen[state.bvid] || (Date.now() - seen[state.bvid] > AWAY.COOLDOWN_MS);
    if (!state.away.shown && fresh) {
      state.away.shown = true;
      seen[state.bvid] = Date.now();
      try { chrome.storage.local.set({ 'bn.awaySeen': seen }); } catch (e) { /* 预览页没有真 storage */ }
      showAwayBanner(sp, hit.length);
    } else {
      showAwayMini(sp);
    }
    stash();
  }

  function showAwayBanner(sp, n) {
    state.away.bannerSpan = sp;
    const el = $('away');
    if (!el) return;
    $('awayText').textContent = awayHead(sp) + ' · ' + (n ? '这段记了 ' + n + ' 段' : '这段还没记');
    $('awayText').title = '区间 ' + spanRange(sp) + '（点「展开补课」看这段的一句话，或让它记账）';
    el.classList.remove('hidden');
    $('awayMini').classList.add('hidden');
    if (awayTimer) clearTimeout(awayTimer);
    awayTimer = setTimeout(function () { showAwayMini(sp); }, AWAY.MINI_AFTER_MS);
  }

  function showAwayMini(sp) {
    const el = $('away');
    if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
    if (el) el.classList.add('hidden');
    state.away.bannerSpan = sp;
    const m = $('awayMini');
    m.classList.remove('hidden');
    m.textContent = '补课 · ' + fmt(sp.a);
    m.title = awayHead(sp) + '（' + spanRange(sp) + '）';
  }

  function hideAway() {
    if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
    const el = $('away');
    if (el) el.classList.add('hidden');
    const m = $('awayMini');
    if (m) m.classList.add('hidden');
    state.away.bannerSpan = null;
  }

  function openCatchup(sp) {
    if (!sp) return;
    hideAway();
    state.away.catchup = sp;
    renderStream();
  }

  function catchupEl(sp) {
    const el = document.createElement('div');
    el.className = 'catchup';
    const head = document.createElement('div');
    head.className = 'ch';
    head.textContent = '补课 · ' + spanRange(sp) + '（' + awayHead(sp) + '）';
    el.appendChild(head);
    const notes = notesInSpan(sp.a, sp.b);
    notes.forEach(function (n) {
      const row = document.createElement('div');
      row.className = 'row';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = fmt(n.start);
      t.addEventListener('click', function () { seekTo(n.start); });
      const s = document.createElement('span');
      s.className = 's';
      // 补课只到一句话级：不展开原话和解释，想看就跳过去
      s.textContent = n.blockSummary || n.oneThing || '';
      const go = document.createElement('button');
      go.className = 'btn sm';
      go.textContent = '去看这段';
      go.addEventListener('click', function () { seekTo(n.start); });
      row.appendChild(t);
      row.appendChild(s);
      row.appendChild(go);
      el.appendChild(row);
    });
    uncoveredRunsIn(sp.a, sp.b).forEach(function (run) {
      const row = document.createElement('div');
      row.className = 'row';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = fmt(run.from);
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = '没记 · ' + run.count + ' 段（' + fmt(run.from) + '–' + fmt(run.to) + '）';
      const sum = document.createElement('button');
      sum.className = 'btn sm accent';
      sum.textContent = '总结这段';
      sum.title = '会照常调用模型，约 ' + Math.max(1, Math.round(run.count * 0.6)) + 'k token';
      sum.addEventListener('click', function () { forceBlocks(run.idx); });
      row.appendChild(t);
      row.appendChild(s);
      row.appendChild(sum);
      el.appendChild(row);
    });
    if (!el.querySelector('.row')) {
      const e = document.createElement('div');
      e.className = 'ce';
      e.textContent = '这段没有需要补的：要么已经记完了，要么还没开始。';
      el.appendChild(e);
    }
    const cf = document.createElement('div');
    cf.className = 'cf';
    const done = document.createElement('button');
    done.className = 'btn sm';
    done.textContent = '看完了';
    done.addEventListener('click', function () { state.away.catchup = null; renderStream(); });
    cf.appendChild(done);
    el.appendChild(cf);
    return el;
  }

  // 三个信号：切走标签页 / 最小化 > 90 秒；手动暂停 > 2 分钟；其余（锁屏、休眠）表现为同一种 hidden。
  // 标签页 hidden 但视频还在播 → 笔记照常生成，只打淡标记（纯听的时候笔记流是你唯一能看的东西）。
  let hiddenWall = 0, hiddenFrom = 0;
  function onVisibility() {
    const v = (videoBound && videoBound.isConnected) ? videoBound : getVideo();
    dbg('hidden-check', { vpaused: v ? v.paused : null });
    if (document.visibilityState === 'hidden') {
      if (v && v.paused) { hiddenWall = 0; dbg('hidden-skip', { why: 'paused' }); return; } // 暂停着走开交给 paused 那条信号
      hiddenWall = nowMs();
      hiddenFrom = v ? v.currentTime : state.lastTime;
      dbg('hidden-track', { from: +hiddenFrom.toFixed(2) });
      return;
    }
    if (!hiddenWall) { dbg('visible-skip', { why: 'no-hidden-wall' }); return; }
    const ms = nowMs() - hiddenWall;
    const to = Math.max(hiddenFrom, state.lastTime || 0, v ? v.currentTime : 0);
    hiddenWall = 0;
    dbg('visible-record', { from: +hiddenFrom.toFixed(2), to: +to.toFixed(2), ms: ms });
    recordAway(hiddenFrom, Math.max(hiddenFrom, to), 'hidden', ms);
  }
  document.addEventListener('visibilitychange', onVisibility);

  let pauseAt = 0, pauseWall = 0;
  function onPause() {
    const v = getVideo();
    if (!v) return;
    dbg('pause', { at: +v.currentTime.toFixed(2) });
    pauseAt = v.currentTime;
    pauseWall = nowMs();
  }
  function onPlay() {
    if (!pauseWall) return;
    const ms = nowMs() - pauseWall;
    const at = pauseAt;
    pauseWall = 0;
    recordAway(at, at, 'paused', ms);
  }

  // 预览页 / 调试用：不改真时钟也能把「离开了多久」造出来
  window.__bnAway = {
    spans: function () { return state.away.spans; },
    skew: function (ms) { state.away.skew = ms; return state.away.skew; },
    resetBanner: function () { state.away.shown = false; hideAway(); },
    record: function (a, b, reason, ms) { recordAway(a, b, reason || 'hidden', ms || 0); },
  };

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open('bn-notes', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('videos'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function dbPut(key, value) {
    try {
      const db = await openDb();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction('videos', 'readwrite');
        tx.objectStore('videos').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) { /* 存储失败不影响使用 */ }
  }

  async function dbGet(key) {
    try {
      const db = await openDb();
      return await new Promise(function (resolve) {
        const tx = db.transaction('videos', 'readonly');
        const req = tx.objectStore('videos').get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    } catch (e) { return null; }
  }

  function saveNow() {
    if (!state.bvid) return;
    if (!state.meta || !state.meta.cid) return; // meta 还没解析出来：别写 "BVxxx:" 这种半截键
    dbPut(state.bvid + ':' + (state.meta ? state.meta.cid : ''), {
      verdict: state.verdict, notes: state.notes, tokens: state.tokens,
      sections: state.sections, savedAt: Date.now(),
    });
    syncSearchIndex();
  }

  // 跨视频检索：弹窗是扩展页面，读不到 bilibili.com 的 IndexedDB，
  // 所以每次笔记变化都往 chrome.storage.local 写一份压扁的索引（bnidx:<bvid>:<cid>）。
  // 攒 1.5 秒再写，别每出一块就序列化一次。
  let idxTimer = 0;
  function syncSearchIndex() {
    if (!state.bvid || !state.notes.length) return;
    if (!window.BnIndex) return;
    clearTimeout(idxTimer);
    idxTimer = setTimeout(function () {
      try {
        const m = state.meta || {};
        const entry = window.BnIndex.build(state.bvid, {
          title: m.title, cid: m.cid, page: m.page, pages: m.pages, part: m.part, updated: Date.now(),
        }, state.notes);
        const patch = {};
        patch[window.BnIndex.PREFIX + state.bvid + ':' + (Number(m.cid) || 0)] = entry;
        chrome.storage.local.set(patch);
      } catch (e) { /* 索引写失败不影响面板本身 */ }
    }, 1500);
  }
  // 每出一块就整份写一次 IndexedDB（120 块 = 120 次全量序列化）没必要：攒 800ms 写一次，
  // 关页面/切后台时立刻补写，保证不丢。
  function save() {
    if (!state.bvid) return;
    savePending = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = 0; if (savePending) { savePending = false; saveNow(); } }, 800);
  }

  // 冷启动：把上一次这个视频的笔记从 IndexedDB 捞回来（字幕也走缓存时才会命中）
  async function hydrateNotes() {
    const seq = bootSeq;
    const key = state.bvid + ':' + (state.meta ? state.meta.cid : '');
    const saved = await dbGet(key);
    // 读 IndexedDB 期间换了视频：这批笔记属于上一个视频
    if (seq !== bootSeq) return 0;
    if (!saved || !saved.notes || !saved.notes.length) return 0;
    linkNotes(saved.notes);
    if (Array.isArray(saved.sections) && saved.sections.length) {
      state.sections = saved.sections;
      state.sections.forEach(function (s) { state.sectionTried[s.idx] = true; state.sectionTry[s.idx] = 1; });
      renderOutline();
    } else {
      maybeSections(); // 上次播到 8 块但标题没生成（失败/退出太早）：这次接着补
    }
    if (saved.tokens) {
      state.tokens = saved.tokens;
      state.cost = state.tokens / 1e6 * 1.5;
      costEl.textContent = (state.tokens / 1000).toFixed(1) + 'k ≈ ¥' + state.cost.toFixed(3);
    }
    syncSearchIndex(); // 老笔记（这个功能之前攒的）也补进检索索引
    return state.notes.length;
  }

  // ---- 画面通道：截帧 → offscreen 跑本地 OCR → 按时间挂到块上 ----
  // 只截「稳定下来」的画面（PPT 翻页停住 2 秒以上），同一张不重复识别。
  const DEIXIS = /(这个图|这张图|这里|这边|如图|看这里|看一下这个|这个公式|这个表|这个式子|这个结论)/;
  let grabber = null;

  function setVisualNote(msg) {
    state.visual.note = msg || '';
    const el = $('vnote');
    if (!el) return;
    el.textContent = state.visual.note;
    el.classList.toggle('hidden', !state.visual.note);
  }

  function normText(s) {
    return String(s || '').replace(/[\s，。、；：""''（）()【】\[\]:：,.;!?！？·…—\-]/g, '');
  }
  function bigramSet(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }
  // 两张幻灯片 OCR 结果的重合度；>=0.9 当同一张，不再重复挂
  function similarText(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const A = bigramSet(a), B = bigramSet(b);
    if (!A.size || !B.size) return false;
    let hit = 0;
    A.forEach(function (g) { if (B.has(g)) hit++; });
    return hit / (A.size + B.size - hit) >= 0.9;
  }
  function textUseful(text) {
    const t = String(text || '').trim();
    const cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
    return cn + alnum >= 8 && t.length >= 10;
  }

  function blockIndexAt(t) {
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      if (t >= b.start - 0.5 && t <= b.end + 0.5) return i;
    }
    let best = -1, bd = 1e9;
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      const d = Math.min(Math.abs(t - b.start), Math.abs(t - b.end));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function attachVisual(t, text) {
    const i = blockIndexAt(t);
    if (i < 0) return;
    const b = state.blocks[i];
    if (!b.visual) b.visual = [];
    if (b.visual.length >= 2) return;
    b.visual.push({ t: t, text: text });
    // 这块已经出过笔记：直接把画面文字补进去，不必等下次总结
    if (b.noteIndex != null) {
      const note = state.notes[b.noteIndex];
      if (note) {
        // 直接镜像 block.visual：用 concat 会在「先出笔记、后截到画面」时把同一条挂两遍
        note.visual = b.visual.slice();
        renderStream();
        save();
      }
    }
  }

  function onShot(shot) {
    if (!state.visual.enabled || !state.blocks.length) return;
    state.visual.frames++;
    chrome.runtime.sendMessage({ type: 'ocr', dataUrl: shot.dataUrl }, function (r) {
      if (chrome.runtime.lastError) return;
      if (!r || !r.ok) {
        if (r && r.error && r.error !== 'ocr-timeout') setVisualNote('画面文字识别失败：' + r.error);
        return;
      }
      const text = String(r.text || '').trim();
      if (!textUseful(text)) return;
      const n = normText(text);
      for (let i = 0; i < state.visual.seen.length; i++) {
        if (similarText(state.visual.seen[i], n)) return; // 同一张幻灯片
      }
      state.visual.seen.push(n);
      if (state.visual.seen.length > 300) state.visual.seen.shift();
      state.visual.ocr++;
      attachVisual(shot.t, text.slice(0, 600));
    });
  }

  function startVisual() {
    if (!state.visual.enabled || grabber || !window.BnFrames || !OCR_OK) return;
    grabber = window.BnFrames.create(getVideo, {
      onFrame: onShot,
      shouldRun: function () { return state.blocks.length > 0; },
      onUnsupported: function (msg) { setVisualNote('画面文字已跳过：' + msg); },
    });
    grabber.start();
  }
  function stopVisual() {
    if (grabber) { grabber.stop(); grabber = null; }
  }

  // 调试：预览页里可直接看画面通道跑到了哪一步
  window.__bnVisual = {
    stats: function () { return { frames: state.visual.frames, ocr: state.visual.ocr, note: state.visual.note, seen: state.visual.seen.length, grabber: grabber ? grabber.stats() : null }; },
    // 测试用：不等画面稳定，立刻截一帧（真实路径里只有字幕出现指代词才会这么干）
    force: function () { return grabber ? (grabber.force('manual') ? 'ok' : 'null') : 'no-grabber'; },
    blocks: function () { return state.blocks.map(function (b) { return { start: b.start, end: b.end, visual: (b.visual || []).map(function (v) { return v.text.slice(0, 80); }) }; }); },
  };


  // ---- 硬字幕兜底：B站 返回 0 条字幕轨时，用本地 OCR 读画面底部烧进去的字幕 ----
  // 为什么必须用户点：每帧 OCR 要几百毫秒到一秒多，整片跑很吃 CPU；而且大多数视频根本没硬字幕。
  const HSUB = window.BnHardsub;
  let hardTimer = 0;

  // 轻量安装包（不带 vendor/ocr）里没有本地 OCR 运行时：探一次文件在不在，不在就别给用户一个点了会报错的按钮
  let OCR_OK = true;
  let ocrProbed = false;
  function probeOcr() {
    try {
      // 不在扩展里跑（预览页、测试页面）时 chrome 可能压根没有：那不是「轻量包」，保持 OCR_OK 不动
      if (!chrome || !chrome.runtime || !chrome.runtime.getURL) return Promise.resolve();
    } catch (e) { OCR_OK = false; return Promise.resolve(); }
    // 交给 background 去探：内容脚本直接 fetch chrome-extension:// 会被 web_accessible_resources/CSP 挡住
    try {
      return chrome.runtime.sendMessage({ type: 'probeOcr' })
        .then(function (r) { OCR_OK = !!(r && r.ok); })
        .catch(function () { OCR_OK = false; });
    } catch (e) { OCR_OK = false; return Promise.resolve(); }
  }

  function hardSupported() { return !!HSUB && OCR_OK; }

  function syncHardBtn() {
    syncVerifyBtn();
    const b = $('btnHard');
    if (!b) return;
    const usable = state.verdict !== 'stable' && state.verdict !== 'single';
    b.classList.toggle('hidden', !(hardSupported() && (usable || state.hard.active)));
    // 已经有画面字幕笔记时再点会从头重认（旧笔记会清掉），按钮文案要说清是「重新识别」
    b.textContent = state.hard.active ? '停止识别' : (state.verdict === 'hardsub' ? '重新识别' : '画面字幕');
    syncMore();
  }

  function hardNote() {
    const base = '画面字幕识别中 · 已认 ' + state.hard.cues + ' 句 / ' + state.blocks.length + ' 段（本地识别，可能有错字）';
    setVisualNote(state.hard.note ? state.hard.note + ' · ' + base : base);
  }

  function hardEmptyHtml(title, hint) {
    let html = '<span class="et">' + title + '</span>' + (hint || '');
    html += '<br><br><button class="btn" id="bnRetry">再试一次</button>';
    if (hardSupported()) {
      html += ' <button class="btn accent" id="bnHard2">用画面字幕试试</button>';
      html += '<br><span class="mono">字幕烧在画面里时可用：本地识别、不上传画面，但比较慢（每帧约 1 秒），需要保持播放。</span>';
    }
    return html;
  }

  function bindEmptyHard() {
    const b = shadow.getElementById('bnHard2');
    if (b) b.addEventListener('click', function () { hardStart(); });
  }

  function hardReset() {
    if (hardTimer) { clearInterval(hardTimer); hardTimer = 0; }
    state.hard = { active: false, samples: 0, cues: 0, consumed: 0, blocks: 0, lastT: -1, emptyRun: 0, note: '', tracker: null, busy: false };
    const b = $('btnHard');
    if (b) b.classList.add('hidden');
    setVisualNote('');
  }

  // 只截画面底部字幕带：整帧 OCR 又慢又容易把台标、滚动条一起认进来
  function hardShot(v) {
    const vw = Number(v.videoWidth) || 0;
    const vh = Number(v.videoHeight) || 0;
    if (!vw || !vh) return null;
    const r = HSUB.bandRect(vw, vh);
    // 放大到 1100 宽左右：中文小字在 720p 上也只有 20 多像素，缩了就更认不出
    const scale = Math.min(2, Math.max(1, 1100 / vw));
    const w = Math.max(16, Math.round(vw * scale));
    const h = Math.max(8, Math.round(r.sh * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    try { ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h); } catch (e) { return null; }
    let dataUrl = '';
    try { dataUrl = c.toDataURL('image/jpeg', 0.85); } catch (e) { return null; }
    return { dataUrl: dataUrl, t: v.currentTime, w: w, h: h };
  }

  // 把「已经认稳」的新句子切块入队。末尾那句还在长，先不切（否则那半句会被永久截断）。
  function hardFlush(final) {
    const sents = state.sentences || [];
    const ready = final ? sents.length : Math.max(0, sents.length - 1);
    if (ready - state.hard.consumed < (final ? 1 : 4)) return 0;
    const add = sents.slice(state.hard.consumed, ready);
    state.hard.consumed = ready;
    if (!add.length) return 0;
    const nb = S.chunkSentences(add);
    nb.forEach(function (b) {
      b.covered = true;
      b.hardsub = true;
      state.blocks.push(b);
      state.queue.push(b);
    });
    state.hard.blocks = state.blocks.length;
    scheduleRender();
    runQueue();
    return nb.length;
  }

  function hardStart() {
    if (!hardSupported()) { setStatus('bad', '这个浏览器不支持本地 OCR'); return; }
    if (state.hard.active) { hardStop('手动停止'); return; }
    const v = getVideo();
    if (!v || v.readyState < 2) { setStatus('warn', '先让视频开始播放，再点「画面字幕」'); return; }
    if (v.paused) { setStatus('warn', '先点播放：识别要跟着播放头走'); return; }
    // 分辨率闸：480p 及以下的中文小字只有十几像素高，OCR 出来全是噪声。
    // 宁可当场说「清晰度太低」，也不要让用户等十分钟拿到一堆看不懂的笔记。
    const vh = Number(v.videoHeight) || 0;
    if (vh && vh < 700) {
      setStatus('warn', '清晰度太低，认不出画面字幕', '当前 ' + vh + 'p；请先切到 720P 或更高');
      renderEmpty(hardEmptyHtml('清晰度太低（当前 ' + vh + 'p）。', '画面里的中文字在 480p 下只有十几像素高，认出来全是乱码。<br>在播放器右下角把清晰度切到 720P 以上，再点「用画面字幕试试」。'));
      bindEmptyHard();
      return;
    }
    stopVisual(); // 画面通道让位：同一帧不重复 OCR 两次
    state.hard = { active: true, samples: 0, cues: 0, consumed: 0, blocks: 0, lastT: -1, emptyRun: 0, note: '', tracker: HSUB.createTracker(), busy: false };
    state.verdict = 'hardsub';
    state.trackLan = 'onscreen-ocr';
    state.sentences = [];
    state.blocks = [];
    state.queue = [];
    state.notes = [];
    state.covered = [];
    state.queueHold = false;
    state.readability = { verdict: '', source: '', flags: null, note: '' };
    state.sections = [];
    state.sectionTried = {};
    renderReadability();
    renderEmpty('正在识别画面底部的字幕…<br><br>请保持播放（可以调 1.5 倍速）。<br>本地识别，不上传画面；只在你说停或连续认不出字时停。');
    setStatus('init', '画面字幕 · 正在识别…', '本地 OCR，不上传画面');
    syncHardBtn();
    hardNote();
    hardTimer = setInterval(function () { hardTick(); }, 600);
    hardTick();
  }

  function hardStop(reason) {
    if (hardTimer) { clearInterval(hardTimer); hardTimer = 0; }
    const was = state.hard.active;
    state.hard.active = false;
    try {
      const v = getVideo();
      if (state.hard.tracker && was) state.hard.tracker.flush(v ? v.currentTime : undefined);
    } catch (e) {}
    try { if (was) hardFlush(true); } catch (e) {}
    if (state.blocks.length) {
      setStatus('warn', '画面字幕 · 已识别 ' + state.blocks.length + ' 段', reason || '');
      setVisualNote('画面字幕识别已停' + (reason ? '：' + reason : '') + '（本地识别，可能有错字）');
      renderStream();
    } else {
      setStatus('bad', '没认出画面字幕', reason || '画面底部可能没有字幕');
      renderEmpty(hardEmptyHtml('没能在画面底部认出字幕。', '常见原因：字幕不在画面里、分辨率太低（360p 认不出）、或者一直没播放。' + (reason ? '<br>最后一次：' + reason : '')));
      bindEmptyHard();
      const retry = shadow.getElementById('bnRetry');
      if (retry) retry.addEventListener('click', function () { boot(true); });
      setVisualNote('');
    }
    syncHardBtn();
  }

  async function hardTick() {
    if (!state.hard.active || state.hard.busy) return;
    const v = getVideo();
    if (!v || v.readyState < 2) return;
    if (v.paused) return;
    if (state.hard.samples >= 900) { hardStop('已经识别 900 帧，先整理到这里'); return; }
    const t = Number(v.currentTime) || 0;
    if (state.hard.lastT >= 0 && t - state.hard.lastT < HSUB.HS.MIN_SAMPLE_GAP) return;
    if (state.hard.lastT >= 0 && t < state.hard.lastT - 0.5) {
      // 往回拖不重复认：播回上次的位置再继续，避免同一句字幕进两遍
      state.hard.note = '往回拖了，播过 ' + fmt(state.hard.lastT) + ' 之后继续';
      hardNote();
      return;
    }
    const shot = hardShot(v);
    if (!shot) return;
    state.hard.busy = true;
    try {
      const r = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: 'ocr', dataUrl: shot.dataUrl }, function (x) {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(x || { ok: false, error: 'no-response' });
        });
      });
      state.hard.samples++;
      if (!r || !r.ok) {
        state.hard.note = '识别失败：' + ((r && r.error) || '未知错误');
        hardNote();
        return;
      }
      state.hard.lastT = t;
      const res = state.hard.tracker.push(t, r.text);
      const hasText = !!(res && res.text);
      if (hasText) { state.hard.emptyRun = 0; state.hard.note = ''; } else { state.hard.emptyRun++; }
      const cues = state.hard.tracker.cues();
      state.hard.cues = cues.length;
      const sents = HSUB.cuesToSentences(cues);
      state.sentences = sents;
      // 攒够 4 句再切块：一次模型调用换一块，别把每两句都跑一遍
      hardFlush(false);
      hardNote();
      if (state.hard.emptyRun >= 60) hardStop('连续 60 次没认出字');
    } finally {
      state.hard.busy = false;
    }
  }

  // opts.json === false：要自由文本（比如问答），别让后台加 response_format=json_object
  // 加了会被 DeepSeek 以 400 拒掉（Prompt must contain the word 'json'），用户看到的就是「提问失败：HTTP 400」
  function callModel(messages, opts) {
    return new Promise(function (resolve) {
      const msg = { type: 'chat', messages: messages };
      if (opts && opts.json === false) msg.json = false;
      chrome.runtime.sendMessage(msg, function (r) {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: String(chrome.runtime.lastError.message) });
        resolve(r || { ok: false, error: 'no-response' });
      });
    });
  }

  function addCost(usage) {
    if (!usage) return;
    state.tokens += (usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0);
    state.cost = state.tokens / 1e6 * 1.5;
    costEl.textContent = (state.tokens / 1000).toFixed(1) + 'k ≈ ¥' + state.cost.toFixed(3);
  }

  function statusLabel() {
    if (state.trackLan === 'onscreen-ocr' || state.verdict === 'hardsub') return '画面字幕 · 本地识别';
    const src = state.trackLan === 'ai-zh' ? 'B站 AI 字幕' : (state.trackLan || '字幕');
    let base = src;
    if (state.verdict === 'stable') base = src + ' · ' + (state.votes >= 3 ? state.votes + ' 次取样一致' : '两次取样一致');
    else if (state.verdict === 'single') base = src + ' · 单次取样（未复核）';
    if (state.readability.verdict === 'machine') base += ' · 疑似机翻';
    if (state.titleCheck && state.titleCheck.tokens >= 6 && state.titleCheck.hits === 0) base += ' · 字幕和标题对不上';
    return base;
  }

  // 可重试的失败：限流 / 网络 / 超时 / 5xx。Key 错了重试没有意义，直接报。
  const RETRYABLE = { 'rate-limit': 1, network: 1, timeout: 1, http: 1 };
  const RETRY = { attempts: 3, baseMs: 2000, rateMs: 5000 };

  async function callWithRetry(payload) {
    let last = null;
    for (let i = 0; i < RETRY.attempts; i++) {
      const res = await callModel(payload);
      if (res && res.ok) return res;
      last = res || { ok: false, error: 'no-response' };
      if (!RETRYABLE[last.code] || i === RETRY.attempts - 1) return last;
      const wait = (last.code === 'rate-limit' ? RETRY.rateMs : RETRY.baseMs) * (i + 1);
      const rest = state.queue.length;
      setStatus('warn', '排队中 · 等 ' + Math.round(wait / 1000) + 's' + (rest ? '（还有 ' + rest + ' 段）' : ''), last.error);
      await new Promise(function (r) { setTimeout(r, wait); });
    }
    return last;
  }

  // ---- 小节：每 8 块合成一个标题 ----
  // 只喂这 8 块各自的「一句话」，不喂全片摘要（喂全片会让模型拿结论倒推，写出后见之明式的小节名）。
  const SEC = { BLOCKS: 8 };

  async function generateSection(g, lo, hi, items) {
    const seq = bootSeq;
    state.sectionBusy = true;
    try {
      const bs = state.blocks.slice(lo, hi);
      const from = bs[0].start;
      const to = bs[bs.length - 1].end;
      const payload = S.sectionPrompt(
        items.map(function (n) { return { oneThing: n.oneThing, summary: n.blockSummary }; }),
        fmt(from), fmt(to));
      const res = await callWithRetry(payload);
      if (seq !== bootSeq) return;
      if (!res.ok) { state.sectionDbg = { g: g, error: res.error || 'call-failed' }; return; }
      addCost(res.usage);
      const v = S.validateSection(res.content);
      if (!v) {
        // 记下原始返回，真机上排查「标题为什么没出现」用
        state.sectionDbg = { g: g, error: 'bad-section', raw: String(res.content || '').slice(0, 160) };
        return;
      }
      state.sectionDbg = { g: g, ok: true, title: v.title };
      state.sections.push({ idx: g, from: from, to: to, title: v.title, oneLine: v.oneLine });
      stash();
      save();
      scheduleRender();
    } catch (e) {
      // 忽略：小节是锦上添花，不许影响主流程
    } finally {
      state.sectionBusy = false;
    }
  }

  // 找「最早那一个整组都出了笔记、还没生成标题」的组，一次只做一组（保证顺序、也避免并发）
  function maybeSections() {
    if (state.sectionBusy || !state.blocks.length) return;
    const per = SEC.BLOCKS;
    const groups = Math.floor(state.blocks.length / per);
    for (let g = 0; g < groups; g++) {
      if (state.sectionTried[g]) continue;
      const tries = state.sectionTry[g] || 0;
      if (tries >= 3) continue; // 同一节最多试 3 次（模型偶尔返回超长/非 JSON，不值得一直重试烧钱）
      const lo = g * per;
      const hi = lo + per;
      const items = [];
      for (let i = lo; i < hi; i++) {
        const b = state.blocks[i];
        const n = b && b.noteIndex != null ? state.notes[b.noteIndex] : null;
        if (!n) return; // 这组还没出齐，后面的组也不用看
        items.push(n);
      }
      state.sectionTry[g] = tries + 1;
      const seq = bootSeq;
      generateSection(g, lo, hi, items).then(function () {
        if (seq !== bootSeq) return; // 已经换视频了，别把标记打到新视频上
        // 成功才封口；失败留着重试（最多 3 次）
        if ((state.sections || []).some(function (s) { return s.idx === g; })) state.sectionTried[g] = true;
      }).catch(function () {});
      return;
    }
  }

  async function runQueue() {
    if (state.busy) return;
    // 上一次彻底失败（Key 错、额度用光等）之后别被 timeupdate 反复自动重试：
    // 那会在后台一直发请求又不成功。等用户自己点一下再继续。
    if (state.queueHold) return;
    state.busy = true;
    const seq = bootSeq;
    // 换视频后这个循环必须立刻退场：旧视频的回包要是被 push 进新视频的 notes，
    // 再顺着 save() 落盘，就是用户看到的「两份笔记混在一起」。
    const stale = function () { return seq !== bootSeq; };
    while (state.queue.length) {
      if (stale()) { state.busy = false; return; }
      const block = state.queue.shift();
      // 记下正在请求的这块：这时候再点「整理全片」，不能把它算成待整理，否则同一段会被写两遍
      state.curBlock = block;
      const lines = S.toPromptLines(block, state.sentences);
      const prev = state.notes.length ? state.notes[state.notes.length - 1].oneThing : '';
      const rest = state.queue.length;
      setStatus('init', '整理 ' + fmt(block.start) + '–' + fmt(block.end) + (rest ? ' · 还有 ' + rest + ' 段' : '') + ' …', statusLabel());
      // 字幕里说「这个图 / 这里 / 这个公式」时，说明画面正在承载信息：立刻补截一帧
      if (state.visual.enabled && grabber && !(block.visual && block.visual.length) && DEIXIS.test(String(block.text || ''))) {
        grabber.force('deixis');
        await new Promise(function (r) { setTimeout(r, 2200); });
        if (stale()) { state.busy = false; return; }
      }
      const machine = state.readability.verdict === 'machine';
      const maxPoints = machine ? 2 : 4;
      const res = await callWithRetry(S.promptFor(lines, prev, block.visual, { machine, maxPoints }));
      if (stale()) { state.busy = false; return; }
      if (!res.ok) {
        // 重试用尽：把这块放回队首，别静默吞掉（用户点「再试一次」或稍后自动继续都能补上）
        state.queue.unshift(block);
        state.curBlock = null;
        state.queueHold = true;
        if (res.code === 'no-key') {
          // 没填 Key 不是「故障」：字幕已经拿稳了，告诉他能直接把它导出去，而不是让他以为产品坏了。
          setStatus('bad', '还没填 API Key：现在点「导出」能拿到字幕全文（' + state.sentences.length + ' 句，带时间戳）；想变成带引文的结论就点「设置」填一个', res.error);
        } else {
          setStatus('bad', '模型调用失败：' + (res.error || '') + '（已暂停，点「继续整理」重试）', res.error);
        }
        scheduleRender();
        state.busy = false;
        return;
      }
      addCost(res.usage);
      // 同一段已经有笔记了（比如停止后重来、或两次点击叠在一起）：不再写第二条，直接指向已有那条
      let dupAt = -1;
      for (let di = 0; di < state.notes.length; di++) {
        const dn = state.notes[di];
        if (dn && Math.abs(Number(dn.start) - block.start) < 0.01) { dupAt = di; break; }
      }
      if (dupAt >= 0) {
        block.noteIndex = dupAt;
        state.curBlock = null;
        scheduleRender();
        continue;
      }
      const v = S.validate(res.content, lines, state.sentences, block.visual, { maxPoints });
      const note = {
        start: block.start, end: block.end, sids: block.sids,
        blockSummary: v.blockSummary, oneThing: v.oneThing,
        points: v.points || [], dropped: v.dropped || 0,
        visual: block.visual && block.visual.length ? block.visual.slice() : null,
      };
      if (block.hardsub) note.hardsub = true;
      const sp = awaySpanFor(note.start);
      // 你不在的时候生成的，回来打个淡标记。用户自己点「总结这段」补的，不算「你不在时记的」
      if (sp && !block.forced) note.away = sp.reason;
      block.noteIndex = state.notes.length;
      state.curBlock = null;
      state.notes.push(note);
      scheduleRender(); // 长视频里不要每块都整体重排一次
      refreshAwayBanner();
      save();
      stash();
      maybeSections();
      setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + (state.queue.length ? ' · 还有 ' + state.queue.length + ' 段' : ''));
    }
    // 队列跑完：把节流住的最后一次渲染补上，别留半截界面
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }
    renderStream();
    flushSave();
    state.busy = false;
    if (state.allRun) {
      // 中途失败会走上面的 return（queueHold 接管），所以能到这里就是真跑完了
      const done = state.allTodo;
      state.allRun = false;
      state.allPrev = null;
      setStatus('ok', Q.doneText(done, state.blocks.length));
      renderStream();
    }
  }

  // ---- 只总结真正播放过的区间：forward 跳转不产生覆盖，被跳过的那段画成占位条 ----
  function addCoverage(a, b) {
    if (!(b > a)) return;
    state.covered.push({ a: a, b: b });
    state.covered.sort(function (x, y) { return x.a - y.a; });
    const merged = [];
    for (let i = 0; i < state.covered.length; i++) {
      const s = state.covered[i];
      const last = merged[merged.length - 1];
      if (last && s.a <= last.b + 0.05) last.b = Math.max(last.b, s.b);
      else merged.push({ a: s.a, b: s.b });
    }
    state.covered = merged;
  }
  function coveredEnd(t) {
    for (let i = 0; i < state.covered.length; i++) {
      const s = state.covered[i];
      if (t >= s.a - 0.05 && t <= s.b + 0.05) return s.b;
    }
    return -1;
  }
  // 一个块要「看过」才算数：累计播放时长 ≥ 块长的 80%。
  // 光看「覆盖到块尾」不够——用户从中间拖进来时，起点永远覆盖不到，那一块就再也不会被总结。
  function addWatch(a, b) {
    if (!(b > a)) return;
    for (let i = 0; i < state.blocks.length; i++) {
      const blk = state.blocks[i];
      const lo = Math.max(a, blk.start);
      const hi = Math.min(b, blk.end);
      if (hi > lo) blk.watched = (blk.watched || 0) + (hi - lo);
    }
  }
  function isBlockCovered(b) {
    if (coveredEnd(b.start) >= b.end - 0.2) return true; // 整段连续看过
    const span = Math.max(1, b.end - b.start);
    return (b.watched || 0) >= span * 0.8;
  }
  function refreshBlocks() {
    let added = 0;
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      if (b.covered) continue;
      if (!isBlockCovered(b)) continue;
      b.covered = true;
      if (!b.queued) { b.queued = true; state.queue.push(b); added++; }
    }
    return added;
  }

  function onTimeUpdate() {
    const v = getVideo();
    if (v) saveCourseProgress(v.currentTime);
    if (!v || !state.blocks.length) return;
    const t = v.currentTime;
    const prev = state.lastTick;
    let added = 0;
    // 连续播放才记覆盖；跳转（前后落差 >3s）不算「看过」
    if (prev !== null && t > prev && t - prev <= 3) {
      addCoverage(prev, t);
      addWatch(prev, t);
      added = refreshBlocks();
    }
    state.lastTick = t;
    state.lastTime = t;
    if (added) {
      renderStream();
      runQueue();
    } else if (Math.abs(t - (state.outlineAt || 0)) > 2) {
      state.outlineAt = t;
      markOutline();
    }
  }

  let videoBound = null;
  function bindVideo() {
    const v = getVideo();
    if (!v || v === videoBound) return;
    if (videoBound) {
      videoBound.removeEventListener('timeupdate', onTimeUpdate);
      videoBound.removeEventListener('pause', onPause);
      videoBound.removeEventListener('play', onPlay);
    }
    videoBound = v;
    state.lastTick = null; // 换视频元素后重新开始记覆盖，别把新旧时间轴连起来
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('pause', onPause);
    v.addEventListener('play', onPlay);
    onTimeUpdate();
    startVisual();
    healPage(v);
  }

  // 分 P 自校正：有些入口切 P 不改 ?p=（播放器直接换片源），URL 上看不出来。
  // 只在「当前 P 的时长和播放器差 >5%」且「分 P 列表里另一个 P 的时长能对上 2%」时动手，
  // 同一个 cid 只试一次，避免来回跳。
  const healTried = {};
  function healPage(v) {
    const m = state.meta;
    if (!m || !m.pageList || m.pageList.length < 2) return;
    if (!v || v.readyState < 1) return;
    const d = Number(v.duration) || 0;
    if (d < 5) return;
    const cur = Number(m.pageDur) || 0;
    if (cur > 0 && Math.abs(d - cur) / cur <= 0.05) return;
    const key = state.bvid + '#' + m.cid;
    if (healTried[key]) return;
    const hit = m.pageList.filter(function (pg) {
      const pd = Number(pg.duration) || 0;
      return pg.cid !== m.cid && pd > 0 && Math.abs(d - pd) / pd <= 0.02;
    })[0];
    if (!hit) return;
    healTried[key] = true;
    healed.bvid = state.bvid;
    healed.p = hit.page || 0;
    boot(false, hit.page);
  }
  setInterval(bindVideo, 1500);

  function bvidFromUrl() {
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : '';
  }

  function aidFromUrl() {
    const m = location.pathname.match(/\/video\/av(\d+)/i);
    return m ? m[1] : '';
  }

  // /video/av<aid> 这种老链接：B站 有时不会重写成 BV，boot 拿不到 bvid 就直接 return，
  // 界面永远停在「初始化…」（真机 av170001 实测）。所以用 aid 问一次 view 接口换 bvid，
  // 换到之后整条链路照旧，导出的链接也指向 /video/<bvid>。
  const aidCache = {};
  async function bvidFromAid(aid) {
    if (aidCache[aid]) return aidCache[aid];
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/view?aid=' + encodeURIComponent(aid), { credentials: 'include' });
      if (!res.ok) return '';
      const j = await res.json();
      const bv = j && j.code === 0 && j.data && j.data.bvid ? String(j.data.bvid) : '';
      if (bv) aidCache[aid] = bv;
      return bv;
    } catch (e) {
      return '';
    }
  }

  // 分 P：B站 切 P 会改 URL 的 ?p=N（没写就是 P1）。content script 读不到页面里的 __INITIAL_STATE__，
  // 所以 URL 是主信号；分 P 列表点不动 URL 的入口靠 bindVideo 里的时长自校正兜底。
  // 时长自校正救回来的分 P（URL 没写 ?p= 的那些入口）：记住它，别下一次 href 变化又踢回 P1。
  // 只有在 URL 里出现显式 ?p= 时才作废——那是用户真的点了分 P 列表。
  const healed = { bvid: '', p: 0 };
  function pFromUrl() {
    const m = location.search.match(/[?&]p=(\d+)/);
    if (m) {
      healed.bvid = '';
      healed.p = 0;
      const p = Number(m[1]);
      return p > 0 ? p : 1;
    }
    if (healed.p && healed.bvid === bvidFromUrl()) return healed.p;
    return 1;
  }

  // 分 P 的一句话说明（空态提示里用）；单片视频返回空串
  function pageHint() {
    const m = state.meta || {};
    const total = Number(m.pages) || 0;
    if (total <= 1) return '';
    const pno = Number(m.page) || state.p || 1;
    return '<br>这是第 ' + pno + ' P / 共 ' + total + ' P' + (m.part ? ' · ' + m.part : '') + '。';
  }

  // 当前在播第几 P，最可靠的信号其实是播放器自己高亮的那一项：.video-pod__item.active 带 data-key = cid。
  // 比 URL 可靠（有些入口切 P 不改 ?p=），也比时长可靠（同长度的 P 会撞）。
  function cidFromDom() {
    const el = document.querySelector('.video-pod__item.active') ||
      document.querySelector('.video-pod__item--active') ||
      document.querySelector('#multi_page .list-box li.on');
    if (!el) return 0;
    const k = el.dataset ? el.dataset.key : '';
    const n = Number(k);
    return n > 0 ? n : 0;
  }

  // 把 meta 换成另一个分 P（不再发请求，分 P 列表已经在 pageList 里）
  function metaForCid(meta, cid) {
    if (!meta || !meta.pageList || !cid) return meta;
    const hit = meta.pageList.filter(function (p) { return p.cid === cid; })[0];
    if (!hit || hit.cid === meta.cid) return meta;
    return Object.assign({}, meta, {
      cid: hit.cid,
      page: hit.page,
      part: hit.part,
      pageDur: hit.duration || meta.pageDur,
    });
  }

  function setPageLabel() {
    const m = state.meta || {};
    const pl = $('pLabel');
    if (!pl) return;
    const total = Number(m.pages) || 0;
    if (total > 1) {
      pl.textContent = 'P' + (m.page || state.p) + '/' + total;
      pl.title = '第 ' + (m.page || state.p) + ' P' + (m.part ? ' · ' + m.part : '') + '（共 ' + total + ' P）';
      pl.classList.remove('hidden');
    } else {
      pl.textContent = '';
      pl.title = '';
      pl.classList.add('hidden');
    }
    syncMultiBtn();
  }

  // 「导出全部 P」只在真的是合集 / 多 P 时出现：单片视频不该多一个按钮。
  function syncMultiBtn() {
    const b = $('btnMulti');
    if (!b) return;
    const m = state.meta || {};
    const n = Array.isArray(m.pageList) ? m.pageList.length : 0;
    b.classList.toggle('hidden', n < 2);
    syncMore();
  }

  // 失败态一律「说人话 + 你能做什么」。术语（truncated/overflow/rejected）只留在 title 里给排查用。
  const STATE_TEXT = {
    truncated: ['bad', '字幕只有一部分'],
    overflow: ['bad', '字幕比视频还长'],
    malformed: ['bad', '字幕格式不对'],
    empty: ['warn', '没拿到字幕内容'],
    emptyUrl: ['warn', 'B站 返回了空字幕'],
    noSubs: ['warn', '这个视频没有字幕'],
    timeout: ['warn', '字幕检查超时'],
    rejected: ['bad', '字幕和视频对不上'],
    ambiguous: ['bad', 'B站 几次给的字幕都不一样'],
  };

  // 每种失败：发生了什么 → 为什么 → 你能做什么。没有「出错了」这种话。
  const FAIL_HINT = {
    noSubs: 'B站 没给这个视频提供字幕（UP 没传、平台也没自动生成）。<br>如果是 PPT / 板书类的课，可以直接用画面字幕试试。',
    emptyUrl: 'B站 说这个视频有字幕，但给回来的文件是空的——这是 B站 那边的问题，不是你操作错。<br>点「再试一次」通常能拿到另一份。',
    empty: '字幕文件里没有能用的句子。<br>点「再试一次」；还是空的话只能走画面字幕。',
    truncated: 'B站 给的字幕只覆盖整片的一小部分（比如 22 分钟的视频只给 2 分钟的字幕）。<br>用它总结会漏掉大半内容，所以没采用。点「再试一次」有时会返回完整的那份。',
    overflow: '字幕总长比视频还长，说明这份字幕不是这个视频的。<br>点「再试一次」。',
    malformed: '字幕的句子之间时间重叠、或者句子太短，读不出连贯内容。<br>点「再试一次」；实在不行用画面字幕。',
    timeout: '网络太慢，或者这个标签页被浏览器挂起了。<br>刷新页面再试；反复超时的话，先确认能正常打开 B站 视频。',
    rejected: 'B站 这次给的字幕文件和这个视频对不上（时长或内容不符），用了就会给你一份别的视频的笔记，所以没采用。<br>点「再试一次」重新取样——它有时会返回正确的那份。',
    ambiguous: 'B站 连着几次给的字幕文件都不重样，分不清哪份才是这个视频的。<br>过一会儿点「再试一次」；实在不行用画面字幕。',
  };

  // 同一次页面生命周期内，同一视频（含 aid+cid）不再重跑三取样闸门，也不丢已有笔记。
  // B站 播完会自己跳到下一个视频；跳走再点回来时，这里能立刻还原。
  const SESSIONS = new Map();
  function sessionKey() {
    if (!state.bvid) return '';
    return state.bvid + '|' + ((state.meta && state.meta.aid) || '') + ':' + ((state.meta && state.meta.cid) || '');
  }
  function snapshot() {
    return {
      meta: state.meta, sentences: state.sentences, blocks: state.blocks,
      notes: state.notes, tokens: state.tokens, verdict: state.verdict, trackLan: state.trackLan, titleCheck: state.titleCheck,
      covered: state.covered, readability: state.readability, sections: state.sections,
      away: { spans: state.away.spans, shown: state.away.shown },
    };
  }
  window.addEventListener('pagehide', function () { try { flushSave(); } catch (e) {} });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { flushSave(); } catch (e) {} } });

  function stash() {
    const k = sessionKey();
    if (!k) return;
    // 还没取到字幕的空壳不要存：否则切走再切回来会「恢复」成一个空会话，永远不再去取字幕
    if (!state.sentences || !state.sentences.length) return;
    SESSIONS.set(k, snapshot());
  }
  function restore(snap) {
    state.meta = snap.meta;
    refreshCourse();
    state.sentences = snap.sentences;
    state.blocks = snap.blocks;
    state.notes = snap.notes;
    state.tokens = snap.tokens;
    state.verdict = snap.verdict;
    state.trackLan = snap.trackLan;
    state.titleCheck = snap.titleCheck || null;
    state.queue = [];
    state.queueHold = false;
    state.covered = snap.covered || [];
    state.away.spans = (snap.away && snap.away.spans) || [];
    state.away.shown = !!(snap.away && snap.away.shown);
    state.away.catchup = null;
    state.away.last = null;
    state.readability = snap.readability || { verdict: '', source: '', flags: null, note: '' };
    state.sections = snap.sections || [];
    state.sectionTried = {};
    state.sectionTry = {};
    (state.sections || []).forEach(function (s) { state.sectionTried[s.idx] = true; state.sectionTry[s.idx] = 1; });
    renderReadability();
    syncHardBtn();
    hideAway();
    state.lastTick = null;
    linkNotes(snap.notes || []);
    if (state.notes.length) {
      costEl.textContent = state.tokens ? (state.tokens / 1000).toFixed(1) + 'k ≈ ¥' + (state.tokens / 1e6 * 1.5).toFixed(3) : '';
      setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + ' · 已恢复');
      state.emptyHint = '';
    } else {
      setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + ' · 等待播放');
      state.emptyHint = '共 ' + state.sentences.length + ' 句、' + state.blocks.length + ' 段。' + pageHint() + '<br>开始播放，笔记会跟着进度出现。';
    }
    renderStream();
    bindVideo();
    maybeSections();
  }

  // 把本地缓存的字幕装回界面。缓存可能是很久以前那一份（用户实测遇到过内容其实是别的视频的），
  // 所以置 fromCache=true，工具栏会多一个「重新核对」。
  async function applyCachedSub(hit) {
    state.sentences = hit.sentences;
    state.trackLan = hit.trackLan || '';
    state.verdict = hit.verdict || 'single';
    state.fromCache = true;
    state.readability = hit.readability || { verdict: '', source: '', flags: null, note: '' };
    state.titleCheck = (state.meta && state.meta.title) ? G.titleOverlap(state.meta.title, state.sentences) : null;
    state.blocks = S.chunkSentences(state.sentences);
    renderReadability();
    if (!hit.readability) checkReadability();
    const gotN = await hydrateNotes();
    setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + ' · 本地缓存');
    state.emptyHint = gotN
      ? '已恢复上次的 ' + gotN + ' 段笔记。<br>继续播放，接着往下记；跳过的段落会画成虚线。'
      : '共 ' + state.sentences.length + ' 句、' + state.blocks.length + ' 段（用的是上次通过检查的字幕）。<br>开始播放，笔记会跟着进度出现。';
    renderStream();
    bindVideo();
  }

  // 分 P 切换会连续触发两次 boot（href 变化 + 时长自校正），加个令牌：只有最后一次的继续往下走。
  let bootSeq = 0;
  async function boot(force, wantP) {
    let bvid = bvidFromUrl();
    if (!bvid) {
      const aid = aidFromUrl();
      if (!aid) return;
      bvid = await bvidFromAid(aid);
      if (!bvid) { setStatus('bad', '这个页面读不到 BV 号（番剧、课程、直播页暂时不支持），取不到字幕'); return; }
    }
    const p = Number(wantP) || pFromUrl();
    // 注意：令牌必须在「确实要重跑」之后才自增。放在早退之前会误伤——
    // URL 被 B站 改写（加 vd_source 之类）会触发一次 boot，它早退却把令牌换了，
    // 正在跑的那次闸门回来后判定自己过期，静默 return，界面就永远停在「检查字幕 N/5」。
    if (bvid === state.bvid && p === state.p && !force) return;
    const seq = ++bootSeq;
    if (!ocrProbed) { ocrProbed = true; await probeOcr(); } // 轻量包里没有 OCR 运行时，先探一次再决定要不要显示「画面字幕」
    if (state.bvid && state.meta) stash();
    // 下面要把 notes 清空：先把攒着没落盘的那一次写下去，否则切视频/重跑 boot 会让最后的笔记丢掉
    try { flushSave(); } catch (e) {}
    state.bvid = bvid;
    state.p = p;
    state.meta = null;
    refreshCourse();
    setPageLabel();
    state.notes = [];
    state.blocks = [];
    state.queue = [];
    state.queueHold = false;
    state.tokens = 0;
    state.verdict = '';
    state.titleCheck = null;
    state.away.spans = [];
    state.away.last = null;
    state.away.catchup = null;
    state.away.shown = false;
    state.visual.seen = [];
    state.visual.frames = 0;
    state.visual.ocr = 0;
    state.readability = { verdict: '', source: '', flags: null, note: '' };
    state.sections = [];
    state.sectionTried = {};
    state.sectionTry = {};
    state.sectionBusy = false;
    state.sectionDbg = null;
    renderReadability();
    hardReset();
    setVisualNote('');
    hideAway();
    renderEmpty('正在取字幕…');
    setStatus('init', '正在取字幕…');
    try {
      state.meta = await G.resolveVideo(bvid, p);
      if (seq !== bootSeq) return;
      // 播放器高亮的项才是真在播的那一 P：URL 没写 ?p= 的入口靠这里纠正
      state.meta = metaForCid(state.meta, cidFromDom());
      setPageLabel();
      refreshCourse();
    } catch (e) {
      if (seq !== bootSeq) return;
      setStatus('bad', '取视频信息失败', String(e));
      renderEmpty('取视频信息失败');
      return;
    }
    const cached = SESSIONS.get(state.bvid + '|' + state.meta.aid + ':' + state.meta.cid);
    if (cached && !force && cached.sentences && cached.sentences.length) { restore(cached); setPageLabel(); return; }

    // 本地缓存：上一次已经通过闸门的字幕，直接复用，不再赌接口这次返回哪份文件。
    // force=true（点「再取样 / 重新核对」）也要读出来：新取样失败时退回它，别把能用的字幕弄丢。
    const hit = await dbGet('sub|' + state.bvid + ':' + state.meta.cid);
    if (seq !== bootSeq) return;
    if (!force && hit && hit.sentences && hit.sentences.length) {
      await applyCachedSub(hit);
      return;
    }
    let r;
    try {
      r = await G.gateSubtitle(state.meta, function (p) {
        setStatus('init', '检查字幕 ' + p.attempt + '/' + p.total + ' …');
      });
    } catch (e) {
      if (seq !== bootSeq) return;
      setStatus('bad', '字幕检查失败', String(e));
      renderEmpty('字幕检查中断了。刷新页面再试，或按 F12 看控制台。');
      return;
    }
    if (seq !== bootSeq) return;
    // 留痕：字幕闸门这一轮到底为什么过 / 为什么没过（排障时用，界面不显示）
    state.gateLog.push({
      cid: state.meta ? state.meta.cid : 0,
      verdict: r.verdict,
      reason: r.reason || '',
      tries: (r.attempts || []).map(function (a) {
        return a.state + (a.cover != null ? '@' + a.cover : '') + (a.error ? ':' + String(a.error).slice(0, 40) : '') + (a.message ? ':' + String(a.message).slice(0, 60) : '');
      }),
    });
    if (state.gateLog.length > 8) state.gateLog.shift();
    state.verdict = r.verdict;
    state.votes = r.votes || 0;
    state.titleCheck = r.titleCheck || null;
    if (r.verdict === 'need-login') {
      setStatus('bad', '请先登录 B站', '未登录读不到字幕');
      renderEmpty('没登录 B站，所以读不到这个视频的字幕。<br><br>登录（右上角头像）→ 刷新本页，就会自动重新检查。' + (hardSupported()
        ? '<br><br><button class="btn accent" id="bnHard2">用画面字幕试试</button><br><span class="mono">不登录也能读画面里烧进去的字幕（本地识别，比较慢）。</span>'
        : ''));
      bindEmptyHard();
      syncHardBtn();
      return;
    }
    if (r.verdict !== 'stable' && r.verdict !== 'single') {
      // 用户点「重新核对」时新取样没通过（接口这次给的文件更差）：退回原来那份，别把界面弄成不可用
      if (force && hit && hit.sentences && hit.sentences.length) {
        await applyCachedSub(hit);
        setStatus('warn', statusLabel() + ' · 上次的字幕', '重新核对没通过（' + (r.reason || r.verdict) + '），先用上次那份');
        return;
      }
      const t = STATE_TEXT[r.verdict] || ['bad', '字幕不可用'];
      const last = (r.attempts || []).slice(-1)[0] || {};
      setStatus(t[0], t[1], (r.reason || r.verdict) + (last.state ? ' · 最后一次：' + last.state : ''));
      const hint = FAIL_HINT[r.verdict] || '这个视频暂时做不了可核对笔记。<br>可以点「再试一次」，或者试试画面字幕。';
      // 上次用画面字幕做过笔记的话，冷启动不该当它不存在：把笔记捞回来接着看。
      // （重认一遍要整片重新播一遍，代价太大；要重认有「重新识别」按钮，会清空旧笔记）
      const gotHard = await hydrateNotes().catch(function () { return 0; });
      if (gotHard) {
        const bs = state.notes.slice().sort(function (a, b) { return a.start - b.start; }).map(function (note) {
          return { start: note.start, end: note.end, sids: note.sids || [], covered: true, hardsub: !!note.hardsub };
        });
        state.blocks = bs;
        linkNotes(state.notes);
        state.verdict = 'hardsub';
        state.trackLan = 'onscreen-ocr';
        setStatus('warn', '画面字幕 · 上次的笔记', '要重新认一遍就点「重新识别」（会清空现有笔记）');
        state.emptyHint = '';
        renderStream();
        syncHardBtn();
        return;
      }
      renderEmpty(hardEmptyHtml(t[1], hint));
      const retry = shadow.getElementById('bnRetry');
      if (retry) retry.addEventListener('click', function () { boot(true); });
      bindEmptyHard();
      syncHardBtn();
      return;
    }
    state.sentences = r.sentences;
    state.fromCache = false;
    state.trackLan = (r.track && r.track.lan) || '';
    state.blocks = S.chunkSentences(state.sentences);
    state.readability = { verdict: '', source: '', flags: null, note: '' };
    checkReadability().catch(function () {});
    dbPut('sub|' + state.bvid + ':' + state.meta.cid, {
      sentences: state.sentences, trackLan: state.trackLan, verdict: r.verdict, savedAt: Date.now(),
      readability: state.readability,
    });
    const gotN = await hydrateNotes();
    setStatus(r.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + (gotN ? ' · 已恢复' : ' · 等待播放'));
    state.emptyHint = gotN
      ? '已恢复上次的 ' + gotN + ' 段笔记。<br>继续播放，接着往下记；跳过的段落会画成虚线。'
      : '共 ' + state.sentences.length + ' 句、' + state.blocks.length + ' 段。' + pageHint() + '<br>开始播放，笔记会跟着进度出现。';
    renderStream();
    bindVideo();
  }

  function pageUrl() {
    const m = state.meta || {};
    const base = 'https://www.bilibili.com/video/' + state.bvid;
    return (Number(m.pages) > 1 && Number(m.page) > 0) ? base + '?p=' + m.page : base;
  }

  // 时间跳转链接：pageUrl() 可能已经带了 ?p=N，直接拼 '?t=' 会变成 ...?p=2?t=661
  function jumpUrl(t) {
    const u = pageUrl();
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.floor(Number(t) || 0);
  }

  function buildMarkdown() {
    const m = state.meta || {};
    const total = Number(m.pages) || 0;
    const pno = Number(m.page) || state.p || 1;
    const heading = (m.title || state.bvid) + (total > 1 ? '（P' + pno + '/' + total + (m.part ? ' · ' + m.part : '') + '）' : '');
    const out = [];
    out.push('---');
    out.push('source: ' + pageUrl());
    out.push('title: ' + (m.title || ''));
    if (state.bvid) out.push('bvid: ' + state.bvid);
    if (total > 1) {
      out.push('page: ' + pno + '/' + total);
      if (m.part) out.push('part: ' + m.part);
    }
    out.push('subtitle_source: ' + (state.trackLan || ''));
    if (state.verdict === 'hardsub' || state.trackLan === 'onscreen-ocr') out.push('subtitle_note: 画面字幕识别，可能有错字');
    out.push('verified: ' + (state.verdict === 'stable' ? 'two-samples-agree' : 'single-sample'));
    if (state.titleCheck && state.titleCheck.tokens >= 6 && state.titleCheck.hits === 0) out.push('subtitle_title_overlap: 0/' + state.titleCheck.tokens + '（字幕和标题一个词都对不上，可能不属于这个视频）');
    // Obsidian 认 properties 里的 tags；多行写法不怕标题里的特殊字符。
    out.push('tags:');
    out.push('  - bilibili');
    out.push('  - 视频笔记');
    out.push('exported: ' + new Date().toISOString());
    const vcount = state.notes.reduce(function (a, n) { return a + ((n.visual && n.visual.length) || 0); }, 0);
    if (vcount > 0) out.push('visual_frames: ' + vcount);
    out.push('---');
    out.push('');
    out.push('# ' + heading);
    out.push('');
    // 长视频的笔记在 Obsidian 里滚半天：开头给一份可点的大纲，和面板上的「大纲」一致。
    const ol = sortedNotes();
    if (ol.length > 1) {
      out.push('## 大纲');
      out.push('');
      ol.forEach(function (n) { out.push('- [' + fmt(n.start) + '](' + jumpUrl(n.start) + ') ' + (n.blockSummary || '')); });
      out.push('');
    }
    let noteIdx = 0;
    sortedNotes().forEach(function (n) {
      out.push('## ' + fmt(n.start) + ' ' + (n.blockSummary || ''));
      out.push('');
      (n.points || []).forEach(function (p) {
        out.push('- ' + p.plain);
        out.push('  > ' + p.quote);
        out.push('  > [' + fmt(p.start) + '](' + jumpUrl(p.start) + ')');
      });
      if (n.oneThing) {
        out.push('');
        out.push('> 如果只记一件事：' + n.oneThing);
      }
      if (n.visual && n.visual.length) {
        out.push('');
        out.push('**画面文字（OCR，机器识别，可能有错字，不是原话）**');
        out.push('');
        n.visual.forEach(function (v) {
          out.push('[' + fmt(v.t) + '](' + jumpUrl(v.t) + ')');
          out.push('');
          out.push('```');
          String(v.text || '').split(/\r?\n/).forEach(function (ln) { out.push(ln); });
          out.push('```');
          out.push('');
        });
      }
      out.push('');
    });
    return out.join('\n');
  }

  function downloadMarkdown(text, name) {
    const m = state.meta || {};
    const total = Number(m.pages) || 0;
    const pno = Number(m.page) || state.p || 1;
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || (((m.title || state.bvid) + (total > 1 ? '-P' + pno : '')).replace(/[\\/:*?<>|]/g, '_') + '.md');
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // 没配 API Key 时也不给死路：导出的就是这份已经过闸门的字幕本身。
  // 用户装完扩展、还没去申请 Key，也能立刻拿到能带走的东西（606 star 的那个项目正是靠这个入口）。
  function buildTranscriptMarkdown() {
    const m = state.meta || {};
    const total = Number(m.pages) || 0;
    const pno = Number(m.page) || state.p || 1;
    const heading = (m.title || state.bvid) + (total > 1 ? '（P' + pno + '/' + total + (m.part ? ' · ' + m.part : '') + '）' : '');
    return S.transcriptMarkdown(state.sentences, {
      url: pageUrl(),
      title: heading,
      totalPages: total,
      page: pno,
      part: m.part || '',
      trackLan: state.trackLan || '',
      ocr: state.verdict === 'hardsub' || state.trackLan === 'onscreen-ocr',
      verified: state.verdict === 'stable' ? 'two-samples-agree' : 'single-sample',
      jumpUrl: jumpUrl,
    });
  }

  function exportMarkdown() {
    downloadMarkdown(state.notes.length ? buildMarkdown() : buildTranscriptMarkdown());
  }

  // 合集 / 多 P 批量导出：逐 P 取样、逐 P 过闸门，只把真的属于那一 P 的字幕拼进文件。
  // 慢是必然的（每 P 至少两次取样），所以有进度、能中途停，也写明「哪几 P 没导出、为什么」。
  async function exportAllParts() {
    const m = state.meta || {};
    const list = Array.isArray(m.pageList) ? m.pageList.slice() : [];
    if (list.length < 2) { setStatus('warn', '这个视频只有一个 P，直接点「导出」就行'); return; }
    if (!m.aid) { setStatus('bad', '拿不到这个视频的 aid', '刷新页面再试'); return; }
    if (state.batch && state.batch.running) {
      state.batch.cancel = true;
      setStatus('warn', '正在停止批量导出…', '这一 P 跑完就停；已经导出的 P 仍会落盘');
      return;
    }
    state.batch = { running: true, cancel: false };
    const btn = $('btnMulti');
    if (btn) { btn.textContent = '停止导出'; btn.classList.add('accent'); }
    const good = [];
    const bad = [];
    try {
      for (let i = 0; i < list.length; i++) {
        if (state.batch.cancel) break;
        const p = list[i];
        const label = 'P' + p.page + (p.part ? ' · ' + String(p.part).slice(0, 14) : '');
        setStatus('warn', '导出全部 P ' + (i + 1) + '/' + list.length + ' · ' + label, '每 P 取样 2~4 次过闸门；可以点「停止导出」');
        let r = null;
        try {
          r = await G.gateSubtitle({ aid: m.aid, cid: p.cid, pageDur: p.duration || 0 }, function (pg) {
            if (pg && pg.state === 'probing') {
              setStatus('warn', '导出全部 P ' + (i + 1) + '/' + list.length + ' · ' + label + ' 取样 ' + pg.attempt + '/' + pg.total);
            }
          }, { attempts: 4, earlyVotes: 2 });
        } catch (e) {
          r = { verdict: 'api-error', reason: String(e).slice(0, 60) };
        }
        if (r && r.sentences && r.sentences.length && (r.verdict === 'stable' || r.verdict === 'single')) {
          good.push({
            page: p.page, part: p.part || '', duration: p.duration || 0,
            verdict: r.verdict, votes: r.votes || 1,
            trackLan: (r.track && r.track.lan) || '',
            sentences: r.sentences,
          });
        } else {
          bad.push({
            page: p.page, part: p.part || '',
            verdict: (r && r.verdict) || 'no-attempt',
            reason: (r && r.reason) || '',
            cover: (r && r.stats && typeof r.stats.cover === 'number') ? Number(r.stats.cover.toFixed(3)) : null,
          });
        }
      }
    } finally {
      state.batch.running = false;
      if (btn) { btn.textContent = '导出全部 P'; btn.classList.remove('accent'); }
    }
    const stopped = !!state.batch.cancel;
    if (!good.length) {
      setStatus('bad', '没有一个 P 的字幕能确认', '多半是没登录 B站，或这些 P 都没有 AI 字幕');
      return;
    }
    const text = window.BnBatch.batchMarkdown(good, bad, {
      url: 'https://www.bilibili.com/video/' + state.bvid,
      title: m.title || state.bvid,
      bvid: state.bvid,
      totalPages: list.length,
    });
    downloadMarkdown(text, window.BnBatch.batchFileName({ title: m.title || state.bvid, bvid: state.bvid, totalPages: list.length }));
    const stableN = good.filter(function (x) { return x.verdict === 'stable'; }).length;
    setStatus(bad.length ? 'warn' : 'ok',
      (stopped ? '已停止：导出了 ' : '已导出 ') + good.length + '/' + list.length + ' P（' + stableN + ' P 两次取样一致）',
      bad.length ? '没导出的 P 和原因写在文件末尾' : '全部 P 都已导出');
  }

  // 调试/验证用：不经下载直接拿到导出的 Markdown 文本
  window.__bnMarkdown = buildMarkdown;
  window.__bnTranscriptMarkdown = buildTranscriptMarkdown;
  window.__bnExportAll = exportAllParts;
  window.__bnCopyDiag = copyDiag;
  window.__bnSetStatus = setStatus;
  // 调试：预览页里直接检查/触发小节（真机上小节靠播够 8 块自动生成）
  window.__bnSections = {
    run: maybeSections,
    list: function () { return state.sections.map(function (s) { return { title: s.title, from: s.from, to: s.to }; }); },
  };
  // 调试/验证用：直接看/改字幕可读性结论，不花模型钱
  window.__bnRead = {
    check: checkReadability,
    show: function (v, note) { state.readability = { verdict: v, source: 'debug', flags: state.readability.flags || null, note: note || '' }; renderReadability(); if (state.verdict) setStatus(state.verdict === 'stable' ? 'ok' : 'warn', statusLabel() + (state.notes.length ? '' : ' · 等待播放')); return rnote.textContent; },
  };

  async function ask(q) {
    if (!q.trim()) return;
    const ctx = state.notes.slice(-6).map(function (n) {
      return '[' + fmt(n.start) + '] ' + (n.blockSummary || '') + ' ' + (n.points || []).map(function (p) { return p.plain; }).join('；');
    }).join('\n');
    const box = document.createElement('div');
    box.className = 'note';
    box.textContent = '思考中…';
    stream.appendChild(box);
    stream.scrollTop = stream.scrollHeight;
    const res = await callModel([
      { role: 'system', content: '你在根据视频笔记回答问题。只用给定笔记内容，不足就说没记到。答案末尾给一个 [mm:ss] 时间标记。' },
      { role: 'user', content: '笔记：\n' + ctx + '\n\n问题：' + q },
    ], { json: false });
    box.textContent = res.ok ? (res.content || '') : ('提问失败：' + (res.error || ''));
    stream.scrollTop = stream.scrollHeight;
  }

  // ---- 页面让位：面板展开时给页面右侧腾出面板宽度，别盖住推荐区 ----
  // B站 视频页是「播放器（可伸缩）+ 右侧固定 350px 列」，容器有最小布局宽度（实测约 1064）。
  // 直接改容器 width 会把播放器挤到屏幕外（实测 video.left 变 -6 ~ -118），所以换成：
  // 给 <html> 加 padding-right，再广播一次 resize 让播放器自己按新宽度重排，最后验一遍再决定留不留。
  const SHIFT_MIN_CONTENT = 1064;
  let shiftApplied = 0;
  let shiftBlockedAt = 0;
  let shiftVerifyTimer = 0;
  let shiftPending = 0;
  let shiftSynth = 0; // 我们自己发出的 resize，别当成用户改窗口

  function shiftNeeded() {
    if (state.collapsed || state.autoHidden) return 0; // 收起 / 贴边时不占页面宽度
    return state.width + 6; // +6 是面板左侧那条拖拽把手
  }

  function shiftRec() {
    return document.querySelector('.recommend-list-v1, #reco_list, .right-container');
  }

  function shiftFire() {
    shiftSynth++;
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* 老浏览器 */ }
    shiftSynth--;
  }

  // 撤掉让位。B站 的播放器宽度是 JS 算的，光删 padding 不会自己变回来，要再广播一次。
  function shiftUnshift() {
    if (!shiftApplied) {
      if (document.documentElement.style.paddingRight) {
        document.documentElement.style.paddingRight = '';
        shiftFire();
      }
      return;
    }
    shiftApplied = 0;
    document.documentElement.style.paddingRight = '';
    shiftFire();
  }

  function shiftRestore() { shiftUnshift(); }

  // 让位之后确认：播放器和推荐区都完整落在面板左边；不成立就说明这屏挤不下，撤回去。
  function shiftVerify(need) {
    if (!shiftApplied) return true;
    const panelLeft = window.innerWidth - need;
    const v = getVideo();
    const vr = v ? v.getBoundingClientRect() : null;
    const rec = shiftRec();
    const rr = rec ? rec.getBoundingClientRect() : null;
    const videoOut = vr && vr.width > 0 && (vr.left < -1 || vr.right > panelLeft + 1);
    const recOut = rr && rr.width > 0 && rr.right > panelLeft + 1;
    if (videoOut || recOut) {
      shiftBlockedAt = Math.round(window.innerWidth);
      shiftUnshift();
      return false;
    }
    return true;
  }

  function shiftApply() {
    const need = shiftNeeded();
    if (need <= 0) { shiftUnshift(); return; }
    if (shiftBlockedAt === Math.round(window.innerWidth)) return;
    // 空间不够别硬挤：挤下去播放器会跑出屏幕，比遮住推荐区更难用（这时靠贴边细条让人点到右侧）
    if (window.innerWidth - need < SHIFT_MIN_CONTENT) { shiftUnshift(); return; }
    if (shiftApplied === need) {
      if (!document.documentElement.style.paddingRight) document.documentElement.style.paddingRight = need + 'px';
      return;
    }
    document.documentElement.style.paddingRight = need + 'px';
    shiftApplied = need;
    shiftFire(); // 播放器只会跟着 resize 重算宽度
    clearTimeout(shiftVerifyTimer);
    shiftVerifyTimer = setTimeout(function () { shiftVerify(need); }, 400);
  }

  // 拖动宽度时别每一帧都改页面布局
  function shiftApplySoon() {
    clearTimeout(shiftPending);
    shiftPending = setTimeout(shiftApply, 60);
  }

  // 用户真的改了窗口大小：清掉「这屏挤不下」的记忆，重新试一次
  window.addEventListener('resize', function () {
    if (shiftSynth > 0) return;
    shiftBlockedAt = 0;
    clearTimeout(shiftVerifyTimer);
    shiftApply();
    setTimeout(shiftApply, 300); // B站 自己也会在 resize 后重排一次
  });

    // 收起态整条贴边标签都可点开（之前只有一根 44px 灰字，用户两次说找不到）
  function foldToggle(e) {
    if (e) e.stopPropagation();
    state.collapsed = !state.collapsed;
    wrap.classList.toggle('collapsed', state.collapsed);
    if (state.collapsed) { state.autoHidden = false; wrap.classList.remove('autohide'); }
    syncFold();
    shiftBlockedAt = 0;
    setTimeout(shiftApply, 160); // 等面板宽度过渡结束再收放页面
  }

  // 收起态下方显示已出笔记条数，让人一眼知道「它还在干活」
  function syncFold() {
    const b = $('btnFold');
    if (b) {
      b.textContent = state.collapsed ? '展开 ▸' : '收起 ▸';
      b.title = state.collapsed ? '展开右侧笔记面板' : '收起右侧笔记面板';
    }
    const sc = $('slimCount');
    if (sc) sc.textContent = String(state.notes.length);
    const c = $('foldCount');
    if (c) {
      const n = state.notes.length;
      c.textContent = String(n);
      c.classList.toggle('zero', n === 0);
      c.title = '已生成 ' + n + ' 条笔记，点这里展开';
    }
  }

  $('btnFold').addEventListener('click', foldToggle);
  $('foldBrand').addEventListener('click', foldToggle);
  $('foldCount').addEventListener('click', foldToggle);

  // ---- 鼠标移出面板就缩成贴边细条 ----
  // 用户反馈：面板一展开（或往左拉宽）就盖住 B站 右侧推荐区，点不到下一个视频。
  // 策略：鼠标在面板里时正常展开；移开 0.6 秒后缩成 22px 细条，同时把页面宽度还回去。
  let hideTimer = 0;
  let pointerInside = false;
  const HIDE_DELAY = 600;

  function autoHideAllowed() {
    if (state.collapsed) return false; // 手动收起态有自己的交互，不掺和
    if (dragging) return false;        // 正在拖宽度
    if (pointerInside) return false;   // 鼠标还在面板上
    const ae = shadow.activeElement;
    if (ae && ae.id === 'askInput') return false; // 正在打字，收了会把没发出去的字弄丢
    return true;
  }

  function autoHideNow() {
    if (state.autoHidden || !autoHideAllowed()) return;
    state.autoHidden = true;
    wrap.classList.add('autohide');
    syncFold();
    shiftBlockedAt = 0;
    shiftApply();
  }

  function autoShow() {
    if (!state.autoHidden) return;
    state.autoHidden = false;
    wrap.classList.remove('autohide');
    shiftBlockedAt = 0;
    shiftApply();
  }

  wrap.addEventListener('mouseenter', function () {
    pointerInside = true;
    clearTimeout(hideTimer);
    autoShow();
  });
  wrap.addEventListener('mouseleave', function () {
    pointerInside = false;
    clearTimeout(hideTimer);
    if (!autoHideAllowed()) return;
    hideTimer = setTimeout(autoHideNow, HIDE_DELAY);
  });
  // 打完字把输入框失焦（点了别处）时也要收，不然面板会一直挂着
  $('askInput').addEventListener('blur', function () {
    clearTimeout(hideTimer);
    if (pointerInside) return;
    hideTimer = setTimeout(autoHideNow, HIDE_DELAY);
  });
  $('slim').addEventListener('click', function (e) { e.stopPropagation(); autoShow(); });
  window.__bnAutoHide = { hide: autoHideNow, show: autoShow, state: function () { return { hidden: state.autoHidden, collapsed: state.collapsed }; } };

  $('awayOpen').addEventListener('click', function () { openCatchup(state.away.bannerSpan || state.away.last); });
  $('awayIgnore').addEventListener('click', hideAway);
  $('awayX').addEventListener('click', hideAway);
  $('awayMini').addEventListener('click', function () { openCatchup(state.away.last); });
  // 默认折叠：小节一生成就把笔记在流上方再列一遍，看起来像重复内容（用户实测反馈）
  $('btnOutline').addEventListener('click', function () {
    const hid = outline.classList.toggle('hidden');
    this.textContent = hid ? '大纲 ▸' : '大纲 ▾';
  });
  $('btnExport').addEventListener('click', exportMarkdown);
  $('btnMulti').addEventListener('click', exportAllParts);
  $('btnAll').addEventListener('click', function () { if (state.allRun) stopAll(); else startAll(); });
  $('btnMore').addEventListener('click', function (ev) {
    ev.stopPropagation();
    $('more').classList.toggle('open');
  });
  $('more').addEventListener('click', function (ev) {
    // 点完菜单里的任意一项就收起（事件仍冒泡给原来的按钮处理）
    ev.stopPropagation();
    if (ev.target && ev.target.closest && ev.target.closest('button')) $('more').classList.remove('open');
  });
  document.addEventListener('click', function () { $('more').classList.remove('open'); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') $('more').classList.remove('open'); });
  $('btnDiag').addEventListener('click', copyDiag);
  $('btnVerify').addEventListener('click', function () { boot(true); });
  $('btnHard').addEventListener('click', function () { if (state.hard.active) hardStop('手动停止'); else hardStart(); });
  // 内容脚本里 chrome.runtime.openOptionsPage 是 undefined（2026-11-16 真机实测），只能让后台代开。
  // 之前那句 if (chrome.runtime.openOptionsPage) 永远不成立，面板「设置」按钮点了没反应。
  function openSettings() {
    try { if (chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'openOptions' }); } catch (e) {}
  }
  // 没填 Key 时两条 AI 入口都是死路：别跑到一半才报错，直接把话说清楚并打开设置
  function needKey() {
    setStatus('warn', '没有填 API Key：点「设置」填一个；不想用 AI 的话点「导出」直接拿字幕全文');
    openSettings();
  }
  $('btnOpt').addEventListener('click', function () { openSettings(); });
  stream.addEventListener('scroll', function () {
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60;
    if (nearBottom !== state.follow) { state.follow = nearBottom; updateJump(); }
  });
  shadow.getElementById('jumpBtn').addEventListener('click', function () {
    state.follow = true;
    stream.scrollTop = stream.scrollHeight;
    updateJump();
  });
  $('askInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { ask(e.target.value); e.target.value = ''; }
  });

  let dragging = false;
  $('handle').addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    const w = Math.min(Math.max(window.innerWidth - e.clientX, 280), 720);
    wrap.style.width = w + 'px';
    state.width = w;
    shiftBlockedAt = 0;
    shiftApplySoon();
  });
  window.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    chrome.storage.local.set({ 'bn.width': state.width });
    shiftApply();
  });


  // 面板配色不另立一套：白底 + B站 蓝，只在深色页面上自动反色（跟页面走，不做主题切换）
  function applyTheme() {
    const bg = getComputedStyle(document.documentElement).backgroundColor;
    const m = bg.match(/\d+/g);
    const dark = m ? (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 < 120 : false;
    wrap.classList.toggle('dark', dark);
  }
  setInterval(applyTheme, 3000);
  applyTheme();

  // 先把默认宽度落到行内样式：只靠 CSS 默认值时，复制/粘贴或别的站点样式带偏就会撑满整页
  wrap.style.width = state.width + 'px';
  chrome.storage.local.get(['bn.awayEnabled', 'bn.awaySeen', 'bn.visualEnabled', 'apiKey'], function (r) {
    state.hasKey = !!(r && r['apiKey']);
    state.away.enabled = !(r && r['bn.awayEnabled'] === false);
    state.away.seen = (r && r['bn.awaySeen']) || {};
    state.visual.enabled = !(r && r['bn.visualEnabled'] === false);
    if (state.visual.enabled) startVisual(); else stopVisual();
  });
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (ch) {
      if (ch['bn.awayEnabled']) state.away.enabled = ch['bn.awayEnabled'].newValue !== false;
      if (ch['apiKey']) state.hasKey = !!ch['apiKey'].newValue;
      if (Object.keys(ch).some(function (k) { return k.indexOf('bnstudy:') === 0; })) loadStudyStates();
      if (ch['bn.visualEnabled']) {
        state.visual.enabled = ch['bn.visualEnabled'].newValue !== false;
        if (state.visual.enabled) startVisual();
        else { stopVisual(); setVisualNote(''); }
      }
    });
  }
  chrome.storage.local.get(['bn.width'], function (r) {
    if (r && r['bn.width']) {
      state.width = r['bn.width'];
      wrap.style.width = state.width + 'px';
    }
    applyTheme();
    shiftApply();
  });

  // 分 P 切换：盯着播放器高亮项（data-key = cid），一变就换一套字幕/笔记。
  // 这是主路径；healPage（按时长比对）只在拿不到分 P 列表的页面上兜底。
  function watchPage() {
    const m = state.meta;
    if (!m || !m.pageList || m.pageList.length < 2) return;
    const cid = cidFromDom();
    if (!cid || cid === m.cid) return;
    const hit = m.pageList.filter(function (p) { return p.cid === cid; })[0];
    if (!hit) return;
    healed.bvid = state.bvid;
    healed.p = hit.page || 0;
    boot(false, hit.page);
  }

  let lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      boot(false);
    }
    // 分 P：播放器高亮项变了就换 P（B站 切 P 不一定改 URL）
    watchPage();
    // 兜底：容器被 B站 换掉或宽度被改回去时补一次；收窄后视频被挤出屏幕就撤回
    if (shiftNeeded() > 0) {
      shiftApply();
      if (shiftApplied > 0) shiftVerify(shiftApplied);
    }
  }, 2000);

  shiftApply();

  // ---- 工具栏图标唤出面板 ----
  // 点图标 → background 发 bnOpenPanel → 这里展开（若是收起态）、滚到可见、闪一下边。
  function openPanelFromIcon() {
    const bv = bvidFromUrl();
    // SPA 换了视频但 2 秒轮询还没轮到：当场补一次，别让人点了图标看到的还是上一个视频的笔记
    if (bv && bv !== state.bvid) boot(true);
    if (state.collapsed) {
      state.collapsed = false;
      wrap.classList.toggle('collapsed', false);
      syncFold();
      shiftBlockedAt = 0;
      setTimeout(shiftApply, 160);
    }
    if (state.autoHidden) {
      state.autoHidden = false;
      wrap.classList.remove('autohide');
      shiftBlockedAt = 0;
      shiftApply();
    }
    wrap.classList.remove('flash');
    void wrap.offsetWidth; // 强制重排，连点两次也能重新播放动画
    wrap.classList.add('flash');
    setTimeout(function () { wrap.classList.remove('flash'); }, 1200);
    return { ok: true, bvid: state.bvid || '', collapsed: state.collapsed, notes: state.notes.length };
  }

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'bnOpenPanel') return false;
      var r = openPanelFromIcon();
      if (sendResponse) sendResponse(r);
      return false;
    });
  }

  boot();
})();