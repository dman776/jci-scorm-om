// @ts-check
/**
 * Minimal fake DOM sufficient to render and interact with the runtime player
 * in Node (no jsdom dependency available). Implements just the subset of the
 * DOM the player uses.
 */

class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set((this.el._class || '').split(/\s+/).filter(Boolean)); }
  add(c) { const s = this._set(); s.add(c); this.el._class = [...s].join(' '); }
  remove(c) { const s = this._set(); s.delete(c); this.el._class = [...s].join(' '); }
  contains(c) { return this._set().has(c); }
}

class FakeNode {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this._class = '';
    this._text = '';
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.type = '';
    this.files = null;
    this.disabled = false;
    this.id = '';
    this.rows = 0;
    this.name = '';
    this.style = {};
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  get classList() { return new FakeClassList(this); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') this._class = String(v);
  }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  hasAttribute(k) { return this.attributes[k] !== undefined; }
  appendChild(child) {
    if (typeof child === 'string') child = new FakeText(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { if (v === '' || v == null) this.children = []; else this._html = v; }
  get innerHTML() { return this._html || ''; }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  /** Test helper: fire a listener registered on this node. */
  dispatch(type, ev = {}) {
    for (const fn of this._listeners[type] || []) fn({ target: this, ...ev });
  }
  click() { this.dispatch('click', { stopPropagation() {}, preventDefault() {} }); }

  querySelector(sel) { return this._find(sel, false)[0] || null; }
  querySelectorAll(sel) { return this._find(sel, true); }
  _find(sel, all) {
    const match = compileSelector(sel);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c instanceof FakeNode) {
          if (match(c)) { out.push(c); if (!all) return true; }
          if (walk(c)) return true;
        }
      }
      return false;
    };
    walk(this);
    return out;
  }
}

class FakeText {
  constructor(t) { this._text = String(t); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}

function compileSelector(sel) {
  sel = sel.trim();
  let m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
  if (m) return (el) => el.getAttribute(m[1]) === m[2];
  m = /^\[([\w-]+)\]$/.exec(sel);
  if (m) return (el) => el.hasAttribute(m[1]);
  m = /^\.([\w-]+)$/.exec(sel);
  if (m) return (el) => el.classList.contains(m[1]);
  m = /^#([\w-]+)$/.exec(sel);
  if (m) return (el) => el.id === m[1];
  m = /^(\w+)\[([\w-]+)="([^"]*)"\]$/.exec(sel);
  if (m) return (el) => el.tagName === m[1].toUpperCase() && el.getAttribute(m[2]) === m[3];
  m = /^(\w+)$/.exec(sel);
  if (m) return (el) => el.tagName === m[1].toUpperCase();
  return () => false;
}

export function installFakeDom() {
  const doc = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (t) => new FakeText(t),
    getElementById: () => null,
    body: new FakeNode('body'),
  };
  const win = { addEventListener() {}, URLSearchParams };
  globalThis.document = doc;
  globalThis.window = win;
  return { doc, win };
}
