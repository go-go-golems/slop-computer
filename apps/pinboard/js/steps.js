/* Pinboard · the steps an app in a frame may take (SLOP3-017): one table,
   read by both sides of the frame protocol.

   In the frame, record(op, args, read) turns a call such as
   m.update(coll, id, r => …) into a step of data. A function argument runs
   there, against the frame's copy of the board (read), because a function
   cannot cross the frame and the page must never run the app's code. In the
   page, check(op, args, page) refuses a step that is not in the table or
   whose arguments do not have its shape, and returns the arguments core
   expects. Nothing is passed on unchecked: a step that would silently do
   nothing is an error. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PinboardSteps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const FRESH = { clip: /^clip:[a-z0-9]{10}$/, rec: /^rec:[a-z0-9]{10}$/ };
  function freshId(kind) {
    let s = '';
    for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 36).toString(36);
    return kind + ':' + s;
  }
  const keepOrFresh = (kind, id) => (typeof id === 'string' && FRESH[kind].test(id) ? id : freshId(kind));

  // What each argument position holds. A trailing "?" makes it optional;
  // "...str" takes the rest.
  const KINDS = {
    id: (v) => typeof v === 'string' && v.length > 0 && v.length <= 120,
    str: (v) => typeof v === 'string' && v.length <= 10000,
    obj: isObj,
    bool: (v) => typeof v === 'boolean',
    point: (v) => isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y),
    size: (v) => isObj(v) && Number.isFinite(v.w) && Number.isFinite(v.h),
    ids: (v) => Array.isArray(v) && v.length <= 500 && v.every(KINDS.id),
    data: () => true, // any JSON value
    patch: (v) => isObj(v) && isObj(v.set) && Array.isArray(v.unset) && v.unset.every((k) => typeof k === 'string'),
    nullable: (v) => v === null || isObj(v),
  };

  // Changes to records and clips computed in the frame, sent as what to set
  // and what to delete (core merges with Object.assign, which cannot delete).
  function diff(before, after) {
    const set = {}, unset = [];
    Object.keys(after).forEach((k) => { if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) set[k] = after[k]; });
    Object.keys(before).forEach((k) => { if (!(k in after)) unset.push(k); });
    return { set: copy(set), unset };
  }

  // The table. record (frame side) returns { args, result }; without one,
  // the arguments go as data. check (page side) returns core's arguments;
  // without one, the checked arguments go as they are.
  const OPS = {
    place: {
      args: ['obj'],
      record: ([c], read) => { const id = keepOrFresh('clip', c && c.id); return { args: [Object.assign({}, copy(c), { id })], result: id }; },
      check: ([c], page) => {
        c = Object.assign({}, c);
        if (!(typeof c.id === 'string' && FRESH.clip.test(c.id) && !page.has('clips', c.id))) delete c.id;
        if (c.kind === 'app') throw new Error('open apps with m.open');
        return [c];
      },
    },
    open: {
      args: ['str', 'obj?'],
      record: ([name, o]) => { const id = keepOrFresh('clip', o && o.id); return { args: [String(name), Object.assign({}, copy(o || {}), { id })], result: id }; },
      check: ([name, o], page) => {
        o = Object.assign({}, o);
        if (!(typeof o.id === 'string' && FRESH.clip.test(o.id) && !page.has('clips', o.id))) delete o.id;
        return [name, o];
      },
    },
    move: { args: ['id', 'point'] },
    resize: { args: ['id', 'size'] },
    retitle: { args: ['id', 'str'] },
    tag: { args: ['id', '...str'] },
    untag: { args: ['id', 'str'] },
    setAttr: {
      args: ['id', 'obj'],
      check: ([id, patch]) => { const p = Object.assign({}, patch); delete p.id; delete p.kind; delete p.app; return [id, p]; },
    },
    remove: { args: ['id'] },
    group: { args: ['ids', 'obj?'] },
    ungroup: { args: ['id'] },
    pin: { args: ['id', 'bool?'] },
    close: { args: ['id'] },
    setParam: { args: ['id', 'str', 'data'] },
    setState: { args: ['id', 'obj'] },
    collection: { args: ['str', 'obj'] },
    insert: {
      args: ['str', 'obj'],
      record: ([coll, d]) => { const id = keepOrFresh('rec', d && d.id); return { args: [String(coll), Object.assign({}, copy(d), { id })], result: id }; },
    },
    // update(coll, id, patch | (record) => patch): the function runs in the
    // frame on a copy of the record, as core would run it on the record.
    update: {
      args: ['str', 'id', 'patch'],
      fn: 2,
      record: ([coll, id, patch], read) => {
        const before = read('records', id);
        if (!before) throw new Error('no record ' + id);
        const r = copy(before);
        const out = typeof patch === 'function' ? patch(r) : copy(patch);
        if (out !== undefined && out !== null && !isObj(out)) throw new Error('update(' + coll + ', ' + id + ', …): the patch must be an object');
        return { args: [String(coll), id, diff(before, Object.assign(r, out || {}))] };
      },
      check: ([coll, id, p]) => [coll, id, (r) => { p.unset.forEach((k) => { delete r[k]; }); return p.set; }],
    },
    removeRecord: { args: ['str', 'id'] },
    // promote(clipId, coll, (clip) => data?): the function runs in the frame
    // on a copy of the clip; without one the page uses core's fromClip.
    promote: {
      args: ['id', 'str', 'nullable', 'id'],
      fn: 2,
      record: ([clipId, coll, fn], read) => {
        const c = read('clips', clipId);
        if (!c) throw new Error('no clip ' + clipId);
        const data = typeof fn === 'function' ? copy(fn(copy(c))) : null;
        if (data !== null && !isObj(data)) throw new Error('promote(' + clipId + ', ' + coll + ', fn): fn must return an object');
        const recId = keepOrFresh('rec', data && data.id);
        return { args: [clipId, String(coll), data, recId], result: recId };
      },
      check: ([clipId, coll, data, recId], page) => [clipId, coll, (c) => Object.assign({}, data || page.fromClip(c), { id: recId })],
    },
    demote: { args: ['id'] },
  };
  const NAMES = Object.keys(OPS);

  function hasFunction(v, depth) {
    if (typeof v === 'function') return true;
    if (!v || typeof v !== 'object' || depth > 20) return false;
    return Object.keys(v).some((k) => hasFunction(v[k], depth + 1));
  }

  // Frame side: one call of m.<op> as a step of data.
  function record(op, args, read) {
    const spec = OPS[op];
    if (!spec) throw new Error('m.' + op + ' is not available to board apps');
    args.forEach((a, i) => {
      if (i !== spec.fn && hasFunction(a)) throw new Error('m.' + op + ': argument ' + (i + 1) + ' must be data in a board app (functions cannot leave its frame)');
    });
    const r = spec.record ? spec.record(args, read) : { args: copy(args), result: undefined };
    return { step: { op, args: r.args }, result: r.result };
  }

  function shapeError(op, why) { return new Error('a board app sent ' + op + ' with ' + why); }
  function checkShape(op, spec, args) {
    if (!Array.isArray(args)) throw shapeError(op, 'no arguments');
    let i = 0;
    for (const kind of spec.args) {
      if (kind.startsWith('...')) {
        const test = KINDS[kind.slice(3)];
        for (; i < args.length; i++) if (!test(args[i])) throw shapeError(op, 'argument ' + (i + 1) + ' not ' + kind.slice(3));
        return;
      }
      const optional = kind.endsWith('?'), name = optional ? kind.slice(0, -1) : kind;
      const v = args[i];
      if (v === undefined || (optional && v === null)) {
        if (!optional) throw shapeError(op, 'argument ' + (i + 1) + ' missing');
      } else if (!KINDS[name](v)) {
        throw shapeError(op, 'argument ' + (i + 1) + ' not ' + name);
      }
      i++;
    }
    if (args.length > i) throw shapeError(op, (args.length - i) + ' arguments too many');
  }

  // Page side: the arguments core gets for a step, or an error. page has
  // has(store, id) and fromClip(clip).
  function check(op, args, page) {
    const spec = typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
    if (!spec) throw new Error('board apps may not ' + op);
    checkShape(op, spec, args);
    return spec.check ? spec.check(args, page) : args;
  }

  // Frame side: the m an app's c.mutate(m => …) gets. Each call becomes a
  // step; within one transaction, later calls read what earlier ones placed,
  // inserted or updated (read is the frame's copy of the board).
  function recorder(read) {
    const local = { clips: {}, records: {} };
    const view = (store, id) => (local[store] && local[store][id]) || read(store, id);
    const steps = [];
    const m = {};
    NAMES.forEach((op) => {
      m[op] = (...args) => {
        const r = record(op, args, view);
        steps.push(r.step);
        const a = r.step.args;
        if (op === 'place') local.clips[r.result] = Object.assign({}, a[0]);
        if (op === 'insert') local.records[r.result] = Object.assign({}, a[1], { id: r.result, coll: a[0] });
        if (op === 'update') {
          const cur = view('records', a[1]);
          if (cur) { const x = Object.assign({}, cur); a[2].unset.forEach((k) => { delete x[k]; }); local.records[a[1]] = Object.assign(x, a[2].set); }
        }
        return r.result;
      };
    });
    const proxy = new Proxy(m, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k !== 'string') return undefined;
        throw new Error('m.' + k + ' is not available to board apps');
      },
    });
    return { m: proxy, steps };
  }

  return { NAMES, record, check, recorder };
});
