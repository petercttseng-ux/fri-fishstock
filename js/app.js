/* =============================================================================
 * FRI-FishStock 網頁版：介面與流程控制
 * 授權：GPL-3
 * ===========================================================================*/
(function () {
  'use strict';
  const FS = window.FS, U = FS.util, G = FS.charts;
  FS.APP_NAME = 'FRI-FishStock 漁業資源評估系統（網頁版）';
  FS.APP_VERSION = '1.0.0';
  const $ = id => document.getElementById(id);
  const S = { cp: {}, lf: {}, cm: {}, spm: {} };
  const EX = { logbook: 'data/example_logbook.csv', lfq: 'data/example_lfq.csv', catch: 'data/example_catch_cpue.csv', se: 'data/example_cpue_se.csv' };

  // ======================================================================== 共用工具
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'success'} border-0`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    $('toasts').appendChild(el); const t = new bootstrap.Toast(el, { delay: type === 'error' ? 12000 : 5000 }); t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }
  const busy = {
    show(msg) { $('busy_msg').textContent = msg || '計算中…'; $('busy_bar').style.width = '0%'; $('busy').classList.remove('d-none'); },
    prog(p, msg) { $('busy_bar').style.width = Math.round(100 * Math.min(1, p)) + '%'; if (msg) $('busy_msg').textContent = msg; },
    hide() { $('busy').classList.add('d-none'); }
  };
  async function guard(msg, fn) {
    busy.show(msg);
    try { return await fn(); } catch (e) { console.error(e); toast('執行失敗：' + (e.message || e), 'error'); return null; } finally { busy.hide(); }
  }
  /** 表格：rows 為物件陣列；opts.fill(row, key) 回傳背景色；opts.max 最多列數 */
  function table(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<div class="empty">尚無資料</div>';
    const cols = Object.keys(rows[0]), max = opts.max || rows.length;
    const fmt = (v, k) => {
      if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '—';
      if (typeof v === 'number') { if (/^\s*(年|year|Year)\s*$/.test(k)) return String(v); return Math.abs(v) >= 1e4 ? Math.round(v).toLocaleString('en-US') : String(U.signif(v, 5)); }
      return esc(v);
    };
    const body = rows.slice(0, max).map(r => '<tr>' + cols.map(k => {
      const v = r[k], bg = opts.fill ? opts.fill(r, k) : null, cls = typeof v === 'number' ? 'num' : '';
      const extra = k === '判定' ? (v === '通過' ? ' pass' : v === '未通過' ? ' fail' : '') : '';
      return `<td class="${cls}${extra}"${bg ? ` style="background:${bg}"` : ''}>${fmt(v, k)}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="tbl-wrap"><table class="table table-sm table-hover fs-tab"><thead><tr>${cols.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` +
      (rows.length > max ? `<div class="small text-muted">僅顯示前 ${max} 筆，共 ${rows.length.toLocaleString()} 筆。</div>` : '');
  }
  const plotCfg = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'], toImageButtonOptions: { format: 'png', scale: 2 } };
  function plot(id, spec) { const el = $(id); el.dataset.has = '1'; return Plotly.react(el, spec.data, spec.layout, plotCfg); }
  function vbox(title, value, sub, cls) { return `<div class="col"><div class="vbox vb-${cls || 'primary'}"><div class="t">${esc(title)}</div><div class="v">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div></div>`; }
  function numVal(id) { const v = $(id).value; return v === '' ? NaN : Number(v); }
  function parseNums(s) { return String(s || '').split(/[,，、\s]+/).map(Number).filter(Number.isFinite); }
  function sel(id, opts, selected, allowEmpty) {
    return `<select class="form-select form-select-sm" id="${id}">${allowEmpty ? `<option value="">${esc(allowEmpty)}</option>` : ''}${opts.map(o => `<option${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  function checklist(id, opts, checked) {
    return `<div class="checklist" id="${id}">${opts.map((o, i) => `<div class="form-check"><input class="form-check-input" type="checkbox" id="${id}_${i}" value="${esc(o)}"${checked.includes(o) ? ' checked' : ''}><label class="form-check-label" for="${id}_${i}">${esc(o)}</label></div>`).join('')}</div>`;
  }
  const checkedOf = id => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(x => x.value);
  const radio = name => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
  const guess = (names, re, fallback) => { const hit = names.find(n => re.test(n)); return hit !== undefined ? hit : (fallback !== undefined ? fallback : (names[0] || '')); };
  function xlsxDownload(sheets, filename) {
    const wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(n => { const rows = sheets[n]; if (rows && rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n.slice(0, 31)); });
    XLSX.writeFile(wb, filename);
  }
  const store = { get(k, d) { try { const v = localStorage.getItem('fristock.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem('fristock.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式等 */ } } };

  // ---------------------------------------------------------------- 讀檔
  async function readFile(file) {
    const buf = await file.arrayBuffer();
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
        .map(r => r.map(v => v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : v));
      return U.rowsToTable(rows.filter(r => r.some(v => v !== null && v !== '')));
    }
    return U.parseCSV(U.decodeText(buf));
  }
  async function readUrl(url) { const r = await fetch(url); if (!r.ok) throw new Error('無法讀取範例檔：' + url); return U.parseCSV(U.decodeText(await r.arrayBuffer())); }
  const preview = (t, n) => { const rows = []; for (let i = 0; i < Math.min(t.n, n); i++) { const o = {}; t.names.forEach(h => o[h] = t.cols[h][i]); rows.push(o); } return rows; };

  // ---------------------------------------------------------------- 工作執行緒池
  const pool = (() => {
    const size = Math.max(2, Math.min(navigator.hardwareConcurrency || 2, 6)), workers = [], queue = [], cbs = new Map();
    let nextId = 1;
    for (let i = 0; i < size; i++) { const w = new Worker('js/worker.js'); w.busy = false; w.onmessage = ev => onMsg(w, ev.data); w.onerror = e => { const c = cbs.get(w.job); if (c) { cbs.delete(w.job); c.reject(new Error(e.message || '運算執行緒錯誤')); } w.busy = false; pump(); }; workers.push(w); }
    function onMsg(w, d) {
      const c = cbs.get(d.id); if (!c) return;
      if (d.progress !== undefined) { if (c.prog) c.prog(d.progress); return; }
      cbs.delete(d.id); w.busy = false; pump();
      if (d.error) c.reject(new Error(d.error)); else c.resolve(d.result);
    }
    function pump() { const w = workers.find(x => !x.busy); if (!w || !queue.length) return; const j = queue.shift(); w.busy = true; w.job = j.id; w.postMessage({ id: j.id, task: j.task, args: j.args }); pump(); }
    return { size, run(task, args, prog) { return new Promise((resolve, reject) => { const id = nextId++; cbs.set(id, { resolve, reject, prog }); queue.push({ id, task, args }); pump(); }); } };
  })();

  // ---------------------------------------------------------------- 導覽
  function showPage(p) {
    document.querySelectorAll('.page').forEach(s => s.classList.toggle('d-none', s.id !== 'page-' + p));
    document.querySelectorAll('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === p));
    setTimeout(() => document.querySelectorAll(`#page-${p} .plot[data-has]`).forEach(el => Plotly.Plots.resize(el)), 50);
  }
  document.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); history.replaceState(null, '', '#' + a.dataset.page); showPage(a.dataset.page);
    a.scrollIntoView({ block: 'nearest', inline: 'center' }); }));
  document.querySelectorAll('[data-tabs]').forEach(ul => ul.addEventListener('click', e => {
    const a = e.target.closest('[data-tab]'); if (!a) return; e.preventDefault();
    ul.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('active', x === a); const p = $(x.dataset.tab); if (p) p.classList.toggle('d-none', x !== a); });
    setTimeout(() => { const p = $(a.dataset.tab); if (p) p.querySelectorAll('.plot[data-has]').forEach(el => Plotly.Plots.resize(el)); }, 30);
  }));
  function gotoTab(tab) { const a = document.querySelector(`[data-tab="${tab}"]`); if (a) a.click(); }

  // ---------------------------------------------------------------- 首頁
  $('guide').innerHTML = table([
    { 資料情況: '只有歷年漁獲量', 建議方法: 'CMSY（漁獲量模型）', 本系統分頁: '④ 漁獲量模型', 主要限制: '高度依賴先驗設定，僅作初步判斷' },
    { 資料情況: '有月別體長資料（數月至數年）', 建議方法: 'ELEFAN 成長參數 → 漁獲曲線 → 開發率、體長指標', 本系統分頁: '③ 體長頻度分析', 主要限制: '漁具選擇性、樣本代表性、年齡未驗證' },
    { 資料情況: '有作業層級漁獲與努力量（原始日誌）', 建議方法: 'CPUE 標準化（GLM／Delta）→ 產出豐度指標', 本系統分頁: '② CPUE 標準化', 主要限制: 'CPUE 不一定與資源量成正比' },
    { 資料情況: '有歷年漁獲量 ＋ 豐度指標（CPUE），約 10 年以上', 建議方法: '貝氏剩餘生產量模型 → Kobe 圖、決策風險表', 本系統分頁: '⑤ 生物量模型', 主要限制: '需檢查收斂、殘差、回溯與預測能力' }]);

  // ======================================================================== ② CPUE
  function cpCols() {
    const t = S.cp.tab, nm = t.names, nn = U.numericCols(t), chr = nm.filter(h => !t.numeric[h]);
    $('cp_cols').innerHTML =
      `<label class="form-label">年別欄位</label>${sel('cp_year', nm, guess(nm, /year|年/i))}
       <label class="form-label">CPUE 來源</label>
       <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="cp_ytype" id="cp_yt1" value="ce" checked><label class="form-check-label" for="cp_yt1">漁獲量 ÷ 努力量</label></div>
       <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="cp_ytype" id="cp_yt2" value="cpue"><label class="form-check-label" for="cp_yt2">直接指定 CPUE 欄</label></div>
       <div id="cp_ce"><label class="form-label">漁獲量欄位</label>${sel('cp_catch', nn, guess(nn, /catch|漁獲/i))}<label class="form-label">努力量欄位</label>${sel('cp_effort', nn, guess(nn, /effort|努力/i))}</div>
       <div id="cp_cp" class="d-none"><label class="form-label">CPUE 欄位</label>${sel('cp_cpue', nn, guess(nn, /cpue/i))}</div>
       <label class="form-label">類別型變數（季別、海區、船型…）</label>${checklist('cp_fac', nm, chr)}
       <label class="form-label">連續型變數（水深、海溫…）</label>${checklist('cp_cov', nn, [])}
       <label class="form-label">交互作用（兩個類別變數，可空白）</label>
       <div class="row g-1"><div class="col-6">${sel('cp_i1', nm, '', '（無）')}</div><div class="col-6">${sel('cp_i2', nm, '', '（無）')}</div></div>`;
    document.querySelectorAll('input[name="cp_ytype"]').forEach(r => r.addEventListener('change', () => { const ce = radio('cp_ytype') === 'ce'; $('cp_ce').classList.toggle('d-none', !ce); $('cp_cp').classList.toggle('d-none', ce); }));
    $('cp_preview').innerHTML = table(preview(t, 500), { max: 500 });
  }
  async function cpLoad(tab, demo) { S.cp.tab = tab; S.cp.demo = demo; S.cp.res = null; cpCols(); toast(`已讀入 ${tab.n.toLocaleString()} 筆資料。`); }
  $('cp_file').addEventListener('change', e => e.target.files[0] && guard('讀取檔案…', async () => cpLoad(await readFile(e.target.files[0]), false)));
  $('cp_demo').addEventListener('click', e => { e.preventDefault(); guard('讀取範例資料…', async () => cpLoad(await readUrl(EX.logbook), true)); });
  $('cp_run').addEventListener('click', () => {
    if (!S.cp.tab) return toast('請先上傳資料或載入範例資料。', 'warning');
    const yr = $('cp_year').value, i1 = $('cp_i1').value, i2 = $('cp_i2').value, fac = checkedOf('cp_fac').filter(f => f !== yr);
    const inter = i1 && i2 && i1 !== i2 ? [i1, i2] : [];
    if (inter.length && !inter.every(x => fac.includes(x))) return toast('交互作用之兩個變數須同時勾選為類別型變數。', 'warning');
    const opt = { year: yr, cpue: radio('cp_ytype') === 'cpue' ? $('cp_cpue').value : null, catchCol: $('cp_catch') && $('cp_catch').value, effortCol: $('cp_effort') && $('cp_effort').value,
      factors: fac, covars: checkedOf('cp_cov').filter(c => c !== yr && !fac.includes(c)), interact: inter, method: radio('cp_method'), nsim: Math.max(200, numVal('cp_nsim') || 1000) };
    guard('CPUE 標準化計算中…', async () => { S.cp.res = await pool.run('cpue', { tab: S.cp.tab, opt }); S.cp.nsim = opt.nsim; cpShow(); gotoTab('cp-idx'); });
  });
  function cpIndexRows() { return S.cp.res.index.map(i => ({ 年: i.year, 名目CPUE: U.signif(i.nominal, 4), 標準化CPUE: U.signif(i.std, 4), '下限2.5%': U.signif(i.lci, 4), '上限97.5%': U.signif(i.uci, 4), 相對指標: U.round(i.std_rel, 3), 'log尺度SE': U.round(i.log_se, 4) })); }
  function cpShow() {
    const r = S.cp.res;
    $('cp_note').innerHTML = `<div class="alert alert-info py-2">${esc(r.note)}</div>`;
    plot('cp_plot', G.cpueIndex(r)); $('cp_index').innerHTML = table(cpIndexRows());
    $('cp_stats').innerHTML = table(r.fit_stats) + `<pre class="small mb-0" style="white-space:pre-wrap">模型公式：\n${esc(r.formula.join('\n'))}</pre>`;
    $('cp_anova').innerHTML = r.method === 'delta' ? `<h6>第一步：出現機率（二項 GLM）</h6>${table(r.anova_bin)}<h6>第二步：正值 CPUE（對數常態 GLM）</h6>${table(r.anova_pos)}` : table(r.anova_pos);
    $('cp_step').innerHTML = table(r.stepwise); plot('cp_resid', G.cpueResid(r));
  }
  $('cp_dl').addEventListener('click', () => { const r = S.cp.res; if (!r) return toast('請先執行標準化。', 'warning');
    const sh = { 標準化指標: cpIndexRows(), 模型摘要: r.fit_stats, ANOVA: r.anova_pos, 因子貢獻: r.stepwise }; if (r.anova_bin) sh.ANOVA_二項模型 = r.anova_bin; xlsxDownload(sh, 'CPUE標準化結果.xlsx'); });
  $('cp_send').addEventListener('click', () => {
    const r = S.cp.res; if (!r) return toast('請先執行標準化。', 'warning');
    S.spm.extra = { year: r.index.map(i => i.year), idx: r.index.map(i => i.std_rel), se: r.index.map(i => i.log_se) };
    if (S.spm.tab) jbCols(); toast('已將標準化指標（含 log SE）加入 ⑤ 生物量模型的指標清單。');
  });

  // ======================================================================== ③ 體長
  function lfCols() {
    const nm = S.lf.tab.names;
    $('lf_cols').innerHTML = `<label class="form-label">日期欄（YYYY-MM-DD）</label>${sel('lf_date', nm, guess(nm, /date|日期/i))}
      <label class="form-label">體長欄</label>${sel('lf_len', nm, guess(nm, /length|體長|FL|TL/i))}
      <label class="form-label">頻度欄（每列為一尾則選「無」）</label>${sel('lf_freq', nm, guess(nm, /freq|頻度|尾數/i, ''), '無')}`;
    ['lf_date', 'lf_len', 'lf_freq'].forEach(id => $(id).addEventListener('change', lfBuild));
  }
  function lfBuild() {
    try {
      S.lf.lfq = FS.lfq.build(S.lf.tab, $('lf_date').value, $('lf_len').value, $('lf_freq').value || null, Math.max(0.1, numVal('lf_bin') || 1));
      S.lf.res = S.lf.boot = S.lf.mort = null;
      plot('lf_rawplot', G.lfqRaw(S.lf.lfq)); $('lf_samples').innerHTML = table(FS.lfq.sampleTable(S.lf.lfq));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function lfLoad(tab, demo) {
    S.lf.tab = tab; S.lf.demo = demo; lfCols();
    if (demo) { $('lf_bin').value = 2; $('lf_ma').value = 7; $('lf_linf0').value = 100; $('lf_linf1').value = 160; $('lf_k0').value = 0.1; $('lf_k1').value = 1; }
    lfBuild();
    if (S.lf.lfq && !demo) { const mx = S.lf.lfq.Lmax_obs; $('lf_linf0').value = Math.round(mx * 0.8); $('lf_linf1').value = Math.round(mx * 1.3); }
    gotoTab('lf-raw');
  }
  $('lf_file').addEventListener('change', e => e.target.files[0] && guard('讀取檔案…', async () => lfLoad(await readFile(e.target.files[0]), false)));
  $('lf_demo').addEventListener('click', e => { e.preventDefault(); guard('讀取範例資料…', async () => lfLoad(await readUrl(EX.lfq), true)); });
  $('lf_bin').addEventListener('change', () => S.lf.tab && lfBuild());
  const lfOpt = () => ({ MA: numVal('lf_ma'), Linf_range: [numVal('lf_linf0'), numVal('lf_linf1')], K_range: [numVal('lf_k0'), numVal('lf_k1')], popSize: numVal('lf_pop'), maxiter: numVal('lf_iter') });
  function lfCheck(o) {
    if (!S.lf.lfq) { toast('請先上傳體長資料或載入範例資料。', 'warning'); return false; }
    if (o.MA % 2 === 0) { toast('MA 須為奇數。', 'error'); return false; }
    if (!(o.Linf_range[1] > o.Linf_range[0]) || !(o.K_range[1] > o.K_range[0])) { toast('搜尋範圍之上限須大於下限。', 'error'); return false; }
    return true;
  }
  $('lf_run').addEventListener('click', () => { const o = lfOpt(); if (!lfCheck(o)) return;
    guard('ELEFAN 遺傳演算法搜尋中…', async () => { S.lf.res = await pool.run('lfqElefan', { lfq: S.lf.lfq, opt: o }); S.lf.mort = null; lfShowPar(); gotoTab('lf-par'); }); });
  function lfShowPar() {
    const r = S.lf.res, p = r.par, l = S.lf.lfq, bf = Object.keys(r.boundary_flag).filter(k => r.boundary_flag[k]).map(k => k === 'Linf' ? 'L∞' : 'K');
    $('lf_parbox').innerHTML = (bf.length ? `<div class="alert alert-danger">注意：${bf.join('、')} 估計值貼近搜尋邊界，可能受邊界限制，建議放寬範圍重新估計。</div>` : '') +
      `<div class="row row-cols-2 row-cols-md-5 g-2 mb-2">${vbox('L∞（cm）', p.Linf.toFixed(2))}${vbox('K（年⁻¹）', p.K.toFixed(3))}${vbox('t_anchor', p.t_anchor.toFixed(3), '', 'grey')}${vbox("φ'", r.phiL.toFixed(3), '', 'grey')}${vbox('Rn 分數', r.Rn_max.toFixed(3), '', 'grey')}</div>` +
      `<p class="text-muted small">觀測最大體長 ${l.Lmax_obs.toFixed(1)} cm；樣本數 ${l.raw_n.toLocaleString()} 尾。一組最佳配適不等於已驗證的年齡，請搭配 Bootstrap 檢視不確定性。</p>`;
    plot('lf_fit', G.lfqFit(l, p, r.settings.MA));
  }
  $('lf_boot').addEventListener('click', () => { const o = lfOpt(); if (!lfCheck(o)) return;
    const nb = Math.max(5, numVal('lf_nboot') || 20), nw = Math.min(pool.size, nb), per = Math.ceil(nb / nw);
    guard('Bootstrap 重抽樣中…', async () => {
      const prog = new Array(nw).fill(0);
      const parts = await Promise.all(Array.from({ length: nw }, (_, w) => pool.run('lfqBoot', { lfq: S.lf.lfq, opt: Object.assign({}, o, { nboot: Math.min(per, nb - w * per), popSize: Math.max(30, Math.round(o.popSize * 0.7)), maxiter: Math.max(30, Math.round(o.maxiter * 0.7)), seed: 1 + 1000 * w }) },
        p => { prog[w] = p; busy.prog(U.mean(prog)); })));
      const draws = U.flat(parts.map(p => p.draws));
      const nm = [['L∞', 'Linf'], ['K', 'K'], ['t_anchor', 't_anchor'], ["φ'", 'phiL']];
      S.lf.boot = { draws, summary: nm.map(([lab, k]) => { const v = draws.map(d => d[k]); return { 參數: lab, 中位數: U.round(U.median(v), 3), '2.5%': U.round(U.quantile(v, 0.025), 3), '97.5%': U.round(U.quantile(v, 0.975), 3) }; }) };
      plot('lf_bplot', G.lfqBoot(S.lf.boot)); $('lf_btab').innerHTML = table(S.lf.boot.summary); gotoTab('lf-boot');
    }); });
  $('lf_mort').addEventListener('click', () => {
    if (!S.lf.res) return toast('請先執行 ELEFAN。', 'warning');
    try {
      const p = S.lf.res.par, Mt = FS.lfq.mEmpirical(p.Linf, p.K, numVal('lf_temp'), numVal('lf_tmax'), $('lf_school').checked);
      const want = ['Then et al. (2015) 成長參數式', 'Pauly', '最大年齡'][Number($('lf_msel').value)];
      let row = Mt.find(m => m.方法.includes(want));
      if (!row) { row = Mt[0]; toast('所選 M 方法缺少必要輸入，改用 Then 成長參數式。', 'warning'); }
      const reg = parseNums($('lf_reg').value), ri = reg.length === 2 ? [reg[0] - 1, reg[1] - 1] : null;
      const cc = FS.lfq.catchCurve(S.lf.lfq, p.Linf, p.K, row.M, ri);
      const ind = FS.lfq.indicators(S.lf.lfq, p.Linf, p.K, row.M, numVal('lf_lm50'));
      S.lf.mort = { Mt, M: row.M, cc, ind };
      $('lf_mtab').innerHTML = table(Mt) + table([{ 項目: '採用自然死亡率 M', 數值: row.M.toFixed(3) }, { 項目: '全死亡率 Z（±95%）', 數值: `${cc.Z.toFixed(3)} ± ${(1.96 * cc.se).toFixed(3)}` },
        { 項目: '漁獲死亡率 F = Z − M', 數值: cc.F.toFixed(3) }, { 項目: '開發率 E = F/Z', 數值: cc.E.toFixed(2) }, { 項目: '50% 選擇體長 L50', 數值: Number.isFinite(cc.L50) ? cc.L50.toFixed(1) : '—' },
        { 項目: '迴歸區間（體長組序號）', 數值: `${cc.reg_int[0] + 1}–${cc.reg_int[1] + 1}` }]);
      plot('lf_cc', G.catchCurve(cc)); $('lf_ind').innerHTML = table(ind.table); gotoTab('lf-mort');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('lf_dl').addEventListener('click', () => { const r = S.lf.res; if (!r) return toast('請先執行 ELEFAN。', 'warning'); const p = r.par;
    const sh = { 成長參數: [['Linf', p.Linf], ['K', p.K], ['t_anchor', p.t_anchor], ["phi'", r.phiL], ['Rn', r.Rn_max]].map(([a, b]) => ({ 參數: a, 數值: b })) };
    if (S.lf.boot) { sh.Bootstrap摘要 = S.lf.boot.summary; sh.Bootstrap抽樣 = S.lf.boot.draws; }
    if (S.lf.mort) { sh.自然死亡率 = S.lf.mort.Mt; sh.體長指標 = S.lf.mort.ind.table; }
    xlsxDownload(sh, '體長頻度分析結果.xlsx'); });

  // ======================================================================== ④ CMSY
  function cmCols() {
    const nn = U.numericCols(S.cm.tab);
    $('cm_cols').innerHTML = `<label class="form-label">年欄位</label>${sel('cm_year', nn, guess(nn, /year|年/i))}<label class="form-label">漁獲量欄位</label>${sel('cm_catch', nn, guess(nn, /catch|漁獲/i))}`;
    ['cm_year', 'cm_catch'].forEach(id => $(id).addEventListener('change', cmPriors)); cmPriors();
  }
  function cmXY() { const t = S.cm.tab, y = t.cols[$('cm_year').value], c = t.cols[$('cm_catch').value]; const o = y.map((v, i) => [v, c[i]]).filter(p => Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]); return { year: o.map(p => p[0]), catch: o.map(p => p[1]) }; }
  function cmPriors() {
    if (!S.cm.tab) return;
    const x = cmXY(), rr = FS.cmsyRRange($('cm_res').value), ok = x.catch.map(Number.isFinite);
    const bk = FS.cmsyBkDefault(x.year.filter((_, i) => ok[i]), x.catch.filter((_, i) => ok[i]), rr);
    $('cm_r0').value = rr[0]; $('cm_r1').value = rr[1]; $('cm_sbk0').value = bk.start[0]; $('cm_sbk1').value = bk.start[1]; $('cm_ebk0').value = bk.end[0]; $('cm_ebk1').value = bk.end[1];
    $('cm_sbk_lab').textContent = `起始年（${x.year[0]}）B/k 下限`; $('cm_ebk_lab').textContent = `末年（${x.year[x.year.length - 1]}）B/k 下限`;
  }
  $('cm_res').addEventListener('change', cmPriors);
  $('cm_useint').addEventListener('change', () => $('cm_intbox').classList.toggle('d-none', !$('cm_useint').checked));
  async function cmLoad(tab, demo) { S.cm.tab = tab; S.cm.demo = demo; S.cm.res = null; cmCols(); toast(`已讀入 ${tab.n} 年資料。`); }
  $('cm_file').addEventListener('change', e => e.target.files[0] && guard('讀取檔案…', async () => cmLoad(await readFile(e.target.files[0]), false)));
  $('cm_demo').addEventListener('click', e => { e.preventDefault(); guard('讀取範例資料…', async () => cmLoad(await readUrl(EX.catch), true)); });
  $('cm_run').addEventListener('click', () => {
    if (!S.cm.tab) return toast('請先上傳資料或載入範例資料。', 'warning');
    const x = cmXY(), useI = $('cm_useint').checked;
    const opt = { year: x.year, catch: x.catch, r_range: [numVal('cm_r0'), numVal('cm_r1')], bk_start: [numVal('cm_sbk0'), numVal('cm_sbk1')], bk_end: [numVal('cm_ebk0'), numVal('cm_ebk1')],
      bk_int: useI ? [numVal('cm_ibk0'), numVal('cm_ibk1')] : null, bk_int_year: useI ? numVal('cm_iyr') : null, n: Math.max(5000, numVal('cm_n') || 30000) };
    guard('CMSY 蒙地卡羅抽樣中…', async () => { S.cm.res = await pool.run('cmsy', { opt }); cmShow(); gotoTab('cm-est'); });
  });
  function cmShow() {
    const r = S.cm.res, unit = store.get('rp_unit', '公噸');
    $('cm_est').innerHTML = table(r.est); plot('cm_catch', G.cmsyCatch(r, unit)); plot('cm_rk', G.cmsyRK(r)); plot('cm_traj', G.ratios(r.year, r.BBmsy, r.FFmsy));
    plot('cm_kobe', G.kobe(r.year, r.BBmsy.map(v => v[2]), r.FFmsy.map(v => v[2]), r.BB_last, r.FF_last, 'Kobe 資源狀態圖（CMSY）'));
  }
  $('cm_dl').addEventListener('click', () => { const r = S.cm.res; if (!r) return toast('請先執行 CMSY。', 'warning');
    const t = m => m.map(v => ({ 年: v[0], '2.5%': v[1], 中位數: v[2], '97.5%': v[3] })); xlsxDownload({ 估計值: r.est, 'B/Bmsy': t(r.BBmsy), 'F/Fmsy': t(r.FFmsy) }, 'CMSY結果.xlsx'); });

  // ======================================================================== ⑤ 貝氏剩餘生產量模型
  function jbCols() {
    const t = S.spm.tab, nn = U.numericCols(t), yc = guess(nn, /year|年/i), cc = guess(nn, /catch|漁獲量/i), idx = nn.filter(n => n !== yc && n !== cc);
    $('jb_cols').innerHTML = `<label class="form-label">年欄位</label>${sel('jb_year', nn, yc)}<label class="form-label">漁獲量欄位</label>${sel('jb_catch', nn, cc)}
      <label class="form-label">豐度指標欄位${S.spm.extra ? '（另含 ② 送來之「標準化CPUE」）' : ''}</label>${checklist('jb_idx', idx, idx)}
      ${S.spm.extra ? '<div class="form-check mt-1"><input class="form-check-input" type="checkbox" id="jb_useextra" checked><label class="form-check-label" for="jb_useextra">納入 ② 之標準化 CPUE</label></div>' : ''}`;
  }
  async function jbLoad(tab, demo) {
    S.spm.tab = tab; S.spm.demo = demo; S.spm.fit = null;
    if (demo) { S.spm.se = await readUrl(EX.se); $('jb_se2').checked = true; jbSeMode(); $('jb_sestat').textContent = '已載入範例標準誤檔。'; }
    jbCols(); toast(demo ? '已載入範例資料與對應之標準誤檔。' : `已讀入 ${tab.n} 年資料。`);
  }
  function jbSeMode() { const f = radio('jb_semode') === 'file'; $('jb_cvbox').classList.toggle('d-none', f); $('jb_sebox').classList.toggle('d-none', !f); }
  document.querySelectorAll('input[name="jb_semode"]').forEach(r => r.addEventListener('change', jbSeMode));
  document.querySelectorAll('input[name="jb_rmode"]').forEach(r => r.addEventListener('change', () => { const ln = radio('jb_rmode') === 'lnorm'; $('jb_rres_box').classList.toggle('d-none', ln); $('jb_rln_box').classList.toggle('d-none', !ln); }));
  $('jb_kcustom').addEventListener('change', () => $('jb_kbox').classList.toggle('d-none', !$('jb_kcustom').checked));
  $('jb_quick').addEventListener('change', () => $('jb_mcbox').classList.toggle('d-none', $('jb_quick').checked));
  $('jb_file').addEventListener('change', e => e.target.files[0] && guard('讀取檔案…', async () => jbLoad(await readFile(e.target.files[0]), false)));
  $('jb_sefile').addEventListener('change', e => e.target.files[0] && guard('讀取檔案…', async () => { S.spm.se = await readFile(e.target.files[0]); $('jb_sestat').textContent = `已讀入標準誤檔：${S.spm.se.names.slice(1).join('、')}`; }));
  $('jb_demo').addEventListener('click', e => { e.preventDefault(); guard('讀取範例資料…', async () => jbLoad(await readUrl(EX.catch), true)); });

  function jbInput() {
    const t = S.spm.tab, yc = $('jb_year').value, cc = $('jb_catch').value, idx = checkedOf('jb_idx');
    const ord = t.cols[yc].map((y, i) => [y, i]).filter(p => Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]);
    const years = ord.map(p => p[0]), pick = col => ord.map(p => t.cols[col][p[1]]);
    const indices = {}, se = {}; idx.forEach(n => indices[n] = pick(n));
    const semode = radio('jb_semode'), cv = numVal('jb_cv');
    if (semode === 'file') {
      if (!S.spm.se) throw new Error('請上傳標準誤檔，或改用固定 CV。');
      const st = S.spm.se, sy = st.names[0], miss = idx.filter(n => !st.names.includes(n));
      if (miss.length) throw new Error('標準誤檔缺少欄位：' + miss.join('、'));
      idx.forEach(n => se[n] = years.map(y => { const k = st.cols[sy].indexOf(y); return k >= 0 ? st.cols[n][k] : null; }));
    } else idx.forEach(n => se[n] = years.map(() => Math.sqrt(Math.log(1 + cv * cv))));
    if (S.spm.extra && $('jb_useextra') && $('jb_useextra').checked) {
      const ex = S.spm.extra; indices['標準化CPUE'] = years.map(y => { const k = ex.year.indexOf(y); return k >= 0 ? ex.idx[k] : null; });
      se['標準化CPUE'] = years.map(y => { const k = ex.year.indexOf(y); return k >= 0 ? ex.se[k] : null; });
    }
    if (!Object.keys(indices).length) throw new Error('請至少選擇一個豐度指標。');
    const rmode = radio('jb_rmode');
    return { input: { years, catch: pick(cc), indices, se, model: $('jb_model').value, rDist: rmode === 'range' ? 'range' : 'lnorm',
      rPrior: rmode === 'range' ? FS.cmsyRRange($('jb_rres').value) : [numVal('jb_rmu'), numVal('jb_rsd')],
      kPrior: $('jb_kcustom').checked && Number.isFinite(numVal('jb_kmu')) ? [numVal('jb_kmu'), numVal('jb_kcv') || 1] : null, psiPrior: [numVal('jb_psimu'), numVal('jb_psicv')] },
      semode, cv };
  }
  $('jb_run').addEventListener('click', () => {
    if (!S.spm.tab) return toast('請先上傳資料或載入範例資料。', 'warning');
    let J; try { J = jbInput(); FS.spm.prepare(J.input); } catch (e) { return toast(e.message, 'error'); }
    const quick = $('jb_quick').checked;
    const mc = quick ? Object.assign({}, FS.spm.quickMC) : { ni: Math.max(2000, numVal('jb_ni')), nb: Math.max(500, numVal('jb_nb')), nt: Math.max(1, numVal('jb_nt')), nc: Math.min(4, Math.max(1, numVal('jb_nc'))) };
    if (mc.nb >= mc.ni) return toast('燒入期須小於疊代數。', 'error');
    const peels = Math.max(0, Math.min(10, numVal('jb_peels') || 0));
    guard('MCMC 抽樣中…', async () => {
      const t0 = performance.now(), pr = new Array(mc.nc).fill(0);
      const chains = await Promise.all(Array.from({ length: mc.nc }, (_, c) => pool.run('spmChain', { input: J.input, mc, c }, p => { pr[c] = p; busy.prog(0.65 * U.mean(pr), `MCMC 抽樣中…（${mc.nc} 條鏈平行執行）`); })));
      busy.prog(0.66, '彙整事後分布…');
      const fit = await pool.run('spmSummarize', { input: J.input, mc, chains });
      let hc = null;
      if (peels > 0) {
        const pp = new Array(peels).fill(0);
        const res = await Promise.all(Array.from({ length: peels }, (_, k) => pool.run('spmPeel', { input: J.input, peel: k + 1, init: fit.final }, p => { pp[k] = p; busy.prog(0.7 + 0.3 * U.mean(pp), `回溯分析中…（${peels} 年）`); })));
        hc = [fit].concat(res.sort((a, b) => a.peel - b.peel));
      }
      S.spm.fit = fit; S.spm.hc = hc; S.spm.prj = null;
      S.spm.set = { model: J.input.model, semode: J.semode, cv: J.cv, quick, peels };
      S.spm.secs = (performance.now() - t0) / 1000;
      jbShow(); gotoTab('jb-est');
    });
  });
  document.querySelectorAll('input[name="jb_life"]').forEach(r => r.addEventListener('change', () => S.spm.fit && jbDiag()));
  function jbDiag() { S.spm.diag = FS.spm.diagnostics(S.spm.fit, S.spm.hc, radio('jb_life')); $('jb_diag').innerHTML = table(S.spm.diag); }
  function jbShow() {
    const f = S.spm.fit, e = f.estimates, b = e['B_Bmsy.cur'], h = e['H_Hmsy.cur'], yl = f.yr[f.yr.length - 1], unit = store.get('rp_unit', '公噸');
    const st = b.mu >= 1 && h.mu <= 1 ? '健康（綠區）' : b.mu < 1 && h.mu > 1 ? '過漁且資源過低（紅區）' : b.mu < 1 ? '資源過低（黃區）' : '正在過漁（橘區）';
    $('jb_status').innerHTML = `<div class="row row-cols-1 row-cols-md-4 g-2 mb-2">${vbox(`${yl} 年 B/Bmsy`, b.mu.toFixed(2), `95%：${b.lci.toFixed(2)}–${b.uci.toFixed(2)}`, b.mu >= 1 ? 'success' : 'warning')}` +
      `${vbox(`${yl} 年 F/Fmsy`, h.mu.toFixed(2), `95%：${h.lci.toFixed(2)}–${h.uci.toFixed(2)}`, h.mu <= 1 ? 'success' : 'danger')}` +
      `${vbox('MSY', Number(e.MSY.mu.toPrecision(4)).toLocaleString(), `95%：${Number(e.MSY.lci.toPrecision(3)).toLocaleString()}–${Number(e.MSY.uci.toPrecision(3)).toLocaleString()}`)}${vbox('資源狀態（中位數）', st, '', 'grey')}</div>` +
      (S.spm.set.quick ? '<div class="alert alert-warning py-2">目前為快速試算，MCMC 抽樣較少；正式評估請取消「快速試算」後重新執行。</div>' : '') +
      (f.mcmc.ntUser ? `<div class="alert alert-info py-2">事後抽樣數過多，為避免瀏覽器記憶體不足，抽稀間隔已由 ${f.mcmc.ntUser} 自動調整為 ${f.mcmc.nt}（保存約 ${f.nDraws.toLocaleString()} 組）。</div>` : '') +
      `<p class="small text-muted">${f.nDraws.toLocaleString()} 組事後抽樣（${f.mcmc.nc} 條鏈）；區塊更新接受率 ${(100 * f.accept).toFixed(0)}%；運算時間 ${S.spm.secs.toFixed(1)} 秒。</p>`;
    $('jb_est').innerHTML = table(FS.spm.estimatesTable(f));
    jbDiag();
    const fitSpec = G.spmFits(f); $('jb_fits').style.height = (200 + 230 * f.names.length) + 'px'; plot('jb_fits', fitSpec);
    plot('jb_resid', G.spmResid(f)); $('jb_runs').style.height = (Math.ceil(f.names.length / 2) * 300 + 80) + 'px'; plot('jb_runs', G.spmRuns(f));
    plot('jb_pp', G.spmPriorPost(f)); plot('jb_trj', G.spmTrends(f, unit));
    plot('jb_kobe', G.kobe(f.yr, f.timeseries.BBmsy.map(v => v.mu), f.timeseries.FFmsy.map(v => v.mu), f.kobe.stock, f.kobe.harvest, 'Kobe 資源狀態圖'));
    plot('jb_phase', G.spmPhase(f, unit));
    if (S.spm.hc) { plot('jb_retro', G.spmRetro(S.spm.hc)); $('jb_hc').style.height = (Math.ceil(f.names.length / 2) * 320 + 80) + 'px'; plot('jb_hc', G.spmHindcast(S.spm.hc)); }
    else { Plotly.purge('jb_retro'); Plotly.purge('jb_hc'); $('jb_retro').innerHTML = '<div class="empty">未執行回溯分析（回溯分析年數 = 0）。</div>'; $('jb_hc').innerHTML = ''; }
    ['jb_prjnote', 'jb_pg', 'jb_pb', 'jb_pf'].forEach(id => $(id).innerHTML = ''); Plotly.purge('jb_prjplot');
  }
  const riskFill = (r, k) => k === '漁獲量情境' ? null : (v => v < 0.25 ? '#E06666' : v < 0.5 ? '#F6B26B' : v < 0.75 ? '#F6E27A' : '#93C47D')(r[k]);
  const pctRows = rows => rows.map(r => { const o = {}; Object.keys(r).forEach(k => o[k] = k === '漁獲量情境' ? r[k] : r[k]); return o; });
  function riskTable(rows) {
    if (!rows) return '';
    const cols = Object.keys(rows[0]);
    return `<div class="tbl-wrap"><table class="table table-sm fs-tab"><thead><tr>${cols.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => '<tr>' + cols.map(k => k === '漁獲量情境' ? `<td>${esc(r[k])}</td>` : `<td class="num" style="background:${riskFill(r, k)}">${Math.round(100 * r[k])}%</td>`).join('') + '</tr>').join('')}</tbody></table></div>`;
  }
  $('jb_prjrun').addEventListener('click', () => {
    const f = S.spm.fit; if (!f) return toast('請先執行評估。', 'warning');
    const pct = U.unique(parseNums($('jb_pct').value).map(v => v / 100)).sort((a, b) => a - b);
    if (!pct.length) return toast('請輸入變化比例，例如 -20,0,20', 'error');
    guard('漁獲量情境預測中…', async () => {
      const pj = await pool.run('spmProjection', { fit: f, pct, nyears: Math.max(3, Math.min(30, numVal('jb_nyr') || 10)) });
      S.spm.prj = pj;
      $('jb_prjnote').innerHTML = `<p>基準：近 3 年平均漁獲量 ${Math.round(pj.current).toLocaleString()}。各列為不同漁獲量情境，表格顏色：綠 ≥ 75%、黃 50–75%、橘 25–50%、紅 &lt; 25%。</p>`;
      plot('jb_prjplot', G.projection(pj)); $('jb_pg').innerHTML = riskTable(pj.P_green); $('jb_pb').innerHTML = riskTable(pj.P_B); $('jb_pf').innerHTML = riskTable(pj.P_F);
    });
  });
  $('jb_prjdl').addEventListener('click', () => { const p = S.spm.prj; if (!p) return toast('請先執行預測。', 'warning');
    xlsxDownload({ 資源健康機率: pctRows(p.P_green), 'B大於等於Bmsy機率': pctRows(p.P_B), 'F小於等於Fmsy機率': pctRows(p.P_F) }, '漁獲量情境風險表.xlsx'); });
  $('jb_dl').addEventListener('click', () => {
    const f = S.spm.fit; if (!f) return toast('請先執行評估。', 'warning'); const ts = f.timeseries;
    const traj = f.yr.map((y, i) => ({ 年: y, 漁獲量: f.catch[i], B: ts.B[i].mu, 'B/Bmsy': ts.BBmsy[i].mu, 'B/Bmsy下限': ts.BBmsy[i].lci, 'B/Bmsy上限': ts.BBmsy[i].uci, 'F/Fmsy': ts.FFmsy[i].mu, 'F/Fmsy下限': ts.FFmsy[i].lci, 'F/Fmsy上限': ts.FFmsy[i].uci }));
    const st = Object.keys(f.stats).map(k => ({ 統計量: k, 數值: f.stats[k] }));
    const conv = f.conv.map(c => ({ 參數: c.name, 中位數: c.mu, 'Geweke p': c.geweke, 'Heidelberger-Welch p': c.heidel, 'R-hat': c.rhat }));
    const res = f.resid.map(r => ({ 指標: r.name, 年: r.year, 觀測值: r.obs, 配適值: r.hat, 殘差: r.residual, 標準化殘差: r.stres }));
    xlsxDownload({ 估計值: FS.spm.estimatesTable(f), 診斷檢核: S.spm.diag, 資源趨勢: traj, 配適統計: st, 收斂診斷: conv, 殘差: res }, '生物量模型評估結果.xlsx');
  });

  // ======================================================================== 評估報告
  const modLabel = { cp: '② CPUE 標準化', lf: '③ 體長頻度分析', cm: '④ 漁獲量模型（CMSY）', spm: '⑤ 生物量模型' };
  const has = () => ({ cp: !!S.cp.res, lf: !!S.lf.res, cm: !!S.cm.res, spm: !!S.spm.fit });
  const repModal = new bootstrap.Modal($('repModal'));
  let repMod = null;
  document.querySelectorAll('.rep-btn').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mod, h = has();
    if (!h[m]) return toast({ cp: '請先執行 CPUE 標準化。', lf: '請先執行 ELEFAN 成長參數估計。', cm: '請先執行 CMSY。', spm: '請先執行評估。' }[m], 'warning');
    repMod = m; $('rep_title').textContent = '生成漁業資源評估報告（PDF）｜' + modLabel[m];
    document.querySelectorAll('.rp').forEach(el => { el.value = store.get(el.id, el.id === 'rp_year' ? new Date().getFullYear() : el.id === 'rp_unit' ? '公噸' : ''); });
    const others = Object.keys(h).filter(k => h[k] && k !== m);
    $('rp_others_box').innerHTML = others.length ? `<label class="form-label">一併納入其他已完成之分析結果</label><div>${others.map(k => `<div class="form-check form-check-inline"><input class="form-check-input rp-other" type="checkbox" id="rpo_${k}" value="${k}" checked><label class="form-check-label" for="rpo_${k}">${modLabel[k]}</label></div>`).join('')}</div>` : '';
    repModal.show();
  }));
  document.querySelectorAll('.rp').forEach(el => el.addEventListener('change', () => store.set(el.id, el.value)));
  function repInputs() {
    const v = id => $(id).value;
    const opt = { species: v('rp_species'), area: v('rp_area'), en: v('rp_en'), sci: v('rp_sci'), year: Number(v('rp_year')) || new Date().getFullYear(), unit: v('rp_unit') || '公噸', next: v('rp_next'),
      agency: v('rp_agency'), authors: v('rp_authors'), recent: v('rp_recent'), use: v('rp_use'), fishery: v('rp_fishery'), bio: v('rp_bio'), mgmt: v('rp_mgmt'), target: v('rp_target'), measure: v('rp_measure'), refs: v('rp_refs') };
    const use = [repMod].concat(Array.from(document.querySelectorAll('.rp-other:checked')).map(x => x.value));
    const mods = {};
    if (use.includes('cp')) mods.cp = { res: S.cp.res, nsim: S.cp.nsim };
    if (use.includes('lf')) mods.lf = { lfq: S.lf.lfq, res: S.lf.res, boot: S.lf.boot, mort: S.lf.mort };
    if (use.includes('cm')) mods.cm = { res: S.cm.res };
    if (use.includes('spm')) mods.spm = { fit: S.spm.fit, hc: S.spm.hc, prj: S.spm.prj, set: S.spm.set, diag: S.spm.diag };
    const catchData = mods.spm ? { year: S.spm.fit.yr, catch: S.spm.fit.catch } : mods.cm ? { year: S.cm.res.year, catch: S.cm.res.catch } : null;
    const demo = use.some(k => S[k] && S[k].demo);
    return { opt, mods, catchData, demo };
  }
  async function repBuild() {
    const I = repInputs();
    return FS.report.build(I.opt, I.mods, I.catchData, I.demo, p => busy.prog(p, '繪製報告圖表…'));
  }
  const repName = ext => { const sp = ($('rp_species').value || '').trim().replace(/[\\/:*?"<>|]/g, ''); const d = new Date().toISOString().slice(0, 10).replace(/-/g, ''); return `${sp ? sp + '_' : ''}資源評估報告_${d}.${ext}`; };
  $('rep_go').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) return toast('瀏覽器封鎖了新視窗，請允許本網站開啟彈出式視窗，或改按「下載 HTML 版」。', 'error');
    w.document.write('<p style="font-family:sans-serif;padding:2em">報告產生中，請稍候…</p>');
    guard('產生評估報告中…', async () => {
      const html = await repBuild();
      w.document.open(); w.document.write(html); w.document.close(); w.document.title = repName('pdf').replace(/\.pdf$/, '');
      repModal.hide();
    }).then(r => { if (r === null) { try { w.close(); } catch (e) { /* 已關閉 */ } } });
  });
  $('rep_html').addEventListener('click', () => guard('產生評估報告中…', async () => {
    const html = await repBuild(), url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = repName('html'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }));

  // ======================================================================== 關於
  $('about_title').textContent = `${FS.APP_NAME} ${FS.APP_VERSION}`;
  $('about_ver').textContent = `農業部水產試驗所 AI應用小組｜版本 ${FS.APP_VERSION}｜運算執行緒 ${pool.size} 個`;
  $('about_valid').innerHTML = [
    ['CPUE 標準化（Delta，6,000 筆）：調整後 R²、AIC、ANOVA F 值', '0.477、8953.3（ANOVA 完全相同）', '0.477、8953.3'],
    ['ELEFAN 計分 Rn（L∞ 120、K 0.2、t_anchor 0.3）', '0.189811', '0.189811（TropFishR）'],
    ['體長轉換漁獲曲線 Z（± SE）', '0.4552 ± 0.0034', '0.4552 ± 0.0034（TropFishR）'],
    ['貝氏剩餘生產量模型 K（95% 區間）', '138,400（82,160–224,600）', '140,400（84,890–225,600）（JABBA）'],
    ['MSY（95% 區間）', '12,630（10,470–14,120）', '12,510（10,410–14,120）（JABBA）'],
    ['最近年 B/Bmsy、F/Fmsy', '0.459、1.75', '0.456、1.78（JABBA）'],
    ['RMSE、SDNR、runs test p 值', '18.9%、0.89、0.699／0.753', '18.8%、0.88、0.699／0.753（JABBA）'],
    ["回溯 Mohn's ρ（B/Bmsy、F/Fmsy）、MASE", '0.057、−0.048、1.10', '0.066、−0.068、1.08（JABBA）']
  ].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');

  // ======================================================================== 啟動
  const start = (location.hash || '#home').slice(1);
  showPage(['home', 'cpue', 'lfq', 'cmsy', 'spm', 'about'].includes(start) ? start : 'home');
  window.FSAPP = { S, pool };          // 供測試使用
})();
