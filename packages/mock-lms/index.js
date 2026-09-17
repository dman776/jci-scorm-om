// @ts-check
/**
 * Headless mock LMS implementing the SCORM 2004 4th Edition API_1484_11
 * surface. Persists cmi state across "sessions" so tests can simulate the
 * exact suspend -> close -> relaunch -> resume cycle a real LMS performs.
 */

export class MockLMS {
  constructor() {
    this.persistent = {
      'cmi.completion_status': 'unknown',
      'cmi.success_status': 'unknown',
      'cmi.location': '',
      'cmi.suspend_data': '',
      'cmi.progress_measure': '',
      'cmi.total_time': 'PT0H0M0S',
      'cmi.exit': '',
    };
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
    };
    let initialized = false;
    let terminated = false;
    let lastError = '0';
    const self = this;

    const api = {
      Initialize(param) {
        if (param !== '' && param !== undefined) { lastError = '201'; return 'false'; }
        if (initialized) { lastError = '103'; return 'false'; }
        initialized = true; lastError = '0'; return 'true';
      },
      Terminate(param) {
        if (param !== '' && param !== undefined) { lastError = '201'; return 'false'; }
        if (!initialized || terminated) { lastError = '112'; return 'false'; }
        api.Commit('');
        self.persistent['cmi.total_time'] = addDurations(
          self.persistent['cmi.total_time'] || 'PT0H0M0S',
          session['cmi.session_time'] || 'PT0H0M0S'
        );
        terminated = true; initialized = false; lastError = '0'; return 'true';
      },
      GetValue(element) {
        if (!initialized) { lastError = '122'; return ''; }
        lastError = '0';
        return session[element] !== undefined ? String(session[element]) : '';
      },
      SetValue(element, value) {
        if (!initialized) { lastError = '132'; return 'false'; }
        if (READ_ONLY.has(element)) { lastError = '404'; return 'false'; }
        session[element] = String(value);
        lastError = '0';
        return 'true';
      },
      Commit(param) {
        if (param !== '' && param !== undefined) { lastError = '201'; return 'false'; }
        if (!initialized) { lastError = '142'; return 'false'; }
        for (const key of PERSISTED_KEYS) {
          if (session[key] !== undefined) self.persistent[key] = session[key];
        }
        self.commitLog.push(JSON.stringify({ ...self.persistent }));
        lastError = '0';
        return 'true';
      },
      GetLastError() { return lastError; },
      GetErrorString(code) { return ERROR_STRINGS[code] || ''; },
      GetDiagnostic() { return ''; },
      _session: session,
    };
    return api;
  }

  snapshot() {
    return { ...this.persistent, launchCount: this.launchCount };
  }
}

const READ_ONLY = new Set(['cmi.entry', 'cmi.total_time', 'cmi.completion_threshold', 'cmi.max_time_allowed']);

const PERSISTED_KEYS = [
  'cmi.completion_status', 'cmi.success_status', 'cmi.location',
  'cmi.suspend_data', 'cmi.progress_measure', 'cmi.exit', 'cmi.session_time',
];

const ERROR_STRINGS = {
  '0': 'No error',
  '101': 'General exception',
  '103': 'Already initialized',
  '112': 'Termination before initialization',
  '122': 'Retrieve data before initialization',
  '132': 'Store data before initialization',
  '142': 'Commit before initialization',
  '201': 'General argument error',
  '404': 'Data model element is read only',
};

/** Add two ISO 8601 PTnHnMnS durations. */
export function addDurations(a, b) {
  let total = parseDuration(a) + parseDuration(b);
  const h = Math.floor(total / 3600);
  total -= h * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `PT${h}H${m}M${s}S`;
}
function parseDuration(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(String(d || '')) || [];
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + Math.round(parseFloat(m[3] || '0'));
}
