// @ts-check
/**
 * Server-side workbook store. JSON files on disk, one per workbook, under
 * data/workbooks/. Deliberately tiny so it can later be swapped for Prisma +
 * SQLite/PostgreSQL behind the same async interface.
 */
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { slugify } from '@sowb/shared/ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data', 'workbooks');

async function ensureDir() { await mkdir(DATA_DIR, { recursive: true }); }

export async function listWorkbooks() {
  await ensureDir();
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const wb = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'));
      out.push({ id: wb.id, title: wb.title, version: wb.version, sections: (wb.sections || []).length });
    } catch (_) { /* skip corrupt */ }
  }
  return out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

export async function getWorkbook(id) {
  await ensureDir();
  try { return JSON.parse(await readFile(join(DATA_DIR, safeName(id)), 'utf8')); }
  catch (_) { return null; }
}

export async function saveWorkbook(workbook) {
  await ensureDir();
  if (!workbook.id) workbook.id = slugify(workbook.title || 'workbook');
  await writeFile(join(DATA_DIR, safeName(workbook.id)), JSON.stringify(workbook, null, 2), 'utf8');
  return workbook;
}

export async function deleteWorkbook(id) {
  await ensureDir();
  try { await unlink(join(DATA_DIR, safeName(id))); return true; }
  catch (_) { return false; }
}

function safeName(id) {
  return String(id).replace(/[^a-z0-9._-]/gi, '-') + (String(id).endsWith('.json') ? '' : '.json');
}
