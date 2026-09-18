// @ts-check
/**
 * Minimal fake DOM sufficient to render and interact with the runtime player in
 * Node (no jsdom available). Implements just the subset the player uses,
 * including enough of <a download> + body append/click for the PDF delivery
 * path. Node supplies Blob and URL.createObjectURL natively, so that path runs
 * for real.
 */
class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set((this.el._class || '').split(/\s+/).filter(Boolean)); }
  add(c) { const s = this._set(); s.add(c); this.el._class = [...s].join(' '); }
  remove(c) { const s = this._set(); s.delete(c); this.el._class = [...s].join(' '); }
  contains(c) { return this._set().has(c); }
}
export class FakeNode {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = []; this.parentNode = null; this.attributes = {};
    this._class = ''; this._text = ''; this._html = ''; this._listeners = {};
    this.value = ''; this.checked = false; this.type = ''; this.files = null;
    this.disabled = false; this.id = ''; this.rows = 0; this.name = '';
    this.href = ''; this.download = ''; this.rel = ''; this.style = {}; this.clickCount = 0;
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  get classList() { return new FakeClassList(this); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') this._class = String(v);
    if (k === 'href') this.href = String(v);
    if (k === 'download') this.download = String(v);
  }
  getAttribute(k) {
    if (k === 'href' && this.href && this.attributes.href === undefined) return this.href;
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }
  hasAttribute(k) { return this.attributes[k] !== undefined; }
  appendChild(c) { if (typeof c === 'string') c = new FakeText(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { if (v === '' || v == null) { this.children = []; this._html = ''; } else this._html = v; }
  get innerHTML() { return this._html || ''; }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  /** Test helper: fire a listener registered on this node. */
  dispatch(t, ev = {}) { for (const fn of this._listeners[t] || []) fn({ target: this, ...ev }); }
  click() { this.clickCount++; this.dispatch('click', { stopPropagation() {}, preventDefault() {} }); }
  querySelector(s) { return this._find(s, false)[0] || null; }
  querySelectorAll(s) { return this._find(s, true); }
  _find(sel, all) {
    const match = compile(sel); const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c instanceof FakeNode) {
          if (match(c)) { out.push(c); if (!all) return true; }
          if (walk(c)) return true;
        }
      }
      return false;
    };
    walk(this); return out;
  }
}
class FakeText {
  constructor(t) { this._text = String(t); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}
function compile(sel) {
  sel = sel.trim(); let m;
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return (el) => el.getAttribute(m[1]) === m[2];
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) return (el) => el.hasAttribute(m[1]);
  if ((m = /^\.([\w-]+)$/.exec(sel))) return (el) => el.classList.contains(m[1]);
  if ((m = /^#([\w-]+)$/.exec(sel))) return (el) => el.id === m[1];
  if ((m = /^(\w+)\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return (el) => el.tagName === m[1].toUpperCase() && el.getAttribute(m[2]) === m[3];
  if ((m = /^(\w+)$/.exec(sel))) return (el) => el.tagName === m[1].toUpperCase();
  return () => false;
}
export function installFakeDom() {
  const body = new FakeNode('body');
  globalThis.document = {
    createElement: (t) => new FakeNode(t),
    createTextNode: (t) => new FakeText(t),
    getElementById: () => null,
    body,
  };
  globalThis.window = { addEventListener() {}, URLSearchParams };
  return { doc: globalThis.document, win: globalThis.window, body };
}
