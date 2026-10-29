/* CLAUDE BLOCKS · the workspace
   CC5's computer in Notion's form factor. The engine is CC5's, unchanged: one Hypha log that people and Claudes
   write together, Fruit views, programs, Spore, the browser. What changes is the shape you hold it by:
   a page is a top-level scope; its body (page.ui) is a list of blocks, prose and live ones in one flow; its other
   cells are its properties; a hole is a Claude block that a Claude writes in place. Built on CC5 by Ramon Marc. */
(function () {
"use strict";
const M = window.Hypha, F = window.Fruit, B = window.Blocks, h = F.h;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hash32 = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const secs = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
const pageOf = p => p.split(".")[0];
const isNum = s => /^\d+$/.test(s);
const RESERVED = new Set(["desk", "sys", "clock", "spaces", "theme", "fn", "lib", "jobs", "ws"]);
const META = new Set(["title", "icon", "cover", "parent", "full", "order", "ui", "serif", "small"]);
const ago = t => { const d = Date.now() - t; if (d < 45000) return "just now"; if (d < 3600000) return Math.round(d / 60000) + " min ago"; if (d < 86400000) return Math.round(d / 3600000) + " h ago"; return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
let toastT = 0;
function toast(msg, act) {
  let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.innerHTML = esc(msg) + (act ? ` <button type="button">${esc(act.label)}</button>` : ""); t.hidden = false;
  if (act) t.querySelector("button").onclick = () => { t.hidden = true; act.run(); };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, act ? 6000 : 3800);
}
const store = { get(k) { try { return JSON.parse(localStorage.getItem("cb:" + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem("cb:" + k, JSON.stringify(v)); } catch (e) { } } };

/* ---------- state ---------- */
const S = {
  U: "me", userId: null, K: null, view: null, timeIdx: null,
  mode: "memory", db: null, user: null, room: null, sample: null, mcp: null, assets: null, downloads: null, profiles: {}, uMap: {}, readOnly: false, isOwner: true, loaded: false,
  page: null, local: new Map(), busy: new Set(), claudeBusy: false, lastChat: null, scope: "page",
  panel: null, sideOpen: innerWidth > 860, open: new Set(store.get("open") || []), focus: null,
};
const meId = () => S.U + ":you";

/* ---------- peers: names and colours are derived, never stored ---------- */
const FILL = ["--p2", "--p4", "--p5", "--p7", "--p6", "--p3"];
function roleOf(id) { const i = id.indexOf(":"); return i < 0 ? { u: "", role: id } : { u: id.slice(0, i), role: id.slice(i + 1) }; }
function nameOf(id) {
  const { u, role } = roleOf(id), mine = u === S.U, who = mine ? "" : ((S.profiles[S.uMap[u]] || {}).name || "Someone");
  const n = (role.match(/\d+$/) || [""])[0];
  if (role === "you") return mine ? "You" : who;
  if (role === "claude") return mine ? "Claude" : `${who}'s Claude`;
  if (/^f\d+$/.test(role)) return mine ? `Claude · ${n}` : `${who}'s Claude · ${n}`;
  if (role === "chat") return mine ? "Claude in chat" : `${who}'s chat Claude`;
  if (role === "ex") return "Example";
  if (role === "clock") return mine ? "Clock" : `${who}'s clock`;
  if (role.startsWith("p-")) return "Program · " + role.slice(2);
  return role;
}
const kindOfPeer = id => (roleOf(id).role === "you" ? "human" : "agent");
const isClaude = id => { const r = roleOf(id).role; return r === "claude" || r === "chat" || /^f\d+$/.test(r); };
function colorOf(id) {
  const { u, role } = roleOf(id), mine = u === S.U;
  if (role === "you") return mine ? "var(--you)" : `var(${FILL[hash32(u) % FILL.length]})`;
  if (role === "claude") return "var(--accent)";
  if (role === "chat") return "var(--p3)";
  if (role === "ex") return "var(--muted)";
  if (role === "clock") return "var(--p4)";
  if (role.startsWith("p-")) return "var(--p5)";
  const n = +(role.match(/\d+$/) || [0])[0];
  return `var(${FILL[(n - 1 + FILL.length) % FILL.length]})`;
}
function ensurePeer(K, id, extra) { if (!K.peers.has(id) || extra) K.peer(Object.assign({ id, kind: kindOfPeer(id) }, extra || {})); return K.peers.get(id); }
const mine = id => roleOf(id).u === S.U;

/* ---------- kernel wiring: any change re-renders what is on screen, once a frame ---------- */
let unsub = null;
function setKernel(K) {
  if (unsub) unsub();
  S.K = K; S.view = K; S.timeIdx = null;
  unsub = K.on(onKernel); ensurePeer(K, meId());
  History.rebuild(); S.themeDirty = true; schedule();
}
function onKernel(ev) {
  if (ev.type === "op") {
    const op = ev.op; ensurePeer(S.K, op.peer);
    if (op.ok && op.path) { const p = pageOf(op.path); if (p === "theme" || op.path.includes(".theme")) S.themeDirty = true; S.lastEdit.set(p, { peer: op.peer, at: op.at || Date.now() }); }
    History.add(op); Net.onOp(op);
    if (S.timeIdx != null) Time.extend();
  } else if (ev.type === "intent") { History.ghosts(); Net.presence(); }
  S.progDirty = true; schedule();
}
S.lastEdit = new Map();
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(flush); }
/* render now: a caret that moves to a new block must land there before the next key does */
function flushNow() { if (raf) cancelAnimationFrame(raf); raf = 0; flush(); }
function flush() {
  raf = 0;
  if (S.themeDirty) { S.themeDirty = false; try { Theme.apply(); } catch (e) { console.error(e); } }
  try { Side.render(); } catch (e) { console.error(e); }
  try { Top.render(); } catch (e) { console.error(e); }
  try { View.render(); } catch (e) { console.error(e); }
  try { Agent.render(); } catch (e) { console.error(e); }
  if (S.progDirty && window.CC5Computer) { S.progDirty = false; try { CC5Computer.Programs.changed(); } catch (e) { console.warn(e); } }
  const c = $("#log-count"); if (c) c.textContent = `${S.K.log.length} ops · ${S.view.cells.size} cells`;
  Ed.afterRender();
}

/* ---------- writing as the person ---------- */
function writeText(text, opts = {}) {
  if (S.readOnly) { toast("You can read this workspace but not change it. Ask for Contributor access in the Share menu."); return null; }
  if (S.view !== S.K) Time.now();
  if (!opts.undo) Undo.mark(opts.coalesce);
  if (opts.coalesce) {
    const out = [];
    S.K.batch(() => { for (const l of String(text).split("\n")) { const s = M.parseStmt(opts.base ? l : l); if (s && s.k !== "err") { if (opts.base && s.path != null) s.path = M.join(opts.base, s.path); out.push(S.K.commit(s, meId(), { coalesce: true })); } } });
    return out;
  }
  const st = new M.Stream(S.K, opts.peer || meId(), { base: opts.base || "" }); st.feed(text + "\n"); return st.end();
}
/* does this text parse as Hypha lines? (a probe kernel, so nothing is written) */
function parses(t) { const K = new M.Kernel(), st = new M.Stream(K, "probe:you"); st.feed(t + "\n"); const ops = st.end(); return { ok: ops.length > 0 && ops.every(o => o.ok), ops, bad: ops.find(o => !o.ok) }; }

/* ---------- undo: the log remembers, so taking a change back is writing what was there before ---------- */
const Undo = {
  stack: [],
  mark(coalesce) {
    const t = Date.now(), top = this.stack[this.stack.length - 1];
    if (coalesce && top && top.coalesce && t - top.at < 1200) { top.at = t; return; }
    this.stack.push({ clock: S.K.clock, at: t, coalesce: !!coalesce }); if (this.stack.length > 80) this.stack.shift();
  },
  undo() {
    if (S.readOnly || S.view !== S.K) return;
    const K = S.K;
    for (;;) {
      const g = this.stack.pop(); if (!g) return toast("Nothing of yours to undo here");
      const ops = K.log.filter(o => o.peer === meId() && o.ok && o.clock > g.clock && o.path && o.stmt.k !== "say");
      if (!ops.length) continue;
      const idx = K.log.findIndex(o => o.clock > g.clock), R = K.replay(idx < 0 ? K.log.length : idx);
      let paths = [...new Set(ops.map(o => o.path))].sort((a, b) => a.length - b.length);
      paths = paths.filter((p, i) => !paths.slice(0, i).some(q => p.startsWith(q + ".")));
      const lines = [];
      for (const p of paths) {
        if (!R.exists(p)) { if (K.exists(p)) lines.push(`${p} -`); continue; }
        if (R.cells.has(p)) { lines.push(R.toHyphaOne(p)); continue; }
        if (K.exists(p)) lines.push(`${p} -`);
        lines.push(R.toHypha({ root: p, values: false }));
      }
      if (!lines.length) continue;
      Ed.blur();
      writeText(lines.join("\n"), { undo: true });
      if (paths.length === 1 && !Pages.exists(S.page) && Pages.exists(pageOf(paths[0]))) Nav.go(pageOf(paths[0]));
      return toast(`Undone: ${ops.length} op${ops.length > 1 ? "s" : ""}`);
    }
  },
};

/* ---------- pages: top-level scopes, with a title, an icon and a parent ---------- */
const Pages = {
  list(K = S.view) { return K.children("").filter(s => !RESERVED.has(s) && !K.cells.has(s)); },
  exists(n, K = S.view) { return !!n && !RESERVED.has(n) && /^[A-Za-z_]\w*$/.test(n) && K.isBranch(n); },
  title(n, K = S.view) { const t = K.cells.get(n + ".title"); if (t && t.kind === "lit") return typeof t.v === "string" && t.v.trim() ? t.v : "Untitled"; if (t) { const v = K.valueAt(n + ".title"); return typeof v === "string" ? v : F.fmt(v); } return n.replace(/_/g, " "); },
  icon(n, K = S.view) { const t = K.cells.get(n + ".icon"); return t && typeof t.v === "string" ? t.v : ""; },
  parent(n, K = S.view) {
    const c = K.cells.get(n + ".parent"), p = c && typeof c.v === "string" ? c.v : "";
    if (!p || p === n || !this.exists(p, K)) return "";
    let a = p; for (let i = 0; i < 24 && a; i++) { if (a === n) return ""; const cc = K.cells.get(a + ".parent"); a = cc && typeof cc.v === "string" ? cc.v : ""; }
    return p;
  },
  born(n, K = S.view) { let best = Infinity; for (const s of ["title", "ui"]) { const c = K.cells.get(n + "." + s); if (c && c.clock) best = Math.min(best, c.clock); } const o = K.cells.get(n + ".order"); return o && typeof o.v === "number" ? o.v : best === Infinity ? 0 : best; },
  kids(n, K = S.view) { return this.list(K).filter(p => this.parent(p, K) === n).sort((a, b) => this.born(a, K) - this.born(b, K)); },
  roots(K = S.view) { return this.list(K).filter(p => !this.parent(p, K)).sort((a, b) => this.born(a, K) - this.born(b, K)); },
  chain(n, K = S.view) { const out = []; let a = n; for (let i = 0; i < 24 && a; i++) { out.unshift(a); a = this.parent(a, K); } return out; },
  fresh(base, K = S.K) {
    let n = String(base || "page").toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "page";
    if (!/^[a-z_]/.test(n)) n = "p_" + n; if (RESERVED.has(n)) n += "_page";
    let id = n, i = 2; while (K.exists(id)) id = n + "_" + i++; return id;
  },
  cell(page, base, K = S.K) { let id = base, i = 2; while (K.exists(page + "." + id)) id = base + "_" + i++; return id; },
  create(opts = {}) {
    if (S.readOnly) return toast("You can read this workspace but not change it.");
    const id = this.fresh(opts.name || "page_" + Date.now().toString(36).slice(-4));
    const lines = [`${id}:`, `  title = ${JSON.stringify(opts.title || "")}`];
    if (opts.icon) lines.push(`  icon = ${JSON.stringify(opts.icon)}`);
    if (opts.parent && this.exists(opts.parent, S.K)) lines.push(`  parent = ${JSON.stringify(opts.parent)}`);
    lines.push(`${id}.ui.1024 is p ""`);
    Ed.blur(); writeText(lines.join("\n"));
    if (opts.parent) { S.open.add(opts.parent); store.set("open", [...S.open]); }
    if (opts.link && opts.parent) Ops.insert(opts.parent + ".ui", opts.linkAfter || Ops.last(opts.parent + ".ui"), { head: `page ${JSON.stringify(id)}` });
    if (opts.go !== false) { Nav.go(id); Ed.wantTitle = true; }
    return id;
  },
  remove(n) {
    if (!this.exists(n, S.K)) return;
    const kids = this.kids(n, S.K), t = this.title(n, S.K);
    const lines = [`${n} -`].concat(kids.map(k => { const p = this.parent(n, S.K); return p ? `${k}.parent = ${JSON.stringify(p)}` : `${k}.parent -`; }));
    Ed.blur(); writeText(lines.join("\n"));
    if (S.page === n) Nav.go(this.parent(n, S.K) || this.roots(S.K)[0] || null);
    toast(`Deleted “${t}”.`, { label: "Undo", run: () => Undo.undo() });
  },
};

/* ---------- design tokens: theme.* cells become the workspace's CSS variables, live ---------- */
const COLOR_TOKENS = ["accent", "ink", "ink-2", "muted", "paper", "card", "raise", "line", "line-2", "good", "bad", "warn", "you", "p2", "p3", "p4", "p5", "p6", "p7"];
const FONTS = { sans: 'var(--sans)', serif: '"Lyon-Text", Georgia, "Iowan Old Style", "Times New Roman", serif', mono: 'var(--mono)', rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", var(--sans)', system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };
const Theme = {
  vars(t) {
    const out = {}; if (!t || typeof t !== "object" || Array.isArray(t)) return out;
    for (const [k0, v] of Object.entries(t)) {
      const k = k0.replace(/_/g, "-");
      if (k === "dark" || v == null || typeof v === "object") continue;
      if (k === "radius" && typeof v === "number") out["--radius"] = Math.max(0, Math.min(28, v)) + "px";
      else if (k === "gap" && typeof v === "number") out["--gap"] = Math.max(2, Math.min(40, v)) + "px";
      else if (k === "font" && typeof v === "string") out["--font-ui"] = FONTS[v] || v.replace(/[;{}<>]/g, "");
      else if (k === "size" && typeof v === "number") out["--size"] = Math.max(10, Math.min(22, v)) + "px";
      else if (typeof v === "string" && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^;{}]*\)|[a-z]+)$/i.test(v.trim())) { out[COLOR_TOKENS.includes(k) ? "--" + k : "--t-" + k] = v.trim(); if (k === "accent") out["--accent-wash"] = `color-mix(in srgb, ${v.trim()} 11%, transparent)`; }
    }
    return out;
  },
  apply() {
    const K = S.view, t = K.valueAt("theme"), light = this.vars(t), SURFACE = ["--ink", "--ink-2", "--muted", "--paper", "--card", "--raise", "--line", "--line-2"];
    const dark = Object.assign(Object.fromEntries(Object.entries(light).filter(([k]) => !SURFACE.includes(k))), this.vars(t && t.dark));
    F.tokens = new Set(Object.keys(Object.assign({}, light, dark)).filter(k => k.startsWith("--t-")).map(k => k.slice(4).replace(/-/g, "_")));
    const block = o => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(" ");
    const darkOnly = Object.keys(dark).length ? block(dark) : "";
    let el = $("#theme-css"); if (!el) { el = document.createElement("style"); el.id = "theme-css"; } document.body.appendChild(el);
    el.textContent = Object.keys(light).length || darkOnly ? `:root { ${block(light)} }` + (darkOnly ? ` @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${darkOnly} } } :root[data-theme="dark"] { ${darkOnly} }` : "") : "";
  },
  read(name) { const k = COLOR_TOKENS.includes(name) ? "--" + name : name === "radius" ? "--radius" : name === "gap" ? "--gap" : "--t-" + name; return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); },
};

/* ---------- the environment a block renders in: what it reads, and the doors its gestures go through ---------- */
function envFor(page) {
  return {
    app: page, al: new Map(), depth: 0, local: S.local, readonly: S.readOnly || S.view !== S.K, edit: false, sel: null,
    ghosts: Ed.ghostMap(page), colorOf, nameOf, titleOf: n => Pages.title(n), toast,
    write: (text, o) => writeText(text, o || {}),
    rerender: () => schedule(),
    ask: (a, text, node) => Claude.ask(text, { app: a, node }),
    fill: p => fillHoles([p]), writeAt: p => Agent.prefill(`${p} = `), holder: p => Claims.holder(p),
    open: a => Nav.go(a), go: a => Nav.go(a), face: () => { },
  };
}

/* ---------- the Claude in this page: shape first, then many Claudes fill in parallel ---------- */
const REF = () => `HYPHA: one op per line, applied the moment the line ends.
  path = value            numbers, "text", true/false, [lists], {records}. 74% is 0.74. Lists and records spread into cells.
  path = formula          live: per_day = total / days. Names resolve from the cell's scope outward; other pages by full path.
  path = ?"intent"        a hole: a slot another Claude fills. Formulas reading it wait.
  path:                   a scope; indented lines below are relative (two spaces).   path = |  a text block (indented lines)
  path += value  append to a list.  path -  remove.   path :: range 0 10 1 | choice a|b|c   " words  say one short line
  functions: sum avg min max count round floor ceil abs clamp mod len join upper lower pct text if(c, a, b) hm at
    where(xs, "k", v) match(xs, q) sort(xs, "k", desc) take skip rev pluck(xs, "k") uniq tally(xs, "k") sumby(xs, "k", "v")
    range(a, b) first last nth keys vals get contains split trim replace slice fixed money(x, "€") num not
    today() days(a, b) adddays(d, n) weekday(d) sin cos atan2 pow sqrt pi() lerp hsl(h, s, l).  list.*.field gathers a column.
CLAUDE BLOCKS: a workspace of pages, like Notion, in which every block is a live cell.
  A PAGE is a top-level scope (snake_case name): title = "…", icon = "🧭" (one emoji), parent = "other_page" (makes it a sub-page),
  cover = "clay" | "ocean" | "sage" | "dusk" | "sand" | "night" | "rose" | "mint" (optional).
  Its other cells are its PROPERTIES: the page's data and live formulas. Its BODY is the view block page.ui:, one block per line, top to bottom.
  PROSE BLOCKS (people edit these in place; their text is light markdown):
    p "text"   h1 "…"   h2 "…"   h3 "…"   bullet "…"   numbered "…"   todo "…", done: false   quote "…"   code "…"   divider
    callout "…", icon: "💡", tone: "good" | "warn" | "bad" | "accent"
    fold "title"  with blocks indented below it (a toggle that opens)
    columns  with col blocks indented below it, each col holding blocks
    page "other_page"  a link card to another page (sub-pages get one on their parent)      toc  the page's headings
    In text: **bold** *italic* \`code\` ~~struck~~ [label](https://…) [[page_name]] (a link to a page)
    and {formula}: a live value inside a sentence, e.g. p "{days} days for {people} people: €{per_person} each". Wherever prose states a
    number or fact the page knows, write it as {…} so it stays true. Inside braces, names resolve from the page (other pages by full path).
    Any prose block also takes color: and bg: with gray brown orange yellow green blue purple pink red.
  LIVE BLOCKS: every Fruit element below is a block too, between prose blocks in the same ui: list.
  DATABASES are lists of records in a cell (tasks: then 0 = {name: "…", status: "todo", due: "2026-11-02"}, 1 = …), shown by
    table / board (by: a field) / calendar (date:) / timeline (at:) / cards (title:, body:) / bars blocks. Several blocks may show one list.
FRUIT: each block line is an element: kind args -> action
  args: positional first, then key: value, comma separated; every arg is a live expression. Indent (two spaces) to nest children.
  A bare name in an input binds it two-way (slider days writes days).
  -> runs Hypha lines when used, values taken at that moment: button "Add" -> items += {text: draft, done: false}; draft = ""
     ask "…" in an action hands a request to Claude.  ?"intent" alone on a line is a hole: a Claude block another Claude writes.
  layout   col row grid(cols) stack card(title) section(title) tabs > tab(title) split(ratio) scroll(h) box spacer divider
  text     md code note(text, title, tone) badge kbd
  numbers  stat(of, label, unit, pre, sub) progress(of, max, label) gauge(of, max) spark(of, y)
  inputs   slider(of, min, max, step) num field(of, placeholder) area toggle check choice(of, options: "a|b") select date stars color button(label) ask
  records  table(of, cols: "a|b|c", total: true) list(of, text) checklist(of, text, done) board(of, by, cols: "todo|doing|done", title, meta)
           cards(of, title, body, meta, tint) timeline(of, at, label, done) calendar(of, date, label) cells(of) json(of)
  charts   bars(of, x, y, dir: "h") trend(of, x, y: "a|b") pie(of, x, y) donut(of, x, y, label, unit)
  logic    each NAME in LIST (children repeat; NAME is the item, its fields NAME.field) · when COND (children show while true) · embed PAGE
  more     disclosure accordion dialog sheet popover menu > item avatar breadcrumb skeleton radio combobox carousel; tip: "…" on any element
  functions fn.NAME(a, b) = expression   then NAME(x, y) in any formula, view or action.
  tokens   theme.accent theme.ink theme.paper theme.card theme.line theme.good theme.bad theme.warn = "#hex" · theme.radius · theme.font
  components  lib.NAME: about = "…" · takes = "of, label" · example = {…} · ui: (its elements). Then NAME x, "Hi" is a block anywhere.
  media    video SRC · audio SRC · image SRC · file F (a file record) · upload CELL · camera CELL
  time     clock.now clock.time clock.date clock.weekday clock.hour: live. dur(ms) timeof(ms) dateof(ms) ago(then, clock.now).
           jobs.NAME = {every: "daily 08:00" | "every 15 min" | "weekdays 09:30", run: "Hypha lines", ask: "a request to Claude"}
  programs page.run = | then JavaScript, indented; page.run :: program; a block: program run. In it: await read(name) · set(name, v)
           · write(lines) · watch(name, fn) · every(ms, fn) · await sleep(ms) · print(…) · await ask(q). For loops, simulations, timers.
  web      browser URL_CELL, text: CELL, h: 460   the person's own browser shown live; Capture puts the page's text into the text: cell.
           ?"intent" @browser   a Claude block whose filler may search and read the web.
  draw     draw(w, h, bg, grid) holding rect circle ellipse line arrow path poly text group; drag: true on shapes whose x, y are places.
  any      tone: accent|muted|good|bad|warn  w h minw maxw pad gap grow align justify bg color size bold center hide
  e.g.
  trip:
    title = "Lisbon in May"
    icon = "🇵🇹"
    days = 5
    people = 2
    nightly = 120
    total = nightly * (days - 1)
    per_person = round(total / people)
    ui:
      p "A long weekend in Alfama. {days} days for {people}: about €{per_person} each for the flat."
      slider days, min: 2, max: 14, label: "Days"
      h2 "To do"
      todo "Book the flat", done: true
      todo "Train to Sintra", done: false
      ?"three dinners in Alfama worth booking, as bullet blocks with one line each"
RULES
- Output only Hypha lines: no fences, no markdown outside strings, no prose outside " lines.
- One page per top-level scope. Data first, then ui:. Words go in prose blocks; numbers and controls in live blocks; say numbers in prose with {…}.
- Prefer formulas over numbers you computed; read other pages (trip.total) rather than copying them.
- A ui: block replaces the page's whole body. To add a block after the others, write page.ui.N is … with N above the last index in the tree
  (each block's path is in the # comment after it); to change one block write page.ui.N is …; to remove one, page.ui.N -.`;
const Claude = {
  ctl: null,
  stop() { if (this.ctl) this.ctl.abort(); },
  async ask(request, opts = {}) {
    if (!S.sample) { toast(S.db ? "This view has no Claude of its own. Ask in the chat instead: it writes into this workspace." : "Asking Claude works when this page is open inside Claude."); return; }
    if (S.readOnly) return toast("You can read this workspace but not change it.");
    if (S.claudeBusy) { toast("Claude is still writing. Wait a moment, or press Stop."); return; }
    if (S.view !== S.K) Time.now();
    S.claudeBusy = true; schedule();
    const K = S.K, id = S.U + ":claude", app = opts.app && K.exists(opts.app) ? opts.app : null, node = opts.node && K.exists(opts.node) ? opts.node : null;
    ensurePeer(K, id, { can: app && !opts.newPages ? [app, app + ".*"] : ["*"] }); S.busy.add(id); schedule();
    const t0 = performance.now(); let first = 0;
    const before = new Set(Pages.list(K));
    const st = new M.Stream(K, id, { onOp: () => { if (!first) first = performance.now() - t0; } });
    const run = Agent.note(request, "Claude");
    const focus = node || app || S.page || null;
    const prompt = [
      "You are Claude, one peer in Claude Blocks: a workspace of pages, like Notion, where every block is a live cell in one log that people and Claudes write together. The person watches your lines land in their page as you write them.", "", REF(), "", window.CC5Spore ? CC5Spore.prompt().replace(/give its app desk\.[^.]*\./, "").replace(/desk/g, "workspace") : "",
      K.isBranch("fn") ? `FUNCTIONS: ${K.children("fn").filter(n => (K.cells.get("fn." + n) || {}).kind === "fn").map(n => `${n}(${K.cells.get("fn." + n).params.join(", ")})`).join(" · ")}` : "",
      CC5Lego.Lib.names(K).length ? `THE LIBRARY HAS: ${CC5Lego.Lib.names(K).map(n => `${n}(${K.takesOf(n).join(", ")})${CC5Lego.Lib.about(K, n) ? " " + CC5Lego.Lib.about(K, n) : ""}`).join(" · ")}. Use these components where they fit.` : "",
      "SHAPE FIRST. Write the structure in one pass: the page's data with formulas, then its ui: blocks. For parts that need real thought or many words (paragraphs, research, long lists of ideas, rows of real data), write a Claude block instead: a hole line ?\"…precise intent…\" in ui:. Other Claudes fill every hole in parallel the moment you stop: do not fill them yourself. Make pages good to read and use: a short opening line, headings, real example content.",
      "", "THE WORKSPACE NOW (pages print as scopes; ui: blocks list each block with its path as a # comment; '# →' shows formula values)", K.toHyphaWithin(60000, focus, { paths: true }) || "(empty: no pages yet)", "",
      S.page && K.exists(S.page) ? `THE PERSON IS ON THE PAGE: ${S.page} (${Pages.title(S.page, K)})` : "",
      app && !opts.newPages ? `WRITE ONLY INSIDE ${app}: every path must start with ${app}. Change what the request is about and keep the rest.` : "To add a page, write a new top-level scope with a fresh name (give it parent = \"" + (S.page || "") + "\" when it belongs under the open page). To change a page, write only what changes.",
      node ? `THE REQUEST IS ABOUT THE BLOCK ${node} (${K.nodeLine(node)}). Rewrite it with "${node} is …", or replace it with a group "${node}:" holding new blocks. Write data it needs under ${pageOf(node)}, above.` : "",
      opts.askedFrom ? `IT WAS ASKED FROM A BUTTON IN ${opts.askedFrom}.` : "",
      `THE PERSON ASKS: ${request}`,
    ].filter(x => x !== "").join("\n");
    this.ctl = new AbortController(); let prev = 0;
    const images = await pictures(app || (S.page && K.exists(S.page) ? S.page : null));
    try {
      await S.sample(prompt + (images.length ? `\n(${images.length} picture${images.length > 1 ? "s" : ""} from that page ${images.length > 1 ? "are" : "is"} attached.)` : ""), { cache: false, modelTier: "default", signal: this.ctl.signal, ...(images.length ? { images } : {}), onText: ({ text }) => { if (!text || text === "Thinking...") return; if (text.length > prev) { st.feed(text.slice(prev)); prev = text.length; } } });
    } catch (e) {
      if (e && e.code === "not_granted") { S.sample = null; toast("Claude is not available in this view."); }
      else if (e && e.code === "rate_limited") toast("Claude is busy. Try again in a moment.");
      else if (!(e && (e.name === "AbortError" || e.code === "aborted"))) toast("Claude could not answer: " + ((e && e.message) || "error"));
    }
    st.end(); S.busy.delete(id); this.ctl = null; S.claudeBusy = false; schedule();
    const made = st.ops.filter(o => o.ok && o.stmt.k === "set" && o.stmt.ast && o.stmt.ast.k === "hole").map(o => o.path);
    const bad = st.ops.filter(o => !o.ok).length, fresh = Pages.list(S.K).filter(p => !before.has(p));
    run.done(`${st.ops.length} ops in ${secs(performance.now() - t0)}${first ? ` · first line after ${secs(first)}` : ""}${fresh.length ? ` · made ${fresh.map(p => Pages.title(p, S.K)).join(", ")}` : ""}${made.length ? ` · ${made.length} Claude block${made.length > 1 ? "s" : ""} to write` : ""}${bad ? ` · ${bad} rejected` : ""}`, st.ops.filter(o => !o.ok).slice(0, 4).map(o => `${o.text} → ${o.err}`));
    if (fresh.length && (!S.page || !Pages.exists(S.page) || opts.newPages)) Nav.go(fresh[0]);
    Net.changed();
    if (made.length) await fillHoles(made, { t0 });
  },
};
/* the one door for the web into the shared tree: asked once a visit */
const Web = {
  allowed: false,
  ask() {
    if (this.allowed) return Promise.resolve(true);
    return new Promise(res => {
      let bar = $("#consent"); if (bar) bar.remove();
      bar = document.createElement("div"); bar.id = "consent"; bar.className = "consent"; bar.setAttribute("role", "alertdialog"); bar.setAttribute("aria-label", "Let Claude browse");
      bar.innerHTML = `<p><b>Let Claude browse the web to write this?</b> It uses the browser in your Claude desktop app. What it finds goes into this workspace, and everyone who can open it will see that.</p><div class="row"><button class="btn primary" type="button" data-a="yes">Allow for this visit</button><button class="btn" type="button" data-a="no">Not now</button></div>`;
      document.body.appendChild(bar); bar.querySelector("[data-a=yes]").focus();
      bar.addEventListener("click", e => { const a = e.target.closest("[data-a]"); if (!a) return; bar.remove(); if (a.dataset.a === "yes") { this.allowed = true; res(true); } else res(false); });
      bar.addEventListener("keydown", e => { if (e.key === "Escape") { bar.remove(); res(false); } });
    });
  },
};
async function pictures(app) {
  if (!app || !S.sample) return [];
  try { const l = await S.sample.limits(); if (!l || !l.images) return []; } catch (e) { return []; }
  const found = [], walk = v => { if (found.length >= 3 || v == null || typeof v !== "object") return; if (!Array.isArray(v) && (v.kind === "image") && typeof v.url === "string") { found.push(v.url); return; } for (const x of Object.values(v)) walk(x); };
  walk(S.K.valueAt(app));
  const out = [];
  for (const u of found) { try { const b = await (await fetch(u)).blob(); if (b.size < 5e6) out.push(b); } catch (e) { } }
  return out;
}
/* claims: one filler per hole, whoever's Claude it is */
const Claims = {
  mine: new Map(),
  key(path) { return path.length < 180 ? path : "h" + hash32(path).toString(36); },
  heldByOther(path) { for (const o of Presence.others.values()) if (o.claims[path]) return o.claims[path]; return null; },
  holder(path) { return this.mine.get(path) || this.heldByOther(path); },
  async take(path, peer) {
    if (this.mine.has(path) || this.heldByOther(path)) return false;
    this.mine.set(path, peer);
    if (S.db && !S.readOnly) {
      try { const r = await S.db.doc("claims/" + this.key(path).replace(/\//g, "_")).acquire({ holder: `${S.U}-${Net.tab}`, ttlMs: 120000 }); if (!r.acquired) { this.mine.delete(path); return false; } }
      catch (e) { if (Net.denied(e)) { this.mine.delete(path); return false; } }
    }
    Net.presence(); schedule(); return true;
  },
  drop(path) { if (!this.mine.delete(path)) return; Net.presence(); schedule(); },
};
async function fillHoles(paths, opts = {}) {
  if (S.view !== S.K) Time.now();
  paths = (paths || S.K.holes().map(x => x.path)).filter(p => S.K.cells.has(p) && S.K.cells.get(p).kind === "hole");
  if (!paths.length) return;
  if (!S.sample) { toast(S.db ? "There is no Claude in this view to write it. Ask Claude in the chat to fill the holes on this page, or write it yourself: you are a peer too." : "Claude blocks are written by Claude when this page is open inside Claude."); return; }
  const t0 = opts.t0 || performance.now(), PAR = 4, queue = paths.slice(); let n = 0, skipped = 0;
  const run = Agent.note(`${paths.length} Claude block${paths.length > 1 ? "s" : ""}`, "fill");
  const worker = async slot => {
    while (queue.length) {
      const p = queue.shift(); let c = S.K.cells.get(p); if (!c || c.kind !== "hole") continue;
      const id = `${S.U}:f${slot}`;
      if (!(await Claims.take(p, id))) { skipped++; continue; }
      c = S.K.cells.get(p); if (!c || c.kind !== "hole") { Claims.drop(p); continue; }
      const app = pageOf(p), view = M.isViewPath(p);
      ensurePeer(S.K, id, { can: view ? [p, p + ".*", app, app + ".*"] : [p, p + ".*"] }); S.busy.add(id); schedule();
      const st = new M.Stream(S.K, id); let prev = 0;
      const web = (c.via || []).some(v => v === "browser" || v === "web") && S.mcp && window.CC5Browser && await Web.ask();
      const tools = web ? window.CC5Browser.tools(slot) : null;
      const prompt = [
        "You are one of several Claudes writing Claude blocks in Claude Blocks (a Notion-like workspace of live pages) at the same time. Each of you writes one block.", "", REF(), "",
        `WRITE EXACTLY ONE CLAUDE BLOCK: ${p}`, `ITS INTENT: ${c.intent || "(none given; infer it from the page)"}`,
        view ? `It is a slot in the page ${app} (${Pages.title(app, S.K)}). Write "${p}:" and below it, indented two spaces, the blocks that fill it: prose blocks (p, h2, h3, bullet, numbered, todo, callout, quote, fold) for words, live blocks for numbers and controls. Use {…} in prose for values the page knows. If they need data that does not exist yet, write that data first, before "${p}:", as full paths under ${app} (e.g. ${app}.ideas = [...]). Do not write other blocks of the page.`
             : `Every line you write must write ${p} or a path below it. For text use "${p} = |" and indented lines; for rows use a scope "${p}:" with "0 = {…}" lines; for one value write "${p} = …". Use formulas with full paths from the root when the value depends on other cells.`,
        tools ? "YOU MAY LOOK THINGS UP on the web with web_search and web_read (the person's own browser). Search first, read one or two pages that matter, then write the Hypha lines. Put in only what the block needs, with the source as a [label](url) link in the text where it helps: everyone who opens this workspace will see it." : "",
        "Be concise and concrete. No fences, no \" lines.", "", "THE WORKSPACE NOW", S.K.toHyphaWithin(24000, p, { paths: true }),
      ].join("\n");
      try { await S.sample(prompt, { cache: false, modelTier: tools ? "default" : "quick", ...(tools ? { tools } : {}), onText: ({ text }) => { if (!text || text === "Thinking...") return; if (text.length > prev) { st.feed(text.slice(prev)); prev = text.length; } } }); }
      catch (e) { if (e && e.code === "rate_limited") { toast("Claude is busy; some Claude blocks stay open."); queue.length = 0; } }
      st.end(); n++; S.busy.delete(id); Claims.drop(p); schedule();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAR, paths.length) }, (_, i) => worker(i + 1)));
  run.done(`${n} written by ${Math.min(PAR, paths.length)} Claude${Math.min(PAR, paths.length) > 1 ? "s" : ""} in parallel${skipped ? ` · ${skipped} taken by someone else's Claude` : ""} · ${secs(performance.now() - t0)}`);
  Net.changed();
}

/* ---------- the log, and time: the workspace at any op is the fold of the log up to it ---------- */
const hlLine = t => esc(t).replace(/^([\w.]+)/, '<b>$1</b>');
const History = {
  els: new Map(), queue: [], rafId: 0,
  row(op) {
    const say = op.stmt && op.stmt.k === "say", el = document.createElement("div");
    el.className = "op" + (op.ok ? "" : " bad") + (say ? " say" : ""); el.style.setProperty("--c", colorOf(op.peer));
    el.title = `${nameOf(op.peer)} · ${new Date(op.at).toLocaleTimeString()}`;
    el.innerHTML = `<i></i><span class="n">${op.clock}</span><span class="t">${say ? esc(nameOf(op.peer) + ": " + op.stmt.text) : hlLine(op.text)}${op.ok ? "" : `<span class="why">${esc(op.err || "")}</span>`}</span>`;
    return el;
  },
  open() { return S.panel === "history"; },
  near() { const l = $("#log"); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; },
  add(op) { if (!this.open()) return; this.queue.push(op); if (!this.rafId) this.rafId = requestAnimationFrame(() => this.drain()); },
  drain() {
    this.rafId = 0; const q = this.queue; this.queue = []; if (!q.length) return;
    const l = $("#log"), stick = this.near(), frag = document.createDocumentFragment();
    for (const op of q.slice(-500)) {
      const el = this.row(op);
      if (op.replaces && this.els.has(op.replaces)) { const old = this.els.get(op.replaces); if (old.parentNode) old.remove(); this.els.delete(op.replaces); }
      if (q.length < 40) el.classList.add("fresh");
      frag.appendChild(el); this.els.set(op.id, el);
    }
    l.insertBefore(frag, $("#ghosts"));
    while (this.els.size > 500) { const [id, e] = this.els.entries().next().value; e.remove(); this.els.delete(id); }
    if (stick) l.scrollTop = l.scrollHeight;
  },
  rebuild() {
    const l = $("#log"); if (!l) return; l.innerHTML = '<div id="ghosts"></div>'; this.els.clear();
    if (!this.open()) return;
    for (const op of S.K.log.slice(-500)) { const el = this.row(op); l.insertBefore(el, $("#ghosts")); this.els.set(op.id, el); }
    l.scrollTop = l.scrollHeight; this.ghosts();
  },
  ghosts() {
    const g = $("#ghosts"); if (!g || !this.open()) return;
    g.innerHTML = [...S.K.intents.entries()].filter(([, it]) => it.text || it.path).map(([id, it]) => {
      const text = it.append ? `${it.path} &= "${it.text}` : it.op === "is" && it.view ? `${it.path} is ${it.text}` : it.op ? `${it.path} ${it.op} ${it.text}` : it.text;
      return `<div class="op ghost" style="--c:${colorOf(id)}" title="${esc(nameOf(id))} is writing this line"><i></i><span class="n">…</span><span class="t">${esc(text)}</span></div>`;
    }).join("");
  },
};
const Time = {
  init() { $("#scrub").addEventListener("input", e => { const n = +e.target.value; if (n >= S.K.log.length) this.now(); else this.go(n); }); $("#past-now").addEventListener("click", () => this.now()); },
  extend() { const r = $("#scrub"); const at = +r.value, end = S.timeIdx == null; r.max = S.K.log.length; r.value = end ? r.max : at; },
  sync() { const r = $("#scrub"); r.max = S.K.log.length; if (S.timeIdx == null) { r.value = r.max; $("#scrub-out").textContent = "now"; } $("#history").hidden = !Net.base; },
  go(n) {
    Ed.blur();
    S.themeDirty = true; S.timeIdx = n; S.view = S.K.replay(n); if (window.CC5Computer) { const op = S.K.log[Math.max(0, n - 1)]; CC5Computer.Clock.apply(S.view, op && op.at ? op.at : Date.now()); }
    $("#scrub").max = S.K.log.length; $("#scrub").value = n; const op = S.K.log[Math.max(0, n - 1)];
    $("#scrub-out").textContent = `op ${n} of ${S.K.log.length}`;
    $("#past").hidden = false; $("#past-txt").textContent = `The workspace as it was at op ${n}${op && op.at ? ", " + new Date(op.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}${op ? " · " + nameOf(op.peer) : ""}`;
    let i = 0; for (const o of S.K.log) { const el = History.els.get(o.id); if (el) el.classList.toggle("future", i >= n); i++; }
    schedule();
  },
  now() {
    S.themeDirty = true; S.timeIdx = null; S.view = S.K; $("#scrub").value = $("#scrub").max = S.K.log.length; $("#scrub-out").textContent = "now"; $("#past").hidden = true;
    for (const el of History.els.values()) el.classList.remove("future");
    schedule();
  },
};

/* ---------- the store, the room, and the chat Claude's channel ----------
   chunks/{id}     { by, tab, seq, at, n, ops: [[id, peer, clock, text, at]] }  each open tab appends to its own chunk
   meta/snap       { id, at, clock, parts, folded }  the latest checkpoint;  snaps/{id}-{i} its parts
   Live: ops also travel as room messages on the "ops" topic; the store dedupes them by op id. */
function use(name) { if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null); return window.claude.use(name).catch(() => null); }
const CHUNK_OPS = 500, CHUNK_BYTES = 150000, PART_BYTES = 180000, SNAP_EVERY = 3000, MARGIN = 15 * 60 * 1000;
const Net = {
  tab: Math.random().toString(36).slice(2, 8), seq: 0, mine: null, writing: false, flushT: 0, flushFirst: 0,
  raw: new Map(), base: null, folded: {}, sinceSnap: 0, roomBuf: [], emitQ: [], emitT: 0, open: new Map(),
  async start() {
    if (!window.claude || typeof window.claude.use !== "function") { S.mode = "memory"; this.status(); this.memoryStart(); return; }
    S.mode = "connecting"; this.status();
    const [db, user, room, sample, mcp, assets, downloads] = await Promise.all([use("db"), use("user"), use("room"), use("sample"), use("mcp"), use("assets"), use("downloads")]);
    S.sample = sample; S.room = room; S.user = user; S.mcp = mcp; S.assets = assets; S.downloads = downloads; if (window.CC5Browser) window.CC5Browser.setMcp(mcp);
    if (user) { try { const me = await user.me(); if (me && me.id) { S.userId = me.id; S.U = "u" + hash32(me.id).toString(36); S.uMap[S.U] = me.id; S.profiles[me.id] = { name: me.name || "You" }; } } catch (e) { } }
    if (db && user && typeof user.isOwner === "function") { try { S.isOwner = !!(await user.isOwner()); } catch (e) { S.isOwner = false; } } else if (db) S.isOwner = false;
    if (!db || !S.userId) { S.mode = "memory"; this.status(); this.memoryStart(); schedule(); return; }
    S.db = db; S.mode = "db"; S.loaded = false;
    try { if (user && typeof user.can === "function" && (await user.can("data.write")) === false) S.readOnly = true; } catch (e) { }
    const K = new M.Kernel(); setKernel(K); Time.sync(); this.status();
    if (room) { room.onPeers(ch => this.peers(ch.peers || [])); room.on("ops", m => this.heard(m), () => { }); this.presence(); }
    try { await this.load(); } catch (e) { console.warn(e); toast("Could not open the shared log. Reload to try again."); }
    this.channel(); this.status(); schedule();
  },
  /* outside Claude there is no store: the workspace lives in this tab, and opens on the example */
  memoryStart() { S.loaded = true; if (!Pages.list(S.K).length) Seed.play(true); },
  status() {
    const el = $("#status"); if (!el) return;
    el.className = S.mode === "db" && S.loaded ? "live" : "";
    el.textContent = S.mode === "db" ? (S.loaded ? (S.readOnly ? "Shared · view only" : "Shared · live") : "Opening the log…") : S.mode === "connecting" ? "Opening…" : "In this tab · not saved";
  },
  async load() {
    const db = S.db;
    const ptr = await db.doc("meta/snap").get().catch(() => null), snap = ptr && ptr.exists ? ptr.data() : null;
    if (snap && snap.id && snap.parts) {
      const parts = await Promise.all(Array.from({ length: snap.parts }, (_, i) => db.doc(`snaps/${snap.id}-${i}`).get()));
      if (parts.every(p => p.exists)) {
        const cp = { clock: snap.clock || 0, ops: [], stamps: [] };
        for (const p of parts) { const d = p.data() || {}; cp.ops.push(...(d.ops || [])); cp.stamps.push(...(d.stamps || [])); }
        for (const [peer] of cp.ops) ensurePeer(S.K, peer);
        S.K.restore(cp, snap.id); this.base = { id: snap.id, at: snap.at, cp }; this.folded = snap.folded || {};
      }
    }
    let q = db.collection("chunks"); if (this.base) q = q.where("at", ">=", this.base.at - MARGIN);
    await new Promise(res => {
      let first = true;
      q.onSnapshot(sn => {
        const fresh = [];
        for (const ch of sn.docChanges()) {
          if (ch.type === "removed") continue;
          const d = ch.doc.data() || {}, ops = Array.isArray(d.ops) ? d.ops : [];
          this.raw.set(ch.doc.id, { at: +d.at || 0, ops, by: d.by });
          const f = this.folded[ch.doc.id];
          ops.forEach((o, i) => {
            if (!Array.isArray(o) || typeof o[3] !== "string") return;
            if (f && (i < f[0] - 1 || (i === f[0] - 1 && o[0] === f[1]))) return;
            if (S.K.seen.has(o[0]) || !this.owns(d.by, o[1])) return;
            fresh.push({ id: o[0], peer: o[1], clock: +o[2] || 0, text: o[3], at: +o[4] || 0, by: d.by });
          });
        }
        this.apply(fresh, true);
        if (first) { first = false; this.loaded(); res(); }
      }, e => { console.warn(e); toast("Lost the connection to the shared log. Reload to reconnect."); res(); });
    });
  },
  owns(by, peer) { if (!by || typeof peer !== "string") return true; const u = roleOf(peer).u; return u === "u" + hash32(by).toString(36); },
  apply(list, sort) {
    if (!list.length) return;
    if (sort) list.sort((a, b) => (a.clock - b.clock) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    const K = S.K; K.batch(() => { for (const d of list) { if (d.by) S.uMap[roleOf(d.peer).u] = d.by; ensurePeer(K, d.peer); K.receive({ id: d.id, peer: d.peer, clock: d.clock, text: String(d.text), at: d.at || Date.now() }); } });
    this.sinceSnap += list.length; this.resolveNames(); schedule();
  },
  loaded() {
    S.loaded = true; Time.sync(); this.status();
    const buf = this.roomBuf; this.roomBuf = []; for (const m of buf) this.heard(m);
    this.maybeCheckpoint(); this.changed();
    Nav.restore(); schedule();
  },
  denied(e) {
    if (e && (e.code === "invalid_argument" || e.code === "not_granted")) { if (!S.readOnly) { S.readOnly = true; toast("You can read this workspace but not change it. Ask for Contributor access in the Share menu."); this.status(); schedule(); } return true; }
    return false;
  },
  newChunk() { const c = { id: `c-${S.U}-${this.tab}-${this.seq++}`, ops: [], bytes: 0, ver: 0, saved: 0, last: Date.now() }; this.open.set(c.id, c); this.mine = c; return c; },
  onOp(op) {
    if (!S.db || op.remote || !op.ok || op.stmt.k === "err" || op.stmt.k === "at") return;
    const row = [op.id, op.peer, op.clock, op.text, op.at], size = JSON.stringify(row).length + 1;
    let c = this.mine;
    if (!c || c.ops.length >= CHUNK_OPS || c.bytes + size > CHUNK_BYTES || Date.now() - c.last > 5 * 60 * 1000) c = this.newChunk();
    if (op.replaces) for (let i = c.ops.length - 1; i >= Math.max(0, c.ops.length - 6); i--) if (c.ops[i][0] === op.replaces) { c.bytes -= JSON.stringify(c.ops[i]).length + 1; c.ops.splice(i, 1); break; }
    c.ops.push(row); c.bytes += size; c.ver++; c.last = Date.now();
    if (!this.open.has(c.id)) this.open.set(c.id, c);
    this.sinceSnap++;
    this.send(row, op.replaces);
    const now = performance.now(); if (!this.flushFirst) this.flushFirst = now;
    clearTimeout(this.flushT); this.flushT = setTimeout(() => this.flush(), now - this.flushFirst > 1000 ? 0 : 250);
    this.changed();
  },
  async flush() {
    this.flushFirst = 0;
    if (this.writing || S.readOnly) return;
    this.writing = true;
    try {
      for (;;) {
        const dirty = [...this.open.values()].filter(c => c.ver !== c.saved); if (!dirty.length) break;
        for (const c of dirty) {
          const ver = c.ver, body = { by: S.userId, tab: this.tab, at: Date.now(), n: c.ops.length, ops: c.ops.slice() };
          try { await S.db.doc(`chunks/${c.id}`).set(body); c.saved = ver; }
          catch (e) { if (this.denied(e)) return; await sleep(800 + Math.random() * 1200); }
          if (c !== this.mine && c.saved === c.ver) this.open.delete(c.id);
        }
      }
    } finally { this.writing = false; }
    this.maybeCheckpoint();
  },
  send(row, replaces) {
    if (!S.room) return;
    if (replaces) { const i = this.emitQ.findIndex(r => r[0] === replaces); if (i >= 0) this.emitQ.splice(i, 1); }
    this.emitQ.push(row);
    if (!this.emitT) this.emitT = setTimeout(() => this.emit(), 50);
  },
  emit() {
    this.emitT = 0; const q = this.emitQ; this.emitQ = [];
    while (q.length) {
      const batch = []; let bytes = 20;
      while (q.length && bytes + JSON.stringify(q[0]).length < 3600) { bytes += JSON.stringify(q[0]).length + 1; batch.push(q.shift()); }
      if (!batch.length) q.shift(); else S.room.emit("ops", { ops: batch }).catch(() => { });
    }
  },
  heard(m) {
    if (!m || m.sameTab || !m.data || !Array.isArray(m.data.ops)) return;
    if (!S.loaded) { this.roomBuf.push(m); return; }
    const fresh = [];
    for (const o of m.data.ops) { if (!Array.isArray(o) || typeof o[0] !== "string" || typeof o[3] !== "string" || S.K.seen.has(o[0]) || !this.owns(m.by, o[1])) continue; fresh.push({ id: o[0], peer: o[1], clock: +o[2] || 0, text: o[3], at: +o[4] || Date.now(), by: m.by }); }
    if (fresh.length) { const K = S.K; K.batch(() => { for (const d of fresh) { if (d.by) S.uMap[roleOf(d.peer).u] = d.by; ensurePeer(K, d.peer); K.receive(d); } }); this.resolveNames(); }
  },
  async maybeCheckpoint() {
    if (!S.db || S.readOnly || !S.loaded || this.checkpointing || this.sinceSnap < SNAP_EVERY) return;
    this.checkpointing = true;
    try {
      const db = S.db, lease = await db.doc("meta/compact").acquire({ holder: "tab-" + this.tab, ttlMs: 120000 });
      if (!lease.acquired) return;
      const cur = await db.doc("meta/snap").get(), live = cur.exists ? cur.data() : null;
      if ((live && live.id) !== (this.base && this.base.id)) { this.sinceSnap = 0; return; }
      const k = new M.Kernel(); if (this.base) k.restore(this.base.cp, this.base.id);
      const rows = [], folded = {}, at = Date.now();
      for (const [id, c] of this.raw) {
        const f = this.folded[id];
        c.ops.forEach((o, i) => { if (f && (i < f[0] - 1 || (i === f[0] - 1 && o[0] === f[1]))) return; rows.push({ id: o[0], peer: o[1], clock: +o[2] || 0, text: o[3], at: +o[4] || 0 }); });
        if (c.at >= at - 2 * MARGIN && c.ops.length) folded[id] = [c.ops.length, c.ops[c.ops.length - 1][0]];
      }
      rows.sort((a, b) => (a.clock - b.clock) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
      k.batch(() => { for (const r of rows) k.receive(r); });
      const cp = k.checkpoint(), id = "s" + at.toString(36), parts = [];
      let part = { ops: [], stamps: [] }, bytes = 0;
      const push = (key, v) => { const n = JSON.stringify(v).length + 1; if (bytes + n > PART_BYTES) { parts.push(part); part = { ops: [], stamps: [] }; bytes = 0; } part[key].push(v); bytes += n; };
      for (const o of cp.ops) push("ops", o); for (const st of cp.stamps) push("stamps", st); parts.push(part);
      for (let i = 0; i < parts.length; i++) await db.doc(`snaps/${id}-${i}`).set(parts[i]);
      if (JSON.stringify(folded).length > PART_BYTES) return;
      await db.doc("meta/snap").set({ id, at, clock: cp.clock, parts: parts.length, folded, prev: live ? { id: live.id, parts: live.parts } : null });
      if (live && live.prev && live.prev.id) for (let i = 0; i < (live.prev.parts || 0); i++) db.doc(`snaps/${live.prev.id}-${i}`).delete().catch(() => { });
      this.base = { id, at, cp }; this.folded = folded; this.sinceSnap = 0;
    } catch (e) { this.denied(e); console.warn("checkpoint", e); }
    finally { this.checkpointing = false; }
  },
  async fullHistory() {
    const db = S.db; if (!db) return;
    const q = await db.collection("chunks").get(), rows = [];
    for (const d of q.docs) { const c = d.data() || {}, ops = Array.isArray(c.ops) ? c.ops : []; this.raw.set(d.id, { at: +c.at || 0, ops, by: c.by }); for (const o of ops) if (Array.isArray(o) && typeof o[3] === "string" && this.owns(c.by, o[1])) rows.push({ id: o[0], peer: o[1], clock: +o[2] || 0, text: o[3], at: +o[4] || 0, by: c.by }); }
    const K = new M.Kernel(); rows.sort((a, b) => (a.clock - b.clock) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    for (const r of rows) ensurePeer(K, r.peer);
    K.batch(() => { for (const r of rows) K.receive(r); });
    K.batch(() => { for (const op of S.K.log) if (!K.seen.has(op.id)) K.receive({ id: op.id, peer: op.peer, clock: op.clock, text: op.text, at: op.at }); });
    for (const [id, p] of S.K.peers) if (!K.peers.has(id)) K.peers.set(id, p);
    this.base = null; this.folded = {}; setKernel(K); Time.sync();
    toast(`Full history: ${rows.length} ops. Drag Time back to any of them.`);
  },
  async resolveNames() {
    if (!S.user) return;
    const ids = [...new Set(Object.values(S.uMap))].filter(id => id && !S.profiles[id]); if (!ids.length) return;
    try { const ps = await S.user.profiles(ids); for (const id of ids) S.profiles[id] = { name: (ps[id] || {}).name || "Someone" }; schedule(); History.rebuild(); } catch (e) { }
  },
  presenceT: 0,
  presence() {
    if (!S.room || this.presenceT) return;
    this.presenceT = setTimeout(() => {
      this.presenceT = 0;
      const intents = {}; let n = 0;
      for (const [id, it] of S.K.intents) if (roleOf(id).u === S.U && n++ < 6) intents[id] = { path: it.path || null, op: it.op || null, text: String(it.text || "").slice(-120), append: !!it.append, view: !!it.view };
      const claims = {}; for (const [p, peer] of Claims.mine) if (Object.keys(claims).length < 20) claims[p] = peer;
      const progs = window.CC5Computer ? CC5Computer.Programs.running().slice(0, 12) : [];
      try { S.room.presence({ u: S.userId, page: S.page, sel: Ed.focus, intents, claims, progs }).catch(() => { }); } catch (e) { }
    }, 40);
  },
  remote: new Set(),
  peers(list) {
    const now = new Set();
    for (const p of list) {
      if (p.isMe || p.kind !== "viewer") continue;
      const uid = p.by || (p.presence && p.presence.u); if (!uid) continue;
      const u = "u" + hash32(uid).toString(36); S.uMap[u] = uid; ensurePeer(S.K, u + ":you");
      const its = (p.presence && p.presence.intents) || {};
      for (const [id, it] of Object.entries(its)) { if (roleOf(id).u !== u) continue; ensurePeer(S.K, id); now.add(id); S.K.setIntent(id, it && (it.path || it.text) ? it : null); }
    }
    for (const id of this.remote) if (!now.has(id)) S.K.setIntent(id, null);
    this.remote = now; this.resolveNames(); Presence.from(list); schedule();
  },
  /* the chat Claude: reads a view of the workspace, writes turns that stream in as its peer */
  viewT: 0,
  changed() { if (!S.db || !S.userId) return; clearTimeout(this.viewT); this.viewT = setTimeout(() => this.writeView(), 1500); },
  async writeView() {
    const K = S.K, focus = Ed.focus || S.page;
    const view = {
      asOf: Date.now(), next: "t" + Date.now(),
      how: "You are a peer in Claude Blocks, a Notion-like workspace of live pages written in Hypha. Read 'tree' (every page as a scope; its ui: block lists the page's blocks with each block's path as a '# page.ui.N' comment; '# →' gives formula values). Write ONE turn: ArtifactData set, collection \"data/users/me/blocks/turns\", doc_id <next>, data { text: <Hypha lines> }. Lines apply as they arrive. Shape first: write Claude blocks (holes, ?\"intent\" lines in ui:) for long parts; the person's page writes them in parallel. The full language is in the page's source comment.",
      tree: K.toHyphaWithin(120000, focus, { paths: true }),
      pages: Pages.list(K).map(p => ({ name: p, title: Pages.title(p, K), parent: Pages.parent(p, K) || null, blocks: K.exists(p + ".ui") ? K.children(p + ".ui").filter(isNum).length : 0 })),
      holes: K.holes().map(x => ({ path: x.path, intent: x.intent })),
      focus: { page: S.page || null, block: Ed.focus || null, line: Ed.focus && K.exists(Ed.focus) ? K.nodeLine(Ed.focus) : null },
      recent: K.log.slice(-30).map(o => `${nameOf(o.peer)}: ${o.text}${o.ok ? "" : "  (rejected: " + o.err + ")"}`),
      last: S.lastChat || null,
      people: Presence.people().map(o => ({ name: nameOf(o.id), on: o.page || null })),
    };
    try { await S.db.doc(`data/users/${S.userId}/blocks`).set(view); } catch (e) { }
  },
  channel() {
    const base = `data/users/${S.userId}/blocks/turns`, done = new Set();
    S.db.collection(base).onSnapshot(async snap => {
      for (const d of snap.docs) {
        const t = d.data() || {}; if (t.applied || done.has(d.id) || typeof t.text !== "string") continue;
        done.add(d.id);
        try {
          const lease = await S.db.doc(`${base}/${d.id}`).acquire({ holder: "tab" + Math.random().toString(36).slice(2), ttlMs: 60000 });
          if (!lease.acquired) continue;
          const cur = await S.db.doc(`${base}/${d.id}`).get(); if (!cur.exists || (cur.data() || {}).applied) continue;
          if (S.view !== S.K) Time.now();
          const id = S.U + ":chat", before = new Set(Pages.list(S.K)); ensurePeer(S.K, id); S.busy.add(id); schedule();
          const run = Agent.note("A turn from Claude in chat", "chat");
          const st = new M.Stream(S.K, id);
          const text = t.text + "\n"; for (let i = 0; i < text.length; i += 160) { st.feed(text.slice(i, i + 160)); await sleep(16); }
          st.end(); S.busy.delete(id); schedule();
          const bad = st.ops.filter(o => !o.ok), fresh = Pages.list(S.K).filter(p => !before.has(p));
          S.lastChat = { id: d.id, at: Date.now(), ops: st.ops.length, errors: bad.map(b => `${b.text} → ${b.err}`).slice(0, 12) };
          await S.db.doc(`${base}/${d.id}`).update({ applied: S.lastChat });
          run.done(`${st.ops.length} ops${bad.length ? `, ${bad.length} rejected` : ""}${fresh.length ? ` · made ${fresh.map(p => Pages.title(p, S.K)).join(", ")}` : ""}`);
          if (fresh.length && (!S.page || !Pages.exists(S.page) || !st.ops.some(o => o.ok && o.path && pageOf(o.path) === S.page))) Nav.go(fresh[0]);
          else { const touched = st.ops.find(o => o.ok && o.path && Pages.exists(pageOf(o.path))); if (touched && !Pages.exists(S.page)) Nav.go(pageOf(touched.path)); }
          const made = st.ops.filter(o => o.ok && o.stmt.k === "set" && o.stmt.ast && o.stmt.ast.k === "hole").map(o => o.path);
          if (made.length && S.sample) fillHoles(made);
          this.changed();
        } catch (e) { console.warn("turn", e); }
      }
    }, e => console.warn("turns", e));
  },
};

/* ---------- presence: who is on which page, and in which block ---------- */
const txt = (x, n = 300) => (typeof x === "string" && x.length <= n ? x : null);
const Presence = {
  others: new Map(),
  from(list) {
    const seen = new Set();
    for (const p of list) {
      if (p.isMe || p.kind !== "viewer") continue;
      const pr = p.presence || {}, uid = p.by || txt(pr.u); if (!uid) continue;
      const u = "u" + hash32(uid).toString(36); S.uMap[u] = uid;
      const claims = {}; if (pr.claims && typeof pr.claims === "object") for (const [k, v] of Object.entries(pr.claims).slice(0, 40)) if (txt(k) && txt(v, 80) && roleOf(v).u === u) claims[k] = v;
      const progs = Array.isArray(pr.progs) ? pr.progs.filter(x => txt(x)).slice(0, 12) : [];
      this.others.set(p.peer, { peer: p.peer, uid, id: u + ":you", page: txt(pr.page, 80), sel: txt(pr.sel), claims, progs });
      seen.add(p.peer);
    }
    for (const k of [...this.others.keys()]) if (!seen.has(k)) this.others.delete(k);
  },
  people() { const by = new Map(); for (const o of this.others.values()) if (!by.has(o.uid)) by.set(o.uid, o); return [...by.values()]; },
  on(page) { return this.people().filter(o => o.page === page); },
  at(path) { return this.people().find(o => o.sel === path) || null; },
};
const Faces = {
  html() {
    const people = Presence.people(), agents = [...S.busy];
    const initials = id => { const n = id === meId() ? ((S.profiles[S.userId] || {}).name || "You") : nameOf(id); return (n.split(/\s+/).map(w => w[0]).join("").slice(0, 2) || "?").toUpperCase(); };
    const list = people.length ? [meId()].concat(people.map(o => o.id)) : [];
    return list.map(id => `<span class="face" style="--c:${colorOf(id)}" title="${esc(nameOf(id))}${id !== meId() ? " · on " + esc(Pages.exists(people.find(o => o.id === id).page) ? Pages.title(people.find(o => o.id === id).page) : "another page") : ""}">${esc(initials(id))}</span>`).join("")
      + agents.map(id => `<span class="face agent busy" style="--c:${colorOf(id)}" title="${esc(nameOf(id))} is writing">${id.endsWith(":claude") || id.endsWith(":chat") ? "✳" : (id.match(/\d+$/) || ["✳"])[0]}</span>`).join("");
  },
};

/* ---------- the computer's doors: what files, time, programs and Spore may do here ---------- */
const asPeer = role => { const id = S.U + ":" + role; ensurePeer(S.K, id); return id; };
const Host = {
  K: () => S.K,
  past: () => S.view !== S.K,
  readonly: () => S.readOnly,
  isOwner: () => S.isOwner,
  sample: () => S.sample,
  assets: () => (S.readOnly ? null : S.assets),
  downloads: () => S.downloads,
  toast,
  title: a => Pages.exists(a, S.K) ? Pages.title(a, S.K) : a === "lib" ? "Library" : a,
  mine: id => !!id && mine(id),
  nameOf, myName: () => (S.profiles[S.userId] || {}).name || "your",
  peer: asPeer,
  presence: () => Net.presence(),
  rerender: () => schedule(),
  write: (text, role) => { if (S.readOnly) return; const st = new M.Stream(S.K, asPeer(role || "clock")); st.feed(text + "\n"); st.end(); },
  writeText: text => writeText(text),
  stream: (text, peer) => { const st = new M.Stream(S.K, peer); st.feed(String(text) + "\n"); return st.end(); },
  commit: (text, peer) => { const s = M.parseStmt(text); if (s && s.k !== "err") S.K.commit(s, peer, { coalesce: true }); },
  env: (app, role) => Object.assign(envFor(app), { write: (text, o) => Host.write(text, role) }),
  ask: (text, opts) => Claude.ask(text, opts || {}),
  sampleText: async prompt => { if (!S.sample) throw new Error("no Claude in this view"); const r = await S.sample(String(prompt), { cache: false, modelTier: "quick" }); return r.text; },
  frame: () => { }, spot: () => ({ x: 0, y: 0 }),
  async save(filename, text) {
    if (!S.downloads) { navigator.clipboard.writeText(text).then(() => toast("Saving files works inside Claude. The text is on your clipboard instead."), () => toast("Saving files works inside Claude.")); return; }
    try { await S.downloads.save({ filename, data: new Blob([text], { type: "text/plain" }) }); } catch (e) { if (!(e && e.code === "declined")) toast("Could not save: " + (e.message || e.code)); }
  },
  theme: Theme, colorTokens: COLOR_TOKENS, fonts: FONTS,
  goto(path) { const a = pageOf(path); if (a === "lib") return Nav.go("@lib"); if (Pages.exists(a)) { Nav.go(a); Ed.flash(path); } },
  install(text) {
    const before = new Set(Pages.list(S.K)), libBefore = new Set(CC5Lego.Lib.names(S.K));
    const ops = writeText(text) || [];
    const made = Pages.list(S.K).filter(a => !before.has(a)), comps = CC5Lego.Lib.names(S.K).filter(n => !libBefore.has(n)), bad = ops.filter(o => !o.ok).length;
    if (made.length) { for (const p of made) if (S.page && !Pages.parent(p, S.K)) writeText(`${p}.parent = ${JSON.stringify(S.page)}`); Nav.go(made[0]); }
    toast(`Installed ${[made.length ? made.map(a => Pages.title(a, S.K)).join(", ") : "", comps.length ? `${comps.length} component${comps.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ") || "nothing new"}${bad ? ` · ${bad} lines did not apply` : ""}`);
  },
  runningElsewhere: path => { for (const o of Presence.others.values()) if (o.progs && o.progs.includes(path)) return nameOf(o.id); return null; },
  async lease(key, ttl) {
    if (!S.db) return true;
    try { const r = await S.db.doc("leases/" + key.replace(/[^\w.:-]/g, "_").slice(0, 180)).acquire({ holder: `${S.U}-${Net.tab}`, ttlMs: ttl }); return !!r.acquired; }
    catch (e) { Net.denied(e); return false; }
  },
};

/* ---------- structure: a block's place is a number, with room between numbers ----------
   Blocks are page.ui.N in numeric order. New blocks take a number halfway between their neighbours, so inserting
   one writes one block, not the whole page; only when two neighbours touch does that list get renumbered. */
const STEP = 1024;
const kidsOf = (K, p) => (K.cells.has(p) ? [] : K.children(p).filter(isNum).map(s => p + "." + s));
const showLit = v => M.showLit(v);
const EDITABLE = ["p", "text", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code", "fold"];
const CAN_HOLD = new Set(["p", "text", "bullet", "numbered", "todo", "quote", "callout", "fold"]);
const LISTY = new Set(["bullet", "numbered", "todo"]);
const Ops = {
  map: null,
  /* a block (and what it holds) as the lines that write it at T */
  serial(K, q, T) {
    const c = K.cells.get(q);
    if (c) return [`${T} = ${c.kind === "hole" ? K.nodeLine(q) : K.propSrc(q)}`];
    const out = [`${T} is ${K.nodeLine(q)}`];
    if (kidsOf(K, q).length) { out.push(`${T}:`); K.viewLines(q, 2, out); }
    return out;
  },
  /* the same, relative: what a person sees in "Edit as Hypha" and what copies to the clipboard */
  rel(K, q) {
    const c = K.cells.get(q);
    if (c) return [c.kind === "hole" ? K.nodeLine(q) : "text " + K.propSrc(q)];
    return [K.nodeLine(q)].concat(K.viewLines(q, 2, []));
  },
  last(c) { const ks = kidsOf(S.K, c); return ks[ks.length - 1] || null; },
  slot(c, after) {
    const ns = kidsOf(S.K, c).map(q => +M.segOf(q));
    if (!ns.length) return STEP;
    if (after == null) return ns[0] >= 2 ? Math.floor(ns[0] / 2) : null;
    const a = +M.segOf(after), i = ns.indexOf(a);
    if (i < 0 || i === ns.length - 1) return ns[ns.length - 1] + STEP;
    const b = ns[i + 1]; return b - a >= 2 ? a + Math.floor((b - a) / 2) : null;
  },
  lines(item, T) {
    if (item.from) return this.serial(S.K, item.from, T);
    const head = String(item.head).trim();
    if (head.startsWith("?")) return [`${T} = ${head}`];
    const out = [`${T} is ${head}`];
    if (item.kids && item.kids.length) { out.push(`${T}:`); for (const l of item.kids) out.push("  " + l); }
    return out;
  },
  /* renumber a list with room between; items say what goes where ({from: path} keeps a block, {head} writes one) */
  relayout(c, items) {
    const K = S.K, old = kidsOf(K, c), body = [], paths = [];
    items.forEach((it, i) => { const T = c + "." + ((i + 1) * STEP); paths.push(T); body.push(...this.lines(it, T)); });
    const from = [], to = []; items.forEach((it, i) => { if (it.from) { from.push(it.from); to.push(paths[i]); } });
    this.map = { from, to };
    writeText(old.map(q => `${q} -`).concat(body).join("\n"));
    return paths;
  },
  /* where a path went after the last renumbering */
  remap(p) {
    if (!p || !this.map) return p;
    const { from, to } = this.map;
    for (let i = 0; i < from.length; i++) { const f = from[i]; if (p === f) return to[i]; if (p.startsWith(f + ".")) return to[i] + p.slice(f.length); }
    return p;
  },
  insert(c, after, item) {
    this.map = null;
    let idx = this.slot(c, after);
    if (idx == null) { const ks = kidsOf(S.K, c); this.relayout(c, ks.map(q => ({ from: q }))); after = this.remap(after); idx = this.slot(c, after); }
    const T = c + "." + idx; writeText(this.lines(item, T).join("\n")); return T;
  },
  remove(q) { writeText(`${q} -`); },
  move(q, c2, after2) {
    this.map = null;
    if (c2 === q || c2.startsWith(q + ".") || after2 === q) return q;
    let idx = this.slot(c2, after2);
    if (idx == null) { const ks = kidsOf(S.K, c2); const keep = this.map; this.relayout(c2, ks.map(x => ({ from: x }))); q = this.remap(q); after2 = this.remap(after2); idx = this.slot(c2, after2); }
    const T = c2 + "." + idx, m0 = this.map;
    writeText([`${q} -`].concat(this.serial(S.K, q, T)).join("\n"));
    this.map = { from: (m0 ? m0.from : []).concat([q]), to: (m0 ? m0.to : []).concat([T]) };
    return T;
  },
  dup(q) { return this.insert(M.parentOf(q), q, { from: q }); },
  /* turn a block into another kind, keeping its words and colours */
  turn(q, kind) {
    const K = S.K, cur = F.kindOf(K, q), name = B.textProp(cur), c = K.cells.get(q + "." + name);
    const src = EDITABLE.includes(cur) && c ? (c.kind === "lit" ? showLit(String(c.v == null ? "" : c.v)) : c.kind === "formula" ? c.src : '""') : '""';
    const extra = [];
    for (const k of ["color", "bg"]) if (K.cells.has(q + "." + k)) extra.push(`${k}: ${K.propSrc(q + "." + k)}`);
    if (kind === "todo") extra.push(`done: ${K.cells.has(q + ".done") ? K.propSrc(q + ".done") : "false"}`);
    if (kind === "callout") extra.push(`icon: ${K.cells.has(q + ".icon") ? K.propSrc(q + ".icon") : '"💡"'}`);
    if (kind === "code" && K.cells.has(q + ".lang")) extra.push(`lang: ${K.propSrc(q + ".lang")}`);
    const head = kind === "divider" || kind === "toc" ? kind : `${kind} ${src}${extra.length ? ", " + extra.join(", ") : ""}`;
    const kids = kidsOf(K, q);
    this.map = null;
    if (kids.length && !M.CONTAINERS.has(kind)) {
      const c0 = M.parentOf(q), sib = kidsOf(K, c0);
      const items = sib.map(x => (x === q ? [{ head }].concat(kids.map(k => ({ from: k }))) : [{ from: x }])).flat();
      const ps = this.relayout(c0, items); return ps[sib.indexOf(q)];
    }
    writeText(`${q} is ${head}`);
    return q;
  },
  /* a block's words, written as the person types (a formula when it starts with =) */
  text(q, raw, final) {
    const K = S.K; if (!K.exists(q)) return;
    const kind = F.kindOf(K, q), name = B.textProp(kind), path = q + "." + name, c = K.cells.get(path);
    if (kind !== "code" && /^=\s*\S/.test(raw)) {
      if (!final) return;
      const src = raw.replace(/^=\s*/, "").trim();
      if (c && c.kind === "formula" && c.src === src) return;
      const t = parses(`${path} = ${src}`); if (!t.ok) { toast(`That formula does not read: ${t.bad ? t.bad.err : "?"}`); return false; }
      writeText(`${path} = ${src}`); return true;
    }
    if (c && c.kind === "formula" && raw === "= " + c.src) return;
    if (c && c.kind === "lit" && c.v === raw) return;
    if (!c && raw === "") return;
    writeText(`${path} = ${showLit(raw)}`, { coalesce: !final });
  },
};

/* ---------- prose at rest: rich, yet its text is exactly what was typed (so a click lands where it was) ---------- */
const RX = /(\{[^{}\n]+\}|\*\*(?:\{[^{}\n]+\}|[^*\n])+?\*\*|~~[^~\n]+~~|`[^`\n]+`|\[\[[A-Za-z_][\w.]*\]\]|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*(?!\s)(?:\{[^{}\n]+\}|[^*\n])+?\*|(?:^|(?<=\s))https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;
const mk = s => `<span class="mk">${esc(s)}</span>`;
function liveHTML(K, q, s, env) {
  let out = "", last = 0, m; const re = new RegExp(RX.source, "g"); s = String(s == null ? "" : s);
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index)); const x = m[0];
    if (x[0] === "{") {
      const src = x.slice(1, -1).trim(), v = B.valueOf(K, q, src, env), bad = M.isErr(v), wait = !bad && M.unfinished(v);
      out += `<span class="b-val${bad ? " err" : wait ? " wait" : ""}" data-v="${esc(bad ? "!" : wait ? "…" : F.fmt(v))}" title="${esc((bad ? v.msg + " · " : wait ? "waiting for a Claude block · " : "") + "= " + src)}">${mk(x)}</span>`;
    }
    else if (x.startsWith("**")) out += `<strong>${mk("**")}${liveHTML(K, q, x.slice(2, -2), env)}${mk("**")}</strong>`;
    else if (x.startsWith("~~")) out += `<s>${mk("~~")}${liveHTML(K, q, x.slice(2, -2), env)}${mk("~~")}</s>`;
    else if (x[0] === "`") out += `<code class="b-code">${mk("`")}${esc(x.slice(1, -1))}${mk("`")}</code>`;
    else if (x.startsWith("[[")) {
      const n = x.slice(2, -2), ok = Pages.exists(n, K);
      out += `<a class="b-mention${ok ? "" : " missing"}" href="#${esc(n)}" data-go="${esc(n)}" data-i="${esc(ok ? Pages.icon(n, K) || "📄" : "↗")}" data-t="${esc(ok ? Pages.title(n, K) : n)}">${mk(x)}</a>`;
    }
    else if (x[0] === "[") { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(x); out += `<a class="b-a" href="${esc(mm[2])}" target="_blank" rel="noopener noreferrer">${mk("[")}${esc(mm[1])}${mk("](" + mm[2] + ")")}</a>`; }
    else if (x[0] === "*") out += `<em>${mk("*")}${liveHTML(K, q, x.slice(1, -1), env)}${mk("*")}</em>`;
    else out += `<a class="b-a" href="${esc(x)}" target="_blank" rel="noopener noreferrer">${esc(x)}</a>`;
    last = m.index + x.length;
  }
  return out + esc(s.slice(last));
}

/* ---------- carets in plain text ---------- */
function textOffset(root, node, off) {
  if (!root.contains(node)) return 0;
  if (node.nodeType !== 3) { let n = 0; for (let i = 0; i < off && i < node.childNodes.length; i++) n += node.childNodes[i].textContent.length; node = node; const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(node, off); return pre.toString().length; }
  const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(node, off); return pre.toString().length;
}
function caretOf(ed) { const s = getSelection(); if (!s.rangeCount || !ed.contains(s.anchorNode)) return { start: 0, end: 0 }; const r = s.getRangeAt(0); return { start: textOffset(ed, r.startContainer, r.startOffset), end: textOffset(ed, r.endContainer, r.endOffset) }; }
function setCaret(ed, start, end = start) {
  const total = ed.textContent.length; start = Math.max(0, Math.min(start, total)); end = Math.max(0, Math.min(end, total));
  const find = n => { const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let t, acc = 0, lastT = null; while ((t = w.nextNode())) { lastT = t; if (acc + t.length >= n) return [t, n - acc]; acc += t.length; } return lastT ? [lastT, lastT.length] : [ed, 0]; };
  const r = document.createRange(), a = find(start), b = find(end); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function pointOffset(ed, x, y) {
  let node = null, off = 0;
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
  else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
  if (!node || !ed.contains(node)) return null;
  const chip = node.nodeType === 1 ? node.closest(".b-val, .b-mention") : node.parentElement && node.parentElement.closest(".b-val, .b-mention");
  if (chip && ed.contains(chip)) { const pre = document.createRange(); pre.selectNodeContents(ed); pre.setEndAfter(chip); return pre.toString().length; }
  return textOffset(ed, node, off);
}
const lineEdge = (ed, top) => {
  const s = getSelection(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0).cloneRange(); r.collapse(true); let rect = r.getClientRects()[0];
  if (!rect) { const tmp = document.createElement("span"); tmp.textContent = "\u200b"; r.insertNode(tmp); rect = tmp.getBoundingClientRect(); tmp.remove(); ed.normalize(); }
  const box = ed.getBoundingClientRect(), lh = parseFloat(getComputedStyle(ed).lineHeight) || 22;
  return top ? rect.top - box.top < lh * 0.8 : box.bottom - rect.bottom < lh * 0.8;
};
const PLAIN = (() => { const d = document.createElement("div"); try { d.contentEditable = "plaintext-only"; } catch (e) { } return d.contentEditable === "plaintext-only"; })();
function insertText(t) { if (!document.execCommand("insertText", false, t)) { const s = getSelection(); if (!s.rangeCount) return; const r = s.getRangeAt(0); r.deleteContents(); const n = document.createTextNode(t); r.insertNode(n); r.setStartAfter(n); r.collapse(true); s.removeAllRanges(); s.addRange(r); } }

const ICON = {
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  drag: '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="3" cy="3.5" r="1.2"/><circle cx="7" cy="3.5" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="12.5" r="1.2"/><circle cx="7" cy="12.5" r="1.2"/></svg>',
  spark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></svg>',
};
const PH = { p: "Write, press ‘space’ for Claude, ‘/’ for blocks…", text: "Write…", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bullet: "List", numbered: "List", todo: "To-do", quote: "Quote", callout: "Callout", code: "Code", fold: "Toggle" };
const DBK = { table: "Table", board: "Board", calendar: "Calendar", timeline: "Timeline", cards: "Gallery", list: "List", bars: "Chart" };

/* ---------- the editor: one page's blocks as DOM, kept in step with the tree ---------- */
const Ed = {
  els: new Map(), seen: null, focus: null, sel: new Set(), pending: null, saveT: 0, clickAt: null, askEl: null,
  ghostMap(page) {
    const out = new Map(); if (S.view !== S.K) return out;
    for (const [id, it] of S.K.intents) { if (!it.view || !it.path || pageOf(it.path) !== page) continue; const par = M.parentOf(it.path); if (!out.has(par)) out.set(par, []); out.get(par).push({ peer: id, text: it.text, name: nameOf(id), color: colorOf(id) }); }
    return out;
  },
  /* draw a list of blocks into host, reusing each block's element */
  list(c, host, env) {
    const K = S.view, want = [];
    for (const q of kidsOf(K, c)) want.push(this.block(q, env));
    const gh = env.ghosts.get(c);
    if (gh) for (const g of gh) { const d = document.createElement("div"); d.className = "ghost-line"; d.style.setProperty("--c", g.color); d.innerHTML = `<small>${esc(g.name)}</small><span>${esc(g.text)}</span>`; want.push(d); }
    want.forEach((el, i) => { if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null); });
    while (host.children.length > want.length) host.lastElementChild.remove();
    return want.length;
  },
  block(q, env) {
    const K = S.view; let kind = F.kindOf(K, q);
    let el = this.els.get(q);
    if (!el || el._kind !== kind) { const old = el; el = this.create(q, kind); this.els.set(q, el); if (old && old.parentNode) old.replaceWith(el); }
    this.seen.add(q);
    try { this.update(el, q, kind, env); } catch (e) { console.error(e); }
    return el;
  },
  create(q, kind) {
    const el = document.createElement("div"); el._kind = kind; el.dataset.p = q;
    const gut = `<div class="gut" contenteditable="false"><button type="button" class="g-add" tabindex="-1" aria-label="Add a block below" title="Add a block below · ⌥-click for above">${ICON.plus}</button><button type="button" class="g-drag" tabindex="-1" aria-label="Move or change this block" title="Drag to move · click for options">${ICON.drag}</button></div>`;
    if (EDITABLE.includes(kind)) {
      const mark = kind === "bullet" ? `<span class="mkr dot" aria-hidden="true"></span>` : kind === "numbered" ? `<span class="mkr num"></span>` : kind === "todo" ? `<button type="button" class="mkr chk" role="checkbox" aria-label="Done"></button>` : kind === "callout" ? `<button type="button" class="mkr ico" aria-label="Change icon"></button>` : kind === "fold" ? `<button type="button" class="mkr tri" aria-label="Open or close"></button>` : "";
      const head = kind === "code" ? `<div class="code-h" contenteditable="false"><span class="lang"></span><button type="button" class="copy">Copy</button></div>` : "";
      el.className = "blk k-" + kind;
      el.innerHTML = gut + `<div class="bd">${head}${mark}<div class="ed" role="textbox" aria-multiline="true" spellcheck="${kind === "code" ? "false" : "true"}"></div></div><div class="sub"></div>`;
      el.querySelector(".ed").contentEditable = PLAIN ? "plaintext-only" : "true";
    } else if (kind === "columns") { el.className = "blk k-columns"; el.innerHTML = gut + `<div class="bd cols"></div>`; }
    else if (kind === "col") { el.className = "blk grp"; el.innerHTML = `<div class="grp-by" contenteditable="false"></div><div class="sub"></div>`; }
    else if (kind === "hole") { el.className = "blk k-hole"; el.innerHTML = gut + `<div class="bd claude"></div>`; }
    else if (kind === "divider") { el.className = "blk k-divider"; el.innerHTML = gut + `<div class="bd"><hr></div>`; }
    else { el.className = "blk k-live k-" + kind; el.innerHTML = gut + `<div class="bd live"><div class="dbbar" hidden></div><div class="fr"></div></div>`; }
    return el;
  },
  update(el, q, kind, env) {
    const K = S.view, ro = env.readonly;
    el.classList.toggle("ro", ro); el.classList.toggle("selb", this.sel.has(q));
    const who = Presence.at(q); el.classList.toggle("other", !!who); if (who) { el.style.setProperty("--who", colorOf(who.id)); el.dataset.who = nameOf(who.id); } else delete el.dataset.who;
    if (EDITABLE.includes(kind)) return this.prose(el, q, kind, env);
    if (kind === "columns") {
      const host = el.querySelector(".cols"), want = [];
      for (const c of kidsOf(K, q)) {
        if (F.kindOf(K, c) !== "col") { want.push(this.block(c, env)); continue; }
        let col = this.els.get(c); if (!col || col._kind !== "colx") { col = document.createElement("div"); col.className = "colx"; col._kind = "colx"; col.dataset.c = c; col.innerHTML = `<div class="sub"></div>`; this.els.set(c, col); }
        this.seen.add(c);
        const n = this.list(c, col.firstChild, env); col.classList.toggle("empty", !n);
        want.push(col);
      }
      want.forEach((x, i) => { if (host.children[i] !== x) host.insertBefore(x, host.children[i] || null); });
      while (host.children.length > want.length) host.lastElementChild.remove();
      return;
    }
    if (kind === "col") {
      const busy = [...S.busy].find(id => { const c = K.cells.get(q + ".k"); return c && c.by === id; });
      const kc = K.cells.get(q + ".k"), by = kc && kc.by && isClaude(kc.by) ? kc.by : null;
      el.classList.toggle("by-claude", !!by); el.classList.toggle("busy", !!busy);
      if (by) { el.style.setProperty("--c", colorOf(by)); el.firstChild.textContent = (busy ? "✳ " + nameOf(by) + " is writing" : "✳ Written by " + nameOf(by)) + (kc.at ? " · " + ago(kc.at) : ""); }
      this.list(q, el.querySelector(".sub"), env);
      return;
    }
    if (kind === "hole") return this.hole(el, q, env);
    if (kind === "divider") return;
    // a live block: Fruit draws it
    const fr = el.querySelector(".fr");
    F.mount(fr, h("div", { class: "fruit" }, F.node(K, q, env)));
    this.dbbar(el, q, kind, env);
  },
  prose(el, q, kind, env) {
    const K = S.view, ed = el.querySelector(".ed"), name = B.textProp(kind), c = K.cells.get(q + "." + name);
    const isF = !!c && c.kind === "formula", isH = !!c && c.kind === "hole";
    const raw = !c ? "" : c.kind === "lit" ? (c.v == null ? "" : String(c.v)) : isF ? "= " + c.src : "";
    ed._raw = raw; ed.dataset.ph = PH[kind] || "";
    el.classList.toggle("formula", isF);
    if (!(this.focus === q && document.activeElement === ed)) {
      let html;
      if (isF || isH) { const v = F.prop(K, q, name, env); html = `<span class="b-f" title="${esc(isF ? "= " + c.src : "a Claude block")}">${M.isRes(v) ? "…" : M.isErr(v) ? "!" + esc(v.msg) : liveHTML(K, q, F.fmt(v), env)}</span>`; }
      else html = kind === "code" ? esc(raw) : liveHTML(K, q, raw, env);
      if (ed._html !== html) { ed.innerHTML = html; ed._html = html; }
    }
    const can = !env.readonly;
    if ((ed.contentEditable !== "false") !== can) ed.contentEditable = can ? (PLAIN ? "plaintext-only" : "true") : "false";
    const st = B.tint(K, q, env); el.style.setProperty("--b-fg", st["--b-fg"] || ""); el.style.setProperty("--b-fg-d", st["--b-fg-d"] || ""); el.style.setProperty("--b-bg", st["--b-bg"] || ""); el.style.setProperty("--b-bg-d", st["--b-bg-d"] || "");
    el.classList.toggle("tinted", !!st["--b-fg"]); el.classList.toggle("filled", !!st["--b-bg"]);
    if (kind === "numbered") el.querySelector(".num").textContent = B.numberLabel(K, q);
    if (kind === "todo") { const done = !!F.prop(K, q, "done", env); el.classList.toggle("done", done); el.querySelector(".chk").setAttribute("aria-checked", done ? "true" : "false"); }
    if (kind === "callout") {
      const icon = F.prop(K, q, "icon", env), tone = F.prop(K, q, "tone", env), TB = { accent: "orange", good: "green", bad: "red", warn: "yellow", muted: "gray", you: "blue" };
      el.querySelector(".ico").textContent = typeof icon === "string" && icon ? icon : "💡";
      if (!st["--b-bg"] && TB[tone]) { el.style.setProperty("--b-bg", B.COLORS[TB[tone]][1]); el.style.setProperty("--b-bg-d", B.COLORS_DARK[TB[tone]][1]); el.classList.add("filled"); }
    }
    if (kind === "code") { const l = F.prop(K, q, "lang", env); el.querySelector(".lang").textContent = typeof l === "string" ? l : "code"; }
    const sub = el.querySelector(".sub");
    if (kind === "fold") {
      const open = this.isOpen(q); el.classList.toggle("open", open); el.querySelector(".tri").setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { const n = this.list(q, sub, env); if (!n) { sub.innerHTML = `<button type="button" class="fold-empty" data-into="${esc(q)}">Empty toggle. Click or drop blocks inside.</button>`; } }
      else if (sub.children.length) sub.textContent = "";
    } else if (CAN_HOLD.has(kind) || kidsOf(K, q).length) this.list(q, sub, env);
    else if (sub.children.length) sub.textContent = "";
  },
  isOpen(q) { const v = S.local.get(q + "#open"); return v != null ? !!v : !!F.prop(S.view, q, "open", { al: new Map() }); },
  hole(el, q, env) {
    const K = S.view, c = K.cells.get(q) || {}, holder = Claims.holder(q), web = (c.via || []).some(v => v === "browser" || v === "web");
    const status = holder ? `<span class="cl-who" style="--c:${colorOf(holder)}">${esc(nameOf(holder))} is writing…</span>` : S.sample ? (S.readOnly ? "Waiting" : "Ready to write") : S.db ? "Waiting for a Claude · ask Claude in chat to write the Claude blocks here" : "Claude writes these when the page is open inside Claude";
    const sig = [c.intent, holder, web, !!S.sample, env.readonly].join("|");
    const bd = el.querySelector(".claude");
    el.classList.toggle("busy", !!holder);
    if (bd._sig === sig) return; bd._sig = sig;
    bd.innerHTML = `<div class="cl-h"><span class="spark">${ICON.spark}</span><b>Claude block</b>${web ? `<span class="cl-tag">may browse the web</span>` : ""}<span class="cl-s">${status}</span></div>
      <div class="cl-i">${esc(c.intent || "An empty slot: say what goes here")}</div>
      ${env.readonly || holder ? "" : `<div class="cl-a"><button type="button" class="btn primary" data-act="fill"${S.sample ? "" : " disabled"}>${ICON.spark} Write it</button><button type="button" class="btn" data-act="intent">Edit intent</button><button type="button" class="btn ghost" data-act="unhole">Write it myself</button></div>`}`;
  },
  /* a database view: one list, many ways to look at it */
  dbOf(K, q) {
    const c = K.cells.get(q + ".of"); if (c && c.kind === "formula" && c.ast && c.ast.k === "ref") return c.src;
    const d = K.cells.get(q + ".db"); return d && typeof d.v === "string" ? d.v : null;
  },
  dbbar(el, q, kind, env) {
    const bar = el.querySelector(".dbbar"), K = S.view, db = DBK[kind] ? this.dbOf(K, q) : null;
    if (!db) { if (!bar.hidden) bar.hidden = true; return; }
    const path = F.refPath(K, db, pageOf(q)), rows = K.valueAt(path), n = Array.isArray(rows) ? rows.length : rows && typeof rows === "object" ? Object.keys(rows).length : 0;
    const sig = [db, kind, n, env.readonly].join("|"); bar.hidden = false; if (bar._sig === sig) return; bar._sig = sig;
    bar.innerHTML = `<span class="db-n">${esc(db.replace(/_/g, " "))}</span><span class="db-c">${n} row${n === 1 ? "" : "s"}</span><span class="db-tabs" role="tablist">${Object.entries(DBK).map(([k, l]) => `<button type="button" role="tab" data-view="${k}" aria-selected="${k === kind}"${env.readonly ? " disabled" : ""}>${l}</button>`).join("")}</span>${env.readonly ? "" : `<span class="grow"></span><button type="button" class="db-add" data-act="row" title="Add a row">+ New</button><button type="button" class="db-add claude" data-act="rows" title="Ask Claude for rows">✳ Rows</button>`}`;
  },
  /* the arguments each view needs, guessed from the records */
  viewLine(K, q, view) {
    const db = this.dbOf(K, q), path = F.refPath(K, db, pageOf(q)), rows = [].concat(K.valueAt(path) || []).filter(r => r && typeof r === "object");
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))], str = k => rows.some(r => typeof r[k] === "string"), num = k => rows.some(r => typeof r[k] === "number") && rows.every(r => r[k] == null || typeof r[k] === "number");
    const dateK = keys.find(k => rows.some(r => /^\d{4}-\d{2}-\d{2}/.test(String(r[k] || "")))), titleK = keys.find(k => /^(name|title|what|text|task|label)$/i.test(k)) || keys.find(str) || keys[0] || "name";
    const distinct = k => new Set(rows.map(r => r[k])).size;
    const byK = keys.find(k => /^(status|stage|state|cat|category|type|kind|group)$/i.test(k) && str(k)) || keys.find(k => k !== titleK && str(k) && distinct(k) <= Math.max(2, Math.min(6, rows.length - 1)));
    const bodyK = keys.find(k => k !== titleK && k !== byK && str(k) && k !== dateK), numK = keys.find(num);
    const L = JSON.stringify;
    switch (view) {
      case "table": return `table ${db}`;
      case "board": { const cols = byK ? [...new Set(rows.map(r => r[byK]).filter(x => x != null).map(String))] : []; return `board ${db}, by: ${L(byK || "status")}, title: ${L(titleK)}` + (cols.length ? `, cols: ${L(cols.join("|"))}` : "") + (bodyK ? `, meta: ${L(bodyK)}` : ""); }
      case "calendar": return `calendar ${db}, date: ${L(dateK || "date")}, label: ${L(titleK)}`;
      case "timeline": return `timeline ${db}, at: ${L(dateK || "date")}, label: ${L(titleK)}`;
      case "cards": return `cards ${db}, title: ${L(titleK)}` + (bodyK ? `, body: ${L(bodyK)}` : "") + (byK ? `, meta: ${L(byK)}` : "");
      case "list": return `list ${db}, text: ${L(titleK)}`;
      case "bars": return numK ? `bars ${db}, x: ${L(titleK)}, y: ${L(numK)}` : `bars tally(${db}, ${L(byK || titleK)}), db: ${L(db)}`;
    }
  },
  setView(q, view) { const line = this.viewLine(S.K, q, view); if (line) writeText(`${q} is ${line}`); },
  addRow(q) {
    const K = S.K, db = this.dbOf(K, q), path = F.refPath(K, db, pageOf(q)), rows = [].concat(K.valueAt(path) || []), first = rows.find(r => r && typeof r === "object") || { name: "" };
    const blank = Object.fromEntries(Object.entries(first).map(([k, v]) => [k, typeof v === "number" ? 0 : typeof v === "boolean" ? false : /^(status|stage|state)$/i.test(k) ? v : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date().toISOString().slice(0, 10) : ""]));
    writeText(`${path} += ${showLit(blank)}`);
  },

  /* ---------- the page ---------- */
  render(page, host) {
    const env = envFor(page); env.width = Math.max(260, host.clientWidth || 700);
    this.seen = new Set();
    const n = this.list(page + ".ui", host, env);
    for (const [p, el] of this.els) if (!this.seen.has(p)) { this.els.delete(p); if (el.parentNode && !el.isConnected) el.remove(); }
    return n;
  },
  reset() { this.els.clear(); this.sel.clear(); this.focus = null; this.pending = null; },
  order() { return $$("#blocks .blk[data-p]").filter(el => !el.classList.contains("grp")).map(el => el.dataset.p); },
  editable(q) { const el = this.els.get(q); return !!el && !!el.querySelector(":scope > .bd > .ed") && !el.classList.contains("ro"); },
  edOf(q) { const el = this.els.get(q); return el ? el.querySelector(":scope > .bd > .ed") : null; },
  focusAt(q, at, end) { this.pending = { q, at, end }; flushNow(); },
  afterRender() {
    if (this.wantTitle) { this.wantTitle = false; const t = $("#title"); if (t && t.isContentEditable) { t.focus(); setCaret(t, t.textContent.length); return; } }
    const p = this.pending; if (!p) return; this.pending = null;
    const q = Ops.remap(p.q), ed = this.edOf(q); if (!ed) return;
    this.focus = q; ed.focus({ preventScroll: true });
    if (document.activeElement === ed) { const len = ed.textContent.length; setCaret(ed, p.at === Infinity ? len : p.at, p.end != null ? p.end : p.at === Infinity ? len : p.at); }
    const r = ed.getBoundingClientRect(), sc = $("#scroller"), sr = sc.getBoundingClientRect();
    if (r.bottom > sr.bottom - 40 || r.top < sr.top + 50) ed.scrollIntoView({ block: "center", behavior: "smooth" });
  },
  blur() { const a = document.activeElement; if (a && a.closest && a.closest("#blocks .ed")) a.blur(); },
  select(list) { this.sel = new Set(list); if (list.length) this.blur(); schedule(); },
  flash(path) { setTimeout(() => { let el = null; for (let p = path; p && !el; p = M.parentOf(p)) el = this.els.get(p); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }, 80); },

  /* ---------- typing ---------- */
  onFocus(ed) {
    const blk = ed.closest(".blk"), q = blk.dataset.p; this.focus = q; this.sel.clear();
    const raw = ed._raw != null ? ed._raw : ed.textContent;
    if (ed.textContent !== raw || ed.querySelector("*")) { const at = this.clickAt != null ? this.clickAt : raw.length; ed.textContent = raw; ed._html = null; setCaret(ed, at); }
    else if (this.clickAt != null) setCaret(ed, this.clickAt);
    this.clickAt = null;
    blk.classList.add("editing"); Net.presence();
  },
  onBlur(ed) {
    const blk = ed.closest(".blk"); if (!blk || !blk.isConnected || this.els.get(blk.dataset.p) !== blk) return; const q = blk.dataset.p;
    blk.classList.remove("editing"); Slash.close();
    clearTimeout(this.saveT); if (S.K.exists(q) && !ed.closest(".ro")) Ops.text(q, ed.textContent, true);
    if (this.focus === q) this.focus = null;
    ed._html = null; Net.presence(); schedule();
  },
  onInput(ed, e) {
    const q = ed.closest(".blk").dataset.p, K = S.K, kind = F.kindOf(K, q);
    if (ed.textContent === "" && ed.innerHTML !== "") ed.innerHTML = "";
    const raw = ed.textContent, { start } = caretOf(ed);
    // markdown at the start of a line turns the block
    if (e && e.inputType === "insertText" && e.data === " " && (kind === "p" || kind === "text")) {
      const head = raw.slice(0, start), m = /^(#{1,3}|[-*+]|1[.)]|\[\s?\]|\[x\]|>|"|```)\s$/.exec(head);
      if (m) {
        const t = { "#": "h1", "##": "h2", "###": "h3", "-": "bullet", "*": "bullet", "+": "bullet", "1.": "numbered", "1)": "numbered", "[]": "todo", "[ ]": "todo", "[x]": "todo", ">": "fold", '"': "quote", "```": "code" }[m[1]];
        const rest = raw.slice(start); clearTimeout(this.saveT);
        writeText(`${q}.text = ${showLit(rest)}`); Ops.turn(q, t); if (m[1] === "[x]") writeText(`${q}.done = true`);
        ed._raw = rest; this.focusAt(q, 0); return;
      }
    }
    if (raw === "---" && (kind === "p" || kind === "text")) { clearTimeout(this.saveT); Ops.turn(q, "divider"); const T = Ops.insert(M.parentOf(q), q, { head: 'p ""' }); this.focusAt(T, 0); return; }
    // the slash menu opens at a "/" typed at a word's start
    if (e && e.inputType === "insertText" && e.data === "/" && (start === 1 || /\s/.test(raw[start - 2] || ""))) Slash.open(q, ed, start - 1);
    else if (Slash.q === q) Slash.update();
    if (/^\[\[[\w.]*$/.test(raw.slice(raw.lastIndexOf("[[", start), start))) Mention.open(q, ed, raw.lastIndexOf("[[", start)); else Mention.close();
    ed._raw = raw;
    clearTimeout(this.saveT); this.saveT = setTimeout(() => { if (/^=\s*\S/.test(raw) && kind !== "code") return; Ops.text(q, raw, false); }, 260);
  },
  saveNow(q, raw) { clearTimeout(this.saveT); Ops.text(q, raw, true); },
  onKey(ed, e) {
    const blk = ed.closest(".blk"), q = blk.dataset.p, K = S.K, kind = F.kindOf(K, q), raw = ed.textContent, c = caretOf(ed), collapsed = c.start === c.end;
    if (Slash.q === q && Slash.key(e)) return;
    if (Mention.q === q && Mention.key(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !e.isComposing) {
      if (kind === "code" && !mod) { e.preventDefault(); insertText("\n"); return; }
      if (e.shiftKey) { e.preventDefault(); insertText("\n"); return; }
      e.preventDefault();
      if (mod) { if (kind === "todo") { this.saveNow(q, raw); writeText(`${q}.done = ${!F.prop(K, q, "done", { al: new Map() })}`); } else if (kind === "fold") { S.local.set(q + "#open", !this.isOpen(q)); schedule(); } return; }
      return this.split(q, kind, raw, c.start, c.end);
    }
    if (e.key === "Backspace" && collapsed && c.start === 0 && !e.isComposing) { e.preventDefault(); return this.backspace(q, kind, raw); }
    if (e.key === "Delete" && collapsed && c.start === raw.length) { e.preventDefault(); return this.joinNext(q, raw); }
    if (e.key === "Tab") { e.preventDefault(); this.saveNow(q, raw); return e.shiftKey ? this.outdent(q, c.start) : this.indent(q, c.start); }
    if (e.key === "ArrowUp" && !e.shiftKey && !mod && lineEdge(ed, true)) { const o = this.order(), i = o.indexOf(q); for (let j = i - 1; j >= 0; j--) if (this.editable(o[j])) { e.preventDefault(); this.focusAt(o[j], Infinity); return; } }
    if (e.key === "ArrowDown" && !e.shiftKey && !mod && lineEdge(ed, false)) { const o = this.order(), i = o.indexOf(q); for (let j = i + 1; j < o.length; j++) if (this.editable(o[j])) { e.preventDefault(); this.focusAt(o[j], 0); return; } }
    if (e.key === "Escape") { e.preventDefault(); this.saveNow(q, raw); this.select([q]); return; }
    if (mod && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); this.saveNow(q, raw); const T = this.nudge(q, e.key === "ArrowUp" ? -1 : 1); if (T) this.focusAt(T, c.start); return; }
    if (mod && !e.shiftKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); this.saveNow(q, raw); Ops.dup(q); return; }
    if (mod && !e.altKey) {
      const wrap = { b: "**", i: "*", e: "`" }[e.key.toLowerCase()] || (e.shiftKey && (e.key === "s" || e.key === "S") ? "~~" : null);
      if (wrap && kind !== "code") { e.preventDefault(); const t = raw.slice(c.start, c.end), w = t.startsWith(wrap) && t.endsWith(wrap) && t.length >= wrap.length * 2; insertText(w ? t.slice(wrap.length, -wrap.length) : wrap + t + wrap); if (!t) setCaret(ed, c.start + wrap.length); this.onInput(ed); return; }
    }
    if (e.key === " " && raw === "" && (kind === "p" || kind === "text") && !e.isComposing) { e.preventDefault(); return this.ask(q, "new"); }
    if (mod && e.altKey && /^Digit[0-9]$/.test(e.code)) {
      const t = ["p", "h1", "h2", "h3", "todo", "bullet", "numbered", "fold", "code", null][+e.code.slice(5)]; e.preventDefault();
      if (t) { this.saveNow(q, raw); Ops.turn(q, t); this.focusAt(q, c.start); } else { this.saveNow(q, raw); Pages.create({ parent: pageOf(q), title: raw, link: true, linkAfter: q, go: true }); writeText(`${q} -`); }
    }
  },
  split(q, kind, raw, at, end) {
    const K = S.K, c = M.parentOf(q);
    if (LISTY.has(kind) && raw === "") { const pk = F.kindOf(K, c); if (!/\.ui$/.test(c) && CAN_HOLD.has(pk) && pk !== "fold" && !kidsOf(K, q).length) return this.outdent(q, 0); Ops.turn(q, "p"); this.focusAt(q, 0); return; }
    if (at === 0 && raw !== "" && kind !== "fold") { this.saveNow(q, raw); const sib = kidsOf(K, c), i = sib.indexOf(q); Ops.insert(c, i > 0 ? sib[i - 1] : null, { head: 'p ""' }); this.focusAt(Ops.remap(q), 0); return; }
    const before = raw.slice(0, at), after = raw.slice(end);
    this.saveNow(q, before);
    if (kind === "fold" && this.isOpen(q)) { const T = Ops.insert(q, null, { head: `p ${showLit(after)}` }); this.focusAt(T, 0); return; }
    const nk = LISTY.has(kind) ? kind : "p", head = nk === "todo" ? `todo ${showLit(after)}, done: false` : `${nk} ${showLit(after)}`;
    // children stay with the first half, as in Notion: the new block comes right after, at the same level
    const T = kidsOf(K, q).length && CAN_HOLD.has(kind) && kind !== "fold" ? Ops.insert(q, null, { head }) : Ops.insert(c, q, { head });
    this.focusAt(T, 0);
  },
  backspace(q, kind, raw) {
    const K = S.K;
    if (kind !== "p" && kind !== "text") { clearTimeout(this.saveT); writeText(`${q}.${B.textProp(kind)} = ${showLit(raw)}`); Ops.turn(q, "p"); this.focusAt(q, 0); return; }
    const o = this.order(), i = o.indexOf(q), prev = i > 0 ? o[i - 1] : null;
    if (!prev) { if (raw === "" && kidsOf(K, M.parentOf(q)).length > 1) { Ops.remove(q); } else if (M.parentOf(q) !== S.page + ".ui") this.outdent(q, 0); return; }
    if (kidsOf(K, q).length) return;
    const pk = F.kindOf(K, prev), pc = K.cells.get(prev + "." + B.textProp(pk));
    if (this.editable(prev) && pk !== "code" && (!pc || pc.kind === "lit")) {
      const pr = pc ? String(pc.v == null ? "" : pc.v) : "";
      clearTimeout(this.saveT); writeText(`${prev}.${B.textProp(pk)} = ${showLit(pr + raw)}\n${q} -`); this.focusAt(prev, pr.length); return;
    }
    if (raw === "") { clearTimeout(this.saveT); Ops.remove(q); }
    this.select([prev]);
  },
  joinNext(q, raw) {
    const K = S.K, o = this.order(), i = o.indexOf(q), next = o[i + 1]; if (!next || !this.editable(next) || kidsOf(K, next).length) return;
    const nk = F.kindOf(K, next), nc = K.cells.get(next + "." + B.textProp(nk)); if (nc && nc.kind !== "lit") return;
    clearTimeout(this.saveT); writeText(`${q}.${B.textProp(F.kindOf(K, q))} = ${showLit(raw + (nc ? String(nc.v || "") : ""))}\n${next} -`); this.focusAt(q, raw.length);
  },
  indent(q, at) {
    const K = S.K, c = M.parentOf(q), sib = kidsOf(K, c), i = sib.indexOf(q), prev = i > 0 ? sib[i - 1] : null;
    if (!prev || !CAN_HOLD.has(F.kindOf(K, prev))) return;
    if (F.kindOf(K, prev) === "fold") S.local.set(prev + "#open", true);
    const T = Ops.move(q, prev, Ops.last(prev)); this.focusAt(T, at);
  },
  outdent(q, at) {
    const K = S.K, c = M.parentOf(q); if (/\.ui$/.test(c) || !K.exists(c)) return;
    const ck = F.kindOf(K, c); if (ck === "col" || ck === "columns") return;
    const T = Ops.move(q, M.parentOf(c), c); this.focusAt(T, at);
  },
  nudge(q, dir) {
    const K = S.K, c = M.parentOf(q), sib = kidsOf(K, c), i = sib.indexOf(q);
    if (dir < 0 && i > 0) return Ops.move(q, c, i > 1 ? sib[i - 2] : null);
    if (dir > 0 && i < sib.length - 1) return Ops.move(q, c, sib[i + 1]);
    return null;
  },
  /* paste: Hypha blocks come in as blocks, markdown as blocks, a line as text */
  onPaste(ed, e) {
    const t = (e.clipboardData && e.clipboardData.getData("text/plain")) || ""; e.preventDefault();
    if (!t) return;
    const q = ed.closest(".blk").dataset.p, K = S.K, kind = F.kindOf(K, q);
    if (kind === "code" || !t.includes("\n")) { insertText(kind === "code" ? t : t.replace(/\n/g, " ")); return; }
    const items = this.blocksFrom(t); if (!items.length) return;
    const raw = ed.textContent, c0 = caretOf(ed), before = raw.slice(0, c0.start), after = raw.slice(c0.end);
    let after_ = q;
    if (!before.trim() && !after.trim()) { clearTimeout(this.saveT); writeText([`${q} -`].concat(Ops.lines(items[0], q)).join("\n")); items.shift(); }
    else { this.saveNow(q, before + after); }
    for (const it of items) after_ = Ops.insert(M.parentOf(q), after_, it);
    this.focusAt(after_, Infinity);
  },
  blocksFrom(t) {
    const lines = t.replace(/\r/g, "").split("\n");
    const hy = parses("x:\n  ui:\n" + lines.map(l => "    " + l).join("\n"));
    if (hy.ok && lines.filter(l => l.trim()).every(l => /^\s*([a-z][a-z0-9_]*\b|\?")/.test(l)) && lines.some(l => /^\s*(p|h[123]|bullet|todo|callout|fold|table|board|slider|stat|text|\?")\b/.test(l))) {
      const out = []; let cur = null;
      for (const l of lines) { if (!l.trim()) continue; if (!/^\s/.test(l)) { cur = { head: l.trim(), kids: [] }; out.push(cur); } else if (cur) cur.kids.push(l.replace(/^ {2}/, "")); }
      return out;
    }
    const out = []; let code = null, para = [];
    const flush = () => { if (para.length) { out.push({ head: `p ${showLit(para.join(" "))}` }); para = []; } };
    for (const l of lines) {
      if (code) { if (/^```/.test(l.trim())) { out.push({ head: `code ${showLit(code.join("\n"))}` }); code = null; } else code.push(l); continue; }
      const s = l.trim(); let m;
      if (/^```/.test(s)) { flush(); code = []; continue; }
      if (!s) { flush(); continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(s))) { flush(); out.push({ head: `h${m[1].length} ${showLit(m[2])}` }); continue; }
      if ((m = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(s))) { flush(); out.push({ head: `todo ${showLit(m[2])}, done: ${m[1] !== " "}` }); continue; }
      if ((m = /^[-*+•]\s+(.*)$/.exec(s))) { flush(); out.push({ head: `bullet ${showLit(m[1])}` }); continue; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(s))) { flush(); out.push({ head: `numbered ${showLit(m[1])}` }); continue; }
      if ((m = /^>\s?(.*)$/.exec(s))) { flush(); out.push({ head: `quote ${showLit(m[1])}` }); continue; }
      if (/^(-{3,}|\*{3,})$/.test(s)) { flush(); out.push({ head: "divider" }); continue; }
      para.push(s);
    }
    if (code) out.push({ head: `code ${showLit(code.join("\n"))}` });
    flush(); return out;
  },

  /* ---------- Claude, right here: space on an empty line ---------- */
  ask(q, mode) {
    this.closeAsk();
    const el = this.els.get(q); if (!el) return;
    const bar = document.createElement("div"); bar.className = "askbar"; bar.contentEditable = "false";
    const page = pageOf(q), isNew = mode === "new";
    const sugg = isNew ? ["Continue writing", "A table of the key numbers on this page", "Brainstorm ten ideas", "Summarize this page", "A checklist to get this done"] : ["Make it shorter", "Make it clearer", "Turn it into a table", "Add an example", "Translate to German"];
    bar.innerHTML = `<div class="ask-row"><span class="spark">${ICON.spark}</span><input type="text" placeholder="${isNew ? "Ask Claude to write or build anything here…" : "Ask Claude to change this block…"}" aria-label="Ask Claude"><label class="ask-web" title="Let the Claude writing this block search and read the web in your browser"><input type="checkbox"> web</label><button type="button" class="btn primary">Ask</button></div><div class="ask-sugg">${sugg.map(s => `<button type="button">${esc(s)}</button>`).join("")}</div><div class="ask-foot">${isNew ? "Claude writes a block here, in place, while you watch" : "Claude rewrites this block"} · ↵ to ask · esc to cancel</div>`;
    el.appendChild(bar); this.askEl = bar;
    const inp = bar.querySelector("input[type=text]"), web = bar.querySelector(".ask-web input");
    if (!isNew) bar.querySelector(".ask-web").hidden = true;
    const go = text => {
      text = text.trim(); if (!text) return; this.closeAsk();
      if (isNew) {
        if (!S.K.exists(q)) return;
        writeText(`${q} = ?${JSON.stringify(text)}${web.checked ? " @browser" : ""}`);
        if (S.sample) fillHoles([q]); else toast(S.db ? "Saved as a Claude block. Ask Claude in chat to write the Claude blocks on this page." : "Saved as a Claude block. Claude writes it when this page is open inside Claude.");
      } else Claude.ask(text, { app: page, node: q });
    };
    inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); go(inp.value); } if (e.key === "Escape") { e.preventDefault(); this.closeAsk(); this.focusAt(q, 0); } });
    bar.querySelector(".btn.primary").addEventListener("click", () => go(inp.value));
    bar.querySelector(".ask-sugg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; const s = b.textContent; go(s === "Continue writing" ? "Continue writing this page from where it stops, in its voice: two or three blocks" : s === "Summarize this page" ? "A short summary of this page as a callout" : s); });
    setTimeout(() => inp.focus(), 0);
  },
  closeAsk() { if (this.askEl) { this.askEl.remove(); this.askEl = null; } },
};

/* ---------- the slash menu: every kind of block, prose and live, in one list ---------- */
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const SAMPLE_ROWS = () => [
  `0 = {name: "Sketch the outline", status: "done", owner: "Ana", due: "${iso(-3)}", hours: 2}`,
  `1 = {name: "Interview three users", status: "doing", owner: "Ravi", due: "${iso(2)}", hours: 5}`,
  `2 = {name: "Draft the first version", status: "doing", owner: "Ana", due: "${iso(5)}", hours: 8}`,
  `3 = {name: "Review with the team", status: "todo", owner: "Mia", due: "${iso(9)}", hours: 1}`,
];
const db = (name, view) => page => { const n = Pages.cell(page, name); return { data: [`${n}:`].concat(SAMPLE_ROWS().map(l => "  " + l)), blocks: [{ head: Ed.viewLineFor(n, view) }] }; };
Ed.viewLineFor = (n, view) => ({ table: `table ${n}`, board: `board ${n}, by: "status", title: "name", cols: "todo|doing|done", meta: "owner"`, calendar: `calendar ${n}, date: "due", label: "name"`, timeline: `timeline ${n}, at: "due", label: "name"`, cards: `cards ${n}, title: "name", body: "owner", meta: "status"`, list: `list ${n}, text: "name"`, bars: `bars ${n}, x: "name", y: "hours"` }[view]);
const SLASH = () => {
  const L = [
    ["Basic blocks"],
    { label: "Text", sub: "Just start writing", icon: "Aa", kw: "p paragraph plain", kind: "p" },
    { label: "Heading 1", sub: "Big section heading", icon: "H1", kw: "h1 title #", kind: "h1" },
    { label: "Heading 2", sub: "Medium section heading", icon: "H2", kw: "h2 ##", kind: "h2" },
    { label: "Heading 3", sub: "Small section heading", icon: "H3", kw: "h3 ###", kind: "h3" },
    { label: "To-do list", sub: "Track tasks with a checkbox", icon: "☑", kw: "todo task check []", kind: "todo" },
    { label: "Bulleted list", sub: "A simple list", icon: "•", kw: "bullet ul -", kind: "bullet" },
    { label: "Numbered list", sub: "A list with numbers", icon: "1.", kw: "numbered ol ordered", kind: "numbered" },
    { label: "Toggle", sub: "Hide blocks inside", icon: "▸", kw: "fold toggle collapse details >", kind: "fold" },
    { label: "Quote", sub: "Capture a quote", icon: "❝", kw: "quote blockquote", kind: "quote" },
    { label: "Callout", sub: "Make writing stand out", icon: "💡", kw: "callout note info", kind: "callout" },
    { label: "Divider", sub: "Separate blocks", icon: "—", kw: "divider hr line ---", kind: "divider" },
    { label: "Code", sub: "A code snippet", icon: "</>", kw: "code snippet ```", kind: "code" },
    { label: "Page", sub: "A sub-page inside this one", icon: "📄", kw: "page subpage new", run: (q, page) => { const id = Pages.create({ parent: page, go: false }); writeText(`${q} is page ${JSON.stringify(id)}`); Nav.go(id); Ed.wantTitle = true; } },
    { label: "Columns", sub: "Two columns side by side", icon: "▥", kw: "columns layout side", make: () => ({ blocks: [{ head: "columns", kids: ["col", '  p ""', "col", '  p ""'] }] }) },
    { label: "Table of contents", sub: "The headings on this page", icon: "≣", kw: "toc contents outline", make: () => ({ blocks: [{ head: "toc" }] }) },
    ["Claude"],
    { label: "Claude block", sub: "Say what goes here: a Claude writes it in place", icon: "✳", kw: "ai claude ask write hole generate", claude: true, run: q => Ed.ask(q, "new") },
    { label: "Ask Claude about this page", sub: "Build, restructure or extend it (⌘J)", icon: "✳", kw: "ai claude agent page", claude: true, run: () => Agent.open() },
    { label: "Browser", sub: "Your browser, live in the page", icon: "🌐", kw: "web browser url site", make: page => { const u = Pages.cell(page, "url"), t = Pages.cell(page, "page_text"); return { data: [`${u} = "https://en.wikipedia.org/wiki/Notion_(productivity_software)"`, `${t} = ""`], blocks: [{ head: `browser ${u}, text: ${t}, h: 460` }] }; } },
    { label: "Program", sub: "JavaScript that runs and writes cells", icon: "▶", kw: "program code js javascript run script", make: page => { const r = Pages.cell(page, "run"), n = Pages.cell(page, "ticks"); return { data: [`${n} = 0`, `${r} = |`, `  every(1000, async () => set("${n}", (await read("${n}")) + 1))`, `  print("counting ${n} once a second")`, `${r} :: program`], blocks: [{ head: `program ${r}` }, { head: `p "The program has counted {${n}} seconds."` }] }; } },
    { label: "Spore app", sub: "A live JavaScript app with controls", icon: "🍄", kw: "spore simulation sim game app js", make: page => { const c = Pages.cell(page, "code"), pre = window.CC5Spore && CC5Spore.presets && CC5Spore.presets[0]; const code = String(pre ? pre.code : "app(\"hello\", { title: \"Hello\" }).param(\"n\", 3, { min: 1, max: 9 }).view(v => v.stat(\"n\", \"N\"))").replace(/\s+$/, ""); return { data: [`${c} = |`].concat(code.split("\n").map(l => "  " + l)), blocks: [{ head: `spore ${c}` }] }; } },
    ["Live"],
    { label: "Inline formula", sub: "A live value inside your text: {total / people}", icon: "{ }", kw: "formula equation inline value expression math", run: (q, page, ed, at) => { Ed.focusAt(q, at); setTimeout(() => { const e2 = Ed.edOf(q); if (e2) { if (document.activeElement !== e2) { e2.focus(); setCaret(e2, at); } insertText("{}"); const c = caretOf(e2); setCaret(e2, c.start - 1); } }, 70); } },
    { label: "Number", sub: "A named number you can use in formulas", icon: "#", kw: "number num cell variable", make: page => { const n = Pages.cell(page, "amount"); return { data: [`${n} = 100`], blocks: [{ head: `num ${n}, label: ${JSON.stringify(n.replace(/_/g, " "))}` }] }; } },
    { label: "Slider", sub: "Drag a number", icon: "⇿", kw: "slider range input", make: page => { const n = Pages.cell(page, "level"); return { data: [`${n} = 50`], blocks: [{ head: `slider ${n}, min: 0, max: 100, label: ${JSON.stringify(n.replace(/_/g, " "))}` }, { head: `p "Set to {${n}}."` }] }; } },
    { label: "Stat", sub: "A big number with a label", icon: "▣", kw: "stat kpi metric number big", make: page => { const n = Pages.cell(page, "total"); return { data: [`${n} = 1298`], blocks: [{ head: `stat ${n}, label: "Total"` }] }; } },
    { label: "Progress", sub: "A bar that fills", icon: "▭", kw: "progress bar percent", make: page => { const n = Pages.cell(page, "done_share"); return { data: [`${n} = 0.4`], blocks: [{ head: `progress ${n}, label: "Done"` }] }; } },
    { label: "Button", sub: "Runs a line when pressed", icon: "⏺", kw: "button action click counter", make: page => { const n = Pages.cell(page, "clicks"); return { data: [`${n} = 0`], blocks: [{ head: `button "Press me" -> ${n} = ${n} + 1` }, { head: `p "Pressed {${n}} times."` }] }; } },
    { label: "Date", sub: "Pick a day; days(…) counts to it", icon: "📅", kw: "date day deadline", make: page => { const n = Pages.cell(page, "deadline"); return { data: [`${n} = "${iso(14)}"`], blocks: [{ head: `date ${n}, label: "Deadline"` }, { head: `p "{days(today(), ${n})} days to go."` }] }; } },
    { label: "Timer", sub: "A focus timer", icon: "⏱", kw: "timer pomodoro countdown clock", make: page => { const n = Pages.cell(page, "ends"); return { data: [`${n} = 0`], blocks: [{ head: `h1 if(${n} > clock.now, dur(${n} - clock.now), "25:00")` }, { head: `button if(${n} > clock.now, "Stop", "Start focus") -> ${n} = if(${n} > clock.now, 0, clock.now + 25 * 60000)` }] }; } },
    ["Database"],
    { label: "Table", sub: "A database as a table", icon: "▦", kw: "table database db grid rows", make: db("tasks", "table") },
    { label: "Board", sub: "A database as a kanban board", icon: "▤", kw: "board kanban database", make: db("tasks", "board") },
    { label: "Calendar", sub: "A database by date", icon: "🗓", kw: "calendar database dates", make: db("events", "calendar") },
    { label: "Timeline", sub: "A database in time order", icon: "⟶", kw: "timeline gantt database", make: db("plan", "timeline") },
    { label: "Gallery", sub: "A database as cards", icon: "▚", kw: "gallery cards database", make: db("items", "cards") },
    { label: "Chart", sub: "A database as bars", icon: "▮", kw: "chart bars graph plot database", make: db("work", "bars") },
    ["Media"],
    { label: "File or image", sub: "Upload pictures, PDFs, sound", icon: "🖼", kw: "image picture photo file upload pdf media", make: page => { const n = Pages.cell(page, "media"); return { data: [`${n} = []`], blocks: [{ head: `upload ${n}` }, { head: `each m in ${n}`, kids: ["file m"] }] }; } },
    { label: "Hypha line", sub: "Write the block in the language itself", icon: "⌁", kw: "hypha source raw line code element", run: q => Src.block(q) },
  ];
  const lib = CC5Lego.Lib.names(S.K);
  if (lib.length) {
    L.push(["Library"]);
    for (const n of lib) L.push({ label: n.replace(/_/g, " "), sub: CC5Lego.Lib.about(S.K, n) || "A component", icon: "◇", kw: "component lib " + n, make: () => { const ex = CC5Lego.Lib.example(S.K, n), t = S.K.takesOf(n), args = []; let pos = true; for (const k of t) { if (!(k in ex)) { pos = false; continue; } args.push(pos ? showLit(ex[k]) : `${k}: ${showLit(ex[k])}`); } return { blocks: [{ head: n + (args.length ? " " + args.join(", ") : "") }] }; } });
  }
  return L;
};
const Slash = {
  q: null, ed: null, start: 0, idx: 0, shown: [],
  open(q, ed, start) { this.q = q; this.ed = ed; this.start = start; this.idx = 0; this.update(); },
  close() { if (!this.q) return; this.q = null; this.ed = null; $("#slash").hidden = true; },
  query() { const raw = this.ed.textContent, c = caretOf(this.ed).start; if (c <= this.start || raw[this.start] !== "/") return null; return raw.slice(this.start + 1, c); },
  update() {
    if (!this.q || !this.ed) return;
    const qy = this.query(); if (qy == null || qy.length > 24 || /\s{2}/.test(qy)) return this.close();
    const ql = qy.toLowerCase().trim(), all = SLASH(), out = []; let group = null;
    for (const it of all) {
      if (Array.isArray(it)) { group = it[0]; continue; }
      const hay = (it.label + " " + (it.kw || "")).toLowerCase();
      const sc = !ql ? 1 : hay.startsWith(ql) ? 100 : it.label.toLowerCase().split(/\s+/).some(w => w.startsWith(ql)) ? 80 : hay.includes(ql) ? 50 : 0;
      if (sc) out.push(Object.assign({ group, sc }, it));
    }
    if (ql) out.sort((a, b) => b.sc - a.sc);
    if (!out.length && /\s/.test(qy)) return this.close();
    this.shown = out; this.idx = Math.min(this.idx, Math.max(0, out.length - 1));
    const m = $("#slash"); let g = null;
    m.innerHTML = out.length ? out.map((it, i) => { const head = !ql && it.group !== g ? `<div class="mg">${esc((g = it.group))}</div>` : ""; return head + `<button type="button" role="option" class="mi${i === this.idx ? " on" : ""}${it.claude ? " claude" : ""}" data-i="${i}" aria-selected="${i === this.idx}"><span class="ic">${esc(it.icon)}</span><span class="tx"><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></span></button>`; }).join("") : `<div class="none">No blocks match “${esc(qy)}”</div>`;
    m.hidden = false; this.place(m);
    const on = m.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
  },
  place(m) {
    const s = getSelection(); let r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
    if (!r || (!r.width && !r.height && !r.top)) r = this.ed.getBoundingClientRect();
    const mh = Math.min(380, m.scrollHeight), below = innerHeight - r.bottom > mh + 16;
    m.style.left = Math.max(8, Math.min(innerWidth - 336, r.left)) + "px";
    m.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - mh - 6)) + "px";
  },
  key(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); this.idx = (this.idx + 1) % Math.max(1, this.shown.length); this.update(); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.idx = (this.idx - 1 + this.shown.length) % Math.max(1, this.shown.length); this.update(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { if (!this.shown.length) { this.close(); return false; } e.preventDefault(); this.choose(this.shown[this.idx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); this.close(); return true; }
    return false;
  },
  choose(it) {
    const q = this.q, ed = this.ed; if (!q || !it) return;
    const raw = ed.textContent, c = caretOf(ed).start, rest = raw.slice(0, this.start) + raw.slice(c);
    this.close(); clearTimeout(Ed.saveT);
    Ed.apply(q, rest, it, ed, this.start);
  },
};
/* a chosen item lands: a prose kind turns this block; anything else is written after it (or instead of it, when empty) */
Ed.apply = function (q, rest, it, ed, at) {
  const K = S.K, page = pageOf(q), empty = !rest.trim(), c = M.parentOf(q);
  if (it.kind) {
    writeText(`${q}.${B.textProp(F.kindOf(K, q))} = ${showLit(rest)}`);
    if (it.kind === "divider") { if (empty) { Ops.turn(q, "divider"); const T = Ops.insert(c, q, { head: 'p ""' }); this.focusAt(T, 0); } else { const D = Ops.insert(c, q, { head: "divider" }); const T = Ops.insert(c, D, { head: 'p ""' }); this.focusAt(T, 0); } return; }
    const T = Ops.turn(q, it.kind); this.focusAt(T, Math.min(at, rest.length)); return;
  }
  if (it.run) { writeText(`${q}.${B.textProp(F.kindOf(K, q))} = ${showLit(rest)}`); return it.run(q, page, ed, at); }
  const spec = it.make(page);
  if (spec.data && spec.data.length) writeText(spec.data.join("\n"), { base: page });
  const paths = []; let after = q;
  if (empty) { writeText([`${q} -`].concat(Ops.lines(spec.blocks[0], q)).join("\n")); paths.push(q); }
  else { writeText(`${q}.${B.textProp(F.kindOf(K, q))} = ${showLit(rest)}`); after = Ops.insert(c, q, spec.blocks[0]); paths.push(after); }
  after = paths[0];
  for (const b of spec.blocks.slice(1)) { after = Ops.remap(after); after = Ops.insert(c, after, b); paths.push(after); }
  const last = Ops.remap(paths[paths.length - 1]), lk = F.kindOf(S.K, last);
  if (lk === "columns") { const col = kidsOf(S.K, last)[0], first = col && kidsOf(S.K, col)[0]; if (first) this.focusAt(first, 0); return; }
  if (!EDITABLE.includes(lk)) { const T = Ops.insert(c, last, { head: 'p ""' }); this.focusAt(T, 0); }
  else this.focusAt(last, Infinity);
};

/* ---------- [[ mentions: link a page while typing ---------- */
const Mention = {
  q: null, ed: null, start: 0, idx: 0, shown: [],
  open(q, ed, start) { this.q = q; this.ed = ed; this.start = start; this.update(); },
  close() { if (!this.q) return; this.q = null; $("#mention").hidden = true; },
  update() {
    const raw = this.ed.textContent, c = caretOf(this.ed).start, qy = raw.slice(this.start + 2, c).toLowerCase();
    const pages = Pages.list(S.K).map(p => ({ p, t: Pages.title(p, S.K) })).filter(x => !qy || x.t.toLowerCase().includes(qy) || x.p.includes(qy)).slice(0, 8);
    this.shown = pages.map(x => ({ name: x.p, label: x.t, icon: Pages.icon(x.p, S.K) || "📄" }));
    if (qy) this.shown.push({ create: true, label: `New page “${raw.slice(this.start + 2, c)}”`, title: raw.slice(this.start + 2, c), icon: "+" });
    this.idx = Math.min(this.idx, Math.max(0, this.shown.length - 1));
    const m = $("#mention");
    m.innerHTML = `<div class="mg">Link to a page</div>` + this.shown.map((it, i) => `<button type="button" class="mi${i === this.idx ? " on" : ""}" data-i="${i}"><span class="ic">${esc(it.icon)}</span><span class="tx"><b>${esc(it.label)}</b>${it.name ? `<small>${esc(it.name)}</small>` : ""}</span></button>`).join("");
    m.hidden = false; Slash.place.call({ ed: this.ed }, m);
  },
  key(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); this.idx = (this.idx + 1) % this.shown.length; this.update(); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.idx = (this.idx - 1 + this.shown.length) % this.shown.length; this.update(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); this.choose(this.shown[this.idx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); this.close(); return true; }
    return false;
  },
  choose(it) {
    if (!it) return; const ed = this.ed, q = this.q, c = caretOf(ed).start;
    let name = it.name;
    if (it.create) name = Pages.create({ title: it.title, parent: pageOf(q), go: false });
    setCaret(ed, this.start, c); insertText(`[[${name}]]`); this.close(); Ed.onInput(ed);
  },
};

/* ---------- the block menu (⋮⋮): turn into, colour, Claude, move, the block as Hypha ---------- */
const TURN = [["p", "Text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["todo", "To-do list"], ["bullet", "Bulleted list"], ["numbered", "Numbered list"], ["fold", "Toggle"], ["quote", "Quote"], ["callout", "Callout"], ["code", "Code"]];
const Menu = {
  q: null, view: "main",
  open(q, at, view = "main") {
    this.q = q; this.view = view; const K = S.K, m = $("#menu"), kind = F.kindOf(K, q);
    const kc = K.cells.get(q + ".k") || K.cells.get(q) || K.cells.get(q + "." + B.textProp(kind)), by = kc && kc.by, when = kc && kc.at;
    const prose = EDITABLE.includes(kind);
    let html = "";
    if (view === "turn") html = `<div class="mg">Turn into</div>` + TURN.map(([k, l]) => `<button type="button" class="mi${k === kind ? " on" : ""}" data-turn="${k}"><span class="tx"><b>${l}</b></span></button>`).join("");
    else if (view === "color") html = `<div class="mg">Text colour</div><div class="swatches">` + Object.entries(B.COLORS).map(([n, [fg]]) => `<button type="button" data-color="${n}" title="${n}" style="--s:${fg || "var(--ink)"}"><span>A</span></button>`).join("") + `</div><div class="mg">Background</div><div class="swatches bg">` + Object.entries(B.COLORS).map(([n, [, bg]]) => `<button type="button" data-bg="${n}" title="${n} background" style="--s:${bg || "var(--paper)"}"><span>A</span></button>`).join("") + `</div>`;
    else if (view === "move") html = `<div class="mg">Move to</div>` + Pages.list(K).filter(p => p !== pageOf(q)).map(p => `<button type="button" class="mi" data-moveto="${esc(p)}"><span class="ic">${esc(Pages.icon(p, K) || "📄")}</span><span class="tx"><b>${esc(Pages.title(p, K))}</b></span></button>`).join("");
    else html = `<button type="button" class="mi claude" data-m="ask"><span class="ic">✳</span><span class="tx"><b>Ask Claude</b></span><kbd>space</kbd></button>
      ${prose ? `<button type="button" class="mi" data-m="turn"><span class="ic">↻</span><span class="tx"><b>Turn into</b></span><span class="chev">›</span></button><button type="button" class="mi" data-m="color"><span class="ic">◐</span><span class="tx"><b>Colour</b></span><span class="chev">›</span></button>` : kind === "hole" ? "" : `<button type="button" class="mi" data-m="text"><span class="ic">↻</span><span class="tx"><b>Turn into text</b></span></button>`}
      <button type="button" class="mi" data-m="dup"><span class="ic">⧉</span><span class="tx"><b>Duplicate</b></span><kbd>⌘D</kbd></button>
      <button type="button" class="mi" data-m="up"><span class="ic">↑</span><span class="tx"><b>Move up</b></span><kbd>⌘⇧↑</kbd></button>
      <button type="button" class="mi" data-m="down"><span class="ic">↓</span><span class="tx"><b>Move down</b></span><kbd>⌘⇧↓</kbd></button>
      <button type="button" class="mi" data-m="move"><span class="ic">↗</span><span class="tx"><b>Move to page</b></span><span class="chev">›</span></button>
      <button type="button" class="mi" data-m="src"><span class="ic">⌁</span><span class="tx"><b>Edit as Hypha</b></span></button>
      <button type="button" class="mi" data-m="copy"><span class="ic">⎘</span><span class="tx"><b>Copy as Hypha</b></span><kbd>⌘C</kbd></button>
      <button type="button" class="mi danger" data-m="del"><span class="ic">🗑</span><span class="tx"><b>Delete</b></span><kbd>⌫</kbd></button>
      <div class="m-foot"><code>${esc(Ops.rel(K, q)[0].slice(0, 120))}</code><span>${esc(q)}${by ? ` · last written by <b style="color:${colorOf(by)}">${esc(nameOf(by))}</b>${when ? " " + esc(ago(when)) : ""}` : ""}</span></div>`;
    m.innerHTML = html; m.hidden = false;
    const r = at.getBoundingClientRect ? at.getBoundingClientRect() : at;
    m.style.left = Math.max(8, Math.min(innerWidth - 300, r.left)) + "px";
    const mh = m.scrollHeight; m.style.top = (innerHeight - r.bottom > mh + 10 ? r.bottom + 4 : Math.max(8, r.top - mh - 4)) + "px";
    S.local.set("menuAt", r);
    Ed.select([q]);
  },
  close() { if (!this.q) return; this.q = null; $("#menu").hidden = true; },
  act(e) {
    const t = e.target.closest("button"); if (!t) return; const q = this.q, K = S.K; if (!q || !K.exists(q)) return this.close();
    const at = S.local.get("menuAt");
    if (t.dataset.m === "turn" || t.dataset.m === "color" || t.dataset.m === "move") return this.open(q, at, t.dataset.m);
    this.close(); Ed.sel.clear();
    if (t.dataset.turn) { const T = Ops.turn(q, t.dataset.turn); Ed.focusAt(T, Infinity); return; }
    if (t.dataset.color) { writeText(t.dataset.color === "default" ? `${q}.color -` : `${q}.color = "${t.dataset.color}"`); return; }
    if (t.dataset.bg) { writeText(t.dataset.bg === "default" ? `${q}.bg -` : `${q}.bg = "${t.dataset.bg}"`); return; }
    if (t.dataset.moveto) { const to = t.dataset.moveto; Ops.move(q, to + ".ui", Ops.last(to + ".ui")); toast(`Moved to ${Pages.title(to)}`, { label: "Go there", run: () => Nav.go(to) }); return; }
    switch (t.dataset.m) {
      case "ask": Ed.ask(q, F.kindOf(K, q) === "p" && !(K.cells.get(q + ".text") || {}).v ? "new" : "edit"); break;
      case "text": { const T = Ops.turn(q, "p"); Ed.focusAt(T, 0); break; }
      case "dup": Ops.dup(q); break;
      case "up": Ed.nudge(q, -1); break;
      case "down": Ed.nudge(q, 1); break;
      case "src": Src.block(q); break;
      case "copy": copyBlocks([q]); break;
      case "del": Ops.remove(q); break;
    }
    schedule();
  },
};
function copyBlocks(list) {
  const K = S.K, text = list.map(q => Ops.rel(K, q).join("\n")).join("\n");
  navigator.clipboard.writeText(text).then(() => toast(`Copied ${list.length} block${list.length > 1 ? "s" : ""} as Hypha: paste into any page, or into a chat with Claude`), () => toast("Could not reach the clipboard"));
}

/* ---------- dragging blocks by their handle ---------- */
const Drag = {
  st: null,
  down(e, q, handle) {
    if (S.readOnly || S.view !== S.K || e.button !== 0) return;
    this.st = { q, x: e.clientX, y: e.clientY, on: false, handle, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
  },
  move(e) {
    const st = this.st; if (!st) return;
    if (!st.on) { if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5) return; st.on = true; Ed.blur(); Menu.close(); document.body.classList.add("dragging"); const el = Ed.els.get(st.q); if (el) el.classList.add("lifted"); }
    const line = $("#dropline"), under = document.elementFromPoint(e.clientX, e.clientY);
    let tgt = under && under.closest("#blocks .blk[data-p], #blocks .colx");
    if (tgt && tgt.classList.contains("grp")) tgt = null;
    if (tgt && tgt.dataset.p && (tgt.dataset.p === st.q || tgt.dataset.p.startsWith(st.q + "."))) tgt = null;
    if (!tgt) { const bl = $("#blocks"), r = bl.getBoundingClientRect(); if (e.clientY > r.bottom - 6 && e.clientY < r.bottom + 120) { st.drop = { to: S.page + ".ui", after: Ops.last(S.page + ".ui") }; line.hidden = false; Object.assign(line.style, { left: r.left + "px", top: r.bottom + "px", width: r.width + "px", height: "3px" }); } else { st.drop = null; line.hidden = true; } return; }
    const r = tgt.getBoundingClientRect();
    if (tgt.classList.contains("colx")) { st.drop = { to: tgt.dataset.c, after: Ops.last(tgt.dataset.c) }; Object.assign(line.style, { left: r.left + "px", top: r.bottom - 2 + "px", width: r.width + "px", height: "3px" }); line.hidden = false; return; }
    const p = tgt.dataset.p, c = M.parentOf(p), side = e.clientX > r.left + r.width * 0.86 && /\.ui$/.test(c) && tgt.classList.contains("blk");
    const before = e.clientY < r.top + Math.min(r.height / 2, 16);
    if (side) { st.drop = { side: p }; Object.assign(line.style, { left: r.right - 3 + "px", top: r.top + "px", width: "3px", height: r.height + "px" }); }
    else { const sib = kidsOf(S.K, c), i = sib.indexOf(p); st.drop = { to: c, after: before ? (i > 0 ? sib[i - 1] : null) : p }; Object.assign(line.style, { left: r.left + "px", top: (before ? r.top - 2 : r.bottom - 1) + "px", width: r.width + "px", height: "3px" }); }
    line.hidden = false;
  },
  up() {
    const st = this.st; this.st = null; if (!st) return;
    $("#dropline").hidden = true; document.body.classList.remove("dragging"); const el = Ed.els.get(st.q); if (el) el.classList.remove("lifted");
    if (!st.on) { Menu.open(st.q, st.handle); return; }
    const d = st.drop; if (!d) return;
    if (d.side) {
      const K = S.K, tgt = d.side, c = M.parentOf(tgt), mine = Ops.rel(K, st.q), theirs = Ops.rel(K, tgt);
      writeText(`${st.q} -`);
      const sib = kidsOf(S.K, c), items = sib.map(x => x === tgt ? { head: "columns", kids: ["col"].concat(theirs.map(l => "  " + l), ["col"], mine.map(l => "  " + l)) } : { from: x });
      Ops.relayout(c, items); return;
    }
    if (d.after === st.q) return;
    Ops.move(st.q, d.to, d.after);
  },
};

/* ---------- Hypha, in a dialog: a block, a cell, or a whole page as the lines that write it ---------- */
const Src = {
  open(title, text, apply, note) {
    const d = $("#src"); d.hidden = false;
    $("#src-title").textContent = title; $("#src-note").textContent = note || ""; $("#src-err").textContent = "";
    const ta = $("#src-ta"); ta.value = text; ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
    this.apply = apply;
  },
  close() { $("#src").hidden = true; this.apply = null; },
  run() {
    const t = $("#src-ta").value; if (!this.apply) return;
    const err = this.apply(t); if (err) { $("#src-err").textContent = err; return; }
    this.close();
  },
  block(q) {
    const K = S.K; if (!K.exists(q)) { writeText(`${q} is p ""`); }
    this.open(`Block ${q}`, Ops.rel(S.K, q).join("\n"), t => {
      const lines = t.replace(/\t/g, "  ").split("\n").filter(l => l.trim()); if (!lines.length) { Ops.remove(q); return; }
      const item = { head: lines[0].trim(), kids: lines.slice(1).map(l => l.replace(/^ {2}/, "")) };
      const probe = parses(["x.ui:", "  " + item.head].concat(item.kids.map(l => "    " + l)).join("\n"));
      if (!probe.ok) return `Line does not read: ${probe.bad ? probe.bad.text + " → " + probe.bad.err : "?"}`;
      writeText([`${q} -`].concat(Ops.lines(item, q)).join("\n"));
    }, "One element per line, children indented two spaces: p \"text\", slider days, min: 1, table rows… or ?\"intent\" for a Claude block.");
  },
  page(page) {
    const K = S.K;
    this.open(`${Pages.title(page, K)} as Hypha`, K.toHypha({ root: page, values: false }), t => {
      const probe = parses(t); if (!probe.ok) return `Line does not read: ${probe.bad ? probe.bad.text + " → " + probe.bad.err : "?"}`;
      const st = new M.Stream(S.K, meId()); Undo.mark(); st.feed(t + "\n"); const ops = st.end();
      const covered = p => [...st.written].some(w => p === w || p.startsWith(w + "."));
      const gone = S.K.leavesUnder(page).filter(l => !covered(l) && !M.isViewPath(l));
      if (gone.length) writeText(gone.map(l => `${l} -`).join("\n"), { undo: true });
      const bad = ops.filter(o => !o.ok); if (bad.length) toast(`${bad.length} line${bad.length > 1 ? "s" : ""} did not apply: ${bad[0].text} → ${bad[0].err}`);
    }, "The whole page in its own language: properties above, blocks in ui:. Apply writes what changed; lines you delete are removed.");
  },
  cell(path) {
    const K = S.K, root = M.parentOf(path), seg = M.segOf(path);
    const text = K.cells.has(path) ? K.toHyphaOne(path).replace(path, seg) : K.toHypha({ root: path, values: false }).replace(new RegExp("^" + path.replace(/\./g, "\\.") + ":"), seg + ":");
    this.open(`Property ${seg}`, text, t => {
      const probe = parses(t); if (!probe.ok) return `Line does not read: ${probe.bad ? probe.bad.text + " → " + probe.bad.err : "?"}`;
      writeText(`${seg} -\n` + t, { base: root });
    });
  },
};

/* ---------- covers and icons ---------- */
const COVERS = {
  clay: "linear-gradient(120deg, #F2C9B4 0%, #E3906F 38%, #C8613F 70%, #8E3E28 100%)",
  ocean: "linear-gradient(120deg, #CFE8F2 0%, #7FB6D4 40%, #3C7FA8 75%, #1D4E73 100%)",
  sage: "linear-gradient(120deg, #E4EBDC 0%, #B4C7A3 40%, #7F9C71 75%, #4F6B47 100%)",
  dusk: "linear-gradient(120deg, #F3D9E4 0%, #C9A5D3 40%, #8A72B8 72%, #3F3A7A 100%)",
  sand: "linear-gradient(120deg, #FBF1DF 0%, #EDD3A6 45%, #CFA669 80%, #9C7536 100%)",
  night: "linear-gradient(120deg, #2C3242 0%, #1C2030 50%, #3B2F4A 100%)",
  rose: "linear-gradient(120deg, #FBE3DF 0%, #F0A9A0 45%, #D06D68 80%, #9A3E43 100%)",
  mint: "linear-gradient(120deg, #E1F5EE 0%, #A6DDC8 45%, #5FB59A 80%, #2F7F69 100%)",
};
const EMOJI = "📄 📝 ✳️ 💡 📚 🧭 🗺️ 🇵🇹 🧳 🏠 🌱 🌊 🔥 ⭐ ✅ 📌 📅 🗓️ 📈 💰 🧪 🔬 🛠️ ⚙️ 🎯 🎨 🎬 🎵 📷 🍳 🍷 ☕ 🏃 🧘 ❤️ 🙂 🤖 🧠 🗂️ 📦 🚀 ✈️ 🏔️ 🌍 🐙 🍄 🪴 🧩 🎲 📖 ✏️ 🔑".split(" ");
const Pick = {
  open(at, onPick, opts = {}) {
    const m = $("#pick"); m.hidden = false;
    m.innerHTML = `<div class="pick-h"><b>${esc(opts.title || "Icon")}</b><span class="grow"></span>${opts.remove ? `<button type="button" class="btn ghost" data-x="1">Remove</button>` : ""}</div><div class="pick-g">${(opts.items || EMOJI).map(e => `<button type="button" data-e="${esc(e)}" title="${esc(opts.names ? opts.names[e] || e : e)}"${opts.css ? ` style="background:${opts.css(e)}"` : ""}>${opts.css ? "" : esc(e)}</button>`).join("")}</div>`;
    const r = at.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(innerWidth - 320, r.left)) + "px"; m.style.top = Math.min(innerHeight - m.scrollHeight - 8, r.bottom + 6) + "px";
    m.onclick = e => { const b = e.target.closest("button"); if (!b) return; m.hidden = true; if (b.dataset.x) onPick(null); else onPick(b.dataset.e); };
  },
  close() { $("#pick").hidden = true; },
};

/* ---------- properties: the page's own cells, editable like Notion's, live like a spreadsheet's ---------- */
const Props = {
  more: false,
  rows(page, K = S.view) { return K.children(page).filter(s => !META.has(s) && !(K.cells.has(page + "." + s) && K.cells.get(page + "." + s).local)); },
  type(K, p) {
    const c = K.cells.get(p);
    if (!c) { const v = K.valueAt(p); return Array.isArray(v) ? ["≡", "list"] : ["{ }", "record"]; }
    if (c.kind === "formula") return ["ƒ", "formula"]; if (c.kind === "hole") return ["✳", "Claude block"]; if (c.kind === "fn") return ["ƒx", "function"];
    const t = K.types.get(p); if (t && t.name === "program") return ["▶", "program"];
    if (typeof c.v === "number") return ["#", "number"]; if (typeof c.v === "boolean") return ["☑", "checkbox"];
    if (typeof c.v === "string") return c.v.includes("\n") ? ["¶", "text block"] : /^\d{4}-\d{2}-\d{2}/.test(c.v) ? ["📅", "date"] : /^https?:\/\//.test(c.v) ? ["🔗", "url"] : ["Aa", "text"];
    return ["{ }", "value"];
  },
  value(K, p, env) {
    const c = K.cells.get(p);
    if (!c) { const v = K.valueAt(p); if (Array.isArray(v)) { const rec = v.find(x => x && typeof x === "object"); return `<span class="pv-list">${v.length} ${rec ? "row" : "item"}${v.length === 1 ? "" : "s"}${rec ? ` · ${esc(Object.keys(rec).slice(0, 4).join(", "))}` : ""}</span>`; } return `<span class="pv-list">${esc(Object.keys(v || {}).slice(0, 5).join(", "))}</span>`; }
    if (c.kind === "hole") return `<span class="pv-hole">${esc(c.intent || "empty")}</span>`;
    if (c.kind === "fn") return `<code>(${esc(c.params.join(", "))}) = ${esc(c.src)}</code>`;
    if (c.kind === "formula") { const v = c.dirty ? (K.compute(c), c.v) : c.v; const shown = M.isRes(v) ? "…" : M.isErr(v) ? v.msg : Array.isArray(v) ? (v.length && v.every(x => x && typeof x === "object") ? `${v.length} row${v.length === 1 ? "" : "s"}` : v.length > 6 ? `${v.length} items` : F.fmt(v)) : v && typeof v === "object" ? "{ " + Object.keys(v).slice(0, 5).join(", ") + " }" : F.fmt(v); return `<span class="pv-f${M.isErr(v) ? " err" : ""}">${esc(String(shown).slice(0, 90))}</span><code class="pv-src">= ${esc(c.src)}</code>`; }
    if (typeof c.v === "boolean") return `<button type="button" class="pv-check" role="checkbox" aria-checked="${c.v}" data-flip="${esc(p)}"${env.readonly ? " disabled" : ""}></button>`;
    if (typeof c.v === "string") return c.v ? `<span class="pv-t">${esc(c.v.split("\n")[0].slice(0, 140))}${c.v.includes("\n") ? " …" : ""}</span>` : `<span class="pv-empty">Empty</span>`;
    return `<span class="pv-t">${esc(F.fmt(c.v))}</span>`;
  },
  render(page) {
    const K = S.view, host = $("#props"), env = envFor(page), names = this.rows(page, K);
    const open = S.local.get("props:" + page) !== false;
    if (!names.length) { const sig = "none" + env.readonly; if (host._sig !== sig) { host._sig = sig; host.innerHTML = ""; } return; }
    const shown = this.more || names.length <= 7 ? names : names.slice(0, 6);
    const recent = new Set(); for (const [p, t] of S.pulse || []) if (performance.now() - t < 900) recent.add(p);
    const rows = open ? shown.map(s => { const p = page + "." + s, [ic, tn] = this.type(K, p); return `<div class="prow${recent.has(p) ? " pulse" : ""}" data-path="${esc(p)}"><span class="pk" title="${esc(tn)}"><i>${esc(ic)}</i>${esc(s.replace(/_/g, " "))}</span><span class="pv" tabindex="0" role="button" aria-label="Edit ${esc(s)}">${this.value(K, p, env)}</span></div>`; }).join("") : "";
    const html = `<div class="props-h"><button type="button" class="props-t" aria-expanded="${open}" data-pt="1"><span class="tri"></span>${names.length} propert${names.length === 1 ? "y" : "ies"}<small>live cells of this page</small></button></div>${rows}${open && names.length > 7 ? `<button type="button" class="props-more" data-pm="1">${this.more ? "Show fewer" : `${names.length - 6} more`}</button>` : ""}${open && !env.readonly ? `<button type="button" class="props-add" data-pa="1">+ Add a property</button>` : ""}`;
    if (host._sig !== html && !host.querySelector(".pv-edit")) { host._sig = html; host.innerHTML = html; }
  },
  edit(row) {
    const p = row.dataset.path, K = S.K, c = K.cells.get(p);
    if (!c || c.kind === "fn" || (c.kind === "lit" && typeof c.v === "string" && c.v.includes("\n")) || K.types.get(p)) return Src.cell(p);
    if (c.kind === "lit" && typeof c.v === "boolean") return writeText(`${p} = ${!c.v}`);
    const pv = row.querySelector(".pv"), cur = c.kind === "formula" ? "= " + c.src : c.kind === "hole" ? "?" + JSON.stringify(c.intent || "") : typeof c.v === "string" ? c.v : M.showLit(c.v);
    pv.innerHTML = `<input class="pv-edit" value="${esc(cur)}" spellcheck="false" aria-label="Value">`;
    const inp = pv.querySelector("input"); inp.focus(); inp.select();
    const done = ok => { if (!inp.isConnected) return; const v = inp.value; $("#props")._sig = null; if (ok) this.commit(p, v); schedule(); };
    inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") { e.preventDefault(); inp.remove(); done(false); } });
    inp.addEventListener("blur", () => done(true));
  },
  /* = starts a formula; numbers, true/false, lists and records stay what they are; anything else is text */
  commit(p, t) {
    const K = S.K, c = K.cells.get(p); t = String(t);
    let line;
    if (/^\s*=/.test(t)) line = `${p} = ${t.replace(/^\s*=\s*/, "")}`;
    else if (/^\s*\?"/.test(t)) line = `${p} = ${t.trim()}`;
    else if (c && c.kind === "lit" && typeof c.v === "string") line = `${p} = ${M.showLit(t)}`;
    else if (/^\s*(-?\d+(\.\d+)?%?|true|false|\[.*\]|\{.*\})\s*$/.test(t) && parses(`${p} = ${t.trim()}`).ok) line = `${p} = ${t.trim()}`;
    else line = `${p} = ${M.showLit(t)}`;
    const pr = parses(line); if (!pr.ok) { toast(`That does not read: ${pr.bad ? pr.bad.err : "?"}`); return; }
    if (c && K.toHyphaOne(p) === line) return;
    writeText(line); S.pulse = new Map([[p, performance.now()]]);
  },
  add() {
    const host = $("#props"), b = host.querySelector(".props-add"); if (!b) return;
    b.outerHTML = `<div class="prow add"><input class="pv-edit" placeholder="name = 42, or name = = a formula, or a word" spellcheck="false" aria-label="New property"></div>`;
    const inp = host.querySelector(".prow.add input"); inp.focus();
    const go = () => {
      const t = inp.value.trim(); host._sig = null; if (!t) return schedule();
      const m = /^([A-Za-z_][\w]*)\s*(?:=\s*([\s\S]*))?$/.exec(t.replace(/\s+(?=\w*\s*=)/, "_"));
      const name = m ? m[1].toLowerCase() : t.toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
      if (!/^[a-z_]\w*$/.test(name) || META.has(name)) { toast("A property's name is lowercase words joined by _, like nights or per_person."); return schedule(); }
      this.commit(S.page + "." + name, m && m[2] != null ? m[2] : "");
    };
    inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); go(); } if (e.key === "Escape") { host._sig = null; schedule(); } });
    inp.addEventListener("blur", go);
  },
};

/* ---------- navigation ---------- */
const Nav = {
  back: [], fwd: [],
  go(page, opts = {}) {
    if (page === S.page) return;
    if (S.page && !opts.hist) { this.back.push(S.page); if (this.back.length > 50) this.back.shift(); this.fwd = []; }
    Ed.blur(); Slash.close(); Menu.close(); Ed.closeAsk(); Ed.reset();
    S.page = page; store.set("page", page); Props.more = false;
    const b = $("#blocks"); b.textContent = ""; $("#props")._sig = null; $("#props").textContent = "";
    $("#scroller").scrollTop = 0;
    if (innerWidth <= 860) Side.toggle(false);
    if (page && Pages.exists(page)) { for (const a of Pages.chain(page).slice(0, -1)) S.open.add(a); store.set("open", [...S.open]); }
    Net.presence(); Net.changed(); schedule();
  },
  prev() { const p = this.back.pop(); if (p) { this.fwd.push(S.page); this.go(p, { hist: true }); } },
  next() { const p = this.fwd.pop(); if (p) { this.back.push(S.page); this.go(p, { hist: true }); } },
  restore() { const want = store.get("page"); if (want && (Pages.exists(want) || want[0] === "@")) this.go(want); else { const r = Pages.roots(); if (r.length) this.go(Pages.exists("welcome") ? "welcome" : r[0]); else schedule(); } },
};

/* ---------- the page view ---------- */
const View = {
  render() {
    const K = S.view, page = S.page, main = $("#page"), special = $("#special");
    document.body.classList.toggle("past", S.view !== S.K);
    if (page === "@lib" || page === "@jobs") {
      main.hidden = true; special.hidden = false; $("#cover").hidden = true;
      const env = envFor(page === "@lib" ? "lib" : "jobs");
      F.mount(special, h("div", { class: "special" }, h("div", { class: "sp-head" }, h("span", { class: "sp-i" }, page === "@lib" ? "◇" : "⏱"), h("h1", null, page === "@lib" ? "Library" : "Jobs")),
        h("p", { class: "sp-sub" }, page === "@lib" ? "Components, functions and tokens: the parts every page builds from. Claude reaches for these first, and leaves the library a little richer." : "Things that run on a schedule while a page of this workspace is open: a line of Hypha, or a request to Claude."),
        h("div", { class: "fruit" }, page === "@lib" ? (K.exists("lib.ui") ? F.node(K, "lib.ui", env) : F.R.library(K, "lib", env)) : F.R.jobs(K, "jobs", env))));
      return;
    }
    special.hidden = true;
    if (!page || !Pages.exists(page)) { main.hidden = true; $("#cover").hidden = true; this.empty(); return; }
    $("#empty").hidden = true; main.hidden = false;
    const full = !!K.valueAt(page + ".full"), serif = !!K.valueAt(page + ".serif"), small = !!K.valueAt(page + ".small");
    main.classList.toggle("full", full); main.classList.toggle("serif", serif); main.classList.toggle("small", small);
    // cover
    const cv = K.valueAt(page + ".cover"), cover = $("#cover");
    if (typeof cv === "string" && cv) { cover.hidden = false; const bg = COVERS[cv] || (/^https?:\/\//.test(cv) ? `center / cover no-repeat url("${cv.replace(/"/g, "")}")` : cv.startsWith("linear-gradient") || /^#[0-9a-f]{3,8}$/i.test(cv) ? cv : COVERS.clay); if (cover._bg !== bg) { cover.style.background = bg; cover._bg = bg; } }
    else cover.hidden = true;
    main.classList.toggle("has-cover", !cover.hidden);
    // icon, title
    const icon = Pages.icon(page, K), ib = $("#icon"); ib.hidden = !icon; if (ib.textContent !== icon) ib.textContent = icon;
    $("#add-icon").hidden = !!icon; $("#add-cover").hidden = !cover.hidden;
    $("#ph-actions").classList.toggle("ro", S.readOnly || S.view !== S.K);
    const t = $("#title"), tc = K.cells.get(page + ".title"), raw = tc && tc.kind === "lit" ? String(tc.v || "") : tc ? Pages.title(page, K) : "";
    if (document.activeElement !== t && t.textContent !== raw) t.textContent = raw;
    t.contentEditable = S.readOnly || S.view !== S.K || (tc && tc.kind !== "lit") ? "false" : (PLAIN ? "plaintext-only" : "true");
    document.title = (icon ? icon + " " : "") + Pages.title(page, K) + " · Claude Blocks";
    Props.render(page);
    this.backlinks(page);
    const n = Ed.render(page, $("#blocks"));
    const ro = S.readOnly || S.view !== S.K;
    $("#starter").hidden = n > 1 || ro || (n === 1 && !(() => { const q = kidsOf(K, page + ".ui")[0], c = K.cells.get(q + ".text"); return F.kindOf(K, q) === "p" && (!c || c.v === ""); })());
    $("#tail").hidden = ro;
    // a Claude writing on this page shows at the bottom, with a way to stop it
    const here = [...S.busy].filter(id => S.K.log.slice(-40).some(o => o.peer === id && o.path && pageOf(o.path) === page) || [...S.K.intents.entries()].some(([pid, it]) => pid === id && it.path && pageOf(it.path) === page));
    const pill = $("#busy"); pill.hidden = !here.length;
    if (here.length) pill.innerHTML = `<span class="spark">${ICON.spark}</span>${here.map(id => `<b style="color:${colorOf(id)}">${esc(nameOf(id))}</b>`).join(", ")} ${here.length > 1 ? "are" : "is"} writing on this page${Claude.ctl && here.includes(S.U + ":claude") ? `<button type="button" class="btn ghost" data-stop="1">Stop</button>` : ""}`;
  },
  backlinks(page) {
    const K = S.view, from = [];
    for (const p of Pages.list(K)) { if (p === page) continue; for (const l of K.leavesUnder(p + ".ui")) { const c = K.cells.get(l); if (c && c.kind === "lit" && typeof c.v === "string" && (c.v.includes("[[" + page + "]]") || (l.endsWith(".of") && c.v === page && (K.cells.get(M.parentOf(l) + ".k") || {}).v === "page"))) { from.push({ p, l: M.parentOf(l) }); break; } } }
    const host = $("#backlinks"), open = S.local.get("bl:" + page);
    const html = from.length ? `<button type="button" class="bl-t" data-bl="1">↖ ${from.length} backlink${from.length > 1 ? "s" : ""}</button>${open ? `<div class="bl-list">${from.map(x => `<a href="#${esc(x.p)}" data-go="${esc(x.p)}" data-flash="${esc(x.l)}"><span>${esc(Pages.icon(x.p, K) || "📄")}</span>${esc(Pages.title(x.p, K))}</a>`).join("")}</div>` : ""}` : "";
    if (host._sig !== html) { host._sig = html; host.innerHTML = html; }
  },
  empty() {
    const e = $("#empty"); e.hidden = false;
    const ready = S.loaded || S.mode === "memory";
    const sig = [ready, Pages.list(S.K).length, S.readOnly].join("|"); if (e._sig === sig) return; e._sig = sig;
    if (!ready) { e.innerHTML = `<div class="empty-card"><p class="muted">Opening the workspace…</p></div>`; return; }
    if (Pages.list(S.K).length) { e.innerHTML = `<div class="empty-card"><h1>Pick a page</h1><p>Choose one in the sidebar, or make a new one.</p><div class="row"><button class="btn primary" type="button" data-new="1">New page</button></div></div>`; return; }
    e.innerHTML = `<div class="empty-card"><div class="mark-big">${ICON.spark}</div><h1>Claude Blocks</h1><p>Pages and blocks, like Notion, where every block is also a live cell: sentences that compute, databases with many views, and Claude blocks that a Claude writes in place while you watch. Everything is one log that you and Claude write together.</p>${S.readOnly ? `<p class="muted">This workspace is empty, and you can read it but not change it.</p>` : `<div class="row"><button class="btn primary" type="button" data-seed="1">Open the example workspace</button><button class="btn" type="button" data-new="1">Start with a blank page</button></div>`}<p class="muted small">Built on <a href="https://moldandyeast.com" target="_blank" rel="noopener">Ramon Marc</a>'s CC5: Hypha, Fruit and Spore.</p></div>`;
  },
};

/* ---------- the sidebar: the page tree ---------- */
const Side = {
  toggle(on = !S.sideOpen) { S.sideOpen = on; document.body.classList.toggle("side-off", !on); store.set("side", on); },
  render() {
    const K = S.view, people = Presence.people();
    const item = (p, d) => {
      const kids = Pages.kids(p, K), open = S.open.has(p), here = people.filter(o => o.page === p), busy = [...S.busy].some(id => [...S.K.intents.entries()].some(([pid, it]) => pid === id && it.path && pageOf(it.path) === p));
      return `<div class="ti${p === S.page ? " on" : ""}" style="--d:${d}" data-go="${esc(p)}" role="treeitem" aria-expanded="${kids.length ? open : ""}" aria-selected="${p === S.page}"><button type="button" class="tw${kids.length ? "" : " leaf"}" data-tw="${esc(p)}" aria-label="${open ? "Collapse" : "Expand"}" tabindex="-1"></button><span class="i">${esc(Pages.icon(p, K) || "📄")}</span><span class="t">${esc(Pages.title(p, K))}</span>${busy ? `<span class="writing" title="Claude is writing here">${ICON.spark}</span>` : ""}${here.map(o => `<span class="dot" style="--c:${colorOf(o.id)}" title="${esc(nameOf(o.id))} is here"></span>`).join("")}<button type="button" class="ti-add" data-sub="${esc(p)}" title="Add a page inside" tabindex="-1">${ICON.plus}</button></div>` + (open ? kids.map(k => item(k, d + 1)).join("") : "");
    };
    const roots = Pages.roots(K), ro = S.readOnly || S.view !== S.K;
    const html = `<div class="tree" role="tree" aria-label="Pages">${roots.map(p => item(p, 0)).join("") || `<p class="tree-empty">No pages yet</p>`}</div>`;
    const t = $("#tree"); if (t._sig !== html) { t._sig = html; t.innerHTML = html; }
    $("#side-new").hidden = ro;
    for (const b of $$("#side [data-route]")) b.classList.toggle("on", S.page === b.dataset.route);
  },
};

/* ---------- the bar on top: where you are, who is here, and the panels ---------- */
const Top = {
  render() {
    const K = S.view, page = S.page, crumbs = $("#crumbs");
    let html = "";
    if (page === "@lib") html = `<span class="cr on">◇ Library</span>`;
    else if (page === "@jobs") html = `<span class="cr on">⏱ Jobs</span>`;
    else if (page && Pages.exists(page)) html = Pages.chain(page).map((p, i, a) => `${i ? `<span class="sl">/</span>` : ""}<a href="#${esc(p)}" class="cr${i === a.length - 1 ? " on" : ""}" data-go="${esc(p)}"><span>${esc(Pages.icon(p, K) || "📄")}</span>${esc(Pages.title(p, K))}</a>`).join("");
    if (crumbs._sig !== html) { crumbs._sig = html; crumbs.innerHTML = html; }
    const le = page && S.lastEdit.get(page), ed = $("#edited"), et = le ? `${isClaude(le.peer) ? "✳ " : ""}Edited by ${nameOf(le.peer)} · ${ago(le.at)}` : "";
    if (ed.textContent !== et) { ed.textContent = et; ed.style.color = le && isClaude(le.peer) ? "var(--accent)" : ""; }
    const f = Faces.html(), fe = $("#faces"); if (fe._sig !== f) { fe._sig = f; fe.innerHTML = f; }
    $("#claude-btn").setAttribute("aria-pressed", S.panel === "claude"); $("#hist-btn").setAttribute("aria-pressed", S.panel === "history");
    $("#more-btn").hidden = !Pages.exists(page);
  },
  more(at) {
    const K = S.K, page = S.page, m = $("#menu"); Menu.q = "@page";
    const full = !!K.valueAt(page + ".full"), serif = !!K.valueAt(page + ".serif"), small = !!K.valueAt(page + ".small"), ro = S.readOnly;
    m.innerHTML = `<div class="mg">Page</div>
      <button type="button" class="mi" data-pg="serif"${ro ? " disabled" : ""}><span class="ic">Ag</span><span class="tx"><b>Serif type</b></span><span class="sw${serif ? " on" : ""}"></span></button>
      <button type="button" class="mi" data-pg="small"${ro ? " disabled" : ""}><span class="ic">a</span><span class="tx"><b>Small text</b></span><span class="sw${small ? " on" : ""}"></span></button>
      <button type="button" class="mi" data-pg="full"${ro ? " disabled" : ""}><span class="ic">↔</span><span class="tx"><b>Full width</b></span><span class="sw${full ? " on" : ""}"></span></button>
      <div class="sep"></div>
      <button type="button" class="mi claude" data-pg="fill"${ro ? " disabled" : ""}><span class="ic">✳</span><span class="tx"><b>Write every Claude block</b><small>${K.holes().filter(x => pageOf(x.path) === page).length} on this page</small></span></button>
      <button type="button" class="mi" data-pg="src"><span class="ic">⌁</span><span class="tx"><b>Page as Hypha</b><small>edit the whole page in its language</small></span></button>
      <button type="button" class="mi" data-pg="export"><span class="ic">⇩</span><span class="tx"><b>Export</b><small>a .hypha file another workspace can install</small></span></button>
      <button type="button" class="mi" data-pg="md"><span class="ic">M↓</span><span class="tx"><b>Copy as Markdown</b></span></button>
      <button type="button" class="mi" data-pg="dup"${ro ? " disabled" : ""}><span class="ic">⧉</span><span class="tx"><b>Duplicate page</b></span></button>
      <button type="button" class="mi" data-pg="hist"><span class="ic">⟲</span><span class="tx"><b>History</b><small>every op, and time</small></span></button>
      <button type="button" class="mi danger" data-pg="del"${ro ? " disabled" : ""}><span class="ic">🗑</span><span class="tx"><b>Delete page</b></span></button>`;
    m.hidden = false; const r = at.getBoundingClientRect(); m.style.left = Math.max(8, r.right - 280) + "px"; m.style.top = r.bottom + 6 + "px";
  },
  act(t) {
    const K = S.K, page = S.page; Menu.q = null; $("#menu").hidden = true;
    switch (t.dataset.pg) {
      case "serif": case "small": case "full": writeText(`${page}.${t.dataset.pg} = ${!K.valueAt(page + "." + t.dataset.pg)}`); break;
      case "fill": fillHoles(K.holes().filter(x => pageOf(x.path) === page).map(x => x.path)); break;
      case "src": Src.page(page); break;
      case "export": Host.save(page + ".hypha", `" ${Pages.title(page, K)}: a page for Claude Blocks. Drop this file on a workspace to install it.\n` + K.toHypha({ root: page, values: false }) + "\n"); break;
      case "md": navigator.clipboard.writeText(Markdown.page(page)).then(() => toast("Copied the page as Markdown"), () => toast("Could not reach the clipboard")); break;
      case "dup": { const id = Pages.fresh(page + "_copy"); writeText(K.toHypha({ root: page, values: false }).replace(new RegExp("^" + page + ":"), id + ":") + `\n${id}.title = ${showLit(Pages.title(page, K) + " (copy)")}`); Nav.go(id); break; }
      case "hist": Panel.open("history"); break;
      case "del": Pages.remove(page); break;
    }
  },
};
/* the page as Markdown, values filled in (for pasting elsewhere) */
const Markdown = {
  page(page) {
    const K = S.K, env = envFor(page), out = [`# ${Pages.icon(page, K) ? Pages.icon(page, K) + " " : ""}${Pages.title(page, K)}`, ""];
    const text = q => { const kind = F.kindOf(K, q), v = F.prop(K, q, B.textProp(kind), env); const s = typeof v === "string" ? v : F.fmt(v); return s.replace(/\{([^{}\n]+)\}/g, (m, src) => F.fmt(B.valueOf(K, q, src, env))).replace(/\[\[([\w.]+)\]\]/g, (m, n) => Pages.exists(n, K) ? Pages.title(n, K) : n); };
    const walk = (c, ind) => {
      for (const q of kidsOf(K, c)) {
        const kind = F.kindOf(K, q), pad = "  ".repeat(ind);
        if (kind === "hole") out.push(pad + `> ✳ Claude block: ${(K.cells.get(q) || {}).intent || ""}`);
        else if (kind === "h1" || kind === "h2" || kind === "h3") out.push("", "#".repeat(+kind[1] + 1) + " " + text(q), "");
        else if (kind === "bullet") out.push(pad + "- " + text(q));
        else if (kind === "numbered") out.push(pad + B.numberLabel(K, q) + " " + text(q));
        else if (kind === "todo") out.push(pad + `- [${F.prop(K, q, "done", env) ? "x" : " "}] ` + text(q));
        else if (kind === "quote") out.push(pad + "> " + text(q));
        else if (kind === "callout") out.push(pad + `> ${F.prop(K, q, "icon", env) || "💡"} ` + text(q));
        else if (kind === "code") out.push("```", text(q), "```");
        else if (kind === "divider") out.push("---");
        else if (kind === "fold") out.push(pad + "- " + text(q));
        else if (kind === "p" || kind === "text") out.push(pad + text(q), "");
        else if (kind === "table") { const rows = [].concat(F.prop(K, q, "of", env) || []).filter(r => r && typeof r === "object"); const cols = [...new Set(rows.flatMap(Object.keys))]; if (cols.length) out.push("| " + cols.join(" | ") + " |", "|" + cols.map(() => " --- |").join(""), ...rows.map(r => "| " + cols.map(k => F.fmt(r[k])).join(" | ") + " |"), ""); }
        else if (kind === "stat" || kind === "progress") out.push(pad + `**${F.prop(K, q, "label", env) || ""}** ${F.fmt(F.prop(K, q, "of", env))}`);
        if (kidsOf(K, q).length && kind !== "columns") walk(q, kind === "col" || kind === "columns" ? ind : ind + 1);
        else if (kind === "columns") for (const c2 of kidsOf(K, q)) walk(c2, ind);
      }
    };
    walk(page + ".ui", 0); return out.join("\n").replace(/\n{3,}/g, "\n\n");
  },
};

/* ---------- the right panel: Claude, and History ---------- */
const Panel = {
  open(which) { S.panel = which; document.body.classList.toggle("panel-on", !!which); $("#panel").hidden = !which; for (const t of $$("#panel [data-tab]")) t.setAttribute("aria-selected", t.dataset.tab === which); $("#p-claude").hidden = which !== "claude"; $("#p-history").hidden = which !== "history"; if (which === "history") { History.rebuild(); Time.sync(); } if (which === "claude") setTimeout(() => $("#ag-in").focus(), 0); schedule(); },
  toggle(which) { this.open(S.panel === which ? null : which); },
};
const STARTERS = ["A page for planning my week", "Add a budget table to this page", "Summarize this page in a callout at the top", "Turn the to-dos into a board", "A reading list database with ratings"];
const Agent = {
  open(prefill) { Panel.open("claude"); if (prefill) this.prefill(prefill); },
  prefill(s) { const ta = $("#ag-in"); ta.value = s; ta.focus(); this.detect(); },
  note(request, kind) {
    const list = $("#ag-runs"), d = document.createElement("div"); d.className = "run " + kind;
    d.innerHTML = `<div class="run-h"><span class="spark">${ICON.spark}</span><b>${esc(kind === "fill" ? "Claude blocks" : kind === "chat" ? "Claude in chat" : "Claude")}</b><span class="run-t">${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><div class="run-q">${esc(request.slice(0, 220))}</div><div class="run-s">writing…</div>`;
    list.appendChild(d); while (list.children.length > 40) list.firstChild.remove(); list.scrollTop = list.scrollHeight;
    $("#ag-empty").hidden = true;
    return { done: (summary, errs) => { d.classList.add("done"); d.querySelector(".run-s").innerHTML = esc(summary) + (errs && errs.length ? `<details><summary>${errs.length} line${errs.length > 1 ? "s" : ""} did not apply</summary>${errs.map(e => `<code>${esc(e)}</code>`).join("")}</details>` : ""); } };
  },
  mode: "idle",
  detect() {
    const t = $("#ag-in").value;
    this.mode = !t.trim() ? "idle" : parses(t).ok && !/^[A-Z][a-z]+\s+[a-z]/.test(t.trim()) ? "lines" : "ask";
    const b = $("#ag-send"); b.textContent = this.mode === "lines" ? "Write" : "Ask"; b.disabled = this.mode === "idle";
    $("#ag-in").classList.toggle("lines", this.mode === "lines");
    this.hint();
  },
  hint() {
    const scope = S.scope, page = S.page && Pages.exists(S.page) ? S.page : null;
    $("#ag-hint").textContent = this.mode === "lines" ? `↵ writes these lines${scope === "page" && page ? " inside " + Pages.title(page) : ""}` : !S.sample ? (S.db ? "No Claude in this view: ask Claude in the chat" : "Claude answers inside Claude") : scope === "page" && page ? `↵ Claude works on ${Pages.title(page)}` : scope === "new" ? "↵ Claude makes a new page" : "↵ Claude works across the workspace";
    for (const b of $$("#ag-scope button")) b.setAttribute("aria-pressed", b.dataset.scope === scope);
  },
  render() {
    if (S.panel !== "claude") return;
    $("#ag-stop").hidden = !Claude.ctl;
    const live = [...S.K.intents.entries()].filter(([id, it]) => isClaude(id) && (it.text || it.path)).slice(0, 6);
    const html = live.map(([id, it]) => `<div class="lv" style="--c:${colorOf(id)}"><small>${esc(nameOf(id))}</small><code>${esc(it.op === "is" && it.view ? `${it.path} is ${it.text}` : it.op ? `${it.path} ${it.op} ${it.text}` : it.text || it.path)}</code></div>`).join("");
    const lv = $("#ag-live"); if (lv._sig !== html) { lv._sig = html; lv.innerHTML = html; }
    const st = $("#ag-starters"), sig = String(!!S.sample);
    if (st._sig !== sig) { st._sig = sig; st.innerHTML = STARTERS.map(s => `<button type="button">${esc(s)}</button>`).join(""); }
    this.hint();
  },
  async send() {
    const ta = $("#ag-in"), text = ta.value.trim(); if (!text) return;
    const page = S.page && Pages.exists(S.page) ? S.page : null;
    if (this.mode === "lines") {
      const ops = writeText(text, { base: S.scope === "page" && page ? page : "" }) || [];
      const bad = ops.filter(o => !o.ok); if (bad.length) toast(`${bad[0].text}: ${bad[0].err}`);
      ta.value = ""; this.detect(); return;
    }
    if (!S.sample) { toast(S.db ? "This view has no Claude of its own. Ask Claude in the chat: it writes into this workspace." : "Asking Claude works when this page is open inside Claude."); return; }
    ta.value = ""; this.detect();
    if (S.scope === "new") await Claude.ask("Make a new page: " + text, { newPages: true });
    else await Claude.ask(text, { app: S.scope === "page" ? page : null });
  },
};

/* ---------- ⌘K: find any page, block, cell or command ---------- */
const Launcher = {
  items: [], idx: 0,
  init() {
    const inp = $("#launch-in");
    inp.addEventListener("input", () => { this.idx = 0; this.render(); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.idx = Math.min(this.items.length - 1, this.idx + 1); this.render(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.idx = Math.max(0, this.idx - 1); this.render(true); }
      else if (e.key === "Enter") { e.preventDefault(); this.run(this.items[this.idx]); }
      else if (e.key === "Escape") { e.preventDefault(); this.toggle(false); }
    });
    $("#launcher").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) this.run(this.items[+b.dataset.i]); else if (e.target.id === "launcher") this.toggle(false); });
  },
  toggle(on = $("#launcher").hidden) { $("#launcher").hidden = !on; if (on) { Ed.blur(); $("#launch-in").value = ""; this.idx = 0; this.render(); $("#launch-in").focus(); } },
  score(q, s) { if (!q) return 1; s = String(s).toLowerCase(); const i = s.indexOf(q); if (i >= 0) return 100 - Math.min(i, 60); let j = 0; for (const ch of s) if (ch === q[j]) j++; return j === q.length ? 10 : 0; },
  gather(q) {
    const K = S.K, out = [], add = (kind, label, sub, go, sc, icon) => { if (sc > 0) out.push({ kind, label, sub, go, sc, icon }); };
    for (const p of Pages.list(K)) add("Page", Pages.title(p, K), Pages.chain(p).slice(0, -1).map(a => Pages.title(a, K)).join(" / "), () => Nav.go(p), this.score(q, Pages.title(p, K) + " " + p) + 8, Pages.icon(p, K) || "📄");
    const cmds = [
      ["New page", "", () => Pages.create({}), "+"], ["Ask Claude", "⌘J", () => Agent.open(q && !/^ask claude/i.test(q) ? q : ""), "✳"], ["History and time", "every op", () => Panel.open("history"), "⟲"],
      ["Undo my last change", "⌘Z", () => Undo.undo(), "↶"], ["Library", "components, functions, tokens", () => Nav.go("@lib"), "◇"], ["Jobs", "things that run on a schedule", () => Nav.go("@jobs"), "⏱"],
      ["Add files", "pictures, PDFs, tables, text", () => $("#attach-input").click(), "📎"],
    ];
    if (Pages.exists(S.page)) cmds.push(["Page as Hypha", Pages.title(S.page), () => Src.page(S.page), "⌁"], ["Write every Claude block on this page", "", () => fillHoles(K.holes().filter(x => pageOf(x.path) === S.page).map(x => x.path)), "✳"]);
    if (!Pages.list(K).length) cmds.push(["Open the example workspace", "", () => Seed.play(), "✳"]);
    for (const [l, s, f, i] of cmds) add("Command", l, s, f, this.score(q, l + " " + s), i);
    if (q.length > 1) {
      let n = 0;
      for (const c of K.cells.values()) {
        if (n >= 14 || c.local || RESERVED.has(pageOf(c.path))) continue;
        const v = c.kind === "lit" && typeof c.v === "string" ? c.v : "", inView = M.isViewPath(c.path);
        const hit = !inView && c.path.toLowerCase().includes(q) ? 30 : v.toLowerCase().includes(q) ? 20 : 0;
        if (!hit) continue; n++;
        const p = c.path, pg = pageOf(p);
        if (inView) { const blk = p.replace(/\.(text|title)$/, ""); add("Block", B.plain(v).slice(0, 80), Pages.exists(pg) ? Pages.title(pg, K) : pg, () => { Nav.go(pg); Ed.flash(blk); }, hit, "¶"); }
        else add("Property", p, v ? v.slice(0, 70) : c.kind === "formula" ? "= " + c.src : "", () => { if (Pages.exists(pg)) Nav.go(pg); }, hit, "#");
      }
    }
    out.sort((a, b) => b.sc - a.sc);
    if (q) { if (parses(q).ok && /[=:]|\bis\b/.test(q)) out.unshift({ kind: "Write", label: q, sub: "as a line", go: () => writeText(q), icon: "⌁" }); out.push({ kind: "Ask", label: `Ask Claude: ${q}`, go: () => Agent.open(q), icon: "✳" }); }
    return out.slice(0, 40);
  },
  render(keep) {
    const q = $("#launch-in").value.trim().toLowerCase(), list = $("#launch-list");
    if (!keep) this.items = this.gather(q);
    list.innerHTML = this.items.length ? this.items.map((it, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${i === this.idx}" class="li${i === this.idx ? " on" : ""}"><span class="ic">${esc(it.icon || "")}</span><span class="l">${esc(it.label)}</span><span class="s">${esc(it.sub || "")}</span><span class="k">${esc(it.kind)}</span></button>`).join("") : `<p class="none">Nothing matches.</p>`;
    const on = list.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
  },
  run(it) { if (!it) return; this.toggle(false); it.go(); },
};

/* ---------- files: dropped on a page they become blocks; tables and text become pages ---------- */
const MEDIA = /^(image|video|audio)\/|application\/pdf/;
const Drops = {
  async ingest(files, at) {
    if (!window.CC5Computer) return;
    if (S.readOnly) return toast("You can read this workspace but not change it.");
    files = [...files]; const page = S.page && Pages.exists(S.page) ? S.page : null;
    const media = page ? files.filter(f => MEDIA.test(f.type || "")) : [], rest = files.filter(f => !media.includes(f));
    if (media.length) {
      const name = S.K.exists(page + ".files") && !Array.isArray(S.K.valueAt(page + ".files")) ? Pages.cell(page, "files") : "files";
      const before = kidsOf(S.K, page + "." + name).length;
      await CC5Computer.Files.ingest(media, { into: page });
      const now = kidsOf(S.K, page + "." + name);
      let after = at || Ed.focus || Ops.last(page + ".ui");
      for (const p of now.slice(before)) after = Ops.insert(after ? M.parentOf(after) : page + ".ui", after, { head: `file ${name}.${M.segOf(p)}` });
    }
    if (rest.length) {
      const made = await CC5Computer.Files.ingest(rest, {}) || [];
      for (const p of made) if (Pages.exists(p, S.K)) { if (page) writeText(`${p}.parent = ${showLit(page)}`); writeText(`${p}.icon = "📎"`); }
      if (made.length) Nav.go(made[0]);
    }
  },
  init() {
    const d = $("#main"); let depth = 0;
    const has = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    d.addEventListener("dragenter", e => { if (!has(e)) return; depth++; document.body.classList.add("dropping"); });
    d.addEventListener("dragleave", e => { if (!has(e)) return; if (--depth <= 0) { depth = 0; document.body.classList.remove("dropping"); } });
    d.addEventListener("dragover", e => { if (has(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
    d.addEventListener("drop", e => {
      if (!has(e)) { if (e.target.closest && e.target.closest(".ed")) e.preventDefault(); return; }
      e.preventDefault(); depth = 0; document.body.classList.remove("dropping");
      const el = document.elementFromPoint(e.clientX, e.clientY), blk = el && el.closest("#blocks .blk[data-p]");
      this.ingest(e.dataTransfer.files, blk ? blk.dataset.p : null);
    });
    document.addEventListener("paste", e => {
      if (e.target.closest && e.target.closest("input, textarea, [contenteditable]")) return;
      const files = [...((e.clipboardData && e.clipboardData.files) || [])]; if (!files.length) return;
      e.preventDefault(); this.ingest(files);
    });
    const pick = $("#attach-input");
    pick.addEventListener("change", () => { if (pick.files.length) this.ingest(pick.files); pick.value = ""; });
  },
};

/* ---------- the example workspace: four pages that read each other ---------- */
const SEED = () => `" A workspace where every block is a live cell. Start on Welcome.
welcome:
  title = "Welcome to Claude Blocks"
  icon = "👋"
  cover = "clay"
  cups = 3
  price = 4.5
  bill = cups * price
  ui:
    p "This looks like Notion and edits like Notion: type anywhere, press **/** for blocks, drag a block by its **⋮⋮** handle, press **⌘K** to find anything. Underneath, every block is a **live cell** in one log that you and Claude write together."
    callout "Press **space** on an empty line and ask for anything. A Claude writes it right there, as blocks, while you watch.", icon: "💬", tone: "accent"
    h2 "Sentences that compute"
    p "Put a formula between braces and it stays true: {cups} coffees at €{price} come to **€{bill}**."
    slider cups, min: 1, max: 12, label: "Coffees"
    p "The slider writes **cups**, one of this page's properties (they sit under the title, like Notion's, but every one can be a formula). Click into the sentence above to see its formulas; start any line with **=** and the whole line becomes one."
    h2 "Blocks that Claude writes"
    p "A Claude block is a slot with an intent. Press **Write it**: a Claude fills it in place, as ordinary blocks you can edit."
    ?"three short tips for getting the most out of Claude Blocks: sentences with {formulas}, Claude blocks, and one list shown as a table, a board and a chart. As bullet blocks, one line each."
    h2 "Pages that read each other"
    p "[[lisbon]] keeps its costs in a database you can see as a table, a board or a chart. Its sub-page [[lisbon_prep]] counts its own ticked to-do blocks into a progress bar, and Lisbon reads that bar back."
    todo "Open the Lisbon page and drag the Days slider", done: false
    todo "Tick a packing item on Before we go, then look at Lisbon", done: false
    todo "Press ⌘J and ask Claude for a page of your own", done: false
    fold "What is underneath?"
      p "Each page is a scope in **Hypha**: one line, one op, one log. Blocks are the elements of the page's view; properties are its cells. ⋮⋮ → *Edit as Hypha* shows any block in its own language, and ••• → *Page as Hypha* shows the whole page."
      p "Open **History** (top right) and drag Time back: every page is the log folded up to that op. This is CC5's computer by Ramon Marc, held in Notion's shape."
      code "welcome.cups = 5\\nwelcome.bill = cups * price", lang: "hypha"
lisbon:
  title = "Lisbon in May"
  icon = "🇵🇹"
  cover = "ocean"
  days = 5
  people = 2
  nightly = 120
  budget = 2000
  costs:
    0 = {what: "Flights ZRH to LIS", cat: "travel", amount: 380}
    1 = {what: "Metro and tram passes", cat: "travel", amount: 48}
    2 = {what: "Pastéis de nata, daily", cat: "food", amount: 35}
    3 = {what: "Dinners out", cat: "food", amount: 260}
    4 = {what: "Gulbenkian Museum", cat: "culture", amount: 30}
    5 = {what: "Sintra day trip", cat: "culture", amount: 65}
  stay = nightly * (days - 1)
  total = sum(costs.*.amount) + stay
  per_person = round(total / people)
  per_day = round(total / people / days)
  ui:
    p "Five days in Alfama in May. The numbers here are live: drag a slider or edit a row, and every sentence that mentions them follows."
    columns
      col
        slider days, min: 2, max: 14, label: "Days"
      col
        choice people, options: "1|2|3|4", label: "Travellers"
    grid cols: 3
      stat total, label: "Trip", pre: "€"
      stat per_person, label: "Each", pre: "€"
      stat per_day, label: "Each, a day", pre: "€"
    p "{days} days for {people}: **€{total}** in all, €{per_person} each. The flat is €{nightly} a night, so {days - 1} nights come to €{stay}."
    when total > budget
      callout "Over the €{budget} budget by €{total - budget}. Trim a dinner, or a night.", icon: "⚠️", tone: "bad"
    h2 "Costs"
    table costs, cols: "what|cat|amount", total: true
    donut sumby(costs, "cat", "amount"), label: "spent", unit: "€"
    h2 "Getting ready"
    progress lisbon_prep.ready, label: "Ready to go"
    page "lisbon_prep"
    h2 "Where to eat"
    ?"three small tascas in Alfama worth a dinner, as bullet blocks: the name in bold, then what to order"
lisbon_prep:
  title = "Before we go"
  icon = "🧳"
  parent = "lisbon"
  tasks:
    0 = {name: "Book the flat", status: "done"}
    1 = {name: "Flights", status: "done"}
    2 = {name: "Train to Sintra", status: "booked"}
    3 = {name: "Table at a fado house", status: "todo"}
    4 = {name: "Travel insurance", status: "todo"}
  ticks = ui.*.done
  packed = count(match(ticks, "true"))
  ready = (count(where(tasks, "status", "done")) + packed) / (count(tasks) + count(ticks))
  ui:
    p "**{round(ready * 100)}% ready.** The bar counts the finished tasks *and* the ticked to-do blocks below: to-dos are cells too, so a formula can read them."
    progress ready, label: "Ready"
    board tasks, by: "status", cols: "todo|booked|done", title: "name"
    h2 "Packing"
    todo "Passports", done: true
    todo "Walking shoes", done: false
    todo "A light jacket for the evenings", done: false
    todo "Plug adapter, type F", done: true
    p "{packed} of {count(ticks)} packed."
reading:
  title = "Reading list"
  icon = "📚"
  cover = "sand"
  books:
    0 = {title: "The Mushroom at the End of the World", author: "Anna Tsing", status: "done", stars: 5, pages: 352}
    1 = {title: "Entangled Life", author: "Merlin Sheldrake", status: "done", stars: 4, pages: 368}
    2 = {title: "Tools for Conviviality", author: "Ivan Illich", status: "reading", stars: 4, pages: 110}
    3 = {title: "Mindstorms", author: "Seymour Papert", status: "want", stars: 0, pages: 252}
    4 = {title: "The Timeless Way of Building", author: "Christopher Alexander", status: "want", stars: 0, pages: 552}
  done_books = where(books, "status", "done")
  pages_read = sum(pluck(done_books, "pages"))
  ui:
    p "{count(done_books)} of {count(books)} finished, {pages_read} pages so far. One list, three ways to look at it: switch the view on the bar above each block."
    cards books, title: "title", body: "author", meta: "status"
    table books, cols: "title|author|status|stars"
    bars books, x: "title", y: "pages"
    ?"two more books that belong on this list, as bullet blocks with the title in bold and one line on why"
`;
const Seed = {
  async play(instant) {
    if (S.readOnly) return toast("You can read this workspace but not change it.");
    const id = S.U + ":ex"; ensurePeer(S.K, id); S.busy.add(id); schedule();
    const text = SEED(), st = new M.Stream(S.K, id);
    if (instant) st.feed(text);
    else for (let i = 0; i < text.length; i += 64) { st.feed(text.slice(i, i + 64)); if (i === 0) Nav.go("welcome"); await sleep(6); }
    st.end(); S.busy.delete(id);
    Nav.go("welcome"); schedule(); Net.changed();
  },
};

/* ---------- wiring: one listener per gesture, at the top ---------- */
function blockOf(t) { const b = t.closest && t.closest("#blocks .blk[data-p]"); return b ? b.dataset.p : null; }
function wire() {
  const blocks = $("#blocks");
  blocks.addEventListener("focusin", e => { if (e.target.classList.contains("ed")) Ed.onFocus(e.target); });
  blocks.addEventListener("focusout", e => { if (e.target.classList.contains("ed")) Ed.onBlur(e.target); });
  blocks.addEventListener("input", e => { if (e.target.classList.contains("ed")) Ed.onInput(e.target, e); });
  blocks.addEventListener("keydown", e => { if (e.target.classList.contains("ed")) Ed.onKey(e.target, e); });
  blocks.addEventListener("paste", e => { if (e.target.classList && e.target.closest(".ed")) Ed.onPaste(e.target.closest(".ed"), e); });
  blocks.addEventListener("drop", e => { if (e.target.closest && e.target.closest(".ed") && !(e.dataTransfer && [...e.dataTransfer.types].includes("Files"))) e.preventDefault(); });
  blocks.addEventListener("pointerdown", e => { const g = e.target.closest(".g-drag"); if (g) { const q = blockOf(g); if (q) Drag.down(e, q, g); } });
  document.addEventListener("pointermove", e => Drag.move(e));
  document.addEventListener("pointerup", e => Drag.up(e));
  document.addEventListener("pointercancel", () => { if (Drag.st) { Drag.st = null; $("#dropline").hidden = true; document.body.classList.remove("dragging"); } });

  document.addEventListener("mousedown", e => {
    const t = e.target;
    if (t.closest("#slash, #mention, #menu, #pick")) { if (!t.closest("input, textarea")) e.preventDefault(); return; }
    for (const id of ["#menu", "#pick"]) if (!$(id).hidden && !t.closest(".g-drag, #more-btn, #icon, #add-icon, #add-cover, .ico, #cover-btn")) { $(id).hidden = true; if (id === "#menu") Menu.q = null; }
    const ed = t.closest("#blocks .ed");
    if (ed && document.activeElement !== ed) {
      if (t.closest("a[data-go], a.b-a")) { e.preventDefault(); return; }
      Ed.clickAt = pointOffset(ed, e.clientX, e.clientY);
    }
    if (!t.closest("#blocks .blk, #menu") && Ed.sel.size) { Ed.sel.clear(); schedule(); }
    if (Ed.askEl && !t.closest(".askbar")) Ed.closeAsk();
  });

  document.addEventListener("click", e => {
    const t = e.target, K = S.K;
    let b;
    if ((b = t.closest("[data-tw]"))) { e.preventDefault(); e.stopPropagation(); const p = b.dataset.tw; if (S.open.has(p)) S.open.delete(p); else S.open.add(p); store.set("open", [...S.open]); schedule(); return; }
    if ((b = t.closest("[data-sub]"))) { e.preventDefault(); e.stopPropagation(); Pages.create({ parent: b.dataset.sub, link: true }); return; }
    if ((b = t.closest("[data-route]"))) { Nav.go(b.dataset.route); return; }
    if ((b = t.closest("a[data-go], [data-go].ti"))) {
      if (b.closest(".ed") && document.activeElement === b.closest(".ed")) return;
      e.preventDefault(); const n = b.dataset.go;
      if (Pages.exists(n)) { Nav.go(n); if (b.dataset.flash) Ed.flash(b.dataset.flash); }
      else if (/^[a-z_]\w*$/i.test(n) && !S.readOnly) { const id = Pages.create({ name: n, title: n.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), parent: S.page, go: true }); if (id !== n) toast(`Made the page ${id}`); }
      return;
    }
    if (t.closest("#blocks")) {
      const q = blockOf(t);
      if ((b = t.closest(".g-add"))) { const c = M.parentOf(q), sib = kidsOf(K, c), i = sib.indexOf(q); const T = Ops.insert(c, e.altKey ? (i > 0 ? sib[i - 1] : null) : q, { head: 'p ""' }); Ed.focusAt(T, 0); Ed.slashNext = true; return; }
      if ((b = t.closest(".chk")) && q) { writeText(`${q}.done = ${!F.prop(K, q, "done", { al: new Map() })}`); return; }
      if ((b = t.closest(".mkr.tri")) && q) { S.local.set(q + "#open", !Ed.isOpen(q)); schedule(); return; }
      if ((b = t.closest(".mkr.ico")) && q && !S.readOnly) { Pick.open(b, ic => writeText(ic ? `${q}.icon = ${showLit(ic)}` : `${q}.icon = "💡"`), { title: "Callout icon" }); return; }
      if ((b = t.closest(".code-h .copy")) && q) { navigator.clipboard.writeText(String(F.prop(K, q, "text", { al: new Map() }) || "")).then(() => toast("Copied")); return; }
      if ((b = t.closest(".fold-empty"))) { const T = Ops.insert(b.dataset.into, null, { head: 'p ""' }); Ed.focusAt(T, 0); return; }
      if ((b = t.closest("[data-jump]"))) { e.preventDefault(); Ed.flash(b.dataset.jump); return; }
      if ((b = t.closest("[data-view]")) && q) { Ed.setView(q, b.dataset.view); return; }
      if ((b = t.closest("[data-act]")) && q) {
        const a = b.dataset.act;
        if (a === "fill") fillHoles([q]);
        else if (a === "intent") { Ed.ask(q, "new"); const c = K.cells.get(q); setTimeout(() => { const i = Ed.askEl && Ed.askEl.querySelector("input[type=text]"); if (i && c) { i.value = c.intent || ""; i.select(); } if (c && (c.via || []).length && Ed.askEl) Ed.askEl.querySelector(".ask-web input").checked = true; }, 10); }
        else if (a === "unhole") { writeText(`${q} -\n${q} is p ""`); Ed.focusAt(q, 0); }
        else if (a === "row") Ed.addRow(q);
        else if (a === "rows") { const db = Ed.dbOf(K, q); Claude.ask(`Add five realistic, varied rows to the database ${db} on this page, with the same fields as the rows already there (write them with ${pageOf(q)}.${db} += {…} lines).`, { app: pageOf(q) }); }
        return;
      }
      return;
    }
    if ((b = t.closest("#tail"))) { const c = S.page + ".ui", last = Ops.last(c), lk = last && F.kindOf(K, last), lc = last && K.cells.get(last + ".text"); if (last && (lk === "p") && (!lc || lc.v === "")) Ed.focusAt(last, 0); else { const T = Ops.insert(c, last, { head: 'p ""' }); Ed.focusAt(T, 0); } return; }
    if ((b = t.closest("[data-st]"))) {
      const first = kidsOf(K, S.page + ".ui")[0] || Ops.insert(S.page + ".ui", null, { head: 'p ""' }), a = b.dataset.st;
      if (a === "claude") Ed.ask(first, "new");
      else if (a === "hypha") Src.page(S.page);
      else { const it = SLASH().find(x => !Array.isArray(x) && x.label === a); if (it) Ed.apply(first, "", it, null, 0); }
      return;
    }
    if (t.closest("[data-pt]")) { S.local.set("props:" + S.page, S.local.get("props:" + S.page) === false); $("#props")._sig = null; schedule(); return; }
    if (t.closest("[data-pm]")) { Props.more = !Props.more; $("#props")._sig = null; schedule(); return; }
    if (t.closest("[data-pa]")) { Props.add(); return; }
    if ((b = t.closest("[data-flip]"))) { if (!S.readOnly) writeText(`${b.dataset.flip} = ${!S.K.valueAt(b.dataset.flip)}`); return; }
    if ((b = t.closest("#props .pv")) && !S.readOnly && S.view === S.K && !t.closest(".pv-edit")) { Props.edit(b.closest(".prow")); return; }
    if (t.closest("[data-bl]")) { S.local.set("bl:" + S.page, !S.local.get("bl:" + S.page)); $("#backlinks")._sig = null; schedule(); return; }
    if (t.closest("[data-stop]") || t.closest("#ag-stop")) { Claude.stop(); return; }
    if (t.closest("[data-seed]")) { Seed.play(); return; }
    if (t.closest("[data-new]") || t.closest("#side-new")) { Pages.create({}); return; }
    if ((b = t.closest("#add-icon, #icon"))) { if (S.readOnly || S.view !== S.K) return; Pick.open(b, ic => writeText(ic ? `${S.page}.icon = ${showLit(ic)}` : `${S.page}.icon -`), { title: "Page icon", remove: !!Pages.icon(S.page) }); return; }
    if ((b = t.closest("#add-cover, #cover-btn"))) { if (S.readOnly || S.view !== S.K) return; const names = Object.keys(COVERS); Pick.open(b, c => writeText(c ? `${S.page}.cover = ${showLit(c)}` : `${S.page}.cover -`), { title: "Cover", items: names, css: n => COVERS[n], remove: !!S.K.valueAt(S.page + ".cover") }); return; }
    if (t.closest("#ph-ask")) { S.scope = "page"; Agent.open(); return; }
    if ((b = t.closest("#menu button"))) { if (Menu.q === "@page") Top.act(b); else Menu.act(e); return; }
    if ((b = t.closest("#slash [data-i]"))) { Slash.choose(Slash.shown[+b.dataset.i]); return; }
    if ((b = t.closest("#mention [data-i]"))) { Mention.choose(Mention.shown[+b.dataset.i]); return; }
    if (t.closest("#claude-btn") || t.closest("#side-claude")) { Panel.toggle("claude"); return; }
    if (t.closest("#hist-btn") || t.closest("#side-hist")) { Panel.toggle("history"); return; }
    if ((b = t.closest("#more-btn"))) { if (!$("#menu").hidden && Menu.q === "@page") { $("#menu").hidden = true; Menu.q = null; } else Top.more(b); return; }
    if (t.closest("#side-btn") || t.closest("#side-close") || t.closest("#scrim")) { Side.toggle(); return; }
    if (t.closest("#side-search")) { Launcher.toggle(true); return; }
    if ((b = t.closest("#panel [data-tab]"))) { Panel.open(b.dataset.tab); return; }
    if (t.closest("#p-close")) { Panel.open(null); return; }
    if ((b = t.closest("#ag-scope button"))) { S.scope = b.dataset.scope; Agent.hint(); $("#ag-in").focus(); return; }
    if ((b = t.closest("#ag-starters button"))) { Agent.prefill(b.textContent); return; }
    if (t.closest("#ag-send")) { Agent.send(); return; }
    if (t.closest("#history")) { Net.fullHistory(); return; }
    if (t.closest("#src-apply")) { Src.run(); return; }
    if (t.closest("#src-cancel") || (t.id === "src")) { Src.close(); return; }
  });

  // the title
  const title = $("#title"); let tT = 0;
  title.addEventListener("input", () => { if (title.textContent === "" && title.innerHTML !== "") title.innerHTML = ""; clearTimeout(tT); const page = S.page, v = title.textContent.replace(/\n/g, " "); tT = setTimeout(() => { if (Pages.exists(page, S.K)) writeText(`${page}.title = ${showLit(v)}`, { coalesce: true }); }, 200); });
  title.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(tT); writeText(`${S.page}.title = ${showLit(title.textContent)}`); const c = S.page + ".ui", first = kidsOf(S.K, c)[0]; if (first && Ed.editable(first) && !(S.K.cells.get(first + ".text") || {}).v) Ed.focusAt(first, 0); else { const T = Ops.insert(c, null, { head: 'p ""' }); Ed.focusAt(T, 0); } }
    if (e.key === "ArrowDown") { const first = Ed.order().find(q => Ed.editable(q)); if (first) { e.preventDefault(); Ed.focusAt(first, 0); } }
  });
  title.addEventListener("blur", () => { clearTimeout(tT); if (Pages.exists(S.page, S.K)) { const v = title.textContent.replace(/\n/g, " "), c = S.K.cells.get(S.page + ".title"); if (!c || c.v !== v) writeText(`${S.page}.title = ${showLit(v)}`); } });
  title.addEventListener("paste", e => { e.preventDefault(); insertText(((e.clipboardData && e.clipboardData.getData("text/plain")) || "").replace(/\n/g, " ")); });

  // the Claude panel
  const ta = $("#ag-in");
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(220, ta.scrollHeight) + "px"; Agent.detect(); });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); Agent.send(); } if (e.key === "Escape") ta.blur(); });
  $("#src-ta").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); Src.run(); } if (e.key === "Escape") Src.close(); if (e.key === "Tab") { e.preventDefault(); insertText("  "); } });
  $("#attach").addEventListener("click", () => $("#attach-input").click());
  addEventListener("resize", () => schedule());
}
/* the slash menu after "+": the new block opens with "/" typed */
const _after = Ed.afterRender.bind(Ed);
Ed.afterRender = function () { const want = this.slashNext && this.pending; _after(); if (want) { this.slashNext = false; const ed = this.edOf(this.focus); if (ed && document.activeElement === ed) insertText("/"); } };

function keys() {
  document.addEventListener("keydown", e => {
    const t = e.target, mod = e.metaKey || e.ctrlKey;
    const typing = t.closest && t.closest("input, textarea, select, [contenteditable=true], [contenteditable=plaintext-only], .f-browser-img");
    if (e.key === "Escape") { if (!$("#launcher").hidden) return; if (!$("#src").hidden) return Src.close(); if (!$("#menu").hidden || !$("#pick").hidden) { $("#menu").hidden = true; Menu.q = null; Pick.close(); return; } if (Ed.sel.size) { Ed.sel.clear(); schedule(); return; } if (S.panel && !typing) { Panel.open(null); return; } }
    if (mod && (e.key === "k" || e.key === "K") && !e.shiftKey) { e.preventDefault(); Launcher.toggle(); return; }
    if (mod && (e.key === "j" || e.key === "J")) { e.preventDefault(); if (Ed.focus && document.activeElement && document.activeElement.classList.contains("ed")) { const q = Ed.focus; Ed.blur(); Ed.ask(q, (S.K.cells.get(q + ".text") || {}).v ? "edit" : "new"); } else Panel.toggle("claude"); return; }
    if (mod && e.key === "\\") { e.preventDefault(); Side.toggle(); return; }
    if (mod && e.key === "[") { e.preventDefault(); Nav.prev(); return; }
    if (mod && e.key === "]") { e.preventDefault(); Nav.next(); return; }
    if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && (!typing || (t.closest && t.closest("#blocks .ed, #title")))) { e.preventDefault(); if (Ed.focus) { const ed = Ed.edOf(Ed.focus); if (ed) Ed.saveNow(Ed.focus, ed.textContent); } Ed.blur(); Undo.undo(); return; }
    if (typing) return;
    // block selection
    if (Ed.sel.size && S.view === S.K && !S.readOnly) {
      const list = [...Ed.sel], o = Ed.order(), first = list[0];
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); const i = o.indexOf(first); writeText(list.map(q => `${q} -`).join("\n")); Ed.sel.clear(); const prev = o.slice(0, i).reverse().find(q => !list.includes(q) && Ed.editable(q)); if (prev) Ed.focusAt(prev, Infinity); schedule(); return; }
      if (e.key === "Enter") { e.preventDefault(); if (Ed.editable(first)) { Ed.sel.clear(); Ed.focusAt(first, Infinity); } else { const T = Ops.insert(M.parentOf(first), first, { head: 'p ""' }); Ed.sel.clear(); Ed.focusAt(T, 0); } return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (mod && e.shiftKey) { const T = Ed.nudge(first, e.key === "ArrowUp" ? -1 : 1); if (T) Ed.select([T]); return; }
        const i = o.indexOf(e.key === "ArrowUp" ? first : list[list.length - 1]), j = Math.max(0, Math.min(o.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
        Ed.select(e.shiftKey ? [...new Set(list.concat([o[j]]))] : [o[j]]); const el = Ed.els.get(o[j]); if (el) el.scrollIntoView({ block: "nearest" }); return;
      }
      if (mod && (e.key === "d" || e.key === "D")) { e.preventDefault(); for (const q of list.slice().reverse()) Ops.dup(q); return; }
      if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyBlocks(list); return; }
      if (mod && (e.key === "x" || e.key === "X")) { e.preventDefault(); copyBlocks(list); writeText(list.map(q => `${q} -`).join("\n")); Ed.sel.clear(); return; }
      if (e.key === " " || e.key === "/") { e.preventDefault(); Menu.open(first, Ed.els.get(first).querySelector(".g-drag")); return; }
    }
  });
}
function boot() {
  const K = new M.Kernel(); setKernel(K);
  S.sideOpen = store.get("side") != null ? !!store.get("side") && innerWidth > 860 : innerWidth > 860; document.body.classList.toggle("side-off", !S.sideOpen);
  wire(); keys(); Time.init(); Launcher.init(); Drops.init();
  if (window.CC5Browser) window.CC5Browser.rerender = () => schedule();
  if (window.CC5Computer) CC5Computer.init(Host);
  if (window.CC5Lego) CC5Lego.init(Host);
  if (window.CC5Spore) CC5Spore.init(Host);
  Net.start();
  schedule();
  window.blocks = { S, write: writeText, tree: () => S.K.toHypha(), go: p => Nav.go(p), seed: () => Seed.play(), page: () => S.page, ops: Ops, ed: Ed, md: p => Markdown.page(p || S.page) };
  if (window.spore) window.blocks.spore = window.spore;
}
boot();
})();
