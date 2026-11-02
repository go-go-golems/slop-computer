// Actors: one QuickJS runtime per active store, one event at a time, each event a turn (section 6).
import { getQuickJS } from '@tootallnate/quickjs-emscripten';
import { PRELUDE } from './prelude.js';
import { err, rid, parseEvery, globMatch } from './util.js';

let QJS = null;
export async function initQuickJS() { QJS = await getQuickJS(); }

const BUDGET_MS = 250;

export class Actor {
  constructor(kernel, storeId) {
    this.k = kernel; this.storeId = storeId;
    this.state = 'cold'; this.inbox = []; this.busy = false;
    this.rt = null; this.vm = null; this.desc = null; this.version = null; this.appId = null;
    this.deferreds = new Map(); this.waiting = new Map(); this.settled = new Map();
    this.t = null; this.deadline = 0; this.lastActive = 0; this.turns = 0; this.cpuMs = 0; this.crashes = []; this.errors = [];
    this.reactorErrors = {}; this.rq = new Set();
  }
  get store() { return this.k.store(this.storeId); }

  // ---------- lifecycle ----------
  teardown(reason) {
    for (const d of this.deferreds.values()) { try { d.deferred.dispose(); } catch { /* gone */ } }
    this.deferreds.clear();
    for (const [, w] of this.waiting) w.reject(err('actor_error', `lost: ${reason}`));
    this.waiting.clear(); this.settled.clear();
    try { this.vm && this.vm.dispose(); } catch { /* leaked handles */ }
    try { this.rt && this.rt.dispose(); } catch { /* leaked handles */ }
    this.vm = null; this.rt = null; this.desc = null;
  }
  // Build a runtime for app@version. Throws on errors in actor.js top level.
  boot(appId, version) {
    const app = this.k.store(appId);
    const src = app.readText('actor.js', { at: version });
    if (src == null) throw err('not_found', `${appId}@${version} has no actor.js`);
    const rt = QJS.newRuntime();
    rt.setMemoryLimit(64 * 1024 * 1024); rt.setMaxStackSize(1024 * 1024);
    rt.setInterruptHandler(() => this.deadline > 0 && performance.now() > this.deadline);
    const vm = rt.newContext();
    this.rt = rt; this.vm = vm; this.appId = appId; this.version = version; this.reactorErrors = {};
    const fn = (name, f) => { const h = vm.newFunction(name, f); vm.setProp(vm.global, name, h); h.dispose(); };
    const manifest = this.k.manifestOf(appId, version);
    const caps = this.k.actorCaps(manifest, appId, version);
    fn('__host_caps', () => vm.newString(JSON.stringify(caps)));
    fn('__now', () => vm.newNumber(this.t ? this.t.now : this.k.clock.now));
    fn('__log', (lvl, msg) => { const m = vm.getString(msg); if (this.t) this.t.logs.push({ level: vm.getString(lvl), msg: m }); });
    fn('__host', (op, argsH) => {
      let out;
      try { out = { v: this.hostCall(vm.getString(op), JSON.parse(vm.getString(argsH))) }; } catch (e) { out = { e: { code: e.code || 'actor_error', message: String(e.message || e) } }; if (this.t) this.t.logs.push({ level: 'error', msg: `${vm.getString(op)}: ${e.code || 'error'}: ${e.message}` }); }
      return vm.newString(JSON.stringify(out === undefined ? { v: null } : out, (k, v) => (v === undefined ? null : v)));
    });
    fn('__async', (op, argsH) => {
      const deferred = vm.newPromise();
      const id = rid('d', 6);
      const origin = this.t ? this.t.origin : null;
      this.deferreds.set(id, { deferred, origin });
      const opName = vm.getString(op), args = JSON.parse(vm.getString(argsH));
      if (this.t) this.t.awaits.push(opName);
      this.k.hostAsync(this, opName, args, origin).then(
        (v) => this.enqueue({ kind: 'continuation', id, ok: true, value: v, origin }),
        (e) => this.enqueue({ kind: 'continuation', id, ok: false, value: { code: e.code || 'actor_error', message: String(e.message || e) }, origin }));
      return deferred.handle;
    });
    fn('__settle', (idH, jsonH) => { this.settled.set(vm.getNumber(idH), JSON.parse(vm.getString(jsonH))); });
    this.evalOrThrow(PRELUDE, 'prelude.js');
    this.deadline = performance.now() + 1000;
    try { this.evalOrThrow(src, 'actor.js'); } finally { this.deadline = 0; }
    this.desc = JSON.parse(this.callGlobal('__describe', []));
    this.state = 'active';
  }
  evalOrThrow(code, file) {
    const r = this.vm.evalCode(code, file);
    if (r.error) { const e = this.vm.dump(r.error); r.error.dispose(); throw err('actor_error', `${file}: ${e && e.message || JSON.stringify(e)}`); }
    r.value.dispose();
  }
  callGlobal(name, args) {
    const vm = this.vm;
    const f = vm.getProp(vm.global, name);
    const hs = args.map(a => vm.newString(String(a)));
    const r = vm.callFunction(f, vm.undefined, ...hs);
    f.dispose(); hs.forEach(h => h.dispose());
    if (r.error) {
      const e = vm.dump(r.error); r.error.dispose();
      const interrupted = e && (e.message === 'interrupted' || /interrupted/.test(e.message || ''));
      throw err(interrupted ? 'actor_error' : (e && e.code) || 'actor_error', interrupted ? `interrupted: turn passed its ${BUDGET_MS} ms budget` : String(e && e.message || JSON.stringify(e)));
    }
    const s = vm.getString(r.value); r.value.dispose();
    return s;
  }
  drain() {
    for (let i = 0; i < 1000 && this.rt.hasPendingJob(); i++) {
      const r = this.rt.executePendingJobs(64);
      if (r.error) { const e = this.vm.dump(r.error); r.error.dispose(); throw err('actor_error', String(e && e.message || e)); }
    }
  }

  // ---------- inbox ----------
  enqueue(ev) {
    return new Promise((resolve, reject) => {
      ev.resolve = resolve; ev.reject = reject; ev.at = performance.now();
      this.inbox.push(ev); this.k.emit('actors');
      this.pump();
    });
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.inbox.length) {
        const ev = this.inbox.shift();
        // handle() returns a value, or a promise for an event whose turn ended at an await;
        // the pump never waits on that promise, so the continuation can run as a later event.
        try { ev.resolve(this.handle(ev)); } catch (e) { ev.reject(e); }
        this.lastActive = performance.now();
        await null;
      }
    } finally { this.busy = false; this.k.emit('actors'); }
  }

  ensure() {
    const st = this.store;
    const appId = st.meta('app');
    if (!appId) throw err('not_found', `${this.storeId} runs no app`);
    const main = this.k.appMain(appId);
    if (!main) throw err('not_found', `app ${appId} has no published version`);
    const running = Number(st.meta('app_version') || 0);
    if (running !== main) this.k.ensureActivated(this.storeId);
    const v = Number(st.meta('app_version') || 0);
    if (!v) throw err('unavailable', `${this.storeId} has no activated version`);
    if (this.state === 'broken' && this.version === v) throw err('unavailable', `${this.storeId}'s actor is broken: ${this.errors[0] || ''}`);
    if (!this.vm || this.version !== v || this.appId !== appId) {
      if (!this.k.store(appId).readText('actor.js', { at: v })) throw err('not_found', `${appId}@${v} has no actor.js`);
      this.teardown('new version'); this.boot(appId, v); this.syncAlarms(); this.catchUp();
    }
  }

  // ---------- events ----------
  handle(ev) {
    if (ev.kind === 'continuation') return this.continuation(ev);
    this.ensure();
    const p = ev.principal || this.k.access.principal('system');
    const label = ev.kind === 'action' ? `action ${ev.name}` : ev.kind === 'http' ? `http ${ev.name}` : ev.kind === 'on' ? `reactor ${ev.name}` : ev.kind === 'every' ? `alarm ${ev.name}` : `${ev.kind} ${ev.name || ''}`;
    const origin = { id: rid('o', 6), label, principal: p, kind: ev.kind, name: ev.name };
    let pendingId = null, result;
    const via = ev.kind === 'on' ? `reactor:${ev.name}` : 'actor';
    this.k.turn({ store: this.storeId, principal: p, via, kind: ev.kind, label, app: `${this.appId}@${this.version}`, origin, step: ev.step }, (t) => {
      this.t = t; t.origin = origin; t.event = { kind: ev.kind, name: ev.name, arg: ev.arg };
      if (this.k.faults.crashNext === this.storeId && ev.kind !== 'on') { this.k.faults.crashNext = null; t.logs.push({ level: 'error', msg: 'fault: actor crashed mid-turn' }); this.crash('fault injected: crash mid-turn'); throw err('actor_error', 'lost: the actor crashed mid-turn (fault)'); }
      if (ev.kind === 'every') this.store.db.krun('UPDATE _alarms SET running = 1 WHERE name = ?', [ev.name]);
      const ctx = this.ctxFor(p, ev, t);
      const out = this.run(() => JSON.parse(this.callGlobal('__dispatch', [ev.kind, ev.name, JSON.stringify(ctx), JSON.stringify(ev.arg === undefined ? null : ev.arg)])));
      if (out.pending) {
        this.run(() => this.drain());
        if (this.settled.has(out.pending)) { result = this.takeSettled(out.pending); }
        else {
          if (ev.kind === 'on') throw err('actor_error', 'async_reactor: reactors must be synchronous; write a task row and set an alarm instead');
          pendingId = out.pending;
        }
      } else { this.run(() => this.drain()); result = { v: out.v }; }
      if (ev.kind === 'on') this.moveCursor(ev.name, ev.source, ev.rev);
      if (ev.kind === 'every' && !pendingId) this.finishAlarm(ev.name);
      t.result = result;
    }, () => { this.t = null; });
    if (pendingId) {
      return new Promise((resolve, reject) => { this.waiting.set(pendingId, { resolve, reject, origin, ev }); }).then(r => this.unwrap(r));
    }
    return this.unwrap(result);
  }
  unwrap(r) { if (r && r.e) throw err(r.e.code || 'actor_error', r.e.message); return r ? r.v : null; }
  takeSettled(id) { const r = this.settled.get(id); this.settled.delete(id); return r; }
  run(f) {
    this.deadline = performance.now() + BUDGET_MS;
    const t0 = performance.now();
    try { return f(); } catch (e) {
      if (/interrupted/.test(e.message || '')) { this.noteCrash('interrupted'); }
      throw e;
    } finally { this.deadline = 0; const ms = performance.now() - t0; this.cpuMs += ms; if (this.t) this.t.cpuMs = (this.t.cpuMs || 0) + ms; this.turns++; }
  }
  continuation(ev) {
    const d = this.deferreds.get(ev.id);
    if (!d || !this.vm) return null; // the runtime that waited is gone (crash)
    const origin = d.origin || { label: 'continuation', principal: this.k.access.principal('system') };
    this.k.turn({ store: this.storeId, principal: origin.principal, via: origin.kind === 'on' ? `reactor:${origin.name}` : 'actor', kind: 'continuation', label: `${origin.label}, continued`, app: `${this.appId}@${this.version}`, origin }, (t) => {
      this.t = t; t.origin = origin;
      if (this.k.faults.crashNext === this.storeId) { this.k.faults.crashNext = null; this.crash('fault injected: crash in a continuation'); throw err('actor_error', 'lost: the actor crashed mid-turn (fault)'); }
      const vm = this.vm;
      const val = vm.newString(JSON.stringify(ev.ok ? { v: ev.value } : { e: ev.value }));
      d.deferred.resolve(val); val.dispose(); d.deferred.dispose(); this.deferreds.delete(ev.id);
      this.run(() => this.drain());
      for (const [pid, w] of this.waiting) {
        if (this.settled.has(pid)) {
          const r = this.takeSettled(pid); this.waiting.delete(pid);
          if (w.ev.kind === 'every') this.finishAlarm(w.ev.name);
          t.result = r; t.after.push(() => w.resolve(r));
        }
      }
    }, () => { this.t = null; });
    return null;
  }
  ctxFor(p, ev, t) {
    const lvl = p.kind === 'system' ? 'owner' : this.k.access.level(p, this.storeId).level;
    const who = this.k.access.who(p);
    return { principal: { id: who.id, kind: p.kind, name: who.name, level: lvl, via: p.id !== who.id ? p.id : undefined }, store: { id: this.storeId, type: this.store.meta('type') || '' }, app: { id: this.appId, version: this.version }, now: t.now, rev: this.store.rev, event: { kind: ev.kind, name: ev.name, late: !!ev.late } };
  }
  crash(reason) { this.noteCrash(reason); this.teardown(reason); this.state = 'cold'; }
  noteCrash(reason) {
    const now = performance.now();
    this.crashes = this.crashes.filter(x => now - x < 60000); this.crashes.push(now);
    this.errors.unshift(reason); this.errors = this.errors.slice(0, 5);
    if (this.crashes.length >= 3) { this.state = 'broken'; }
  }

  // ---------- host calls (synchronous, inside the turn) ----------
  hostCall(op, a) {
    const t = this.t; if (!t) throw err('actor_error', `${op} called outside a turn`);
    const st = this.store, k = this.k;
    switch (op) {
      case 'rid': return rid('', 10);
      case 'readFile': return k.store(this.appId).readText(a[0], { at: this.version });
      case 'sql.all': return st.db.q('actor', a[0], a[1], { turn: t, budgetMs: Math.max(5, this.deadline - performance.now()) });
      case 'sql.one': return st.db.q('actor', a[0], a[1], { mode: 'one', turn: t, budgetMs: Math.max(5, this.deadline - performance.now()) });
      case 'sql.run': return st.db.q('actor', a[0], a[1], { mode: 'run', turn: t, budgetMs: Math.max(5, this.deadline - performance.now()) });
      case 'sp': { const nm = 'u' + t.id; st.db.kexec(a[0] === 'begin' ? `SAVEPOINT ${nm}` : a[0] === 'commit' ? `RELEASE ${nm}` : `ROLLBACK TO ${nm}; RELEASE ${nm}`); return null; }
      case 'db.get': return st.getDoc(a[0]);
      case 'db.query': return st.queryDocs(a[0], a[1] || {}).rows;
      case 'db.set': return st.setDoc(t, a[0], a[1], { merge: !!a[2] });
      case 'db.delete': return st.deleteDoc(t, a[0]);
      case 'alarm.at': st.db.krun('INSERT INTO _alarms(name, at, every, data) VALUES (?,?,NULL,?) ON CONFLICT(name) DO UPDATE SET at = excluded.at, every = NULL, data = excluded.data', [a[1], Number(a[0]), JSON.stringify(a[2] ?? null)]); k.scheduleChanged(); return null;
      case 'alarm.every': { const ms = parseEvery(a[1]); st.db.krun('INSERT INTO _alarms(name, at, every, data) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET every = excluded.every, data = excluded.data', [a[0], t.now + ms, String(a[1]), JSON.stringify(a[2] ?? null)]); k.scheduleChanged(); return null; }
      case 'alarm.cancel': st.db.krun('DELETE FROM _alarms WHERE name = ?', [a[0]]); return null;
      case 'alarm.list': return st.db.kall('SELECT name, at, every, running FROM _alarms ORDER BY at');
      case 'room.emit': t.released.push({ kind: 'room', store: this.storeId, topic: a[0], data: a[1] }); return null;
      case 'room.peers': return k.peers(this.storeId);
      case 'log.since': return st.commits({ since: Number(a[0]) || 0, limit: 200 });
      case 'stores.get': {
        const p = k.access.principal(`app:${this.appId}`);
        if (!k.stores.has(a[0])) throw err('not_found', `no store "${a[0]}"`);
        const target = k.store(a[0]);
        const c = k.access.can(p, a[0], 'doc.read', a[1], { manifest: k.manifestOf(target.meta('app'), Number(target.meta('app_version') || 0)) });
        if (!c.ok) {
          if (c.code === 'not_found') return null;
          throw err(c.code, `${p.id} (this actor) may not read ${a[1]} in ${a[0]}: ${c.trace.filter(x => !x.startsWith('· ')).join('; ')}. Give it a level there: grant ${a[0]} ${p.id} view`, { trace: c.trace });
        }
        return target.getDoc(a[1]);
      }
      default: throw err('invalid_argument', `unknown host call ${op}`);
    }
  }

  // ---------- alarms, reactors ----------
  syncAlarms() {
    const st = this.store; const now = this.k.clock.now;
    for (const e of this.desc.every) {
      const spec = e.every || e.cron || '1h';
      let ms; try { ms = parseEvery(spec); } catch { ms = 36e5; }
      st.db.krun('INSERT INTO _alarms(name, at, every, data) VALUES (?,?,?,NULL) ON CONFLICT(name) DO UPDATE SET every = excluded.every', [e.name, now + ms, String(spec)]);
    }
    this.k.scheduleChanged();
  }
  finishAlarm(name) {
    const st = this.store;
    const a = st.db.kone('SELECT every, at FROM _alarms WHERE name = ?', [name]);
    if (!a) return;
    if (a.every) { const ms = parseEvery(a.every); let next = a.at + ms; while (next <= this.k.clock.now) next += ms; st.db.krun('UPDATE _alarms SET running = 0, at = ? WHERE name = ?', [next, name]); }
    else st.db.krun('DELETE FROM _alarms WHERE name = ?', [name]);
  }
  selectors() {
    return (this.desc ? this.desc.on : []).map(key => {
      const m = /^store:([a-z0-9-]+)\s+(.*)$/.exec(key);
      return { key, source: m ? m[1] : this.storeId, sel: m ? m[2] : key };
    });
  }
  cursor(name, source) { const r = this.store.db.kone('SELECT rev FROM _cursors WHERE name = ? AND source = ?', [name, source]); return r ? r.rev : null; }
  moveCursor(name, source, rev) {
    if (!source) return;
    this.store.db.krun('INSERT INTO _cursors(name, source, epoch, rev) VALUES (?,?,?,?) ON CONFLICT(name, source) DO UPDATE SET rev = excluded.rev, epoch = excluded.epoch', [name, source, this.k.store(source).epoch, rev]);
  }
  // After a wake or a commit: deliver every unseen matching commit to each reactor, in order.
  catchUp(onlySource) {
    for (const s of this.selectors()) {
      if (onlySource && s.source !== onlySource) continue;
      if (this.reactorErrors[s.key] || this.rq.has(s.key)) continue;
      let src; try { src = this.k.store(s.source); } catch { this.reactorErrors[s.key] = `no store "${s.source}"`; continue; }
      if (s.source !== this.storeId) {
        const c = this.k.access.can(this.k.access.principal(`app:${this.appId}`), s.source, 'files.read');
        if (!c.ok) { this.reactorErrors[s.key] = `app:${this.appId} may not follow ${s.source}'s log (it needs view there): grant ${s.source} app:${this.appId} view`; this.k.emit('actors'); continue; }
      }
      let cur = this.cursor(s.key, s.source);
      if (cur === null) { cur = src.rev; this.k.turn({ store: this.storeId, principal: this.k.access.principal('system'), via: 'kernel', kind: 'bookkeeping', label: `cursor ${s.key} starts at ${cur}`, quiet: true }, () => this.moveCursor(s.key, s.source, cur)); continue; }
      const commits = src.commits({ since: cur, limit: 500 }).reverse();
      for (const c of commits) {
        const own = s.source === this.storeId && c.via === `reactor:${s.key}`;
        const changes = own ? [] : c.changes.filter(ch => matchSelector(s.sel, ch));
        if (!changes.length) { this.k.turn({ store: this.storeId, principal: this.k.access.principal('system'), via: 'kernel', kind: 'bookkeeping', label: `cursor ${s.key} → ${c.rev}`, quiet: true }, () => this.moveCursor(s.key, s.source, c.rev)); continue; }
        if (this.rq.has(s.key)) break;
        this.rq.add(s.key);
        this.enqueue({ kind: 'on', name: s.key, source: s.source, rev: c.rev, arg: { ...c, changes }, principal: this.k.access.principal(`app:${this.appId}`) })
          .then(() => { this.rq.delete(s.key); this.catchUp(s.source); },
            e => { this.rq.delete(s.key); this.reactorErrors[s.key] = `rev ${c.rev}: ${e.message}`; this.k.emit('actors'); });
        break; // one at a time per reactor; the next commit goes after this turn moves the cursor
      }
    }
  }
}

export function matchSelector(sel, ch) {
  if (sel === '*') return true;
  const i = sel.indexOf(':'); const kind = sel.slice(0, i), pat = sel.slice(i + 1);
  if (kind === 'table') return (ch.kind === 'table' && ch.key === pat) || (ch.kind === 'row' && ch.key.split(':')[0] === pat);
  if (kind === 'doc') return ch.kind === 'doc' && globMatch(pat, ch.key);
  if (kind === 'file') return ch.kind === 'file' && globMatch(pat, ch.key);
  if (kind === 'ref') return ch.kind === 'ref' && (pat === '*' || ch.key === pat);
  if (sel === 'snapshot') return ch.kind === 'snapshot';
  if (sel === 'schema') return ch.kind === 'schema';
  return false;
}
