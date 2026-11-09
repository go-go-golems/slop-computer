'use strict';
// Loads Pinboard's page scripts (apps/pinboard, in index.html order, without
// main.js's boot) into a node vm context with a minimal DOM stub.
// Usage: const { load } = require('./harness.js'); const ctx = load(appDir);
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.childNodes = []; this.className = '';
    this.style = { setProperty() {} }; this.dataset = {}; this.listeners = {}; this.attrs = {}; this._html = null; this.parentNode = null;
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach(x => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = self.className.split(' ').filter(x => x && !c.includes(x)).join(' '); },
      toggle: (c, on) => { const has = self.className.split(' ').includes(c); if (on === undefined ? !has : on) self.classList.add(c); else self.classList.remove(c); },
      contains: (c) => self.className.split(' ').includes(c),
    };
  }
  append(...kids) { kids.forEach(k => { if (k == null) return; const n = typeof k === 'object' ? k : new Text(k); n.parentNode = this; this.childNodes.push(n); }); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); p.childNodes[i] = n; n.parentNode = p; }
  replaceChildren(...k) { this.childNodes = []; this.append(...k); }
  remove() { const p = this.parentNode; if (p) p.childNodes = p.childNodes.filter(x => x !== this); }
  before(n) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); p.childNodes.splice(i, 0, n); n.parentNode = p; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this._html != null ? this._html.replace(/<[^>]*>/g, '') : this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this._html = null; this.childNodes = []; if (v !== '' && v != null) this.append(new Text(v)); }
  get innerHTML() { return this._html != null ? this._html : ''; }
  set innerHTML(v) { this.childNodes = []; this._html = v ? String(v) : null; }
  querySelector() { return null; } querySelectorAll() { return []; } contains() { return false; }
  focus() {} blur() {} getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  closest() { return null; }
}
function html(n, depth = 0) {
  if (!n) return '';
  if (n.nodeType === 3) return n.textContent;
  const t = n.tagName.toLowerCase();
  const a = (n.className ? ' class="' + n.className + '"' : '') + Object.keys(n.dataset).map(k => ' data-' + k + '="' + n.dataset[k] + '"').join('')
    + (n.value !== undefined && n.value !== '' ? ' value="' + n.value + '"' : '')
    + (n.style && n.style.gridTemplateColumns ? ' style="grid-template-columns:' + n.style.gridTemplateColumns + '"' : '')
    + (n.style && n.style.gap ? ' style-gap="' + n.style.gap + '"' : '') + (n.style && n.style.width ? ' style-width="' + n.style.width + '"' : '');
  const inner = n._html != null ? n._html : n.childNodes.map(c => html(c, depth + 1)).join('');
  return '<' + t + a + '>' + inner + '</' + t + '>';
}
function walk(n, f) { if (!n) return; f(n); (n.childNodes || []).forEach(c => walk(c, f)); }
function find(root, pred) { let hit = null; walk(root, n => { if (!hit && n.nodeType === 1 && pred(n)) hit = n; }); return hit; }
function fire(n, ev, extra = {}) { (n.listeners[ev] || []).forEach(fn => fn(Object.assign({ type: ev, stopPropagation() {}, preventDefault() {} }, extra))); }

function load(appDir, opts = {}) {
  const document = {
    createElement: (t) => new El(t), createTextNode: (t) => new Text(t), activeElement: null,
    documentElement: Object.assign(new El('html'), { dataset: {} }), body: new El('body'),
    getElementById: () => null, querySelector: () => null, readyState: 'complete', addEventListener() {},
    execCommand() {},
  };
  const store = {};
  const sandbox = {
    console: opts.console || console, Blob, crypto: globalThis.crypto, setTimeout, clearTimeout, URL, performance,
    requestAnimationFrame: (fn) => setTimeout(fn, 0), MutationObserver: class { observe() {} }, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    CSS: { escape: (s) => s }, document, structuredClone, addEventListener() {}, fetch: () => Promise.reject(new Error('no network')),
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  if (opts.setup) opts.setup(sandbox);
  vm.createContext(sandbox);
  const files = opts.files || ['core.js', 'js/store.js', 'js/dsl.js', 'js/render.js', 'js/board.js', 'js/presence.js', 'js/apps.js', 'js/steps.js', 'js/frames.js', 'js/agent.js'];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(appDir, f), 'utf8'), sandbox, { filename: f });
  return { sandbox, PB: sandbox.PB, html, find, walk, fire, El };
}
// JSON in the host realm (values made in the vm have its prototypes).
const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? 'λ' : x));
module.exports = { load, html, find, walk, fire, J };
