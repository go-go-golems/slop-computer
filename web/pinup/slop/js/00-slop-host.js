// ---------- slop host (web/pinup/slop; not part of upstream Pinup) ----------
// Pinup reaches its host only through window.claude.use(name). On slop it
// runs in two modes:
//   tool    the Workshop opens /tools/pinup?file=<design>: db is the design's
//           live documents (/api/docs/<design>), room is presence and comment
//           threads, user is the grant's user and people.
//   player  a site route binds a design (slop route set /proto/x/:screen
//           pinup-player --bind design=<design>): db is the design's saved
//           version, read-only, and the page opens in Present mode.
// Anywhere else nothing is installed and Pinup keeps its local mode.
const SLOP = { mode: null, api: null, file: null, peer: 'p' + Math.random().toString(36).slice(2, 10), db: null };

(function () {
  const sl = window.slop;
  if (!sl || window.claude) return;
  if (sl.data && sl.data.design && sl.mode !== 'tool') {
    SLOP.mode = 'player';
    const caps = { db: slopStaticDb(sl.data.design.all || []), user: slopViewer() };
    window.claude = { use: name => Promise.resolve(caps[name] || null) };
    return;
  }
  if (sl.mode !== 'tool' || !sl.tool) return;
  SLOP.mode = 'tool';
  const ready = sl.tool.ready().then(async api => {
    SLOP.api = api;
    SLOP.file = await slopPick(api);
    return api;
  });
  const made = {};
  window.claude = {
    use: name => ready.then(() => {
      if (!(name in made)) made[name] = slopCap(name);
      return made[name];
    }).catch(err => { console.warn('[pinup/slop]', err && err.message); return null; }),
  };
})();

function slopCap(name) {
  const api = SLOP.api;
  if (!SLOP.file) return null;
  if (name === 'db') return api.can('docs:read') ? (SLOP.db = slopDb()) : null;
  if (name === 'user') return slopUser();
  if (name === 'room') return api.can('docs:write') ? slopRoom() : null;
  if (name === 'downloads') return { save: slopDownload };
  return null; // sample, assets, comments: not on slop yet
}

// ---------- errors: slop HTTP failures as the codes Pinup handles ----------
function slopErr(e) {
  const s = e && e.status;
  const x = new Error((e && e.message) || 'network error');
  x.code = s === 401 || s === 403 ? 'not_granted' : s === 413 ? 'invalid_argument' : s === 507 ? 'quota_exceeded'
    : s === 429 ? 'resource_exhausted' : s === 400 ? 'invalid_argument' : s === 404 ? 'not_found' : 'unavailable';
  if (s === 413) x.message = 'document too large: over the size limit';
  return x;
}

// ---------- snapshots, shaped like the Artifact runtime's ----------
function slopSnap(path, data) {
  return { id: path.slice(path.indexOf('/') + 1), exists: data != null, metadata: {},
    data: () => (data == null ? undefined : JSON.parse(JSON.stringify(data))) };
}
function slopChanges(list) { return { docs: [], size: list.length, empty: !list.length, metadata: {}, docChanges: () => list }; }
function slopInitial(s, mirror) {
  if (s.path) { const m = mirror.get(s.path); s.next(slopSnap(s.path, m ? m.data : null)); return; }
  const list = [];
  for (const [p, m] of mirror) if (m.data != null && p.startsWith(s.prefix) && p.indexOf('/', s.prefix.length) < 0) list.push({ type: 'added', doc: slopSnap(p, m.data) });
  s.next(slopChanges(list));
}

// ---------- db (tool): the design's live documents ----------
function slopDb() {
  const api = SLOP.api, base = '/docs/' + encodeURIComponent(SLOP.file);
  const mirror = new Map(); // path → {data (null: deleted), rev}
  const subs = new Set();
  let rev = 0, ready = false;
  const fire = (path, before, after) => {
    for (const s of subs) {
      if (s.path) { if (s.path === path) s.next(slopSnap(path, after)); continue; }
      if (!path.startsWith(s.prefix) || path.indexOf('/', s.prefix.length) >= 0) continue;
      const type = before == null ? (after == null ? null : 'added') : (after == null ? 'removed' : 'modified');
      if (type) s.next(slopChanges([{ type, doc: slopSnap(path, after == null ? before : after) }]));
    }
  };
  const apply = (path, data, r) => {
    const cur = mirror.get(path);
    if (cur && cur.rev >= r) return; // a newer change already landed
    mirror.set(path, { data: data == null ? null : data, rev: r });
    if (ready) fire(path, cur ? cur.data : null, data == null ? null : data);
  };
  api.stream(base + '/events', {
    after: () => rev,
    on: (type, ev) => {
      if (type === 'doc') {
        rev = Math.max(rev, ev.rev);
        if (ev.big) api.get(base + '/' + ev.path).then(d => apply(ev.path, d.data, d.rev), () => {});
        else apply(ev.path, ev.data, ev.rev);
      } else if (type === 'ready') {
        rev = Math.max(rev, ev.rev);
        if (!ready) { ready = true; for (const s of subs) slopInitial(s, mirror); }
      } else if (type === 'presence') slopOnPresence(ev);
    },
  });
  const listen = s => { subs.add(s); if (ready) setTimeout(() => slopInitial(s, mirror), 0); return () => subs.delete(s); };
  const docRef = path => ({
    id: path.slice(path.indexOf('/') + 1), path,
    get: () => api.get(base + '/' + path).then(d => slopSnap(path, d.data), e => (e.status === 404 ? slopSnap(path, null) : Promise.reject(slopErr(e)))),
    set: data => api.put(base + '/' + path, data).then(() => {}, e => Promise.reject(slopErr(e))),
    update: data => docRef(path).get().then(s => docRef(path).set(Object.assign(s.data() || {}, data))),
    delete: () => api.del(base + '/' + path).then(() => {}, e => (e.status === 404 ? undefined : Promise.reject(slopErr(e)))),
    acquire: o => api.post(base + '/' + path + '/acquire', { holder: String((o && o.holder) || SLOP.peer), ttlMs: (o && o.ttlMs) || 30000 })
      .catch(e => Promise.reject(slopErr(e))),
    onSnapshot: (next, onErr) => listen({ path, next, onErr }),
  });
  const collection = prefix => ({
    path: prefix,
    doc: id => docRef(prefix + '/' + (id || Math.random().toString(36).slice(2, 12))),
    get: () => api.get(base, { prefix: prefix + '/' }).then(r => ({ docs: r.docs.map(d => slopSnap(d.path, d.data)) })),
    onSnapshot: (next, onErr) => listen({ prefix: prefix + '/', next, onErr }),
  });
  return { doc: docRef, collection };
}

// ---------- db (player): the bound design's saved version, read-only ----------
function slopStaticDb(rows) {
  const mirror = new Map();
  for (const r of rows) {
    if (r.path === 'file.json') {
      const f = Object.assign({}, r); delete f.id; delete f.path;
      mirror.set('meta/file', { data: f, rev: 1 });
    } else if (/^pages\/[^/]+\.json$/.test(r.path || '')) {
      for (const n of r.nodes || []) if (n && n.id) mirror.set('nodes/' + n.id, { data: n, rev: 1 });
    }
  }
  const listen = s => { setTimeout(() => slopInitial(s, mirror), 0); return () => {}; };
  const docRef = path => ({
    id: path.slice(path.indexOf('/') + 1), path,
    get: async () => slopSnap(path, mirror.has(path) ? mirror.get(path).data : null),
    set: async () => {}, update: async () => {}, delete: async () => {},
    acquire: async () => ({ acquired: false }),
    onSnapshot: next => listen({ path, next }),
  });
  return { doc: docRef, collection: prefix => ({ path: prefix, doc: id => docRef(prefix + '/' + id), onSnapshot: next => listen({ prefix: prefix + '/', next }) }) };
}
function slopViewer() {
  return { me: async () => ({ id: null, name: 'Viewer', color: '', avatarUrl: '' }), canEdit: async () => false, can: async () => false, isOwner: async () => false, profiles: async () => ({}) };
}

// ---------- user ----------
function slopUser() {
  const api = SLOP.api;
  const person = id => ({ id, name: (api.people[id] && api.people[id].name) || 'Someone', color: '', avatarUrl: '' });
  return {
    me: async () => ({ id: api.user.id, name: api.user.name, color: '', avatarUrl: '' }),
    canEdit: async () => api.can('docs:write'),
    can: async p => (p === 'data.write' ? api.can('docs:write') : false),
    isOwner: async () => false,
    profiles: async ids => Object.fromEntries(ids.map(id => [id, person(id)])),
  };
}

// ---------- room: presence on the docs stream, "send to Claude" as a thread ----------
const ROOM = { handlers: new Set(), peers: new Map(), mine: {}, pending: false };
function slopOnPresence(ev) {
  if (!ev || !ev.peer) return;
  if (ev.left) ROOM.peers.delete(ev.peer);
  else ROOM.peers.set(ev.peer, Object.assign({}, ev, { seen: Date.now() }));
  slopEmitPeers();
}
function slopEmitPeers() {
  const peers = [...ROOM.peers.values()].map(p => ({ peer: p.peer, isMe: p.peer === SLOP.peer, kind: p.kind,
    presence: Object.assign({ u: p.user || null, n: p.name || null }, p.presence || {}) }));
  for (const h of ROOM.handlers) { try { h({ peers, joined: [], left: [], updated: [] }); } catch (e) { console.warn(e); } }
}
function slopRoom() {
  const api = SLOP.api, path = '/presence/' + encodeURIComponent(SLOP.file);
  const post = () => api.post(path, { peer: SLOP.peer, presence: ROOM.mine }).catch(() => {});
  const soon = () => { if (ROOM.pending) return; ROOM.pending = true; setTimeout(() => { ROOM.pending = false; post(); }, 250); };
  setInterval(post, 15000);
  setInterval(() => { // drop viewers whose tab went away without saying so
    const now = Date.now(); let gone = false;
    for (const [id, p] of ROOM.peers) if (p.kind !== 'agent' && id !== SLOP.peer && now - p.seen > 45000) { ROOM.peers.delete(id); gone = true; }
    if (gone) slopEmitPeers();
  }, 10000);
  addEventListener('pagehide', () => api.beacon('POST', path, { peer: SLOP.peer, left: true }));
  api.get(path).then(r => { for (const p of r.peers || []) ROOM.peers.set(p.peer, Object.assign({}, p, { seen: Date.now() })); slopEmitPeers(); }, () => {});
  return {
    presence: async patch => { Object.assign(ROOM.mine, patch); soon(); },
    onPeers: h => { ROOM.handlers.add(h); setTimeout(slopEmitPeers, 0); return () => ROOM.handlers.delete(h); },
    canSendToClaudeSession: async () => (api.can('threads:write') ? 'available' : 'unavailable'),
    sendToClaudeSession: (data, opts) => slopSendToAgent(data, opts),
  };
}

// The agent beside a slop design is a coding agent blocked on
// `slop comments wait`: what Pinup sends to "Claude" becomes a thread on
// the design, and the agent answers through `slop docs` (inbox steps).
async function slopSendToAgent(data, opts) {
  const api = SLOP.api, id = encodeURIComponent(SLOP.file);
  const a = await api.get('/artifacts/' + id);
  const rest = Object.assign({}, data); delete rest.label; delete rest.what;
  const text = [
    'Pinup · ' + ((data && data.label) || SLOP.file),
    (data && data.what) || '',
    'Design file: ' + SLOP.file + '. Read and write it with `slop docs` (`slop help pinup`): layers are nodes/<id>, review items feedback/<id>; write HTML or a step to inbox/<id> and the open Pinup tab applies it.',
    '```json\n' + JSON.stringify(rest, null, 1).slice(0, 6000) + '\n```',
  ].filter(Boolean).join('\n\n');
  const anchor = { pinup: { file: SLOP.file, page: (data && data.page && data.page.id) || null, selection: ((data && data.selection) || []).map(s => s.id), deliver: (opts && opts.deliver) || 'send' } };
  const t = await api.post('/artifacts/' + id + '/threads', { version: a.latest || a.main, anchor, text });
  return { to: 'thread', thread: t && t.id };
}

// ---------- downloads ----------
async function slopDownload(o) {
  const data = o && o.data;
  const blob = data instanceof Blob ? data : new Blob([data], { type: typeof data === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = (o && o.filename) || 'pinup-export';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { status: 'saved' };
}

// ---------- pushing versions (Save version, new designs) ----------
async function slopSha(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// files: path → string or bytes. o: {message, base | create, manifest, moveMain}.
async function slopPush(artifact, files, o) {
  const api = SLOP.api, enc = new TextEncoder(), tree = {}, bytes = {};
  for (const p of Object.keys(files)) { const b = typeof files[p] === 'string' ? enc.encode(files[p]) : files[p]; const sha = await slopSha(b); tree[p] = sha; bytes[sha] = b; }
  const m = await api.post('/blobs/missing', { sha256: Object.values(tree) });
  for (const sha of (m && m.missing) || []) await api.putRaw('/blobs/' + sha, bytes[sha], 'application/octet-stream');
  const body = { tree, message: o.message || 'Saved from Pinup' };
  if (o.create) body.create = o.create; else body.base = o.base;
  if (o.manifest) body.manifest = o.manifest;
  if (o.moveMain === false) body.moveMain = false;
  return api.post('/artifacts/' + encodeURIComponent(artifact) + '/versions', body);
}

// ---------- choosing the design (no ?file=) ----------
function slopPick(api) {
  const f = api.args && api.args.file;
  if (f) return Promise.resolve(f);
  return new Promise(resolve => {
    let done = false;
    const pickFile = id => { if (done) return; done = true; sh.close(); api.setArgs && api.setArgs({ file: id }); resolve(id); };
    const list = h('div', { class: 'opt' }, h('b', { text: 'Designs' }), h('span', { text: 'Loading…' }));
    const name = h('input', { type: 'text', placeholder: 'Name, e.g. Pace Club', 'aria-label': 'Design name', style: { width: '100%' } });
    const proj = h('select', { 'aria-label': 'Project' }, h('option', { value: '', text: 'No project' }));
    const err = h('span', { class: 'muted' });
    const create = h('button', { class: 'btn primary sm', text: 'Create', onclick: async () => {
      const n = name.value.trim(); if (!n) { name.focus(); return; }
      const id = ('design-' + slug(n)).slice(0, 63);
      create.disabled = true; err.textContent = 'Creating ' + id + '…';
      try {
        const file = { name: n, pages: [{ id: 'p1', name: 'Page 1' }], tokens: { colors: {}, type: {} }, v: 1 };
        await slopPush(id, { 'file.json': JSON.stringify(file) }, { message: 'New Pinup design', create: { title: n, kind: 'data', type: 'pinup', project: proj.value || null } });
        await api.put('/docs/' + encodeURIComponent(id) + '/meta/file', file);
        pickFile(id);
      } catch (e) { create.disabled = false; err.textContent = 'Could not create ' + id + ': ' + (e.message || e); }
    } });
    const body = [list, h('div', { class: 'opt' }, h('b', { text: 'New design' }), name, h('div', { class: 'acts' }, proj, create), err)];
    const sh = sheet('Open a design', body, { width: 520, onclose: () => { if (!done) { done = true; resolve(null); } } });
    api.get('/artifacts').then(arts => {
      const ds = (arts || []).filter(a => a.kind === 'data' && a.type === 'pinup');
      list.textContent = '';
      list.append(h('b', { text: ds.length ? 'Designs' : 'No designs yet' }));
      for (const a of ds) list.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => pickFile(a.id) }, a.title + ' · ' + a.id + ' · v' + a.main)));
    }, e => { list.textContent = 'Could not list designs: ' + (e.message || e); });
    api.get('/projects').then(ps => { for (const p of ps || []) proj.append(h('option', { value: p.id, text: p.name })); }, () => {});
  });
}
