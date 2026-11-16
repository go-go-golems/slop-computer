// slop's dev probe (SLOP3-022 C.1). The sandbox adds it to dev embeds only:
// a view a tool (a bench) opened with workshop.embed(store, {dev: true}).
// It talks to that tool, the boot data's parentOrigin, with messages marked
// slopProbe: 1 (the runtime's own messages are marked slop: 1):
//
//   page → tool  {ev: "ready", url}              loaded; ops may be called
//                {ev: "log", level, text, src?}  console output and errors
//                {reply: id, ok, value | error}  an op's answer
//   tool → page  {op, args, id}                 state(), restore(state), src(x, y)
//
// state and restore keep scroll and form values across a reload, so a tool
// can reload a dev view in place when its app changes.
(() => {
  "use strict";
  const bootEl = document.getElementById("slop-boot");
  let boot = {};
  try { boot = JSON.parse((bootEl && bootEl.textContent) || "{}"); } catch (e) { boot = {}; }
  const parent = boot.parentOrigin;
  if (!parent || window.parent === window) return;
  const post = (m) => window.parent.postMessage(Object.assign({ slopProbe: 1 }, m), parent);

  const show = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.name + ": " + v.message;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  };
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...a) => {
      orig(...a);
      post({ ev: "log", level, text: a.map(show).join(" ").slice(0, 2000) });
    };
  }
  addEventListener("error", (e) => post({ ev: "log", level: "error", text: String(e.message || e), src: e.filename ? e.filename.split("/").pop() + (e.lineno ? ":" + e.lineno : "") : "" }));
  addEventListener("unhandledrejection", (e) => post({ ev: "log", level: "error", text: "Unhandled rejection: " + show(e.reason && e.reason.message ? e.reason.message : e.reason) }));

  // A form field's key: its source line (data-src, set on dev embeds) and
  // its name or id, so values find their field again after a reload.
  const keyOf = (el) => {
    const src = el.closest("[data-src]");
    return (src ? src.getAttribute("data-src") : "") + "|" + (el.name || el.id || "");
  };
  const fields = () => [...document.querySelectorAll("input, textarea, select")];
  const ops = {
    state() {
      return {
        scroll: [window.scrollX, window.scrollY],
        fields: fields().map((el) => [keyOf(el), el.type === "checkbox" || el.type === "radio" ? !!el.checked : el.value]),
      };
    },
    restore(st) {
      if (!st || typeof st !== "object") return false;
      const left = new Map();
      for (const [k, v] of st.fields || []) {
        if (!left.has(k)) left.set(k, []);
        left.get(k).push(v);
      }
      for (const el of fields()) {
        const vals = left.get(keyOf(el));
        if (!vals || !vals.length) continue;
        const v = vals.shift();
        if (el.type === "checkbox" || el.type === "radio") el.checked = !!v;
        else if (el.type !== "file") el.value = v;
      }
      if (Array.isArray(st.scroll)) window.scrollTo(st.scroll[0] || 0, st.scroll[1] || 0);
      return true;
    },
    src(x, y) {
      const el = document.elementFromPoint(x, y);
      const s = el && el.closest("[data-src]");
      return s ? s.getAttribute("data-src") : null;
    },
  };

  addEventListener("message", (e) => {
    if (e.origin !== parent || e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.slopProbe !== 1 || typeof m.op !== "string") return;
    const fn = Object.prototype.hasOwnProperty.call(ops, m.op) ? ops[m.op] : null;
    if (!fn) return post({ reply: m.id, ok: false, error: "unknown op " + m.op });
    try {
      post({ reply: m.id, ok: true, value: fn(...(Array.isArray(m.args) ? m.args : [])) });
    } catch (err) {
      post({ reply: m.id, ok: false, error: String((err && err.message) || err) });
    }
  });

  const ready = () => post({ ev: "ready", url: location.pathname + location.search + location.hash });
  if (document.readyState === "complete") setTimeout(ready, 0);
  else addEventListener("load", () => setTimeout(ready, 0));
})();
