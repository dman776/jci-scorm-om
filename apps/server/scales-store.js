// @ts-check
/**
 * Author-defined rating scale library, persisted as data/scales.json.
 *
 * Built-in scales live in code (@sowb/shared/scales.js) and are never written
 * here; this file holds only what an author creates. Kept deliberately small so
 * it can move to the same database as workbooks later.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateScale, slugifyScaleId, BUILT_IN_SCALES } from '@sowb/shared/scales.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = join(DATA_DIR, 'scales.json');

async function readAll() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    return Array.isArray(parsed.scales) ? parsed.scales : [];
  } catch (_) { return []; }
}
async function writeAll(scales) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify({ version: 1, scales }, null, 2), 'utf8');
  return scales;
}

/** Author-defined scales only. */
export const listCustomScales = readAll;

/** Built-ins plus author scales, for pickers. */
export async function listAllScales() {
  const custom = await readAll();
  const customIds = new Set(custom.map((s) => s.id));
  return [...BUILT_IN_SCALES.filter((b) => !customIds.has(b.id)), ...custom];
}

/** Create or update an author scale. */
export async function saveScale(scale) {
  const next = { ...scale };
  if (!next.id) next.id = slugifyScaleId(next.name);
  // Built-ins ship in code; an author edit becomes an override stored here,
  // which buildScaleIndex resolves in favour of the author's version.
  delete next.builtIn;

  const check = validateScale(next);
  if (!check.ok) {
    const err = new Error(check.errors.join(' '));
    /** @type {any} */ (err).errors = check.errors;
    throw err;
  }

  const scales = await readAll();
  const idx = scales.findIndex((s) => s.id === next.id);
  if (idx >= 0) scales[idx] = next; else scales.push(next);
  await writeAll(scales);
  return next;
}

export async function deleteScale(id) {
  const scales = await readAll();
  const filtered = scales.filter((s) => s.id !== id);
  if (filtered.length === scales.length) return false;
  await writeAll(filtered);
  return true;
}

/**
 * Which questions, across all saved workbooks, reference a given scale.
 * The UI warns before deleting a scale that is still in use, because a dangling
 * reference becomes a blocking validation error at publish time.
 */
export function findScaleUsage(id, workbooks) {
  const usage = [];
  for (const wb of workbooks || []) {
    for (const section of wb.sections || []) {
      for (const q of section.questions || []) {
        if (q.type === 'rating' && q.scaleId === id) {
          usage.push({
            workbookId: wb.id, workbookTitle: wb.title,
            sectionTitle: section.title, questionId: q.id, prompt: q.prompt,
          });
        }
      }
    }
  }
  return usage;
}
