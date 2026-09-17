// @ts-check
/**
 * Compact serialization of learner state into cmi.suspend_data.
 *
 * Design goals:
 *  - Ids only, never prompt text (prompts live in the static package, not in
 *    suspend data) to respect the SCORM 2004 4th Edition capacity budget.
 *  - Stable, versioned envelope so a future format bump can be detected.
 *  - Deterministic size estimate so the builder can warn before export.
 *
 * Runs in the browser player and in Node tests, so keep it dependency-free.
 */

export const SUSPEND_FORMAT_VERSION = 2;

/**
 * @param {import('@sowb/shared').LearnerState} state
 * @returns {string}
 */
export function serializeState(state) {
  const compact = {
    v: SUSPEND_FORMAT_VERSION,
    cs: state.currentSection || '',
    cp: typeof state.currentPage === 'number' ? state.currentPage : 0,
    r: state.responses || {},
    ss: encodeStatusMap(state.sectionStatus || {}),
  };
  return JSON.stringify(compact);
}

/**
 * @param {string} raw
 * @returns {import('@sowb/shared').LearnerState}
 */
export function deserializeState(raw) {
  const empty = { currentSection: '', currentPage: 0, responses: {}, sectionStatus: {} };
  if (!raw || typeof raw !== 'string') return empty;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!data || typeof data !== 'object') return empty;
  return {
    currentSection: data.cs || '',
    currentPage: typeof data.cp === 'number' ? data.cp : 0,
    responses: data.r || {},
    sectionStatus: decodeStatusMap(data.ss || {}),
  };
}

/**
 * Estimated serialized byte length of the suspend payload. UTF-8 aware so
 * multibyte responses are counted correctly.
 * @param {import('@sowb/shared').LearnerState} state
 * @returns {number}
 */
export function estimateSuspendSize(state) {
  const str = serializeState(state);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8');
}

// Status is stored as a single char to save space.
// n = not started, i = in progress, p = partially complete, c = completed.
const STATUS_TO_CHAR = {
  not_started: 'n',
  in_progress: 'i',
  partially_complete: 'p',
  completed: 'c',
};
const CHAR_TO_STATUS = {
  n: 'not_started',
  i: 'in_progress',
  p: 'partially_complete',
  c: 'completed',
};

function encodeStatusMap(map) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const k of Object.keys(map)) out[k] = STATUS_TO_CHAR[map[k]] || 'n';
  return out;
}

function decodeStatusMap(map) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const k of Object.keys(map)) out[k] = CHAR_TO_STATUS[map[k]] || 'not_started';
  return out;
}
