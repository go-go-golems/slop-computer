// Pinboard's actor: the board's operations for callers without a page (the
// CLI's app verbs, MCP tools, other apps), over the same core as the page.
//
// Every action runs as its caller: `requires` is checked before it runs, and
// the core checks levels again per operation (interact for clips and
// records, admin for apps). The actor's db is the store's own, without the
// page rules, so nothing here may write what the caller could not.
const C = require('./core.js');
const db = use('db');

const MAX_LIST = 500;

function readAll(coll) {
  return db.collection(coll).get().docs.map(d => d.data());
}
function board() {
  return { clips: byId(readAll('clips')), apps: byKey(readAll('apps'), 'name'), collections: byKey(readAll('colls'), 'name'), records: byId(readAll('records')), meta: (db.doc('board/meta').get().data() || {}) };
}
function byId(rows) { const o = {}; rows.forEach(r => { o[r.id] = r; }); return o; }
function byKey(rows, k) { const o = {}; rows.forEach(r => { o[r[k]] = r; }); return o; }

// A core whose storage is the actor's db, in this turn.
function coreFor(ctx) {
  let z = 0;
  return C.createCore({
    get: (store, id) => { const s = db.doc(C.pathOf(store, id)).get(); return s.exists ? s.data() : undefined; },
    put: (store, id, v) => { const ref = db.doc(C.pathOf(store, id)); if (v == null) ref.delete(); else ref.set(v); },
    list: (store) => readAll(C.COLL[store]),
    level: () => ctx.visitor.level,
    now: () => ctx.now,
    id: (kind) => C.newId(kind),
    z: () => { if (!z) z = readAll('clips').reduce((m, c) => Math.max(m, c.z || 0), 0); return ++z; },
  });
}
function who(ctx, via) {
  const v = ctx.visitor || {};
  return (v.name || v.email || v.id || 'someone') + ' (' + (via || 'actor') + ')';
}
// One transaction, written to the board and to the shared log.
function commit(ctx, args, fn) {
  const core = coreFor(ctx);
  const r = core.mutate(fn);
  if (r.ops.length) {
    const tx = { id: C.newId('tx'), ops: r.ops, by: who(ctx, args && args.via), uid: ctx.visitor.id, at: ctx.now, label: r.ops.map(o => o.label).join(' · ') };
    db.doc('log/' + tx.id).set(C.logEntry(tx));
  }
  return r.result;
}
// Where a clip made without a position goes: below everything on the board.
function freeSpot() {
  const clips = readAll('clips').filter(c => !c.pinned && !c.group);
  const y = clips.reduce((m, c) => Math.max(m, (c.y || 0) + (c.h || 0)), 0);
  return { x: 40, y: y + 32 };
}
const str = (v, max) => String(v == null ? '' : v).slice(0, max || 2000);
const tagsOf = (t) => (Array.isArray(t) ? t : t ? String(t).split(',') : []).map(x => str(x, 60).trim()).filter(Boolean).slice(0, 20);

defineActor({
  actions: {
    // What is on the board: title, counts, clips (newest first), collections.
    describe: {
      requires: 'view',
      run(ctx, args) { return C.describe(board(), { max: Math.min(Number(args && args.max) || 200, MAX_LIST) }); },
    },
    // Clips, filtered by kind, tag or text.
    clips: {
      requires: 'view',
      run(ctx, args) {
        const a = args || {};
        let rows = C.describe(board(), { max: MAX_LIST }).clips;
        if (a.kind) rows = rows.filter(c => c.kind === a.kind);
        if (a.tag) rows = rows.filter(c => (c.tags || []).includes(a.tag));
        if (a.q) { const q = String(a.q).toLowerCase(); rows = rows.filter(c => JSON.stringify(c).toLowerCase().includes(q)); }
        return rows.slice(0, Math.min(Number(a.limit) || 100, MAX_LIST));
      },
    },
    // Add a note (text), a link (url) or an image (asset, an uploaded asset id).
    addClip: {
      requires: 'interact',
      run(ctx, args) {
        const a = args || {};
        const spec = a.asset ? { kind: 'image', blobId: 'blob:' + str(a.asset, 64).replace(/^blob:/, ''), w: 260, h: 220 }
          : a.url ? { kind: 'link', url: str(a.url, 2000), w: 260, h: 110 }
          : { kind: 'note', text: str(a.text, 20000), w: 220, h: 120 };
        if (!a.asset && !a.url && !a.text) ctx.fail('invalid_argument', 'give text, url or asset');
        const pos = (a.x != null && a.y != null) ? { x: Number(a.x), y: Number(a.y) } : freeSpot();
        const id = commit(ctx, a, m => m.place(Object.assign(spec, pos, { title: str(a.title, 200), tags: tagsOf(a.tags), note: str(a.note, 2000), source: { from: str(a.via || 'actor', 20), at: ctx.now } })));
        return { id, kind: spec.kind };
      },
    },
    removeClip: {
      requires: 'interact',
      run(ctx, args) { const id = str(args && args.id, 80); commit(ctx, args, m => m.remove(id)); return { removed: id }; },
    },
    tagClip: {
      requires: 'interact',
      run(ctx, args) {
        const id = str(args && args.id, 80), add = tagsOf(args && args.tags), drop = tagsOf(args && args.untag);
        commit(ctx, args, m => { if (add.length) m.tag(id, ...add); drop.forEach(t => m.untag(id, t)); });
        const c = db.doc(C.pathOf('clips', id)).get().data();
        return { id, tags: (c && c.tags) || [] };
      },
    },
    // Collections with their fields and row counts.
    collections: {
      requires: 'view',
      run() { return C.describe(board()).collections; },
    },
    // Records of a collection: where [[field, op, value]…], orderBy, desc, limit.
    query: {
      requires: 'view',
      run(ctx, args) {
        const a = args || {};
        if (!a.coll) ctx.fail('invalid_argument', 'which collection? (coll)');
        return C.query(board(), String(a.coll), { where: a.where || [], orderBy: a.orderBy, desc: !!a.desc, limit: Math.min(Number(a.limit) || 100, MAX_LIST) });
      },
    },
    insert: {
      requires: 'interact',
      run(ctx, args) {
        const a = args || {};
        if (!a.coll || !a.data || typeof a.data !== 'object') ctx.fail('invalid_argument', 'give coll and data');
        const id = commit(ctx, a, m => m.insert(String(a.coll), a.data));
        return { id, coll: a.coll };
      },
    },
    update: {
      requires: 'interact',
      run(ctx, args) {
        const a = args || {};
        if (!a.coll || !a.id || !a.patch) ctx.fail('invalid_argument', 'give coll, id and patch');
        commit(ctx, a, m => m.update(String(a.coll), String(a.id), a.patch));
        return db.doc(C.pathOf('records', a.id)).get().data();
      },
    },
    // The newest steps of the shared log.
    log: {
      requires: 'view',
      run(ctx, args) {
        const n = Math.min(Number(args && args.limit) || 20, 200);
        return db.collection('log').orderBy('at', 'desc').limit(n).get().docs.map(d => { const e = d.data(); return { id: e.id, at: e.at, by: e.by, label: e.label, undone: !!e.undone }; });
      },
    },
  },
});
