// @ts-check
/** Thin fetch wrappers around the authoring server API. */
async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) { const err = new Error((body && body.error) || res.statusText); err.body = body; throw err; }
  return body;
}
const json = () => ({ 'Content-Type': 'application/json' });
function filenameFromDisposition(d) { const m = d && /filename="([^"]+)"/.exec(d); return m ? m[1] : null; }
/** Today as YYYY-MM-DD in local time; the server normally supplies the dated name. */
function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const api = {
  listWorkbooks: () => jsonFetch('/api/workbooks'),
  getWorkbook: (id) => jsonFetch('/api/workbooks/' + encodeURIComponent(id)),
  newWorkbook: () => jsonFetch('/api/workbooks/new'),
  saveWorkbook: (wb) => jsonFetch('/api/workbooks', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  deleteWorkbook: (id) => jsonFetch('/api/workbooks/' + encodeURIComponent(id), { method: 'DELETE' }),

  listScales: () => jsonFetch('/api/scales'),
  getVersion: () => jsonFetch('/api/version'),
  saveScale: (s) => jsonFetch('/api/scales', { method: 'POST', headers: json(), body: JSON.stringify(s) }),
  deleteScale: (id) => jsonFetch('/api/scales/' + encodeURIComponent(id), { method: 'DELETE' }),
  scaleUsage: (id) => jsonFetch('/api/scales/' + encodeURIComponent(id) + '/usage'),

  validate: (wb) => jsonFetch('/api/validate', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  targets: () => jsonFetch('/api/targets'),
  setPreview: (wb) => jsonFetch('/api/preview', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  importXlsx: (buffer) => jsonFetch('/api/import/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer }),

  async publishZip(wb, target = 'scorm2004') {
    const res = await fetch('/api/publish?target=' + encodeURIComponent(target), { method: 'POST', headers: json(), body: JSON.stringify(wb) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || 'Publish failed'); err.body = body; throw err;
    }
    return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get('content-disposition')) || `workbook_SCORM2004_${localDate()}.zip` };
  },
};
