// The verb table: one set of operations shared by every door (console, agent, lab UI).
// Each verb runs as a principal and checks can() itself; the CLI is a thin parser over it.
import { err, lv, dec, isText, parseEvery } from './util.js';

const W = true; // marks verbs that change something (read-only agents may not run them)

function need(k, p, store, op, target, opts) {
  const c = k.access.can(p, store, op, target, opts);
  if (!c.ok) {
    k.recordDenied(store, p, `${op} ${target || ''}`.trim(), err(c.code, 'denied'), c.trace);
    throw err(c.code, c.code === 'not_found' ? `${target || store}: not found` : `${p.id} may not ${op} on ${store}`, { trace: c.trace });
  }
  return c;
}
const platformAdmin = (k, p) => { const who = k.access.who(p); if (p.kind !== 'system' && who.role !== 'admin') throw err('permission_denied', `${p.id} is not a platform admin`); };
const storeOpts = (k, id) => { const { manifest, version } = k.storeManifest(id); return { manifest, version }; };

function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 4e6) return ['(files too large to diff here)'];
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; continue; }
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { out.push(`+${j + 1}: ${B[j]}`); j++; } else { out.push(`-${i + 1}: ${A[i]}`); i++; }
  }
  return out;
}

export const VERBS = {
  help: { usage: 'help [verb]', about: 'list verbs, or show one', run: (k, p, a) => a[0] ? { usage: VERBS[a[0]] ? VERBS[a[0]].usage : 'no such verb', about: VERBS[a[0]] && VERBS[a[0]].about } : Object.entries(VERBS).map(([n, v]) => ({ verb: n, usage: v.usage, about: v.about, writes: !!v.write })) },
  whoami: { usage: 'whoami', about: 'the principal this door acts as', run: (k, p) => { const who = k.access.who(p); return { principal: p.id, kind: p.kind, actsFor: who.id !== p.id ? who.id : undefined, name: who.name, role: who.role, step: k.activeStep[p.id] || null }; } },
  principals: { usage: 'principals', about: 'everyone the platform knows', run: (k) => [...k.access.principals(), { id: 'anon', kind: 'anon', name: 'Anonymous', role: 'none' }].map(x => ({ id: x.id, kind: x.kind, name: x.name, role: x.role, for: x.user_id || '', max: x.max_level || '' })) },

  // ----- stores -----
  stores: { usage: 'stores', about: 'every store with its app, owner, head and your level', run: (k, p) => k.storeRows().map(s => { let level = 'none'; try { level = k.access.level(p, s.id).level; } catch { /* gone */ } const st = k.stores.get(s.id); return { id: s.id, type: s.type, app: s.app || '', running: st ? (st.meta('app_version') ? `${s.app}@${st.meta('app_version')}` : '') : '', owner: s.owner, rev: st ? st.rev : null, level }; }).filter(s => s.level !== 'none' || p.kind === 'system') },
  new: { write: W, usage: 'new <id> [--app APP] [--type TYPE] [--from STORE]', about: 'create a store (empty, running an app, or forked)', run: (k, p, a, f) => {
    const who = k.access.who(p);
    if (p.kind !== 'system' && !['admin', 'member'].includes(who.role)) throw err('permission_denied', `${who.id} may not create stores`);
    if (f.from) need(k, p, f.from, 'files.read');
    if (f.app && !k.stores.has(f.app)) throw err('not_found', `no app store "${f.app}"`);
    const r = k.createStore(p, { id: a[0], app: f.app || null, type: f.type || (f.app ? k.store(f.app).meta('type_name') || f.app : ''), from: f.from || null });
    if (f.app && k.appMain(f.app)) { try { k.activate(r.id); } catch (e) { r.activation = e.message; } }
    return r;
  } },
  rmstore: { write: W, usage: 'rmstore <id>', about: 'delete a store and its grants and mounts', run: (k, p, a) => { const s = k.system.db.kone('SELECT owner FROM stores WHERE id = ?', [a[0]]); if (!s) throw err('not_found', `no store ${a[0]}`); const who = k.access.who(p); if (p.kind !== 'system' && s.owner !== who.id && who.role !== 'admin') throw err('permission_denied', 'only the owner or a platform admin deletes a store'); k.deleteStore(p, a[0]); return { deleted: a[0] }; } },

  // ----- files, snapshots, refs -----
  ls: { usage: 'ls <store> [--at N|REF] [--assets]', about: 'files in the working tree, a snapshot, or assets', run: (k, p, a, f) => { need(k, p, a[0], 'files.read'); const st = k.store(a[0]); return f.at ? st.treeAt(f.at) : st.listFiles(f.assets ? 'assets' : 'tree').map(x => ({ path: x.path, size: x.size, type: x.type, rev: x.rev })); } },
  cat: { usage: 'cat <store> <path> [--at N|REF]', about: 'print a file', run: (k, p, a, f) => { need(k, p, a[0], 'files.read'); const fl = k.store(a[0]).readFile(a[1], { at: f.at }); if (!fl) throw err('not_found', `no file ${a[1]}`); return isText(fl.type) ? dec(fl.bytes) : `(${fl.type}, ${fl.bytes.length} bytes)`; } },
  write: { write: W, usage: 'write <store> <path>   (content on stdin)', about: 'write a file in the working tree', run: (k, p, a, f, input) => { need(k, p, a[0], 'files.write'); if (input == null) throw err('invalid_argument', 'write takes the content on stdin'); return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'files', label: `write ${a[1]}` }, t => k.store(a[0]).writeFile(t, a[1], input)); } },
  edit: { write: W, usage: 'edit <store> <path> --old TEXT --new TEXT', about: 'replace exactly one occurrence in a file', run: (k, p, a, f) => {
    need(k, p, a[0], 'files.write');
    const st = k.store(a[0]); const cur = st.readText(a[1]);
    if (cur == null) throw err('not_found', `no file ${a[1]}`);
    const n = cur.split(f.old).length - 1;
    if (n !== 1) throw err('invalid_argument', n ? `--old occurs ${n} times in ${a[1]}; make it unique` : `--old does not occur in ${a[1]}`);
    return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'files', label: `edit ${a[1]}` }, t => st.writeFile(t, a[1], cur.replace(f.old, () => f.new)));
  } },
  rm: { write: W, usage: 'rm <store> <path>', about: 'remove a file from the working tree', run: (k, p, a) => { need(k, p, a[0], 'files.write'); return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'files', label: `rm ${a[1]}` }, t => k.store(a[0]).removeFile(t, a[1])); } },
  publish: { write: W, usage: 'publish <store> [message]', about: 'snapshot the tree, move main, activate every store that runs it', run: (k, p, a) => k.publish(p, a[0], a.slice(1).join(' ')) },
  snapshots: { usage: 'snapshots <store>', about: 'numbered snapshots of the tree', run: (k, p, a) => { need(k, p, a[0], 'files.read'); return k.store(a[0]).snapshots().map(s => ({ ...s, tree: s.tree.slice(0, 10) })); } },
  refs: { usage: 'refs <store>', about: 'named pointers to snapshots', run: (k, p, a) => { need(k, p, a[0], 'files.read'); return k.store(a[0]).refs(); } },
  ref: { write: W, usage: 'ref <store> <name> <N>', about: 'move a ref (rollback is `ref app main 3`)', run: (k, p, a) => { need(k, p, a[0], 'refs.write'); k.turn({ store: a[0], principal: p, via: 'cli', kind: 'refs', label: `ref ${a[1]} → ${a[2]}` }, t => k.store(a[0]).moveRef(t, a[1], Number(a[2]))); k.manifests.clear(); const act = a[1] === 'main' ? k.activateAll(a[0]) : []; return { ref: a[1], n: Number(a[2]), activations: act }; } },
  diff: { usage: 'diff <store> [FROM] [TO]', about: 'files changed between snapshots (TO defaults to the working tree)', run: (k, p, a) => {
    need(k, p, a[0], 'files.read');
    const st = k.store(a[0]);
    const from = a[1] ? st.treeAt(a[1]) : (st.refs().find(r => r.name === 'main') ? st.treeAt('main') : []);
    const to = a[2] ? st.treeAt(a[2]) : st.listFiles('tree');
    const A = new Map(from.map(x => [x.path, x])), B = new Map(to.map(x => [x.path, x]));
    const out = [];
    for (const [path, x] of B) {
      const y = A.get(path);
      if (!y) out.push({ path, change: 'added' });
      else if (y.sha256 !== x.sha256) out.push({ path, change: 'changed', lines: isText(x.type) ? lineDiff(dec(st.blob(y.sha256)), dec(st.blob(x.sha256))).slice(0, 80) : undefined });
    }
    for (const path of A.keys()) if (!B.has(path)) out.push({ path, change: 'removed' });
    return out;
  } },

  // ----- documents -----
  colls: { usage: 'colls <store>', about: 'collections and their document counts', run: (k, p, a) => { need(k, p, a[0], 'files.read'); return k.store(a[0]).listColls(); } },
  docs: { usage: 'docs <store> <collection> [--where "f op v"] [--order f] [--limit N]', about: 'query documents (rules apply)', run: (k, p, a, f) => {
    const o = storeOpts(k, a[0]);
    const where = f.where ? [f.where.split(/\s+/)].map(([x, op, ...v]) => [x, op, parseVal(v.join(' '))]) : [];
    const rows = k.store(a[0]).queryDocs(a[1], { where, orderBy: f.order ? [[f.order.replace(/^-/, ''), f.order.startsWith('-') ? 'desc' : 'asc']] : [], limit: Number(f.limit) || 100 }).rows;
    return rows.filter(r => k.access.can(p, a[0], 'doc.read', r.path, o).ok).map(r => ({ path: r.path, version: r.version, rev: r.rev, data: r.data }));
  } },
  get: { usage: 'get <store> <docpath>', about: 'read one document (hidden reads look missing)', run: (k, p, a) => { try { need(k, p, a[0], 'doc.read', a[1], storeOpts(k, a[0])); } catch (e) { if (e.code === 'not_found') return null; throw e; } return k.store(a[0]).getDoc(a[1]); } },
  set: { write: W, usage: 'set <store> <docpath> <json> [--merge]', about: 'write one document (rules apply)', run: (k, p, a, f) => { need(k, p, a[0], 'doc.write', a[1], storeOpts(k, a[0])); const data = JSON.parse(a.slice(2).join(' ')); return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'write', label: `set ${a[1]}` }, t => k.store(a[0]).setDoc(t, a[1], data, { merge: !!f.merge })); } },
  del: { write: W, usage: 'del <store> <docpath>', about: 'delete one document', run: (k, p, a) => { need(k, p, a[0], 'doc.write', a[1], storeOpts(k, a[0])); return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'write', label: `del ${a[1]}` }, t => k.store(a[0]).deleteDoc(t, a[1])); } },

  // ----- SQL -----
  tables: { usage: 'tables <store>', about: 'app tables and views, with columns', run: (k, p, a) => { need(k, p, a[0], 'files.read'); const st = k.store(a[0]); return st.db.appObjects().map(o => ({ name: o.name, type: o.type, columns: st.db.tableInfo(o.name).map(c => c.name).join(', '), rows: o.type === 'table' ? st.db.kval(`SELECT count(*) FROM "${o.name}"`) : '' })); } },
  sql: { usage: 'sql <store> "<SQL>" [--write]', about: 'admin SQL: read-only unless --write; the policy still applies', write: (f) => !!f.write, run: (k, p, a, f) => {
    need(k, p, a[0], 'sql.admin');
    const st = k.store(a[0]); const q = a.slice(1).join(' ');
    if (!f.write) {
      const rec = { statements: [] };
      let rows; try { rows = k.withPrincipalFns(st, p, () => st.db.q('admin', q, null, { turn: rec, budgetMs: 1000 })); } finally { k.recordRead(a[0], p, `sql ${q.slice(0, 60)}`, rec.statements, 'cli'); }
      return rows;
    }
    return k.turn({ store: a[0], principal: p, via: 'cli', kind: 'sql', label: `sql --write ${q.slice(0, 60)}` }, t => st.db.q('admin', q, null, { mode: 'run', write: true, turn: t, budgetMs: 1000 }));
  } },

  // ----- actors -----
  call: { write: W, usage: 'call <store> <action> [json]', about: 'run an action as you', run: (k, p, a) => k.callAction(p, a[0], a[1], a[2] ? JSON.parse(a.slice(2).join(' ')) : {}) },
  actors: { usage: 'actors', about: 'actors, their state and inboxes', run: (k) => [...k.actors.values()].map(x => ({ store: x.storeId, state: x.state, code: x.appId ? `${x.appId}@${x.version}` : '', inbox: x.inbox.length, waiting: x.waiting.size, turns: x.turns, cpuMs: +x.cpuMs.toFixed(1), error: x.errors[0] || '', reactors: Object.entries(x.reactorErrors).map(([kk, v]) => `${kk}: ${v}`).join('; ') })) },
  alarms: { usage: 'alarms <store>', about: 'scheduled alarms', run: (k, p, a) => { need(k, p, a[0], 'files.read'); return k.store(a[0]).db.kall('SELECT name, at, every, running FROM _alarms ORDER BY at').map(x => ({ ...x, in: fmtDur(x.at - k.clock.now) })); } },
  activate: { write: W, usage: 'activate <store>', about: 'run migrations, setup and smoke for main, in one turn', run: (k, p, a) => { need(k, p, a[0], 'platform'); k.failedActivation.delete(a[0]); return k.activate(a[0], p); } },

  // ----- log and turns -----
  log: { usage: 'log <store> [--n N]', about: 'commits, newest first', run: (k, p, a, f) => { need(k, p, a[0], 'files.read'); return k.store(a[0]).commits({ limit: Number(f.n) || 20 }).map(c => ({ rev: c.rev, at: fmtTime(c.at), principal: c.principal, via: c.via, step: c.step || '', summary: c.summary, changes: c.changes.map(x => `${x.kind}:${x.key}`).slice(0, 6).join(' ') })); } },
  turns: { usage: 'turns [--n N] [--store S]', about: 'recent turns', run: (k, p, a, f) => k.turnsLog.filter(t => !f.store || t.store === f.store).slice(-(Number(f.n) || 20)).reverse().map(t => ({ id: t.id, store: t.store, principal: t.principal, via: t.via, label: t.label, status: t.status, rev: t.rev, ms: t.ms, error: t.error ? `${t.error.code}: ${t.error.message}` : '' })) },
  turn: { usage: 'turn <id>', about: 'one turn in full', run: (k, p, a) => { const t = k.turnsLog.find(x => x.id === Number(a[0])); if (!t) throw err('not_found', `no turn ${a[0]} (the ring keeps 400)`); return t; } },

  // ----- access -----
  can: { usage: 'can <principal> <store> <op> [target]', about: 'explain an access decision (ops: doc.read doc.write sql.read sql.admin files.read files.write call platform)', run: (k, p, a) => { const q = k.access.principal(a[0]); return k.access.can(q, a[1], a[2], a[3], storeOpts(k, a[1])); } },
  grants: { usage: 'grants <store>', about: 'who holds which level', run: (k, p, a) => k.system.db.kall('SELECT subject, level, via, created_by FROM grants WHERE store = ? ORDER BY subject', [a[0]]) },
  grant: { write: W, usage: 'grant <store> <subject> <level>', about: 'give a level (subjects: a principal, app:<app> for an app\'s actors, *signed-in, *anyone)', run: (k, p, a) => { need(k, p, a[0], 'platform'); if (!['view', 'interact', 'admin'].includes(a[2])) throw err('invalid_argument', 'levels: view, interact, admin');
    const subj = a[1] || '';
    if (!['*anyone', '*signed-in'].includes(subj)) {
      if (subj.startsWith('app:')) { if (!k.stores.has(subj.slice(4))) throw err('invalid_argument', `no app store "${subj.slice(4)}"`); }
      else { try { k.access.principal(subj); } catch { const hint = k.stores.has(subj) ? ` "${subj}" is a store. A store's actor acts as app:<its app>; to let it read here, grant ${a[0]} app:${k.store(subj).meta('app') || subj} view` : ''; throw err('invalid_argument', `"${subj}" is not a principal.${hint}`); } }
    } k.sysTurn(p, `grant ${a[1]} ${a[2]} on ${a[0]}`, (t) => { k.system.db.krun("INSERT INTO grants(store, subject, level, via, created_by, created_at) VALUES (?,?,?,'direct',?,?) ON CONFLICT(store, subject, via) DO UPDATE SET level = excluded.level", [a[0], a[1], a[2], k.access.who(p).id, k.clock.now]); t.change({ kind: 'table', key: 'grants', op: 'upsert', new: `${a[0]} ${a[1]} ${a[2]}` }); }); k.emit('access'); k.retryReactors(); return { store: a[0], subject: a[1], level: a[2] }; } },
  revoke: { write: W, usage: 'revoke <store> <subject>', about: 'remove a grant', run: (k, p, a) => { need(k, p, a[0], 'platform'); k.sysTurn(p, `revoke ${a[1]} on ${a[0]}`, (t) => { k.system.db.krun('DELETE FROM grants WHERE store = ? AND subject = ?', [a[0], a[1]]); t.change({ kind: 'table', key: 'grants', op: 'delete', old: `${a[0]} ${a[1]}` }); }); k.emit('access'); return { store: a[0], revoked: a[1] }; } },
  approve: { write: W, usage: 'approve <app> <version> <cap,cap>', about: 'approve capabilities like sample for one app version', run: (k, p, a) => { platformAdmin(k, p); k.store(a[0]).resolveVersion(Number(a[1])); const caps = (a[2] || '').split(',').filter(Boolean); k.sysTurn(p, `approve ${a[0]}@${a[1]} ${caps.join(',')}`, (t) => { k.system.db.krun('INSERT INTO approvals(app, version, caps, approved_by, approved_at) VALUES (?,?,?,?,?) ON CONFLICT(app, version) DO UPDATE SET caps = excluded.caps', [a[0], Number(a[1]), JSON.stringify(caps), k.access.who(p).id, k.clock.now]); t.change({ kind: 'table', key: 'approvals', op: 'upsert', new: `${a[0]}@${a[1]}` }); }); for (const st of k.instancesOf(a[0])) { const ac = k.actors.get(st); if (ac) ac.teardown('approvals changed'); } k.emit('access'); return { app: a[0], version: Number(a[1]), caps }; } },
  approvals: { usage: 'approvals', about: 'approved capabilities per app version', run: (k) => k.system.db.kall('SELECT * FROM approvals ORDER BY app, version') },
  instantiate: { write: W, usage: 'instantiate <app> <subject>', about: 'let a subject create stores of an app through a mount', run: (k, p, a) => { platformAdmin(k, p); k.system.db.krun('INSERT OR REPLACE INTO instantiate(app, subject) VALUES (?,?)', [a[0], a[1]]); k.emit('access'); return { app: a[0], subject: a[1] }; } },

  // ----- mounts -----
  mounts: { usage: 'mounts', about: 'host/path → store', run: (k) => k.mounts().map(m => ({ at: m.host + m.path, store: m.store || `:${m.store_param}`, type: m.type || '', on_missing: m.on_missing === 'create' ? `create ${m.create_app}` : '', mode: m.mode })) },
  mount: { write: W, usage: 'mount <host/path> <store|:param> [--type T] [--create APP] [--mode live|static]', about: 'point a URL at a store', run: (k, p, a, f) => { platformAdmin(k, p); const [host, ...rest] = a[0].split('/'); const path = '/' + rest.join('/'); const param = a[1].startsWith(':') ? a[1].slice(1) : null; k.setMount(p, { host, path, store: param ? null : a[1], store_param: param, type: f.type || null, on_missing: f.create ? 'create' : 'none', create_app: f.create || null, mode: f.mode || 'live' }); return { mounted: host + path }; } },
  unmount: { write: W, usage: 'unmount <host/path>', about: 'remove a mount', run: (k, p, a) => { platformAdmin(k, p); const [host, ...rest] = a[0].split('/'); const path = '/' + rest.join('/'); k.sysTurn(p, `unmount ${a[0]}`, (t) => { k.system.db.krun('DELETE FROM mounts WHERE host = ? AND path = ?', [host, path]); t.change({ kind: 'table', key: 'mounts', op: 'delete', old: a[0] }); }); k.emit('mounts'); return { unmounted: a[0] }; } },
  resolve: { usage: 'resolve <host/path> [--method GET]', about: 'what a URL serves, as you, with the trace', run: async (k, p, a, f) => { const [host, ...rest] = a[0].replace(/^https?:\/\//, '').split('/'); const r = await k.resolve(host, '/' + rest.join('/'), p.id, f.method || 'GET'); return r; } },

  // ----- lab controls -----
  clock: { usage: 'clock [+5m | run | pause | speed N]', about: 'the virtual clock', run: async (k, p, a) => {
    if (a[0] && a[0].startsWith('+')) await k.advanceTo(k.clock.now + parseEvery(a[0].slice(1)));
    else if (a[0] === 'run') k.clock.running = true; else if (a[0] === 'pause') k.clock.running = false;
    else if (a[0] === 'speed') k.clock.speed = Number(a[1]) || 1;
    k.emit('clock');
    return { now: fmtTime(k.clock.now), running: k.clock.running, speed: k.clock.speed, next: k.nextEventAt() ? fmtDur(k.nextEventAt() - k.clock.now) : null };
  } },
  fault: { usage: 'fault crash|fail-commit|clear <store>', about: 'inject a failure into the next turn', run: (k, p, a) => { if (a[0] === 'crash') k.faults.crashNext = a[1]; else if (a[0] === 'fail-commit') k.faults.failNextCommit = a[1]; else { k.faults.crashNext = null; k.faults.failNextCommit = null; } k.emit('faults'); return { ...k.faults }; } },
  pagelog: { usage: 'pagelog [store]', about: 'warnings and errors from pages (console.error, uncaught errors)', run: (k, p, a) => k.pageLogs.filter(l => !a[0] || l.store === a[0]).slice(-40).map(l => ({ at: fmtTime(l.at), store: l.store, as: l.principal, level: l.level, msg: l.msg })) },
  steps: { usage: 'steps', about: 'agent and CLI steps with their commits', run: (k) => k.steps().map(s => ({ id: s.id, principal: s.principal, state: s.state, message: s.message, commits: s.commits.map(c => `${c.store}@${c.rev}`).join(' ') })) },
  step: { usage: 'step begin [message] | step end', about: 'group the next commits into a step', run: (k, p, a) => a[0] === 'end' ? k.endStep(p) : k.startStep(p, a.slice(1).join(' '), 'cli') },
  revert: { write: W, usage: 'revert <step>', about: 'undo a step\'s document, file and ref changes', run: (k, p, a) => k.revertStep(p, a[0]) },
};

function parseVal(s) { if (s === 'true') return true; if (s === 'false') return false; if (s === 'null') return null; if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); return s.replace(/^["']|["']$/g, ''); }
export function fmtTime(ms) { const d = new Date(ms); return d.toISOString().replace('T', ' ').slice(0, 19); }
export function fmtDur(ms) { if (ms == null) return ''; const neg = ms < 0; ms = Math.abs(ms); const s = Math.round(ms / 1000); const out = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`; return neg ? `-${out}` : out; }

// ----- the CLI: tokenize, split flags, run, format -----
export function tokenize(line) {
  const out = []; let cur = '', q = null, any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    // A token that starts with { or [ is a JSON literal: read it raw up to its balancing bracket.
    if (!q && !cur && !any && (c === '{' || c === '[')) {
      let depth = 0, str = false, j = i;
      for (; j < line.length; j++) {
        const d = line[j];
        if (str) { if (d === '\\') j++; else if (d === '"') str = false; continue; }
        if (d === '"') str = true; else if (d === '{' || d === '[') depth++; else if (d === '}' || d === ']') { if (--depth === 0) break; }
      }
      out.push(line.slice(i, j + 1)); i = j; continue;
    }
    if (q) { if (c === '\\' && line[i + 1] === q) { cur += q; i++; } else if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += c;
  }
  if (q) throw err('invalid_argument', 'unclosed quote');
  if (cur || any) out.push(cur);
  return out;
}
export function parse(line) {
  const toks = tokenize(line.trim());
  const verb = toks.shift();
  const args = [], flags = {};
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith('--') && t.length > 2) { const [kk, v] = t.slice(2).split('=', 2); if (v !== undefined) flags[kk] = v; else if (toks[i + 1] !== undefined && !toks[i + 1].startsWith('--') && !['merge', 'write', 'assets'].includes(kk)) flags[kk] = toks[++i]; else flags[kk] = true; }
    else args.push(t);
  }
  return { verb, args, flags };
}
export function isWrite(line) { try { const { verb, flags } = parse(line); const v = VERBS[verb]; if (!v) return false; return typeof v.write === 'function' ? v.write(flags) : !!v.write; } catch { return true; } }

export async function runLine(k, p, line, input) {
  const { verb, args, flags } = parse(line);
  if (!verb) return { value: null, text: '' };
  const v = VERBS[verb];
  if (!v) throw err('invalid_argument', `unknown verb "${verb}"; try help`);
  const value = await v.run(k, p, args, flags, input);
  return { value, text: format(value) };
}

export function format(v) {
  if (v == null) return '(nothing)';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    if (!v.length) return '(none)';
    if (v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const cols = [...new Set(v.flatMap(x => Object.keys(x)))];
      const cell = (x) => x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
      const rows = v.map(x => cols.map(c => cell(x[c]).replace(/\n/g, '⏎')));
      const w = cols.map((c, i) => Math.min(60, Math.max(c.length, ...rows.map(r => r[i].length))));
      const line = (r) => r.map((x, i) => (x.length > w[i] ? x.slice(0, w[i] - 1) + '…' : x.padEnd(w[i]))).join('  ').trimEnd();
      return [line(cols), line(w.map(n => '─'.repeat(n))), ...rows.map(line)].join('\n');
    }
    return v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n');
  }
  return yamlish(v);
}
function yamlish(v, ind = '') {
  if (v == null || typeof v !== 'object') return String(v);
  const lines = [];
  for (const [key, x] of Object.entries(v)) {
    if (x === undefined) continue;
    if (Array.isArray(x)) { if (!x.length) lines.push(`${ind}${key}: []`); else { lines.push(`${ind}${key}:`); for (const y of x) lines.push(`${ind}  - ${typeof y === 'object' && y ? JSON.stringify(y) : y}`); } }
    else if (x && typeof x === 'object') { lines.push(`${ind}${key}:`); lines.push(yamlish(x, ind + '  ')); }
    else lines.push(`${ind}${key}: ${typeof x === 'string' && x.includes('\n') ? '|\n' + x.split('\n').map(l => ind + '  ' + l).join('\n') : x}`);
  }
  return lines.join('\n');
}
export { lv };
