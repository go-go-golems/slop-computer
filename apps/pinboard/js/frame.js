/* Pinboard · inside an app's frame (phase 6): what dsl.js and render.js need,
   with the board as a copy the page keeps current and every change sent to the
   page as a message.

   An app written by someone else runs here, in a sandboxed frame with an
   opaque origin and no network: it cannot reach the page (its document, its
   runtime, the person's identity, model allowance or other stores), only this
   copy of the board and the messages below. The page applies what the app
   changes as the app ("app:<name>"), with the person's level on the board.

   page → frame: init {app, clip, S, local, sel, log, me, theme}, sync {S, sel,
     log, theme}, blob {ref, blob}
   frame → page: meta {def}, error {message}, set {patch}, param {name, value},
     mutate {ops: steps of data, see steps.js}, toast {msg}, open {name, opts},
     blob {ref} */
(function () {
  'use strict';
  const PB = window.PB = { S: { clips: {}, apps: {}, collections: {}, records: {}, meta: {} }, local: {}, log: [], track: null };
  let port = null, clip = null, def = null, sel = [], me = { id: '', name: '' };
  const send = (m) => { if (port) port.postMessage(m); };
  const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  PB.clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  PB.myId = () => me.id;
  PB.myName = () => me.name;
  PB.agent = null;
  PB.keyStop = (ev) => ev.stopPropagation();
  PB.nodeMenus = new WeakMap();
  PB.toast = (msg) => send({ t: 'toast', msg: String(msg).slice(0, 300) });

  // Images: the page fetches the asset and sends its bytes; the frame makes
  // its own URL for them (it cannot load the page's).
  const urls = {}, asked = {};
  PB.isAssetRef = (s) => typeof s === 'string' && /^blob:[^\s/:]+$/.test(s);
  PB.blobURL = (ref) => {
    if (urls[ref]) return urls[ref];
    if (!asked[ref]) { asked[ref] = true; send({ t: 'blob', ref }); }
    return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  };

  // The app's own window: state is shared (the page saves it), local is this
  // viewer's, here only.
  PB.setState = (id, patch) => {
    if (id !== clip.id) throw new Error('an app changes the state of its own window only');
    const c = PB.S.clips[id]; if (c) c.state = Object.assign({}, c.state, patch);
    send({ t: 'set', patch: plain(patch) }); redraw();
  };
  PB.setLocal = (id, patch) => { PB.local[id] = Object.assign({}, PB.local[id], patch); redraw(); };

  // c.mutate: each step is recorded here as data (steps.js, the table the
  // page checks against) and applied by the page, in one transaction. A
  // function argument (update's patch, promote's mapping) runs here, on a
  // copy. Ids of new clips and records are made here, so the app gets them
  // back at once; the page refuses an id that is taken.
  PB.mutate = (fn) => {
    const rec = PinboardSteps.recorder((store, id) => (PB.S[store] || {})[id]);
    const r = fn(rec.m);
    if (rec.steps.length) send({ t: 'mutate', ops: plain(rec.steps) });
    return r;
  };

  // The board API, narrowed: reads from the copy, changes through mutate.
  const api = {
    clips: (f) => { PB.track && PB.track('clips'); const all = Object.values(PB.S.clips); return f ? all.filter(f) : all; },
    get: (id) => PB.S.clips[id],
    find: (q) => Object.values(PB.S.clips).filter(c => PB.match(c, q)),
    selection: () => sel.map(i => PB.S.clips[i]).filter(Boolean),
    apps: () => Object.values(PB.S.apps),
    open: (name, o) => { send({ t: 'open', name: String(name), opts: plain(o || {}) }); return null; },
    toast: (m) => PB.toast(m),
    mutate: (fn) => PB.mutate(fn),
    log: (n = 50) => PB.log.slice(0, n),
    clip(spec, o = {}) {
      if (!spec || typeof spec !== 'object' || spec._isBuilder) throw new Error('board.clip({kind, …}) in a board app: note {text}, link {url}, doc {md}');
      if (!['note', 'link', 'doc'].includes(spec.kind)) throw new Error('board apps place notes, links and docs');
      return PB.mutate(m => m.place(Object.assign({ w: 220, h: 120 }, spec, o.at || {}, o.tags ? { tags: o.tags } : {})));
    },
  };
  PB.boardAPI = new Proxy(api, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string' || k === 'then' || k === 'toJSON') return undefined;
      throw new Error('board.' + k + ' is not available to board apps: they run in a frame of their own');
    },
  });
  PB.apps = {
    _capture: null,
    def: (name) => (clip && name === clip.app ? def : null),
    narrow: Object.freeze({
      open: (name, o) => api.open(name, o),
      list: () => Object.values(PB.S.apps).map(a => ({ name: a.name, title: a.title, icon: a.icon, by: a.by, version: a.version })),
    }),
  };

  // ---------- running the app ----------
  function evaluate(src) {
    const cap = []; PB.apps._capture = cap;
    try {
      const fn = new Function('ui', 'app', 'db', 'fragment', 'board', 'PB', 'helpers', '"use strict";\n' + src + '\n');
      fn(PB.ui, PB.app, PB.db, PB.fragment, PB.boardAPI, undefined, { ago: PB.ago, match: PB.match, clock: PB.clock, host: PB.host, md: PB.md, toYAML: PB.toYAML });
    } finally { PB.apps._capture = null; }
    if (!cap.length) throw new Error("the source registers nothing: end it with app('name')….register()");
    return Object.assign({}, cap[cap.length - 1], { _narrow: true });
  }
  const meta = (d) => plain({ title: d.title, icon: d.icon, about: d.about, w: d.w, h: d.h, state: d.state || {},
    params: (d.params || []).map(p => ({ name: p.name, type: p.type, def: p.def, options: p.options, min: p.min, max: p.max, step: p.step })) });

  let queued = false;
  function redraw() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); }
  function draw() {
    const root = document.getElementById('root');
    PB.rerender(root, () => {
      root.innerHTML = '';
      if (!def) return;
      const c = PB.S.clips[clip.id] || clip;
      const ctx = PB.makeCtx(c);
      if (def.toolbar) { const tb = PB.el('div', 'toolbar'); tb.append(PB.render(def.toolbar, ctx)); root.append(tb); }
      const main = PB.el('div', 'appmain'), body = PB.el('div', 'scroll');
      body.append(def.view ? PB.render(def.view, ctx) : PB.el('div', 'empty padded', 'this app has no view'));
      main.append(body);
      if (def.side) { const s = PB.el('aside', 'appside'); s.append(PB.render(def.side, ctx)); main.append(s); }
      root.append(main);
    });
  }
  function adopt(m) {
    if (m.S) PB.S = m.S;
    if (m.sel) sel = m.sel;
    if (m.log) PB.log = m.log;
    if (m.theme) document.documentElement.dataset.theme = m.theme;
  }

  // The page hands over a port in its first message; nothing else is heard.
  window.addEventListener('message', function first(ev) {
    if (port || !ev.data || ev.data.t !== 'init' || !ev.ports || !ev.ports[0]) return;
    window.removeEventListener('message', first);
    port = ev.ports[0];
    const m = ev.data;
    clip = m.clip; me = m.me || me; PB.local[clip.id] = m.local || {}; adopt(m);
    port.onmessage = (e) => {
      const d = e.data || {};
      if (d.t === 'sync') { adopt(d); redraw(); }
      if (d.t === 'blob' && d.blob) { urls[d.ref] = URL.createObjectURL(d.blob); redraw(); }
    };
    try {
      def = evaluate(m.app.source);
      send({ t: 'meta', def: meta(def) });
    } catch (e) {
      send({ t: 'error', message: String(e && e.message || e) });
      document.getElementById('root').append(PB.el('div', 'fail padded', 'app ' + m.app.name + ' failed to load: ' + (e && e.message || e)));
      return;
    }
    draw();
  });
  window.addEventListener('error', (e) => send({ t: 'error', message: String(e.message || e) }));
})();
