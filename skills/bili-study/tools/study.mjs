// B站字幕笔记 · 学习包工具（agent 侧确定性部分；对话与出题不在这里）
// 用法：
//   node study.mjs plan <学习包.json> [--goal "…"] [--keep 12] [--out <目录>]
//   node study.mjs state <学习包.json> [--goal "…"] [--out <目录>]
//   node study.mjs mark <study-state.json> <概念名> <understood|shaky|unknown> [--quote "…"] [--url "…"]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PACK_SPEC = 'bn-study-pack/1';
export const STATE_SPEC = 'bn-study-state/1';

const PARTICLE = new Set(['的', '了', '吗', '呢', '吧', '着', '过', '和', '与', '是', '在', '也', '就', '都', '而', '及', '或', '中', '上', '下', '里', '把', '被', '让', '给', '对', '从', '到', '用', '能', '会', '要', '来', '去', '这', '那']);
const STOP = new Set(['的', '了', '是', '在', '和', '与', '也', '就', '都', '而', '及', '或', '一个', '这个', '那个', '我们', '你们', '他们', '怎么', '什么', '为什么', '如何', '可以', '需要', '想要', '要', '能', '会', '把', '被', '让', '给', '对', '从', '到', '用', '里', '上', '下', '中']);

/** 目标句切词：中文 2~4 字滑窗（去停用词），英文/数字整词小写 */
export function tokenize(goal) {
  const out = new Set();
  const s = String(goal || '');
  for (const w of s.toLowerCase().match(/[a-z][a-z0-9+#.\-]{1,}/g) || []) out.add(w);
  const zh = s.replace(/[^\u4e00-\u9fa5]+/g, ' ').split(' ').filter(Boolean);
  for (const seg of zh) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const t = seg.slice(i, i + n);
        if (!STOP.has(t) && ![...t].every(ch => PARTICLE.has(ch))) out.add(t);
      }
    }
  }
  return [...out];
}

function hits(text, tokens) {
  const t = String(text || '').toLowerCase();
  let n = 0;
  for (const k of tokens) if (k.length >= 2 && t.includes(k)) n++;
  return n;
}

/** 概念打分：目标命中 + 跨集复用。why 用来向人解释「为什么留下」 */
export function scoreConcept(c, tokens) {
  const eps = [...new Set((c.anchors || []).map(a => a.ep))].filter(v => v !== undefined);
  const inName = hits(c.name, tokens) + hits((c.aliases || []).join(' '), tokens);
  const inDef = hits(c.def, tokens);
  const inQuote = (c.anchors || []).reduce((n, a) => n + hits(a.quote, tokens), 0);
  const reuse = Math.max(0, eps.length - 1);
  const score = inName * 3 + inDef * 2 + Math.min(inQuote, 4) + reuse * 2;
  const why = [];
  if (inName) why.push('目标里点名了');
  if (inDef) why.push('定义对上目标');
  if (inQuote) why.push('原话里出现过目标词');
  if (reuse) why.push(reuse + ' 集里复用');
  return { score, hits: inName + inDef + inQuote, eps, reuse, why };
}

function firstAnchor(c) {
  let best = null;
  for (const a of c.anchors || []) {
    const k = [a.ep === undefined ? 1e9 : a.ep, a.t === undefined ? 1e9 : a.t];
    if (!best || k[0] < best.k[0] || (k[0] === best.k[0] && k[1] < best.k[1])) best = { k, a };
  }
  return best ? best.a : null;
}

/** 裁剪 + 排序 + 共现图。不编造依赖：边只表示「同一集里都讲过」 */
export function plan(pack, opts = {}) {
  if (!pack || pack.spec !== PACK_SPEC) throw new Error('不是 ' + PACK_SPEC + ' 的学习包（读到 ' + (pack && pack.spec) + '）');
  const goal = String(opts.goal || pack.goal || '').trim();
  const tokens = tokenize(goal);
  const concepts = Array.isArray(pack.concepts) ? pack.concepts : [];
  const base = { spec: PACK_SPEC, goal, course: pack.course, scope: pack.scope };
  if (!concepts.length) return { ...base, kept: [], dropped: [], edges: [], mermaid: '', stats: { total: 0, kept: 0, dropped: 0, edges: 0 } };

  const scored = concepts.map(c => ({ c, s: scoreConcept(c, tokens) }));
  const ratio = Math.ceil(scored.length * 0.6);
  const keepMin = Math.max(1, Math.min(Number(opts.keep) || 0 || ratio, scored.length));
  const must = scored.filter(x => x.s.hits > 0 || x.s.reuse > 0);
  const rest = scored.filter(x => x.s.hits === 0 && x.s.reuse === 0).sort((a, b) => b.s.score - a.s.score);
  const keptSet = new Set(must.map(x => x.c.name));
  // 没填目标就无从裁剪：全留（宁可多学，也不替用户瞎删）
  if (!tokens.length) for (const x of scored) keptSet.add(x.c.name);
  for (const x of rest) {
    if (keptSet.size >= keepMin) break;
    keptSet.add(x.c.name);
  }
  // 救回被别的概念点名的：留下的概念，其定义或原话里提到的名字，不能一边讲它一边把它丢掉
  for (let pass = 0; pass < 2; pass++) {
    const text = scored.filter(x => keptSet.has(x.c.name)).map(x => x.c.def + " " + (x.c.anchors || []).map(a => a.quote).join(" ")).join(" ");
    let changed = false;
    for (const x of scored) {
      if (keptSet.has(x.c.name)) continue;
      const nm = x.c.name;
      if (nm.length >= 2 && text.indexOf(nm) >= 0) { keptSet.add(nm); x.s.why.push("被其他概念引用"); changed = true; }
    }
    if (!changed) break;
  }
  const kept = scored.filter(x => keptSet.has(x.c.name));
  const dropped = scored.filter(x => !keptSet.has(x.c.name));

  // 顺序 = 第一次被讲到的先后（这是事实，不是「依赖」）
  const order = kept.map(x => ({
    name: x.c.name, def: x.c.def, kind: x.c.kind,
    first: firstAnchor(x.c), anchors: x.c.anchors || [],
    why: x.s.why, score: x.s.score, eps: x.s.eps,
  })).sort((a, b) => {
    const ka = a.first ? [a.first.ep === undefined ? 1e9 : a.first.ep, a.first.t || 0] : [1e9, 0];
    const kb = b.first ? [b.first.ep === undefined ? 1e9 : b.first.ep, b.first.t || 0] : [1e9, 0];
    return ka[0] - kb[0] || ka[1] - kb[1];
  });

  // 边 = 同一集里按讲到的先后相邻的两个概念（链式，避免全连通糊成一团）
  // 这只是「讲课顺序」，不是因果依赖；真依赖要 agent 结合字幕判断
  const byEp = new Map();
  for (const x of order) {
    for (const a of x.anchors || []) {
      if (a.ep === undefined) continue;
      if (!byEp.has(a.ep)) byEp.set(a.ep, new Map());
      const m = byEp.get(a.ep);
      const prev = m.get(x.name);
      if (prev === undefined || (a.t || 0) < prev) m.set(x.name, a.t || 0);
    }
  }
  const pairs = new Map();
  for (const [, m] of byEp) {
    const seq = [...m.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    for (let i = 0; i + 1 < seq.length; i++) {
      const k = [seq[i], seq[i + 1]].sort().join(String.fromCharCode(0));
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  const edges = [...pairs.entries()].map(([k, n]) => {
    const parts = k.split(String.fromCharCode(0));
    return { a: parts[0], b: parts[1], eps: n };
  }).sort((x, y) => y.eps - x.eps);

  return { ...base, kept: order, dropped: dropped.map(x => ({ name: x.c.name, def: x.c.def, score: x.s.score })), edges, mermaid: mermaid(order, edges),
    stats: { total: concepts.length, kept: order.length, dropped: dropped.length, edges: edges.length } };
}

const mermaidId = (i) => 'c' + (i + 1);
const cleanLabel = (s) => String(s || '').replace(/["\[\]{}()]/g, '').slice(0, 24);

export function mermaid(order, edges, maxEdges = 60) {
  const idx = new Map(order.map((c, i) => [c.name, i]));
  const lines = ['graph TD'];
  order.forEach((c, i) => lines.push('  ' + mermaidId(i) + '["' + cleanLabel(c.name) + '"]'));
  edges.filter(e => idx.has(e.a) && idx.has(e.b)).sort((x, y) => y.eps - x.eps).slice(0, maxEdges).forEach(e => {
    const a = idx.get(e.a), b = idx.get(e.b);
    const from = Math.min(a, b), to = Math.max(a, b);
    lines.push('  ' + mermaidId(from) + ' -. 同集相邻 .-> ' + mermaidId(to));
  });
  return lines.join('\n');
}

export function markdown(pl) {
  const L = [];
  L.push('# 学习计划 · ' + (pl.course ? pl.course.title : '课程'));
  L.push('');
  if (pl.goal) { L.push('目标：' + pl.goal); L.push(''); }
  L.push('范围：' + (pl.scope || '') + ' · 共 ' + pl.stats.total + ' 个概念，保留 ' + pl.stats.kept + ' 个，跳过 ' + pl.stats.dropped + ' 个');
  L.push('');
  L.push('## 依赖图（虚线 = 同一集里讲过，不代表因果）');
  L.push('');
  L.push('```mermaid');
  L.push(pl.mermaid);
  L.push('```');
  L.push('');
  L.push('## 学习顺序（按第一次被讲到的先后）');
  L.push('');
  pl.kept.forEach((c, i) => {
    const a = c.first;
    const at = a ? ' · ' + (a.ep_label || '第 ' + a.ep + ' 集') + ' ' + (a.at || '') : '';
    L.push((i + 1) + '. **' + c.name + '**' + at);
    if (c.def) L.push('   ' + c.def);
    if (a && a.url) L.push('   ' + a.url);
    if (c.why && c.why.length) L.push('   _为什么留下：' + c.why.join(' / ') + '_');
  });
  if (pl.dropped.length) {
    L.push('');
    L.push('## 跳过的概念（' + pl.dropped.length + '）');
    L.push('');
    pl.dropped.forEach(d => L.push('- ' + d.name + (d.def ? '：' + d.def : '')));
  }
  L.push('');
  return L.join('\n');
}

export function stateInit(pl) {
  const now = new Date().toISOString();
  return {
    spec: STATE_SPEC,
    course: (pl.course && pl.course.title) || '',
    course_id: (pl.course && pl.course.id) || '',
    goal: pl.goal || '',
    updated_at: now,
    concepts: pl.kept.map(c => ({
      name: c.name, status: 'unknown', asked: 0, correct: 0,
      last_quote: (c.first && c.first.quote) || '', last_url: (c.first && c.first.url) || '', updated_at: now,
    })),
    next: pl.kept.slice(0, 3).map(c => ({ name: c.name, url: (c.first && c.first.url) || '', reason: '按顺序先学' })),
    progress: { understood: 0, shaky: 0, unknown: pl.kept.length, total: pl.kept.length },
  };
}

export function stateMark(state, name, status, opts = {}) {
  if (!state || state.spec !== STATE_SPEC) throw new Error('不是 ' + STATE_SPEC + ' 的学习状态');
  if (!['understood', 'shaky', 'unknown'].includes(status)) throw new Error('status 只能是 understood / shaky / unknown');
  const c = (state.concepts || []).find(x => x.name === name);
  if (!c) throw new Error('这个包里没有概念：' + name);
  const now = new Date().toISOString();
  c.status = status;
  c.asked = (c.asked || 0) + 1;
  if (status === 'understood') c.correct = (c.correct || 0) + 1;
  if (opts.quote) c.last_quote = opts.quote;
  if (opts.url) c.last_url = opts.url;
  c.updated_at = now;
  state.updated_at = now;
  const p = { understood: 0, shaky: 0, unknown: 0 };
  for (const x of state.concepts) p[x.status] = (p[x.status] || 0) + 1;
  state.progress = { ...p, total: state.concepts.length };
  const next = [];
  for (const st of ['shaky', 'unknown']) {
    for (const x of state.concepts) {
      if (x.status === st && next.length < 3) next.push({ name: x.name, url: x.last_url || '', reason: st === 'shaky' ? '上次没讲清，再考一次' : '还没考过' });
    }
  }
  state.next = next;
  return state;
}

export function summarize(state) {
  const p = state.progress || {};
  return '懂 ' + (p.understood || 0) + ' / 半懂 ' + (p.shaky || 0) + ' / 没考 ' + (p.unknown || 0) + '，共 ' + (p.total || 0);
}

// ---------- CLI ----------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').slice(-1)[0]);
if (isMain) {
  const argv = process.argv.slice(2);
  const [cmd, file] = argv;
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  try {
    if (cmd === 'plan' || cmd === 'state') {
      const pack = JSON.parse(readFileSync(file, 'utf8'));
      const pl = plan(pack, { goal: opt('goal', ''), keep: opt('keep', 0) });
      const outDir = opt('out', '');
      if (cmd === 'plan') {
        const md = markdown(pl);
        process.stdout.write(md);
        if (outDir) { writeFileSync(join(outDir, 'plan.md'), md); writeFileSync(join(outDir, 'plan.json'), JSON.stringify(pl, null, 2)); }
      } else {
        const st = stateInit(pl);
        const text = JSON.stringify(st, null, 2);
        process.stdout.write(text);
        if (outDir) writeFileSync(join(outDir, 'study-state.json'), text);
      }
    } else if (cmd === 'mark') {
      const st = JSON.parse(readFileSync(file, 'utf8'));
      const next = stateMark(st, argv[2], argv[3], { quote: opt('quote', ''), url: opt('url', '') });
      const text = JSON.stringify(next, null, 2);
      writeFileSync(file, text);
      process.stdout.write(summarize(next) + '\n');
    } else {
      process.stderr.write('用法：plan <包.json> | state <包.json> | mark <study-state.json> <概念> <understood|shaky|unknown>\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write('[study] ' + e.message + '\n');
    process.exit(1);
  }
}
