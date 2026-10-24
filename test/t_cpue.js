const FS = require('./load')('util.js', 'cpue.js'); const fs = require('fs');
const tab = FS.util.parseCSV(FS.util.decodeText(fs.readFileSync(require('path').join(__dirname, '../data/') + 'example_logbook.csv')));
for (const method of ['lognormal', 'delta']) {
  const t0 = Date.now();
  const r = FS.cpueStandardize(tab, { year: 'year', catchCol: '漁獲量_kg', effortCol: '努力量_鉤數', factors: ['季別', '海區', '船噸級'], covars: ['水深'], interact: ['季別', '海區'], method, nsim: 1000 });
  console.log(method, Date.now() - t0, 'ms', JSON.stringify(r.fit_stats));
  console.log(' idx', r.index.slice(0, 4).map(x => [x.year, x.std_rel.toFixed(4), x.log_se.toFixed(4)].join(':')).join(' '));
  console.log(' anova', JSON.stringify(r.anova_pos)); if (r.anova_bin) console.log(' anovaB', JSON.stringify(r.anova_bin));
  console.log(' step', JSON.stringify(r.stepwise.slice(-2)));
}
