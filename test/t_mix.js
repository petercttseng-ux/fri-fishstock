const FS = require('./load')('util.js', 'cmsy.js', 'spm.js'); const fs = require('fs'); const U = FS.util;
const cd = U.parseCSV(U.decodeText(fs.readFileSync(require('path').join(__dirname, '../data/') + 'example_catch_cpue.csv')));
const se = U.parseCSV(U.decodeText(fs.readFileSync(require('path').join(__dirname, '../data/') + 'example_cpue_se.csv')));
const idx = cd.names.filter(n => !['year', 'catch'].includes(n));
const o = { years: cd.cols.year, catch: cd.cols.catch, indices: Object.fromEntries(idx.map(n => [n, cd.cols[n]])), se: Object.fromEntries(idx.map(n => [n, se.cols[n]])), model: 'Schaefer', rDist: 'range', rPrior: [0.2, 0.8], kPrior: null, psiPrior: [0.9, 0.25] };
for (const seed of [0, 1, 2, 3, 4]) { const t0 = Date.now(); const f = FS.spm.run(o, Object.assign({ seed }, FS.spm.quickMC)); console.log(process.env.NB, 'seed', seed, Date.now() - t0, 'ms Rhat', f.conv.map(c => c.rhat.toFixed(3)).join(','), 'geweke', f.conv.map(c => c.geweke.toFixed(2)).join(','), 'K', Math.round(f.estimates.K.mu)); }
