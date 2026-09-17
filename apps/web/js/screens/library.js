// @ts-check
import { h, toast, downloadBlob, confirmDialog } from '../ui.js';

export async function renderLibrary(mount, { store, api, navigate }) {
  const inner = h('div.screen-inner', [
    h('h1.screen-title', 'Library'),
    h('p.screen-sub', 'Open a saved workbook, start a new one, import an Excel template, or import/export project JSON.'),
    h('div.card', [
      h('h2.card-title', 'Start'),
      h('div.lib-actions', [
        h('button.btn', { onclick: onNew }, '+ New workbook'),
        h('label.btn.ghost.file-btn', ['Import Excel (.xlsx)', h('input', { type: 'file', accept: '.xlsx', style: 'display:none', onchange: onImportXlsx })]),
        h('label.btn.ghost.file-btn', ['Import project JSON', h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: onImportJson })]),
        h('button.btn.ghost', { onclick: onExportJson }, 'Export project JSON'),
        h('a.btn.ghost', { href: '/api/template.xlsx' }, 'Download Excel template'),
      ]),
    ]),
    h('div.card', [h('h2.card-title', 'Saved workbooks'), h('div', { id: 'lib-list' }, 'Loading...')]),
  ]);
  mount.appendChild(inner);
  await refreshList();

  async function refreshList() {
    const listEl = inner.querySelector('#lib-list');
    listEl.innerHTML = '';
    try {
      const items = await api.listWorkbooks();
      if (!items.length) { listEl.appendChild(h('p.muted', 'No saved workbooks yet.')); return; }
      listEl.appendChild(h('ul.lib-items', items.map((w) => h('li.lib-item', [
        h('div.lib-item-main', [h('span.lib-name', w.title), h('span.lib-meta', `v${w.version} \u00b7 ${w.sections} section${w.sections === 1 ? '' : 's'} \u00b7 ${w.id}`)]),
        h('div.lib-item-actions', [
          h('button.btn.small', { onclick: () => onOpen(w.id) }, 'Open'),
          h('button.btn.small.ghost', { onclick: () => onDelete(w.id) }, 'Delete'),
        ]),
      ]))));
    } catch (err) {
      listEl.appendChild(h('p.error', 'Could not load: ' + err.message));
    }
  }

  async function onNew() {
    if (store.hasContent() && !(await confirmDialog('Start a new workbook? Unsaved changes to the current workbook will be lost.'))) return;
    store.set(await api.newWorkbook());
    toast('New workbook created', 'success');
    navigate('settings');
  }
  async function onOpen(id) {
    if (store.dirty && !(await confirmDialog('Open another workbook? Unsaved changes will be lost.'))) return;
    const wb = await api.getWorkbook(id);
    store.set(wb);
    store.markSaved();
    toast('Opened ' + wb.title, 'success');
    navigate('editor');
  }
  async function onDelete(id) {
    if (!(await confirmDialog('Delete this saved workbook? This cannot be undone.'))) return;
    await api.deleteWorkbook(id);
    toast('Deleted', 'info');
    await refreshList();
  }
  async function onImportXlsx(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { workbook, warnings } = await api.importXlsx(await file.arrayBuffer());
      store.set(workbook);
      toast(`Imported ${workbook.sections.length} sections` + (warnings.length ? ` (${warnings.length} warnings)` : ''), warnings.length ? 'info' : 'success');
      if (warnings.length) console.warn('Import warnings:', warnings);
      navigate('editor');
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  }
  async function onImportJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.set(JSON.parse(await file.text()));
      toast('Project JSON imported', 'success');
      navigate('editor');
    } catch (err) {
      toast('Invalid JSON: ' + err.message, 'error');
    }
  }
  function onExportJson() {
    const blob = new Blob([JSON.stringify(store.workbook, null, 2)], { type: 'application/json' });
    downloadBlob(blob, (store.workbook.id || 'workbook') + '.workbook.json');
  }
}
