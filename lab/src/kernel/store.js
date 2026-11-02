// A store: one SQLite file with documents, files, app tables, the log, snapshots and refs.
import { Db } from './sqlite.js';
import { sha256, err, docPath, collPath, deepMerge, depth, isObj, enc, dec, guessType, isText } from './util.js';

export const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS _meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS _docs(path TEXT PRIMARY KEY, coll TEXT NOT NULL, body TEXT CHECK (body IS NULL OR json_valid(body)), version INTEGER NOT NULL, rev INTEGER NOT NULL, size INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS _docs_coll ON _docs(coll);
CREATE TABLE IF NOT EXISTS _files(zone TEXT NOT NULL CHECK (zone IN ('tree','assets')), path TEXT NOT NULL, sha256 TEXT, size INTEGER NOT NULL, type TEXT NOT NULL, rev INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL, PRIMARY KEY(zone, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _blobs(sha256 TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _log(rev INTEGER PRIMARY KEY, at INTEGER NOT NULL, principal TEXT NOT NULL, via TEXT NOT NULL, app TEXT, step TEXT, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS _changes(rev INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, op TEXT NOT NULL, version INTEGER, old TEXT, new TEXT, PRIMARY KEY(rev, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS _changes_key ON _changes(kind, key, rev);
CREATE TABLE IF NOT EXISTS _snapshots(n INTEGER PRIMARY KEY, rev INTEGER NOT NULL, tree TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', by TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS _snapshot_files(n INTEGER NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY(n, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _refs(name TEXT PRIMARY KEY, n INTEGER NOT NULL, at INTEGER NOT NULL, by TEXT);
CREATE TABLE IF NOT EXISTS _migrations(app TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(app, name));
CREATE TABLE IF NOT EXISTS _cursors(name TEXT NOT NULL, source TEXT NOT NULL, epoch INTEGER NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(name, source));
CREATE TABLE IF NOT EXISTS _alarms(name TEXT PRIMARY KEY, at INTEGER NOT NULL, every TEXT, data TEXT, running INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS _leases(path TEXT PRIMARY KEY, holder TEXT NOT NULL, until INTEGER NOT NULL, data TEXT);
`;

const MAX_DOC = 256 * 1024, MAX_DOCS = 25000;

export class Store {
  constructor(id, bytes) {
    this.id = id;
    this.db = new Db(bytes);
    if (!bytes) this.db.kexec(STORE_SCHEMA);
    this.metaCache = null;
  }
  meta(k) { if (!this.metaCache) this.metaCache = Object.fromEntries(this.db.kall('SELECT key, value FROM _meta').map(r => [r.key, r.value])); return k ? this.metaCache[k] : this.metaCache; }
  setMeta(k, v) { this.db.krun('INSERT INTO _meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]); this.metaCache = null; }
  get rev() { return this.db.kval('SELECT coalesce(max(rev), 0) AS r FROM _log'); }
  get epoch() { return Number(this.meta('epoch') || 1); }

  // ---------- documents ----------
  getDoc(path) {
    docPath(path);
    const r = this.db.kone('SELECT path, body, version, rev, at, by FROM _docs WHERE path = ?', [path]);
    if (!r || r.body == null) return null;
    return { path: r.path, id: path.split('/').pop(), data: JSON.parse(r.body), version: r.version, rev: r.rev, at: r.at, by: r.by };
  }
  queryDocs(coll, { where = [], orderBy = [], limit, startAfter } = {}) {
    collPath(coll);
    if (where.length > 10) throw err('invalid_argument', 'at most 10 filters');
    const ops = { '==': '=', '=': '=', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
    const clauses = ['coll = ?', 'body IS NOT NULL'], bind = [coll];
    const jx = (f) => { if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(f)) throw err('invalid_argument', `bad field "${f}"`); return `json_extract(body, '$.${f}')`; };
    for (const [f, op, v] of where) {
      if (op === 'in') { if (!Array.isArray(v) || !v.length) throw err('invalid_argument', 'in needs a non-empty array'); clauses.push(`${jx(f)} IN (${v.map(() => '?').join(',')})`); bind.push(...v.map(sqlv)); continue; }
      if (op === 'array-contains') { clauses.push(`EXISTS (SELECT 1 FROM json_each(body, '$.${f}') WHERE value = ?)`); jx(f); bind.push(sqlv(v)); continue; }
      if (!ops[op]) throw err('invalid_argument', `operator ${op} is not supported`);
      if (v === null && (op === '==' || op === '=')) { clauses.push(`${jx(f)} IS NULL`); continue; }
      clauses.push(`${jx(f)} ${ops[op]} ?`); bind.push(sqlv(v));
    }
    const order = orderBy.map(([f, d]) => `${jx(f)} IS NULL, ${jx(f)} ${d === 'desc' ? 'DESC' : 'ASC'}`).concat('path');
    const sql = `SELECT path, body, version, rev, at FROM _docs WHERE ${clauses.join(' AND ')} ORDER BY ${order.join(', ')}${limit ? ` LIMIT ${Math.min(1000, limit | 0)}` : ' LIMIT 1000'}`;
    return { sql, rows: this.db.kall(sql, bind).map(r => ({ path: r.path, id: r.path.split('/').pop(), data: JSON.parse(r.body), version: r.version, rev: r.rev, at: r.at })) };
  }
  listColls() { return this.db.kall('SELECT coll, count(*) AS n FROM _docs WHERE body IS NOT NULL GROUP BY coll ORDER BY coll'); }
  setDoc(t, path, data, { merge = false, ifVersion } = {}) {
    const { coll } = docPath(path);
    if (!isObj(data)) throw err('invalid_argument', 'document bodies are JSON objects');
    const cur = this.db.kone('SELECT body, version FROM _docs WHERE path = ?', [path]);
    const curBody = cur && cur.body != null ? JSON.parse(cur.body) : null;
    if (ifVersion !== undefined && ifVersion !== null && (curBody ? cur.version : 0) !== ifVersion) throw err('conflict', `document is at version ${curBody ? cur.version : 0}, not ${ifVersion}`);
    if (merge && !curBody) throw err('not_found', `${path} does not exist; update needs an existing document`);
    const next = merge ? deepMerge(curBody, data) : data;
    const body = JSON.stringify(next);
    if (body.length > MAX_DOC) throw err('quota_exceeded', 'document larger than 256 KiB');
    if (depth(next) > 32) throw err('invalid_argument', 'document deeper than 32 levels');
    if (!curBody && this.db.kval('SELECT count(*) FROM _docs WHERE body IS NOT NULL') >= MAX_DOCS) throw err('quota_exceeded', 'store holds 25,000 documents');
    const version = (cur ? cur.version : 0) + 1;
    this.db.krun(`INSERT INTO _docs(path, coll, body, version, rev, size, by, at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET body = excluded.body, version = excluded.version, rev = excluded.rev, size = excluded.size, by = excluded.by, at = excluded.at`,
      [path, coll, body, version, -1, body.length, t.principal.id, t.now]);
    t.change({ kind: 'doc', key: path, op: curBody ? (merge ? 'update' : 'set') : 'create', version, old: t.step ? (cur ? cur.body : null) : undefined });
    return { path, version };
  }
  deleteDoc(t, path) {
    docPath(path);
    const cur = this.db.kone('SELECT body, version FROM _docs WHERE path = ?', [path]);
    if (!cur || cur.body == null) return { path, deleted: false };
    this.db.krun('UPDATE _docs SET body = NULL, version = version + 1, rev = -1, size = 0, by = ?, at = ? WHERE path = ?', [t.principal.id, t.now, path]);
    t.change({ kind: 'doc', key: path, op: 'delete', version: cur.version + 1, old: t.step ? cur.body : undefined });
    return { path, deleted: true };
  }

  // ---------- files ----------
  putBlob(bytes) { const h = sha256(bytes); this.db.krun('INSERT OR IGNORE INTO _blobs(sha256, data) VALUES (?, ?)', [h, bytes]); return h; }
  blob(h) { const r = this.db.as('kernel', () => this.db.db.selectValue('SELECT data FROM _blobs WHERE sha256 = ?', [h])); return r || null; }
  writeFile(t, path, content, { zone = 'tree', type } = {}) {
    const bytes = typeof content === 'string' ? enc(content) : content;
    if (bytes.length > (zone === 'assets' ? 20 : 50) * 1024 * 1024) throw err('quota_exceeded', 'file too large');
    const cur = this.db.kone('SELECT sha256 FROM _files WHERE zone = ? AND path = ?', [zone, path]);
    const h = this.putBlob(bytes);
    if (cur && cur.sha256 === h) return { path, sha256: h, unchanged: true };
    this.db.krun(`INSERT INTO _files(zone, path, sha256, size, type, rev, by, at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(zone, path) DO UPDATE SET sha256 = excluded.sha256, size = excluded.size, type = excluded.type, rev = excluded.rev, by = excluded.by, at = excluded.at`,
      [zone, path, h, bytes.length, type || guessType(path), -1, t.principal.id, t.now]);
    t.change({ kind: 'file', key: (zone === 'assets' ? 'assets:' : '') + path, op: cur ? 'update' : 'create', old: cur ? cur.sha256 : null, new: h });
    return { path, sha256: h };
  }
  removeFile(t, path, zone = 'tree') {
    const cur = this.db.kone('SELECT sha256 FROM _files WHERE zone = ? AND path = ?', [zone, path]);
    if (!cur) return { removed: false };
    this.db.krun('DELETE FROM _files WHERE zone = ? AND path = ?', [zone, path]);
    t.change({ kind: 'file', key: (zone === 'assets' ? 'assets:' : '') + path, op: 'delete', old: cur.sha256, new: null });
    return { removed: true };
  }
  listFiles(zone = 'tree') { return this.db.kall('SELECT path, sha256, size, type, rev, at FROM _files WHERE zone = ? ORDER BY path', [zone]); }
  readFile(path, { zone = 'tree', at } = {}) {
    let row;
    if (at !== undefined && at !== null) {
      const n = this.resolveVersion(at);
      row = this.db.kone('SELECT sha256, type FROM _snapshot_files WHERE n = ? AND path = ?', [n, path]);
    } else row = this.db.kone('SELECT sha256, type FROM _files WHERE zone = ? AND path = ?', [zone, path]);
    if (!row) return null;
    const bytes = this.blob(row.sha256);
    return { bytes, type: row.type, sha256: row.sha256 };
  }
  readText(path, opts) { const f = this.readFile(path, opts); return f ? dec(f.bytes) : null; }

  // ---------- snapshots and refs ----------
  snapshot(t, { message = '', ref = 'main' } = {}) {
    const files = this.db.kall("SELECT path, sha256, size, type FROM _files WHERE zone = 'tree' ORDER BY path");
    const tree = sha256(files.map(f => `${f.path}\t${f.sha256}`).join('\n'));
    const last = this.db.kone('SELECT n, tree FROM _snapshots ORDER BY n DESC LIMIT 1');
    const n = (last ? last.n : 0) + 1;
    this.db.krun('INSERT INTO _snapshots(n, rev, tree, message, by, at) VALUES (?,?,?,?,?,?)', [n, -1, tree, message, t.principal.id, t.now]);
    for (const f of files) this.db.krun('INSERT INTO _snapshot_files(n, path, sha256, size, type) VALUES (?,?,?,?,?)', [n, f.path, f.sha256, f.size, f.type]);
    t.change({ kind: 'snapshot', key: String(n), op: 'create', new: tree });
    if (ref) this.moveRef(t, ref, n);
    return { n, tree, unchangedFrom: last && last.tree === tree ? last.n : null };
  }
  moveRef(t, name, n) {
    const cur = this.db.kone('SELECT n FROM _refs WHERE name = ?', [name]);
    if (!this.db.kone('SELECT n FROM _snapshots WHERE n = ?', [n])) throw err('not_found', `no snapshot ${n}`);
    this.db.krun('INSERT INTO _refs(name, n, at, by) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET n = excluded.n, at = excluded.at, by = excluded.by', [name, n, t.now, t.principal.id]);
    t.change({ kind: 'ref', key: name, op: cur ? 'move' : 'create', old: cur ? String(cur.n) : null, new: String(n) });
  }
  resolveVersion(at) {
    if (typeof at === 'number' || /^\d+$/.test(String(at))) {
      const n = Number(at);
      if (!this.db.kone('SELECT 1 AS x FROM _snapshots WHERE n = ?', [n])) throw err('not_found', `no snapshot ${n} in ${this.id}`);
      return n;
    }
    const r = this.db.kone('SELECT n FROM _refs WHERE name = ?', [String(at)]);
    if (!r) throw err('not_found', `no ref "${at}"`);
    return r.n;
  }
  snapshots() { return this.db.kall('SELECT n, rev, tree, message, by, at FROM _snapshots ORDER BY n DESC'); }
  refs() { return this.db.kall('SELECT name, n, at, by FROM _refs ORDER BY name'); }
  treeAt(at) { const n = this.resolveVersion(at); return this.db.kall('SELECT path, sha256, size, type FROM _snapshot_files WHERE n = ? ORDER BY path', [n]); }
  manifestAt(at) {
    try { const n = this.resolveVersion(at); const txt = this.readText('app.json', { at: n }); return txt ? { n, manifest: JSON.parse(txt) } : null; } catch (e) { if (e.code === 'not_found') return null; throw e; }
  }

  // ---------- log ----------
  commits({ since = 0, limit = 200 } = {}) {
    const logs = this.db.kall('SELECT rev, at, principal, via, app, step, summary FROM _log WHERE rev > ? ORDER BY rev DESC LIMIT ?', [since, limit]);
    if (!logs.length) return [];
    const ch = this.db.kall(`SELECT rev, seq, kind, key, op, version FROM _changes WHERE rev >= ? AND rev <= ? ORDER BY rev, seq`, [logs[logs.length - 1].rev, logs[0].rev]);
    const by = {}; for (const c of ch) (by[c.rev] ||= []).push(c);
    return logs.map(l => ({ ...l, store: this.id, epoch: this.epoch, changes: by[l.rev] || [] }));
  }
  textFile(path) { const f = this.readFile(path); return f && isText(f.type) ? dec(f.bytes) : null; }
}

function sqlv(v) { return typeof v === 'boolean' ? (v ? 1 : 0) : v; }
