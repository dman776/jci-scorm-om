// @ts-check
/**
 * Rating Scales screen: manage the global library of reusable rating scales.
 *
 * Built-in scales are read-only but can be duplicated as a starting point.
 * Author scales are editable and deletable, with a usage check first so a scale
 * still referenced by a workbook cannot vanish silently.
 */
import { h, toast, confirmDialog } from '../ui.js';

export async function renderScales(mount, { api }) {
  const inner = h('div.screen-inner', [
    h('h1.screen-title', 'Rating Scales'),
    h('p.screen-sub', 'Reusable scales for rating questions. Pick one per question in the Sections editor; the chosen scale is baked into the SCORM package when you publish.'),
    h('div', { id: 'scale-list' }, h('div.card', 'Loading...')),
  ]);
  mount.appendChild(inner);
  await refresh();

  async function refresh() {
    const host = inner.querySelector('#scale-list');
    host.innerHTML = '';
    let scales;
    try {
      scales = await api.listScales();
    } catch (err) {
      host.appendChild(h('div.card.error', 'Could not load scales: ' + err.message));
      return;
    }
    host.appendChild(h('div.card', [
      h('div.scale-actions', [h('button.btn', { onclick: () => openEditor(null) }, '+ New scale')]),
      h('p.field-hint', 'Built-in scales ship with the app. Duplicate one to make an editable copy. Editing a scale updates every question using it, but already-published packages keep the wording they were built with.'),
    ]));
    for (const scale of scales) host.appendChild(renderScaleCard(scale));
  }

  function renderScaleCard(scale) {
    const points = scale.points || [];
    return h('div.card.scale-card', [
      h('div.scale-head', [
        h('div', [
          h('span.scale-name', scale.name),
          scale.builtIn ? h('span.badge.builtin', 'Built-in') : null,
        ]),
        h('div.scale-card-actions', [
          h('button.btn.small.ghost', { onclick: () => openEditor(duplicateOf(scale)) }, 'Duplicate'),
          scale.builtIn ? null : h('button.btn.small.ghost', { onclick: () => openEditor(scale) }, 'Edit'),
          scale.builtIn ? null : h('button.btn.small.ghost', { onclick: () => onDelete(scale) }, 'Delete'),
        ]),
      ]),
      scale.description ? h('p.field-hint', scale.description) : null,
      h('ol.scale-points', points.map((p) => h('li.scale-point', [
        h('span.scale-point-value', String(p.value)),
        h('span.scale-point-label', p.label),
      ]))),
      h('p.field-hint', `${points.length} points \u00b7 id: ${scale.id}`),
    ]);
  }

  function duplicateOf(scale) {
    return {
      id: '', name: scale.name + ' (copy)', description: scale.description || '',
      points: (scale.points || []).map((p) => ({ ...p })),
    };
  }

  async function onDelete(scale) {
    // Check usage first: deleting a referenced scale turns every question
    // pointing at it into a blocking validation error at publish time.
    let usage = [];
    try { usage = await api.scaleUsage(scale.id); } catch (_) { /* fall through */ }

    if (usage.length) {
      const lines = usage.slice(0, 5).map((u) => `  - ${u.workbookTitle}: ${u.prompt}`).join('\n');
      const more = usage.length > 5 ? `\n  ...and ${usage.length - 5} more` : '';
      const ok = await confirmDialog(
        `"${scale.name}" is used by ${usage.length} question${usage.length === 1 ? '' : 's'}:\n\n${lines}${more}\n\n` +
        'Deleting it will make those questions fail validation until you pick another scale. Delete anyway?'
      );
      if (!ok) return;
    } else if (!(await confirmDialog(`Delete the scale "${scale.name}"? This cannot be undone.`))) {
      return;
    }
    try {
      await api.deleteScale(scale.id);
      toast('Scale deleted', 'info');
      await refresh();
    } catch (err) {
      toast('Delete failed: ' + err.message, 'error');
    }
  }

  function openEditor(existing) {
    const draft = existing
      ? { id: existing.id || '', name: existing.name || '', description: existing.description || '',
          points: (existing.points || []).map((p) => ({ ...p })) }
      : { id: '', name: '', description: '', points: [{ value: 1, label: '' }, { value: 2, label: '' }] };

    const host = inner.querySelector('#scale-list');
    host.innerHTML = '';
    host.appendChild(h('div.card', [
      h('h2.card-title', existing && existing.id ? 'Edit scale' : 'New scale'),
      h('label.field', [
        h('span.field-label', 'Name'),
        h('input', { type: 'text', value: draft.name, placeholder: 'e.g. Agreement (5-point)',
          oninput: (e) => { draft.name = e.target.value; } }),
      ]),
      h('label.field', [
        h('span.field-label', 'Description (optional)'),
        h('input', { type: 'text', value: draft.description, oninput: (e) => { draft.description = e.target.value; } }),
      ]),
      h('div.points-block', [
        h('span.field-label', 'Points'),
        h('p.field-hint', 'The VALUE is stored in the LMS and shown to facilitators; the LABEL is what the learner reads. Changing a label later is safe. Changing a value is not: it orphans responses already recorded against the old value.'),
        h('div', { id: 'point-rows' }),
        h('button.btn.small.ghost', { onclick: addPoint }, '+ Add point'),
      ]),
      h('div.publish-actions', [
        h('button.btn', { onclick: save }, 'Save scale'),
        h('button.btn.ghost', { onclick: refresh }, 'Cancel'),
      ]),
      h('div', { id: 'scale-errors' }),
    ]));
    drawPoints();

    function drawPoints() {
      const rows = host.querySelector('#point-rows');
      rows.innerHTML = '';
      draft.points.forEach((p, i) => {
        rows.appendChild(h('div.point-row', [
          h('input.point-value', { type: 'text', value: String(p.value), title: 'Stored value',
            oninput: (e) => { p.value = coerce(e.target.value); } }),
          h('input.point-label', { type: 'text', value: p.label, placeholder: 'Label shown to the learner',
            oninput: (e) => { p.label = e.target.value; } }),
          h('button.icon-btn', { title: 'Move up', onclick: () => move(i, -1) }, '\u2191'),
          h('button.icon-btn', { title: 'Move down', onclick: () => move(i, 1) }, '\u2193'),
          h('button.icon-btn', { title: 'Remove point', onclick: () => { draft.points.splice(i, 1); drawPoints(); } }, '\u2715'),
        ]));
      });
    }
    function move(i, dir) {
      const to = i + dir;
      if (to < 0 || to >= draft.points.length) return;
      const [item] = draft.points.splice(i, 1);
      draft.points.splice(to, 0, item);
      drawPoints();
    }
    function addPoint() { draft.points.push({ value: draft.points.length + 1, label: '' }); drawPoints(); }
    async function save() {
      const errHost = host.querySelector('#scale-errors');
      errHost.innerHTML = '';
      try {
        await api.saveScale(draft);
        toast('Scale saved', 'success');
        await refresh();
      } catch (err) {
        const list = (err.body && err.body.errors) || [err.message];
        errHost.appendChild(h('ul.issue-list.errors', list.map((m) => h('li', m))));
      }
    }
  }
}

/** Keep numeric-looking values numeric so scales sort and compare naturally. */
function coerce(raw) {
  const s = String(raw).trim();
  if (s !== '' && isFinite(Number(s))) return Number(s);
  return s;
}
