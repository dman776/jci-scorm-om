// @ts-check
import { h, toast, downloadBlob, confirmDialog } from '../ui.js';

/**
 * Tree state that survives leaving and returning to the screen: which folders
 * are expanded and which workbooks (by file path) are ticked.
 */
const openFolders = new Set();
const selected = new Set();
let treeInitialized = false;

const ICON_CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_FOLDER = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#fdf3dc" stroke="#c98a00" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_FILE = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z M14 3v4h4" fill="none" stroke="#2c5cc5" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_DOTS = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="13" r="1.6" fill="currentColor"/></svg>';
const ICON_CARET = '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Close every open popup menu; `except` stays as it is. */
function closeMenus(except) {
  for (const m of document.querySelectorAll('.lib-menu.open')) {
    if (m === except) continue;
    m.classList.remove('open');
    const btn = m.parentElement && m.parentElement.querySelector('[aria-haspopup]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}
// Installed once: a click outside any menu, or Escape, closes them.
document.addEventListener('click', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('.lib-menu-wrap')) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.lib-menu.open');
  if (!open) return;
  closeMenus();
  const btn = open.parentElement && open.parentElement.querySelector('[aria-haspopup]');
  if (btn instanceof HTMLElement) btn.focus();
});

/**
 * A button that opens a popup menu of actions.
 * @param {HTMLElement} button
 * @param {{label: string, onclick: () => void, danger?: boolean, depth?: number}[]} items
 * @param {string} [align] 'left' to open toward the right
 */
function menuWrap(button, items, align) {
  const menu = h('div.lib-menu' + (align === 'left' ? '.left' : ''), { role: 'menu' }, items.map((it) =>
    h('button.lib-menu-item' + (it.danger ? '.danger' : ''), {
      type: 'button', role: 'menuitem', style: it.depth ? `padding-left:${12 + it.depth * 16}px` : null,
      onclick: () => { closeMenus(); it.onclick(); },
    }, it.label)));
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    const opening = !menu.classList.contains('open');
    closeMenus(menu);
    menu.classList.remove('up');
    menu.classList.toggle('open', opening);
    button.setAttribute('aria-expanded', String(opening));
    // Open upward when the menu would run past the bottom of the window.
    if (opening && menu.getBoundingClientRect().bottom > window.innerHeight
      && button.getBoundingClientRect().top > menu.offsetHeight + 8) menu.classList.add('up');
    if (opening) { const first = menu.querySelector('button'); if (first) first.focus(); }
  });
  return h('div.lib-menu-wrap', [button, menu]);
}

export async function renderLibrary(mount, { store, api, navigate }) {
  const inner = h('div.screen-inner', [
    h('h1.screen-title', 'Library'),
    h('p.screen-sub', 'Open a saved workbook, organize workbooks into folders, start a new one, import an Excel template, or import/export project JSON.'),
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
    h('div.card', [
      h('div.lib-head', [
        h('h2.card-title', 'Saved workbooks'),
        h('div.lib-head-actions', [
          h('button.btn.small.ghost', { onclick: () => { folders.forEach((f) => openFolders.add(f)); renderTree(); } }, 'Expand all'),
          h('button.btn.small.ghost', { onclick: () => { openFolders.clear(); renderTree(); } }, 'Collapse all'),
          h('button.btn.small', { onclick: () => onNewFolder('') }, '+ New folder'),
        ]),
      ]),
      h('div', { id: 'lib-list' }, 'Loading...'),
    ]),
  ]);
  mount.appendChild(inner);

  /** @type {any[]} */ let items = [];
  /** @type {string[]} */ let folders = [];
  await refreshList();

  function parentOf(path) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
  function baseOf(path) { return path.slice(path.lastIndexOf('/') + 1); }
  function inside(folder) { return items.filter((w) => w.file.startsWith(folder + '/')); }
  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  /** Reload workbooks and folders from the server, then redraw the tree. */
  async function refreshList() {
    const listEl = inner.querySelector('#lib-list');
    try {
      [items, folders] = await Promise.all([api.listWorkbooks(), api.listFolders()]);
    } catch (err) {
      listEl.replaceChildren(h('p.error', 'Could not load: ' + err.message));
      return;
    }
    // First visit: show everything expanded. Afterwards keep the user's choice.
    if (!treeInitialized) { folders.forEach((f) => openFolders.add(f)); treeInitialized = true; }
    const known = new Set(items.map((w) => w.file));
    for (const f of [...selected]) if (!known.has(f)) selected.delete(f);
    renderTree();
  }

  /** Redraw the selection bar and tree from the cached lists (no server call). */
  function renderTree() {
    const listEl = inner.querySelector('#lib-list');
    if (!items.length && !folders.length) {
      listEl.replaceChildren(h('p.muted', 'No saved workbooks yet.'));
      return;
    }
    const rows = [];
    buildRows('', 0, rows);
    listEl.replaceChildren(renderSelectionBar(), h('div.lib-tree', { role: 'tree', 'aria-label': 'Saved workbooks' }, rows));
  }

  function renderSelectionBar() {
    const n = selected.size;
    const all = items.length > 0 && n === items.length;
    const selectAll = h('input.lib-check', { type: 'checkbox', checked: all, onchange: () => {
      if (all) selected.clear(); else items.forEach((w) => selected.add(w.file));
      renderTree();
    } });
    selectAll.indeterminate = n > 0 && !all;
    const targets = [{ label: 'Library (top level)', folder: '', depth: 0 }]
      .concat(folders.map((f) => ({ label: baseOf(f), folder: f, depth: f.split('/').length - 1 })));
    return h('div.lib-selbar' + (n ? '.active' : ''), [
      h('label.lib-selall', [selectAll, h('span', 'Select all')]),
      n ? h('span.lib-selcount', `${plural(n, 'workbook')} selected`) : null,
      n ? menuWrap(h('button.btn.small', { type: 'button', html: 'Move to folder ' + ICON_CARET }),
        targets.map((t) => ({ label: t.label, depth: t.depth, onclick: () => onMoveSelected(t.folder) })), 'left') : null,
      n ? h('button.btn.small.ghost.danger-text', { type: 'button', onclick: onDeleteSelected }, 'Delete selected') : null,
      n ? h('button.link-btn', { type: 'button', onclick: () => { selected.clear(); renderTree(); } }, 'Clear') : null,
      n ? null : h('span.muted.lib-selhint', 'Tick workbooks (or a whole folder) to move several at once.'),
    ]);
  }

  /** Folders first (sorted), then the workbooks directly in `folder` (by title). */
  function buildRows(folder, depth, rows) {
    const indent = `padding-left:${12 + depth * 24}px`;
    for (const f of folders.filter((x) => parentOf(x) === folder).sort((a, b) => a.localeCompare(b))) {
      const within = inside(f);
      const n = within.filter((w) => selected.has(w.file)).length;
      const isOpen = openFolders.has(f);
      const check = h('input.lib-check', {
        type: 'checkbox', checked: within.length > 0 && n === within.length, disabled: !within.length,
        'aria-label': 'Select everything in ' + f,
        onchange: () => {
          const on = n !== within.length;
          within.forEach((w) => (on ? selected.add(w.file) : selected.delete(w.file)));
          renderTree();
        },
      });
      check.indeterminate = n > 0 && n < within.length;
      rows.push(h('div.lib-row.lib-folder' + (within.length && n === within.length ? '.selected' : ''),
        { role: 'treeitem', 'aria-expanded': String(isOpen), style: indent }, [
          check,
          h('button.lib-toggle', { type: 'button', onclick: () => { if (isOpen) openFolders.delete(f); else openFolders.add(f); renderTree(); } }, [
            h('span.lib-chevron' + (isOpen ? '.open' : ''), { html: ICON_CHEVRON }),
            h('span.lib-ico', { html: ICON_FOLDER }),
            h('span.lib-name', baseOf(f)),
            h('span.lib-meta', plural(within.length, 'workbook')),
          ]),
          menuWrap(h('button.lib-kebab', { type: 'button', 'aria-label': 'Actions for folder ' + f, html: ICON_DOTS }), [
            { label: 'New subfolder', onclick: () => onNewFolder(f) },
            { label: 'Rename folder', onclick: () => onRenameFolder(f) },
            { label: 'Delete folder', danger: true, onclick: () => onDeleteFolder(f) },
          ]),
        ]));
      if (isOpen) buildRows(f, depth + 1, rows);
    }
    const here = items.filter((w) => parentOf(w.file) === folder)
      .sort((a, b) => String(a.title).localeCompare(String(b.title)) || a.file.localeCompare(b.file));
    for (const w of here) {
      const on = selected.has(w.file);
      const isCurrent = store.file === w.file;
      const meta = w.unreadable ? `${baseOf(w.file)} · not a readable workbook`
        : `v${w.version} · ${plural(w.sections, 'section')} · ${baseOf(w.file)}`;
      const label = [h('span.lib-name', w.title), isCurrent ? h('span.lib-badge', 'Open') : null, h('span.lib-meta', meta)];
      rows.push(h('div.lib-row.lib-wb' + (on ? '.selected' : ''), { role: 'treeitem', style: indent }, [
        h('input.lib-check', { type: 'checkbox', checked: on, 'aria-label': 'Select ' + w.title,
          onchange: () => { if (on) selected.delete(w.file); else selected.add(w.file); renderTree(); } }),
        h('span.lib-ico.lib-ico-file', { html: ICON_FILE }),
        w.unreadable ? h('div.lib-title', label)
          : h('button.lib-title', { type: 'button', title: 'Open this workbook', onclick: () => onOpen(w.file) }, label),
        menuWrap(h('button.lib-kebab', { type: 'button', 'aria-label': 'Actions for ' + w.title, html: ICON_DOTS }), [
          ...(w.unreadable ? [] : [
            { label: 'Open', onclick: () => onOpen(w.file) },
            { label: 'Clone', onclick: () => onClone(w.file) },
          ]),
          { label: 'Rename file', onclick: () => onRename(w.file) },
          { label: 'Move to…', onclick: () => moveOne(w.file) },
          { label: 'Delete', danger: true, onclick: () => onDelete(w.file) },
        ]),
      ]));
    }
  }

  /** "Move to..." on one row: select just that workbook and open the bulk Move menu. */
  function moveOne(file) {
    selected.clear(); selected.add(file);
    renderTree();
    const btn = inner.querySelector('.lib-selbar [aria-haspopup]');
    if (btn instanceof HTMLElement) btn.click();
  }

  async function onMoveSelected(folder) {
    const files = [...selected].filter((f) => parentOf(f) !== folder);
    const where = folder || 'Library (top level)';
    let moved = 0;
    const skipped = [];
    for (const file of files) {
      try {
        const { file: to } = await api.moveWorkbook(file, folder);
        if (store.file === file) store.setFile(to);
        moved++;
      } catch (err) { skipped.push(`${baseOf(file)} (${err.message})`); }
    }
    selected.clear();
    for (let p = folder; p; p = parentOf(p)) openFolders.add(p);
    if (moved) toast(`Moved ${plural(moved, 'workbook')} to ${where}`, 'success');
    else if (!skipped.length) toast(`Already in ${where}`, 'info');
    if (skipped.length) toast(`Not moved: ${skipped.join(', ')}`, 'error');
    await refreshList();
  }

  async function onDeleteSelected() {
    const files = [...selected];
    if (!(await confirmDialog(`Delete ${plural(files.length, 'saved workbook')}? This cannot be undone.`))) return;
    let failed = 0;
    for (const file of files) {
      try {
        await api.deleteWorkbook(file);
        if (store.file === file) store.setFile(null);
      } catch (_) { failed++; }
    }
    selected.clear();
    toast(failed ? `Deleted ${files.length - failed}; ${failed} could not be deleted` : `Deleted ${plural(files.length, 'workbook')}`, failed ? 'error' : 'info');
    await refreshList();
  }

  async function onNewFolder(parent) {
    const name = window.prompt(parent ? `New folder inside ${parent}:` : 'New folder name:');
    if (name === null || !name.trim()) return;
    try {
      const { folder } = await api.createFolder((parent ? parent + '/' : '') + name.trim());
      for (let p = folder; p; p = parentOf(p)) openFolders.add(p);
      toast('Created folder ' + folder, 'success');
      await refreshList();
    } catch (err) { toast('Could not create folder: ' + err.message, 'error'); }
  }
  async function onRenameFolder(folder) {
    const name = window.prompt('New folder name:', baseOf(folder));
    if (name === null) return;
    try {
      const { folder: renamed } = await api.renameFolder(folder, name);
      if (store.file && store.file.startsWith(folder + '/')) store.setFile(renamed + store.file.slice(folder.length));
      // Carry expanded state and ticks over to the new paths.
      const swap = (p) => (p === folder || p.startsWith(folder + '/') ? renamed + p.slice(folder.length) : p);
      for (const set of [openFolders, selected]) { const next = [...set].map(swap); set.clear(); next.forEach((p) => set.add(p)); }
      toast('Renamed to ' + renamed, 'success');
      await refreshList();
    } catch (err) { toast('Rename failed: ' + err.message, 'error'); }
  }
  async function onDeleteFolder(folder) {
    if (!(await confirmDialog(`Delete the folder ${folder}? Only empty folders can be deleted.`))) return;
    try { await api.deleteFolder(folder); openFolders.delete(folder); toast('Folder deleted', 'info'); await refreshList(); }
    catch (err) { toast('Could not delete folder: ' + err.message, 'error'); }
  }

  async function onNew() {
    if (store.hasContent() && !(await confirmDialog('Start a new workbook? Unsaved changes to the current workbook will be lost.'))) return;
    store.set(await api.newWorkbook());
    toast('New workbook created', 'success');
    navigate('settings');
  }
  async function onRename(file) {
    const entered = window.prompt('New file name (without .json):', baseOf(file).replace(/\.json$/, ''));
    if (entered === null) return;
    try {
      const { file: renamed } = await api.renameWorkbook(file, entered);
      if (store.file === file) store.setFile(renamed);
      if (selected.delete(file)) selected.add(renamed);
      toast('Renamed to ' + baseOf(renamed), 'success');
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
    selected.delete(file);
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
