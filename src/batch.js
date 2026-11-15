// 合集 / 多 P 批量导出：每一 P 各自过一遍闸门，再拼成一份 Markdown。
// 纯函数放在 BnBatch 上，便于在 Node 里跑测试：格式错一个字符，用户拿到的就是一份没法读的文件。
(function (root) {
  'use strict';

  // 闸门的 verdict / reason 翻成人话。用户看不懂 'ambiguous'，但看得懂「每次取到的都不一样」。
  const REASON_TEXT = {
    'no-subs': '这一 P 没有中文 AI 字幕',
    'need-login': '需要先登录 B站',
    'truncated': '字幕只有一部分（时长对不上这一 P）',
    'overflow': '字幕比这一 P 还长（不是这一 P 的）',
    'malformed': '字幕结构不正常',
    'ambiguous': '每次取到的字幕都不一样，不敢猜',
    'file-error': '字幕文件下载失败',
    'bad-json': '字幕文件不是正常 JSON（CDN 偶发返回错误页）',
    'timeout': '取样超时',
    'empty': '字幕是空的',
    'empty-url': '字幕接口没给文件地址',
    'api-error': '字幕接口报错',
    'no-attempt': '没取到字幕',
  };

  function reasonText(verdict, reason) {
    if (reason && REASON_TEXT[reason]) return REASON_TEXT[reason];
    if (verdict && REASON_TEXT[verdict]) return REASON_TEXT[verdict];
    return '没取到可用的字幕';
  }

  // 文件名里不能有 \ / : * ? " < > |，Windows 上还得防结尾的点与空格。
  function safeName(name, fallback) {
    let s = String(name == null ? '' : name).replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim();
    s = s.replace(/[. ]+$/, '');
    return s || (fallback || 'bilibili-notes');
  }

  function fmtTime(sec) {
    if (root.BnSum && root.BnSum.fmtTime) return root.BnSum.fmtTime(sec);
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function partUrl(baseUrl, page) {
    const u = String(baseUrl || '');
    if (!u) return '';
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=' + Number(page || 1);
  }

  function partJump(baseUrl, page, t) {
    const u = partUrl(baseUrl, page);
    if (!u) return '#t=' + Math.floor(Number(t) || 0);
    return u + '&t=' + Math.floor(Number(t) || 0);
  }

  // parts: [{ page, part, duration, verdict:'stable'|'single', votes, trackLan, sentences:[{from,to,content}] }]
  // failed: [{ page, part, verdict, reason, cover }]
  // meta: { url, title, bvid, exportedAt, totalPages }
  function batchMarkdown(parts, failed, meta) {
    const m = meta || {};
    const good = Array.isArray(parts) ? parts : [];
    const bad = Array.isArray(failed) ? failed : [];
    const total = Number(m.totalPages) || (good.length + bad.length);
    const stableN = good.filter(function (p) { return p.verdict === 'stable'; }).length;
    const singleN = good.length - stableN;
    const out = [];
    out.push('---');
    out.push('source: ' + (m.url || ''));
    out.push('title: ' + (m.title || ''));
    if (m.bvid) out.push('bvid: ' + m.bvid);
    out.push('pages: ' + total);
    out.push('exported_parts: ' + good.length + '/' + total);
    out.push('verified_parts: ' + stableN + '/' + total);
    out.push('tags:');
    out.push('  - bilibili');
    out.push('  - 视频笔记');
    out.push('  - 合集');
    out.push('exported: ' + (m.exportedAt || new Date().toISOString()));
    out.push('---');
    out.push('');
    out.push('# ' + (m.title || m.bvid || ''));
    out.push('');
    out.push('> 合集共 ' + total + ' P，这份文件里有 ' + good.length + ' P 的字幕（' + stableN + ' P 两次取样一致'
      + (singleN ? '，' + singleN + ' P 只取到一份、标了「单次取样」' : '') + '），' + bad.length + ' P 没有导出（原因在文末）。');
    out.push('> 每行是播放器里的原句，点时间回到那一 P 的对应秒。');
    out.push('');
    good.forEach(function (p) {
      const head = '## P' + Number(p.page || 1) + (p.part ? ' · ' + String(p.part) : '');
      out.push(head);
      out.push('');
      const lines = Array.isArray(p.sentences) ? p.sentences : [];
      const tag = p.verdict === 'stable' ? '两次取样一致' : '单次取样';
      out.push('_字幕 ' + lines.length + ' 句 · ' + tag + (p.trackLan ? ' · ' + p.trackLan : '') + '_');
      out.push('');
      lines.forEach(function (s) {
        const text = String((s && s.content) || '').replace(/\s+/g, ' ').trim();
        const from = Number(s && s.from) || 0;
        out.push('- [' + fmtTime(from) + '](' + partJump(m.url, p.page, from) + ') ' + text);
      });
      out.push('');
    });
    if (bad.length) {
      out.push('## 未导出的 P（' + bad.length + '）');
      out.push('');
      bad.forEach(function (f) {
        const cover = (f && f.cover != null) ? '（时长覆盖 ' + f.cover + '）' : '';
        out.push('- P' + Number(f.page || 0) + (f.part ? ' · ' + String(f.part) : '') + '：' + reasonText(f.verdict, f.reason) + cover);
      });
      out.push('');
      out.push('> 这几 P 不是坏了，是字幕没通过取样/闸门。单独打开那一 P 刷新几次，或者去视频页点「导出」看它自己的判定。');
      out.push('');
    }
    return out.join('\n');
  }

  function batchFileName(meta) {
    const m = meta || {};
    const total = Number(m.totalPages) || 0;
    const base = safeName(m.title || m.bvid || '', m.bvid || 'bilibili');
    const tail = total > 1 ? '（合集' + total + 'P）' : '';
    return (base + tail).replace(/[. ]+$/, '') + '.md';
  }

  root.BnBatch = {
    batchMarkdown: batchMarkdown,
    batchFileName: batchFileName,
    reasonText: reasonText,
    safeName: safeName,
    partUrl: partUrl,
    partJump: partJump,
  };
})(typeof window !== 'undefined' ? window : globalThis);