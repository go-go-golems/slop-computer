/* Pinboard · store: the board's slop db, in-memory state, mutations with undo.
 *
 * PB.S keeps the prototype's five maps; rendering reads them as before. What
 * changed is where they live:
 *
 *   PB.S.clips[id]        db clips/<id>
 *   PB.S.apps[name]       db apps/<name>        (built-in apps stay in memory)
 *   PB.S.collections[n]   db colls/<n>
 *   PB.S.records[id]      db records/<id>       (each record carries its coll)
 *   PB.S.meta[k]          board/meta for the shared keys (title, seeded),
 *                         data/users/<me>/view for this viewer's keys
 *   blobs                 assets; a clip keeps "blob:<asset id>"
 *
 * Without the slop runtime (a file opened locally) everything stays in memory.
 */
window.PB = window.PB || {};
(function (PB) {
  'use strict';
  const COLL = { clips: 'clips', apps: 'apps', collections: 'colls', records: 'records' };
  const SHARED_META = new Set(['title', 'seeded', 'about']);
  const LEVELS = ['view', 'interact', 'admin', 'owner'];

  // ---------- the runtime ----------
  PB.rt = { db: null, user: null, assets: null, slop: null, room: null, me: null, visitor: null, level: 'owner', online: false };
  PB.can = (level) => LEVELS.indexOf(PB.rt.level) >= LEVELS.indexOf(level);
  PB.connect = async function () {
    const has = window.claude && typeof claude.use === 'function';
    const use = (n) => has ? claude.use(n).catch(() => null) : Promise.resolve(null);
    const [db, user, assets, slop, room] = await Promise.all(['db', 'user', 'assets', 'slop', 'room'].map(use));
    Object.assign(PB.rt, { db, user, assets, slop, room, online: !!db });
    PB.rt.me = user ? await user.me().catch(() => null) : null;
    PB.rt.visitor = slop && slop.visitor ? await slop.visitor().catch(() => null) : null;
    if (db) PB.rt.level = (PB.rt.visitor && PB.rt.visitor.level) || ((user && await user.canEdit().catch(() => false)) ? 'admin' : 'interact');
    PB.actor = (PB.rt.me && (PB.rt.me.name || PB.rt.me.email)) || 'you';
    return PB.rt;
  };

  // ---------- ids and values ----------
  // Ten base-36 characters: about 3.6e15 values, enough for many writers
  // without coordination.
  PB.id = (p) => {
    const a = new Uint8Array(10); crypto.getRandomValues(a);
    return p + ':' + Array.from(a, b => (b % 36).toString(36)).join('');
  };
  PB.clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  PB.same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  // A db path segment allows letters, digits and _ - . ~ : @ +. Collection
  // names are free text, so anything else is written as ~ and two hex digits.
  const SEG_OK = /[A-Za-z0-9_\-.:@+]/;
  PB.seg = (s) => Array.from(new TextEncoder().encode(String(s)), b => {
    const c = String.fromCharCode(b);
    return b < 128 && SEG_OK.test(c) ? c : '~' + b.toString(16).padStart(2, '0');
  }).join('');
  PB.unseg = (s) => {
    const bytes = []; for (let i = 0; i < s.length; i++) {
      if (s[i] === '~') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s.charCodeAt(i));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  };
  PB.pathOf = (store, id) => COLL[store] + '/' + PB.seg(id);

  // ---------- state ----------
  PB.S = { clips: {}, apps: {}, collections: {}, records: {}, meta: {} };
  PB.builtins = {};            // name → app record, shipped with the code, never in the db

  // ---------- writing: debounced per document, then in order ----------
  // The runtime already sends one write at a time per document; the timers
  // here coalesce bursts (typing, dragging) into one write per pause.
  const timers = {}, getters = {}, dirty = new Set();
  let inflight = 0, failed = 0;
  function status() { PB.emit('saving', { inflight, dirty: dirty.size, failed }); }
  function send(path, value) {
    const db = PB.rt.db; if (!db) return;
    inflight++; status();
    const ref = db.doc(path);
    (value == null ? ref.delete() : ref.set(PB.clone(value)))
      .catch(e => { failed++; writeFailed(path, e); })
      .finally(() => { inflight--; status(); });
  }
  function writeFailed(path, e) {
    console.warn('write failed', path, e);
    const code = e && e.code;
    if (code === 'invalid_argument' && /level|denied|permission|write/i.test(e.message || '')) PB.toast('⚠ this board is read-only for you', 'long');
    else if (code === 'quota_exceeded') PB.toast('⚠ the board is full: ' + (e.message || ''), 'long');
    else PB.toast('⚠ not saved: ' + (e && e.message || e), 'long');
  }
  function schedule(path, get, delay) {
    clearTimeout(timers[path]); dirty.add(path); getters[path] = get; status();
    timers[path] = setTimeout(() => fire(path), delay);
  }
  function fire(path) {
    clearTimeout(timers[path]); delete timers[path]; dirty.delete(path);
    const get = getters[path]; delete getters[path]; if (get) send(path, get());
  }
  PB.save = function (store, id, delay = 40) {
    if (store === 'meta') return saveMeta(id);
    if (store === 'apps' && PB.builtins[id] && PB.S.apps[id] === PB.builtins[id]) return;
    if (!PB.can(store === 'apps' ? 'admin' : 'interact')) return;   // a viewer's z-order, typing: this tab only
    schedule(PB.pathOf(store, id), () => PB.S[store][id], delay);
  };
  PB.del = function (store, id) {
    if (!PB.can(store === 'apps' ? 'admin' : 'interact')) return;
    const path = PB.pathOf(store, id);
    clearTimeout(timers[path]); delete timers[path]; delete getters[path]; dirty.delete(path);
    send(path, null);
  };
  PB.isDirty = (path) => dirty.has(path);
  PB.flush = function () { Object.keys(timers).forEach(fire); };
  window.addEventListener('pagehide', () => PB.flush());

  // ---------- meta: shared keys in board/meta, the rest per viewer ----------
  const VIEW_DOC = () => PB.rt.me && PB.rt.me.id ? 'data/users/' + PB.rt.me.id + '/view' : null;
  const local = {
    get(k) { try { const v = localStorage.getItem('pinboard.' + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set(k, v) { try { localStorage.setItem('pinboard.' + k, JSON.stringify(v)); } catch (e) { } },
  };
  function saveMeta(k) {
    if (SHARED_META.has(k)) {
      if (!PB.can('admin')) return;
      const shared = {}; SHARED_META.forEach(x => { if (PB.S.meta[x] !== undefined) shared[x] = PB.S.meta[x]; });
      return schedule('board/meta', () => shared, 40);
    }
    // Per viewer: in the db when this person may write their own subtree,
    // otherwise in this browser only.
    const doc = VIEW_DOC();
    if (!doc || !PB.can('interact')) return local.set(k, PB.S.meta[k]);
    schedule(doc, () => viewDoc(), 300);
  }
  // The view document holds every per-viewer key; agent threads are trimmed so
  // that it stays well below the 256 KiB document limit.
  function viewDoc() {
    const out = {}; Object.keys(PB.S.meta).forEach(k => { if (!SHARED_META.has(k)) out[k] = PB.S.meta[k]; });
    let threads = out.threads || [];
    while (threads.length && JSON.stringify(out).length > 200000) { threads = threads.slice(0, -1); out.threads = threads; }
    return out;
  }
  PB.meta = function (k, v) {
    if (v === undefined) return PB.S.meta[k];
    PB.S.meta[k] = v; PB.save('meta', k); return v;
  };

  // ---------- loading ----------
  PB.load = async function () {
    const db = PB.rt.db;
    if (!db) {
      ['view', 'minimap', 'threads', 'agentOpen', 'agentMode', 'agentTier'].forEach(k => { const v = local.get(k); if (v !== undefined) PB.S.meta[k] = v; });
      Object.assign(PB.S.apps, PB.builtins); return;
    }
    const all = async (coll) => (await db.collection(coll).get()).docs;
    const [clips, apps, colls, recs, meta] = await Promise.all([
      all('clips'), all('apps'), all('colls'), all('records'), db.doc('board/meta').get(),
    ]);
    PB.S.clips = {}; clips.forEach(d => { PB.S.clips[PB.unseg(d.id)] = PB.clone(d.data()); });
    PB.S.apps = {}; apps.forEach(d => { PB.S.apps[PB.unseg(d.id)] = PB.clone(d.data()); });
    PB.S.collections = {}; colls.forEach(d => { PB.S.collections[PB.unseg(d.id)] = PB.clone(d.data()); });
    PB.S.records = {}; recs.forEach(d => { PB.S.records[PB.unseg(d.id)] = PB.clone(d.data()); });
    PB.S.meta = Object.assign({}, meta.exists ? PB.clone(meta.data()) : {});
    // This viewer's keys: the db document, else this browser.
    const doc = VIEW_DOC();
    const mine = doc && PB.can('interact') ? await db.doc(doc).get().catch(() => null) : null;
    if (mine && mine.exists) Object.assign(PB.S.meta, PB.clone(mine.data()));
    else ['view', 'minimap', 'threads', 'agentOpen', 'agentMode', 'agentTier'].forEach(k => { const v = local.get(k); if (v !== undefined) PB.S.meta[k] = v; });
    Object.assign(PB.S.apps, PB.builtins);
  };

  // ---------- blobs: assets ----------
  // A clip's blobId is "blob:<asset id>"; the asset is served at /_blob/<id>.
  PB.blobs = {};               // blobId → Blob, fetched on demand (agent images, copy)
  const ASSET = (blobId) => String(blobId || '').replace(/^blob:/, '');
  PB.isAssetRef = (s) => typeof s === 'string' && /^blob:[^\s/:]+$/.test(s);
  PB.blobURL = function (id) {
    if (!id) return '';
    if (PB.blobs[id] && !PB.rt.assets) { const b = PB.blobs[id]; return b._url || (b._url = URL.createObjectURL(b)); }
    return '/_blob/' + ASSET(id);
  };
  PB.putBlob = async function (blob) {
    if (!PB.rt.assets) {                      // no runtime: keep it in memory for this visit
      const id = 'blob:mem' + PB.id('b').slice(2);
      PB.blobs[id] = blob; return id;
    }
    const r = await PB.rt.assets.upload(blob, { type: blob.type || undefined });
    const id = 'blob:' + r.id; PB.blobs[id] = blob; return id;
  };
  PB.fetchBlob = async function (id) {
    if (PB.blobs[id]) return PB.blobs[id];
    const r = await fetch(PB.blobURL(id)); if (!r.ok) throw new Error('image ' + id + ': ' + r.status);
    return (PB.blobs[id] = await r.blob());
  };

  // ---------- events ----------
  const listeners = {};
  PB.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => PB.off(ev, fn); };
  PB.off = (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); };
  PB.emit = (ev, ...a) => { (listeners[ev] || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); };

  // ---------- mutations ----------
  PB.history = { txs: [], idx: 0 };
  function write(store, id, val) {
    if (val == null) { delete PB.S[store][id]; PB.del(store, id); }
    else { PB.S[store][id] = val; PB.save(store, id); }
  }
  function keysFor(store, id, before, after) {
    const k = new Set([store, store + ':' + id]);
    if (store === 'records') { const c = (after || before || {}).coll; if (c) k.add('coll:' + c); }
    if (store === 'clips') { const c = (after || before || {}); if (c.binding) k.add('coll:' + c.binding.coll); }
    return k;
  }
  PB.keysFor = keysFor;
  // Who may change what: the store refuses anyway; checking first gives a clear
  // message instead of a failed write after the screen already changed.
  function check(store) {
    if (!PB.can('interact')) throw new Error('This board is read-only for you (level ' + PB.rt.level + ').');
    if (store === 'apps' && !PB.can('admin')) throw new Error('Only board admins register apps.');
  }
  function recorder(ops, keys, by) {
    const m = {};
    m.set = function (store, id, fn, label) {
      check(store);
      const before = PB.clone(PB.S[store][id]);
      let after = fn(PB.clone(before));
      if (after === undefined) after = null;
      if (after && !after.id && store !== 'meta' && store !== 'apps' && store !== 'collections') after.id = id;
      write(store, id, after);
      ops.push({ store, id, before, after, label: label || store });
      keysFor(store, id, before, after).forEach(k => keys.add(k));
      return after;
    };
    m.get = (store, id) => PB.S[store][id];
    // board
    m.place = function (clip) {
      const id = clip.id || PB.id('clip');
      const z = ++PB.zTop;
      const c = Object.assign({ x: 0, y: 0, w: 200, h: 140, tags: [], note: '', added: Date.now(), z }, clip, { id });
      m.set('clips', id, () => c, 'place ' + id + ' (' + c.kind + ')');
      return id;
    };
    m.move = (id, p) => m.set('clips', id, c => (c.x = Math.round(p.x), c.y = Math.round(p.y), c), 'move ' + id);
    m.resize = (id, s) => m.set('clips', id, c => (c.w = Math.max(120, Math.round(s.w)), c.h = Math.max(60, Math.round(s.h)), c), 'resize ' + id);
    m.retitle = (id, t) => m.set('clips', id, c => (c.title = String(t), c), 'retitle ' + id);
    m.tag = (id, ...tags) => m.set('clips', id, c => (c.tags = [...new Set([...(c.tags || []), ...tags.map(String)])], c), 'tag ' + id + ' ' + tags.join(','));
    m.untag = (id, tag) => m.set('clips', id, c => (c.tags = (c.tags || []).filter(t => t !== tag), c), 'untag ' + id);
    m.setAttr = (id, patch) => m.set('clips', id, c => Object.assign(c, patch), 'set ' + id + ' ' + Object.keys(patch).join(','));
    m.remove = function (id) {
      const c = PB.S.clips[id]; if (!c) throw new Error('no clip ' + id);
      (c.children || []).forEach(ch => m.set('clips', ch, x => (x && (x.group = null), x), 'ungroup ' + ch));
      m.set('clips', id, () => null, 'remove ' + id);
      if (c.binding) m.set('records', c.binding.id, r => (r ? (delete r.clipId, r) : r), 'unbind');
    };
    m.group = function (ids, opts = {}) {
      const kids = ids.filter(i => PB.S.clips[i] && !PB.S.clips[i].group);
      if (kids.length < 2) throw new Error('group needs two or more clips');
      const first = PB.S.clips[kids[0]];
      const gid = m.place({ kind: 'group', title: opts.title || 'group', x: first.x, y: first.y, w: Math.max(first.w, 240), h: Math.max(first.h, 160), children: kids, active: kids[0] });
      kids.forEach(k => m.set('clips', k, c => (c.group = gid, c), 'into group'));
      return gid;
    };
    m.ungroup = function (gid) {
      const g = PB.S.clips[gid]; if (!g || g.kind !== 'group') throw new Error('not a group: ' + gid);
      g.children.forEach((k, i) => m.set('clips', k, c => (c ? (c.group = null, c.x = g.x + 24 * i, c.y = g.y + 24 * i, c) : c), 'out of group'));
      m.set('clips', gid, () => null, 'ungroup ' + gid);
    };
    m.pin = (id, on = true) => m.set('clips', id, c => (c.pinned = !!on, c), (on ? 'pin ' : 'unpin ') + id);
    m.open = function (appName, opts = {}) {
      const def = PB.apps && PB.apps.def(appName); if (!def) throw new Error('no app ' + appName);
      const params = {}; (def.params || []).forEach(p => params[p.name] = p.def);
      return m.place(Object.assign({ kind: 'app', app: appName, title: def.title || appName, w: def.w || 420, h: def.h || 320, state: PB.clone(def.state || {}), params: Object.assign(params, opts.params || {}) }, opts));
    };
    m.close = (id) => m.set('clips', id, () => null, 'close ' + id);
    m.setParam = (id, name, val) => m.set('clips', id, c => (c.params = c.params || {}, c.params[name] = val, c), 'param ' + name + '=' + JSON.stringify(val));
    m.setState = (id, patch) => m.set('clips', id, c => (c.state = Object.assign(c.state || {}, patch), c), 'state ' + Object.keys(patch).join(','));
    // data
    m.collection = (name, schema) => m.set('collections', name, old => Object.assign(old || { name, fields: [], indexes: [], store: 'db', version: 1 }, schema), 'collection ' + name);
    m.insert = function (coll, data) {
      if (!PB.S.collections[coll]) m.collection(coll, { name: coll, fields: Object.keys(data || {}).map(k => ({ name: k, type: 'text' })) });
      const id = PB.id('rec'); const rec = Object.assign({}, data, { id, coll, added: (data && data.added) || Date.now() });
      m.set('records', id, () => rec, 'insert ' + coll); return id;
    };
    m.update = (coll, id, patch) => m.set('records', id, r => { if (!r) throw new Error('no record ' + id); return Object.assign(r, typeof patch === 'function' ? patch(r) : patch); }, 'update ' + coll + '/' + id);
    m.removeRecord = (coll, id) => { const r = PB.S.records[id]; if (r && r.clipId) m.set('clips', r.clipId, c => (c && (c.binding = null), c), 'unbind'); m.set('records', id, () => null, 'remove ' + coll + '/' + id); };
    m.removeCollection = (name) => { Object.values(PB.S.records).filter(r => r.coll === name).forEach(r => m.removeRecord(name, r.id)); m.set('collections', name, () => null, 'drop ' + name); };
    m.promote = function (clipId, coll, fn) {
      const c = PB.S.clips[clipId]; if (!c) throw new Error('no clip ' + clipId);
      if (c.binding) throw new Error(clipId + ' is already bound to ' + c.binding.coll + '/' + c.binding.id);
      const data = fn ? fn(c) : PB.fromClip(c);
      const id = m.insert(coll, Object.assign({}, data, { clipId }));
      m.set('clips', clipId, x => (x.binding = { coll, id }, x), 'bind ' + clipId + ' → ' + coll); return id;
    };
    m.demote = (clipId) => m.set('clips', clipId, c => (c.binding = null, c), 'unbind ' + clipId);
    // apps
    m.register = (def) => m.set('apps', def.name, old => Object.assign(old || {}, def), 'register ' + def.name);
    m.unregister = (name) => m.set('apps', name, () => null, 'unregister ' + name);
    return m;
  }
  PB.zTop = 1;
  PB.mutate = function (fn, by = PB.actor || 'you', opts = {}) {
    if (PB.readonly) throw new Error('Read-only mode: mutations are off. Switch the agent mode to Ask or Auto.');
    const ops = [], keys = new Set();
    const m = recorder(ops, keys, by);
    const r = fn(m);
    if (!ops.length) return r;
    const H = PB.history;
    const last = H.txs[H.idx - 1];
    if (opts.coalesce && last && last.coalesce === opts.coalesce && Date.now() - last.at < 2000) {
      last.ops.push(...ops); keys.forEach(k => last.keys.add(k)); last.at = Date.now();
      PB.emit('mutation', last, keys); return r;
    }
    const tx = { ops, by, at: Date.now(), keys, coalesce: opts.coalesce, label: ops.map(o => o.label).join(' · ') };
    H.txs.length = H.idx; H.txs.push(tx); H.idx++;
    if (H.txs.length > 300) { H.txs.shift(); H.idx--; }
    PB.emit('mutation', tx, keys);
    return r;
  };
  PB.undo = function () {
    const H = PB.history; if (H.idx === 0) return false;
    const tx = H.txs[--H.idx]; const keys = new Set();
    [...tx.ops].reverse().forEach(o => { write(o.store, o.id, PB.clone(o.before)); keysFor(o.store, o.id, o.before, o.after).forEach(k => keys.add(k)); });
    PB.emit('mutation', Object.assign({}, tx, { undo: true, at: Date.now(), by: 'undo' }), keys); return true;
  };
  PB.redo = function () {
    const H = PB.history; if (H.idx >= H.txs.length) return false;
    const tx = H.txs[H.idx++]; const keys = new Set();
    tx.ops.forEach(o => { write(o.store, o.id, PB.clone(o.after)); keysFor(o.store, o.id, o.before, o.after).forEach(k => keys.add(k)); });
    PB.emit('mutation', Object.assign({}, tx, { redo: true, at: Date.now(), by: 'redo' }), keys); return true;
  };
  PB.revertTo = function (idx) { while (PB.history.idx > idx) PB.undo(); };

  // Quiet changes: persisted, not in history (typing, pan, z-order). Typing
  // is coalesced into one write per 300 ms pause.
  PB.quiet = function (store, id, patch, keys) {
    const v = PB.S[store][id]; if (!v) return;
    if (store !== 'meta' && !PB.can('interact')) return;
    Object.assign(v, typeof patch === 'function' ? patch(v) || {} : patch);
    PB.save(store, id, 300);
    const ks = new Set(keys || [store + ':' + id]); PB.emit('change', ks);
  };
  PB.setState = function (clipId, patch) {
    const c = PB.S.clips[clipId]; if (!c) return;
    c.state = Object.assign(c.state || {}, patch);
    if (PB.can('interact')) PB.save('clips', clipId, 300);
    PB.emit('change', new Set(Object.keys(patch).map(k => 'state:' + clipId + ':' + k)));
  };

  PB.fromClip = function (c) {
    const d = { title: c.title || '', tags: c.tags || [], note: c.note || '' };
    if (c.kind === 'link') { d.url = c.url; }
    if (c.kind === 'note') { d.text = c.text; }
    if (c.kind === 'doc') { d.text = c.md; }
    if (c.kind === 'image') { d.src = c.blobId || c.url; d.caption = c.caption || ''; }
    return d;
  };
})(window.PB);
