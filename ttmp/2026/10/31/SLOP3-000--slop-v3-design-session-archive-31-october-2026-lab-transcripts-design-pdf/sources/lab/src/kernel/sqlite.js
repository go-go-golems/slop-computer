// SQLite through sqlite-wasm: one Db per store file, an authorizer that applies the
// SQL policy of design section 5.4, update-hook row hints, and statement recording.
import sqlite3InitModule from '../../../vendor/sqlite-wasm/src/bin/sqlite3.mjs';
import { clean, err } from './util.js';

export let sqlite3, capi, wasm;
export async function initSqlite() {
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  capi = sqlite3.capi; wasm = sqlite3.wasm;
  return sqlite3;
}

const ACTION = {}; // code -> name
const NAMES = ['CREATE_INDEX', 'CREATE_TABLE', 'CREATE_TEMP_INDEX', 'CREATE_TEMP_TABLE', 'CREATE_TEMP_TRIGGER', 'CREATE_TEMP_VIEW', 'CREATE_TRIGGER', 'CREATE_VIEW', 'DELETE', 'DROP_INDEX', 'DROP_TABLE', 'DROP_TEMP_INDEX', 'DROP_TEMP_TABLE', 'DROP_TEMP_TRIGGER', 'DROP_TEMP_VIEW', 'DROP_TRIGGER', 'DROP_VIEW', 'INSERT', 'PRAGMA', 'READ', 'SELECT', 'TRANSACTION', 'UPDATE', 'ATTACH', 'DETACH', 'ALTER_TABLE', 'REINDEX', 'ANALYZE', 'CREATE_VTABLE', 'DROP_VTABLE', 'FUNCTION', 'SAVEPOINT', 'RECURSIVE'];

// Kernel-owned names. sqlite_schema/master, sqlite_sequence (AUTOINCREMENT) and sqlite_stat1 (ANALYZE) belong to SQLite itself.
const SQLITE_OWN = new Set(['sqlite_schema', 'sqlite_master', 'sqlite_sequence', 'sqlite_stat1', 'sqlite_temp_master', 'sqlite_temp_schema']);
const sys = (t) => !!t && (t.startsWith('_') || t.startsWith('sqlite_')) && !SQLITE_OWN.has(t) && !t.startsWith('sqlite_autoindex_');
const PRAGMA_OK = new Set(['table_info', 'table_xinfo', 'index_list', 'index_info', 'foreign_key_list', 'data_version']);
const FN_DENY = new Set(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile', 'edit', 'sqlite_offset']);

// The policy: caller kind x action -> [ok, reason]. Section 5.4 of the design.
export function decide(kind, code, a, b, db, via, write) {
  const n = ACTION[code];
  if (kind === 'kernel') return [true];
  switch (n) {
    case 'SELECT': case 'RECURSIVE': return [true];
    case 'READ':
      if (a === 'sqlite_schema' || a === 'sqlite_master') return kind === 'page' ? [false, 'pages cannot read the schema'] : [true];
      if (via && via.startsWith('slop_')) return [true];
      if (sys(a)) return kind === 'actor' || kind === 'admin' ? [true] : [false, `kernel table ${a} is not readable by ${kind} code`];
      return [true];
    case 'INSERT': case 'UPDATE': case 'DELETE':
      if (sys(a)) return [false, `${a} belongs to the kernel; write it through its API`];
      if (kind === 'actor' || kind === 'migration') return [true];
      if (kind === 'admin') return write ? [true] : [false, 'admin SQL is read-only without --write'];
      return [false, 'pages write through actions or documents'];
    case 'CREATE_TABLE': case 'CREATE_VIEW': case 'CREATE_INDEX': case 'CREATE_TRIGGER':
    case 'DROP_TABLE': case 'DROP_VIEW': case 'DROP_INDEX': case 'DROP_TRIGGER': case 'ALTER_TABLE':
      if (kind !== 'migration') return [false, 'DDL ships as migrations (sql/NNN_name.sql)'];
      { const name = n === 'ALTER_TABLE' ? b : a; if (sys(name) || (name || '').startsWith('slop_')) return [false, `"${name}" is a reserved name`]; }
      return [true];
    case 'CREATE_VTABLE': case 'DROP_VTABLE':
      return kind === 'migration' && b === 'fts5' ? [true] : [false, 'only fts5 virtual tables, only in migrations'];
    case 'CREATE_TEMP_INDEX': case 'CREATE_TEMP_TABLE': case 'CREATE_TEMP_TRIGGER': case 'CREATE_TEMP_VIEW':
    case 'DROP_TEMP_INDEX': case 'DROP_TEMP_TABLE': case 'DROP_TEMP_TRIGGER': case 'DROP_TEMP_VIEW':
      return [false, 'TEMP objects are denied everywhere'];
    case 'ATTACH': case 'DETACH': return [false, 'ATTACH and DETACH are denied'];
    case 'PRAGMA':
      if (kind === 'page') return [false, 'pages cannot run PRAGMA'];
      if (PRAGMA_OK.has(a) || (kind === 'migration' && a === 'user_version' && b == null)) return [true];
      return [false, `PRAGMA ${a} is not on the allowlist`];
    case 'FUNCTION': return FN_DENY.has(b) ? [false, `function ${b} is denied`] : [true];
    case 'TRANSACTION': case 'SAVEPOINT': return [false, 'the kernel owns transactions; use sql.transaction(fn)'];
    case 'ANALYZE': case 'REINDEX': return kind === 'migration' ? [true] : [false, `${n} only in migrations`];
    default: return [false, `${n || code} is not allowed`];
  }
}

export class Db {
  constructor(bytes) {
    if (!ACTION[18]) NAMES.forEach(nm => { ACTION[capi['SQLITE_' + nm]] = nm; });
    this.db = new sqlite3.oo1.DB(':memory:', 'c');
    if (bytes) this.load(bytes);
    this.kind = 'kernel'; this.write = false; this.rec = null; this.readSet = null; this.writeSet = null; this.hints = null;
    this.fns = {};
    const S = (p) => (typeof p === 'string' ? p : p ? wasm.cstrToJs(p) : null);
    capi.sqlite3_set_authorizer(this.db.pointer, (pV, code, a, b, dbn, via) => {
      a = S(a); b = S(b); via = S(via);
      const [ok, why] = decide(this.kind, code, a, b, dbn, via, this.write);
      const n = ACTION[code];
      if (this.kind !== 'kernel') {
        if (n === 'READ' && a && !sys(a) && this.readSet) this.readSet.add(a);
        if ((n === 'INSERT' || n === 'UPDATE' || n === 'DELETE') && ok && this.writeSet) this.writeSet.add(a);
        if (this.rec && !(n === 'READ' && ok && this.rec.auth.some(x => x.a === a && x.ok))) this.rec.auth.push({ action: n, a, b, via, ok, why });
      }
      return ok ? 0 : capi.SQLITE_DENY;
    }, 0);
    capi.sqlite3_update_hook(this.db.pointer, (pV, op, dbn, tbl, rowid) => {
      if (this.hints && this.kind !== 'kernel') this.hints.push({ op: op === capi.SQLITE_INSERT ? 'insert' : op === capi.SQLITE_DELETE ? 'delete' : 'update', table: S(tbl), rowid: clean(rowid) });
    }, 0);
    for (const [k, v] of [[capi.SQLITE_LIMIT_ATTACHED, 0], [capi.SQLITE_LIMIT_SQL_LENGTH, 100 * 1024], [capi.SQLITE_LIMIT_EXPR_DEPTH, 100], [capi.SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024]]) capi.sqlite3_limit(this.db.pointer, k, v);
    this.kexec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
  }
  load(bytes) {
    const p = wasm.allocFromTypedArray(bytes);
    const rc = capi.sqlite3_deserialize(this.db.pointer, 'main', p, bytes.length, bytes.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
    if (rc) throw err('unavailable', 'could not load a store image (rc ' + rc + ')');
  }
  export() { return capi.sqlite3_js_db_export(this.db.pointer); }
  close() { try { this.db.close(); } catch { /* closed */ } }
  fn(name, f) { if (this.fns[name]) return; this.fns[name] = true; this.db.createFunction({ name, xFunc: (ctx, ...args) => f(...args), deterministic: false, innocuous: true, arity: -1 }); }

  // Kernel statements: no policy, no recording.
  kall(sql, bind) { return this.as('kernel', () => clean(this.db.selectObjects(sql, bind))); }
  kone(sql, bind) { return this.kall(sql, bind)[0] || null; }
  kval(sql, bind) { const r = this.kone(sql, bind); return r ? Object.values(r)[0] : null; }
  krun(sql, bind) { return this.as('kernel', () => { this.db.exec({ sql, bind }); return { changes: capi.sqlite3_changes(this.db.pointer), lastRowid: clean(capi.sqlite3_last_insert_rowid(this.db.pointer)) }; }); }
  kexec(sql) { return this.as('kernel', () => this.db.exec(sql)); }

  // Code statements: policy applies; each one is recorded on `rec` (the turn).
  q(kind, sql, bind, { mode = 'all', write = false, turn = null, budgetMs = 250 } = {}) {
    const rec = { sql, bind: bind ? clean(bind) : undefined, kind, auth: [], ms: 0, error: null, rows: undefined, changes: undefined };
    if (turn) turn.statements.push(rec);
    const prev = [this.kind, this.write, this.rec];
    this.kind = kind; this.write = write; this.rec = rec;
    const t0 = performance.now();
    let n = 0; const stopAt = t0 + budgetMs;
    capi.sqlite3_progress_handler(this.db.pointer, 2000, () => (++n % 4 === 0 && performance.now() > stopAt ? 1 : 0), 0);
    try {
      if (mode === 'run') {
        this.db.exec({ sql, bind });
        const r = { changes: capi.sqlite3_changes(this.db.pointer), lastRowid: clean(capi.sqlite3_last_insert_rowid(this.db.pointer)) };
        rec.changes = r.changes; return r;
      }
      if (mode === 'script') { this.db.exec(sql); return null; }
      const rows = clean(this.db.selectObjects(sql, bind));
      rec.rows = rows.length;
      if (rows.length > 10000) throw err('quota_exceeded', 'more than 10,000 rows');
      return mode === 'one' ? rows[0] || null : rows;
    } catch (e) {
      const msg = String(e && e.message || e);
      rec.error = msg;
      if (/SQLITE_INTERRUPT/.test(msg)) throw err('query_too_slow', `statement passed its ${budgetMs} ms budget`);
      if (/SQLITE_AUTH|not authorized|prohibited/.test(msg)) {
        const d = rec.auth.find(x => !x.ok);
        throw err('permission_denied', d ? d.why : msg.replace(/^.*?: /, ''), { authorizer: true });
      }
      throw err('invalid_argument', msg.replace(/^SQLITE_\w+: sqlite3 result code \d+: /, ''));
    } finally {
      rec.ms = +(performance.now() - t0).toFixed(2);
      capi.sqlite3_progress_handler(this.db.pointer, 0, 0, 0);
      [this.kind, this.write, this.rec] = prev;
    }
  }
  as(kind, f) { const p = this.kind; this.kind = kind; try { return f(); } finally { this.kind = p; } }
  tableInfo(name) { return this.kall(`SELECT name, type FROM pragma_table_info(?)`, [name]); }
  appObjects() { return this.kall(`SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND type IN ('table','view') ORDER BY type, name`); }
}
