// 学习包工具（agent 侧）：切词 / 打分 / 裁剪 / 救回 / 图 / 状态机
import { tokenize, scoreConcept, plan, mermaid, markdown, stateInit, stateMark, summarize, safeDirName, outDirFor, ensureDir, PACK_SPEC, STATE_SPEC } from '../skills/bili-study/tools/study.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const okk = JSON.stringify(a) === JSON.stringify(b);
  if (okk) pass++; else { fail++; console.log('FAIL ' + msg + '\n  got ' + JSON.stringify(a) + '\n  want ' + JSON.stringify(b)); }
};
const ok = (v, msg) => eq(!!v, true, msg);
const throws = (fn, msg) => { try { fn(); fail++; console.log('FAIL ' + msg + '（应该抛错）'); } catch { pass++; } };

const pack = (concepts) => ({ spec: PACK_SPEC, goal: '', course: { id: 'season:1', title: '测试课' }, scope: 'S1', concepts, episodes: [], counts: {} });
const C = (name, def, anchors, kind = '概念', aliases = []) => ({ name, def, kind, aliases, anchors });
const A = (ep, t, quote) => ({ ep, ep_label: 'S' + ep, ep_title: '第 ' + ep + ' 集', t, at: String(t), url: 'https://x/' + ep + '?t=' + t, quote });

// --- 切词 ---
const tk = tokenize('三周内能独立用 agent 跑通一个自动化任务');
ok(tk.includes('agent'), '英文词整词进 token');
ok(tk.includes('自动'), '中文 2 字滑窗进 token');
ok(!tk.includes('一个'), '停用词被过滤');
eq(tokenize('').length, 0, '空目标没有 token');
eq(tokenize('的了吗').length, 0, '全是停用词时没有 token');

// --- 打分 ---
const s1 = scoreConcept(C('agent', '能替你写代码、跑脚本的AI执行者', [A(1, 10, '让 agent 自己跑')]), ['agent']);
ok(s1.score >= 4 && s1.hits > 0, '名字命中 + 原话命中加权');
ok(s1.why.some(w => w.indexOf('点名') >= 0), 'why 说清楚为什么留下');
const s2 = scoreConcept(C('开源精神', '不求回报', [A(1, 5, '当兴趣'), A(2, 5, '别薅羊毛')]), []);
eq(s2.reuse, 1, '跨两集复用记一次');
eq(s2.hits, 0, '没命中目标是 0 分');
ok(s2.score >= 2, '复用本身给分');

// --- 裁剪 ---
const full = pack([
  C('agent', '能跑脚本的执行者', [A(1, 10, '让 agent 干活')]),
  C('回滚', '把改动退回上一个版本', [A(2, 10, '改坏了就回滚'), A(3, 10, '回滚到上一版')]),
  C('配色', '界面好看不好看', [A(1, 60, '配色要克制')]),
  C('零食', '吃的东西', [A(9, 60, '带点零食')]),
]);
const pl = plan(full, { goal: '跑通自动化 回滚', keep: 2 });
ok(pl.kept.some(c => c.name === 'agent'), '目标点名 + 引用救回后留下 agent');
ok(pl.kept.some(c => c.name === '回滚'), '目标点名的概念留下');
eq(pl.stats.total, 4, '统计总数');
eq(pl.stats.kept, pl.kept.length, '统计保留数一致');
eq(pl.dropped.length, 4 - pl.kept.length, '跳过数 = 总数 - 保留');

// 救回：被保留概念的定义里提到的名字，不能被丢掉
const rescue = pack([
  C('GH', 'GitHub 官方命令行工具', [A(1, 10, '用 gh 命令搜仓库')]),
  C('GitHub', '存放代码的网站', [A(1, 5, '打开 github 看看')]),
  C('奶茶', '喝的', [A(1, 30, '先点杯奶茶')]),
]);
const pl2 = plan(rescue, { goal: '命令行工具', keep: 1 });
ok(pl2.kept.some(c => c.name === 'GitHub'), '被 GH 定义点名的 GitHub 被救回');
ok(pl2.dropped.some(c => c.name === '奶茶'), '无关概念仍然跳过');
ok(pl2.kept.find(c => c.name === 'GitHub').why.join().indexOf('引用') >= 0, '救回时写明原因');

// 顺序 = 第一次被讲到的先后
const orderPack = pack([
  C('乙', 'b', [A(1, 90, '乙句')]),
  C('甲', 'a', [A(1, 10, '甲句')]),
]);
eq(plan(orderPack, { goal: '' }).kept.map(c => c.name), ['甲', '乙'], '按首次出现的秒数排序');

// --- 图 ---
const g = plan(pack([
  C('一', 'd1', [A(1, 10, 'q1')]),
  C('二', 'd2', [A(1, 20, 'q2')]),
  C('三', 'd3', [A(1, 30, 'q3')]),
]), { goal: '' });
ok(g.mermaid.indexOf('graph TD') === 0, 'mermaid 以 graph TD 开头');
ok(g.mermaid.indexOf('同集相邻') > 0, '边标注是「同集相邻」不是「依赖」');
eq((g.mermaid.match(/\.->/g) || []).length, 2, '三个相邻概念 = 两条边（链式，不是全连通）');
eq(mermaid([], []).trim(), 'graph TD', '空计划也能出合法图');
ok(mermaid([{ name: 'ab(c)' }], []).indexOf('"') > 0, '节点用引号包住名字');

// --- Markdown ---
const md = markdown(plan(pack([C('甲', '定义甲', [A(2, 65, '原话甲')])]), { goal: '甲' }));
ok(md.indexOf('# 学习计划') === 0, '计划标题');
ok(md.indexOf('```mermaid') > 0, '有 mermaid 代码块');
ok(md.indexOf('· S2') >= 0, '写清第一次讲到在哪');
ok(md.indexOf('原话甲') < 0, '计划里不塞引文（引文留给拷打环节）');

// --- 状态机 ---
const st = stateInit(plan(full, { goal: 'agent 回滚' }));
eq(st.spec, STATE_SPEC, '状态 spec');
eq(st.progress.total, st.concepts.length, '进度总数');
eq(st.concepts.filter(c => c.status === 'unknown').length, st.concepts.length, '初始全部没考');
ok(st.next.length > 0 && st.next[0].name, '给下一批建议');
const st2 = stateMark(st, st.concepts[0].name, 'understood', { quote: '原话', url: 'https://x' });
eq(st2.progress.understood, 1, '标记懂');
eq(st2.concepts[0].asked, 1, '记一次拷打');
eq(st2.concepts[0].last_quote, '原话', '记下当时的引文');
const st3 = stateMark(st2, st2.concepts[0].name, 'shaky');
eq(st3.progress.understood, 0, '改判后旧状态清掉');
eq(st3.progress.shaky, 1, '半懂计数');
eq(st3.next[0].name, st3.concepts[0].name, '半懂的排到下一批最前');
throws(() => stateMark(st, '不存在', 'understood'), '未知概念要抛错');
throws(() => stateMark(st, st.concepts[0].name, 'mastered'), '非法状态要抛错');
throws(() => stateMark({ spec: 'x' }, 'a', 'understood'), '错的 spec 要抛错');
ok(summarize(st3).indexOf('半懂 1') > 0, '总结写人话');
throws(() => plan({ spec: 'bn-study-pack/9' }), '不认识的 pack 版本要抛错');
eq(plan(pack([])).stats.total, 0, '空概念不崩');
eq(plan(pack([])).mermaid, '', '空概念没有图');


// 输出目录：早先 --out 指到不存在的目录直接 ENOENT，工具不自己建。
eq(safeDirName('【从零开始的 AI 学习】'), '【从零开始的 AI 学习】', '中文书名号保留');
eq(safeDirName('a/b\\c:d'), 'a_b_c_d', 'Windows 非法字符换成下划线');
eq(safeDirName(''), 'study', '空名字兜底');
eq(safeDirName('   '), 'study', '纯空白也算空');
eq(outDirFor({ course: { title: '测试课' } }, ''), join('study', '测试课'), '不给 --out 就落到 ./study/<课程名>');
eq(outDirFor({ course: { title: '测试课' } }, 'D:/x/y'), 'D:/x/y', '给了 --out 就用它');
eq(outDirFor({}, ''), join('study', 'study'), '包里没课程名也不崩');
const tmpBase = mkdtempSync(join(tmpdir(), 'bn-out-'));
const deep = join(tmpBase, 'a', 'b', 'c');
eq(existsSync(deep), false, '目录还不存在');
eq(ensureDir(deep), deep, 'ensureDir 返回路径');
eq(existsSync(deep), true, 'ensureDir 真的建出来了（含父级）');
eq(ensureDir(''), '', '空目录名原样返回');
rmSync(tmpBase, { recursive: true, force: true });
console.log('studyplan: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
