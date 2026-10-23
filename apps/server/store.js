// @ts-check
/**
 * Server-side workbook store. JSON files on disk, one per workbook, under
 * data/workbooks/. Deliberately tiny so it can later be swapped for Prisma +
 * SQLite/PostgreSQL behind the same async interface.
 */
import { readFile, writeFile, readdir, unlink, mkdir, rename, access, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { slugify } from '@sowb/shared/ids.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'workbooks');
const ensureDir = () => mkdir(DATA_DIR, { recursive: true });
const cleanSegment = (seg) => String(seg).replace(/[^a-z0-9._-]/gi, '-');
const fail = (status, msg) => Object.assign(new Error(msg), { status });

/** Sanitised folder path ('' for the root); each segment is one directory, never '.' or '..'. */
const safeFolder = (folder) => String(folder || '').split('/').filter(Boolean).map(cleanSegment)
  .filter((seg) => !/^\.+$/.test(seg)).join('/');
/** Workbook file path relative to the library root, e.g. `safety/ppe.json`. */
const safeName = (id) => {
  const parts = String(id).split('/').filter(Boolean);
  const name = cleanSegment(parts.pop() || '');
  const base = /^\.+$/.test(name) ? 'workbook' : name;
  return posix.join(safeFolder(parts.join('/')), base + (base.endsWith('.json') ? '' : '.json'));
};

/** Every `.json` under the library, as paths relative to the root. */
async function walkFiles(dir = '') {
  const out = [];
  for (const e of await readdir(join(DATA_DIR, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(rel));
    else if (e.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

/** Every folder under the library (empty ones too), as sorted relative paths. */
export async function listFolders(dir = '') {
  await ensureDir();
  const out = [];
  for (const e of await readdir(join(DATA_DIR, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || !e.isDirectory()) continue;
    const rel = posix.join(dir, e.name);
    out.push(rel, ...await listFolders(rel));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Create a folder (and any missing parents). @returns {Promise<string>} its path */
export async function createFolder(path) {
  await ensureDir();
  const clean = safeFolder(path);
  if (!clean) throw fail(400, 'Enter a folder name.');
  await mkdir(join(DATA_DIR, clean), { recursive: true });
  return clean;
}

/** Rename the last segment of a folder, keeping it under the same parent. @returns {Promise<string>} the new path */
export async function renameFolder(path, newName) {
  await ensureDir();
  const from = safeFolder(path);
  const name = cleanSegment(String(newName || '').trim().replace(/\//g, '-'));
  if (!from) throw fail(404, 'Not found');
  if (!name || /^\.+$/.test(name)) throw fail(400, 'Enter a folder name.');
  const to = posix.join(posix.dirname(from) === '.' ? '' : posix.dirname(from), name);
  if (to === from) return to;
  try { await access(join(DATA_DIR, from)); } catch (_) { throw fail(404, 'Not found'); }
  if (await access(join(DATA_DIR, to)).then(() => true, () => false)) throw fail(409, `A folder named ${name} already exists.`);
  await rename(join(DATA_DIR, from), join(DATA_DIR, to));
  return to;
}

/** Delete a folder, only when it holds nothing. */
export async function deleteFolder(path) {
  const clean = safeFolder(path);
  if (!clean) throw fail(404, 'Not found');
  try { await rmdir(join(DATA_DIR, clean)); } catch (err) {
    if (err.code === 'ENOTEMPTY') throw fail(409, 'The folder is not empty. Move or delete its contents first.');
    throw fail(404, 'Not found');
  }
  return true;
}

/** Move a workbook file into `folder` ('' = root). @returns {Promise<string>} the new file path */
export async function moveWorkbook(file, folder) {
  await ensureDir();
  const from = safeName(file);
  const dir = safeFolder(folder);
  try { await access(join(DATA_DIR, from)); } catch (_) { throw fail(404, 'Not found'); }
  if (dir) await mkdir(join(DATA_DIR, dir), { recursive: true });
  const to = posix.join(dir, posix.basename(from));
  if (to === from) return to;
  if (await access(join(DATA_DIR, to)).then(() => true, () => false)) throw fail(409, `${to} already exists.`);
  await rename(join(DATA_DIR, from), join(DATA_DIR, to));
  return to;
}

/**
 * The library lists FILES, not workbook ids. A workbook is identified by its
 * file name, so a JSON dropped into data/workbooks/ always shows up, even if it
 * is a copy sharing another file's `id` or has no `id` at all.
 */
export async function listWorkbooks() {
  await ensureDir();
  const files = await walkFiles();
  const out = [];
  for (const f of files) {
    try {
      const wb = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'));
      out.push({
        file: f, id: wb.id || '', title: wb.title || posix.basename(f).replace(/\.json$/, ''),
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
  const files = await walkFiles();
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

/** First `<base>.json`, `<base>-2.json`, ... in `folder` that does not exist yet. @returns the file path */
async function uniqueFile(base, folder = '') {
  const existing = new Set(await readdir(join(DATA_DIR, folder)));
  let name = `${base}.json`;
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}.json`;
  return posix.join(folder, name);
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
  await mkdir(join(DATA_DIR, posix.dirname(target)), { recursive: true });
  await writeFile(join(DATA_DIR, target), JSON.stringify(workbook, null, 2), 'utf8');
  return { workbook, file: target };
}

/** Copy a workbook file under a new title and id. */
export async function cloneWorkbook(file) {
  const src = await getWorkbook(file);
  if (!src) return null;
  const title = `${src.title || 'Workbook'} (copy)`;
  const folder = posix.dirname(safeName(file)).replace(/^\.$/, '');
  const target = await uniqueFile(slugify(title), folder);
  const copy = { ...src, title, id: posix.basename(target).replace(/\.json$/, '') };
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
  const base = String(newName || '').trim().replace(/\.json$/i, '').replace(/\//g, '-');
  if (!base || /^\.+$/.test(base)) throw fail(400, 'Enter a file name.');
  const from = safeName(file);
  const to = posix.join(posix.dirname(from) === '.' ? '' : posix.dirname(from), safeName(base + '.json'));
  try { await access(join(DATA_DIR, from)); } catch (_) { throw fail(404, 'Not found'); }
  if (to === from) return to;
  const exists = await access(join(DATA_DIR, to)).then(() => true, () => false);
  if (exists) throw fail(409, `A file named ${to} already exists.`);
  await rename(join(DATA_DIR, from), join(DATA_DIR, to));
  return to;
}
