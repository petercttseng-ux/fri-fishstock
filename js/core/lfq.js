/* =============================================================================
 * FRI-FishStock 網頁版：體長頻度分析
 * ELEFAN 資料重整與成長曲線計分依 TropFishR（Mildenberger et al. 2017，GPL-3）
 * 之 lfqRestructure、lfqFitCurves 演算法移植；遺傳演算法比照 R 套件 GA 之實數型預設運算子
 * （線性縮放選擇、局部算術交配、均勻隨機突變、菁英保留）。
 * 自然死亡率經驗式、體長轉換漁獲曲線依 TropFishR M_empirical、catchCurve。
 * 授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS = root.FS || {};
  const U = FS.util;
  const L = FS.lfq = {};

  // ---------------------------------------------------------------- 日期
  L.parseDate = function (v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {                        // Excel 序號
      if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return null;
    }
    const m = String(v).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  };
  L.yeardec = function (d) {
    const y = d.getUTCFullYear(), s = Date.UTC(y, 0, 1), e = Date.UTC(y + 1, 0, 1);
    return y + (d.getTime() - s) / (e - s);
  };
  L.fmtDate = d => d.toISOString().slice(0, 10);

  // ---------------------------------------------------------------- 建立 LFQ 物件（同 lfqCreate，aggregate_dates = TRUE）
  L.build = function (tab, dateCol, lenCol, freqCol, bin) {
    const rows = [];
    for (let i = 0; i < tab.n; i++) {
      const d = L.parseDate(tab.cols[dateCol][i]), len = Number(tab.cols[lenCol][i]);
      const f = freqCol ? Number(tab.cols[freqCol][i]) : 1;
      if (!d || !Number.isFinite(len) || len === 0 || !Number.isFinite(f)) continue;
      rows.push({ d: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)), len, f });
    }
    if (rows.length < 30) throw new Error('有效體長資料不足（少於 30 筆）。');
    rows.sort((a, b) => a.d - b.d);
    const minL = Math.min(...rows.map(r => r.len)), maxL = Math.max(...rows.map(r => r.len));
    const Lmin = Math.floor(minL / bin) * bin;
    const breaks = U.seq(Lmin, maxL + bin, bin);
    const mid = breaks.map(b => +(b + bin / 2).toFixed(10));
    const dates = U.unique(rows.map(r => r.d.getTime())).map(t => new Date(t));
    const catchM = breaks.map(() => new Array(dates.length).fill(0));
    rows.forEach(r => {
      const j = dates.findIndex(d => d.getTime() === r.d.getTime());
      let i = Math.floor((r.len - Lmin) / bin + 1e-9); if (i > breaks.length - 1) i = breaks.length - 1;
      catchM[i][j] += r.f;
    });
    return { dates, midLengths: mid, catch: catchM, bin, raw_n: U.sum(rows.map(r => r.f)), Lmax_obs: maxL };
  };
  L.sampleTable = lfq => lfq.dates.map((d, j) => ({ 採樣日期: L.fmtDate(d), 樣本數: U.sum(lfq.catch.map(r => r[j])) }));

  // ---------------------------------------------------------------- lfqRestructure
  L.restructure = function (lfq, MA, addlSqrt) {
    if (MA % 2 === 0) throw new Error('MA 須為奇數。');
    const nL = lfq.midLengths.length, nT = lfq.dates.length, pm = (MA - 1) / 2;
    const rc = Array.from({ length: nL }, () => new Float64Array(nT));
    for (let i = 0; i < nT; i++) {
      const col = lfq.catch.map(r => r[i]);
      const nzIdx = col.map((v, k) => v !== 0 ? k : -1).filter(k => k >= 0);
      if (!nzIdx.length) throw new Error(`第 ${i + 1} 個樣本（${L.fmtDate(lfq.dates[i])}）全為 0，請移除後再執行。`);
      const vf = nzIdx[0], vl = nzIdx[nzIdx.length - 1];
      const vs = col.slice(vf, vl + 1), n = vs.length;
      const AF = new Array(n), nz = new Array(n);
      for (let j = 0; j < n; j++) {
        const idx = []; for (let k = j - pm; k <= j + pm; k++) if (k >= 0 && k < n) idx.push(k);
        nz[j] = idx.filter(k => k !== j && vs[k] === 0).length + (MA - idx.length);
        const maj = U.sum(idx.map(k => vs[k])) / MA;
        AF[j] = vs[j] / maj;
        if (!Number.isFinite(AF[j])) AF[j] = 0;
      }
      const mprime = U.mean(AF);
      let Fs = AF.map(a => a / mprime - 1);
      Fs = Fs.map((v, j) => v > 0 ? v * Math.pow(0.5, nz[j]) : v);
      if (Fs[n - 1] < 0) Fs[n - 1] = 0;
      if (n >= 2 && Fs[n - 2] < 0) Fs[n - 2] = Fs[n - 2] * 0.5;
      let SPV = 0, SNV = 0; Fs.forEach(v => { if (v > 0) SPV += v; else if (v < 0) SNV += v; });
      Fs = Fs.map(v => (1 + v) < 1e-8 || !Number.isFinite(v) ? 0 : v);
      Fs = Fs.map(v => v < 0 ? v * (SPV / -SNV) : v);
      if (addlSqrt) Fs = Fs.map((v, j) => v > 0 ? v / Math.sqrt(1 + 2 / lfq.catch[vf + j][i]) : v);
      for (let j = 0; j < n; j++) rc[vf + j][i] = Fs[j];
    }
    // 波峰編號（peaks_mat）
    const peaks = Array.from({ length: nL }, () => new Float64Array(nT));
    let maxPeaks = 0; const runId = [];
    for (let i = 0; i < nT; i++) {
      let id = 0, prev = 0; const ids = new Array(nL);
      for (let l = 0; l < nL; l++) { const p = rc[l][i] > 0 ? 1 : 0; if (p === 1 && prev !== 1) id++; ids[l] = p ? id : 0; prev = p; }
      runId.push(ids); maxPeaks = Math.max(maxPeaks, id);
    }
    for (let i = 0; i < nT; i++) for (let l = 0; l < nL; l++) peaks[l][i] = runId[i][l] + (rc[l][i] > 0 ? 1 : 0) * maxPeaks * (i + 1);
    // ASP
    let ASP = 0;
    for (let i = 0; i < nT; i++) {
      let l = 0;
      while (l < nL) {
        if (rc[l][i] > 0) { let mx = 0; while (l < nL && rc[l][i] > 0) { mx = Math.max(mx, rc[l][i]); l++; } ASP += mx; }
        else l++;
      }
    }
    const t = lfq.dates.map(L.yeardec);
    return Object.assign({}, lfq, { rcounts: rc, peaks, ASP, MA, t });
  };

  const vbgf = (Linf, K, t0, t) => Linf * (1 - Math.exp(-K * (t - t0)));

  /** 成長曲線世代軌跡（同 lfqFitCurves 內部計算） */
  L.cohortTraces = function (lr, par, agemax) {
    const t = lr.t, tmax = Math.max(...t), tmin = Math.min(...t);
    if (agemax == null) agemax = Math.ceil((1 / -par.K) * Math.log(1 - (par.Linf * 0.95) / par.Linf));
    let ncoh = agemax + Math.ceil(tmax - tmin);
    const frac = ((par.t_anchor + 1e6) % 1);
    let tAs = []; for (let y = Math.floor(tmax - ncoh); y <= Math.floor(tmax); y++) tAs.push(y + frac);
    tAs = tAs.filter(v => v < tmax);
    const tt = t.concat([tmax + 0.2]);
    const pts = [];
    tAs.forEach((ta, ct) => tt.forEach(ti => { const ra = ti - ta; if (ra <= agemax && ra > 0) { const Lt = vbgf(par.Linf, par.K, ta, ti); if (Lt >= 0) pts.push({ t: ti, Lt, ct }); } }));
    return { pts, agemax, tAs };
  };

  /** ELEFAN 計分（lfqFitCurves，flagging.out = TRUE），回傳 Rn */
  L.score = function (lr, par) {
    const { pts } = L.cohortTraces(lr, par, null);
    const mid = lr.midLengths, nL = mid.length, nT = lr.t.length;
    const bw = []; for (let i = 0; i < nL - 1; i++) bw.push(mid[i + 1] - mid[i]);
    const lower = mid.map((m, i) => m - (i === 0 ? bw[0] : bw[i - 1]) / 2);
    const upper = mid.map((m, i) => m + (i < nL - 1 ? bw[i] : bw[nL - 2]) / 2);
    const hit = Array.from({ length: nL }, () => new Float64Array(nT));
    const tIndex = new Map(); lr.t.forEach((v, j) => tIndex.set(v, j));
    pts.forEach(p => {
      const j = tIndex.get(p.t); if (j === undefined) return;
      for (let l = 0; l < nL; l++) if (lower[l] <= p.Lt && upper[l] > p.Lt) hit[l][j] += 1;
    });
    // flagging.out：同一波峰被多條曲線命中時，只計最大值之格。
    // 為與 TropFishR 結果一致，完整重現其寫法：ch <- unique(peaks)；若含 0 則移除 ch 之「第一個」元素。
    const groups = new Map();
    for (let j = 0; j < nT; j++) for (let l = 0; l < nL; l++) {
      const c = lr.peaks[l][j];
      if (!groups.has(c)) groups.set(c, []); groups.get(c).push([l, j]);
    }
    const ch = Array.from(groups.keys());
    if (ch.includes(0)) groups.delete(ch[0]);
    groups.forEach(cells => {
      const s = U.sum(cells.map(([l, j]) => hit[l][j]));
      if (s > 1) { let best = cells[0]; cells.forEach(c => { if (lr.rcounts[c[0]][c[1]] > lr.rcounts[best[0]][best[1]]) best = c; }); cells.forEach(([l, j]) => hit[l][j] = 0); hit[best[0]][best[1]] = 1; }
    });
    let ESP = 0;
    for (let l = 0; l < nL; l++) for (let j = 0; j < nT; j++) ESP += lr.rcounts[l][j] * hit[l][j];
    return Math.pow(10, ESP / lr.ASP) / 10;
  };

  // ---------------------------------------------------------------- 遺傳演算法（GA 實數型預設）
  function ga(fitness, lower, upper, o, rng) {
    const pop = o.popSize, d = lower.length, pc = 0.8, pmut = 0.1, elit = Math.max(1, Math.round(pop * 0.05));
    let P = Array.from({ length: pop }, () => lower.map((lo, j) => lo + rng.unif() * (upper[j] - lo)));
    let Fit = P.map(fitness);
    let best = -Infinity, bestSol = null, noImp = 0;
    for (let it = 0; it < o.maxiter; it++) {
      const ord = Fit.map((f, i) => i).sort((a, b) => Fit[b] - Fit[a]);
      const PS = ord.map(i => P[i].slice()), FS_ = ord.map(i => Fit[i]);
      if (FS_[0] > best + 1e-12) { best = FS_[0]; bestSol = PS[0].slice(); noImp = 0; } else noImp++;
      if (noImp >= (o.run || o.maxiter)) break;
      if (it === o.maxiter - 1) break;
      // 線性縮放選擇（sfactor = 2）
      const fmin = Math.min(...Fit), fmax = Math.max(...Fit), fmean = U.mean(Fit), sf = 2;
      let a, b;
      if (fmin > (sf * fmean - fmax) / (sf - 1)) { const dl = fmax - fmean; a = (sf - 1) * fmean / dl; b = fmean * (fmax - sf * fmean) / dl; }
      else { const dl = fmean - fmin; a = fmean / dl; b = -fmin * fmean / dl; }
      let w = Fit.map(f => Math.abs(a * f + b)); if (!w.every(Number.isFinite) || U.sum(w) === 0) w = Fit.map(() => 1);
      const sw = U.sum(w), cum = []; w.reduce((s, v, i) => (cum[i] = s + v / sw), 0);
      const pick = () => { const u = rng.unif(); let i = 0; while (i < pop - 1 && cum[i] < u) i++; return i; };
      const sel = Array.from({ length: pop }, pick);
      P = sel.map(i => P[i].slice()); Fit = sel.map(i => Fit[i]);
      // 局部算術交配
      for (let i = 0; i + 1 < pop; i += 2) if (rng.unif() < pc) {
        const p1 = P[i], p2 = P[i + 1], c1 = [], c2 = [];
        for (let j = 0; j < d; j++) { const u = rng.unif(); c1.push(u * p1[j] + (1 - u) * p2[j]); c2.push(u * p2[j] + (1 - u) * p1[j]); }
        P[i] = c1; P[i + 1] = c2; Fit[i] = NaN; Fit[i + 1] = NaN;
      }
      // 均勻隨機突變
      for (let i = 0; i < pop; i++) if (rng.unif() < pmut) { const j = Math.floor(rng.unif() * d); P[i][j] = lower[j] + rng.unif() * (upper[j] - lower[j]); Fit[i] = NaN; }
      Fit = Fit.map((f, i) => Number.isFinite(f) ? f : fitness(P[i]));
      // 菁英保留：以前一代最佳之不重複個體取代最差者
      const worst = Fit.map((f, i) => i).sort((x, y) => Fit[x] - Fit[y]);
      const seen = new Set(), uniq = [];
      for (let k = 0; k < PS.length && uniq.length < elit; k++) { const key = PS[k].join(','); if (!seen.has(key)) { seen.add(key); uniq.push(k); } }
      uniq.forEach((k, e) => { P[worst[e]] = PS[k].slice(); Fit[worst[e]] = FS_[k]; });
    }
    const ib = U.argmax(Fit);
    if (Fit[ib] > best) { best = Fit[ib]; bestSol = P[ib]; }
    return { par: bestSol, value: best };
  }

  /** ELEFAN_GA（非季節性 VBGF） */
  L.elefan = function (lfq, o) {
    const rng = U.rng(o.seed || 1);
    const lr = L.restructure(lfq, o.MA, false);
    const lo = [o.Linf_range[0], o.K_range[0], o.ta_range ? o.ta_range[0] : 0];
    const up = [o.Linf_range[1], o.K_range[1], o.ta_range ? o.ta_range[1] : 1];
    const g = ga(x => L.score(lr, { Linf: x[0], K: x[1], t_anchor: x[2] }), lo, up, { popSize: o.popSize, maxiter: o.maxiter, run: o.maxiter }, rng);
    const par = { Linf: g.par[0], K: g.par[1], t_anchor: g.par[2] };
    const near = (x, r) => (x - r[0]) / (r[1] - r[0]) < 0.05 || (r[1] - x) / (r[1] - r[0]) < 0.05;
    return { par, Rn_max: g.value, phiL: Math.log10(par.K) + 2 * Math.log10(par.Linf),
             boundary_flag: { Linf: near(par.Linf, o.Linf_range), K: near(par.K, o.K_range) },
             settings: { MA: o.MA, Linf_range: o.Linf_range, K_range: o.K_range, ta_range: [lo[2], up[2]] } };
  };

  /** Bootstrap：各樣本內以多項分布重抽個體後重新執行 ELEFAN（Schwamborn et al. 2019 概念之簡化） */
  L.bootstrap = function (lfq, o, progress) {
    const rng = U.rng(o.seed || 1), draws = [];
    for (let b = 0; b < o.nboot; b++) {
      const lb = Object.assign({}, lfq);
      const nT = lfq.dates.length, nL = lfq.midLengths.length;
      lb.catch = Array.from({ length: nL }, () => new Array(nT).fill(0));
      for (let j = 0; j < nT; j++) {
        const col = lfq.catch.map(r => r[j]), n = U.sum(col);
        const s = n > 0 ? rng.multinom(Math.round(n), col.map(v => v / n)) : col;
        s.forEach((v, l) => lb.catch[l][j] = v);
      }
      try {
        const r = L.elefan(lb, Object.assign({}, o, { seed: (o.seed || 1) + b + 1 }));
        draws.push({ Linf: r.par.Linf, K: r.par.K, t_anchor: r.par.t_anchor, phiL: r.phiL });
      } catch (e) { /* 略過失敗之重抽樣 */ }
      if (progress) progress((b + 1) / o.nboot);
    }
    const nm = [['L∞', 'Linf'], ['K', 'K'], ['t_anchor', 't_anchor'], ["φ'", 'phiL']];
    const summary = nm.map(([lab, k]) => { const v = draws.map(d => d[k]); return { 參數: lab, 中位數: U.round(U.median(v), 3), '2.5%': U.round(U.quantile(v, 0.025), 3), '97.5%': U.round(U.quantile(v, 0.975), 3) }; });
    return { draws, summary };
  };

  // ---------------------------------------------------------------- 自然死亡率（TropFishR M_empirical）
  L.mEmpirical = function (Linf, K, temp, tmax, schooling) {
    const rows = [{ 方法: 'Then et al. (2015) 成長參數式', M: U.round(4.118 * Math.pow(K, 0.73) * Math.pow(Linf, -0.33), 3) }];
    if (Number.isFinite(temp)) {
      let m = U.round(Math.pow(10, -0.0066 - 0.279 * Math.log10(Linf) + 0.6543 * Math.log10(K) + 0.4634 * Math.log10(temp)), 3);
      if (schooling) m = 0.8 * m;
      rows.push({ 方法: 'Pauly (1980) 式' + (schooling ? '（群游性 ×0.8）' : ''), M: U.round(m, 3) });
    }
    if (Number.isFinite(tmax) && tmax > 0) rows.push({ 方法: 'Then et al. (2015) 最大年齡式', M: U.round(4.899 * Math.pow(tmax, -0.916), 3) });
    return rows;
  };

  // ---------------------------------------------------------------- 體長轉換漁獲曲線（catchCurve，t0 = 0）
  L.catchCurve = function (lfq, Linf, K, M, regInt) {
    let mid = lfq.midLengths.slice(), C = lfq.catch.map(r => U.sum(r));
    const ok = mid.map(m => m < 0.95 * Linf);
    mid = mid.filter((_, i) => ok[i]); C = C.filter((_, i) => ok[i]);
    const n = mid.length; if (n < 4) throw new Error('可用於漁獲曲線之體長組太少（體長多接近 L∞），請檢查成長參數。');
    const interval = mid[1] - mid[0];
    const lower = mid.map(m => m - interval / 2);
    const tL1 = lower.map(Lw => -Math.log(1 - Lw / Linf) / K);
    const dt = mid.map((_, i) => i < n - 1 ? tL1[i + 1] - tL1[i] : NaN);
    const t = mid.map(m => -Math.log(1 - m / Linf) / K);
    const y = C.map((c, i) => { const v = Math.log(c / dt[i]); return v === -Infinity ? NaN : v; });
    if (!regInt) {
      const pk = U.argmax(C); const last = C.reduce((m, v, i) => v > 0 ? i : m, 0);
      regInt = [Math.min(pk + 1, last - 2), last];          // 0 起算
    }
    const xs = [], ys = [];
    for (let i = regInt[0]; i <= regInt[1]; i++) if (Number.isFinite(y[i]) && Number.isFinite(t[i])) { xs.push(t[i]); ys.push(y[i]); }
    if (xs.length < 3) throw new Error('漁獲曲線迴歸區間之有效點數不足 3 點，請手動指定區間。');
    const f = U.simpleLm(xs, ys);
    const Z = Math.abs(f.b), se = Math.abs(f.se);
    // 選擇性曲線（ogive）
    let L50 = NaN;
    if (regInt[0] >= 2) {
      const to = [], lo = [];
      for (let i = 0; i < regInt[0]; i++) {
        const S = C[i] / (dt[i] * Math.exp(f.a - Z * t[i]));
        const v = Math.log(1 / S - 1);
        if (Number.isFinite(v) && Number.isFinite(t[i])) { to.push(t[i]); lo.push(v); }
      }
      if (to.length >= 2) { const g = U.simpleLm(to, lo); const T1 = g.a, T2 = Math.abs(g.b); const t50 = T1 / T2; L50 = Linf * (1 - Math.exp(-K * t50)); }
    }
    const Fm = Z - M;
    return { Z, se, M, F: Fm, E: Fm / Z, L50: Number.isFinite(L50) ? L50 : NaN, reg_int: regInt, t, y, a: f.a, b: f.b, mid };
  };

  // ---------------------------------------------------------------- 體長指標（Froese 2004）
  L.indicators = function (lfq, Linf, K, M, Lm50) {
    const Lopt = Linf * 3 / (3 + M / K);
    const tot = lfq.catch.map(r => U.sum(r)), mid = lfq.midLengths, N = U.sum(tot);
    const mean = U.sum(mid.map((m, i) => m * tot[i])) / N;
    let cum = 0, med = NaN; const half = N / 2;
    // 中位數（同 R median(rep(mid, n))）
    const arr = []; mid.forEach((m, i) => { if (tot[i] > 0) arr.push([m, tot[i]]); });
    const kth = k => { let c = 0; for (const [m, w] of arr) { c += w; if (c >= k) return m; } return arr[arr.length - 1][0]; };
    med = N % 2 ? kth((N + 1) / 2) : (kth(N / 2) + kth(N / 2 + 1)) / 2;
    const frac = cond => U.sum(mid.map((m, i) => cond(m) ? tot[i] : 0)) / N;
    const popt = frac(m => m >= 0.9 * Lopt && m <= 1.1 * Lopt), pmega = frac(m => m > 1.1 * Lopt);
    const pmat = Number.isFinite(Lm50) ? frac(m => m >= Lm50) : NaN;
    const table = [
      { 指標: '理論最佳漁獲體長 Lopt', 數值: Lopt.toFixed(1), 參考: 'Beverton (1992)' },
      { 指標: '漁獲平均體長', 數值: mean.toFixed(1), 參考: '' },
      { 指標: '漁獲中位體長', 數值: med.toFixed(1), 參考: '' },
      { 指標: 'P_opt：Lopt ±10% 之比例', 數值: (100 * popt).toFixed(1) + '%', 參考: '目標 100%（Froese 2004）' },
      { 指標: 'P_mega：> 1.1 Lopt 大型魚比例', 數值: (100 * pmega).toFixed(1) + '%', 參考: '目標 30–40%' },
      { 指標: 'P_mat：≥ Lm50 已成熟比例', 數值: Number.isFinite(pmat) ? (100 * pmat).toFixed(1) + '%' : '（未輸入 Lm50）', 參考: '目標 100%' }];
    return { Lopt, popt, pmega, pmat, table };
  };
})(typeof self !== 'undefined' ? self : globalThis);
