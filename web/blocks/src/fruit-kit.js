/* FRUIT · the rest of the kit: inputs, lists, boards, charts, drawings, holes and the cells projection.
   Every input binds a prop to a path (slider days): it shows what is there and writes back through it,
   as the person, one op per change. A binding to a formula only shows it: hands do not overwrite logic. */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit;
const { h, R, DRAW, prop, bind, itemsOf, aliasWith, runAction, kindOf, kidsOf, styleOf, valueNode, fmt, color, options, label, uid, write, readonlyOf, TONES, PALETTE } = F;

const idOf = (p, env, s = "") => uid(p + (env.keySuffix || "") + s);
const fieldLabel = (K, p, env, b) => label(K, p, env, b.path && !(prop(K, p, "placeholder", env) != null && ["field", "area"].includes(kindOf(K, p))) ? b.path.split(".").pop().replace(/_/g, " ") : "");
const roNote = b => (b.formula ? "Computed by a formula: change its inputs instead" : b.computed ? "Computed here, so it only shows" : "");
function wrapField(K, p, env, b, control, extra) {
  const l = fieldLabel(K, p, env, b);
  return h("div", { class: "f-field", style: styleOf(K, p, env), title: roNote(b) || undefined },
    l ? h("label", { for: idOf(p, env), class: "f-label" }, l, b.formula ? h("i", { class: "f-fx", title: roNote(b) }, "ƒ") : null) : null, control, extra || null);
}
function niceStep(min, max) { const r = Math.abs(max - min); if (!r) return 1; const raw = r / 100, pow = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / pow; const s = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow; return Number.isInteger(min) && Number.isInteger(max) && r >= 20 ? Math.max(1, Math.round(s)) : s; }
function numberish(s) { const t = String(s).trim().replace(/,/g, ""); return /^-?\d*\.?\d+(e[+-]?\d+)?%?$/i.test(t) ? (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t)) : null; }

/* ---------- inputs ---------- */
R.slider = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), ty = b.path && K.types.get(b.path), ta = ty && ty.name === "range" ? ty.args : [];
  const v0 = typeof b.v === "number" ? b.v : 0;
  let min = prop(K, p, "min", env), max = prop(K, p, "max", env), step = prop(K, p, "step", env);
  if (typeof min !== "number") min = typeof ta[0] === "number" ? ta[0] : Math.min(0, v0);
  if (typeof max !== "number") max = typeof ta[1] === "number" ? ta[1] : Math.max(10, Math.ceil(Math.abs(v0) * 2));
  if (typeof step !== "number") step = typeof ta[2] === "number" ? ta[2] : niceStep(min, max);
  const o = { unit: prop(K, p, "unit", env), pre: prop(K, p, "pre", env), pct: prop(K, p, "pct", env) };
  return h("div", { class: "f-field f-slider", style: styleOf(K, p, env) },
    h("div", { class: "f-label-row" }, h("label", { for: idOf(p, env), class: "f-label" }, fieldLabel(K, p, env, b)), h("output", { class: "f-num", for: idOf(p, env) }, valueNode(b.v, o))),
    h("input", { type: "range", id: idOf(p, env), min, max, step, value: v0, disabled: ro, style: { "--f": ((v0 - min) / ((max - min) || 1) * 100).toFixed(1) + "%" },
      on: { input: e => write(env, b.path, Number(e.target.value), true) } }));
};
R.num = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), v = typeof b.v === "number" ? b.v : 0;
  let step = prop(K, p, "step", env); if (typeof step !== "number") step = Number.isInteger(v) ? Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1)) - 1)) : Math.abs(v) < 1 ? 0.01 : 0.1;
  const scrub = e => {
    if (ro || e.button !== 0) return;
    const el = e.currentTarget, x0 = e.clientX, start = v; let moved = false; el.setPointerCapture(e.pointerId);
    const mv = ev => { const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (moved) write(env, b.path, Number((start + Math.round(dx / 4) * step).toFixed(6)), true); };
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  return wrapField(K, p, env, b, h("div", { class: "f-num-wrap" },
    h("span", { class: "f-scrub", title: ro ? roNote(b) : "Drag sideways", "aria-hidden": "true", on: { pointerdown: scrub } }, "⟷"),
    h("input", { id: idOf(p, env), class: "f-input f-num", inputmode: "decimal", value: H.isRes(b.v) ? "…" : fmt(b.v), disabled: ro,
      on: { change: e => { const n = numberish(e.target.value); if (n != null) write(env, b.path, n); else e.target.value = fmt(b.v); }, keydown: e => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); write(env, b.path, Number((v + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(6)), true); } } } }),
    prop(K, p, "unit", env) ? h("span", { class: "f-unit" }, fmt(prop(K, p, "unit", env))) : null));
};
const textInput = multi => (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), isNumber = typeof b.v === "number";
  const ph = prop(K, p, "placeholder", env), attrs = { id: idOf(p, env), class: "f-input", value: b.v == null || H.isRes(b.v) ? "" : String(b.v), disabled: ro, placeholder: ph != null ? fmt(ph) : "" };
  const commit = e => { const t = e.target.value; if (isNumber) { const n = numberish(t); write(env, b.path, n != null ? n : t); } else write(env, b.path, t, true); };
  attrs.on = { input: isNumber ? null : commit, change: isNumber ? commit : null, keydown: e => { if (!multi && e.key === "Enter" && p && (K.cells.get(p + ".do") || {}).v) { e.preventDefault(); runAction(K, p, env); } } };
  if (multi) attrs.rows = prop(K, p, "rows", env) || 4;
  return wrapField(K, p, env, b, h(multi ? "textarea" : "input", attrs));
};
R.field = textInput(false); R.area = textInput(true);
R.toggle = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), on = !!b.v && !H.isRes(b.v);
  return h("div", { class: "f-check", style: styleOf(K, p, env) },
    h("button", { type: "button", class: "f-switch", role: "switch", id: idOf(p, env), "aria-checked": on ? "true" : "false", disabled: ro, on: { click: () => write(env, b.path, !on) } }),
    h("label", { for: idOf(p, env) }, fieldLabel(K, p, env, b)));
};
R.check = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b);
  return h("label", { class: "f-check", style: styleOf(K, p, env) }, h("input", { type: "checkbox", id: idOf(p, env), checked: !!b.v && !H.isRes(b.v), disabled: ro, on: { change: e => write(env, b.path, e.target.checked) } }), h("span", null, fieldLabel(K, p, env, b)));
};
const cast = (opt, like) => (typeof like === "number" && numberish(opt) != null ? numberish(opt) : opt);
R.choice = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), opts = options(prop(K, p, "options", env));
  return wrapField(K, p, env, b, h("div", { class: "f-seg", role: "radiogroup", id: idOf(p, env) }, opts.map(o => h("button", { type: "button", key: o, role: "radio", "aria-checked": String(b.v) === o ? "true" : "false", disabled: ro, on: { click: () => write(env, b.path, cast(o, b.v)) } }, o))));
};
R.select = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), opts = options(prop(K, p, "options", env));
  const has = opts.includes(String(b.v));
  return wrapField(K, p, env, b, h("select", { id: idOf(p, env), class: "f-input", disabled: ro, value: has ? String(b.v) : "", on: { change: e => write(env, b.path, cast(e.target.value, b.v)) } },
    has ? null : h("option", { value: "" }, "Choose…"), opts.map(o => h("option", { value: o, key: o, selected: String(b.v) === o }, o))));
};
R.date = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b);
  return wrapField(K, p, env, b, h("input", { type: "date", id: idOf(p, env), class: "f-input", value: typeof b.v === "string" ? b.v.slice(0, 10) : "", disabled: ro, on: { change: e => write(env, b.path, e.target.value) } }));
};
R.stars = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), max = prop(K, p, "max", env) || 5, v = typeof b.v === "number" ? b.v : 0;
  return wrapField(K, p, env, b, h("div", { class: "f-stars", role: "radiogroup", id: idOf(p, env) }, Array.from({ length: max }, (_, i) => h("button", { type: "button", key: "s" + i, role: "radio", "aria-checked": v === i + 1 ? "true" : "false", "aria-label": `${i + 1} of ${max}`, class: i < v ? "on" : "", disabled: ro, on: { click: () => write(env, b.path, v === i + 1 ? 0 : i + 1) } }, "★"))));
};
R.color = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = readonlyOf(env, b), cur = typeof b.v === "string" ? b.v : "";
  const sw = options(prop(K, p, "options", env)); const list = sw.length ? sw : ["#E0400F", "#D9A84A", "#2F7A4E", "#3F8F8A", "#2650A8", "#7E6BB0", "#B5636E", "#191919", "#7C7C7C", "#FAFAFA"];
  return wrapField(K, p, env, b, h("div", { class: "f-swatches", id: idOf(p, env) },
    list.map(c => h("button", { type: "button", key: c, class: "f-swatch" + (c.toLowerCase() === cur.toLowerCase() ? " on" : ""), style: { background: color(c) || c }, "aria-label": c, disabled: ro, on: { click: () => write(env, b.path, c) } })),
    h("input", { type: "color", class: "f-colorin", "aria-label": "Any colour", value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : "#E0400F", disabled: ro, on: { change: e => write(env, b.path, e.target.value) } }),
    h("code", { class: "f-hex" }, cur || "–")));
};
R.button = (K, p, env) => {
  const has = !!(K.cells.get(p + ".do") || {}).v, tone = prop(K, p, "tone", env), st = styleOf(K, p, env);
  return h("button", { type: "button", class: "f-btn" + (tone === "ghost" ? " ghost" : tone ? " toned" : " primary"), style: st, disabled: env.readonly || !has, title: has ? "" : "This button has no action yet (button \"…\" -> …)", on: { click: e => { e.stopPropagation(); runAction(K, p, env); } } }, valueNode(prop(K, p, "label", env) != null ? prop(K, p, "label", env) : "Button"));
};
R.ask = (K, p, env) => {
  const id = idOf(p, env), l = prop(K, p, "label", env);
  const send = () => { const ta = document.getElementById(id); if (!ta || !ta.value.trim()) return; env.ask(F.appOf(p), ta.value.trim(), p); ta.value = ""; };
  return h("div", { class: "f-ask", style: styleOf(K, p, env) },
    h("textarea", { id, rows: 2, class: "f-input", placeholder: l != null ? fmt(l) : "Ask Claude to change this app", disabled: env.readonly, on: { keydown: e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } } }),
    h("button", { type: "button", class: "f-btn primary", disabled: env.readonly, on: { click: send } }, "Ask"));
};

/* ---------- lists of records ---------- */
function colsFor(items, given) {
  if (given.length) return given;
  const out = [];
  for (const it of items.slice(0, 50)) { const v = it.value; if (v && typeof v === "object" && !Array.isArray(v)) { for (const k of Object.keys(v)) if (!out.includes(k)) out.push(k); } }
  return out.length ? out.slice(0, 8) : ["value"];
}
const cellOf = (it, col) => (col === "value" && (it.value == null || typeof it.value !== "object") ? it.value : it.value && typeof it.value === "object" ? it.value[col] : undefined);
const firstText = v => (v && typeof v === "object" ? (["text", "title", "name", "what", "label", "item"].map(k => v[k]).find(x => typeof x === "string") || Object.values(v).find(x => typeof x === "string") || H.showLit(v)) : fmt(v));
function addRowText(cols, items) {
  const parts = cols.map(c => { const s = items.map(it => cellOf(it, c)).find(x => x != null); return `${/^[A-Za-z_]\w*$/.test(c) ? c : JSON.stringify(c)}: ${typeof s === "number" ? 0 : typeof s === "boolean" ? "false" : '""'}`; });
  return `{${parts.join(", ")}}`;
}
function itemAction(K, p, env, it) {
  if (!(K.cells.get(p + ".do") || {}).v) return null;
  return () => runAction(K, p, aliasWith(env, "it", it), null, aliasWith(env, "it", it).al);
}
R.table = (K, p, env) => {
  const { items, v, b } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", { class: "f-table-wrap" }, valueNode(v));
  const cols = colsFor(items, options(prop(K, p, "cols", env)));
  const nums = cols.map(c => items.length > 0 && items.every(it => { const x = cellOf(it, c); return x == null || typeof x === "number"; }) && items.some(it => typeof cellOf(it, c) === "number"));
  const sort = env.local.get(p + "#sort");
  let rows = items.slice();
  if (sort) rows.sort((a, b2) => { const x = cellOf(a, sort.c), y = cellOf(b2, sort.c); return (typeof x === "number" && typeof y === "number" ? x - y : String(x == null ? "" : x).localeCompare(String(y == null ? "" : y))) * sort.d; });
  const per = prop(K, p, "page", env), pk = p + (env.keySuffix || "") + "#page", pages = typeof per === "number" && per > 0 ? Math.max(1, Math.ceil(rows.length / per)) : 1, pg = Math.min(pages - 1, env.local.get(pk) || 0);
  if (pages > 1) rows = rows.slice(pg * per, pg * per + per);
  const canEdit = it => !env.readonly && !!it.path && prop(K, p, "edit", env) !== false;
  const act = it => itemAction(K, p, env, it);
  const head = h("tr", null, cols.map((c, i) => h("th", { key: c, class: nums[i] ? "n" : "", "aria-sort": sort && sort.c === c ? (sort.d > 0 ? "ascending" : "descending") : null },
    h("button", { type: "button", on: { click: () => { env.local.set(p + "#sort", sort && sort.c === c ? (sort.d > 0 ? { c, d: -1 } : null) : { c, d: 1 }); env.rerender(); } } }, c.replace(/_/g, " "), sort && sort.c === c ? (sort.d > 0 ? " ↑" : " ↓") : ""))),
    items.some(canEdit) ? h("th", { class: "x", "aria-label": "Remove" }) : null);
  const body = rows.map(it => h("tr", { key: it.key, class: act(it) ? "clickable" : "", on: act(it) ? { click: e => { if (!e.target.closest("input,button")) act(it)(); } } : null },
    cols.map((c, i) => {
      const x = cellOf(it, c), path = it.path && (c === "value" && typeof it.value !== "object" ? it.path : it.path + "." + c);
      if (!canEdit(it) || (x != null && typeof x === "object")) return h("td", { key: c, class: nums[i] ? "n" : "" }, valueNode(x));
      return h("td", { key: c, class: nums[i] ? "n" : "" }, h("input", { class: "f-cell-in" + (nums[i] ? " n" : ""), "aria-label": c, value: x == null ? "" : typeof x === "number" ? H.fmtNum(x) : String(x), size: Math.max(nums[i] ? 3 : 6, Math.min(30, String(x == null ? "" : x).length + 1)),
        on: { change: e => { const t = e.target.value; write(env, path, nums[i] || typeof x === "number" ? (numberish(t) != null ? numberish(t) : t) : typeof x === "boolean" ? t === "true" : t); }, keydown: e => { if (e.key === "Enter") e.target.blur(); } } }));
    }),
    items.some(canEdit) ? h("td", { class: "x" }, canEdit(it) ? h("button", { type: "button", class: "f-x", "aria-label": "Remove row", on: { click: () => env.write(`${it.path} -`) } }, "×") : null) : null));
  const foot = prop(K, p, "total", env) ? h("tr", { class: "total" }, cols.map((c, i) => h("td", { key: c, class: nums[i] ? "n" : "" }, nums[i] ? H.fmtNum(items.reduce((a, it) => a + (cellOf(it, c) || 0), 0)) : i === 0 ? "Total" : "")), items.some(canEdit) ? h("td") : null) : null;
  const canAdd = !env.readonly && b.path && b.can && prop(K, p, "add", env) !== false;
  return h("div", { class: "f-table-wrap", style: styleOf(K, p, env) },
    h("table", { class: "f-table" }, h("thead", null, head), h("tbody", null, body.length ? body : h("tr", null, h("td", { colspan: cols.length + 1, class: "f-empty" }, "No rows yet"))), foot ? h("tfoot", null, foot) : null),
    pages > 1 ? h("div", { class: "f-pager" }, h("button", { type: "button", class: "f-btn ghost", disabled: pg === 0, "aria-label": "Previous page", on: { click: () => { env.local.set(pk, pg - 1); env.rerender(); } } }, "‹"), h("span", null, `${pg + 1} of ${pages}`), h("button", { type: "button", class: "f-btn ghost", disabled: pg >= pages - 1, "aria-label": "Next page", on: { click: () => { env.local.set(pk, pg + 1); env.rerender(); } } }, "›")) : null,
    canAdd ? h("button", { type: "button", class: "f-btn ghost f-add", on: { click: () => env.write(`${b.path} += ${addRowText(cols, items)}`) } }, "+ Add row") : null);
};
R.list = (K, p, env) => {
  const { items, v, b } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", null, valueNode(v));
  const tf = prop(K, p, "text", env), sub = prop(K, p, "sub", env);
  const id = idOf(p, env, "add"), canAdd = !env.readonly && b.path && b.can && prop(K, p, "add", env) !== false;
  const recs = items.some(it => it.value && typeof it.value === "object");
  const add = () => { const el = document.getElementById(id); if (!el || !el.value.trim()) return; env.write(`${b.path} += ${recs ? `{${typeof tf === "string" ? tf : "text"}: ${JSON.stringify(el.value.trim())}}` : JSON.stringify(el.value.trim())}`); el.value = ""; };
  return h("div", { class: "f-list", style: styleOf(K, p, env) },
    h("ul", null, items.map(it => { const a = itemAction(K, p, env, it); return h("li", { key: it.key, class: a ? "clickable" : "", on: a ? { click: e => { if (!e.target.closest("button")) a(); } } : null },
      h("span", { class: "t" }, typeof tf === "string" && it.value && typeof it.value === "object" ? fmt(it.value[tf]) : firstText(it.value)),
      typeof sub === "string" && it.value && typeof it.value === "object" && it.value[sub] != null ? h("span", { class: "s" }, fmt(it.value[sub])) : null,
      !env.readonly && it.path && b.can ? h("button", { type: "button", class: "f-x", "aria-label": "Remove", on: { click: () => env.write(`${it.path} -`) } }, "×") : null); })),
    !items.length ? h("div", { class: "f-empty" }, fmt(prop(K, p, "empty", env) || "Nothing yet")) : null,
    canAdd ? h("div", { class: "f-addrow" }, h("input", { id, class: "f-input", placeholder: fmt(prop(K, p, "placeholder", env) || "Add…"), on: { keydown: e => { if (e.key === "Enter") add(); } } }), h("button", { type: "button", class: "f-btn ghost", on: { click: add } }, "Add")) : null);
};
R.checklist = (K, p, env) => {
  const { items, v, b } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", null, valueNode(v));
  const tf = prop(K, p, "text", env) || "text", df = prop(K, p, "done", env) || "done";
  const id = idOf(p, env, "add"), canAdd = !env.readonly && b.path && b.can && prop(K, p, "add", env) !== false;
  const add = () => { const el = document.getElementById(id); if (!el || !el.value.trim()) return; env.write(`${b.path} += {${tf}: ${JSON.stringify(el.value.trim())}, ${df}: false}`); el.value = ""; };
  const done = items.filter(it => it.value && it.value[df]).length;
  return h("div", { class: "f-checklist", style: styleOf(K, p, env) },
    h("ul", null, items.map(it => {
      const val = it.value || {}, can = !env.readonly && !!it.path;
      return h("li", { key: it.key, class: val[df] ? "done" : "" },
        h("input", { type: "checkbox", "aria-label": fmt(val[tf]), checked: !!val[df], disabled: !can, on: { change: e => write(env, it.path + "." + df, e.target.checked) } }),
        can ? h("input", { class: "f-cell-in", value: val[tf] == null ? "" : String(val[tf]), "aria-label": "Item", on: { change: e => write(env, it.path + "." + tf, e.target.value), keydown: e => { if (e.key === "Enter") e.target.blur(); } } }) : h("span", { class: "t" }, fmt(val[tf])),
        can ? h("button", { type: "button", class: "f-x", "aria-label": "Remove", on: { click: () => env.write(`${it.path} -`) } }, "×") : null);
    })),
    canAdd ? h("div", { class: "f-addrow" }, h("input", { id, class: "f-input", placeholder: fmt(prop(K, p, "placeholder", env) || "Add an item"), on: { keydown: e => { if (e.key === "Enter") add(); } } }), h("button", { type: "button", class: "f-btn ghost", on: { click: add } }, "Add")) : null,
    items.length ? h("div", { class: "f-foot" }, `${done} of ${items.length} done`) : null);
};
R.board = (K, p, env) => {
  const { items, v, b } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", null, valueNode(v));
  const by = prop(K, p, "by", env) || "status", tf = prop(K, p, "title", env), meta = prop(K, p, "meta", env);
  let cols = options(prop(K, p, "cols", env));
  if (!cols.length) cols = [...new Set(items.map(it => String((it.value || {})[by] || "todo")))];
  const move = (it, c) => { if (it.path) write(env, it.path + "." + by, c); };
  const titleOf = val => (typeof tf === "string" ? fmt(val[tf]) : firstText(val));
  const canAdd = !env.readonly && b.path && b.can;
  return h("div", { class: "f-board", style: Object.assign({ gridTemplateColumns: `repeat(${cols.length}, minmax(112px, 1fr))` }, styleOf(K, p, env)) }, cols.map((c, ci) => {
    const here = items.filter(it => String((it.value || {})[by]) === c || (ci === 0 && !cols.includes(String((it.value || {})[by]))));
    const id = idOf(p, env, "add" + ci);
    const add = () => { const el = document.getElementById(id); if (!el || !el.value.trim()) return; env.write(`${b.path} += {${typeof tf === "string" ? tf : "text"}: ${JSON.stringify(el.value.trim())}, ${by}: ${JSON.stringify(c)}}`); el.value = ""; };
    return h("div", { class: "f-board-col", key: c, "data-col": c,
      on: { dragover: e => { if (e.dataTransfer.types.includes("text/x-fruit")) { e.preventDefault(); e.currentTarget.classList.add("over"); } }, dragleave: e => e.currentTarget.classList.remove("over"),
        drop: e => { e.preventDefault(); e.currentTarget.classList.remove("over"); const path = e.dataTransfer.getData("text/x-fruit"); const it = items.find(x => x.path === path); if (it) move(it, c); } } },
      h("div", { class: "f-board-h" }, h("b", null, c), h("span", null, String(here.length))),
      here.map(it => { const val = it.value || {}, can = !env.readonly && !!it.path;
        return h("div", { class: "f-board-card", key: it.key, draggable: can ? "true" : null, on: can ? { dragstart: e => { e.dataTransfer.setData("text/x-fruit", it.path); e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); } } : null },
          h("div", { class: "t" }, titleOf(val)), typeof meta === "string" && val[meta] != null ? h("div", { class: "m" }, fmt(val[meta])) : null,
          can ? h("div", { class: "f-board-move" },
            ci > 0 ? h("button", { type: "button", "aria-label": "Move to " + cols[ci - 1], on: { click: () => move(it, cols[ci - 1]) } }, "‹") : null,
            ci < cols.length - 1 ? h("button", { type: "button", "aria-label": "Move to " + cols[ci + 1], on: { click: () => move(it, cols[ci + 1]) } }, "›") : null,
            h("button", { type: "button", "aria-label": "Remove", on: { click: () => env.write(`${it.path} -`) } }, "×")) : null); }),
      canAdd ? h("input", { id, class: "f-input f-board-add", placeholder: "+ Add", on: { keydown: e => { if (e.key === "Enter") add(); } } }) : null);
  }));
};
R.cards = (K, p, env) => {
  const { items, v } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", null, valueNode(v));
  const tf = prop(K, p, "title", env), bf = prop(K, p, "body", env), mf = prop(K, p, "meta", env), cf = prop(K, p, "tint", env);
  const st = styleOf(K, p, env); const min = prop(K, p, "min", env); st.gridTemplateColumns = `repeat(auto-fill, minmax(${typeof min === "number" ? min : 160}px, 1fr))`;
  return h("div", { class: "f-cards", style: st }, items.map(it => {
    const val = it.value && typeof it.value === "object" ? it.value : { title: it.value }, a = itemAction(K, p, env, it);
    return h(a ? "button" : "div", { type: a ? "button" : null, class: "f-cardlet" + (a ? " clickable" : ""), key: it.key, style: typeof cf === "string" && color(val[cf]) ? { "--tint": color(val[cf]) } : null, on: a ? { click: a } : null },
      h("b", null, typeof tf === "string" ? fmt(val[tf]) : firstText(val)),
      typeof bf === "string" && val[bf] != null ? h("p", null, fmt(val[bf])) : null,
      typeof mf === "string" && val[mf] != null ? h("span", { class: "m" }, fmt(val[mf])) : null);
  }), !items.length ? h("div", { class: "f-empty" }, "Nothing yet") : null);
};
R.timeline = (K, p, env) => {
  const { items, v } = itemsOf(K, p, "of", env);
  if (H.isRes(v) || H.isErr(v)) return h("div", null, valueNode(v));
  const af = prop(K, p, "at", env) || "at", lf = prop(K, p, "label", env), df = prop(K, p, "done", env);
  return h("ol", { class: "f-timeline", style: styleOf(K, p, env) }, items.map(it => {
    const val = it.value && typeof it.value === "object" ? it.value : { label: it.value };
    const isDone = typeof df === "string" && !!val[df];
    return h("li", { key: it.key, class: isDone ? "done" : "" }, h("span", { class: "at" }, fmt(val[af])), h("span", { class: "dot" }), h("span", { class: "l" }, typeof lf === "string" ? fmt(val[lf]) : firstText(Object.fromEntries(Object.entries(val).filter(([k]) => k !== af)))));
  }));
};
R.calendar = (K, p, env) => {
  const { items } = itemsOf(K, p, "of", env);
  const df = prop(K, p, "date", env) || "date", lf = prop(K, p, "label", env);
  const dates = items.map(it => ({ d: String((it.value || {})[df] || ""), it })).filter(x => /^\d{4}-\d{2}-\d{2}/.test(x.d));
  let month = env.local.get(p + "#m") || prop(K, p, "month", env) || (dates[0] ? dates[0].d.slice(0, 7) : H.FN.today().slice(0, 7));
  const [y, m] = String(month).split("-").map(Number), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); env.local.set(p + "#m", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); env.rerender(); };
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("div", { class: "f-cal-d off", key: "o" + i }));
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, ev = dates.filter(x => x.d.startsWith(key));
    cells.push(h("div", { class: "f-cal-d" + (key === H.FN.today() ? " today" : "") + (ev.length ? " has" : ""), key }, h("span", { class: "n" }, String(d)), ev.slice(0, 3).map((x, i) => h("span", { class: "e", key: "e" + i }, typeof lf === "string" ? fmt(x.it.value[lf]) : firstText(Object.fromEntries(Object.entries(x.it.value || {}).filter(([k]) => k !== df)))))));
  }
  return h("div", { class: "f-cal", style: styleOf(K, p, env) },
    h("div", { class: "f-cal-h" }, h("button", { type: "button", class: "f-btn ghost", "aria-label": "Previous month", on: { click: () => shift(-1) } }, "‹"), h("b", null, first.toLocaleString("en-GB", { month: "long", year: "numeric" })), h("button", { type: "button", class: "f-btn ghost", "aria-label": "Next month", on: { click: () => shift(1) } }, "›")),
    h("div", { class: "f-cal-g" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => h("div", { class: "f-cal-w", key: d }, d)), cells));
};
R.json = (K, p, env) => { const v = prop(K, p, "of", env); return h("pre", { class: "f-code", style: styleOf(K, p, env) }, H.isRes(v) ? "… " + H.show(v.ast) : JSON.stringify(v, (k, x) => (H.isRes(x) ? "…" : H.isErr(x) ? "!" + x.msg : x), 2)); };

/* ---------- charts ---------- */
function series(items, xf, yf) {
  const ys = yf ? String(yf).split("|").map(s => s.trim()) : null;
  const rows = items.map((it, i) => {
    const v = it.value;
    if (typeof v === "number") return { label: it.key && !/^\d+$/.test(it.key) ? it.key : String(i + 1), vals: [v], it, fields: ["value"] };
    if (v && typeof v === "object") {
      const xk = xf || ["name", "label", "x", "what", "cat", "month", "day", "date", "item"].find(k => k in v) || Object.keys(v).find(k => typeof v[k] === "string");
      const yk = ys || [["value", "y", "amount", "n", "count", "total"].find(k => typeof v[k] === "number") || Object.keys(v).find(k => typeof v[k] === "number")].filter(Boolean);
      return { label: xk != null ? fmt(v[xk]) : String(i + 1), vals: yk.map(k => (typeof v[k] === "number" ? v[k] : 0)), it, fields: yk };
    }
    return { label: String(i + 1), vals: [0], it, fields: [] };
  });
  return rows;
}
function chartItems(K, p, env) {
  const r = itemsOf(K, p, "of", env);
  if (!r.items.length && r.v && typeof r.v === "object" && !Array.isArray(r.v) && !H.isRes(r.v)) r.items = Object.entries(r.v).map(([k, x]) => ({ value: x, key: k, path: r.b.path ? r.b.path + "." + k : null }));
  return r;
}
function niceMax(m) { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))), n = m / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const tick = v => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : H.fmtNum(v));
R.bars = (K, p, env) => {
  const { items, v } = chartItems(K, p, env);
  if (H.isRes(v) || H.isErr(v)) return h("div", { class: "f-chart" }, valueNode(v));
  const rows = series(items, prop(K, p, "x", env), prop(K, p, "y", env));
  const hor = prop(K, p, "dir", env) === "h", drag = !!prop(K, p, "drag", env) && !env.readonly;
  const max = niceMax(Math.max(0, ...rows.map(r => r.vals[0] || 0))), col = color(prop(K, p, "color", env)) || "var(--accent)";
  const unit = prop(K, p, "unit", env), H0 = typeof prop(K, p, "h", env) === "number" ? prop(K, p, "h", env) : 160;
  const dragOn = (r, vert) => e => {
    if (!drag || !r.it.path || !r.fields[0] || e.button !== 0) return;
    const plot = e.currentTarget.closest(".f-bars-plot"), el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const target = typeof r.it.value === "number" ? r.it.path : r.it.path + "." + r.fields[0];
    const mv = ev => { const b = plot.getBoundingClientRect(); const f = vert ? 1 - (ev.clientY - b.top) / b.height : (ev.clientX - b.left) / b.width; let nv = Math.max(0, f * max); nv = max >= 50 ? Math.round(nv) : Number(nv.toFixed(2)); write(env, target, nv, true); };
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); mv(e);
  };
  if (!rows.length) return h("div", { class: "f-chart f-empty", style: styleOf(K, p, env) }, "No data yet");
  if (hor) return h("div", { class: "f-chart f-hbars", style: styleOf(K, p, env) }, label(K, p, env, "") ? h("div", { class: "f-chart-t" }, label(K, p, env, "")) : null,
    h("div", { class: "f-bars-plot" }, rows.map((r, i) => h("div", { class: "f-hbar", key: r.it.key || "r" + i },
      h("span", { class: "l" }, r.label), h("span", { class: "track" + (drag && r.it.path ? " drag" : ""), on: { pointerdown: dragOn(r, false) } }, h("i", { style: { width: (100 * Math.max(0, r.vals[0]) / max).toFixed(2) + "%", background: col } })), h("span", { class: "v f-num" }, fmt(r.vals[0], { unit }))))));
  const ticks = [0, 0.5, 1].map(f => f * max);
  return h("div", { class: "f-chart", style: styleOf(K, p, env) }, label(K, p, env, "") ? h("div", { class: "f-chart-t" }, label(K, p, env, "")) : null,
    h("div", { class: "f-vbars" },
      h("div", { class: "f-axis" }, ticks.slice().reverse().map(t => h("span", { key: "t" + t }, tick(t)))),
      h("div", { class: "f-bars-plot", style: { height: H0 + "px" } },
        ticks.map(t => h("i", { class: "grid", key: "g" + t, style: { bottom: (100 * t / max) + "%" } })),
        rows.map((r, i) => h("div", { class: "f-vbar" + (drag && r.it.path ? " drag" : ""), key: r.it.key || "r" + i, title: `${r.label}: ${fmt(r.vals[0], { unit })}`, on: { pointerdown: dragOn(r, true) } },
          h("span", { class: "v f-num" }, fmt(r.vals[0])), h("i", { style: { height: (100 * Math.max(0, r.vals[0]) / max).toFixed(2) + "%", background: col } }))))),
    h("div", { class: "f-xlabels", style: { paddingLeft: "34px" } }, rows.map((r, i) => h("span", { key: "x" + i }, r.label))));
};
R.trend = (K, p, env) => {
  const { items, v } = chartItems(K, p, env);
  if (H.isRes(v) || H.isErr(v)) return h("div", { class: "f-chart" }, valueNode(v));
  const rows = series(items, prop(K, p, "x", env), prop(K, p, "y", env)); if (!rows.length) return h("div", { class: "f-chart f-empty" }, "No data yet");
  const W = Math.round(Math.max(220, Math.min(1400, env.width || 400))), Hh = typeof prop(K, p, "h", env) === "number" ? prop(K, p, "h", env) : 170, L = 34, Rr = 12, T = 12, B = 24;
  const ns = Math.max(...rows.map(r => r.vals.length)), all = rows.flatMap(r => r.vals);
  const lo = Math.min(0, ...all), hi = niceMax(Math.max(...all, 0) - lo) + lo;
  const X = i => L + (rows.length === 1 ? (W - L - Rr) / 2 : i * (W - L - Rr) / (rows.length - 1)), Y = y => T + (1 - (y - lo) / ((hi - lo) || 1)) * (Hh - T - B);
  const names = rows[0] ? rows[0].fields : [];
  const out = [];
  for (const f of [0, 0.5, 1]) { const y = lo + f * (hi - lo); out.push(h("line", { x1: L, x2: W - Rr, y1: Y(y), y2: Y(y), class: "grid", key: "g" + f }), h("text", { x: L - 6, y: Y(y) + 4, "text-anchor": "end", class: "ax", key: "t" + f }, tick(y))); }
  const every = Math.ceil(rows.length / 7);
  rows.forEach((r, i) => { if (i % every === 0 || i === rows.length - 1) out.push(h("text", { x: X(i), y: Hh - 6, "text-anchor": "middle", class: "ax", key: "x" + i }, r.label.length > 8 ? r.label.slice(0, 7) + "…" : r.label)); });
  for (let s = 0; s < ns; s++) {
    const pts = rows.map((r, i) => [X(i), Y(r.vals[s] || 0)]), c = PALETTE[s % PALETTE.length];
    if (s === 0 && ns === 1) out.push(h("path", { d: `M${pts[0][0]},${Y(Math.max(lo, 0))} ` + pts.map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ") + ` L${pts[pts.length - 1][0]},${Y(Math.max(lo, 0))} Z`, fill: c, opacity: "0.12", key: "a" }));
    out.push(h("polyline", { points: pts.map(q => q.map(n => n.toFixed(1)).join(",")).join(" "), fill: "none", stroke: c, "stroke-width": "2", "stroke-linejoin": "round", key: "l" + s }));
    const lp = pts[pts.length - 1]; out.push(h("circle", { cx: lp[0], cy: lp[1], r: 3.5, fill: c, key: "d" + s }));
  }
  return h("div", { class: "f-chart", style: styleOf(K, p, env) }, label(K, p, env, "") ? h("div", { class: "f-chart-t" }, label(K, p, env, "")) : null,
    h("svg", { viewBox: `0 0 ${W} ${Hh}`, class: "f-svgchart", role: "img", "aria-label": label(K, p, env, "Line chart") }, out),
    ns > 1 ? h("div", { class: "f-legend" }, names.map((n, i) => h("span", { key: n }, h("i", { style: { background: PALETTE[i % PALETTE.length] } }), n))) : null);
};
const pie = hole => (K, p, env) => {
  const { items, v } = chartItems(K, p, env);
  if (H.isRes(v) || H.isErr(v)) return h("div", { class: "f-chart" }, valueNode(v));
  const rows = series(items, prop(K, p, "x", env), prop(K, p, "y", env)).filter(r => r.vals[0] > 0);
  const tot = rows.reduce((a, r) => a + r.vals[0], 0); if (!tot) return h("div", { class: "f-chart f-empty" }, "No data yet");
  let a0 = -Math.PI / 2; const arcs = [];
  rows.forEach((r, i) => {
    const a1 = a0 + 2 * Math.PI * r.vals[0] / tot, big = a1 - a0 > Math.PI ? 1 : 0, R0 = 80, ri = hole ? 50 : 0;
    const p1 = [100 + R0 * Math.cos(a0), 100 + R0 * Math.sin(a0)], p2 = [100 + R0 * Math.cos(a1), 100 + R0 * Math.sin(a1)];
    const d = rows.length === 1 ? (hole ? `M100,20 A80,80 0 1 1 99.99,20 Z M100,50 A50,50 0 1 0 100.01,50 Z` : `M100,20 A80,80 0 1 1 99.99,20 Z`)
      : hole ? `M${p1} A${R0},${R0} 0 ${big} 1 ${p2} L${100 + ri * Math.cos(a1)},${100 + ri * Math.sin(a1)} A${ri},${ri} 0 ${big} 0 ${100 + ri * Math.cos(a0)},${100 + ri * Math.sin(a0)} Z` : `M100,100 L${p1} A${R0},${R0} 0 ${big} 1 ${p2} Z`;
    arcs.push(h("path", { d, fill: PALETTE[i % PALETTE.length], key: "a" + i, stroke: "var(--card)", "stroke-width": "1.5", "fill-rule": "evenodd" }, h("title", null, `${r.label}: ${fmt(r.vals[0])}`)));
    a0 = a1;
  });
  const center = hole ? [h("text", { x: 100, y: 98, "text-anchor": "middle", class: "f-pie-v", key: "cv" }, fmt(tot, { unit: prop(K, p, "unit", env) })), h("text", { x: 100, y: 116, "text-anchor": "middle", class: "ax", key: "cl" }, label(K, p, env, "total"))] : [];
  return h("div", { class: "f-chart f-pie", style: styleOf(K, p, env) },
    h("svg", { viewBox: "0 0 200 200", role: "img", "aria-label": label(K, p, env, "Pie chart") }, arcs, center),
    h("div", { class: "f-legend col" }, rows.map((r, i) => h("span", { key: "l" + i }, h("i", { style: { background: PALETTE[i % PALETTE.length] } }), h("em", null, r.label), h("b", { class: "f-num" }, Math.round(100 * r.vals[0] / tot) + "%")))));
};
R.pie = pie(false); R.donut = pie(true);
R.spark = (K, p, env) => {
  const { items } = chartItems(K, p, env), rows = series(items, prop(K, p, "x", env), prop(K, p, "y", env)), vals = rows.map(r => r.vals[0] || 0);
  if (vals.length < 2) return h("span", { class: "f-spark" });
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 100, Hh = 26, pts = vals.map((v, i) => [i * W / (vals.length - 1), Hh - 3 - (v - lo) / ((hi - lo) || 1) * (Hh - 6)]);
  return h("span", { class: "f-spark", style: styleOf(K, p, env) }, h("svg", { viewBox: `0 0 ${W} ${Hh}`, preserveAspectRatio: "none", "aria-hidden": "true" }, h("polyline", { points: pts.map(q => q.join(",")).join(" "), fill: "none", stroke: color(prop(K, p, "color", env)) || "var(--accent)", "stroke-width": "1.6", "vector-effect": "non-scaling-stroke" })),
    label(K, p, env, "") ? h("span", { class: "l" }, label(K, p, env, "")) : null, h("b", { class: "f-num" }, fmt(vals[vals.length - 1])));
};

/* ---------- drawing: an svg whose shapes are cells; drag a shape whose x and y are places ---------- */
R.draw = (K, p, env) => {
  let w = prop(K, p, "w", env), hh = prop(K, p, "h", env); w = typeof w === "number" ? w : 400; hh = typeof hh === "number" ? hh : 240;
  const bg = color(prop(K, p, "bg", env)), gridOn = prop(K, p, "grid", env), e = Object.assign({}, env, { inDraw: true });
  const grid = [];
  if (gridOn) { const g = typeof gridOn === "number" ? gridOn : 20; for (let x = g; x < w; x += g) grid.push(h("line", { x1: x, x2: x, y1: 0, y2: hh, class: "grid", key: "gx" + x })); for (let y = g; y < hh; y += g) grid.push(h("line", { y1: y, y2: y, x1: 0, x2: w, class: "grid", key: "gy" + y })); }
  return h("div", { class: "f-draw", style: styleOf(K, p, env) }, h("svg", { viewBox: `0 0 ${w} ${hh}`, role: "img", "aria-label": label(K, p, env, "Drawing"), style: { background: bg || "var(--raise)" } }, grid, F.kids(K, p, e)));
};
function shapeAttrs(K, p, env, dflt) {
  const a = {}, fill = prop(K, p, "fill", env), stroke = prop(K, p, "stroke", env), sw = prop(K, p, "sw", env), op = prop(K, p, "opacity", env);
  a.fill = fill === "none" ? "none" : color(fill) || (dflt.fill || "none");
  const s = color(stroke) || dflt.stroke; if (s) a.stroke = s;
  if (typeof sw === "number") a["stroke-width"] = sw; else if (dflt.sw) a["stroke-width"] = dflt.sw;
  if (typeof op === "number") a.opacity = op;
  return a;
}
function dragShape(K, p, env, xs, ys) {
  if (env.readonly || !prop(K, p, "drag", env)) return null;
  const bx = bind(K, p, xs, env), by = bind(K, p, ys, env);
  if (!bx.can && !by.can) return null;
  return e => {
    if (e.button !== 0) return; e.stopPropagation();
    const el = e.currentTarget, svg = el.ownerSVGElement, pt = svg.createSVGPoint();
    const at = ev => { pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    const s = at(e), ox = (typeof bx.v === "number" ? bx.v : 0) - s.x, oy = (typeof by.v === "number" ? by.v : 0) - s.y;
    el.setPointerCapture(e.pointerId); el.classList.add("dragging");
    const snap = prop(K, p, "snap", env), sn = v => (typeof snap === "number" && snap > 0 ? Math.round(v / snap) * snap : Math.round(v));
    const vb = svg.viewBox.baseVal, cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const mv = ev => { const q = at(ev), lines = []; if (bx.can) lines.push(`${bx.path} = ${sn(cl(q.x + ox, vb.x, vb.x + vb.width))}`); if (by.can) lines.push(`${by.path} = ${sn(cl(q.y + oy, vb.y, vb.y + vb.height))}`); env.write(lines.join("\n"), { coalesce: true }); };
    const up = () => { el.classList.remove("dragging"); el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
}
const num = (K, p, n, env, d = 0) => { const v = prop(K, p, n, env); return typeof v === "number" && isFinite(v) ? v : d; };
const tip = (K, p, env) => { const t = prop(K, p, "title", env); return t != null && !H.isRes(t) ? h("title", null, fmt(t)) : null; };
R.rect = (K, p, env) => { const d = dragShape(K, p, env, "x", "y"); return h("rect", Object.assign({ x: num(K, p, "x", env), y: num(K, p, "y", env), width: Math.max(0, num(K, p, "w", env, 20)), height: Math.max(0, num(K, p, "h", env, 20)), rx: num(K, p, "r", env), class: d ? "f-drag" : null, on: d ? { pointerdown: d } : null }, shapeAttrs(K, p, env, { fill: "var(--line)" })), tip(K, p, env)); };
R.circle = (K, p, env) => { const d = dragShape(K, p, env, "x", "y"); return h("circle", Object.assign({ cx: num(K, p, "x", env), cy: num(K, p, "y", env), r: Math.max(0, num(K, p, "r", env, 6)), class: d ? "f-drag" : null, on: d ? { pointerdown: d } : null }, shapeAttrs(K, p, env, { fill: "var(--accent)" })), tip(K, p, env)); };
R.ellipse = (K, p, env) => { const d = dragShape(K, p, env, "x", "y"); return h("ellipse", Object.assign({ cx: num(K, p, "x", env), cy: num(K, p, "y", env), rx: Math.max(0, num(K, p, "rx", env, 10)), ry: Math.max(0, num(K, p, "ry", env, 6)), class: d ? "f-drag" : null, on: d ? { pointerdown: d } : null }, shapeAttrs(K, p, env, { fill: "var(--accent)" })), tip(K, p, env)); };
DRAW.line = "s_line";
R.s_line = (K, p, env) => h("line", Object.assign({ x1: num(K, p, "x1", env), y1: num(K, p, "y1", env), x2: num(K, p, "x2", env), y2: num(K, p, "y2", env), "stroke-linecap": "round" }, shapeAttrs(K, p, env, { stroke: "var(--ink-2)", sw: 1.5 })), tip(K, p, env));
R.arrow = (K, p, env) => {
  const x1 = num(K, p, "x1", env), y1 = num(K, p, "y1", env), x2 = num(K, p, "x2", env), y2 = num(K, p, "y2", env), a = Math.atan2(y2 - y1, x2 - x1), s = 8;
  const at = shapeAttrs(K, p, env, { stroke: "var(--ink-2)", sw: 1.5 });
  return h("g", null, h("line", Object.assign({ x1, y1, x2: x2 - Math.cos(a) * s * 0.6, y2: y2 - Math.sin(a) * s * 0.6, "stroke-linecap": "round" }, at)),
    h("polygon", { points: `${x2},${y2} ${x2 - s * Math.cos(a - 0.45)},${y2 - s * Math.sin(a - 0.45)} ${x2 - s * Math.cos(a + 0.45)},${y2 - s * Math.sin(a + 0.45)}`, fill: at.stroke }));
};
R.path = (K, p, env) => { const d = prop(K, p, "d", env); return h("path", Object.assign({ d: typeof d === "string" ? d : "" }, shapeAttrs(K, p, env, { stroke: "var(--ink-2)", sw: 1.5 })), tip(K, p, env)); };
R.poly = (K, p, env) => {
  const v = prop(K, p, "points", env);
  const pts = Array.isArray(v) ? v.map(q => (Array.isArray(q) ? q.join(",") : q && typeof q === "object" ? `${q.x},${q.y}` : "")).join(" ") : typeof v === "string" ? v : "";
  const closed = prop(K, p, "closed", env);
  return h(closed ? "polygon" : "polyline", Object.assign({ points: pts, "stroke-linejoin": "round", "stroke-linecap": "round" }, shapeAttrs(K, p, env, { stroke: "var(--ink-2)", sw: 1.5 })), tip(K, p, env));
};
DRAW.text = "s_text";
R.s_text = (K, p, env) => {
  const v = prop(K, p, "text", env), anchor = prop(K, p, "anchor", env), size = prop(K, p, "size", env);
  return h("text", { x: num(K, p, "x", env), y: num(K, p, "y", env), "text-anchor": anchor === "middle" || anchor === "end" ? anchor : anchor === "center" ? "middle" : "start", fill: color(prop(K, p, "color", env) || prop(K, p, "fill", env)) || "var(--ink)", "font-size": typeof size === "number" ? size : 12, "font-weight": prop(K, p, "bold", env) ? 700 : null, class: "f-svgtext" }, H.isRes(v) ? "…" : fmt(v));
};
R.group = (K, p, env) => {
  const rot = prop(K, p, "rotate", env), sc = prop(K, p, "scale", env);
  const t = `translate(${num(K, p, "x", env)} ${num(K, p, "y", env)})` + (typeof rot === "number" ? ` rotate(${rot})` : "") + (typeof sc === "number" ? ` scale(${sc})` : "");
  return h("g", { transform: t, opacity: typeof prop(K, p, "opacity", env) === "number" ? prop(K, p, "opacity", env) : null }, F.kids(K, p, Object.assign({}, env, { inDraw: true })));
};
DRAW.when = "s_when";
R.s_when = (K, p, env) => { const c = prop(K, p, "if", env); return h("g", null, c && !H.isRes(c) ? F.kids(K, p, env) : null); };

/* ---------- holes: a slot someone fills ---------- */
R.hole = (K, p, env) => {
  const c = K.cells.get(p) || {}, holder = env.holder ? env.holder(p) : null;
  if (env.inDraw) return h("g", null);
  return h("div", { class: "f-hole" + (holder ? " taken" : ""), style: holder ? { "--c": env.colorOf(holder) } : null },
    h("span", { class: "q" }, "?"), h("span", { class: "intent" }, c.intent || "an empty slot"),
    holder ? h("span", { class: "held" }, `${env.nameOf(holder)} is on it`) : env.readonly ? null : h("span", { class: "acts" },
      h("button", { type: "button", class: "f-btn ghost", on: { click: () => env.fill(p) } }, "Fill"),
      h("button", { type: "button", class: "f-btn ghost", on: { click: () => env.writeAt(p) } }, "Write it")));
};

/* ---------- cells: the tree as it is, for hands (the default projection of any app) ---------- */
function recordList(K, p) {
  const segs = K.children(p); if (!segs.length || !segs.every(s => /^\d+$/.test(s))) return null;
  const cols = [];
  for (const s of segs) { const q = p + "." + s; if (K.cells.has(q)) return null; const ks = K.children(q); if (!ks.length) return null; for (const k of ks) { if (!K.cells.has(q + "." + k)) return null; if (!cols.includes(k)) cols.push(k); } }
  return cols.length <= 8 ? { rows: segs, cols } : null;
}
function cellValue(K, q, env) {
  const c = K.cells.get(q), ro = env.readonly, ty = K.types.get(q);
  if (c.kind === "hole") return R.hole(K, q, env);
  const holderEdit = v => h("input", { class: "f-cell-in", "aria-label": q, value: v, on: { change: e => { const t = e.target.value.trim(); if (!t) return; env.write(`${q} ${c.prov ? "≈" : "="} ${t}`); }, keydown: e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = v; e.target.blur(); } } } });
  if (c.kind === "formula") {
    if (c.dirty) K.compute(c);
    const v = c.v;
    return h("span", { class: "c-f" }, h("b", { class: "c-v" + (c.prov || c.dprov ? " guess" : "") }, valueNode(v)), ro ? h("code", null, c.src) : h("span", { class: "c-src" }, "= ", holderEdit(c.src)));
  }
  const v = c.v, guess = c.prov ? h("span", { class: "c-guess" }, "≈ guess", ro ? null : h("button", { type: "button", on: { click: () => env.write(`${q} = ${H.showLit(v)}`) } }, "confirm")) : null;
  if (ty && ty.name === "choice") return h("span", { class: "f-seg" }, ty.args.map(a => h("button", { type: "button", key: a, "aria-checked": a === v ? "true" : "false", role: "radio", disabled: ro, on: { click: () => env.write(`${q} = ${JSON.stringify(a)}`) } }, a)));
  if (typeof v === "boolean") return h("span", null, h("button", { type: "button", class: "f-switch", role: "switch", "aria-label": q, "aria-checked": v ? "true" : "false", disabled: ro, on: { click: () => env.write(`${q} = ${!v}`) } }), guess);
  if (typeof v === "number") return h("span", { class: "c-n" }, ro ? H.fmtNum(v) : holderEdit(H.fmtNum(v)), ty && ty.name === "range" ? h("input", { type: "range", min: ty.args[0], max: ty.args[1], step: ty.args[2] || "any", value: v, "aria-label": q, disabled: ro, on: { input: e => write(env, q, Number(e.target.value), true) } }) : null, guess);
  if (typeof v === "string") {
    const long = v.includes("\n") || v.length > 60 || (ty && ty.name === "long");
    if (ro) return h("span", { class: "c-s" + (long ? " long" : "") }, v);
    return h(long ? "textarea" : "input", { class: "f-cell-in" + (long ? " long" : ""), "aria-label": q, value: v, rows: long ? Math.min(8, v.split("\n").length + 1) : null, on: { change: e => write(env, q, e.target.value), keydown: e => { if (!long && e.key === "Enter") e.target.blur(); } } });
  }
  return h("code", null, H.showLit(v));
}
function cellRows(K, p, env, depth, skip) {
  const out = [];
  for (const s of K.children(p)) {
    const q = p + "." + s;
    if (skip && skip(q)) continue;
    if (K.cells.has(q)) { out.push(h("div", { class: "c-row", key: q, "data-path": q }, h("span", { class: "c-k", title: q + " · drag it into a field to use it there", draggable: "true", on: { dragstart: e => { e.dataTransfer.setData("text/plain", q); e.dataTransfer.effectAllowed = "copy"; } } }, s), h("span", { class: "c-val" }, cellValue(K, q, env)))); continue; }
    if (H.isViewPath(q)) { out.push(h("div", { class: "c-row c-view", key: q }, h("span", { class: "c-k" }, s), h("span", { class: "c-val" }, h("button", { type: "button", class: "f-btn ghost", on: { click: () => env.face && env.face("app") } }, `a view of ${K.leavesUnder(q).filter(l => l.endsWith(".k")).length} elements`)))); continue; }
    const rl = recordList(K, q);
    if (rl) {
      out.push(h("div", { class: "c-group", key: q }, h("div", { class: "c-gh" }, h("b", null, s), h("span", null, `${rl.rows.length} rows`)),
        tableAt(K, q, env)));
      continue;
    }
    out.push(h("div", { class: "c-group", key: q }, h("div", { class: "c-gh" }, h("b", null, s)), depth > 6 ? null : cellRows(K, q, env, depth + 1)));
  }
  return out;
}
/* a table straight over a path, for the cells projection */
function tableAt(K, path, env) {
  const items = K.children(path).map(s => ({ value: K.valueAt(path + "." + s), path: path + "." + s, key: s }));
  const cols = colsFor(items, []);
  const nums = cols.map(c => items.every(it => { const x = cellOf(it, c); return x == null || typeof x === "number"; }) && items.some(it => typeof cellOf(it, c) === "number"));
  const ro = env.readonly;
  return h("div", { class: "f-table-wrap" }, h("table", { class: "f-table" },
    h("thead", null, h("tr", null, cols.map((c, i) => h("th", { key: c, class: nums[i] ? "n" : "" }, c)), ro ? null : h("th", { class: "x" }))),
    h("tbody", null, items.slice(0, 200).map(it => h("tr", { key: it.key }, cols.map((c, i) => {
      const q = it.path + "." + c, cell = K.cells.get(q), x = cellOf(it, c);
      if (ro || !cell || cell.kind !== "lit") return h("td", { key: c, class: nums[i] ? "n" : "" }, cell && cell.kind === "hole" ? h("span", { class: "f-residual" }, "?" + (cell.intent ? " " + cell.intent : "")) : valueNode(x));
      return h("td", { key: c, class: nums[i] ? "n" : "" }, h("input", { class: "f-cell-in" + (nums[i] ? " n" : ""), "aria-label": c, value: x == null ? "" : typeof x === "number" ? H.fmtNum(x) : String(x), on: { change: e => { const t = e.target.value; write(env, q, typeof x === "number" ? (numberish(t) != null ? numberish(t) : t) : t); }, keydown: e => { if (e.key === "Enter") e.target.blur(); } } }));
    }), ro ? null : h("td", { class: "x" }, h("button", { type: "button", class: "f-x", "aria-label": "Remove row", on: { click: () => env.write(`${it.path} -`) } }, "×")))))),
    ro ? null : h("button", { type: "button", class: "f-btn ghost f-add", on: { click: () => env.write(`${path} += ${addRowText(cols, items)}`) } }, "+ Add row"));
}
R.cells = (K, p, env, direct) => {
  const b = direct ? { path: direct } : bind(K, p, "of", env), path = b.path;
  if (!path || !K.exists(path)) return h("div", { class: "f-empty" }, "Nothing at " + (path || "this path") + " yet");
  if (K.cells.has(path)) return h("div", { class: "f-cells" }, h("div", { class: "c-row" }, h("span", { class: "c-k" }, path.split(".").pop()), h("span", { class: "c-val" }, cellValue(K, path, env))));
  const rl = recordList(K, path);
  return h("div", { class: "f-cells", style: p ? styleOf(K, p, env) : null }, rl ? tableAt(K, path, env) : cellRows(K, path, env, 0, env.skipCells));
};
F.cellsOf = (K, path, env) => R.cells(K, "", env, path);
})(typeof window !== "undefined" ? window : globalThis);

/* FRUIT · the rest of what a UI kit needs (after shadcn and Base UI): disclosure and accordion, dialog and sheet,
   popover and menu, avatar, breadcrumb, skeleton, combobox, carousel, radio. Overlays belong to their window:
   a dialog covers the window it was opened in, not the whole desktop. Open/closed is each viewer's own state. */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit, { h, R, prop, bind, write, styleOf, uid, fmt, kidsOf, options, label, runAction, valueNode, color } = F;
const open = (env, key, dflt) => { const v = env.local.get(key); return v == null ? !!dflt : v; };
const flip = (env, key, v) => { env.local.set(key, v); env.rerender(); };
const keyOf = (p, env) => p + (env.keySuffix || "");

R.disclosure = (K, p, env) => {
  const k = keyOf(p, env) + "#open", b = bind(K, p, "of", env), isOpen = b.path ? !!b.v : open(env, k, prop(K, p, "open", env));
  const set = v => (b.path && b.can ? write(env, b.path, v) : flip(env, k, v));
  return h("div", { class: "f-disc" + (isOpen ? " open" : ""), style: styleOf(K, p, env) },
    h("button", { type: "button", class: "f-disc-h", "aria-expanded": isOpen ? "true" : "false", on: { click: () => set(!isOpen) } }, h("span", { class: "chev", "aria-hidden": "true" }, "›"), h("span", null, valueNode(prop(K, p, "title", env, "Details")))),
    isOpen ? h("div", { class: "f-disc-b" }, F.kids(K, p, env)) : null);
};
/* an accordion opens one of its disclosures at a time */
R.accordion = (K, p, env) => {
  const k = keyOf(p, env) + "#which", which = env.local.get(k), items = kidsOf(K, p);
  return h("div", { class: "f-accordion", style: styleOf(K, p, env) }, items.map((q, i) => {
    const isOpen = which === undefined ? !!prop(K, q, "open", env) : which === i;
    return h("div", { class: "f-disc" + (isOpen ? " open" : ""), key: q, "data-node": q },
      h("button", { type: "button", class: "f-disc-h", "aria-expanded": isOpen ? "true" : "false", on: { click: () => flip(env, k, isOpen ? -1 : i) } }, h("span", { class: "chev", "aria-hidden": "true" }, "›"), h("span", null, valueNode(prop(K, q, "title", env, "Section " + (i + 1))))),
      isOpen ? h("div", { class: "f-disc-b" }, F.kids(K, q, env)) : null);
  }));
};
const overlay = side => (K, p, env) => {
  const k = keyOf(p, env) + "#open", b = bind(K, p, "of", env), isOpen = b.path ? !!b.v : open(env, k, false);
  const set = v => (b.path && b.can ? write(env, b.path, v) : flip(env, k, v)), t = prop(K, p, "title", env);
  const trigger = h("button", { type: "button", class: "f-btn" + (prop(K, p, "tone", env) === "ghost" ? " ghost" : ""), "aria-haspopup": "dialog", on: { click: () => set(true) } }, valueNode(prop(K, p, "label", env, side ? "Open panel" : "Open")));
  if (!isOpen) return h("div", { class: "f-ovl-anchor", style: styleOf(K, p, env) }, trigger);
  return h("div", { class: "f-ovl-anchor", style: styleOf(K, p, env) }, trigger,
    h("div", { class: "f-scrim" + (side ? " side" : ""), on: { click: e => { if (e.target === e.currentTarget) set(false); }, keydown: e => { if (e.key === "Escape") { e.stopPropagation(); set(false); } } } },
      h("div", { class: side ? "f-sheet" : "f-dialog", role: "dialog", "aria-modal": "true", "aria-label": t != null ? fmt(t) : "Dialog", tabindex: "-1", ref: el => setTimeout(() => el.focus(), 0) },
        h("div", { class: "f-dialog-h" }, t != null ? h("b", null, valueNode(t)) : h("span"), h("button", { type: "button", class: "f-x", "aria-label": "Close", on: { click: () => set(false) } }, "×")),
        h("div", { class: "f-col" }, F.kids(K, p, env)))));
};
R.dialog = overlay(false); R.sheet = overlay(true);
R.popover = (K, p, env) => {
  const k = keyOf(p, env) + "#open", isOpen = open(env, k, false);
  return h("div", { class: "f-pop-anchor", style: styleOf(K, p, env) },
    h("button", { type: "button", class: "f-btn ghost", "aria-expanded": isOpen ? "true" : "false", on: { click: () => flip(env, k, !isOpen) } }, valueNode(prop(K, p, "label", env, "More"))),
    isOpen ? h("div", { class: "f-pop", role: "dialog", on: { keydown: e => { if (e.key === "Escape") flip(env, k, false); } } }, F.kids(K, p, env)) : null);
};
/* a menu: items with actions; picking one runs it and closes the menu */
R.menu = (K, p, env) => {
  const k = keyOf(p, env) + "#open", isOpen = open(env, k, false), items = kidsOf(K, p);
  return h("div", { class: "f-pop-anchor", style: styleOf(K, p, env) },
    h("button", { type: "button", class: "f-btn ghost", "aria-haspopup": "menu", "aria-expanded": isOpen ? "true" : "false", on: { click: () => flip(env, k, !isOpen) } }, valueNode(prop(K, p, "label", env, "Menu")), " ▾"),
    isOpen ? h("div", { class: "f-pop f-menu", role: "menu", on: { keydown: e => { if (e.key === "Escape") flip(env, k, false); } } }, items.map(q => F.kindOf(K, q) === "divider" ? h("hr", { class: "f-divider", key: q }) :
      h("button", { type: "button", role: "menuitem", key: q, "data-node": q, class: "f-menu-i" + (prop(K, q, "tone", env) === "bad" ? " bad" : ""), disabled: env.readonly, on: { click: () => { flip(env, k, false); runAction(K, q, env); } } }, valueNode(prop(K, q, "label", env, "Item"))))) : null);
};
R.item = (K, p, env) => h("button", { type: "button", class: "f-item", disabled: env.readonly || !(K.cells.get(p + ".do") || {}).v, on: { click: () => runAction(K, p, env) } }, valueNode(prop(K, p, "label", env, "Item")), prop(K, p, "sub", env) != null ? h("span", { class: "s" }, valueNode(prop(K, p, "sub", env))) : null);
const hue = s => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; };
R.avatar = (K, p, env) => {
  const v = prop(K, p, "of", env), size = prop(K, p, "size", env) || 32, url = v && typeof v === "object" ? v.url : typeof v === "string" && /^(https?:|\/_blob\/|blob:|data:)/.test(v) ? v : null;
  const name = v && typeof v === "object" ? v.name || "" : url ? "" : fmt(v), ini = String(name).split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const st = Object.assign(styleOf(K, p, env), { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.38) + "px", flex: "none" }); if (!url) st.background = `hsl(${hue(name)} 42% 46%)`;
  return h("span", { class: "f-avatar", style: st, title: name || null, role: "img", "aria-label": name || "avatar" }, url ? h("img", { src: url, alt: "" }) : ini);
};
R.breadcrumb = (K, p, env) => {
  const v = prop(K, p, "of", env), parts = Array.isArray(v) ? v.map(x => fmt(x)) : String(v == null ? "" : fmt(v)).split(/\s*[\/›>]\s*/).filter(Boolean);
  return h("nav", { class: "f-crumbs", "aria-label": "Breadcrumb", style: styleOf(K, p, env) }, parts.map((x, i) => h("span", { key: "c" + i, class: i === parts.length - 1 ? "cur" : "" }, x)));
};
R.skeleton = (K, p, env) => {
  const n = Math.max(1, Math.min(12, prop(K, p, "lines", env) || 3));
  return h("div", { class: "f-skel", "aria-busy": "true", "aria-label": "Loading", style: styleOf(K, p, env) }, Array.from({ length: n }, (_, i) => h("i", { key: "s" + i, style: { width: i === n - 1 && n > 1 ? "60%" : "100%" } })));
};
R.radio = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = env.readonly || !b.can, opts = options(prop(K, p, "options", env)), name = uid(keyOf(p, env));
  return h("fieldset", { class: "f-radio", style: styleOf(K, p, env) }, label(K, p, env, "") ? h("legend", { class: "f-label" }, label(K, p, env, "")) : null,
    opts.map(o => h("label", { key: o }, h("input", { type: "radio", name, value: o, checked: String(b.v) === o, disabled: ro, on: { change: () => write(env, b.path, typeof b.v === "number" && !isNaN(+o) ? +o : o) } }), h("span", null, o))));
};
/* a select you can type into */
R.combobox = (K, p, env) => {
  const b = bind(K, p, "of", env), ro = env.readonly || !b.can, opts = options(prop(K, p, "options", env)), k = keyOf(p, env), id = uid(k);
  const q = env.local.get(k + "#q"), isOpen = !!env.local.get(k + "#open"), shown = opts.filter(o => !q || o.toLowerCase().includes(String(q).toLowerCase())).slice(0, 50);
  const pick = o => { env.local.set(k + "#q", null); env.local.set(k + "#open", false); write(env, b.path, o); };
  return h("div", { class: "f-combo f-field", style: styleOf(K, p, env) }, label(K, p, env, "") ? h("label", { class: "f-label", for: id }, label(K, p, env, "")) : null,
    h("input", { id, class: "f-input", role: "combobox", "aria-expanded": isOpen ? "true" : "false", autocomplete: "off", disabled: ro, value: q != null ? q : b.v == null ? "" : String(b.v), placeholder: fmt(prop(K, p, "placeholder", env) || "Type to search"),
      on: { focus: () => { env.local.set(k + "#open", true); env.rerender(); }, input: e => { env.local.set(k + "#q", e.target.value); env.local.set(k + "#open", true); env.rerender(); },
        keydown: e => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); pick(shown[0]); } if (e.key === "Escape") { env.local.set(k + "#open", false); env.rerender(); } },
        blur: () => setTimeout(() => { env.local.set(k + "#open", false); env.local.set(k + "#q", null); env.rerender(); }, 160) } }),
    isOpen ? h("div", { class: "f-pop f-menu", role: "listbox" }, shown.length ? shown.map(o => h("button", { type: "button", role: "option", key: o, class: "f-menu-i" + (String(b.v) === o ? " on" : ""), on: { mousedown: e => { e.preventDefault(); pick(o); } } }, o)) : h("div", { class: "f-empty" }, "No match")) : null);
};
R.carousel = (K, p, env) => {
  const slides = kidsOf(K, p), k = keyOf(p, env) + "#i", i = Math.min(slides.length - 1, Math.max(0, env.local.get(k) || 0));
  if (!slides.length) return h("div", { class: "f-empty" }, "No slides yet");
  return h("div", { class: "f-carousel", style: styleOf(K, p, env) },
    h("div", { class: "f-slide", key: slides[i] }, F.node(K, slides[i], env)),
    h("div", { class: "f-car-nav" }, h("button", { type: "button", class: "f-btn ghost", "aria-label": "Previous", disabled: i === 0, on: { click: () => flip(env, k, i - 1) } }, "‹"),
      h("span", { class: "dots" }, slides.map((_, j) => h("button", { type: "button", key: "d" + j, class: j === i ? "on" : "", "aria-label": `Slide ${j + 1}`, on: { click: () => flip(env, k, j) } }))),
      h("button", { type: "button", class: "f-btn ghost", "aria-label": "Next", disabled: i === slides.length - 1, on: { click: () => flip(env, k, i + 1) } }, "›")));
};
})(typeof window !== "undefined" ? window : globalThis);
