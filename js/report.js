/* =============================================================================
 * FRI-FishStock 網頁版：漁業資源評估報告（中文；瀏覽器列印為 PDF）
 * 由 R 版 report.R 移植。章節參考日本水產廳「國際漁業資源の現況」：
 *   標題 → 管理及相關機關 → 最近動態 → 利用及用途 → 漁業概要 → 生物學特性 → 資源狀態
 *   → 將來預測 → 資源評估建議 → 管理方策 → 執筆者 → 參考文獻 → 資源現況摘要表
 * 授權：GPL-3
 * ===========================================================================*/
(function (root) {
  'use strict';
  const FS = root.FS, U = FS.util, G = FS.charts;
  const R = FS.report = {};

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blank = s => s === null || s === undefined || String(s).trim() === '';
  const para = s => blank(s) ? '' : String(s).split('\n').map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('');
  const P = (...a) => `<p>${a.join('')}</p>`;
  const fin = Number.isFinite;
  const f2 = (x, d = 2) => fin(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fbig = x => fin(x) ? Math.round(x).toLocaleString('en-US') : '—';
  const fsig = (x, s = 3) => fin(x) ? Number(x.toPrecision(s)).toLocaleString('en-US', { maximumFractionDigits: 10 }) : '—';
  const fpct = (x, d = 0) => fin(x) ? (100 * x).toFixed(d) + '%' : '—';
  const sgn = v => (v >= 0 ? '+' : '') + Math.round(100 * v) + '%';

  // ---------------------------------------------------------------- 圖表（以代碼編號，最後依版面順序重編）
  function ctx() { return { fig: 0, tab: 0, jobs: [] }; }
  function fig(c, spec, caption, note, w, h, wide) {
    c.fig++; const tok = `{{F${c.fig}}}`, id = `img${c.fig}`;
    c.jobs.push({ id, spec, w: (w || 4.8) * 96, h: (h || 3.4) * 96 });
    return { n: tok, html: `<figure class="${wide ? 'fig wide' : 'fig'}"><img data-id="${id}" alt=""><figcaption>圖 ${tok}. ${esc(caption)}${note ? `<span class="fnote">${esc(note)}</span>` : ''}</figcaption></figure>` };
  }
  function tab(c, rows, caption, note, wide, fill) {
    if (!rows || !rows.length) return { n: '{{T0}}', html: '' };
    c.tab++; const tok = `{{T${c.tab}}}`, cols = Object.keys(rows[0]);
    const cell = (v, nm) => {
      if (/^\s*(年|year|Year)\s*$/.test(nm)) return v === null || v === undefined ? '' : String(v);
      if (typeof v === 'number') return fin(v) ? (Math.abs(v) >= 1000 ? fbig(v) : String(U.signif(v, 4))) : '—';
      return v === null || v === undefined ? '—' : esc(v);
    };
    const body = rows.map((r, i) => '<tr>' + cols.map((k, j) => `<td${j === 0 ? ' class="l"' : ''}${fill && fill[i] && fill[i][j] ? ` style="background:${fill[i][j]}"` : ''}>${cell(r[k], k)}</td>`).join('') + '</tr>').join('');
    return { n: tok, html: `<div class="${wide ? 'tbl wide' : 'tbl'}"><div class="tcap">表 ${tok}. ${esc(caption)}</div><table class="data"><thead><tr>${cols.map(k => `<th>${esc(k.trim())}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>${note ? `<div class="fnote">${esc(note)}</div>` : ''}</div>` };
  }
  function renumber(html) {
    [['F', /<figcaption>圖 \{\{F(\d+)\}\}/g], ['T', /<div class="tcap">表 \{\{T(\d+)\}\}/g]].forEach(([k, re]) => {
      const ids = []; let m; while ((m = re.exec(html))) if (!ids.includes(m[1])) ids.push(m[1]);
      ids.forEach((id, i) => { html = html.split(`{{${k}${id}}}`).join(String(i + 1)); });
    });
    return html.replace(/\{\{[FT]\d+\}\}/g, '—');
  }

  // ---------------------------------------------------------------- 狀態判定
  function zone(b, f) {
    if (!fin(b) || !fin(f)) return { key: 'na', label: '無法判定', text: '資源狀態無法判定' };
    if (b >= 1 && f <= 1) return { key: 'green', label: '綠區（健康）', text: '資源未呈過漁狀態（B ≥ Bmsy），亦無過度漁撈進行中（F ≤ Fmsy）' };
    if (b < 1 && f > 1) return { key: 'red', label: '紅區（過漁且過度漁撈）', text: '資源呈過漁狀態（B < Bmsy），且過度漁撈仍在進行（F > Fmsy）' };
    if (b < 1) return { key: 'yellow', label: '黃區（資源過低）', text: '資源呈過漁狀態（B < Bmsy），惟目前漁撈壓力未超過 Fmsy，資源具回復潛力' };
    return { key: 'orange', label: '橘區（正在過度漁撈）', text: '資源量仍高於 Bmsy，但過度漁撈正在進行（F > Fmsy），若持續將使資源下降' };
  }
  function kprob(bb, ff) {
    let g = 0, y = 0, o = 0, r = 0, pB = 0, pF = 0, n = 0;
    bb.forEach((b, i) => { const f = ff[i]; if (!fin(b) || !fin(f)) return; n++; if (b >= 1) pB++; if (f <= 1) pF++; if (b >= 1 && f <= 1) g++; else if (b < 1 && f <= 1) y++; else if (b >= 1) o++; else r++; });
    return { green: g / n, yellow: y / n, orange: o / n, red: r / n, pB: pB / n, pF: pF / n };
  }

  // ---------------------------------------------------------------- 各章節
  function secCatch(c, year, C, unit) {
    const n = year.length, last5 = year.map((_, i) => i).slice(-5), y5 = last5.map(i => year[i]), c5 = last5.map(i => C[i]);
    const imax = U.argmax(C), imin = C.indexOf(Math.min(...C));
    const F1 = fig(c, G.catchBars(year, C, unit), `漁獲量之年間變化（${year[0]}～${year[n - 1]} 年）`, null, 4.8, 3);
    const k0 = Math.max(0, n - 20); let rows = [];
    for (let i = k0; i < n; i++) rows.push({ 年: year[i], [`漁獲量（${unit}）`]: C[i] });
    if (rows.length > 10) {
      const h = Math.ceil(rows.length / 2), a = rows.slice(0, h), b = rows.slice(h);
      rows = a.map((r, i) => ({ 年: r.年, [`漁獲量（${unit}）`]: r[`漁獲量（${unit}）`], ' 年 ': b[i] ? b[i].年 : null, [` 漁獲量（${unit}） `]: b[i] ? b[i][`漁獲量（${unit}）`] : null }));
    }
    const T1 = tab(c, rows, `近年漁獲量（${year[k0]}～${year[n - 1]} 年，單位：${unit}）`);
    const txt = P(`本資源之年漁獲量介於 ${fbig(Math.min(...C))}～${fbig(Math.max(...C))} ${unit}之間（圖 ${F1.n}）；歷年最高為 ${year[imax]} 年之 ${fbig(C[imax])} ${unit}，最低為 ${year[imin]} 年之 ${fbig(C[imin])} ${unit}。`,
      `最近 5 年（${y5[0]}～${y5[y5.length - 1]} 年）漁獲量介於 ${fbig(Math.min(...c5))}～${fbig(Math.max(...c5))} ${unit}，平均 ${fbig(U.mean(c5))} ${unit}；最近年（${y5[y5.length - 1]} 年）漁獲量為 ${fbig(c5[c5.length - 1])} ${unit}（表 ${T1.n}）。`);
    return { html: txt + F1.html + T1.html,
      summary: `${fbig(Math.min(...c5))}～${fbig(Math.max(...c5))} ${unit}<br>最近（${y5[y5.length - 1]}）年：${fbig(c5[c5.length - 1])} ${unit}<br>平均：${fbig(U.mean(c5))} ${unit}（${y5[0]}～${y5[y5.length - 1]} 年）` };
  }

  function secCpue(c, m) {
    const r = m.res, idx = r.index, n = idx.length, vars = r.factors.concat(r.covars);
    const model = r.method === 'delta' ? 'Delta 對數常態廣義線性模型（Delta-lognormal GLM；Lo et al. 1992）' : '對數常態廣義線性模型（lognormal GLM）';
    const F1 = fig(c, G.cpueIndex(r), `名目與標準化 CPUE 之年間變化（${idx[0].year}～${idx[n - 1].year} 年）`, '以期間平均值規格化（平均 = 1）；陰影為 95% 信賴區間。');
    const T1 = tab(c, idx.map(d => ({ 年: d.year, 名目CPUE: U.round(d.nominal_rel, 3), 標準化CPUE: U.round(d.std_rel, 3), 下限: U.round(d.lci_rel, 3), 上限: U.round(d.uci_rel, 3), 'log SE': U.round(d.log_se, 3) })),
      '標準化 CPUE 指標（相對值，平均 = 1）', '下限、上限為 95% 信賴區間；log SE 可作為生物量模型之觀測誤差。');
    const T2 = tab(c, r.anova_pos, r.method === 'delta' ? '正值 CPUE 模型之變數顯著性（逐項移除檢定）' : '各變數之顯著性（逐項移除檢定）');
    const F2 = fig(c, G.cpueResid(r), 'CPUE 標準化模型之殘差診斷', null, 7.4, 2.8, true);
    const r2 = (r.fit_stats.find(s => /R²/.test(s.項目)) || {}).數值;
    const method = '<h3>【CPUE 標準化】</h3>' + P(`以作業層級資料（${fbig(r.n)} 筆）進行 CPUE 標準化，採用${model}。`,
      vars.length ? `模型除年別外，納入${vars.join('、')}等解釋變數` : '模型僅含年別效應', `（模型式：${esc(r.formula.join('；'))}）`,
      fin(r2) ? `，調整後 R² 為 ${Number(r2).toFixed(3)}。` : '。',
      `年別標準化指標以模型參數之多變量常態模擬（${fbig(m.nsim || 1000)} 次）求得中位數及 95% 信賴區間（表 ${T1.n}、表 ${T2.n}）。`, esc(r.note));
    const rel = idx.map(d => d.std_rel), yrs = idx.map(d => d.year), last3 = U.mean(rel.slice(-3)), k = Math.min(10, n);
    const sl = U.simpleLm(yrs.slice(-k), rel.slice(-k).map(Math.log)).b;
    const trend = !fin(sl) ? '' : sl > 0.02 ? '呈增加趨勢' : sl < -0.02 ? '呈減少趨勢' : '大致持平';
    const status = '<h3>【豐度指標】</h3>' + P(`標準化 CPUE 於 ${yrs[U.argmax(rel)]} 年達最高、${yrs[rel.indexOf(Math.min(...rel))]} 年最低（圖 ${F1.n}）。最近 3 年（${yrs[Math.max(0, n - 3)]}～${yrs[n - 1]} 年）之平均相對指標為 ${last3.toFixed(2)}，`,
      `為全期平均之 ${(100 * last3).toFixed(0)}%、歷年最高值之 ${(100 * last3 / Math.max(...rel)).toFixed(0)}%；近 ${k} 年指標${trend}（年變化率約 ${(100 * (Math.exp(sl) - 1)).toFixed(1)}%）。`,
      `殘差分布及常態 Q-Q 圖如圖 ${F2.n}，應確認殘差大致對稱且無明顯型態，指標方可作為資源量之相對指數。`) + F1.html + T1.html + T2.html + F2.html;
    return { method, status, advice: `標準化 CPUE 近 ${k} 年${trend}，最近 3 年平均為全期平均之 ${(100 * last3).toFixed(0)}%。CPUE 未必與資源量成正比（如漁場集中、漁具效率提升），建議與其他資料（體長組成、科學調查）交叉比對。`,
      refs: ['Maunder, M.N. and Punt, A.E. 2004. Standardizing catch and effort data: a review of recent approaches. Fish. Res., 70: 141-159.'].concat(r.method === 'delta' ? ['Lo, N.C.H., Jacobson, L.D. and Squire, J.L. 1992. Indices of relative abundance from fish spotter data based on delta-lognormal models. Can. J. Fish. Aquat. Sci., 49: 2515-2526.'] : []),
      name: r.method === 'delta' ? 'CPUE 標準化（Delta 對數常態 GLM）' : 'CPUE 標準化（對數常態 GLM）',
      sum: `標準化 CPUE 近 ${k} 年${trend}（最近 3 年平均為全期平均之 ${(100 * last3).toFixed(0)}%）` };
  }

  function secLfq(c, m) {
    const l = m.lfq, r = m.res, p = r.par, mo = m.mort, bt = m.boot, s = r.settings;
    const F1 = fig(c, G.lfqRaw(l), '各採樣月之體長頻度分布', null, 4.8, 3.6);
    const F2 = fig(c, G.lfqFit(l, p, s.MA), 'ELEFAN 重組體長頻度與估計之成長曲線', '紅色曲線為依估計成長參數推算之世代成長軌跡。', 7.4, 4, true);
    let btTxt = '', TB = { html: '', n: '{{T0}}' };
    if (bt) {
      TB = tab(c, bt.summary, `成長參數之 Bootstrap 估計（${bt.draws.length} 次重抽樣）`);
      btTxt = `以 Bootstrap 重抽樣評估不確定性，L∞ 之 95% 區間為 ${f2(bt.summary[0]['2.5%'], 1)}～${f2(bt.summary[0]['97.5%'], 1)} cm，K 為 ${f2(bt.summary[1]['2.5%'], 3)}～${f2(bt.summary[1]['97.5%'], 3)} 年⁻¹（表 ${TB.n}）。`;
    }
    const bf = Object.keys(r.boundary_flag).filter(k => r.boundary_flag[k]).map(k => k === 'Linf' ? 'L∞' : 'K');
    const warn = bf.length ? `惟${bf.join('、')}之估計值貼近搜尋範圍邊界，可能受邊界限制，宜放寬範圍重新估計。` : '';
    let bio = '<h3>【成長】</h3>' + P(`以 ${l.dates.length} 個採樣月、共 ${fbig(l.raw_n)} 尾之體長頻度資料（觀測最大體長 ${l.Lmax_obs.toFixed(1)} cm），利用 ELEFAN 遺傳演算法（演算法依 TropFishR；Mildenberger et al. 2017）估計 von Bertalanffy 成長參數（圖 ${F1.n}、圖 ${F2.n}）。`,
      `估計之極限體長 L∞ 為 ${p.Linf.toFixed(1)} cm、成長係數 K 為 ${p.K.toFixed(3)} 年⁻¹，成長性能指數 φ′ 為 ${r.phiL.toFixed(2)}（Rn = ${r.Rn_max.toFixed(3)}）。`, btTxt, warn,
      'ELEFAN 之結果為體長資料之最佳配適，並非經耳石等驗證之年齡，引用時宜注意。') + F1.html + TB.html;
    const method = '<h3>【體長頻度分析】</h3>' + P(`體長組距 ${l.bin} cm，移動平均跨度 MA = ${s.MA}；L∞ 搜尋範圍 ${s.Linf_range[0]}～${s.Linf_range[1]} cm，K 搜尋範圍 ${s.K_range[0]}～${s.K_range[1]} 年⁻¹。`) + F2.html;
    let status = '', advice = [], sum = `L∞ = ${p.Linf.toFixed(1)} cm、K = ${p.K.toFixed(3)} 年⁻¹`;
    if (mo) {
      const cc = mo.cc, MT = tab(c, mo.Mt, '以經驗式估計之自然死亡係數 M');
      bio += '<h3>【自然死亡係數】</h3>' + P(`自然死亡係數以多種經驗式估計（表 ${MT.n}），本評估採用 M = ${mo.M.toFixed(3)} 年⁻¹。`) + MT.html;
      const F3 = fig(c, G.catchCurve(cc), '體長轉換漁獲曲線');
      const IT = tab(c, mo.ind.table, '體長指標（Froese 2004）');
      const E = cc.E;
      const ej = !fin(E) ? '' : E > 0.5 ? '高於 Gulland（1971）建議之 0.5，顯示漁撈死亡可能偏高，資源有過度利用之虞' : E > 0.4 ? '介於 0.4～0.5，接近 Patterson（1992）建議上限，宜審慎利用' : '低於 0.4，漁撈壓力尚屬適度';
      const pm = mo.ind;
      status = '<h3>【死亡率與開發率】</h3>' + P(`以體長轉換漁獲曲線估計全死亡係數 Z = ${cc.Z.toFixed(3)}（±${(1.96 * cc.se).toFixed(3)}，95%）年⁻¹（圖 ${F3.n}），扣除自然死亡後之漁撈死亡係數 F = ${cc.F.toFixed(3)} 年⁻¹，開發率 E = F/Z = ${E.toFixed(2)}，${ej}。`,
        fin(cc.L50) ? `推估 50% 選擇體長 L50 為 ${cc.L50.toFixed(1)} cm。` : '', `依 Beverton（1992）之理論最佳漁獲體長 Lopt 為 ${pm.Lopt.toFixed(1)} cm；`,
        `漁獲中位於 Lopt ±10% 之比例（P_opt）為 ${(100 * pm.popt).toFixed(1)}%，大型魚比例（P_mega）為 ${(100 * pm.pmega).toFixed(1)}%，`,
        fin(pm.pmat) ? `已成熟個體比例（P_mat）為 ${(100 * pm.pmat).toFixed(1)}%（表 ${IT.n}）。` : `詳表 ${IT.n}。`) + F3.html + IT.html;
      if (fin(E)) advice.push(`體長頻度分析之開發率 E = ${E.toFixed(2)}，${ej}。`);
      if (fin(pm.pmat) && pm.pmat < 0.9) advice.push(`漁獲物中已成熟個體比例僅 ${(100 * pm.pmat).toFixed(0)}%，未成熟魚漁獲比例偏高，可考慮以最小體長限制或漁具網目調整保護幼魚。`);
      if (pm.pmega < 0.3) advice.push(`大型魚比例（P_mega）為 ${(100 * pm.pmega).toFixed(0)}%，低於 Froese（2004）建議之 30～40%，大型親魚可能不足。`);
      sum += `；M = ${mo.M.toFixed(3)}、F = ${cc.F.toFixed(3)}、開發率 E = ${E.toFixed(2)}`;
    }
    const refs = ['Mildenberger, T.K., Taylor, M.H. and Wolff, M. 2017. TropFishR: an R package for fisheries analysis with length-frequency data. Methods Ecol. Evol., 8: 1520-1527.',
      'Pauly, D. 1980. On the interrelationships between natural mortality, growth parameters, and mean environmental temperature in 175 fish stocks. ICES J. Mar. Sci., 39: 175-192.',
      'Then, A.Y., Hoenig, J.M., Hall, N.G. and Hewitt, D.A. 2015. Evaluating the predictive performance of empirical estimators of natural mortality rate using information on over 200 fish species. ICES J. Mar. Sci., 72: 82-92.'];
    if (bt) refs.push('Schwamborn, R., Mildenberger, T.K. and Taylor, M.H. 2019. Assessing sources of uncertainty in length-based estimates of body growth in populations of fishes and macroinvertebrates with bootstrapped ELEFAN. Ecol. Model., 393: 37-51.');
    if (mo) refs.push('Froese, R. 2004. Keep it simple: three indicators to deal with overfishing. Fish Fish., 5: 86-91.', 'Beverton, R.J.H. 1992. Patterns of reproductive strategy parameters in some marine teleost fishes. J. Fish Biol., 41(Suppl. B): 137-160.', 'Gulland, J.A. 1971. The fish resources of the ocean. Fishing News Books, West Byfleet. 255 pp.');
    return { bio, method, status, advice: advice.join(''), refs, name: '體長頻度分析（ELEFAN、體長轉換漁獲曲線）', sum };
  }

  function secCmsy(c, m, unit) {
    const r = m.res, pr = r.priors, ny = r.year.length, yl = r.year[ny - 1], e = r.est, g = (i, k) => e[i][k || '中位數'];
    const pb = kprob(r.BB_last, r.FF_last), b = g(5), f = g(6), z = zone(b, f);
    const ET = tab(c, e, 'CMSY 之參數與參考點估計值', '中位數與 95% 區間。');
    const F1 = fig(c, G.cmsyRK(r), 'CMSY 之 r–k 可行組合分布', null, 4.8, 3.6);
    const F2 = fig(c, G.ratios(r.year, r.BBmsy, r.FFmsy), `CMSY 推估之 B/Bmsy 與 F/Fmsy（${r.year[0]}～${yl} 年）`, '實線為中位數，陰影為 95% 區間；虛線為參考點（= 1）。', 7.4, 3, true);
    const F3 = fig(c, G.kobe(r.year, r.BBmsy.map(v => v[2]), r.FFmsy.map(v => v[2]), r.BB_last, r.FF_last, 'Kobe 資源狀態圖（CMSY）'), `CMSY 之 Kobe 圖（最近年 ${yl} 年之點為事後抽樣分布）`, null, 4.6, 4.4);
    const method = '<h3>【漁獲量模型（CMSY）】</h3>' + P(`僅以 ${r.year[0]}～${yl} 年之漁獲量資料，依 Froese et al.（2017）之 CMSY 方法（Schaefer 剩餘生產量模型之蒙地卡羅法），`,
      `自先驗分布抽取 ${fbig(r.n_draw)} 組 r–k 組合，篩選出可使資源量軌跡符合起始年 B/k（${pr.start[0]}～${pr.start[1]}）與末年 B/k（${pr.end[0]}～${pr.end[1]}）先驗之可行組合 ${fbig(r.n_viable)} 組（圖 ${F1.n}）。`,
      `r 之先驗範圍為 ${pr.r[0]}～${pr.r[1]}。`, pr.int ? `另設定 ${pr.int_year} 年之 B/k 為 ${pr.int[0]}～${pr.int[1]}。` : '') + F1.html;
    const status = '<h3>【資源狀態（CMSY）】</h3>' + P(`CMSY 估計之 MSY 為 ${fsig(g(2))} ${unit}（95% 區間 ${fsig(g(2, '2.5%'))}～${fsig(g(2, '97.5%'))}），Bmsy 為 ${fsig(g(3))} ${unit}（表 ${ET.n}）。`,
      `最近年（${yl} 年）之 B/Bmsy 中位數為 ${b.toFixed(2)}（${g(5, '2.5%').toFixed(2)}～${g(5, '97.5%').toFixed(2)}），F/Fmsy 為 ${f.toFixed(2)}（${g(6, '2.5%').toFixed(2)}～${g(6, '97.5%').toFixed(2)}），${z.text}（圖 ${F2.n}、圖 ${F3.n}）。`,
      `依事後分布，位於綠區之機率為 ${fpct(pb.green)}，B ≥ Bmsy 之機率 ${fpct(pb.pB)}，F ≤ Fmsy 之機率 ${fpct(pb.pF)}。`, 'CMSY 僅使用漁獲量資料，結果高度依賴韌性及 B/k 先驗之設定，宜視為初步評估。') + ET.html + F2.html + F3.html;
    return { method, status, zone: z, advice: `CMSY 初步評估顯示${z.text}（綠區機率 ${fpct(pb.green)}）。`,
      refs: ['Froese, R., Demirel, N., Coro, G., Kleisner, K.M. and Winker, H. 2017. Estimating fisheries reference points from catch and resilience. Fish Fish., 18: 506-526.'],
      name: 'CMSY（漁獲量模型）', sum: `CMSY：${yl} 年 B/Bmsy = ${b.toFixed(2)}、F/Fmsy = ${f.toFixed(2)}，${z.label}` };
  }

  function secSpm(c, m, unit) {
    const fit = m.fit, s = m.set || {}, ts = fit.timeseries, e = fit.estimates, N = fit.yr.length, yl = fit.yr[N - 1];
    const b = e['B_Bmsy.cur'].mu, fh = e['H_Hmsy.cur'].mu, z = zone(b, fh), pb = kprob(fit.kobe.stock, fit.kobe.harvest);
    const mlab = { Schaefer: 'Schaefer', Fox: 'Fox', Pella: 'Pella-Tomlinson' }[fit.model] || fit.model;
    const F1 = fig(c, G.spmFits(fit), '豐度指標之觀測值與模型配適值', '點為觀測值（誤差線為 95% 觀測誤差），線與陰影為配適值中位數及 95% 區間。', 7.4, 1.6 + 1.7 * fit.names.length, true);
    const pr = fit.prior;
    const method = '<h3>【生物量模型（貝氏狀態空間剩餘生產量模型）】</h3>' + P(`資源解析採用貝氏狀態空間剩餘生產量模型，模型結構、先驗分布與診斷依 JABBA（Winker et al. 2018）之公開模型規格，於本系統以 JavaScript 重新實作（MCMC 採 Metropolis-within-Gibbs 抽樣），生產函數為 ${mlab} 型（形狀參數 m = ${fit.m}）。`,
      `輸入資料為 ${fit.yr[0]}～${yl} 年之年漁獲量及 ${fit.names.length} 組豐度指標（${fit.names.join('、')}；圖 ${F1.n}）`,
      s.semode === 'file' ? '，指標之觀測誤差採用 CPUE 標準化所得之 log 尺度標準誤，另估計額外觀測變異。' : `，各指標之觀測誤差設為 CV = ${s.cv ?? '—'}，另估計額外觀測變異。`,
      `r 之先驗分布為對數常態（中位數 ${fsig(Math.exp(pr.lr))}，log SD ${pr.sdr.toFixed(3)}${pr.rDist === 'range' ? `，由範圍 ${pr.rRaw[0]}～${pr.rRaw[1]} 換算` : ''}），`,
      `K 之先驗平均 ${fbig(pr.Kmean)}（CV ${pr.Kcv}），起始年資源量相對於 K 之比值（ψ）先驗平均 ${pr.psiRaw[0]}（CV ${pr.psiRaw[1]}）。`,
      s.quick ? 'MCMC 採快速試算設定（抽樣數較少），結果僅供參考。' : `MCMC 抽樣 ${fbig(fit.mcmc.ni)} 次、燒入期 ${fbig(fit.mcmc.nb)}、抽稀 ${fit.mcmc.nt}、${fit.mcmc.nc} 條鏈。`) + F1.html;
    const ET = tab(c, FS.spm.estimatesTable(fit), '主要參數與參考點估計值', '中位數與 95% 信用區間。');
    const q = k => ts[k].map((v, i) => [fit.yr[i], v.lci, v.mu, v.uci]);
    const F2 = fig(c, G.ratios(fit.yr, q('BBmsy'), q('FFmsy')), `推估之 B/Bmsy 與 F/Fmsy（${fit.yr[0]}～${yl} 年）`, '實線為中位數，陰影為 95% 信用區間；虛線為參考點（= 1）。', 7.4, 3, true);
    const F3 = fig(c, G.kobe(fit.yr, ts.BBmsy.map(v => v.mu), ts.FFmsy.map(v => v.mu), fit.kobe.stock, fit.kobe.harvest, 'Kobe 資源狀態圖'), `Kobe 圖（${fit.yr[0]}～${yl} 年）`, '灰點為最近年之事後抽樣分布；□ 為起始年，△ 為最近年。', 4.6, 4.4);
    const bbmu = ts.BBmsy.map(v => v.mu), bmin = fit.yr[bbmu.indexOf(Math.min(...bbmu))];
    let status = '<h3>【資源狀態（貝氏剩餘生產量模型）】</h3>' + P(`估計之 MSY 為 ${fsig(e.MSY.mu)} ${unit}（95% 信用區間 ${fsig(e.MSY.lci)}～${fsig(e.MSY.uci)}），環境負荷量 K 為 ${fsig(e.K.mu)} ${unit}，內在成長率 r 為 ${e.r.mu.toFixed(3)}（表 ${ET.n}）。`,
      `B/Bmsy 於 ${bmin} 年達最低（${Math.min(...bbmu).toFixed(2)}），最近年（${yl} 年）之 B/Bmsy 中位數為 ${b.toFixed(2)}（${e['B_Bmsy.cur'].lci.toFixed(2)}～${e['B_Bmsy.cur'].uci.toFixed(2)}），F/Fmsy 為 ${fh.toFixed(2)}（${e['H_Hmsy.cur'].lci.toFixed(2)}～${e['H_Hmsy.cur'].uci.toFixed(2)}）（圖 ${F2.n}）。`,
      `依此判斷，${z.text}（圖 ${F3.n}）。依事後分布，最近年位於綠區之機率為 ${fpct(pb.green)}、黃區 ${fpct(pb.yellow)}、橘區 ${fpct(pb.orange)}、紅區 ${fpct(pb.red)}。`) + ET.html + F2.html + F3.html;
    let nfail = 0, fails = [];
    if (m.diag && m.diag.length) {
      nfail = m.diag.filter(d => d.判定 === '未通過').length; fails = m.diag.filter(d => d.判定 === '未通過').map(d => d.診斷項目);
      const fill = m.diag.map(d => Object.keys(d).map(k => k === '判定' ? (d.判定 === '通過' ? '#D9EAD3' : d.判定 === '未通過' ? '#F4CCCC' : null) : null));
      const DT = tab(c, m.diag, '模型診斷檢核表', '診斷標準依 Carvalho et al.（2021）等文獻。', true, fill);
      const FR = m.hc && m.hc.length > 1 ? fig(c, G.spmRetro(m.hc), `回溯分析（${m.hc.length - 1} 年）`, null, 7.4, 3.4, true) : { html: '', n: '{{F0}}' };
      status += '<h3>【模型診斷】</h3>' + P(`依 Carvalho et al.（2021）建議之診斷流程，就 MCMC 收斂、殘差隨機性、配適誤差${m.hc && m.hc.length > 1 ? `、回溯分析（Mohn's ρ；圖 ${FR.n}）及事後預測能力（MASE）` : ''}等項目逐項檢核（表 ${DT.n}）。`,
        nfail === 0 ? '各項診斷均通過，模型結果可作為資源狀態判斷之依據。' : `其中 ${nfail} 項未通過（${fails.join('、')}），解讀資源狀態時應特別審慎，建議檢討指標選擇、先驗設定或模型結構後重新評估。`) + DT.html + FR.html;
    }
    let proj = '', padv = '';
    const pj = m.prj;
    if (pj) {
      const yrs = pj.years.map(y => y + '年'), yend = String(pj.years[pj.years.length - 1]), kend = yrs[yrs.length - 1];
      const FP = fig(c, G.projection(pj), `不同漁獲量情境下之 B/Bmsy 與 F/Fmsy 預測（至 ${yend} 年）`, '各線為各情境預測之中位數；圖例為相對於近 3 年平均漁獲量之變化率。', 7.4, 3.2, true);
      const ny = yrs.length, st = ny <= 7 ? 1 : Math.ceil(ny / 6), show = []; for (let k = 0; k < ny; k += st) show.push(k); if (show[show.length - 1] !== ny - 1) show.push(ny - 1);
      const zc = v => v < 0.25 ? '#E06666' : v < 0.5 ? '#F6B26B' : v < 0.75 ? '#F6E27A' : '#93C47D';
      const rows = pj.P_green.map(r => { const o = { 漁獲量情境: r.漁獲量情境 }; show.forEach(k => o[yrs[k]] = fpct(r[yrs[k]])); return o; });
      const fill = pj.P_green.map(r => [null].concat(show.map(k => zc(r[yrs[k]]))));
      const RT = tab(c, rows, '各漁獲量情境下資源健康（B ≥ Bmsy 且 F ≤ Fmsy）之機率（風險表）', '顏色：綠 ≥ 75%、黃 50–75%、橘 25–50%、紅 < 25%。', true, fill);
      const fn = pj.P_green.map(r => r[kend]), i0 = pj.pct.findIndex(v => Math.abs(v) < 1e-9);
      const ok = pj.pct.map((p, i) => i).filter(i => fn[i] >= 0.6), best = ok.length ? ok.reduce((a, i) => pj.pct[i] > pj.pct[a] ? i : a, ok[0]) : -1;
      proj = P(`以事後分布，就近 3 年平均漁獲量（${fbig(pj.current)} ${unit}）之 ${pj.pct.map(sgn).join('、')} 等 ${pj.pct.length} 種漁獲量情境，進行 ${ny} 年之隨機預測（圖 ${FP.n}、表 ${RT.n}）。`,
        i0 >= 0 ? `維持近 3 年平均漁獲量時，${yend} 年資源健康之機率為 ${fpct(fn[i0])}。` : '',
        best >= 0 ? `在 ${yend} 年資源健康機率達 60% 以上之情境中，漁獲量最高者為 ${sgn(pj.pct[best])}（約 ${fbig(pj.levels[best])} ${unit}）。` : `所有情境於 ${yend} 年之資源健康機率均未達 60%。`) + FP.html + RT.html;
      padv = best >= 0 ? `依將來預測，若將漁獲量控制在近 3 年平均之 ${sgn(pj.pct[best])}（約 ${fbig(pj.levels[best])} ${unit}）以下，${yend} 年資源健康之機率可維持在 60% 以上。`
        : `將來預測顯示，即使在所評估之最低漁獲量情境下，${yend} 年資源健康機率仍未達 60%，宜考慮更大幅度之漁獲削減。`;
    }
    const base = { green: '資源狀態良好，建議維持現行漁獲水準，並持續監測漁獲量與豐度指標之變化。', yellow: '資源量低於 Bmsy，建議採取使資源回復至 Bmsy 以上之措施，並避免漁撈壓力增加。',
      orange: '目前漁撈壓力已超過 Fmsy，建議降低漁撈死亡使 F 不超過 Fmsy，以免資源下降至 Bmsy 以下。', red: '資源已呈過漁且過度漁撈仍在進行，建議儘速採取削減漁獲量或努力量之回復措施。' }[z.key] || '';
    const dadv = nfail ? `惟模型診斷有 ${nfail} 項未通過（${fails.join('、')}），上述判斷之可信度有限，宜先改善模型後再據以研提管理措施。` : '';
    const qadv = s.quick ? '本次為快速試算，正式評估應增加 MCMC 抽樣數並確認收斂。' : '';
    const refs = ['Winker, H., Carvalho, F. and Kapur, M. 2018. JABBA: Just Another Bayesian Biomass Assessment. Fish. Res., 204: 275-288.',
      'Carvalho, F., Winker, H., Courtney, D., Kapur, M., Kell, L., Cardinale, M., Schirripa, M., Kitakado, T., Yemane, D., Piner, K.R., Maunder, M.N., Taylor, I., Wetzel, C.R., Doering, K., Johnson, K.F. and Methot, R.D. 2021. A cookbook for using model diagnostics in integrated stock assessments. Fish. Res., 240: 105959.'];
    if (m.hc && m.hc.length > 1) refs.push('Hurtado-Ferro, F., Szuwalski, C.S., Valero, J.L., Anderson, S.C., Cunningham, C.J., Johnson, K.F., Licandeo, R., McGilliard, C.R., Monnahan, C.C., Muradian, M.L., Ono, K., Vert-Pre, K.A., Whitten, A.R. and Punt, A.E. 2015. Looking in the rear-view mirror: bias and retrospective patterns in integrated, age-structured stock assessment models. ICES J. Mar. Sci., 72: 99-110.',
      'Kell, L.T., Kimoto, A. and Kitakado, T. 2016. Evaluation of the prediction skill of stock assessment using hindcasting. Fish. Res., 183: 119-127.');
    return { method, status, proj, zone: z, advice: `貝氏剩餘生產量模型評估結果顯示${z.text}（綠區機率 ${fpct(pb.green)}）。` + base + padv + dadv + qadv, refs,
      name: `貝氏狀態空間剩餘生產量模型（JABBA 架構，${mlab} 型）`, sum: `貝氏剩餘生產量模型：${yl} 年 B/Bmsy = ${b.toFixed(2)}、F/Fmsy = ${fh.toFixed(2)}，${z.text}。`, projSum: padv };
  }

  // ---------------------------------------------------------------- CSS
  function css(hl, hr, foot) {
    const F = '"Microsoft JhengHei","微軟正黑體","Noto Sans TC","Noto Sans CJK TC","PingFang TC",sans-serif';
    return `
@page { size: A4; margin: 19mm 15mm 17mm 15mm;
  @top-left { content: "${hl}"; font-family: ${F}; font-size: 8.5pt; color: #333; vertical-align: bottom; padding-bottom: 1.5mm; border-bottom: 0.6pt solid #444; }
  @top-center { content: ""; border-bottom: 0.6pt solid #444; }
  @top-right { content: "${hr}"; font-family: ${F}; font-size: 8.5pt; color: #333; vertical-align: bottom; padding-bottom: 1.5mm; border-bottom: 0.6pt solid #444; }
  @bottom-center { content: "${foot}\\A " counter(page); white-space: pre; font-family: ${F}; font-size: 8pt; color: #333; } }
* { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${F}; font-size: 9.3pt; line-height: 1.62; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { max-width: 180mm; margin: 0 auto; }
.toolbar { position: sticky; top: 0; z-index: 10; background: #123B6D; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.toolbar button { background: #fff; color: #123B6D; border: 0; border-radius: 4px; padding: 6px 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
@media print { .toolbar { display: none; } .sheet { max-width: none; } }
@media screen { .sheet { padding: 12mm 0 20mm; } }
.title { text-align: center; margin: 2mm 0 5mm; } .title h1 { font-size: 22pt; letter-spacing: 3pt; margin: 0 0 1mm; font-weight: 700; }
.title h1 .area { font-size: 16pt; margin-left: 8mm; letter-spacing: 1pt; } .title .sub { font-size: 9.5pt; color: #333; } .title .meta { font-size: 8.5pt; color: #555; margin-top: 1.5mm; }
.cols { column-count: 2; column-gap: 7mm; }
h2 { font-size: 11pt; font-weight: 700; margin: 3.5mm 0 1.2mm; break-after: avoid; } h2:first-child { margin-top: 0; }
h3 { font-size: 9.5pt; font-weight: 700; margin: 2.5mm 0 0.8mm; break-after: avoid; }
p { margin: 0 0 1.2mm; text-align: justify; text-indent: 1em; orphans: 2; widows: 2; }
.agency p { text-indent: 0; padding-left: 1em; margin: 0; }
figure { margin: 2mm 0 3mm; break-inside: avoid; } figure img { width: 100%; display: block; }
figcaption { font-size: 8pt; line-height: 1.45; margin-top: 1mm; } .fnote { display: block; font-size: 7.6pt; color: #333; line-height: 1.4; }
.wide { column-span: all; } .tbl { margin: 2mm 0 3mm; break-inside: avoid; } .tcap { font-size: 8pt; margin-bottom: 1mm; }
table.data { border-collapse: collapse; width: 100%; font-size: 7.8pt; line-height: 1.35; }
table.data th { border-top: 0.9pt solid #000; border-bottom: 0.6pt solid #000; padding: 0.8mm 1mm; font-weight: 700; text-align: center; }
table.data td { padding: 0.5mm 1mm; text-align: right; border-bottom: 0.3pt solid #ccc; } table.data td.l { text-align: left; }
table.data tr:last-child td { border-bottom: 0.9pt solid #000; }
.advice { border: 0.6pt solid #1F5FAD; background: #F4F7FB; padding: 2mm 3mm; margin: 2mm 0; break-inside: avoid; } .advice p { text-indent: 0; }
.notice { border: 0.8pt solid #B3261E; color: #B3261E; font-size: 8.5pt; padding: 1.5mm 3mm; margin: 0 0 4mm; text-align: center; }
.refs p { text-indent: -1.5em; padding-left: 1.5em; font-size: 7.8pt; line-height: 1.45; text-align: left; margin-bottom: 0.6mm; }
.authors p { text-indent: 0; } .summary { break-before: page; } .summary h2 { text-align: center; font-size: 11.5pt; margin-bottom: 3mm; }
table.sum { border-collapse: collapse; width: 100%; font-size: 8.8pt; } table.sum th, table.sum td { border: 0.6pt solid #000; padding: 1.5mm 2mm; vertical-align: middle; }
table.sum th { width: 24%; text-align: center; font-weight: 400; } table.sum td { text-align: left; line-height: 1.55; }
.wm { position: fixed; top: 40%; left: 0; width: 100%; text-align: center; font-size: 40pt; font-weight: 700; color: rgba(179,38,30,0.10); transform: rotate(-28deg); z-index: 0; pointer-events: none; }`;
  }

  /**
   * 產生報告 HTML（圖片以 Plotly 轉為 PNG 內嵌）
   * @param opt  報告設定；mods {cp, lf, cm, spm}；catchData {year, catch} | null；demo 是否為範例資料
   */
  R.build = async function (opt, mods, catchData, demo, onProgress) {
    const c = ctx(), unit = blank(opt.unit) ? '公噸' : opt.unit, sp = blank(opt.species) ? '（魚種名稱）' : opt.species, area = opt.area || '';
    const yr = opt.year || new Date().getFullYear(), S = {};
    if (mods.cp) S.cp = secCpue(c, mods.cp);
    const C = catchData && catchData.year.length >= 2 ? secCatch(c, catchData.year, catchData.catch, unit) : null;
    if (mods.lf) S.lf = secLfq(c, mods.lf);
    if (mods.cm) S.cm = secCmsy(c, mods.cm, unit);
    if (mods.spm) S.spm = secSpm(c, mods.spm, unit);
    const list = Object.values(S), names = list.map(x => x.name);
    const main = S.spm || S.cm || null;
    const sec = (t, b) => blank(b) ? '' : `<h2>${esc(t)}</h2>${b}`;
    const autoRecent = P(`本報告以 FRI-FishStock 漁業資源評估系統（網頁版），採用${names.join('、')}進行資源評估。`) + (main ? P(main.sum) : '') + (S.spm && S.spm.projSum ? P(S.spm.projSum) : '');
    const adv = list.map(x => x.advice).filter(a => !blank(a));
    const advice = adv.length ? `<div class="advice">${adv.map((a, i) => `<p>${i + 1}. ${a}</p>`).join('')}<p style="font-size:8pt;color:#444">上述為依模型結果所提之技術性建議，實際管理措施應綜合考量社會經濟等因素，並經相關會議審議。</p></div>` : '';
    const refs = Array.from(new Set(list.flatMap(x => x.refs).concat(blank(opt.refs) ? [] : opt.refs.split('\n').map(s => s.trim()).filter(Boolean)))).sort();
    const row = (h, v) => blank(v) ? '' : `<tr><th>${h}</th><td>${v}</td></tr>`, br = s => blank(s) ? '' : esc(s).replace(/\n/g, '<br>');
    const summary = `<section class="summary"><h2>${esc(sp)}${area ? `（${esc(area)}）` : ''}之資源現況（摘要表）</h2><table class="sum">` +
      row('漁獲量<br>（最近 5 年）', C ? C.summary : '') + row('資源評估方法', esc(names.join('；'))) + row('資源狀態<br>（資源評估結果）', list.map(x => esc(x.sum)).join('<br>')) +
      row('將來預測', S.spm ? esc(S.spm.projSum) : '') + row('管理目標', br(opt.target)) + row('管理措施', br(opt.measure)) + row('管理及<br>相關機關', br(opt.agency)) +
      row('最近之資源評估年', `${yr} 年`) + row('下次資源評估年', blank(opt.next) ? '' : `${esc(opt.next)} 年`) + '</table></section>';
    const sub = [opt.en ? esc(opt.en) : '', opt.sci ? `<i>${esc(opt.sci)}</i>` : ''].filter(Boolean).join(' ');
    const analysis = list.map(x => x.method || '').join(''), status = list.map(x => x.status || '').join('');
    let body = (demo ? '<div class="wm">範例資料（模擬）</div><div class="notice">本報告使用系統內附之範例資料（模擬資料，非真實漁業資料），僅供操作示範，不得作為資源評估結論。</div>' : '') +
      `<div class="title"><h1>${esc(sp)}${area ? `<span class="area">${esc(area)}</span>` : ''}</h1>${sub ? `<div class="sub">（${sub}）</div>` : ''}` +
      `<div class="meta">報告產製日期：${new Date().toISOString().slice(0, 10)}　｜　${esc(FS.APP_NAME)} ${esc(FS.APP_VERSION)}　｜　農業部水產試驗所 AI應用小組</div></div><div class="cols">` +
      (blank(opt.agency) ? '' : `<h2>管理及相關機關</h2><div class="agency">${para(opt.agency)}</div>`) +
      sec('最近動態', blank(opt.recent) ? autoRecent : para(opt.recent)) + sec('利用及用途', para(opt.use)) + sec('漁業概要', para(opt.fishery) + (C ? C.html : '')) +
      sec('生物學特性', para(opt.bio) + (S.lf ? S.lf.bio : '')) + (blank(analysis) && blank(status) ? '' : '<h2>資源狀態</h2>' + analysis + status) +
      sec('將來預測', S.spm ? S.spm.proj : '') + sec('資源評估建議', advice) + sec('管理方策', para(opt.mgmt)) +
      sec('執筆者', blank(opt.authors) ? '' : `<div class="authors">${para(opt.authors)}</div>`) +
      sec('參考文獻', refs.length ? `<div class="refs">${refs.map(r => `<p>${esc(r)}</p>`).join('')}</div>` : '') + '</div>' + summary;
    // 繪製圖片
    const imgs = {};
    for (let k = 0; k < c.jobs.length; k++) {
      const j = c.jobs[k];
      const lay = Object.assign({}, j.spec.layout, { width: j.w, height: j.h });
      try { imgs[j.id] = await root.Plotly.toImage({ data: j.spec.data, layout: lay }, { format: 'png', width: j.w, height: j.h, scale: 2.2 }); } catch (e) { imgs[j.id] = ''; }
      if (onProgress) onProgress((k + 1) / c.jobs.length);
    }
    body = body.replace(/<img data-id="(img\d+)" alt="">/g, (_, id) => `<img src="${imgs[id] || ''}" alt="">`);
    const hl = `${yr} 年度　漁業資源評估報告`, hr = [sp, area].filter(Boolean).join('　').replace(/"/g, "'"), foot = `© ${yr} 農業部水產試驗所 AI應用小組`;
    return renumber(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(sp)} 資源評估報告</title><style>${css(hl, hr, foot)}</style></head><body>` +
      `<div class="toolbar"><button onclick="window.print()">列印／另存為 PDF</button><span>於列印對話框選擇「另存為 PDF」，紙張 A4；建議使用 Microsoft Edge 或 Google Chrome，並勾選「背景圖形」。</span></div>` +
      `<div class="sheet">${body}</div></body></html>`);
  };
})(typeof self !== 'undefined' ? self : globalThis);
