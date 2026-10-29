/* FRUIT · the browser element
   browser url, text: page, h: 460
   A real browser, the Claude desktop app's own, shown as a live screenshot inside a view. Clicks, scrolling
   and typing on it go through to the page. The address is a cell: navigate, and the shared url changes for
   everyone here; change the url, and every open browser on it follows. What a page says enters the tree only
   when someone presses Capture (into the cell named by text:). Screenshots stay with each viewer.          */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit, { h, R, prop, bind, write, styleOf, uid, fmt } = F;
const SERVER = "host:claude_browser";

const B = {
  mcp: null,              // the viewer's connectors; null outside the Claude desktop app
  states: new Map(),      // element key -> what this viewer's browser shows for it
  rerender: () => { },
  setMcp(m) { this.mcp = m; this.rerender(); },
  texts(r) { return ((r && r.content) || []).filter(b => b.type === "text").map(b => b.text).join("\n"); },
  image(r) { const b = ((r && r.content) || []).find(b => b.type === "image"); return b ? `data:${b.mimeType || "image/jpeg"};base64,${b.data}` : null; },
  async call(tool, args) {
    if (!this.mcp) throw { code: "no_mcp" };
    return this.mcp.callTool(SERVER, tool, args);
  },
  why(e) {
    const c = e && e.code;
    if (c === "no_mcp" || c === "server_not_connected" || c === "server_not_found") return "The browser runs in the Claude desktop app. Open this desktop there, with the app running.";
    if (c === "not_granted" || c === "approval_required" || c === "denied" || c === "permission_denied") return "The browser was not allowed. Press Open to be asked again.";
    if (c === "not_in_manifest") return "This page may not use the browser.";
    if (c === "tool_error") return "The browser said: " + String(e.message || "").slice(0, 160);
    if (c === "cancelled") return "Cancelled.";
    return "The browser could not be reached" + (e && e.message ? ": " + String(e.message).slice(0, 120) : ".");
  },
  /* where the page is now: the line for the tab that ran the call */
  where(text, tabId) {
    const re = /tabId (\S+?): "((?:[^"\\]|\\.)*)" \("([^"]*)"\)/g; let m, out = null;
    while ((m = re.exec(text))) if (!tabId || m[1] === tabId) out = { tabId: m[1], title: m[2], url: m[3] };
    return out;
  },
  normal(u) { u = String(u || "").trim(); if (!u) return ""; if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; if (/^[^\s]+\.[^\s]+$/.test(u)) return "https://" + u; return "https://duckduckgo.com/?q=" + encodeURIComponent(u); },
};

function stateOf(key) {
  let s = B.states.get(key);
  if (!s) { s = { key, started: false, tabId: null, img: null, frame: { w: 800, h: 600 }, url: "", title: "", busy: 0, err: "", lastAct: 0, typed: "", timer: 0 }; B.states.set(key, s); }
  return s;
}
function live(s) { return !!document.querySelector(`[data-browser="${CSS.escape(s.key)}"]`); }
function loop(s) {
  clearInterval(s.timer);
  s.timer = setInterval(() => {
    if (!live(s)) { clearInterval(s.timer); s.timer = 0; s.started = false; return; }
    if (document.hidden || s.busy || performance.now() - s.lastAct < 1200) return;
    shoot(s).catch(() => { });
  }, 2500);
}
async function step(s, fn, env, b) {
  s.busy++; s.err = ""; B.rerender();
  try { await fn(); s.lastAct = performance.now(); await new Promise(r => setTimeout(r, 300)); await shoot(s, env, b); }
  catch (e) { s.err = B.why(e); }
  finally { s.busy--; B.rerender(); }
}
async function shoot(s, env, b) {
  const r = await B.call("computer", { action: "screenshot", tabId: s.tabId || undefined, scale: 0.6 });
  const t = B.texts(r), img = B.image(r), fr = /coordinate frame: (\d+)x(\d+)/.exec(t), at = B.where(t, s.tabId);
  if (img) s.img = img;
  if (fr) s.frame = { w: +fr[1], h: +fr[2] };
  if (at) {
    const moved = at.url && at.url !== s.url; s.url = at.url; s.title = at.title; if (!s.tabId) s.tabId = at.tabId;
    // a link clicked inside the page moves the shared address, so everyone here follows
    if (moved && env && b && b.can && b.path && at.url !== b.v) { s.seenWant = at.url; write(env, b.path, at.url); }
  }
  B.rerender();
}
async function go(s, url, env, b) {
  url = B.normal(url); if (!url) return;
  s.started = true; if (!s.timer) loop(s);
  if (env && b && b.can && b.path && b.v !== url) write(env, b.path, url);
  s.seenWant = url; s.url = url; s.pending = url;
  await step(s, async () => {
    if (!s.tabId) { const r = await B.call("preview_start", { url }); const m = /tabId (\S+?)\)/.exec(B.texts(r)); if (m) s.tabId = m[1]; }
    else await B.call("navigate", { url, tabId: s.tabId });
  }, env, b);
  s.pending = null;
}

/* keys typed into the screen: letters are gathered and typed together, other keys are pressed */
const KEYS = { Enter: "Enter", Backspace: "Backspace", Tab: "Tab", Escape: "Escape", Delete: "Delete", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End", " ": "space" };
function onKey(s, e, env, b) {
  if (e.key === "Shift" || e.key === "Alt" || e.key === "Control" || e.key === "Meta") return;
  e.preventDefault(); e.stopPropagation();
  const mod = (e.metaKey ? "cmd+" : "") + (e.ctrlKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "");
  const flush = () => { const t = s.typed; s.typed = ""; clearTimeout(s.typeT); if (t) step(s, () => B.call("computer", { action: "type", text: t, tabId: s.tabId, action_summary: "Types into the page" }), env, b); };
  if (!mod && e.key.length === 1 && e.key !== " ") { s.typed += e.key; clearTimeout(s.typeT); s.typeT = setTimeout(flush, 260); return; }
  flush();
  const k = KEYS[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null); if (!k) return;
  step(s, () => B.call("computer", { action: "key", text: mod + k, tabId: s.tabId, action_summary: "Presses " + mod + k + " in the page" }), env, b);
}

const ICON = {
  back: '<path d="M10 3L5 8l5 5"/>', fwd: '<path d="M6 3l5 5-5 5"/>', reload: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5"/>',
};
const icon = n => h("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", ref: el => { el.innerHTML = ICON[n]; } });

R.browser = (K, p, env) => {
  const key = p + (env.keySuffix || ""), s = stateOf(key), b = bind(K, p, "of", env);
  const want = typeof b.v === "string" ? b.v : "", tb = bind(K, p, "text", env);
  const hh = typeof prop(K, p, "h", env) === "number" ? prop(K, p, "h", env) : null;
  const id = uid(key) + "-addr", ro = env.readonly;
  // someone moved the shared address: follow it, once this viewer has opened the browser
  if (s.started && B.mcp && !ro && want && want !== s.seenWant) { s.seenWant = want; if (want !== s.url && want !== s.pending) setTimeout(() => go(s, want, env, b), 0); }
  const nav = u => go(s, u, env, b);
  const capture = () => step(s, async () => {
    const r = await B.call("get_page_text", { tabId: s.tabId || undefined, max_chars: 20000 });
    const raw = B.texts(r).replace(/\n+Tab Context:[\s\S]*$/, "").trim();
    const title = (/^Title: (.*)$/m.exec(raw) || [])[1], url = (/^URL: (.*)$/m.exec(raw) || [])[1];
    const body = raw.includes("\n---\n") ? raw.slice(raw.indexOf("\n---\n") + 5).trim() : raw;
    write(env, tb.path, (title ? `# ${title}\n\n` : "") + body + (url ? `\n\nSource: ${url}` : ""));
  }, env, b);
  const click = e => {
    if (!s.img || ro) return;
    const r = e.currentTarget.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * s.frame.w), y = Math.round((e.clientY - r.top) / r.height * s.frame.h);
    e.currentTarget.focus();
    step(s, () => B.call("computer", { action: e.detail === 2 ? "double_click" : "left_click", coordinate: [x, y], tabId: s.tabId, action_summary: "Clicks in the page" }), env, b);
  };
  const wheel = e => {
    e.preventDefault(); e.stopPropagation();
    if (!s.img || ro || s.busy) return;
    const r = e.currentTarget.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * s.frame.w), y = Math.round((e.clientY - r.top) / r.height * s.frame.h);
    const now = performance.now(); if (now - (s.lastWheel || 0) < 350) return; s.lastWheel = now;
    const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? (e.deltaX > 0 ? "right" : "left") : (e.deltaY > 0 ? "down" : "up");
    step(s, () => B.call("computer", { action: "scroll", coordinate: [x, y], scroll_direction: dir, scroll_amount: Math.min(10, Math.max(2, Math.round(Math.abs(e.deltaY || e.deltaX) / 40))), tabId: s.tabId }), env, b);
  };
  const ratio = s.frame.h / s.frame.w;
  let screen;
  if (!B.mcp) screen = h("div", { class: "f-browser-off" }, h("b", null, "A real browser lives here"), h("p", null, "It is the Claude desktop app's own browser. Open this desktop in the desktop app, with the app running, and it comes alive."), want ? h("code", null, want) : null);
  else if (!s.started) screen = h("div", { class: "f-browser-off" }, h("b", null, want ? "Ready to open" : "Type an address above"), want ? h("code", null, want) : null,
    h("button", { type: "button", class: "f-btn primary", disabled: ro || !want, on: { click: () => nav(want) } }, "Open in your browser"),
    h("p", null, "Your clicks, scrolling and typing here go to the page. Screenshots stay on your screen."));
  else if (!s.img) screen = h("div", { class: "f-browser-off" }, s.err ? h("p", { class: "f-err" }, s.err) : h("p", null, "Opening…"), s.err ? h("button", { type: "button", class: "f-btn", on: { click: () => nav(want || s.url) } }, "Try again") : null);
  else screen = h("img", { class: "f-browser-img", src: s.img, alt: s.title ? `The page ${s.title}` : "The page", tabindex: "0", draggable: "false",
    style: { aspectRatio: `${s.frame.w} / ${s.frame.h}` }, on: { click, wheel, keydown: e => onKey(s, e, env, b), dragstart: e => e.preventDefault() } });
  return h("div", { class: "f-browser" + (s.busy ? " busy" : ""), "data-browser": key, style: styleOf(K, p, env) },
    h("div", { class: "f-browser-bar" },
      h("button", { type: "button", class: "f-bbtn", "aria-label": "Back", disabled: !s.started || ro, on: { click: () => step(s, () => B.call("navigate", { url: "back", tabId: s.tabId }), env, b) } }, icon("back")),
      h("button", { type: "button", class: "f-bbtn", "aria-label": "Forward", disabled: !s.started || ro, on: { click: () => step(s, () => B.call("navigate", { url: "forward", tabId: s.tabId }), env, b) } }, icon("fwd")),
      h("button", { type: "button", class: "f-bbtn", "aria-label": "Reload", disabled: !s.started || ro, on: { click: () => nav(s.url || want) } }, icon("reload")),
      h("input", { id, class: "f-input f-browser-addr", value: s.started ? (s.url || want) : want, placeholder: "Address, or words to search", spellcheck: "false", disabled: ro, "aria-label": "Address",
        on: { keydown: e => { if (e.key === "Enter") { e.preventDefault(); nav(e.target.value); e.target.blur(); } } } }),
      tb.path ? h("button", { type: "button", class: "f-btn ghost", disabled: !s.img || ro, title: `Put this page's text into ${tb.path}, where everyone here can read it`, on: { click: capture } }, "Capture") : null),
    h("div", { class: "f-browser-screen", style: hh ? { maxHeight: hh + "px" } : null }, screen),
    h("div", { class: "f-browser-foot" }, h("span", { class: "dot" }), h("span", { class: "t" }, s.err && s.img ? s.err : s.busy ? "Working…" : s.title || (s.started ? "" : "Not open")), s.started && s.img ? h("span", { class: "m" }, "live · every 2.5 s") : null));
};

/* the web as tools for a Claude filling a hole marked @browser: one research tab each */
B.tools = function (slot) {
  const tab = { id: null };
  const open = async url => {
    if (!tab.id) { const r = await B.call("preview_start", { url }); const m = /tabId (\S+?)\)/.exec(B.texts(r)); if (m) tab.id = m[1]; }
    else await B.call("navigate", { url, tabId: tab.id });
    await new Promise(r => setTimeout(r, 600));
    const t = B.texts(await B.call("get_page_text", { tabId: tab.id || undefined, max_chars: 9000 }));
    return t.replace(/\n+Tab Context:[\s\S]*$/, "");
  };
  const wrap = f => async input => { try { return await f(input || {}); } catch (e) { throw new Error(B.why(e)); } };
  return [
    { name: "web_search", description: "Search the web in the person's browser. Returns the results page as text (titles, links, snippets).", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      execute: wrap(i => open("https://duckduckgo.com/html/?q=" + encodeURIComponent(String(i.query || "")))) },
    { name: "web_read", description: "Open a URL in the person's browser and return the page's text.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      execute: wrap(i => open(B.normal(i.url))) },
  ];
};
root.CC5Browser = B;
})(typeof window !== "undefined" ? window : globalThis);
