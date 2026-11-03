// use('storage') and ctx.storage: Durable-Object-shaped storage over the
// store's own documents, SQL and alarms (SLOP3-008 phase 5). It has the shape
// of DurableObjectStorage, so code written against ctx.storage reads
// naturally here; it is not Cloudflare's runtime, and the differences are
// listed in doc/design/slop-v3.md.
//
//   keys    documents storage/<id> with body {key, value}: <id> is the key
//           itself when it is a valid path segment, else ~<sha256 of the key>
//   order   by key, as UTF-8 bytes, like Durable Objects
//   values  JSON values only (no Date, Map, ArrayBuffer...)
//   sql     sql.exec(query, ...bindings) over the store's tables (made by
//           the app's migrations; DDL is refused at run time)
//   alarm   one alarm named "alarm": its handler is alarms.alarm(ctx)
//
// Every method runs inside the actor's turn: the promises it returns are
// already settled, so awaiting them does not end the turn.
(function (db, sql, alarm, keyID, sqlTable) {
  'use strict';
  const COLL = 'storage', ALARM = 'alarm', MAX_KEYS = 128, MAX_KEY_BYTES = 2048;

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    throw e;
  }
  // settled wraps a synchronous function so it returns a settled promise.
  function settled(fn) {
    return function () {
      try {
        return Promise.resolve(fn.apply(null, arguments));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  function utf8Bytes(s) {
    let n = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
  }
  // cmp orders strings by code point, which is UTF-8 byte order (the server
  // orders documents the same way).
  function cmp(a, b) {
    const x = Array.from(a), y = Array.from(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = x[i].codePointAt(0) - y[i].codePointAt(0);
      if (d) return d;
    }
    return x.length - y.length;
  }
  function checkKey(k) {
    if (typeof k !== 'string') fail('invalid_argument', 'a storage key is a string');
    if (utf8Bytes(k) > MAX_KEY_BYTES) fail('invalid_argument', 'a storage key is at most 2048 bytes');
    return k;
  }
  function checkKeys(ks) {
    if (ks.length > MAX_KEYS) fail('invalid_argument', 'at most 128 keys at once');
    ks.forEach(checkKey);
    return ks;
  }
  function checkValue(v) {
    if (v === undefined) fail('invalid_argument', 'undefined cannot be stored');
    return JSON.parse(JSON.stringify(v)); // a copy, as structured clone gives
  }
  function inRange(k, o) {
    return (o.start === undefined || cmp(k, o.start) >= 0) &&
      (o.startAfter === undefined || cmp(k, o.startAfter) > 0) &&
      (o.end === undefined || cmp(k, o.end) < 0) &&
      (o.prefix === undefined || k.startsWith(o.prefix));
  }
  function checkList(o) {
    o = o || {};
    if (o.start !== undefined && o.startAfter !== undefined) fail('invalid_argument', 'list takes start or startAfter, not both');
    for (const f of ['start', 'startAfter', 'end', 'prefix']) if (o[f] !== undefined) checkKey(o[f]);
    if (o.limit !== undefined && !(Number.isInteger(o.limit) && o.limit > 0)) fail('invalid_argument', 'list limit is a positive integer');
    return o;
  }
  const ref = (k) => db.doc(COLL + '/' + keyID(checkKey(k)));

  // The applied key-value store, synchronous.
  const base = {
    get(k) {
      const s = ref(k).get();
      return s.exists ? s.data().value : undefined;
    },
    put(k, v) { ref(k).set({ key: k, value: v }); },
    delete(k) { return ref(k).delete(); },
    list(o) {
      let q = db.collection(COLL).orderBy('key', o.reverse ? 'desc' : 'asc');
      if (o.start !== undefined) q = q.where('key', '>=', o.start);
      if (o.startAfter !== undefined) q = q.where('key', '>', o.startAfter);
      if (o.end !== undefined) q = q.where('key', '<', o.end);
      if (o.prefix !== undefined) q = q.where('key', '>=', o.prefix);
      const out = [];
      for (const d of q.get().docs) {
        const b = d.data();
        if (o.prefix !== undefined && !b.key.startsWith(o.prefix)) {
          if (o.reverse) continue; // keys past the prefix come first
          break;
        }
        out.push([b.key, b.value]);
        if (o.limit && out.length >= o.limit) break;
      }
      return out;
    },
  };

  // overlay buffers a transaction's writes over base; commit applies them.
  function overlay() {
    const buf = new Map(); // key → {v} | null (deleted)
    return {
      get(k) {
        checkKey(k);
        if (buf.has(k)) {
          const e = buf.get(k);
          return e ? e.v : undefined;
        }
        return base.get(k);
      },
      put(k, v) { buf.set(checkKey(k), { v: v }); },
      delete(k) {
        const had = this.get(k) !== undefined;
        buf.set(k, null);
        return had;
      },
      list(o) {
        const m = new Map(base.list(Object.assign({}, o, { limit: undefined })));
        for (const [k, e] of buf) {
          if (!inRange(k, o)) continue;
          if (e) m.set(k, e.v);
          else m.delete(k);
        }
        let ks = Array.from(m.keys()).sort(cmp);
        if (o.reverse) ks.reverse();
        if (o.limit) ks = ks.slice(0, o.limit);
        return ks.map((k) => [k, m.get(k)]);
      },
      commit() {
        for (const [k, e] of buf) {
          if (e) base.put(k, e.v);
          else base.delete(k);
        }
      },
    };
  }

  // The operations, over a key-value source (base, or a transaction's).
  function get(src, k) {
    if (Array.isArray(k)) {
      const m = new Map();
      for (const x of checkKeys(k.slice()).sort(cmp)) {
        const v = src.get(x);
        if (v !== undefined) m.set(x, v);
      }
      return m;
    }
    return src.get(k);
  }
  function put(src, k, v) {
    if (k !== null && typeof k === 'object') {
      const es = Object.entries(k);
      checkKeys(es.map((e) => e[0]));
      for (const [a, b] of es) src.put(a, checkValue(b));
      return;
    }
    src.put(checkKey(k), checkValue(v));
  }
  function del(src, k) {
    if (Array.isArray(k)) {
      let n = 0;
      for (const x of checkKeys(k)) if (src.delete(x)) n++;
      return n;
    }
    return src.delete(checkKey(k));
  }
  const list = (src, o) => new Map(src.list(checkList(o)));

  function getAlarm() {
    const r = alarm.list().find((a) => a.name === ALARM);
    return r ? Number(r.at) : null;
  }
  function setAlarm(t) {
    const ms = t instanceof Date ? t.getTime() : Number(t);
    if (!Number.isFinite(ms)) fail('invalid_argument', 'setAlarm takes a time in milliseconds or a Date');
    alarm.at(ms, ALARM);
  }
  function deleteAlarm() { alarm.cancel(ALARM); }

  function cursor(r) {
    let i = 0;
    const obj = (row) => {
      const o = {};
      r.columns.forEach((c, j) => { o[c] = row[j]; });
      return o;
    };
    const take = (f) => () => (i < r.rows.length ? { done: false, value: f(r.rows[i++]) } : { done: true, value: undefined });
    const rest = (f) => () => {
      const out = [];
      while (i < r.rows.length) out.push(f(r.rows[i++]));
      return out;
    };
    const c = {
      columnNames: r.columns,
      rowsRead: r.rows.length,
      rowsWritten: r.rowsWritten,
      next: take(obj),
      toArray: rest(obj),
      one() {
        if (r.rows.length !== 1) fail('invalid_argument', 'one() expects exactly one row, the query returned ' + r.rows.length);
        return obj(r.rows[0]);
      },
      raw() {
        const it = { next: take((row) => row.slice()), toArray: rest((row) => row.slice()) };
        it[Symbol.iterator] = () => it;
        return it;
      },
    };
    c[Symbol.iterator] = () => c;
    return c;
  }

  let current = null; // the transaction transactionSync runs in
  const kv = () => current || base;

  function transaction(closure) {
    const t = overlay();
    let rolledBack = false;
    const txn = {
      get: settled((k) => get(t, k)),
      put: settled((k, v) => put(t, k, v)),
      delete: settled((k) => del(t, k)),
      list: settled((o) => list(t, o)),
      rollback() { rolledBack = true; },
      getAlarm: settled(getAlarm),
      setAlarm: settled(setAlarm),
      deleteAlarm: settled(deleteAlarm),
    };
    let r;
    try {
      r = closure(txn);
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(r).then((v) => {
      if (!rolledBack) t.commit();
      return v;
    });
  }

  function transactionSync(fn) {
    if (current) return fn(); // nested: part of the outer one
    const t = overlay();
    let r;
    current = t;
    try {
      r = sql.transaction(() => fn());
    } finally {
      current = null;
    }
    if (r && typeof r.then === 'function') fail('invalid_argument', 'transactionSync takes a synchronous function');
    t.commit();
    return r;
  }

  return Object.freeze({
    get: settled((k) => get(kv(), k)),
    put: settled((k, v) => { put(kv(), k, v); }),
    delete: settled((k) => del(kv(), k)),
    list: settled((o) => list(kv(), o)),
    deleteAll: settled(() => {
      for (const d of db.collection(COLL).get().docs) db.doc(d.path).delete();
    }),
    transaction: transaction,
    transactionSync: transactionSync,
    getAlarm: settled(getAlarm),
    setAlarm: settled(setAlarm),
    deleteAlarm: settled(deleteAlarm),
    sync: settled(() => undefined),
    // The synchronous key-value API of SQLite-backed Durable Objects.
    kv: Object.freeze({
      get: (k) => get(kv(), k),
      put: (k, v) => { put(kv(), k, v); },
      delete: (k) => del(kv(), k),
      list: (o) => kv().list(checkList(o)),
    }),
    sql: Object.freeze({
      exec: function (query) {
        return cursor(sqlTable.apply(null, arguments));
      },
    }),
  });
})
