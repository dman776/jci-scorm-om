// @ts-check
import { h, toast } from '../ui.js';

export function renderPreview(mount, { store }) {
  const wb = store.workbook;
  const frameWrap = h('div.preview-frame-wrap');
  const iframe = h('iframe.preview-frame', { title: 'Learner preview', src: 'about:blank' });
  frameWrap.appendChild(iframe);

  async function load() {
    if (!wb.sections.length) { toast('Add at least one section before previewing', 'error'); return; }
    try {
      await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wb) });
      iframe.src = '/preview/harness.html?t=' + Date.now();
    } catch (err) {
      toast('Preview failed: ' + err.message, 'error');
    }
  }

  mount.appendChild(h('div.screen-inner', [
    h('h1.screen-title', 'Preview / Learner Simulation'),
    h('p.screen-sub', 'Runs the real runtime player against a mock LMS. Use "Exit + resume" to prove suspend/restore, and toggle the SCORM debug panel to watch the data model.'),
    h('div.preview-toolbar', [
      h('button.btn', { onclick: load }, 'Load / Reload preview'),
      h('span.preview-hint', 'Responses auto-save to cmi.suspend_data. Partially complete sections show in orange.'),
    ]),
    frameWrap,
  ]));
  setTimeout(load, 50);
}
