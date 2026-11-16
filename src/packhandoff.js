// 「交给 agent」的最后一厘米：把「读哪个文件、用什么 skill」写成一句可以直接粘贴的话。
// 扩展不能往任意本地路径写文件、也不能主动和 agent 进程通信（零服务器约束），
// 所以这里只生成一句话 + 一个可复制的位置，由用户粘到 agent 里。
// 纯函数，无 DOM、无 chrome。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.BnPackHandoff = api; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'bn.packLast';
  const MAX_TEXT = 2000;

  function str(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; }

  // 浏览器把两个文件下到默认下载目录，名字在这里定死，agent 就按这个名字找。
  function names(baseName) {
    const b = str(baseName) || 'bilibili-course';
    return { json: b + '.json', md: b + '.md' };
  }

  function goalLine(goal) {
    const g = str(goal);
    if (!g) return '目标：我还没写，请先问我这次想学到什么程度，再开始裁剪。';
    return '目标：' + g;
  }

  // 一句里要带上：文件名、找不到怎么办、先校验 spec，然后才是我要的东西。
  // 「找不到就问我」是故意写的：扩展拿不到绝对路径，硬写一个路径反而会骗人。
  function text(o) {
    o = o || {};
    const n = names(o.baseName);
    const course = str(o.course) || '这门课';
    const eps = num(o.episodes);
    const scope = str(o.scope);
    const head = '我刚用「B站字幕笔记」导出了学习包「' + n.json + '」（同目录还有「' + n.md + '」，是给人看的版本）。';
    const ask = '请用 bili-study 带我学这门课：先找到这个文件（默认在浏览器下载目录，Windows 是 %USERPROFILE%\\Downloads，macOS 是 ~/Downloads；找不到就问我路径，别猜），读之前确认 spec 是 bn-study-pack/1，然后按下面的目标裁剪、出依赖图和学习顺序，再用逐字原话考我。';
    const meta = '课程：' + course + (scope ? '（' + scope + ' · ' + (eps ? eps + ' 集' : '若干集') + '）' : (eps ? '（' + eps + ' 集）' : ''));
    const out = [head, ask, meta, goalLine(o.goal)].join('\n');
    return out.slice(0, MAX_TEXT);
  }

  function record(o) {
    o = o || {};
    const n = names(o.baseName);
    const at = str(o.at) || new Date().toISOString();
    // 传进来的记录已经带名字时保留它（markedCopied 就是直接回写自己那条）
    const jsonName = str(o.jsonName) || n.json;
    const mdName = str(o.mdName) || n.md;
    return {
      at: at,
      jsonName: jsonName,
      mdName: mdName,
      course: str(o.course),
      scope: str(o.scope),
      episodes: num(o.episodes),
      goal: str(o.goal),
      text: str(o.text),
      copiedAt: str(o.copiedAt),
    };
  }

  function parsePending(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = str(raw.text);
    if (!t) return null;
    return record(raw);
  }

  // 每次导出后自动复制一次；同一个 at 已经复制过就不再打扰。
  function shouldAutoCopy(rec) {
    if (!rec || !str(rec.text)) return false;
    return !str(rec.copiedAt);
  }

  function markedCopied(rec, now) {
    const o = record(rec);
    o.copiedAt = str(now) || new Date().toISOString();
    return o;
  }

  return {
    KEY: KEY,
    MAX_TEXT: MAX_TEXT,
    names: names,
    text: text,
    record: record,
    parsePending: parsePending,
    shouldAutoCopy: shouldAutoCopy,
    markedCopied: markedCopied,
  };
});
