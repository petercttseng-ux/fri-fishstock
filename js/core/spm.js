/* =============================================================================
 * FRI-FishStock 網頁版：貝氏狀態空間剩餘生產量模型
 *
 * 模型結構、先驗分布、懲罰項與診斷統計依 JABBA（Winker, Carvalho & Kapur 2018,
 * Fisheries Research 204:275–288；EUPL）之公開模型規格以 JavaScript 重新實作：
 *   P[1] ~ LN(log ψ, σ²)；P[t] ~ LN(log(max(P + r/(m−1)·P·(1−P^(m−1)) − C/K, 0.001)), σ²)
 *   I[t,i] ~ LN(log(q_i·P[t]·K), SE²[t,i] + τ²_i)
 *   K ~ LN(log K̄, sd_K)、r ~ LN、ψ ~ LN、1/σ² ~ Γ(4, 0.01)、1/τ² ~ Γ(0.001, 0.001)、q 均勻
 *   軟懲罰：P ∉ [0.02, 1.3]、σ > 0.2、τ > 1（同 JABBA 預設）
 * JABBA 以 JAGS 抽樣；瀏覽器無法執行 JAGS，本程式改以 Metropolis-within-Gibbs 抽樣
 * （K、r、ψ、σ² 適應性區塊更新；過程偏差非中心化逐項更新；指標尺度參數以 Gibbs 精確抽樣）。
 * 本程式「不是」JABBA 原套件，估計結果與 R 版 JABBA 可能略有差異。
 * 診斷：Geweke、Heidelberger–Welch（依 coda 演算法）、Gelman–Rubin R̂、runs test（同 JABBA
 * jbruns_sig3）、RMSE／SDNR（同 JABBA）、回溯 Mohn's ρ、MASE（同 JABBA jbmase 之概念）。
 * 授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS = root.FS || {};
  const U = FS.util;
  const S = FS.spm = {};

  // ---------------------------------------------------------------- 資料與先驗
  S.shapeFor = function (model) {
    if (model === 'Schaefer') return 2;
    if (model === 'Fox') return 1.001;
    // Pella-Tomlinson：BmsyK = 0.4（JABBA 預設），於 0.1–10 以 0.001 間距搜尋
    let best = 0.1, bv = Infinity;
    for (let s = 0.1; s <= 10.0000001; s += 0.001) { if (Math.abs(s - 1) < 1e-9) continue; const v = Math.pow(Math.pow(s, -1 / (s - 1)) - 0.4, 2); if (v < bv) { bv = v; best = s; } }
    return Math.round(best * 1000) / 1000;
  };

  /**
   * @param o { years, catch, indices: {name: [..]}, se: {name: [..]} | null, model,
   *            rDist: 'range'|'lnorm', rPrior: [a,b], kPrior: [mean, CV] | null, psiPrior: [mean, CV] }
   */
  S.prepare = function (o) {
    const N = o.years.length, names = Object.keys(o.indices), nI = names.length;
    if (N < 5) throw new Error('時間序列太短。');
    if (!nI) throw new Error('請至少選擇一個豐度指標。');
    const C = o.catch.map(Number);
    if (C.some(v => !Number.isFinite(v) || v < 0)) throw new Error('漁獲量含缺值或負值，JABBA 架構需完整之年漁獲量。');
    const I = names.map(nm => o.indices[nm].map(v => (v === null || !(v > 0)) ? NaN : v));
    const hasSE = !!o.se;
    const fixed = hasSE ? 0.001 : 0.1;
    const SE2 = names.map((nm, i) => o.years.map((_, t) => {
      if (!hasSE) return fixed * fixed;
      const s = o.se[nm] ? o.se[nm][t] : null;
      return Math.pow(Number.isFinite(s) && s !== null ? s : 0.3, 2) + fixed * fixed;
    }));
    I.forEach((col, i) => { if (col.filter(Number.isFinite).length < 3) throw new Error(`指標「${names[i]}」有效觀測值少於 3 筆。`); });
    const maxC = Math.max(...C);
    let lr, sdr;
    if (o.rDist === 'range') { lr = (Math.log(o.rPrior[0]) + Math.log(o.rPrior[1])) / 2; sdr = Math.abs(lr - Math.log(o.rPrior[0])) / 2; }
    else { lr = Math.log(o.rPrior[0]); sdr = o.rPrior[1]; }
    const kp = o.kPrior && Number.isFinite(o.kPrior[0]) ? o.kPrior : [8 * maxC, 1];
    const lK = Math.log(kp[0]), sdK = Math.sqrt(Math.log(kp[1] * kp[1] + 1));
    const psi = o.psiPrior || [0.9, 0.25];
    return { years: o.years.slice(), N, C, I, SE2, names, nI, m: S.shapeFor(o.model || 'Schaefer'), model: o.model || 'Schaefer',
             prior: { lK, sdK, lr, sdr, lpsi: Math.log(psi[0]), sdpsi: Math.sqrt(Math.log(psi[1] * psi[1] + 1)),
                      Kmean: kp[0], Kcv: kp[1], rRaw: o.rPrior, rDist: o.rDist, psiRaw: psi, igamma: [4, 0.01], tgamma: [0.001, 0.001] },
             hasSE };
  };

  // ---------------------------------------------------------------- MCMC
  const PEN = 500;          // = 0.5 × 精度 1000（JABBA 之軟懲罰）

  function runChain(D, mc, seed, init, onProgress) {
    const rng = U.rng(seed), N = D.N, nI = D.nI, m = D.m, pr = D.prior, C = D.C;
    const obs = D.I.map(col => col.map(v => Number.isFinite(v) ? Math.log(v) : NaN));
    // 各年之觀測清單（指標序號）
    const obsAt = []; for (let t = 0; t < N; t++) { const l = []; for (let i = 0; i < nI; i++) if (obs[i][t] === obs[i][t]) l.push(i); obsAt.push(l); }
    let lK = init.lK, lr = init.lr, lpsi = init.lpsi, ls2 = init.ls2;
    const z = new Float64Array(N); for (let t = 0; t < N; t++) z[t] = init.z ? init.z[t] : 0;
    const a = new Float64Array(nI);                    // a_i = log(q_i K)
    const lt2 = new Float64Array(nI).fill(Math.log(0.01));
    const iv = D.I.map(() => new Float64Array(N)), hlv = D.I.map(() => new Float64Array(N));
    const setVar = i => { const t2 = Math.exp(lt2[i]); for (let t = 0; t < N; t++) { const v = D.SE2[i][t] + t2; iv[i][t] = 1 / v; hlv[i][t] = 0.5 * Math.log(v); } };
    for (let i = 0; i < nI; i++) setVar(i);
    const P = new Float64Array(N), lP = new Float64Array(N), Pn = new Float64Array(N), lPn = new Float64Array(N);
    const rm1 = 1 / (m - 1), schaefer = Math.abs(m - 2) < 1e-12;
    // 由第 from 年起計算資源量軌跡（Pout[from−1] 須已就緒）
    function path(from, K, r, sig, lpsiV, Pout, lPout) {
      const iK = 1 / K;
      for (let t = from; t < N; t++) {
        let mu;
        if (t === 0) mu = lpsiV;
        else {
          const p = Pout[t - 1];
          const g = schaefer ? r * p * (1 - p) : r * rm1 * p * (1 - Math.pow(p, m - 1));
          mu = Math.log(Math.max(p + g - C[t - 1] * iK, 0.001));
        }
        const l = mu + sig * z[t]; lPout[t] = l; Pout[t] = Math.exp(l);
      }
    }
    function llAt(lPv, Pv, t) {
      let s = 0; const l = obsAt[t];
      for (let k = 0; k < l.length; k++) { const i = l[k], e = obs[i][t] - a[i] - lPv[t]; s -= hlv[i][t] + 0.5 * e * e * iv[i][t]; }
      const p = Pv[t];
      if (p < 0.02) { const d = Math.log(p / 0.02); s -= PEN * d * d; } else if (p > 1.3) { const d = Math.log(p / 1.3); s -= PEN * d * d; }
      return s;
    }
    const llT = new Float64Array(N), newT = new Float64Array(N);
    function fullLL() { let s = 0; for (let t = 0; t < N; t++) { llT[t] = llAt(lP, P, t); s += llT[t]; } return s; }
    const sigPen = ls => { const s = Math.exp(0.5 * ls); return s > 0.2 ? -PEN * Math.pow(Math.log(s / 0.2), 2) : 0; };
    const blockPrior = (k, r_, ps, s2) => -0.5 * Math.pow((k - pr.lK) / pr.sdK, 2) - 0.5 * Math.pow((r_ - pr.lr) / pr.sdr, 2)
      - 0.5 * Math.pow((ps - pr.lpsi) / pr.sdpsi, 2) - pr.igamma[0] * s2 - pr.igamma[1] * Math.exp(-s2) + sigPen(s2) - nI * k;  // −nI·lK：q 均勻先驗之 Jacobian
    function gibbsA() {
      for (let i = 0; i < nI; i++) {
        let w = 0, sw = 0;
        for (let t = 0; t < N; t++) { const y = obs[i][t]; if (y === y) { w += iv[i][t]; sw += (y - lP[t]) * iv[i][t]; } }
        const V = 1 / w, mu = V * sw + V;           // q 均勻 → log q 密度含 e^{log q}，平均位移 V
        a[i] = mu + Math.sqrt(V) * rng.norm();
      }
    }
    path(0, Math.exp(lK), Math.exp(lr), Math.exp(0.5 * ls2), lpsi, P, lP);
    for (let i = 0; i < nI; i++) { let s = 0, n = 0; for (let t = 0; t < N; t++) if (obs[i][t] === obs[i][t]) { s += obs[i][t] - lP[t]; n++; } a[i] = s / n; }
    let LL = fullLL();
    const d4 = 4; let mean4 = [lK, lr, lpsi, ls2], cov4 = [[0.02, 0, 0, 0], [0, 0.02, 0, 0], [0, 0, 0.005, 0], [0, 0, 0, 0.1]], nAd = 0;
    let lam = 2.38 * 2.38 / d4, acc4 = 0, Lc = U.cholJitter(cov4.map(r => r.map(v => v * lam)));
    const zsc = new Float64Array(N).fill(0.8), tsc = new Float64Array(nI).fill(0.5);
    const keep = [], total = mc.ni, nBlock = 20;
    for (let it = 0; it < total; it++) {
      const burn = it < mc.nb;
      // (1) 區塊更新 lK, lr, lpsi, ls2（成本低、主導 K–r 混合，每次疊代執行 nBlock 次）
      for (let bk = 0; bk < nBlock; bk++) {
        if (burn && it % 20 === 0) Lc = U.cholJitter(cov4.map(r => r.map(v => v * lam)));
        const e0 = rng.norm(), e1 = rng.norm(), e2 = rng.norm(), e3 = rng.norm(), e = [e0, e1, e2, e3];
        const cur = [lK, lr, lpsi, ls2];
        const prop = cur.map((v, i) => { let s = v; for (let k = 0; k <= i; k++) s += Lc[i][k] * e[k]; return s; });
        path(0, Math.exp(prop[0]), Math.exp(prop[1]), Math.exp(0.5 * prop[3]), prop[2], Pn, lPn);
        let LLn = 0; for (let t = 0; t < N; t++) { newT[t] = llAt(lPn, Pn, t); LLn += newT[t]; }
        const lpo = blockPrior(lK, lr, lpsi, ls2), lpn = blockPrior(prop[0], prop[1], prop[2], prop[3]);
        if (Number.isFinite(LLn) && Math.log(rng.unif()) < LLn + lpn - LL - lpo) {
          lK = prop[0]; lr = prop[1]; lpsi = prop[2]; ls2 = prop[3]; P.set(Pn); lP.set(lPn); llT.set(newT); LL = LLn; acc4++;
          if (burn) lam *= 1.01;
        } else if (burn) lam *= 0.9965;
        if (burn) {                                  // 經驗共變異（Welford）
          nAd++; const x = [lK, lr, lpsi, ls2], g = 1 / nAd;
          const dx = x.map((v, i) => v - mean4[i]);
          mean4 = mean4.map((v, i) => v + g * dx[i]);
          if (nAd > 50) cov4 = cov4.map((r, i) => r.map((v, j) => (1 - g) * v + g * dx[i] * (x[j] - mean4[j]) + (i === j ? 1e-8 : 0)));
        }
      }
      // (2) 過程偏差 z_t 逐項更新（僅重算第 t 年以後）
      const K = Math.exp(lK), r = Math.exp(lr), sig = Math.exp(0.5 * ls2);
      for (let t = 0; t < N; t++) {
        const zo = z[t], zn = zo + zsc[t] * rng.norm();
        z[t] = zn;
        if (t > 0) { Pn[t - 1] = P[t - 1]; lPn[t - 1] = lP[t - 1]; }
        path(t, K, r, sig, lpsi, Pn, lPn);
        let dLL = 0;
        for (let s = t; s < N; s++) { newT[s] = llAt(lPn, Pn, s); dLL += newT[s] - llT[s]; }
        if (Number.isFinite(dLL) && Math.log(rng.unif()) < dLL - 0.5 * (zn * zn - zo * zo)) {
          for (let s = t; s < N; s++) { P[s] = Pn[s]; lP[s] = lPn[s]; llT[s] = newT[s]; }
          LL += dLL; if (burn) zsc[t] *= 1.03;
        } else { z[t] = zo; if (burn) zsc[t] *= 0.98; }
      }
      // (3) 指標尺度參數（Gibbs）
      gibbsA(); LL = fullLL();
      // (4) 額外觀測變異 τ²（僅該指標之觀測值）
      for (let i = 0; i < nI; i++) {
        const old = lt2[i], nw = old + tsc[i] * rng.norm();
        const t2o = Math.exp(old), t2n = Math.exp(nw);
        let d = 0;
        for (let t = 0; t < N; t++) { const y = obs[i][t]; if (y === y) { const e = y - a[i] - lP[t], vo = D.SE2[i][t] + t2o, vn = D.SE2[i][t] + t2n; d += -0.5 * Math.log(vn / vo) - 0.5 * e * e * (1 / vn - 1 / vo); } }
        const tauPen = l => { const s = Math.exp(0.5 * l); return s > 1 ? -PEN * Math.pow(Math.log(s), 2) : 0; };
        const pri = l => -pr.tgamma[0] * l - pr.tgamma[1] * Math.exp(-l) + tauPen(l);
        if (Number.isFinite(d) && Math.log(rng.unif()) < d + pri(nw) - pri(old)) { lt2[i] = nw; setVar(i); LL = fullLL(); if (burn) tsc[i] *= 1.03; }
        else if (burn) tsc[i] *= 0.98;
      }
      if (!burn && (it - mc.nb) % mc.nt === 0)
        keep.push({ K, r, psi: Math.exp(lpsi), s2: Math.exp(ls2), lq: Array.from(a, v => v - lK), tau2: Array.from(lt2, Math.exp), P: Float64Array.from(P) });
      if (onProgress && it % 500 === 0) onProgress(it / total);
    }
    return { draws: keep, acc: acc4 / (total * nBlock), final: { lK, lr, lpsi, ls2, z: Array.from(z) } };
  }

  // ---------------------------------------------------------------- 收斂診斷（coda 演算法）
  function arSpec0(x) {                         // spectrum0.ar：Yule–Walker AR，AIC 選階
    const n = x.length, mu = U.mean(x), y = x.map(v => v - mu);
    let r0 = 0; for (const v of y) r0 += v * v; r0 /= n;
    if (r0 < 1e-300) return 0;
    const omax = Math.min(n - 1, Math.floor(10 * Math.log10(n)));
    const acf = [r0]; for (let k = 1; k <= omax; k++) { let s = 0; for (let t = k; t < n; t++) s += y[t] * y[t - k]; acf.push(s / n); }
    let phi = [], v = r0, best = { aic: n * Math.log(r0), order: 0, phi: [], v: r0 };
    for (let k = 1; k <= omax; k++) {
      let num = acf[k]; for (let j = 0; j < k - 1; j++) num -= phi[j] * acf[k - 1 - j];
      const kk = num / v; const np = phi.map((p, j) => p - kk * phi[k - 2 - j]); np.push(kk); phi = np; v = v * (1 - kk * kk);
      const aic = n * Math.log(v) + 2 * k; if (aic < best.aic) best = { aic, order: k, phi: phi.slice(), v };
    }
    const vp = best.v * n / (n - (best.order + 1));
    return vp / Math.pow(1 - U.sum(best.phi), 2);
  }
  S.geweke = function (x) {
    const n = x.length, n1 = Math.ceil(0.1 * n), s2 = Math.floor(n - 0.5 * n);
    const a = x.slice(0, n1), b = x.slice(s2);
    const z = (U.mean(a) - U.mean(b)) / Math.sqrt(arSpec0(a) / a.length + arSpec0(b) / b.length);
    return { z, p: 2 * U.pnorm(-Math.abs(z)) };
  };
  function besselK14(x) {                       // K_{1/4}(x) = ∫_0^∞ e^{−x cosh t} cosh(t/4) dt
    let s = 0; const h = 0.01; for (let t = 0; t < 30; t += h) { const v = Math.exp(-x * Math.cosh(t)) * Math.cosh(t / 4); s += (t === 0 ? 0.5 : 1) * v; if (v < 1e-300 && t > 1) break; } return s * h;
  }
  function pcramer(q) {
    let s = 0; for (let k = 0; k <= 3; k++) {
      const z = Math.exp(U.lgamma(k + 0.5)) * Math.sqrt(4 * k + 1) / (Math.exp(U.lgamma(k + 1)) * Math.pow(Math.PI, 1.5) * Math.sqrt(q));
      const u = (4 * k + 1) * (4 * k + 1) / (16 * q);
      s += u > -Math.log(1e-5) ? 0 : z * Math.exp(-u) * besselK14(u);
    }
    return s;
  }
  S.heidel = function (x) {                      // 回傳平穩性檢定 p 值
    const n0 = x.length, S0 = arSpec0(x.slice(Math.floor(n0 / 2)));
    let I = NaN, conv = false;
    for (let k = 0; k < 6; k++) {
      const st = Math.round(k * n0 / 10); if (st > n0 / 2) break;
      const Y = x.slice(st), n = Y.length, yb = U.mean(Y);
      let B = 0, ss = 0; for (let i = 0; i < n; i++) { B += Y[i] - yb; ss += B * B / (n * S0); }
      I = ss / n; if (pcramer(I) < 0.95) { conv = true; break; }
    }
    return { p: 1 - pcramer(I), conv };
  };
  S.rhat = function (chains) {                   // Gelman–Rubin（未分割）
    const m = chains.length; if (m < 2) return NaN;
    const n = Math.min(...chains.map(c => c.length));
    const means = chains.map(c => U.mean(c.slice(0, n))), vars = chains.map(c => U.variance(c.slice(0, n)));
    const W = U.mean(vars), B = n * U.variance(means);
    return Math.sqrt(((n - 1) / n * W + B / n) / W);
  };

  // ---------------------------------------------------------------- 摘要
  S.summarize = function (D, chains, mc) {
    const draws = [].concat(...chains.map(c => c.draws)), N = D.N, m = D.m, nI = D.nI;
    const q3 = a => { const v = U.q3(a); return { lci: v[0], mu: v[1], uci: v[2] }; };
    const K = draws.map(d => d.K), r = draws.map(d => d.r);
    const Hmsy = draws.map(d => d.r / (m - 1) * (1 - 1 / m)), SBmsyK = Math.pow(m, -1 / (m - 1));
    const SBmsy = K.map(k => k * SBmsyK), MSY = SBmsy.map((b, i) => b * Hmsy[i]);
    const ts = { B: [], H: [], BBmsy: [], FFmsy: [], P: [] };
    const bbLast = [], ffLast = [];
    for (let t = 0; t < N; t++) {
      const B = draws.map(d => d.P[t] * d.K), H = B.map(b => D.C[t] / b);
      const BB = draws.map((d, i) => d.P[t] * d.K / SBmsy[i]), FF = H.map((h, i) => h / Hmsy[i]);
      ts.B.push(q3(B)); ts.H.push(q3(H)); ts.BBmsy.push(q3(BB)); ts.FFmsy.push(q3(FF)); ts.P.push(q3(draws.map(d => d.P[t])));
      if (t === N - 1) { bbLast.push(...BB); ffLast.push(...FF); }
    }
    const y0 = D.years[0], y1 = D.years[N - 1];
    const est = {
      K: q3(K), r: q3(r), psi: q3(draws.map(d => d.psi)), 'sigma.proc': q3(draws.map(d => Math.sqrt(d.s2))), m: { lci: m, mu: m, uci: m },
      Hmsy: q3(Hmsy), SBmsy: q3(SBmsy), MSY: q3(MSY), bmsyk: { lci: SBmsyK, mu: SBmsyK, uci: SBmsyK },
      ['P' + y0]: q3(draws.map(d => d.P[0])), ['P' + y1]: q3(draws.map(d => d.P[N - 1])),
      'B_Bmsy.cur': q3(bbLast), 'H_Hmsy.cur': q3(ffLast) };
    // 殘差
    const resid = [];
    let Nobs = 0, ssr = 0, ssst = 0;
    for (let i = 0; i < nI; i++) for (let t = 0; t < N; t++) {
      const o = D.I[i][t]; if (!Number.isFinite(o)) continue;
      const hat = draws.map(d => Math.exp(d.lq[i]) * d.P[t] * d.K);
      const toe = U.median(draws.map(d => Math.sqrt(D.SE2[i][t] + d.tau2[i])));
      const h = q3(hat); const res = Math.log(o) - Math.log(h.mu);
      const st = Math.log(o / h.mu) / toe + 0.5 * toe;
      resid.push({ name: D.names[i], i, year: D.years[t], obs: o, hat: h.mu, lci: h.lci, uci: h.uci, residual: res, stres: st, toe });
      Nobs++; ssr += res * res; ssst += st * st;
    }
    // 無觀測年份之指標預測（回溯分析 MASE 用）
    const ihat = D.names.map((nm, i) => D.years.map((_, t) => U.median(draws.map(d => Math.exp(d.lq[i]) * d.P[t] * d.K))));
    const npar = 5 + 2 * nI, DF = Nobs - npar;
    const stats = { N: Nobs, p: npar, DF, SDNR: U.round(Math.sqrt(ssst / (Nobs - 1)), 2), RMSE: U.round(100 * Math.sqrt(ssr / DF), 1) };
    // 收斂
    const conv = ['K', 'r'].map(nm => {
      const stack = [].concat(...chains.map(c => c.draws.map(d => Math.log(d[nm]))));
      const g = S.geweke(stack), h = S.heidel(stack), rh = S.rhat(chains.map(c => c.draws.map(d => Math.log(d[nm]))));
      return { name: nm, mu: U.median(nm === 'K' ? K : r), geweke: g.p, heidel: h.p, rhat: rh };
    });
    return { yr: D.years.slice(), catch: D.C.slice(), names: D.names, m, model: D.model, timeseries: ts, estimates: est,
             kobe: { stock: bbLast, harvest: ffLast }, resid, ihat, stats, conv, nDraws: draws.length, mcmc: mc,
             accept: U.mean(chains.map(c => c.acc)), prior: D.prior,
             post: { K, r, psi: draws.map(d => d.psi) }, _draws: draws, _D: D };
  };

  /** 單一鏈（供 Web Worker 平行執行） */
  S.chain = function (o, mc, c, initFrom, onProgress) {
    const D = S.prepare(o);
    const rng = U.rng(1000 + 7919 * c + (mc.seed || 0));
    const init = initFrom ? Object.assign({}, initFrom) :
      { lK: D.prior.lK + 0.3 * rng.norm(), lr: D.prior.lr + 0.2 * rng.norm(), lpsi: D.prior.lpsi, ls2: Math.log(0.01) };
    return runChain(D, mc, 12345 + 101 * c + (mc.seed || 0), init, onProgress);
  };
  S.fromChains = function (o, mc, chains) {
    const D = S.prepare(o);
    const fit = S.summarize(D, chains, mc);
    fit.final = chains[0].final; fit.input = o;
    return fit;
  };
  /** 主函數：先驗設定 → MCMC → 摘要（循序執行各鏈） */
  S.run = function (o, mc, onProgress, initFrom) {
    const chains = [];
    for (let c = 0; c < mc.nc; c++) chains.push(S.chain(o, mc, c, initFrom, p => onProgress && onProgress((c + p) / mc.nc)));
    return S.fromChains(o, mc, chains);
  };
  /** 回溯分析用之輸入：移除最後 p 年之指標觀測值 */
  S.peelInput = function (o, p) {
    const oo = JSON.parse(JSON.stringify(o));
    Object.keys(oo.indices).forEach(nm => { const v = oo.indices[nm]; for (let t = v.length - p; t < v.length; t++) v[t] = null; });
    return oo;
  };
  S.quickMC = { ni: 15000, nb: 3000, nt: 3, nc: 2 };     // 快速試算（JABBA quickmcmc 為 8000/2000/2/2；本抽樣器每疊代成本較低，故加長以確保收斂）

  // ---------------------------------------------------------------- runs test（同 JABBA jbruns_sig3、randtests::runs.test）
  S.runsTest = function (x) {
    const mr0 = []; for (let i = 1; i < x.length; i++) mr0.push(Math.abs(x[i] - x[i - 1]));
    let amr = U.mean(mr0); const ul = 3.267 * amr; const mr = mr0.filter(v => v < ul); amr = U.mean(mr);
    const sd = amr / 1.128, lcl = -3 * sd, ucl = 3 * sd;
    const s = x.filter(v => v !== 0).map(v => v > 0 ? 1 : 0);
    const n1 = s.filter(v => v === 1).length, n2 = s.length - n1;
    let p = 0.001;
    if (n1 > 0 && n2 > 0) {
      let R = 1; for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) R++;
      const n = n1 + n2, mu = 2 * n1 * n2 / n + 1, v = 2 * n1 * n2 * (2 * n1 * n2 - n) / (n * n * (n - 1));
      p = U.round(U.pnorm((R - mu) / Math.sqrt(v)), 3);
    }
    return { lcl, ucl, p };
  };

  // ---------------------------------------------------------------- 回溯分析與 MASE
  S.hindcast = function (fit, peels, onProgress) {
    const out = [fit];
    peels.forEach((p, k) => {
      const f = S.run(S.peelInput(fit.input, p), S.quickMC, q => onProgress && onProgress((k + q) / peels.length), fit.final);
      f.peel = p; out.push(f);
    });
    return out;
  };
  /** 精簡回溯結果（僅保留比較所需欄位，減少傳輸量） */
  S.slim = function (f) { return { yr: f.yr, timeseries: f.timeseries, ihat: f.ihat, peel: f.peel, names: f.names }; };
  S.mohnsRho = function (hc) {
    const ref = hc[0], N = ref.yr.length, res = {};
    ['BBmsy', 'FFmsy'].forEach(q => {
      const v = hc.slice(1).map(h => { const t = N - 1 - h.peel; const xp = h.timeseries[q][t].mu, xr = ref.timeseries[q][t].mu; return (xp - xr) / xr; });
      res[q] = U.mean(v);
    });
    return res;
  };
  S.mase = function (hc) {
    const ref = hc[0], N = ref.yr.length, D = ref._D, peels = hc.slice(1).map(h => h.peel);
    const maxp = Math.max(...peels);
    const rows = []; let allP = [], allN = [];
    D.names.forEach((nm, i) => {
      const obs = D.I[i];
      const evalT = []; for (let t = N - 1 - maxp; t < N; t++) evalT.push(t);          // 評估年（含基準年）
      const obsE = evalT.map(t => obs[t]);
      if (obsE.filter(Number.isFinite).length < 2) { rows.push({ Index: nm, MASE: NaN, n: 0 }); return; }
      const pred = [], naive = [];
      hc.slice(1).forEach(h => {
        const t = N - h.peel;                       // 該次回溯之下一年（一步預測）
        if (t < N && Number.isFinite(obs[t])) {
          pred.push(Math.log(h.ihat[i][t]) - Math.log(obs[t]));
          let tp = t - 1; while (tp >= 0 && !Number.isFinite(obs[tp])) tp--;
          if (tp >= 0) naive.push(Math.log(obs[tp]) - Math.log(obs[t]));
        }
      });
      const k = Math.min(pred.length, naive.length); if (!k) { rows.push({ Index: nm, MASE: NaN, n: 0 }); return; }
      const mp = U.mean(pred.slice(0, k).map(Math.abs)), mn = U.mean(naive.slice(0, k).map(Math.abs));
      rows.push({ Index: nm, MASE: mp / mn, n: k }); allP = allP.concat(pred.slice(0, k)); allN = allN.concat(naive.slice(0, k));
    });
    const joint = allP.length ? U.mean(allP.map(Math.abs)) / U.mean(allN.map(Math.abs)) : NaN;
    rows.push({ Index: 'joint', MASE: joint, n: allP.length });
    return rows;
  };

  // ---------------------------------------------------------------- 診斷檢核表
  S.diagnostics = function (fit, hc, life) {
    const rows = [], add = (item, val, crit, pass, ref) => rows.push({ 診斷項目: item, 結果: val, 判定標準: crit, 判定: pass === null ? '—' : (pass ? '通過' : '未通過'), 文獻: ref });
    const c = fit.conv;
    add('MCMC 收斂（Geweke 檢定，K、r）', c.map(x => `${x.name}: p=${x.geweke.toFixed(2)}`).join('；'), 'p > 0.05', c.every(x => x.geweke > 0.05), 'Geweke (1992)');
    add('MCMC 收斂（Heidelberger–Welch，K、r）', c.map(x => `${x.name}: p=${x.heidel.toFixed(2)}`).join('；'), 'p > 0.05', c.every(x => x.heidel > 0.05), 'Heidelberger & Welch (1983)');
    if (c.every(x => Number.isFinite(x.rhat)))
      add('MCMC 收斂（Gelman–Rubin R̂，K、r）', c.map(x => `${x.name}: ${x.rhat.toFixed(3)}`).join('；'), '< 1.1', c.every(x => x.rhat < 1.1), 'Gelman & Rubin (1992)');
    const rt = fit.names.map(nm => ({ nm, r: S.runsTest(fit.resid.filter(x => x.name === nm).map(x => x.residual)) }));
    add('殘差隨機性（runs test）', rt.map(x => `${x.nm}: p=${x.r.p.toFixed(3)}`).join('；'), '各指標 p > 0.05', rt.every(x => x.r.p > 0.05), 'Carvalho et al. (2021)');
    add('配適誤差 RMSE（%）', fit.stats.RMSE.toFixed(1) + '%', '< 30%', fit.stats.RMSE < 30, 'Winker et al. (2018)');
    add('標準化殘差標準差 SDNR', fit.stats.SDNR.toFixed(2), '接近 1（參考）', null, 'Francis (2011)');
    if (hc && hc.length > 1) {
      const rho = S.mohnsRho(hc), lim = life === 'short' ? [-0.22, 0.30] : [-0.15, 0.20];
      add("回溯分析 Mohn's ρ（B/Bmsy）", rho.BBmsy.toFixed(3), `${lim[0].toFixed(2)} ～ ${lim[1].toFixed(2)}`, rho.BBmsy >= lim[0] && rho.BBmsy <= lim[1], 'Hurtado-Ferro et al. (2015)');
      add("回溯分析 Mohn's ρ（F/Fmsy）", rho.FFmsy.toFixed(3), `${lim[0].toFixed(2)} ～ ${lim[1].toFixed(2)}`, rho.FFmsy >= lim[0] && rho.FFmsy <= lim[1], 'Hurtado-Ferro et al. (2015)');
      const ms = S.mase(hc), j = ms.find(x => x.Index === 'joint');
      if (j && Number.isFinite(j.MASE)) add('事後預測能力 MASE（聯合）', j.MASE.toFixed(2), '< 1', j.MASE < 1, 'Kell et al. (2016)');
    }
    return rows;
  };

  // ---------------------------------------------------------------- 主要估計值表
  S.estimatesTable = function (fit) {
    const lab = { K: 'K（原始生物量）', r: 'r（內在成長率）', psi: 'ψ（起始 B/K）', 'sigma.proc': '過程誤差 σ', m: '形狀參數 m',
                  Hmsy: 'Hmsy（MSY 收穫率）', SBmsy: 'Bmsy', MSY: 'MSY', bmsyk: 'Bmsy/K', 'B_Bmsy.cur': '目前 B/Bmsy', 'H_Hmsy.cur': '目前 H/Hmsy' };
    return Object.keys(fit.estimates).map(k => { const e = fit.estimates[k]; return { 參數: lab[k] || k, 中位數: U.signif(e.mu, 4), '下限 2.5%': U.signif(e.lci, 4), '上限 97.5%': U.signif(e.uci, 4) }; });
  };

  // ---------------------------------------------------------------- 漁獲量情境預測（同 R 版 jabba_projection 之輸出結構）
  S.projection = function (fit, pct, nyears, nsq) {
    nsq = nsq || 3;
    const rng = U.rng(2024), D = fit._D, N = D.N, m = fit.m, rm1 = 1 / (m - 1);
    const cur = U.mean(D.C.slice(-nsq));
    const levels = pct.map(p => Math.round(cur * (1 + p)));
    const draws = fit._draws; const step = Math.max(1, Math.floor(draws.length / 2000)); const use = draws.filter((_, i) => i % step === 0);
    const years = []; for (let k = 1; k <= nyears; k++) years.push(D.years[N - 1] + k);
    const res = levels.map(() => years.map(() => ({ bb: [], ff: [] })));
    use.forEach(d => {
      const Hmsy = d.r * rm1 * (1 - 1 / m), SBmsy = d.K * Math.pow(m, -1 / (m - 1)), sig = Math.sqrt(d.s2);
      const eps = years.map(() => rng.norm() * sig);          // 各情境共用相同過程誤差（共同亂數）
      levels.forEach((Cl, li) => {
        let P = d.P[N - 1], Cprev = D.C[N - 1];
        years.forEach((_, k) => {
          P = Math.max(P + d.r * rm1 * P * (1 - Math.pow(P, m - 1)) - Cprev / d.K, 0.001) * Math.exp(eps[k]);
          const B = P * d.K; res[li][k].bb.push(B / SBmsy); res[li][k].ff.push((Cl / B) / Hmsy); Cprev = Cl;
        });
      });
    });
    const lab = levels.map((l, i) => `${pct[i] >= 0 ? '+' : ''}${Math.round(100 * pct[i])}%（${l.toLocaleString('en-US')}）`);
    const mk = f => levels.map((_, li) => { const row = { 漁獲量情境: lab[li] }; years.forEach((y, k) => row[y + '年'] = f(res[li][k])); return row; });   // 欄名加「年」以保持欄位順序
    return {
      current: cur, levels, pct, years,
      P_green: mk(c => U.mean(c.bb.map((b, i) => (b >= 1 && c.ff[i] <= 1) ? 1 : 0))),
      P_B: mk(c => U.mean(c.bb.map(b => b >= 1 ? 1 : 0))),
      P_F: mk(c => U.mean(c.ff.map(f => f <= 1 ? 1 : 0))),
      median: levels.map((_, li) => ({ pct: pct[li], bb: years.map((_, k) => U.median(res[li][k].bb)), ff: years.map((_, k) => U.median(res[li][k].ff)) }))
    };
  };
})(typeof self !== 'undefined' ? self : globalThis);
