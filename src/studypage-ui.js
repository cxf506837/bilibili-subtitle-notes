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
    const shown = P.filterGroups(grouped.groups, q);
    if (!shown.length) {
      empty.hidden = false;
      empty.innerHTML = '<b>没有命中</b>换个词试试：概念名、定义里的词、原话里的句子都算。';
      return;
    }
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

  $('courseSel').addEventListener('change', function (e) {
    courseId = e.target.value;
    q = '';
    $('q').value = '';
    render();
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
