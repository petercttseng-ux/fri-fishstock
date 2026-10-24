/* =============================================================================
 * FRI-FishStock 網頁版：CMSY（僅需漁獲量之蒙地卡羅法）
 * 由 R 版 calc_cmsy.R 移植；方法依 Froese et al. (2017) Fish Fish. 18:506–526。
 * 注意：此為 CMSY 核心演算法之簡化實作，非 CMSY++ 官方程式碼。授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS = root.FS || {};
  const U = FS.util;

  FS.cmsyRRange = function (res) {
    return { '高': [0.6, 1.5], '中': [0.2, 0.8], '低': [0.05, 0.5], '極低': [0.015, 0.1] }[res] || [0.2, 0.8];
  };

  /** R ksmooth(kernel = "normal", bandwidth = bw)：四分位數位於 ±0.25 bw */
  function ksmooth(x, y, bw) {
    const s = 0.25 * bw / 0.6744897501960817;
    return x.map(x0 => { let sw = 0, sy = 0; for (let i = 0; i < x.length; i++) { const z = (x[i] - x0) / s; if (Math.abs(z) > 4) continue; const w = Math.exp(-0.5 * z * z); sw += w; sy += w * y[i]; } return sy / sw; });
  }

  FS.cmsyBkDefault = function (year, catch_, rr) {
    const ct = ksmooth(year, catch_, 3), maxc = U.max(ct), ct3 = U.mean(ct.slice(0, 3));
    let start = year[0] < 1960 ? [0.5, 0.9] : (ct3 < 0.33 * maxc ? [0.5, 0.9] : [0.2, 0.6]);
    if (year[0] >= 1980 && rr[1] > 0.3 && ct3 < 0.33 * maxc) start = [0.2, 0.6];
    const endr = ct[ct.length - 1] / maxc;
    const end = endr > 0.8 ? [0.4, 0.8] : endr > 0.5 ? [0.2, 0.6] : [0.01, 0.4];
    return { start, end };
  };

  /**
   * @param o { year, catch, r_range, k_range, bk_start, bk_end, bk_int, bk_int_year, n, sigR, seed }
   */
  FS.cmsyRun = function (o) {
    const rng = U.rng(o.seed || 42), n = o.n || 20000, sigR = o.sigR || 0.1;
    const year = [], C = [];
    o.year.forEach((y, i) => { if (Number.isFinite(o.catch[i])) { year.push(y); C.push(o.catch[i]); } });
    const ny = year.length;
    if (ny < 10) throw new Error('漁獲量時間序列太短（少於 10 年）。');
    const maxc = U.max(C), rr = o.r_range;
    let kr = o.k_range;
    if (!kr) { kr = [maxc / rr[1], 4 * maxc / rr[0]]; if (o.bk_end[1] <= 0.5) kr[0] = Math.max(kr[0], 2 * maxc / rr[1]); }
    const r = new Float64Array(n), k = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = Math.exp(Math.log(rr[0]) + rng.unif() * (Math.log(rr[1]) - Math.log(rr[0])));
    for (let i = 0; i < n; i++) k[i] = Math.exp(Math.log(kr[0]) + rng.unif() * (Math.log(kr[1]) - Math.log(kr[0])));
    const b = Array.from({ length: n }, () => new Float64Array(ny + 1).fill(NaN));
    for (let i = 0; i < n; i++) b[i][0] = k[i] * (o.bk_start[0] + rng.unif() * (o.bk_start[1] - o.bk_start[0]));
    const alive = new Uint8Array(n).fill(1);
    const intI = (o.bk_int && o.bk_int_year != null) ? year.indexOf(o.bk_int_year) : -1;
    for (let t = 0; t < ny; t++) {
      for (let i = 0; i < n; i++) {
        const e = rng.norm() * sigR;           // 與 R 相同：每年對全部組合抽一次
        if (!alive[i]) continue;
        const bt = b[i][t], rel = bt / k[i], rr2 = rel < 0.25 ? r[i] * 4 * rel : r[i];
        const nb = (bt + rr2 * bt * (1 - rel) - C[t]) * Math.exp(e);
        let ok = Number.isFinite(nb) && nb > 0.005 * k[i] && nb / k[i] < 1.1;
        if (ok && intI >= 0 && t + 1 === intI) { const ri = nb / k[i]; ok = ri >= o.bk_int[0] && ri <= o.bk_int[1]; }
        if (!ok) { alive[i] = 0; continue; }
        b[i][t + 1] = nb;
      }
    }
    const viable = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const re = b[i][ny - 1] / k[i]; viable[i] = alive[i] && re >= o.bk_end[0] && re <= o.bk_end[1] ? 1 : 0; }
    const vi = []; for (let i = 0; i < n; i++) if (viable[i]) vi.push(i);
    const nv = vi.length;
    if (nv < 10) throw new Error(`可行 r–k 組合僅 ${nv} 組，請放寬 r、k 或 B/k 先驗範圍。`);
    const rmed = U.median(vi.map(i => r[i]));
    const sel = vi.filter(i => r[i] >= rmed);
    const rs = sel.map(i => r[i]), ks = sel.map(i => k[i]);
    const msy = sel.map(i => r[i] * k[i] / 4), Bmsy = ks.map(v => v / 2), Fmsy = rs.map(v => v / 2);
    const BB = sel.map((i, s) => Array.from({ length: ny }, (_, t) => b[i][t] / Bmsy[s]));
    const FF = sel.map((i, s) => Array.from({ length: ny }, (_, t) => (C[t] / b[i][t]) / Fmsy[s]));
    const q = (M) => Array.from({ length: ny }, (_, t) => { const col = M.map(row => row[t]); return [year[t]].concat(U.q3(col)); });
    const last = (M) => M.map(row => row[ny - 1]);
    const est = [['r', rs], ['k', ks], ['MSY', msy], ['Bmsy', Bmsy], ['Fmsy', Fmsy],
                 [`B/Bmsy（${year[ny - 1]}）`, last(BB)], [`F/Fmsy（${year[ny - 1]}）`, last(FF)]]
      .map(([nm, v]) => ({ 參數: nm, 中位數: U.signif(U.median(v), 4), '2.5%': U.signif(U.quantile(v, 0.025), 4), '97.5%': U.signif(U.quantile(v, 0.975), 4) }));
    // r–k 散布圖用（抽樣顯示最多 4000 點）
    const step = Math.max(1, Math.floor(n / 4000)), allIdx = []; for (let i = 0; i < n; i += step) allIdx.push(i);
    return { year, catch: C, n_draw: n, n_viable: nv, est,
             rk_all: { r: allIdx.map(i => r[i]), k: allIdx.map(i => k[i]) },
             rk_viable: { r: vi.map(i => r[i]), k: vi.map(i => k[i]) }, sel_r: rs, sel_k: ks,
             BBmsy: q(BB), FFmsy: q(FF), BB_last: last(BB), FF_last: last(FF),
             priors: { r: rr, k: kr, start: o.bk_start, end: o.bk_end, int: o.bk_int || null, int_year: o.bk_int_year ?? null } };
  };
})(typeof self !== 'undefined' ? self : globalThis);
