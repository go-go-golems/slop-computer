// ---------- live preview (web/pinup/slop; not part of upstream Pinup) ----------
// A panel beside the canvas showing the app page as a visitor sees it:
// compiled here by slopAppCompile (images kept inline), given the rows each
// data source has on main and the site index, the way the server injects
// them (#slop-boot + runtime.js). The page runs in an iframe that may run
// scripts but has an opaque origin, so it cannot reach this tool's API
// grant; it talks back only by postMessage. Every change recompiles it, the
// selection picks the screen, and links to screens of the app move the
// preview while other links open in a new tab. Nothing is written.
// Guide: ttmp/2026/10/29/SLOP-007-…/design-doc/01.

const LP = {
  open: false, el: null, stage: null, frame: null, next: null, msg: null, foot: null,
  scr: null, rec: null, back: null, dev: null,
  device: 390, at: null, history: [], scroll: 0, // at: {id, params}, the screen on show
  data: null, dataKey: '', loading: null, errors: {},
  runtime: null, timer: 0, seq: 0,
};
const LP_KEY = 'pinup.slop.preview';
const LP_DEVICES = [[390, 'smartphone', 'Phone'], [768, 'tablet', 'Tablet'], [1280, 'monitor', 'Desktop']];
// runtime.js comes from /_slop/runtime.js on this origin; this stands in
// when it cannot be fetched (same window.slop shape).
const LP_SHIM = "(function(){var D={};try{D=JSON.parse(document.getElementById('slop-boot').textContent)}catch(e){}var data={};" +
  "Object.keys(D.data||{}).forEach(function(k){var rows=D.data[k]||[];data[k]={list:function(){return Promise.resolve(rows.slice())},get:function(id){return Promise.resolve(rows.filter(function(r){return r.id===id})[0]||null)},all:rows}});" +
  "window.slop={route:D.route||{params:{}},data:data,record:null,version:D.version||null,mode:D.mode||'preview',tokens:null};})();";

document.head.append(h('style', { text: `
#slopPreview { position: fixed; z-index: 40; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--shadow); resize: both; overflow: hidden; min-width: 280px; min-height: 260px; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); }
#slopPreview .lp-hd { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 12px; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
#slopPreview .lp-hd b { font-size: 12px; margin-right: auto; }
#slopPreview .lp-nav { display: flex; align-items: center; gap: 6px; padding: 0 8px 8px 6px; border-bottom: 1px solid var(--line); }
#slopPreview select { flex: 1; min-width: 0; height: 26px; border: 1px solid var(--line-2); border-radius: var(--r); background: var(--panel); padding: 0 4px; font-size: 12px; }
#slopPreview .ib { width: 26px; height: 26px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); display: grid; place-items: center; padding: 0; flex: none; }
#slopPreview .ib:hover:not(:disabled) { background: var(--panel-2); color: var(--ink); }
#slopPreview .ib:disabled { opacity: .35; }
#slopPreview .ib svg, #slopPreview .seg svg { width: 15px; height: 15px; }
#slopPreview .seg { width: auto; }
#slopPreview .seg button { width: 28px; flex: none; }
#slopPreview .lp-msg { padding: 8px 12px; font-size: 12px; line-height: 1.45; border-bottom: 1px solid var(--line); background: var(--panel-2); color: var(--ink-2); max-height: 35%; overflow: auto; }
#slopPreview .lp-msg.bad { color: var(--bad); }
#slopPreview .lp-msg p { margin: 0; }
#slopPreview .lp-msg p + p, #slopPreview .lp-msg .btn { margin-top: 6px; }
#slopPreview .lp-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--canvas); }
#slopPreview .lp-stage iframe { position: absolute; top: 0; left: 0; border: 0; transform-origin: 0 0; background: #fff; }
#slopPreview .lp-stage iframe.pending { opacity: 0; pointer-events: none; }
#slopPreview.moving iframe { pointer-events: none; }
#slopPreview .lp-ft { padding: 5px 12px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
` }));

// ---------- the panel ----------
function lpBuild() {
  const g = lsGet(LP_KEY, {}) || {};
  if (LP_DEVICES.some(d => d[0] === g.device)) LP.device = g.device;
  LP.scr = h('select', { 'aria-label': 'Screen', onchange: () => lpGo({ id: LP.scr.value, params: {} }, true) });
  LP.rec = h('select', { 'aria-label': 'Record', hidden: true, onchange: () => {
    const f = get(LP.at && LP.at.id), k = f && lpParamNames(f)[0];
    if (k) lpGo({ id: f.id, params: Object.assign({}, LP.at.params, { [k]: LP.rec.value }) }, true);
  } });
  LP.back = h('button', { class: 'ib', title: 'Back', 'aria-label': 'Back', disabled: true, onclick: () => lpBack() }, ico('arrow-left'));
  LP.dev = h('div', { class: 'seg', role: 'group', 'aria-label': 'Width' }, ...LP_DEVICES.map(([w, icon, name]) =>
    h('button', { title: `${name} · ${w} px`, 'aria-label': name, 'aria-pressed': String(LP.device === w), 'data-w': w, onclick: () => lpDevice(w) }, ico(icon))));
  const head = h('div', { class: 'lp-hd', title: 'Drag to move' },
    h('b', { text: 'Live preview' }), LP.dev,
    h('button', { class: 'ib', title: 'Reload the data', 'aria-label': 'Reload the data', onclick: () => { LP.loading = null; lpRender(); } }, ico('refresh-cw')),
    h('button', { class: 'ib', title: 'Open on the site (published version)', 'aria-label': 'Open on the site', onclick: () => lpOpenSite() }, ico('external-link')),
    h('button', { class: 'ib', title: 'Close', 'aria-label': 'Close the preview', onclick: () => lpToggle(false) }, ico('x')));
  LP.msg = h('div', { class: 'lp-msg', hidden: true, role: 'status' });
  LP.stage = h('div', { class: 'lp-stage' });
  LP.foot = h('div', { class: 'lp-ft' });
  LP.el = h('section', { id: 'slopPreview', 'aria-label': 'Live preview', hidden: true },
    head, h('div', { class: 'lp-nav' }, LP.back, LP.scr, LP.rec), LP.msg, LP.stage, LP.foot);
  document.body.append(LP.el);
  lpDrag(head);
  let save = 0;
  new ResizeObserver(() => { lpFit(); clearTimeout(save); save = setTimeout(lpSave, 300); }).observe(LP.el);
  addEventListener('resize', () => { if (LP.open) lpPlace(lpGeom()); });
}

function lpGeom() { const r = LP.el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }
function lpSave() { if (LP.open) lsSet(LP_KEY, Object.assign(lpGeom(), { device: LP.device, open: true })); }
// Inside the window, whatever was saved; the default sits left of the
// inspector, as tall as most of the window.
function lpPlace(g) {
  const W = innerWidth, H = innerHeight;
  const w = Math.min(g && g.w > 0 ? g.w : 440, W - 16), ht = Math.min(g && g.h > 0 ? g.h : Math.min(760, Math.round(H * .78)), H - 16);
  const x = g && g.x != null ? g.x : W - w - (W > 900 ? 300 : 8), y = g && g.y != null ? g.y : H - ht - 16;
  Object.assign(LP.el.style, { width: w + 'px', height: ht + 'px', left: Math.max(8, Math.min(x, W - w - 8)) + 'px', top: Math.max(8, Math.min(y, H - ht - 8)) + 'px' });
}
function lpDrag(handle) {
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, select')) return;
    const r = LP.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId); LP.el.classList.add('moving');
    const move = m => lpPlace({ x: m.clientX - dx, y: m.clientY - dy, w: r.width, h: r.height });
    const up = () => { handle.removeEventListener('pointermove', move); LP.el.classList.remove('moving'); lpSave(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
}

function lpToggle(on = !LP.open) {
  if (!LP.el) lpBuild();
  LP.open = on;
  LP.el.hidden = !on;
  const b = $('#bPreview'); if (b) b.setAttribute('aria-pressed', String(on));
  if (!on) {
    clearTimeout(LP.timer); LP.seq++;
    for (const f of LP.stage.querySelectorAll('iframe')) f.remove();
    LP.frame = LP.next = null;
    lsSet(LP_KEY, Object.assign(lsGet(LP_KEY, {}) || {}, { open: false }));
    return;
  }
  lpPlace(lsGet(LP_KEY, null));
  lpFollow(true);
  lpRender();
}

function lpDevice(w) {
  LP.device = w;
  for (const b of LP.dev.children) b.setAttribute('aria-pressed', String(+b.dataset.w === w));
  lpFit(); lpSave();
}
// The page is laid out at the device width and scaled down to the panel.
function lpFit(only) {
  if (!LP.stage) return;
  const W = LP.stage.clientWidth, H = LP.stage.clientHeight, d = LP.device, s = Math.min(1, W / d);
  if (!W || !H) return;
  for (const f of only ? [only] : LP.stage.querySelectorAll('iframe')) {
    Object.assign(f.style, { width: d + 'px', height: Math.ceil(H / s) + 'px', transform: `scale(${s})`, left: Math.max(0, Math.round((W - d * s) / 2)) + 'px' });
  }
}

function lpSay(lines, opts = {}) {
  LP.msg.textContent = '';
  LP.msg.hidden = !lines.length && !opts.action;
  LP.msg.classList.toggle('bad', !!opts.bad);
  for (const l of lines) LP.msg.append(h('p', { text: l }));
  if (opts.action) LP.msg.append(opts.action);
}

function lpOpenSite() {
  const app = S.file.app, f = app && get(LP.at && LP.at.id);
  if (!app || !app.host) return;
  window.open(location.protocol + '//' + app.host + (f ? lpPath(f, LP.at.params) : slopAppPath(app.base)), '_blank', 'noopener');
}

// ---------- screens and paths ----------
const lpParamNames = f => (slopAppPath(f.route).match(/:[a-z][a-z0-9_]*/g) || []).map(s => s.slice(1));
function lpRows(f) { return f && f.record && LP.data ? LP.data[f.record] || [] : []; }
const lpRowKey = r => String(r.id != null ? r.id : r.slug != null ? r.slug : '');
// The screen on show: the one picked, else the start screen.
function lpScreen(screens) { return (LP.at && screens.find(f => f.id === LP.at.id)) || slopAppStart(screens); }
// Fills in what a screen's path needs: a record screen's first parameter
// names its first record, any other parameter is "sample".
function lpParams(f, params) {
  const out = {}, rows = lpRows(f);
  lpParamNames(f).forEach((k, i) => { out[k] = params[k] != null && params[k] !== '' ? String(params[k]) : i === 0 && rows.length ? lpRowKey(rows[0]) : 'sample'; });
  return out;
}
function lpPath(f, params) {
  const route = slopAppPath(f.route).replace(/:([a-z][a-z0-9_]*)/g, (_, k) => encodeURIComponent((params && params[k]) || 'sample'));
  return slopAppJoin(S.file.app.base, route);
}
// A site path → the screen of this app that serves it, as the runtime
// picks it (literal segments beat parameters), or null.
function lpMatch(href, screens) {
  let u; try { u = new URL(href, 'http://x'); } catch { return null; }
  const segs = p => p.split('/').filter(Boolean), base = segs(slopAppPath(S.file.app.base)), xs = segs(u.pathname);
  if (base.some((s, i) => xs[i] !== s)) return null;
  const rest = xs.slice(base.length);
  let best = null, score = -1;
  for (const f of screens) {
    const ps = segs(slopAppPath(f.route));
    if (ps.length !== rest.length) continue;
    const params = {};
    if (!ps.every((s, i) => { if (s[0] !== ':') return s === rest[i]; try { params[s.slice(1)] = decodeURIComponent(rest[i]); } catch { params[s.slice(1)] = rest[i]; } return true; })) continue;
    const sc = ps.reduce((n, s) => n + (s[0] === ':' ? 2 : 3), 0);
    if (sc > score) { best = { id: f.id, params }; score = sc; }
  }
  return best;
}

function lpGo(at, reset) {
  if (reset) LP.history = [];
  else if (LP.at) LP.history.push({ at: LP.at, scroll: LP.scroll });
  LP.at = at; LP.scroll = 0;
  lpRender();
}
function lpBack() {
  const prev = LP.history.pop(); if (!prev) return;
  LP.at = prev.at; LP.scroll = prev.scroll;
  lpRender();
}
// A link clicked inside the preview.
function lpNavigate(href, back) {
  const app = S.file.app; if (!app) return;
  if (back && LP.history.length) return lpBack();
  if (/^\/(?!\/)/.test(href)) {
    const to = lpMatch(href, slopAppScreens());
    if (to) return lpGo(to);
    window.open(location.protocol + '//' + app.host + href, '_blank', 'noopener');
  } else if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener');
}
// The selected layer's screen, when it is one the app routes.
function lpFollow(quiet) {
  if (!LP.open || !S.file.app || !S.sel.length) return;
  const top = topOf(S.sel[0]);
  if (!top || (LP.at && top.id === LP.at.id) || !slopAppScreens().some(f => f.id === top.id)) return;
  LP.history = []; LP.at = { id: top.id, params: {} }; LP.scroll = 0;
  if (!quiet) lpSoon(60);
}

// ---------- rendering ----------
function lpSoon(ms = 350) { if (!LP.open) return; clearTimeout(LP.timer); LP.timer = setTimeout(lpRender, ms); }

function lpLoad() {
  const app = S.file.app, key = JSON.stringify([app.host, app.data || {}]);
  if (LP.loading && LP.dataKey === key) return LP.loading;
  LP.dataKey = key;
  const errors = {}, names = Object.keys(app.data || {});
  LP.loading = Promise.all(names.map(name => slopAppRows(app.data[name], app.host).then(
    rs => [name, Array.isArray(rs) ? rs : []],
    e => { errors[name] = (e && e.message) || String(e); return [name, []]; })))
    .then(es => { LP.errors = errors; return (LP.data = Object.fromEntries(es)); });
  return LP.loading;
}
async function lpRuntime() {
  if (LP.runtime) return LP.runtime;
  try { const r = await fetch('/_slop/runtime.js'); const t = r.ok ? await r.text() : ''; if (t.includes('slop-boot')) return (LP.runtime = t); } catch {}
  return (LP.runtime = LP_SHIM);
}

// Runs inside the preview (copied as source): restores the scroll position,
// reports scrolling, and hands every link to Pinup instead of following it.
function lpBridge(restore) {
  var t = 0;
  function back() { if (restore) scrollTo(0, restore); }
  addEventListener('DOMContentLoaded', function () { back(); requestAnimationFrame(function () { parent.postMessage({ pinupPreview: 'ready' }, '*'); }); });
  addEventListener('load', back);
  addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(function () { parent.postMessage({ pinupPreview: 'scroll', y: scrollY }, '*'); }, 120); });
  addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') { var el = href.length > 1 && document.getElementById(href.slice(1)); if (el) el.scrollIntoView(); return; }
    parent.postMessage({ pinupPreview: 'nav', href: href, back: a.hasAttribute('data-back') }, '*');
  }, true);
}

// The compiled page with what the server would add after <head>.
function lpDocument(html, boot, runtime) {
  const app = S.file.app;
  const head = `<base href="${esc(location.protocol + '//' + app.host + '/')}">`
    + `<script type="application/json" id="slop-boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}<\/script>`
    + `<script>${runtime.replace(/<\/script/gi, '<\\/script')}<\/script>`
    + `<script>(${lpBridge.toString()})(${Math.max(0, Math.round(LP.scroll)) || 0});<\/script>`;
  return html.replace(/<head>/i, () => '<head>\n' + head);
}

// The new page loads in a hidden frame over the old one and replaces it
// when it is ready, so a recompile does not flash.
function lpSwap(doc) {
  if (LP.next) LP.next.remove();
  const f = h('iframe', { class: 'pending', sandbox: 'allow-scripts', title: 'Live preview of the app page', referrerpolicy: 'no-referrer' });
  f.srcdoc = doc;
  LP.next = f;
  const done = () => {
    if (LP.next !== f) return;
    LP.next = null;
    if (LP.frame) LP.frame.remove();
    LP.frame = f; f.classList.remove('pending');
  };
  f.addEventListener('load', done, { once: true });
  f.lpReady = done;
  lpFit(f);
  LP.stage.append(f);
}

addEventListener('message', e => {
  const m = e.data;
  if (!m || typeof m !== 'object' || !m.pinupPreview || !LP.open) return;
  const from = [LP.frame, LP.next].find(f => f && f.contentWindow === e.source);
  if (!from) return;
  if (m.pinupPreview === 'ready') { if (from === LP.next) from.lpReady(); }
  else if (m.pinupPreview === 'scroll') { if (from === LP.frame) LP.scroll = +m.y || 0; }
  else if (m.pinupPreview === 'nav' && from === LP.frame) lpNavigate(String(m.href || ''), !!m.back);
});

function lpPickers(screens, f) {
  LP.scr.textContent = '';
  for (const x of screens) LP.scr.append(h('option', { value: x.id, text: `${x.name} · ${slopAppJoin(S.file.app.base, x.route)}` }));
  LP.scr.value = f.id;
  const rows = lpRows(f), k = lpParamNames(f)[0];
  LP.rec.hidden = !f.record || !k;
  if (!LP.rec.hidden) {
    LP.rec.textContent = '';
    for (const r of rows.slice(0, 500)) LP.rec.append(h('option', { value: lpRowKey(r), text: String(r.title || r.name || lpRowKey(r)) }));
    if (!rows.length) LP.rec.append(h('option', { value: '', text: 'No records in ' + f.record }));
    LP.rec.value = LP.at.params[k];
  }
  LP.back.disabled = !LP.history.length;
}

async function lpRender() {
  clearTimeout(LP.timer);
  if (!LP.open) return;
  const seq = ++LP.seq, app = S.file.app;
  if (!app) {
    for (const f of LP.stage.querySelectorAll('iframe')) f.remove();
    LP.frame = LP.next = null; LP.scr.textContent = ''; LP.rec.hidden = true; LP.foot.textContent = '';
    const can = SLOP.api && SLOP.api.can('versions:push');
    lpSay(['This design is not an app yet. An app’s screens are real pages on the site; the preview shows them with the site’s data.'],
      { action: can && h('button', { class: 'btn sm', text: 'Make this an app…', onclick: slopAppSheet }) });
    return;
  }
  const chk = slopAppCheck();
  if (chk.errors.length) { lpSay(chk.errors, { bad: true }); return; } // the last good page stays
  let data, runtime, out;
  try {
    [data, runtime] = await Promise.all([lpLoad(), lpRuntime()]);
    out = await slopAppCompile(chk, 'live', { inline: true });
  } catch (e) {
    if (seq === LP.seq) lpSay(['Could not build the preview: ' + ((e && e.message) || e)], { bad: true });
    return;
  }
  if (seq !== LP.seq || !LP.open) return;
  const f = lpScreen(chk.screens);
  LP.at = { id: f.id, params: lpParams(f, LP.at && LP.at.id === f.id ? LP.at.params : {}) };
  const path = lpPath(f, LP.at.params);
  lpPickers(chk.screens, f);
  const boot = { route: { host: app.host, path, params: LP.at.params }, data, mode: 'preview', version: { artifact: app.page, n: 0 } };
  lpSwap(lpDocument(out.files['index.html'], boot, runtime));
  const errs = Object.entries(LP.errors).map(([n, m]) => `Could not load ${n} (${app.data[n]}): ${m}`);
  lpSay(errs, { bad: !!errs.length });
  const counts = Object.keys(data).map(n => `${n} ${data[n].length}`).join(' · ');
  LP.foot.textContent = `${path} · compiled ${new Date().toLocaleTimeString()}` + (counts ? ' · ' + counts : '') + (chk.warnings.length ? ` · ${chk.warnings.length} warning${chk.warnings.length > 1 ? 's' : ''}` : '');
  LP.foot.title = chk.warnings.join('\n');
}

// ---------- hooks ----------
// Every change, local or remote (undo and redo go through commit), and the
// selection. They do nothing while the panel is closed.
if (SLOP.mode !== 'player') {
  const committed = commit;
  commit = function (...a) { const r = committed.apply(this, a); lpSoon(); return r; };
  const remoteNode = applyRemoteNode;
  applyRemoteNode = function (...a) { const r = remoteNode.apply(this, a); lpSoon(); return r; };
  const remoteFile = applyRemoteFile;
  applyRemoteFile = function (...a) { const r = remoteFile.apply(this, a); lpSoon(); return r; };
  const selected = select;
  // Only a new selection: re-selecting the same layers must not undo a
  // screen reached by a link in the preview.
  select = function (...a) { const was = S.sel, r = selected.apply(this, a); if (!same(was, S.sel)) lpFollow(); return r; };
}
if (SLOP.mode === 'tool') {
  const loaded = onLoaded;
  onLoaded = function (...a) { const r = loaded.apply(this, a); if ((lsGet(LP_KEY, {}) || {}).open && !LP.open) lpToggle(true); return r; };
  const booted = boot;
  boot = function (...a) {
    const r = booted.apply(this, a);
    const b = h('button', { class: 'tb', id: 'bPreview', title: 'Live preview of the app page', 'aria-label': 'Live preview', 'aria-pressed': 'false', onclick: () => lpToggle() }, ico('app-window'));
    const at = $('#bSlop') || $('#bShare'); if (at) at.before(b);
    return r;
  };
}
