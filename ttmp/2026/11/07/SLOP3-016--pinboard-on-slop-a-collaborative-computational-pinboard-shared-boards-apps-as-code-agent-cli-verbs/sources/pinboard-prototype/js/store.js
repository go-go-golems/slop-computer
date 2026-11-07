/* Pinboard · store: IndexedDB persistence, in-memory state, mutations with undo. */
window.PB = window.PB || {};
(function (PB) {
  'use strict';
  const DB_NAME = 'pinboard.v1', STORES = ['clips', 'blobs', 'apps', 'collections', 'records', 'meta'];

  // ---------- IndexedDB (with an in-memory fallback) ----------
  let dbp = null, memory = false;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB_NAME, 1); } catch (e) { memory = true; return res(null); }
      r.onupgradeneeded = () => { const d = r.result; STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { memory = true; res(null); };
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open(); if (!d) return null;
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  }
  PB.idb = {
    get: (s, k) => tx(s, 'readonly', o => o.get(k)),
    put: (s, k, v) => tx(s, 'readwrite', o => o.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)),
    all: async s => {
      const d = await open(); if (!d) return {};
      const o = d.transaction(s, 'readonly').objectStore(s);
      const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const [keys, vals] = await Promise.all([req(o.getAllKeys()), req(o.getAll())]);
      const m = {}; keys.forEach((k, i) => m[k] = vals[i]); return m;
    },
    clear: async () => { for (const s of STORES) await tx(s, 'readwrite', o => o.clear()); },
    get memory() { return memory; }
  };

  // ---------- state ----------
  PB.S = { clips: {}, apps: {}, collections: {}, records: {}, meta: {} };
  PB.blobs = {};            // id → Blob (loaded lazily)
  const urls = {};
  PB.blobURL = function (id) {
    const b = PB.blobs[id]; if (!b) return '';
    if (!urls[id]) urls[id] = URL.createObjectURL(b); return urls[id];
  };
  PB.putBlob = async function (blob) {
    const id = PB.id('blob'); PB.blobs[id] = blob;
    try { await PB.idb.put('blobs', id, blob); } catch (e) { console.warn('blob not persisted', e); }
    return id;
  };
  PB.id = (p) => p + ':' + Math.random().toString(36).slice(2, 7);
  PB.clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  const saveTimers = {};
  PB.save = function (store, id) {
    const v = PB.S[store][id];
    clearTimeout(saveTimers[store + id]);
    saveTimers[store + id] = setTimeout(() => { PB.idb.put(store, id, PB.clone(v)).catch(e => console.warn('save failed', e)); }, 40);
  };
  PB.del = function (store, id) { clearTimeout(saveTimers[store + id]); PB.idb.del(store, id).catch(() => { }); };
  PB.meta = function (k, v) {
    if (v === undefined) return PB.S.meta[k];
    PB.S.meta[k] = v; PB.save('meta', k); return v;
  };

  PB.load = async function () {
    for (const s of ['clips', 'apps', 'collections', 'records', 'meta']) { try { PB.S[s] = await PB.idb.all(s); } catch (e) { PB.S[s] = {}; } }
    try { PB.blobs = await PB.idb.all('blobs'); } catch (e) { PB.blobs = {}; }
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
  function recorder(ops, keys, by) {
    const m = {};
    m.set = function (store, id, fn, label) {
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
    m.collection = (name, schema) => m.set('collections', name, old => Object.assign(old || { name, fields: [], indexes: [], store: 'indexeddb', version: 1 }, schema), 'collection ' + name);
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
  PB.mutate = function (fn, by = 'you', opts = {}) {
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

  // Quiet changes: persisted, not in history (typing, pan, z-order).
  PB.quiet = function (store, id, patch, keys) {
    const v = PB.S[store][id]; if (!v) return;
    Object.assign(v, typeof patch === 'function' ? patch(v) || {} : patch);
    PB.save(store, id);
    const ks = new Set(keys || [store + ':' + id]); PB.emit('change', ks);
  };
  PB.setState = function (clipId, patch) {
    const c = PB.S.clips[clipId]; if (!c) return;
    c.state = Object.assign(c.state || {}, patch); PB.save('clips', clipId);
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
