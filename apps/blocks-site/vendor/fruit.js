/* FRUIT · views that surface from the tree
   Hypha is the mycelium: one log of ops folded into live cells. Fruit is what surfaces: a view is a subtree
   under app.ui whose elements are cells too (kind at .k, every prop its own literal or formula, children at
   .0 .1 …). Rendering is a pure read of the tree; every gesture is an op written as the person.

   This file: a small virtual DOM, the element kit, bindings (a prop that names a path reads it and writes
   back through it), templates (each, with aliases that point at real paths when they can), and actions. */
(function (root) {
"use strict";
const H = root.Hypha;
const SVG = "http://www.w3.org/2000/svg";

/* ---------- a small virtual DOM ---------- */
function flat(list, out = []) {
  for (const x of list) {
    if (x == null || x === false || x === true) continue;
    if (Array.isArray(x)) flat(x, out);
    else out.push(typeof x === "object" ? x : String(x));
  }
  return out;
}
function h(t, p, ...c) { return { t, p: p || {}, c: flat(c) }; }
const keyOf = v => (v && typeof v === "object" ? v.p.key : undefined);
function setProp(el, k, v, old, svg) {
  if (k === "key" || k === "ref" || k === "on") return;
  if (k === "style") {
    if (typeof v === "string") { el.style.cssText = v; return; }
    const o = old && typeof old === "object" ? old : {};
    for (const s in o) if (!v || !(s in v)) { if (s.startsWith("--")) el.style.removeProperty(s); else el.style[s] = ""; }
    if (v) for (const s in v) if (o[s] !== v[s]) { if (s.startsWith("--")) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; }
    return;
  }
  if (k === "value") { if (document.activeElement !== el && el.value !== String(v == null ? "" : v)) el.value = v == null ? "" : v; return; }
  if (k === "checked" || k === "selected" || k === "indeterminate") { el[k] = !!v; return; }
  if (k === "class") k = "class";
  if (v == null || v === false) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? "" : v);
}
function setProps(el, op, np, svg) {
  for (const k in op) if (!(k in np)) setProp(el, k, null, op[k], svg);
  for (const k in np) if (k === "style" ? true : op[k] !== np[k]) setProp(el, k, np[k], op[k], svg);
  const on = np.on || {};
  el._on = on;
  el._bound = el._bound || {};
  for (const ev in on) if (!el._bound[ev]) { el._bound[ev] = true; el.addEventListener(ev, e => { const f = el._on && el._on[ev]; if (f) f(e, el); }, ev === "wheel" || ev === "touchmove" ? { passive: false } : undefined); }
}
function create(v, svg) {
  if (typeof v === "string") return document.createTextNode(v);
  const isSvg = svg || v.t === "svg";
  const el = isSvg ? document.createElementNS(SVG, v.t) : document.createElement(v.t);
  setProps(el, {}, v.p, isSvg);
  const inner = isSvg && v.t !== "foreignObject";
  for (const c of v.c) el.appendChild(create(c, inner));
  el._v = v;
  if (v.p.ref) try { v.p.ref(el); } catch (e) { console.error(e); }
  return el;
}
function same(a, b) {
  if (typeof a === "string" || typeof b === "string") return typeof a === typeof b;
  return a.t === b.t && a.p.key === b.p.key;
}
function update(el, ov, nv, svg) {
  if (typeof nv === "string") { if (el.nodeValue !== nv) el.nodeValue = nv; return el; }
  const isSvg = svg || nv.t === "svg";
  setProps(el, ov.p, nv.p, isSvg);
  children(el, ov.c, nv.c, isSvg && nv.t !== "foreignObject");
  el._v = nv;
  return el;
}
function children(el, oc, nc, svg) {
  const keyed = nc.some(c => keyOf(c) !== undefined);
  const nodes = [...el.childNodes];
  if (!keyed) {
    const n = Math.max(oc.length, nc.length);
    for (let i = 0; i < n; i++) {
      const o = oc[i], v = nc[i], node = nodes[i];
      if (v === undefined) { if (node) node.remove(); continue; }
      if (o === undefined || !node) { el.appendChild(create(v, svg)); continue; }
      if (!same(o, v)) { el.replaceChild(create(v, svg), node); continue; }
      update(node, o, v, svg);
    }
    return;
  }
  const old = new Map(); oc.forEach((o, i) => { const k = keyOf(o); old.set(k !== undefined ? "k:" + k : "i:" + i, { o, node: nodes[i] }); });
  const out = [];
  nc.forEach((v, i) => {
    const k = keyOf(v), id = k !== undefined ? "k:" + k : "i:" + i, was = old.get(id);
    if (was && was.node && same(was.o, v)) { old.delete(id); out.push(update(was.node, was.o, v, svg)); }
    else out.push(create(v, svg));
  });
  for (const { node } of old.values()) if (node && node.parentNode === el) node.remove();
  out.forEach((node, i) => { if (el.childNodes[i] !== node) el.insertBefore(node, el.childNodes[i] || null); });
  while (el.childNodes.length > out.length) el.lastChild.remove();
}
/* render a vnode (or a list) into a container, diffing against what it held */
function mount(container, v) {
  const nc = flat([v]), oc = container._vc || [];
  if (container._vc === undefined && container.childNodes.length) container.textContent = "";
  children(container, oc, nc, container instanceof SVGElement);
  container._vc = nc;
}

/* ---------- reading the tree ---------- */
const isNum = s => /^\d+$/.test(s);
const appOf = p => p.split(".")[0];
function kindOf(K, p) { const c = K.cells.get(p + ".k"); return c && typeof c.v === "string" ? c.v : (K.cells.has(p) ? (K.cells.get(p).kind === "hole" ? "hole" : "value") : "col"); }
function kidsOf(K, p) { return K.cells.has(p) ? [] : K.children(p).filter(isNum).map(s => p + "." + s); }
function propNames(K, p) { return K.children(p).filter(s => !isNum(s) && s !== "k" && s !== "do"); }

/* aliases: name -> { path } (an item that lives at a path) or { value } (an item computed on the way) */
function subst(ast, al) {
  if (!al || !al.size) return ast;
  const walk = n => {
    switch (n.k) {
      case "ref": {
        const i = n.p.indexOf("."), head = i < 0 ? n.p : n.p.slice(0, i), rest = i < 0 ? "" : n.p.slice(i + 1);
        const a = al.get(head); if (!a) return n;
        if (a.path) return { k: "ref", p: rest ? a.path + "." + rest : a.path };
        let v = a.value; if (rest) for (const s of rest.split(".")) { if (s === "*") break; v = v != null && typeof v === "object" ? v[s] : undefined; }
        return H.toAst(v === undefined ? null : v);
      }
      case "bin": return { k: "bin", op: n.op, a: walk(n.a), b: walk(n.b) };
      case "un": return { k: "un", op: n.op, a: walk(n.a) };
      case "call": return { k: "call", f: n.f, args: n.args.map(walk) };
      case "list": return { k: "list", items: n.items.map(walk) };
      case "obj": return { k: "obj", entries: n.entries.map(([k, x]) => [k, walk(x)]) };
    }
    return n;
  };
  return walk(ast);
}
function evalAst(K, ast, p, al) {
  const ctx = { base: H.viewBase(p), self: p, deps: new Set(), reads: new Set(), prov: false };
  try { return K.ev(subst(ast, al), ctx); } catch (e) { return new H.Err(e.message); }
}
/* the value of a prop, live */
function prop(K, p, name, env, dflt) {
  const q = p + "." + name, c = K.cells.get(q);
  if (!c) { if (K.isBranch(q)) return K.valueAt(q); return dflt; }
  if (c.kind === "hole") return new H.Res({ k: "hole", intent: c.intent });
  if (c.kind === "lit") return c.v;
  if (env.al && env.al.size && refsAlias(c.ast, env.al)) return evalAst(K, c.ast, q, env.al);
  if (c.dirty) K.compute(c);
  return c.v;
}
function refsAlias(ast, al) {
  let hit = false;
  const walk = n => { if (hit || !n) return; if (n.k === "ref") { const head = n.p.split(".")[0]; if (al.has(head)) hit = true; } else if (n.k === "bin") { walk(n.a); walk(n.b); } else if (n.k === "un") walk(n.a); else if (n.k === "call") n.args.forEach(walk); else if (n.k === "list") n.items.forEach(walk); else if (n.k === "obj") n.entries.forEach(e => walk(e[1])); };
  walk(ast); return hit;
}
/* where a name points, the way a formula would read it: by its first segment, from the scope outward */
function refPath(K, name, base) {
  if (name.includes("*")) return null;
  const head = name.split(".")[0];
  let b = base;
  for (;;) { const c = b ? b + "." + head : head; if (K.exists(c)) return b ? b + "." + name : name; if (!b) break; b = H.parentOf(b); }
  return base ? base + "." + name : name;
}
/* a binding: what a prop shows, and where a hand's change goes */
function bind(K, p, name, env) {
  const q = p + "." + name, c = K.cells.get(q);
  if (!c) return { v: undefined, path: null, can: false };
  if (c.kind === "lit") return { v: c.v, path: q, can: true, own: true };
  if (c.kind === "hole") return { v: undefined, path: null, can: false };
  const ast = subst(c.ast, env.al);
  if (ast.k === "ref") {
    const path = refPath(K, ast.p, H.viewBase(q));
    const t = path && K.cells.get(path);
    const v = path && K.exists(path) ? K.valueAt(path) : undefined;
    return { v, path, can: !!path && (!t || t.kind === "lit" || t.kind === "hole"), formula: !!t && t.kind === "formula" };
  }
  const v = env.al && env.al.size ? evalAst(K, c.ast, q, env.al) : (c.dirty && K.compute(c), c.v);
  return { v, path: null, can: false, computed: true };
}
/* the items of a list prop, each with the path it lives at when one can be found */
function itemsOf(K, p, name, env) {
  const b = bind(K, p, name, env);
  let v = b.v;
  if (H.isRes(v) || H.isErr(v)) return { items: [], v, b };
  let entries;
  if (Array.isArray(v)) entries = v.map((x, i) => [String(i), x]);
  else if (v && typeof v === "object") entries = Object.entries(v);
  else entries = [];
  if (b.path && K.exists(b.path)) return { items: entries.map(([k, x]) => ({ value: x, path: b.path + "." + k, key: k })), b };
  // a computed list (a filter, a sort): find each item where it came from, so hands still write through it
  const c = K.cells.get(p + "." + name), reads = c && c.reads ? c.reads : [];
  const pool = [];
  for (const r of reads) { if (!K.isBranch(r)) continue; for (const s of K.children(r)) pool.push(r + "." + s); }
  const taken = new Set();
  const items = entries.map(([k, x], i) => {
    let path = null;
    if (x && typeof x === "object") { const j = JSON.stringify(x); for (const q of pool) { if (taken.has(q)) continue; if (JSON.stringify(K.valueAt(q)) === j) { path = q; taken.add(q); break; } } }
    return { value: x, path, key: path || "v" + i };
  });
  return { items, b };
}
function aliasWith(env, name, it) {
  const al = new Map(env.al || []);
  al.set(name, it.path ? { path: it.path } : { value: it.value });
  return Object.assign({}, env, { al });
}

/* ---------- actions: Hypha lines that run when a hand uses an element ---------- */
function runAction(K, p, env, src, extraAl) {
  src = src != null ? src : (K.cells.get(p + ".do") || {}).v;
  if (!src || typeof src !== "string") return;
  const al = extraAl || env.al || new Map(), base = H.viewBase(p), out = [];
  for (let line of H.splitTop(src, ";")) {
    line = line.trim(); if (!line) continue;
    let m;
    if ((m = /^ask\s+([\s\S]+)$/.exec(line))) { const v = evalAst(K, H.parseExpr(m[1]), p, al); env.ask(appOf(p), String(v), p); continue; }
    if ((m = /^open\s+([A-Za-z_]\w*)$/.exec(line))) { env.open(m[1]); continue; }
    if ((m = /^go\s+(\S+)$/.exec(line))) { env.go && env.go(m[1]); continue; }
    if ((m = /^play\s+([\s\S]+)$/.exec(line))) { const v = evalAst(K, H.parseExpr("[" + m[1] + "]"), p, al); if (Array.isArray(v) && root.CC5Computer) root.CC5Computer.Sound.play(v[0], v[1], v[2]); continue; }
    if ((m = /^toast\s+([\s\S]+)$/.exec(line))) { const v = evalAst(K, H.parseExpr(m[1]), p, al); env.toast(fmt(v)); continue; }
    if ((m = /^speak\s+([\s\S]+)$/.exec(line))) { const v = evalAst(K, H.parseExpr(m[1]), p, al); if (root.CC5Computer) root.CC5Computer.Sound.speak(fmt(v)); continue; }
    if (line.startsWith('"')) { out.push(line); continue; }
    const s = H.parseStmt(line);
    if (!s || s.k === "err") { env.toast(`This button's action does not parse: ${s ? s.msg : "empty"}`); return; }
    if (s.k === "say") { out.push(line); continue; }
    const path = refPathAl(K, s.path, base, al);
    if (!path) { env.toast(`This action writes "${s.path}", which is not a place`); return; }
    if (s.k === "del") { out.push(`${path} -`); continue; }
    if (s.k === "set" || s.k === "append" || s.k === "text") {
      const v = s.ast.k === "hole" ? null : evalAst(K, s.ast, p, al);
      if (s.ast.k === "hole") { out.push(`${path} = ${s.src}`); continue; }
      if (H.isErr(v)) { env.toast(`This action fails: ${v.msg}`); return; }
      if (H.unfinished(v)) { env.toast("This action reads something that is not filled in yet"); return; }
      out.push(`${path} ${s.k === "append" ? "+=" : s.k === "text" ? "&=" : "="} ${H.showLit(v)}`);
      continue;
    }
    out.push(H.canon(Object.assign({}, s, { path })));
  }
  if (out.length) env.write(out.join("\n"));
}
function refPathAl(K, path, base, al) {
  const head = path.split(".")[0], a = al && al.get(head);
  if (a) { if (!a.path) return null; const rest = path.slice(head.length); return a.path + rest; }
  return refPath(K, path, base);
}

/* ---------- small helpers for elements ---------- */
const TONES = { accent: "var(--accent)", muted: "var(--muted)", good: "var(--good)", bad: "var(--bad)", warn: "var(--warn)", you: "var(--you)", ink: "var(--ink)" };
const PALETTE = ["var(--accent)", "var(--p7)", "var(--p2)", "var(--p4)", "var(--p3)", "var(--p5)", "var(--p6)", "var(--ink-2)"];
function color(v) {
  if (v == null || v === "") return undefined;
  const s = String(v);
  if (TONES[s]) return TONES[s];
  if (root.Fruit && root.Fruit.tokens && root.Fruit.tokens.has(s)) return `var(--t-${s.replace(/_/g, "-")})`;
  if (/^p[2-7]$/.test(s)) return `var(--${s})`;
  if (["paper", "card", "line", "ink-2", "raise"].includes(s)) return `var(--${s})`;
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|hsl)a?\(/.test(s) || /^[a-z]+$/i.test(s)) return s;
  return undefined;
}
function fmt(v, opts = {}) {
  if (v === undefined || v === null) return "–";
  if (H.isRes(v)) return "…";
  if (H.isErr(v)) return "!" + v.msg;
  if (typeof v === "number") {
    let s = opts.fixed != null ? v.toFixed(opts.fixed) : Math.abs(v) >= 1000 && Number.isInteger(Math.round(v * 100) / 100) ? Math.round(v).toLocaleString("en-US") : Math.abs(v) >= 10000 ? Math.round(v).toLocaleString("en-US") : H.fmtNum(v);
    if (opts.pct) s = Math.round(v * 100) + "%";
    return (opts.pre || "") + s + (opts.unit ? (/^[%°′″]/.test(opts.unit) ? "" : " ") + opts.unit : "");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return (opts.pre || "") + v + (opts.unit ? " " + opts.unit : "");
  if (Array.isArray(v)) return v.map(x => fmt(x)).join(", ");
  return H.showLit(v);
}
/* an unfinished value shows what it waits for; an error says what is wrong */
function valueNode(v, opts = {}) {
  if (H.isRes(v)) return h("span", { class: "f-residual", title: "waiting for " + H.show(v.ast) }, "… ", h("span", { class: "f-res-src" }, H.show(v.ast)));
  if (H.isErr(v)) return h("span", { class: "f-err" }, v.msg);
  return fmt(v, opts);
}
function styleOf(K, p, env, base = {}) {
  const st = Object.assign({}, base);
  for (const n of propNames(K, p)) {
    switch (n) {
      case "w": { const v = prop(K, p, n, env); if (v != null && kindOf(K, p) !== "draw") { st.width = typeof v === "number" ? v + "px" : String(v); st.flex = "0 0 auto"; } break; }
      case "h": { const v = prop(K, p, n, env); if (v != null && kindOf(K, p) !== "draw") st.height = typeof v === "number" ? v + "px" : String(v); break; }
      case "minw": { const v = prop(K, p, n, env); if (typeof v === "number") st.minWidth = v + "px"; break; }
      case "maxw": { const v = prop(K, p, n, env); if (typeof v === "number") st.maxWidth = v + "px"; break; }
      case "pad": { const v = prop(K, p, n, env); if (typeof v === "number") st.padding = v + "px"; break; }
      case "gap": { const v = prop(K, p, n, env); if (typeof v === "number") st.gap = v + "px"; break; }
      case "grow": { const v = prop(K, p, n, env); if (v) st.flex = typeof v === "number" ? `${v} 1 0` : "1 1 0"; break; }
      case "align": { const v = prop(K, p, n, env); if (v) st.alignItems = { start: "flex-start", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" }[v] || v; break; }
      case "justify": { const v = prop(K, p, n, env); if (v) st.justifyContent = { start: "flex-start", end: "flex-end", center: "center", between: "space-between", around: "space-around", evenly: "space-evenly" }[v] || v; break; }
      case "bg": { const v = color(prop(K, p, n, env)); if (v) { st.background = v; st.borderRadius = st.borderRadius || "8px"; if (!st.padding) st.padding = "10px 12px"; } break; }
      case "color": { const v = color(prop(K, p, n, env)); if (v) st.color = v; break; }
      case "tone": { const v = TONES[prop(K, p, n, env)]; if (v) st["--tone"] = v; break; }
      case "size": { const v = prop(K, p, n, env); if (typeof v === "number") st.fontSize = v + "px"; break; }
      case "bold": { if (prop(K, p, n, env)) st.fontWeight = "700"; break; }
      case "center": { if (prop(K, p, n, env)) st.textAlign = "center"; break; }
      case "radius": { const v = prop(K, p, n, env); if (typeof v === "number") st.borderRadius = v + "px"; break; }
      case "border": { const v = prop(K, p, n, env); if (v) st.border = "1px solid " + (color(v) || "var(--line)"); break; }
      case "opacity": { const v = prop(K, p, n, env); if (typeof v === "number") st.opacity = v; break; }
    }
  }
  return st;
}
function options(v) {
  if (H.isRes(v) || H.isErr(v) || v == null) return [];
  if (typeof v === "string") return v.split("|").map(s => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.map(x => (x && typeof x === "object" ? (x.name != null ? String(x.name) : H.showLit(x)) : String(x)));
  if (typeof v === "object") return Object.keys(v);
  return [String(v)];
}
const label = (K, p, env, fallback) => { const l = prop(K, p, "label", env); return l != null && !H.isRes(l) ? fmt(l) : fallback; };
const uid = p => "f-" + p.replace(/[^\w]/g, "_");
function write(env, path, v, coalesce) { if (!path) return; env.write(`${path} = ${H.showLit(v)}`, { coalesce }); }
function readonlyOf(env, b) { return env.readonly || !b.can; }

/* ---------- the kit ---------- */
const R = {}, DRAW = {};   // DRAW: what a kind means inside a drawing (text is an svg label, line a stroke)
function node(K, p, env) {
  const c = K.cells.get(p);
  if (c) {
    if (c.kind === "hole") return R.hole(K, p, env);
    return h("div", { class: "f-text", "data-node": p }, valueNode(K.valueAt(p)));
  }
  const kind = kindOf(K, p);
  if (prop(K, p, "hide", env)) return null;
  const f = R[env.inDraw ? (DRAW[kind] || kind) : kind] || R[H.ALIAS[kind]];
  let v;
  try { v = f ? f(K, p, env) : K.exists(`lib.${kind}.ui`) ? component(K, p, kind, env) : h("div", { class: "f-unknown" }, `no element or component "${kind}" (the kit is in the README; components live in lib)`); }
  catch (e) { console.error(e); v = h("div", { class: "f-unknown" }, `${kind}: ${e.message}`); }
  // inside a component, a click lands on the instance, not on the definition
  if (v && typeof v === "object" && !Array.isArray(v) && K.exists(p + ".tip")) { const t = prop(K, p, "tip", env); if (t != null && !H.isRes(t)) v.p.title = fmt(t); }
  if (v && typeof v === "object" && !Array.isArray(v)) { const at = env.inComp || p; v.p["data-node"] = at; if (env.sel === at && !env.inComp) v.p.class = (v.p.class || "") + " f-sel"; }
  return v;
}
/* a component: lib.NAME.ui rendered with its inputs bound to what the caller passed. A name passed as a place
   stays a place (inputs inside write back to the caller's data); anything else arrives as a value. */
function takes(K, name) { return K.takesOf(name); }
function component(K, p, name, env) {
  if ((env.compDepth || 0) > 6) return h("div", { class: "f-unknown" }, `${name} holds itself too deeply`);
  const t = takes(K, name), names = propNames(K, p), al = new Map(env.al || []);
  t.forEach((n, i) => {
    const key = names.includes(n) ? n : names.includes("_" + i) ? "_" + i : null;
    if (!key) { al.set(n, { value: null }); return; }
    const b = bind(K, p, key, env);
    if (b.path && !b.own) al.set(n, { path: b.path });
    else al.set(n, { value: prop(K, p, key, env, null) });
  });
  const e = Object.assign({}, env, { al, compDepth: (env.compDepth || 0) + 1, inComp: env.inComp || p, keySuffix: (env.keySuffix || "") + "@" + p });
  const st = styleOf(K, p, env);
  return h("div", { class: "f-comp" + (env.sel === p && !env.inComp ? " f-sel" : ""), style: st, title: env.edit ? `${name}: a component from the library` : null }, kids(K, `lib.${name}.ui`, e));
}
/* render a component on its own, with example values (the library shows these) */
function preview(K, name, values, env) {
  const al = new Map(); for (const n of takes(K, name)) al.set(n, { value: values && n in values ? values[n] : null });
  const e = Object.assign({}, env, { al, compDepth: 1, inComp: "lib." + name, keySuffix: "@preview:" + name, readonly: true });
  return h("div", { class: "f-comp" }, kids(K, `lib.${name}.ui`, e));
}
function kids(K, p, env) {
  const out = kidsOf(K, p).map(q => { const v = node(K, q, env); if (v && typeof v === "object" && !Array.isArray(v) && v.p.key === undefined) v.p.key = q + (env.keySuffix || ""); return v; });
  const g = env.ghosts && env.ghosts.get(p);
  if (g && !env.inDraw) for (const it of g) out.push(h("div", { class: "f-ghost", key: "ghost:" + it.peer, style: { "--c": it.color } }, h("small", null, it.name), it.text));
  return out;
}

/* layout */
const box = cls => (K, p, env) => h("div", { class: cls, style: styleOf(K, p, env) }, kids(K, p, env));
R.col = box("f-col"); R.box = box("f-box"); R.stack = box("f-stack");
const narrow = (env, f, pad = 0) => (env.width ? Object.assign({}, env, { width: Math.max(120, env.width * f - pad) }) : env);
R.row = (K, p, env) => { const n = kidsOf(K, p).length || 1, w = env.width && env.width / n >= 140 ? narrow(env, 1 / n, 12) : env; return h("div", { class: "f-row" + (prop(K, p, "wrap", env) === false ? " nowrap" : ""), style: styleOf(K, p, env) }, kids(K, p, w)); };
R.grid = (K, p, env) => {
  const cols = prop(K, p, "cols", env), st = styleOf(K, p, env);
  st.gridTemplateColumns = typeof cols === "number" ? `repeat(${Math.max(1, Math.min(12, cols))}, minmax(0, 1fr))` : typeof cols === "string" ? cols : "repeat(auto-fill, minmax(140px, 1fr))";
  return h("div", { class: "f-grid", style: st }, kids(K, p, typeof cols === "number" ? narrow(env, 1 / Math.max(1, cols), 10) : env));
};
R.card = (K, p, env) => {
  const t = prop(K, p, "title", env), sub = prop(K, p, "sub", env);
  return h("div", { class: "f-card", style: styleOf(K, p, env) }, t != null ? h("div", { class: "f-card-h" }, h("b", null, valueNode(t)), sub != null ? h("span", null, valueNode(sub)) : null) : null, h("div", { class: "f-col" }, kids(K, p, narrow(env, 1, 30))));
};
R.section = (K, p, env) => {
  const t = prop(K, p, "title", env);
  return h("section", { class: "f-section", style: styleOf(K, p, env) }, t != null ? h("div", { class: "f-eyebrow" }, valueNode(t)) : null, h("div", { class: "f-col" }, kids(K, p, env)));
};
R.split = (K, p, env) => {
  let r = prop(K, p, "ratio", env); r = typeof r === "number" && r > 0 && r < 1 ? r : 0.5;
  const st = styleOf(K, p, env); st.gridTemplateColumns = `minmax(0, ${r}fr) minmax(0, ${1 - r}fr)`;
  return h("div", { class: "f-split", style: st }, kids(K, p, narrow(env, Math.max(r, 1 - r), 14)));
};
R.scroll = (K, p, env) => { const v = prop(K, p, "h", env), st = styleOf(K, p, env); st.maxHeight = (typeof v === "number" ? v : 240) + "px"; delete st.height; return h("div", { class: "f-scroll", style: st }, kids(K, p, env)); };
R.spacer = () => h("div", { class: "f-spacer" });
R.divider = () => h("hr", { class: "f-divider" });
R.tab = box("f-col");
R.tabs = (K, p, env) => {
  const tabs = kidsOf(K, p), b = bind(K, p, "of", env);
  const names = tabs.map((q, i) => { const t = prop(K, q, "title", env); return t != null && !H.isRes(t) ? fmt(t) : "Tab " + (i + 1); });
  let cur = b.path ? names.indexOf(String(b.v)) : env.local.get(p);
  if (cur == null || cur < 0) cur = 0;
  const pick = i => { if (b.path && b.can) write(env, b.path, names[i]); else { env.local.set(p, i); env.rerender(); } };
  return h("div", { class: "f-tabs", style: styleOf(K, p, env) },
    h("div", { class: "f-tabbar", role: "tablist" }, names.map((n, i) => h("button", { type: "button", role: "tab", "aria-selected": i === cur ? "true" : "false", key: "t" + i, on: { click: () => pick(i) } }, n))),
    tabs[cur] ? node(K, tabs[cur], env) : null);
};
R.when = (K, p, env) => {
  const c = prop(K, p, "if", env);
  if (H.isRes(c)) return h("div", { class: "f-residual" }, "… waiting for ", H.show(c.ast));
  return c ? h("div", { class: "f-col", style: styleOf(K, p, env) }, kids(K, p, env)) : h("div", { class: "f-when-off", hidden: !env.edit }, "when: off");
};
R.each = (K, p, env) => {
  const name = String(prop(K, p, "as", env) || "it"), { items, v } = itemsOf(K, p, "of", env);
  if (H.isRes(v)) return h(env.inDraw ? "g" : "div", { class: "f-residual" }, env.inDraw ? null : "… waiting for " + H.show(v.ast));
  const out = [];
  const limit = typeof prop(K, p, "limit", env) === "number" ? prop(K, p, "limit", env) : 200;
  items.slice(0, limit).forEach((it, i) => {
    const e = aliasWith(env, name, it); e.al.set(name + "_n", { value: i }); e.keySuffix = (env.keySuffix || "") + "#" + it.key;
    for (const q of kidsOf(K, p)) { const v = node(K, q, e); if (v && typeof v === "object" && !Array.isArray(v)) { v.p.key = q + e.keySuffix; out.push(v); } }
  });
  if (env.inDraw) return h("g", null, out);
  const st = styleOf(K, p, env);
  const dir = prop(K, p, "dir", env);
  return h("div", { class: dir === "row" ? "f-row" : dir === "grid" ? "f-grid" : "f-col", style: dir === "grid" ? Object.assign({ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }, st) : st },
    out.length ? out : h("div", { class: "f-empty" }, fmt(prop(K, p, "empty", env) || "Nothing here yet")));
};
R.embed = (K, p, env) => {
  const b = bind(K, p, "of", env), app = b.path && appOf(b.path);
  if (!app || !K.exists(app)) return h("div", { class: "f-unknown" }, "embed needs an app's name");
  if ((env.depth || 0) > 2 || app === env.app) return h("div", { class: "f-unknown" }, "an app cannot hold itself");
  const e = Object.assign({}, env, { app, depth: (env.depth || 0) + 1, al: new Map() });
  return h("div", { class: "f-embed", style: styleOf(K, p, env) }, h("div", { class: "f-eyebrow" }, env.titleOf ? env.titleOf(app) : app), K.exists(app + ".ui") ? node(K, app + ".ui", e) : R.cells(K, p, e, app));
};

/* text */
const textEl = (tag, cls) => (K, p, env) => h(tag, { class: cls, style: styleOf(K, p, env) }, valueNode(prop(K, p, "text", env), { unit: prop(K, p, "unit", env), pre: prop(K, p, "pre", env) }));
R.h1 = textEl("h1", "f-h1"); R.h2 = textEl("h2", "f-h2"); R.h3 = textEl("h3", "f-h3");
R.text = textEl("p", "f-p"); R.code = textEl("pre", "f-code"); R.quote = textEl("blockquote", "f-quote"); R.kbd = textEl("kbd", "f-kbd");
R.badge = (K, p, env) => { const st = styleOf(K, p, env); const t = TONES[prop(K, p, "tone", env)]; if (t) st["--tone"] = t; return h("span", { class: "f-badge", style: st }, valueNode(prop(K, p, "text", env))); };
R.note = (K, p, env) => { const st = styleOf(K, p, env); const t = TONES[prop(K, p, "tone", env)] || "var(--accent)"; st["--tone"] = t; return h("div", { class: "f-note", style: st }, prop(K, p, "title", env) != null ? h("b", null, valueNode(prop(K, p, "title", env))) : null, h("div", null, valueNode(prop(K, p, "text", env)))); };
R.md = (K, p, env) => { const v = prop(K, p, "text", env); return h("div", { class: "f-md", style: styleOf(K, p, env) }, H.isRes(v) || H.isErr(v) ? valueNode(v) : md(String(v == null ? "" : v))); };
function inline(s) {
  const out = []; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g; let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(h("b", null, t.slice(2, -2)));
    else if (t.startsWith("`")) out.push(h("code", null, t.slice(1, -1)));
    else if (t.startsWith("[")) { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t); out.push(h("a", { href: mm[2], target: "_blank", rel: "noopener" }, mm[1])); }
    else out.push(h("em", null, t.slice(1, -1)));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function md(src) {
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(h("p", null, inline(para.join(" ")))); para = []; } };
  const flushL = () => { if (list) { out.push(h(list.ordered ? "ol" : "ul", null, list.items)); list = null; } };
  for (const raw of src.split("\n")) {
    const l = raw.trim(); let m;
    if (!l) { flushP(); flushL(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flushP(); flushL(); out.push(h("h" + (m[1].length + 2), null, inline(m[2]))); continue; }
    if ((m = /^[-*]\s+\[( |x)\]\s+(.*)$/i.exec(l))) { flushP(); if (!list || list.ordered) { flushL(); list = { items: [] }; } list.items.push(h("li", { class: "task" + (m[1] !== " " ? " done" : "") }, inline(m[2]))); continue; }
    if ((m = /^[-*•]\s+(.*)$/.exec(l))) { flushP(); if (!list || list.ordered) { flushL(); list = { items: [] }; } list.items.push(h("li", null, inline(m[1]))); continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { flushP(); if (!list || !list.ordered) { flushL(); list = { ordered: true, items: [] }; } list.items.push(h("li", null, inline(m[1]))); continue; }
    if ((m = /^>\s?(.*)$/.exec(l))) { flushP(); flushL(); out.push(h("blockquote", null, inline(m[1]))); continue; }
    flushL(); para.push(l);
  }
  flushP(); flushL();
  return out;
}
R.stat = (K, p, env) => {
  const v = prop(K, p, "of", env), st = styleOf(K, p, env), sub = prop(K, p, "sub", env);
  const o = { unit: prop(K, p, "unit", env), pre: prop(K, p, "pre", env), pct: prop(K, p, "pct", env), fixed: prop(K, p, "fixed", env) };
  return h("div", { class: "f-stat", style: st },
    h("div", { class: "f-stat-v" }, valueNode(v, o)),
    h("div", { class: "f-stat-l" }, label(K, p, env, "")), sub != null ? h("div", { class: "f-stat-s" }, valueNode(sub)) : null);
};
R.progress = (K, p, env) => {
  const v = prop(K, p, "of", env); let max = prop(K, p, "max", env);
  if (typeof max !== "number") max = typeof v === "number" && v <= 1 ? 1 : 100;
  const f = typeof v === "number" ? Math.max(0, Math.min(1, v / (max || 1))) : 0;
  const st = styleOf(K, p, env); const t = TONES[prop(K, p, "tone", env)]; if (t) st["--tone"] = t;
  return h("div", { class: "f-progress", style: st }, h("div", { class: "f-progress-l" }, h("span", null, label(K, p, env, "")), h("span", { class: "f-num" }, typeof v === "number" ? Math.round(f * 100) + "%" : valueNode(v))),
    h("div", { class: "f-progress-bar", role: "progressbar", "aria-valuenow": Math.round(f * 100), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: { width: (f * 100).toFixed(1) + "%" } })));
};
R.gauge = (K, p, env) => {
  const v = prop(K, p, "of", env); let max = prop(K, p, "max", env); if (typeof max !== "number") max = typeof v === "number" && v <= 1 ? 1 : 100;
  const f = typeof v === "number" ? Math.max(0, Math.min(1, v / (max || 1))) : 0, a = Math.PI * (1 - f);
  const x = 60 + 46 * Math.cos(a), y = 58 - 46 * Math.sin(a);
  return h("div", { class: "f-gauge", style: styleOf(K, p, env) }, h("svg", { viewBox: "0 0 120 70", role: "img", "aria-label": label(K, p, env, "gauge") + " " + Math.round(f * 100) + "%" },
    h("path", { d: "M14 58 A46 46 0 0 1 106 58", fill: "none", stroke: "var(--line)", "stroke-width": "9", "stroke-linecap": "round" }),
    f > 0.001 ? h("path", { d: `M14 58 A46 46 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`, fill: "none", stroke: TONES[prop(K, p, "tone", env)] || "var(--accent)", "stroke-width": "9", "stroke-linecap": "round" }) : null,
    h("text", { x: "60", y: "56", "text-anchor": "middle", class: "f-gauge-v" }, typeof v === "number" ? fmt(v, { unit: prop(K, p, "unit", env) }) : "…")),
    h("div", { class: "f-stat-l" }, label(K, p, env, "")));
};

root.Fruit = { h, mount, R, DRAW, component, preview, node, kids, prop, bind, itemsOf, aliasWith, runAction, kindOf, kidsOf, propNames, styleOf, valueNode, fmt, color, options, label, uid, write, readonlyOf, evalAst, refPath, subst, TONES, PALETTE, md, appOf };
})(typeof window !== "undefined" ? window : globalThis);
