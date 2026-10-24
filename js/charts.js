/* =============================================================================
 * FRI-FishStock 網頁版：圖表（Plotly 圖形規格；介面互動圖與報告靜態圖共用）
 * 授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS; const U = FS.util;
  const G = FS.charts = {};
  const FONT = '"Microsoft JhengHei","微軟正黑體","Noto Sans TC","Noto Sans CJK TC","PingFang TC",sans-serif';
  const BLUE = '#1F5FAD', RED = '#B3261E', GREEN = '#1E7B4F', GREY = '#6b7280', LBLUE = '#9DB9DD';
  const ZONE = { red: '#E06666', orange: '#F6B26B', yellow: '#F6E27A', green: '#93C47D' };
  G.colors = { BLUE, RED, GREEN, GREY, LBLUE, ZONE };
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  G.alpha = alpha;

  function base(title, extra) {
    return Object.assign({
      title: title ? { text: title, font: { size: 15 } } : undefined,
      font: { family: FONT, size: 12, color: '#222' }, paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      margin: { l: 62, r: 18, t: title ? 46 : 18, b: 52 }, showlegend: true,
      legend: { orientation: 'h', y: -0.18, x: 0, bgcolor: 'rgba(255,255,255,0.8)' }, hovermode: 'closest'
    }, extra || {});
  }
  const ax = (title, o) => Object.assign({ title: { text: title || '' }, showline: true, linecolor: '#444', ticks: 'outside', zeroline: false, gridcolor: '#eee', automargin: true }, o || {});
  /** 子圖版面：rows × cols，回傳各子圖之座標軸名稱 */
  function grid(layout, rows, cols, gapx, gapy) {
    gapx = gapx ?? 0.08; gapy = gapy ?? 0.12;
    const w = (1 - gapx * (cols - 1)) / cols, h = (1 - gapy * (rows - 1)) / rows, out = [];
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      k++; const xa = k === 1 ? 'xaxis' : 'xaxis' + k, ya = k === 1 ? 'yaxis' : 'yaxis' + k;
      layout[xa] = ax('', { domain: [c * (w + gapx), c * (w + gapx) + w], anchor: k === 1 ? 'y' : 'y' + k });
      layout[ya] = ax('', { domain: [1 - (r + 1) * h - r * gapy, 1 - r * h - r * gapy], anchor: k === 1 ? 'x' : 'x' + k });
      out.push({ x: k === 1 ? 'x' : 'x' + k, y: k === 1 ? 'y' : 'y' + k, xa, ya });
    }
    return out;
  }
  const band = (x, lo, hi, color, name, axes) => Object.assign({ x: x.concat(x.slice().reverse()), y: lo.concat(hi.slice().reverse()), fill: 'toself', fillcolor: alpha(color, 0.2), line: { width: 0 }, hoverinfo: 'skip', name: name || '95% 區間', showlegend: !!name, type: 'scatter' }, axes || {});
  const hline = (y, axes, dash, color) => ({ type: 'line', xref: (axes ? axes.x : 'x') + ' domain', yref: axes ? axes.y : 'y', x0: 0, x1: 1, y0: y, y1: y, line: { dash: dash || 'dash', color: color || '#333', width: 1 } });
  function hist(v, nb) {
    const f = v.filter(Number.isFinite); const [lo, hi] = U.range(f); const n = nb || Math.min(40, Math.max(8, Math.ceil(Math.sqrt(f.length))));
    const w = (hi - lo) / n || 1, cnt = new Array(n).fill(0); f.forEach(x => { let i = Math.floor((x - lo) / w); if (i >= n) i = n - 1; if (i < 0) i = 0; cnt[i]++; });
    return { x: cnt.map((_, i) => lo + (i + 0.5) * w), y: cnt, w };
  }

  // ======================================================================== CPUE
  G.cpueIndex = function (r) {
    const i = r.index, x = i.map(d => d.year);
    return { data: [band(x, i.map(d => d.lci_rel), i.map(d => d.uci_rel), BLUE, '95% 信賴區間'),
      { x, y: i.map(d => d.nominal_rel), name: '名目 CPUE', mode: 'lines+markers', line: { dash: 'dash', color: GREY }, marker: { symbol: 'circle-open' } },
      { x, y: i.map(d => d.std_rel), name: '標準化 CPUE', mode: 'lines+markers', line: { color: BLUE, width: 2.5 } }],
      layout: base('名目與標準化 CPUE（95% 信賴區間）', { xaxis: ax('年'), yaxis: ax('相對 CPUE（平均 = 1）', { rangemode: 'tozero' }) }) };
  };
  G.cpueResid = function (r) {
    const res = r.resid.resid, fit = r.resid.fitted, L = base('', { showlegend: false }), g = grid(L, 1, 3);
    const h = hist(res, 40);
    const s = res.slice().sort((a, b) => a - b), n = s.length, th = s.map((_, k) => U.qnorm((k + 0.5) / n));
    const step = Math.max(1, Math.floor(n / 3000)), sel = (a) => a.filter((_, k) => k % step === 0);
    const q1 = U.quantile(res, 0.25), q3 = U.quantile(res, 0.75), slope = (q3 - q1) / (U.qnorm(0.75) - U.qnorm(0.25)), icp = q1 - slope * U.qnorm(0.25);
    L[g[0].xa].title.text = '殘差'; L[g[0].ya].title.text = '次數'; L[g[1].xa].title.text = '理論分位數'; L[g[1].ya].title.text = '樣本分位數';
    L[g[2].xa].title.text = '配適值（對數尺度）'; L[g[2].ya].title.text = '殘差';
    L.annotations = ['殘差直方圖', '常態 Q-Q 圖', '殘差 vs 配適值'].map((t, k) => ({ text: '<b>' + t + '</b>', xref: g[k].x + ' domain', yref: g[k].y + ' domain', x: 0.5, y: 1.12, showarrow: false }));
    L.margin.t = 40;
    return { data: [{ type: 'bar', x: h.x, y: h.y, width: h.w, marker: { color: LBLUE }, xaxis: g[0].x, yaxis: g[0].y },
      { x: sel(th), y: sel(s), mode: 'markers', marker: { size: 3, color: BLUE }, xaxis: g[1].x, yaxis: g[1].y },
      { x: [th[0], th[n - 1]], y: [icp + slope * th[0], icp + slope * th[n - 1]], mode: 'lines', line: { color: RED }, xaxis: g[1].x, yaxis: g[1].y },
      { x: sel(Array.from(fit)), y: sel(Array.from(res)), mode: 'markers', marker: { size: 3, color: alpha(BLUE, 0.4) }, xaxis: g[2].x, yaxis: g[2].y }],
      layout: Object.assign(L, { shapes: [hline(0, g[2], 'solid', RED)] }) };
  };

  // ======================================================================== 體長頻度
  function lfqBars(lfq, M, posColor, negColor, scale) {
    const t = lfq.dates.map(FS.lfq.yeardec), mid = lfq.midLengths, bw = mid[1] - mid[0];
    let mx = 0; M.forEach(r => r.forEach(v => mx = Math.max(mx, Math.abs(v))));
    const dt = t.length > 1 ? Math.min(...t.slice(1).map((v, i) => v - t[i])) : 0.1;
    const sc = (scale || 0.85) * dt / (mx || 1), shapes = [];
    t.forEach((tj, j) => mid.forEach((m, l) => {
      const v = M[l][j]; if (!v) return;
      shapes.push({ type: 'rect', xref: 'x', yref: 'y', x0: tj, x1: tj + Math.abs(v) * sc * (v < 0 ? 1 : 1), y0: m - bw / 2, y1: m + bw / 2,
        fillcolor: v > 0 ? posColor : negColor, line: { width: 0.4, color: v > 0 ? '#222' : '#999' }, layer: 'below' });
    }));
    return { shapes, t, mid, dt };
  }
  const dateTicks = t => { const ys = U.unique(t.map(Math.floor)); const vals = [], txt = []; t.forEach(v => { vals.push(v); const d = new Date(Date.UTC(Math.floor(v), 0, 1) + (v - Math.floor(v)) * 365.25 * 864e5); txt.push(`'${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }); return { tickvals: vals, ticktext: txt }; };
  G.lfqRaw = function (lfq) {
    const b = lfqBars(lfq, lfq.catch, '#4a4a4a', '#bbb');
    return { data: [{ x: [b.t[0]], y: [b.mid[0]], mode: 'markers', marker: { opacity: 0 }, hoverinfo: 'skip', showlegend: false }],
      layout: base('月別體長頻度（原始）', { showlegend: false, shapes: b.shapes,
        xaxis: ax('採樣月', Object.assign({ range: [Math.min(...b.t) - b.dt * 0.2, Math.max(...b.t) + b.dt * 1.1] }, dateTicks(b.t))),
        yaxis: ax('體長組（cm）', { range: [b.mid[0] - 2, b.mid[b.mid.length - 1] + 2] }) }) };
  };
  G.lfqFit = function (lfq, par, MA) {
    const lr = FS.lfq.restructure(lfq, MA);
    const b = lfqBars(lr, lr.rcounts, '#222', '#ccc', 0.9);
    const data = [{ x: [b.t[0]], y: [b.mid[0]], mode: 'markers', marker: { opacity: 0 }, hoverinfo: 'skip', showlegend: false }];
    if (par) {
      const tmin = Math.min(...b.t) - 0.05, tmax = Math.max(...b.t) + 0.25;
      const tr = FS.lfq.cohortTraces(lr, par, null);
      tr.tAs.forEach(ta => {
        const xs = [], ys = []; for (let x = Math.max(ta, tmin); x <= tmax; x += 0.01) { const ra = x - ta; if (ra > 0 && ra <= tr.agemax) { xs.push(x); ys.push(par.Linf * (1 - Math.exp(-par.K * (x - ta)))); } }
        if (xs.length) data.push({ x: xs, y: ys, mode: 'lines', line: { color: RED, width: 2 }, hoverinfo: 'skip', showlegend: false });
      });
    }
    return { data, layout: base('重整後體長頻度與 von Bertalanffy 成長曲線', { showlegend: false, shapes: b.shapes,
      xaxis: ax('採樣月', Object.assign({ range: [Math.min(...b.t) - b.dt * 0.2, Math.max(...b.t) + b.dt * 1.1] }, dateTicks(b.t))),
      yaxis: ax('體長組（cm）', { range: [b.mid[0] - 2, b.mid[b.mid.length - 1] + 2] }) }) };
  };
  G.lfqBoot = function (bt) {
    const L = base('', { showlegend: false }), g = grid(L, 1, 3), d = bt.draws;
    const h1 = hist(d.map(x => x.Linf), 12), h2 = hist(d.map(x => x.K), 12);
    L[g[0].xa].title.text = 'L∞（cm）'; L[g[0].ya].title.text = 'K（年⁻¹）'; L[g[1].xa].title.text = 'L∞（cm）'; L[g[1].ya].title.text = '次數'; L[g[2].xa].title.text = 'K（年⁻¹）'; L[g[2].ya].title.text = '次數';
    L.annotations = ['Bootstrap 之 L∞–K 分布', 'L∞', 'K'].map((t, k) => ({ text: '<b>' + t + '</b>', xref: g[k].x + ' domain', yref: g[k].y + ' domain', x: 0.5, y: 1.12, showarrow: false })); L.margin.t = 40;
    return { data: [{ x: d.map(x => x.Linf), y: d.map(x => x.K), mode: 'markers', marker: { color: alpha(BLUE, 0.6), size: 7 }, xaxis: g[0].x, yaxis: g[0].y },
      { type: 'bar', x: h1.x, y: h1.y, width: h1.w, marker: { color: LBLUE }, xaxis: g[1].x, yaxis: g[1].y },
      { type: 'bar', x: h2.x, y: h2.y, width: h2.w, marker: { color: LBLUE }, xaxis: g[2].x, yaxis: g[2].y }], layout: L };
  };
  G.catchCurve = function (cc) {
    const ok = cc.t.map((v, i) => Number.isFinite(v) && Number.isFinite(cc.y[i]));
    const inR = i => i >= cc.reg_int[0] && i <= cc.reg_int[1];
    const xo = [], yo = [], xi = [], yi = [];
    cc.t.forEach((v, i) => { if (!ok[i]) return; (inR(i) ? xi : xo).push(v); (inR(i) ? yi : yo).push(cc.y[i]); });
    const xr = [Math.min(...xi), Math.max(...xi)];
    return { data: [{ x: xo, y: yo, mode: 'markers', name: '未納入迴歸', marker: { symbol: 'circle-open', color: '#444', size: 8 } },
      { x: xi, y: yi, mode: 'markers', name: '納入迴歸', marker: { color: BLUE, size: 8 } },
      { x: xr, y: xr.map(x => cc.a + cc.b * x), mode: 'lines', name: '迴歸線', line: { color: RED, width: 2.5 } }],
      layout: base(`體長轉換漁獲曲線：Z = ${cc.Z.toFixed(2)} ± ${(1.96 * cc.se).toFixed(2)} 年⁻¹`, { xaxis: ax('相對年齡（年）'), yaxis: ax('ln(C / dt)') }) };
  };

  // ======================================================================== CMSY
  G.cmsyRK = function (r) {
    return { data: [{ x: r.rk_all.r, y: r.rk_all.k, mode: 'markers', name: '全部抽樣', marker: { size: 3, color: '#d0d0d0' } },
      { x: r.rk_viable.r, y: r.rk_viable.k, mode: 'markers', name: '可行組合', marker: { size: 4, color: LBLUE } },
      { x: r.sel_r, y: r.sel_k, mode: 'markers', name: '選用組合（r 上半部）', marker: { size: 4, color: BLUE } },
      { x: [U.median(r.sel_r)], y: [U.median(r.sel_k)], mode: 'markers', name: '最可能值', marker: { size: 16, color: RED, symbol: 'cross' } }],
      layout: base(`r–k 抽樣（可行 ${r.n_viable.toLocaleString()} / ${r.n_draw.toLocaleString()} 組）`, { xaxis: ax('r', { type: 'log' }), yaxis: ax('k', { type: 'log' }) }) };
  };
  G.cmsyCatch = function (r, unit) {
    const m = r.est.find(e => e.參數 === 'MSY'), x = r.year;
    return { data: [{ x, y: r.catch, mode: 'lines+markers', name: '漁獲量', line: { color: '#333' } }],
      layout: base('漁獲量與 MSY（95% 區間）', { xaxis: ax('年'), yaxis: ax(`漁獲量（${unit || '公噸'}）`, { rangemode: 'tozero' }),
        shapes: [{ type: 'rect', xref: 'x domain', yref: 'y', x0: 0, x1: 1, y0: m['2.5%'], y1: m['97.5%'], fillcolor: alpha(GREEN, 0.15), line: { width: 0 } },
                 { type: 'line', xref: 'x domain', yref: 'y', x0: 0, x1: 1, y0: m.中位數, y1: m.中位數, line: { color: GREEN, width: 2, dash: 'dash' } }],
        annotations: [{ xref: 'x domain', yref: 'y', x: 0.01, y: m.中位數, text: 'MSY', showarrow: false, yshift: 9, font: { color: GREEN } }] }) };
  };
  /** B/Bmsy、F/Fmsy 雙子圖；bb、ff 為 [[年, 下限, 中位數, 上限], …] */
  G.ratios = function (yr, bb, ff, title) {
    const L = base(title || '', { showlegend: false }), g = grid(L, 1, 2, 0.1);
    L[g[0].xa].title.text = '年'; L[g[1].xa].title.text = '年'; L[g[0].ya].title.text = 'B / Bmsy'; L[g[1].ya].title.text = 'F / Fmsy';
    const mk = (m, col, k) => [band(yr, m.map(v => v[1]), m.map(v => v[3]), col, null, { xaxis: g[k].x, yaxis: g[k].y }),
      { x: yr, y: m.map(v => v[2]), mode: 'lines', line: { color: col, width: 2.5 }, xaxis: g[k].x, yaxis: g[k].y }];
    L[g[0].ya].rangemode = 'tozero'; L[g[1].ya].rangemode = 'tozero';
    L.shapes = [hline(1, g[0]), hline(1, g[1])];
    L.annotations = ['相對生物量 B/Bmsy', '相對漁獲死亡率 F/Fmsy'].map((t, k) => ({ text: '<b>' + t + '</b>', xref: g[k].x + ' domain', yref: g[k].y + ' domain', x: 0.5, y: 1.1, showarrow: false }));
    if (!title) L.margin.t = 34;
    return { data: mk(bb, BLUE, 0).concat(mk(ff, RED, 1)), layout: L };
  };
  G.kobe = function (years, bb, ff, bbL, ffL, title) {
    const okL = bbL.map((v, i) => Number.isFinite(v) && Number.isFinite(ffL[i]));
    const bl = bbL.filter((_, i) => okL[i]), fl = ffL.filter((_, i) => okL[i]);
    const xm = Math.max(2, ...bb.map(v => v * 1.1), U.quantile(bl, 0.95)), ym = Math.max(2, ...ff.map(v => v * 1.1), U.quantile(fl, 0.95));
    const p = { red: 0, orange: 0, yellow: 0, green: 0 }; bl.forEach((b, i) => { const f = fl[i]; if (b < 1 && f > 1) p.red++; else if (b >= 1 && f > 1) p.orange++; else if (b < 1) p.yellow++; else p.green++; });
    Object.keys(p).forEach(k => p[k] = p[k] / bl.length);
    const step = Math.max(1, Math.floor(bl.length / 2500)), n = years.length;
    const shapes = [[0, 1, 0, 1, ZONE.yellow], [1, xm, 1, ym, ZONE.orange], [0, 1, 1, ym, ZONE.red], [1, xm, 0, 1, ZONE.green]]
      .map(([x0, x1, y0, y1, c]) => ({ type: 'rect', xref: 'x', yref: 'y', x0, x1, y0, y1, fillcolor: c, line: { width: 0 }, layer: 'below' }));
    const zl = [['紅區（過漁且資源過低）', p.red, ZONE.red], ['橘區（正在過漁）', p.orange, ZONE.orange], ['黃區（資源過低）', p.yellow, ZONE.yellow], ['綠區（健康）', p.green, ZONE.green]];
    const data = [{ x: bl.filter((_, i) => i % step === 0), y: fl.filter((_, i) => i % step === 0), mode: 'markers', marker: { size: 3, color: 'rgba(40,40,40,0.25)' }, name: years[n - 1] + ' 年事後分布', hoverinfo: 'skip' },
      { x: bb, y: ff, mode: 'lines+markers', line: { color: '#111', width: 1.4 }, marker: { size: 5, color: '#111' }, text: years.map(String), hovertemplate: '%{text}<br>B/Bmsy=%{x:.2f}<br>F/Fmsy=%{y:.2f}<extra></extra>', name: '歷年軌跡' },
      { x: [bb[0]], y: [ff[0]], mode: 'markers+text', text: [String(years[0])], textposition: 'top center', marker: { symbol: 'square', size: 13, color: '#fff', line: { color: '#000', width: 1.5 } }, name: '起始年' },
      { x: [bb[n - 1]], y: [ff[n - 1]], mode: 'markers+text', text: [String(years[n - 1])], textposition: 'top center', marker: { symbol: 'triangle-up', size: 15, color: '#fff', line: { color: '#000', width: 1.5 } }, name: '最近年' }]
      .concat(zl.map(([t, v, c]) => ({ x: [null], y: [null], mode: 'markers', marker: { symbol: 'square', size: 12, color: c }, name: `${t} ${Math.round(100 * v)}%` })));
    return { data, probs: p, layout: base(title || 'Kobe 資源狀態圖', { shapes, xaxis: ax('B / Bmsy', { range: [0, xm] }), yaxis: ax('F / Fmsy', { range: [0, ym] }),
      legend: { x: 1, xanchor: 'right', y: 1, bgcolor: 'rgba(255,255,255,0.88)', bordercolor: '#999', borderwidth: 1, font: { size: 11 } } }) };
  };

  // ======================================================================== 貝氏剩餘生產量模型
  G.spmFits = function (fit) {
    const nI = fit.names.length, L = base('', { showlegend: false }), g = grid(L, nI, 1, 0, 0.14 / Math.max(1, nI - 1) + 0.06), data = [];
    fit.names.forEach((nm, i) => {
      const r = fit.resid.filter(x => x.name === nm), x = r.map(v => v.year);
      data.push(band(x, r.map(v => v.lci), r.map(v => v.uci), BLUE, null, { xaxis: g[i].x, yaxis: g[i].y }));
      data.push({ x, y: r.map(v => v.hat), mode: 'lines', line: { color: BLUE, width: 2.5 }, name: '配適值', xaxis: g[i].x, yaxis: g[i].y });
      data.push({ x, y: r.map(v => v.obs), mode: 'markers', marker: { color: '#fff', size: 8, line: { color: '#111', width: 1.5 } }, name: '觀測值', xaxis: g[i].x, yaxis: g[i].y,
        error_y: { type: 'data', symmetric: false, array: r.map(v => v.obs * (Math.exp(1.96 * v.toe) - 1)), arrayminus: r.map(v => v.obs * (1 - Math.exp(-1.96 * v.toe))), color: '#888', thickness: 1, width: 0 } });
      L[g[i].ya].title.text = nm; L[g[i].ya].rangemode = 'tozero'; L[g[i].xa].title.text = i === nI - 1 ? '年' : '';
    });
    L.margin.t = 20;
    return { data, layout: L };
  };
  G.spmResid = function (fit) {
    const pal = [BLUE, RED, GREEN, '#8E44AD', '#D68910', '#17A589'];
    const data = fit.names.map((nm, i) => { const r = fit.resid.filter(x => x.name === nm); return { x: r.map(v => v.year), y: r.map(v => v.residual), mode: 'lines+markers', name: nm, line: { color: pal[i % 6], width: 1.2 }, marker: { size: 7 } }; });
    return { data, layout: base('對數殘差（log 觀測值 − log 配適值）', { xaxis: ax('年'), yaxis: ax('殘差'), shapes: [hline(0)] }) };
  };
  G.spmRuns = function (fit) {
    const nI = fit.names.length, cols = Math.min(nI, 2), rows = Math.ceil(nI / cols), L = base('', { showlegend: false }), g = grid(L, rows, cols, 0.1, 0.18), data = [], shapes = [], ann = [];
    fit.names.forEach((nm, i) => {
      const r = fit.resid.filter(x => x.name === nm), rt = FS.spm.runsTest(r.map(v => v.residual)), x = r.map(v => v.year);
      const col = rt.p > 0.05 ? alpha(GREEN, 0.25) : alpha(RED, 0.25);
      shapes.push({ type: 'rect', xref: g[i].x + ' domain', yref: g[i].y, x0: 0, x1: 1, y0: rt.lcl, y1: rt.ucl, fillcolor: col, line: { width: 0 }, layer: 'below' }, hline(0, g[i]));
      data.push({ x, y: r.map(v => v.residual), mode: 'lines+markers', line: { color: '#333', width: 1 }, marker: { size: 7, color: r.map(v => (v.residual < rt.lcl || v.residual > rt.ucl) ? RED : '#fff'), line: { color: '#111', width: 1.2 } }, xaxis: g[i].x, yaxis: g[i].y });
      ann.push({ text: `<b>${nm}</b>（runs p = ${rt.p.toFixed(3)}）`, xref: g[i].x + ' domain', yref: g[i].y + ' domain', x: 0.5, y: 1.13, showarrow: false });
      L[g[i].ya].title.text = '殘差'; L[g[i].xa].title.text = '年';
    });
    Object.assign(L, { shapes, annotations: ann }); L.margin.t = 40;
    return { data, layout: L };
  };
  G.spmPriorPost = function (fit) {
    const L = base('', { showlegend: true }), g = grid(L, 1, 3, 0.08), pr = fit.prior, data = [];
    const items = [['K', fit.post.K, pr.lK, pr.sdK, 'K'], ['r', fit.post.r, pr.lr, pr.sdr, 'r'], ['psi', fit.post.psi, pr.lpsi, pr.sdpsi, 'ψ（起始 B/K）']];
    items.forEach(([k, v, ml, sd, lab], j) => {
      const h = hist(v, 40), area = v.length * h.w;
      const lo = Math.min(h.x[0] - h.w, Math.exp(ml - 2.5 * sd)), hi = Math.max(h.x[h.x.length - 1] + h.w, Math.exp(ml + 2.5 * sd));
      const xs = []; for (let k2 = 0; k2 <= 200; k2++) xs.push(lo + (hi - lo) * k2 / 200);
      data.push({ type: 'bar', x: h.x, y: h.y.map(c => c / area), width: h.w, marker: { color: alpha(BLUE, 0.55) }, name: '事後分布', showlegend: j === 0, xaxis: g[j].x, yaxis: g[j].y });
      data.push({ x: xs, y: xs.map(x => U.dlnorm(x, ml, sd)), mode: 'lines', line: { color: '#222', width: 2, dash: 'dash' }, name: '先驗分布', showlegend: j === 0, xaxis: g[j].x, yaxis: g[j].y });
      L[g[j].xa].title.text = lab; L[g[j].ya].title.text = j === 0 ? '密度' : '';
    });
    return { data, layout: L };
  };
  G.spmTrends = function (fit, unit) {
    const L = base('', { showlegend: false }), g = grid(L, 2, 2, 0.1, 0.16), ts = fit.timeseries, yr = fit.yr, data = [];
    const items = [['B', `生物量 B（${unit || '公噸'}）`, BLUE, null], ['H', '收穫率 H = C/B', RED, null], ['BBmsy', 'B / Bmsy', BLUE, 1], ['FFmsy', 'H / Hmsy', RED, 1]];
    const shapes = [];
    items.forEach(([k, lab, col, ref], j) => {
      const s = ts[k];
      data.push(band(yr, s.map(v => v.lci), s.map(v => v.uci), col, null, { xaxis: g[j].x, yaxis: g[j].y }));
      data.push({ x: yr, y: s.map(v => v.mu), mode: 'lines', line: { color: col, width: 2.5 }, xaxis: g[j].x, yaxis: g[j].y });
      L[g[j].ya].title.text = lab; L[g[j].ya].rangemode = 'tozero'; L[g[j].xa].title.text = j >= 2 ? '年' : '';
      if (ref) shapes.push(hline(ref, g[j]));
    });
    if (fit.estimates.SBmsy) shapes.push(hline(fit.estimates.SBmsy.mu, g[0], 'dot', GREEN), hline(fit.estimates.Hmsy.mu, g[1], 'dot', GREEN));
    L.shapes = shapes; return { data, layout: L };
  };
  G.spmPhase = function (fit, unit) {
    const K = fit.estimates.K.mu, r = fit.estimates.r.mu, m = fit.m, xs = [], ys = [];
    for (let k = 0; k <= 200; k++) { const B = K * k / 200, P = B / K; xs.push(B); ys.push(r / (m - 1) * B * (1 - Math.pow(P, m - 1))); }
    const B = fit.timeseries.B.map(v => v.mu);
    return { data: [{ x: xs, y: ys, mode: 'lines', name: '剩餘生產量曲線（中位數參數）', line: { color: GREEN, width: 2.5 } },
      { x: B, y: fit.catch, mode: 'lines+markers', name: '歷年（生物量, 漁獲量）', line: { color: '#333', width: 1 }, marker: { size: 6, color: BLUE }, text: fit.yr.map(String), hovertemplate: '%{text}<extra></extra>' }],
      layout: base('剩餘生產量相位圖', { xaxis: ax(`生物量（${unit || '公噸'}）`, { rangemode: 'tozero' }), yaxis: ax(`剩餘生產量／漁獲量（${unit || '公噸'}）`, { rangemode: 'tozero' }),
        shapes: [{ type: 'line', xref: 'x', yref: 'y domain', x0: fit.estimates.SBmsy.mu, x1: fit.estimates.SBmsy.mu, y0: 0, y1: 1, line: { dash: 'dash', color: '#333', width: 1 } }] }) };
  };
  G.spmRetro = function (hc) {
    const L = base('', { showlegend: true }), g = grid(L, 1, 2, 0.1), data = [], pal = ['#111', BLUE, RED, GREEN, '#8E44AD', '#D68910', '#17A589', '#7F8C8D', '#2E86C1', '#CB4335', '#229954'];
    const rho = FS.spm.mohnsRho(hc);
    hc.forEach((h, k) => {
      const N = h.yr.length, end = k === 0 ? N : N - h.peel, yr = h.yr.slice(0, end), nm = k === 0 ? '參考（全部資料）' : `${h.yr[N - 1 - h.peel]}`;
      ['BBmsy', 'FFmsy'].forEach((q, j) => data.push({ x: yr, y: h.timeseries[q].slice(0, end).map(v => v.mu), mode: 'lines', name: nm, showlegend: j === 0, legendgroup: nm, line: { color: pal[k % pal.length], width: k === 0 ? 3 : 1.6 }, xaxis: g[j].x, yaxis: g[j].y }));
    });
    L[g[0].ya].title.text = 'B / Bmsy'; L[g[1].ya].title.text = 'F / Fmsy'; L[g[0].xa].title.text = '年'; L[g[1].xa].title.text = '年';
    L.shapes = [hline(1, g[0]), hline(1, g[1])];
    L.annotations = [`B/Bmsy（Mohn's ρ = ${rho.BBmsy.toFixed(3)}）`, `F/Fmsy（Mohn's ρ = ${rho.FFmsy.toFixed(3)}）`].map((t, k) => ({ text: '<b>' + t + '</b>', xref: g[k].x + ' domain', yref: g[k].y + ' domain', x: 0.5, y: 1.1, showarrow: false }));
    L.margin.t = 34; return { data, layout: L };
  };
  G.spmHindcast = function (hc) {
    const ref = hc[0], D = ref._D, N = ref.yr.length, nI = D.names.length, cols = Math.min(nI, 2), rows = Math.ceil(nI / cols);
    const L = base('', { showlegend: false }), g = grid(L, rows, cols, 0.1, 0.18), data = [], ann = [];
    const ms = FS.spm.mase(hc), maxp = Math.max(...hc.slice(1).map(h => h.peel));
    D.names.forEach((nm, i) => {
      const x = ref.yr, o = D.I[i];
      data.push({ x, y: o, mode: 'markers', marker: { color: '#fff', size: 7, line: { color: '#111', width: 1.2 } }, xaxis: g[i].x, yaxis: g[i].y });
      data.push({ x, y: ref.ihat[i], mode: 'lines', line: { color: '#111', width: 2.5 }, xaxis: g[i].x, yaxis: g[i].y });
      hc.slice(1).forEach(h => {
        const t = N - h.peel; if (t >= N) return;
        data.push({ x: [x[t - 1], x[t]], y: [h.ihat[i][t - 1], h.ihat[i][t]], mode: 'lines+markers', line: { color: BLUE, width: 1.5, dash: 'dot' }, marker: { size: 6, color: BLUE }, xaxis: g[i].x, yaxis: g[i].y });
      });
      const m = ms.find(z => z.Index === nm);
      ann.push({ text: `<b>${nm}</b>（MASE = ${m && Number.isFinite(m.MASE) ? m.MASE.toFixed(2) : '—'}）`, xref: g[i].x + ' domain', yref: g[i].y + ' domain', x: 0.5, y: 1.13, showarrow: false });
      L[g[i].xa].range = [x[Math.max(0, N - maxp - 8)] - 0.5, x[N - 1] + 0.5]; L[g[i].ya].title.text = '指標'; L[g[i].xa].title.text = '年';
    });
    L.annotations = ann; L.margin.t = 40; return { data, layout: L };
  };
  G.projection = function (pr) {
    const L = base('', { showlegend: true }), g = grid(L, 1, 2, 0.1), data = [], n = pr.median.length;
    const col = k => { const t = n > 1 ? k / (n - 1) : 0; const c1 = [30, 123, 79], c2 = [242, 193, 78], c3 = [179, 38, 30]; const mix = t < 0.5 ? [c1, c2, t * 2] : [c2, c3, (t - 0.5) * 2]; const c = mix[0].map((v, i) => Math.round(v + (mix[1][i] - v) * mix[2])); return `rgb(${c.join(',')})`; };
    pr.median.forEach((m, k) => ['bb', 'ff'].forEach((q, j) => data.push({ x: pr.years, y: m[q], mode: 'lines', name: `${m.pct >= 0 ? '+' : ''}${Math.round(100 * m.pct)}%`, legendgroup: 'g' + k, showlegend: j === 0, line: { color: col(k), width: 2 }, xaxis: g[j].x, yaxis: g[j].y })));
    L[g[0].ya].title.text = 'B/Bmsy（中位數）'; L[g[1].ya].title.text = 'F/Fmsy（中位數）'; L[g[0].xa].title.text = '年'; L[g[1].xa].title.text = '年';
    const mxB = Math.max(1.2, ...pr.median.flatMap(m => m.bb)) * 1.05, mxF = Math.max(1.2, ...pr.median.flatMap(m => m.ff));
    L[g[0].ya].range = [0, mxB]; L[g[1].ya].range = [0, Math.min(mxF * 1.05, 4)];   // 資源崩潰時 F/Fmsy 會極大，限制顯示範圍
    L.shapes = [hline(1, g[0]), hline(1, g[1])];
    L.annotations = ['預測：相對生物量', '預測：相對漁獲死亡率'].map((t, k) => ({ text: '<b>' + t + '</b>', xref: g[k].x + ' domain', yref: g[k].y + ' domain', x: 0.5, y: 1.1, showarrow: false }));
    L.margin.t = 34; return { data, layout: L };
  };
  G.catchBars = function (yr, c, unit) {
    return { data: [{ type: 'bar', x: yr, y: c, marker: { color: '#5B8BC9' }, name: '漁獲量' }],
      layout: base('', { showlegend: false, xaxis: ax('年'), yaxis: ax(`漁獲量（${unit || '公噸'}）`, { rangemode: 'tozero' }), bargap: 0.15 }) };
  };
})(typeof self !== 'undefined' ? self : globalThis);
