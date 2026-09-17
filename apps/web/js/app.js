// @ts-check
import { h, clear, toast } from './ui.js';
import { store } from './store.js';
import { api } from './api.js';
import { renderLibrary } from './screens/library.js';
import { renderSettings } from './screens/settings.js';
import { renderEditor } from './screens/editor.js';
import { renderPreview } from './screens/preview.js';
import { renderPublish } from './screens/publish.js';
import { renderHelp } from './screens/help.js';

const SCREENS = {
  library: { label: 'Library', icon: 'folder', render: renderLibrary },
  settings: { label: 'Workbook Settings', icon: 'gear', render: renderSettings },
  editor: { label: 'Sections', icon: 'list', render: renderEditor },
  preview: { label: 'Preview', icon: 'play', render: renderPreview },
  publish: { label: 'Publish', icon: 'box', render: renderPublish },
  help: { label: 'Help & Guide', icon: 'help', render: renderHelp },
};

let current = 'editor';

function navigate(screen) {
  if (!SCREENS[screen]) screen = 'editor';
  current = screen;
  location.hash = '#' + screen;
  renderShell();
}
window.__navigate = navigate;

function renderShell() {
  const root = document.getElementById('app');
  clear(root);
  root.appendChild(h('div.shell', [
    renderTopbar(),
    h('div.body', [renderSidebar(), h('main.content', { id: 'screen' })]),
  ]));
  SCREENS[current].render(document.getElementById('screen'), { navigate, store, api });
}

function renderTopbar() {
  const dirtyDot = store.dirty ? h('span.dirty-dot', { title: 'Unsaved changes' }) : null;
  return h('header.topbar', [
    h('div.brand', [
      h('span.brand-mark', { text: 'SOWB' }),
      h('span.brand-name', { text: 'SCORM Observation Workbook Builder' }),
    ]),
    h('div.top-actions', [
      h('span.wb-title-chip', [store.workbook.title, dirtyDot]),
      h('button.btn.ghost', { onclick: onSave }, 'Save'),
      h('button.btn', { onclick: () => navigate('publish') }, 'Publish'),
      h('a.top-link', { href: '#help', onclick: (e) => { e.preventDefault(); navigate('help'); } }, 'Help'),
    ]),
  ]);
}

function renderSidebar() {
  const items = Object.entries(SCREENS).map(([key, s]) =>
    h('button.nav-item' + (key === current ? '.active' : ''), {
      onclick: () => navigate(key),
    }, [h('span.nav-ico.ico-' + s.icon), s.label]));
  // A small, discrete build credit pinned to the bottom of the nav pane.
  return h('nav.sidebar', [
    h('div.nav-items', items),
    h('div.sidebar-credit', 'Built by Darryl Quinn'),
  ]);
}

async function onSave() {
  try {
    const saved = await api.saveWorkbook(store.workbook);
    store.update((wb) => { wb.id = saved.id; });
    store.markSaved();
    toast('Workbook saved', 'success');
    renderShell();
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

store.subscribe(() => {
  const chip = document.querySelector('.wb-title-chip');
  if (chip && chip.firstChild) chip.firstChild.textContent = store.workbook.title;
});

window.addEventListener('hashchange', () => {
  const s = location.hash.replace('#', '');
  if (s && SCREENS[s] && s !== current) { current = s; renderShell(); }
});

const initial = location.hash.replace('#', '');
if (SCREENS[initial]) current = initial;
renderShell();
