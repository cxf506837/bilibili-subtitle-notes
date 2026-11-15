// 字幕信任闸门：唯一允许字幕进入「可核对」语境的入口。
// 纯函数放在 BnGate 上，便于在 Node 里跑测试。
(function (root) {
  'use strict';

  const GATE = {
    MIN_COVER: 0.85,
    MAX_COVER: 1.10,
    MIN_LINES: 8,
    MIN_CHARS: 120,
    MIN_AVG_CHARS: 3,
    MAX_SUM_RATIO: 1.15,
    MAX_GAP_ABS: 90,
    MAX_GAP_RATIO: 0.1,
    ATTEMPTS: 5, // 单次通过率实测约 25%，3 次的失败率仍高达 ~42%
    RETRY_DELAY_MS: 700,
  };

  function normalize(s) {
    return String(s || '').replace(/\s+/g, '').replace(/[，。！？、；："'（）《》…—,.!?;:()]/g, '');
  }

  function stats(sentences, pageDur) {
    const lines = sentences.length;
    const chars = sentences.reduce((n, s) => n + normalize(s.content).length, 0);
    const lastTo = lines ? Number(sentences[lines - 1].to) || 0 : 0;
    const sumDur = sentences.reduce((n, s) => n + Math.max(0, (Number(s.to) || 0) - (Number(s.from) || 0)), 0);
    let maxGap = 0;
    let prevTo = 0;
    for (const s of sentences) {
      const from = Number(s.from) || 0;
      const to = Number(s.to) || 0;
      maxGap = Math.max(maxGap, from - prevTo);
      prevTo = Math.max(prevTo, to);
    }
    if (pageDur > 0) maxGap = Math.max(maxGap, pageDur - prevTo);
    return {
      lines,
      chars,
      avgChars: lines ? chars / lines : 0,
      lastTo,
      sumDur,
      cover: pageDur > 0 ? lastTo / pageDur : 0,
      sumRatio: pageDur > 0 ? sumDur / pageDur : 0,
      maxGap,
    };
  }

  // 单次判定。返回 { ok, verdict, reason, stats }
  function judge(sentences, pageDur, opts) {
    const G = Object.assign({}, GATE, opts || {});
    if (!Array.isArray(sentences) || sentences.length === 0) {
      return { ok: false, verdict: 'empty', reason: 'no-sentences' };
    }
    if (!(pageDur > 0)) return { ok: false, verdict: 'empty', reason: 'no-duration' };
    const st = stats(sentences, pageDur);
    if (st.cover < G.MIN_COVER) return { ok: false, verdict: 'truncated', reason: 'cover-low', stats: st };
    if (st.cover > G.MAX_COVER) return { ok: false, verdict: 'overflow', reason: 'cover-high', stats: st };
    if (st.lines < G.MIN_LINES) return { ok: false, verdict: 'malformed', reason: 'too-few-lines', stats: st };
    if (st.chars < G.MIN_CHARS) return { ok: false, verdict: 'malformed', reason: 'too-few-chars', stats: st };
    if (st.avgChars < G.MIN_AVG_CHARS) return { ok: false, verdict: 'malformed', reason: 'lines-too-short', stats: st };
    if (st.sumRatio > G.MAX_SUM_RATIO) return { ok: false, verdict: 'malformed', reason: 'cues-overlap', stats: st };
    const gapLimit = Math.max(G.MAX_GAP_ABS, pageDur * G.MAX_GAP_RATIO);
    if (st.maxGap > gapLimit) return { ok: false, verdict: 'malformed', reason: 'gap-too-large', stats: st };
    return { ok: true, verdict: 'ok', stats: st };
  }

  // 多轨选择：只认中文轨，优先 UP 上传的人工轨，其次平台 AI 轨。
  function pickTrack(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const zh = tracks.filter((t) => /^(ai-)?zh/i.test(t.lan || ''));
    const manual = zh.filter((t) => !/^ai-/.test(t.lan || ''));
    const cand = manual.length ? manual : zh;
    const withUrl = cand.filter((t) => t.subtitle_url);
    return withUrl[0] || cand[0] || null;
  }

  // 字幕可读性：闸门只查「长度/结构/稳定」，查不出「这是不是人话」。
  // 外语视频的机翻字幕和正常转写在这套系统里长得一样，但笔记会变成「把破句子再解释一遍」。
  // 本地特征只用来标记「疑似」，不拦字幕；宁可漏报，不要冤枉中文口播。
  const READ = {
    LATIN_RATIO: 0.12, // 含拉丁字母（>=2 个字母）的句子占比
    NAME_HITS: 2,      // 常见英文音译名命中的句数
    LITERAL_YOU: 0.8,  // 「你应该 / 让我们」每 100 句
    MIN_LINES: 20,     // 少于 20 句不下结论
  };
  // 只有真的在指外国名字时才计：中文课里出现「杰克」不稀奇，所以单靠它不下结论
  const NAME_WORDS = ['马特', '汤姆', '杰克', '麦克', '约翰', '史蒂夫', '大卫', '保罗', '彼得', '尼克', '山姆', '艾米', '凯特', '露西', '玛丽', '鲍勃', '托尼', '杰瑞', '哈利', '罗恩', '琳达', '加里', '布鲁斯', '克里斯', '丹尼尔', '亚瑟', '菲比', '比尔', '史蒂芬', '安东尼', '布莱恩', '凯文', '贾斯汀', '艾米莉', '索菲', '威廉', '查理', '斯科特', '杰森', '瑞恩'];
  const LITERAL_YOU = ['你应该', '你需要', '你想要', '你们需要', '你必须', '让我们', '我们会', '你需要去', '你需要把', '你可以去'];
  // 机翻最硬的一条痕迹：把外语的人名安到被动词前面。中文不会说「被马特离开一会儿」，
  // 但「被安放 / 被叫做 / 被派遣」都是正常中文，所以动词必须紧跟在音译名后面才算。
  const ODD_NAME_PASSIVE = new RegExp('被(' + NAME_WORDS.join('|') + ')(离开|做|说|看|听|放|给|拿|去|来|想|要|叫|当成|认为|告诉)', 'g');

  function readability(sentences, opts) {
    const R = Object.assign({}, READ, opts || {});
    const list = Array.isArray(sentences) ? sentences : [];
    const lines = list.length;
    let latinSents = 0;
    let nameSents = 0;
    let literalYou = 0;
    let oddNamePassive = 0;
    for (const s of list) {
      const t = String((s && s.content) || '');
      if (/[A-Za-z]{2,}/.test(t)) latinSents++;
      if (NAME_WORDS.some(function (w) { return t.indexOf(w) >= 0; })) nameSents++;
      for (const p of LITERAL_YOU) if (t.indexOf(p) >= 0) { literalYou++; break; }
      const m = t.match(ODD_NAME_PASSIVE);
      if (m) oddNamePassive += m.length;
    }
    const latinRatio = lines ? latinSents / lines : 0;
    const youPer100 = lines ? (literalYou / lines) * 100 : 0;
    const flags = {
      lines,
      latinRatio: Number(latinRatio.toFixed(3)),
      nameSents,
      youPer100: Number(youPer100.toFixed(2)),
      oddNamePassive,
    };
    if (lines < R.MIN_LINES) return { verdict: 'unknown', flags, reason: 'too-few-lines' };
    // 宁可漏报：只有「被+音译名+动词」是硬证据；音译名单独出现（游戏角色、课件人名）不算。
    const strong = oddNamePassive >= 1
      || (nameSents >= R.NAME_HITS && latinRatio >= R.LATIN_RATIO)
      || (latinRatio >= 0.3 && youPer100 >= 3);
    if (strong) return { verdict: 'machine', flags, reason: 'machine-traits' };
    const suspect = (latinRatio >= R.LATIN_RATIO && (nameSents >= R.NAME_HITS || youPer100 >= 1))
      || youPer100 >= 3;
    if (suspect) return { verdict: 'suspect', flags, reason: 'weak-traits' };
    return { verdict: 'clean', flags };
  }

  // ---- 网络部分（只在扩展里跑） ----
  // 网络：每个请求都必须有超时。否则网络卡住时界面永远停在「检查字幕 1/3 …」。
  const NET = { JSON_TIMEOUT: 8000, FILE_TIMEOUT: 12000, BG_TIMEOUT: 15000, GATE_DEADLINE: 45000 };

  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    try {
      return await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(url) {
    const res = await fetchWithTimeout(url, { credentials: 'include' }, NET.JSON_TIMEOUT);
    if (!res.ok) throw new Error('http ' + res.status);
    return res.json();
  }

  // 多 P：wantP 是 URL 里的 ?p=N（从 1 开始）。B站 的 view 接口一次给全部分 P，
  // 但 d.cid 永远是默认 P（通常是 P1）——只按 d.cid 取，切到 P2 会拿到 P1 的字幕和时长。
  async function resolveVideo(bvid, wantP) {
    const j = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
    if (!j || j.code !== 0 || !j.data) throw new Error('view api failed: ' + (j && j.code));
    const d = j.data;
    const list = (d.pages || []).map((p) => ({
      cid: p.cid,
      page: Number(p.page) || 0,
      part: p.part || '',
      duration: Number(p.duration) || 0,
    }));
    if (!list.length) list.push({ cid: d.cid, page: 1, part: '', duration: Number(d.duration) || 0 });
    const want = Number(wantP) || 0;
    const byP = list.filter((p) => p.page === want)[0];
    const page = byP || list.filter((p) => p.cid === d.cid)[0] || list[0];
    return {
      bvid: d.bvid,
      aid: d.aid,
      cid: page.cid,
      title: d.title,
      pageDur: page.duration || Number(d.duration) || 0,
      pages: list.length,
      pageList: list,
      page: page.page || 1,
      part: page.part || '',
      tname: d.tname || '',
    };
  }

  // 只取字幕轨；必须用 aid，bvid 形式会返回不属于该视频的轨。
  async function fetchTracks(aid, cid) {
    const j = await getJson('https://api.bilibili.com/x/player/v2?aid=' + aid + '&cid=' + cid);
    if (!j || j.code !== 0 || !j.data) throw new Error('player api failed: ' + (j && j.code));
    const sub = j.data.subtitle || {};
    return { tracks: sub.subtitles || [], needLogin: !!sub.need_login_subtitle };
  }

  // 未登录时实测：0 轨、且 need_login_subtitle 不一定为 true。
  // 所以「没字幕」要再问一次登录态，否则会把「没登录」误报成「这视频没字幕」。
  async function isLoggedIn() {
    try {
      const j = await getJson('https://api.bilibili.com/x/web-interface/nav');
      return !!(j && j.data && j.data.isLogin);
    } catch (e) {
      return null; // null = 判断不了，按未知处理
    }
  }

  // 字幕文件：先试页面内直连（2026-11-12 实测该 CDN 返回 ACAO: *），失败再退回扩展后台。
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  async function fetchSubtitleText(url) {
    try {
      const res = await fetchWithTimeout(url, {}, NET.FILE_TIMEOUT);
      if (res.ok) {
        const text = await res.text();
        return { ok: true, status: res.status, text, hash: fnv1a(text), via: 'page' };
      }
    } catch (e) { /* 超时或跨域，落到后台 */ }
    return Object.assign({ via: 'background' }, await fetchFileViaBackground(url));
  }

  function fetchFileViaBackground(url) {
    return new Promise(function (resolve) {
      let done = false;
      let timer = null;
      const finish = function (r) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(r);
      };
      timer = setTimeout(function () { finish({ ok: false, error: 'background-timeout' }); }, NET.BG_TIMEOUT);
      try {
        chrome.runtime.sendMessage({ type: 'fetchSubtitleFile', url }, function (r) {
          if (chrome.runtime.lastError) return finish({ ok: false, error: String(chrome.runtime.lastError.message) });
          finish(r || { ok: false, error: 'no-response' });
        });
      } catch (e) {
        finish({ ok: false, error: String(e).slice(0, 120) });
      }
    });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // 完整闸门流程：最多取样 N 次，按哈希计票，票最多的那份才算数。
  // 为什么不取「第一个通过」：实测同一个 (aid,cid) 会随机返回别的视频的字幕文件，
  // 其中一部分时长还对得上（比如歌词文件 cover 0.92）。只取第一个会直接把错的当真。
  // 投票依据：正确文件在同一批取样里出现的次数明显最多（实测 8 次里 5 次正确）。
  // onProgress({attempt, total, state}) 用来喂界面。
  // opts: { attempts, earlyVotes } —— 批量导出（合集/多 P）用更少的取样次数：一屏几十 P，
  // 每 P 都按页面上的 5 次取样会让用户以为卡死了。默认值保持不动，单视频仍走 5 次 / 3 票。
  async function gateSubtitle(meta, onProgress, opts) {
    const O = opts || {};
    const maxAttempts = Math.max(1, Math.min(Number(O.attempts) || GATE.ATTEMPTS, 12));
    const attempts = [];
    const seen = new Map(); // hash -> { sentences, count, track, stats, first }
    const EARLY_VOTES = Math.max(2, Number(O.earlyVotes) || 3);
    let lastReason = 'no-attempt';
    let loginState; // undefined = 还没问过
    const startedAt = Date.now();
    for (let i = 0; i < maxAttempts; i++) {
      if (Date.now() - startedAt > NET.GATE_DEADLINE) {
        return { verdict: 'timeout', attempts, elapsed: Date.now() - startedAt };
      }
      if (onProgress) onProgress({ attempt: i + 1, total: maxAttempts, state: 'probing' });
      let r;
      try {
        r = await fetchTracks(meta.aid, meta.cid);
      } catch (e) {
        attempts.push({ attempt: i + 1, state: 'api-error', message: String(e).slice(0, 120) });
        await sleep(GATE.RETRY_DELAY_MS);
        continue;
      }
      if (r.needLogin) return { verdict: 'need-login', attempts, reason: 'need-login-flag' };
      const tracks = r.tracks;
      if (!tracks.length) {
        if (loginState === undefined) loginState = await isLoggedIn();
        if (loginState === false) {
          attempts.push({ attempt: i + 1, state: 'not-logged-in' });
          return { verdict: 'need-login', attempts, reason: 'no-tracks-and-logged-out' };
        }
        attempts.push({ attempt: i + 1, state: 'no-subs', login: loginState });
        lastReason = 'no-subs';
        await sleep(GATE.RETRY_DELAY_MS);
        continue;
      }
      const track = pickTrack(tracks);
      if (!track || !track.subtitle_url) { attempts.push({ attempt: i + 1, state: 'empty-url' }); lastReason = 'empty-url'; await sleep(GATE.RETRY_DELAY_MS); continue; }
      const url = track.subtitle_url.startsWith('//') ? 'https:' + track.subtitle_url : track.subtitle_url;
      const file = await fetchSubtitleText(url);
      if (!file || !file.ok) {
        attempts.push({ attempt: i + 1, state: 'file-error', error: file && file.error });
        lastReason = 'file-error';
        await sleep(GATE.RETRY_DELAY_MS);
        continue;
      }
      let json;
      const head = String(file.text || '').trim().slice(0, 1);
      if (head !== '{') {
        // CDN 偶发返回 HTML 错误页（实测出现过 <!DOCTYPE ...），当一次失败别当异常。
        attempts.push({ attempt: i + 1, state: 'bad-json', error: 'not-json', hash: file.hash });
        lastReason = 'bad-json';
        await sleep(GATE.RETRY_DELAY_MS);
        continue;
      }
      try { json = JSON.parse(file.text); } catch (e) { attempts.push({ attempt: i + 1, state: 'bad-json' }); lastReason = 'bad-json'; await sleep(GATE.RETRY_DELAY_MS); continue; }
      const sentences = (json.body || []).map((s, idx) => ({
        sid: idx,
        from: Number(s.from) || 0,
        to: Number(s.to) || 0,
        content: String(s.content || ''),
      }));
      const v = judge(sentences, meta.pageDur);
      attempts.push({ attempt: i + 1, state: v.ok ? 'ok' : v.verdict, cover: v.stats ? Number(v.stats.cover.toFixed(3)) : null, hash: file.hash, via: file.via });
      lastReason = v.ok ? 'ok' : v.verdict;
      if (!v.ok) { await sleep(GATE.RETRY_DELAY_MS); continue; }
      const hit = seen.get(file.hash);
      if (hit) { hit.count += 1; } else { seen.set(file.hash, { sentences, count: 1, track, stats: v.stats, hash: file.hash }); }
      const votes = hit ? hit.count : 1;
      attempts[attempts.length - 1].votes = votes;
      if (votes >= EARLY_VOTES) {
        const win = seen.get(file.hash);
        return { verdict: 'stable', track: win.track, sentences: win.sentences, stats: win.stats, attempts, hash: win.hash, votes: win.count };
      }
      await sleep(GATE.RETRY_DELAY_MS);
    }
    const ranked = Array.from(seen.values()).sort((a, b) => b.count - a.count);
    const top = ranked[0];
    const tie = ranked.length > 1 && ranked[1].count === top.count;
    if (top && top.count >= 2 && !tie) {
      return { verdict: 'stable', track: top.track, sentences: top.sentences, stats: top.stats, attempts, hash: top.hash, votes: top.count };
    }
    if (ranked.length === 1) {
      return { verdict: 'single', track: top.track, sentences: top.sentences, stats: top.stats, attempts, hash: top.hash, votes: 1 };
    }
    if (ranked.length > 1) {
      // 每次拿到的都是不同的文件，而且都通过了时长/结构检查 —— 这种情况不能猜。
      return { verdict: 'rejected', reason: 'ambiguous', attempts, candidates: ranked.map((r) => ({ hash: r.hash, count: r.count, cover: Number(r.stats.cover.toFixed(3)) })) };
    }
    return { verdict: 'rejected', reason: lastReason, attempts };
  }

  root.BnGate = {
    GATE,
    normalize,
    stats,
    judge,
    pickTrack,
    resolveVideo,
    fetchTracks,
    fetchSubtitleText,
    gateSubtitle,
    isLoggedIn,
    readability,
    READ,
    NET,
    sleep,
  };
})(typeof window !== 'undefined' ? window : globalThis);