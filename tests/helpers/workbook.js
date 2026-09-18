// @ts-check
/**
 * Shared fixture loader.
 *
 * EVERY test suite loads the same samples/demo.workbook.json. Tests needing a
 * variant load the fixture and mutate a deep CLONE, so no suite can leak state
 * into another.
 *
 * Fixture shape:
 *   s1 "Month 1"  required  3 questions, all required
 *        q_s1_1 datetime
 *        q_s1_2 long_text
 *        q_s1_3 checklist  <- 2 of 4 options flagged `expected`
 *   s2 "Month 2"  required  4 questions, all required
 *        q_s2_1 short_text
 *        q_s2_2 numeric    <- min 4, integerOnly
 *        q_s2_3 rating     <- scaleId agreement-5
 *        q_s2_4 rating     <- scaleId frequency-5
 *   s3 "Month 3"  required  4 questions, 2 required
 *        q_s3_1 yes_no     required
 *        q_s3_2 rating     required, numeric-5 + end captions
 *        q_s3_3 url        optional
 *        q_s3_4 long_text  optional
 *   s4 "Wrap-Up"  OPTIONAL  4 questions
 *
 * Section titles are "Month N" on purpose: they are the case that makes a
 * "Section 1:" prefix read badly, which the dashboard and PDF now avoid.
 *
 * Required questions inside required sections = 3 + 4 + 2 = 9,
 * so one completed required question = 1/9 = 0.11.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_PATH = join(ROOT, 'samples', 'demo.workbook.json');
export const SCALES_PATH = join(ROOT, 'data', 'scales.json');

let cachedWorkbook = null;
let cachedScales = null;

/** Load the shared fixture. Always returns a fresh deep clone. */
export async function loadWorkbook() {
  if (!cachedWorkbook) cachedWorkbook = await readFile(FIXTURE_PATH, 'utf8');
  return JSON.parse(cachedWorkbook);
}

/** Load the fixture and apply a mutation, for variant scenarios. */
export async function loadWorkbookWith(mutate) {
  const wb = await loadWorkbook();
  mutate(wb);
  return wb;
}

/** Author-defined scales from data/scales.json. */
export async function loadCustomScales() {
  if (!cachedScales) {
    try { cachedScales = await readFile(SCALES_PATH, 'utf8'); }
    catch (_) { cachedScales = '{"scales":[]}'; }
  }
  return JSON.parse(cachedScales).scales || [];
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

export const SECTION_IDS = ['s1', 's2', 's3', 's4'];
export const SECTION_TITLES = ['Month 1', 'Month 2', 'Month 3', 'Wrap-Up'];
export const REQUIRED_QUESTION_COUNT = 9;

/**
 * Every response needed to complete all REQUIRED sections (s1..s3).
 * The optional s4 is deliberately left untouched.
 */
export const COMPLETE_REQUIRED_RESPONSES = Object.freeze({
  q_s1_1: '2026-09-14',
  q_s1_2: 'Reviewed scope, safety, roles and schedule.',
  q_s1_3: ['o_scope', 'o_safety'],   // both expected options
  q_s2_1: 'Dana Ruiz',
  q_s2_2: '6',                       // >= min 4, whole number
  q_s2_3: '2',                       // agreement-5 -> Disagree
  q_s2_4: '1',                       // frequency-5 -> Never
  q_s3_1: 'yes',
  q_s3_2: '4',                       // numeric-5
});

/** Apply a response map to a live SessionCore. */
export function answerAll(session, responses = COMPLETE_REQUIRED_RESPONSES) {
  for (const [id, value] of Object.entries(responses)) session.setResponse(id, value);
}
