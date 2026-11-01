// The kernel worker. The lab shell talks to it over postMessage; each hosted page gets its own
// MessagePort, bound here to the page's view (and so to one principal) when the view opens.
import { Kernel } from './kernel/kernel.js';
import { runLine, isWrite, VERBS, fmtTime, parse } from './kernel/verbs.js';
import { seed } from './seeds/seed.js';

let k = null, unsub = null;
const pending = new Map(); let reqSeq = 0;
function ask(type, payload) { return new Promise((res, rej) => { const reqId = ++reqSeq; pending.set(reqId, { res, rej }); postMessage({ type, reqId, ...payload }); }); }
const bridge = { sample: (input, opts) => ask('sample', { input, opts }), download: (file) => ask('download', { file }) };

let evq = new Set(), evTimer = null;
function onEvent(type) { evq.add(type); if (!evTimer) evTimer = setTimeout(() => { postMessage({ type: 'events', names: [...evq] }); evq = new Set(); evTimer = null; }, 50); }

let last = performance.now();
setInterval(() => { const now = performance.now(), dt = now - last; last = now; if (k) { try { k.tick(dt); } catch (e) { console.error(e); } } }, 200);

async function start(images) {
  if (unsub) unsub();
  for (const v of (k ? [...k.views.keys()] : [])) k.closeView(v);
  k = await Kernel.create({ images, bridge, seed: images ? null : seed });
  unsub = k.on((type) => onEvent(type));
  // Restored stores: wake every actor that has alarms or reactors so cursors catch up.
  if (images) for (const s of k.storeRows()) { if (s.app && k.hasActor(s.id)) { try { const a = k.actor(s.id); a.ensure(); } catch (e) { /* shown in the Actors view */ } } }
  return overview();
}

function overview() {
  const stores = k.storeRows().map(s => {
    const st = k.stores.get(s.id); const a = k.actors.get(s.id);
    return { ...s, rev: st ? st.rev : null, running: st ? Number(st.meta('app_version') || 0) || null : null, main: s.app ? k.appMain(s.app) : (st && st.refs().find(r => r.name === 'main') ? st.refs().find(r => r.name === 'main').n : null),
      isApp: !!(st && st.readText('app.json') != null), failed: k.failedActivation.get(s.id) || null,
      actor: a ? { state: a.state, inbox: a.inbox.length, waiting: a.waiting.size, error: a.errors[0] || null, reactorErrors: Object.keys(a.reactorErrors).length } : (s.app && k.hasActor(s.id) ? { state: 'cold' } : null) };
  });
  return {
    now: k.clock.now, running: k.clock.running, speed: k.clock.speed, next: k.nextEventAt(),
    faults: { ...k.faults }, stores, principals: [...k.access.principals(), { id: 'anon', kind: 'anon', name: 'Anonymous', role: 'none' }],
    mounts: k.mounts(), views: [...k.views.values()].map(v => ({ id: v.id, store: v.store, principal: v.principal.id })),
    turnSeq: k.turnSeq, activations: k.activations.slice(0, 20), steps: k.steps().slice(0, 30), activeSteps: { ...k.activeStep },
    approvals: k.system.db.kall('SELECT * FROM approvals ORDER BY app, version'), pageLogs: k.pageLogs.slice(-60),
  };
}

function storeInfo({ id }) {
  const st = k.store(id); const a = k.actors.get(id);
  const { app, version, manifest } = k.storeManifest(id);
  let desc = a && a.desc;
  if (!desc && app && k.hasActor(id)) { try { const x = k.actor(id); x.ensure(); desc = x.desc; } catch (e) { /* cold */ } }
  const ac = k.actors.get(id);
  return {
    id, meta: st.meta(), rev: st.rev, epoch: st.epoch, app, version, main: app ? k.appMain(app) : null, failed: k.failedActivation.get(id) || null,
    manifest: manifest ? { ...manifest, __app: undefined } : null,
    colls: st.listColls(), tables: st.db.appObjects().map(o => ({ name: o.name, type: o.type, sql: o.sql, columns: st.db.tableInfo(o.name), rows: o.type === 'table' ? st.db.kval(`SELECT count(*) FROM "${o.name}"`) : null })),
    files: st.listFiles('tree'), assets: st.listFiles('assets'), refs: st.refs(), snapshots: st.snapshots(), isApp: st.readText('app.json') != null,
    alarms: st.db.kall('SELECT name, at, every, running, data FROM _alarms ORDER BY at'), cursors: st.db.kall('SELECT * FROM _cursors ORDER BY name'),
    migrations: st.db.kall('SELECT * FROM _migrations ORDER BY name'), commits: st.commits({ limit: 80 }),
    grants: k.system.db.kall('SELECT * FROM grants WHERE store = ? ORDER BY subject', [id]),
    instances: k.instancesOf(id),
    actor: ac ? { state: ac.state, code: ac.appId ? `${ac.appId}@${ac.version}` : null, desc: ac.desc || desc || null, inbox: ac.inbox.map(e => ({ kind: e.kind, name: e.name })), waiting: [...ac.waiting.values()].map(w => w.origin && w.origin.label), deferreds: ac.deferreds.size, turns: ac.turns, cpuMs: +ac.cpuMs.toFixed(1), errors: ac.errors, reactorErrors: ac.reactorErrors, crashes: ac.crashes.length } : null,
    activations: k.activations.filter(x => x.store === id).slice(0, 10),
  };
}

const P = (as) => k.access.principal(as || 'usr_me');
const OPS = {
  boot: ({ images }) => start(images),
  reset: () => start(null),
  overview,
  storeInfo,
  docs: ({ store, coll }) => k.store(store).queryDocs(coll, { limit: 500 }).rows,
  doc: ({ store, path }) => k.store(store).getDoc(path),
  file: ({ store, path, at }) => { const f = k.store(store).readFile(path, { at }); return f ? { type: f.type, text: new TextDecoder().decode(f.bytes), size: f.bytes.length } : null; },
  turns: ({ since = 0, limit = 400 }) => k.turnsLog.filter(t => t.id > since).slice(-limit).map(t => ({ id: t.id, store: t.store, principal: t.principal, via: t.via, kind: t.kind, label: t.label, status: t.status, rev: t.rev, ms: t.ms, now: t.now, n: t.statements.length, denied: !!t.denied || t.statements.some(s => s.auth && s.auth.some(x => !x.ok)), error: t.error })),
  turn: ({ id }) => k.turnsLog.find(t => t.id === id) || null,
  run: async ({ as, line, input, via = 'cli', readOnly = false }) => {
    if (readOnly && isWrite(line)) { const e = new Error('read-only mode: this command changes something'); e.code = 'permission_denied'; throw e; }
    const { verb } = parse(line);
    if (verb === 'as') return { text: '(as is handled by the console)' };
    k.currentVia = via;
    try { return await runLine(k, P(as), line, input); } finally { k.currentVia = null; }
  },
  verb: async ({ as, verb, args = [], flags = {}, input, via = 'ui' }) => {
    const v = VERBS[verb]; if (!v) throw Object.assign(new Error(`no verb ${verb}`), { code: 'invalid_argument' });
    k.currentVia = via;
    try { return await v.run(k, P(as), args, flags, input); } finally { k.currentVia = null; }
  },
  isWrite: ({ line }) => isWrite(line),
  matrix: () => {
    const stores = k.storeRows().filter(s => s.id !== 'system');
    return [...k.access.principals(), k.access.principal('anon')].map(p => ({ p: { id: p.id, name: p.name, kind: p.kind }, levels: Object.fromEntries(stores.map(s => { try { return [s.id, k.access.level(p, s.id).level]; } catch { return [s.id, 'none']; } })) }));
  },
  approvalsInfo: () => {
    const NEEDS = ['sample', 'mcp', 'fetch', 'secrets', 'spawn', 'platform'];
    const out = [];
    for (const s of k.storeRows()) {
      const st = k.stores.get(s.id); if (!st || st.readText('app.json') == null) continue;
      const main = k.appMain(s.id);
      for (const sn of st.snapshots()) {
        const m = st.manifestAt(sn.n); if (!m) continue;
        const declared = NEEDS.filter(c => c in ((m.manifest && m.manifest.capabilities) || {}) || c in ((m.manifest && m.manifest.slop) || {}));
        if (!declared.length) continue;
        const a = k.system.db.kone('SELECT caps FROM approvals WHERE app = ? AND version = ?', [s.id, sn.n]);
        out.push({ app: s.id, version: sn.n, isMain: sn.n === main, declared, approved: a ? JSON.parse(a.caps) : [] });
      }
    }
    return out;
  },
  resolve: ({ host, path, as, method }) => k.resolve(host, path, as || 'usr_me', method || 'GET'),
  createFromMount: ({ app, id, as }) => {
    const p = P(as); const who = k.access.who(p);
    const inst = k.system.db.kall('SELECT * FROM instantiate WHERE app = ?', [app]);
    const ok = who.role === 'admin' || inst.some(g => g.subject === who.id || g.subject === '*anyone' || (g.subject === '*signed-in' && ['member', 'admin'].includes(who.role)));
    if (!ok) throw Object.assign(new Error(`${who.id} may not create ${app} stores`), { code: 'permission_denied' });
    const r = k.createStore(p, { id, app, type: app, owner: who.id });
    k.activate(id);
    return r;
  },
  openView: ({ store, as }, ports) => {
    const port = ports[0];
    const info = k.openView(store, as || 'usr_me', (msg) => { try { port.postMessage(msg); } catch { /* closed */ } });
    port.onmessage = async (ev) => {
      const { id, method, args } = ev.data || {};
      if (!id) return;
      try { const value = await k.pageRpc(info.view, method, args); port.postMessage({ id, ok: true, value: value === undefined ? null : value }); }
      catch (e) { port.postMessage({ id, ok: false, error: { code: e.code || 'unavailable', message: String(e.message || e) } }); }
    };
    let html; try { html = k.pageHtml(store, info); } catch (e) { k.closeView(info.view); throw e; }
    return { ...info, html };
  },
  closeView: ({ view }) => { k.closeView(view); return null; },
  // Downloads: one store as its SQLite file, or as readable JSON.
  storeImage: ({ id }) => ({ id, bytes: k.store(id).db.export() }),
  dumpStore: ({ id }) => {
    const st = k.store(id);
    const docs = st.db.kall('SELECT path, body, version, rev, at, by FROM _docs WHERE body IS NOT NULL ORDER BY path').map(r => ({ path: r.path, data: JSON.parse(r.body), version: r.version, rev: r.rev, at: new Date(r.at).toISOString(), by: r.by }));
    const tables = {};
    for (const o of st.db.appObjects()) tables[o.name] = { type: o.type, sql: o.sql, rows: st.db.kall(`SELECT * FROM "${o.name}"`) };
    const files = st.listFiles('tree').map(f => { const b = st.blob(f.sha256); const text = /^text\/|json|javascript|sql|svg|markdown/.test(f.type) ? new TextDecoder().decode(b) : undefined; return { path: f.path, type: f.type, size: f.size, rev: f.rev, text }; });
    return {
      format: 'slop-store-dump/1', store: id, exported_at: new Date().toISOString(), clock: new Date(k.clock.now).toISOString(),
      meta: st.meta(), rev: st.rev, epoch: st.epoch, documents: docs, tables, files,
      assets: st.listFiles('assets').map(f => ({ path: f.path, type: f.type, size: f.size })),
      snapshots: st.snapshots(), refs: st.refs(), grants: k.system.db.kall('SELECT subject, level, via FROM grants WHERE store = ?', [id]),
      log: st.commits({ limit: 1000 }).map(c => ({ rev: c.rev, at: new Date(c.at).toISOString(), principal: c.principal, via: c.via, step: c.step, summary: c.summary, changes: c.changes.map(x => `${x.op} ${x.kind}:${x.key}`) })),
    };
  },
  threadSave: ({ id, title, data }) => { k.system.db.krun('INSERT INTO lab_threads(id, title, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, updated_at = excluded.updated_at', [id, title || '', JSON.stringify(data), Date.now()]); k.dirty.add('system'); k.emit('stores'); return null; },
  threadLoad: () => { const r = k.system.db.kone('SELECT * FROM lab_threads ORDER BY updated_at DESC LIMIT 1'); return r ? { id: r.id, title: r.title, data: JSON.parse(r.data) } : null; },
  threadList: () => k.system.db.kall('SELECT id, title, updated_at FROM lab_threads ORDER BY updated_at DESC'),
  threadGet: ({ id }) => { const r = k.system.db.kone('SELECT * FROM lab_threads WHERE id = ?', [id]); return r ? { id: r.id, title: r.title, data: JSON.parse(r.data) } : null; },
  exportImages: () => { const out = k.exportImages({ all: true }); return { stores: out.stores, at: k.clock.now }; },
  clockSet: async ({ running, speed, advance }) => { if (running !== undefined) k.clock.running = running; if (speed) k.clock.speed = speed; if (advance) await k.advanceTo(k.clock.now + advance); k.emit('clock'); return { now: k.clock.now, running: k.clock.running, speed: k.clock.speed, next: k.nextEventAt() }; },
  startStep: ({ as, message, via }) => k.startStep(P(as), message, via || 'agent'),
  endStep: ({ as }) => k.endStep(P(as)),
};

onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'reply') { const p = pending.get(m.reqId); if (p) { pending.delete(m.reqId); m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error && m.error.message || 'failed'), { code: m.error && m.error.code })); } return; }
  const { id, op, args } = m;
  try {
    if (!OPS[op]) throw new Error(`unknown op ${op}`);
    if (!k && op !== 'boot' && op !== 'reset') throw Object.assign(new Error('the kernel is not booted'), { code: 'unavailable' });
    const value = await OPS[op](args || {}, e.ports);
    postMessage({ type: 'res', id, ok: true, value });
  } catch (err) {
    postMessage({ type: 'res', id, ok: false, error: { code: err.code || 'error', message: String(err.message || err), trace: err.trace } });
  }
};
postMessage({ type: 'ready' });
export { fmtTime };
