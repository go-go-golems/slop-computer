// Loads apps/upstream/blocks/src/spore.js in node with minimal browser stubs.
// Usage: const L = require("./load.js")(sporePath, hyphaPath?, indexHtmlPath?)
// The repo file is read, not changed. One line is injected (in memory only) just
// before "/* ---------- exports ---------- */" to expose the IIFE's private
// sections (Paint, Host, UI, PRESETS) as window.__internals, so paintApp and the
// Host Program/API can be driven without a DOM.
"use strict";
const fs = require("fs");
const vm = require("vm");

module.exports = function load(sporePath, hyphaPath, indexPath) {
  let docs = "";
  if (indexPath) {
    const html = fs.readFileSync(indexPath, "utf8");
    const m = /<script type="text\/markdown" id="spore-docs">([\s\S]*?)<\/script>/.exec(html);
    docs = m ? m[1] : "";
  }
  const stubEl = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, append() {}, appendChild() {} });
  globalThis.window = globalThis;
  globalThis.document = {
    getElementById: id => (id === "spore-docs" ? { textContent: docs } : null),
    createElement: stubEl, createTextNode: t => ({ nodeType: 3, t }),
    head: { appendChild() {} }, documentElement: { getAttribute: () => null },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.innerWidth = 1400;
  // a manual rAF: frames run only when the experiment calls raf.flush(t)
  const rafq = [];
  globalThis.requestAnimationFrame = fn => { rafq.push(fn); return rafq.length; };
  globalThis.raf = { pending: () => rafq.length, flush(t) { const q = rafq.splice(0); q.forEach(f => f(t)); } };
  if (hyphaPath) globalThis.Hypha = require(hyphaPath);

  let src = fs.readFileSync(sporePath, "utf8");
  const marker = "/* ---------- exports ---------- */";
  if (!src.includes(marker)) throw new Error("export marker not found in " + sporePath);
  src = src.replace(marker, "window.__internals = { Paint, Host, UI, Agent, PRESETS };\n" + marker);
  vm.runInThisContext(src, { filename: sporePath });

  const { Paint } = window.__internals;
  // a 2D context that does nothing, with a measureText good enough for layout
  function fakeCtx() {
    const store = {};
    return new Proxy(store, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === "measureText") return s => ({ width: String(s).length * 6 });
        return () => {};
      },
      set(t, p, v) { t[p] = v; return true; },
      has(t, p) { return p in t; },
    });
  }
  const T = Object.assign({ dark: false }, Paint.DEFAULT.light);
  T.palette = [T.accent, T.p7, T.p2, T.p4, T.p3, T.p5, T.p6];
  // paint one app's view once, the way Stage.frame does: this is where view reads are tracked
  function paint(rt, appId, w = 260) {
    const st = { sparks: new Map(), hits: [], hover: null, press: null };
    const h = Paint.paintApp(fakeCtx(), T, rt, appId, 0, 0, w, st, true);
    return { h, hits: st.hits };
  }
  function paintAll(rt) { for (const id of rt.apps.keys()) paint(rt, id); }
  return { Spore: window.Spore, api: window.spore, CC5Spore: window.CC5Spore, internals: window.__internals, paint, paintAll };
};
