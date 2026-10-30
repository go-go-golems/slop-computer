/* CC5 · LEGO: software as instructions over a growing library of components
   A component is Hypha like everything else:
     lib.metric:
       about = "A number with a label, and a trend line when given one"
       takes = "of, label, pre, unit, trend"          the inputs, in the order a line passes them
       example = {of: 1298, label: "Trip", pre: "€"}  what the library shows it with
       ui:
         card
           stat of, label: label, pre: pre, unit: unit
   Used anywhere as an element:  metric total, "Trip", pre: "€"
   An input passed as a place stays a place: a slider inside a component writes the caller's data.
   Building something leaves the library richer: any element can become a component in one step, an app
   exports with the components it uses, and dropping that file on another desktop installs both.          */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit, { h, R, prop, styleOf, fmt } = F;
let X = null;

const Lib = {
  names(K) { return K.isBranch("lib") ? K.children("lib").filter(n => K.exists(`lib.${n}.ui`)) : []; },
  about(K, n) { const v = K.valueAt(`lib.${n}.about`); return typeof v === "string" ? v : ""; },
  example(K, n) { const v = K.valueAt(`lib.${n}.example`); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; },
  /* where each component is used: element kinds across every view */
  uses(K) {
    const out = new Map();
    for (const c of K.cells.values()) if (c.path.endsWith(".k") && typeof c.v === "string" && K.exists(`lib.${c.v}.ui`)) { const at = c.path.slice(0, -2); if (!at.startsWith(`lib.${c.v}.`)) { if (!out.has(c.v)) out.set(c.v, []); out.get(c.v).push(at); } }
    return out;
  },
  /* the components an app (or a component) needs, and what those need in turn */
  deps(K, root, seen = new Set()) {
    for (const l of K.leavesUnder(root)) {
      if (!l.endsWith(".k")) continue; const k = K.cells.get(l).v;
      if (typeof k === "string" && !seen.has(k) && K.exists(`lib.${k}.ui`)) { seen.add(k); this.deps(K, `lib.${k}`, seen); }
    }
    return seen;
  },
  block(K, n) { return K.toHypha({ root: `lib.${n}`, values: false }); },
  /* one element becomes a component; the element becomes its first use */
  make(K, node, name) {
    name = String(name || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[a-z][a-z0-9_]*$/.test(name)) return { err: "A component's name is lowercase words joined by _, like price_card." };
    if (R[name] || H.POS[name]) return { err: `"${name}" is already an element of the kit. Pick another name.` };
    if (K.exists("lib." + name)) return { err: `There is already a component called ${name}.` };
    const app = node.split(".")[0], params = [], aliases = new Set();
    // the names it reads from its app (or that do not exist yet) become its inputs
    for (const l of K.leavesUnder(node).concat(K.cells.has(node) ? [node] : [])) {
      const c = K.cells.get(l); if (!c) continue;
      if (l.endsWith(".as") && typeof c.v === "string") aliases.add(c.v);
      if (c.kind !== "formula") continue;
      const walk = a => { if (!a) return; if (a.k === "ref") { const head = a.p.split(".")[0]; if (!params.includes(head) && (K.exists(app + "." + head) || !K.exists(head))) params.push(head); } else if (a.k === "bin") { walk(a.a); walk(a.b); } else if (a.k === "un") walk(a.a); else if (a.k === "call") a.args.forEach(walk); else if (a.k === "list") a.items.forEach(walk); else if (a.k === "obj") a.entries.forEach(e => walk(e[1])); };
      walk(c.ast);
    }
    const takes = params.filter(p => !aliases.has(p) && !/_n$/.test(p));
    const lines = [K.nodeLine(node)].concat(K.cells.has(node) ? [] : K.viewLines(node, 2, []));
    const def = [`lib.${name}:`, `  about = ${JSON.stringify("Made from " + X.title(app))}`, `  takes = ${JSON.stringify(takes.join(", "))}`, "  ui:"].concat(lines.map(l => "    " + l)).join("\n");
    return { name, takes, text: def + `\n${node} -\n${node} is ${name}${takes.length ? " " + takes.join(", ") : ""}` };
  },
  /* an app as a file: its own lines, plus every component it uses */
  exportApp(K, app) {
    const deps = [...this.deps(K, app)];
    const head = `" ${X.title(app)}: an app for CC5. Drop this file on a desktop to install it${deps.length ? ", with the components it uses: " + deps.join(", ") : ""}.`;
    const fns = K.isBranch("fn") ? K.children("fn").filter(f => new RegExp("\\b" + f + "\\(").test(K.toHypha({ root: app, values: false }) + deps.map(n => this.block(K, n)).join("\n"))) : [];
    return [head].concat(deps.map(n => this.block(K, n)), fns.map(f => K.toHyphaOne("fn." + f)), [K.toHypha({ root: app, values: false })]).join("\n") + "\n";
  },
  exportLib(K) { const n = this.names(K); return [`" A CC5 library: ${n.join(", ")}. Drop it on a desktop to add them.`].concat(n.map(x => this.block(K, x)), K.isBranch("fn") ? [K.toHypha({ root: "fn", values: false })] : [], K.isBranch("theme") ? [K.toHypha({ root: "theme", values: false })] : []).join("\n") + "\n"; },
};

/* the starter set: small, general pieces most apps reach for (components, and functions) */
const STARTER = `lib.metric:
  about = "A number with a label, and a small trend line when given one"
  takes = "of, label, pre, unit, trend"
  example = {of: 1298, label: "Trip", pre: "€", trend: [3, 5, 4, 8, 6, 9]}
  ui:
    card
      stat of, label: label, pre: pre, unit: unit
      when len(trend) > 1
        spark trend
lib.form_field:
  about = "A labelled text input with a hint under it"
  takes = "of, label, hint, placeholder"
  example = {of: "Ramon", label: "Name", hint: "As it should appear on the invoice"}
  ui:
    col gap: 4
      field of, label: label, placeholder: placeholder
      when hint
        text hint, color: "muted", size: 12
lib.stepper:
  about = "Minus and plus around a number; it writes the number it is given"
  takes = "of, label, step"
  example = {of: 3, label: "Guests"}
  ui:
    row align: "center", wrap: false
      text label, color: "muted"
      spacer
      button "−", tone: "ghost" -> of = of - if(step, step, 1)
      stat of
      button "+", tone: "ghost" -> of = of + if(step, step, 1)
lib.pair:
  about = "A label on the left, a value on the right"
  takes = "label, of, unit"
  example = {label: "Total", of: 818, unit: "€"}
  ui:
    row justify: "between", align: "baseline", wrap: false
      text label, color: "muted"
      text of + if(unit, " " + unit, ""), bold: true
lib.list_item:
  about = "A row with an avatar, a title, a quieter line and a value at the end"
  takes = "title, sub, trailing, avatar"
  example = {title: "Ana Silva", sub: "Design, Lisbon", trailing: "Online"}
  ui:
    row align: "center", wrap: false, gap: 10
      avatar if(avatar, avatar, title), size: 34
      col gap: 0, grow: true
        text title, bold: true
        text sub, color: "muted", size: 12
      badge trailing
lib.settings_row:
  about = "A setting: what it is, a line on what it does, and a switch; it writes the switch it is given"
  takes = "of, title, sub"
  example = {of: true, title: "Daily summary", sub: "A short note every morning at 8"}
  ui:
    row align: "center", wrap: false
      col gap: 0, grow: true
        text title, bold: true
        text sub, color: "muted", size: 12
      toggle of, label: ""
lib.empty_state:
  about = "What to show before there is anything: a title, a line, and one thing to do"
  takes = "title, sub, action"
  example = {title: "No trips yet", sub: "Plan the first one and it shows up here.", action: "Plan a trip"}
  ui:
    col align: "center", center: true, pad: 18, gap: 6
      h3 title
      text sub, color: "muted"
      when action
        button action -> ask "Help me with: " + action
lib.todo_card:
  about = "A titled checklist with how much is done"
  takes = "of, title"
  example = {title: "Packing", of: [{text: "Passport", done: true}, {text: "Charger", done: false}]}
  ui:
    card title
      progress count(where(of, "done", true)) / max(1, count(of)), label: "Done"
      checklist of
lib.timer:
  about = "A countdown that reads the clock; it writes the end time it is given"
  takes = "ends, minutes, label"
  example = {ends: 0, minutes: 25, label: "Focus"}
  ui:
    card label
      h1 if(ends > clock.now, dur(ends - clock.now), dur(if(minutes, minutes, 25) * 60000))
      button if(ends > clock.now, "Stop", "Start") -> ends = if(ends > clock.now, 0, clock.now + if(minutes, minutes, 25) * 60000)
lib.section_head:
  about = "A heading with a quieter line under it"
  takes = "title, sub"
  example = {title: "This week", sub: "Three things that matter"}
  ui:
    col gap: 2
      h2 title
      text sub, color: "muted"
fn:
  pct_of(part, whole) = if(whole, part / whole, 0)
  plural(n, word) = text(n) + " " + word + if(n == 1, "", "s")
  initials(name) = upper(slice(first(split(name, " ")), 0, 1) + if(len(split(name, " ")) > 1, slice(last(split(name, " ")), 0, 1), ""))
  between(x, lo, hi) = x >= lo && x <= hi
  with_vat(price, rate) = round(price * (1 + rate), 2)
  share(xs, key, value) = pct_of(count(where(xs, key, value)), count(xs))
`;

const fnNames = K => (K.isBranch("fn") ? K.children("fn").filter(n => (K.cells.get("fn." + n) || {}).kind === "fn") : []);
const fnUses = (K, n) => { let u = 0; const re = new RegExp("\\b" + n + "\\("); for (const c of K.cells.values()) if ((c.kind === "formula" || c.kind === "fn") && c.path !== "fn." + n && re.test(c.src)) u++; return u; };

/* the Library: the desktop's design system, live. Components, the functions formulas call, and the tokens. */
R.library = (K, p, env) => {
  const tab = env.local.get(p + "#tab") || "components", names = Lib.names(K), fns = fnNames(K);
  const tabs = h("div", { class: "f-lib-tabs", role: "tablist" }, [["components", `Components · ${names.length}`], ["functions", `Functions · ${fns.length}`], ["tokens", "Tokens"]].map(([k, l]) =>
    h("button", { type: "button", role: "tab", key: k, "aria-selected": tab === k ? "true" : "false", on: { click: () => { env.local.set(p + "#tab", k); env.rerender(); } } }, l)));
  const starter = !env.readonly && (!names.length || !fns.length) ? h("button", { type: "button", class: "f-btn" + (names.length ? " ghost" : " primary"), on: { click: () => X.writeText(STARTER) } }, "Add the starter set") : null;
  let body;
  if (tab === "functions") {
    body = fns.length ? h("div", { class: "f-fns" }, fns.map(n => { const c = K.cells.get("fn." + n), u = fnUses(K, n);
      return h("div", { class: "f-fn", key: n }, h("code", null, h("span", { class: "sig" }, `${n}(${c.params.join(", ")})`), " = ", h("span", { class: "body" }, c.src)), h("span", { class: "u" }, u ? `called by ${u} formula${u > 1 ? "s" : ""}` : "not called yet")); }))
      : h("div", { class: "f-lib-empty" }, h("b", null, "No functions yet"), h("p", null, "A function is a formula with inputs, written once and called anywhere: fn.with_vat(price, rate) = round(price * (1 + rate), 2), then with_vat(total, 8.1%)."), starter);
  } else if (tab === "tokens") {
    const th = K.valueAt("theme") || {}, set = (k, v) => X.writeText(`theme.${k} = ${H.showLit(v)}`);
    const custom = Object.keys(th).filter(k => !X.colorTokens.includes(k.replace(/_/g, "-")) && !["radius", "gap", "font", "size", "dark"].includes(k) && typeof th[k] === "string");
    const hex = v => { const s = String(v || "").trim(); if (/^#[0-9a-f]{6}$/i.test(s)) return s; const c = document.createElement("canvas").getContext("2d"); c.fillStyle = s || "#000"; return /^#/.test(c.fillStyle) ? c.fillStyle : "#000000"; };
    const tok = k => h("label", { class: "f-tok", key: k, title: `theme.${k}` }, h("input", { type: "color", value: hex(th[k] || X.theme.read(k)), disabled: env.readonly, "aria-label": k, on: { change: e => set(k.replace(/-/g, "_"), e.target.value) } }), h("span", null, k + (th[k.replace(/-/g, "_")] ? " ·" : "")));
    const num = (k, lo, hi, d) => h("div", { class: "f-field f-slider", key: k }, h("div", { class: "f-label-row" }, h("label", { class: "f-label", for: F.uid(p + k) }, k), h("output", { class: "f-num" }, String(typeof th[k] === "number" ? th[k] : d) + "px")),
      h("input", { type: "range", id: F.uid(p + k), min: lo, max: hi, step: 1, value: typeof th[k] === "number" ? th[k] : d, disabled: env.readonly, style: { "--f": (((typeof th[k] === "number" ? th[k] : d) - lo) / (hi - lo) * 100) + "%" }, on: { input: e => X.writeText(`theme.${k} = ${+e.target.value}`) } }));
    body = h("div", { class: "f-tokens" },
      h("p", { class: "f-p" }, "Tokens are cells: theme.accent, theme.radius and the rest restyle every app as you change them. theme.dark.* holds the dark versions; an app's own theme overrides them in its window. Name any colour (theme.brand = \"#2650A8\") and views can use it by name."),
      h("div", { class: "f-swatch-grid" }, ["accent", "ink", "ink-2", "muted", "paper", "card", "line", "good", "bad", "warn"].concat(custom).map(tok)),
      h("div", { class: "f-row" }, num("radius", 0, 20, 8), num("gap", 4, 24, 10)),
      h("div", { class: "f-field" }, h("span", { class: "f-label" }, "font"), h("div", { class: "f-seg", role: "radiogroup" }, Object.keys(X.fonts).map(f => h("button", { type: "button", role: "radio", key: f, "aria-checked": (th.font || "sans") === f ? "true" : "false", disabled: env.readonly, on: { click: () => set("font", f) } }, f)))),
      Object.keys(th).length && !env.readonly ? h("button", { type: "button", class: "f-btn ghost", on: { click: () => X.writeText("theme -") } }, "Back to the default tokens") : null);
  } else {
    if (!names.length) body = h("div", { class: "f-lib-empty" }, h("b", null, "An empty library"), h("p", null, "Components are reusable pieces of views. Make one from any element in edit mode, ask Claude for one, or start with a general set."), starter);
    else {
      const uses = Lib.uses(K), q = String(env.local.get(p + "#q") || "").toLowerCase();
      const shown = names.filter(n => !q || n.includes(q) || Lib.about(K, n).toLowerCase().includes(q));
      body = h("div", { class: "f-lib" },
        h("div", { class: "f-lib-bar" }, h("input", { class: "f-input", id: F.uid(p + "#q"), placeholder: `Search ${names.length} components`, value: env.local.get(p + "#q") || "", on: { input: e => { env.local.set(p + "#q", e.target.value); env.rerender(); } } }),
          h("button", { type: "button", class: "f-btn ghost", on: { click: () => X.save("library.hypha", Lib.exportLib(K)) } }, "Export"), starter),
        h("div", { class: "f-lib-grid" }, shown.map(n => {
          const t = K.takesOf(n), used = (uses.get(n) || []).length, line = `${n}${t.length ? " " + t.join(", ") : ""}`;
          return h("article", { class: "f-lib-item", key: n },
            h("div", { class: "f-lib-h" }, h("code", null, n), h("span", { class: "u" }, used ? `used ${used}×` : "not used yet")),
            Lib.about(K, n) ? h("p", null, Lib.about(K, n)) : null,
            h("div", { class: "f-lib-prev" }, F.preview(K, n, Lib.example(K, n), env)),
            h("div", { class: "f-lib-foot" }, h("code", { class: "line", title: "Write this line in any ui: block" }, line),
              h("button", { type: "button", class: "f-btn ghost", on: { click: () => { navigator.clipboard.writeText(line).then(() => X.toast("Copied: " + line), () => X.toast(line)); } } }, "Copy"),
              used ? h("button", { type: "button", class: "f-btn ghost", on: { click: () => X.goto((uses.get(n) || [])[0]) } }, "Show a use") : null));
        })));
    }
  }
  return h("div", { class: "f-col", style: styleOf(K, p, env) }, tabs, body);
};
root.CC5Lego = { Lib, STARTER, init(host) { X = host; } };
})(typeof window !== "undefined" ? window : globalThis);
