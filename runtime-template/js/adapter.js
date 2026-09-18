// @ts-check
/**
 * SCORM 2004 4th Edition runtime adapter.
 *
 *  - Discovers the LMS-provided `API_1484_11` object by walking up the parent
 *    frame chain and then the opener chain (the algorithm mandated by the
 *    SCORM 2004 Run-Time Environment spec).
 *  - Provides a localStorage-backed fallback so the same player runs during
 *    local preview and offline with no LMS present.
 *  - Wraps the raw eight-function IEEE 1484.11.2 surface in a small API.
 *
 * Ships verbatim inside the exported package. No third-party code.
 */
const MAX_FRAME_DEPTH = 100;

function findAPIInWindow(win) {
  let current = win, depth = 0;
  while (current && depth < MAX_FRAME_DEPTH) {
    try {
      if (current.API_1484_11) return current.API_1484_11;
    } catch (_) {
      return null; // cross-origin frame; stop climbing this chain
    }
    if (current.parent === current) break;
    current = current.parent;
    depth++;
  }
  return null;
}

/** Full SCORM 2004 discovery: parent chain, then opener chain. */
export function discoverAPI() {
  if (typeof window === 'undefined') return null;
  let api = findAPIInWindow(window);
  if (!api && window.opener) {
    try { api = findAPIInWindow(window.opener); } catch (_) { api = null; }
  }
  return api || null;
}

/** Spec-shaped fallback API used when no LMS is present. */
export function createFallbackAPI(storageKey = 'sowb.fallback') {
  const data = {
    'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown',
    'cmi.entry': 'ab-initio', 'cmi.exit': '', 'cmi.location': '',
    'cmi.suspend_data': '', 'cmi.progress_measure': '',
    'cmi.session_time': '', 'cmi.total_time': 'PT0H0M0S',
    'cmi.learner_name': '', 'cmi.learner_id': '',
  };
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      Object.assign(data, JSON.parse(raw));
      if (data['cmi.exit'] === 'suspend' || data['cmi.suspend_data']) data['cmi.entry'] = 'resume';
    }
  } catch (_) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (_) {} };
  return {
    __fallback: true,
    Initialize() { return 'true'; },
    Terminate() { persist(); return 'true'; },
    GetValue(el) { return data[el] !== undefined ? data[el] : ''; },
    SetValue(el, v) { data[el] = String(v); return 'true'; },
    Commit() { persist(); return 'true'; },
    GetLastError() { return '0'; },
    GetErrorString() { return ''; },
    GetDiagnostic() { return ''; },
    _dump() { return { ...data }; },
  };
}

/** High-level wrapper around whichever API (real LMS or fallback) is in play. */
export class ScormAdapter {
  /** @param {{ storageKey?: string, forceFallback?: boolean, api?: any }} [opts] */
  constructor(opts = {}) {
    // An explicitly injected api wins (used by headless tests and the preview
    // harness supplying a mock LMS). Otherwise discover, then fall back.
    this.api = opts.api || (opts.forceFallback ? null : discoverAPI());
    this.usingFallback = false;
    if (!this.api) { this.api = createFallbackAPI(opts.storageKey); this.usingFallback = true; }
    this.injected = !!opts.api;
    this.initialized = false;
    this._log = [];
  }
  _record(op, el, val, result) {
    this._log.push(`${op}(${el ?? ''}${val !== undefined ? ', ' + val : ''}) -> ${result}`);
    if (this._log.length > 200) this._log.shift();
  }
  initialize() {
    const r = this.api.Initialize('');
    this.initialized = r === 'true' || r === true;
    this._record('Initialize', '', undefined, r);
    return this.initialized;
  }
  getValue(element) { const v = this.api.GetValue(element); this._record('GetValue', element, undefined, v); return v; }
  setValue(element, value) { const r = this.api.SetValue(element, String(value)); this._record('SetValue', element, value, r); return r; }
  commit() { const r = this.api.Commit(''); this._record('Commit', '', undefined, r); return r; }
  terminate() {
    if (!this.initialized) return 'true';
    const r = this.api.Terminate('');
    this.initialized = false;
    this._record('Terminate', '', undefined, r);
    return r;
  }
  lastError() { return this.api.GetLastError ? this.api.GetLastError() : '0'; }
  get log() { return this._log.slice(); }
}
