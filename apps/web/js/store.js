// @ts-check
/**
 * Client-side working state for the authoring UI. Holds the current workbook,
 * mirrors it to localStorage (so a reload does not lose work), and notifies
 * subscribers on change.
 */
import { newSectionId, newQuestionId, newOptionId } from './ids-browser.js';

const LS_KEY = 'sowb.currentWorkbook';

class Store {
  constructor() {
    this.workbook = migrate(this._load() || blank());
    this.dirty = false;
    this.subs = new Set();
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _emit() { for (const fn of this.subs) fn(this.workbook); }
  _load() { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
  persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.workbook)); } catch { /* ignore */ } }
  set(workbook) { this.workbook = migrate(workbook); this.dirty = true; this.persist(); this._emit(); }
  update(mutator) { mutator(this.workbook); this.dirty = true; this.persist(); this._emit(); }
  markSaved() { this.dirty = false; }
  hasContent() {
    return (this.workbook.sections || []).length > 0 ||
      (this.workbook.title && this.workbook.title !== 'Untitled Observation Workbook');
  }

  // ---- section ops ----
  addSection() {
    this.update((wb) => wb.sections.push({ id: newSectionId(), title: 'New Section', required: true, questions: [] }));
  }
  duplicateSection(id) {
    this.update((wb) => {
      const idx = wb.sections.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const copy = deepClone(wb.sections[idx]);
      copy.id = newSectionId();
      copy.title += ' (copy)';
      copy.questions = copy.questions.map((q) => reId(q));
      wb.sections.splice(idx + 1, 0, copy);
    });
  }
  deleteSection(id) { this.update((wb) => { wb.sections = wb.sections.filter((s) => s.id !== id); }); }
  moveSection(id, dir) { this.update((wb) => move(wb.sections, wb.sections.findIndex((s) => s.id === id), dir)); }

  // ---- question ops ----
  addQuestion(sectionId, type = 'short_text') {
    this.update((wb) => {
      const s = wb.sections.find((x) => x.id === sectionId);
      if (s) s.questions.push(newQuestion(type));
    });
  }
  duplicateQuestion(sectionId, qid) {
    this.update((wb) => {
      const s = wb.sections.find((x) => x.id === sectionId);
      if (!s) return;
      const idx = s.questions.findIndex((q) => q.id === qid);
      if (idx < 0) return;
      const copy = reId(deepClone(s.questions[idx]));
      copy.prompt += ' (copy)';
      s.questions.splice(idx + 1, 0, copy);
    });
  }
  deleteQuestion(sectionId, qid) {
    this.update((wb) => {
      const s = wb.sections.find((x) => x.id === sectionId);
      if (s) s.questions = s.questions.filter((q) => q.id !== qid);
    });
  }
  moveQuestion(sectionId, qid, dir) {
    this.update((wb) => {
      const s = wb.sections.find((x) => x.id === sectionId);
      if (s) move(s.questions, s.questions.findIndex((q) => q.id === qid), dir);
    });
  }
}

export function newQuestion(type) {
  const q = { id: newQuestionId(), type, prompt: 'New question', required: true };
  if (['single_select', 'multiple_select', 'checklist'].includes(type)) {
    q.options = [{ id: newOptionId(), label: 'Option 1' }, { id: newOptionId(), label: 'Option 2' }];
  }
  // New rating questions default to the numeric built-in.
  if (type === 'rating') q.scaleId = 'numeric-5';
  return q;
}

function blank() {
  return {
    id: '', title: 'Untitled Observation Workbook', description: '', version: '1.0',
    author: '', courseId: '', estimatedDuration: '',
    settings: {
      language: 'en-US', navigation: 'free', completionRule: 'all-required-sections',
      reportSuccess: false, dashboardHeading: 'Your observation workbook', allowPdfDownload: true,
    },
    sections: [],
  };
}

/** Fill in fields added after a workbook was first authored. */
function migrate(wb) {
  if (!wb || typeof wb !== 'object') return blank();
  wb.settings = wb.settings || {};
  if (!wb.settings.dashboardHeading) wb.settings.dashboardHeading = 'Your observation workbook';
  // Absent means "on", matching the runtime default.
  if (wb.settings.allowPdfDownload === undefined) wb.settings.allowPdfDownload = true;
  return wb;
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function reId(q) {
  q.id = newQuestionId();
  if (q.options) q.options = q.options.map((o) => ({ ...o, id: newOptionId() }));
  return q;
}
function move(arr, idx, dir) {
  if (idx < 0) return;
  const to = idx + dir;
  if (to < 0 || to >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(to, 0, item);
}

export const store = new Store();
export { blank as blankWorkbook };
