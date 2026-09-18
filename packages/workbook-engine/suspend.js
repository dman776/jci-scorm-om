// @ts-check
/**
 * Compact serialization of learner state into cmi.suspend_data.
 *
 *  - Ids only, never prompt text, to respect the SCORM 2004 capacity budget.
 *  - Versioned envelope so a future format bump can be detected.
 *  - Deterministic size estimate so the builder can warn before export.
 *
 * Runs in the browser player and in Node tests, so it stays dependency-free.
 */
export const SUSPEND_FORMAT_VERSION = 3;

export function serializeState(state) {
  return JSON.stringify({
    v: SUSPEND_FORMAT_VERSION,
    cs: state.currentSection || '',
    cp: typeof state.currentPage === 'number' ? state.currentPage : 0,
    r: state.responses || {},
    ss: encodeStatusMap(state.sectionStatus || {}),
    l: state.lockedSections || [],
  });
}

export function deserializeState(raw) {
  const empty = { currentSection: '', currentPage: 0, responses: {}, sectionStatus: {}, lockedSections: [] };
  if (!raw || typeof raw !== 'string') return empty;
  let data;
  try { data = JSON.parse(raw); } catch { return empty; }
  if (!data || typeof data !== 'object') return empty;
  return {
    currentSection: data.cs || '',
    currentPage: typeof data.cp === 'number' ? data.cp : 0,
    responses: data.r || {},
    sectionStatus: decodeStatusMap(data.ss || {}),
    // v2 payloads predate answer locking and carry no `l`; they resume unlocked.
    lockedSections: Array.isArray(data.l) ? data.l : [],
  };
}

export function estimateSuspendSize(state) {
  const str = serializeState(state);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8');
}

// Status is stored as a single char to save space.
const STATUS_TO_CHAR = { not_started: 'n', in_progress: 'i', partially_complete: 'p', completed: 'c' };
const CHAR_TO_STATUS = { n: 'not_started', i: 'in_progress', p: 'partially_complete', c: 'completed' };
function encodeStatusMap(m) { const o = {}; for (const k of Object.keys(m)) o[k] = STATUS_TO_CHAR[m[k]] || 'n'; return o; }
function decodeStatusMap(m) { const o = {}; for (const k of Object.keys(m)) o[k] = CHAR_TO_STATUS[m[k]] || 'not_started'; return o; }
