const FS = require('./load')('util.js', 'cpue.js', 'lfq.js', 'cmsy.js', 'spm.js'); const U = FS.util; const fs = require('fs'), path = require('path');
const rng = U.rng(7); const T = (name, f) => { const t0 = Date.now(); try { const r = f(); console.log('OK  ', name, (Date.now() - t0) + 'ms', r || ''); } catch (e) { console.log('FAIL', name, e.message); } };
// 1) 體長：30 萬尾、每列一尾（無頻度欄）
const rows = [['date', 'length_cm']]; const months = ['2016-01-15', '2016-03-15', '2016-05-15', '2016-07-15', '2016-09-15', '2016-11-15'];
for (let i = 0; i < 300000; i++) rows.push([months[i % 6], (20 + 100 * rng.unif()).toFixed(1)]);
const ltab = U.rowsToTable(rows); let l;
T('LFQ build 300k rows', () => { l = FS.lfq.build(ltab, 'date', 'length_cm', null, 2); return `n=${l.raw_n}`; });
T('LFQ ELEFAN', () => FS.lfq.elefan(l, { MA: 7, Linf_range: [100, 160], K_range: [0.1, 1], popSize: 30, maxiter: 15 }).Rn_max.toFixed(3));
T('LFQ catch curve + indicators', () => { const cc = FS.lfq.catchCurve(l, 130, 0.3, 0.3); FS.lfq.indicators(l, 130, 0.3, 0.3, 60); return 'Z=' + cc.Z.toFixed(3); });
// 2) CPUE：20 萬筆
const cr = [['year', 'area', 'season', 'depth', 'catch', 'effort']];
for (let i = 0; i < 200000; i++) { const y = 2000 + (i % 25); cr.push([y, 'A' + (i % 5), 'S' + (i % 4), (50 + 200 * rng.unif()).toFixed(0), rng.unif() < 0.2 ? 0 : (Math.exp(2 - 0.03 * (y - 2000) + 0.5 * rng.norm())).toFixed(3), (1000 + 2000 * rng.unif()).toFixed(0)]); }
const ctab = U.rowsToTable(cr);
T('CPUE delta 200k rows', () => FS.cpueStandardize(ctab, { year: 'year', catchCol: 'catch', effortCol: 'effort', factors: ['area', 'season'], covars: ['depth'], interact: ['area', 'season'], method: 'delta', nsim: 500 }).index.length + ' yrs');
// 3) CMSY 20 萬組
const cd = U.parseCSV(U.decodeText(fs.readFileSync(path.join(__dirname, '../data/example_catch_cpue.csv'))));
T('CMSY n=200000', () => { const rr = [0.2, 0.8], bk = FS.cmsyBkDefault(cd.cols.year, cd.cols.catch, rr); return FS.cmsyRun({ year: cd.cols.year, catch: cd.cols.catch, r_range: rr, bk_start: bk.start, bk_end: bk.end, n: 200000 }).n_viable + ' viable'; });
// 4) 生物量模型：長鏈（ni 100000、nt 1、4 鏈 → 36 萬組，應自動抽稀）
const se = U.parseCSV(U.decodeText(fs.readFileSync(path.join(__dirname, '../data/example_cpue_se.csv')))); const idx = cd.names.filter(n => !['year', 'catch'].includes(n));
const o = { years: cd.cols.year, catch: cd.cols.catch, indices: Object.fromEntries(idx.map(n => [n, cd.cols[n]])), se: Object.fromEntries(idx.map(n => [n, se.cols[n]])), model: 'Schaefer', rDist: 'range', rPrior: [0.2, 0.8], kPrior: null, psiPrior: [0.9, 0.25] };
T('SPM ni=100000 nt=1 nc=4', () => { const mc = { ni: 100000, nb: 10000, nt: 1, nc: 4 }; const ch = [0, 1, 2, 3].map(c => FS.spm.chain(o, mc, c)); const f = FS.spm.fromChains(o, mc, ch); return `draws=${f.nDraws} nt=${f.mcmc.nt} BB=${f.estimates['B_Bmsy.cur'].mu.toFixed(3)}`; });
