// @ts-check
/**
 * ZIP packager. Turns a { path: content } file map into a ZIP buffer using
 * jszip. Files are written at the ZIP root (index.html and imsmanifest.xml at
 * top level), which is what an LMS SCORM player expects.
 */
import JSZip from 'jszip';

/** @param {Record<string,string|Uint8Array>} fileMap @returns {Promise<Buffer>} */
export async function zipFileMap(fileMap) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(fileMap)) zip.file(path, content);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    // Deterministic timestamp keeps repeated exports byte-stable for diffing.
    date: new Date('2020-01-01T00:00:00Z'),
  });
}

/** Read a ZIP buffer back into a file map (tests + round-trips). */
export async function unzipToMap(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  /** @type {Record<string,string>} */
  const out = {};
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  await Promise.all(entries.map(async (f) => { out[f.name] = await f.async('string'); }));
  return out;
}
