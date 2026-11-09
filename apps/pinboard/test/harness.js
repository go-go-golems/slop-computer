'use strict';
// Loads Pinboard's scripts into a node vm context with a minimal DOM stub, for
// tests that need the page (store, dsl, apps …) or the app frame (steps,
// frame, dsl) without a browser. Nothing here is a real DOM: elements record
// children, attributes and listeners, enough for the scripts to load and for
// their logic to run.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.childNodes = []; this.className = '';
    this.style = { setProperty() {} }; this.dataset = {}; this.listeners = {}; this.attrs = {}; this.parentNode = null;
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach(x => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = self.className.split(' ').filter(x => x && !c.includes(x)).join(' '); },
      toggle: () => {}, contains: (c) => self.className.split(' ').includes(c),
    };
  }
  append(...kids) { kids.forEach(k => { if (k == null) return; const n = typeof k === 'object' ? k : new Text(k); n.parentNode = this; this.childNodes.push(n); }); }
  replaceChildren(...k) { this.childNodes = []; this.append(...k); }
  replaceWith() {} remove() {} before() {}
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '' && v != null) this.append(new Text(v)); }
  set innerHTML(v) { this.childNodes = []; }
  querySelector() { return null; } querySelectorAll() { return []; } contains() { return false; }
  focus() {} blur() {} closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}

// load(files): a fresh context with the given scripts (paths relative to
// apps/pinboard) run in order. The context is its own window (window.x is a
// global), so a test can see whether a script, or code it evaluated, wrote one.
function load(files, opts = {}) {
  const listeners = {};
  const document = {
    createElement: (t) => new El(t), createTextNode: (t) => new Text(t), activeElement: null,
    documentElement: Object.assign(new El('html'), { dataset: {} }), body: new El('body'),
    getElementById: () => new El('div'), querySelector: () => null, readyState: 'complete', addEventListener() {},
  };
  const store = {};
  const sandbox = {
    console, Blob, crypto: globalThis.crypto, setTimeout, clearTimeout, URL, performance, structuredClone, MessageChannel,
    requestAnimationFrame: (fn) => setTimeout(fn, 0), MutationObserver: class { observe() {} }, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    CSS: { escape: (s) => s }, document, fetch: () => Promise.reject(new Error('no network in tests')),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  if (opts.setup) opts.setup(sandbox);
  vm.createContext(sandbox);
  const dir = path.join(__dirname, '..');
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
  return { sandbox, listeners };
}

// The scripts of the page (index.html's order, without main.js's boot) and of
// an app frame (frames.js's frameDoc order).
const PAGE = ['core.js', 'js/store.js', 'js/dsl.js', 'js/render.js', 'js/board.js', 'js/presence.js', 'js/apps.js', 'js/steps.js', 'js/frames.js', 'js/agent.js'];
const FRAME = ['js/steps.js', 'js/frame.js', 'js/dsl.js', 'js/render.js'];

module.exports = { load, PAGE, FRAME };
