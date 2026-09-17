// @ts-check
/**
 * SessionCore - the DOM-free heart of the learner runtime.
 *
 * Owns all SCORM interaction and learner-state bookkeeping: initialize,
 * resume, auto-save, completion/progress reporting, and suspend-on-exit. The
 * DOM player (player.js) wraps a SessionCore and only renders; the headless
 * mock-LMS tests drive a SessionCore directly, so the exact same persistence
 * logic runs in preview, in the exported package, and under test.
 */
import {
  computeAllSectionStatus,
  computeProgressMeasure,
  isWorkbookComplete,
  isSectionUnlocked,
  COMPLETED,
} from './engine/completion.js';
import { serializeState, deserializeState, estimateSuspendSize } from './engine/suspend.js';

export class SessionCore {
  /** @param {{ workbook: import('@sowb/shared').Workbook, adapter: any }} opts */
  constructor(opts) {
    this.workbook = opts.workbook;
    this.adapter = opts.adapter;
    this.startTime = Date.now();
    this._exited = false;
    /** @type {import('@sowb/shared').LearnerState} */
    this.state = {
      currentSection: (this.workbook.sections[0] || {}).id || '',
      currentPage: 0,
      responses: {},
      sectionStatus: {},
    };
  }

  init() {
    this.adapter.initialize();
    const entry = this.adapter.getValue('cmi.entry');
    if (entry === 'resume') {
      const restored = deserializeState(this.adapter.getValue('cmi.suspend_data'));
      if (restored.currentSection) this.state = restored;
      const loc = this.adapter.getValue('cmi.location');
      if (loc) this._applyLocation(loc);
    }
    this.state.sectionStatus = computeAllSectionStatus(this.workbook, this.state.responses);
    return { entry, resumed: entry === 'resume' };
  }

  _applyLocation(loc) {
    const [sid, page] = String(loc).split(':');
    if (sid) this.state.currentSection = sid;
    if (page !== undefined) this.state.currentPage = parseInt(page, 10) || 0;
  }
  location() { return `${this.state.currentSection}:${this.state.currentPage}`; }

  /** Write full state to the LMS and Commit. Called after every page + change. */
  save() {
    this.state.sectionStatus = computeAllSectionStatus(this.workbook, this.state.responses);
    this.adapter.setValue('cmi.location', this.location());
    this.adapter.setValue('cmi.suspend_data', serializeState(this.state));
    this.adapter.setValue('cmi.progress_measure', String(this.progress()));
    const complete = isWorkbookComplete(this.workbook, this.state.sectionStatus);
    // SCORM 2004 has no "partial" completion value; partially complete
    // sections still report the workbook as incomplete.
    this.adapter.setValue('cmi.completion_status', complete ? 'completed' : 'incomplete');
    if (this.workbook.settings && this.workbook.settings.reportSuccess) {
      this.adapter.setValue('cmi.success_status', complete ? 'passed' : 'unknown');
    }
    this.adapter.commit();
    return { bytes: estimateSuspendSize(this.state), complete };
  }

  setResponse(questionId, value) {
    this.state.responses[questionId] = value;
    return this.save();
  }

  /** Question-level progress measure (partial responses do not count). */
  progress() {
    return computeProgressMeasure(this.workbook, this.state.sectionStatus, this.state.responses);
  }
  isComplete() { return isWorkbookComplete(this.workbook, this.state.sectionStatus); }
  isUnlocked(sectionId) { return isSectionUnlocked(this.workbook, sectionId, this.state.sectionStatus); }
  currentSection() {
    return this.workbook.sections.find((s) => s.id === this.state.currentSection) || this.workbook.sections[0];
  }

    openSection(sectionId) {
    if (!this.isUnlocked(sectionId)) return false;
    // Start at question 1 when opening a DIFFERENT section, or when reopening a
    // COMPLETED section (the learner is reviewing, so begin at the top).
    // Otherwise resume at the saved page so "Continue" lands in place.
    const reviewing = this.state.sectionStatus[sectionId] === COMPLETED;
    if (sectionId !== this.state.currentSection || reviewing) {
      this.state.currentPage = 0;
    }
    this.state.currentSection = sectionId;
    this.save();
    return true;
  }
  nextPage() {
    const section = this.currentSection();
    if (this.state.currentPage < section.questions.length - 1) { this.state.currentPage++; this.save(); return true; }
    this.save();
    return false;
  }
  prevPage() {
    if (this.state.currentPage > 0) { this.state.currentPage--; this.save(); return true; }
    this.save();
    return false;
  }

  /** Suspend + terminate so the LMS preserves state for the next launch. */
  suspendAndExit() {
    if (this._exited) return;
    this._exited = true;
    this.save();
    this.adapter.setValue('cmi.exit', 'suspend');
    this.adapter.setValue('cmi.session_time', toIsoDuration(Date.now() - this.startTime));
    this.adapter.commit();
    this.adapter.terminate();
  }

  suspendBytes() { return estimateSuspendSize(this.state); }
}

/** Milliseconds to ISO 8601 duration (PTnHnMnS). */
export function toIsoDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `PT${h}H${m}M${s}S`;
}
