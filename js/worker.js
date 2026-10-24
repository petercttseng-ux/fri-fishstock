/* FRI-FishStock 網頁版：運算工作執行緒（避免畫面凍結）。授權：GPL-3 */
importScripts('core/util.js', 'core/cpue.js', 'core/lfq.js', 'core/cmsy.js', 'core/spm.js');

const tasks = {
  cpue: (a) => FS.cpueStandardize(a.tab, a.opt),
  lfqElefan: (a) => FS.lfq.elefan(a.lfq, a.opt),
  lfqBoot: (a, prog) => FS.lfq.bootstrap(a.lfq, a.opt, prog),
  cmsy: (a) => FS.cmsyRun(a.opt),
  spmChain: (a, prog) => FS.spm.chain(a.input, a.mc, a.c, a.init || null, prog),
  spmSummarize: (a) => FS.spm.fromChains(a.input, a.mc, a.chains),
  spmPeel: (a, prog) => { const f = FS.spm.run(FS.spm.peelInput(a.input, a.peel), FS.spm.quickMC, prog, a.init); f.peel = a.peel; return FS.spm.slim(f); },
  spmProjection: (a) => FS.spm.projection(a.fit, a.pct, a.nyears, 3)
};

self.onmessage = (ev) => {
  const { id, task, args } = ev.data;
  let last = 0;
  const prog = (p) => { const now = Date.now(); if (now - last > 200) { last = now; self.postMessage({ id, progress: p }); } };
  try {
    const result = tasks[task](args, prog);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: (e && e.message) || String(e) });
  }
};
