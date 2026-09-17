// @ts-check
/** Thin fetch wrappers around the authoring server API. */

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && body.error) || res.statusText);
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  listWorkbooks: () => jsonFetch('/api/workbooks'),
  getWorkbook: (id) => jsonFetch('/api/workbooks/' + encodeURIComponent(id)),
  newWorkbook: () => jsonFetch('/api/workbooks/new'),
  saveWorkbook: (wb) => jsonFetch('/api/workbooks', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  deleteWorkbook: (id) => jsonFetch('/api/workbooks/' + encodeURIComponent(id), { method: 'DELETE' }),
  validate: (wb) => jsonFetch('/api/validate', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  targets: () => jsonFetch('/api/targets'),
  setPreview: (wb) => jsonFetch('/api/preview', { method: 'POST', headers: json(), body: JSON.stringify(wb) }),
  importXlsx: (buffer) => jsonFetch('/api/import/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer }),

  async publishZip(wb, target = 'scorm2004') {
    const res = await fetch('/api/publish?target=' + encodeURIComponent(target), { method: 'POST', headers: json(), body: JSON.stringify(wb) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || 'Publish failed');
      err.body = body;
      throw err;
    }
    const filename = filenameFromDisposition(res.headers.get('content-disposition')) || 'workbook_SCORM2004.zip';
    return { blob: await res.blob(), filename };
  },
};

function json() { return { 'Content-Type': 'application/json' }; }
function filenameFromDisposition(d) {
  if (!d) return null;
  const m = /filename="([^"]+)"/.exec(d);
  return m ? m[1] : null;
}
