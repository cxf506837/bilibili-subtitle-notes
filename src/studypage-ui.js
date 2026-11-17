// 学习页：把「这门课有什么概念、看到哪、懂没懂」放进一屏。
// 数据全部来自 chrome.storage.local（课程存档 bnc: / 进度 bnp: / 概念缓存 bnc:<cid> / 掌握度 bnstudy: / 笔记索引 bnidx:）。
(function () {
  'use strict';
  const P = window.BnStudyPage;
  const CV = window.BnConceptView;
  const C = window.BnConcept;
  const $ = function (id) { return document.getElementById(id); };
  const el = function (tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  };

  let ALL = {};
  let courseId = '';
  let q = '';
  let EPMAP = {};   // 集号 -> 课程里的那一集（bvid / cid / page / title）
  let view = 'all';   // 中栏视角：all | unwatched | cross
  let mode = 'ep';    // 中栏排法：ep（按集）| concept（按概念，一个概念一张卡）
let weakOnly = false;   // 按概念时，只留「还没弄懂」的（半懂 / 没考过）

  function statusMap(all, id) {
    const raw = all['bnstudy:' + String(id)];
    const st = raw && (raw.state || raw);
    const map = {};
    if (!st || !C || !C.conceptKey) return map;
    (st.concepts || []).forEach(function (c) {
      if (c && c.name) map[C.conceptKey(c.name)] = c.status;
    });
    return map;
  }

  function epUrl(ep, t) {
    let u = 'https://www.bilibili.com/video/' + String(ep.bvid || '');
    const qs = [];
    if (Number(ep.page) > 1) qs.push('p=' + Number(ep.page));
    if (Number(t) >= 1) qs.push('t=' + Math.floor(Number(t)));
    if (!ep.bvid) return '';
    return qs.length ? u + '?' + qs.join('&') : u;
  }

  function jump(url) {
    if (url) window.open(url, '_blank', 'noopener');
  }

  // 就地看这一段：用 B站 官方播放器 iframe，带上 bvid/cid/page/t。
  // 真机上 player.bilibili.com 在扩展页里能播（CSP 不拦 iframe，autoplay 也生效）。
  function playerUrl(ep, t) {
    return P.playerSrc(EPMAP[Number(ep)] || null, t);
  }

  function playHere(ep, t, who, fallbackUrl) {
    const src = playerUrl(ep, t);
    if (!src) return false;   // 找不到这一集的 bvid：交给调用方走新标签
    const box = $('player');
    const frame = $('pframe');
    const label = $('pwho');
    const out = $('pout');
    if (!box || !frame) return false;
    frame.innerHTML = '';
    const f = document.createElement('iframe');
    f.src = src;
    f.setAttribute('allow', 'autoplay; fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.appendChild(f);
    const e = EPMAP[Number(ep)] || {};
    label.textContent = (who ? who + ' · ' : '') + CV.fmtClock(t) + (e.title ? ' · ' + e.title : '');
    if (out) {
      out.href = fallbackUrl || '';
      out.style.display = fallbackUrl ? '' : 'none';
    }
    box.classList.remove('hidden');
    // 只在这一块被滚出视口时才把页面拉回来，避免点一下就跳屏
    const r = box.getBoundingClientRect();
    if (r.top < 0) box.scrollIntoView({ block: 'start' });
    return true;
  }

  function closePlayer() {
    const frame = $('pframe');
    const box = $('player');
    if (frame) frame.innerHTML = '';   // 清掉 iframe，声音才会停
    if (box) box.classList.add('hidden');
  }

  function renderCourses() {
    const sel = $('courseSel');
    sel.innerHTML = '';
    const list = P.courses(ALL);
    if (!list.length) { sel.disabled = true; return; }
    sel.disabled = false;
    list.forEach(function (c) {
      const o = el('option', null, c.title || c.id);
      o.value = c.id;
      if (String(c.id) === String(courseId)) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderOverview(course) {
    const box = $('overview');
    box.innerHTML = '';
    const ov = P.overview(ALL, course);
    const big = el('div', 'big', String(ov.pct));
    big.appendChild(el('small', null, '%'));
    box.appendChild(big);
    const bar = el('div', 'bar');
    const i = el('i');
    i.style.width = ov.pct + '%';
    bar.appendChild(i);
    box.appendChild(bar);
    const rows = el('div', 'rows');
    const parts = [];
    parts.push('看过 <b>' + ov.watched + '/' + ov.count + '</b> 集');
    parts.push('还剩 <b>' + window.BnCourseStore.fmtDur(ov.total - ov.seen) + '</b>');
    parts.push('笔记 <b>' + ov.notes + '</b> 条');
    parts.forEach(function (html, i) {
      if (i) rows.appendChild(document.createTextNode(' · '));
      const sp = el('span', 'stat');
      sp.innerHTML = html;
      rows.appendChild(sp);
    });
    box.appendChild(rows);
    const nx = $('next');
    if (ov.next) {
      nx.hidden = false;
      nx.textContent = '接着学 · ' + (ov.next.title || '下一集');
      nx.onclick = function () { jump(epUrl(ov.next, 0)); };
    } else {
      nx.hidden = true;
      nx.onclick = null;
    }
  }

  function renderEps(course) {
    const list = $('eps');
    list.innerHTML = '';
    const pm = P.progressMap(ALL);
    const nm = P.notesMap(ALL);
    const ov = P.overview(ALL, course);
    ((course && course.episodes) || []).forEach(function (ep) {
      const li = el('li');
      const done = P.watched(ep, pm);
      if (done) li.className = 'done';
      else if (ov.next && String(ov.next.cid) === String(ep.cid)) li.className = 'now';
      const lbl = el('span', 'lbl', String(ep.index || ''));
      const a = el('a', 't', ep.title || '');
      a.href = epUrl(ep, 0);
      a.target = '_blank';
      a.rel = 'noopener';
      const n = el('span', 'n', (nm[String(ep.cid)] ? String(nm[String(ep.cid)]) + ' 条' : ''));
      li.appendChild(lbl); li.appendChild(a); li.appendChild(n);
      list.appendChild(li);
    });
  }

  // 这门课里「看过的集号」列表（进度按 cid 存，这里换成集号给 filterByView 用）
  function watchedIdx(course) {
    const pm = P.progressMap(ALL);
    const out = [];
    ((course && course.episodes) || []).forEach(function (e) {
      if (e && P.watched(e, pm)) out.push(Number(e.index));
    });
    return out;
  }

  // 中栏顶上那行小字：现在看的是哪个视角、还剩多少个。
  // cards 给了就说明现在按概念排（一个概念一张卡），统计口径跟着换。
  function renderNote(course, filtered, shown, totals, cards, extra) {
    const box = $('viewNote');
    if (!box) return;
    const byC = Array.isArray(cards);
    if (view === 'all' && !q && !byC) { box.hidden = true; box.textContent = ''; return; }
    const n = byC ? cards.length : shown.reduce(function (a, g) { return a + ((g && g.items) || []).length; }, 0);
    const parts = [];
    if (view === 'unwatched') {
      const all = ((course && course.episodes) || []).length;
      if (byC) parts.push('只看<b>没看过</b>的集里讲到的：' + n + ' 个概念');
      else parts.push('只看<b>没看过</b>的集：' + shown.length + ' / ' + all + ' 集');
    } else if (view === 'cross') {
      parts.push('只看<b>跨集</b>概念：' + n + ' 个（全课 ' + ((totals && totals.cross) || 0) + ' 个跨集）');
    } else if (byC) {
      parts.push('按<b>概念</b>看：' + n + ' 个，跨集 ' + ((totals && totals.cross) || 0) + ' 个');
    }
    if (q) parts.push('搜索「' + q + '」命中 ' + n + ' 个概念' + (view !== 'all' || byC ? '' : '，分布在 ' + shown.length + ' 集'));
    if (weakOnly && extra && extra.stats) {
      parts.push('只看<b>还没弄懂</b>的：' + extra.stats.weak + ' / ' + extra.stats.total + ' 个');
    }
    box.hidden = !parts.length;
    box.innerHTML = parts.join(' · ');
  }

  // 「按概念」的一张卡：概念名、定义、懂没懂、出现在几集几处，下面直接列出每一处。
  // 前 3 处铺开（扫一眼就知道讲了什么），多的收在按钮后面。
  const CC_ROWS = 3;
  function conceptCardEl(cd) {
    const card = el('div', 'item cc');
    card.appendChild(el('div', 'name', cd.name || ''));
    if (cd.def) card.appendChild(el('div', 'def', cd.def));
    const meta = el('div', 'meta');
    if (cd.status === 'understood') meta.appendChild(el('span', 'badge under', '懂'));
    else if (cd.status === 'shaky') meta.appendChild(el('span', 'badge shaky', '半懂'));
    if (cd.eps > 1) meta.appendChild(el('span', 'badge cross', '跨 ' + cd.eps + ' 集'));
    else if (cd.suspect) meta.appendChild(el('span', 'badge suspect', '只在一集出现'));
    meta.appendChild(el('span', 'badge n', cd.count + ' 处'));
    card.appendChild(meta);
    const occBox = el('div', 'occ');
    const draw = function (from, to) {
      cd.list.slice(from, to).forEach(function (a) {
        const row = el('div', 'occRow');
        const lbl = el('span', 'lbl', a.label);
        if (a.title) lbl.title = a.title;
        row.appendChild(lbl);
        const tk = el('a', 't', CV.fmtClock(a.t));
        const thref = a.url ? CV.withT(a.url, a.t) : '';
        tk.href = thref || '#';
        tk.target = '_blank';
        tk.rel = 'noopener';
        tk.title = '在这一页看这一段';
        tk.onclick = function (e) { if (playHere(a.ep, a.t, cd.name, thref)) e.preventDefault(); };
        row.appendChild(tk);
        row.appendChild(el('span', 'q', a.quote || ''));
        occBox.appendChild(row);
      });
    };
    draw(0, CC_ROWS);
    card.appendChild(occBox);
    if (cd.list.length > CC_ROWS) {
      const more = el('button', 'occBtn', '还有 ' + (cd.list.length - CC_ROWS) + ' 处');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.onclick = function () {
        const open = more.getAttribute('aria-expanded') !== 'true';
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        occBox.innerHTML = '';
        if (open) { draw(0, cd.list.length); more.textContent = '收起'; }
        else { draw(0, CC_ROWS); more.textContent = '还有 ' + (cd.list.length - CC_ROWS) + ' 处'; }
      };
      card.appendChild(more);
    }
    return card;
  }
  // 「还没弄懂」按钮：只在按概念、且真的导入过掌握度时才出现，数字是这一批里半懂 + 没考过的个数。
  function syncWeakBtn(stats) {
    const b = $('mWeak');
    if (!b) return;
    const hasMastery = !!stats && (stats.understood + stats.shaky) > 0;
    const show = mode === 'concept' && hasMastery && stats.weak > 0;
    b.hidden = !show;
    b.textContent = '还没弄懂 ' + (stats ? stats.weak : 0);
    const on = show && weakOnly;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderGroups(course) {
    const box = $('groups');
    const empty = $('empty');
    box.innerHTML = '';
    const cids = P.cidsOf(course);
    if (!cids.length) {
      empty.hidden = false;
      empty.innerHTML = '<b>这门课还没有集</b>再打开一次视频页，面板会把课程目录存下来。';
      return;
    }
    const collected = CV.collect(ALL, cids);
    // CV.group 返回 {groups, list, totals}，不是数组
    if (!collected.length) {
      empty.hidden = false;
      empty.innerHTML = '<b>还没抽概念</b>在视频页面板里点「概念」，抽完这里就按集列出来；也可以勾集导出学习包让 agent 帮你整理。';
      return;
    }
    empty.hidden = true;
    const titles = ((course && course.episodes) || []).map(function (e) { return e.title || ''; });
    const grouped = CV.group(collected, {
      keyOf: C.conceptKey,
      merge: C.merge,
      titles: titles,
      mastery: statusMap(ALL, course && course.id),
    });
    const filtered = P.filterGroups(grouped.groups, q);
    if (mode === 'concept') {
      const base = (view === 'cross') ? P.filterByView(filtered, 'cross', []) : filtered;
      const allCards = P.byConcept(base, { dropWatched: view === 'unwatched', watchedEps: watchedIdx(course) });
      const stats = P.masteryStats(allCards);
      const cards = weakOnly ? P.filterByMastery(allCards, 'weak') : allCards;
      syncWeakBtn(stats);
      renderNote(course, filtered, [], grouped.totals, cards, { stats: stats, weakOnly: weakOnly });
      if (!cards.length) {
        empty.hidden = false;
        if (q) empty.innerHTML = '<b>没有命中</b>换个词试试：概念名、定义里的词、原话里的句子都算。';
        else if (weakOnly) empty.innerHTML = '<b>都弄懂了</b>这个视角里已经没有「半懂 / 没考过」的概念——等下一次拷打、再导一次掌握度，它还会变。';
        else if (view === 'unwatched') empty.innerHTML = '<b>没看过的集里还没有概念</b>点「全部」可以看讲过的那些。';
        else if (view === 'cross') empty.innerHTML = '<b>还没有跨集概念</b>现在的概念都只在一集里出现；多抽几集，跨集连接就会出来。';
        else empty.innerHTML = '<b>还没有概念</b>去视频页面板里点「概念」。';
        return;
      }
      empty.hidden = true;
      cards.forEach(function (cd) { box.appendChild(conceptCardEl(cd)); });
      return;
    }
    syncWeakBtn(null);   // 按集排时没有这个按钮，别把它留在屏幕上
    const shown = P.filterByView(filtered, view, watchedIdx(course));
    renderNote(course, filtered, shown, grouped.totals);
    if (!shown.length) {
      empty.hidden = false;
      if (q) empty.innerHTML = '<b>没有命中</b>换个词试试：概念名、定义里的词、原话里的句子都算。';
      else if (view === 'unwatched') empty.innerHTML = '<b>没有没看过的集了</b>这门课已经全部看过；点「全部」可以回看讲过的概念。';
      else if (view === 'cross') empty.innerHTML = '<b>还没有跨集概念</b>现在的概念都只在一集里出现；多抽几集，跨集连接就会出来。';
      else empty.innerHTML = '<b>还没有概念</b>去视频页面板里点「概念」。';
      return;
    }
    empty.hidden = true;   // 上一次搜索的「没有命中」不能留在屏幕上
    shown.forEach(function (grp) {
      const head = el('div', 'ghead');
      head.appendChild(el('span', 'lbl', grp.label || ('第 ' + grp.ep + ' 集')));
      head.appendChild(el('span', 't', String(grp.title || '').replace(/^\s*\S+\s+/, function (m) { return m.trim().indexOf(String(grp.label || '')) === 0 ? '' : m; })));
      head.appendChild(el('span', 'n', grp.items.length + ' 个概念'));
      box.appendChild(head);
      grp.items.forEach(function (item) {
        const card = el('div', 'item');
        card.appendChild(el('div', 'name', item.name || ''));
        if (item.def) card.appendChild(el('div', 'def', item.def));
        const meta = el('div', 'meta');
        if (item.status === 'understood') meta.appendChild(el('span', 'badge under', '懂'));
        else if (item.status === 'shaky') meta.appendChild(el('span', 'badge shaky', '半懂'));
        const nEps = Array.isArray(item.eps) ? item.eps.length : 0;
        if (item.cross && nEps > 1) meta.appendChild(el('span', 'badge cross', '跨 ' + nEps + ' 集'));
        if (item.suspect) meta.appendChild(el('span', 'badge suspect', '只在这集出现'));
        card.appendChild(meta);
        // 第一条引文直接铺开（扫一眼就知道讲了什么），其余的收进「出现在 N 集 · M 处」。
        // 一个概念在整门课里出现在哪几集第几秒，才是「知识点连起来」真正要看的东西。
        const occ = P.occSummary(item);
        if (occ.count) {
          const first = occ.list[0];
          const qd = el('div', 'quote');
          const t = el('a', 't', CV.fmtClock(first.t));
          const href = first.url ? CV.withT(first.url, first.t) : '';
          t.href = href || '#';
          t.target = '_blank';
          t.rel = 'noopener';
          t.title = occ.count > 1
            ? '在这一页看第 1 处（共 ' + occ.count + ' 处）'
            : '在这一页看这一段';
          t.onclick = function (e) {
            if (playHere(first.ep, first.t, item.name, href)) e.preventDefault();
          };
          qd.appendChild(t);
          qd.appendChild(document.createTextNode(' ' + (first.quote || '')));
          card.appendChild(qd);
          if (occ.count > 1) {
            const label = occ.eps > 1 ? ('出现在 ' + occ.eps + ' 集 · ' + occ.count + ' 处') : ('这一集讲了 ' + occ.count + ' 处');
            const btn = el('button', 'occBtn', label);
            btn.type = 'button';
            btn.setAttribute('aria-expanded', 'false');
            const more = el('div', 'occ hidden');
            occ.list.forEach(function (a) {
              const row = el('div', 'occRow');
              const lbl = el('span', 'lbl', a.label);
              if (a.title) lbl.title = a.title;
              row.appendChild(lbl);
              const tk = el('a', 't', CV.fmtClock(a.t));
              const thref = a.url ? CV.withT(a.url, a.t) : '';
              tk.href = thref || '#';
              tk.target = '_blank';
              tk.rel = 'noopener';
              tk.title = '在这一页看这一段';
              tk.onclick = function (e) {
                if (playHere(a.ep, a.t, item.name, thref)) e.preventDefault();
              };
              row.appendChild(tk);
              row.appendChild(el('span', 'q', a.quote || ''));
              more.appendChild(row);
            });
            btn.onclick = function () {
              const nowHidden = more.classList.toggle('hidden');
              const open = !nowHidden;
              btn.setAttribute('aria-expanded', open ? 'true' : 'false');
              btn.textContent = open ? '收起' : label;
            };
            card.appendChild(btn);
            card.appendChild(more);
          }
        }
        box.appendChild(card);
      });
    });
  }

  function renderMastery(course) {
    const box = $('mastery');
    box.innerHTML = '';
    const m = P.masteryOf(ALL, course && course.id);
    box.appendChild(el('div', 'line', P.line(m)));
    const when = m.updated_at ? ('agent 拷打于 ' + m.updated_at.replace('T', ' ').slice(0, 16)) : '还没导入掌握度（点扩展图标 →「应用到面板」）';
    box.appendChild(el('div', 'when', when));
  }

  // 右栏「今天先看这几个」：把合并后的概念列表交给 P.reviewQueue 排序，点一行就地播。
  function renderReview(course, grouped) {
    const box = $('review');
    if (!box) return;
    box.innerHTML = '';
    const cids = P.cidsOf(course);
    let g = grouped;
    if (!g && cids.length) {
      const collected = CV.collect(ALL, cids);
      if (collected.length) {
        g = CV.group(collected, {
          keyOf: C.conceptKey,
          merge: C.merge,
          titles: ((course && course.episodes) || []).map(function (e) { return e.title || ''; }),
          mastery: statusMap(ALL, course && course.id),
        });
      }
    }
    const qs = P.reviewQueue(g ? g.list : [], { limit: 6 });
    if (!qs.length) { box.hidden = true; return; }
    box.hidden = false;
    const head = el('div', 'rhead');
    head.innerHTML = '<b>今天先看这几个</b> · 半懂优先，跨集的往前排';
    box.appendChild(head);
    qs.forEach(function (it) {
      const row = el('button', 'rrow');
      row.type = 'button';
      const left = el('span');
      left.style.flex = '1';
      left.style.minWidth = '0';
      const nm = el('span', 'rname', it.name);
      nm.style.display = 'block';
      const why = el('span', 'rwhy', it.reason);
      left.appendChild(nm);
      left.appendChild(why);
      row.appendChild(left);
      row.appendChild(el('span', 'rmeta', it.epLabel + ' · ' + CV.fmtClock(it.t)));
      row.title = '回去听这一段：' + it.epLabel + ' ' + CV.fmtClock(it.t);
      row.onclick = function () { playHere(it.ep, it.t, it.name, epUrl(EPMAP[Number(it.ep)] || {}, it.t)); };
      box.appendChild(row);
    });
    const m = P.masteryOf(ALL, course && course.id);
    const foot = el('div', 'rfoot', m.total
      ? '依据 agent 这次拷打的结果（' + (m.updated_at || '').replace('T', ' ').slice(0, 16) + '）；再考一次，这张卡会跟着变。'
      : '还没导入掌握度：现在按「跨集 / 锚点多」挑，导入后会按懂没懂重排。');
    box.appendChild(foot);
  }

  function render() {
    const list = P.courses(ALL);
    const course = P.pick(list, courseId);
    if (!course) {
      $('empty').hidden = false;
      $('empty').innerHTML = '<b>还没有课程</b>打开任意一个 B站 视频页，面板读到课程目录后就会出现在这里。';
      $('overview').innerHTML = '';
      $('eps').innerHTML = '';
      $('groups').innerHTML = '';
      $('mastery').innerHTML = '';
      $('next').hidden = true;
      renderCourses();
      return;
    }
    courseId = course.id;
    EPMAP = {};
    ((course && course.episodes) || []).forEach(function (e) { if (e) EPMAP[Number(e.index)] = e; });
    renderCourses();
    renderOverview(course);
    renderEps(course);
    renderGroups(course);
    renderMastery(course);
    renderReview(course);
  }

  function load() {
    try {
      chrome.storage.local.get(null, function (all) {
        ALL = all || {};
        render();
      });
    } catch (e) {}
  }

  const params = new URLSearchParams(location.search);
  courseId = params.get('course') || '';
  // 面板课程头的「跨集 N」用 ?view=cross 直接把学习页开在这一档；三档按钮的选中态也据此设，
  // 否则会「按钮写全部、内容却是跨集」——两处不一致比不做还糟。
  view = P.parseView(params.get('view'));
  document.querySelectorAll('.fbtn').forEach(function (x) {
    const on = (x.getAttribute('data-view') || 'all') === view;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  $('courseSel').addEventListener('change', function (e) {
    courseId = e.target.value;
    q = '';
    $('q').value = '';
    render();
  });
  document.querySelectorAll('.fbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      view = b.getAttribute('data-view') || 'all';
      document.querySelectorAll('.fbtn').forEach(function (x) {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const course = P.pick(P.courses(ALL), courseId);
      if (course) renderGroups(course);
    });
  });

  // 中栏排法切换：按集 / 按概念。两个按钮只改 mode，重排一次中栏。
  // 只给「按集 / 按概念」两个按钮接线：#mWeak 也带 .mbtn（样式相同），但它不是排法。
  document.querySelectorAll('.mbtn[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = (b.getAttribute('data-mode') === 'concept') ? 'concept' : 'ep';
      document.querySelectorAll('.mbtn[data-mode]').forEach(function (x) {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const course = P.pick(P.courses(ALL), courseId);
      if (course) renderGroups(course);
    });
  });
  // 「还没弄懂」开关：只改这一个布尔，重排中栏；按集时它自己会藏起来。
  const mw = $('mWeak');
  if (mw) mw.addEventListener('click', function () {
    weakOnly = !weakOnly;
    const course = P.pick(P.courses(ALL), courseId);
    if (course) renderGroups(course);
  });
  const pc = $('pclose');
  if (pc) pc.addEventListener('click', closePlayer);
  $('q').addEventListener('input', function (e) {
    q = String(e.target.value || '');
    const list = P.courses(ALL);
    const course = P.pick(list, courseId);
    if (course) renderGroups(course);
  });
  try {
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local') load(); });
  } catch (e) {}
  load();
})();
