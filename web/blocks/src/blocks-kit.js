/* CLAUDE BLOCKS · the block kit
   Notion-shaped blocks, written as Fruit elements so every block is a cell in the same log as everything else.
   p "text"  bullet  numbered  todo "text", done: true  callout "text", icon: "💡", tone  fold "title" (holds blocks)
   columns (holds col, each holding blocks)  page NAME (a link to a sub-page)  toc
   Prose is light markdown: **bold** *italic* `code` ~~struck~~ [label](https://…) [[page]] and {formula}:
   anything between braces is a live Hypha expression read from the page's scope, so a sentence can hold a value. */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit, { h, R, prop, styleOf, fmt, evalAst, write } = F;

Object.assign(H.POS, { p: ["text"], bullet: ["text"], numbered: ["text"], todo: ["text"], callout: ["text"], fold: ["title"], columns: [], page: ["of"], toc: [] });
/* any text block can hold blocks below it (Tab nests, like Notion); headings and code cannot */
for (const k of ["fold", "columns", "p", "bullet", "numbered", "todo", "callout", "quote"]) H.CONTAINERS.add(k);

const PROSE = new Set(["p", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code", "fold", "text"]);
const textProp = kind => (kind === "fold" ? "title" : "text");

/* ---------- rich text: a tiny tokenizer and two printers (virtual DOM for Fruit, HTML for the editor) ---------- */
const RE = /(\{[^{}\n]+\}|\*\*(?:\{[^{}\n]+\}|[^*\n])+?\*\*|~~[^~\n]+~~|`[^`\n]+`|\[\[[A-Za-z_][\w.]*\]\]|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*(?!\s)(?:\{[^{}\n]+\}|[^*\n])+?\*|(?:^|(?<=\s))https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;
function tokens(s) {
  const out = []; let last = 0, m; s = String(s == null ? "" : s); RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const x = m[0];
    if (x[0] === "{") out.push({ t: "expr", src: x.slice(1, -1).trim() });
    else if (x.startsWith("**")) out.push({ t: "b", kids: tokens(x.slice(2, -2)) });
    else if (x.startsWith("~~")) out.push({ t: "s", kids: tokens(x.slice(2, -2)) });
    else if (x[0] === "`") out.push({ t: "code", v: x.slice(1, -1) });
    else if (x.startsWith("[[")) out.push({ t: "page", name: x.slice(2, -2) });
    else if (x[0] === "[") { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(x); out.push({ t: "a", v: mm[1], url: mm[2] }); }
    else if (x[0] === "*") out.push({ t: "i", kids: tokens(x.slice(1, -1)) });
    else out.push({ t: "a", v: x.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48), url: x });
    last = m.index + x.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}
const asts = new Map();
function astOf(src) {
  let a = asts.get(src); if (a) return a;
  try { a = { ast: H.parseExpr(src) }; } catch (e) { a = { err: e.message }; }
  if (asts.size > 2000) asts.clear(); asts.set(src, a); return a;
}
/* the value of {src} as read from the block at path p */
function valueOf(K, p, src, env) {
  const a = astOf(src); if (a.err) return new H.Err(a.err);
  return evalAst(K, a.ast, p, env && env.al);
}
function pageTitle(K, name) { const t = K.cells.get(name + ".title"); return t && typeof t.v === "string" && t.v ? t.v : name.replace(/_/g, " "); }
function pageIcon(K, name) { const t = K.cells.get(name + ".icon"); return t && typeof t.v === "string" && t.v ? t.v : ""; }
function rich(K, p, s, env) {
  const walk = list => list.map(tk => {
    switch (tk.t) {
      case "text": return tk.v;
      case "b": return h("strong", null, walk(tk.kids));
      case "i": return h("em", null, walk(tk.kids));
      case "s": return h("s", null, walk(tk.kids));
      case "code": return h("code", { class: "b-code" }, tk.v);
      case "a": return h("a", { href: tk.url, target: "_blank", rel: "noopener noreferrer", class: "b-a" }, tk.v);
      case "page": {
        const ok = K.exists(tk.name) && !K.cells.has(tk.name);
        return h("a", { class: "b-mention" + (ok ? "" : " missing"), "data-go": tk.name, href: "#" + tk.name, title: ok ? "Open " + pageTitle(K, tk.name) : "No page called " + tk.name + " yet: click to make it" },
          h("span", { class: "i" }, pageIcon(K, tk.name) || "↗"), ok ? pageTitle(K, tk.name) : tk.name);
      }
      case "expr": {
        const v = valueOf(K, p, tk.src, env), bad = H.isErr(v), wait = !bad && H.unfinished(v);
        return h("span", { class: "b-val" + (bad ? " err" : wait ? " wait" : ""), "data-expr": tk.src, title: (bad ? v.msg + " · " : wait ? "waiting for a hole to be filled · " : "") + "= " + tk.src }, bad ? "!" : wait ? "…" : fmt(v));
      }
    }
    return null;
  });
  return walk(tokens(s));
}
/* a virtual node as HTML (the editor's resting state is plain DOM) */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);
function toHTML(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(toHTML).join("");
  if (typeof v !== "object") return esc(v);
  const attrs = Object.entries(v.p || {}).filter(([k, x]) => x != null && x !== false && !["key", "ref", "on", "style"].includes(k)).map(([k, x]) => ` ${k}="${esc(x === true ? "" : x)}"`).join("");
  return `<${v.t}${attrs}>${(v.c || []).map(toHTML).join("")}</${v.t}>`;
}
const richHTML = (K, p, s, env) => toHTML(rich(K, p, s, env));
/* text with the markup taken off: for search, titles and the table of contents */
function plain(s) { return tokens(s).map(function f(tk) { return tk.t === "text" || tk.t === "code" || tk.t === "a" ? tk.v : tk.kids ? tk.kids.map(f).join("") : tk.t === "page" ? tk.name : tk.t === "expr" ? "{" + tk.src + "}" : ""; }).join(""); }

/* ---------- colours: Notion's ten, as text and as background ---------- */
const COLORS = {
  default: ["", ""], gray: ["#787774", "#F1F1EF"], brown: ["#976D57", "#F3EEEE"], orange: ["#CC782F", "#F8ECDF"], yellow: ["#C29343", "#FAF3DD"],
  green: ["#548164", "#EEF3ED"], blue: ["#487CA5", "#E9F3F7"], purple: ["#8A67AB", "#F6F3F8"], pink: ["#B35488", "#F9F2F5"], red: ["#C4554D", "#FAECEC"],
};
const COLORS_DARK = { gray: ["#9B9B9B", "#2F2F2F"], brown: ["#BA856F", "#4A3228"], orange: ["#C77D48", "#5C3B23"], yellow: ["#CA9849", "#564328"], green: ["#529E72", "#243D30"], blue: ["#5E87C9", "#143A4E"], purple: ["#9D68D3", "#3C2D49"], pink: ["#D15796", "#4E2C3C"], red: ["#DF5452", "#522E2A"] };
/* a block's colour props (color: "blue", bg: "yellow") become CSS variables the stylesheet reads in both themes */
function tint(K, p, env) {
  const st = {}, c = prop(K, p, "color", env), b = prop(K, p, "bg", env);
  if (typeof c === "string" && c) { if (COLORS[c]) { st["--b-fg"] = COLORS[c][0]; st["--b-fg-d"] = (COLORS_DARK[c] || COLORS[c])[0]; } else { const x = F.color(c); if (x) { st["--b-fg"] = x; st["--b-fg-d"] = x; } } }
  if (typeof b === "string" && b) { if (COLORS[b]) { st["--b-bg"] = COLORS[b][1]; st["--b-bg-d"] = (COLORS_DARK[b] || COLORS[b])[1]; } else { const x = F.color(b); if (x) { st["--b-bg"] = x; st["--b-bg-d"] = x; } } }
  return st;
}
const tintClass = (K, p, env) => (prop(K, p, "color", env) ? " b-fg" : "") + (prop(K, p, "bg", env) ? " b-bgc" : "");

/* ---------- numbering: a numbered block counts the numbered blocks right above it ---------- */
function numberOf(K, p) {
  const par = H.parentOf(p), me = H.segOf(p), sibs = K.children(par).filter(s => /^\d+$/.test(s));
  let n = 1;
  for (let i = sibs.indexOf(me) - 1; i >= 0; i--) { const k = K.cells.get(par + "." + sibs[i] + ".k"); if (k && k.v === "numbered") n++; else break; }
  return n;
}
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
function numberLabel(K, p) {
  let depth = 0, a = H.parentOf(p); while (a && !/\.ui$/.test(a) && a.indexOf(".ui") > 0) { const k = K.cells.get(a + ".k"); if (k && k.v === "fold") depth++; a = H.parentOf(a); }
  const n = numberOf(K, p);
  return depth % 3 === 1 ? LETTERS[(n - 1) % 26] + "." : depth % 3 === 2 ? ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][(n - 1) % 10] + "." : n + ".";
}

/* ---------- the elements, as Fruit draws them (inside cards, embeds, the past, read-only pages) ---------- */
const textOf = (K, p, env, name = "text") => { const v = prop(K, p, name, env); return v; };
const richOrValue = (K, p, env, name = "text") => {
  const c = K.cells.get(p + "." + name), v = textOf(K, p, env, name);
  if (c && c.kind === "lit" && typeof c.v === "string") return rich(K, p, c.v, env);
  return H.isRes(v) || H.isErr(v) ? F.valueNode(v) : rich(K, p, v == null ? "" : fmt(v), env);
};
const kidsBelow = (K, p, env) => (F.kidsOf(K, p).length ? h("div", { class: "b-kids" }, F.kids(K, p, env)) : null);
const withKids = (v, K, p, env) => { const k = kidsBelow(K, p, env); return k ? h("div", { class: "b-with" }, v, k) : v; };
const box = (tag, cls) => (K, p, env) => withKids(h(tag, { class: cls + tintClass(K, p, env), style: Object.assign(styleOf(K, p, env), tint(K, p, env)) }, richOrValue(K, p, env)), K, p, env);
R.p = box("p", "b-p");
R.h1 = box("h2", "b-h1"); R.h2 = box("h3", "b-h2"); R.h3 = box("h4", "b-h3");
R.quote = box("blockquote", "b-quote");
R.bullet = (K, p, env) => withKids(h("div", { class: "b-li" + tintClass(K, p, env), style: Object.assign(styleOf(K, p, env), tint(K, p, env)) }, h("span", { class: "b-mark dot", "aria-hidden": "true" }), h("div", { class: "b-li-t" }, richOrValue(K, p, env))), K, p, env);
R.numbered = (K, p, env) => withKids(h("div", { class: "b-li" + tintClass(K, p, env), style: Object.assign(styleOf(K, p, env), tint(K, p, env)) }, h("span", { class: "b-mark num" }, numberLabel(K, p)), h("div", { class: "b-li-t" }, richOrValue(K, p, env))), K, p, env);
R.todo = (K, p, env) => {
  const done = !!prop(K, p, "done", env), c = K.cells.get(p + ".done"), can = !env.readonly && (!c || c.kind === "lit");
  return withKids(h("div", { class: "b-li b-todo" + (done ? " done" : "") + tintClass(K, p, env), style: Object.assign(styleOf(K, p, env), tint(K, p, env)) },
    h("button", { type: "button", class: "b-check", role: "checkbox", "aria-checked": done ? "true" : "false", "aria-label": "Done", disabled: !can, on: { click: () => write(env, p + ".done", !done) } }),
    h("div", { class: "b-li-t" }, richOrValue(K, p, env))), K, p, env);
};
const TONE_BG = { accent: "orange", good: "green", bad: "red", warn: "yellow", muted: "gray", you: "blue" };
R.callout = (K, p, env) => {
  const icon = prop(K, p, "icon", env), tone = prop(K, p, "tone", env), st = Object.assign(styleOf(K, p, env), tint(K, p, env));
  if (!prop(K, p, "bg", env) && TONE_BG[tone]) { st["--b-bg"] = COLORS[TONE_BG[tone]][1]; st["--b-bg-d"] = COLORS_DARK[TONE_BG[tone]][1]; }
  return h("div", { class: "b-callout" + tintClass(K, p, env) + (tone && TONE_BG[tone] ? " b-bgc" : ""), style: st }, h("span", { class: "b-callout-i", "aria-hidden": "true" }, typeof icon === "string" && icon ? icon : "💡"), h("div", { class: "b-callout-t" }, richOrValue(K, p, env), kidsBelow(K, p, env)));
};
R.fold = (K, p, env) => {
  const open = env.local.get(p + "#open") != null ? !!env.local.get(p + "#open") : !!prop(K, p, "open", env);
  return h("div", { class: "b-fold" + (open ? " open" : "") },
    h("button", { type: "button", class: "b-fold-h", "aria-expanded": open ? "true" : "false", on: { click: () => { env.local.set(p + "#open", !open); env.rerender(); } } },
      h("span", { class: "b-tri", "aria-hidden": "true" }), h("span", null, richOrValue(K, p, env, "title"))),
    open ? h("div", { class: "b-fold-kids" }, F.kids(K, p, env)) : null);
};
R.columns = (K, p, env) => h("div", { class: "b-cols", style: styleOf(K, p, env) }, F.kids(K, p, Object.assign({}, env, { width: env.width ? env.width / Math.max(1, F.kidsOf(K, p).length) : env.width })));
R.page = (K, p, env) => {
  const b = F.bind(K, p, "of", env), name = typeof K.cells.get(p + ".of") === "object" && K.cells.get(p + ".of").kind === "formula" ? (K.cells.get(p + ".of").src || "") : String(prop(K, p, "of", env) || "");
  const target = /^[A-Za-z_]\w*$/.test(name) ? name : b.path || name, ok = K.exists(target) && !K.cells.has(target);
  return h("a", { class: "b-pagelink" + (ok ? "" : " missing"), "data-go": target, href: "#" + target },
    h("span", { class: "i" }, pageIcon(K, target) || "📄"), h("span", { class: "t" }, ok ? pageTitle(K, target) : "Untitled"));
};
/* the headings of the page this block sits on, in reading order */
function headings(K, page) {
  const out = [], walk = p => { for (const q of F.kidsOf(K, p)) { const k = (K.cells.get(q + ".k") || {}).v; if (k === "h1" || k === "h2" || k === "h3") { const t = K.cells.get(q + ".text"); out.push({ path: q, level: +k[1], text: t && typeof t.v === "string" ? plain(t.v) : fmt(K.valueAt(q + ".text")) }); } if (k === "fold" || k === "columns" || k === "col" || !k) walk(q); } };
  if (K.exists(page + ".ui")) walk(page + ".ui");
  return out;
}
R.toc = (K, p, env) => {
  const page = H.viewBase(p), list = headings(K, page);
  if (!list.length) return h("div", { class: "b-toc empty" }, "Add headings and they show up here.");
  return h("nav", { class: "b-toc", "aria-label": "On this page" }, list.map(x => h("a", { key: x.path, href: "#", class: "l" + x.level, "data-jump": x.path }, x.text || "Heading")));
};

root.Blocks = { PROSE, textProp, tokens, rich, richHTML, toHTML, plain, valueOf, COLORS, COLORS_DARK, tint, numberLabel, headings, pageTitle, pageIcon, esc };
})(typeof window !== "undefined" ? window : globalThis);
