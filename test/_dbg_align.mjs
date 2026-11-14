import vm from 'node:vm'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/align.js'), 'utf8'), ctx);
const A = ctx.window.BnAlign;
function rnd(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function makeCues(duration, seed = 7) { const r = rnd(seed), cues = []; let t = 1 + r(); while (t + 1.4 < duration) { const len = 1.2 + r() * 2.4; cues.push({ from: +t.toFixed(2), to: +(t + len).toFixed(2) }); t += len + 0.3 + r() * 1.6; } return cues; }
function makeSamples(cues, shiftFn, duration = 600, noise = 0.01) { const out = []; for (let d = 0; d <= duration; d += 0.2) out.push({ t: +d.toFixed(2), rms: noise }); for (const c of cues) { const s = c.from + (shiftFn ? shiftFn(c.from) : 0), len = c.to - c.from; for (let d = s; d <= s + len; d += 0.2) { if (d < 0 || d > duration) continue; const i = Math.round(d / 0.2); if (out[i]) out[i].rms = 0.12 + 0.05 * Math.sin(d); } } return out; }
const cues = makeCues(600);
const rate = 0.008;
const s = makeSamples(cues, (t) => rate * t);
const r = A.analyze(s, cues);
console.log('global', JSON.stringify(r));
const buckets = A.toBuckets(s), spans = A.cueSpans(cues);
const rms = buckets.map(b => b.rms).sort((a,b)=>a-b);
const thr = rms[Math.round((rms.length-1)*0.2)] + 0.25 * (rms[Math.round((rms.length-1)*0.9)] - rms[Math.round((rms.length-1)*0.2)]);
for (let i = 0; i < 3; i++) { const a = i*200, b = a+200; const seg = buckets.filter(x => x.t >= a && x.t < b); console.log('seg', i, 'n', seg.length); }
