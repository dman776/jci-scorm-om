// @ts-check
/**
 * SCORM 2004 4th Edition runtime adapter.
 *
 * Responsibilities:
 *  - Discover the LMS-provided API object named `API_1484_11` by walking up
 *    the parent frame chain and then the opener chain (the algorithm mandated
 *    by the SCORM 2004 Run-Time Environment spec).
 *  - Provide a standalone in-memory fallback (backed by localStorage) so the
 *    same player runs during local preview and offline with no LMS present.
 *  - Expose a small convenience API so the player never touches the raw
 *    eight-function IEEE 1484.11.2 surface directly.
 *
 * This file ships verbatim inside the exported package. No third-party code.
 */

const MAX_FRAME_DEPTH = 100;

function findAPIInWindow(win) {
  let current = win;
  let depth = 0;
  while (current && depth < MAX_FRAME_DEPTH) {
    try {
      if (current.API_1484_11) return current.API_1484_11;
    } catch (_) {
      return null; // cross-origin frame; stop climbing
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
    try {
      api = findAPIInWindow(window.opener);
    } catch (_) {
      api = null;
    }
  }
  return api || null;
}

/** Spec-shaped fallback API used when no LMS is present. */
export function createFallbackAPI(storageKey = 'sowb.fallback') {
  /** @type {Record<string,string>} */
  const data = {
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    'cmi.entry': 'ab-initio',
    'cmi.exit': '',
    'cmi.location': '',
    'cmi.suspend_data': '',
    'cmi.progress_measure': '',
    'cmi.session_time': '',
    'cmi.total_time': 'PT0H0M0S',
  };
  let initialized = false;
  let lastError = '0';

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        Object.assign(data, JSON.parse(raw));
        if (data['cmi.exit'] === 'suspend' || data['cmi.suspend_data']) data['cmi.entry'] = 'resume';
      }
    } catch (_) { /* ignore */ }
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (_) { /* ignore */ }
  }
  load();

  return {
    __fallback: true,
    Initialize() { initialized = true; lastError = '0'; return 'true'; },
    Terminate() { initialized = false; persist(); return 'true'; },
    GetValue(el) { lastError = '0'; return data[el] !== undefined ? data[el] : ''; },
    SetValue(el, val) { data[el] = String(val); lastError = '0'; return 'true'; },
    Commit() { persist(); lastError = '0'; return 'true'; },
    GetLastError() { return lastError; },
    GetErrorString() { return ''; },
    GetDiagnostic() { return ''; },
    _dump() { return { ...data }; },
    _reset() { try { localStorage.removeItem(storageKey); } catch (_) {} },
  };
}

/** High-level wrapper around whichever API (real LMS or fallback) is in play. */
export class ScormAdapter {
  /** @param {{ storageKey?: string, forceFallback?: boolean, api?: any }} [opts] */
  constructor(opts = {}) {
    this.api = opts.api || (opts.forceFallback ? null : discoverAPI());
    this.usingFallback = false;
    if (!this.api) {
      this.api = createFallbackAPI(opts.storageKey);
      this.usingFallback = true;
    }
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
  getValue(element) {
    const v = this.api.GetValue(element);
    this._record('GetValue', element, undefined, v);
    return v;
  }
  setValue(element, value) {
    const r = this.api.SetValue(element, String(value));
    this._record('SetValue', element, value, r);
    return r;
  }
  commit() {
    const r = this.api.Commit('');
    this._record('Commit', '', undefined, r);
    return r;
  }
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
