// @ts-check
/**
 * Server-side workbook store. JSON files on disk, one per workbook, under
 * data/workbooks/. Deliberately tiny so it can later be swapped for Prisma +
 * SQLite/PostgreSQL behind the same async interface.
 */
import { readFile, writeFile, readdir, unlink, mkdir, rename, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { slugify } from '@sowb/shared/ids.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'workbooks');
const ensureDir = () => mkdir(DATA_DIR, { recursive: true });
const safeName = (id) => String(id).replace(/[^a-z0-9._-]/gi, '-') + (String(id).endsWith('.json') ? '' : '.json');

/**
 * The library lists FILES, not workbook ids. A workbook is identified by its
 * file name, so a JSON dropped into data/workbooks/ always shows up, even if it
 * is a copy sharing another file's `id` or has no `id` at all.
 */
export async function listWorkbooks() {
  await ensureDir();
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const wb = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'));
      out.push({
        file: f, id: wb.id || '', title: wb.title || f.replace(/\.json$/, ''),
        version: wb.version || '', sections: (wb.sections || []).length,
      });
    } catch (_) {
      out.push({ file: f, id: '', title: f, version: '', sections: 0, unreadable: true });
    }
  }
  return out.sort((a, b) => String(a.title).localeCompare(String(b.title)) || a.file.localeCompare(b.file));
}

/** Full workbook objects, used for scale-usage lookups. */
export async function readAllWorkbooks() {
  await ensureDir();
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'))); } catch (_) { /* skip */ }
  }
  return out;
}

/** @param {string} file the file name from listWorkbooks() */
export async function getWorkbook(file) {
  await ensureDir();
  try { return JSON.parse(await readFile(join(DATA_DIR, safeName(file)), 'utf8')); } catch (_) { return null; }
}

/** First `<base>.json`, `<base>-2.json`, ... that does not exist yet. */
async function uniqueFile(base) {
  const existing = new Set(await readdir(DATA_DIR));
  let name = `${base}.json`;
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}.json`;
  return name;
}

/**
 * Save to `file` when given (the file the workbook was opened from), otherwise
 * to a fresh, non-colliding file named after the workbook.
 * @returns {Promise<{workbook:any, file:string}>}
 */
export async function saveWorkbook(workbook, file) {
  await ensureDir();
  if (!workbook.id) workbook.id = slugify(workbook.title || 'workbook');
  const target = file ? safeName(file) : await uniqueFile(safeName(workbook.id).replace(/\.json$/, ''));
  await writeFile(join(DATA_DIR, target), JSON.stringify(workbook, null, 2), 'utf8');
  return { workbook, file: target };
}

/** Copy a workbook file under a new title and id. */
export async function cloneWorkbook(file) {
  const src = await getWorkbook(file);
  if (!src) return null;
  const title = `${src.title || 'Workbook'} (copy)`;
  const target = await uniqueFile(slugify(title));
  const copy = { ...src, title, id: target.replace(/\.json$/, '') };
  await writeFile(join(DATA_DIR, target), JSON.stringify(copy, null, 2), 'utf8');
  return { workbook: copy, file: target };
}

export async function deleteWorkbook(id) {
  await ensureDir();
  try { await unlink(join(DATA_DIR, safeName(id))); return true; } catch (_) { return false; }
}

/**
 * Rename a workbook FILE. The workbook's own id and title are left alone.
 * Throws an Error with `.status` 404 (no such file), 400 (bad name) or 409 (taken).
 * @returns {Promise<string>} the new file name
 */
export async function renameWorkbook(file, newName) {
  await ensureDir();
  const base = String(newName || '').trim().replace(/\.json$/i, '');
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  if (!base || /^\.+$/.test(base)) throw fail(400, 'Enter a file name.');
  const from = safeName(file);
  const to = safeName(base + '.json');
  try { await access(join(DATA_DIR, from)); } catch (_) { throw fail(404, 'Not found'); }
  if (to === from) return to;
  const exists = await access(join(DATA_DIR, to)).then(() => true, () => false);
  if (exists) throw fail(409, `A file named ${to} already exists.`);
  await rename(join(DATA_DIR, from), join(DATA_DIR, to));
  return to;
}
