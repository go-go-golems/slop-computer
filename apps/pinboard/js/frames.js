/* Pinboard · app frames (phase 6): every app that is not built in runs in a
   sandboxed frame of its own (js/frame.js inside), never in this page.

   The frame has an opaque origin (sandbox="allow-scripts", no
   allow-same-origin) and a policy without network or outside images, so the
   app sees neither this page nor the person's runtime (identity, model
   allowance, other stores). It gets a copy of the board, kept current, and
   sends what it wants changed; this page applies those steps as the app,
   under the person's level on the board, and only the steps an app may take. */
(function (PB) {
  'use strict';
  const el = PB.el;

  // The frame document: the page's own style and grammar, with a policy that
  // allows only its inline code (and the app's source, evaluated there),
  // inline styles and images the frame made itself: no network at all.
  const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:";
  const FRAME_CSS = 'html,body{margin:0;height:100%;background:var(--fill);overflow:hidden}#root{height:100%;display:flex;flex-direction:column}#root>.appmain{flex:1;min-height:0}';
  let docP = null;
  function frameDoc() {
    if (!docP) {
      docP = Promise.all(['style.css', 'js/steps.js', 'js/frame.js', 'js/dsl.js', 'js/render.js'].map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f + ': ' + r.status); return r.text(); })))
        .then(([css, steps, frame, dsl, render]) => '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + POLICY + '">' +
          '<style>' + css + FRAME_CSS + '</style></head><body><div id="root" class="appview"></div>' +
          [steps, frame, dsl, render].map(s => '<script>' + s.replace(/<\/script/gi, '<\\/script') + '</' + 'script>').join('') + '</body></html>');
      docP.catch(() => { docP = null; });
    }
    return docP;
  }

  // What a frame sees of the board: everything but the apps' sources, and
  // only the board's shared meta. PB.S.meta also holds this viewer's own
  // keys (their view document: agent threads, view), which no app may read.
  function snapshot() {
    const apps = {};
    Object.values(PB.S.apps).forEach(a => { apps[a.name] = { name: a.name, title: a.title, icon: a.icon, about: a.about, by: a.by, version: a.version }; });
    return JSON.parse(JSON.stringify({ clips: PB.S.clips, records: PB.S.records, collections: PB.S.collections, meta: PB.sharedMeta(), apps }));
  }
  const logLines = () => (PB.log || []).slice(0, 50).map(e => ({ id: e.id, at: e.at, by: e.by, label: e.label, undone: !!e.undone }));
  const selection = () => (PB.board && PB.board.sel ? [...PB.board.sel] : []);
  const theme = () => document.documentElement.dataset.theme || 'light';

  // The steps an app may take are steps.js's table: each one is checked
  // there (shape, fresh ids, what an app may not change) before core runs it
  // as the app. An unknown or malformed step fails the whole transaction.
  const page = { has: (store, id) => !!(PB.S[store] || {})[id], fromClip: (c) => PinboardCore.fromClip(c) };

  const live = new Map(); // clip id → { iframe, port, app }
  function handle(id, name, d) {
    const f = live.get(id); if (!f) return;
    const by = 'app:' + name;
    try {
      switch (d.t) {
        case 'meta': PB.apps.framedMeta(name, d.def); break;
        case 'error': console.warn('app ' + name + ': ' + d.message); break;
        case 'toast': PB.toast(name + ' · ' + String(d.msg).slice(0, 300)); break;
        case 'dropped': PB.toast(d.ok ? 'dropped into ' + name : name + ' takes nothing dropped there', d.ok ? 'ok' : undefined); break;
        case 'set': if (d.patch && typeof d.patch === 'object') PB.setState(id, d.patch); break;
        case 'open': PB.apps.narrow.open(String(d.name), d.opts || {}); break;
        case 'blob': if (PB.isAssetRef(d.ref)) PB.fetchBlob(d.ref).then(blob => f.port.postMessage({ t: 'blob', ref: d.ref, blob })).catch(() => {}); break;
        case 'mutate': {
          // The frame keeps this batch over its copy until a sync says the
          // page handled it (applied or refused): ack.
          f.ack = Math.max(f.ack || 0, Number(d.seq) || 0);
          try {
            const ops = Array.isArray(d.ops) ? d.ops.slice(0, 500) : [];
            const steps = ops.map(o => [o && o.op, PinboardSteps.check(o && o.op, o && o.args, page)]);
            PB.mutate(m => { steps.forEach(([op, args]) => m[op](...args)); }, by);
          } finally { sync(); }
          break;
        }
      }
    } catch (e) { PB.toast('⚠ ' + name + ': ' + e.message); }
  }

  function connect(clip, iframe, name) {
    const ch = new MessageChannel();
    live.set(clip.id, { iframe, port: ch.port1, app: name, ack: 0 });
    ch.port1.onmessage = (ev) => handle(clip.id, name, ev.data || {});
    const a = PB.S.apps[name] || {};
    iframe.contentWindow.postMessage({ t: 'init', app: { name, source: a.source || '', version: a.version }, clip: JSON.parse(JSON.stringify(PB.S.clips[clip.id] || clip)),
      S: snapshot(), local: PB.local[clip.id] || {}, sel: selection(), log: logLines(), me: { id: PB.myId(), name: PB.myName() }, theme: theme() }, '*', [ch.port2]);
  }

  // One copy per animation frame, to every live frame.
  let pending = false;
  function sync() {
    if (pending || !live.size) return; pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const S = snapshot(), sel = selection(), log = logLines(), th = theme();
      live.forEach((f, id) => { if (!f.iframe.isConnected) { live.delete(id); return; } f.port.postMessage({ t: 'sync', S, sel, log, theme: th, ack: f.ack || 0 }); });
    });
  }
  PB.on('change', sync);
  PB.on('selection', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  PB.frames = {
    // The body of an app window: one frame, kept for as long as the window
    // shows that version of the app (board.js leaves it in place).
    view(clip, def) {
      const wrap = el('div', 'appframe');
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.title = (def.title || clip.app) + ' (a board app, in its own frame)';
      iframe.addEventListener('load', () => { if (iframe.srcdoc) connect(clip, iframe, clip.app); });
      wrap.append(iframe);
      frameDoc().then(doc => { iframe.srcdoc = doc; }).catch(e => wrap.replaceChildren(el('div', 'fail padded', 'the app frame could not be built: ' + e.message)));
      return wrap;
    },
    live: () => live.size,
    snapshot,
    // A board drag released over an app's frame (board.js): the page cannot
    // see the frame's dropzones, so the frame finds the one at that point,
    // in its own coordinates (the board may be zoomed), and fires it.
    drop(iframe, item, clientX, clientY) {
      const f = [...live.values()].find(x => x.iframe === iframe);
      if (!f) return false;
      const r = iframe.getBoundingClientRect(), k = iframe.offsetWidth / (r.width || 1);
      const at = { t: 'drop', x: (clientX - r.left) * k, y: (clientY - r.top) * k };
      try { f.port.postMessage(Object.assign(at, { item })); } catch (e) { f.port.postMessage(Object.assign(at, { item: JSON.parse(JSON.stringify(Object.assign({}, item, { image: null }))) })); }
      return true;
    },
  };
})(window.PB);
