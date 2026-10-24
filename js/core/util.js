/* =============================================================================
 * FRI-FishStock 網頁版：共用數值工具
 * 亂數、統計量、機率分布、線性代數（QR／Cholesky）、線性模型與二項 GLM
 * 授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS = root.FS || {};
  const U = FS.util = {};

  // ---------------------------------------------------------------- 亂數（可設種子）
  U.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const unif = function () {             // mulberry32
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const norm = function () {             // Box–Muller
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = unif();
      v = unif();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    // Gamma(shape, 1)：Marsaglia–Tsang
    const gamma = function (k) {
      if (k < 1) return gamma(k + 1) * Math.pow(unif(), 1 / k);
      const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x, v;
        do { x = norm(); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = unif();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
      }
    };
    const binom = function (n, p) {        // 小 n 直接法，大 n 常態近似（僅用於 Bootstrap 重抽樣）
      if (n <= 0 || p <= 0) return 0;
      if (p >= 1) return n;
      if (n < 60) { let k = 0; for (let i = 0; i < n; i++) if (unif() < p) k++; return k; }
      const m = n * p, s = Math.sqrt(n * p * (1 - p));
      return Math.max(0, Math.min(n, Math.round(m + s * norm())));
    };
    const multinom = function (n, probs) {
      const out = new Array(probs.length).fill(0);
      let rest = n, prest = 1;
      for (let i = 0; i < probs.length - 1 && rest > 0; i++) {
        const p = prest > 0 ? Math.min(1, Math.max(0, probs[i] / prest)) : 0;
        const k = binom(rest, p); out[i] = k; rest -= k; prest -= probs[i];
      }
      if (rest > 0) out[probs.length - 1] += rest;
      return out;
    };
    return { unif, norm, gamma, binom, multinom };
  };

  // ---------------------------------------------------------------- 基本統計
  U.sum = a => { let s = 0; for (const v of a) s += v; return s; };
  U.mean = a => a.length ? U.sum(a) / a.length : NaN;
  U.finite = a => a.filter(v => Number.isFinite(v));
  U.sd = a => { const m = U.mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / (a.length - 1)); };
  U.variance = a => { const s = U.sd(a); return s * s; };
  U.quantile = function (arr, p) {           // R type 7
    const a = arr.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
    const n = a.length; if (!n) return NaN;
    const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return a[lo] + (h - lo) * (a[hi] - a[lo]);
  };
  U.median = a => U.quantile(a, 0.5);
  U.q3 = a => [U.quantile(a, 0.025), U.quantile(a, 0.5), U.quantile(a, 0.975)];
  U.range = a => { let lo = Infinity, hi = -Infinity; for (const v of a) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
  U.seq = (from, to, by) => { const o = []; const n = Math.floor((to - from) / by + 1e-10); for (let i = 0; i <= n; i++) o.push(+(from + i * by).toFixed(10)); return o; };
  U.round = (x, d) => { const f = Math.pow(10, d); return Math.round(x * f) / f; };
  U.signif = (x, d) => { if (!Number.isFinite(x) || x === 0) return x; return Number(x.toPrecision(d)); };
  U.unique = a => Array.from(new Set(a));
  U.argmax = a => { let k = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i; return k; };

  // ---------------------------------------------------------------- 機率分布
  U.lgamma = function (x) {                  // Lanczos
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - U.lgamma(1 - x);
    x -= 1; let a = c[0]; const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  U.pnorm = function (x) {                   // W. J. Cody 近似（誤差 < 1e-14）
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - r / 2 : r / 2;
  };
  U.qnorm = function (p) {                   // Acklam
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425; let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };
  // 正規化不完全 Beta（Numerical Recipes 連分式）
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  U.pbeta = function (x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(U.lgamma(a + b) - U.lgamma(a) - U.lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  };
  U.pf_upper = (f, d1, d2) => (f <= 0 || !Number.isFinite(f)) ? (f > 0 ? 0 : 1) : U.pbeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
  U.pt2 = (t, df) => U.pbeta(df / (df + t * t), df / 2, 0.5);           // 雙尾 p 值
  U.qt975 = function (df) {                   // t 分布 0.975 分位數（二分法）
    let lo = 1.9, hi = 15; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (U.pt2(m, df) / 2 > 0.025) lo = m; else hi = m; } return (lo + hi) / 2;
  };
  // 正規化不完全 Gamma（上尾）
  U.pgamma_upper = function (x, a) {
    if (x <= 0) return 1;
    const gln = U.lgamma(a);
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-14) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  };
  U.pchisq_upper = (x, df) => U.pgamma_upper(x / 2, df / 2);
  U.dnorm_log = (x, m, s) => -0.5 * Math.log(2 * Math.PI) - Math.log(s) - 0.5 * ((x - m) / s) * ((x - m) / s);
  U.dlnorm = (x, ml, s) => x > 0 ? Math.exp(U.dnorm_log(Math.log(x), ml, s)) / x : 0;

  // ---------------------------------------------------------------- 線性代數
  U.chol = function (A) {                    // 下三角 L，A = L L'
    const n = A.length, L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s <= 0) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    return L;
  };
  U.cholJitter = function (A) {
    let L = U.chol(A); if (L) return L;
    const n = A.length; let eps = 1e-10 * (U.mean(A.map((r, i) => Math.abs(r[i]))) || 1);
    for (let t = 0; t < 20 && !L; t++) { const B = A.map((r, i) => r.map((v, j) => v + (i === j ? eps : 0))); L = U.chol(B); eps *= 10; }
    return L;
  };
  // 以下三角 L 求 (L L')^{-1}
  U.cholInverse = function (L) {
    const n = L.length, Li = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      Li[i][i] = 1 / L[i][i];
      for (let j = 0; j < i; j++) { let s = 0; for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j]; Li[i][j] = s / L[i][i]; }
    }
    const inv = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = 0; for (let k = i; k < n; k++) s += Li[k][i] * Li[k][j]; inv[i][j] = inv[j][i] = s;
    }
    return inv;
  };

  /**
   * 加權最小平方（Householder QR，依序偵測共線欄位，與 R lm 之處理相同：共線者係數為 NA）
   * @param X 陣列之陣列（n × p）；y 長度 n；w 權重（可省略）
   */
  U.wls = function (X, y, w) {
    const n = X.length, p = X[0].length;
    const sw = w ? w.map(Math.sqrt) : null;
    // 欄主序之工作矩陣
    const A = []; for (let j = 0; j < p; j++) { const c = new Float64Array(n); for (let i = 0; i < n; i++) c[i] = X[i][j] * (sw ? sw[i] : 1); A.push(c); }
    const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = y[i] * (sw ? sw[i] : 1);
    const keep = [], R = [], vs = [], betas = [];
    const norm0 = A.map(c => { let s = 0; for (const v of c) s += v * v; return Math.sqrt(s); });
    for (let j = 0; j < p; j++) {
      const c = A[j]; const k = keep.length;
      // 套用先前之 Householder 轉換
      for (let h = 0; h < k; h++) { const v = vs[h], bt = betas[h]; let s = 0; for (let i = h; i < n; i++) s += v[i] * c[i]; s *= bt; for (let i = h; i < n; i++) c[i] -= s * v[i]; }
      let nrm = 0; for (let i = k; i < n; i++) nrm += c[i] * c[i]; nrm = Math.sqrt(nrm);
      if (k >= n || nrm <= 1e-7 * (norm0[j] || 1)) continue;   // 共線，略過
      const alpha = c[k] > 0 ? -nrm : nrm;
      const v = new Float64Array(n); for (let i = k; i < n; i++) v[i] = c[i]; v[k] -= alpha;
      let vv = 0; for (let i = k; i < n; i++) vv += v[i] * v[i];
      const bt = vv > 0 ? 2 / vv : 0;
      vs.push(v); betas.push(bt);
      const col = new Float64Array(k + 1); for (let i = 0; i < k; i++) col[i] = c[i]; col[k] = alpha;
      R.push(col); keep.push(j);
    }
    const r = keep.length;
    // Q'b
    for (let h = 0; h < r; h++) { const v = vs[h], bt = betas[h]; let s = 0; for (let i = h; i < n; i++) s += v[i] * b[i]; s *= bt; for (let i = h; i < n; i++) b[i] -= s * v[i]; }
    // 回代 R β = Q'b（R 以欄儲存：R[col][row]）
    const bk = new Float64Array(r);
    for (let i = r - 1; i >= 0; i--) { let s = b[i]; for (let jj = i + 1; jj < r; jj++) s -= R[jj][i] * bk[jj]; bk[i] = s / R[i][i]; }
    // (R'R)^{-1}
    const Rinv = Array.from({ length: r }, () => new Float64Array(r));
    for (let i = r - 1; i >= 0; i--) { Rinv[i][i] = 1 / R[i][i]; for (let jj = i + 1; jj < r; jj++) { let s = 0; for (let m = i + 1; m <= jj; m++) s -= R[m][i] * Rinv[m][jj]; Rinv[i][jj] = s / R[i][i]; } }
    const XtXi = Array.from({ length: r }, () => new Float64Array(r));
    for (let i = 0; i < r; i++) for (let jj = 0; jj <= i; jj++) { let s = 0; for (let m = Math.max(i, jj); m < r; m++) s += Rinv[i][m] * Rinv[jj][m]; XtXi[i][jj] = XtXi[jj][i] = s; }
    const coef = new Array(p).fill(NaN); keep.forEach((j, i) => coef[j] = bk[i]);
    const fitted = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let jj = 0; jj < r; jj++) s += X[i][keep[jj]] * bk[jj]; fitted[i] = s; }
    return { coef, keep, rank: r, XtXi, fitted };
  };

  /** 線性模型（同 R lm）：回傳係數、vcov、RSS、R²、AIC、殘差 */
  U.lm = function (X, y) {
    const n = y.length, f = U.wls(X, y);
    let rss = 0, tss = 0; const my = U.mean(y); const resid = new Float64Array(n);
    for (let i = 0; i < n; i++) { resid[i] = y[i] - f.fitted[i]; rss += resid[i] * resid[i]; tss += (y[i] - my) * (y[i] - my); }
    const df = n - f.rank, s2 = rss / df;
    const ll = -n / 2 * (Math.log(2 * Math.PI) + Math.log(rss / n) + 1);
    const hasInt = true;
    const r2 = 1 - rss / tss, adj = 1 - (1 - r2) * (n - 1) / df;
    return { coef: f.coef, keep: f.keep, rank: f.rank, vcov: f.XtXi.map(r => Array.from(r, v => v * s2)), rss, df, sigma: Math.sqrt(s2),
             s2, r2, adjr2: adj, loglik: ll, aic: -2 * ll + 2 * (f.rank + 1), bic: -2 * ll + Math.log(n) * (f.rank + 1),
             fitted: f.fitted, resid, n, hasInt };
  };

  /** 二項 GLM（logit，IRLS；同 R glm(family = binomial)） */
  U.glmBinom = function (X, y) {
    const n = y.length; let eta = new Float64Array(n), mu = new Float64Array(n);
    for (let i = 0; i < n; i++) { mu[i] = (y[i] + 0.5) / 2; eta[i] = Math.log(mu[i] / (1 - mu[i])); }
    let f = null, dev = Infinity;
    const devf = () => { let d = 0; for (let i = 0; i < n; i++) { const m = Math.min(1 - 1e-15, Math.max(1e-15, mu[i])); d += -2 * (y[i] ? Math.log(m) : Math.log(1 - m)); } return d; };
    for (let it = 0; it < 50; it++) {
      const w = new Float64Array(n), z = new Float64Array(n);
      for (let i = 0; i < n; i++) { const v = Math.max(mu[i] * (1 - mu[i]), 1e-10); w[i] = v; z[i] = eta[i] + (y[i] - mu[i]) / v; }
      f = U.wls(X, Array.from(z), Array.from(w));
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < f.keep.length; j++) s += X[i][f.keep[j]] * f.coef[f.keep[j]]; eta[i] = s; mu[i] = 1 / (1 + Math.exp(-s)); }
      const nd = devf(); if (Math.abs(nd - dev) / (Math.abs(nd) + 0.1) < 1e-8) { dev = nd; break; } dev = nd;
    }
    return { coef: f.coef, keep: f.keep, rank: f.rank, vcov: f.XtXi.map(r => Array.from(r)), deviance: dev, aic: dev + 2 * f.rank, fitted: mu, n };
  };

  /** 多變量常態抽樣：回傳 nsim × p */
  U.mvrnorm = function (rng, mu, V, nsim) {
    const L = U.cholJitter(V); const p = mu.length; const out = [];
    for (let s = 0; s < nsim; s++) {
      const z = new Float64Array(p); for (let i = 0; i < p; i++) z[i] = rng.norm();
      const x = new Float64Array(p); for (let i = 0; i < p; i++) { let v = mu[i]; for (let k = 0; k <= i; k++) v += L[i][k] * z[k]; x[i] = v; }
      out.push(x);
    }
    return out;
  };

  // ---------------------------------------------------------------- 迴歸工具
  U.simpleLm = function (x, y) {             // y = a + b x，回傳 a、b、se(b)、df
    const n = x.length, mx = U.mean(x), my = U.mean(y);
    let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) * (x[i] - mx); sxy += (x[i] - mx) * (y[i] - my); }
    const b = sxy / sxx, a = my - b * mx; let rss = 0; for (let i = 0; i < n; i++) { const e = y[i] - a - b * x[i]; rss += e * e; }
    const df = n - 2; return { a, b, se: Math.sqrt(rss / df / sxx), df, r2: 1 - rss / U.sum(y.map(v => (v - my) * (v - my))) };
  };

  // ---------------------------------------------------------------- 讀檔（UTF-8／Big5）
  /** 將 ArrayBuffer 解碼為文字：去除 BOM，非合法 UTF-8 時改以 Big5（CP950）解碼 */
  U.decodeText = function (buf) {
    let bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('big5').decode(bytes); }
  };
  /** CSV 解析（支援引號、逗號、換行），數值欄自動轉數字，空白／NA 為 null */
  U.parseCSV = function (text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return U.rowsToTable(rows);
  };
  U.rowsToTable = function (rows) {
    const head = rows[0].map(h => String(h).trim());
    const cols = {}; head.forEach(h => cols[h] = []);
    for (let r = 1; r < rows.length; r++) head.forEach((h, j) => {
      let v = rows[r][j]; if (v === undefined || v === null) v = ''; v = String(v).trim();
      cols[h].push(v === '' || v === 'NA' ? null : v);
    });
    const numeric = {};
    head.forEach(h => {
      const vals = cols[h].filter(v => v !== null);
      numeric[h] = vals.length > 0 && vals.every(v => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v));
      if (numeric[h]) cols[h] = cols[h].map(v => v === null ? null : Number(v));
    });
    return { names: head, cols, numeric, n: rows.length - 1 };
  };
  U.numericCols = t => t.names.filter(h => t.numeric[h]);
})(typeof self !== 'undefined' ? self : globalThis);
