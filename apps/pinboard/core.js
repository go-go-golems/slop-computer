/* Pinboard · core: the operations on a board's documents.
 *
 * The same file runs in the page (a <script>, as window.PinboardCore), in the
 * actor (require('./core.js')) and in CLI verbs. It touches no DOM and no
 * network: a storage adapter reads and writes documents.
 *
 *   storage = {
 *     get(store, id)            current value or undefined
 *     put(store, id, value)     value, or null to delete
 *     level()                   'view' | 'interact' | 'admin' | 'owner'
 *     now()                     milliseconds
 *     id(kind)                  a fresh id such as 'clip:k3x9…'
 *     z()                       the next stacking order (optional)
 *     appDef(name)              an app's definition, for m.open (optional)
 *   }
 *
 * Stores: clips, apps, collections, records. In the db they are the
 * collections clips/, apps/, colls/ and records/ (see pathOf).
 */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = core;
  else root.PinboardCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLL = { clips: 'clips', apps: 'apps', collections: 'colls', records: 'records' };
  const STORE_OF = { clips: 'clips', apps: 'apps', colls: 'collections', records: 'records' };
  const LEVELS = ['view', 'interact', 'admin', 'owner'];
  const atLeast = (have, want) => LEVELS.indexOf(have) >= LEVELS.indexOf(want);

  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  // Equal as JSON, whatever the key order (documents come back from the
  // server with their keys sorted).
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const same = (a, b) => canon(a) === canon(b);

  // Ten base-36 characters: about 3.6e15 values, enough for many writers
  // without coordination.
  function newId(kind, rand) {
    const r = rand || Math.random; let s = '';
    for (let i = 0; i < 10; i++) s += Math.floor(r() * 36).toString(36);
    return kind + ':' + s;
  }

  // A db path segment allows letters, digits and _ - . ~ : @ +. Free text
  // (collection names) is written as UTF-8 bytes, ~ and two hex digits each.
  const SEG_OK = /^[A-Za-z0-9_\-.:@+]$/;
  function seg(s) {
    let out = '';
    for (const ch of String(s)) {
      if (SEG_OK.test(ch)) { out += ch; continue; }
      const enc = encodeURIComponent(ch);
      out += enc === ch ? '~' + ch.charCodeAt(0).toString(16).padStart(2, '0') : enc.replace(/%([0-9A-F]{2})/g, (_, h) => '~' + h.toLowerCase());
    }
    return out;
  }
  const unseg = (s) => decodeURIComponent(String(s).replace(/~([0-9a-f]{2})/g, '%$1'));
  const pathOf = (store, id) => COLL[store] + '/' + seg(id);
  function parsePath(path) {
    const i = path.indexOf('/'); const store = STORE_OF[path.slice(0, i)];
    return store ? { store, id: unseg(path.slice(i + 1)) } : null;
  }

  // The render keys a change touches (the page re-renders windows that read them).
  function keysFor(store, id, before, after) {
    const k = new Set([store, store + ':' + id]);
    if (store === 'records') { const c = (after || before || {}).coll; if (c) k.add('coll:' + c); }
    if (store === 'clips') { const c = (after || before || {}); if (c.binding) k.add('coll:' + c.binding.coll); }
    return k;
  }

  function fromClip(c) {
    const d = { title: c.title || '', tags: c.tags || [], note: c.note || '' };
    if (c.kind === 'link') { d.url = c.url; }
    if (c.kind === 'note') { d.text = c.text; }
    if (c.kind === 'doc') { d.text = c.md; }
    if (c.kind === 'image') { d.src = c.blobId || c.url; d.caption = c.caption || ''; }
    return d;
  }

  function createCore(storage) {
    const S = storage;
    const now = () => (S.now ? S.now() : Date.now());
    const level = () => (S.level ? S.level() : 'owner');
    const mkId = (kind) => (S.id ? S.id(kind) : newId(kind));
    let zTop = 1;
    const nextZ = () => (S.z ? S.z() : ++zTop);

    // Who may change what. The store refuses anyway; checking first gives a
    // clear error before anything changed.
    function check(store) {
      if (!atLeast(level(), 'interact')) throw new Error('This board is read-only for you (level ' + level() + ').');
      if (store === 'apps' && !atLeast(level(), 'admin')) throw new Error('Only board admins register apps.');
    }

    function recorder(ops, keys) {
      const m = {};
      m.set = function (store, id, fn, label) {
        if (!COLL[store]) throw new Error('unknown store ' + store);
        check(store);
        const before = clone(S.get(store, id));
        let after = fn(clone(before));
        if (after === undefined) after = null;
        if (after && !after.id && store !== 'apps' && store !== 'collections') after.id = id;
        S.put(store, id, after);
        ops.push({ store, id, before: before === undefined ? null : before, after: clone(after), label: label || store });
        keysFor(store, id, before, after).forEach(k => keys.add(k));
        return after;
      };
      m.get = (store, id) => S.get(store, id);
      // board
      m.place = function (clip) {
        const id = clip.id || mkId('clip');
        const c = Object.assign({ x: 0, y: 0, w: 200, h: 140, tags: [], note: '', added: now(), z: nextZ() }, clip, { id });
        m.set('clips', id, () => c, 'place ' + id + ' (' + c.kind + ')');
        return id;
      };
      m.move = (id, p) => m.set('clips', id, c => (need(c, id), c.x = Math.round(p.x), c.y = Math.round(p.y), c), 'move ' + id);
      m.resize = (id, s) => m.set('clips', id, c => (need(c, id), c.w = Math.max(120, Math.round(s.w)), c.h = Math.max(60, Math.round(s.h)), c), 'resize ' + id);
      m.retitle = (id, t) => m.set('clips', id, c => (need(c, id), c.title = String(t), c), 'retitle ' + id);
      m.tag = (id, ...tags) => m.set('clips', id, c => (need(c, id), c.tags = [...new Set([...(c.tags || []), ...tags.map(String)])], c), 'tag ' + id + ' ' + tags.join(','));
      m.untag = (id, tag) => m.set('clips', id, c => (need(c, id), c.tags = (c.tags || []).filter(t => t !== tag), c), 'untag ' + id);
      m.setAttr = (id, patch) => m.set('clips', id, c => Object.assign(need(c, id), patch), 'set ' + id + ' ' + Object.keys(patch).join(','));
      m.remove = function (id) {
        const c = S.get('clips', id); if (!c) throw new Error('no clip ' + id);
        (c.children || []).forEach(ch => m.set('clips', ch, x => (x && (x.group = null), x), 'ungroup ' + ch));
        m.set('clips', id, () => null, 'remove ' + id);
        if (c.binding) m.set('records', c.binding.id, r => (r ? (delete r.clipId, r) : r), 'unbind');
      };
      m.group = function (ids, opts = {}) {
        const kids = ids.filter(i => S.get('clips', i) && !S.get('clips', i).group);
        if (kids.length < 2) throw new Error('group needs two or more clips');
        const first = S.get('clips', kids[0]);
        const gid = m.place({ kind: 'group', title: opts.title || 'group', x: first.x, y: first.y, w: Math.max(first.w, 240), h: Math.max(first.h, 160), children: kids, active: kids[0] });
        kids.forEach(k => m.set('clips', k, c => (c.group = gid, c), 'into group'));
        return gid;
      };
      m.ungroup = function (gid) {
        const g = S.get('clips', gid); if (!g || g.kind !== 'group') throw new Error('not a group: ' + gid);
        g.children.forEach((k, i) => m.set('clips', k, c => (c ? (c.group = null, c.x = g.x + 24 * i, c.y = g.y + 24 * i, c) : c), 'out of group'));
        m.set('clips', gid, () => null, 'ungroup ' + gid);
      };
      m.pin = (id, on = true) => m.set('clips', id, c => (need(c, id), c.pinned = !!on, c), (on ? 'pin ' : 'unpin ') + id);
      m.open = function (appName, opts = {}) {
        const def = S.appDef ? S.appDef(appName) : (S.get('apps', appName) || null);
        if (!def) throw new Error('no app ' + appName);
        const params = {}; (def.params || []).forEach(p => params[p.name] = p.def);
        return m.place(Object.assign({ kind: 'app', app: appName, title: def.title || appName, w: def.w || 420, h: def.h || 320, state: clone(def.state || {}), params: Object.assign(params, opts.params || {}) }, opts));
      };
      m.close = (id) => m.set('clips', id, () => null, 'close ' + id);
      m.setParam = (id, name, val) => m.set('clips', id, c => (need(c, id), c.params = c.params || {}, c.params[name] = val, c), 'param ' + name + '=' + JSON.stringify(val));
      m.setState = (id, patch) => m.set('clips', id, c => (need(c, id), c.state = Object.assign(c.state || {}, patch), c), 'state ' + Object.keys(patch).join(','));
      // data
      m.collection = (name, schema) => m.set('collections', name, old => Object.assign(old || { name, fields: [], indexes: [], store: 'db', version: 1 }, schema), 'collection ' + name);
      m.insert = function (coll, data) {
        if (!S.get('collections', coll)) m.collection(coll, { name: coll, fields: Object.keys(data || {}).map(k => ({ name: k, type: 'text' })) });
        const id = mkId('rec'); const rec = Object.assign({}, data, { id, coll, added: (data && data.added) || now() });
        m.set('records', id, () => rec, 'insert ' + coll); return id;
      };
      m.update = (coll, id, patch) => m.set('records', id, r => { if (!r) throw new Error('no record ' + id); return Object.assign(r, typeof patch === 'function' ? patch(r) : patch); }, 'update ' + coll + '/' + id);
      m.removeRecord = (coll, id) => { const r = S.get('records', id); if (r && r.clipId) m.set('clips', r.clipId, c => (c && (c.binding = null), c), 'unbind'); m.set('records', id, () => null, 'remove ' + coll + '/' + id); };
      m.removeCollection = (name) => { (S.list ? S.list('records') : []).filter(r => r.coll === name).forEach(r => m.removeRecord(name, r.id)); m.set('collections', name, () => null, 'drop ' + name); };
      m.promote = function (clipId, coll, fn) {
        const c = S.get('clips', clipId); if (!c) throw new Error('no clip ' + clipId);
        if (c.binding) throw new Error(clipId + ' is already bound to ' + c.binding.coll + '/' + c.binding.id);
        const data = fn ? fn(c) : fromClip(c);
        const id = m.insert(coll, Object.assign({}, data, { clipId }));
        m.set('clips', clipId, x => (x.binding = { coll, id }, x), 'bind ' + clipId + ' → ' + coll); return id;
      };
      m.demote = (clipId) => m.set('clips', clipId, c => (need(c, clipId), c.binding = null, c), 'unbind ' + clipId);
      // apps
      m.register = (def) => m.set('apps', def.name, old => Object.assign(old || {}, def), 'register ' + def.name);
      m.unregister = (name) => m.set('apps', name, () => null, 'unregister ' + name);
      return m;
    }
    function need(c, id) { if (!c) throw new Error('no clip ' + id); return c; }

    // One call is one transaction. If fn throws, what it changed is put back
    // and the error is rethrown, so a failed step leaves the board as it was.
    function mutate(fn) {
      const ops = [], keys = new Set();
      const m = recorder(ops, keys);
      let result;
      try { result = fn(m); } catch (e) {
        for (let i = ops.length - 1; i >= 0; i--) S.put(ops[i].store, ops[i].id, clone(ops[i].before));
        throw e;
      }
      return { result, ops, keys };
    }

    // Puts back what ops changed, each document only if it still holds what
    // the op wrote (or if mayOverwrite(op) says it is safe). Returns the
    // inverse ops it applied and the ones it skipped.
    function revert(ops, mayOverwrite) {
      const applied = [], conflicts = [], keys = new Set();
      for (let i = ops.length - 1; i >= 0; i--) {
        const o = ops[i];
        if (o.trimmed) { conflicts.push(o); continue; }
        check(o.store);
        const cur = S.get(o.store, o.id);
        if (!same(cur, o.after) && !(mayOverwrite && mayOverwrite(o, cur))) { conflicts.push(o); continue; }
        const val = clone(o.before);
        S.put(o.store, o.id, val);
        applied.push({ store: o.store, id: o.id, before: clone(cur === undefined ? null : cur), after: clone(val), label: 'revert ' + o.label });
        keysFor(o.store, o.id, cur, val).forEach(k => keys.add(k));
      }
      return { applied, conflicts, keys };
    }

    return { mutate, recorder, revert, check, setZ: (z) => { zTop = Math.max(zTop, z || 0); } };
  }

  // The shared log entry for a transaction. Documents are at most 256 KiB, so
  // a transaction whose values do not fit keeps only which documents changed
  // (it can then not be reverted by others).
  const MAX_LOG = 200000;
  function logEntry(tx) {
    const ops = tx.ops.map(o => ({ store: o.store, id: o.id, before: o.before, after: o.after, label: o.label }));
    const e = { id: tx.id, by: tx.by, uid: tx.uid || null, at: tx.at, label: tx.label, ops, undone: !!tx.undone };
    if (tx.revertOf) e.revertOf = tx.revertOf;
    if (JSON.stringify(e).length > MAX_LOG) {
      e.ops = ops.map(o => ({ store: o.store, id: o.id, label: o.label, trimmed: true }));
      e.trimmed = true;
    }
    return e;
  }

  // A plain description of a board's data, for verbs and the server agent
  // (the page has its own, richer one with the view and the selection).
  function describe(data, opts = {}) {
    const clips = Object.values(data.clips || {});
    const colls = Object.values(data.collections || {});
    const recs = Object.values(data.records || {});
    const max = opts.max || 200;
    return {
      title: (data.meta && data.meta.title) || '',
      counts: { clips: clips.length, apps: Object.keys(data.apps || {}).length, collections: colls.length, records: recs.length },
      clips: clips.sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, max).map(c => {
        const o = { id: c.id, kind: c.kind, title: c.title || '', tags: c.tags || [] };
        if (c.url) o.url = c.url; if (c.kind === 'note') o.text = String(c.text || '').slice(0, 200);
        if (c.kind === 'app') o.app = c.app; if (c.binding) o.binding = c.binding.coll + '/' + c.binding.id;
        return o;
      }),
      collections: colls.map(c => ({ name: c.name, fields: (c.fields || []).map(f => f.name), count: recs.filter(r => r.coll === c.name).length })),
    };
  }

  // Records of one collection: where [[field, op, value]…], orderBy, desc, limit.
  function query(data, coll, q = {}) {
    const ops = {
      '==': (a, b) => same(a, b), '!=': (a, b) => !same(a, b), '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
      'contains': (a, b) => Array.isArray(a) ? a.includes(b) : String(a || '').toLowerCase().includes(String(b).toLowerCase()),
    };
    let rows = Object.values(data.records || {}).filter(r => r.coll === coll);
    for (const [f, op, v] of (q.where || [])) { const fn = ops[op]; if (!fn) throw new Error('unknown operator ' + op); rows = rows.filter(r => fn(r[f], v)); }
    if (q.orderBy) rows.sort((a, b) => (a[q.orderBy] > b[q.orderBy] ? 1 : a[q.orderBy] < b[q.orderBy] ? -1 : 0) * (q.desc ? -1 : 1));
    return rows.slice(0, q.limit || rows.length);
  }

  return { COLL, STORE_OF, LEVELS, atLeast, clone, same, canon, newId, seg, unseg, pathOf, parsePath, keysFor, fromClip, createCore, logEntry, describe, query };
});
