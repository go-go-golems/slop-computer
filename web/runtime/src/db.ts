// The db capability: refs are pure path holders; reads and writes are RPCs;
// subscriptions keep a mirror each, fed by the view's stream, and evaluate
// their query locally (D5). Writes are optimistic (an overlay marks
// hasPendingWrites), one at a time per document, and travel as patches
// when they are small next to the body (D6).
import { applyPatch, diff, patchSize, type Patch } from "./diff.ts";
import { limits } from "./limits.ts";
import { apply as applyQuery, validate, type Filter, type Query } from "./query.ts";
import { connect, on, rpc, seenRev, state } from "./transport.ts";
import { bytes, checkPath, collOf, depth, fail, freeze, idOf, isPlain, plain, randomId, type Body } from "./util.ts";

type Meta = { fromCache: boolean; hasPendingWrites: boolean };
type DocSnap = { id: string; exists: boolean; data(): Body | undefined; metadata: Meta };
type Entry = { path: string; version: number; body: Body; snap?: DocSnap };
type Wire = { path: string; version: number; body?: Body | null; exists?: boolean; patch?: Patch; base?: number; deleted?: boolean; rev?: number };

const META_OK: Meta = Object.freeze({ fromCache: false, hasPendingWrites: false });
const META_PENDING: Meta = Object.freeze({ fromCache: false, hasPendingWrites: true });

function snapOf(path: string, body: Body | undefined, meta: Meta): DocSnap {
  const b = body === undefined ? undefined : freeze(body);
  return Object.freeze({ id: idOf(path), exists: b !== undefined, data: () => b, metadata: meta });
}

// --- known bodies, for diffs upstream ------------------------------------

const known = new Map<string, { version: number; body: Body }>();
function remember(path: string, version: number, body: Body | null) {
  const k = known.get(path);
  if (k && k.version > version) return;
  if (body) known.set(path, { version, body });
  else known.delete(path);
  if (known.size > 2000) known.delete(known.keys().next().value!);
}

// --- pending writes (latency compensation) ------------------------------

const pending = new Map<string, { body: Body | null; n: number }>();
const queues = new Map<string, Promise<unknown>>();

/** Runs fn after the document's earlier writes (one at a time per doc). */
function serial<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  queues.set(path, tail);
  tail.then(() => queues.get(path) === tail && queues.delete(path));
  return next;
}

// --- subscriptions --------------------------------------------------------

type Listener = {
  id: string;
  path: string;
  coll: boolean;
  query: Query;
  mirror: Map<string, Entry>;
  seen: Map<string, number>; // path → newest version, deletions included
  ready: boolean;
  dead: boolean;
  last: DocSnap[] | DocSnap | null;
  next: (s: any) => void;
  error?: (e: unknown) => void;
};

const listeners = new Map<string, Listener>();

function covers(l: Listener, path: string) {
  return l.coll ? collOf(path) === l.path : l.path === path;
}

/** Applies a wire document to a listener's mirror; false when it was old. */
function intoMirror(l: Listener, d: Wire): boolean | "refetch" {
  const seen = l.seen.get(d.path) ?? 0;
  if (d.version <= seen) return false;
  if (d.deleted || d.exists === false || d.body === null) {
    l.seen.set(d.path, d.version);
    return l.mirror.delete(d.path);
  }
  let body = d.body as Body | undefined;
  if (d.patch) {
    const cur = l.mirror.get(d.path);
    if (!cur || cur.version !== d.base) return "refetch";
    try {
      body = applyPatch(cur.body, d.patch) as Body;
    } catch {
      return "refetch";
    }
  }
  if (!body) return false;
  l.seen.set(d.path, d.version);
  l.mirror.set(d.path, { path: d.path, version: d.version, body });
  return true;
}

function deliver(l: Listener) {
  if (l.dead || !l.ready) return;
  if (!l.coll) {
    const p = pending.get(l.path);
    const e = l.mirror.get(l.path);
    let snap: DocSnap;
    if (p) snap = snapOf(l.path, p.body ?? undefined, META_PENDING);
    else if (e) snap = e.snap ??= snapOf(l.path, e.body, META_OK);
    else snap = snapOf(l.path, undefined, META_OK);
    const prev = l.last as DocSnap | null;
    if (prev && prev === snap) return;
    if (prev && !p && !e && !prev.exists && !prev.metadata.hasPendingWrites) return; // still missing
    l.last = snap;
    call(l, snap);
    return;
  }
  // collection: mirror plus pending overlay, then the query
  const rows = new Map<string, { path: string; body: Body; snap: DocSnap }>();
  for (const e of l.mirror.values()) rows.set(e.path, { path: e.path, body: e.body, snap: (e.snap ??= snapOf(e.path, e.body, META_OK)) });
  let pend = false;
  for (const [path, p] of pending) {
    if (collOf(path) !== l.path) continue;
    pend = true;
    if (p.body) rows.set(path, { path, body: p.body, snap: snapOf(path, p.body, META_PENDING) });
    else rows.delete(path);
  }
  const docs = applyQuery(l.query, [...rows.values()]).map((r) => r.snap);
  const prev = (l.last as DocSnap[] | null) ?? null;
  if (prev && prev.length === docs.length && prev.every((d, i) => d === docs[i])) return;
  const changes = docChanges(prev ?? [], docs);
  l.last = docs;
  const meta = pend ? META_PENDING : META_OK;
  call(l, Object.freeze({ docs: Object.freeze(docs), size: docs.length, empty: docs.length === 0, docChanges: () => changes, metadata: meta }));
}

function docChanges(prev: DocSnap[], next: DocSnap[]) {
  const out: unknown[] = [];
  const pi = new Map(prev.map((d, i) => [d.id, i]));
  const ni = new Map(next.map((d, i) => [d.id, i]));
  prev.forEach((d, i) => {
    if (!ni.has(d.id)) out.push(Object.freeze({ type: "removed", doc: d, oldIndex: i, newIndex: -1 }));
  });
  next.forEach((d, i) => {
    const o = pi.get(d.id);
    if (o === undefined) out.push(Object.freeze({ type: "added", doc: d, oldIndex: -1, newIndex: i }));
    else if (prev[o] !== d || o !== i) out.push(Object.freeze({ type: "modified", doc: d, oldIndex: o, newIndex: i }));
  });
  return Object.freeze(out);
}

function call(l: Listener, s: unknown) {
  try {
    l.next(s);
  } catch (e) {
    console.error(e);
  }
}

function kill(l: Listener, code: string, message: string) {
  if (l.dead) return;
  l.dead = true;
  listeners.delete(l.id);
  const e = fail(code, message);
  if (l.error) l.error(e);
  else reportError(e);
}

on("doc", (d: Wire) => {
  if (d.body !== undefined && d.body !== null && !d.patch) remember(d.path, d.version, d.body as Body);
  for (const l of listeners.values()) {
    if (!covers(l, d.path)) continue;
    const r = intoMirror(l, d);
    if (r === "refetch") refetch(l, d.path);
    else if (r) deliver(l);
  }
  const k = known.get(d.path);
  if (d.patch && k && k.version === d.base) {
    try {
      remember(d.path, d.version, applyPatch(k.body, d.patch) as Body);
    } catch {
      known.delete(d.path);
    }
  } else if (d.deleted) known.delete(d.path);
});

async function refetch(l: Listener, path: string) {
  try {
    const d = await rpc<Wire>("db.get", { path });
    if (intoMirror(l, { ...d, deleted: !d.exists }) === true) deliver(l);
  } catch {
    /* the next change brings it */
  }
}

async function register(l: Listener) {
  try {
    const res = await rpc<{ rev: number; doc?: Wire; docs?: Wire[] }>("db.subscribe", {
      sub: l.id,
      path: l.path,
      coll: l.coll,
      query: l.coll ? { coll: l.path, filters: l.query.filters ?? [] } : undefined,
    });
    if (l.dead) {
      rpc("db.unsubscribe", { sub: l.id }).catch(() => {});
      return;
    }
    seenRev(res.rev);
    if (l.coll) {
      // A full initial load replaces the mirror (after a new view too).
      const fresh = new Set((res.docs ?? []).map((d) => d.path));
      for (const p of [...l.mirror.keys()]) if (!fresh.has(p)) l.mirror.delete(p);
      for (const d of res.docs ?? []) {
        intoMirror(l, d);
        remember(d.path, d.version, d.body as Body);
      }
    } else if (res.doc) {
      if (res.doc.exists) {
        intoMirror(l, res.doc);
        remember(res.doc.path, res.doc.version, res.doc.body as Body);
      } else l.mirror.delete(l.path);
    }
    l.ready = true;
    deliver(l);
  } catch (e: any) {
    if (e?.code === "unavailable") {
      setTimeout(() => !l.dead && register(l), 2000);
      return;
    }
    kill(l, e?.code || "unavailable", e?.message || "subscribe failed");
  }
}

// A new view (the old one expired) has no subscriptions: register again.
on("newview", () => {
  for (const l of listeners.values()) {
    l.seen.clear();
    register(l);
  }
});
on("terminal", (code: string) => {
  for (const l of [...listeners.values()]) kill(l, code, "this view was closed");
});

function subscribe(path: string, coll: boolean, query: Query, next: (s: any) => void, error?: (e: unknown) => void): () => void {
  if (typeof next !== "function") throw new TypeError("onSnapshot needs a callback");
  const l: Listener = { id: randomId(12), path, coll, query, mirror: new Map(), seen: new Map(), ready: false, dead: false, last: null, next, error };
  queueMicrotask(() => {
    if (l.dead) return;
    if (state.terminal) return kill(l, state.terminal, "this view was closed");
    if (listeners.size >= limits.MaxSubscriptions) return kill(l, "resource_exhausted", `at most ${limits.MaxSubscriptions} subscriptions per view`);
    if (coll) {
      const bad = validate(query);
      if (bad) return kill(l, "invalid_argument", bad);
    }
    listeners.set(l.id, l);
    register(l);
  });
  return () => {
    if (l.dead) return;
    l.dead = true;
    if (listeners.delete(l.id)) rpc("db.unsubscribe", { sub: l.id }).catch(() => {});
  };
}

function redeliver(path: string) {
  for (const l of listeners.values()) if (covers(l, path)) deliver(l);
}

// --- writes --------------------------------------------------------------

function checkBody(data: unknown): Body {
  if (!isPlain(data)) throw fail("invalid_argument", "a document body is a plain JSON object");
  const body = plain(data) as Body;
  const n = bytes(JSON.stringify(body));
  if (n > limits.MaxDocBytes) throw fail("invalid_argument", `a document is at most ${limits.MaxDocBytes} bytes (this one is ${n})`);
  if (depth(body) > limits.MaxDocDepth) throw fail("invalid_argument", `a document is at most ${limits.MaxDocDepth} levels deep`);
  return body;
}

function merge(cur: Body, patch: Body): Body {
  const out: Body = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(v) && isPlain(cur[k]) ? merge(cur[k] as Body, v) : v;
  }
  return out;
}

/** What a local snapshot shows for path (for update's optimistic merge). */
function localBody(path: string): Body | undefined {
  const p = pending.get(path);
  if (p) return p.body ?? undefined;
  for (const l of listeners.values()) {
    const e = l.mirror.get(path);
    if (e) return e.body;
  }
  return known.get(path)?.body;
}

async function write(path: string, op: "set" | "update" | "delete", body?: Body): Promise<void> {
  if (!(await connect())) throw fail("not_granted", "db is not available in this view");
  const optimistic = op === "delete" ? null : op === "update" ? (localBody(path) ? merge(localBody(path)!, body!) : undefined) : body!;
  const mark = { n: 0 };
  if (optimistic !== undefined) {
    const p = { body: optimistic, n: (pending.get(path)?.n ?? 0) + 1 };
    mark.n = p.n;
    pending.set(path, p);
    redeliver(path);
  }
  try {
    const version = await serial(path, async (): Promise<number> => {
      if (op === "set") {
        const k = known.get(path);
        if (k) {
          const p = diff(k.body, body);
          if (p && patchSize(p) <= JSON.stringify(body).length / 4) {
            try {
              return (await rpc<{ version: number }>("db.write", { path, op: "patch", patch: p, base: k.version })).version;
            } catch (e: any) {
              if (e?.code !== "conflict_base") throw e;
            }
          }
        }
      }
      return (await rpc<{ version: number }>("db.write", { path, op, body })).version;
    });
    // The confirmed state goes into the mirrors now, so dropping the
    // overlay below never shows the old body until the echo arrives.
    if (version > 0 && op !== "update" && optimistic !== undefined) {
      remember(path, version, optimistic);
      const w: Wire = optimistic ? { path, version, body: optimistic } : { path, version, deleted: true };
      for (const l of listeners.values()) if (covers(l, path)) intoMirror(l, w);
    }
  } finally {
    if (pending.get(path)?.n === mark.n) {
      pending.delete(path);
      redeliver(path);
    }
  }
}

// --- refs ------------------------------------------------------------------

function docRef(path: string): any {
  checkPath(path, true);
  return Object.freeze({
    id: idOf(path),
    path,
    async get() {
      if (!(await connect())) throw fail("not_granted", "db is not available in this view");
      const p = pending.get(path);
      if (p) return snapOf(path, p.body ?? undefined, META_PENDING);
      const d = await rpc<Wire>("db.get", { path });
      if (d.exists) remember(path, d.version, d.body as Body);
      return snapOf(path, d.exists ? (d.body as Body) : undefined, META_OK);
    },
    set(data: Record<string, unknown>) {
      try {
        return write(path, "set", checkBody(data));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    update(data: Record<string, unknown>) {
      try {
        return write(path, "update", checkBody(data));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    delete() {
      return write(path, "delete");
    },
    async acquire(o: { holder: string; ttlMs?: number; data?: Record<string, unknown> }) {
      if (!o || typeof o.holder !== "string" || !o.holder) throw fail("invalid_argument", "acquire needs a holder");
      if (!(await connect())) throw fail("not_granted", "db is not available in this view");
      return Object.freeze(await rpc("db.acquire", { path, holder: o.holder, ttlMs: o.ttlMs ?? 0, data: o.data ? checkBody(o.data) : undefined }));
    },
    onSnapshot(next: (s: DocSnap) => void, error?: (e: unknown) => void) {
      return subscribe(path, false, { coll: collOf(path) }, next, error);
    },
    collection(sub: string) {
      return collRef(path + "/" + sub);
    },
  });
}

function query(coll: string, q: Query): any {
  const self = {
    where(field: string, op: string, value: unknown) {
      const filters: Filter[] = [...(q.filters ?? []), { field, op, value: plain(value) }];
      if (filters.length > limits.MaxFilters) throw fail("invalid_argument", `at most ${limits.MaxFilters} filters`);
      return query(coll, { ...q, filters });
    },
    orderBy(field: string, dir: "asc" | "desc" = "asc") {
      if (q.order) throw fail("invalid_argument", "at most one orderBy");
      return query(coll, { ...q, order: field, desc: dir === "desc" });
    },
    limit(n: number) {
      return query(coll, { ...q, limit: n });
    },
    async get() {
      const bad = validate(q);
      if (bad) throw fail("invalid_argument", bad);
      if (!(await connect())) throw fail("not_granted", "db is not available in this view");
      const res = await rpc<{ docs: Wire[] }>("db.query", { coll, filters: q.filters ?? [], order: q.order, desc: q.desc, limit: q.limit ?? 0 });
      const docs = res.docs.map((d) => snapOf(d.path, d.body as Body, META_OK));
      return Object.freeze({ docs: Object.freeze(docs), size: docs.length, empty: docs.length === 0,
        docChanges: () => docChanges([], docs), metadata: META_OK });
    },
    onSnapshot(next: (s: unknown) => void, error?: (e: unknown) => void) {
      return subscribe(coll, true, q, next, error);
    },
  };
  return self;
}

function collRef(path: string): any {
  checkPath(path, false);
  const q = query(path, { coll: path });
  return Object.freeze({
    ...q,
    path,
    doc(id?: string) {
      return docRef(path + "/" + (id ?? randomId(20)));
    },
    async add(data: Record<string, unknown>) {
      const ref = docRef(path + "/" + randomId(20));
      await ref.set(data);
      return ref;
    },
  });
}

export const db = Object.freeze({
  doc: (path: string) => docRef(path),
  collection: (path: string) => collRef(path),
});
