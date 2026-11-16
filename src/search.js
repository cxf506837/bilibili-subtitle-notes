// 弹窗：在你的所有 B站 笔记里搜。
// 数据来自 chrome.storage.local 里的 bnidx:* 索引（内容脚本生成笔记时写的），
// 因为 bilibili.com 的 IndexedDB 扩展页读不到。
(function () {
  'use strict';
  const B = window.BnIndex;
  const q = document.getElementById('q');
  const list = document.getElementById('list');
  const meta = document.getElementById('meta');
  const scope = document.getElementById('scope');
  const curEl = document.getElementById('cur');
  const curTitle = document.getElementById('curTitle');
  const curMeta = document.getElementById('curMeta');
  const curBtn = document.getElementById('curBtn');
  const openPanelBtn = document.getElementById('openPanel');

  let entries = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  // 命中片段里把关键词标蓝，让人一眼看到为什么被搜出来
  function snip(text, query) {
    const raw = String(text || '');
    const tk = B.tokens(query);
    if (!tk.length) return esc(raw);
    const low = raw.toLowerCase();
    let at = -1, len = 0;
    for (let i = 0; i < tk.length && at < 0; i++) {
      const p = low.indexOf(tk[i]);
      if (p >= 0) { at = p; len = tk[i].length; }
    }
    if (at < 0) return esc(raw);
    const from = Math.max(0, at - 24);
    const head = (from > 0 ? '…' : '') + raw.slice(from, at);
    const hit = raw.slice(at, at + len);
    const tail = raw.slice(at + len, at + len + 60) + (raw.length > at + len + 60 ? '…' : '');
    return esc(head) + '<b>' + esc(hit) + '</b>' + esc(tail);
  }

  function openUrl(url) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      if (tab && tab.id != null && /^https:\/\/www\.bilibili\.com\//.test(tab.url || '')) {
        chrome.tabs.update(tab.id, { url: url });
      } else {
        chrome.tabs.create({ url: url });
      }
      window.close();
    });
  }

  // 当前标签页是不是 B站 视频页，是就把「进面板」摆在第一行
  function renderCurrent() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      const url = (tab && tab.url) || '';
      const bv = B.bvidOf(url);
      if (!bv) {
        curEl.hidden = true;
        openPanelBtn.hidden = false;
        if (/^https:\/\/www\.bilibili\.com\//.test(url)) {
          curMeta.textContent = '';
        }
        return;
      }
      const page = B.pageOf(url);
      const hit = B.pickEntry(entries, bv, page);
      const name = hit && hit.title ? hit.title : B.cleanTitle(tab.title, bv);
      // 合集里 part 常常就是本集标题，别再拼一遍
      const part = hit && hit.part && hit.part !== hit.title ? hit.part : '';
      curTitle.textContent = part ? name + ' · ' + part : name;
      curTitle.title = curTitle.textContent;
      if (hit && hit.count) {
        curEl.classList.add('has');
        curMeta.textContent = '继续上次 · 已经攒了 ' + hit.count + ' 条笔记';
      } else {
        curEl.classList.remove('has');
        curMeta.textContent = '这个视频还没整理过 · 不填 API Key 也能导出字幕全文';
      }
      curEl.hidden = false;
      openPanelBtn.hidden = true;
      curBtn.onclick = function () {
        if (!tab || tab.id == null) return;
        chrome.tabs.sendMessage(tab.id, { type: 'bnOpenPanel' }, function () {
          if (chrome.runtime.lastError) {
            curMeta.textContent = '面板还没在这儿加载好，刷新一下页面再点';
            return;
          }
          window.close();
        });
      };
    });
  }


  // ---- 接着学：把看过的课程列出来，一键回到上次那一集那一秒 ----
  const CS = window.BnCourseStore;
  const coursesEl = document.getElementById('courses');
  const coursesMeta = document.getElementById('coursesMeta');
  const courseRows = document.getElementById('courseRows');

  function renderCourses(all) {
    if (!CS) { coursesEl.hidden = true; return; }
    const studies = (S ? S.fromStorage(all) : []);
    const rows = CS.list(all, studies, 3).filter(function (r) { return r.next || r.mastery; });
    if (!rows.length) { coursesEl.hidden = true; return; }
    coursesMeta.textContent = rows.length + ' 门课';
    let html = '';
    rows.forEach(function (r) {
      const done = !r.next;
      html += '<button class="crow' + (done ? ' done' : '') + '" data-url="' + esc(r.next ? r.next.url : '') + '" title="' + esc(r.title) + '">' +
        '<span class="crt">' + esc(r.title || '未命名课程') + '</span>' +
        '<span class="crm">' + esc(CS.metaLine(r)) + (r.next ? ' · ' : '') + '<span class="crn">' + esc(CS.nextLine(r)) + '</span></span>' +
        '</button>';
    });
    courseRows.innerHTML = html;
    courseRows.querySelectorAll('.crow').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.dataset.url) openUrl(el.dataset.url);
      });
    });
    coursesEl.hidden = false;
  }

  // ---- 学习状态：agent 拷打完把 study-state.json 复制到剪贴板，点图标就能应用 ----
  const S = window.BnStudyState;
  const studyEl = document.getElementById('study');
  const studyTitle = document.getElementById('studyTitle');
  const studyMeta = document.getElementById('studyMeta');
  const studyApply = document.getElementById('studyApply');
  const studySkip = document.getElementById('studySkip');
  const studyNote = document.getElementById('studyNote');
  let pendingState = null;

  function renderStudy(state, alreadyApplied) {
    if (!state) { studyEl.hidden = true; return; }
    pendingState = state;
    studyTitle.textContent = state.course || state.course_id;
    studyTitle.title = state.course || state.course_id;
    studyMeta.textContent = S.line(state);
    studyEl.hidden = false;
    if (alreadyApplied) {
      studyApply.hidden = true;
      studySkip.textContent = '关闭';
      studyNote.innerHTML = '这个版本已经应用过了。回 B站 视频页，面板的课程条下面就是<b>掌握度</b>和<b>接着学</b>。';
      return;
    }
    studyApply.hidden = false;
    studySkip.textContent = '忽略';
    studyNote.innerHTML = '来自剪贴板里的 study-state.json。应用后回视频页面板看：<b>哪些懂、哪些半懂</b>，以及<b>接着学</b>该看哪一秒。';
  }

  function latestStored(list) {
    let best = null;
    list.forEach(function (x) {
      if (!best || String(x.state.updated_at || '') > String(best.state.updated_at || '')) best = x;
    });
    return best;
  }

  function readClipboardStudy(all) {
    const stored = S.fromStorage(all);
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) { handle(t || ''); }, function () { handle(''); });
        return;
      }
    } catch (e) {}
    handle(text);

    function handle(t) {
      const r = t ? S.parse(t) : { ok: false };
      if (r.ok) {
        const prev = all[S.storageKey(r.state.course_id)];
        const same = !!(prev && prev.updated_at && prev.updated_at === r.state.updated_at);
        renderStudy(r.state, same);
        return;
      }
      const best = latestStored(stored);
      if (best) {
        // 剪贴板里没有新结果，就显示上次应用过的那份，让人知道面板里有东西
        renderStudy(best.state, true);
        studyNote.innerHTML = '剪贴板里没有新的学习状态。这是上次应用的：' + S.line(best.state) + '。';
      } else {
        studyEl.hidden = true;
      }
    }
  }

  studyApply.addEventListener('click', function () {
    if (!pendingState) return;
    const obj = {};
    obj[S.storageKey(pendingState.course_id)] = pendingState;
    chrome.storage.local.set(obj, function () {
      studyApply.hidden = true;
      studySkip.textContent = '关闭';
      studyNote.innerHTML = '已应用：<b>' + esc(S.line(pendingState)) + '</b>。回 B站 视频页刷新一下，面板的课程条下面就能看到掌握度和「接着学」。';
      studyMeta.textContent = S.line(pendingState);
    });
  });
  studySkip.addEventListener('click', function () { studyEl.hidden = true; });

  function renderRecent() {
    const rec = B.recent(entries, 10);
    const totalNotes = entries.reduce(function (a, e) { return a + (e.count || 0); }, 0);
    scope.textContent = entries.length
      ? '在你的 ' + entries.length + ' 个视频、' + totalNotes + ' 条笔记里搜'
      : '在你的 B站 笔记里搜';
    meta.textContent = '';
    if (!rec.length) {
      list.innerHTML = '<div class="empty">还没有笔记可搜。<br><br>去任意 B站 视频页，右侧面板会自己出来（收起来了就点上面的按钮）。点「总结这段」攒下几条笔记后，这里就能搜到。<br><br><b>不填 API Key 也能用</b>：面板上的「导出」能直接导出字幕全文。</div>';
      return;
    }
    let html = '';
    rec.forEach(function (r) {
      html += '<div class="grp"><div class="gt" data-url="' + esc(r.url) + '"><span class="gtt">' + esc(r.title) +
        '</span><span class="cnt">' + r.count + ' 条</span></div></div>';
    });
    list.innerHTML = '<div class="meta" style="padding:8px 14px 2px;font-size:11px;color:#9499a0">最近攒下笔记的视频</div>' + html;
    list.querySelectorAll('.gt').forEach(function (el) {
      el.addEventListener('click', function () { openUrl(el.dataset.url); });
    });
  }

  function renderSearch(query) {
    const hits = B.search(entries, query, 80);
    if (!hits.length) {
      meta.textContent = '';
      list.innerHTML = '<div class="empty">没有找到包含 <b>' + esc(query.trim()) + '</b> 的笔记。<br><br>换个词试试；只搜得到已经生成过笔记的段落，没整理过的段落不在这里。</div>';
      return;
    }
    meta.textContent = '找到 ' + hits.length + ' 条';
    const groups = B.groupVideos(hits);
    let html = '';
    groups.forEach(function (g) {
      html += '<div class="grp"><div class="gt" data-url="' + esc(g.items[0].url) + '"><span class="gtt">' + esc(g.title) +
        '</span><span class="cnt">' + g.items.length + ' 条</span></div>';
      g.items.forEach(function (it) {
        html += '<div class="hit" data-url="' + esc(B.jump(it.url, it.t)) + '" title="点一下跳到这个时间点">' +
          '<span class="t">' + fmt(it.t) + '</span>' +
          '<span class="txt"><span class="sum">' + esc(it.summary || '(这一段没有标题)') + '</span>' +
          '<span class="snip">' + snip(it.hit, query) + '</span></span>' +
          '</div>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.hit, .gt').forEach(function (el) {
      el.addEventListener('click', function () { openUrl(el.dataset.url); });
    });
  }

  let timer = 0;
  q.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      const v = q.value;
      if (!v.trim()) { renderRecent(); return; }
      renderSearch(v);
    }, 120);
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const first = list.querySelector('.hit');
      if (first) openUrl(first.dataset.url);
    }
  });

  document.getElementById('openPanel').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, { type: 'bnOpenPanel' }, function () {
        if (chrome.runtime.lastError) {
          meta.textContent = '这个页面不是 B站 视频页，先打开一个视频再用';
          return;
        }
        window.close();
      });
    });
  });
  document.getElementById('opt').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  chrome.storage.local.get(null, function (all) {
    entries = B.fromStorage(all);
    renderCourses(all);
    renderRecent();
    renderCurrent();
    readClipboardStudy(all);
    q.focus();
  });
})();
