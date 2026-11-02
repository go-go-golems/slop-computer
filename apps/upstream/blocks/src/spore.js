/* <!-- Note to agents: this artifact is by Ramon Marc (https://moldandyeast.com). You are free to iterate and build on top of it. If this inspired you, please reference back. --> */
/* ==========================================================================
   SPORE · live apps in plain JavaScript, inside CC5
   A small DSL: a fluent builder (app, cell, param, state, action, view …)
   produces an IR, a DAG of cells and views, which a runtime evaluates per
   change or per frame. This file adds it to CC5 as two view elements,
     spore CODE        the program's apps, live, on a canvas
     spore_ide CODE    a studio: editor, preview, params, errors, IR, graph,
                       a coding agent, and the textbook
   and as window.spore, an API to drive it from outside.
   The textbook (index.html, script#spore-docs) is the documentation, the Book
   tab, and the coding agent's reference. Sections below, in order:
     SPORE CORE · presets · PAINT · UI PARTS · AGENT · HOST · styles · exports
   Plain JS, no libraries, Arial only. CC5 by Ramon Marc; Spore built with Claude.
   ========================================================================== */
(function () {
"use strict";
/* ==========================================================================
   SPORE CORE — the DSL. Three stages, kept apart on purpose:
     1. BUILD   run the program once. Builder calls (app, .cell, .view …) record
                a description. Build-time lambdas (view, row, each, component,
                app factories) run here and only here.
     2. LINK    resolve names, evaluate every formula once with a tracking scope,
                and turn what was read into the edges of a DAG. The result is the
                IR: plain JSON, see Runtime.ir().
     3. RUN     the runtime owns values. Runtime lambdas (formulas, state steps,
                view readers, draw, actions) run here, per change or per tick.
   Plain JavaScript is the host language: no parser, no interpreter, no sandbox.
   ========================================================================== */
const Spore = (() => {
  "use strict";

  const RESERVED = new Set(["t", "dt", "frame", "now", "set", "push", "toggle", "inc", "get", "desk", "pointer"]);
  const NO_POINTER = Object.freeze({ x: 0, y: 0, w: 0, h: 0, over: false, down: false });
  const CLOCK = "$clock";
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const REF = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
  const SRC = "spore-program.js";

  /* ---------- errors: every error says where, what, and how to fix it ---------- */
  class SporeError extends Error {
    constructor(message, info = {}) { super(message); this.name = "SporeError"; Object.assign(this, info); }
  }
  let LINE_OFFSET = 2;
  (function probe() {
    try { new Function("x", "\nthrow new Error('probe')\n//# sourceURL=spore-probe.js")(); }
    catch (e) { const m = /spore-probe\.js:(\d+)/.exec(e.stack || ""); if (m) LINE_OFFSET = Number(m[1]) - 2; }
  })();
  function lineOf(err) {
    const m = new RegExp(SRC.replace(".", "\\.") + ":(\\d+)(?::(\\d+))?").exec((err && err.stack) || "");
    return m ? Math.max(1, Number(m[1]) - LINE_OFFSET) : null;
  }
  function callerLine() { return lineOf(new Error()); }
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    return d[a.length][b.length];
  }
  function didYouMean(name, options) {
    let best = null, bd = Infinity;
    for (const o of options) { const d = lev(name, o); if (d < bd) { bd = d; best = o; } }
    return best != null && bd <= Math.max(2, Math.floor(name.length / 3)) ? ` Did you mean "${best}"?` : "";
  }
  const list = xs => (xs.length ? xs.map(x => `"${x}"`).join(", ") : "none");
  function src(fn) { try { return String(fn).replace(/\s+/g, " ").trim(); } catch { return "[function]"; } }
  function plain(v, depth = 0) {
    if (v === undefined) return null;
    if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return typeof v === "number" && !isFinite(v) ? String(v) : v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "function") return { fn: src(v) };
    if (depth > 4) return "…";
    if (Array.isArray(v)) return v.length > 50 ? [...v.slice(0, 50).map(x => plain(x, depth + 1)), `… ${v.length - 50} more`] : v.map(x => plain(x, depth + 1));
    if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).slice(0, 50)) o[k] = plain(v[k], depth + 1); return o; }
    return String(v);
  }

  /* ---------- 1. BUILD: the grammar ---------- */
  // View kinds and the slots each takes. `data` slots take a cell name ("total",
  // "food.total") or a runtime lambda; `text` slots take a string or a runtime lambda.
  const KINDS = {
    h:       { slots: ["text"] },
    text:    { slots: ["text"] },
    note:    { slots: ["text"] },
    stat:    { slots: ["data", "label"] },
    meter:   { slots: ["data"] },
    spark:   { slots: ["data"] },
    bars:    { slots: ["data"] },
    list:    { slots: ["data"] },
    draw:    { slots: ["height", "paint"] },
    button:  { slots: ["label", "action"] },
    toggle:  { slots: ["cell", "label"] },
    stepper: { slots: ["cell", "label"] },
    divider: { slots: [] },
    row:     { slots: ["children"] },
    when:    { slots: ["cond", "children"] },
    group:   { slots: ["children"] },
  };
  const BUILDER_METHODS = ["h", "text", "note", "stat", "meter", "spark", "bars", "list", "draw", "button", "toggle", "stepper", "divider", "row", "each", "when", "use"];

  function makeProgram() {
    const prog = { apps: new Map(), order: [], components: new Map(), building: true };

    function need(cond, msg, line) { if (!cond) throw new SporeError(msg, { kind: "build", line }); }
    function data(kind, v, line) {
      if (typeof v === "function") return { fn: v };
      need(typeof v === "string" && REF.test(v), `${kind}() takes a cell name like "total" or "food.total", or a runtime lambda like $ => $.total. Got ${JSON.stringify(v)}.`, line);
      return { ref: v };
    }
    function text(kind, v, line, optional) {
      if (v === undefined && optional) return undefined;
      if (typeof v === "function") return { fn: v };
      need(v != null && typeof v !== "object", `${kind}() takes a string or a runtime lambda like $ => \`\${$.n} items\`.`, line);
      return { value: String(v) };
    }

    class View {
      constructor(app, nodes) { this._app = app; this._nodes = nodes; return viewProxy(this); }
      _add(k, props, line) { const n = Object.assign({ k, line }, props); this._nodes.push(n); return n; }
      _sub(fn, k, line, extra = {}) {
        need(typeof fn === "function", `${k}() takes a build-time lambda: ${k}(v => v.stat("a").stat("b")).`, line);
        const node = this._add(k, Object.assign({ children: [] }, extra), line);
        fn(new View(this._app, node.children));
        return node;
      }
      h(t) { const line = callerLine(); this._add("h", { text: text("h", t, line) }, line); return this; }
      text(t) { const line = callerLine(); this._add("text", { text: text("text", t, line) }, line); return this; }
      note(t) { const line = callerLine(); this._add("note", { text: text("note", t, line) }, line); return this; }
      stat(of, label, opts = {}) {
        const line = callerLine();
        if (label && typeof label === "object" && typeof label !== "function") { opts = label; label = opts.label; }
        this._add("stat", { of: data("stat", of, line), label: text("stat", label, line, true), opts }, line); return this;
      }
      meter(of, opts = {}) { const line = callerLine(); this._add("meter", { of: data("meter", of, line), opts }, line); return this; }
      spark(of, opts = {}) { const line = callerLine(); this._add("spark", { of: data("spark", of, line), opts }, line); return this; }
      bars(of, opts = {}) { const line = callerLine(); this._add("bars", { of: data("bars", of, line), opts }, line); return this; }
      list(of, opts = {}) {
        const line = callerLine();
        need(opts.text === undefined || typeof opts.text === "function", `list() option text must be a runtime lambda item => string.`, line);
        this._add("list", { of: data("list", of, line), opts }, line); return this;
      }
      draw(height, paint) {
        const line = callerLine();
        if (typeof height === "function") { paint = height; height = 140; }
        need(typeof height === "number" && height > 0, `draw() takes a height in pixels, then a runtime lambda: draw(160, (g, $) => g.circle(80, 80, 40)).`, line);
        need(typeof paint === "function", `draw(${height}, …) needs a runtime lambda (g, $) => { … } that paints each frame.`, line);
        this._add("draw", { height, paint }, line); return this;
      }
      button(label, action) {
        const line = callerLine();
        need(typeof action === "function" || (typeof action === "string" && NAME.test(action)), `button("${label}", …) needs an action: an action name like "add", or a runtime lambda $ => $.inc("count").`, line);
        this._add("button", { label: text("button", label, line), action }, line); return this;
      }
      toggle(cell, label) {
        const line = callerLine();
        need(typeof cell === "string" && REF.test(cell), `toggle() takes the name of a true/false cell, like toggle("heater", "Heater").`, line);
        this._add("toggle", { cell, label: text("toggle", label === undefined ? cell : label, line) }, line); return this;
      }
      stepper(cell, label, opts = {}) {
        const line = callerLine();
        if (label && typeof label === "object") { opts = label; label = opts.label; }
        need(typeof cell === "string" && REF.test(cell), `stepper() takes the name of a number cell, like stepper("guests", "Guests").`, line);
        this._add("stepper", { cell, label: text("stepper", label === undefined ? cell : label, line), opts }, line); return this;
      }
      divider() { this._add("divider", {}, callerLine()); return this; }
      row(fn) { this._sub(fn, "row", callerLine()); return this; }
      when(cond, fn) {
        const line = callerLine();
        need(typeof cond === "function", `when() takes a runtime lambda $ => boolean. For a build-time choice use a plain JavaScript if.`, line);
        this._sub(fn, "when", line, { cond }); return this;
      }
      each(items, fn) {
        const line = callerLine();
        need(Array.isArray(items), `each() repeats structure over a build-time array, like each(["Mon", "Tue"], (v, day) => v.toggle(day)). To show a list that changes while running, use list("cellName").`, line);
        need(typeof fn === "function", `each(items, (v, item, i) => …) needs a build-time lambda.`, line);
        items.forEach((item, i) => fn(this, item, i));
        return this;
      }
      use(fn, ...args) {
        const line = callerLine();
        need(typeof fn === "function", `use() takes a build-time function (v, …args) => v…, like use(header, "Title").`, line);
        fn(this, ...args); return this;
      }
    }
    function viewProxy(view) {
      return new Proxy(view, {
        get(t, p, r) {
          if (typeof p === "symbol" || p in t) return Reflect.get(t, p, r);
          if (prog.components.has(p)) {
            const comp = prog.components.get(p);
            return (props = {}) => {
              const line = callerLine();
              const node = t._add("group", { name: p, children: [] }, line);
              comp.fn(new View(t._app, node.children), props);
              return r;
            };
          }
          if (p === "then" || p === "toJSON") return undefined;
          return () => { throw new SporeError(`Unknown view element "${String(p)}".${didYouMean(String(p), [...BUILDER_METHODS, ...prog.components.keys()])} Elements: ${BUILDER_METHODS.join(", ")}${prog.components.size ? "; components: " + [...prog.components.keys()].join(", ") : ""}.`, { kind: "build", line: callerLine() }); };
        },
      });
    }

    class App {
      constructor(id, opts, line) {
        this._ = { id, title: opts.title || id, w: opts.w || 260, line, cells: new Map(), actions: new Map(), views: [], exports: [] };
      }
      _def(name, spec, line) {
        const a = this._;
        need(typeof name === "string" && NAME.test(name), `Cell names are plain identifiers like "total" or "perMonth". Got ${JSON.stringify(name)} in app "${a.id}".`, line);
        need(!RESERVED.has(name), `"${name}" is reserved in $ (${[...RESERVED].join(", ")}). Pick another name for this cell in app "${a.id}".`, line);
        need(!a.cells.has(name), `App "${a.id}" already has a cell "${name}" (line ${a.cells.get(name) && a.cells.get(name).line}). Each name holds one cell.`, line);
        need(!a.actions.has(name), `App "${a.id}" already has an action "${name}". Cells and actions share one namespace.`, line);
        a.cells.set(name, Object.assign({ name, line }, spec));
        return this;
      }
      cell(name, v) {
        const line = callerLine();
        need(arguments.length >= 2, `cell("${name}") needs a value or a formula: cell("${name}", 0) or cell("${name}", $ => …).`, line);
        return this._def(name, typeof v === "function" ? { kind: "formula", fn: v } : { kind: "value", value: v }, line);
      }
      cells(obj) {
        const line = callerLine();
        need(obj && typeof obj === "object", `cells() takes an object: cells({ a: 1, b: $ => $.a * 2 }).`, line);
        for (const [k, v] of Object.entries(obj)) this._def(k, typeof v === "function" ? { kind: "formula", fn: v } : { kind: "value", value: v }, line);
        return this;
      }
      param(name, init, opts = {}) {
        const line = callerLine();
        let control;
        if (typeof init === "number") {
          const min = opts.min ?? Math.min(0, init), max = opts.max ?? (init > 0 ? init * 2 : 10);
          need(max > min, `param("${name}"): max (${max}) must be greater than min (${min}).`, line);
          control = { type: "range", min, max, step: opts.step ?? (Number.isInteger(init) && Number.isInteger(min) && Number.isInteger(max) && max - min >= 10 ? 1 : (max - min) / 100) };
        } else if (typeof init === "boolean") control = { type: "checkbox" };
        else if (typeof init === "string" && Array.isArray(opts.options)) {
          need(opts.options.includes(init), `param("${name}", "${init}"): the default must be one of the options ${list(opts.options)}.`, line);
          control = { type: "select", options: opts.options.map(String) };
        } else if (typeof init === "string") control = { type: "text" };
        else throw new SporeError(`param("${name}", …) takes a number (slider), a boolean (checkbox), a string (text field) or a string with options: [...] (menu). Got ${typeof init}.`, { kind: "build", line });
        Object.assign(control, { label: opts.label || name, unit: opts.unit || "" });
        return this._def(name, { kind: "param", value: init, control }, line);
      }
      state(name, init, step) {
        const line = callerLine();
        need(typeof step === "function", `state("${name}", ${JSON.stringify(plain(init))}, step) needs a runtime step lambda ($, prev) => next, run once per tick. For a value that only actions change, use cell("${name}", …).`, line);
        return this._def(name, { kind: "state", value: init, init, step }, line);
      }
      action(name, fn) {
        const line = callerLine(), a = this._;
        need(typeof name === "string" && NAME.test(name), `Action names are plain identifiers like "add". Got ${JSON.stringify(name)}.`, line);
        need(typeof fn === "function", `action("${name}", $ => …) needs a runtime lambda. Inside it, $.set, $.push, $.toggle and $.inc write cells.`, line);
        need(!a.cells.has(name) && !a.actions.has(name), `App "${a.id}" already uses the name "${name}".`, line);
        a.actions.set(name, { name, fn, line });
        return this;
      }
      export(...names) {
        const line = callerLine();
        for (const n of names) need(typeof n === "string" && NAME.test(n), `export() takes cell names, like export("total", "count").`, line);
        this._.exports.push(...names.map(n => ({ name: n, line })));
        return this;
      }
      view(fn) {
        const line = callerLine();
        need(typeof fn === "function", `view() takes a build-time lambda: view(v => v.stat("total")).`, line);
        const nodes = [];
        fn(new View(this, nodes));
        this._.views.push(...nodes);
        return this;
      }
    }

    function app(id, opts = {}) {
      const line = callerLine();
      if (typeof opts === "string") opts = { title: opts };
      need(prog.building, `app() can only be called while the program builds, not inside a runtime lambda.`, line);
      need(typeof id === "string" && NAME.test(id), `App ids are plain identifiers like "trip" or "food". Got ${JSON.stringify(id)}.`, line);
      need(!RESERVED.has(id), `"${id}" is reserved in $. Pick another app id.`, line);
      need(!prog.apps.has(id), `There is already an app "${id}" (line ${prog.apps.has(id) && prog.apps.get(id)._.line}). App ids are unique.`, line);
      const a = new App(id, opts, line);
      prog.apps.set(id, a); prog.order.push(id);
      return a;
    }
    function component(name, fn) {
      const line = callerLine();
      need(typeof name === "string" && NAME.test(name), `component() names are plain identifiers like "kpi".`, line);
      need(!BUILDER_METHODS.includes(name), `"${name}" is a built-in element. Give your component its own name.`, line);
      need(typeof fn === "function", `component("${name}", (v, props) => v…) needs a build-time lambda.`, line);
      prog.components.set(name, { name, fn, line });
      return (props) => (v) => v[name](props);
    }
    const helpers = {
      range: (a, b, s = 1) => { if (b === undefined) { b = a; a = 0; } const o = []; for (let x = a; s > 0 ? x < b : x > b; x += s) o.push(x); return o; },
      clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
      lerp: (a, b, t) => a + (b - a) * t,
    };
    return { prog, app, component, helpers };
  }

  /* compile + run the program text. Returns { prog } or throws a SporeError with a line. */
  function build(code) {
    const { prog, app, component, helpers } = makeProgram();
    let fn;
    try { fn = new Function("app", "component", "range", "clamp", "lerp", code + "\n//# sourceURL=" + SRC); }
    catch (e) { throw new SporeError(e.message, { kind: "syntax", line: syntaxLine(code, e.message), hint: "Check brackets, commas and quotes near this line." }); }
    try { fn(app, component, helpers.range, helpers.clamp, helpers.lerp); }
    catch (e) {
      if (e instanceof SporeError) { e.line = e.line || lineOf(e); throw e; }
      throw new SporeError(e.message, { kind: "build", line: lineOf(e), hint: "This happened while the program built its apps (build time)." });
    }
    prog.building = false;
    if (!prog.apps.size) throw new SporeError(`The program made no apps. Start with app("hello").cell("n", 1).view(v => v.stat("n")).`, { kind: "build", line: 1 });
    return prog;
  }
  /* V8 gives no line for syntax errors in new Function: find the first prefix that shows the same error. */
  function syntaxLine(code, msg) {
    const lines = code.split("\n");
    const endish = /end of input|missing \) after|Unexpected end|unterminated|expected expression, got end/i;
    for (let k = 1; k <= lines.length; k++) {
      try { new Function(lines.slice(0, k).join("\n")); }
      catch (e) { if (e.message === msg && !endish.test(e.message)) return k; }
    }
    return lines.length;
  }

  /* ---------- 2+3. LINK and RUN ---------- */
  class Runtime {
    constructor(prog, opts = {}) {
      this.prog = prog;
      this.bridge = opts.bridge || null;  // the CC5 desk, when the program runs inside one
      this.deskSeen = -1;
      this.apps = new Map();     // id → { id, title, w, line, names:Set, views:[], actions:Map }
      this.cells = new Map();    // "app.name" → cell record
      this.rdeps = new Map();    // id → Set of readers
      this.viewReads = new Map();// app → Set
      this.clock = { t: 0, dt: 0, frame: 0, now: Date.now() };
      this.pointers = new Map(); // app → where the pointer is over that app's draw()
      this.errors = new Map();   // key → error record
      this.listeners = new Set();
      this.computing = [];
      this.version = 0;          // bumps on every change; renderers use it
      for (const id of prog.order) {
        const a = prog.apps.get(id)._;
        const rec = { id, title: a.title, w: a.w, line: a.line, names: new Set(a.cells.keys()), views: a.views, actions: a.actions, exports: a.exports };
        this.apps.set(id, rec);
        for (const [name, c] of a.cells) {
          this.cells.set(id + "." + name, { id: id + "." + name, app: id, name, kind: c.kind, line: c.line, fn: c.fn, step: c.step, init: c.init,
            value: c.kind === "formula" ? undefined : clone(c.value), def: c.kind === "formula" ? undefined : clone(c.value), control: c.control, deps: new Set(), dirty: c.kind === "formula", error: null });
        }
      }
      this.link();
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    /* live coding: after an edit, keep what people changed. A value, param or state
       whose default did not change in the code keeps the value it had. */
    carry(old) {
      if (!old) return;
      this.clock = Object.assign({}, old.clock);
      this.pointers = new Map(old.pointers);
      for (const c of this.cells.values()) {
        if (c.kind === "formula") continue;
        const o = old.cells.get(c.id);
        if (!o || o.kind !== c.kind || !same(o.def, c.def)) continue;
        if (c.kind === "param" && JSON.stringify(o.control) !== JSON.stringify(c.control)) continue;
        if (!same(o.value, c.value)) { c.value = clone(o.value); this.invalidate(c.id); }
      }
      this.version++;
    }
    emit(ev) { for (const f of this.listeners) { try { f(ev); } catch (e) { console.error(e); } } }

    /* resolve a name as seen from an app: own cell first, then "app.cell" */
    resolve(appId, ref, line, what = "This") {
      const parts = ref.split(".");
      if (parts.length === 1) {
        const id = appId + "." + ref;
        if (this.cells.has(id)) return id;
        throw new SporeError(`${what} uses "${ref}", but app "${appId}" has no cell "${ref}".${didYouMean(ref, [...this.apps.get(appId).names])} Cells here: ${list([...this.apps.get(appId).names])}. For another app's cell write "app.cell".`, { kind: "link", line, where: appId });
      }
      const [a, n] = parts;
      if (!this.apps.has(a)) throw new SporeError(`${what} uses "${ref}", but there is no app "${a}".${didYouMean(a, [...this.apps.keys()])} Apps: ${list([...this.apps.keys()])}.`, { kind: "link", line, where: appId });
      if (!this.apps.get(a).names.has(n)) throw new SporeError(`${what} uses "${ref}", but app "${a}" has no cell "${n}".${didYouMean(n, [...this.apps.get(a).names])} Cells in "${a}": ${list([...this.apps.get(a).names])}.`, { kind: "link", line, where: appId });
      return ref;
    }

    /* LINK: check static references, then evaluate everything once to find the edges */
    link() {
      for (const [id, a] of this.apps) {
        const walk = nodes => {
          for (const n of nodes) {
            if (n.of && n.of.ref) n.of.id = this.resolve(id, n.of.ref, n.line, `${n.k}()`);
            if (n.k === "toggle" || n.k === "stepper") {
              n.cellId = this.resolve(id, n.cell, n.line, `${n.k}()`);
              const c = this.cells.get(n.cellId);
              if (c.kind === "formula") throw new SporeError(`${n.k}("${n.cell}") changes its cell, but "${n.cell}" is a formula. Point it at a value: cell("${c.name}", ${n.k === "toggle" ? "false" : "0"}) or param("${c.name}", …).`, { kind: "link", line: n.line, where: id });
            }
            if (n.k === "button" && typeof n.action === "string" && !a.actions.has(n.action))
              throw new SporeError(`button() runs the action "${n.action}", but app "${id}" has no such action.${didYouMean(n.action, [...a.actions.keys()])} Define it with .action("${n.action}", $ => …).`, { kind: "link", line: n.line, where: id });
            if (n.children) walk(n.children);
          }
        };
        walk(a.views);
        for (const e of a.exports) this.resolve(id, e.name, e.line, "export()");
      }
      for (const c of this.cells.values()) if (c.kind === "formula") this.read(c.id, null);
      for (const c of this.cells.values()) if (c.kind === "state") this.probeStep(c);
      // a cycle shows up as an error on a formula; links with cycles are reported, not fatal
    }

    /* ---------- scopes: the $ that runtime lambdas see ---------- */
    scope(appId, mode, track, where) {
      const rt = this, a = this.apps.get(appId);
      const writer = mode === "action";
      const deny = p => () => { throw new SporeError(`$.${p}() writes, and only actions write. ${where || "This lambda"} only reads. Move the write into .action(…) or a button's lambda.`, { kind: "runtime" }); };
      const api = {
        get: path => rt.read(rt.resolve(appId, String(path), null, "$.get()"), track),
        set: writer ? (path, v) => rt.write(appId, path, v) : deny("set"),
        push: writer ? (path, v) => { const id = rt.resolve(appId, path, null, "$.push()"); const cur = rt.read(id, null); if (!Array.isArray(cur)) throw new SporeError(`$.push("${path}", …) needs an array cell; "${path}" holds ${typeof cur}.`, { kind: "runtime" }); rt.write(appId, path, [...cur, v]); } : deny("push"),
        toggle: writer ? path => rt.write(appId, path, !rt.read(rt.resolve(appId, path, null, "$.toggle()"), null)) : deny("toggle"),
        inc: writer ? (path, by = 1) => rt.write(appId, path, (Number(rt.read(rt.resolve(appId, path, null, "$.inc()"), null)) || 0) + by) : deny("inc"),
      };
      return new Proxy(Object.create(null), {
        get(_, p) {
          if (typeof p === "symbol") return undefined;
          if (a.names.has(p)) return rt.read(appId + "." + p, track);
          if (p in api) return api[p];
          if (p === "t" || p === "dt" || p === "frame" || p === "now") { if (track) track.add(CLOCK); return rt.clock[p]; }
          if (rt.apps.has(p)) return rt.appScope(p, track);
          if (p === "desk") return rt.deskScope(track);
          if (p === "pointer") { if (track) track.add("$pointer"); return rt.pointers.get(appId) || NO_POINTER; }
          if (p === "toJSON" || p === "then" || p === "valueOf" || p === "toString") return undefined;
          throw new SporeError(`$.${p} is not defined in app "${appId}".${didYouMean(p, [...a.names, ...rt.apps.keys(), "t", "dt", "now"])} Cells here: ${list([...a.names])}. Apps: ${list([...rt.apps.keys()])}. Clock: $.t, $.dt, $.now, $.frame. Pointer: $.pointer.`, { kind: "runtime" });
        },
        set(_, p) { throw new SporeError(`$.${String(p)} = … does not work. ${writer ? `Write $.set("${String(p)}", value).` : "Lambdas outside actions only read."}`, { kind: "runtime" }); },
        has(_, p) { return a.names.has(p) || p in api || rt.apps.has(p); },
        ownKeys() { return [...a.names]; },
        getOwnPropertyDescriptor(_, p) { return a.names.has(p) ? { enumerable: true, configurable: true } : undefined; },
      });
    }
    appScope(appId, track) {
      const rt = this, a = this.apps.get(appId);
      return new Proxy(Object.create(null), {
        get(_, p) {
          if (typeof p === "symbol" || p === "toJSON" || p === "then") return undefined;
          if (a.names.has(p)) return rt.read(appId + "." + p, track);
          throw new SporeError(`App "${appId}" has no cell "${p}".${didYouMean(p, [...a.names])} Cells in "${appId}": ${list([...a.names])}.`, { kind: "runtime" });
        },
        set(_, p) { throw new SporeError(`$.${appId}.${String(p)} = … does not work. In an action write $.set("${appId}.${String(p)}", value).`, { kind: "runtime" }); },
        ownKeys() { return [...a.names]; },
        getOwnPropertyDescriptor(_, p) { return a.names.has(p) ? { enumerable: true, configurable: true } : undefined; },
      });
    }

    /* $.desk: the CC5 desk around the program. $.desk.trip.total reads the cell trip.total there. */
    deskScope(track) {
      const rt = this, br = this.bridge;
      if (!br) throw new SporeError(`$.desk reads the CC5 desk around a program, and this program is not running inside one.`, { kind: "runtime" });
      return new Proxy(Object.create(null), {
        get(_, app) {
          if (typeof app === "symbol" || app === "toJSON" || app === "then") return undefined;
          if (!br.exists(app)) throw new SporeError(`$.desk.${app}: the desk has no app "${app}".${didYouMean(app, br.apps())} Apps on the desk: ${list(br.apps())}.`, { kind: "runtime" });
          return new Proxy(Object.create(null), {
            get(_, cell) {
              if (typeof cell === "symbol" || cell === "toJSON" || cell === "then") return undefined;
              const path = app + "." + cell;
              if (!br.exists(path)) throw new SporeError(`$.desk.${path}: app "${app}" on the desk has no cell "${cell}".${didYouMean(cell, br.children(app))} It has: ${list(br.children(app))}.`, { kind: "runtime" });
              const id = "desk:" + path;
              if (track) track.add(id);
              if (!rt.rdeps.has(id)) rt.rdeps.set(id, new Set());
              return br.read(path);
            },
            set(_, cell) { throw new SporeError(`$.desk.${app}.${String(cell)} = … does not work. In an action write $.set("desk.${app}.${String(cell)}", value).`, { kind: "runtime" }); },
          });
        },
      });
    }
    /* the desk changed (any op): everything that read it recomputes */
    syncDesk() {
      if (!this.bridge) return false;
      const v = this.bridge.version();
      if (v === this.deskSeen) return false;
      this.deskSeen = v;
      for (const id of this.rdeps.keys()) if (id.startsWith("desk:")) this.invalidate(id);
      this.version++;
      return true;
    }
    /* the pointer over an app's draw(): { x, y, w, h, over, down } in that element's pixels */
    setPointer(appId, p) {
      const old = this.pointers.get(appId) || NO_POINTER;
      if (old.x === p.x && old.y === p.y && old.over === p.over && old.down === p.down && old.w === p.w && old.h === p.h) return;
      this.pointers.set(appId, Object.freeze({ x: p.x, y: p.y, w: p.w, h: p.h, over: !!p.over, down: !!p.down }));
      this.invalidate("$pointer");
      this.version++;
    }
    exportsNow() {
      const out = [];
      for (const [id, a] of this.apps) for (const e of a.exports) out.push({ app: id, name: e.name, value: this.read(id + "." + e.name, null) });
      return out;
    }

    /* ---------- reading: lazy, memoised, dependency-tracked ---------- */
    read(id, track) {
      if (track) track.add(id);
      const c = this.cells.get(id);
      if (c.kind === "formula" && c.dirty) this.compute(c);
      return c.value;
    }
    compute(c) {
      const at = this.computing.indexOf(c.id);
      if (at >= 0) {
        const path = [...this.computing.slice(at), c.id];
        throw new SporeError(`Cycle: ${path.join(" → ")}. A formula cannot depend on itself. Break the loop with a state(…) that steps per tick, or store one side in a cell(…).`, { kind: "link", line: c.line, where: c.id, cycle: true });
      }
      this.computing.push(c.id);
      const track = new Set();
      try {
        c.value = c.fn(this.scope(c.app, "read", track, `The formula "${c.id}"`));
        if (c.value && typeof c.value.then === "function") throw new SporeError(`The formula "${c.id}" returned a Promise. Formulas are synchronous; keep async work outside the program.`, { kind: "runtime" });
        this.clearError("cell:" + c.id); c.error = null;
      } catch (e) {
        if (e.cycle && this.computing[0] !== c.id) { this.computing.pop(); throw e; }
        c.value = undefined; c.error = this.fail("cell:" + c.id, e, { where: c.id, line: c.line, kind: e.kind || "runtime" });
      } finally {
        if (this.computing[this.computing.length - 1] === c.id) this.computing.pop();
      }
      this.setDeps(c.id, track);
      c.dirty = false;
    }
    setDeps(id, track) {
      const c = this.cells.get(id);
      const old = c ? c.deps : null;
      if (old) for (const d of old) if (!track.has(d)) { const s = this.rdeps.get(d); if (s) s.delete(id); }
      for (const d of track) { if (!this.rdeps.has(d)) this.rdeps.set(d, new Set()); this.rdeps.get(d).add(id); }
      if (c) c.deps = track;
    }
    probeStep(c) {
      const track = new Set();
      try { c.step(this.scope(c.app, "read", track, `The state step "${c.id}"`), clone(c.value)); this.clearError("step:" + c.id); }
      catch (e) { this.fail("step:" + c.id, e, { where: c.id, line: c.line, kind: e.kind || "runtime" }); }
      c.deps = track;
    }
    invalidate(id) {
      const queue = [id], seen = new Set();
      while (queue.length) {
        const x = queue.shift();
        const rs = this.rdeps.get(x); if (!rs) continue;
        for (const r of rs) {
          if (seen.has(r)) continue; seen.add(r);
          const c = this.cells.get(r);
          if (c && c.kind === "formula") { c.dirty = true; queue.push(r); }
        }
      }
    }

    /* ---------- writing: only values, params and states change ---------- */
    write(appId, path, v) {
      if (String(path).startsWith("desk.")) {
        if (!this.bridge) throw new SporeError(`$.set("${path}", …) writes to the CC5 desk, and this program is not running inside one.`, { kind: "runtime" });
        const target = String(path).slice(5);
        if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/.test(target)) throw new SporeError(`$.set("${path}", …): write a desk path like "desk.trip.nights".`, { kind: "runtime" });
        this.bridge.write(target, v); return;
      }
      const id = this.resolve(appId, String(path), null, "$.set()");
      const c = this.cells.get(id);
      if (c.kind === "formula") throw new SporeError(`Cannot set "${id}": it is a formula (line ${c.line}). Formulas compute; to store a value make it cell("${c.name}", …) or param("${c.name}", …).`, { kind: "runtime", line: c.line });
      if (c.kind === "param") v = coerce(c.control, v);
      if (same(c.value, v)) return;
      c.value = v;
      this.invalidate(id);
      this.version++;
      this.emit({ type: "change", id, kind: c.kind, value: v });
    }
    setParam(id, v) {
      const c = this.cells.get(id);
      if (!c) throw new SporeError(`No cell "${id}". Params: ${list(this.params().map(p => p.id))}.`, { kind: "runtime" });
      if (c.kind !== "param") throw new SporeError(`"${id}" is a ${c.kind}, not a param. Params: ${list(this.params().map(p => p.id))}.`, { kind: "runtime" });
      this.write(c.app, c.name, v);
    }
    params() { return [...this.cells.values()].filter(c => c.kind === "param").map(c => ({ id: c.id, app: c.app, name: c.name, value: c.value, control: c.control, line: c.line })); }
    act(appId, action) {
      const a = this.apps.get(appId);
      const fn = typeof action === "function" ? action : a.actions.get(action) && a.actions.get(action).fn;
      const def = typeof action === "string" ? a.actions.get(action) : null;
      if (!fn) throw new SporeError(`No action "${action}" in app "${appId}". Actions: ${list([...a.actions.keys()])}.`, { kind: "runtime" });
      try { fn(this.scope(appId, "action", null, "This action")); this.clearError("act:" + appId + "." + (def ? def.name : "lambda")); }
      catch (e) { this.fail("act:" + appId + "." + (def ? def.name : "lambda"), e, { where: appId + (def ? "." + def.name : " button"), line: def ? def.line : null, kind: "runtime" }); }
    }

    /* ---------- time: one tick steps every state, two-phase ---------- */
    tick(dt) {
      this.clock.dt = dt; this.clock.t += dt; this.clock.frame++; this.clock.now = Date.now();
      this.invalidate(CLOCK);
      const next = [];
      for (const c of this.cells.values()) {
        if (c.kind !== "state") continue;
        const track = new Set();
        try { next.push([c, c.step(this.scope(c.app, "read", track, `The state step "${c.id}"`), c.value)]); this.clearError("step:" + c.id); }
        catch (e) { this.fail("step:" + c.id, e, { where: c.id, line: c.line, kind: "runtime" }); }
        this.setDeps(c.id, track);
      }
      for (const [c, v] of next) if (!same(c.value, v)) { c.value = v; this.invalidate(c.id); this.emit({ type: "change", id: c.id, kind: "state", value: v, quiet: true }); }
      this.version++;
    }
    /* the clock pseudo-cell: does anything need ticking? */
    ticking() {
      for (const c of this.cells.values()) if (c.kind === "state" || c.deps.has(CLOCK)) return true;
      for (const s of this.viewReads.values()) if (s.has(CLOCK)) return true;
      return false;
    }
    reset() {
      this.clock = { t: 0, dt: 0, frame: 0, now: Date.now() };
      for (const c of this.cells.values()) {
        if (c.kind === "state") c.value = clone(c.init);
        if (c.kind === "formula") c.dirty = true;
      }
      this.version++;
    }

    /* view evaluation helpers, used by renderers */
    evalSlot(appId, slot, track, where) {
      if (!slot) return undefined;
      if ("value" in slot) return slot.value;
      if (slot.id) return this.read(slot.id, track);
      if (slot.fn) return slot.fn(this.scope(appId, "read", track, where));
    }
    noteViewReads(appId, track) {
      if (!this.viewReads.has(appId)) this.viewReads.set(appId, new Set());
      const s = this.viewReads.get(appId); for (const x of track) s.add(x);
    }

    /* ---------- errors ---------- */
    fail(key, e, ctx) {
      const err = {
        key, kind: (e && e.kind) || ctx.kind || "runtime",
        message: (e && e.message) || String(e),
        line: (e && e.line) || lineOf(e) || ctx.line || null,
        where: ctx.where || (e && e.where) || null,
        hint: (e && e.hint) || null,
      };
      if (!(e instanceof SporeError) && e && e.name && e.name !== "Error") err.message = `${e.name}: ${err.message}`;
      const prev = this.errors.get(key);
      if (!prev || prev.message !== err.message) { this.errors.set(key, err); this.emit({ type: "errors" }); }
      return err;
    }
    clearError(key) { if (this.errors.has(key)) { this.errors.delete(key); this.emit({ type: "errors" }); } }

    /* ---------- the IR: the whole program as plain JSON ---------- */
    ir() {
      const nodes = [{ id: CLOCK, kind: "clock", note: "time: $.t, $.dt, $.now, $.frame" }], edges = [];
      for (const c of this.cells.values()) {
        if (c.kind === "formula" && c.dirty) { try { this.read(c.id, null); } catch {} }
        const n = { id: c.id, app: c.app, name: c.name, kind: c.kind, line: c.line, value: plain(c.value) };
        if (c.kind === "formula") n.fn = src(c.fn);
        if (c.kind === "state") { n.init = plain(c.init); n.step = src(c.step); }
        if (c.kind === "param") n.control = c.control;
        if (c.kind === "formula" || c.kind === "state") { n.reads = [...c.deps]; n.ticks = c.kind === "state" || c.deps.has(CLOCK); }
        if (c.error) n.error = c.error.message;
        nodes.push(n);
        if (n.reads) for (const r of n.reads) edges.push({ from: r, to: c.id });
      }
      let ptr = false;
      for (const c of this.cells.values()) if (c.deps.has("$pointer")) ptr = true;
      for (const s of this.viewReads.values()) if (s.has("$pointer")) ptr = true;
      if (ptr) nodes.push({ id: "$pointer", kind: "pointer", note: "the pointer over an app's draw(): $.pointer" });
      const desk = new Set();
      for (const c of this.cells.values()) for (const d of c.deps) if (d.startsWith("desk:")) desk.add(d);
      for (const s of this.viewReads.values()) for (const d of s) if (d.startsWith("desk:")) desk.add(d);
      for (const d of desk) nodes.push({ id: d, kind: "desk", path: d.slice(5), value: this.bridge ? plain(this.bridge.read(d.slice(5))) : null });
      const apps = [];
      for (const [id, a] of this.apps) {
        const reads = [...(this.viewReads.get(id) || [])];
        nodes.push({ id: id + ".view", app: id, kind: "view", reads, ticks: reads.includes(CLOCK) });
        for (const r of reads) edges.push({ from: r, to: id + ".view" });
        apps.push({ id, title: a.title, w: a.w, line: a.line, cells: [...a.names], exports: a.exports.map(e => e.name), actions: [...a.actions.keys()].map(k => ({ name: k, line: a.actions.get(k).line, fn: src(a.actions.get(k).fn) })), view: a.views.map(viewIR) });
      }
      return {
        spore: 1,
        stages: ["build", "link", "run"],
        apps,
        components: [...this.prog.components.values()].map(c => ({ name: c.name, line: c.line })),
        nodes,
        edges,
        order: this.order(nodes, edges),
        clock: { t: round(this.clock.t), frame: this.clock.frame },
        errors: [...this.errors.values()].map(({ key, ...e }) => e),
      };
    }
    order(nodes, edges) {
      const indeg = new Map(nodes.map(n => [n.id, 0])), out = new Map();
      for (const e of edges) { if (!indeg.has(e.to)) continue; indeg.set(e.to, indeg.get(e.to) + 1); if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); }
      const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id), res = [];
      while (q.length) { const x = q.shift(); res.push(x); for (const y of out.get(x) || []) { indeg.set(y, indeg.get(y) - 1); if (indeg.get(y) === 0) q.push(y); } }
      return res;
    }
  }
  function viewIR(n) {
    const o = { k: n.k, line: n.line };
    if (n.name) o.component = n.name;
    if (n.text) o.text = n.text.fn ? { fn: src(n.text.fn) } : n.text.value;
    if (n.label) o.label = n.label.fn ? { fn: src(n.label.fn) } : n.label.value;
    if (n.of) o.of = n.of.id || n.of.ref || { fn: src(n.of.fn) };
    if (n.cell) o.cell = n.cellId || n.cell;
    if (n.action) o.action = typeof n.action === "string" ? n.action : { fn: src(n.action) };
    if (n.cond) o.when = { fn: src(n.cond) };
    if (n.paint) { o.height = n.height; o.paint = { fn: src(n.paint) }; }
    if (n.opts && Object.keys(n.opts).length) o.opts = plain(n.opts);
    if (n.children) o.children = n.children.map(viewIR);
    return o;
  }
  function coerce(control, v) {
    if (control.type === "range") { const n = Number(v); if (!isFinite(n)) throw new SporeError(`"${control.label}" takes a number. Got ${JSON.stringify(v)}.`, { kind: "runtime" }); return n; }
    if (control.type === "checkbox") return v === true || v === "true" || v === 1;
    if (control.type === "select") { const s = String(v); if (!control.options.includes(s)) throw new SporeError(`"${control.label}" takes one of ${list(control.options)}. Got ${JSON.stringify(v)}.`, { kind: "runtime" }); return s; }
    return String(v);
  }
  function same(a, b) {
    if (Object.is(a, b)) return true;
    if (a && b && typeof a === "object" && typeof b === "object") { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } }
    return false;
  }
  function clone(v) { if (v && typeof v === "object") { try { return structuredClone(v); } catch { return v; } } return v; }
  const round = x => Math.round(x * 1000) / 1000;

  /* one call does all three stages */
  function load(code, opts) {
    const prog = build(code);
    return new Runtime(prog, opts);
  }
  return { build, load, Runtime, SporeError, KINDS, BUILDER_METHODS, RESERVED, CLOCK, plain, lineOf, didYouMean };
})();

/* ---------- presets: the examples, from one cell to a whole home ---------- */
const PRESETS = [
{ id: "hello", title: "1 · Hello, cell", code:
`// One app, one value, one formula, one view.
app("hello", { title: "Hello, cell" })
  .cell("count", 0)                      // a value: actions change it
  .cell("double", $ => $.count * 2)      // a formula: a runtime lambda over $
  .view(v => v                           // a build-time lambda: it makes structure
    .stat("count", "Count")
    .stat("double", "Twice that")
    .button("Add one", $ => $.inc("count")))
` },
{ id: "coffee", title: "2 · Parameters", code:
`// Parameters become controls. Change them and every formula follows.
app("coffee", { title: "Coffee budget" })
  .param("cups", 2, { min: 0, max: 8, step: 1, label: "Cups a day" })
  .param("price", 4.2, { min: 1, max: 9, step: 0.1, unit: "CHF", label: "Price a cup" })
  .param("oat", true, { label: "Oat milk, +0.60" })
  .param("days", "weekdays", { options: ["weekdays", "every day"], label: "Which days" })
  .cell("each", $ => $.price + ($.oat ? 0.6 : 0))
  .cell("perMonth", $ => $.cups * $.each * ($.days === "weekdays" ? 21.7 : 30.4))
  .view(v => v
    .stat("perMonth", "Per month", { unit: "CHF", digits: 0 })
    .meter("perMonth", { max: 300, label: "of a 300 CHF treat budget" })
    .text($ => \`\${$.cups} cups at \${$.each.toFixed(2)} CHF\`))
` },
{ id: "inbox", title: "3 · Actions", code:
`// Actions write. Formulas, views and states only read.
app("inbox", { title: "Inbox" })
  .param("draft", "Buy oat milk", { label: "New task" })
  .cell("tasks", ["Water the plants", "Call the bank"])
  .cell("done", 0)
  .cell("open", $ => $.tasks.length)
  .action("add", $ => {
    if ($.draft.trim()) $.push("tasks", $.draft.trim())
    $.set("draft", "")
  })
  .action("finish", $ => {
    if (!$.tasks.length) return
    $.set("tasks", $.tasks.slice(1))
    $.inc("done")
  })
  .view(v => v
    .stat("open", "Open")
    .list("tasks", { max: 6 })
    .row(r => r.button("Add the draft", "add").button("Finish the first", "finish"))
    .note($ => \`\${$.done} finished so far\`))
` },
{ id: "trip", title: "4 · Two apps talking", code:
`// Apps read each other: $.food.total, $.trip.nights.
// Each read is an edge in the graph, drawn as a wire between windows.
app("trip", { title: "Trip to Lisbon" })
  .param("nights", 4, { min: 1, max: 14 })
  .param("rate", 120, { min: 40, max: 400, step: 5, unit: "€", label: "Hotel a night" })
  .cell("stay", $ => $.nights * $.rate)
  .cell("total", $ => $.stay + $.food.total)
  .view(v => v
    .stat("total", "Trip total", { unit: "€" })
    .row(r => r
      .stat("stay", "Stay", { unit: "€" })
      .stat("food.total", "Food", { unit: "€" })))

app("food", { title: "Food" })
  .param("perDay", 45, { min: 10, max: 150, unit: "€", label: "Food a day" })
  .cell("total", $ => $.perDay * $.trip.nights)
  .view(v => v
    .stat("total", "Food", { unit: "€" })
    .note($ => \`\${$.trip.nights} days at \${$.perDay} €\`))
` },
{ id: "components", title: "5 · Components", code:
`// A component is a build-time function that adds view structure.
// Once defined, it is an element like any other: v.kpi({...}).
component("kpi", (v, { of, label, unit = "", max = 100 }) => v
  .stat(of, label, { unit, digits: 1 })
  .meter(of, { max }))

// An app factory: plain JavaScript makes apps, too.
const account = (id, title, cash, burn) => app(id, { title })
  .param("burn", burn, { min: 1, max: 40, unit: "k/mo", label: "Monthly burn" })
  .cell("cash", cash)
  .cell("runway", $ => $.cash / $.burn)
  .view(v => v.kpi({ of: "runway", label: "Runway", unit: "months", max: 36 }))

account("studio", "Studio", 240, 18)
account("lab", "Lab", 120, 9)

app("group", { title: "Group" })
  .cell("runway", $ => Math.min($.studio.runway, $.lab.runway))
  .view(v => v
    .kpi({ of: "runway", label: "Shortest runway", unit: "months", max: 36 })
    .bars($ => ({ Studio: $.studio.runway, Lab: $.lab.runway }), { label: "Months each" }))
` },
{ id: "habits", title: "6 · Build time", code:
`// Build time: plain JavaScript runs once and makes structure.
// Here a loop makes seven cells and seven toggles.
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const week = app("week", { title: "Habit week" })
  .param("goal", 5, { min: 1, max: 7, label: "Days a week" })
days.forEach(d => week.cell(d, false))               // build time: seven cells

week
  .cell("done", $ => days.filter(d => $[d]).length)  // runtime: reads seven cells
  .cell("onTrack", $ => $.done >= $.goal)
  .view(v => v
    .stat("done", "Days done", { unit: "of 7" })
    .meter("done", { max: 7 })
    .each(days, (v, d) => v.toggle(d, d))            // build time: seven toggles
    .when($ => $.onTrack, v => v.note("Goal reached for this week.")))
` },
{ id: "clock", title: "7 · Time", code:
`// Runtime lambdas that read $.t or $.now run every frame.
app("clock", { title: "Clock", w: 220 })
  .cell("time", $ => new Date($.now))
  .view(v => v
    .draw(170, (g, $) => {
      const d = $.time, cx = g.w / 2, cy = 85, r = 74
      g.circle(cx, cy, r, { stroke: "line", width: 1 })
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2
        g.line(cx + Math.sin(a) * (r - 8), cy - Math.cos(a) * (r - 8), cx + Math.sin(a) * r, cy - Math.cos(a) * r, { stroke: "muted" })
      }
      const hand = (turns, len, o) => g.line(cx, cy, cx + Math.sin(turns * 2 * Math.PI) * len, cy - Math.cos(turns * 2 * Math.PI) * len, o)
      hand((d.getHours() % 12 + d.getMinutes() / 60) / 12, r * 0.5, { width: 3 })
      hand((d.getMinutes() + d.getSeconds() / 60) / 60, r * 0.78, { width: 2 })
      hand(d.getSeconds() / 60, r * 0.88, { stroke: "accent", width: 1 })
    })
    .text($ => $.time.toLocaleTimeString()))

// A semidiurnal tide: one cycle every 12 h 25 min (44,712 s).
app("tide", { title: "Tide at Cascais" })
  .param("range", 3.2, { min: 0.5, max: 8, step: 0.1, unit: "m", label: "Tidal range" })
  .param("speed", 3600, { min: 60, max: 7200, step: 60, unit: "×", label: "Time speed" })
  .cell("height", $ => $.range / 2 * Math.sin($.t * $.speed / 44712 * 2 * Math.PI))
  .view(v => v
    .stat("height", "Water level", { unit: "m", digits: 2 })
    .spark("height", { min: -4, max: 4, label: "Last minutes" }))
` },
{ id: "wild", title: "8 · Simulation", code:
`// A state steps once per tick, from the values of the tick before.
// Hares and lynx, after Lotka and Volterra.
app("wild", { title: "Hares and lynx" })
  .param("birth", 0.9, { min: 0.2, max: 2, step: 0.05, label: "Hare births" })
  .param("hunt", 0.06, { min: 0.01, max: 0.2, step: 0.005, label: "Hunting success" })
  .param("gain", 0.02, { min: 0.005, max: 0.08, step: 0.001, label: "Lynx gain" })
  .param("death", 0.8, { min: 0.2, max: 2, step: 0.05, label: "Lynx deaths" })
  .param("speed", 1.5, { min: 0.2, max: 6, step: 0.1, label: "Years a second" })
  .cell("h", $ => Math.min($.dt, 0.05) * $.speed)    // years per tick
  .state("hares", 40, ($, x) => Math.max(0, x + $.h * ($.birth * x - $.hunt * x * $.lynx)))
  .state("lynx", 9, ($, y) => Math.max(0, y + $.h * ($.gain * $.hares * y - $.death * y)))
  .state("trail", [], ($, tr) => [...tr.slice(-400), [$.hares, $.lynx]])
  .export("hares", "lynx")
  .view(v => v
    .row(r => r.stat("hares", "Hares", { digits: 0 }).stat("lynx", "Lynx", { digits: 0 }))
    .spark("hares", { label: "Hares" })
    .spark("lynx", { label: "Lynx" }))

app("phase", { title: "Phase plot", w: 300 })
  .view(v => v
    .draw(240, (g, $) => {
      const tr = $.wild.trail, X = x => 16 + x / 160 * (g.w - 32), Y = y => g.h - 16 - y / 60 * (g.h - 32)
      g.line(16, g.h - 16, g.w - 16, g.h - 16, { stroke: "line" })
      g.line(16, 16, 16, g.h - 16, { stroke: "line" })
      g.text("hares →", g.w - 16, g.h - 4, { align: "right", color: "muted", size: 10 })
      g.text("lynx ↑", 20, 12, { color: "muted", size: 10 })
      g.path(tr.map(([x, y]) => [X(x), Y(y)]), { stroke: "accent", width: 1.5 })
      if (tr.length) { const [x, y] = tr[tr.length - 1]; g.circle(X(x), Y(y), 4, { fill: "accent" }) }
    }))

app("census", { title: "Census office" })
  .cell("ratio", $ => $.wild.lynx ? $.wild.hares / $.wild.lynx : 0)
  .view(v => v
    .stat("ratio", "Hares per lynx", { digits: 1 })
    .bars($ => ({ Hares: $.wild.hares, Lynx: $.wild.lynx }))
    .row(r => r
      .button("Release 10 lynx", $ => $.set("wild.lynx", $.wild.lynx + 10))
      .button("Release 50 hares", $ => $.set("wild.hares", $.wild.hares + 50))))
` },
{ id: "home", title: "9 · Home computer", code:
`// A whole small computer: five apps, one shared clock, all wired by reads.
// Simulated hours move fast; every app reads the clock app.
app("clock", { title: "Clock", w: 220 })
  .param("speed", 1800, { min: 60, max: 7200, step: 60, unit: "×", label: "Time speed" })
  .cell("step", $ => Math.min($.dt, 0.05) * $.speed / 3600)   // simulated hours per tick
  .state("hours", 6, ($, h) => (h + $.step) % 24)
  .state("day", 1, ($, d) => $.hours + $.step >= 24 ? d + 1 : d)
  .cell("label", $ => \`Day \${$.day}, \${String(Math.floor($.hours)).padStart(2, "0")}:\${String(Math.floor($.hours % 1 * 60)).padStart(2, "0")}\`)
  .view(v => v.stat("label", "Simulated time"))

app("weather", { title: "Weather", w: 240 })
  .param("season", "winter", { options: ["winter", "spring", "summer"], label: "Season" })
  .cell("base", $ => ({ winter: 1, spring: 11, summer: 22 })[$.season])
  .cell("outside", $ => $.base + 5 * Math.sin(($.clock.hours - 9) / 24 * 2 * Math.PI))
  .view(v => v
    .stat("outside", "Outside", { unit: "°C", digits: 1 })
    .spark("outside", { label: "Outside, recent" }))

app("thermostat", { title: "Thermostat" })
  .param("target", 21, { min: 15, max: 25, step: 0.5, unit: "°C", label: "Target" })
  .param("band", 0.5, { min: 0.1, max: 2, step: 0.1, unit: "°C", label: "Dead band" })
  .cell("away", false)
  .state("heating", false, ($, on) =>
    $.away ? false : $.house.temp < $.target - $.band ? true : $.house.temp > $.target + $.band ? false : on)
  .view(v => v
    .stat($ => $.heating ? "Heating" : "Idle", "Boiler")
    .toggle("away", "Away mode"))

app("house", { title: "House" })
  .param("insulation", 0.6, { min: 0.1, max: 1, step: 0.05, label: "Insulation" })
  .cell("window", false)
  .cell("loss", $ => (1.2 - $.insulation) * ($.window ? 3 : 1) * 0.25)   // per hour
  .state("temp", 19, ($, T) =>
    T + $.clock.step * ($.loss * ($.weather.outside - T) + ($.thermostat.heating ? 2.2 : 0)))
  .view(v => v
    .stat("temp", "Living room", { unit: "°C", digits: 1 })
    .spark("temp", { label: "Room, recent", min: 10, max: 26 })
    .toggle("window", "Window open"))

app("energy", { title: "Energy bill" })
  .param("price", 0.29, { min: 0.1, max: 0.6, step: 0.01, unit: "CHF/kWh", label: "Price" })
  .param("power", 8, { min: 2, max: 20, step: 0.5, unit: "kW", label: "Boiler power" })
  .state("kwh", 0, ($, e) => e + ($.thermostat.heating ? $.power * $.clock.step : 0))
  .cell("cost", $ => $.kwh * $.price)
  .cell("perDay", $ => $.cost / Math.max(1, $.clock.day - 1 + $.clock.hours / 24))
  .view(v => v
    .stat("cost", "So far", { unit: "CHF", digits: 2 })
    .stat("perDay", "Per day", { unit: "CHF", digits: 2 })
    .meter("perDay", { max: 30, label: "of a 30 CHF daily cap" }))
` },
{ id: "desk", title: "10 · Reading the desk", code:
`// Inside CC5, $.desk reads the desk's own apps, and an action may write them.
// export() puts a Spore cell back on the desk, where any formula can read it.
// This example reads the Docs app if the desk has one.
app("words", { title: "Words on the desk" })
  .cell("docs", $ => {
    try { return $.desk.docs.files } catch (e) { return [] }   // no Docs app: nothing to count
  })
  .cell("count", $ => $.docs.reduce((n, d) => n + String(d.body || "").split(/\\s+/).filter(Boolean).length, 0))
  .cell("titles", $ => $.docs.map(d => d.title))
  .export("count")
  .view(v => v
    .stat("count", "Words across all docs")
    .list("titles", { label: "Docs" })
    .note("Write a new doc in Docs and watch this count move."))
` },
{ id: "creatures", title: "11 · Creatures", code:
`// Procedural animals.
// A body is a chain of joints. The head moves toward a target; every joint after
// it keeps a fixed distance from the one ahead and may bend only so far. Legs plant
// their feet and take a step when the body has moved on. Move the pointer over the
// field, or drag in it. Every animal's window is a camera that follows it.

// ---------- build time: plain JavaScript helpers ----------
const TAU = Math.PI * 2
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0])          // direction from a to b
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))               // into −π..π
const along = (p, a, d) => [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d]
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const SKIN = { orange: "accent", blue: "p7", green: "good", ochre: "p4", violet: "p3", rose: "p6" }
const SKINS = Object.keys(SKIN)

// a straight chain of n joints, len apart
const chain = (n, len, x, y) => range(n).map(i => [x - i * len, y])
// grow or shrink a chain to n joints, keeping its shape
const fit = (pts, n, len) => {
  const out = pts.slice(0, n)
  while (out.length < n) { const k = out.length, a = k > 1 ? ang(out[k - 2], out[k - 1]) : Math.PI; out.push(along(out[k - 1], a, len)) }
  return out
}
// one tick of follow-the-leader: the head chases the target, the rest keep distance and bend
function follow(pts, target, len, speed, bend, dt) {
  const out = pts.map(p => p.slice())
  const d = dist(out[0], target)
  if (d > 2) out[0] = along(out[0], ang(out[0], target), Math.min(d, speed * dt))
  for (let i = 1; i < out.length; i++) {
    let a = ang(out[i - 1], out[i])
    if (i > 1) { const prev = ang(out[i - 2], out[i - 1]); a = prev + clamp(wrap(a - prev), -bend, bend) }
    out[i] = along(out[i - 1], a, len)
  }
  return out
}
// the direction each joint faces (toward the head)
const facing = (pts, i) => (i === 0 ? ang(pts[1], pts[0]) : ang(pts[i], pts[i - 1]))
// a closed outline around a chain, with a width at each joint and a round nose
function outline(pts, width) {
  const L = [], R = [], n = pts.length
  pts.forEach((p, i) => { const a = facing(pts, i), w = width(i / (n - 1)); L.push(along(p, a + TAU / 4, w)); R.push(along(p, a - TAU / 4, w)) })
  const a0 = facing(pts, 0), w0 = width(0)
  const nose = range(1, 8).map(k => along(pts[0], a0 + TAU / 4 - (k / 8) * (TAU / 2), w0))
  return [L[0], ...nose, ...R, ...L.reverse()]
}
// two equal bones from hip to foot; the knee bends to one side
function leg(g, hip, foot, len, side, M, s) {
  const d = Math.min(dist(hip, foot), len * 1.96), bend = Math.acos(clamp(d / (2 * len), -1, 1))
  const knee = along(hip, ang(hip, foot) - side * bend, len)
  const [H, K, F] = [hip, knee, foot].map(M)
  g.path([H, K, F], { stroke: "ink", width: 3.5 * s })
  const toe = ang(knee, foot)
  for (const t of [-0.6, 0, 0.6]) { const q = M(along(foot, toe + t, len * 0.35)); g.line(F[0], F[1], q[0], q[1], { stroke: "ink", width: 1.6 * s }) }
}
// the skeleton, for seeing how it works
function bones(g, pts, len, M, s) {
  g.path(pts.map(M), { stroke: "ink", width: 1, alpha: 0.7 })
  pts.forEach((p, i) => { const q = M(p); g.circle(q[0], q[1], i ? 2.2 : 3.5, { fill: i ? "card" : "accent", stroke: "ink", width: 1 }) })
  for (let i = 0; i < pts.length; i += 4) { const q = M(pts[i]); g.circle(q[0], q[1], len * s, { stroke: "muted", width: 1, alpha: 0.35, dash: [3, 3] }) }
}

// ---------- the three animals, as painters: (g, animal, map, scale, showBones) ----------
const snakeW = c => u => c.size * (0.75 + 0.25 * Math.min(1, u * 8)) * Math.pow(1 - u, 0.65) + 0.8
function paintSnake(g, c, M, s, showBones) {
  const pts = c.body, w = snakeW(c), n = pts.length
  g.poly(outline(pts, w).map(M), { fill: SKIN[c.skin], stroke: "ink", width: 1.2 })
  for (let i = 3; i < n - 3; i += 3) {
    const a = facing(pts, i), r = w(i / (n - 1)) * 0.55
    g.poly([along(pts[i], a, r), along(pts[i], a + TAU / 4, r * 0.8), along(pts[i], a + TAU / 2, r), along(pts[i], a - TAU / 4, r * 0.8)].map(M), { fill: "ink", alpha: 0.28 })
  }
  eyes(g, pts, w(0), M, s)
  if (showBones) bones(g, pts, c.len, M, s)
}
const fishW = c => u => c.size * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.92)), 0.75) + 1
function paintFish(g, c, M, s, showBones) {
  const pts = c.body, w = fishW(c), n = pts.length
  const fin = (j, side, size) => {
    const a = facing(pts, j), base = along(pts[j], a + side * TAU / 4, w(j / (n - 1)) * 0.85)
    g.poly([base, along(base, a + side * (TAU / 4 + 0.9), size), along(base, a + TAU / 2, size * 0.7)].map(M), { fill: SKIN[c.skin], stroke: "ink", width: 1, alpha: 0.85 })
  }
  for (const side of [1, -1]) { fin(2, side, c.size * 1.3); fin(Math.round(n * 0.6), side, c.size * 0.7) }
  const t = pts[n - 1], back = ang(pts[n - 2], t), L = c.size * 1.9
  g.poly([t, along(t, back + 0.6, L), along(t, back, L * 0.55), along(t, back - 0.6, L)].map(M), { fill: SKIN[c.skin], stroke: "ink", width: 1.2 })
  g.poly(outline(pts, w).map(M), { fill: SKIN[c.skin], stroke: "ink", width: 1.2 })
  g.path(pts.slice(1, Math.round(n * 0.7)).map(M), { stroke: "card", width: 2 * s, alpha: 0.5 })
  eyes(g, pts, w(0), M, s)
  if (showBones) bones(g, pts, c.len, M, s)
}
const geckoW = c => u => c.size * (u < 0.1 ? 0.95 : u < 0.17 ? 0.62 : u < 0.46 ? 1 : 1 - (u - 0.46) / 0.54 * 0.92) + 0.8
const LEGS = [[3, 1], [3, -1], [8, 1], [8, -1]]          // joint, side
function paintGecko(g, c, M, s, showBones) {
  const pts = c.body, w = geckoW(c), n = pts.length
  LEGS.forEach(([j, side], k) => {
    const f = c.feet[k]; if (!f) return
    leg(g, along(pts[j], facing(pts, j) + side * TAU / 4, w(j / (n - 1)) * 0.55), f, c.leg, side, M, s)
  })
  g.poly(outline(pts, w).map(M), { fill: SKIN[c.skin], stroke: "ink", width: 1.2 })
  for (let i = 4; i < n * 0.5; i += 2) { const q = M(pts[i]); g.circle(q[0], q[1], w(i / (n - 1)) * 0.25 * s, { fill: "card", alpha: 0.6 }) }
  eyes(g, pts, w(0), M, s)
  if (showBones) { bones(g, pts, c.len, M, s); c.feet.forEach(f => { const q = M(f); g.circle(q[0], q[1], 5, { stroke: f[2] ? "accent" : "good", width: 1.5 }) }) }
}
function eyes(g, pts, w, M, s) {
  const a = facing(pts, 0)
  for (const side of [1, -1]) { const e = M(along(along(pts[0], a, w * 0.1), a + side * TAU / 4, w * 0.55)); g.circle(e[0], e[1], Math.max(1.4, w * 0.2 * s), { fill: "ink" }) }
}
// a camera that follows one animal, over a dot grid that shows it moving
function closeUp(g, c, paint, showBones) {
  const pts = c.body, mid = pts[Math.floor(pts.length / 3)], s = 0.9
  const M = p => [g.w / 2 + (p[0] - mid[0]) * s, g.h / 2 + (p[1] - mid[1]) * s]
  g.clear("paper")
  const step = 24, ox = ((g.w / 2 - mid[0] * s) % step + step) % step, oy = ((g.h / 2 - mid[1] * s) % step + step) % step
  for (let x = ox; x < g.w; x += step) for (let y = oy; y < g.h; y += step) g.rect(x, y, 1.5, 1.5, { fill: "line" })
  paint(g, c, M, s, showBones)
}
// shared params for every animal
const animal = (id, title, o) => app(id, { title, w: 250 })
  .param("on", true, { label: "In the field" })
  .param("joints", o.joints, { min: o.minJoints || 6, max: o.joints * 2, step: 1, label: "Joints" })
  .param("len", o.len, { min: 3, max: o.len * 2, step: 0.5, unit: "px", label: "Joint spacing" })
  .param("size", o.size, { min: 3, max: o.size * 2, step: 0.5, unit: "px", label: "Body width" })
  .param("speed", o.speed, { min: 20, max: 420, step: 5, unit: "px/s", label: "Speed" })
  .param("bend", o.bend, { min: 0.05, max: 1.2, step: 0.01, unit: "rad", label: "Most bend per joint" })
  .param("skin", o.skin, { options: SKINS, label: "Skin" })
  .state("body", chain(o.joints, o.len, o.x, o.y), ($, b) => follow(fit(b, $.joints, $.len), $.target, $.len, $.speed, $.bend, Math.min($.dt, 0.05)))

// ---------- the field: where everyone lives, and where the pointer leads ----------
app("field", { title: "The field", w: 700 })
  .param("chase", true, { label: "Follow the pointer" })
  .param("showBones", false, { label: "Show the skeletons" })
  .cell("W", 660)
  .cell("H", 400)
  .cell("inside", $ => p => [clamp(p[0], 24, $.W - 24), clamp(p[1], 24, $.H - 24)])   // a formula can hold a function
  .cell("target", $ => {
    const p = $.pointer
    if ($.chase && p.over && p.w) {
      const s = Math.min(p.w / $.W, p.h / $.H), ox = (p.w - $.W * s) / 2, oy = (p.h - $.H * s) / 2
      return $.inside([(p.x - ox) / s, (p.y - oy) / s])
    }
    return [$.W / 2 + Math.cos($.t * 0.45) * 230 + Math.sin($.t * 1.1) * 50, $.H / 2 + Math.sin($.t * 0.7) * 130]
  })
  .view(v => v
    .draw(400, (g, $) => {
      const s = Math.min(g.w / $.W, g.h / $.H), ox = (g.w - $.W * s) / 2, oy = (g.h - $.H * s) / 2
      const M = p => [ox + p[0] * s, oy + p[1] * s]
      g.clear("paper")
      const step = 30 * s
      for (let x = ox % step; x < g.w; x += step) for (let y = oy % step; y < g.h; y += step) g.rect(x, y, 1.5, 1.5, { fill: "line" })
      const T = M($.target)
      g.circle(T[0], T[1], 7, { stroke: "accent", width: 1.5 }); g.circle(T[0], T[1], 2, { fill: "accent" })
      if ($.gecko.on) paintGecko(g, $.gecko, M, s, $.showBones)
      if ($.koi.on) paintFish(g, $.koi, M, s, $.showBones)
      if ($.snake.on) paintSnake(g, $.snake, M, s, $.showBones)
    })
    .note($ => $.chase ? "Move the pointer over the field, or drag. Each animal chases its own point near yours." : "The animals follow a wandering point. Turn on Follow the pointer to lead them."))

// ---------- the animals: one app each, with its own params and camera ----------
animal("snake", "Snake", { joints: 40, len: 7, size: 9, speed: 170, bend: 0.32, skin: "green", x: 120, y: 320, minJoints: 8 })
  .cell("target", $ => $.field.target)
  .view(v => v.draw(150, (g, $) => closeUp(g, $, paintSnake, $.field.showBones)))

animal("koi", "Koi", { joints: 13, len: 9, size: 15, speed: 140, bend: 0.22, skin: "orange", x: 420, y: 90 })
  .cell("target", $ => { const [x, y] = $.field.target; return $.field.inside([x + Math.cos($.t * 1.2) * 95, y + Math.sin($.t * 1.2) * 60]) })
  .view(v => v.draw(150, (g, $) => closeUp(g, $, paintFish, $.field.showBones)))

animal("gecko", "Gecko", { joints: 18, len: 10, size: 10, speed: 90, bend: 0.3, skin: "ochre", x: 300, y: 260, minJoints: 12 })
  .param("leg", 15, { min: 6, max: 26, step: 0.5, unit: "px", label: "Leg bone" })
  .param("stride", 24, { min: 6, max: 60, step: 1, unit: "px", label: "Stride" })
  .cell("target", $ => { const [x, y] = $.field.target; return $.field.inside([x - Math.cos($.t * 0.8) * 140, y - Math.sin($.t * 0.8) * 90]) })
  // feet stay planted until the hip has moved a stride away, then step ahead;
  // the two feet of one pair never lift together
  .state("feet", [], ($, feet) => LEGS.map(([j, side], k) => {
    const pts = $.body, a = facing(pts, j)
    const home = along(along(pts[j], a + side * 1.15, $.leg * 1.75), a, $.leg * 0.3)
    const f = feet[k] || [home[0], home[1], 0]
    let stepping = f[2]
    if (!stepping && dist(f, home) > $.stride && !(feet[k ^ 1] && feet[k ^ 1][2])) stepping = 1
    if (!stepping) return f
    const goal = along(home, a, $.stride * 0.45), d = dist(f, goal), sp = $.speed * 3.2 * Math.min($.dt, 0.05)
    if (d <= sp) return [goal[0], goal[1], 0]
    return [f[0] + (goal[0] - f[0]) * sp / d, f[1] + (goal[1] - f[1]) * sp / d, 1]
  }))
  .view(v => v.draw(150, (g, $) => closeUp(g, $, paintGecko, $.field.showBones)))
` },
];

/* ==========================================================================
   PAINT — the runtime drawn on a canvas. One Stage draws one of three things:
     desk   every app as a window, wires between apps that read each other
     app    one app's view, no chrome (a Spore app inside a CC5 window)
     graph  the DAG itself: cells, views, the clock and desk reads, in layers
   The canvas is devicePixelRatio aware and also accounts for CC5's zoom.
   ========================================================================== */
const Paint = (() => {
  "use strict";
  const FONT = "Arial, sans-serif";
  const PAD = 12, GAP = 10, BAR = 30, RADIUS = 2.5;
  const DEFAULT = {
    light: { paper: "#EEEEEC", card: "#FFFFFF", raise: "#FFFFFF", ink: "#141414", "ink-2": "#454545", muted: "#7C7C7A", line: "#D6D6D3", "line-2": "#E9E9E6", accent: "#E0400F", good: "#2F7A4E", bad: "#B42318", warn: "#946200", you: "#2650A8", p2: "#2F7A4E", p3: "#7E6BB0", p4: "#B8862B", p5: "#3F8F8A", p6: "#B5636E", p7: "#4F79A8", shadow: "rgba(20,20,20,0.16)" },
    dark: { paper: "#1A1A1A", card: "#222222", raise: "#2A2A2A", ink: "#EDEDED", "ink-2": "#C4C4C4", muted: "#8C8C8C", line: "#3A3A3A", "line-2": "#2D2D2D", accent: "#FF6A3D", good: "#63C08C", bad: "#F2766A", warn: "#E0B04A", you: "#86A9F0", p2: "#63C08C", p3: "#A493D6", p4: "#D9A84A", p5: "#62B5AF", p6: "#D88893", p7: "#79A0D0", shadow: "rgba(0,0,0,0.5)" },
  };
  const NAMES = Object.keys(DEFAULT.light);
  /* the tokens the canvas paints with: CC5's CSS variables when present */
  function tokens(el) {
    const cs = getComputedStyle(el);
    const dark = (cs.getPropertyValue("color-scheme") || "").includes("dark") || matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.getAttribute("data-theme") !== "light" || document.documentElement.getAttribute("data-theme") === "dark";
    const base = DEFAULT[dark ? "dark" : "light"], T = { dark };
    for (const n of NAMES) T[n] = (cs.getPropertyValue("--" + n) || "").trim() || (cs.getPropertyValue("--sp-" + n) || "").trim() || base[n];
    T.palette = [T.accent, T.p7, T.p2, T.p4, T.p3, T.p5, T.p6];
    return T;
  }
  const col = (T, c, d) => (c == null ? d : T[c] || c);
  const font = (size, bold) => `${bold ? "700 " : ""}${size}px ${FONT}`;

  /* numbers the way people read them */
  function fmt(v, o = {}) {
    let s;
    if (v === undefined || v === null || (typeof v === "number" && isNaN(v))) s = "–";
    else if (typeof v === "number") {
      const d = o.digits != null ? o.digits : Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
      s = isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: o.digits != null ? d : 0, maximumFractionDigits: d }) : String(v);
    } else if (typeof v === "boolean") s = v ? "yes" : "no";
    else if (v instanceof Date) s = v.toLocaleString();
    else if (Array.isArray(v)) s = `${v.length} item${v.length === 1 ? "" : "s"}`;
    else if (typeof v === "object") { try { s = JSON.stringify(v); } catch { s = "{…}"; } }
    else s = String(v);
    return (o.pre || "") + s;
  }
  const wrapCache = new Map();
  function wrap(ctx, text, w) {
    const key = ctx.font + "|" + w + "|" + text;
    if (wrapCache.has(key)) return wrapCache.get(key);
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const t = line + word;
        if (ctx.measureText(t).width > w && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
        else line = t;
      }
      out.push(line);
    }
    if (wrapCache.size > 800) wrapCache.clear();
    wrapCache.set(key, out);
    return out;
  }
  function clip(ctx, text, w) {
    text = String(text);
    if (ctx.measureText(text).width <= w) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > w) text = text.slice(0, -1);
    return text + "…";
  }
  function rrect(ctx, x, y, w, h, r = RADIUS) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function caps(ctx, text, x, y, color, size = 10) {
    ctx.font = font(size, true); ctx.fillStyle = color;
    if ("letterSpacing" in ctx) { ctx.letterSpacing = "0.12em"; ctx.fillText(String(text).toUpperCase(), x, y); ctx.letterSpacing = "0px"; }
    else ctx.fillText(String(text).toUpperCase(), x, y);
  }

  /* ---------- the drawing API a draw() lambda receives ---------- */
  function makeG(ctx, T, x, y, w, h) {
    const style = (o, defStroke) => {
      ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
      ctx.lineWidth = o.width != null ? o.width : 1.5;
      ctx.setLineDash(o.dash || []);
      ctx.strokeStyle = col(T, o.stroke, defStroke ? T.ink : "transparent");
      ctx.fillStyle = col(T, o.fill, "transparent");
    };
    const done = o => { if (o.fill) ctx.fill(); if (o.stroke || (!o.fill)) ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); };
    return {
      w, h,
      map: (v, a, b, c, d) => c + (d - c) * ((v - a) / ((b - a) || 1)),
      clear(c) { ctx.fillStyle = col(T, c, T.card); ctx.fillRect(0, 0, w, h); return this; },
      line(x1, y1, x2, y2, o = {}) { style(o, true); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); return this; },
      rect(rx, ry, rw, rh, o = {}) { if (!o.fill && !o.stroke) o = Object.assign({ fill: "ink" }, o); style(o); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); done(o); return this; },
      circle(cx, cy, r, o = {}) { if (!o.fill && !o.stroke) o = Object.assign({ fill: "ink" }, o); style(o); ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2); done(o); return this; },
      path(pts, o = {}) {
        if (!pts || pts.length < 2) return this;
        if (!o.fill && !o.stroke) o = Object.assign({ stroke: "ink" }, o);
        style(o); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (o.close) ctx.closePath(); done(o); return this;
      },
      poly(pts, o = {}) { return this.path(pts, Object.assign({ close: true }, o.fill || o.stroke ? o : Object.assign({ fill: "ink" }, o))); },
      text(s, tx, ty, o = {}) {
        ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
        ctx.font = font(o.size || 12, o.bold); ctx.fillStyle = col(T, o.color, T.ink);
        ctx.textAlign = o.align || "left"; ctx.textBaseline = o.baseline || "alphabetic";
        ctx.fillText(String(s), tx, ty); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1; return this;
      },
    };
  }

  /* ---------- one app's view: measure and draw in one pass ---------- */
  // st (per app, kept by the Stage): sparks history, hits, hover/press keys.
  function paintApp(ctx, T, rt, appId, x, y, w, st, drawing) {
    const a = rt.apps.get(appId);
    const track = new Set();
    let yy = y;
    const errKeys = [];
    const slot = (n, key, s) => {
      try { const v = rt.evalSlot(appId, s, track, `This view (line ${n.line})`); rt.clearError("view:" + key); return { v }; }
      catch (e) { rt.fail("view:" + key, e, { where: appId + ".view", line: n.line, kind: e.kind || "runtime" }); return { err: e.message }; }
    };
    const errText = (msg, x0, y0, w0) => {
      ctx.font = font(11); const lines = wrap(ctx, "⚠ " + msg, w0);
      if (drawing) { ctx.fillStyle = T.bad; lines.forEach((l, i) => ctx.fillText(l, x0, y0 + 12 + i * 15)); }
      return lines.length * 15 + 2;
    };
    const hit = (key, x0, y0, w0, h0, kind, click) => { if (drawing) st.hits.push({ key, x: x0, y: y0, w: w0, h: h0, kind, click, app: appId }); };

    function node(n, key, x0, y0, w0) {
      ctx.textBaseline = "alphabetic";
      switch (n.k) {
        case "h": case "text": case "note": {
          const r = slot(n, key, n.text); if (r.err) return errText(r.err, x0, y0, w0);
          const size = n.k === "h" ? 15 : n.k === "text" ? 13 : 11.5, lh = n.k === "h" ? 19 : n.k === "text" ? 18 : 16;
          ctx.font = font(size, n.k === "h"); const lines = wrap(ctx, fmt(r.v), w0);
          if (drawing) { ctx.fillStyle = n.k === "h" ? T.ink : n.k === "text" ? T["ink-2"] : T.muted; lines.forEach((l, i) => ctx.fillText(l, x0, y0 + lh * (i + 1) - (lh - size) / 2 - 2)); }
          return lines.length * lh;
        }
        case "stat": {
          const r = slot(n, key, n.of); const lab = n.label ? slot(n, key + "l", n.label) : { v: "" };
          const o = n.opts || {};
          if (drawing) {
            caps(ctx, clip(ctx, fmt(lab.v === undefined ? "" : lab.v), w0), x0, y0 + 10, T.muted);
            if (r.err) errText(r.err, x0, y0 + 14, w0);
            else {
              ctx.font = font(26, true); ctx.fillStyle = T.ink;
              const s = clip(ctx, fmt(r.v, o), w0); ctx.fillText(s, x0, y0 + 42);
              if (o.unit) { const sw = ctx.measureText(s).width; ctx.font = font(12); ctx.fillStyle = T.muted; ctx.fillText(clip(ctx, o.unit, Math.max(0, w0 - sw - 5)), x0 + sw + 5, y0 + 42); }
            }
          }
          return r.err ? 14 + 18 : 46;
        }
        case "meter": {
          const r = slot(n, key, n.of); if (r.err) return errText(r.err, x0, y0, w0);
          const o = n.opts || {}, max = o.max != null ? o.max : 100, min = o.min || 0, v = Number(r.v) || 0, f = Math.max(0, Math.min(1, (v - min) / ((max - min) || 1)));
          if (drawing) {
            ctx.font = font(11); ctx.fillStyle = T.muted; if (o.label) ctx.fillText(clip(ctx, o.label, w0 * 0.6), x0, y0 + 11);
            const t = fmt(v, o) + " / " + fmt(max, o); ctx.fillStyle = T["ink-2"]; ctx.textAlign = "right"; ctx.fillText(t, x0 + w0, y0 + 11); ctx.textAlign = "left";
            ctx.fillStyle = T["line-2"]; rrect(ctx, x0, y0 + 17, w0, 6); ctx.fill();
            ctx.fillStyle = v > max ? T.warn : T.accent; if (f > 0) { rrect(ctx, x0, y0 + 17, Math.max(3, w0 * f), 6); ctx.fill(); }
          }
          return 23;
        }
        case "spark": {
          const r = slot(n, key, n.of); if (r.err) return errText(r.err, x0, y0, w0);
          const o = n.opts || {}, hh = o.h || 44, max = o.n || 160;
          let hist = st.sparks.get(key); if (!hist) { hist = { pts: [], last: -1 }; st.sparks.set(key, hist); }
          const now = performance.now();
          if (drawing && typeof r.v === "number" && isFinite(r.v) && now - hist.last > 60) { hist.pts.push(r.v); hist.last = now; if (hist.pts.length > max) hist.pts.shift(); }
          if (drawing) {
            ctx.font = font(11); ctx.fillStyle = T.muted; if (o.label) ctx.fillText(clip(ctx, o.label, w0 * 0.6), x0, y0 + 11);
            ctx.fillStyle = T["ink-2"]; ctx.textAlign = "right"; ctx.fillText(fmt(r.v, o) + (o.unit ? " " + o.unit : ""), x0 + w0, y0 + 11); ctx.textAlign = "left";
            const top = y0 + 17, pts = hist.pts;
            ctx.strokeStyle = T["line-2"]; ctx.lineWidth = 1;
            for (const f of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(x0, Math.round(top + f * hh) + 0.5); ctx.lineTo(x0 + w0, Math.round(top + f * hh) + 0.5); ctx.stroke(); }
            if (pts.length > 1) {
              let lo = o.min != null ? o.min : Math.min(...pts), hi = o.max != null ? o.max : Math.max(...pts);
              if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
              const X = i => x0 + (i / (max - 1)) * w0, Y = v => top + hh - ((v - lo) / (hi - lo)) * hh;
              const off = max - pts.length;
              ctx.beginPath(); ctx.moveTo(X(off), top + hh); pts.forEach((v, i) => ctx.lineTo(X(off + i), Y(v))); ctx.lineTo(X(off + pts.length - 1), top + hh); ctx.closePath();
              ctx.globalAlpha = 0.12; ctx.fillStyle = T.accent; ctx.fill(); ctx.globalAlpha = 1;
              ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(off + i), Y(v)) : ctx.moveTo(X(off + i), Y(v)))); ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5; ctx.stroke();
              ctx.beginPath(); ctx.arc(X(off + pts.length - 1), Y(pts[pts.length - 1]), 2.5, 0, Math.PI * 2); ctx.fillStyle = T.accent; ctx.fill();
            } else { ctx.font = font(11); ctx.fillStyle = T.muted; ctx.fillText("Collecting…", x0, top + hh / 2 + 4); }
          }
          return 17 + hh;
        }
        case "bars": {
          const r = slot(n, key, n.of); if (r.err) return errText(r.err, x0, y0, w0);
          const o = n.opts || {}, hh = o.h || 84;
          let items = [];
          const v = r.v;
          if (Array.isArray(v)) items = v.map((x, i) => (x && typeof x === "object" ? { label: String(x.label ?? x.name ?? i + 1), value: Number(x.value ?? x.n ?? 0) } : { label: String(i + 1), value: Number(x) || 0 }));
          else if (v && typeof v === "object") items = Object.entries(v).map(([k, x]) => ({ label: k, value: Number(x) || 0 }));
          const head = o.label ? 15 : 0;
          if (drawing) {
            if (o.label) { ctx.font = font(11); ctx.fillStyle = T.muted; ctx.fillText(clip(ctx, o.label, w0), x0, y0 + 11); }
            const max = o.max != null ? o.max : Math.max(1e-9, ...items.map(i => i.value)) * 1.12;
            const nb = Math.max(1, items.length), gap = nb > 12 ? 2 : 8, bw = Math.min(64, (w0 - gap * (nb - 1)) / nb);
            const top = y0 + head;
            ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, top + hh + 0.5); ctx.lineTo(x0 + w0, top + hh + 0.5); ctx.stroke();
            items.forEach((it, i) => {
              const bx = x0 + i * (bw + gap), bh = Math.max(0, Math.min(1, it.value / max)) * (hh - 14);
              ctx.fillStyle = T.palette[i % T.palette.length]; ctx.fillRect(bx, top + hh - bh, bw, bh);
              if (bw >= 22) { ctx.font = font(10, true); ctx.fillStyle = T["ink-2"]; ctx.textAlign = "center"; ctx.fillText(fmt(it.value, { digits: o.digits }), bx + bw / 2, top + hh - bh - 4); }
              if (bw >= 18) { ctx.font = font(10); ctx.fillStyle = T.muted; ctx.textAlign = "center"; ctx.fillText(clip(ctx, it.label, bw + gap - 2), bx + bw / 2, top + hh + 13); }
              ctx.textAlign = "left";
            });
          }
          return head + hh + 16;
        }
        case "list": {
          const r = slot(n, key, n.of); if (r.err) return errText(r.err, x0, y0, w0);
          const o = n.opts || {}, items = Array.isArray(r.v) ? r.v : r.v && typeof r.v === "object" ? Object.entries(r.v).map(([k, v]) => `${k}: ${fmt(v)}`) : [];
          const max = o.max || 8, shown = items.slice(0, max), head = o.label ? 15 : 0;
          const textOf = it => {
            if (o.text) { try { return fmt(o.text(it)); } catch (e) { return "⚠ " + e.message; } }
            if (it && typeof it === "object") return fmt(it.title ?? it.name ?? it.text ?? it.label ?? JSON.stringify(it));
            return fmt(it);
          };
          if (drawing) {
            if (o.label) { ctx.font = font(11); ctx.fillStyle = T.muted; ctx.fillText(clip(ctx, o.label, w0), x0, y0 + 11); }
            ctx.font = font(13);
            shown.forEach((it, i) => {
              const ry = y0 + head + i * 24;
              ctx.fillStyle = T.accent; ctx.fillRect(x0, ry + 10, 4, 4);
              ctx.fillStyle = T.ink; ctx.font = font(13); ctx.fillText(clip(ctx, textOf(it), w0 - 12), x0 + 12, ry + 16);
              ctx.strokeStyle = T["line-2"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, ry + 23.5); ctx.lineTo(x0 + w0, ry + 23.5); ctx.stroke();
            });
            if (!items.length) { ctx.font = font(12); ctx.fillStyle = T.muted; ctx.fillText(o.empty || "Nothing here yet", x0, y0 + head + 15); }
            if (items.length > max) { ctx.font = font(11); ctx.fillStyle = T.muted; ctx.fillText(`+ ${items.length - max} more`, x0, y0 + head + shown.length * 24 + 13); }
          }
          return head + Math.max(1, shown.length) * 24 + (items.length > max ? 18 : 0);
        }
        case "draw": {
          const hh = n.height;
          if (drawing) {
            ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w0, hh); ctx.clip(); ctx.translate(x0, y0);
            try { n.paint(makeG(ctx, T, x0, y0, w0, hh), rt.scope(appId, "read", track, `This draw() (line ${n.line})`)); rt.clearError("view:" + key); }
            catch (e) { ctx.restore(); ctx.save(); rt.fail("view:" + key, e, { where: appId + ".view", line: n.line, kind: e.kind || "runtime" }); errText(e.message, x0, y0, w0); }
            ctx.restore(); ctx.globalAlpha = 1; ctx.setLineDash([]);
            hit(key, x0, y0, w0, hh, "draw", null);
          }
          return hh;
        }
        case "button": {
          const lab = slot(n, key, n.label), hh = 30;
          if (drawing) {
            const hot = st.hover === key, down = st.press === key;
            rrect(ctx, x0 + 0.5, y0 + 0.5, w0 - 1, hh - 1);
            ctx.fillStyle = down ? T["line-2"] : hot ? T["line-2"] : T.card; ctx.fill();
            ctx.strokeStyle = hot || down ? T["ink-2"] : T.line; ctx.lineWidth = 1; ctx.stroke();
            ctx.font = font(12.5, true); ctx.fillStyle = T.ink; ctx.textAlign = "center";
            ctx.fillText(clip(ctx, fmt(lab.err ? "⚠" : lab.v), w0 - 12), x0 + w0 / 2, y0 + 19.5); ctx.textAlign = "left";
            hit(key, x0, y0, w0, hh, "button", () => rt.act(appId, n.action));
          }
          return hh;
        }
        case "toggle": {
          const on = !!rt.read(n.cellId, track), lab = slot(n, key, n.label), hh = 26;
          if (drawing) {
            const hot = st.hover === key;
            rrect(ctx, x0 + 0.5, y0 + 5.5, 30, 16); ctx.fillStyle = on ? T.accent : T["line-2"]; ctx.fill(); ctx.strokeStyle = on ? T.accent : hot ? T["ink-2"] : T.line; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = T.card; rrect(ctx, on ? x0 + 17 : x0 + 3, y0 + 8, 11, 11, 1.5); ctx.fill();
            ctx.font = font(13); ctx.fillStyle = T.ink; ctx.fillText(clip(ctx, fmt(lab.v), w0 - 42), x0 + 40, y0 + 18);
            hit(key, x0, y0, Math.min(w0, 44 + ctx.measureText(fmt(lab.v)).width), hh, "toggle", () => rt.write(appId, n.cell, !on));
          }
          return hh;
        }
        case "stepper": {
          const v = Number(rt.read(n.cellId, track)) || 0, lab = slot(n, key, n.label), o = n.opts || {}, step = o.step || 1, hh = 30;
          if (drawing) {
            ctx.font = font(13); ctx.fillStyle = T["ink-2"]; ctx.fillText(clip(ctx, fmt(lab.v), w0 - 110), x0, y0 + 19);
            const bx = x0 + w0 - 96;
            const btn = (k, bxx, label, nv) => {
              const hot = st.hover === k;
              rrect(ctx, bxx + 0.5, y0 + 2.5, 26, 25); ctx.fillStyle = hot ? T["line-2"] : T.card; ctx.fill(); ctx.strokeStyle = hot ? T["ink-2"] : T.line; ctx.lineWidth = 1; ctx.stroke();
              ctx.font = font(15, true); ctx.fillStyle = T.ink; ctx.textAlign = "center"; ctx.fillText(label, bxx + 13.5, y0 + 20); ctx.textAlign = "left";
              hit(k, bxx, y0, 27, hh, "stepper", () => rt.write(appId, n.cell, Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, Math.round((nv) * 1e6) / 1e6))));
            };
            btn(key + "-", bx, "−", v - step);
            ctx.font = font(13, true); ctx.fillStyle = T.ink; ctx.textAlign = "center"; ctx.fillText(fmt(v, o), bx + 48, y0 + 19); ctx.textAlign = "left";
            btn(key + "+", bx + 70, "+", v + step);
          }
          return hh;
        }
        case "divider": {
          if (drawing) { ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Math.round(y0 + 4) + 0.5); ctx.lineTo(x0 + w0, Math.round(y0 + 4) + 0.5); ctx.stroke(); }
          return 9;
        }
        case "row": {
          const kids = n.children, k = Math.max(1, kids.length), g = 8, cw = (w0 - g * (k - 1)) / k;
          let hh = 0;
          kids.forEach((c, i) => { const r = node(c, key + "." + i, x0 + i * (cw + g), y0, cw); if (r != null) hh = Math.max(hh, r); });
          return hh;
        }
        case "when": {
          let on;
          try { on = !!n.cond(rt.scope(appId, "read", track, `This when() (line ${n.line})`)); rt.clearError("view:" + key); }
          catch (e) { rt.fail("view:" + key, e, { where: appId + ".view", line: n.line, kind: e.kind || "runtime" }); return errText(e.message, x0, y0, w0); }
          return on ? stack(n.children, key, x0, y0, w0) || null : null;
        }
        case "group": return stack(n.children, key, x0, y0, w0) || null;
      }
      return 0;
    }
    function stack(nodes, key, x0, y0, w0) {
      let yy0 = y0, first = true;
      nodes.forEach((n, i) => {
        const r = node(n, key + "." + i, x0, yy0 + (first ? 0 : GAP), w0);
        if (r == null) return;
        yy0 += (first ? 0 : GAP) + r; first = false;
      });
      return yy0 - y0;
    }
    const hh = stack(a.views, appId, x, yy, w);
    rt.noteViewReads(appId, track);
    return a.views.length ? hh : 0;
  }

  /* ---------- the canvas, sized crisply ---------- */
  class Surface {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.w = 1; this.h = 1; this.scale = 1; }
    fit(w, h) {
      const c = this.canvas, r = c.getBoundingClientRect();
      const zoom = c.offsetWidth ? r.width / c.offsetWidth : 1;
      const scale = (window.devicePixelRatio || 1) * Math.max(0.5, Math.min(4, zoom || 1));
      const bw = Math.max(1, Math.round(w * scale)), bh = Math.max(1, Math.round(h * scale));
      if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
      const css = h + "px"; if (c.style.height !== css) c.style.height = css;
      this.w = w; this.h = h; this.scale = scale;
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    point(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (this.w / (r.width || 1)), y: (e.clientY - r.top) * (this.h / (r.height || 1)) }; }
  }

  /* ---------- the Stage: desk, app or graph ---------- */
  class Stage {
    constructor(canvas, opts = {}) {
      this.s = new Surface(canvas); this.opts = opts; this.mode = opts.mode || "desk";
      this.pos = new Map(); this.manual = new Set(); this.heights = new Map(); this.off = { x: 0, y: 0 };
      this.app = new Map(); this.hits = []; this.pulses = []; this.need = true; this.contentH = 0; this.rt = null; this.unsub = null;
      this.T = null; this.tAt = 0; this.graph = null;
      const c = canvas;
      c.addEventListener("pointerdown", e => this.down(e));
      c.addEventListener("pointermove", e => this.move(e));
      c.addEventListener("pointerup", e => this.up(e));
      c.addEventListener("pointercancel", () => { this.drag = null; this.pressHit = null; this.need = true; });
      c.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = null; this.need = true; c.style.cursor = ""; this.pointerTo(null); } });
      c.addEventListener("wheel", e => { if (this.mode === "app") return; e.preventDefault(); e.stopPropagation(); this.off.x -= e.deltaX; this.off.y -= e.deltaY; this.clampOff(); this.need = true; }, { passive: false });
    }
    setRuntime(rt) {
      if (rt === this.rt) return;
      if (this.unsub) this.unsub();
      const before = this.rt ? [...this.rt.apps.keys()].join() : null;
      this.rt = rt; this.graph = null; this.need = true;
      if (!rt) return;
      if ([...rt.apps.keys()].join() !== before) { for (const k of [...this.pos.keys()]) if (!rt.apps.has(k)) { this.pos.delete(k); this.manual.delete(k); } }
      this.unsub = rt.on(ev => {
        if (ev.type !== "change" || ev.quiet) return;
        const from = ev.id.split(".")[0];
        for (const [k] of this.wires()) { const [a, b] = k.split(">"); if (a === from) this.pulses.push({ a, b, t: performance.now() }); }
        this.need = true;
      });
    }
    tidy() { this.manual.clear(); this.pos.clear(); this.off = { x: 0, y: 0 }; this.need = true; }
    theme(el) { const now = performance.now(); if (!this.T || now - this.tAt > 1000) { this.T = tokens(el); this.tAt = now; } return this.T; }
    clampOff() { this.off.x = Math.min(40, this.off.x); this.off.y = Math.min(40, this.off.y); }

    /* which apps read which: from formula deps and view reads */
    wires() {
      const rt = this.rt, m = new Map();
      if (!rt) return m;
      const add = (from, to, name) => { if (!from || from === to || !rt.apps.has(from)) return; const k = from + ">" + to; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(name); };
      for (const c of rt.cells.values()) for (const d of c.deps) if (!d.startsWith("$") && !d.startsWith("desk:")) add(d.split(".")[0], c.app, d.split(".")[1]);
      for (const [app, s] of rt.viewReads) for (const d of s) if (!d.startsWith("$") && !d.startsWith("desk:")) add(d.split(".")[0], app, d.split(".")[1]);
      return m;
    }
    stOf(id) { let st = this.app.get(id); if (!st) { st = { sparks: new Map(), hits: [], hover: null, press: null }; this.app.set(id, st); } st.hits = this.hits; st.hover = this.hover; st.press = this.pressHit && this.pressHit.key; return st; }

    layout(W) {
      const rt = this.rt, colW = 276, gap = 18;
      const cols = Math.max(1, Math.floor((W - gap) / colW)), heights = new Array(cols).fill(gap);
      for (const id of rt.apps.keys()) {
        const a = rt.apps.get(id), w = Math.min(Math.max(200, a.w), W - gap * 2);
        const span = Math.max(1, Math.min(cols, Math.round((w + gap) / colW)));
        const h = BAR + PAD * 2 + (this.heights.get(id) || 120) + gap;
        if (this.manual.has(id) && this.pos.has(id)) continue;
        let best = 0, by = Infinity;
        for (let c = 0; c + span <= cols; c++) { const y = Math.max(...heights.slice(c, c + span)); if (y < by) { by = y; best = c; } }
        this.pos.set(id, { x: gap + best * colW, y: by, w: Math.min(w, span * colW - gap) });
        for (let c = best; c < best + span; c++) heights[c] = by + h;
      }
    }

    /* draw one frame. W: css width, H: css height (null = fit content, app mode) */
    frame(el, W, H) {
      const rt = this.rt, T = this.theme(el);
      if (this.mode === "app") return this.frameApp(T, W);
      this.s.fit(W, H);
      const ctx = this.s.ctx;
      ctx.fillStyle = T.paper; ctx.fillRect(0, 0, W, H);
      // dot grid, the CC5 desk
      ctx.fillStyle = T.line; ctx.globalAlpha = 0.55;
      const ox = ((this.off.x % 22) + 22) % 22, oy = ((this.off.y % 22) + 22) % 22;
      for (let x = ox; x < W; x += 22) for (let y = oy; y < H; y += 22) ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
      this.hits = [];
      if (!rt) return;
      if (this.mode === "graph") return this.frameGraph(T, W, H);
      this.layout(W);
      ctx.save(); ctx.translate(this.off.x, this.off.y);
      // wires under windows
      const now = performance.now();
      const wires = this.wires();
      const ends = (a, b) => {
        const A = this.pos.get(a), B = this.pos.get(b); if (!A || !B) return null;
        const ay = A.y + BAR / 2, by = B.y + BAR / 2;
        const right = A.x + A.w / 2 < B.x + B.w / 2;
        const x1 = right ? A.x + A.w : A.x, x2 = right ? B.x : B.x + B.w;
        const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
        return { x1, y1: ay, x2, y2: by, c1: x1 + dx, c2: x2 - dx };
      };
      const bez = (p, t) => { const u = 1 - t; return { x: u * u * u * p.x1 + 3 * u * u * t * p.c1 + 3 * u * t * t * p.c2 + t * t * t * p.x2, y: u * u * u * p.y1 + 3 * u * u * t * p.y1 + 3 * u * t * t * p.y2 + t * t * t * p.y2 }; };
      for (const [k, names] of wires) {
        const [a, b] = k.split(">"), p = ends(a, b); if (!p) continue;
        ctx.strokeStyle = T.muted; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.bezierCurveTo(p.c1, p.y1, p.c2, p.y2, p.x2, p.y2); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = T.paper; ctx.strokeStyle = T.muted; ctx.beginPath(); ctx.arc(p.x2, p.y2, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const m = bez(p, 0.5), label = [...names].join(", ");
        ctx.font = font(10); const lw = ctx.measureText(label).width;
        ctx.fillStyle = T.paper; ctx.fillRect(m.x - lw / 2 - 4, m.y - 8, lw + 8, 14);
        ctx.fillStyle = T.muted; ctx.textAlign = "center"; ctx.fillText(label, m.x, m.y + 3); ctx.textAlign = "left";
      }
      this.pulses = this.pulses.filter(pu => now - pu.t < 650);
      for (const pu of this.pulses) {
        const p = ends(pu.a, pu.b); if (!p) continue;
        const q = bez(p, (now - pu.t) / 650);
        ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      // windows
      let bottom = 0, i = 0;
      for (const [id, a] of rt.apps) {
        const P = this.pos.get(id); if (!P) continue;
        const st = this.stOf(id);
        const ch = this.heights.get(id) || 120;
        const h = BAR + PAD + ch + PAD;
        ctx.save();
        ctx.shadowColor = T.shadow; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
        rrect(ctx, P.x, P.y, P.w, h); ctx.fillStyle = T.card; ctx.fill();
        ctx.restore();
        rrect(ctx, P.x + 0.5, P.y + 0.5, P.w - 1, h - 1); ctx.strokeStyle = this.dragId === id ? T["ink-2"] : T.line; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = T.palette[i % T.palette.length]; ctx.fillRect(P.x + PAD, P.y + 12, 6, 6);
        caps(ctx, clip(ctx, a.title, P.w - 120), P.x + PAD + 13, P.y + 19, T.ink, 10.5);
        ctx.font = font(10.5); ctx.fillStyle = T.muted; ctx.textAlign = "right"; ctx.fillText(clip(ctx, id, 90), P.x + P.w - PAD, P.y + 19); ctx.textAlign = "left";
        ctx.strokeStyle = T["line-2"]; ctx.beginPath(); ctx.moveTo(P.x + 1, P.y + BAR + 0.5); ctx.lineTo(P.x + P.w - 1, P.y + BAR + 0.5); ctx.stroke();
        this.hits.push({ key: "title:" + id, x: P.x, y: P.y, w: P.w, h: BAR, kind: "title", app: id });
        ctx.save(); ctx.beginPath(); ctx.rect(P.x, P.y + BAR, P.w, h - BAR); ctx.clip();
        const got = paintApp(ctx, T, rt, id, P.x + PAD, P.y + BAR + PAD, P.w - PAD * 2, st, true);
        ctx.restore();
        if (Math.abs(got - ch) > 0.5) { this.heights.set(id, got); this.need = true; }
        bottom = Math.max(bottom, P.y + h);
        i++;
      }
      ctx.restore();
      this.contentH = bottom;
      for (const hh of this.hits) { hh.x += this.off.x; hh.y += this.off.y; }
      return this.pulses.length > 0;
    }
    frameApp(T, W) {
      const rt = this.rt, id = this.opts.app;
      if (!rt || !rt.apps.has(id)) {
        this.s.fit(W, 40); const ctx = this.s.ctx; ctx.clearRect(0, 0, W, 40);
        ctx.font = font(12); ctx.fillStyle = T.muted; ctx.fillText(rt ? `This program has no app "${id}". Apps: ${[...rt.apps.keys()].join(", ")}.` : "Starting…", 0, 22);
        return;
      }
      const h = Math.max(20, Math.ceil(this.heights.get(id) || 120));
      this.s.fit(W, h);
      const ctx = this.s.ctx; ctx.clearRect(0, 0, W, h);
      this.hits = [];
      const got = paintApp(ctx, T, rt, id, 0, 0, W, this.stOf(id), true);
      if (Math.abs(got - h) > 0.5) { this.heights.set(id, got); this.need = true; }
    }

    /* the DAG, in layers: sources left, views right */
    frameGraph(T, W, H) {
      const rt = this.rt, ctx = this.s.ctx;
      if (!this.graph || this.graph.v !== rt.version) {
        const nodes = new Map(), edges = [];
        const add = (id, kind, extra = {}) => { if (!nodes.has(id)) nodes.set(id, Object.assign({ id, kind }, extra)); };
        for (const c of rt.cells.values()) add(c.id, c.kind, { line: c.line, cell: c });
        for (const c of rt.cells.values()) for (const d of c.deps) { add(d, d === "$clock" ? "clock" : d === "$pointer" ? "pointer" : d.startsWith("desk:") ? "desk" : "cell"); edges.push([d, c.id]); }
        for (const [app, s] of rt.viewReads) { add(app + ".view", "view", { line: rt.apps.get(app).line }); for (const d of s) { add(d, d === "$clock" ? "clock" : d === "$pointer" ? "pointer" : d.startsWith("desk:") ? "desk" : "cell"); edges.push([d, app + ".view"]); } }
        const layer = new Map(), preds = new Map();
        for (const [a, b] of edges) { if (!preds.has(b)) preds.set(b, []); preds.get(b).push(a); }
        const depth = (id, seen = new Set()) => {
          if (layer.has(id)) return layer.get(id);
          if (seen.has(id)) return 0; seen.add(id);
          const p = (preds.get(id) || []).filter(x => x !== id);
          const d = p.length ? 1 + Math.max(...p.map(x => depth(x, seen))) : 0;
          layer.set(id, d); return d;
        };
        for (const id of nodes.keys()) depth(id);
        const cols = [];
        for (const [id, n] of nodes) { const d = layer.get(id) || 0; (cols[d] = cols[d] || []).push(n); }
        const NW = 152, NH = 38, gx = 30, gy = 10;
        cols.forEach((list, ci) => { list.sort((a, b) => a.id.localeCompare(b.id)); list.forEach((n, ri) => { n.x = 20 + ci * (NW + gx); n.y = 20 + ri * (NH + gy); n.w = NW; n.h = NH; }); });
        this.graph = { v: rt.version, nodes, edges, NW, NH };
      }
      const g = this.graph;
      if (g.W == null) { let mx = 0, my = 0; for (const n of g.nodes.values()) { mx = Math.max(mx, n.x + n.w); my = Math.max(my, n.y + n.h); } g.W = mx + 20; g.H = my + 20; }
      const k = Math.max(0.75, Math.min(1, (W - 8) / g.W, (H - 28) / g.H)), over = g.W * k > W || g.H * k > H - 24;
      ctx.save(); ctx.translate(this.off.x, this.off.y); ctx.scale(k, k);
      const kindCol = { param: T.accent, value: T.ink, formula: T["ink-2"], state: T.good, view: T.you, clock: T.warn, pointer: T.p3, desk: T.p7, cell: T.muted };
      ctx.lineWidth = 1;
      for (const [a, b] of g.edges) {
        const A = g.nodes.get(a), B = g.nodes.get(b); if (!A || !B) continue;
        const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, dx = Math.max(20, (x2 - x1) / 2);
        ctx.strokeStyle = T.muted; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      let maxX = 0, maxY = 0;
      for (const n of g.nodes.values()) {
        const hot = this.hover === "node:" + n.id;
        rrect(ctx, n.x + 0.5, n.y + 0.5, n.w - 1, n.h - 1); ctx.fillStyle = T.card; ctx.fill(); ctx.strokeStyle = hot ? T.ink : T.line; ctx.stroke();
        ctx.fillStyle = kindCol[n.kind] || T.muted; ctx.fillRect(n.x, n.y, 3, n.h);
        caps(ctx, n.kind, n.x + 10, n.y + 13, kindCol[n.kind] || T.muted, 8.5);
        ctx.font = font(11.5, true); ctx.fillStyle = T.ink; ctx.fillText(clip(ctx, n.id.replace(/^desk:/, "desk."), n.w - 16), n.x + 10, n.y + 29);
        if (n.cell) {
          const c = n.cell; let v;
          if (c.kind === "formula" && c.dirty) { try { rt.read(c.id, null); } catch {} }
          v = c.error ? "⚠ error" : fmt(c.value);
          ctx.font = font(10); ctx.fillStyle = c.error ? T.bad : T.muted; ctx.textAlign = "right"; ctx.fillText(clip(ctx, v, 70), n.x + n.w - 8, n.y + 13); ctx.textAlign = "left";
        }
        this.hits.push({ key: "node:" + n.id, x: n.x * k + this.off.x, y: n.y * k + this.off.y, w: n.w * k, h: n.h * k, kind: "node", line: n.line, id: n.id });
        maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
      }
      ctx.restore();
      ctx.fillStyle = T.paper; ctx.fillRect(0, H - 24, W, 24);
      ctx.font = font(10.5); ctx.fillStyle = T.muted;
      ctx.fillText((W > 520 ? "Sources on the left, views on the right. Each line is a read. Click a node to see its line." : "Sources left, views right. Click a node for its line.") + (over ? " Drag to see more." : ""), 12, H - 8);
      this.contentH = maxY;
    }

    /* $.pointer: where the pointer is over a draw(), in that element's pixels */
    pointerTo(h, p, down) {
      const rt = this.rt; if (!rt) return;
      if (this.ptrApp && (!h || h.app !== this.ptrApp)) {
        const old = rt.pointers.get(this.ptrApp); if (old) rt.setPointer(this.ptrApp, Object.assign({}, old, { over: false, down: false }));
        this.ptrApp = null;
      }
      if (h) { rt.setPointer(h.app, { x: p.x - h.x, y: p.y - h.y, w: h.w, h: h.h, over: true, down: !!down }); this.ptrApp = h.app; }
    }
    /* pointer: buttons and toggles, window drag, pan */
    at(p) { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h; } return null; }
    down(e) {
      if (e.button !== 0) return;
      const p = this.s.point(e), h = this.at(p);
      if (h && (h.kind === "button" || h.kind === "toggle" || h.kind === "stepper")) { this.pressHit = h; this.need = true; e.stopPropagation(); this.s.canvas.setPointerCapture(e.pointerId); return; }
      if (h && h.kind === "node") { e.stopPropagation(); if (h.line && this.opts.onLine) this.opts.onLine(h.line, h.id); return; }
      if (h && h.kind === "draw") { e.stopPropagation(); e.preventDefault(); this.s.canvas.setPointerCapture(e.pointerId); this.drag = { kind: "draw", hit: h }; this.pointerTo(h, p, true); return; }
      if (this.mode === "app") return;
      e.stopPropagation(); e.preventDefault();
      this.s.canvas.setPointerCapture(e.pointerId);
      if (h && h.kind === "title") { const P = this.pos.get(h.app); this.drag = { kind: "win", id: h.app, dx: p.x - this.off.x - P.x, dy: p.y - this.off.y - P.y }; this.dragId = h.app; }
      else this.drag = { kind: "pan", x: p.x - this.off.x, y: p.y - this.off.y };
    }
    move(e) {
      const p = this.s.point(e);
      if (this.drag && this.drag.kind === "draw") { this.pointerTo(this.drag.hit, p, true); return; }
      if (this.drag) {
        if (this.drag.kind === "win") { const P = this.pos.get(this.drag.id); P.x = Math.max(0, p.x - this.off.x - this.drag.dx); P.y = Math.max(0, p.y - this.off.y - this.drag.dy); this.manual.add(this.drag.id); }
        else { this.off.x = p.x - this.drag.x; this.off.y = p.y - this.drag.y; this.clampOff(); }
        this.need = true; return;
      }
      const h = this.at(p), key = h && h.kind !== "title" && h.kind !== "draw" ? h.key : null;
      if (key !== this.hover) { this.hover = key; this.need = true; }
      this.pointerTo(h && h.kind === "draw" ? h : null, p, false);
      this.s.canvas.style.cursor = h ? (h.kind === "title" ? "grab" : h.kind === "draw" ? "crosshair" : "pointer") : this.mode === "app" ? "" : "default";
    }
    up(e) {
      if (this.pressHit) {
        const h = this.at(this.s.point(e));
        if (h && h.key === this.pressHit.key) { try { h.click(); } catch (err) { console.warn(err); } }
        this.pressHit = null; this.need = true; return;
      }
      if (this.drag && this.drag.kind === "draw") { const p = this.s.point(e), h = this.at(p); this.pointerTo(h && h.kind === "draw" ? h : null, p, false); }
      this.drag = null; this.dragId = null; this.need = true;
    }
  }
  return { Stage, Surface, tokens, fmt, paintApp, DEFAULT };
})();

/* ==========================================================================
   UI PARTS — small DOM pieces the studio is made of. No framework.
     Editor     a textarea over a highlighted <pre>, with a line-number gutter
     highlight  a JavaScript tokenizer that also knows the Spore grammar
     Markdown   the textbook renderer (headings, code, lists, tables, quotes)
     Params     controls for every .param(), grouped by app
     Errors     the error list: kind, line, where, message, fix
   ========================================================================== */
const UI = (() => {
  "use strict";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };

  /* ---------- highlighting ---------- */
  const KW = new Set("const let var function return if else for of in while do new true false null undefined this typeof class extends break continue switch case default try catch finally throw async await yield delete instanceof void".split(" "));
  const DSL = new Set(["app", "component", "range", "clamp", "lerp"]);
  const GRAMMAR = new Set(["cell", "cells", "param", "state", "action", "view", "export", "h", "text", "note", "stat", "meter", "spark", "bars", "list", "draw", "button", "toggle", "stepper", "divider", "row", "each", "when", "use", "set", "push", "inc", "get", "line", "rect", "circle", "path", "poly", "map", "clear"]);
  const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\$)|([A-Za-z_][A-Za-z0-9_]*)|(=>)|(\s+)|(.)/g;
  function tokens(src) {
    const out = []; let m, prevDot = false;
    RE.lastIndex = 0;
    while ((m = RE.exec(src))) {
      const t = m[0];
      let c = "";
      if (m[1]) c = "c"; else if (m[2]) c = "s"; else if (m[3]) c = "n"; else if (m[4]) c = "d";
      else if (m[5]) { if (KW.has(t)) c = "k"; else if (prevDot && GRAMMAR.has(t)) c = "m"; else if (prevDot) c = "pr"; else if (DSL.has(t)) c = "g"; else if (t === "Math") c = "g"; }
      else if (m[6]) c = "o";
      else if (m[8]) c = /[{}()[\]]/.test(t) ? "b" : "p";
      out.push([c, t]);
      if (!m[7]) prevDot = t === "." || (prevDot && false);
    }
    return out;
  }
  /* HTML for code, one block per line so a line can be marked */
  function highlight(src, marks = new Map()) {
    const lines = [[]];
    for (const [c, t] of tokens(src)) {
      const parts = t.split("\n");
      parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push(c ? `<span class="t-${c}">${esc(p)}</span>` : esc(p)); });
    }
    return lines.map((l, i) => `<span class="ln${marks.has(i + 1) ? " ln-" + marks.get(i + 1) : ""}">${l.join("") || " "}</span>`).join("");
  }

  /* ---------- the editor ---------- */
  class Editor {
    constructor(opts = {}) {
      this.opts = opts;
      this.root = el("div", { class: "sp-editor", id: opts.id || null });
      this.gutter = el("div", { class: "sp-gutter", "aria-hidden": "true" });
      this.pre = el("pre", { class: "sp-hl", "aria-hidden": "true" });
      this.ta = el("textarea", { class: "sp-ta", spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off", "aria-label": opts.label || "Program source, JavaScript with the Spore DSL", id: opts.id ? opts.id + "-input" : null });
      this.code = el("div", { class: "sp-code" }, this.pre, this.ta);
      this.scroll = el("div", { class: "sp-scroll" }, this.gutter, this.code);
      this.root.append(this.scroll);
      this.marks = new Map();
      this.ta.addEventListener("input", () => { this.paint(); if (opts.onInput) opts.onInput(this.ta.value); });
      this.ta.addEventListener("keydown", e => this.key(e));
      this.ta.addEventListener("pointerdown", e => e.stopPropagation());
      this.ta.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
      this.scroll.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
      this.paint();
    }
    get value() { return this.ta.value; }
    set(v, keepCaret) {
      if (v === this.ta.value) return;
      const s = this.ta.selectionStart, en = this.ta.selectionEnd;
      this.ta.value = v; this.paint();
      if (keepCaret && document.activeElement === this.ta) { this.ta.selectionStart = Math.min(s, v.length); this.ta.selectionEnd = Math.min(en, v.length); }
    }
    readonly(on) { this.ta.readOnly = !!on; this.root.classList.toggle("ro", !!on); }
    mark(marks) { this.marks = marks; this.paint(); }
    paint() {
      const v = this.ta.value;
      this.pre.innerHTML = highlight(v + (v.endsWith("\n") ? " " : ""), this.marks);
      const n = v.split("\n").length;
      if (this.gutter.childElementCount !== n || this.marksSig !== [...this.marks].join()) {
        this.marksSig = [...this.marks].join();
        let h = ""; for (let i = 1; i <= n; i++) h += `<span class="${this.marks.has(i) ? "g-" + this.marks.get(i) : ""}" data-line="${i}">${i}</span>`;
        this.gutter.innerHTML = h;
      }
    }
    goto(line) {
      const lines = this.ta.value.split("\n"); line = Math.max(1, Math.min(lines.length, line));
      let pos = 0; for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
      this.ta.focus({ preventScroll: true }); this.ta.selectionStart = this.ta.selectionEnd = pos;
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
      this.scroll.scrollTop = Math.max(0, (line - 4) * lh);
    }
    insert(text) {
      this.ta.focus();
      if (!document.execCommand || !document.execCommand("insertText", false, text)) { this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, "end"); this.ta.dispatchEvent(new Event("input")); }
    }
    key(e) {
      const ta = this.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === "s")) { e.preventDefault(); if (this.opts.onRun) this.opts.onRun(); return; }
      if (e.key === "Escape") { ta.blur(); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        if (e.shiftKey) {
          const le = v.indexOf("\n", en - 1) < 0 ? v.length : v.indexOf("\n", Math.max(s, en - 1));
          const block = v.slice(ls, le), out = block.split("\n").map(l => l.replace(/^ {1,2}/, "")).join("\n");
          ta.selectionStart = ls; ta.selectionEnd = le; this.insert(out); ta.selectionStart = ls; ta.selectionEnd = ls + out.length;
        } else if (s !== en && v.slice(s, en).includes("\n")) {
          const le = en, block = v.slice(ls, le), out = block.split("\n").map(l => "  " + l).join("\n");
          ta.selectionStart = ls; ta.selectionEnd = le; this.insert(out); ta.selectionStart = ls; ta.selectionEnd = ls + out.length;
        } else this.insert("  ");
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const ls = v.lastIndexOf("\n", s - 1) + 1, line = v.slice(ls, s), ind = /^\s*/.exec(line)[0];
        const opens = /[{([]\s*$|=>\s*$/.test(line) || /^\s*\.view\(v => v\s*$/.test(line);
        this.insert("\n" + ind + (opens ? "  " : ""));
      }
    }
  }

  /* ---------- markdown, for the book ---------- */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[([^\]]+)\]\(#([\w-]+)\)/g, '<a href="#$2" data-jump="$2">$1</a>');
  }
  const slug = s => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  function markdown(src) {
    const lines = src.replace(/\r/g, "").split("\n"), out = [], toc = [];
    let i = 0, n = 0;
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if ((m = /^```(\w*)\s*(run)?\s*$/.exec(l))) {
        const lang = m[1], run = !!m[2], buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        const code = buf.join("\n"), id = "ex-" + (++n);
        const body = lang === "js" || lang === "javascript" ? highlight(code) : esc(code);
        out.push(`<figure class="sp-ex${run ? " sp-runnable" : ""}" id="${id}"><pre class="sp-pre"><code>${body}</code></pre>${run ? `<figcaption><button type="button" class="sp-btn" data-run="${id}">Open in editor</button><span>Runnable example</span></figcaption>` : ""}</figure>`);
        if (run) out[out.length - 1] = out[out.length - 1].replace("<figure", `<figure data-code="${esc(code)}"`);
        continue;
      }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
        const lv = m[1].length, text = m[2], id = slug(text);
        if (lv === 2) toc.push({ id, text });
        out.push(`<h${lv} id="${id}">${inline(text)}</h${lv}>`); i++; continue;
      }
      if (/^\s*$/.test(l)) { i++; continue; }
      if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`); continue; }
      if (/^\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.replace(/^\||\|\s*$/g, "").split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, "|")));
        const head = cells(rows[0]), body = rows.slice(2).map(cells);
        out.push(`<div class="sp-table"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += " " + lines[i++].trim();
          items.push(`<li>${inline(item)}</li>`);
        }
        out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`); continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
    return { html: out.join("\n"), toc };
  }

  /* ---------- params ---------- */
  class Params {
    constructor(onSet) { this.onSet = onSet; this.root = el("div", { class: "sp-params", role: "group", "aria-label": "Parameters" }); this.sig = ""; this.inputs = new Map(); }
    render(rt) {
      const ps = rt ? rt.params() : [];
      const sig = ps.map(p => p.id + ":" + p.control.type + ":" + (p.control.options || []).join("/") + ":" + p.control.min + ":" + p.control.max).join("|");
      if (sig === this.sig) return this.sync(rt);
      this.sig = sig; this.root.textContent = ""; this.inputs.clear();
      if (!ps.length) { this.root.append(el("p", { class: "sp-empty" }, "No parameters yet. ", el("code", {}, '.param("rate", 120, { min: 40, max: 400 })'), " makes a slider here.")); return; }
      const byApp = new Map(); for (const p of ps) { if (!byApp.has(p.app)) byApp.set(p.app, []); byApp.get(p.app).push(p); }
      for (const [app, list] of byApp) {
        const g = el("fieldset", { class: "sp-pgroup" }, el("legend", {}, rt.apps.get(app).title));
        for (const p of list) {
          const id = "sp-p-" + p.id.replace(/\W/g, "_") + "-" + Math.random().toString(36).slice(2, 6), c = p.control;
          let input, out = null;
          if (c.type === "range") {
            input = el("input", { type: "range", id, min: c.min, max: c.max, step: c.step, value: p.value });
            out = el("output", { for: id }, fmtP(p.value, c));
            input.addEventListener("input", () => { out.textContent = fmtP(Number(input.value), c); this.onSet(p.id, Number(input.value)); });
            g.append(el("div", { class: "sp-pf" }, el("div", { class: "sp-pl" }, el("label", { for: id }, c.label), out), input));
          } else if (c.type === "checkbox") {
            input = el("input", { type: "checkbox", id }); input.checked = !!p.value;
            input.addEventListener("change", () => this.onSet(p.id, input.checked));
            g.append(el("div", { class: "sp-pf sp-pc" }, input, el("label", { for: id }, c.label)));
          } else if (c.type === "select") {
            input = el("select", { id }, c.options.map(o => el("option", { value: o }, o))); input.value = p.value;
            input.addEventListener("change", () => this.onSet(p.id, input.value));
            g.append(el("div", { class: "sp-pf" }, el("label", { for: id }, c.label), input));
          } else {
            input = el("input", { type: "text", id, value: p.value });
            input.addEventListener("input", () => this.onSet(p.id, input.value));
            g.append(el("div", { class: "sp-pf" }, el("label", { for: id }, c.label), input));
          }
          input.dataset.param = p.id;
          this.inputs.set(p.id, { input, out, c });
        }
        this.root.append(g);
      }
    }
    sync(rt) {
      if (!rt) return;
      for (const p of rt.params()) {
        const r = this.inputs.get(p.id); if (!r || document.activeElement === r.input) continue;
        if (r.c.type === "checkbox") r.input.checked = !!p.value;
        else if (String(r.input.value) !== String(p.value)) r.input.value = p.value;
        if (r.out) r.out.textContent = fmtP(p.value, r.c);
      }
    }
  }
  const fmtP = (v, c) => Paint.fmt(Number(v), { digits: c.step < 1 ? Math.min(3, String(c.step).split(".")[1]?.length || 2) : 0 }) + (c.unit ? " " + c.unit : "");

  /* ---------- errors ---------- */
  function errors(list, onLine) {
    const root = el("ol", { class: "sp-errors", "aria-label": "Errors" });
    for (const e of list) {
      const li = el("li", { class: "sp-err", "data-kind": e.kind },
        el("span", { class: "sp-err-k" }, e.kind),
        e.line ? el("button", { type: "button", class: "sp-err-l", onclick: () => onLine(e.line), title: "Show line " + e.line }, "Line " + e.line) : null,
        e.where ? el("code", { class: "sp-err-w" }, e.where) : null,
        el("span", { class: "sp-err-m" }, e.message),
        e.hint ? el("span", { class: "sp-err-h" }, e.hint) : null);
      root.append(li);
    }
    return root;
  }
  return { el, esc, highlight, tokens, Editor, markdown, Params, errors, slug };
})();

/* ==========================================================================
   AGENT — the coding agent's model access. Three providers, tried in order:
     builtin    Claude inside the artifact (the `sample` capability). No setup.
     anthropic  the Anthropic Messages API: key and model in settings, plain fetch.
     openai     any OpenAI-compatible /chat/completions: base URL, key, model.
   complete() tries the preferred provider, then falls back to the next one
   that is set up, and says which model answered.
   ========================================================================== */
const Agent = (() => {
  "use strict";
  const STORE = "spore.agent.v1";
  const DEFAULTS = { prefer: "auto", anthropic: { key: "", model: "claude-sonnet-5-5" }, openai: { base: "https://api.openai.com/v1", key: "", model: "" } };
  let settings = load();
  let sampleSource = () => null;
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s) return { prefer: s.prefer || "auto", anthropic: Object.assign({}, DEFAULTS.anthropic, s.anthropic), openai: Object.assign({}, DEFAULTS.openai, s.openai) }; } catch {}
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save(s) { settings = s; try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} }

  const P = {
    builtin: {
      id: "builtin", label: "Claude, built in",
      ready: () => !!sampleSource(),
      model: () => "Claude",
      async call(system, turns, { onText, signal }) {
        const sample = sampleSource();
        if (!sample) throw Object.assign(new Error("Claude is only built in when this page runs inside Claude."), { code: "unavailable" });
        const msgs = turns.map((t, i) => ({ role: t.role, content: i === 0 ? system + "\n\n" + t.content : t.content }));
        const r = await sample(msgs, { cache: false, modelTier: "default", signal, onText: onText ? ({ text }) => { if (text && text !== "Thinking...") onText(text); } : undefined });
        return r.text;
      },
    },
    anthropic: {
      id: "anthropic", label: "Anthropic API",
      ready: () => !!settings.anthropic.key,
      model: () => settings.anthropic.model || DEFAULTS.anthropic.model,
      async call(system, turns, { signal }) {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "content-type": "application/json", "x-api-key": settings.anthropic.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: this.model(), max_tokens: 8000, system, messages: turns }),
        });
        if (!r.ok) throw Object.assign(new Error(`Anthropic API answered ${r.status}: ${(await r.text()).slice(0, 240)}`), { code: "http_" + r.status });
        const j = await r.json();
        return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      },
    },
    openai: {
      id: "openai", label: "OpenAI-compatible",
      ready: () => !!(settings.openai.base && settings.openai.model),
      model: () => settings.openai.model,
      async call(system, turns, { signal }) {
        const url = settings.openai.base.replace(/\/+$/, "") + "/chat/completions";
        const headers = { "content-type": "application/json" };
        if (settings.openai.key) headers.authorization = "Bearer " + settings.openai.key;
        const r = await fetch(url, { method: "POST", signal, headers, body: JSON.stringify({ model: this.model(), messages: [{ role: "system", content: system }, ...turns] }) });
        if (!r.ok) throw Object.assign(new Error(`${url} answered ${r.status}: ${(await r.text()).slice(0, 240)}`), { code: "http_" + r.status });
        const j = await r.json();
        return ((j.choices || [])[0] || {}).message?.content || "";
      },
    },
  };
  const ORDER = ["builtin", "anthropic", "openai"];
  function order() {
    const first = settings.prefer !== "auto" && P[settings.prefer] ? [settings.prefer] : [];
    return [...first, ...ORDER.filter(x => !first.includes(x))].map(x => P[x]).filter(p => p.ready());
  }
  function active() { const p = order()[0]; return p ? { id: p.id, label: p.label, model: p.model() } : null; }

  /* ask the first provider that answers; notes say what fell through */
  async function complete(system, turns, opts = {}) {
    const notes = [], list = order();
    if (!list.length) throw Object.assign(new Error("No model is set up. Open this page inside Claude to use Claude built in, or add an Anthropic key or an OpenAI-compatible endpoint in Settings."), { code: "no_model" });
    for (const p of list) {
      try {
        const text = await p.call(system, turns, opts);
        return { text, provider: { id: p.id, label: p.label, model: p.model() }, notes };
      } catch (e) {
        if (opts.signal && opts.signal.aborted) throw Object.assign(new Error("Stopped."), { code: "cancelled" });
        if (e && (e.code === "cancelled" || e.name === "AbortError")) throw e;
        notes.push(`${p.label} did not answer (${e && (e.code || e.message) || "error"}).`);
      }
    }
    throw Object.assign(new Error(notes.join(" ") + " No model answered."), { code: "all_failed" });
  }
  /* the program in a reply: the last fenced JavaScript block */
  function extract(text) {
    const re = /```(?:js|javascript)?\s*\n([\s\S]*?)```/g; let m, last = null;
    while ((m = re.exec(text))) last = m[1];
    return last ? last.replace(/\s+$/, "") + "\n" : null;
  }
  return { P, order, active, complete, extract, settings: () => settings, save, setSample: fn => { sampleSource = fn; }, DEFAULTS };
})();

/* ==========================================================================
   HOST — Spore inside CC5.
     Program   one program text, its runtime, its errors. Shared by every view
               that shows the same code cell, so an edit anywhere runs everywhere.
     Loop      one requestAnimationFrame for every live view.
     RunView   the `spore` element: a program's apps on a canvas (+ parameters).
     Studio    the `spore_ide` element: editor, preview, parameters, errors, IR,
               graph, the coding agent and the textbook.
     Bridge    the desk around a program: $.desk reads, $.set("desk.…") writes,
               .export() writes app.out.<sporeApp>.<cell> back to the desk.
     API       window.spore — load, run, getIR, setParam and more.
   ========================================================================== */
const Host = (() => {
  "use strict";
  const { el } = UI;
  let X = null;                 // CC5's Host, once CC5 boots
  const CC5_RESERVED = new Set(["desk", "sys", "clock", "spaces", "theme", "fn", "lib"]);
  const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "main";

  /* ---------- the desk bridge ---------- */
  function clean(v, d = 0) {
    const H = window.Hypha;
    if (H && (H.isRes(v) || H.isErr(v))) return undefined;
    if (d > 6 || v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(x => clean(x, d + 1));
    const o = {}; for (const k of Object.keys(v)) o[k] = clean(v[k], d + 1); return o;
  }
  const Bridge = {
    get() {
      if (!X) return null;
      const K = () => X.K();
      return {
        exists: p => K().exists(p),
        apps: () => K().children("").filter(s => !CC5_RESERVED.has(s) && !K().cells.has(s)),
        children: a => K().children(a).filter(c => c !== "ui"),
        read: p => clean(K().valueAt(p)),
        version: () => K().log.length + ":" + Math.floor(Date.now() / 1000),
        write: (p, v) => X.writeText(`${p} = ${window.Hypha.showLit(v)}`),
      };
    },
  };

  /* ---------- a program: code, runtime, errors ---------- */
  const Registry = new Map();
  let activeKey = null;
  class Program {
    constructor(key, path) {
      this.key = key; this.path = path; this.host = path ? path.split(".")[0] : null;
      this.code = null; this.rt = null; this.buildError = null; this.playing = true; this.auto = true;
      this.subs = new Set(); this.timer = 0; this.pending = false; this.writeTimer = 0; this.writer = null;
      this.exported = new Map(); this.expAt = 0;
    }
    on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    emit(type, data) { for (const f of this.subs) { try { f(type, data); } catch (e) { console.error(e); } } }
    /* the code changed outside: in the tree, or from the API */
    sync(code) {
      if (this.pending || code === this.code) return;
      const first = this.code === null;
      this.code = code; this.emit("code", { code, remote: true });
      if (first) this.rebuild(); else this.schedule(240);
    }
    /* the code changed here: the editor, a preset, the agent */
    edit(code, opts = {}) {
      if (code === this.code && !opts.now) return;
      this.code = code; this.emit("code", { code, by: opts.by });
      if (this.writer) {
        this.pending = true; clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => { this.pending = false; try { this.writer(this.code); } catch (e) { console.warn(e); } }, opts.now ? 0 : 450);
      }
      if (opts.now) this.rebuild(); else if (this.auto) this.schedule(320);
    }
    schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.rebuild(), ms); }
    rebuild() {
      clearTimeout(this.timer);
      const old = this.rt;
      try {
        const rt = Spore.load(this.code || "", { bridge: Bridge.get() });
        rt.carry(old);
        rt.on(ev => this.emit(ev.type, ev));
        this.rt = rt; this.buildError = null;
        if (old) old.listeners.clear();
      } catch (e) {
        this.buildError = { kind: e.kind || "build", message: e.message, line: e.line || null, hint: e.hint || null, where: e.where || null };
      }
      this.emit("run", { ok: !this.buildError });
      Loop.wake();
    }
    errors() {
      const out = [];
      if (this.buildError) out.push(this.buildError);
      if (this.rt) for (const { key, ...e } of this.rt.errors.values()) out.push(e);
      return out;
    }
    ir() {
      const base = this.rt ? this.rt.ir() : { spore: 1, apps: [], nodes: [], edges: [], errors: [] };
      if (this.buildError) { base.buildError = this.buildError; base.note = "The program does not build. This IR is from the last version that did."; }
      base.source = this.path ? `the CC5 cell ${this.path}` : this.key;
      return base;
    }
    /* .export(): a few values back to the desk, at most every two seconds */
    exportTick(now) {
      if (!X || !this.host || !this.rt || X.readonly() || X.past() || now - this.expAt < 2000) return;
      this.expAt = now;
      let list; try { list = this.rt.exportsNow(); } catch { return; }
      const lines = [];
      for (const { app, name, value } of list) {
        let v = value;
        if (typeof v === "number") v = Number(v.toPrecision(6));
        if (v !== null && typeof v === "object" && JSON.stringify(v).length > 4000) continue;
        if (v === undefined) continue;
        const k = app + "." + name, lit = window.Hypha.showLit(v);
        if (this.exported.get(k) === lit) continue;
        this.exported.set(k, lit); lines.push(`${this.host}.out.${app}.${name} = ${lit}`);
      }
      if (lines.length) X.write(lines.join("\n"), "spore");
    }
  }
  function program(key, path) {
    let p = Registry.get(key);
    if (!p) { p = new Program(key, path); Registry.set(key, p); if (!activeKey) activeKey = key; }
    return p;
  }

  /* ---------- one loop for every view ---------- */
  const Loop = {
    views: new Set(), raf: 0, last: 0,
    add(v) { this.views.add(v); this.wake(); },
    wake() { if (!this.raf) this.raf = requestAnimationFrame(t => this.tick(t)); },
    tick(now) {
      this.raf = 0;
      const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60; this.last = now;
      const live = [];
      for (const v of this.views) { if (v.alive()) { live.push(v); v.goneAt = 0; } else if (!v.goneAt) v.goneAt = now; else if (now - v.goneAt > 30000) { this.views.delete(v); v.dispose && v.dispose(); } }
      const progs = new Set(live.map(v => v.prog));
      for (const p of progs) {
        const rt = p.rt; if (!rt) continue;
        try { rt.syncDesk(); } catch (e) { console.warn(e); }
        if (p.playing && rt.ticking()) rt.tick(dt);
        p.exportTick(now);
      }
      for (const v of live) { try { v.frame(now); } catch (e) { console.error(e); } }
      if (live.length || this.views.size) this.wake(); else this.last = 0;
    },
  };

  /* ---------- the `spore` element: a program's apps, live ---------- */
  class RunView {
    constructor(prog, o) {
      this.prog = prog; this.o = o;
      this.canvas = el("canvas", { class: "sp-canvas", role: "img", "aria-label": "Spore apps, live" });
      this.params = new UI.Params((id, v) => this.setParam(id, v));
      this.err = el("div", { class: "sp-run-err", role: "status", hidden: true });
      this.root = el("div", { class: "sp-root sp-run" }, el("div", { class: "sp-run-stage" }, this.canvas), this.err, this.params.root);
      this.stage = new Paint.Stage(this.canvas, { mode: o.app ? "app" : "desk", app: o.app });
      this.v = -1; this.at = 0; this.errSig = "";
      this.unsub = prog.on(type => { if (type === "run" || type === "errors" || type === "change") this.stage.need = true; });
      Loop.add(this);
    }
    update(o) { this.o = o; this.stage.mode = o.app ? "app" : "desk"; this.stage.opts.app = o.app; this.stage.need = true; }
    setParam(id, v) { try { this.prog.rt.setParam(id, v); } catch (e) { console.warn(e); } }
    alive() { return this.root.isConnected; }
    dispose() { this.unsub(); }
    frame(now) {
      const rt = this.prog.rt, st = this.stage;
      st.setRuntime(rt);
      const ticking = rt && this.prog.playing && rt.ticking();
      if (!(st.need || ticking || (rt && rt.version !== this.v) || now - this.at > 1000 || st.pulses.length)) return;
      this.at = now; st.need = false; this.v = rt ? rt.version : -1;
      const W = Math.max(120, this.root.clientWidth || 300);
      const H = this.o.app ? null : (typeof this.o.h === "number" ? this.o.h : Math.max(240, Math.min(720, (st.contentH || 380) + 24)));
      st.frame(this.root, W, H);
      if (this.o.params !== false) this.params.render(this.o.app && rt ? Object.assign(Object.create(rt), { params: () => rt.params().filter(p => p.app === this.o.app) }) : rt);
      this.params.root.hidden = this.o.params === false || !rt || !(this.o.app ? rt.params().some(p => p.app === this.o.app) : rt.params().length);
      const errs = this.prog.errors(), sig = errs.map(e => e.line + e.message).join("|");
      if (sig !== this.errSig) { this.errSig = sig; this.err.hidden = !errs.length; this.err.textContent = errs.length ? `${errs.length} error${errs.length > 1 ? "s" : ""} · ${errs[0].line ? "line " + errs[0].line + ": " : ""}${errs[0].message}` : ""; }
    }
  }

  /* ---------- the studio ---------- */
  const SYSTEM = `You are the coding agent of the Spore studio inside CC5, a desktop of live apps. You write and edit programs in Spore, a small JavaScript DSL. The textbook below is your complete reference: use only the grammar it teaches. The person sees your program run live next to the editor, and every error you cause shows up there.

How to answer:
- To build or change something: one or two plain sentences on what you did, then the COMPLETE program in one \`\`\`js block. Never a fragment or a diff. Nothing after the block.
- To answer a question about the program or the DSL: plain prose. Add a code block only when you change the program.
- Keep what the person built unless they ask you to remove it. Keep cell and param names stable, so values they set survive the edit.
- Data slots take a cell name ("total", "food.total") or a runtime lambda ($ => …). Only actions write ($.set, $.push, $.toggle, $.inc). Build-time code (view, row, each, components, plain loops) runs once.
- Make apps good to use: params for anything worth tuning, real units, real example content, clear titles.`;
  const SUGGEST = ["A pomodoro timer with a 25-minute focus block", "Bouncing balls with gravity and a slider for bounce", "Split a dinner bill between friends", "Explain what this program does"];

  class Studio {
    constructor(prog, o = {}) {
      this.prog = prog; this.o = o; this.px = "spore-" + slug(prog.key);
      this.tab = "preview"; this.side = "chat"; this.mode = "desk"; this.size = "wide";
      this.history = []; this.turns = []; this.busy = false; this.loads = [];
      this.build();
      this.unsub = prog.on((type, data) => this.onProgram(type, data));
      if (prog.code != null) this.editor.set(prog.code);
      Loop.add(this);
      this.v = -1; this.at = 0; this.errSig = null;
    }
    id(s) { return this.px + "-" + s; }
    build() {
      const id = s => this.id(s);
      const tabBtn = (k, label) => el("button", { type: "button", role: "tab", id: id("tab-" + k), "aria-controls": id(k), "data-tab": k, onclick: () => this.show(k) }, label);
      this.fullBtn = el("button", { type: "button", class: "sp-full", id: id("full"), "aria-pressed": "false", title: "Full screen (Esc closes)", onclick: () => this.full(!this.isFull) }, "Full screen");
      this.tabs = el("nav", { class: "sp-tabs", role: "tablist", "aria-label": "Studio panels", id: id("tabs") }, tabBtn("code", "Code"), tabBtn("preview", "Preview"), tabBtn("chat", "Agent"), tabBtn("book", "Book"), this.fullBtn);
      this.cta = el("button", { type: "button", class: "sp-cta", id: id("cta"), hidden: true, onclick: () => this.full(true) }, "Open the studio full screen");

      // CODE
      this.presets = el("select", { id: id("presets"), "aria-label": "Load an example program", onchange: e => { const p = PRESETS.find(x => x.id === e.target.value); e.target.value = ""; if (p) this.load(p.code, "example " + p.title); } },
        el("option", { value: "" }, "Examples…"), PRESETS.map(p => el("option", { value: p.id }, p.title)));
      this.runBtn = el("button", { type: "button", class: "sp-btn sp-primary", id: id("run"), title: "Run (⌘/Ctrl + Enter)", onclick: () => this.prog.edit(this.editor.value, { now: true }) }, "Run");
      this.autoBox = el("input", { type: "checkbox", id: id("auto"), checked: true, onchange: e => { this.prog.auto = e.target.checked; } });
      this.revertBtn = el("button", { type: "button", class: "sp-btn", id: id("revert"), hidden: true, onclick: () => this.revert() }, "Undo load");
      this.editor = new UI.Editor({ id: id("editor"), onInput: v => this.prog.edit(v), onRun: () => this.prog.edit(this.editor.value, { now: true }) });
      this.status = el("p", { class: "sp-status", id: id("status"), role: "status", "aria-live": "polite" });
      this.errBox = el("div", { class: "sp-errbox", id: id("errors"), role: "region", "aria-label": "Errors" });
      const code = el("section", { class: "sp-panel sp-p-code", id: id("code"), role: "tabpanel", "aria-labelledby": id("tab-code") },
        el("header", { class: "sp-ph" }, el("h2", {}, "Code"), el("div", { class: "sp-tools" }, this.presets, this.revertBtn, el("label", { class: "sp-check", for: id("auto") }, this.autoBox, "Auto"), this.runBtn)),
        this.editor.root, this.status, this.errBox);

      // PREVIEW
      const seg = (k, label) => el("button", { type: "button", role: "radio", "aria-checked": k === this.mode ? "true" : "false", "data-mode": k, onclick: () => this.setMode(k) }, label);
      this.modeSeg = el("div", { class: "sp-seg", role: "radiogroup", "aria-label": "Preview shows", id: id("mode") }, seg("desk", "Desk"), seg("graph", "Graph"), seg("ir", "IR"));
      this.playBtn = el("button", { type: "button", class: "sp-btn", id: id("play"), onclick: () => { this.prog.playing = !this.prog.playing; this.syncPlay(); } }, "Pause");
      this.stepBtn = el("button", { type: "button", class: "sp-btn", id: id("step"), title: "One tick", onclick: () => { if (this.prog.rt) { this.prog.rt.tick(1 / 30); this.stage.need = true; } } }, "Step");
      this.resetBtn = el("button", { type: "button", class: "sp-btn", id: id("reset"), title: "Restart time and states", onclick: () => { if (this.prog.rt) { this.prog.rt.reset(); this.stage.app.clear(); this.stage.need = true; } } }, "Reset");
      this.tidyBtn = el("button", { type: "button", class: "sp-btn", id: id("tidy"), title: "Lay the windows out again", onclick: () => this.stage.tidy() }, "Tidy");
      this.canvas = el("canvas", { class: "sp-canvas", id: id("canvas"), role: "img", "aria-label": "The program's apps, live. Switch to IR for the same program as JSON." });
      this.irPre = el("pre", { class: "sp-ir", id: id("ir"), tabindex: "0", "aria-label": "The program's IR as JSON" });
      this.irCopy = el("button", { type: "button", class: "sp-btn", id: id("ir-copy"), onclick: () => this.copyIR() }, "Copy JSON");
      this.irWrap = el("div", { class: "sp-irwrap", hidden: true }, el("div", { class: "sp-irbar" }, el("span", {}, "The whole program as data: apps, cells, views, the DAG's edges and its order."), this.irCopy), this.irPre);
      this.stageWrap = el("div", { class: "sp-stagewrap" }, this.canvas, this.irWrap);
      this.params = new UI.Params((pid, v) => { try { this.prog.rt.setParam(pid, v); } catch (e) { console.warn(e); } });
      const preview = el("section", { class: "sp-panel sp-p-preview", id: id("preview"), role: "tabpanel", "aria-labelledby": id("tab-preview") },
        el("header", { class: "sp-ph" }, el("h2", {}, "Preview"), el("div", { class: "sp-tools" }, this.modeSeg, this.playBtn, this.stepBtn, this.resetBtn, this.tidyBtn)),
        el("div", { class: "sp-prevbody" }, this.stageWrap, el("aside", { class: "sp-paramwrap", id: id("params"), "aria-label": "Parameters" }, el("h3", {}, "Parameters"), this.params.root)));
      this.stage = new Paint.Stage(this.canvas, { mode: "desk", onLine: line => { this.show("code"); this.editor.goto(line); } });

      // AGENT
      this.chip = el("button", { type: "button", class: "sp-chip", id: id("model"), "aria-expanded": "false", "aria-controls": id("settings"), onclick: () => this.toggleSettings() });
      this.log = el("ol", { class: "sp-log", id: id("log"), "aria-live": "polite", "aria-label": "Conversation with the coding agent" });
      this.sugg = el("div", { class: "sp-sugg", id: id("suggest") }, SUGGEST.map(s => el("button", { type: "button", class: "sp-pill", onclick: () => this.send(s) }, s)));
      this.ask = el("textarea", { id: id("ask"), rows: 2, class: "sp-input", placeholder: "Ask for an app, a change, or an explanation", "aria-label": "Message to the coding agent",
        onkeydown: e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(this.ask.value); } } });
      this.sendBtn = el("button", { type: "button", class: "sp-btn sp-primary", id: id("send"), onclick: () => this.send(this.ask.value) }, "Send");
      this.stopBtn = el("button", { type: "button", class: "sp-btn", id: id("stop"), hidden: true, onclick: () => this.ctl && this.ctl.abort() }, "Stop");
      this.settings = this.buildSettings();
      const chat = el("section", { class: "sp-panel sp-p-chat", id: id("chat"), role: "tabpanel", "aria-labelledby": id("tab-chat") },
        el("header", { class: "sp-ph" }, el("h2", {}, "Agent"), el("div", { class: "sp-tools" }, this.chip)),
        this.settings, el("div", { class: "sp-logwrap" }, this.log, this.sugg),
        el("form", { class: "sp-composer", onsubmit: e => { e.preventDefault(); this.send(this.ask.value); } }, this.ask, el("div", { class: "sp-tools" }, this.stopBtn, this.sendBtn)));

      // BOOK
      this.toc = el("nav", { class: "sp-toc", id: id("toc"), "aria-label": "Chapters" });
      this.article = el("article", { class: "sp-article", id: id("article") });
      const book = el("section", { class: "sp-panel sp-p-book", id: id("book"), role: "tabpanel", "aria-labelledby": id("tab-book") },
        el("header", { class: "sp-ph" }, el("h2", {}, "Book"), el("div", { class: "sp-tools" }, el("span", { class: "sp-quiet" }, "The textbook is also the agent's reference."))),
        el("div", { class: "sp-bookbody" }, this.toc, this.article));
      this.article.addEventListener("click", e => {
        const b = e.target.closest("[data-run]"); if (b) { const fig = b.closest("figure"); this.load(fig.dataset.code + "\n", "example from the book"); this.show(this.size === "narrow" ? "preview" : "code"); return; }
        const a = e.target.closest("a[data-jump]"); if (a) { e.preventDefault(); this.jump(a.dataset.jump); }
      });
      this.toc.addEventListener("click", e => { const a = e.target.closest("a[data-jump]"); if (a) { e.preventDefault(); this.jump(a.dataset.jump); } });

      this.panels = { code, preview, chat, book };
      this.root = el("div", { class: "sp-root sp-studio", id: this.px, "data-size": "wide", role: "region", "aria-label": "Spore studio" }, this.tabs, code, preview, chat, book, this.cta);
      ["pointerdown", "wheel", "keydown"].forEach(t => this.root.addEventListener(t, e => { if (t !== "keydown" || e.target.closest("textarea, input, select")) e.stopPropagation(); activeKey = this.prog.key; }, t === "wheel" ? { passive: true } : undefined));
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.root);
      this.syncChip(); this.syncPlay(); this.layout();
    }
    buildSettings() {
      const id = s => this.id(s), s = Agent.settings();
      const f = (label, inputId, input, help) => el("div", { class: "sp-pf" }, el("label", { for: inputId }, label), input, help ? el("small", {}, help) : null);
      this.setPrefer = el("select", { id: id("prefer") }, [["auto", "Automatic: Claude built in first"], ["builtin", "Claude, built in"], ["anthropic", "Anthropic API"], ["openai", "OpenAI-compatible"]].map(([v, l]) => el("option", { value: v }, l)));
      this.setPrefer.value = s.prefer;
      this.setAKey = el("input", { id: id("a-key"), type: "password", autocomplete: "off", value: s.anthropic.key, placeholder: "sk-ant-…" });
      this.setAModel = el("input", { id: id("a-model"), type: "text", value: s.anthropic.model });
      this.setOBase = el("input", { id: id("o-base"), type: "url", value: s.openai.base });
      this.setOKey = el("input", { id: id("o-key"), type: "password", autocomplete: "off", value: s.openai.key });
      this.setOModel = el("input", { id: id("o-model"), type: "text", value: s.openai.model, placeholder: "e.g. gpt-4.1 or llama3" });
      const save = () => { Agent.save({ prefer: this.setPrefer.value, anthropic: { key: this.setAKey.value.trim(), model: this.setAModel.value.trim() || Agent.DEFAULTS.anthropic.model }, openai: { base: this.setOBase.value.trim(), key: this.setOKey.value.trim(), model: this.setOModel.value.trim() } }); this.syncChip(); this.toggleSettings(false); };
      return el("form", { class: "sp-settings", id: id("settings"), hidden: true, "aria-label": "Model settings", onsubmit: e => { e.preventDefault(); save(); } },
        f("Use", id("prefer"), this.setPrefer, "If the first choice does not answer, the next one that is set up takes over."),
        el("fieldset", {}, el("legend", {}, "Anthropic API"), f("API key", id("a-key"), this.setAKey), f("Model", id("a-model"), this.setAModel)),
        el("fieldset", {}, el("legend", {}, "OpenAI-compatible endpoint"), f("Base URL", id("o-base"), this.setOBase), f("API key", id("o-key"), this.setOKey, "Leave empty for local servers that need none."), f("Model", id("o-model"), this.setOModel)),
        el("p", { class: "sp-quiet" }, "Keys stay in this browser. Inside Claude the page cannot reach other servers, so direct API calls work when this page runs outside Claude."),
        el("div", { class: "sp-tools" }, el("button", { type: "button", class: "sp-btn", onclick: () => this.toggleSettings(false) }, "Cancel"), el("button", { type: "submit", class: "sp-btn sp-primary" }, "Save")));
    }
    /* full screen: the studio leaves its window for the whole page, at 1:1 */
    full(on) {
      if (on === this.isFull) return;
      this.isFull = on;
      if (on) {
        this.home = this.root.parentNode; this.homeH = this.root.style.height;
        this.overlay = el("div", { class: "sp-root sp-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Spore studio, full screen",
          onkeydown: e => { if (e.key === "Escape" && !e.target.closest("textarea, input, select")) { e.stopPropagation(); this.full(false); } } });
        document.body.append(this.overlay); this.overlay.append(this.root);
        this.root.classList.add("is-full"); this.root.style.height = "100%";
        this.fullBtn.textContent = "Close"; this.fullBtn.setAttribute("aria-pressed", "true"); this.fullBtn.focus({ preventScroll: true });
      } else {
        if (this.home && this.home.isConnected) this.home.append(this.root);
        this.root.classList.remove("is-full"); this.root.style.height = this.homeH || "";
        if (this.overlay) this.overlay.remove(); this.overlay = null;
        this.fullBtn.textContent = "Full screen"; this.fullBtn.setAttribute("aria-pressed", "false");
      }
      this.resize(); this.stage.need = true;
    }
    toggleSettings(on = this.settings.hidden) { this.settings.hidden = !on; this.chip.setAttribute("aria-expanded", on ? "true" : "false"); }
    syncChip() {
      const a = Agent.active();
      this.chip.innerHTML = "";
      this.chip.append(el("span", { class: "sp-dot" + (a ? " sp-on" : "") }), a ? (a.id === "builtin" ? a.label : `${a.label} · ${a.model}`) : "No model set up");
      this.chip.title = "Model settings";
    }
    syncPlay() { this.playBtn.textContent = this.prog.playing ? "Pause" : "Play"; this.playBtn.setAttribute("aria-pressed", this.prog.playing ? "false" : "true"); }

    /* ---------- layout: wide, medium, narrow, from the studio's own width ---------- */
    resize() { const w = this.root.clientWidth; const size = w >= 1240 ? "wide" : w >= 660 ? "medium" : "narrow"; if (size !== this.size) { this.size = size; this.layout(); } this.stage.need = true; }
    show(k) { if (k === "chat" || k === "book") this.side = k; this.tab = k; this.layout(); if (k === "book") this.renderBook(); if (k === "chat") setTimeout(() => this.ask.focus({ preventScroll: true }), 0); }
    visible() {
      if (this.size === "wide") return ["code", "preview", this.side];
      if (this.size === "medium") return ["code", this.tab === "code" ? "preview" : this.tab];
      return [this.tab];
    }
    layout() {
      this.root.dataset.size = this.size;
      const vis = this.visible();
      for (const [k, p] of Object.entries(this.panels)) p.hidden = !vis.includes(k);
      for (const b of this.tabs.querySelectorAll("[data-tab]")) {
        const k = b.dataset.tab, shown = this.size === "wide" ? k === "chat" || k === "book" : this.size === "medium" ? k !== "code" : true;
        b.hidden = !shown; b.setAttribute("aria-selected", vis.includes(k) && shown ? "true" : "false"); b.tabIndex = vis.includes(k) ? 0 : -1;
      }
      if (vis.includes("book")) this.renderBook();
      this.stage.need = true;
    }
    setMode(k) {
      this.mode = k;
      for (const b of this.modeSeg.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", b.dataset.mode === k ? "true" : "false");
      this.canvas.hidden = k === "ir"; this.irWrap.hidden = k !== "ir";
      if (k !== "ir") { this.stage.mode = k; this.stage.off = { x: 0, y: 0 }; this.stage.need = true; } else this.renderIR();
    }
    renderIR() { try { this.irPre.textContent = JSON.stringify(this.prog.ir(), null, 2); } catch (e) { this.irPre.textContent = "Could not serialise the IR: " + e.message; } }
    copyIR() {
      const t = this.irPre.textContent;
      navigator.clipboard.writeText(t).then(() => { this.irCopy.textContent = "Copied"; setTimeout(() => (this.irCopy.textContent = "Copy JSON"), 1200); }, () => { const r = document.createRange(); r.selectNodeContents(this.irPre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.irCopy.textContent = "Selected: press ⌘C"; });
    }

    /* ---------- code ---------- */
    load(code, by) {
      this.loads.push(this.prog.code || ""); if (this.loads.length > 20) this.loads.shift();
      this.revertBtn.hidden = false; this.revertBtn.title = "Back to the program before the " + by;
      this.editor.set(code); this.prog.edit(code, { now: true, by });
    }
    revert() { const c = this.loads.pop(); if (c != null) { this.editor.set(c); this.prog.edit(c, { now: true, by: "undo" }); } this.revertBtn.hidden = !this.loads.length; }
    onProgram(type, data) {
      if (type === "code" && data.remote) this.editor.set(data.code, true);
      if (type === "run" || type === "errors") { this.errSig = null; this.stage.need = true; }
      if (type === "change") this.stage.need = true;
    }
    renderErrors() {
      const errs = this.prog.errors(), sig = JSON.stringify(errs);
      if (sig === this.errSig) return;
      this.errSig = sig;
      const marks = new Map(); for (const e of errs) if (e.line) marks.set(e.line, "err");
      this.editor.mark(marks);
      this.errBox.textContent = "";
      if (errs.length) this.errBox.append(UI.errors(errs, line => { this.show("code"); this.editor.goto(line); }));
      const rt = this.prog.rt;
      this.status.dataset.state = errs.length ? "err" : "ok";
      this.status.textContent = errs.length ? `${errs.length} error${errs.length > 1 ? "s" : ""}${this.prog.buildError ? ". The preview shows the last version that built." : "."}`
        : rt ? `${rt.apps.size} app${rt.apps.size === 1 ? "" : "s"} · ${rt.cells.size} cells · ${rt.ticking() ? "running per frame" : "runs on change"}` : "Write a program, or pick an example.";
    }

    /* ---------- frames ---------- */
    alive() { return this.root.isConnected; }
    dispose() { this.unsub(); this.ro.disconnect(); }
    frame(now) {
      const rt = this.prog.rt, st = this.stage;
      this.renderErrors();
      // shown too small to read (a phone reading a wide desk): offer full screen, counter-scaled to stay legible
      if (!this.isFull && now - (this.ctaAt || 0) > 400) {
        this.ctaAt = now;
        const r = this.root.getBoundingClientRect(), z = this.root.offsetWidth ? r.width / this.root.offsetWidth : 1;
        const small = this.root.offsetWidth > 0 && z < 0.66 && innerWidth < 760;
        this.cta.hidden = !small;
        if (small) this.cta.style.fontSize = Math.round(15 / Math.max(0.2, z)) + "px";
      }
      if (this.isFull && !this.cta.hidden) this.cta.hidden = true;
      if (this.panels.preview.hidden) return;
      st.setRuntime(rt);
      const ticking = rt && this.prog.playing && rt.ticking();
      if (this.mode === "ir") { if (now - this.at > 1000) { this.at = now; this.renderIR(); } return; }
      if (!(st.need || ticking || (rt && rt.version !== this.v) || now - this.at > 1000 || st.pulses.length)) return;
      this.at = now; st.need = false; this.v = rt ? rt.version : -1;
      const wrap = this.stageWrap, W = Math.max(100, wrap.clientWidth), H = Math.max(160, wrap.clientHeight);
      st.frame(this.root, W, H);
      this.params.render(rt);
    }

    /* ---------- the book ---------- */
    renderBook() {
      if (this.bookDone) return; this.bookDone = true;
      const { html, toc } = UI.markdown(docs());
      this.article.innerHTML = html;
      this.toc.innerHTML = "";
      this.toc.append(el("ol", {}, toc.map(t => el("li", {}, el("a", { href: "#" + t.id, "data-jump": t.id }, t.text.replace(/`/g, ""))))));
    }
    jump(idv) { const t = this.article.querySelector("#" + CSS.escape(idv)); if (t) { this.article.scrollTop = t.offsetTop - this.article.offsetTop - 8; } }

    /* ---------- the agent ---------- */
    say(role, text, extra) {
      const li = el("li", { class: "sp-msg sp-" + role }, el("div", { class: "sp-msg-t" }, text));
      if (extra) li.append(extra);
      this.log.append(li); this.sugg.hidden = true;
      this.log.parentElement.scrollTop = 1e9;
      return li;
    }
    summary() {
      const rt = this.prog.rt; if (!rt) return "(nothing runs yet)";
      const lines = [];
      for (const [id, a] of rt.apps) {
        const cells = [...a.names].map(n => { const c = rt.cells.get(id + "." + n); let v = c.value; try { v = JSON.stringify(Spore.plain(c.value)); } catch {} return `${n} (${c.kind}) = ${String(v).slice(0, 60)}`; });
        lines.push(`${id} "${a.title}": ${cells.join("; ")}${a.actions.size ? "; actions: " + [...a.actions.keys()].join(", ") : ""}`);
      }
      return lines.join("\n");
    }
    async send(text) {
      text = String(text || "").trim(); if (!text || this.busy) return;
      this.ask.value = "";
      this.say("user", text);
      this.busy = true; this.sendBtn.disabled = true; this.stopBtn.hidden = false;
      try { await this.converse(text, 0); }
      catch (e) { this.say("note", e && e.code === "cancelled" ? "Stopped." : (e && e.message) || "The agent could not answer."); }
      this.busy = false; this.sendBtn.disabled = false; this.stopBtn.hidden = true; this.syncChip();
    }
    async converse(request, attempt) {
      const errs = this.prog.errors();
      const ctx = [
        "<program>", this.prog.code || "", "</program>",
        "<errors>", errs.length ? errs.map(e => `- ${e.kind}${e.line ? " line " + e.line : ""}${e.where ? " in " + e.where : ""}: ${e.message}`).join("\n") : "none", "</errors>",
        "<apps>", this.summary(), "</apps>",
        X ? `<desk>This studio runs inside CC5. The desk around it has the apps: ${(Bridge.get().apps()).join(", ") || "none"}. $.desk.<app>.<cell> reads them.</desk>` : "",
      ].join("\n");
      const turns = [...this.history.slice(-8), { role: "user", content: ctx + "\n\n" + request }];
      const bubble = this.say("agent", "…"), body = bubble.firstChild;
      this.ctl = new AbortController();
      const res = await Agent.complete(SYSTEM + "\n\n<textbook>\n" + docs() + "\n</textbook>", turns, {
        signal: this.ctl.signal,
        onText: t => { body.textContent = t.replace(/```[\s\S]*?(```|$)/g, "[writing the program…]").trim() || "…"; this.log.parentElement.scrollTop = 1e9; },
      });
      for (const n of res.notes) this.say("note", n);
      const code = Agent.extract(res.text);
      const prose = res.text.replace(/```[\s\S]*?```/g, "").trim();
      body.textContent = prose || (code ? "Here is the program." : "(no answer)");
      bubble.append(el("div", { class: "sp-msg-m" }, res.provider.id === "builtin" ? res.provider.label : `${res.provider.label} · ${res.provider.model}`));
      this.history.push({ role: "user", content: request }, { role: "assistant", content: (prose || "Done.") + (code ? "\n[The complete program went into the editor.]" : "") });
      if (!code) return;
      this.load(code, "agent's edit");
      await new Promise(r => setTimeout(r, 700));
      const after = this.prog.errors();
      const tag = el("div", { class: "sp-msg-s", "data-state": after.length ? "err" : "ok" }, after.length ? `Loaded. ${after.length} error${after.length > 1 ? "s" : ""}.` : `Loaded and running. ${code.split("\n").length} lines.`);
      bubble.append(tag);
      if (after.length && attempt < 2) {
        this.say("note", `Asking the agent to fix ${after.length === 1 ? "it" : "them"} (attempt ${attempt + 1} of 2).`);
        await this.converse(`The program you wrote reports ${after.length} error${after.length > 1 ? "s" : ""}:\n${after.map(e => `- ${e.kind}${e.line ? " line " + e.line : ""}${e.where ? " in " + e.where : ""}: ${e.message}`).join("\n")}\nFix ${after.length > 1 ? "them" : "it"}. Reply with the complete program.`, attempt + 1);
      }
    }
  }

  /* ---------- the textbook and the brief ---------- */
  function docs() { const s = document.getElementById("spore-docs"); return s ? s.textContent.trim() : "The textbook is missing from this page (script#spore-docs)."; }
  function reference() { const d = docs(), i = d.search(/^## [^\n]*Reference/m); return i >= 0 ? d.slice(i) : d.slice(0, 6000); }

  /* ---------- mounting, inside CC5 or on any page ---------- */
  const Views = new Map();
  function view(vkey, prog, ide, o) {
    let v = Views.get(vkey);
    if (v && (v instanceof Studio) !== ide) { Loop.views.delete(v); v.dispose && v.dispose(); v = null; }
    if (!v) { v = ide ? new Studio(prog, o) : new RunView(prog, o); Views.set(vkey, v); }
    else if (v.update) v.update(o);
    return v;
  }
  function mount(target, opts = {}) {
    const key = opts.key || "page:" + (target.id || "studio");
    const p = program(key, null);
    if (opts.code != null && p.code == null) p.sync(opts.code);
    const v = view(key + "#view", p, opts.ide !== false, opts);
    target.append(v.root);
    return v;
  }

  /* the CC5 elements: spore CODE and spore_ide CODE */
  function element(K, p, env, ide) {
    const F = window.Fruit;
    const b = F.bind(K, p, "of", env);
    const key = b.path || "inline:" + p;
    const prog = program(key, b.path);
    prog.writer = b.path && b.can && !env.readonly ? text => F.write(env, b.path, text) : null;
    prog.sync(typeof b.v === "string" ? b.v : "");
    const o = { app: F.prop(K, p, "app", env), h: F.prop(K, p, "h", env), params: F.prop(K, p, "params", env) };
    const vkey = p + (env.keySuffix || "");
    const v = view(vkey, prog, ide, o);
    if (ide) { v.editor.readonly(!prog.writer); const hh = (typeof o.h === "number" ? o.h : 640) + "px"; if (v.isFull) v.homeH = hh; else v.root.style.height = hh; }
    return F.h("div", { class: "sp-host", key: "sp:" + vkey + (ide ? ":ide" : ""), style: F.styleOf(K, p, env), ref: host => host.appendChild(v.root) });
  }
  function hookFruit() {
    const F = window.Fruit, H = window.Hypha;
    if (!F || !H || F.R.spore) return;
    H.POS.spore = ["of"]; H.POS.spore_ide = ["of"];
    F.R.spore = (K, p, env) => element(K, p, env, false);
    F.R.spore_ide = (K, p, env) => element(K, p, env, true);
  }
  hookFruit();

  /* a new studio on the desk: an app holding code, its view a studio */
  function create(name, code, opts = {}) {
    if (!X) throw new Error("create() works inside CC5.");
    const K = X.K();
    let n = String(name || "studio").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "studio";
    if (!/^[a-z]/.test(n)) n = "s_" + n;
    let id = n, i = 2; while (K.exists(id)) id = n + "_" + i++;
    const src = String(code || PRESETS[0].code).replace(/\s+$/, "");
    const phoneH = innerWidth < 760 ? 720 : 760;
    const text = [`${id}:`, `  title = ${JSON.stringify(opts.title || "Spore studio")}`, `  code = |`, ...src.split("\n").map(l => "    " + l), `  ui:`, opts.ide === false ? `    spore code` : `    spore_ide code, h: ${opts.h || phoneH}`].join("\n");
    X.writeText(text);
    // a studio made on a phone is phone-sized; one made on a desk is desk-sized (people resize windows in CC5)
    const phone = innerWidth < 760, w = opts.ide === false ? (phone ? 380 : 560) : phone ? 390 : 1380, h = opts.ide === false ? 560 : phone ? 780 : 830;
    if (opts.frame !== false && X.frame) { try { X.frame(id, Object.assign({}, X.spot ? X.spot(null, w) : { x: 0, y: 0 }, { w, h })); } catch (e) { console.warn(e); } }
    activeKey = id + ".code";
    return id + ".code";
  }

  /* ---------- window.spore: drive the studio from outside ---------- */
  const listeners = new Map();
  const pick = key => { const p = Registry.get(key || activeKey) || [...Registry.values()][0]; if (!p) throw new Error("No Spore program is running here yet. Use spore.create(name, code) inside CC5, or mount a studio."); return p; };
  const API = {
    version: "1.0",
    docs, reference,
    programs: () => [...Registry.values()].map(p => ({ key: p.key, apps: p.rt ? [...p.rt.apps.keys()] : [], errors: p.errors().length, playing: p.playing })),
    active: () => activeKey,
    use(key) { if (!Registry.has(key)) throw new Error(`No program "${key}". Programs: ${[...Registry.keys()].join(", ")}.`); activeKey = key; return key; },
    load(code, key) { const p = pick(key); for (const v of Views.values()) if (v.prog === p && v.editor) v.editor.set(code); p.edit(String(code), { now: true, by: "api" }); return { ok: !p.errors().length, errors: p.errors() }; },
    run(key) { const p = pick(key); p.rebuild(); return { ok: !p.errors().length, errors: p.errors() }; },
    getIR: key => pick(key).ir(),
    setParam(id, value, key) { const p = pick(key); p.rt.setParam(id, value); return p.rt.cells.get(id).value; },
    get(id, key) { const p = pick(key); const c = p.rt && p.rt.cells.get(id); if (!c) throw new Error(`No cell "${id}". Cells: ${p.rt ? [...p.rt.cells.keys()].join(", ") : "none"}.`); return p.rt.read(id, null); },
    full(on = true, key) { for (const v of Views.values()) if (v.prog === pick(key) && v.full) { v.full(!!on); return true; } return false; },
    act(path, key) { const p = pick(key); const [a, n] = String(path).split("."); p.rt.act(a, n); return p.errors(); },
    errors: key => pick(key).errors(),
    play(on = true, key) { pick(key).playing = !!on; },
    code: key => pick(key).code,
    create: (name, code, opts) => create(name, code, opts),
    presets: () => PRESETS.map(p => ({ id: p.id, title: p.title, code: p.code })),
    mount,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
  };
  const relay = (type, data) => { for (const f of listeners.get(type) || []) { try { f(data); } catch (e) { console.error(e); } } };
  const _program = program;
  program = (key, path) => { const fresh = !Registry.has(key), p = _program(key, path); if (fresh) p.on((type, d) => relay(type, Object.assign({ key }, d))); return p; };

  /* CC5 calls this once it boots */
  function init(host) {
    X = host;
    Agent.setSample(() => (X && X.sample ? X.sample() : null));
    if (window.cc5) window.cc5.spore = API;
    for (const p of Registry.values()) if (p.code != null) p.rebuild();
  }
  /* what CC5's built-in Claude is told about Spore */
  function prompt() {
    return `SPORE: CC5 also runs JavaScript apps. For simulations, animation, drawing, games, physics, timers, or logic with many interacting parts, write a Spore program instead of formulas: a CC5 app holds the program in a text block, code = | (the JavaScript indented below it), and its view is spore code (the program's apps on a canvas, with their parameters as controls). Use spore code, app: "name" to show one Spore app in a window; spore_ide code, h: 760 gives a full studio (editor, preview, agent, textbook); give its app desk.<app> = {x, y, w: 1380, h: 830}. Spore apps read the desk with $.desk.<app>.<cell>, an action writes it with $.set("desk.<app>.<cell>", v), and .export("cell") puts a value on the desk as <host>.out.<sporeApp>.<cell> for formulas to read.\n${reference()}`;
  }
  return { init, prompt, mount, create, API, Program, Registry, Studio, RunView, Loop, docs, reference, hookFruit };
})();

/* ---------- styles, injected once ---------- */
(function () {
  if (document.getElementById("spore-css")) return;
  const st = document.createElement("style"); st.id = "spore-css"; st.textContent = "/* Spore studio. Swiss: Arial only, 1px hairlines, 2.5px corners, elevation by soft shadow.\n   Colours come from CC5's tokens (--paper, --card, --ink \u2026) and fall back to these. */\n.sp-root {\n  --sp-paper: var(--paper, #EEEEEC); --sp-card: var(--card, #FFFFFF); --sp-ink: var(--ink, #141414); --sp-ink2: var(--ink-2, #454545);\n  --sp-muted: var(--muted, #7C7C7A); --sp-line: var(--line, #D6D6D3); --sp-line2: var(--line-2, #E9E9E6); --sp-accent: var(--accent, #E0400F);\n  --sp-good: var(--good, #2F7A4E); --sp-bad: var(--bad, #B42318); --sp-blue: var(--p7, #4F79A8); --sp-shadow: var(--shadow, rgba(20, 20, 20, 0.16));\n  --sp-r: 2.5px; --sp-font: Arial, sans-serif;\n  font: 13px/1.45 var(--sp-font); color: var(--sp-ink); -webkit-font-smoothing: antialiased; box-sizing: border-box;\n}\n.sp-root *, .sp-root *::before, .sp-root *::after { box-sizing: border-box; }\n.sp-root button, .sp-root input, .sp-root select, .sp-root textarea { font: inherit; color: inherit; }\n.sp-root :focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 1px; }\n.sp-host { min-width: 0; }\n\n/* controls */\n.sp-btn { height: 28px; padding: 0 10px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); background: var(--sp-card); font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }\n.sp-btn:hover { border-color: var(--sp-ink2); }\n.sp-btn:disabled { opacity: .45; cursor: default; }\n.sp-root .sp-primary { background: var(--sp-ink); border-color: var(--sp-ink); color: var(--sp-card); }\n.sp-root .sp-primary:hover { background: var(--sp-ink2); border-color: var(--sp-ink2); }\n.sp-root select, .sp-input, .sp-root input[type=\"text\"], .sp-root input[type=\"url\"], .sp-root input[type=\"password\"] {\n  height: 28px; padding: 0 8px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); background: var(--sp-card); font-size: 12.5px; min-width: 0; }\n.sp-root textarea.sp-input { height: auto; padding: 7px 9px; resize: none; line-height: 1.4; width: 100%; }\n.sp-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--sp-ink2); cursor: pointer; }\n.sp-check input { accent-color: var(--sp-accent); margin: 0; }\n.sp-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }\n.sp-seg { display: inline-flex; border: 1px solid var(--sp-line); border-radius: var(--sp-r); overflow: hidden; }\n.sp-seg button { height: 26px; padding: 0 10px; border: 0; background: var(--sp-card); font-size: 11.5px; font-weight: 700; cursor: pointer; color: var(--sp-ink2); }\n.sp-seg button + button { border-left: 1px solid var(--sp-line); }\n.sp-seg button[aria-checked=\"true\"] { background: var(--sp-ink); color: var(--sp-card); }\n.sp-quiet { color: var(--sp-muted); font-size: 11.5px; }\n.sp-chip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); background: var(--sp-card); font-size: 11.5px; font-weight: 700; cursor: pointer; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.sp-dot { width: 7px; height: 7px; border-radius: 1px; background: var(--sp-muted); flex: none; }\n.sp-dot.sp-on { background: var(--sp-good); }\n.sp-pill { padding: 6px 10px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); background: var(--sp-card); font-size: 12px; text-align: left; cursor: pointer; }\n.sp-pill:hover { border-color: var(--sp-ink2); }\n\n/* the studio grid: wide, medium, narrow, from its own width */\n.sp-studio { position: relative; display: grid; height: 640px; min-height: 0; background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: var(--sp-r); overflow: hidden; }\n.sp-studio[data-size=\"wide\"] { grid-template-columns: minmax(0, .92fr) minmax(0, 1.3fr) minmax(290px, .72fr); grid-template-rows: 40px minmax(0, 1fr); grid-template-areas: \"code preview tabs\" \"code preview side\"; }\n.sp-studio[data-size=\"medium\"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); grid-template-rows: 40px minmax(0, 1fr); grid-template-areas: \"code tabs\" \"code side\"; }\n.sp-studio[data-size=\"narrow\"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) 46px; grid-template-areas: \"side\" \"tabs\"; }\n.sp-studio .sp-tabs { grid-area: tabs; }\n.sp-studio .sp-panel { grid-area: side; }\n.sp-studio[data-size=\"wide\"] .sp-p-code, .sp-studio[data-size=\"medium\"] .sp-p-code { grid-area: code; }\n.sp-studio[data-size=\"wide\"] .sp-p-preview { grid-area: preview; }\n.sp-studio[data-size=\"wide\"] .sp-p-preview, .sp-studio[data-size=\"wide\"] .sp-p-chat, .sp-studio[data-size=\"wide\"] .sp-p-book,\n.sp-studio[data-size=\"medium\"] .sp-p-preview, .sp-studio[data-size=\"medium\"] .sp-p-chat, .sp-studio[data-size=\"medium\"] .sp-p-book { border-left: 1px solid var(--sp-line); }\n.sp-studio[data-size=\"wide\"] .sp-p-chat > .sp-ph h2, .sp-studio[data-size=\"wide\"] .sp-p-book > .sp-ph h2,\n.sp-studio[data-size=\"medium\"] .sp-panel:not(.sp-p-code) > .sp-ph h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }\n\n.sp-tabs { display: flex; min-width: 0; border-bottom: 1px solid var(--sp-line); background: var(--sp-card); }\n.sp-studio[data-size=\"wide\"] .sp-tabs, .sp-studio[data-size=\"medium\"] .sp-tabs { border-left: 1px solid var(--sp-line); }\n.sp-tabs button { height: 100%; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: none; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-muted); cursor: pointer; }\n.sp-tabs button[aria-selected=\"true\"] { color: var(--sp-ink); border-bottom-color: var(--sp-accent); }\n.sp-studio[data-size=\"narrow\"] .sp-tabs { border-bottom: 0; border-top: 1px solid var(--sp-line); }\n.sp-studio[data-size=\"narrow\"] .sp-tabs button { flex: 1; border-bottom: 0; border-top: 2px solid transparent; min-height: 44px; }\n.sp-studio[data-size=\"narrow\"] .sp-tabs button[aria-selected=\"true\"] { border-top-color: var(--sp-accent); }\n\n.sp-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--sp-card); position: relative; }\n.sp-ph { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; padding: 6px 12px; border-bottom: 1px solid var(--sp-line); }\n.sp-ph h2 { margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-ink); flex: none; }\n\n/* the editor: a textarea over highlighted lines */\n.sp-editor { flex: 1; min-height: 0; position: relative; background: var(--sp-card); }\n.sp-scroll { position: absolute; inset: 0; overflow: auto; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; overscroll-behavior: contain; }\n.sp-gutter { position: sticky; left: 0; z-index: 1; min-height: 100%; padding: 10px 8px 40px 10px; background: var(--sp-card); border-right: 1px solid var(--sp-line2); color: var(--sp-muted); font: 11.5px/20px var(--sp-font); text-align: right; font-variant-numeric: tabular-nums; user-select: none; }\n.sp-gutter span { display: block; min-width: 2ch; }\n.sp-gutter .g-err { color: var(--sp-bad); font-weight: 700; }\n.sp-code { display: grid; min-width: 0; min-height: 100%; }\n.sp-code > * { grid-area: 1 / 1; margin: 0; padding: 10px 14px 40px; font: 13px/20px var(--sp-font); white-space: pre; tab-size: 2; letter-spacing: 0; word-spacing: 0; }\n.sp-hl { color: var(--sp-ink); pointer-events: none; }\n.sp-hl .ln { display: block; min-height: 20px; }\n.sp-hl .ln-err { background: color-mix(in srgb, var(--sp-bad) 11%, transparent); box-shadow: inset 2px 0 var(--sp-bad); }\n.sp-ta { border: 0; outline: 0; resize: none; overflow: hidden; background: transparent; color: transparent; -webkit-text-fill-color: transparent; caret-color: var(--sp-ink); min-height: 100%; width: 100%; }\n.sp-ta::selection { background: color-mix(in srgb, var(--sp-accent) 24%, transparent); }\n.sp-editor.ro .sp-ta { caret-color: transparent; }\n.t-c { color: var(--sp-muted); }\n.t-s { color: var(--sp-good); }\n.t-n { color: var(--sp-blue); }\n.t-k { color: var(--sp-ink); font-weight: 700; }\n.t-d, .t-g { color: var(--sp-accent); font-weight: 700; }\n.t-m { color: var(--sp-accent); }\n.t-pr { color: var(--sp-ink2); }\n.t-o, .t-p, .t-b { color: var(--sp-muted); }\n\n.sp-status { flex: none; margin: 0; padding: 7px 12px; border-top: 1px solid var(--sp-line); font-size: 11.5px; color: var(--sp-muted); font-variant-numeric: tabular-nums; }\n.sp-status[data-state=\"err\"] { color: var(--sp-bad); font-weight: 700; }\n.sp-errbox { flex: none; max-height: 34%; overflow: auto; }\n.sp-errbox:empty { display: none; }\n.sp-errors { list-style: none; margin: 0; padding: 0; }\n.sp-err { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; padding: 8px 12px; border-top: 1px solid var(--sp-line2); background: color-mix(in srgb, var(--sp-bad) 5%, var(--sp-card)); }\n.sp-err-k { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-bad); }\n.sp-err-l { border: 0; padding: 0; background: none; color: var(--sp-ink); font-size: 11.5px; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }\n.sp-err-w { font: 11.5px var(--sp-font); color: var(--sp-muted); }\n.sp-err-m { flex-basis: 100%; font-size: 12.5px; color: var(--sp-ink); }\n.sp-err-h { flex-basis: 100%; font-size: 11.5px; color: var(--sp-muted); }\n\n/* preview */\n.sp-p-preview { container-type: inline-size; }\n.sp-prevbody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 236px; }\n@container (max-width: 640px) { .sp-prevbody { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; } .sp-paramwrap { border-left: 0 !important; border-top: 1px solid var(--sp-line); max-height: 210px; } .sp-ph h2 { display: none; } }\n.sp-stagewrap { position: relative; min-height: 0; min-width: 0; overflow: hidden; background: var(--sp-paper); }\n.sp-canvas { display: block; width: 100%; touch-action: none; }\n.sp-paramwrap { min-height: 0; overflow: auto; padding: 12px; border-left: 1px solid var(--sp-line); background: var(--sp-card); }\n.sp-paramwrap h3, .sp-params legend { margin: 0 0 10px; padding: 0; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-muted); }\n.sp-params { display: grid; gap: 4px; }\n.sp-pgroup { border: 0; margin: 0 0 8px; padding: 0; min-width: 0; }\n.sp-params legend { color: var(--sp-ink); margin-bottom: 8px; }\n.sp-pf { display: grid; gap: 4px; margin-bottom: 11px; min-width: 0; }\n.sp-pl { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }\n.sp-pf label { font-size: 12px; color: var(--sp-ink2); }\n.sp-pf output { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }\n.sp-pf small { font-size: 11px; color: var(--sp-muted); }\n.sp-pf input[type=\"range\"] { width: 100%; margin: 2px 0; accent-color: var(--sp-accent); }\n.sp-pc { display: flex; align-items: center; gap: 8px; }\n.sp-pc input { accent-color: var(--sp-accent); margin: 0; width: 15px; height: 15px; }\n.sp-empty { margin: 0; font-size: 12px; color: var(--sp-muted); }\n.sp-empty code, .sp-quiet code { font: 11.5px var(--sp-font); background: var(--sp-line2); padding: 0 4px; border-radius: var(--sp-r); color: var(--sp-ink); }\n.sp-irwrap { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--sp-card); }\n.sp-irbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--sp-line); font-size: 11.5px; color: var(--sp-muted); }\n.sp-ir { flex: 1; margin: 0; padding: 12px; overflow: auto; font: 11.5px/1.5 var(--sp-font); white-space: pre; color: var(--sp-ink2); }\n\n/* agent */\n.sp-logwrap { flex: 1; min-height: 0; overflow: auto; padding: 12px; overscroll-behavior: contain; }\n.sp-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }\n.sp-msg { max-width: 92%; padding: 8px 10px; border-radius: var(--sp-r); font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }\n.sp-user { justify-self: end; background: var(--sp-line2); }\n.sp-agent { justify-self: start; background: var(--sp-card); border: 1px solid var(--sp-line); box-shadow: 0 6px 18px -12px var(--sp-shadow); }\n.sp-note { justify-self: center; max-width: 100%; padding: 2px 6px; font-size: 11.5px; color: var(--sp-muted); text-align: center; }\n.sp-msg-m { margin-top: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-muted); white-space: normal; }\n.sp-msg-s { margin-top: 6px; font-size: 11.5px; font-weight: 700; color: var(--sp-good); white-space: normal; }\n.sp-msg-s[data-state=\"err\"] { color: var(--sp-bad); }\n.sp-sugg { display: grid; gap: 6px; margin-top: 4px; }\n.sp-composer { flex: none; display: grid; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--sp-line); }\n.sp-settings { flex: none; display: grid; gap: 10px; padding: 12px; border-bottom: 1px solid var(--sp-line); background: var(--sp-card); box-shadow: 0 14px 28px -20px var(--sp-shadow); max-height: 70%; overflow: auto; }\n.sp-settings fieldset { border: 1px solid var(--sp-line); border-radius: var(--sp-r); padding: 8px 10px 0; margin: 0; min-width: 0; }\n.sp-settings legend { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-muted); padding: 0 4px; }\n.sp-settings input, .sp-settings select { width: 100%; }\n.sp-settings p { margin: 0; }\n\n/* book */\n.sp-bookbody { flex: 1; min-height: 0; display: grid; grid-template-columns: 190px minmax(0, 1fr); container-type: inline-size; }\n.sp-p-book { container-type: inline-size; }\n@container (max-width: 640px) { .sp-bookbody { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); } .sp-toc { border-right: 0 !important; border-bottom: 1px solid var(--sp-line); max-height: 92px; } .sp-toc ol { display: flex; flex-wrap: wrap; gap: 2px 12px; } }\n.sp-toc { overflow: auto; padding: 14px 12px; border-right: 1px solid var(--sp-line); }\n.sp-toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }\n.sp-toc a { display: block; padding: 3px 0; font-size: 12px; color: var(--sp-ink2); text-decoration: none; }\n.sp-toc a:hover { color: var(--sp-accent); }\n.sp-article { overflow: auto; padding: 18px 24px 80px; overscroll-behavior: contain; }\n.sp-article > * { max-width: 70ch; }\n.sp-article h1 { margin: 6px 0 14px; font-size: 30px; line-height: 1.08; font-weight: 700; letter-spacing: -.015em; text-wrap: balance; }\n.sp-article h2 { margin: 38px 0 10px; padding-top: 14px; border-top: 1px solid var(--sp-ink); font-size: 20px; line-height: 1.2; font-weight: 700; text-wrap: balance; }\n.sp-article h3 { margin: 24px 0 6px; font-size: 14.5px; font-weight: 700; }\n.sp-article h4 { margin: 18px 0 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sp-muted); }\n.sp-article p, .sp-article li { font-size: 14px; line-height: 1.6; color: var(--sp-ink2); }\n.sp-article p { margin: 0 0 10px; }\n.sp-article ul, .sp-article ol { margin: 0 0 12px; padding-left: 20px; }\n.sp-article strong { color: var(--sp-ink); }\n.sp-article a { color: var(--sp-ink); text-underline-offset: 2px; }\n.sp-article code { font: 12.5px var(--sp-font); background: var(--sp-line2); padding: 1px 4px; border-radius: var(--sp-r); color: var(--sp-ink); }\n.sp-article blockquote { margin: 14px 0; padding: 2px 0 2px 14px; border-left: 2px solid var(--sp-accent); color: var(--sp-ink); font-size: 14px; line-height: 1.55; }\n.sp-article hr { border: 0; border-top: 1px solid var(--sp-line); margin: 24px 0; }\n.sp-ex { margin: 12px 0 16px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); overflow: hidden; background: var(--sp-paper); max-width: 70ch; }\n.sp-pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 12.5px/1.6 var(--sp-font); }\n.sp-pre code { background: none; padding: 0; font: inherit; }\n.sp-pre .ln { display: block; min-height: 1.6em; }\n.sp-ex figcaption { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-top: 1px solid var(--sp-line); background: var(--sp-card); font-size: 11.5px; color: var(--sp-muted); }\n.sp-table { overflow-x: auto; margin: 10px 0 16px; max-width: 70ch; }\n.sp-table table { border-collapse: collapse; width: 100%; font-size: 12.5px; }\n.sp-table th { text-align: left; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--sp-muted); padding: 6px 10px 6px 0; border-bottom: 1px solid var(--sp-ink); }\n.sp-table td { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--sp-line2); vertical-align: top; color: var(--sp-ink2); }\n.sp-table td code { white-space: nowrap; }\n\n/* the spore element */\n.sp-run { display: grid; gap: 10px; min-width: 0; }\n.sp-run-stage { min-width: 0; border-radius: var(--sp-r); overflow: hidden; }\n.sp-run-err { font-size: 12px; color: var(--sp-bad); }\n.sp-run .sp-params { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0 16px; padding-top: 10px; border-top: 1px solid var(--sp-line2); }\n.sp-run .sp-pgroup { display: contents; }\n.sp-run .sp-pgroup legend { display: none; }\n@media (prefers-reduced-motion: reduce) { .sp-root * { scroll-behavior: auto !important; } }\n\n/* full screen, and the prompt to open it when the studio is shown too small */\n.sp-full { margin-left: auto; align-self: center; height: 26px; padding: 0 10px; margin-right: 8px; border: 1px solid var(--sp-line); border-radius: var(--sp-r); background: var(--sp-card); font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; }\n.sp-full:hover { border-color: var(--sp-ink2); }\n.sp-studio[data-size=\"narrow\"] .sp-full { margin: 0 6px; height: 32px; }\n.sp-overlay { position: fixed; inset: 0; z-index: 2000; background: var(--sp-paper); padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }\n.sp-studio.is-full { height: 100%; border: 0; border-radius: 0; }\n.sp-cta { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); z-index: 5; padding: .7em 1.1em; border: 1px solid var(--sp-ink); border-radius: var(--sp-r); background: var(--sp-ink); color: var(--sp-card); font-weight: 700; white-space: nowrap; box-shadow: 0 18px 40px -16px var(--sp-shadow); cursor: pointer; }\n.sp-bookbody .sp-toc ol { display: grid; }\n@container (max-width: 640px) { .sp-bookbody .sp-toc ol { display: flex; flex-wrap: wrap; gap: 2px 14px; } }\n";
  document.head.appendChild(st);
})();

/* ---------- exports ---------- */
window.Spore = Spore;
window.spore = Host.API;
window.CC5Spore = { init: Host.init, prompt: Host.prompt, create: Host.create, mount: Host.mount, docs: Host.docs, reference: Host.reference, presets: PRESETS };
})();
