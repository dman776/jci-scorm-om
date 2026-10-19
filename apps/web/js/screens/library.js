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
        h('div.lib-item-main', [
          h('span.lib-name', w.title),
          h('span.lib-meta', w.unreadable ? `${w.file} \u00b7 not a readable workbook` : `v${w.version} \u00b7 ${w.sections} section${w.sections === 1 ? '' : 's'} \u00b7 ${w.file}`),
        ]),
        h('div.lib-item-actions', [
          w.unreadable ? null : h('button.btn.small', { onclick: () => onOpen(w.file) }, 'Open'),
          w.unreadable ? null : h('button.btn.small.ghost', { onclick: () => onClone(w.file) }, 'Clone'),
          h('button.btn.small.ghost', { title: 'Rename the file', onclick: () => onRename(w.file) }, 'Rename'),
          h('button.btn.small.ghost', { onclick: () => onDelete(w.file) }, 'Delete'),
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
  async function onRename(file) {
    const entered = window.prompt('New file name (without .json):', file.replace(/\.json$/, ''));
    if (entered === null) return;
    try {
      const { file: renamed } = await api.renameWorkbook(file, entered);
      if (store.file === file) store.setFile(renamed);
      toast('Renamed to ' + renamed, 'success');
      await refreshList();
    } catch (err) { toast('Rename failed: ' + err.message, 'error'); }
  }
  async function onClone(file) {
    try {
      const copy = await api.cloneWorkbook(file);
      toast('Cloned as ' + copy.workbook.title, 'success');
      await refreshList();
    } catch (err) { toast('Clone failed: ' + err.message, 'error'); }
  }
  async function onOpen(file) {
    if (store.dirty && !(await confirmDialog('Open another workbook? Unsaved changes will be lost.'))) return;
    const wb = await api.getWorkbook(file);
    store.set(wb); store.setFile(file); store.markSaved();
    toast('Opened ' + wb.title, 'success');
    navigate('editor');
  }
  async function onDelete(file) {
    if (!(await confirmDialog('Delete this saved workbook? This cannot be undone.'))) return;
    await api.deleteWorkbook(file);
    if (store.file === file) store.setFile(null);
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
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  }
  async function onImportJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    try { store.set(JSON.parse(await file.text())); toast('Project JSON imported', 'success'); navigate('editor'); }
    catch (err) { toast('Invalid JSON: ' + err.message, 'error'); }
  }
  function onExportJson() {
    downloadBlob(new Blob([JSON.stringify(store.workbook, null, 2)], { type: 'application/json' }),
      (store.workbook.id || 'workbook') + '.workbook.json');
  }
}
