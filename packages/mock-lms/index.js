// @ts-check
/**
 * Headless mock LMS implementing the SCORM 2004 4th Edition API_1484_11
 * surface. Persists cmi state across "sessions" so tests can simulate the exact
 * suspend -> close -> relaunch -> resume cycle a real LMS performs.
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
        return session[el] !== undefined ? String(session[el]) : '';
      },
      SetValue(el, v) {
        if (!initialized) { lastError = '132'; return 'false'; }
        if (READ_ONLY.has(el)) { lastError = '404'; return 'false'; }
        session[el] = String(v); lastError = '0'; return 'true';
      },
      Commit(p) {
        if (p !== '' && p !== undefined) { lastError = '201'; return 'false'; }
        if (!initialized) { lastError = '142'; return 'false'; }
        for (const k of PERSISTED_KEYS) if (session[k] !== undefined) self.persistent[k] = session[k];
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
}

const READ_ONLY = new Set(['cmi.entry', 'cmi.total_time', 'cmi.learner_name', 'cmi.learner_id',
  'cmi.completion_threshold', 'cmi.max_time_allowed']);
const PERSISTED_KEYS = ['cmi.completion_status', 'cmi.success_status', 'cmi.location',
  'cmi.suspend_data', 'cmi.progress_measure', 'cmi.exit', 'cmi.session_time'];
const ERROR_STRINGS = {
  '0': 'No error', '101': 'General exception', '103': 'Already initialized',
  '112': 'Termination before initialization', '122': 'Retrieve data before initialization',
  '132': 'Store data before initialization', '142': 'Commit before initialization',
  '201': 'General argument error', '404': 'Data model element is read only',
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
