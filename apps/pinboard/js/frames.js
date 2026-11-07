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
      docP = Promise.all(['style.css', 'js/frame.js', 'js/dsl.js', 'js/render.js'].map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f + ': ' + r.status); return r.text(); })))
        .then(([css, frame, dsl, render]) => '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + POLICY + '">' +
          '<style>' + css + FRAME_CSS + '</style></head><body><div id="root" class="appview"></div>' +
          [frame, dsl, render].map(s => '<script>' + s.replace(/<\/script/gi, '<\\/script') + '</' + 'script>').join('') + '</body></html>');
      docP.catch(() => { docP = null; });
    }
    return docP;
  }

  // What a frame sees of the board: everything but the apps' sources.
  function snapshot() {
    const apps = {};
    Object.values(PB.S.apps).forEach(a => { apps[a.name] = { name: a.name, title: a.title, icon: a.icon, about: a.about, by: a.by, version: a.version }; });
    return JSON.parse(JSON.stringify({ clips: PB.S.clips, records: PB.S.records, collections: PB.S.collections, meta: PB.S.meta, apps }));
  }
  const logLines = () => (PB.log || []).slice(0, 50).map(e => ({ id: e.id, at: e.at, by: e.by, label: e.label, undone: !!e.undone }));
  const selection = () => (PB.board && PB.board.sel ? [...PB.board.sel] : []);
  const theme = () => document.documentElement.dataset.theme || 'light';

  // The steps an app may take, and how each is checked. Ids of new clips and
  // records come from the frame; a taken or malformed one is dropped.
  const freshClip = (id) => typeof id === 'string' && /^clip:[a-z0-9]{10}$/.test(id) && !PB.S.clips[id];
  const STEPS = {
    place: ([c]) => { c = Object.assign({}, c); if (!freshClip(c.id)) delete c.id; if (c.kind === 'app') throw new Error('open apps with m.open'); return [c]; },
    open: ([name, o]) => { o = Object.assign({}, o); if (!freshClip(o.id)) delete o.id; return [String(name), o]; },
    setAttr: ([id, patch]) => { const p = Object.assign({}, patch); delete p.id; delete p.kind; delete p.app; return [id, p]; },
    insert: ([coll, data]) => [String(coll), data],
    promote: ([id, coll]) => [id, String(coll)],
  };
  ['move', 'resize', 'retitle', 'tag', 'untag', 'remove', 'group', 'ungroup', 'pin', 'close', 'setParam', 'setState', 'collection', 'update', 'removeRecord', 'demote'].forEach(op => { STEPS[op] = (args) => args; });

  const live = new Map(); // clip id → { iframe, port, app }
  function handle(id, name, d) {
    const f = live.get(id); if (!f) return;
    const by = 'app:' + name;
    try {
      switch (d.t) {
        case 'meta': PB.apps.framedMeta(name, d.def); break;
        case 'error': console.warn('app ' + name + ': ' + d.message); break;
        case 'toast': PB.toast(name + ' · ' + String(d.msg).slice(0, 300)); break;
        case 'set': if (d.patch && typeof d.patch === 'object') PB.setState(id, d.patch); break;
        case 'open': PB.apps.narrow.open(String(d.name), d.opts || {}); break;
        case 'blob': if (PB.isAssetRef(d.ref)) PB.fetchBlob(d.ref).then(blob => f.port.postMessage({ t: 'blob', ref: d.ref, blob })).catch(() => {}); break;
        case 'mutate': {
          const ops = Array.isArray(d.ops) ? d.ops.slice(0, 500) : [];
          const steps = ops.map(o => { const check = STEPS[o && o.op]; if (!check) throw new Error(name + ' may not ' + (o && o.op)); return [o.op, check(Array.isArray(o.args) ? o.args : [])]; });
          PB.mutate(m => { steps.forEach(([op, args]) => m[op](...args)); }, by);
          break;
        }
      }
    } catch (e) { PB.toast('⚠ ' + name + ': ' + e.message); }
  }

  function connect(clip, iframe, name) {
    const ch = new MessageChannel();
    live.set(clip.id, { iframe, port: ch.port1, app: name });
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
      live.forEach((f, id) => { if (!f.iframe.isConnected) { live.delete(id); return; } f.port.postMessage({ t: 'sync', S, sel, log, theme: th }); });
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
  };
})(window.PB);
