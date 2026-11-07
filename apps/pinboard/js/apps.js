/* Pinboard · apps: the app() builder, the registry, running a window, the built-in apps, the reference. */
(function (PB) {
  'use strict';
  const ui = PB.ui, el = PB.el;

  // The app() builder is in dsl.js (the grammar), shared with app frames.


  // ---------- registry ----------
  const defs = {};
  const framedMetas = {}; // name@sha256 → what the app's frame reported
  // An app that runs in a frame, as this page knows it: data from its record
  // (and from its frame once it reported), no code.
  function framedDef(a) {
    const m = framedMetas[a.name + '@' + (a.sha256 || a.version || 0)] || {};
    const d = { name: a.name, framed: true, _narrow: true, record: a, icon: a.icon, title: a.title, about: a.about, w: a.w || 420, h: a.h || 320, params: a.params || [], state: a.state || {} };
    Object.keys(m).forEach(k => { if (m[k] !== undefined) d[k] = m[k]; });
    return d;
  }
  const A = PB.apps = {
    _capture: null,
    // App source is evaluated with the grammar and the board API. Built-in
    // apps run in this page. Every other app runs in a sandboxed frame of its
    // own (frames.js, frame.js) and its source is never evaluated here, except
    // by registerSource, which checks what the person registering wrote.
    evalSource(src, opts = {}) {
      const cap = []; const prev = A._capture; A._capture = cap;
      try {
        const fn = new Function('ui', 'app', 'db', 'fragment', 'board', 'PB', 'helpers', '"use strict";\n' + src + '\n');
        fn(ui, PB.app, PB.db, PB.fragment, PB.boardAPI, opts.narrow ? undefined : PB, { ago: PB.ago, match: PB.match, clock: PB.clock, host: PB.host, md: PB.md, toYAML: PB.toYAML });
      } finally { A._capture = prev; }
      if (!cap.length) throw new Error('the source registers nothing: end it with app(\'name\')….register()');
      const def = cap[cap.length - 1];
      return opts.narrow ? Object.assign({}, def, { _narrow: true }) : def;
    },
    // Registering writes a new version: apps/<name> (replaced whole) and
    // apps/<name>/versions/<n>, with the author and the source's sha256.
    registerSource(src, extra = {}) {
      const def = A.evalSource(src, { narrow: true });
      delete defs[def.name];
      const old = PB.S.apps[def.name];
      const version = ((old && old !== PB.builtins[def.name] && old.version) || 0) + 1;
      const sha256 = PinboardCore.sha256(src), at = Date.now();
      // What the page needs without running the app (it runs in a frame):
      // its size, params and initial state, as data.
      const data = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
      const rec = Object.assign({ name: def.name, source: src, icon: def.icon || '△', title: def.title || def.name, about: def.about || '', shortcut: def.shortcut || '', hidden: !!def.hidden, order: def.order, version, by: PB.myName(), uid: PB.myId(), at, sha256,
        w: def.w || 420, h: def.h || 320, state: data(def.state || {}), params: data((def.params || []).map(p => ({ name: p.name, type: p.type, def: p.def, options: p.options, min: p.min, max: p.max, step: p.step }))) }, extra);
      PB.mutate(m => m.register(rec), PB.actor);
      PB.saveVersion(def.name, version, { source: src, by: rec.by, uid: rec.uid, at, sha256, note: extra.note || '' });
      // Not kept: the app runs from its record, in a frame (A.def).
      delete defs[def.name]; return def;
    },
    // Built-in apps, and apps this person wrote, run without asking; any
    // other app runs only after this person accepted that exact source.
    trusted(a) {
      if (!a) return false;
      if (a === PB.builtins[a.name]) return true;
      if (a.uid && a.uid === PB.myId()) return true;
      return PB.trust.has(a.name, a.sha256 || PinboardCore.sha256(a.source || ''));
    },
    trust(name) {
      const a = PB.S.apps[name]; if (!a) return;
      PB.trust.set(name, a.sha256 || PinboardCore.sha256(a.source || ''));
      delete defs[name];
      PB.emit('change', new Set(['apps:' + name]));
    },
    def(name) {
      if (defs[name]) return defs[name];
      const a = PB.S.apps[name]; if (!a) return null;
      if (!A.trusted(a)) return { name, untrusted: true, record: a, params: [], state: {}, icon: a.icon, title: a.title, w: 420, h: 320 };
      if (a !== PB.builtins[name]) return (defs[name] = framedDef(a));
      try { defs[name] = A.evalSource(a.source); } catch (e) { defs[name] = { name, error: e, params: [], state: {}, icon: a.icon, title: a.title }; }
      return defs[name];
    },
    // What an app's frame reports once it has evaluated the source.
    framedMeta(name, m) {
      const a = PB.S.apps[name]; if (!a || !m || typeof m !== 'object') return;
      const key = name + '@' + (a.sha256 || a.version || 0);
      const clean = { w: Number(m.w) || undefined, h: Number(m.h) || undefined, state: m.state && typeof m.state === 'object' ? m.state : undefined, params: Array.isArray(m.params) ? m.params.slice(0, 40) : undefined };
      if (JSON.stringify(framedMetas[key]) === JSON.stringify(clean)) return;
      framedMetas[key] = clean; delete defs[name];
      Object.values(PB.S.clips).filter(c => c.kind === 'app' && c.app === name).forEach(c => PB.board.renderClip(c.id));
    },
    narrow: Object.freeze({ open: (name, opts) => A.open(name, opts), list: () => A.list().map(a => ({ name: a.name, title: a.title, icon: a.icon, by: a.by, version: a.version })) }),
    invalidate(name) { if (name) delete defs[name]; else Object.keys(defs).forEach(k => delete defs[k]); },
    source: (name) => (PB.S.apps[name] || {}).source || '',
    list: () => Object.values(PB.S.apps),
    unregister(name) { delete defs[name]; PB.mutate(m => { Object.values(PB.S.clips).filter(c => c.kind === 'app' && c.app === name).forEach(c => m.close(c.id)); m.unregister(name); }, PB.actor); },
    open(name, opts = {}) {
      const def = A.def(name); if (!def) throw new Error('no app "' + name + '". Registered: ' + Object.keys(PB.S.apps).join(', '));
      const go = (pos) => { const id = PB.mutate(m => m.open(name, Object.assign({ x: pos.x, y: pos.y }, opts.state ? { state: Object.assign({}, def.state, opts.state) } : {}, opts.params ? { params: opts.params } : {}, opts.pinned ? { pinned: true } : {})), PB.actor); PB.board.front(id); PB.board.select([id]); return id; };
      if (opts.at) return go(opts.at);
      if (opts.place && PB.board.placeMode && !opts.pinned) { PB.board.pickPlace({ w: def.w || 420, h: def.h || 320 }, go, (def.title || name) + ' · click to place · Esc cancels'); return null; }
      const id = go(PB.board.nextPos()); if (!opts.place) PB.board.focus(id); return id;
    },
    edit(name) {
      const src = name ? A.source(name) : A.TEMPLATE;
      const existing = Object.values(PB.S.clips).find(c => c.kind === 'app' && c.app === 'editor');
      if (existing) { PB.setState(existing.id, { src, err: '', ok: '', name: name || '' }); PB.board.focus(existing.id); return existing.id; }
      return A.open('editor', { state: { src, err: '', ok: '', name: name || '' } });
    },
    view(clip, ctx) {
      const def = A.def(clip.app);
      const root = el('div', 'appview');
      if (!def) { root.append(el('div', 'rerr', 'app "' + clip.app + '" is not registered. Open the editor to write it, or ⌘Z.')); return root; }
      if (def.untrusted) return trustPrompt(def.record, root);
      if (def.framed) return PB.frames.view(clip, def);
      if (def.error) { root.append(el('div', 'fail', 'app ' + clip.app + ' failed to load: ' + def.error.message)); const b = el('button', 'btn sm', 'edit source'); b.addEventListener('click', () => A.edit(clip.app)); root.append(b); return root; }
      if (def.toolbar) { const tb = el('div', 'toolbar'); tb.append(PB.render(def.toolbar, ctx)); root.append(tb); }
      const main = el('div', 'appmain'); const body = el('div', 'scroll'); body.append(def.view ? PB.render(def.view, ctx) : el('div', 'empty padded', 'this app has no view')); main.append(body);
      if (def.side) { const s = el('aside', 'appside'); s.append(PB.render(def.side, ctx)); main.append(s); }
      root.append(main); return root;
    },
  };
  PB.on('mutation', (tx, keys) => { for (const k of keys) if (k.startsWith('apps:')) delete defs[k.slice(5)]; });
  PB.on('remote', (keys) => { for (const k of keys) if (k.startsWith('apps:')) delete defs[k.slice(5)]; });

  // "Moodboard v4 by Ada · run it · view source": shown instead of an app
  // written by someone else until this viewer accepts that version.
  function trustPrompt(a, root) {
    const box = el('div', 'trust padded');
    box.append(
      el('p', '', (a.title || a.name) + (a.version ? ' v' + a.version : '') + ' was written by ' + (a.by || 'someone') + (a.at ? ', ' + PB.ago(a.at) : '') + '.'),
      el('p', 'small muted', 'It runs in a frame of its own: it sees this board and can change it as you, but not your account, your model allowance or anything outside this board. Run it only if you trust ' + (a.by || 'its author') + ' with this board. You are asked again when it changes.'));
    const row = el('div', 'row');
    const run = el('button', 'btn primary sm', 'Run it'); run.addEventListener('click', () => A.trust(a.name));
    const src = el('button', 'btn sm', 'View source');
    const pre = el('pre', 'mono small srcview'); pre.textContent = a.source || ''; pre.style.display = 'none';
    src.addEventListener('click', () => { pre.style.display = pre.style.display === 'none' ? '' : 'none'; });
    row.append(run, src); box.append(row, pre); root.append(box); return root;
  }

  // ---------- built-in apps (plain sources, so the agent and the editor can read and change them) ----------
  A.TEMPLATE = [
    "// An app is one chain. Build-time lambdas get a builder (b); runtime lambdas get the context (c).",
    "app('counter')",
    "  .icon('△').title('Counter').about('a first app')",
    "  .size(260, 180)",
    "  .state({ n: 0 })",
    "  .param.slider('step', 1, { min: 1, max: 10 })",
    "  .view(ui.stack(",
    "    ui.text().bind(c => c.state.n).bold().class('bignum'),",
    "    ui.row(",
    "      ui.button('−').on('click', (ev, c) => c.set('n', c.state.n - c.param('step'))),",
    "      ui.button('+').on('click', (ev, c) => c.set('n', c.state.n + c.param('step'))),",
    "      ui.button('reset').small().on('click', (ev, c) => c.set('n', 0)),",
    "    ).gap(6),",
    "  ).pad(12).gap(10))",
    "  .agent.describe(c => 'counter at ' + c.state.n)",
    "  .register()",
  ].join('\n');

  const SRC = {};
  SRC.collections = [
    "app('collections')",
    "  .icon('▤').title('Collections').about('browse and edit any collection; double-click a cell to edit')",
    "  .size(560, 380).order(1)",
    "  .state({ coll: '' })",
    "  .toolbar(ui.row(",
    "    ui.select('coll').options(c => [{ value: '', label: 'all collections' }, ...c.db.collections().map(x => x.name)]),",
    "    ui.input('q').local().placeholder('filter rows').grow(),",
    "    ui.text(c => c.state.coll ? c.db[c.state.coll].count() + ' rows' : c.db.collections().length + ' collections').small().muted(),",
    "    ui.button('+ row').small().on('click', (ev, c) => { const n = c.state.coll; if (!n) return c.toast('pick a collection first'); c.db[n].insert({ title: 'new row' }); }),",
    "  ).gap(8).align('center'))",
    "  .view(ui.stack(",
    "    ui.when(c => !c.state.coll, ui.each(c => c.db.collections(), col =>",
    "      ui.row(ui.text(col.name).bold(), ui.text(c => c.db[col.name].count() + ' rows').small().muted(), ui.text((col.fields || []).map(f => f.name).join(' · ')).small().muted())",
    "        .gap(10).pad(6).class('rowline').on('click', (ev, c) => c.set('coll', col.name))",
    "    ).hint('no collections yet · promote a clip (◇ → promote) or ask the agent to make one')),",
    "    ui.when(c => c.state.coll, ui.table(c => c.db[c.state.coll].where(r => c.match(r, c.local.q)).orderBy('added', 'desc'), { editable: true, hint: 'no rows · drop clips here or press + row' })",
    "      .selected(c => c.local.sel)",
    "      .onRow((row, ev, c) => c.setLocal('sel', row.id))),",
    "  ).gap(4))",
    "  .side(ui.stack(",
    "    ui.h('Row', 3),",
    "    ui.when(c => c.local.sel && c.db.record(c.local.sel), ui.stack(",
    "      ui.kv(c => { const r = Object.assign({}, c.db.record(c.local.sel)); delete r.coll; return r; }),",
    "      ui.row(",
    "        ui.button('pop out').small().on('click', (ev, c) => { const r = c.db.record(c.local.sel); if (!r) return; if (r.clipId && c.board.get(r.clipId)) return c.board.focus(r.clipId); c.board.clip(r.src ? ui.image(r.src) : r.url ? ui.link(r.url).title(r.title || '') : ui.note(r.text || r.title || '')).title(r.title || '').near(c.window); }),",
    "        ui.button('delete').small().on('click', (ev, c) => { c.db[c.state.coll].remove(c.local.sel); c.setLocal('sel', null); }),",
    "      ).gap(6),",
    "    ), ui.text('click a row').small().muted()),",
    "    ui.sep(),",
    "    ui.h('Fields', 3),",
    "    ui.each(c => c.state.coll ? ((c.db[c.state.coll].schema() || {}).fields || []) : [], f => ui.text(f.name + ' : ' + f.type + (f.required ? ' !' : '')).small().mono()),",
    "    ui.dropzone({ accepts: ['clip:*'] }).hint('drop a clip to add it as a row').on('drop', (it, c) => { const n = c.state.coll; if (!n) return c.toast('pick a collection first'); (it.clipIds || [it.clipId]).forEach(id => c.board.clip(id).promote(n)); }),",
    "  ).gap(8))",
    "  .agent.describe(c => c.state.coll ? 'collections browser on ' + c.state.coll + ' (' + c.db[c.state.coll].count() + ' rows, filter \"' + c.local.q + '\")' : 'collections browser, list view')",
    "  .register()",
  ].join('\n');

  SRC.editor = [
    "app('editor')",
    "  .icon('λ').title('App editor').about('write an app with the grammar; ⌘↩ registers it').size(680, 460).order(9)",
    "  .state({ src: '', err: '', ok: '', name: '' })",
    "  .toolbar(ui.row(",
    "    ui.text(c => c.state.name ? 'editing ' + c.state.name : 'new app').bold(),",
    "    ui.spacer(),",
    "    ui.button('Reference').small().on('click', (ev, c) => c.board.open('reference')),",
    "    ui.button('Describe IR').small().on('click', (ev, c) => { try { const d = c.apps.evalSource(c.state.src); c.set('ok', (d.view ? d.view.describe() : 'no view').slice(0, 4000)); c.set('err', ''); } catch (e) { c.set('err', e.message); } }),",
    "    ui.button('Register · ⌘↩').primary().on('click', (ev, c) => c.apps.registerFromEditor(c)),",
    "  ).gap(8).align('center'))",
    "  .view(ui.stack(",
    "    ui.input('src').code().rows(16).grow().placeholder('app(\\'name\\')…register()').on('submit', (ev, c) => c.apps.registerFromEditor(c)),",
    "    ui.when(c => c.state.err, ui.text(c => c.state.err).class('fail').mono()),",
    "    ui.when(c => c.state.ok, ui.text(c => c.state.ok).small().mono().muted()),",
    "  ).gap(6).class('editorstack'))",
    "  .agent.describe(c => 'app editor' + (c.state.name ? ' on ' + c.state.name : '') + (c.state.err ? ' · error: ' + c.state.err : ''))",
    "  .register()",
  ].join('\n');
  A.registerFromEditor = function (c) {
    try { const def = A.registerSource(c.state.src); c.set({ err: '', ok: 'registered ' + def.name + ' · ' + PB.clock(Date.now()), name: def.name }); PB.toast('registered ' + def.name, 'ok'); const open = Object.values(PB.S.clips).find(x => x.kind === 'app' && x.app === def.name); if (open) Object.values(PB.S.clips).filter(x => x.kind === 'app' && x.app === def.name).forEach(x => PB.board.renderClip(x.id)); else A.open(def.name); }
    catch (e) { c.set({ err: e.message, ok: '' }); }
  };

  SRC.moodboard = [
    "const palette = fragment('palette')",
    "  .attr('swatches', [])",
    "  .decorate(b => b.footer(ui.row(ui.each(c => (b.attrs.swatches || []), s => ui.swatch(s).width(14).height(6))).gap(2)))",
    "",
    "app('moodboard')",
    "  .icon('▦').title('Moodboard').about('images in a grid; drop images or image clips in').size(560, 420).order(2)",
    "  .param.slider('cols', 3, { min: 1, max: 6 })",
    "  .param.slider('gap', 8, { min: 0, max: 24, unit: 'px' })",
    "  .param.select('by', 'added', ['added', 'caption', 'tag'])",
    "  .param.toggle('captions', true)",
    "  .state({})",
    "  .toolbar(ui.row(",
    "    ui.input('q').local().placeholder('search captions and tags').grow(),",
    "    ui.segmented('by'),",
    "    ui.text(c => c.db.moodboard.count() + ' images').small().muted(),",
    "  ).gap(8).align('center'))",
    "  .view(ui.dropzone({ accepts: ['clip:image', 'Files'] })",
    "    .hint('drop images or image clips anywhere here · double-click one to pop it out')",
    "    .on('drop', async (it, c) => {",
    "      const files = it.files ? it.files.filter(f => f.type.startsWith('image/')) : [];",
    "      for (const f of files) { const id = await c.board.putBlob(f); c.db.moodboard.insert({ src: id, caption: f.name.replace(/\\.[a-z]+$/i, ''), tags: [] }); }",
    "      (it.clipIds || (it.clipId ? [it.clipId] : [])).forEach(cid => { const k = c.board.get(cid); if (k && k.kind === 'image' && k.blobId) c.db.moodboard.insert({ src: k.blobId, caption: k.title || k.caption || '', tags: k.tags || [], clipId: cid }); });",
    "    })",
    "    .child(ui.grid(ui.each(c => c.db.moodboard.where(r => c.match([r.caption, r.tags], c.local.q)).orderBy(c.param('by') === 'added' ? ['added', 'desc'] : c.param('by') === 'caption' ? 'caption' : 'tags.0'), im =>",
    "      ui.image(im.src).caption(ui.when(c => c.param('captions'), ui.text(im.caption || '').small()))",
    "        .selected(c => c.local.sel === im.id)",
    "        .on('click', (ev, c) => c.setLocal('sel', im.id))",
    "        .on('dblclick', (ev, c) => c.board.clip(ui.image(im.src)).title(im.caption || '').tag(...(im.tags || [])).near(c.window))",
    "        .draggable({ kind: 'clip:image', payload: () => ({ src: im.src, title: im.caption, tags: im.tags }) })",
    "        .menu([",
    "          { label: 'pop out as a clip', run: (c) => c.board.clip(ui.image(im.src)).title(im.caption || '').tag(...(im.tags || [])).near(c.window) },",
    "          { label: 'caption…', run: (c) => { const t = prompt('caption', im.caption || ''); if (t != null) c.db.moodboard.update(im.id, { caption: t }); } },",
    "          { label: 'remove from moodboard', run: (c) => c.db.moodboard.remove(im.id) },",
    "        ])",
    "    ).id('images')).masonry().cols(c => c.param('cols')).gap(c => c.param('gap'))))",
    "  .side(ui.stack(",
    "    ui.h('Selected', 3),",
    "    ui.when(c => c.local.sel && c.db.record(c.local.sel), ui.stack(",
    "      ui.input('caption').local().placeholder('caption').on('change', (v, ev, c) => c.db.moodboard.update(c.local.sel, { caption: v })),",
    "      ui.text(c => 'added ' + c.ago(c.db.record(c.local.sel).added)).small().muted(),",
    "      ui.row(ui.each(c => c.db.record(c.local.sel).tags || [], t => ui.chip(t))).gap(4).wrap(),",
    "      ui.input('tag').local().placeholder('add a tag, Enter').on('enter', (ev, c) => { const t = c.local.tag; if (!t) return; c.db.moodboard.update(c.local.sel, r => ({ tags: [...new Set([...(r.tags || []), t])] })); c.setLocal('tag', ''); }),",
    "      ui.button('remove').small().on('click', (ev, c) => { c.db.moodboard.remove(c.local.sel); c.setLocal('sel', null); }),",
    "    ).gap(6), ui.text('click an image').small().muted()),",
    "  ).gap(8))",
    "  .menu([{ label: 'clear the search', when: (c) => !!c.local.q, run: (c) => c.setLocal('q', '') }, { label: 'add all image clips on the board', run: (c) => c.board.clips(k => k.kind === 'image' && k.blobId).forEach(k => c.db.moodboard.insert({ src: k.blobId, caption: k.title || '', tags: k.tags || [], clipId: k.id })) }])",
    "  .agent.describe(c => 'moodboard: ' + c.db.moodboard.count() + ' images, by ' + c.param('by') + (c.local.q ? ', filter \"' + c.local.q + '\"' : ''))",
    "  .agent.allow(['insert', 'update', 'tag'])",
    "  .agent.suggest(['caption the untitled images', 'tag images by what they show (send them to me)', 'make a palette note from the selection'])",
    "  .register()",
  ].join('\n');

  SRC.reading = [
    "app('reading')",
    "  .icon('○').title('Reading list').about('links to read; drop link clips in').size(420, 360).order(3)",
    "  .param.select('show', 'unread', ['unread', 'read', 'all'])",
    "  .state({})",
    "  .toolbar(ui.row(ui.input('q').local().placeholder('search').grow(), ui.segmented('show'), ui.text(c => c.db.reading.where(r => !r.read).count() + ' to read').small().muted()).gap(8).align('center'))",
    "  .view(ui.dropzone({ accepts: ['clip:link', 'text/uri-list'] })",
    "    .hint('drop links here')",
    "    .on('drop', (it, c) => { const ids = it.clipIds || (it.clipId ? [it.clipId] : []); if (!ids.length && it.url) return c.db.reading.insert({ url: it.url, title: it.title || '', read: false }); ids.forEach(id => { const k = c.board.get(id); if (k && k.url) c.db.reading.insert({ url: k.url, title: k.title || '', read: false, tags: k.tags || [], clipId: id }); }); })",
    "    .child(ui.each(c => c.db.reading.where(r => (c.param('show') === 'all' || (c.param('show') === 'read') === !!r.read) && c.match([r.title, r.url], c.local.q)).orderBy('added', 'desc'), r =>",
    "      ui.row(",
    "        ui.button(r.read ? '■' : '□').small().tooltip(r.read ? 'mark unread' : 'mark read').on('click', (ev, c) => c.db.reading.update(r.id, { read: !r.read })),",
    "        ui.link(r.url).title(r.title || undefined).grow().draggable({ kind: 'clip:link', payload: () => ({ url: r.url, title: r.title }) }),",
    "        ui.button('×').small().on('click', (ev, c) => c.db.reading.remove(r.id)),",
    "      ).gap(8).align('center').class('rowline')",
    "    ).id('links').hint('nothing here · drop a link clip, or paste a URL on the board and drag it in')))",
    "  .agent.describe(c => 'reading list: ' + c.db.reading.where(r => !r.read).count() + ' unread of ' + c.db.reading.count())",
    "  .register()",
  ].join('\n');

  SRC.reference = [
    "app('reference')",
    "  .icon('▸').title('Reference').about('the grammar, the board API and the agent, in one page').size(620, 480).order(8)",
    "  .view(ui.doc(PB.REFERENCE).class('refdoc'))",
    "  .register()",
  ].join('\n');

  SRC.log = [
    "app('log')",
    "  .icon('≡').title('Board log').about('every change on this board, by everyone; revert puts a step back where nobody has changed those things since').size(560, 320).order(7)",
    "  .view(ui.each(c => { c.board.clips(); return c.board.log(80); }, (e) => ui.row(",
    "      ui.text(e.line).mono().small().grow(1).muted(e.undone),",
    "      e.undone ? ui.text('reverted').small().muted() : ui.button('revert').small().on('click', (ev, c) => { const r = c.board.revert(e.id); c.toast(r.reverted ? 'reverted ' + r.reverted + (r.kept ? ' · kept ' + r.kept + ' changed since' : '') : 'nothing to revert: changed since'); })",
    "    ).gap(6).class('rowline')).id('lines').hint('no changes yet'))",
    "  .toolbar(ui.row(ui.button('undo mine').small().on('click', (ev, c) => c.board.undo()), ui.button('redo').small().on('click', (ev, c) => c.board.redo()), ui.text(c => { c.board.clips(); return PB.history.idx + ' of my ' + PB.history.txs.length + ' in this tab'; }).small().muted()).gap(6))",
    "  .register()",
  ].join('\n');

  A.BUILTIN = SRC;
  A.seed = function () {
    // Built-in apps ship with the code: they live in memory (PB.builtins), are
    // never written to a board, and a board's own app of the same name wins.
    Object.keys(SRC).forEach(name => {
      try {
        const def = A.evalSource(SRC[name]);
        const rec = { name: def.name, source: SRC[name], icon: def.icon || '△', title: def.title || def.name, about: def.about || '', shortcut: def.shortcut || '', hidden: !!def.hidden, order: def.order, builtin: 'v1' };
        PB.builtins[def.name] = rec;
        if (!PB.S.apps[def.name]) { PB.S.apps[def.name] = rec; defs[def.name] = def; }
      } catch (e) { console.error('seed ' + name, e); }
    });
    PB.history.txs.length = 0; PB.history.idx = 0;
  };

  // ---------- the reference (read by people in the Reference app and by the agent) ----------
  PB.REFERENCE = [
    "# Pinboard reference",
    "A pinboard of windows (clips) with an agent, and a grammar for little apps. Builders are immutable: every call returns a new one. A lambda that receives a builder (b) runs at build time; one that receives the context (c) runs at runtime and is re-run when what it read changes.",
    "",
    "## Atoms (ui.*)",
    "- `ui.text(v)` `ui.h(v, level)` `ui.note(text)` `ui.doc(markdown)` `ui.image(src)` `ui.link(url)` `ui.chip(t)` `ui.swatch(hex)` `ui.kv(pairs)` `ui.sep()` `ui.spacer()`",
    "- `ui.input(key)` writes state.key (`.multiline()` `.code()` `.placeholder()` `.on('enter'|'submit'|'change', …)`); `ui.button(label).on('click', (ev, c) => …)`",
    "- `ui.stack(…)` `ui.row(…)` `ui.grid(…).cols(n).masonry()` `ui.list(items, it => …)` (build-time, expanded once) `ui.each(source, it => …)` (runtime; source is an array, a query or `c => query`)",
    "- `ui.when(c => cond, then, else)` `ui.table(rows, { columns, editable, hint }).onRow((row, ev, c) => …)` `ui.dropzone({ accepts: ['clip:link', 'clip:image', 'Files', 'text/uri-list'] }).hint(…).on('drop', (item, c) => …).child(…)`",
    "- `ui.segmented(key)` `ui.select(key).options([...])` `ui.toggle(key, label)` `ui.slider(key, { min, max })` — key is a param (if the app declares one) or a state key",
    "- Modifiers on anything: `.gap(px|'s')` `.pad()` `.size(w, h)` `.grow()` `.align()` `.wrap()` `.small()` `.bold()` `.mono()` `.muted()` `.class()` `.id()` `.when(c => …)` `.bind(c => value)` `.map(b => b…)` `.use(fragment)` `.selected(c => …)` `.draggable({ kind, payload })` `.caption()` `.footer()` `.hint()` `.tooltip()`",
    "- Prop values can be lambdas of the context: `.cols(c => c.param('cols'))`. Handlers get the context last: `(ev, c)`, `(row, ev, c)`, `(item, c)`, `(value, ev, c)`.",
    "- `b.build()` → IR (`.nodes`, `.node(id)`, `.toYAML()`, `.diff(other)`); `b.describe()` → YAML; `b.mount(el, ctx)`.",
    "",
    "## Context (c) inside runtime lambdas",
    "`c.state.k` · `c.set(k, v)` or `c.set({…})`: shared, kept in the clip, seen by everyone on the board · `c.local.k` · `c.setLocal(k, v)`: this viewer only, this tab only (a search box, a selected row); `ui.input('q').local()` binds an input to `c.local` · `c.param(name)` · `c.setParam(name, v)` · `c.db` · `c.board` · `c.window` (this clip) · `c.attr('tags')` · `c.sel()` (bound record) · `c.mutate(m => …)` · `c.toast(msg)` · `c.apps` · `c.ago` `c.match` `c.clock`",
    "",
    "## Apps",
    "```",
    "app('name').icon('△').title('…').about('…').shortcut('⌘⇧M').size(w, h)",
    "  .state({ q: '' })",
    "  .param.slider('cols', 3, { min: 1, max: 8 }).param.toggle('captions', true).param.select('by', 'added', ['added', 'hue']).param.text('prefix', '')",
    "  .toolbar(ui.row(…)).view(…).side(…)",
    "  .agent.describe(c => '…').agent.allow(['insert']).agent.suggest(['…'])",
    "  .register()",
    "```",
    "Apps are kept as source on the board (apps/<name>, every version in apps/<name>/versions/<n> with its author and sha256) and re-evaluated at load. Only board admins register apps. Everyone else's app runs for a person only after they accept that version (a prompt in its window); built-in apps and your own run at once. Board apps run in a sandboxed frame of their own (no network, no access to this page): they get a copy of the board, kept current, and their changes are applied as `app:<name>` with your level on the board; `c` has no `agent()`, only `apps.open`/`apps.list`, and `board` only reads, `clip`, `open`, `mutate`, `toast` and `log`. `apps.open(name, { state, params })`, `apps.edit(name)`, `apps.registerSource(src)`, `apps.source(name)`, `apps.unregister(name)`, `apps.list()`.",
    "",
    "## Fragments",
    "`fragment('taggable').attr('tags', []).method('tag', (b, ...t) => b.set('tags', x => [...x, ...t])).query('hasTag', (node, t) => …).decorate(b => b.footer(…)).on('paste', (b, data) => …)`; use with `.use(taggable)`; `.global()` adds its methods to every builder. Every clip carries taggable, sourced, bound and annotated.",
    "",
    "## Collections (db)",
    "`db.collection('recipes').field('title', 'text').required().field('url', 'url').field('serves', 'int').field('tags', 'text[]').field('added', 'time').auto().index('tags')` · `db.recipes.insert({…})` `.update(id, patch | r => patch)` `.remove(id)` `.where(r => …)` `.orderBy('added', 'desc')` `.limit(n)` `.all()` `.count()` `.get(id)` `.first()` `.distinct('tags')` `.schema()` · `db.collections()` `db.record(id)` · migrations: `db.collection('x').migrate(2, s => s.rename('serves', 'servings'))`. Image fields hold a blob id (`blob:…`) from `board.putBlob(file)`.",
    "",
    "## Board",
    "- `board.clip(ui.note('…') | ui.link(url) | ui.doc(md) | ui.image(blobId))` → placer: `.at(x, y)` `.near(window)` `.tag(…)` `.title(…)` `.pin()`; `board.clip(id)` → `.promote(coll, clip => row)` `.set(patch)` `.remove()` `.clip`",
    "- Right-click menus: `.menu([{ label, run(c), when?(c), hint? }, '-'])` on any builder adds items to that element; `app(…).menu([...])` adds items to the window; `board.menu('canvas' | 'clip' | 'clip:image' | 'app:name', items)` adds them board-wide (call it in an app's source so it is re-registered at load).",
    "- `board.clips(filter?)` `board.get(id)` `board.selection()` `board.select(ids)` `board.find(q)` `board.focus(id)` `board.filter({ tag, q })` `board.open(app, { state, params, at, place })` `board.pickPlace({ w, h })` (resolves with a position the person clicks) `board.minimap(on)` `board.openCollection(name)` `board.putBlob(file)` `board.toast(msg)` `board.history()` `board.undo()` `board.describe()` `board.export(ids)` `board.import(data)`",
    "- Mutations are the only way state changes: `m(x => x.move(id, {x, y}).retitle(id, t).tag(id, …).untag().setAttr(id, patch).remove(id).group(ids, {title}).ungroup(gid).pin(id, bool).open(app, opts).close(id).setParam(id, name, v).setState(id, patch).insert(coll, data).update(coll, id, patch).removeRecord(coll, id).promote(clipId, coll, fn).demote(clipId).collection(name, schema).register(def).unregister(name))` — one call is one transaction and one undo step.",
    "",
    "## Clips",
    "Kinds: note (text), link (url, title, desc), image (blobId, dims, caption), doc (md), app (app, state, params), group (children). Every clip: id, title, tags, note, x y w h, pinned, binding {coll, id}, source {from, at}. Paste or drop anything on the board to make one; double-click the canvas for a note; n for a note; ⌘K quicklaunch; ⌘Z undo; ⌘C/⌘V copy clips between boards; ⌘G group; ⌘P pin; Tab opens properties; drag a strip onto another strip to group, onto an app's dropzone to add, onto the dock to make it an app, to the right edge to pin.",
    "",
    "## The agent",
    "One tool, `eval`: its input is JavaScript (the body of an async function) run against `board, db, ui, app, apps, m, describe, log, fragment, PB`. The result comes back as YAML, cut at 9,000 characters. Modes: Auto runs each step, Ask waits for Run this step or Decline, Read-only makes every mutation throw. Each step records where the history was, so Revert undoes back to before it. Image clips are sent to the agent as images when they are selected, when the message names them, or when you paste an image into the composer.",
  ].join('\n');
})(window.PB);
