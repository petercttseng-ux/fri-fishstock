/* =============================================================================
 * FRI-FishStock 網頁版：CPUE 標準化（對數常態 GLM／Delta-對數常態 GLM）
 * 由 R 版 calc_cpue.R 移植。授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS = root.FS || {};
  const U = FS.util;

  /** 建立設計矩陣（處理對比：第一水準為基準，同 R 預設） */
  function design(d, spec, levels) {
    const { year, factors, covars, interact } = spec;
    const n = d[year].length;
    const lv = levels || {};
    const facs = [year].concat(factors);
    if (!levels) {
      facs.forEach(f => {
        const u = U.unique(d[f].map(v => String(v)));
        lv[f] = f === year ? u.map(Number).sort((a, b) => a - b).map(String) : u.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      });
    }
    const cols = [{ name: '(Intercept)', term: '(Intercept)', f: () => 1 }];
    facs.forEach(f => lv[f].slice(1).forEach(l => cols.push({ name: f + l, term: f, f: i => String(d[f][i]) === l ? 1 : 0 })));
    covars.forEach(c => cols.push({ name: c, term: c, f: i => d[c][i] }));
    const terms = [year].concat(factors, covars);
    if (interact && interact.length === 2 && interact.every(x => factors.includes(x))) {
      const [a, b] = interact; const tn = a + '×' + b;
      lv[a].slice(1).forEach(la => lv[b].slice(1).forEach(lb =>
        cols.push({ name: a + la + ':' + b + lb, term: tn, f: i => (String(d[a][i]) === la && String(d[b][i]) === lb) ? 1 : 0 })));
      terms.push(tn);
    }
    const X = new Array(n);
    for (let i = 0; i < n; i++) { const r = new Float64Array(cols.length); for (let j = 0; j < cols.length; j++) r[j] = cols[j].f(i); X[i] = r; }
    return { X, cols, terms, levels: lv, interactTerm: interact && interact.length === 2 ? interact[0] + '×' + interact[1] : null };
  }

  function subsetCols(X, keepIdx) { return X.map(r => { const o = new Float64Array(keepIdx.length); keepIdx.forEach((j, k) => o[k] = r[j]); return o; }); }

  /** 逐項移除檢定（同 R drop1；交互作用存在時，其主效應不列入） */
  function drop1(dm, y, type, full) {
    const out = [];
    const marginal = new Set();
    if (dm.interactTerm) dm.interactTerm.split('×').forEach(t => marginal.add(t));
    dm.terms.forEach(t => {
      if (marginal.has(t)) return;
      const idx = dm.cols.map((c, j) => c.term === t ? -1 : j).filter(j => j >= 0);
      const Xs = subsetCols(dm.X, idx);
      if (type === 'F') {
        const m = U.lm(Xs, y), dfT = full.rank - m.rank, ss = m.rss - full.rss;
        const F = (ss / dfT) / (full.rss / full.df);
        out.push({ 變數: t, 自由度: dfT, 平方和: U.round(ss, 2), F值: U.round(F, 2), p值: U.signif(U.pf_upper(F, dfT, full.df), 3) });
      } else {
        const m = U.glmBinom(Xs, y), dfT = full.rank - m.rank, lrt = m.deviance - full.deviance;
        out.push({ 變數: t, 自由度: dfT, 偏差減少: U.round(lrt, 2), p值: U.signif(U.pchisq_upper(lrt, dfT), 3) });
      }
    });
    return out;
  }

  function formula(resp, spec) {
    const t = ['factor(' + spec.year + ')'].concat(spec.factors.map(f => 'factor(' + f + ')'), spec.covars);
    if (spec.interact && spec.interact.length === 2) t.push('factor(' + spec.interact[0] + '):factor(' + spec.interact[1] + ')');
    return resp + ' ~ ' + t.join(' + ');
  }

  /** 預測用資料：逐年，類別因子取最常見水準，連續變數取平均 */
  function newdataRows(d, spec, years) {
    const mode = {};
    spec.factors.forEach(f => {
      const tab = {}; d[f].forEach(v => tab[String(v)] = (tab[String(v)] || 0) + 1);
      const keys = Object.keys(tab).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      let best = keys[0]; keys.forEach(k => { if (tab[k] > tab[best]) best = k; }); mode[f] = best;
    });
    const mcov = {}; spec.covars.forEach(c => mcov[c] = U.mean(d[c]));
    const nd = {}; nd[spec.year] = years.map(String);
    spec.factors.forEach(f => nd[f] = years.map(() => mode[f]));
    spec.covars.forEach(c => nd[c] = years.map(() => mcov[c]));
    return nd;
  }

  function simPred(rng, model, dmFit, nd, spec, nsim) {
    const dn = design(nd, spec, dmFit.levels);
    const keep = model.keep, b = keep.map(j => model.coef[j]);
    const B = U.mvrnorm(rng, b, model.vcov, nsim);
    return dn.X.map(r => B.map(bb => { let s = 0; for (let k = 0; k < keep.length; k++) s += r[keep[k]] * bb[k]; return s; }));  // 年 × nsim
  }

  function stepwise(d, spec, method, lc) {
    const rows = []; const fac = [], cov = [];
    const run = (sp) => { const dm = design(d, sp); return U.lm(dm.X, lc); };
    let m = run({ year: spec.year, factors: [], covars: [], interact: [] });
    rows.push({ 模型: '年別', AIC: m.aic, R2: m.r2 });
    spec.factors.concat(spec.covars).forEach(v => {
      if (spec.factors.includes(v)) fac.push(v); else cov.push(v);
      m = run({ year: spec.year, factors: fac.slice(), covars: cov.slice(), interact: [] });
      rows.push({ 模型: '+ ' + v, AIC: m.aic, R2: m.r2 });
    });
    if (spec.interact && spec.interact.length === 2) {
      m = run({ year: spec.year, factors: fac.slice(), covars: cov.slice(), interact: spec.interact });
      rows.push({ 模型: '+ ' + spec.interact.join('×'), AIC: m.aic, R2: m.r2 });
    }
    return rows.map((r, i) => ({ 模型: r.模型, AIC: U.round(r.AIC, 1), 'R²': U.round(r.R2, 4), 'R² 增量': i ? U.round(r.R2 - rows[i - 1].R2, 4) : null }));
  }

  /**
   * CPUE 標準化主函數
   * @param tab  資料表（util.parseCSV 之結果）
   * @param o    { year, cpue, catchCol, effortCol, factors, covars, interact, method, nsim, seed }
   */
  FS.cpueStandardize = function (tab, o) {
    const rng = U.rng(o.seed || 123);
    const spec = { year: o.year, factors: (o.factors || []).filter(f => f !== o.year), covars: o.covars || [], interact: o.interact || [] };
    const need = U.unique([spec.year].concat(spec.factors, spec.covars));
    const C = tab.cols, N = tab.n;
    const d = {}; need.forEach(k => d[k] = []); d['.cpue'] = [];
    for (let i = 0; i < N; i++) {
      const cp = o.cpue ? C[o.cpue][i] : (C[o.catchCol][i] / C[o.effortCol][i]);
      if (cp === null || !Number.isFinite(cp) || cp < 0) continue;
      if (need.some(k => C[k][i] === null || C[k][i] === undefined || (spec.covars.includes(k) && !Number.isFinite(C[k][i])))) continue;
      need.forEach(k => d[k].push(spec.factors.includes(k) ? String(C[k][i]) : C[k][i]));
      d['.cpue'].push(cp);
    }
    d[spec.year] = d[spec.year].map(Number);
    const n = d['.cpue'].length;
    if (n < 10) throw new Error('有效資料筆數不足（少於 10 筆）。');
    const cpue = d['.cpue'];
    const zero = cpue.filter(v => v === 0).length / n;
    const years = U.unique(d[spec.year]).sort((a, b) => a - b);
    const nomMap = {}; years.forEach(y => nomMap[y] = []); for (let i = 0; i < n; i++) nomMap[d[spec.year][i]].push(cpue[i]);
    const out = { method: o.method, zero_rate: zero, n, year_col: spec.year, factors: spec.factors, covars: spec.covars, nsim: o.nsim };
    const nd = newdataRows(d, spec, years);
    let idxSim;
    if (o.method === 'lognormal') {
      let cst = 0, lc;
      if (zero > 0) {
        cst = 0.1 * U.mean(cpue.filter(v => v > 0)); lc = cpue.map(v => Math.log(v + cst));
        out.note = `資料含 ${(100 * zero).toFixed(1)}% 零值，已加常數 ${U.signif(cst, 4)}（正值平均之 10%）後取對數；零值比例高時建議改用 Delta 模型。`;
      } else { lc = cpue.map(Math.log); out.note = '資料無零值，直接取對數。'; }
      const dm = design(d, spec); const m = U.lm(dm.X, lc);
      const sim = simPred(rng, m, dm, nd, spec, o.nsim);
      idxSim = sim.map(r => r.map(v => Math.exp(v + m.s2 / 2) - cst));
      out.formula = [formula('log(CPUE)', spec)];
      out.anova_pos = drop1(dm, lc, 'F', m);
      out.fit_stats = [{ 項目: '樣本數', 數值: n }, { 項目: '調整後 R²', 數值: U.round(m.adjr2, 3) }, { 項目: 'AIC', 數值: U.round(m.aic, 1) },
                       { 項目: 'BIC', 數值: U.round(m.bic, 1) }, { 項目: '殘差標準差', 數值: U.round(m.sigma, 3) }];
      out.resid = { fitted: Array.from(m.fitted), resid: Array.from(m.resid) };
      out.stepwise = stepwise(d, spec, 'lognormal', lc);
    } else {
      if (zero === 0) throw new Error('資料沒有零值，不需使用 Delta 模型，請改用對數常態 GLM。');
      const pa = cpue.map(v => v > 0 ? 1 : 0);
      const dmB = design(d, spec); const mb = U.glmBinom(dmB.X, pa);
      const dp = {}; Object.keys(d).forEach(k => dp[k] = d[k].filter((_, i) => cpue[i] > 0));
      const lcp = dp['.cpue'].map(Math.log);
      const yp = U.unique(dp[spec.year]); if (yp.length < years.length) throw new Error('部分年份沒有正值 CPUE，無法以 Delta 模型估計，請合併年份或改用對數常態 GLM。');
      const dmP = design(dp, spec, null); const mp = U.lm(dmP.X, lcp);
      const sb = simPred(rng, mb, dmB, nd, spec, o.nsim), sp = simPred(rng, mp, dmP, nd, spec, o.nsim);
      idxSim = sb.map((r, i) => r.map((v, s) => (1 / (1 + Math.exp(-v))) * Math.exp(sp[i][s] + mp.s2 / 2)));
      out.formula = [formula('出現與否', spec), formula('log(CPUE)', spec)];
      out.anova_bin = drop1(dmB, pa, 'Chisq', mb);
      out.anova_pos = drop1(dmP, lcp, 'F', mp);
      out.note = `零值比例 ${(100 * zero).toFixed(1)}%：第一步以二項 GLM 估計出現機率，第二步以對數常態 GLM 估計正值 CPUE，兩者相乘為標準化指標。`;
      out.fit_stats = [{ 項目: '總樣本數', 數值: n }, { 項目: '正值樣本數', 數值: lcp.length }, { 項目: '零值比例', 數值: (100 * zero).toFixed(1) + '%' },
                       { 項目: '二項模型 AIC', 數值: U.round(mb.aic, 1) }, { 項目: '正值模型 調整後 R²', 數值: U.round(mp.adjr2, 3) },
                       { 項目: '正值模型 AIC', 數值: U.round(mp.aic, 1) }, { 項目: '正值模型 BIC', 數值: U.round(mp.bic, 1) }];
      out.resid = { fitted: Array.from(mp.fitted), resid: Array.from(mp.resid) };
      out.stepwise = stepwise(dp, spec, 'delta', lcp);
    }
    const idx = years.map((y, i) => {
      const s = idxSim[i];
      return { year: y, std: U.median(s), lci: U.quantile(s, 0.025), uci: U.quantile(s, 0.975),
               log_se: U.sd(s.map(v => Math.log(Math.max(v, 1e-12)))), nominal: U.mean(nomMap[y]) };
    });
    const sc = U.mean(idx.map(r => r.std)), sn = U.mean(idx.map(r => r.nominal));
    idx.forEach(r => { r.std_rel = r.std / sc; r.lci_rel = r.lci / sc; r.uci_rel = r.uci / sc; r.nominal_rel = r.nominal / sn; });
    out.index = idx;
    return out;
  };
})(typeof self !== 'undefined' ? self : globalThis);
