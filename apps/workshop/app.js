// The Workshop's page (SLOP3-002). It holds no authority: every read and
// change is an action of the Workshop's actor, which uses the workshop
// module as the visitor. The preview runs on its own sandbox origin with
// the bridge; this page talks to it only by postMessage, checking origins.
(async () => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'dataset') Object.assign(e.dataset, v);
      else e[k] = v;
    }
    for (const k of kids) if (k != null && k !== false) e.append(k);
    return e;
  };
  const say = (t, bad) => {
    const m = $('msg');
    m.textContent = t;
    m.className = 'msg on' + (bad ? ' bad' : '');
    clearTimeout(say.t);
    say.t = setTimeout(() => { m.className = 'msg'; }, bad ? 6000 : 2500);
  };

  const [slop, db] = await Promise.all([claude.use('slop'), claude.use('db')]);
  if (!slop) { say('This page needs the slop runtime.', true); return; }
  const act = async (name, args) => {
    try {
      return await slop.actions[name](args || {});
    } catch (e) {
      say(`${e.code || 'error'}: ${e.message}`, true);
      throw e;
    }
  };

  const frame = $('frame');
  const state = { stores: [], store: '', snaps: [], refs: {}, n: 0, threads: [], origin: '', focus: '', anchor: null, picking: false, off: null };

  // --- stores and snapshots ---------------------------------------------

  async function overview() {
    state.stores = await act('overview');
    renderStores();
  }

  function renderStores() {
    const items = state.stores.map((s) => el('li', { className: s.id === state.store ? 'on' : '', dataset: { store: s.id }, onclick: () => openStore(s.id) },
      el('span', {}, s.id),
      el('span', {},
        s.refs.draft && s.refs.draft !== s.refs.main ? el('span', { className: 'tag draft' }, '#' + s.refs.draft) : null,
        s.open ? el('span', { className: 'tag' }, s.open + ' open') : null)));
    $('stores').replaceChildren(...(items.length ? items : [el('li', { className: 'dim' }, 'Nothing to review.')]));
  }

  async function openStore(id, n) {
    state.store = id;
    renderStores();
    const s = await act('store', { store: id });
    state.snaps = s.snapshots;
    state.refs = s.refs;
    state.n = n || s.refs.draft || s.refs.main || (s.snapshots[0] && s.snapshots[0].n) || 0;
    watch();
    renderSnaps();
    await preview();
  }

  function renderSnaps() {
    const refs = state.refs;
    $('crumb').textContent = '▸ ' + state.store;
    $('refs').textContent = [refs.draft ? 'draft #' + refs.draft : '', refs.main ? 'main #' + refs.main : ''].filter(Boolean).join(' · ');
    $('snaps-h').hidden = false;
    $('snaps').replaceChildren(...state.snaps.map((sn) => el('li', { className: sn.n === state.n ? 'on' : '', dataset: { n: String(sn.n) }, onclick: () => show(sn.n) },
      el('span', {}, '#' + sn.n + ' ', el('span', { className: 'dim' }, (sn.message || '').slice(0, 24))),
      el('span', {}, ...Object.entries(refs).filter(([, v]) => v === sn.n).map(([k]) => el('span', { className: 'tag ' + k }, k))))));
    const pub = $('publish');
    pub.hidden = !state.n || state.n === refs.main;
    pub.textContent = 'Publish #' + state.n;
  }

  function show(n) {
    state.n = n;
    renderSnaps();
    preview();
  }

  // refresh reloads the snapshots and refs (an agent pushed a new draft).
  async function refresh() {
    const s = await act('store', { store: state.store });
    state.snaps = s.snapshots;
    state.refs = s.refs;
    renderSnaps();
  }

  $('publish').onclick = async () => {
    const n = state.n;
    await act('publish', { store: state.store, n });
    say(`Published #${n}: ${state.store} now serves it`);
    await openStore(state.store, n);
    overview();
  };

  // --- the preview and its bridge ---------------------------------------

  async function preview() {
    const p = await act('preview', { store: state.store, n: state.n, parent: location.origin });
    state.origin = new URL(p.url).origin;
    frame.src = p.url;
    $('at').textContent = `${state.store} #${state.n}`;
    $('pick').disabled = false;
    setPick(false);
  }

  function send(m) {
    if (state.origin && frame.contentWindow) frame.contentWindow.postMessage({ slop: 1, ...m }, state.origin);
  }

  function setPick(on) {
    state.picking = on;
    $('pick').setAttribute('aria-pressed', String(on));
    send({ type: 'pick', on });
  }
  $('pick').onclick = () => setPick(!state.picking);

  // Pins for open threads (numbered as in the list), and for the focused one.
  function pins() {
    send({ type: 'pins', focus: state.focus, pins: state.threads.map((t, i) => ({
      id: t.id, n: i + 1, selector: t.anchor.selector, fx: t.anchor.fx, fy: t.anchor.fy, resolved: t.status !== 'open', title: (t.comments[0] || {}).text || '',
    })).filter((p) => !p.resolved || p.id === state.focus) });
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== state.origin || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    switch (m.type) {
      case 'ready': pins(); break;
      case 'pick': state.anchor = m; setPick(false); compose(); break;
      case 'pin': focus(m.id); break;
      case 'nav': {
        const u = new URL(m.href, state.origin + '/');
        if (u.origin === state.origin) frame.src = u.href;
        break;
      }
    }
  });

  // --- threads ------------------------------------------------------------

  function watch() {
    if (state.off) state.off();
    state.threads = [];
    renderThreads();
    if (!db) return;
    state.off = db.collection('threads').where('store', '==', state.store).onSnapshot((s) => {
      state.threads = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
      renderThreads();
      pins();
      const known = new Set(state.snaps.map((x) => x.n));
      if (state.threads.some((t) => t.comments.some((c) => c.n && !known.has(c.n)))) refresh();
    }, (err) => say(err.message, true));
  }

  function focus(id) {
    state.focus = id;
    renderThreads();
    pins();
    send({ type: 'focus', id });
  }

  function renderThreads() {
    const open = state.threads.filter((t) => t.status === 'open').length;
    $('count').textContent = state.threads.length ? `${open} open` : '';
    $('threads').replaceChildren(...state.threads.map((t, i) => {
      const box = el('textarea', { rows: 2, placeholder: 'Reply' });
      const reply = el('button', { type: 'button', className: 'btn', textContent: 'Reply', onclick: async () => {
        if (!box.value.trim()) return;
        await act('reply', { thread: t.id, text: box.value, n: state.n });
        box.value = '';
      } });
      const resolve = el('button', { type: 'button', className: 'btn', textContent: t.status === 'open' ? 'Resolve' : 'Reopen',
        onclick: () => act('resolve', { thread: t.id, open: t.status !== 'open' }) });
      return el('li', { className: 'thread' + (t.id === state.focus ? ' focus' : '') + (t.status !== 'open' ? ' resolved' : ''), dataset: { thread: t.id } },
        el('header', { onclick: () => focus(t.id) },
          el('span', { className: 'pin' }, String(i + 1)), el('code', {}, t.anchor.tag || 'page'),
          el('span', { className: 'dim' }, ` #${t.n} ${(t.anchor.text || '').slice(0, 36)}`)),
        ...t.comments.map((c) => (c.system
          ? el('p', { className: 'c system' }, c.text)
          : el('div', { className: 'c' + (c.agent ? ' agent' : '') },
            el('div', { className: 'who' }, c.name || c.by, c.n && c.n !== state.n
              ? el('a', { href: '#', textContent: ` · view #${c.n}`, onclick: (ev) => { ev.preventDefault(); show(c.n); } })
              : (c.n ? ` · #${c.n}` : '')),
            el('div', {}, c.text)))),
        t.status === 'open' ? box : null,
        el('div', { className: 'row' }, t.status === 'open' ? reply : null, resolve));
    }));
  }

  function compose() {
    const a = state.anchor;
    $('anchor').replaceChildren('On ', el('code', {}, a.tag), ' ', (a.text || '').slice(0, 60));
    $('composer').hidden = false;
    $('ctext').focus();
  }
  $('cancel').onclick = () => { $('composer').hidden = true; state.anchor = null; };
  $('composer').onsubmit = async (ev) => {
    ev.preventDefault();
    const text = $('ctext').value.trim();
    if (!text || !state.anchor) return;
    const { selector, tag, text: elText, fx, fy, box } = state.anchor;
    const r = await act('comment', { store: state.store, n: state.n, anchor: { selector, tag, text: elText, fx, fy, box }, text });
    $('ctext').value = '';
    $('composer').hidden = true;
    state.anchor = null;
    focus(r.id); // the thread may already be listed: draw it focused
  };

  await overview();
})();
