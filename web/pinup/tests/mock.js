// Minimal stand-in for the artifact runtime, for local testing only.
window.__log = [];
(function () {
  const docs = new Map(); // path -> data
  const listeners = new Set();
  const notify = (path, type) => { for (const l of listeners) l(path, type); };
  const col = path => ({
    path,
    doc: id => docRef(path + '/' + (id || Math.random().toString(36).slice(2))),
    onSnapshot(next) {
      const send = (changes) => next({ docs: [], size: 0, empty: false, docChanges: () => changes, metadata: {} });
      const initial = [...docs.entries()].filter(([p]) => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1).map(([p, d]) => ({ type: 'added', doc: snap(p) }));
      setTimeout(() => send(initial), 20);
      const l = (p, type) => { if (p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1) setTimeout(() => send([{ type, doc: snap(p) }]), 5); };
      listeners.add(l); return () => listeners.delete(l);
    },
    async get() { return { docs: [...docs.keys()].filter(p => p.startsWith(path + '/')).map(snap) }; },
  });
  const snap = p => ({ id: p.split('/').pop(), exists: docs.has(p), data: () => docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : undefined, metadata: {} });
  const docRef = p => ({
    id: p.split('/').pop(), path: p,
    async get() { return snap(p); },
    async set(d) { const s = JSON.stringify(d); if (s.length > 262144) { const e = new Error('too large'); e.code = 'invalid_argument'; throw e; } if (/undefined/.test(typeof d)) throw 1; const ex = docs.has(p); docs.set(p, JSON.parse(s)); window.__log.push(['set', p]); notify(p, ex ? 'modified' : 'added'); },
    async update(d) { docs.set(p, Object.assign(docs.get(p) || {}, d)); notify(p, 'modified'); },
    async delete() { docs.delete(p); window.__log.push(['delete', p]); notify(p, 'removed'); },
    async acquire() { return { acquired: true }; },
    onSnapshot(next) { setTimeout(() => next(snap(p)), 20); const l = (q) => { if (q === p) setTimeout(() => next(snap(p)), 5); }; listeners.add(l); return () => listeners.delete(l); },
  });
  const db = { doc: docRef, collection: col };
  window.__db = db; window.__docs = docs;
  let peersH = null;
  const room = {
    presence: async (patch) => { window.__presence = Object.assign(window.__presence || {}, patch); },
    onPeers(h) { peersH = h; setTimeout(() => h({ peers: [{ peer: 'me', isMe: true, presence: {} }, { peer: 'x1', isMe: false, kind: 'viewer', presence: { u: 'u2', page: null, cur: { x: 200, y: 300 }, sel: [] } }], joined: [], left: [], updated: [] }), 50); return () => {}; },
    canSendToClaudeSession: async () => 'available',
    sendToClaudeSession: async (data, o) => { window.__sent = { data, o }; return { to: 'pane' }; },
  };
  window.__peers = (list) => peersH && peersH({ peers: list, joined: [], left: [], updated: [] });
  const user = { me: async () => ({ id: 'u1', name: 'Ramon Marc', color: '#2B59FF', avatarUrl: '' }), can: async () => window.__canWrite !== false, canEdit: async () => true, isOwner: async () => true, profiles: async ids => Object.fromEntries(ids.map(id => [id, { id, name: id === 'u2' ? 'Ana Lima' : 'Someone', color: '#1E9E6A', avatarUrl: '' }])) };
  let cb = null;
  const comments = { customAnchors: async c => { cb = c; window.__ca = c; return { compose: async (a, at, o) => { window.__composed = { a, at, o }; return { opened: true }; }, open: async () => {}, placed: m => { window.__placed = m; }, exitMode: () => {}, release: () => {}, get areas() { return true; } }; } };
  const sample = async (input, opts) => { window.__sampleInput = input; const t = opts.tools; const r = await t.find(x => x.name === 'write_html').execute({ html: '<div data-name="Settings" style="width:390px;height:844px;background:#fff;display:flex;flex-direction:column;gap:12px;padding:24px"><h2 style="margin:0;font:700 24px Inter">Settings</h2><p style="margin:0">Notifications</p></div>' }, {}); opts.onText && opts.onText({ text: 'Added a Settings screen.', delta: '' }); return { text: 'Added a Settings screen.', truncated: false }; };
  const downloads = { save: async r => { window.__saved = r; return { status: 'saved' }; } };
  const caps = { db, room, user, comments, sample, downloads, assets: null };
  window.claude = { use: name => new Promise(r => setTimeout(() => r(caps[name] || null), 30)) };
})();
