// @ts-check
import { h, toast, downloadBlob, confirmDialog } from '../ui.js';

/** The folder being browsed; survives leaving and returning to the screen. */
let currentFolder = '';

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

  function parentOf(path) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
  function baseOf(path) { return path.slice(path.lastIndexOf('/') + 1); }
  function folderOf(file) { return parentOf(file); }

  async function refreshList() {
    const listEl = inner.querySelector('#lib-list');
    listEl.innerHTML = '';
    try {
      const [items, folders] = await Promise.all([api.listWorkbooks(), api.listFolders()]);
      if (currentFolder && !folders.includes(currentFolder)) currentFolder = '';
      const subfolders = folders.filter((f) => parentOf(f) === currentFolder);
      const here = items.filter((w) => folderOf(w.file) === currentFolder);

      const crumbs = [h('button.btn.small.ghost', { onclick: () => goTo('') }, 'Library')];
      let acc = '';
      for (const seg of currentFolder.split('/').filter(Boolean)) {
        acc = acc ? acc + '/' + seg : seg;
        const target = acc;
        crumbs.push(h('span.lib-sep', '/'), h('button.btn.small.ghost', { onclick: () => goTo(target) }, seg));
      }
      listEl.appendChild(h('div.lib-crumbs', [
        ...crumbs,
        h('span.lib-spacer'),
        currentFolder ? h('button.btn.small.ghost', { onclick: () => onRenameFolder(currentFolder) }, 'Rename folder') : null,
        currentFolder ? h('button.btn.small.ghost', { onclick: () => onDeleteFolder(currentFolder) }, 'Delete folder') : null,
        h('button.btn.small', { onclick: () => onNewFolder() }, '+ New folder'),
      ]));

      if (!subfolders.length && !here.length) {
        listEl.appendChild(h('p.muted', currentFolder ? 'This folder is empty.' : 'No saved workbooks yet.'));
        return;
      }
      const moveTargets = [''].concat(folders);
      listEl.appendChild(h('ul.lib-items', [
        ...subfolders.map((f) => {
          const count = items.filter((w) => w.file.startsWith(f + '/')).length;
          return h('li.lib-item.lib-folder', { onclick: () => goTo(f) }, [
            h('div.lib-item-main', [
              h('span.lib-name', '\ud83d\udcc1 ' + baseOf(f)),
              h('span.lib-meta', `${count} workbook${count === 1 ? '' : 's'}`),
            ]),
          ]);
        }),
        ...here.map((w) => h('li.lib-item', [
          h('div.lib-item-main', [
            h('span.lib-name', w.title),
            h('span.lib-meta', w.unreadable ? `${baseOf(w.file)} \u00b7 not a readable workbook` : `v${w.version} \u00b7 ${w.sections} section${w.sections === 1 ? '' : 's'} \u00b7 ${baseOf(w.file)}`),
          ]),
          h('div.lib-item-actions', [
            h('select.lib-move', { title: 'Move to folder', onchange: (e) => onMove(w.file, e.target.value) }, [
              h('option', { value: '', disabled: true, selected: true }, 'Move to\u2026'),
              ...moveTargets.filter((f) => f !== currentFolder).map((f) => h('option', { value: f === '' ? '/' : f }, f === '' ? 'Library (top level)' : f)),
            ]),
            w.unreadable ? null : h('button.btn.small', { onclick: () => onOpen(w.file) }, 'Open'),
            w.unreadable ? null : h('button.btn.small.ghost', { onclick: () => onClone(w.file) }, 'Clone'),
            h('button.btn.small.ghost', { title: 'Rename the file', onclick: () => onRename(w.file) }, 'Rename'),
            h('button.btn.small.ghost', { onclick: () => onDelete(w.file) }, 'Delete'),
          ]),
        ])),
      ]));
    } catch (err) {
      listEl.appendChild(h('p.error', 'Could not load: ' + err.message));
    }
  }

  function goTo(folder) { currentFolder = folder; return refreshList(); }
  async function onNewFolder() {
    const name = window.prompt(currentFolder ? `New folder inside ${currentFolder}:` : 'New folder name:');
    if (name === null || !name.trim()) return;
    try {
      const { folder } = await api.createFolder((currentFolder ? currentFolder + '/' : '') + name.trim());
      toast('Created folder ' + folder, 'success');
      await goTo(folder);
    } catch (err) { toast('Could not create folder: ' + err.message, 'error'); }
  }
  async function onRenameFolder(folder) {
    const name = window.prompt('New folder name:', baseOf(folder));
    if (name === null) return;
    try {
      const { folder: renamed } = await api.renameFolder(folder, name);
      if (store.file && store.file.startsWith(folder + '/')) store.setFile(renamed + store.file.slice(folder.length));
      toast('Renamed to ' + renamed, 'success');
      await goTo(renamed);
    } catch (err) { toast('Rename failed: ' + err.message, 'error'); }
  }
  async function onDeleteFolder(folder) {
    if (!(await confirmDialog(`Delete the folder ${folder}? Only empty folders can be deleted.`))) return;
    try { await api.deleteFolder(folder); toast('Folder deleted', 'info'); await goTo(parentOf(folder)); }
    catch (err) { toast('Could not delete folder: ' + err.message, 'error'); }
  }
  async function onMove(file, folder) {
    try {
      const { file: moved } = await api.moveWorkbook(file, folder === '/' ? '' : folder);
      if (store.file === file) store.setFile(moved);
      toast('Moved to ' + (folder === '/' ? 'Library' : folder), 'success');
    } catch (err) { toast('Move failed: ' + err.message, 'error'); }
    await refreshList();
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
