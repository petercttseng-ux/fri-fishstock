const FS = require('./load')('util.js', 'cmsy.js', 'spm.js'); const fs = require('fs'); const U = FS.util;
const cd = U.parseCSV(U.decodeText(fs.readFileSync(require('path').join(__dirname, '../data/') + 'example_catch_cpue.csv')));
const se = U.parseCSV(U.decodeText(fs.readFileSync(require('path').join(__dirname, '../data/') + 'example_cpue_se.csv')));
const idx = cd.names.filter(n => !['year', 'catch'].includes(n));
const o = { years: cd.cols.year, catch: cd.cols.catch, indices: Object.fromEntries(idx.map(n => [n, cd.cols[n]])),
  se: Object.fromEntries(idx.map(n => [n, se.cols[n]])), model: 'Schaefer', rDist: 'range', rPrior: FS.cmsyRRange('中'), kPrior: null, psiPrior: [0.9, 0.25] };
let t0 = Date.now();
const fit = FS.spm.run(o, { ni: 30000, nb: 5000, nt: 5, nc: 2 });
console.log('time', Date.now() - t0, 'ms draws', fit.nDraws, 'acc', fit.accept.toFixed(3));
for (const k of ['K', 'r', 'psi', 'sigma.proc', 'MSY', 'B_Bmsy.cur', 'H_Hmsy.cur']) { const e = fit.estimates[k]; console.log(k.padEnd(11), U.signif(e.mu, 4), U.signif(e.lci, 4), U.signif(e.uci, 4)); }
console.log('stats', JSON.stringify(fit.stats), 'conv', JSON.stringify(fit.conv.map(c => [c.name, c.geweke.toFixed(2), c.heidel.toFixed(2), c.rhat.toFixed(3)])));
t0 = Date.now(); const hc = FS.spm.hindcast(fit, [1, 2, 3, 4, 5]); console.log('hindcast', Date.now() - t0, 'ms');
console.log(JSON.stringify(FS.spm.diagnostics(fit, hc, 'long').map(r => [r.診斷項目, r.結果, r.判定])));
t0 = Date.now(); const pj = FS.spm.projection(fit, [-0.4, -0.2, 0, 0.2], 10); console.log('proj', Date.now() - t0, 'ms', JSON.stringify(pj.P_green.map(r => [r.漁獲量情境, r['2035']])));
