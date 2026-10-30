/* HYPHA · KERNEL (as grown for CC5)
   The substrate. One log of ops, written by peers (people and agents alike) in Hypha,
   folded into a tree of live cells. Interfaces are projections of the tree; none is privileged.

   - A line is an op. Ops apply the moment their line closes, so every prefix of a stream is a state.
   - A hole (?) is a value. Formulas evaluate around holes and leave a residual: an unfinished term.
   - A guess (≈) is a value that a slower, better peer can confirm (=). Guesses taint what reads them.
   - Every write carries a stamp [clock, peer]; the newest stamp wins per path (an LWW map),
     so any number of peers can stream into the same tree in any order.
   CC5 adds views (Fruit): a node op `path is kind args -> action` writes an element whose props are cells,
   names in a view resolve from its app's scope outward, and a `ui:` block in a stream writes a whole view.  */
(function (root) {
"use strict";

/* ---------- values ---------- */
class Res { constructor(ast) { this.ast = ast; } }      // a residual: an unfinished term
class Err { constructor(msg) { this.msg = msg; } }
const isRes = v => v instanceof Res, isErr = v => v instanceof Err;
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v) && !isRes(v) && !isErr(v);
function unfinished(v) {
  if (isRes(v)) return true;
  if (Array.isArray(v)) return v.some(unfinished);
  if (isObj(v)) return Object.values(v).some(unfinished);
  return false;
}
function firstErr(v) {
  if (isErr(v)) return v;
  if (Array.isArray(v)) { for (const x of v) { const e = firstErr(x); if (e) return e; } }
  else if (isObj(v)) { for (const x of Object.values(v)) { const e = firstErr(x); if (e) return e; } }
  return null;
}

/* ---------- paths ---------- */
const PATH = "(?:[A-Za-z_][A-Za-z0-9_]*|\\d+)(?:\\.(?:\\d+|[A-Za-z_][A-Za-z0-9_]*))*";
const parentOf = p => { const i = p.lastIndexOf("."); return i < 0 ? "" : p.slice(0, i); };
const segOf = p => { const i = p.lastIndexOf("."); return i < 0 ? p : p.slice(i + 1); };
const join = (a, b) => (a ? (b ? a + "." + b : a) : b);
const segSort = (a, b) => { const na = /^\d+$/.test(a), nb = /^\d+$/.test(b); if (na && nb) return a - b; if (na !== nb) return na ? 1 : -1; return 0; };
const cmpStamp = (a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
/* views: any path with a "ui" segment below the top is part of a view; its names resolve from the app */
const isViewPath = p => p.split(".").indexOf("ui") >= 1;
const viewBase = p => { const segs = p.split("."), i = segs.indexOf("ui"); return i >= 1 ? segs.slice(0, i).join(".") : parentOf(p); };
const isNum = s => /^\d+$/.test(s);
function globMatch(g, p) {
  if (g === "*") return true;
  if (g.endsWith(".*")) { const h = g.slice(0, -2); return p === h || p.startsWith(h + "."); }
  return p === g;
}

/* ---------- numbers and literals ---------- */
function fmtNum(v) {
  if (!isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v), d = a >= 100 ? 1 : a >= 1 ? 2 : 3;
  return String(Number(v.toFixed(d)));
}
function showLit(v) {
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "[" + v.map(showLit).join(", ") + "]";
  if (isRes(v)) return show(v.ast);
  if (isErr(v)) return "!" + v.msg;
  return "{" + Object.entries(v).map(([k, x]) => (/^[A-Za-z_]\w*$/.test(k) ? k : JSON.stringify(k)) + ": " + showLit(x)).join(", ") + "}";
}

/* ---------- lexer ---------- */
const OPS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "^", "<", ">", "!", "(", ")", "[", "]", "{", "}", ",", ":"];
function lex(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") break;
    if (c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== '"') { if (src[j] === "\\" && j + 1 < src.length) { const e = src[j + 1]; s += e === "n" ? "\n" : e === "t" ? "\t" : e; j += 2; } else s += src[j++]; }
      if (j >= src.length) throw new Error("a string is not closed");
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(?:\d[\d_]*(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(%?)/i.exec(src.slice(i));
      let v = parseFloat(m[0].replace(/[_%]/g, "")); if (m[1]) v /= 100;
      out.push({ t: "num", v }); i += m[0].length; continue;
    }
    if (c === "?") {
      i++; while (src[i] === " ") i++;
      let intent = "";
      if (src[i] === '"') {
        let j = i + 1, s = "";
        while (j < src.length && src[j] !== '"') { if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++]; }
        if (j >= src.length) throw new Error("a string is not closed");
        intent = s; i = j + 1;
      }
      const via = []; let m;
      while ((m = /^\s*@([A-Za-z_]\w*)/.exec(src.slice(i)))) { via.push(m[1]); i += m[0].length; }
      out.push({ t: "hole", v: intent, via }); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.(?:\*|\d+|[A-Za-z_][A-Za-z0-9_]*))*/.exec(src.slice(i));
      out.push({ t: "id", v: m[0] }); i += m[0].length; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Error(`I don't know "${c}" here`);
    out.push({ t: "op", v: op }); i += op.length;
  }
  return out;
}

/* ---------- expression parser (Pratt) ---------- */
const BIN = { "||": [1], "&&": [2], "==": [3], "!=": [3], "<": [4], ">": [4], "<=": [4], ">=": [4], "+": [5], "-": [5], "*": [6], "/": [6], "^": [7, "r"] };
function parseExpr(src) {
  const toks = lex(src); let p = 0;
  if (!toks.length) throw new Error("needs a value (or ? for a hole)");
  const peek = () => toks[p], next = () => toks[p++];
  const want = v => { const t = next(); if (!t || t.v !== v || t.t !== "op") throw new Error(`expected ${v}`); };
  function expr(minP) {
    let left = unary();
    for (;;) {
      const t = peek(); if (!t || t.t !== "op" || !BIN[t.v]) break;
      const [pr, as] = BIN[t.v]; if (pr < minP) break;
      next(); left = { k: "bin", op: t.v, a: left, b: expr(as === "r" ? pr : pr + 1) };
    }
    return left;
  }
  function unary() {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "!")) { next(); const a = expr(7); if (t.v === "-" && a.k === "lit" && typeof a.v === "number") return { k: "lit", v: -a.v }; return { k: "un", op: t.v, a }; }
    return primary();
  }
  function primary() {
    const t = next();
    if (!t) throw new Error("the expression stops early");
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "hole") return { k: "hole", intent: t.v, via: t.via || [] };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" };
      if (t.v === "null") return { k: "lit", v: null };
      const n = peek();
      if (n && n.t === "op" && n.v === "(") {
        next(); const args = [];
        if (!(peek() && peek().v === ")")) { do { args.push(expr(0)); } while (peek() && peek().v === "," && next()); }
        want(")"); return { k: "call", f: t.v, args };
      }
      return { k: "ref", p: t.v };
    }
    if (t.v === "(") { const e = expr(0); want(")"); return e; }
    if (t.v === "[") {
      const items = [];
      if (!(peek() && peek().v === "]")) { do { if (peek() && peek().v === "]") break; items.push(expr(0)); } while (peek() && peek().v === "," && next()); }
      want("]"); return { k: "list", items };
    }
    if (t.v === "{") {
      const entries = [];
      if (!(peek() && peek().v === "}")) {
        do {
          if (peek() && peek().v === "}") break;
          const kt = next(); if (!kt || (kt.t !== "id" && kt.t !== "str")) throw new Error("a record key is missing");
          want(":"); entries.push([kt.v, expr(0)]);
        } while (peek() && peek().v === "," && next());
      }
      want("}"); return { k: "obj", entries };
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  const e = expr(0);
  if (p < toks.length) throw new Error(`unexpected "${toks[p].v}"`);
  return e;
}
function isLiteral(n) {
  if (n.k === "lit") return true;
  if (n.k === "list") return n.items.every(isLiteral);
  if (n.k === "obj") return n.entries.every(([, v]) => isLiteral(v));
  return false;
}
function litValue(n) {
  if (n.k === "lit") return n.v;
  if (n.k === "list") return n.items.map(litValue);
  const o = {}; for (const [k, v] of n.entries) o[k] = litValue(v); return o;
}
function show(n, pp = 0) {
  switch (n.k) {
    case "lit": return showLit(n.v);
    case "ref": return (n.miss ? "?" : "") + n.p;
    case "hole": return (n.intent ? `?${JSON.stringify(n.intent)}` : "?") + (n.via || []).map(v => " @" + v).join("");
    case "bin": { const pr = BIN[n.op][0], s = show(n.a, pr) + " " + n.op + " " + show(n.b, pr + 1); return pr < pp ? "(" + s + ")" : s; }
    case "un": return n.op + show(n.a, 8);
    case "call": return n.f + "(" + n.args.map(a => show(a)).join(", ") + ")";
    case "list": return "[" + n.items.map(a => show(a)).join(", ") + "]";
    case "obj": return "{" + n.entries.map(([k, v]) => k + ": " + show(v)).join(", ") + "}";
  }
  return "?";
}
function toAst(v) {
  if (isRes(v)) return v.ast;
  if (Array.isArray(v)) return { k: "list", items: v.map(toAst) };
  if (isObj(v)) return { k: "obj", entries: Object.entries(v).map(([k, x]) => [k, toAst(x)]) };
  return { k: "lit", v };
}

/* ---------- functions (pure; the only verbs a formula has) ---------- */
const numbers = (xs, f) => { for (const x of xs) if (typeof x !== "number") throw new Error(`${f} wants numbers`); return xs; };
const FN = {
  sum: xs => numbers(xs, "sum").reduce((a, b) => a + b, 0),
  avg: xs => numbers(xs, "avg").reduce((a, b) => a + b, 0) / (xs.length || 1),
  min: xs => Math.min(...numbers(xs, "min")), max: xs => Math.max(...numbers(xs, "max")),
  count: xs => xs.length,
  round: (x, d = 0) => { const m = Math.pow(10, d); return Math.round(x * m) / m; },
  floor: x => Math.floor(x), ceil: x => Math.ceil(x), abs: x => Math.abs(x), sqrt: x => Math.sqrt(x),
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)), mod: (a, b) => ((a % b) + b) % b,
  len: x => (x == null ? 0 : x.length || Object.keys(x).length),
  join: (xs, sep = ", ") => (Array.isArray(xs) ? xs : [xs]).join(sep),
  upper: s => String(s).toUpperCase(), lower: s => String(s).toLowerCase(),
  pct: x => Math.round(x * 100) + "%",
  hm: m => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`,
  at: (clock, m) => { const [h, mi] = String(clock).split(":").map(Number); const t = (((h * 60 + (mi || 0) + m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`; },
  text: x => (typeof x === "number" ? fmtNum(x) : String(x)),
  /* lists of records: what views lean on */
  where: (xs, key, val) => arr(xs).filter(x => x != null && (val === undefined ? !!field(x, key) : same(field(x, key), val))),
  match: (xs, q) => { q = String(q == null ? "" : q).trim().toLowerCase(); return !q ? arr(xs) : arr(xs).filter(x => flat(x).toLowerCase().includes(q)); },
  sort: (xs, key, desc) => { const d = desc ? -1 : 1; return arr(xs).slice().sort((a, b) => cmp(key == null ? a : field(a, key), key == null ? b : field(b, key)) * d); },
  take: (xs, n) => arr(xs).slice(0, Math.max(0, n)), skip: (xs, n) => arr(xs).slice(Math.max(0, n)),
  rev: xs => arr(xs).slice().reverse(),
  pluck: (xs, key) => arr(xs).map(x => field(x, key)),
  uniq: xs => { const seen = new Set(), out = []; for (const x of arr(xs)) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; },
  tally: (xs, key) => { const m = new Map(); for (const x of arr(xs)) { const k = key == null ? x : field(x, key); const n = String(k == null ? "—" : k); m.set(n, (m.get(n) || 0) + 1); } return [...m].map(([name, n]) => ({ name, n })); },
  sumby: (xs, key, val) => { const m = new Map(); for (const x of arr(xs)) { const n = String(field(x, key) == null ? "—" : field(x, key)), v = Number(field(x, val)) || 0; m.set(n, (m.get(n) || 0) + v); } return [...m].map(([name, value]) => ({ name, value })); },
  range: (a, b, step = 1) => { const out = []; if (b === undefined) { b = a; a = 0; } if (!step) return out; for (let x = a; step > 0 ? x < b : x > b; x += step) { out.push(x); if (out.length >= 1000) break; } return out; },
  first: xs => arr(xs)[0], last: xs => { const a = arr(xs); return a[a.length - 1]; }, nth: (xs, i) => arr(xs)[i],
  keys: o => Object.keys(o || {}), vals: o => Object.values(o || {}), get: (o, k) => field(o, k), has: (o, k) => field(o, k) != null,
  contains: (s, sub) => (Array.isArray(s) ? s.some(x => same(x, sub)) : String(s).toLowerCase().includes(String(sub).toLowerCase())),
  split: (s, sep = ",") => String(s).split(sep).map(x => x.trim()).filter(x => x !== ""),
  trim: s => String(s).trim(), replace: (s, a, b) => String(s).split(String(a)).join(String(b)),
  slice: (x, a, b) => (Array.isArray(x) ? x.slice(a, b) : String(x).slice(a, b)),
  fixed: (x, d = 2) => Number(x).toFixed(d),
  money: (x, cur = "") => (x < 0 ? "-" : "") + cur + Math.round(Math.abs(x)).toLocaleString("en-US"),
  num: x => { const n = Number(x); return isFinite(n) ? n : 0; },
  not: x => !x,
  today: () => ymd(new Date()),
  days: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5),
  adddays: (d, n) => { const t = new Date(String(d) + "T12:00:00"); t.setDate(t.getDate() + n); return ymd(t); },
  weekday: d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(String(d) + "T12:00:00").getDay()],
  pi: () => Math.PI, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, pow: Math.pow, exp: Math.exp, log: Math.log,
  lerp: (a, b, t) => a + (b - a) * t,
  dur: ms => { const t = Math.max(0, Math.round(Number(ms) / 1000)), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60; return (hh ? hh + ":" + String(mm).padStart(2, "0") : String(mm)) + ":" + String(ss).padStart(2, "0"); },
  timeof: ms => { const d = new Date(Number(ms)); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; },
  dateof: ms => ymd(new Date(Number(ms))),
  ago: (then, now) => { const a = Math.abs(now - then), s = a < 60000 ? Math.round(a / 1000) + " s" : a < 3600000 ? Math.round(a / 60000) + " min" : a < 86400000 ? Math.round(a / 3600000) + " h" : Math.round(a / 86400000) + " d"; return now >= then ? s + " ago" : "in " + s; },
  hsl: (h, s = 0.6, l = 0.5) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`,
};
function arr(x) { return Array.isArray(x) ? x : x == null ? [] : typeof x === "object" ? Object.values(x) : [x]; }
function field(x, key) { if (x == null || key == null) return x; if (typeof x !== "object") return undefined; let v = x; for (const k of String(key).split(".")) { if (v == null || typeof v !== "object") return undefined; v = v[k]; } return v; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function cmp(a, b) { if (a == null) return b == null ? 0 : 1; if (b == null) return -1; if (typeof a === "number" && typeof b === "number") return a - b; return String(a).localeCompare(String(b)); }
function flat(x) { return x == null ? "" : typeof x === "object" ? Object.values(x).map(flat).join(" ") : String(x); }
function ymd(t) { return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }
const AGG = new Set(["sum", "avg", "min", "max", "count", "join"]);

/* ---------- statements: one line, one op ---------- */
const RE_SET = new RegExp(`^(${PATH})\\s*(::|\\+=|&=|~=|≈|=)\\s*(.*)$`);
const RE_SCOPE = new RegExp(`^(${PATH})\\s*:$`);
const RE_DEL = new RegExp(`^(?:(${PATH})\\s+-|-\\s*(${PATH}))$`);
const RE_AT = new RegExp(`^@\\s*(${PATH})?$`);
const RE_SOURCE = new RegExp(`^(${PATH})\\s*<-\\s*([A-Za-z_]\\w*)\\.([A-Za-z_]\\w*)\\s*(.*)$`);
const RE_NODE = new RegExp(`^(${PATH})\\s+is\\s+(.+)$`);
const RE_FN = new RegExp(`^(${PATH})\\(\\s*([A-Za-z_]\\w*(?:\\s*,\\s*[A-Za-z_]\\w*)*)?\\s*\\)\\s*=\\s*(.+)$`);

/* ---------- views (Fruit): one element per line ----------
   kind args -> action      args are positional (named by the kind) or key: expr; the action is Hypha
   lines (; between them) that run when the element is used, with values taken at that moment.          */
const POS = {
  h1: ["text"], h2: ["text"], h3: ["text"], text: ["text"], md: ["text"], code: ["text"], quote: ["text"], badge: ["text"], note: ["text"], kbd: ["text"],
  stat: ["of"], progress: ["of"], gauge: ["of"],
  slider: ["of"], num: ["of"], field: ["of"], area: ["of"], toggle: ["of"], check: ["of"], choice: ["of"], select: ["of"], date: ["of"], stars: ["of"], color: ["of"],
  button: ["label"], ask: ["label"],
  table: ["of"], list: ["of"], checklist: ["of"], board: ["of"], cards: ["of"], bars: ["of"], trend: ["of"], pie: ["of"], donut: ["of"], spark: ["of"], timeline: ["of"], cells: ["of"], json: ["of"], calendar: ["of"],
  each: ["of"], when: ["if"], embed: ["of"], browser: ["of"], file: ["of"], image: ["src"], program: ["of"], jobs: [], library: [], video: ["src"], audio: ["src"], upload: ["of"], camera: ["of"],
  card: ["title"], section: ["title"], tab: ["title"], grid: ["cols"], split: ["ratio"], scroll: ["h"], tabs: [], box: [],
  draw: ["w", "h"], rect: ["x", "y", "w", "h"], circle: ["x", "y", "r"], ellipse: ["x", "y", "rx", "ry"], line: ["x1", "y1", "x2", "y2"], arrow: ["x1", "y1", "x2", "y2"], path: ["d"], poly: ["points"], group: ["x", "y"],
  row: [], col: [], stack: [], spacer: [], divider: [],
};
Object.assign(POS, { disclosure: ["title"], accordion: [], dialog: ["label"], sheet: ["label"], popover: ["label"], menu: ["label"], item: ["label"], avatar: ["of"], breadcrumb: ["of"], skeleton: ["lines"], radio: ["of"], combobox: ["of"], carousel: [] });
/* the names other kits use, so either works: shadcn's switch is Fruit's toggle */
const ALIAS = { switch: "toggle", checkbox: "check", input: "field", textarea: "area", separator: "divider", alert: "note", meter: "progress", heading: "h2", paragraph: "text",
  collapsible: "disclosure", modal: "dialog", drawer: "sheet", dropdown: "menu", segmented: "choice", toggle_group: "choice", number: "num", hr: "divider" };
for (const [a, b] of Object.entries(ALIAS)) if (!POS[a]) POS[a] = POS[b];
/* kinds that hold child elements; any other known kind is a leaf, and becoming one drops its children */
const CONTAINERS = new Set(["col", "row", "grid", "stack", "box", "card", "section", "tabs", "tab", "split", "scroll", "each", "when", "draw", "group", "disclosure", "accordion", "dialog", "sheet", "popover", "menu", "carousel", "collapsible", "modal", "drawer", "dropdown"]);
/* split at a separator outside strings and brackets */
function splitTop(src, sep) {
  const out = []; let depth = 0, q = false, last = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === "\\") i++; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && src.startsWith(sep, i)) { out.push(src.slice(last, i)); last = i + sep.length; i += sep.length - 1; }
  }
  out.push(src.slice(last));
  return out;
}
function parseNode(rest) {
  rest = stripComment(rest).trim();
  const parts = splitTop(rest, " -> "), head = parts[0].trim(), act = parts.length > 1 ? parts.slice(1).join(" -> ").trim() : null;
  const m = /^([a-z][a-z0-9_]*):?(?:\s+([\s\S]*))?$/.exec(head);
  if (!m) throw new Error("an element starts with its kind, like text, row or slider");
  const kind = m[1], args = (m[2] || "").trim(), props = {}, pos = POS[kind] || [];
  let items = args ? splitTop(args, ",").map(x => x.trim()) : [];
  if (items.some(x => !x)) throw new Error("an empty argument (two commas in a row?)");
  if (kind === "each" && items.length) {
    const e = /^([A-Za-z_]\w*)\s+in\s+([\s\S]+)$/.exec(items[0]);
    if (e) { props.as = { src: JSON.stringify(e[1]), ast: { k: "lit", v: e[1] } }; items[0] = e[2]; }
  }
  let i = 0;
  for (const it of items) {
    const nm = /^([A-Za-z_]\w*)\s*:(?!:)\s*([\s\S]*)$/.exec(it);
    let name, src;
    if (nm) { name = nm[1]; src = nm[2].trim(); }
    else { name = pos[i] || "_" + i; i++; src = it; }
    if (!src) throw new Error(`${name} needs a value`);
    if (name === "k" || name === "do" || isNum(name)) throw new Error(`"${name}" is not a prop name`);
    props[name] = { src, ast: parseExpr(src) };
  }
  if (act !== null && !act) throw new Error("-> needs an action after it");
  return { kind, props, act, src: head + (act ? " -> " + act : "") };
}
function stripComment(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "\\" && q) { i++; continue; } if (c === '"') q = !q; else if (c === "#" && !q) return s.slice(0, i).trimEnd(); }
  return s.trim();
}
function parseType(src) {
  const parts = src.trim().split(/\s+/), name = parts[0];
  if (!["num", "text", "long", "bool", "range", "choice", "time", "program"].includes(name)) throw new Error(`no type "${name}" (num text long bool range choice time program)`);
  if (name === "program") return { name, args: parts.slice(1), src: src.trim() };
  if (name === "range") return { name, args: parts.slice(1).map(Number), src: src.trim() };
  if (name === "choice") return { name, args: parts.slice(1).join(" ").split("|").map(s => s.trim()).filter(Boolean), src: src.trim() };
  return { name, args: [], src: src.trim() };
}
function parseStmt(text) {
  text = text.trim();
  if (!text || text.startsWith("#")) return null;
  if (text.startsWith('"')) return { k: "say", text: text.slice(1).trim().replace(/"$/, "") };
  let m;
  if ((m = RE_AT.exec(text))) return { k: "at", path: m[1] || "" };
  if ((m = RE_SOURCE.exec(text))) {
    const rhs = stripComment(m[4]);
    try { return { k: "source", path: m[1], conn: m[2], tool: m[3], src: rhs, ast: rhs ? parseExpr(rhs) : { k: "obj", entries: [] } }; }
    catch (e) { return { k: "err", msg: e.message, text }; }
  }
  if ((m = RE_FN.exec(text))) {
    const rhs = stripComment(m[3]);
    try { return { k: "fn", path: m[1], params: m[2] ? m[2].split(",").map(x => x.trim()) : [], src: rhs, ast: parseExpr(rhs) }; }
    catch (e) { return { k: "err", msg: e.message, text }; }
  }
  if ((m = RE_NODE.exec(text))) {
    try { const n = parseNode(m[2]); return Object.assign({ k: "node", path: m[1] }, n); }
    catch (e) { return { k: "err", msg: e.message, text }; }
  }
  if ((m = RE_SCOPE.exec(text))) return { k: "scope", path: m[1] };
  if ((m = RE_DEL.exec(text))) return { k: "del", path: m[1] || m[2] };
  if ((m = RE_SET.exec(text))) {
    const path = m[1], op = m[2], rhs = stripComment(m[3]);
    try {
      if (op === "::") return { k: "type", path, type: parseType(rhs) };
      if (op === "=" && rhs === "|") return { k: "block", path };
      const ast = parseExpr(rhs);
      if (op === "+=") return { k: "append", path, src: rhs, ast };
      if (op === "&=") { if (!isLiteral(ast)) throw new Error("&= appends text, not a formula"); return { k: "text", path, src: rhs, ast }; }
      return { k: "set", path, src: rhs, ast, prov: op !== "=" };
    } catch (e) { return { k: "err", msg: e.message, text }; }
  }
  return { k: "err", msg: "a line is: path = value, path:, path -, path is element, \" words, or @ path", text };
}
function canon(s) {
  switch (s.k) {
    case "say": return `" ${s.text}`;
    case "set": return `${s.path} ${s.prov ? "≈" : "="} ${s.src}`;
    case "append": return `${s.path} += ${s.src}`;
    case "text": return `${s.path} &= ${s.src}`;
    case "del": return `${s.path} -`;
    case "type": return `${s.path} :: ${s.type.src}`;
    case "at": return `@ ${s.path}`;
    case "source": return `${s.path} <- ${s.conn}.${s.tool}${s.src ? " " + s.src : ""}`;
    case "node": return `${s.path} is ${s.src}`;
    case "fn": return `${s.path}(${s.params.join(", ")}) = ${s.src}`;
  }
  return s.text || "";
}
/* what a half-written line already says: the intent shown while a peer is still typing it */
function intentOf(line, base) {
  const t = line.trim(); if (!t) return null;
  const m = new RegExp(`^(${PATH})\\s*(::|\\+=|&=|~=|≈|=)\\s*(.*)$`).exec(t);
  if (m) return { path: join(base || "", m[1]), op: m[2], text: m[3] };
  const p = new RegExp(`^(${PATH})`).exec(t);
  if (t.startsWith('"')) return { say: true, text: t.slice(1).trim() };
  const nm = new RegExp(`^(${PATH})\\s+is\\s+(.*)$`).exec(t);
  if (nm) return { path: join(base || "", nm[1]), op: "is", text: nm[2] };
  const sm = new RegExp(`^(${PATH})\\s*<-\\s*(.*)$`).exec(t);
  if (sm) return { path: join(base || "", sm[1]), op: "<-", text: sm[2] };
  return { path: p ? join(base || "", p[1]) : null, text: t, partial: true };
}

/* ---------- the kernel ---------- */
let seq = 0;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const uid = p => (p || "o") + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

class Kernel {
  constructor() {
    this.cells = new Map();                  // leaf path -> cell
    this.kids = new Map([["", new Set()]]);  // branch path -> child segments
    this.types = new Map();                  // path -> { name, args, src }
    this.sources = new Map();                // path -> { conn, tool, src, ast }: a connector fills this path
    this.stamps = new Map();                 // path -> [clock, peer] of the write that replaced it
    this.watch = new Map();                  // path -> Set(formula paths reading it or below it)
    this.log = []; this.clock = 0; this.seen = new Set();
    this.peers = new Map(); this.intents = new Map(); this.attention = new Map();
    this.said = [];
    this.stats = { ops: 0, us: 0, recomputed: 0, totalUs: 0 };
    this.fns = new Set(); this.computing = new Set(); this.recomputed = [];
    this.shape = 0;                          // bumps when cells appear, vanish or change kind: views rebuild only then
    this.sorted = new Map();                 // branch path -> sorted child segments (cache)
    this.batching = 0; this.batchChanged = [];
  }
  on(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(ev) { for (const f of this.fns) { try { f(ev); } catch (e) { console.error(e); } } }

  /* peers: people and agents are the same kind of thing */
  peer(p) {
    const cur = this.peers.get(p.id) || { can: ["*"] };
    const n = Object.assign(cur, p); if (!n.can) n.can = ["*"];
    this.peers.set(p.id, n); this.emit({ type: "peers" }); return n;
  }
  /* can: globs a peer may write ("*", "news", "news.*"); a glob starting with "!" forbids, and forbidding wins */
  allowed(peerId, path) {
    const p = this.peers.get(peerId); if (!p) return true;
    if (p.can.some(g => g[0] === "!" && globMatch(g.slice(1), path))) return false;
    const yes = p.can.filter(g => g[0] !== "!");
    return !yes.length || yes.some(g => globMatch(g, path));
  }
  setIntent(peerId, intent) {
    const had = this.intents.get(peerId);
    if (!intent) { if (had) { this.intents.delete(peerId); this.emit({ type: "intent", peer: peerId }); } return; }
    if (had && had.path === intent.path && had.text === intent.text) return;
    this.intents.set(peerId, Object.assign({ at: Date.now() }, intent)); this.emit({ type: "intent", peer: peerId });
  }
  attend(peerId, path) { if (path) this.attention.set(peerId, path); else this.attention.delete(peerId); this.emit({ type: "attention", peer: peerId }); }

  /* tree */
  exists(p) { return p === "" || this.cells.has(p) || (this.kids.has(p) && this.kids.get(p).size > 0); }
  isBranch(p) { return !this.cells.has(p) && this.kids.has(p) && this.kids.get(p).size > 0; }
  children(p) {
    let c = this.sorted.get(p); if (c) return c;
    const k = this.kids.get(p); c = k ? [...k].sort(segSort) : [];
    this.sorted.set(p, c); return c;
  }
  link(p) {
    let c = p;
    while (c) {
      const par = parentOf(c); let set = this.kids.get(par); if (!set) { set = new Set(); this.kids.set(par, set); }
      const seg = segOf(c); if (set.has(seg)) break;
      set.add(seg); this.sorted.delete(par); this.shape++; c = par;
    }
  }
  prune(p) {
    while (p) {
      if (this.cells.has(p) || (this.kids.has(p) && this.kids.get(p).size)) return;
      this.kids.delete(p); this.sorted.delete(p); const par = parentOf(p); if (this.kids.has(par)) { this.kids.get(par).delete(segOf(p)); this.sorted.delete(par); } this.shape++; p = par;
    }
  }
  leavesUnder(p, out = []) { if (this.cells.has(p)) out.push(p); for (const s of this.children(p)) this.leavesUnder(join(p, s), out); return out; }
  dropLeaf(p, changed) { const c = this.cells.get(p); if (!c) return; this.unwatch(c); this.cells.delete(p); changed.push(p); this.shape++; }
  removeSubtree(p, changed) {
    for (const l of this.leavesUnder(p)) this.dropLeaf(l, changed);
    const clear = q => { for (const s of this.children(q)) clear(join(q, s)); if (q) { this.kids.delete(q); this.sorted.delete(q); } };
    clear(p); if (p) { const par = parentOf(p); if (this.kids.has(par)) { this.kids.get(par).delete(segOf(p)); this.sorted.delete(par); } this.prune(par); }
    this.shape++;
    for (const t of [...this.types.keys()]) if (t === p || t.startsWith(p + ".")) { if (t !== p) this.types.delete(t); }
    for (const t of [...this.sources.keys()]) if (t.startsWith(p + ".")) this.sources.delete(t);
  }
  putLeaf(p, cell, changed) {
    let a = parentOf(p); while (a) { if (this.cells.has(a)) this.dropLeaf(a, changed); a = parentOf(a); }
    if (this.isBranch(p)) this.removeSubtree(p, changed);
    const old = this.cells.get(p); if (old) this.unwatch(old);
    if (!old || old.kind !== cell.kind || old.prov !== cell.prov || typeof old.v !== typeof cell.v) this.shape++;
    cell.path = p; this.cells.set(p, cell); this.link(p); changed.push(p);
  }
  writeValue(p, v, meta, changed) {
    if ((Array.isArray(v) && v.length) || (isObj(v) && Object.keys(v).length)) {
      if (this.cells.has(p) || this.isBranch(p)) this.removeSubtree(p, changed);
      let a = parentOf(p); while (a) { if (this.cells.has(a)) this.dropLeaf(a, changed); a = parentOf(a); }
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
      for (const [k, x] of entries) this.writeValue(join(p, k), x, meta, changed);
      return;
    }
    this.putLeaf(p, Object.assign({ kind: "lit", v }, meta), changed);
  }

  /* reading values, computing what is stale on the way */
  valueAt(p, ctx) {
    const c = this.cells.get(p);
    if (c) {
      if (c.kind === "formula" && c.dirty) this.compute(c);
      if (ctx && (c.prov || c.dprov)) ctx.prov = true;
      if (c.kind === "hole") return new Res({ k: "ref", p, miss: true, hole: true });
      if (c.kind === "formula" && isRes(c.v)) return new Res({ k: "ref", p, miss: true });
      return c.v;
    }
    const segs = this.children(p); if (!segs.length) return undefined;
    if (segs.every(s => /^\d+$/.test(s))) return segs.map(s => this.valueAt(join(p, s), ctx));
    const o = {}; for (const s of segs) o[s] = this.valueAt(join(p, s), ctx); return o;
  }
  resolve(ref, base, self) {
    const star = ref.indexOf("*");
    const head = star < 0 ? ref : ref.slice(0, star).replace(/\.$/, "");
    const cands = []; let b = base;
    for (;;) { const c = join(b, head); if (c !== self && !self.startsWith(c + ".")) cands.push(c); if (!b) break; b = parentOf(b); }
    return { found: cands.find(c => this.exists(c)), cands, tail: star < 0 ? null : ref.slice(star) };
  }
  glob(H, tail, ctx) {
    const rest = tail.slice(1).replace(/^\./, ""), out = [];
    for (const s of this.children(H)) {
      const p = join(H, s);
      if (!rest) { out.push(this.valueAt(p, ctx)); continue; }
      const st = rest.indexOf("*");
      if (st < 0) { const q = join(p, rest); if (this.exists(q)) out.push(this.valueAt(q, ctx)); }
      else out.push(...this.glob(join(p, rest.slice(0, st).replace(/\.$/, "")), rest.slice(st), ctx));
    }
    return out;
  }
  ev(n, ctx) {
    switch (n.k) {
      case "lit": return n.v;
      case "hole": return new Res(n);
      case "ref": {
        const r = this.resolve(n.p, ctx.base, ctx.self);
        for (const c of r.cands) ctx.deps.add(c);
        if (!r.found) return new Res({ k: "ref", p: n.p, miss: true });
        ctx.reads.add(r.found);
        let v = r.tail ? this.glob(r.found, r.tail, ctx) : this.valueAt(r.found, ctx);
        if (r.tail && ctx.base) { const pre = ctx.base + "."; v = v.map(x => (isRes(x) && x.ast.k === "ref" && x.ast.p.startsWith(pre)) ? new Res(Object.assign({}, x.ast, { p: x.ast.p.slice(pre.length) })) : x); }
        if (isRes(v) && v.ast.k === "ref") return new Res({ k: "ref", p: n.p, miss: true, hole: v.ast.hole });
        return v;
      }
      case "list": return n.items.map(x => this.ev(x, ctx));
      case "obj": { const o = {}; for (const [k, x] of n.entries) o[k] = this.ev(x, ctx); return o; }
      case "un": {
        const a = this.ev(n.a, ctx); if (isErr(a)) return a;
        if (unfinished(a)) return new Res({ k: "un", op: n.op, a: toAst(a) });
        if (n.op === "-") { if (typeof a !== "number") return new Err("- wants a number"); return -a; }
        return !a;
      }
      case "bin": {
        const a = this.ev(n.a, ctx);
        if (isErr(a)) return a;
        if (!unfinished(a) && n.op === "&&" && !a) return a;
        if (!unfinished(a) && n.op === "||" && a) return a;
        const b = this.ev(n.b, ctx);
        if (isErr(b)) return b;
        if (unfinished(a) || unfinished(b)) return new Res({ k: "bin", op: n.op, a: toAst(a), b: toAst(b) });
        return binop(n.op, a, b);
      }
      case "call": {
        if (n.f === "if") {
          const c = this.ev(n.args[0], ctx); if (isErr(c)) return c;
          if (unfinished(c)) return new Res({ k: "call", f: "if", args: [toAst(c), ...n.args.slice(1).map(x => toAst(this.ev(x, ctx)))] });
          return n.args[c ? 1 : 2] ? this.ev(n.args[c ? 1 : 2], ctx) : null;
        }
        const f = FN[n.f];
        if (!f) return this.callDefined(n, ctx);
        let args = n.args.map(x => this.ev(x, ctx));
        const e = firstErr(args); if (e) return e;
        if (AGG.has(n.f)) {
          let xs = n.f === "join" ? (Array.isArray(args[0]) ? args[0] : [args[0]]) : args.flat(Infinity);
          xs = xs.filter(x => x !== undefined && x !== null);
          if (xs.some(unfinished)) {
            const done = xs.filter(x => !unfinished(x)), open = xs.filter(unfinished);
            if (n.f === "sum") {
              let ast = done.length ? { k: "lit", v: FN.sum(done) } : null;
              for (const o of open) ast = ast ? { k: "bin", op: "+", a: ast, b: toAst(o) } : toAst(o);
              return new Res(ast);
            }
            if (n.f === "count") return xs.length;
            return new Res({ k: "call", f: n.f, args: args.map(toAst) });
          }
          return n.f === "join" ? f(xs, args[1]) : f(xs);
        }
        if (args.some(unfinished)) return new Res({ k: "call", f: n.f, args: args.map(toAst) });
        try { return f(...args); } catch (er) { return new Err(er.message); }
      }
    }
    return new Err("?");
  }
  /* fn.NAME(a, b) = expr: a function written in Hypha, found like a name (an app's own fn first, then the root's) */
  callDefined(n, ctx) {
    const cands = []; let b = ctx.base;
    for (;;) { cands.push(join(b, "fn." + n.f)); if (!b) break; b = parentOf(b); }
    const r = { cands, found: cands.find(c => this.cells.has(c)) };
    for (const c of r.cands) ctx.deps.add(c);
    const def = r.found && this.cells.get(r.found);
    if (!def || def.kind !== "fn") return new Err(`no function "${n.f}"`);
    if ((ctx.depth || 0) > 40) return new Err(`${n.f} calls itself too deeply`);
    const args = n.args.map(x => this.ev(x, ctx)); const e = firstErr(args); if (e) return e;
    if (args.some(unfinished)) return new Res({ k: "call", f: n.f, args: args.map(toAst) });
    const bound = new Map(def.params.map((p, i) => [p, args[i] === undefined ? null : args[i]]));
    const sub = a => {
      switch (a.k) {
        case "ref": { const i = a.p.indexOf("."), head = i < 0 ? a.p : a.p.slice(0, i); if (!bound.has(head)) return a; let v = bound.get(head); if (i >= 0) for (const s of a.p.slice(i + 1).split(".")) v = v != null && typeof v === "object" ? v[s] : undefined; return toAst(v === undefined ? null : v); }
        case "bin": return { k: "bin", op: a.op, a: sub(a.a), b: sub(a.b) };
        case "un": return { k: "un", op: a.op, a: sub(a.a) };
        case "call": return { k: "call", f: a.f, args: a.args.map(sub) };
        case "list": return { k: "list", items: a.items.map(sub) };
        case "obj": return { k: "obj", entries: a.entries.map(([k, x]) => [k, sub(x)]) };
      }
      return a;
    };
    ctx.reads.add(r.found);
    return this.ev(sub(def.ast), { base: parentOf(r.found), self: r.found, deps: ctx.deps, reads: ctx.reads, prov: ctx.prov, depth: (ctx.depth || 0) + 1 });
  }
  compute(c) {
    if (this.computing.has(c.path)) { c.v = new Err("cycle: it reads itself"); c.dirty = false; return; }
    this.computing.add(c.path);
    const ctx = { base: viewBase(c.path), self: c.path, deps: new Set(), reads: new Set(), prov: false };
    let v; try { v = this.ev(c.ast, ctx); } catch (e) { v = new Err(e.message); }
    this.computing.delete(c.path);
    if (typeof v === "number" && !isFinite(v)) v = new Err(isNaN(v) ? "not a number" : "÷ 0");
    c.v = v; c.dprov = ctx.prov; c.dirty = false; c.reads = [...ctx.reads];
    this.unwatch(c); c.deps = ctx.deps; for (const d of c.deps) { if (!this.watch.has(d)) this.watch.set(d, new Set()); this.watch.get(d).add(c.path); }
    this.recomputed.push(c.path);
  }
  unwatch(c) { if (!c.deps) return; for (const d of c.deps) { const w = this.watch.get(d); if (w) { w.delete(c.path); if (!w.size) this.watch.delete(d); } } c.deps = null; }
  propagate(changed) {
    const t0 = now(), affected = new Set(), q = [];
    for (const p of changed) { const c = this.cells.get(p); if (c && c.kind === "formula" && !affected.has(p)) { affected.add(p); } q.push(p); }
    while (q.length) {
      const p = q.pop(); let a = p;
      for (;;) { const w = this.watch.get(a); if (w) for (const f of w) if (!affected.has(f)) { affected.add(f); q.push(f); } if (!a) break; a = parentOf(a); }
    }
    for (const f of affected) { const c = this.cells.get(f); if (c && c.kind === "formula") c.dirty = true; }
    this.recomputed = [];
    for (const f of affected) { const c = this.cells.get(f); if (c && c.dirty) this.compute(c); }
    const us = (now() - t0) * 1000;
    this.stats.us = us; this.stats.totalUs += us; this.stats.recomputed = this.recomputed.length;
    return this.recomputed;
  }
  isStale(p, st) {
    let a = p;
    for (;;) { const s = this.stamps.get(a); if (s && cmpStamp(st, s) < 0) return true; if (!a) return false; a = parentOf(a); }
  }

  /* applying one op. Returns { ok, err, changed, recomputed } */
  apply(op) {
    const s = op.stmt, st = [op.clock, op.peer];
    this.clock = Math.max(this.clock, op.clock);
    if (s.k === "say") { this.said.push({ peer: op.peer, text: s.text, at: op.at }); return { ok: true, changed: [], recomputed: [] }; }
    if (s.k === "at") { this.attend(op.peer, s.path); return { ok: true, changed: [], recomputed: [] }; }
    if (s.k === "err") return { ok: false, err: s.msg, changed: [], recomputed: [] };
    let path = s.path;
    if (!this.allowed(op.peer, path)) { const p = this.peers.get(op.peer); return { ok: false, err: `may only write ${p.can.join(", ")}`, changed: [], recomputed: [] }; }
    if (s.k === "append") {
      if (this.cells.has(path)) { const c = this.cells.get(path); if (c.kind === "lit" && Array.isArray(c.v)) { const arr = c.v, ch = []; this.writeValue(path, arr.length ? arr : [], { by: c.by, at: c.at }, ch); } }
      const idx = this.children(path).filter(x => /^\d+$/.test(x)).map(Number);
      path = join(path, String(idx.length ? Math.max(...idx) + 1 : 0));
    }
    if (this.isStale(path, st)) return { ok: false, stale: true, err: "a later write already replaced this", changed: [], recomputed: [] };
    const changed = [], meta = { by: op.peer, at: op.at, clock: op.clock };
    switch (s.k) {
      case "set": case "append": {
        const ast = s.ast;
        if (ast.k === "hole") this.putLeaf(path, Object.assign({ kind: "hole", intent: ast.intent, via: ast.via || [], prov: false }, meta), changed);
        else if (isLiteral(ast)) this.writeValue(path, litValue(ast), Object.assign({ prov: !!s.prov }, meta), changed);
        else this.putLeaf(path, Object.assign({ kind: "formula", ast, src: s.src, prov: !!s.prov, dirty: true }, meta), changed);
        break;
      }
      case "block": this.putLeaf(path, Object.assign({ kind: "lit", v: "", prov: false }, meta), changed); break;
      case "text": {
        const add = String(litValue(s.ast)), c = this.cells.get(path);
        const prev = c && c.kind === "lit" && typeof c.v === "string" ? c.v : "";
        this.putLeaf(path, Object.assign({ kind: "lit", v: prev ? prev + "\n" + add : add, prov: false }, meta), changed);
        break;
      }
      case "del": if (!this.exists(path)) return { ok: false, err: "nothing there", changed: [], recomputed: [] }; this.removeSubtree(path, changed); this.types.delete(path); this.sources.delete(path); break;
      case "source":
        this.sources.set(path, { conn: s.conn, tool: s.tool, src: s.src, ast: s.ast, by: op.peer, at: op.at });
        if (!this.exists(path)) { this.putLeaf(path, Object.assign({ kind: "hole", intent: `${s.conn}.${s.tool}${s.src ? " " + s.src : ""}`, via: [s.conn], prov: false }, meta), changed); this.stamps.set(path, st); }
        else changed.push(path);
        this.shape++; break;
      case "type": this.types.set(path, s.type); changed.push(path); this.shape++; break;
      case "fn": this.putLeaf(path, Object.assign({ kind: "fn", params: s.params, ast: s.ast, src: s.src, v: `ƒ(${s.params.join(", ")})`, prov: false }, meta), changed); break;
      case "node": {
        // a component's positional args take the names it declares (lib.NAME.takes)
        if (!POS[s.kind]) { const takes = this.takesOf(s.kind); if (takes.length) { const props = {}; for (const [k, v] of Object.entries(s.props)) { const m = /^_(\d+)$/.exec(k); props[m && takes[+m[1]] ? takes[+m[1]] : k] = v; } s.props = props; } }
        // a value or a hole at this path becomes an element; its props are replaced, its child elements stay
        if (this.cells.has(path)) this.dropLeaf(path, changed);
        let a = parentOf(path); while (a) { if (this.cells.has(a)) this.dropLeaf(a, changed); a = parentOf(a); }
        const keep = new Set(["k"].concat(Object.keys(s.props))); if (s.act != null) keep.add("do");
        const leaf = POS[s.kind] && !CONTAINERS.has(s.kind);
        for (const seg of this.children(path).slice()) if ((!isNum(seg) && !keep.has(seg)) || (leaf && isNum(seg))) this.removeSubtree(join(path, seg), changed);
        const m2 = () => Object.assign({ prov: false }, meta);
        this.putLeaf(join(path, "k"), Object.assign({ kind: "lit", v: s.kind }, m2()), changed);
        for (const [name, pr] of Object.entries(s.props)) {
          const q = join(path, name), ast = pr.ast;
          if (ast.k === "hole") this.putLeaf(q, Object.assign({ kind: "hole", intent: ast.intent, via: ast.via || [] }, m2()), changed);
          else if (isLiteral(ast)) this.writeValue(q, litValue(ast), m2(), changed);
          else this.putLeaf(q, Object.assign({ kind: "formula", ast, src: pr.src, dirty: true }, m2()), changed);
        }
        if (s.act != null) this.putLeaf(join(path, "do"), Object.assign({ kind: "lit", v: s.act }, m2()), changed);
        this.shape++;
        break;
      }
    }
    if (s.k !== "type" && s.k !== "text" && s.k !== "source") this.stamps.set(path, st);
    if (this.batching) { for (const p of changed) this.batchChanged.push(p); this.stats.ops++; return { ok: true, path, changed, recomputed: [] }; }
    const recomputed = this.propagate(changed);
    this.stats.ops++;
    return { ok: true, path, changed, recomputed };
  }

  /* local cells: values each page keeps for itself (the clock), outside the log; formulas read them like any cell */
  local(path, v) {
    const changed = [], put = (p, x) => { const c = this.cells.get(p); if (c && c.local && c.v === x) return; this.putLeaf(p, { kind: "lit", v: x, prov: false, by: "clock", clock: 0, local: true }, changed); };
    if (isObj(v)) for (const [k, x] of Object.entries(v)) put(join(path, k), x); else put(path, v);
    if (!changed.length) return;
    const recomputed = this.propagate(changed);
    this.emit({ type: "batch", changed, recomputed, local: true });
  }
  /* many ops at once (a sync burst, a pasted turn): apply them all, then recompute each affected formula once */
  batch(fn) {
    this.batching++;
    try { return fn(); }
    finally {
      if (--this.batching === 0 && this.batchChanged.length) {
        const ch = this.batchChanged; this.batchChanged = [];
        const recomputed = this.propagate(ch);
        this.emit({ type: "batch", changed: ch, recomputed });
      }
    }
  }
  /* writing as a peer: the only door */
  commit(stmt, peerId, opts = {}) {
    if (typeof stmt === "string") stmt = parseStmt(stmt);
    if (!stmt) return null;
    const op = { id: uid("o"), peer: peerId, clock: ++this.clock, at: Date.now(), stmt, text: canon(stmt) };
    this.seen.add(op.id);
    const r = this.apply(op);
    op.ok = r.ok; op.err = r.err || null; op.path = r.path || stmt.path || null; op.recomputed = r.recomputed;
    if (stmt.k === "at") return op;
    // a drag writes many values: each replaces its own last write in the log (looking back past a few of my
    // other writes, so a shape dragged by x and y coalesces too); the clock still orders them
    let rep = -1;
    if (opts.coalesce && stmt.k === "set" && op.ok) {
      for (let i = this.log.length - 1, n = 0; i >= 0 && n < 6; i--, n++) {
        const l = this.log[i]; if (l.peer !== peerId) break;
        if (l.path === op.path && l.stmt.k === "set" && l.ok && op.at - l.at < 900) { rep = i; break; }
      }
    }
    if (rep >= 0) { op.replaces = this.log[rep].id; this.log.splice(rep, 1); }
    this.log.push(op);
    this.emit({ type: "op", op, r });
    return op;
  }
  /* an op from elsewhere (another tab, another person, a stored log) */
  receive(raw) {
    if (this.seen.has(raw.id)) return null; this.seen.add(raw.id);
    const stmt = parseStmt(raw.text) || { k: "err", msg: "empty", text: raw.text };
    const op = { id: raw.id, peer: raw.peer, clock: raw.clock, at: raw.at || Date.now(), stmt, text: raw.text, remote: true };
    const r = this.apply(op);
    op.ok = r.ok; op.err = r.err || null; op.path = r.path || stmt.path || null; op.recomputed = r.recomputed;
    if (stmt.k !== "at") this.log.push(op);
    this.emit({ type: "op", op, r });
    return op;
  }
  reject(text, peerId, msg) {
    const op = { id: uid("x"), peer: peerId, clock: this.clock, at: Date.now(), stmt: { k: "err", msg, text }, text, ok: false, err: msg, path: null, recomputed: [] };
    this.log.push(op); this.emit({ type: "op", op, r: { ok: false } }); return op;
  }

  /* a source's arguments, evaluated in its own scope (they may read other cells) */
  sourceArgs(path) {
    const sp = this.sources.get(path); if (!sp) return null;
    const ctx = { base: viewBase(path), self: path, deps: new Set(), reads: new Set(), prov: false };
    let v; try { v = this.ev(sp.ast, ctx); } catch (e) { v = new Err(e.message); }
    return v;
  }
  /* reading the whole: projections use these */
  holes() { const out = []; for (const c of this.cells.values()) if (c.kind === "hole") out.push({ path: c.path, intent: c.intent, via: c.via || [], by: c.by, source: this.sources.has(c.path) }); return out; }
  snapshot(p = "") {
    const enc = v => isRes(v) ? { "…": show(v.ast) } : isErr(v) ? { "!": v.msg } : Array.isArray(v) ? v.map(enc) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v;
    const walk = q => {
      const c = this.cells.get(q);
      if (c) { if (c.kind === "hole") return { "?": c.intent }; return enc(c.v); }
      const segs = this.children(q);
      if (segs.length && segs.every(s => /^\d+$/.test(s))) return segs.map(s => walk(join(q, s)));
      const o = {}; for (const s of segs) o[s] = walk(join(q, s)); return o;
    };
    return walk(p);
  }
  /* the inputs a component declares: lib.NAME.takes = "of, label, unit" */
  takesOf(kind) { const v = this.valueAt(`lib.${kind}.takes`); return typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : Array.isArray(v) ? v.map(String) : []; }
  /* an element back as its line: kind args -> action */
  propSrc(q) {
    const c = this.cells.get(q);
    if (c) return c.kind === "hole" ? (c.intent ? "?" + JSON.stringify(c.intent) : "?") : c.kind === "formula" ? c.src : showLit(c.v);
    return showLit(this.valueAt(q));
  }
  nodeLine(p) {
    const c = this.cells.get(p);
    if (c) return c.kind === "hole" ? (c.intent ? "?" + JSON.stringify(c.intent) : "?") + (c.via || []).map(v => " @" + v).join("") : `text ${c.kind === "formula" ? c.src : showLit(c.v)}`;
    const kc = this.cells.get(join(p, "k")), kind = kc && typeof kc.v === "string" ? kc.v : "col";
    const names = this.children(p).filter(x => !isNum(x) && x !== "k" && x !== "do");
    const pos = POS[kind] || this.takesOf(kind).concat(names.filter(n => /^_\d+$/.test(n)).sort()), args = [], used = new Set();
    let lead = "";
    if (kind === "each" && names.includes("as") && names.includes("of")) { lead = `${this.valueAt(join(p, "as"))} in ${this.propSrc(join(p, "of"))}`; used.add("as"); used.add("of"); }
    else for (const nm of pos) { if (!names.includes(nm)) break; args.push(this.propSrc(join(p, nm))); used.add(nm); }
    for (const nm of names) if (!used.has(nm)) args.push(`${nm}: ${this.propSrc(join(p, nm))}`);
    const all = (lead ? [lead] : []).concat(args), d = this.cells.get(join(p, "do"));
    return kind + (all.length ? " " + all.join(", ") : "") + (d && typeof d.v === "string" && d.v ? " -> " + d.v : "");
  }
  /* a view as the block that writes it */
  viewLines(p, ind, out, opts = {}) {
    const pad = " ".repeat(ind);
    for (const s of this.children(p)) {
      if (!isNum(s)) continue;
      const q = join(p, s);
      out.push(pad + this.nodeLine(q) + (opts.paths ? `   # ${q}` : ""));
      if (!this.cells.has(q)) this.viewLines(q, ind + 2, out, opts);
    }
    return out;
  }
  viewBlock(p, seg, ind, opts = {}) {
    const pad = " ".repeat(ind), out = [], c = this.cells.get(p);
    if (c) { out.push(`${pad}${seg} = ${c.kind === "hole" ? (c.intent ? "?" + JSON.stringify(c.intent) : "?") : c.kind === "formula" ? c.src : showLit(c.v)}`); return out; }
    const head = this.nodeLine(p);
    if (head !== "col") out.push(`${pad}${seg} is ${head}`);
    out.push(`${pad}${seg}:` + (opts.paths ? `   # ${p}` : ""));
    this.viewLines(p, ind + 2, out, opts);
    return out;
  }
  /* the tree back in its own language: what an agent reads is what it writes */
  toHypha(opts = {}) {
    const lines = [], values = opts.values !== false;
    const recordLike = p => {
      const leaves = this.leavesUnder(p);
      return leaves.length && leaves.length <= 8 && leaves.every(l => { const c = this.cells.get(l); return c.kind === "lit" && !c.prov && !(typeof c.v === "string" && c.v.includes("\n")) && !this.types.has(l); });
    };
    const maxRows = opts.maxRows || Infinity, keep = opts.keep || (() => false);
    const walk = (p, ind) => {
      const pad = " ".repeat(ind), segs = this.children(p);
      const numeric = segs.length > maxRows && segs.every(x => /^\d+$/.test(x));
      let skipped = 0;
      for (const s of segs) {
        const q = join(p, s), c = this.cells.get(q);
        if (opts.skip && opts.skip(q)) continue;
        if (c && c.local) continue;
        if (!c && !p && this.leavesUnder(q).every(l => this.cells.get(l).local)) continue;
        if (isViewPath(q) && !isViewPath(p)) { lines.push(...this.viewBlock(q, s, ind, opts)); continue; }
        if (numeric && +s >= maxRows && !keep(q)) { skipped++; continue; }
        if (c) {
          if (c.kind === "fn") { lines.push(`${pad}${s}(${c.params.join(", ")}) = ${c.src}`); continue; }
          if (c.kind === "hole") { if (!this.sources.has(q)) lines.push(`${pad}${s} = ${c.intent ? "?" + JSON.stringify(c.intent) : "?"}${(c.via || []).map(v => " @" + v).join("")}`); }
          else if (c.kind === "formula") {
            const val = isRes(c.v) ? "… " + show(c.v.ast) : isErr(c.v) ? "! " + c.v.msg : showLit(c.v);
            lines.push(`${pad}${s} ${c.prov ? "≈" : "="} ${c.src}${values ? "  # → " + val : ""}`);
          } else if (typeof c.v === "string" && c.v.includes("\n")) {
            lines.push(`${pad}${s} = |`); for (const l of c.v.split("\n")) lines.push(`${pad}  ${l}`);
          } else lines.push(`${pad}${s} ${c.prov ? "≈" : "="} ${showLit(c.v)}`);
          const t = this.types.get(q); if (t) lines.push(`${pad}${s} :: ${t.src}`);
          const so = this.sources.get(q); if (so) lines.push(`${pad}${s} <- ${so.conn}.${so.tool}${so.src ? " " + so.src : ""}`);
        } else if (/^\d+$/.test(s) && recordLike(q)) {
          lines.push(`${pad}${s} = ${showLit(this.valueAt(q))}`);
        } else { lines.push(`${pad}${s}:`); walk(q, ind + 2); const t = this.types.get(q); if (t) lines.push(`${pad}${s} :: ${t.src}`); const so = this.sources.get(q); if (so) lines.push(`${pad}${s} <- ${so.conn}.${so.tool}${so.src ? " " + so.src : ""}`); }
      }
      if (skipped) lines.push(`${pad}# … ${skipped} more rows like these (${segs.length} in all; read ${p ? p + "." : ""}<n> to see one)`);
    };
    if (opts.root) {
      // one subtree as if it stood alone: its scope line, then what is below it
      if (this.cells.has(opts.root)) return this.toHyphaOne(opts.root);
      if (isViewPath(opts.root)) return this.viewBlock(opts.root, opts.root, 0, opts).join("\n");
      lines.push(`${opts.root}:`); walk(opts.root, 2); return lines.join("\n");
    }
    walk("", 0);
    return lines.join("\n");
  }
  toHyphaOne(p) { const c = this.cells.get(p); if (!c) return ""; if (c.kind === "fn") return `${p}(${c.params.join(", ")}) = ${c.src}`; return `${p} = ${c.kind === "hole" ? (c.intent ? "?" + JSON.stringify(c.intent) : "?") : c.kind === "formula" ? c.src : showLit(c.v)}`; }
  /* a snapshot: one op per cell with the stamp of the write that made it, plus every stamp (deletions
     included), so a fresh kernel loading it converges with replicas that saw the whole log */
  checkpoint() {
    const ops = [];
    for (const c of this.cells.values()) {
      if (c.local) continue;
      const p = c.path; let text;
      if (c.kind === "hole") { if (this.sources.has(p)) continue; text = `${p} = ${c.intent ? "?" + JSON.stringify(c.intent) : "?"}${(c.via || []).map(v => " @" + v).join("")}`; }
      else if (c.kind === "formula") text = `${p} ${c.prov ? "≈" : "="} ${c.src}`;
      else if (c.kind === "fn") text = `${p}(${c.params.join(", ")}) = ${c.src}`;
      else text = `${p} ${c.prov ? "≈" : "="} ${showLit(c.v)}`;
      ops.push([c.by || "snap", c.clock || 0, text]);
    }
    for (const [p, t] of this.types) ops.push(["snap", this.clock, `${p} :: ${t.src}`]);
    for (const [p, so] of this.sources) ops.push([so.by || "snap", this.clock, `${p} <- ${so.conn}.${so.tool}${so.src ? " " + so.src : ""}`]);
    const stamps = []; for (const [p, st] of this.stamps) stamps.push([p, st[0], st[1]]);
    return { clock: this.clock, ops, stamps };
  }
  restore(cp, tag) {
    this.batch(() => {
      cp.ops.forEach(([peer, clock, text], i) => this.receive({ id: `${tag}:${i}`, peer, clock, text, at: 0, snap: true }));
      for (const [p, c, peer] of cp.stamps || []) { const cur = this.stamps.get(p), st = [c, peer]; if (!cur || cmpStamp(cur, st) < 0) this.stamps.set(p, st); }
      this.clock = Math.max(this.clock, cp.clock || 0);
    });
  }
  /* the tree for an agent, within a byte budget: long lists keep a few rows plus any row holding a hole
     or the focus, and say how many they skip; the shape always arrives whole */
  toHyphaWithin(budget, focus, opts = {}) {
    const full = this.toHypha(opts); if (full.length <= budget) return full;
    for (const rows of [40, 12, 4, 1]) {
      const keep = q => (focus && (focus === q || focus.startsWith(q + ".") || q.startsWith(focus + "."))) || this.leavesUnder(q).some(l => this.cells.get(l).kind === "hole");
      const out = this.toHypha(Object.assign({}, opts, { maxRows: rows, keep })); if (out.length <= budget || rows === 1) return out.length <= budget ? out : out.slice(0, budget) + "\n# … cut at " + budget + " bytes";
    }
  }
  /* time: the state at any point is the fold of the log up to it */
  replay(n) {
    const k = new Kernel();
    for (const [id, p] of this.peers) k.peers.set(id, Object.assign({}, p));
    for (const op of this.log.slice(0, n)) { if (op.stmt.k === "err") continue; const r = k.apply(op); const o = Object.assign({}, op, { ok: r.ok, recomputed: r.recomputed }); k.log.push(o); }
    return k;
  }
}

/* ---------- streams: a peer's text arriving token by token ---------- */
/* A scope whose path holds a "ui" segment (trip.ui:) opens a view block. Inside it each line is an element
   (kind args -> action), placed at the next index of its parent; indenting nests. When the block closes,
   elements the block did not write are removed, so a block always leaves exactly the view it describes. */
class Stream {
  constructor(k, peerId, opts = {}) {
    const base = opts.base || "";
    this.k = k; this.peer = peerId; this.buf = ""; this.scopes = [{ ind: -1, path: base, view: false, n: 0 }];
    this.block = null; this.ops = []; this.onOp = opts.onOp || null; this.chars = 0; this.lines = 0;
    this.written = new Set();   // every path this stream wrote (a source editor uses it to remove the rest)
  }
  feed(chunk) {
    this.buf += chunk; this.chars += chunk.length;
    if (this.buf.indexOf("\n") >= 0) this.k.batch(() => { let i; while ((i = this.buf.indexOf("\n")) >= 0) { const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); this.line(line); } });
    this.ghost();
  }
  end() {
    this.k.batch(() => {
      if (this.buf.trim()) { const l = this.buf; this.buf = ""; this.line(l); }
      while (this.scopes.length > 1) this.pop();
    });
    this.buf = ""; this.block = null; this.k.setIntent(this.peer, null); return this.ops;
  }
  top(ind) { let i = this.scopes.length - 1; while (i > 0 && ind <= this.scopes[i].ind) i--; return this.scopes[i]; }
  commit(stmt) {
    const op = this.k.commit(stmt, this.peer);
    if (op) { this.ops.push(op); if (op.ok && op.path) this.written.add(op.path); if (this.onOp) this.onOp(op); }
    return op;
  }
  reject(text, msg) { const op = this.k.reject(text, this.peer, msg); this.ops.push(op); if (this.onOp) this.onOp(op); return op; }
  pop() {
    const sc = this.scopes.pop();
    if (sc.root && sc.root.path === sc.path) this.prune(sc.root);
  }
  /* a view block closes: remove child elements it did not write */
  prune(root) {
    for (const p of root.nodes) {
      if (!this.k.exists(p) || this.k.cells.has(p)) continue;
      for (const seg of this.k.children(p).slice()) {
        if (!/^\d+$/.test(seg)) continue;
        const q = join(p, seg);
        if (!root.nodes.has(q)) this.commit({ k: "del", path: q });
      }
    }
  }
  openView(path, ind) {
    const root = { path, nodes: new Set([path]) };
    if (!this.k.cells.has(join(path, "k"))) this.commit({ k: "node", path, kind: "col", props: {}, act: null, src: "col" });
    this.scopes.push({ ind, path, view: true, n: 0, root });
  }
  viewLine(text, ind, top) {
    if (text.startsWith('"')) { this.commit({ k: "say", text: text.slice(1).trim().replace(/"$/, "") }); return; }
    const P = join(top.path, String(top.n));
    if (text.startsWith("?")) {
      let ast; try { ast = parseExpr(stripComment(text)); } catch (e) { this.reject(text, e.message); return; }
      if (ast.k !== "hole") { this.reject(text, "a hole in a view is ?\"what goes here\""); return; }
      top.n++; top.root.nodes.add(P);
      this.commit({ k: "set", path: P, src: show(ast), ast });
      this.scopes.push({ ind, path: P, view: true, n: 0, root: top.root });
      return;
    }
    if (/[^:]:$/.test(text) && !/"$/.test(text)) text = text.slice(0, -1).trim();   // "row:" means row
    if (RE_SET.test(text) && !/^[a-z][a-z0-9_]*\s+[^=:+&~≈]/.test(text)) { this.reject(text, "inside a ui block each line is an element (text \"hi\", row, slider days); write data outside the block"); return; }
    let n;
    try { n = parseNode(text); } catch (e) { this.reject(text, e.message); top.n++; top.root.nodes.add(P); this.scopes.push({ ind, path: P, view: true, n: 0, root: top.root }); return; }
    top.n++; top.root.nodes.add(P);
    this.commit(Object.assign({ k: "node", path: P }, n));
    this.scopes.push({ ind, path: P, view: true, n: 0, root: top.root });
  }
  line(raw) {
    raw = raw.replace(/\r$/, "").replace(/\t/g, "  ");
    const ind = raw.length - raw.trimStart().length, text = raw.trim();
    this.lines++;
    if (this.block) {
      if (!text) { this.block.blank++; return; }
      if (ind > this.block.ind) {
        if (this.block.cind == null) this.block.cind = ind;
        const t = "\n".repeat(this.block.blank) + raw.slice(Math.min(ind, this.block.cind));
        this.block.blank = 0; this.commit({ k: "text", path: this.block.path, src: JSON.stringify(t), ast: { k: "lit", v: t } }); return;
      }
      this.block = null;
    }
    if (!text || text.startsWith("#") || text.startsWith("```")) return;
    while (this.scopes.length > 1 && ind <= this.scopes[this.scopes.length - 1].ind) this.pop();
    const top = this.scopes[this.scopes.length - 1], base = top.path;
    if (top.view) return this.viewLine(text, ind, top);
    const s = parseStmt(text); if (!s) return;
    if (s.k === "err") { this.reject(text, s.msg); return; }
    if (s.path !== undefined && s.k !== "say") s.path = join(base, s.path);
    if (s.k === "scope") {
      if (isViewPath(s.path)) return this.openView(s.path, ind);
      this.scopes.push({ ind, path: s.path, view: false, n: 0 }); return;
    }
    if (s.k === "block") { this.block = { path: s.path, ind, blank: 0, cind: null }; this.commit({ k: "set", path: s.path, src: '""', ast: { k: "lit", v: "" } }); return; }
    this.commit(s);
  }
  ghost() {
    const raw = this.buf.replace(/\t/g, "  ");
    if (!raw.trim()) { this.k.setIntent(this.peer, this.block ? { path: this.block.path, text: "", append: true } : null); return; }
    const ind = raw.length - raw.trimStart().length;
    if (this.block && ind > this.block.ind) { this.k.setIntent(this.peer, { path: this.block.path, text: raw.trim(), append: true }); return; }
    const top = this.top(ind);
    if (top.view) { this.k.setIntent(this.peer, { path: join(top.path, String(top.n)), op: "is", text: raw.trim(), view: true }); return; }
    this.k.setIntent(this.peer, intentOf(raw, top.path));
  }
}

const Hypha = { Kernel, Stream, parseStmt, parseExpr, parseNode, splitTop, stripComment, canon, show, showLit, fmtNum, toAst, intentOf, isRes, isErr, isObj, unfinished, join, parentOf, segOf, globMatch, uid, FN, Res, Err, POS, ALIAS, CONTAINERS, isViewPath, viewBase, isLiteral, litValue, PATH };
if (typeof module !== "undefined" && module.exports) module.exports = Hypha; else root.Hypha = Hypha;

function binop(op, a, b) {
  switch (op) {
    case "+":
      if (typeof a === "number" && typeof b === "number") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      if (typeof a === "string" || typeof b === "string") return (typeof a === "number" ? fmtNum(a) : String(a)) + (typeof b === "number" ? fmtNum(b) : String(b));
      return new Err("+ wants numbers or text");
    case "-": case "*": case "/": case "^":
      if (typeof a !== "number" || typeof b !== "number") return new Err(`${op} wants numbers`);
      if (op === "/" && b === 0) return new Err("÷ 0");
      return op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : Math.pow(a, b);
    case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b;
    case "==": return JSON.stringify(a) === JSON.stringify(b); case "!=": return JSON.stringify(a) !== JSON.stringify(b);
    case "&&": return a && b; case "||": return a || b;
  }
  return new Err("?");
}
})(typeof window !== "undefined" ? window : globalThis);
