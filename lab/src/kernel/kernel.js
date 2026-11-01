// The slop v3 kernel: stores, turns and commits, apps and activation, actors, views, mounts,
// access, the clock, steps, and the verb table that the doors (console, agent, UI) share.
import { initSqlite } from './sqlite.js';
import { Store, STORE_SCHEMA } from './store.js';
import { Access, ALWAYS_ON } from './access.js';
import { Actor, initQuickJS, matchSelector } from './actors.js';
import { err, rid, lv, enc, dec, isText, guessType, docPath, clean, sha256 } from './util.js';
import SHIM from '../runtime/shim.js.txt';

const SYSTEM_SCHEMA = `
CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT '', app TEXT, owner TEXT NOT NULL, created_at INTEGER NOT NULL, forked_from TEXT, made_by TEXT);
CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'none', user_id TEXT, max_level TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grants(store TEXT NOT NULL, subject TEXT NOT NULL, level TEXT NOT NULL, via TEXT NOT NULL DEFAULT 'direct', created_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(store, subject, via));
CREATE TABLE IF NOT EXISTS instantiate(app TEXT NOT NULL, subject TEXT NOT NULL, per_day INTEGER NOT NULL DEFAULT 50, PRIMARY KEY(app, subject));
CREATE TABLE IF NOT EXISTS approvals(app TEXT NOT NULL, version INTEGER NOT NULL, caps TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL, PRIMARY KEY(app, version));
CREATE TABLE IF NOT EXISTS mounts(host TEXT NOT NULL, path TEXT NOT NULL, store TEXT, store_param TEXT, type TEXT, on_missing TEXT NOT NULL DEFAULT 'none', create_app TEXT, mode TEXT NOT NULL DEFAULT 'live', changed_by TEXT, changed_at INTEGER NOT NULL, PRIMARY KEY(host, path));
CREATE TABLE IF NOT EXISTS mount_log(id INTEGER PRIMARY KEY, host TEXT NOT NULL, path TEXT NOT NULL, before TEXT, after TEXT, by TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS steps(id TEXT PRIMARY KEY, principal TEXT NOT NULL, via TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, ended_at INTEGER, state TEXT NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS step_commits(step TEXT NOT NULL, store TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(step, store, rev));
CREATE TABLE IF NOT EXISTS lab_threads(id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, updated_at INTEGER NOT NULL);
`;

let booted = null;
export async function bootEngines() { if (!booted) booted = Promise.all([initSqlite(), initQuickJS()]); return booted; }

export class Kernel {
  constructor({ bridge = {}, clockNow } = {}) {
    this.stores = new Map(); this.actors = new Map(); this.access = new Access(this);
    this.turnsLog = []; this.turnSeq = 0; this.listeners = new Set(); this.bridge = bridge;
    this.clock = { now: clockNow || Date.now(), running: true, speed: 1, timers: [] };
    this.faults = { crashNext: null, failNextCommit: null };
    this.views = new Map(); this.rooms = new Map(); this.watches = new Map();
    this.activeStep = {}; this.dirty = new Set(); this.activations = []; this.manifests = new Map();
    this.failedActivation = new Map(); this.currentVia = null; this.pageLogs = [];
  }
  static async create({ images, bridge, seed } = {}) {
    await bootEngines();
    const k = new Kernel({ bridge });
    if (images && images.system) {
      k.system = k.addStore(new Store('system', images.system));
      for (const [id, bytes] of Object.entries(images.stores || images)) if (id !== 'system' && bytes instanceof Uint8Array) k.addStore(new Store(id, bytes));
      k.system.db.kexec(SYSTEM_SCHEMA); // older images gain the tables added since
      // A saved world can hold steps that were never ended (a closed tab); they stay open in the record, but nobody is in them now.
      k.system.db.krun("UPDATE steps SET state = 'done', ended_at = coalesce(ended_at, started_at) WHERE state = 'open'");
    } else {
      k.system = k.addStore(new Store('system'));
      k.system.db.kexec(SYSTEM_SCHEMA);
      k.system.db.krun("INSERT INTO stores(id, type, app, owner, created_at) VALUES ('system', 'system', NULL, 'system', ?)", [k.clock.now]);
      k.system.setMeta('id', 'system'); k.system.setMeta('type', 'system'); k.system.setMeta('epoch', 1);
      if (seed) await seed(k);
    }
    return k;
  }

  addStore(st) { this.stores.set(st.id, st); this.installFns(st); return st; }
  // SQL functions code and views may use: slop_principal(), slop_level(), slop_now().
  installFns(st) {
    st.db.fn('slop_principal', () => (st.cur ? st.cur.id : null));
    st.db.fn('slop_level', () => { const c = st.cur; if (!c) return 'none'; if (c.level == null) { try { c.level = c.p.kind === 'system' ? 'owner' : this.access.level(c.p, st.id).level; } catch { c.level = 'none'; } } return c.level; });
    st.db.fn('slop_now', () => (st.cur ? st.cur.now : this.clock.now));
  }

  // ---------- events ----------
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(type, data) { for (const f of this.listeners) { try { f(type, data); } catch { /* listener */ } } }

  // ---------- registry ----------
  store(id) { const s = this.stores.get(id); if (!s) throw err('not_found', `no store "${id}"`); return s; }
  storeRows() { return this.system.db.kall('SELECT * FROM stores ORDER BY id'); }
  sysTurn(p, label, fn, via = 'kernel') { return this.turn({ store: 'system', principal: p, via, kind: 'platform', label }, fn); }
  createStore(p, { id, type = '', app = null, from = null, owner } = {}) {
    id = id || rid('s-', 8);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw err('invalid_argument', `store ids are lowercase slugs: "${id}"`);
    if (this.stores.has(id)) throw err('conflict', `store "${id}" exists`);
    let st;
    if (from) { const src = this.store(from); st = new Store(id, src.db.export()); st.setMeta('forked_from', from); st.setMeta('forked_at', src.rev); type = type || src.meta('type') || ''; app = app ?? src.meta('app') ?? null; }
    else { st = new Store(id); }
    const who = this.access.who(p);
    st.setMeta('id', id); st.setMeta('type', type); st.setMeta('owner', owner || who.id); st.setMeta('created_at', this.clock.now); st.setMeta('epoch', 1);
    if (app) st.setMeta('app', app); else st.db.krun("DELETE FROM _meta WHERE key = 'app'");
    st.db.krun("DELETE FROM _meta WHERE key = 'app_version'"); st.metaCache = null;
    this.addStore(st);
    this.sysTurn(p, `create store ${id}`, (t) => {
      this.system.db.krun('INSERT INTO stores(id, type, app, owner, created_at, forked_from) VALUES (?,?,?,?,?,?)', [id, type, app, owner || who.id, this.clock.now, from]);
      t.change({ kind: 'table', key: 'stores', op: 'insert', new: id });
    });
    this.dirty.add(id); this.emit('stores');
    return { id, type, app };
  }
  deleteStore(p, id) {
    if (id === 'system') throw err('invalid_argument', 'the system store cannot be deleted');
    const a = this.actors.get(id); if (a) { a.teardown('store deleted'); this.actors.delete(id); }
    const st = this.store(id); st.db.close(); this.stores.delete(id);
    this.sysTurn(p, `delete store ${id}`, (t) => {
      for (const tb of ['stores', 'grants', 'mounts']) this.system.db.krun(`DELETE FROM ${tb} WHERE ${tb === 'stores' ? 'id' : 'store'} = ?`, [id]);
      t.change({ kind: 'table', key: 'stores', op: 'delete', old: id });
    });
    this.dirty.add(id); this.emit('stores');
  }

  // ---------- turns ----------
  turn(o, fn, fin) {
    const st = this.store(o.store);
    const p = o.principal, who = this.access.who(p);
    if (o.via === 'cli' && this.currentVia) o = { ...o, via: this.currentVia };
    const t = { id: ++this.turnSeq, store: o.store, principal: p, who: who.id, via: o.via, kind: o.kind, label: o.label, app: o.app || null,
      step: o.step || (o.via !== 'actor' && !o.via.startsWith('reactor') ? this.activeStep[p.id] || null : null),
      now: this.clock.now, statements: [], logs: [], changes: [], hints: [], awaits: [], released: [], after: [], status: 'running', rev: null, error: null,
      t0: performance.now(), change(c) { this.changes.push(c); } };
    const db = st.db;
    if (st.inTurn) throw err('conflict', `${o.store} already has a turn open (${st.inTurn}); turns do not nest`);
    st.inTurn = o.label || o.kind;
    const prevCur = st.cur; st.cur = { id: p.kind === 'app' ? p.id : who.id, p, now: t.now };
    const prev = [db.hints, db.readSet, db.writeSet];
    db.hints = t.hints; db.readSet = new Set(); db.writeSet = new Set();
    let result, failed = null;
    db.kexec('BEGIN IMMEDIATE');
    try {
      result = fn(t);
      for (const tbl of db.writeSet) t.changes.push({ kind: 'table', key: tbl, op: 'write' });
      for (const h of t.hints) if (db.writeSet.has(h.table)) t.changes.push({ kind: 'row', key: `${h.table}:${h.rowid}`, op: h.op });
      const real = t.changes.filter(c => c.kind !== 'bookkeeping');
      if (real.length && this.faults.failNextCommit === o.store) { this.faults.failNextCommit = null; this.emit('faults'); throw err('unavailable', 'fault injected: the commit failed'); }
      if (real.length) {
        const rev = st.rev + 1;
        const viaS = p.kind === 'token' || p.kind === 'delegate' ? `${o.via} (${p.id})` : o.via;
        db.krun('INSERT INTO _log(rev, at, principal, via, app, step, summary) VALUES (?,?,?,?,?,?,?)', [rev, t.now, who.id, viaS, t.app, t.step, o.label || '']);
        real.forEach((c, i) => db.krun('INSERT INTO _changes(rev, seq, kind, key, op, version, old, new) VALUES (?,?,?,?,?,?,?,?)', [rev, i, c.kind, c.key, c.op, c.version ?? null, c.old ?? null, c.new ?? null]));
        for (const tb of ['_docs', '_files', '_snapshots']) db.krun(`UPDATE ${tb} SET rev = ? WHERE rev = -1`, [rev]);
        t.rev = rev;
      }
      db.kexec('COMMIT');
      t.status = t.rev ? 'commit' : 'no writes';
    } catch (e) {
      try { db.kexec('ROLLBACK'); } catch { /* already rolled back */ }
      t.status = 'rollback'; t.error = { code: e.code || 'actor_error', message: String(e.message || e) };
      failed = e;
    } finally {
      [db.hints, db.readSet, db.writeSet] = prev;
      st.inTurn = null; st.cur = prevCur;
      t.ms = +(performance.now() - t.t0).toFixed(2);
      if (fin) fin();
    }
    if (!(o.quiet && !t.rev && !failed)) this.recordTurn(t);
    if (failed) throw failed;
    if (t.rev) this.afterCommit(st, t);
    for (const f of t.after) { try { f(); } catch { /* caller gone */ } }
    for (const r of t.released) if (r.kind === 'room') this.roomEmit(r.store, { id: `app:${st.meta('app')}`, name: 'actor' }, r.topic, r.data, true);
    return result;
  }
  recordTurn(t) {
    const rec = { id: t.id, store: t.store, principal: t.principal.id, who: t.who, via: t.via, kind: t.kind, label: t.label, app: t.app, step: t.step, now: t.now, status: t.status, rev: t.rev, error: t.error, ms: t.ms, cpuMs: t.cpuMs ? +t.cpuMs.toFixed(2) : undefined,
      statements: t.statements.map(s => ({ ...s, bind: s.bind })), logs: t.logs, changes: t.changes.map(c => ({ kind: c.kind, key: c.key, op: c.op, version: c.version })), hints: t.hints.slice(0, 50), awaits: t.awaits, released: t.released.map(r => ({ kind: r.kind, topic: r.topic })), event: t.event || null, denied: t.denied || null };
    this.turnsLog.push(rec); if (this.turnsLog.length > 400) this.turnsLog.splice(0, this.turnsLog.length - 400);
    this.emit('turn', { id: rec.id, store: rec.store, status: rec.status });
  }
  // A denial outside any turn (a read, a refused call) is recorded as a turn of its own.
  recordDenied(store, p, label, error, trace, statements = [], via = this.currentVia || 'page') {
    const rec = { id: ++this.turnSeq, store, principal: p.id, who: this.access.who(p).id, via, kind: 'denied', label, status: 'denied', rev: null, error: { code: error.code, message: error.message }, ms: 0, statements, logs: [], changes: [], hints: [], awaits: [], released: [], denied: trace, now: this.clock.now };
    this.turnsLog.push(rec); this.emit('turn', { id: rec.id, store, status: 'denied' });
  }
  recordRead(store, p, label, statements, via = 'page') {
    const rec = { id: ++this.turnSeq, store, principal: p.id, who: this.access.who(p).id, via, kind: 'read', label, status: 'read', rev: null, error: null, ms: statements.reduce((a, s) => a + s.ms, 0), statements, logs: [], changes: [], hints: [], awaits: [], released: [], now: this.clock.now };
    this.turnsLog.push(rec); this.emit('turn', { id: rec.id, store, status: 'read' });
  }
  afterCommit(st, t) {
    const commit = { store: st.id, epoch: st.epoch, rev: t.rev, at: t.now, principal: t.who, via: t.via, app: t.app, step: t.step, label: t.label, changes: t.changes.map(c => ({ kind: c.kind, key: c.key, op: c.op, version: c.version })) };
    this.dirty.add(st.id);
    if (t.step) this.system.db.krun('INSERT OR IGNORE INTO step_commits(step, store, rev) VALUES (?,?,?)', [t.step, st.id, t.rev]);
    this.emit('commit', commit);
    // views: commits and live queries
    for (const v of this.views.values()) if (v.store === st.id) this.viewCommit(v, commit);
    // reactors: the store's own actor, and actors that follow this store
    queueMicrotask(() => {
      const app = st.id === 'system' ? null : st.meta('app');
      if (app && this.hasActor(st.id)) { const a = this.actor(st.id); try { if (!a.desc) a.ensure(); a.catchUp(st.id); } catch (e) { a.errors.unshift(e.message); this.emit('actors'); } }
      for (const a of this.actors.values()) if (a.storeId !== st.id && a.desc && a.selectors().some(s => s.source === st.id)) a.catchUp(st.id);
    });
  }

  // ---------- apps ----------
  appMain(appId) { try { const st = this.store(appId); const m = st.manifestAt('main'); return m ? m.n : null; } catch { return null; } }
  manifestOf(appId, version) {
    if (!appId || !version) return null;
    const key = `${appId}@${version}`;
    if (!this.manifests.has(key)) { const m = this.store(appId).manifestAt(version); this.manifests.set(key, m ? { ...m.manifest, __app: appId } : null); }
    return this.manifests.get(key);
  }
  storeManifest(storeId) { const st = this.store(storeId); const app = st.meta('app'); const v = Number(st.meta('app_version') || 0); return { app, version: v, manifest: this.manifestOf(app, v) }; }
  hasActor(storeId) { const st = this.store(storeId); const app = st.meta('app'); if (!app) return false; const v = Number(st.meta('app_version') || 0) || this.appMain(app); return !!(v && this.stores.has(app) && this.store(app).readText('actor.js', { at: v }) != null); }
  actor(storeId) { if (!this.actors.has(storeId)) this.actors.set(storeId, new Actor(this, storeId)); return this.actors.get(storeId); }
  actorCaps(manifest, appId, version) {
    const caps = ['sql', 'db', 'alarm', 'log', 'time', 'stores', 'ui'];
    const declared = { ...(manifest && manifest.capabilities || {}), ...(manifest && manifest.slop || {}) };
    if ('room' in declared) caps.push('room');
    if ('sample' in declared && this.access.capability('sample', manifest, version, { kind: 'app' }).ok) caps.push('sample');
    return caps;
  }
  // Activation: migrations, setup and smoke in one transaction (section 6.4).
  activate(storeId, p = this.access.principal('system'), step = null) {
    const st = this.store(storeId); const appId = st.meta('app'); const v = this.appMain(appId);
    if (!v) throw err('not_found', `${appId} has no published version`);
    const app = this.store(appId); const files = app.treeAt(v);
    const migrations = files.filter(f => /^sql\/[^/]+\.sql$/.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
    const hasActor = files.some(f => f.path === 'actor.js');
    const record = { store: storeId, app: appId, version: v, at: this.clock.now, ok: false, steps: [] };
    const a = hasActor ? this.actor(storeId) : null;
    try {
      this.turn({ store: storeId, principal: p, via: 'kernel', kind: 'activation', label: `activate ${appId}@${v}`, app: `${appId}@${v}`, step }, (t) => {
        for (const m of migrations) {
          const name = m.path.slice(4);
          if (st.db.kone('SELECT 1 AS x FROM _migrations WHERE app = ? AND name = ?', [appId, name])) continue;
          st.db.q('migration', dec(app.blob(m.sha256)), null, { mode: 'script', turn: t, budgetMs: 5000 });
          st.db.krun('INSERT INTO _migrations(app, name, sha256, rev) VALUES (?,?,?,?)', [appId, name, m.sha256, st.rev + 1]);
          t.change({ kind: 'schema', key: name, op: 'migrate' });
          record.steps.push(`migration ${name}`);
        }
        if (a) {
          a.teardown('activation'); a.boot(appId, v); a.t = t; t.origin = { label: 'setup', principal: p, kind: 'setup' };
          for (const k of ['setup', 'smoke']) {
            if (!a.desc[k]) continue;
            const out = JSON.parse(a.run(() => a.callGlobal('__dispatch', [k, k, JSON.stringify(a.ctxFor(p, { kind: k, name: k }, t)), 'null'])));
            if (out.pending) throw err('actor_error', `${k} must be synchronous`);
            a.run(() => a.drain());
            record.steps.push(k);
          }
          a.t = null;
        }
        if (Number(st.meta('app_version') || 0) !== v) { st.setMeta('app_version', v); t.change({ kind: 'bookkeeping', key: 'app_version', op: 'set' }); }
        st.setMeta('last_good', v);
      });
      record.ok = true;
      if (a) { a.syncAlarms(); a.catchUp(); }
    } catch (e) {
      record.error = e.message;
      if (a) { a.teardown('activation failed'); a.state = 'cold'; a.errors.unshift(`activation of ${appId}@${v} failed: ${e.message}`); }
      this.activations.unshift(record); this.emit('actors');
      throw err(e.code || 'actor_error', `activation of ${appId}@${v} on ${storeId} rolled back: ${e.message}`);
    }
    this.activations.unshift(record); this.activations = this.activations.slice(0, 50);
    this.emit('actors');
    return record;
  }

  retryReactors() { for (const a of this.actors.values()) { if (Object.keys(a.reactorErrors).length) { a.reactorErrors = {}; try { if (a.desc) a.catchUp(); } catch { /* shown in Actor */ } } } this.emit('actors'); }
  instancesOf(appId) { return this.system.db.kall('SELECT id FROM stores WHERE app = ? ORDER BY id', [appId]).map(r => r.id); }
  // Publishing: snapshot the tree, move main, then activate every store that runs this app.
  publish(p, id, message = '') {
    const c = this.access.can(p, id, 'files.write');
    if (!c.ok) { this.recordDenied(id, p, `publish ${id}`, err(c.code, 'denied'), c.trace); throw err(c.code, `${p.id} may not publish ${id}`, { trace: c.trace }); }
    const st = this.store(id);
    const mj = st.readText('app.json');
    if (mj != null) { try { JSON.parse(mj); } catch (e) { throw err('invalid_argument', `app.json does not parse: ${e.message}`); } }
    const snap = this.turn({ store: id, principal: p, via: 'cli', kind: 'publish', label: `publish${message ? ': ' + message : ''}` }, t => st.snapshot(t, { message, ref: 'main' }));
    this.manifests.clear();
    const activations = mj != null ? this.activateAll(id, this.activeStep[p.id] || null) : [];
    this.emit('stores');
    return { snapshot: snap.n, unchangedFrom: snap.unchangedFrom || undefined, activations };
  }
  activateAll(appId, step = null) {
    return this.instancesOf(appId).map(s => {
      this.failedActivation.delete(s);
      try { const r = this.activate(s, this.access.principal('system'), step); return { store: s, ok: true, version: r.version, steps: r.steps.join(', ') || 'nothing to run' }; }
      catch (e) { this.failedActivation.set(s, this.appMain(appId)); return { store: s, ok: false, error: e.message, running: Number(this.store(s).meta('app_version') || 0) || null }; }
    });
  }
  // Before serving a store: activate main once; on failure keep running the last good version.
  ensureActivated(storeId) {
    const st = this.store(storeId); const app = st.meta('app'); if (!app) return;
    const main = this.appMain(app); if (!main) return;
    const running = Number(st.meta('app_version') || 0);
    if (running === main || this.failedActivation.get(storeId) === main) return;
    try { this.activate(storeId); this.failedActivation.delete(storeId); }
    catch (e) { this.failedActivation.set(storeId, main); if (!running) throw e; }
  }

  // ---------- async host operations for actors ----------
  hostAsync(actor, op, args, origin) {
    if (op === 'sleep') return new Promise(res => this.after(Number(args[0]) || 0, () => res(null)));
    if (op === 'sample') {
      if (!this.bridge.sample) return Promise.reject(err('unavailable', 'Claude is not available here (no sample capability)'));
      return this.bridge.sample(args[0], { ...(args[1] || {}), tools: undefined }).then(r => ({ text: r.text, truncated: !!r.truncated }));
    }
    if (op === 'stores.call') {
      const p = this.access.principal(`app:${actor.appId}`);
      const c = this.access.can(p, args[0], 'call');
      if (!c.ok) return Promise.reject(err(c.code, `app:${actor.appId} may not call ${args[0]}: ${c.trace.slice(-1)[0]}`));
      return this.callAction(p, args[0], args[1], args[2], { onBehalfOf: origin && origin.principal && origin.principal.id });
    }
    return Promise.reject(err('invalid_argument', `unknown async op ${op}`));
  }
  callAction(p, storeId, name, args, extra = {}) {
    const c = this.access.can(p, storeId, 'call');
    if (!c.ok) { this.recordDenied(storeId, p, `action ${name}`, err(c.code, 'denied'), c.trace); return Promise.reject(err(c.code, c.trace.slice(-1)[0])); }
    if (!this.hasActor(storeId)) return Promise.reject(err('not_found', `${storeId} has no actor`));
    return this.actor(storeId).enqueue({ kind: 'action', name, arg: args ?? null, principal: p, step: this.activeStep[p.id] || null, ...extra });
  }

  // ---------- clock ----------
  after(ms, fn) { this.clock.timers.push({ at: this.clock.now + ms, fn }); this.clock.timers.sort((a, b) => a.at - b.at); }
  scheduleChanged() { this.emit('clock'); }
  dueAlarms(upto) {
    const out = [];
    for (const [id, st] of this.stores) {
      if (id === 'system') continue;
      for (const a of st.db.kall('SELECT name, at, running FROM _alarms WHERE at <= ? ORDER BY at', [upto])) out.push({ store: id, ...a });
    }
    return out.sort((a, b) => a.at - b.at);
  }
  nextEventAt() {
    let best = this.clock.timers.length ? this.clock.timers[0].at : Infinity;
    for (const [id, st] of this.stores) { if (id === 'system') continue; const r = st.db.kval('SELECT min(at) FROM _alarms WHERE running = 0'); if (r != null && r < best) best = r; }
    return best === Infinity ? null : best;
  }
  // Advance the virtual clock, firing timers and alarms in time order. Async: after each firing the
  // actor's event settles before the next due alarm is considered.
  async advanceTo(target, quiet = false) {
    if (this.advancing) { this.advancePending = Math.max(this.advancePending || 0, target); return 0; }
    this.advancing = true;
    let fired = 0;
    try {
    for (let guard = 0; guard < 5000; guard++) {
      const t = this.clock.timers[0];
      const due = this.dueAlarms(target).filter(a => !a.running && !this.firing.has(a.store + '/' + a.name));
      const nextAlarm = due[0];
      const nextAt = Math.min(t ? t.at : Infinity, nextAlarm ? Math.max(nextAlarm.at, this.clock.now) : Infinity);
      if (nextAt > target || nextAt === Infinity) break;
      this.clock.now = Math.max(this.clock.now, nextAt);
      fired++;
      if (t && t.at <= this.clock.now) { this.clock.timers.shift(); t.fn(); }
      else if (nextAlarm) this.fireAlarm(nextAlarm.store, nextAlarm.name, nextAlarm.at < this.clock.now - 60000);
      await new Promise(r => setTimeout(r, 0));
    }
    this.clock.now = Math.max(this.clock.now, target);
    } finally { this.advancing = false; }
    if (fired || !quiet) this.emit('clock');
    if (this.advancePending > this.clock.now) { const n = this.advancePending; this.advancePending = 0; fired += await this.advanceTo(n, quiet); }
    return fired;
  }
  get firing() { return this._firing || (this._firing = new Set()); }
  fireAlarm(storeId, name, late = false) {
    const key = storeId + '/' + name;
    if (!this.hasActor(storeId)) { this.store(storeId).db.krun('DELETE FROM _alarms WHERE name = ?', [name]); return; }
    this.firing.add(key);
    this.actor(storeId).enqueue({ kind: 'every', name, late, principal: this.access.principal('system') })
      .catch(e => { this.store(storeId).db.krun('UPDATE _alarms SET at = ? WHERE name = ? AND running = 0', [this.clock.now + 60000, name]); this.actor(storeId).errors.unshift(`alarm ${name}: ${e.message}`); })
      .finally(() => { this.firing.delete(key); this.emit('actors'); });
  }
  tick(realMs) { if (this.clock.running) this.advanceTo(Math.round(this.clock.now + realMs * this.clock.speed), true); }

  // ---------- rooms ----------
  peers(storeId) { return [...(this.rooms.get(storeId) || new Map()).values()]; }
  roomEmit(storeId, from, topic, data, fromActor = false) {
    for (const v of this.views.values()) if (v.store === storeId) v.push({ type: 'room', topic, data, peer: from.id, name: from.name, isMe: v.principal.id === from.id && !fromActor });
    this.emit('room', { store: storeId, topic });
  }

  // ---------- views (pages) ----------
  openView(storeId, pid, push) {
    const p = this.access.principal(pid);
    const st = this.store(storeId);
    let { app, version, manifest } = this.storeManifest(storeId);
    if (app) { this.ensureActivated(storeId); ({ app, version, manifest } = this.storeManifest(storeId)); }
    const { level, trace } = this.access.level(p, storeId);
    if (level === 'none') throw err('permission_denied', `${p.id} has no access to ${storeId}: ${trace.slice(-1)[0]}`);
    const caps = Object.keys((manifest && manifest.capabilities) || {}).filter(c => this.access.capability(c, manifest, version, p).ok);
    caps.push('user', 'slop'); if (!caps.includes('permissions')) caps.push('permissions');
    const id = rid('v_', 8);
    const who = this.access.who(p);
    const v = { id, store: storeId, principal: p, app, version, manifest, caps, level, push, subs: new Map(), watches: new Map() };
    this.views.set(id, v);
    const room = this.rooms.get(storeId) || new Map(); room.set(id, { id: who.id, view: id, name: who.name, presence: {} }); this.rooms.set(storeId, room);
    this.peersChanged(storeId);
    return { view: id, store: storeId, type: st.meta('type'), app, version, caps, level, me: { id: who.id, name: who.name, kind: p.kind, guest: p.kind === 'guest' } };
  }
  closeView(id) {
    const v = this.views.get(id); if (!v) return;
    this.views.delete(id);
    const room = this.rooms.get(v.store); if (room) { room.delete(id); this.peersChanged(v.store); }
  }
  peersChanged(storeId) { const peers = this.peers(storeId); for (const v of this.views.values()) if (v.store === storeId) v.push({ type: 'peers', peers: peers.map(x => ({ ...x, isMe: x.view === v.id })) }); this.emit('views'); }
  viewCommit(v, commit) {
    const docs = commit.changes.filter(c => c.kind === 'doc');
    for (const [sid, sub] of v.subs) {
      if (docs.some(c => (sub.doc ? c.key === sub.doc : c.key.startsWith(sub.coll + '/') && c.key.split('/').length === sub.coll.split('/').length + 1))) {
        try { v.push({ type: 'snapshot', sub: sid, data: sub.doc ? this.pageDocGet(v, sub.doc) : this.pageQuery(v, sub.coll, sub.q) }); } catch (e) { v.push({ type: 'snapshot', sub: sid, error: { code: e.code, message: e.message } }); }
      }
    }
    const tables = new Set(commit.changes.filter(c => c.kind === 'table' || c.kind === 'row').map(c => c.key.split(':')[0]));
    for (const [wid, w] of v.watches) {
      if ([...w.readSet].some(x => tables.has(x)) || commit.changes.some(c => c.kind === 'schema')) {
        const now = performance.now(); if (now - (w.last || 0) < 100) { clearTimeout(w.timer); w.timer = setTimeout(() => this.rerunWatch(v, wid), 100); continue; }
        this.rerunWatch(v, wid);
      }
    }
    v.push({ type: 'commit', commit: { rev: commit.rev, epoch: commit.epoch, changes: commit.changes.length } });
  }
  rerunWatch(v, wid) { const w = v.watches.get(wid); if (!w) return; w.last = performance.now(); try { const r = this.pageSelect(v, w.name, w.q, true); w.readSet = r.readSet; v.push({ type: 'rows', watch: wid, rows: r.rows }); } catch (e) { v.push({ type: 'rows', watch: wid, error: { code: e.code, message: e.message } }); } }
  pageCan(v, op, target) {
    const c = this.access.can(v.principal, v.store, op, target, { manifest: v.manifest, version: v.version });
    if (!c.ok) { this.recordDenied(v.store, v.principal, `${op} ${target || ''}`, err(c.code, c.trace.slice(-1)[0]), c.trace); throw err(c.code, c.code === 'not_found' ? `${target} not found` : c.trace.filter(x => x.startsWith('✗')).join('; ')); }
    return c;
  }
  pageDocGet(v, path) {
    try { this.pageCan(v, 'doc.read', path); } catch (e) { if (e.code === 'not_found') return null; throw e; }
    return this.store(v.store).getDoc(path);
  }
  pageQuery(v, coll, q) {
    const st = this.store(v.store); const who = this.access.who(v.principal);
    const { rows } = st.queryDocs(coll, q || {});
    return rows.filter(r => this.access.can(v.principal, v.store, 'doc.read', r.path, { manifest: v.manifest, version: v.version }).ok || false).map(r => ({ ...r, mine: r.path.includes(`/${who.id}/`) }));
  }
  pageWrite(v, path, data, merge) {
    this.pageCan(v, 'doc.write', path);
    return this.turn({ store: v.store, principal: v.principal, via: 'page', kind: 'write', label: `db ${merge ? 'update' : 'set'} ${path}`, app: v.app ? `${v.app}@${v.version}` : null }, t => this.store(v.store).setDoc(t, path, data, { merge }));
  }
  pageDelete(v, path) {
    this.pageCan(v, 'doc.write', path);
    return this.turn({ store: v.store, principal: v.principal, via: 'page', kind: 'write', label: `db delete ${path}`, app: v.app ? `${v.app}@${v.version}` : null }, t => this.store(v.store).deleteDoc(t, path));
  }
  // Structured page queries: the kernel writes the SQL (section 5.1).
  pageSelect(v, name, q = {}, quiet = false) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw err('invalid_argument', `"${name}" is not a table or view name`);
    this.pageCan(v, 'sql.read', name);
    const st = this.store(v.store);
    const cols = st.db.tableInfo(name).map(c => c.name);
    if (!cols.length) throw err('not_found', `no table or view ${name}`);
    const pick = (c) => { if (!cols.includes(c)) throw err('invalid_argument', `${name} has no column "${c}"`); return `"${c}"`; };
    const sel = (q.columns && q.columns.length ? q.columns.map(pick) : ['*']).join(', ');
    const where = [], bind = [];
    const OPS = { '=': '=', '==': '=', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=', like: 'LIKE', is: 'IS' };
    for (const [c, op, val] of (q.where || []).slice(0, 10)) {
      if (op === 'in') { where.push(`${pick(c)} IN (${val.map(() => '?').join(', ')})`); bind.push(...val); continue; }
      if (!OPS[op]) throw err('invalid_argument', `operator ${op} is not supported`);
      where.push(`${pick(c)} ${OPS[op]} ?`); bind.push(val);
    }
    const order = (q.orderBy || []).map(([c, d]) => `${pick(c)} ${d === 'desc' ? 'DESC' : 'ASC'}`);
    const sql = `SELECT ${sel} FROM "${name}"${where.length ? ' WHERE ' + where.join(' AND ') : ''}${order.length ? ' ORDER BY ' + order.join(', ') : ''} LIMIT ${Math.min(10000, q.limit | 0 || 1000)}${q.offset ? ' OFFSET ' + (q.offset | 0) : ''}`;
    const fake = { statements: [] };
    const prevR = st.db.readSet; st.db.readSet = new Set();
    let rows, readSet;
    try {
      this.withPrincipalFns(st, v.principal, () => { rows = st.db.q('page', sql, bind, { turn: fake, budgetMs: 250 }); });
      readSet = st.db.readSet;
    } finally { st.db.readSet = prevR; }
    if (!quiet) this.recordRead(v.store, v.principal, `select ${name}`, fake.statements);
    return { rows, sql, readSet };
  }
  withPrincipalFns(st, p, f) {
    const who = this.access.who(p);
    const prev = st.cur;
    st.cur = { id: p.kind === 'app' ? p.id : who.id, now: this.clock.now, p };
    try { return f(); } finally { st.cur = prev; }
  }
  pageRpc(viewId, method, args) {
    const v = this.views.get(viewId); if (!v) throw err('not_found', 'this view is closed');
    const a = args || [];
    switch (method) {
      case 'db.get': return this.pageDocGet(v, a[0]);
      case 'db.query': return this.pageQuery(v, a[0], a[1]);
      case 'db.set': return this.pageWrite(v, a[0], a[1], !!a[2]);
      case 'db.delete': return this.pageDelete(v, a[0]);
      case 'db.subscribe': { const sid = a[0]; v.subs.set(sid, a[1]); return a[1].doc ? this.pageDocGet(v, a[1].doc) : this.pageQuery(v, a[1].coll, a[1].q); }
      case 'db.unsubscribe': v.subs.delete(a[0]); return null;
      case 'rid': return rid('', 12);
      case 'page.log': { this.pageLogs.push({ view: v.id, store: v.store, principal: v.principal.id, level: a[0], msg: String(a[1]).slice(0, 2000), at: this.clock.now }); if (this.pageLogs.length > 200) this.pageLogs.shift(); this.emit('pagelog'); return null; }
      case 'user.me': { const who = this.access.who(v.principal); return { id: who.id, name: who.name, kind: v.principal.kind, guest: v.principal.kind === 'guest', level: v.level, isOwner: v.level === 'owner', canEdit: lv(v.level) >= lv('admin') }; }
      case 'user.profiles': { const out = {}; for (const id of a[0] || []) { try { const p = this.access.principal(id); out[id] = { id, name: p.name }; } catch { out[id] = { id, name: '' }; } } return out; }
      case 'room.emit': { const need = (v.manifest && v.manifest.capabilities && v.manifest.capabilities.room && v.manifest.capabilities.room.topics && v.manifest.capabilities.room.topics[a[0]]) || 'admin'; this.pageCan(v, 'room.emit', typeof need === 'string' ? need : need.level || 'admin'); const who = this.access.who(v.principal); this.roomEmit(v.store, { id: who.id, name: who.name }, a[0], a[1]); return null; }
      case 'room.presence': { const r = this.rooms.get(v.store); const me = r && r.get(v.id); if (me) { me.presence = { ...me.presence, ...(a[0] || {}) }; this.peersChanged(v.store); } return null; }
      case 'room.peers': return this.peers(v.store).map(x => ({ ...x, isMe: x.view === v.id }));
      case 'slop.sql.select': return this.pageSelect(v, a[0], a[1]).rows;
      case 'slop.sql.watch': { const wid = a[0]; const r = this.pageSelect(v, a[1], a[2]); v.watches.set(wid, { name: a[1], q: a[2], readSet: r.readSet }); return r.rows; }
      case 'slop.sql.unwatch': v.watches.delete(a[0]); return null;
      case 'slop.actions.call': return this.callAction(v.principal, v.store, a[0], a[1]);
      case 'slop.log.since': this.pageCan(v, 'files.read'); return this.store(v.store).commits({ since: a[0] || 0, limit: 100 });
      case 'sample': {
        const c = this.access.capability('sample', v.manifest, v.version, v.principal);
        if (!c.ok) throw err('permission_denied', `sample: ${c.why}`);
        if (!this.bridge.sample) throw err('unavailable', 'Claude is not available here');
        return this.bridge.sample(a[0], a[1] || {});
      }
      case 'downloads.save': if (!this.bridge.download) throw err('unavailable', 'downloads are not available'); return this.bridge.download(a[0]);
      case 'assets.upload': {
        this.pageCan(v, 'doc.write', 'assets/x');
        const bytes = Uint8Array.from(atob(a[0].base64), c => c.charCodeAt(0));
        const id = rid('a_', 10);
        this.turn({ store: v.store, principal: v.principal, via: 'page', kind: 'write', label: `assets upload ${id}` }, t => this.store(v.store).writeFile(t, id, bytes, { zone: 'assets', type: a[0].type }));
        return { id, url: `data:${a[0].type};base64,${a[0].base64}`, sizeBytes: bytes.length, contentType: a[0].type };
      }
      case 'assets.list': return { assets: this.store(v.store).listFiles('assets').map(f => ({ id: f.path, sizeBytes: f.size, contentType: f.type })), usage: {} };
      default: throw err('invalid_argument', `unknown method ${method}`);
    }
  }
  // The page HTML: the app's index.html with its own files inlined and the runtime injected first.
  pageHtml(storeId, viewInfo) {
    const st = this.store(storeId); const app = st.meta('app') || storeId;
    const v = Number(st.meta('app_version') || 0) || this.appMain(app);
    const a = this.store(app);
    const html = a.readText('index.html', { at: v });
    if (html == null) throw err('not_found', `${app}@${v} has no index.html`);
    const tree = new Map(a.treeAt(v).map(f => [f.path, f]));
    const fileText = (p) => { const f = tree.get(p.replace(/^\.\//, '')); return f ? dec(a.blob(f.sha256)) : null; };
    const dataUrl = (p) => { const f = tree.get(p.replace(/^\.\//, '')); if (!f) return null; const b = a.blob(f.sha256); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return `data:${f.type};base64,${btoa(s)}`; };
    let out = html
      .replace(/<script([^>]*?)\ssrc=["']([^"':]+)["']([^>]*)>\s*<\/script>/gi, (m, pre, src, post) => { const s = fileText(src); return s == null ? m : `<script${pre}${post}>${s.replace(/<\/script/gi, '<\\/script')}</script>`; })
      .replace(/<link([^>]*?)rel=["']stylesheet["']([^>]*?)href=["']([^"':]+)["']([^>]*)>/gi, (m, a1, a2, href) => { const s = fileText(href); return s == null ? m : `<style>${s}</style>`; })
      .replace(/(<img[^>]*?\ssrc=)["']([^"':]+)["']/gi, (m, pre, src) => { const d = dataUrl(src); return d ? `${pre}"${d}"` : m; });
    const boot = `<script>window.__SLOP_VIEW=${JSON.stringify(viewInfo).replace(/</g, '\\u003c')};</script><script>${SHIM}</script>`;
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + boot) : boot + out;
    return out;
  }

  // ---------- mounts and resolve ----------
  mounts() { return this.system.db.kall('SELECT * FROM mounts ORDER BY host, path'); }
  setMount(p, m) {
    const prev = this.system.db.kone('SELECT * FROM mounts WHERE host = ? AND path = ?', [m.host, m.path]);
    this.sysTurn(p, `mount ${m.host}${m.path}`, (t) => {
      this.system.db.krun(`INSERT INTO mounts(host, path, store, store_param, type, on_missing, create_app, mode, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(host, path) DO UPDATE SET store = excluded.store, store_param = excluded.store_param, type = excluded.type, on_missing = excluded.on_missing, create_app = excluded.create_app, mode = excluded.mode, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
        [m.host, m.path, m.store || null, m.store_param || null, m.type || null, m.on_missing || 'none', m.create_app || null, m.mode || 'live', this.access.who(p).id, this.clock.now]);
      this.system.db.krun('INSERT INTO mount_log(host, path, before, after, by, at) VALUES (?,?,?,?,?,?)', [m.host, m.path, prev ? JSON.stringify(prev) : null, JSON.stringify(m), this.access.who(p).id, this.clock.now]);
      t.change({ kind: 'table', key: 'mounts', op: prev ? 'update' : 'insert', new: `${m.host}${m.path}` });
    });
    this.emit('mounts');
  }
  undoMount(p, host, path) {
    const last = this.system.db.kone('SELECT * FROM mount_log WHERE host = ? AND path = ? ORDER BY id DESC LIMIT 1', [host, path]);
    if (!last) throw err('not_found', 'nothing to undo');
    this.sysTurn(p, `undo mount ${host}${path}`, (t) => {
      if (last.before) { const b = JSON.parse(last.before); this.system.db.krun('UPDATE mounts SET store = ?, store_param = ?, type = ?, on_missing = ?, create_app = ?, mode = ? WHERE host = ? AND path = ?', [b.store, b.store_param, b.type, b.on_missing, b.create_app, b.mode, host, path]); }
      else this.system.db.krun('DELETE FROM mounts WHERE host = ? AND path = ?', [host, path]);
      this.system.db.krun('DELETE FROM mount_log WHERE id = ?', [last.id]);
      t.change({ kind: 'table', key: 'mounts', op: 'undo', new: `${host}${path}` });
    });
    this.emit('mounts');
  }
  matchMount(host, path) {
    const ps = path.split('/').filter(Boolean);
    let best = null;
    for (const m of this.system.db.kall('SELECT * FROM mounts WHERE host = ?', [host])) {
      const ms = m.path.split('/').filter(Boolean);
      if (ms.length > ps.length) continue;
      const params = {}; let score = 0, ok = true;
      for (let i = 0; i < ms.length; i++) {
        if (ms[i] === '*') { score += 0; continue; }
        if (ms[i].startsWith(':')) { params[ms[i].slice(1)] = ps[i]; score += 1; continue; }
        if (ms[i] !== ps[i]) { ok = false; break; }
        score += 2;
      }
      if (ok && (!best || score > best.score)) best = { m, params, score, rest: '/' + ps.slice(ms.length).join('/') };
    }
    return best;
  }
  // resolve(): section 10.3, with a trace for the Site view.
  async resolve(host, path, pid, method = 'GET') {
    const p = this.access.principal(pid);
    const trace = [];
    const hit = this.matchMount(host, path);
    if (!hit) { trace.push(`no mount on ${host} matches ${path}`); return { kind: '404', trace }; }
    const { m, params, rest } = hit;
    trace.push(`mount ${m.host}${m.path} (${m.mode})`);
    let storeId = m.store || params[m.store_param];
    if (storeId && !this.stores.has(storeId)) { trace.push(`no store "${storeId}"`); storeId = null; }
    if (storeId && m.type && this.store(storeId).meta('type') !== m.type) { trace.push(`store ${storeId} is not of type ${m.type}`); storeId = null; }
    if (!storeId) {
      if (m.on_missing === 'create' && m.create_app) {
        const inst = this.system.db.kall('SELECT * FROM instantiate WHERE app = ?', [m.create_app]);
        const who = this.access.who(p);
        const ok = who.role === 'admin' || inst.some(g => g.subject === who.id || g.subject === '*anyone' || (g.subject === '*signed-in' && (who.role === 'member' || who.role === 'admin')));
        trace.push(ok ? `on_missing create: ${who.id} may instantiate ${m.create_app}` : `on_missing create: ${who.id} has no instantiate grant on ${m.create_app}`);
        return { kind: ok ? 'create' : '404', trace, app: m.create_app, type: m.type, suggested: params[m.store_param] };
      }
      return { kind: '404', trace };
    }
    trace.push(`store ${storeId}${m.store_param ? ` (from :${m.store_param})` : ''}`);
    const st = this.store(storeId);
    let app = st.meta('app'), v = Number(st.meta('app_version') || 0);
    if (!app) { trace.push(`${storeId} runs no app`); return { kind: '404', trace }; }
    if (v !== this.appMain(app)) { try { this.ensureActivated(storeId); } catch (e) { trace.push(`activation failed: ${e.message}`); return { kind: '404', trace }; } const nv = Number(st.meta('app_version') || 0); trace.push(nv === this.appMain(app) ? `activated ${app}@${nv}` : `main is ${app}@${this.appMain(app)}, but its activation failed: still on ${nv}`); v = nv; }
    trace.push(`code: ${app}@${v}`);
    const a = this.store(app);
    if (this.hasActor(storeId)) {
      const actor = this.actor(storeId);
      try { actor.ensure(); } catch (e) { trace.push(`actor: ${e.message}`); }
      const route = actor.desc && matchRoute(actor.desc.http, method, rest);
      if (route) {
        trace.push(`1. http route "${route.key}" in actor.js`);
        if (route.level !== 'public') { const c = this.access.can(p, storeId, 'call'); if (!c.ok || lv(c.level) < lv(route.level)) { trace.push(`✗ ${p.id} needs ${route.level}`); return { kind: 'denied', trace }; } }
        const pp = route.level === 'public' && p.kind === 'anon' ? p : p;
        try {
          const res = await actor.enqueue({ kind: 'http', name: route.key, arg: { method, path: rest, params: route.params, query: {}, headers: {}, body: null }, principal: pp });
          return { kind: 'http', trace, response: res || { status: 204 } };
        } catch (e) { return { kind: 'http', trace, response: { status: 500, json: { error: { code: e.code, message: e.message } } } }; }
      }
    }
    const fileHit = a.treeAt(v).find(f => '/' + f.path === rest && rest !== '/');
    if (fileHit) {
      trace.push(`2. file ${fileHit.path} in ${app}@${v}`);
      const b = a.blob(fileHit.sha256);
      return { kind: 'file', trace, type: fileHit.type, text: isText(fileHit.type) ? dec(b) : null, size: b.length };
    }
    const { level } = this.access.level(p, storeId);
    if (m.mode === 'live' || !/\.\w+$/.test(rest)) {
      if (level === 'none') { trace.push(`3. live view: ✗ ${p.id} has no level on ${storeId}`); return { kind: 'denied', trace }; }
      trace.push(`3. live view of ${storeId} as ${p.id} (${level})`);
      return { kind: 'live', trace, store: storeId };
    }
    trace.push('5. nothing matched'); return { kind: '404', trace };
  }

  // ---------- steps ----------
  startStep(p, message, via = 'cli') {
    if (this.activeStep[p.id]) throw err('conflict', `${p.id} already has step ${this.activeStep[p.id]} open${via === 'cli' && p.kind === 'token' ? '. The agent panel opens a step for every request; do not begin another' : '; end it first with step end'}`);
    const id = rid('stp_', 6);
    this.system.db.krun('INSERT INTO steps(id, principal, via, message, started_at) VALUES (?,?,?,?,?)', [id, p.id, via, message || '', this.clock.now]);
    this.activeStep[p.id] = id; this.emit('steps'); return { step: id };
  }
  endStep(p) { const id = this.activeStep[p.id]; if (!id) return null; delete this.activeStep[p.id]; this.system.db.krun("UPDATE steps SET ended_at = ?, state = CASE state WHEN 'open' THEN 'done' ELSE state END WHERE id = ?", [this.clock.now, id]); this.emit('steps'); return { step: id }; }
  steps() {
    return this.system.db.kall('SELECT * FROM steps ORDER BY started_at DESC LIMIT 100').map(s => ({ ...s, commits: this.system.db.kall('SELECT store, rev FROM step_commits WHERE step = ? ORDER BY store, rev', [s.id]) }));
  }
  revertStep(p, id) {
    const s = this.system.db.kone('SELECT * FROM steps WHERE id = ?', [id]); if (!s) throw err('not_found', `no step ${id}`);
    const commits = this.system.db.kall('SELECT store, rev FROM step_commits WHERE step = ? ORDER BY rev DESC', [id]);
    const report = [], refStores = new Set();
    const byStore = {}; for (const c of commits) (byStore[c.store] ||= []).push(c.rev);
    for (const [storeId, revs] of Object.entries(byStore)) {
      if (!this.stores.has(storeId)) { report.push(`${storeId}: gone`); continue; }
      const st = this.store(storeId);
      const changes = st.db.kall(`SELECT rev, seq, kind, key, op, old, new FROM _changes WHERE rev IN (${revs.map(() => '?').join(',')}) ORDER BY rev DESC, seq DESC`, revs);
      if (!changes.length) { report.push(`${storeId}: changes past retention`); continue; }
      this.turn({ store: storeId, principal: p, via: 'kernel', kind: 'revert', label: `revert ${id}` }, (t) => {
        for (const c of changes) {
          if (c.kind === 'doc') {
            if (c.old == null) st.deleteDoc(t, c.key); else st.setDoc(t, c.key, JSON.parse(c.old));
            report.push(`${storeId}: ${c.key} restored`);
          } else if (c.kind === 'file') {
            const path = c.key.replace(/^assets:/, ''), zone = c.key.startsWith('assets:') ? 'assets' : 'tree';
            if (c.old) st.writeFile(t, path, st.blob(c.old), { zone }); else st.removeFile(t, path, zone);
            report.push(`${storeId}: file ${path} restored`);
          } else if (c.kind === 'ref') { if (c.old) { st.moveRef(t, c.key, Number(c.old)); refStores.add(storeId); report.push(`${storeId}: ref ${c.key} → ${c.old}`); } }
          else if (c.kind === 'table' || c.kind === 'row') report.push(`${storeId}: ${c.key} not revertible in v3.0`);
        }
      });
    }
    this.system.db.krun("UPDATE steps SET state = 'reverted' WHERE id = ?", [id]);
    this.manifests.clear();
    for (const storeId of refStores) {
      if (!this.stores.has(storeId) || this.store(storeId).readText('app.json') == null) continue;
      for (const a of this.activateAll(storeId)) report.push(a.ok ? `${a.store}: now runs ${storeId}@${a.version}` : `${a.store}: activation failed, still on ${storeId}@${a.running}`);
    }
    this.emit('steps'); this.emit('stores');
    return { step: id, report: [...new Set(report)] };
  }

  // ---------- persistence ----------
  exportImages({ all = false } = {}) {
    const ids = all ? [...this.stores.keys()] : [...this.dirty];
    const out = { stores: {}, deleted: [] };
    for (const id of ids) { if (this.stores.has(id)) out.stores[id] = this.store(id).db.export(); else out.deleted.push(id); }
    if (!out.stores.system) out.stores.system = this.system.db.export();
    this.dirty.clear();
    return out;
  }
}

function matchRoute(routes, method, path) {
  for (const r of routes || []) {
    const [m, pat] = r.route.includes(' ') ? r.route.split(/\s+/, 2) : ['GET', r.route];
    if (m !== method && m !== '*') continue;
    const a = pat.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
    if (a.length !== b.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i]; else if (a[i] !== b[i]) { ok = false; break; } }
    if (ok) return { key: r.route, level: r.level || 'view', params };
  }
  return null;
}
export { matchSelector, STORE_SCHEMA, ALWAYS_ON, guessType, docPath, clean, sha256, enc };
