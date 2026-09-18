// @ts-check
import { h, toast, downloadBlob } from '../ui.js';

export async function renderPublish(mount, { store, api }) {
  const wb = store.workbook;
  const inner = h('div.screen-inner', [
    h('h1.screen-title', 'Publish Wizard'),
    h('p.screen-sub', 'Validate the workbook, then build a self-contained SCORM 2004 4th Edition package.'),
    h('div', { id: 'publish-body' }, h('div.card', 'Validating...')),
  ]);
  mount.appendChild(inner);
  const body = inner.querySelector('#publish-body');

  let report;
  try { report = await api.validate(wb); }
  catch (err) { body.innerHTML = ''; body.appendChild(h('div.card.error', 'Validation request failed: ' + err.message)); return; }
  body.innerHTML = '';

  body.appendChild(h('div.card', [
    h('h2.card-title', '1. Validation'),
    report.errors.length === 0
      ? h('div.status-ok', '\u2713 No blocking errors. Ready to export.')
      : h('div.status-bad', `\u2715 ${report.errors.length} error${report.errors.length === 1 ? '' : 's'} must be fixed before export.`),
    report.errors.length ? h('ul.issue-list.errors', report.errors.map((e) => h('li', e.message))) : null,
    report.warnings.length ? h('div.warn-head', `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'} (non-blocking):`) : null,
    report.warnings.length ? h('ul.issue-list.warnings', report.warnings.map((w) => h('li', w.message))) : null,
    h('div.suspend-meter', [
      h('span', `Estimated worst-case suspend data: ${report.estimatedSuspendSize} bytes of 64000`),
      h('div.meter', [h('div.meter-fill', { style: `width:${Math.min(100, Math.round((report.estimatedSuspendSize / 64000) * 100))}%` })]),
    ]),
  ]));

  body.appendChild(h('div.card', [
    h('h2.card-title', '2. SCORM settings'),
    h('table.kv-table', [
      row('Standard', 'SCORM 2004 4th Edition'),
      row('Completion rule', 'All required sections complete'),
      row('Navigation', wb.settings.navigation),
      row('Dashboard heading', wb.settings.dashboardHeading || 'Your observation workbook'),
      row('Learner PDF download', wb.settings.allowPdfDownload !== false ? 'Enabled' : 'Disabled'),
      row('Report success status', wb.settings.reportSuccess ? 'Yes' : 'No (completion only)'),
      row('Course ID', wb.courseId || wb.id || '(auto)'),
      row('Sections', String(wb.sections.length)),
    ]),
    h('p.field-hint', 'Rating scales are resolved and baked into the package at publish time, so the offline SCO never needs the library. Editing a scale later does not change an already-published package.'),
  ]));

  const buildCard = h('div.card', [
    h('h2.card-title', '3. Build package'),
    h('p', 'The ZIP contains index.html and imsmanifest.xml at the root and can be uploaded directly to Workday Learning.'),
    h('div.publish-actions', [
      h('button.btn.big' + (report.ok ? '' : '.disabled'), { disabled: !report.ok, onclick: onBuildZip }, 'Build SCORM ZIP'),
    ]),
    h('div', { id: 'build-result' }),
  ]);
  body.appendChild(buildCard);

  async function onBuildZip() {
    try {
      const { blob, filename } = await api.publishZip(wb);
      downloadBlob(blob, filename);
      const rr = buildCard.querySelector('#build-result');
      rr.innerHTML = '';
      rr.appendChild(h('div.status-ok', `\u2713 Built ${filename} (${blob.size} bytes).`));
      toast('SCORM package built', 'success');
    } catch (err) { toast('Build failed: ' + err.message, 'error'); }
  }
}
function row(k, v) { return h('tr', [h('td.k', k), h('td.v', v)]); }
