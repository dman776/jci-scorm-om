// @ts-check
/**
 * Learner runtime player (DOM layer). This is the SAME module used by the
 * authoring preview (against the mock LMS) and shipped inside the exported
 * SCORM package (against the real LMS). All SCORM interaction + state lives in
 * SessionCore; this file only renders and wires events.
 *
 * The workbook definition is provided by the host page as `window.__WORKBOOK__`.
 */
import { ScormAdapter } from './adapter.js';
import { SessionCore } from './session.js';
import { buildResponseReport, reportFileName } from './report.js';
import { renderRating } from './rating.js';
import {
  getResponseState, getRequirementHint, isValidHttpUrl,
  COMPLETE, PARTIAL,
  COMPLETED, IN_PROGRESS, PARTIALLY_COMPLETE, NOT_STARTED,
} from './engine/completion.js';

const STATUS_LABEL = {
  [COMPLETED]: 'Completed',
  [PARTIALLY_COMPLETE]: 'Partially Complete',
  [IN_PROGRESS]: 'In Progress',
  [NOT_STARTED]: 'Not Started',
};

const DEFAULT_HEADING = 'Your observation workbook';

/** Inline download glyph. Inline SVG keeps the package asset-free. */
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z"/>' +
  '<path fill="currentColor" d="M5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/>' +
  '</svg>';

export class WorkbookPlayer {
  /**
   * @param {{ mount: any, workbook: any, adapter?: any, debug?: boolean }} opts
   */
  constructor(opts) {
    this.mount = opts.mount;
    this.workbook = opts.workbook;
    this.debug = !!opts.debug;
    const adapter = opts.adapter || new ScormAdapter();
    this.session = new SessionCore({ workbook: this.workbook, adapter });
    this.adapter = adapter;
    this.view = 'dashboard';
  }

  get state() { return this.session.state; }

  /** Author-configurable dashboard heading, with a safe default. */
  get dashboardHeading() {
    const h = this.workbook.settings && this.workbook.settings.dashboardHeading;
    return (h && String(h).trim()) || DEFAULT_HEADING;
  }

  /** Learner display name from cmi.learner_name, or '' when unavailable. */
  get learnerName() { return this.session.learnerName(); }

  /** Defaults ON so workbooks authored before this setting keep the button. */
  get pdfEnabled() {
    const s = this.workbook.settings || {};
    return s.allowPdfDownload !== false;
  }

  init() {
    // Restore state from the LMS, but ALWAYS land on the section dashboard on
    // launch (including resume) so the learner chooses what to continue. The
    // restored cursor is preserved so "Continue" reopens the last section.
    this.session.init();
    this.view = 'dashboard';
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', () => this.session.suspendAndExit());
    }
    this.render();
  }

  // ---- navigation --------------------------------------------------------

  // Every route out of a section funnels through here, so this is the single
  // place an opt-in section lock commits.
  goToDashboard() { this.view = 'dashboard'; this.session.closeSection(); this.render(); }
  openSection(id) { if (this.session.openSection(id)) { this.view = 'section'; this.render(); } }
  nextPage() { if (this.session.nextPage()) this.render(); else this.goToDashboard(); }
  prevPage() { if (this.session.prevPage()) this.render(); else this.goToDashboard(); }

  setResponse(questionId, value) {
    this.session.setResponse(questionId, value);
    this._refreshChrome();
  }

  // ---- PDF export --------------------------------------------------------

  /**
   * Build a PDF of the learner's responses for the WHOLE workbook and hand it
   * to the browser. Returns the bytes so tests can assert on them.
   */
  downloadResponsesPdf() {
    const learnerName = this.learnerName;
    const bytes = buildResponseReport(this.workbook, this.state, { learnerName });
    const filename = reportFileName(this.workbook, learnerName);
    this._deliverPdf(bytes, filename);
    return { bytes, filename, learnerName };
  }

  /**
   * Deliver the PDF as a download.
   *
   * IMPORTANT: some LMS SCORM players host the SCO in a sandboxed iframe
   * without `allow-downloads`. The browser then blocks the download SILENTLY,
   * with no exception to catch, so we always surface a visible fallback link.
   */
  _deliverPdf(bytes, filename) {
    let url = null;
    try {
      const blob = new Blob([bytes], { type: 'application/pdf' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {
      // Fall through to the visible fallback below.
    }
    this._showPdfFallback(url, filename);
    // Revoke later so the fallback link stays usable for a while. In Node
    // (tests) unref the timer so it never holds the event loop open; in the
    // browser setTimeout returns a number and there is nothing to unref.
    if (url) {
      const timer = setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 120000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }

  _showPdfFallback(url, filename) {
    const host = this.mount.querySelector('[data-pdf-fallback]');
    if (!host) return;
    host.innerHTML = '';
    if (!url) {
      const msg = el('span', 'sowb-pdf-note');
      msg.textContent = 'Could not generate the PDF in this browser.';
      host.appendChild(msg);
      return;
    }
    const note = el('span', 'sowb-pdf-note');
    note.textContent = 'Download did not start? ';
    const link = el('a', 'sowb-pdf-link');
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('download', filename);
    link.setAttribute('data-pdf-open', '');
    link.textContent = 'Open the PDF in a new tab.';
    host.appendChild(note);
    host.appendChild(link);
  }

  // ---- rendering ---------------------------------------------------------

  render() {
    this.mount.innerHTML = '';
    const shell = el('div', 'sowb-shell');
    shell.appendChild(this._renderHeader());
    const main = el('main', 'sowb-main');
    main.appendChild(this.view === 'dashboard' ? this._renderDashboard() : this._renderSection());
    shell.appendChild(main);
    if (this.debug) shell.appendChild(this._renderDebug());
    this.mount.appendChild(shell);
  }

  /** Update progress + answer status without a full re-render. */
  _refreshChrome() {
    const bar = this.mount.querySelector('[data-progress-fill]');
    if (bar) {
      const pct = Math.round(this.session.progress() * 100);
      bar.style.width = pct + '%';
      const label = this.mount.querySelector('[data-progress-label]');
      if (label) label.textContent = pct + '% complete';
    }
    if (this.view === 'section') {
      const q = this.session.currentSection().questions[this.state.currentPage];
      const status = this.mount.querySelector('[data-answer-status]');
      if (status && q) {
        const info = this._answerStatus(q);
        status.textContent = info.text;
        status.className = 'sowb-answer-status ' + info.cls;
        status.setAttribute('data-answer-status', '');
      }
      const link = this.mount.querySelector('[data-url-preview]');
      if (link && q && q.type === 'url') {
        const v = String(this.state.responses[q.id] || '').trim();
        if (isValidHttpUrl(v)) { link.setAttribute('href', v); link.textContent = 'Open link'; link.style.display = ''; }
        else link.style.display = 'none';
      }
    }
    if (this.debug) {
      const d = this.mount.querySelector('[data-debug-body]');
      if (d) d.textContent = this._debugText();
    }
  }

  _answerStatus(q) {
    const s = getResponseState(q, this.state.responses[q.id]);
    if (s === COMPLETE) return { text: 'Answer saved', cls: 'ok' };
    if (s === PARTIAL) return { text: getRequirementHint(q, this.state.responses[q.id]), cls: 'partial' };
    return { text: q.required ? 'Required' : 'Optional', cls: q.required ? 'req' : 'opt' };
  }

  _renderHeader() {
    const header = el('header', 'sowb-header');

    const left = el('div', 'sowb-header-left');
    const title = el('div', 'sowb-title');
    title.textContent = this.workbook.title;
    left.appendChild(title);
    // Greet the learner by name when the LMS provides one.
    if (this.learnerName) {
      const who = el('div', 'sowb-learner');
      who.setAttribute('data-learner-name', '');
      who.textContent = this.learnerName;
      left.appendChild(who);
    }
    header.appendChild(left);

    const right = el('div', 'sowb-header-right');
    const pct = Math.round(this.session.progress() * 100);
    const progress = el('div', 'sowb-progress');
    const track = el('div', 'sowb-progress-track');
    const fill = el('div', 'sowb-progress-fill');
    fill.setAttribute('data-progress-fill', '');
    fill.style.width = pct + '%';
    track.appendChild(fill);
    const label = el('span', 'sowb-progress-label');
    label.setAttribute('data-progress-label', '');
    label.textContent = pct + '% complete';
    progress.appendChild(track);
    progress.appendChild(label);
    right.appendChild(progress);

    // PDF export lives in the header, shown only on the dashboard so the
    // question view stays focused. It always exports the ENTIRE workbook.
    if (this.pdfEnabled && this.view === 'dashboard') right.appendChild(this._renderPdfButton());
    header.appendChild(right);
    return header;
  }

  _renderPdfButton() {
    const btn = el('button', 'sowb-icon-btn');
    btn.type = 'button';
    btn.setAttribute('data-download-pdf', '');
    // The visible label is an icon, so the accessible name carries the meaning.
    btn.setAttribute('aria-label', 'Download all my responses as a PDF');
    btn.setAttribute('title', 'Download all my responses (PDF)');
    btn.innerHTML = DOWNLOAD_ICON;
    const text = el('span', 'sowb-icon-btn-text');
    text.textContent = 'PDF';
    btn.appendChild(text);
    btn.addEventListener('click', () => this.downloadResponsesPdf());
    return btn;
  }

  _renderDashboard() {
    const wrap = el('section', 'sowb-dashboard');
    const h = el('h1', 'sowb-h1');
    h.setAttribute('data-dashboard-heading', '');
    h.textContent = this.dashboardHeading;
    wrap.appendChild(h);
    if (this.workbook.description) {
      const p = el('p', 'sowb-desc');
      p.textContent = this.workbook.description;
      wrap.appendChild(p);
    }

    const list = el('ul', 'sowb-section-list');
    list.setAttribute('role', 'list');
    this.workbook.sections.forEach((section) => {
      const status = this.state.sectionStatus[section.id] || NOT_STARTED;
      const unlocked = this.session.isUnlocked(section.id);
      const answersLocked = this.session.isLocked(section.id);
      const li = el('li', 'sowb-section-card status-' + status + (unlocked ? '' : ' locked'));

      const meta = el('div', 'sowb-section-meta');
      const name = el('div', 'sowb-section-name');
      // Show the author's section name verbatim. No "Section N:" prefix, so
      // titles like "Month 1" read naturally.
      name.textContent = section.title;
      const sub = el('div', 'sowb-section-sub');
      sub.textContent = (section.required ? 'Required' : 'Optional') +
        ` \u00b7 ${section.questions.length} item${section.questions.length === 1 ? '' : 's'}`;
      meta.appendChild(name);
      meta.appendChild(sub);
      if (status === PARTIALLY_COMPLETE) {
        const note = el('div', 'sowb-section-note');
        note.textContent = 'Every item has a response, but some requirements are not yet met.';
        meta.appendChild(note);
      }
      if (answersLocked) {
        const note = el('div', 'sowb-section-lock');
        note.setAttribute('data-section-locked', section.id);
        note.textContent = 'Answers locked · you can still review this section.';
        meta.appendChild(note);
      }

      const right = el('div', 'sowb-section-right');
      const pill = el('span', 'sowb-pill pill-' + status);
      pill.textContent = STATUS_LABEL[status];
      pill.setAttribute('data-section-status', section.id);
      right.appendChild(pill);

      const btn = el('button', 'sowb-btn');
      btn.type = 'button';
      btn.textContent = unlocked
        ? (status === COMPLETED ? 'Review' : status === NOT_STARTED ? 'Start' : 'Continue')
        : 'Locked';
      btn.disabled = !unlocked;
      btn.setAttribute('data-open-section', section.id);
      // The accessible name mirrors the visible label: author's title only.
      btn.setAttribute('aria-label', `${unlocked ? 'Open' : 'Locked'} ${section.title}`);
      btn.addEventListener('click', () => this.openSection(section.id));
      right.appendChild(btn);

      li.appendChild(meta);
      li.appendChild(right);
      list.appendChild(li);
    });
    wrap.appendChild(list);

    // Fallback host for a blocked download, next to the header button.
    if (this.pdfEnabled) {
      const fallback = el('div', 'sowb-pdf-fallback');
      fallback.setAttribute('data-pdf-fallback', '');
      wrap.appendChild(fallback);
    }

    const footer = el('div', 'sowb-dash-footer');
    footer.setAttribute('data-dash-footer', '');
    footer.textContent = this.session.isComplete()
      ? 'All required sections are complete. Your progress has been reported to the LMS.'
      : 'Complete every required section to finish this workbook. Your work saves automatically.';
    wrap.appendChild(footer);
    return wrap;
  }

  _renderSection() {
    const section = this.session.currentSection();
    const wrap = el('section', 'sowb-section-view');

    const crumbs = el('button', 'sowb-back');
    crumbs.type = 'button';
    crumbs.textContent = '\u2190 Back to sections';
    crumbs.setAttribute('data-back', '');
    crumbs.addEventListener('click', () => this.goToDashboard());
    wrap.appendChild(crumbs);

    const h = el('h1', 'sowb-h1');
    h.textContent = section.title;
    wrap.appendChild(h);

    const total = section.questions.length;
    const page = Math.min(this.state.currentPage, total - 1);
    this.state.currentPage = page;
    const question = section.questions[page];

    const counter = el('div', 'sowb-counter');
    counter.textContent = `Question ${page + 1} of ${total}`;
    wrap.appendChild(counter);

    const locked = this.session.isLocked(section.id);
    if (locked) {
      const banner = el('div', 'sowb-locked-banner');
      banner.setAttribute('data-locked-banner', '');
      banner.setAttribute('role', 'status');
      banner.textContent = 'You finished this section, so your answers are now final. You can still read back everything you recorded.';
      wrap.appendChild(banner);
    }

    wrap.appendChild(this._renderQuestion(question, locked));

    const nav = el('div', 'sowb-nav');
    const prev = el('button', 'sowb-btn ghost');
    prev.type = 'button';
    prev.textContent = page === 0 ? 'Dashboard' : 'Previous';
    prev.setAttribute('data-prev', '');
    prev.addEventListener('click', () => this.prevPage());
    const next = el('button', 'sowb-btn');
    next.type = 'button';
    next.textContent = page === total - 1 ? 'Finish section' : 'Next';
    next.setAttribute('data-next', '');
    next.addEventListener('click', () => this.nextPage());
    nav.appendChild(prev);
    nav.appendChild(next);
    wrap.appendChild(nav);
    return wrap;
  }

  _renderQuestion(q, locked) {
    const card = el('div', 'sowb-question' + (locked ? ' locked' : ''));
    const prompt = el('label', 'sowb-prompt');
    prompt.id = 'lbl-' + q.id;
    prompt.textContent = q.prompt;
    if (q.required) {
      const req = el('span', 'sowb-req');
      req.textContent = ' *';
      req.setAttribute('aria-hidden', 'true');
      prompt.appendChild(req);
    }
    card.appendChild(prompt);

    if (q.helpText) {
      const help = el('p', 'sowb-help');
      help.textContent = q.helpText;
      card.appendChild(help);
    }

    card.appendChild(this._renderInput(q, this.state.responses[q.id], locked));

    const info = this._answerStatus(q);
    const status = el('div', 'sowb-answer-status ' + info.cls);
    status.setAttribute('data-answer-status', '');
    status.setAttribute('role', 'status');
    status.textContent = info.text;
    card.appendChild(status);
    return card;
  }

  _renderInput(q, value, locked) {
    const box = el('div', 'sowb-input');
    const lb = 'lbl-' + q.id;
    switch (q.type) {
      case 'short_text': {
        const i = el('input', 'sowb-text');
        i.type = 'text'; i.value = value || '';
        i.setAttribute('aria-labelledby', lb);
        i.setAttribute('data-q', q.id);
        i.addEventListener('input', () => this.setResponse(q.id, i.value));
        box.appendChild(i);
        break;
      }
      case 'long_text': {
        const t = el('textarea', 'sowb-textarea');
        t.rows = 5; t.value = value || '';
        t.setAttribute('aria-labelledby', lb);
        t.setAttribute('data-q', q.id);
        t.addEventListener('input', () => this.setResponse(q.id, t.value));
        box.appendChild(t);
        break;
      }
      case 'numeric': {
        const i = el('input', 'sowb-text sowb-numeric');
        i.type = 'number';
        i.value = value === undefined || value === null ? '' : String(value);
        if (isNum(q.min)) i.setAttribute('min', String(q.min));
        if (isNum(q.max)) i.setAttribute('max', String(q.max));
        i.setAttribute('step', q.integerOnly ? '1' : 'any');
        i.setAttribute('inputmode', q.integerOnly ? 'numeric' : 'decimal');
        i.setAttribute('aria-labelledby', lb);
        i.setAttribute('data-q', q.id);
        i.addEventListener('input', () => this.setResponse(q.id, i.value));
        box.appendChild(i);
        const rule = numericRuleText(q);
        if (rule) { const hint = el('div', 'sowb-rule'); hint.textContent = rule; box.appendChild(hint); }
        break;
      }
      case 'url': {
        const i = el('input', 'sowb-text');
        i.type = 'url'; i.value = value || '';
        i.setAttribute('placeholder', 'https://');
        i.setAttribute('aria-labelledby', lb);
        i.setAttribute('data-q', q.id);
        i.addEventListener('input', () => this.setResponse(q.id, i.value));
        box.appendChild(i);
        // Clickable preview so a reviewer can follow the link.
        const link = el('a', 'sowb-url-preview');
        link.setAttribute('data-url-preview', '');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        const v = String(value || '').trim();
        if (isValidHttpUrl(v)) { link.setAttribute('href', v); link.textContent = 'Open link'; }
        else link.style.display = 'none';
        box.appendChild(link);
        break;
      }
      // Delegates to rating.js so labeled scales render with the right layout.
      case 'rating':
        box.appendChild(renderRating(q, value, (v) => this.setResponse(q.id, v), lb));
        break;
      case 'yes_no':
        box.appendChild(this._radioGroup(q, ['yes', 'no'].map((v) => ({ id: v, label: cap(v) })), value, lb));
        break;
      case 'single_select':
        box.appendChild(this._radioGroup(q, q.options || [], value, lb));
        break;
      case 'multiple_select':
      case 'checklist':
        box.appendChild(this._checkGroup(q, q.options || [], Array.isArray(value) ? value : [], lb));
        break;
      case 'datetime': {
        const i = el('input', 'sowb-text');
        i.type = 'date'; i.value = value || '';
        i.setAttribute('aria-labelledby', lb);
        i.setAttribute('data-q', q.id);
        i.addEventListener('input', () => this.setResponse(q.id, i.value));
        box.appendChild(i);
        break;
      }
      case 'acknowledgement': {
        const w = el('label', 'sowb-check');
        const cb = el('input');
        cb.type = 'checkbox'; cb.checked = value === true;
        cb.setAttribute('data-q', q.id);
        cb.addEventListener('change', () => this.setResponse(q.id, cb.checked));
        const s = el('span');
        s.textContent = 'I confirm I completed this activity.';
        w.appendChild(cb); w.appendChild(s); box.appendChild(w);
        break;
      }
      case 'evidence_ref':
        box.appendChild(this._evidenceInput(q, value || {}, lb));
        break;
      default: {
        const p = el('p', 'sowb-help');
        p.textContent = `Unsupported question type: ${q.type}`;
        box.appendChild(p);
      }
    }
    if (locked) disableControls(box);
    return box;
  }

  _radioGroup(q, options, value, lb) {
    const g = el('div', 'sowb-choices');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-labelledby', lb);
    options.forEach((o) => {
      const l = el('label', 'sowb-choice');
      const i = el('input');
      i.type = 'radio'; i.name = q.id; i.value = o.id; i.checked = value === o.id;
      i.setAttribute('data-q', q.id);
      i.addEventListener('change', () => this.setResponse(q.id, o.id));
      const s = el('span'); s.textContent = o.label;
      l.appendChild(i); l.appendChild(s); g.appendChild(l);
    });
    return g;
  }

  /**
   * Checklist / multiple select. Options flagged `expected` are NOT visually
   * distinguished: the learner must not see which are required.
   */
  _checkGroup(q, options, values, lb) {
    const g = el('div', 'sowb-choices');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-labelledby', lb);
    options.forEach((o) => {
      const l = el('label', 'sowb-choice');
      const i = el('input');
      i.type = 'checkbox'; i.value = o.id; i.checked = values.includes(o.id);
      i.setAttribute('data-q', q.id);
      i.addEventListener('change', () => {
        const set = new Set(this.state.responses[q.id] || []);
        if (i.checked) set.add(o.id); else set.delete(o.id);
        this.setResponse(q.id, Array.from(set));
      });
      const s = el('span'); s.textContent = o.label;
      l.appendChild(i); l.appendChild(s); g.appendChild(l);
    });
    return g;
  }

  _evidenceInput(q, value, lb) {
    const box = el('div', 'sowb-evidence');
    const note = el('p', 'sowb-help');
    note.textContent = 'Select your proof-of-work file. Only the file name and type are recorded here; upload the actual file where your facilitator instructs.';
    box.appendChild(note);
    const i = el('input');
    i.type = 'file';
    i.setAttribute('aria-labelledby', lb);
    i.addEventListener('change', () => {
      const f = i.files && i.files[0];
      const meta = f
        ? { fileSelected: true, fileName: f.name, fileType: f.type || '', selectedDate: new Date().toISOString().slice(0, 10) }
        : { fileSelected: false };
      this.setResponse(q.id, meta);
      this.render();
    });
    box.appendChild(i);
    if (value && value.fileSelected) {
      const chip = el('div', 'sowb-evidence-chip');
      chip.textContent = `Recorded: ${value.fileName} (${value.fileType || 'unknown'}) on ${value.selectedDate}`;
      box.appendChild(chip);
    }
    return box;
  }

  // ---- debug -------------------------------------------------------------

  _renderDebug() {
    const panel = el('aside', 'sowb-debug');
    const h = el('div', 'sowb-debug-title');
    h.textContent = 'SCORM debug panel' + (this.adapter.usingFallback ? ' (no LMS - fallback)' : ' (LMS connected)');
    const body = el('pre', 'sowb-debug-body');
    body.setAttribute('data-debug-body', '');
    body.textContent = this._debugText();

    const btns = el('div', 'sowb-debug-btns');
    const ex = el('button', 'sowb-btn ghost small');
    ex.type = 'button';
    ex.textContent = 'Exit + suspend';
    ex.setAttribute('data-exit', '');
    ex.addEventListener('click', () => {
      this.session.suspendAndExit();
      body.textContent = 'Session terminated + suspended. Reload to resume.\n\n' + this._debugText();
    });
    btns.appendChild(ex);
    panel.appendChild(h);
    panel.appendChild(btns);
    panel.appendChild(body);
    return panel;
  }

  _debugText() {
    return [
      'learner_name:      ' + (this.learnerName || '(not supplied)'),
      'completion_status: ' + this.adapter.getValue('cmi.completion_status'),
      'progress_measure:  ' + this.adapter.getValue('cmi.progress_measure'),
      'location:          ' + this.adapter.getValue('cmi.location'),
      'entry:             ' + this.adapter.getValue('cmi.entry'),
      'suspend bytes:     ' + this.session.suspendBytes(),
      '',
      'recent API calls:',
      this.adapter.log.slice(-12).join('\n'),
    ].join('\n');
  }
}

// ---- helpers -------------------------------------------------------------

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * Make every control in a rendered answer read-only. Done by walking the built
 * subtree rather than at each of the dozen input branches, so a new question
 * type cannot be added that silently stays editable once locked.
 */
function disableControls(box) {
  for (const sel of ['input', 'textarea', 'select']) {
    for (const node of box.querySelectorAll(sel)) node.disabled = true;
  }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function isNum(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }

/** Learner-visible statement of a numeric question's rule. */
export function numericRuleText(q) {
  const hasMin = isNum(q.min), hasMax = isNum(q.max);
  const whole = q.integerOnly ? ' Whole numbers only.' : '';
  if (hasMin && hasMax) return `Enter a value between ${q.min} and ${q.max}.${whole}`;
  if (hasMin) return `Enter at least ${q.min}.${whole}`;
  if (hasMax) return `Enter no more than ${q.max}.${whole}`;
  return whole.trim();
}
