// @ts-check
/**
 * Headless mock LMS implementing the SCORM 2004 4th Edition API_1484_11
 * surface. Persists cmi state across "sessions" so tests can simulate the exact
 * suspend -> close -> relaunch -> resume cycle a real LMS performs.
 *
 * cmi.interactions follows the spec's array rules strictly, so a SCO that
 * skips an index (351) or writes a field before its id (408) fails here the
 * way it would in a real LMS. Timestamps and results are type-checked (406),
 * since strict LMSs silently drop a malformed value.
 *
 * Usage:
 *   const lms = new MockLMS();
 *   const api = lms.newAttempt();   // first launch -> cmi.entry = 'ab-initio'
 *   ... run the SCO, Terminate ...
 *   const api2 = lms.newAttempt();  // relaunch -> cmi.entry = 'resume'
 */
export class MockLMS {
  /** @param {{learnerName?:string, learnerId?:string}} [opts] */
  constructor(opts = {}) {
    /** Persistent (data-model) state that survives Terminate. */
    this.persistent = {
      'cmi.completion_status': 'unknown',
      'cmi.success_status': 'unknown',
      'cmi.location': '',
      'cmi.suspend_data': '',
      'cmi.progress_measure': '',
      'cmi.total_time': 'PT0H0M0S',
      'cmi.exit': '',
    };
    // Read-only learner identity supplied by the LMS.
    this.learnerName = opts.learnerName !== undefined ? opts.learnerName : 'Quinn, Darryl';
    this.learnerId = opts.learnerId !== undefined ? opts.learnerId : 'jquinnd1';
    this.launchCount = 0;
    /** @type {string[]} */
    this.commitLog = [];
  }

  /** Produce a fresh API object for one launch/attempt. */
  newAttempt() {
    this.launchCount++;
    const suspended = this.persistent['cmi.exit'] === 'suspend' || !!this.persistent['cmi.suspend_data'];
    const session = {
      ...this.persistent,
      'cmi.entry': suspended ? 'resume' : 'ab-initio',
      'cmi.exit': '',
      'cmi.session_time': 'PT0H0M0S',
      'cmi.learner_name': this.learnerName,
      'cmi.learner_id': this.learnerId,
    };
    let initialized = false, terminated = false, lastError = '0';
    const self = this;

    const api = {
      Initialize(p) {
        if (p !== '' && p !== undefined) { lastError = '201'; return 'false'; }
        if (initialized) { lastError = '103'; return 'false'; }
        initialized = true; lastError = '0'; return 'true';
      },
      Terminate(p) {
        if (p !== '' && p !== undefined) { lastError = '201'; return 'false'; }
        if (!initialized || terminated) { lastError = '112'; return 'false'; }
        api.Commit('');
        self.persistent['cmi.total_time'] = addDurations(
          self.persistent['cmi.total_time'] || 'PT0H0M0S',
          session['cmi.session_time'] || 'PT0H0M0S'
        );
        terminated = true; initialized = false; lastError = '0'; return 'true';
      },
      GetValue(el) {
        if (!initialized) { lastError = '122'; return ''; }
        lastError = '0';
        const count = COUNT_RE.exec(el);
        if (count) return String(countEntries(session, count[1]));
        return session[el] !== undefined ? String(session[el]) : '';
      },
      SetValue(el, v) {
        if (!initialized) { lastError = '132'; return 'false'; }
        if (READ_ONLY.has(el) || COUNT_RE.test(el)) { lastError = '404'; return 'false'; }
        const err = arrayOrderError(session, el) || formatError(el, String(v));
        if (err) { lastError = err; return 'false'; }
        session[el] = String(v); lastError = '0'; return 'true';
      },
      Commit(p) {
        if (p !== '' && p !== undefined) { lastError = '201'; return 'false'; }
        if (!initialized) { lastError = '142'; return 'false'; }
        for (const k of PERSISTED_KEYS) if (session[k] !== undefined) self.persistent[k] = session[k];
        for (const k of Object.keys(session)) if (k.startsWith('cmi.interactions.')) self.persistent[k] = session[k];
        self.commitLog.push(JSON.stringify({ ...self.persistent }));
        lastError = '0'; return 'true';
      },
      GetLastError() { return lastError; },
      GetErrorString(code) { return ERROR_STRINGS[code] || ''; },
      GetDiagnostic() { return ''; },
      _session: session,
    };
    return api;
  }

  /** Snapshot of persistent LMS state (what a real LMS would store). */
  snapshot() { return { ...this.persistent, launchCount: this.launchCount }; }

  /** Committed interactions as objects, in index order. */
  interactions() {
    const out = [];
    for (let n = 0; this.persistent[`cmi.interactions.${n}.id`] !== undefined; n++) {
      const prefix = `cmi.interactions.${n}.`;
      const entry = {};
      for (const [k, v] of Object.entries(this.persistent)) if (k.startsWith(prefix)) entry[k.slice(prefix.length)] = v;
      out.push(entry);
    }
    return out;
  }
}

const COUNT_RE = /^(cmi\.interactions(?:\.\d+\.objectives)?)\._count$/;

/** Entries in a data-model array: each one exists once its id is set. */
function countEntries(data, base) {
  let n = 0;
  while (data[`${base}.${n}.id`] !== undefined) n++;
  return n;
}

/** SCORM time(second,10,0): a time zone is only allowed after fractional seconds. */
const SCORM_TIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d{1,2}(Z|[+-]\d{2}(:\d{2})?)?)?)?)?)?)?)?$/;
const RESULTS = new Set(['correct', 'incorrect', 'unanticipated', 'neutral']);

/** @returns {string} '406' (type mismatch) for a malformed value, else '' */
function formatError(el, v) {
  if (/^cmi\.interactions\.\d+\.timestamp$/.test(el) && !SCORM_TIME.test(v)) return '406';
  if (/^cmi\.interactions\.\d+\.result$/.test(el) && !RESULTS.has(v) && !isFinite(Number(v))) return '406';
  return '';
}

/**
 * SCORM 2004 array rules for cmi.interactions (and its objectives): a new
 * entry must be created at index _count, and by setting its id first.
 * @returns {string} error code, or '' when the write is allowed
 */
function arrayOrderError(data, el) {
  const m = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(el);
  if (!m) return '';
  const n = Number(m[1]);
  const count = countEntries(data, 'cmi.interactions');
  if (n > count) return '351';
  if (n === count && m[2] !== 'id') return '408';
  const obj = /^objectives\.(\d+)\.(.+)$/.exec(m[2]);
  if (obj) {
    const oc = countEntries(data, `cmi.interactions.${n}.objectives`);
    if (Number(obj[1]) > oc) return '351';
    if (Number(obj[1]) === oc && obj[2] !== 'id') return '408';
  }
  return '';
}

const READ_ONLY = new Set(['cmi.entry', 'cmi.total_time', 'cmi.learner_name', 'cmi.learner_id',
  'cmi.completion_threshold', 'cmi.max_time_allowed']);
const PERSISTED_KEYS = ['cmi.completion_status', 'cmi.success_status', 'cmi.location',
  'cmi.suspend_data', 'cmi.progress_measure', 'cmi.exit', 'cmi.session_time'];
const ERROR_STRINGS = {
  '0': 'No error', '101': 'General exception', '103': 'Already initialized',
  '112': 'Termination before initialization', '122': 'Retrieve data before initialization',
  '132': 'Store data before initialization', '142': 'Commit before initialization',
  '201': 'General argument error', '351': 'General set failure',
  '404': 'Data model element is read only', '406': 'Data model element type mismatch', '408': 'Data model dependency not established',
};

/** Add two ISO 8601 PTnHnMnS durations. */
export function addDurations(a, b) {
  let total = parseDuration(a) + parseDuration(b);
  const h = Math.floor(total / 3600); total -= h * 3600;
  const m = Math.floor(total / 60); const s = total - m * 60;
  return `PT${h}H${m}M${s}S`;
}
function parseDuration(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(String(d || '')) || [];
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + Math.round(parseFloat(m[3] || '0'));
}
