/* Pinboard · store: the board's slop db, in-memory state, transactions, the
 * shared log and collaborative undo.
 *
 * PB.S keeps the prototype's maps; rendering reads them as before.
 *
 *   PB.S.clips[id]        db clips/<id>
 *   PB.S.apps[name]       db apps/<name>        (built-in apps stay in memory)
 *   PB.S.collections[n]   db colls/<n>          (n escaped, core.seg)
 *   PB.S.records[id]      db records/<id>       (each record carries its coll)
 *   PB.S.meta[k]          board/meta for the shared keys (title, seeded, about),
 *                         data/users/<me>/view for this viewer's keys
 *   transactions          db log/<tx id>        (everyone's, newest 200 loaded)
 *   images                assets; a clip keeps blobId "blob:<asset id>"
 *
 * Operations live in ../core.js (PinboardCore), shared with the actor and the
 * CLI verbs; this file adapts them to the page: PB.S, debounced writes,
 * subscriptions that apply other people's changes, and undo.
 *
 * Without the slop runtime (a file opened locally) everything stays in memory.
 */
window.PB = window.PB || {};
(function (PB) {
  'use strict';
  const C = window.PinboardCore;
  const SHARED_META = new Set(['title', 'seeded', 'about']);
  const VIEW_KEYS = ['view', 'minimap', 'threads', 'agentOpen', 'agentMode', 'agentTier', 'placeMode'];

  // ---------- the runtime ----------
  PB.rt = { db: null, user: null, assets: null, slop: null, room: null, me: null, visitor: null, level: 'owner', online: false };
  PB.can = (level) => C.atLeast(PB.rt.level, level);
  PB.connect = async function () {
    const has = window.claude && typeof claude.use === 'function';
    const use = (n) => has ? claude.use(n).catch(() => null) : Promise.resolve(null);
    const [db, user, assets, slop, room] = await Promise.all(['db', 'user', 'assets', 'slop', 'room'].map(use));
    Object.assign(PB.rt, { db, user, assets, slop, room, online: !!db });
    PB.rt.me = user ? await user.me().catch(() => null) : null;
    PB.rt.visitor = slop && slop.visitor ? await slop.visitor().catch(() => null) : null;
    if (db) PB.rt.level = (PB.rt.visitor && PB.rt.visitor.level) || ((user && await user.canEdit().catch(() => false)) ? 'admin' : 'interact');
    return PB.rt;
  };
  PB.myName = () => (PB.rt.me && (PB.rt.me.name || PB.rt.me.email)) || 'you';
  PB.myId = () => (PB.rt.me && PB.rt.me.id) || null;

  // ---------- ids and values ----------
  PB.id = (kind) => {
    const a = new Uint8Array(10); crypto.getRandomValues(a);
    return kind + ':' + Array.from(a, b => (b % 36).toString(36)).join('');
  };
  PB.clone = C.clone; PB.same = C.same; PB.seg = C.seg; PB.unseg = C.unseg; PB.pathOf = C.pathOf;
  PB.keysFor = C.keysFor; PB.fromClip = C.fromClip;

  // ---------- state ----------
  PB.S = { clips: {}, apps: {}, collections: {}, records: {}, meta: {} };
  PB.builtins = {};            // name → app record, shipped with the code, never in the db
  PB.log = [];                 // the shared log, newest first (log/* documents)

  // ---------- writing: debounced per document ----------
  // The runtime sends one write at a time per document and shows pending
  // writes in snapshots; the timers here coalesce bursts (typing, dragging)
  // into one write per pause. A document with a write waiting here is "dirty":
  // snapshots from others do not overwrite it until it has been sent.
  const timers = {}, getters = {}, dirty = new Set();
  let inflight = 0, failed = 0;
  function status() { PB.emit('saving', { inflight, dirty: dirty.size, failed }); }
  function send(path, value) {
    const db = PB.rt.db; if (!db) return;
    inflight++; status();
    const ref = db.doc(path);
    (value == null ? ref.delete() : ref.set(PB.clone(value)))
      .catch(e => { failed++; writeFailed(path, e); reread(path); })
      .finally(() => { inflight--; status(); });
  }
  // A refused or failed write leaves PB.S ahead of the board: read the
  // document again and show what the board holds.
  function reread(path) {
    const t = C.parsePath(path); if (!t || !PB.rt.db) return;
    PB.rt.db.doc(path).get().then(snap => {
      const data = snap.exists ? PB.clone(snap.data()) : null, cur = PB.S[t.store][t.id];
      if (PB.same(cur, data)) return;
      if (data == null) delete PB.S[t.store][t.id]; else PB.S[t.store][t.id] = data;
      PB.emit('change', C.keysFor(t.store, t.id, cur, data));
    }).catch(() => { });
  }
  function writeFailed(path, e) {
    console.warn('write failed', path, e);
    const code = e && e.code;
    if (code === 'invalid_argument' && !PB.can('interact')) PB.toast('⚠ this board is read-only for you', 'long');
    else if (code === 'quota_exceeded') PB.toast('⚠ the board is full: ' + (e.message || ''), 'long');
    else if (code === 'revoked') PB.toast('⚠ your access to this board was withdrawn', 'long');
    else PB.toast('⚠ not saved (' + path + '): ' + (e && e.message || e), 'long');
  }
  function schedule(path, get, delay) {
    clearTimeout(timers[path]); dirty.add(path); getters[path] = get; status();
    timers[path] = setTimeout(() => fire(path), delay);
  }
  function fire(path) {
    clearTimeout(timers[path]); delete timers[path]; dirty.delete(path);
    const get = getters[path]; delete getters[path]; if (get) send(path, get()); status();
  }
  PB.isDirty = (path) => dirty.has(path);
  PB.flush = function () { Object.keys(timers).forEach(fire); };
  window.addEventListener('pagehide', () => PB.flush());

  const writable = (store) => PB.can(store === 'apps' ? 'admin' : 'interact');
  PB.save = function (store, id, delay = 40) {
    if (store === 'meta') return saveMeta(id);
    if (store === 'apps' && PB.builtins[id] && PB.S.apps[id] === PB.builtins[id]) return;
    if (!writable(store)) return;                 // a viewer's z-order and typing stay in this tab
    schedule(PB.pathOf(store, id), () => PB.S[store][id], delay);
  };
  PB.del = function (store, id) {
    if (!writable(store)) return;
    const path = PB.pathOf(store, id);
    clearTimeout(timers[path]); delete timers[path]; delete getters[path]; dirty.delete(path);
    send(path, null);
  };

  // ---------- meta: shared keys in board/meta, the rest per viewer ----------
  const VIEW_DOC = () => PB.myId() ? 'data/users/' + PB.myId() + '/view' : null;
  const local = {
    get(k) { try { const v = localStorage.getItem('pinboard.' + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set(k, v) { try { localStorage.setItem('pinboard.' + k, JSON.stringify(v)); } catch (e) { } },
  };
  function sharedMeta() { const o = {}; SHARED_META.forEach(x => { if (PB.S.meta[x] !== undefined) o[x] = PB.S.meta[x]; }); return o; }
  function saveMeta(k) {
    if (SHARED_META.has(k)) { if (PB.can('admin')) schedule('board/meta', sharedMeta, 40); return; }
    // Per viewer: in the db when this person may write their own subtree,
    // otherwise in this browser only.
    const doc = VIEW_DOC();
    if (!doc || !PB.can('interact') || !PB.rt.db) return local.set(k, PB.S.meta[k]);
    schedule(doc, viewDoc, 300);
  }
  // The view document holds every per-viewer key; agent threads are trimmed so
  // that it stays below the 256 KiB document limit.
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

  // ---------- loading and others' changes ----------
  PB.load = async function () {
    const db = PB.rt.db;
    if (!db) {
      VIEW_KEYS.forEach(k => { const v = local.get(k); if (v !== undefined) PB.S.meta[k] = v; });
      Object.assign(PB.S.apps, PB.builtins); return;
    }
    const all = async (coll) => (await db.collection(coll).get()).docs;
    const [clips, apps, colls, recs, meta, log] = await Promise.all([
      all('clips'), all('apps'), all('colls'), all('records'), db.doc('board/meta').get(),
      db.collection('log').orderBy('at', 'desc').limit(200).get().then(s => s.docs).catch(() => []),
    ]);
    const fill = (store, docs) => { PB.S[store] = {}; docs.forEach(d => { PB.S[store][PB.unseg(d.id)] = PB.clone(d.data()); }); };
    fill('clips', clips); fill('apps', apps); fill('collections', colls); fill('records', recs);
    PB.S.meta = Object.assign({}, meta.exists ? PB.clone(meta.data()) : {});
    PB.log = log.map(d => PB.clone(d.data()));
    // This viewer's keys: the db document, else this browser.
    const doc = VIEW_DOC();
    const mine = doc && PB.can('interact') ? await db.doc(doc).get().catch(() => null) : null;
    if (mine && mine.exists) Object.assign(PB.S.meta, PB.clone(mine.data()));
    else VIEW_KEYS.forEach(k => { const v = local.get(k); if (v !== undefined) PB.S.meta[k] = v; });
    Object.keys(PB.builtins).forEach(n => { if (!PB.S.apps[n]) PB.S.apps[n] = PB.builtins[n]; });
    await PB.trust.load();
    PB.zTop = Math.max(1, ...Object.values(PB.S.clips).map(c => c.z || 0));
  };

  // When each document last changed because of someone else (for undo).
  const remoteAt = {};
  PB.remoteAt = (path) => remoteAt[path] || 0;
  const subs = [];
  PB.subscribe = function () {
    const db = PB.rt.db; if (!db) return;
    const fail = (what) => (e) => { console.warn('subscription', what, e); if (e && e.code === 'revoked') PB.toast('⚠ your access to this board was withdrawn', 'long'); };
    Object.entries(C.COLL).forEach(([store, coll]) => {
      subs.push(db.collection(coll).onSnapshot(snap => applyRemote(store, coll, snap), fail(coll)));
    });
    subs.push(db.doc('board/meta').onSnapshot(snap => {
      if (dirty.has('board/meta') || !snap.exists) return;
      const d = snap.data(); let changed = false;
      SHARED_META.forEach(k => { if (!PB.same(PB.S.meta[k], d[k])) { PB.S.meta[k] = PB.clone(d[k]); changed = true; } });
      if (changed) PB.emit('meta', sharedMeta());
    }, fail('board/meta')));
    subs.push(db.collection('log').orderBy('at', 'desc').limit(200).onSnapshot(snap => {
      PB.log = snap.docs.map(d => PB.clone(d.data()));
      PB.emit('change', new Set(['log']));
    }, fail('log')));
  };
  function applyRemote(store, coll, snap) {
    const keys = new Set();
    for (const ch of snap.docChanges()) {
      const id = PB.unseg(ch.doc.id), path = coll + '/' + ch.doc.id;
      if (dirty.has(path)) continue;                // our own edit is still waiting to be sent
      let data = ch.type === 'removed' ? null : PB.clone(ch.doc.data());
      if (store === 'apps' && data == null && PB.builtins[id]) data = PB.builtins[id];
      const cur = PB.S[store][id];
      if (PB.same(cur, data)) continue;             // our own write coming back, or nothing new
      if (data == null) delete PB.S[store][id]; else PB.S[store][id] = data;
      remoteAt[path] = Date.now();
      C.keysFor(store, id, cur, data).forEach(k => keys.add(k));
      if (store === 'clips' && data && data.z > PB.zTop) PB.zTop = data.z;
    }
    if (keys.size) { PB.emit('remote', keys); PB.emit('change', keys); }
  }

  // ---------- images: assets ----------
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
    if (!PB.rt.assets) { const id = 'blob:mem' + PB.id('b').slice(2); PB.blobs[id] = blob; return id; }
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

  // ---------- transactions ----------
  const isBuiltin = (store, id) => store === 'apps' && PB.builtins[id] && PB.S.apps[id] === PB.builtins[id];
  function put(store, id, val) {
    if (val == null) {
      if (isBuiltin(store, id)) return;
      delete PB.S[store][id]; PB.del(store, id);
      if (store === 'apps' && PB.builtins[id]) PB.S.apps[id] = PB.builtins[id];   // the shipped app shows again
    } else { PB.S[store][id] = val; PB.save(store, id); }
  }
  PB.zTop = 1;
  PB.core = C.createCore({
    get: (store, id) => (isBuiltin(store, id) ? undefined : PB.S[store][id]),
    put,
    list: (store) => Object.values(PB.S[store]),
    level: () => PB.rt.level,
    now: () => Date.now(),
    id: (kind) => PB.id(kind),
    z: () => ++PB.zTop,
    appDef: (name) => PB.apps && PB.apps.def(name),
  });

  // This tab's transactions, for undo and redo (the person's own changes).
  PB.history = { txs: [], idx: 0 };
  const label = (by) => {
    const me = PB.myName();
    if (!by || by === 'you') return me;
    if (by === 'agent' || by.startsWith('app:')) return by + ' (' + me + ')';
    return by;
  };
  function writeLog(tx, delay = 300) {
    if (!PB.rt.db || !PB.can('interact')) return;
    schedule('log/' + tx.id, () => C.logEntry(tx), delay);
  }
  function record(ops, keys, by, opts = {}) {
    const H = PB.history;
    const last = H.txs[H.idx - 1];
    if (opts.coalesce && last && last.coalesce === opts.coalesce && !last.undone && Date.now() - last.at < 2000) {
      last.ops.push(...ops); keys.forEach(k => last.keys.add(k)); last.at = Date.now();
      writeLog(last); PB.emit('mutation', last, keys); return last;
    }
    const tx = { id: PB.id('tx'), ops, by: label(by), uid: PB.myId(), at: Date.now(), keys, coalesce: opts.coalesce, label: opts.label || ops.map(o => o.label).join(' · ') };
    if (opts.revertOf) tx.revertOf = opts.revertOf;
    H.txs.length = H.idx; H.txs.push(tx); H.idx++;
    if (H.txs.length > 300) { H.txs.shift(); H.idx--; }
    writeLog(tx);
    PB.emit('mutation', tx, keys);
    return tx;
  }
  PB.mutate = function (fn, by = PB.actor || 'you', opts = {}) {
    if (PB.readonly) throw new Error('Read-only mode: mutations are off. Switch the agent mode to Ask or Auto.');
    const { result, ops, keys } = PB.core.mutate(fn);
    if (ops.length) record(ops, keys, by, opts);
    return result;
  };

  // Undo puts back my own transaction, document by document, unless someone
  // else changed that document after it: their change is kept.
  const untouchedSince = (at) => (o) => PB.remoteAt(PB.pathOf(o.store, o.id)) <= at;
  function markLog(tx, undone) { tx.undone = undone; writeLog(tx, 40); }
  function report(what, r) {
    const n = r.conflicts.length;
    if (n) PB.toast(n + ' change' + (n > 1 ? 's were' : ' was') + ' not ' + what + ': someone changed ' + (n > 1 ? 'them' : 'it') + ' since', 'long');
  }
  PB.undo = function () {
    const H = PB.history; if (H.idx === 0) return false;
    const tx = H.txs[H.idx - 1];
    let r; try { r = PB.core.revert(tx.ops, untouchedSince(tx.at)); } catch (e) { PB.toast('⚠ ' + e.message); return false; }
    H.idx--; markLog(tx, true); report('undone', r);
    PB.emit('mutation', Object.assign({}, tx, { undo: true, at: Date.now(), by: 'undo' }), r.keys); return true;
  };
  PB.redo = function () {
    const H = PB.history; if (H.idx >= H.txs.length) return false;
    const tx = H.txs[H.idx];
    const inverse = tx.ops.map(o => ({ store: o.store, id: o.id, before: o.after, after: o.before, label: o.label })).reverse();
    let r; try { r = PB.core.revert(inverse, untouchedSince(tx.at)); } catch (e) { PB.toast('⚠ ' + e.message); return false; }
    H.idx++; markLog(tx, false); report('redone', r);
    PB.emit('mutation', Object.assign({}, tx, { redo: true, at: Date.now(), by: 'redo' }), r.keys); return true;
  };
  PB.revertTo = function (idx) { while (PB.history.idx > idx) if (!PB.undo()) break; };

  // Revert any step in the shared log, anyone's: each document is put back only
  // if it still holds what that step wrote. The revert is a transaction of its
  // own (in the log, and undoable).
  PB.revertLogEntry = function (id) {
    if (PB.readonly) throw new Error('Read-only mode: mutations are off.');
    const e = PB.log.find(x => x.id === id); if (!e) throw new Error('no log entry ' + id);
    if (e.undone) throw new Error('already reverted');
    if (e.trimmed) throw new Error('this step was too large to keep its values; it cannot be reverted');
    const r = PB.core.revert(e.ops);
    if (r.applied.length) {
      record(r.applied, r.keys, 'you', { label: 'revert: ' + e.label, revertOf: e.id });
      if (PB.rt.db) PB.rt.db.doc('log/' + e.id).update({ undone: true, undoneBy: PB.myName(), undoneAt: Date.now() }).catch(err => console.warn(err));
    }
    report('reverted', r);
    return { reverted: r.applied.length, kept: r.conflicts.length };
  };

  // Quiet changes: persisted, not in history (typing, pan, z-order). Typing
  // is coalesced into one write per 300 ms pause.
  PB.quiet = function (store, id, patch, keys) {
    const v = PB.S[store][id]; if (!v) return;
    Object.assign(v, typeof patch === 'function' ? patch(v) || {} : patch);
    PB.save(store, id, 300);
    const ks = new Set(keys || [store + ':' + id]); PB.emit('change', ks);
  };
  // ---------- app versions and trust ----------
  // Every registered version is kept at apps/<name>/versions/<n> (admins
  // write apps/). Running an app written by someone else needs this viewer's
  // consent for that exact source (its sha256), kept in data/users/<me>/trust,
  // or in this browser for viewers.
  PB.saveVersion = function (name, n, doc) {
    if (!PB.rt.db || !PB.can('admin')) return;
    schedule('apps/' + PB.seg(name) + '/versions/' + n, () => doc, 40);
  };
  PB.versions = async function (name) {
    if (!PB.rt.db) return [];
    const s = await PB.rt.db.collection('apps/' + PB.seg(name) + '/versions').get();
    return s.docs.map(d => Object.assign({ n: Number(d.id) }, d.data())).sort((a, b) => b.n - a.n);
  };
  const TRUST_DOC = () => PB.myId() ? 'data/users/' + PB.myId() + '/trust' : null;
  PB.trust = {
    apps: {},
    async load() {
      const doc = TRUST_DOC();
      if (doc && PB.rt.db && PB.can('interact')) { const s = await PB.rt.db.doc(doc).get().catch(() => null); if (s && s.exists) this.apps = PB.clone(s.data().apps || {}); }
      else this.apps = local.get('trust') || {};
    },
    has(name, sha) { return !!sha && this.apps[name] === sha; },
    set(name, sha) {
      this.apps[name] = sha;
      const doc = TRUST_DOC();
      if (doc && PB.rt.db && PB.can('interact')) schedule(doc, () => ({ apps: this.apps }), 40);
      else local.set('trust', this.apps);
    },
  };

  // c.local: per viewer and per window, kept in this tab only (a search box,
  // a selected row), so one person's typing does not change everyone's view.
  PB.local = {};
  PB.setLocal = function (clipId, patch) {
    PB.local[clipId] = Object.assign(PB.local[clipId] || {}, patch);
    PB.emit('change', new Set(Object.keys(patch).map(k => 'local:' + clipId + ':' + k)));
  };
  PB.setState = function (clipId, patch) {
    const c = PB.S.clips[clipId]; if (!c) return;
    c.state = Object.assign(c.state || {}, patch);
    PB.save('clips', clipId, 300);
    PB.emit('change', new Set(Object.keys(patch).map(k => 'state:' + clipId + ':' + k)));
  };
})(window.PB);
