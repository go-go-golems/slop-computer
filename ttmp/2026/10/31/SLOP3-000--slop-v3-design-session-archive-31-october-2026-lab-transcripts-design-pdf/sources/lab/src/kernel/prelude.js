// JS that runs inside every actor's QuickJS context before actor.js. Kept as a string.
export const PRELUDE = String.raw`
'use strict';
const __LEVELS = ['none','view','interact','admin','owner'];
const __j = (s) => (s === undefined || s === null || s === '' ? null : JSON.parse(s));
globalThis.console = { log: (...a) => __log('log', a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), warn: (...a) => __log('warn', a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), error: (...a) => __log('error', a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) };
Date.now = () => __now();
const __call = (op, ...args) => { const r = __host(op, JSON.stringify(args)); const o = JSON.parse(r); if (o.e) { const err = new Error(o.e.message); err.code = o.e.code; throw err; } return o.v; };
const __acall = async (op, ...args) => { const r = await __async(op, JSON.stringify(args)); const o = JSON.parse(r); if (o.e) { const err = new Error(o.e.message); err.code = o.e.code; throw err; } return o.v; };
function __snap(d) { return d ? { exists: true, id: d.id, path: d.path, version: d.version, data: () => d.data } : { exists: false, data: () => undefined }; }
function __query(coll, q) {
  return {
    where(f, op, v) { return __query(coll, { ...q, where: [...(q.where || []), [f, op, v]] }); },
    orderBy(f, d) { return __query(coll, { ...q, orderBy: [...(q.orderBy || []), [f, d || 'asc']] }); },
    limit(n) { return __query(coll, { ...q, limit: n }); },
    get() { const rows = __call('db.query', coll, q); const docs = rows.map(__snap); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; },
    doc(id) { return __doc(coll + '/' + (id || __call('rid'))); },
    add(data) { const id = __call('rid'); __call('db.set', coll + '/' + id, data, false); return __doc(coll + '/' + id); },
  };
}
function __doc(path) {
  return { id: path.split('/').pop(), path,
    get() { return __snap(__call('db.get', path)); },
    set(data, o) { return __call('db.set', path, data, !!(o && o.merge)); },
    update(data) { return __call('db.set', path, data, true); },
    delete() { return __call('db.delete', path); },
    collection(c) { return __query(path + '/' + c, {}); } };
}
const __caps = __j(__host_caps());
const __mods = {
  sql: () => ({ all: (q, ...p) => __call('sql.all', q, p), one: (q, ...p) => __call('sql.one', q, p), run: (q, ...p) => __call('sql.run', q, p),
    transaction(fn) { __call('sp', 'begin'); try { const r = fn(); __call('sp', 'commit'); return r; } catch (e) { __call('sp', 'rollback'); throw e; } } }),
  db: () => ({ doc: (p) => __doc(p), collection: (p) => __query(p, {}) }),
  alarm: () => ({ at: (t, name, data) => __call('alarm.at', t, name, data), every: (name, spec, data) => __call('alarm.every', name, spec, data), cancel: (name) => __call('alarm.cancel', name), list: () => __call('alarm.list') }),
  room: () => ({ emit: (topic, data) => __call('room.emit', topic, data), peers: () => __call('room.peers') }),
  log: () => ({ since: (rev) => __call('log.since', rev) }),
  time: () => ({ now: () => __now(), sleep: (ms) => __acall('sleep', ms) }),
  stores: () => ({
    open: (id) => ({ id, call: (action, args) => __acall('stores.call', id, action, args), get: (path) => __snap(__call('stores.get', id, path)) }),
    get: (id, path) => __snap(__call('stores.get', id, path)),
  }),
  sample: () => { const f = (input, opts) => __acall('sample', input, opts || {}).then(r => r); f.create = (o) => __acall('sample', o.prompt || o.input || o, o).then(r => r.text); return f; },
  ui: () => { const n = (t) => (props, ...c) => ({ t, ...(props && !Array.isArray(props) && typeof props === 'object' && !props.t ? props : {}), c: [].concat(props && (Array.isArray(props) || props.t || typeof props !== 'object') ? props : [], c).flat().filter(x => x != null) });
    return { stack: n('stack'), row: n('row'), heading: (text) => ({ t: 'heading', text }), text: (text) => ({ t: 'text', text: String(text) }), button: (label, action, args) => ({ t: 'button', label, on: { action, args } }), json: (value) => ({ t: 'json', value }), table: (rows) => ({ t: 'table', rows }), badge: (text) => ({ t: 'badge', text }) }; },
};
globalThis.use = (name) => (__caps.includes(name) && __mods[name] ? __mods[name]() : null); // null: not declared, not approved, or no such module
const __modcache = {};
globalThis.require = (p) => {
  const path = String(p).replace(/^\.\//, '');
  if (__modcache[path]) return __modcache[path].exports;
  const src = __call('readFile', path);
  if (src == null) throw new Error('require: no file ' + path);
  const module = { exports: {} }; __modcache[path] = module;
  (0, eval)('(function (module, exports, require) {' + src + '\n})')(module, module.exports, globalThis.require);
  return module.exports;
};
let __spec = null;
globalThis.defineActor = (spec) => { __spec = spec || {}; };
function __ctx(c) {
  return { ...c, need(level) { if (__LEVELS.indexOf(c.principal.level) < __LEVELS.indexOf(level)) { const e = new Error(c.principal.id + ' has ' + c.principal.level + ', needs ' + level); e.code = 'permission_denied'; throw e; } },
    exclusive: (fn) => fn(), log: (...a) => console.log(...a) };
}
const __pending = {};
let __pid = 0;
globalThis.__describe = () => JSON.stringify({ actions: Object.keys(__spec && __spec.actions || {}), http: Object.keys(__spec && __spec.http || {}).map(k => ({ route: k, level: (__spec.http[k] && __spec.http[k].level) || 'view' })), on: Object.keys(__spec && __spec.on || {}), every: Object.entries(__spec && __spec.every || {}).map(([k, v]) => ({ name: k, every: v.every || null, cron: v.cron || null })), surfaces: Object.keys(__spec && __spec.surfaces || {}), setup: !!(__spec && __spec.setup), smoke: !!(__spec && __spec.smoke) });
globalThis.__dispatch = (kind, name, ctxJson, argJson) => {
  if (!__spec) throw new Error('actor.js did not call defineActor');
  const ctx = __ctx(JSON.parse(ctxJson)); const arg = __j(argJson);
  let fn;
  if (kind === 'action') fn = __spec.actions && __spec.actions[name];
  else if (kind === 'http') fn = __spec.http && __spec.http[name] && (__spec.http[name].run || __spec.http[name]);
  else if (kind === 'on') fn = __spec.on && __spec.on[name];
  else if (kind === 'every') fn = __spec.every && __spec.every[name] && (__spec.every[name].run || __spec.every[name]);
  else if (kind === 'setup') fn = __spec.setup; else if (kind === 'smoke') fn = __spec.smoke;
  else if (kind === 'surface') fn = __spec.surfaces && __spec.surfaces[name];
  if (typeof fn !== 'function') { if (kind === 'setup' || kind === 'smoke') return JSON.stringify({ done: true, v: null }); const e = new Error('no ' + kind + ' "' + name + '"'); e.code = 'not_found'; throw e; }
  const r = fn(ctx, arg);
  if (r && typeof r.then === 'function') {
    const id = ++__pid; __pending[id] = { done: false };
    r.then((v) => { __settle(id, JSON.stringify({ v: v === undefined ? null : v })); }, (e) => { __settle(id, JSON.stringify({ e: { code: (e && e.code) || 'actor_error', message: String(e && e.message || e) } })); });
    return JSON.stringify({ pending: id });
  }
  return JSON.stringify({ done: true, v: r === undefined ? null : r });
};
`;
