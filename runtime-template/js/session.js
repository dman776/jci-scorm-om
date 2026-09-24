// @ts-check
/**
 * SessionCore - the DOM-free heart of the learner runtime.
 *
 * Owns all SCORM interaction and learner-state bookkeeping: initialize, resume,
 * auto-save, completion/progress reporting, per-question cmi.interactions
 * reporting, and suspend-on-exit. The DOM player
 * (player.js) wraps a SessionCore and only renders; the headless mock-LMS tests
 * drive a SessionCore directly, so the exact same persistence logic runs in
 * preview, in the exported package, and under test.
 */
import {
  computeAllSectionStatus, computeProgressMeasure,
  isWorkbookComplete, isSectionUnlocked, isSectionLocked, shouldLockSection, COMPLETED,
} from './engine/completion.js';
import { serializeState, deserializeState, estimateSuspendSize } from './engine/suspend.js';
import {
  interactionType, formatLearnerResponse, interactionResult, interactionDescription,
  toScormTimestamp, INTERACTIONS_LIMIT,
} from './engine/interactions.js';

export class SessionCore {
  /** @param {{ workbook: any, adapter: any }} opts */
  constructor(opts) {
    this.workbook = opts.workbook;
    this.adapter = opts.adapter;
    this.startTime = Date.now();
    this._exited = false;
    /** Learner identity reported by the LMS, read once at init. */
    this._learnerName = '';
    this.state = {
      currentSection: (this.workbook.sections[0] || {}).id || '',
      currentPage: 0,
      responses: {},
      sectionStatus: {},
      lockedSections: [],
    };
    /** questionId -> sectionId, so a write can find the section that governs it. */
    this._sectionOfQuestion = {};
    /** questionId -> question definition. */
    this._questions = {};
    for (const section of this.workbook.sections || []) {
      for (const question of section.questions || []) {
        this._sectionOfQuestion[question.id] = section.id;
        this._questions[question.id] = question;
      }
    }
    const settings = this.workbook.settings || {};
    this._reportInteractions = settings.reportInteractions !== false;
    this._lang = settings.language || 'en-US';
    /** questionId -> cmi.interactions index, rebuilt from the LMS at init. */
    this._interactionIndex = {};
    this._interactionCount = 0;
    /** Questions answered since the last flush. */
    this._dirtyInteractions = new Set();
  }

  init() {
    this.adapter.initialize();
    // cmi.learner_name is read-only and supplied by the LMS. Capture it once at
    // launch so the PDF report can identify the learner. It is never written to
    // suspend data (the LMS already owns it).
    this._learnerName = normalizeLearnerName(this.adapter.getValue('cmi.learner_name'));

    const entry = this.adapter.getValue('cmi.entry');
    if (entry === 'resume') {
      const restored = deserializeState(this.adapter.getValue('cmi.suspend_data'));
      if (restored.currentSection) this.state = restored;
      const loc = this.adapter.getValue('cmi.location');
      if (loc) this._applyLocation(loc);
    }
    this.state.sectionStatus = computeAllSectionStatus(this.workbook, this.state.responses);
    if (this._reportInteractions) this._loadInteractionIndex();
    return { entry, resumed: entry === 'resume', learnerName: this._learnerName };
  }

  /** Learner display name from the LMS, or '' when unavailable. */
  learnerName() { return this._learnerName; }

  _applyLocation(loc) {
    const [sid, page] = String(loc).split(':');
    if (sid) this.state.currentSection = sid;
    if (page !== undefined) this.state.currentPage = parseInt(page, 10) || 0;
  }
  location() { return `${this.state.currentSection}:${this.state.currentPage}`; }

  /**
   * Interactions from earlier sessions stay in the LMS, keyed by index. Map
   * them back to question ids so a resumed session updates the same entries
   * instead of appending duplicates.
   */
  _loadInteractionIndex() {
    const count = parseInt(this.adapter.getValue('cmi.interactions._count'), 10) || 0;
    this._interactionCount = count;
    for (let n = 0; n < count; n++) {
      const id = this.adapter.getValue(`cmi.interactions.${n}.id`);
      if (id && this._interactionIndex[id] === undefined) this._interactionIndex[id] = n;
    }
  }

  /**
   * Write every question answered since the last flush to cmi.interactions.
   * Runs on navigation and exit, never per keystroke: some LMSs journal each
   * interaction write, and typing would bury the report in partial answers.
   * The caller's save() commits.
   */
  _flushInteractions() {
    if (!this._reportInteractions) return;
    const set = (n, field, v) => this.adapter.setValue(`cmi.interactions.${n}.${field}`, v);
    for (const questionId of this._dirtyInteractions) {
      const question = this._questions[questionId];
      if (!question) continue;
      const value = this.state.responses[questionId];
      const response = formatLearnerResponse(question, value, this._lang);
      let n = this._interactionIndex[questionId];
      if (n === undefined) {
        // Nothing to report yet, and SCORM cannot delete an interaction, so a
        // blank answer never creates one.
        if (response === null || response === '') continue;
        if (this._interactionCount >= INTERACTIONS_LIMIT) continue;
        n = this._interactionCount;
        // id must be set first; any other field on a new index is error 408.
        if (String(set(n, 'id', questionId)) !== 'true') continue;
        this._interactionIndex[questionId] = n;
        this._interactionCount++;
        set(n, 'type', interactionType(question));
        set(n, 'description', interactionDescription(question, this._lang));
        set(n, 'objectives.0.id', this._sectionOfQuestion[questionId]);
      }
      if (response !== null) set(n, 'learner_response', response);
      set(n, 'result', interactionResult(question, value));
      set(n, 'timestamp', toScormTimestamp());
    }
    this._dirtyInteractions.clear();
  }

  /** Save at a navigation point: report changed answers, then commit. */
  _checkpoint() {
    this._flushInteractions();
    return this.save();
  }

  /** Write full state to the LMS and Commit. Called after every page + change. */
  save() {
    this.state.sectionStatus = computeAllSectionStatus(this.workbook, this.state.responses);
    this.adapter.setValue('cmi.location', this.location());
    this.adapter.setValue('cmi.suspend_data', serializeState(this.state));
    this.adapter.setValue('cmi.progress_measure', String(this.progress()));
    const complete = isWorkbookComplete(this.workbook, this.state.sectionStatus);
    // SCORM 2004 has no "partial" completion value; partially complete sections
    // still report the workbook as incomplete.
    this.adapter.setValue('cmi.completion_status', complete ? 'completed' : 'incomplete');
    if (this.workbook.settings && this.workbook.settings.reportSuccess) {
      this.adapter.setValue('cmi.success_status', complete ? 'passed' : 'unknown');
    }
    this.adapter.commit();
    return { bytes: estimateSuspendSize(this.state), complete };
  }

  /**
   * Record a response, unless its section's answers are already final. The
   * rejection here is the real guarantee; disabling the inputs in the player is
   * only the visible half of it.
   */
  setResponse(questionId, value) {
    if (this.isQuestionLocked(questionId)) {
      return { bytes: this.suspendBytes(), complete: this.isComplete(), locked: true };
    }
    this.state.responses[questionId] = value;
    this._dirtyInteractions.add(questionId);
    return this.save();
  }

  /** Question-level progress measure (partial responses do not count). */
  progress() { return computeProgressMeasure(this.workbook, this.state.sectionStatus, this.state.responses); }
  isComplete() { return isWorkbookComplete(this.workbook, this.state.sectionStatus); }
  isUnlocked(sectionId) { return isSectionUnlocked(this.workbook, sectionId, this.state.sectionStatus); }
  currentSection() {
    return this.workbook.sections.find((s) => s.id === this.state.currentSection) || this.workbook.sections[0];
  }
  _section(sectionId) { return this.workbook.sections.find((s) => s.id === sectionId); }

  /**
   * Are this section's answers final? Distinct from isUnlocked(), which is the
   * linear-navigation gate on whether the section can be OPENED at all. A
   * locked section is still fully readable; only its answers are frozen.
   */
  isLocked(sectionId) {
    return isSectionLocked(this._section(sectionId), this.state.sectionStatus[sectionId], this.state.lockedSections);
  }
  isQuestionLocked(questionId) { return this.isLocked(this._sectionOfQuestion[questionId]); }

  /**
   * Leave the current section. This is where an opt-in lock commits, so the
   * learner can still fix the answer that completed the section right up until
   * they step out of it.
   */
  closeSection() {
    this._commitLock(this.state.currentSection);
    return this._checkpoint();
  }

  _commitLock(sectionId) {
    if (!shouldLockSection(this._section(sectionId), this.state.sectionStatus[sectionId])) return false;
    if (!this.state.lockedSections.includes(sectionId)) this.state.lockedSections.push(sectionId);
    return true;
  }

  openSection(sectionId) {
    if (!this.isUnlocked(sectionId)) return false;
    // Moving straight from one section to another still counts as leaving.
    if (sectionId !== this.state.currentSection) this._commitLock(this.state.currentSection);
    // Start at question 1 when opening a DIFFERENT section, or when reopening a
    // COMPLETED section (the learner is reviewing, so begin at the top).
    // Otherwise resume at the saved page so "Continue" lands in place.
    const reviewing = this.state.sectionStatus[sectionId] === COMPLETED;
    if (sectionId !== this.state.currentSection || reviewing) this.state.currentPage = 0;
    this.state.currentSection = sectionId;
    this._checkpoint();
    return true;
  }

  nextPage() {
    const section = this.currentSection();
    if (this.state.currentPage < section.questions.length - 1) { this.state.currentPage++; this._checkpoint(); return true; }
    this._checkpoint();
    return false; // caller returns to the dashboard
  }
  prevPage() {
    if (this.state.currentPage > 0) { this.state.currentPage--; this._checkpoint(); return true; }
    this._checkpoint();
    return false;
  }

  /** Suspend + terminate so the LMS preserves state for the next launch. */
  suspendAndExit() {
    if (this._exited) return;
    this._exited = true;
    // Exiting from inside a completed section is leaving it, so the lock
    // commits here too and the learner resumes to the same state they left.
    this._commitLock(this.state.currentSection);
    this._checkpoint();
    this.adapter.setValue('cmi.exit', 'suspend');
    this.adapter.setValue('cmi.session_time', toIsoDuration(Date.now() - this.startTime));
    this.adapter.commit();
    this.adapter.terminate();
  }

  suspendBytes() { return estimateSuspendSize(this.state); }
  interactionCount() { return this._interactionCount; }
}

/**
 * LMSs commonly report cmi.learner_name as "Last, First". Flip it to
 * "First Last" for a natural reading. Anything that is not a simple two-part
 * comma pair is left as-is.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeLearnerName(raw) {
  const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const parts = name.split(',');
  if (parts.length === 2) {
    const last = parts[0].trim(), first = parts[1].trim();
    if (last && first) return `${first} ${last}`;
  }
  return name;
}

/** Milliseconds to ISO 8601 duration (PTnHnMnS). */
export function toIsoDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `PT${h}H${m}M${s}S`;
}
