// Static mode (players on the public site): db is read-only and holds the
// documents a saved version of the target carries in db.json; user is a
// viewer with no id; everything else resolves null.
import { apply, validate, type Query } from "./query.ts";
import { checkPath, collOf, fail, freeze, idOf, type Body } from "./util.ts";

const META = Object.freeze({ fromCache: false, hasPendingWrites: false });

export function staticDb(docs: Record<string, Body>) {
  const snap = (path: string) => {
    const b = docs[path] ? freeze(docs[path]) : undefined;
    return Object.freeze({ id: idOf(path), exists: !!b, data: () => b, metadata: META });
  };
  const ro = () => Promise.reject(fail("invalid_argument", "this page is read-only"));
  const query = (coll: string, q: Query): any => ({
    where: (field: string, op: string, value: unknown) => query(coll, { ...q, filters: [...(q.filters ?? []), { field, op, value }] }),
    orderBy: (field: string, dir = "asc") => query(coll, { ...q, order: field, desc: dir === "desc" }),
    limit: (n: number) => query(coll, { ...q, limit: n }),
    async get() {
      const bad = validate(q);
      if (bad) throw fail("invalid_argument", bad);
      const rows = Object.keys(docs).filter((p) => collOf(p) === coll && !p.slice(coll.length + 1).includes("/"))
        .map((p) => ({ path: p, body: docs[p], version: 1 }));
      const out = apply(q, rows).map((r) => snap(r.path));
      return Object.freeze({ docs: Object.freeze(out), size: out.length, empty: !out.length, docChanges: () => [], metadata: META });
    },
    onSnapshot(next: (s: unknown) => void) {
      this.get().then(next);
      return () => {};
    },
  });
  const docRef = (path: string): any => {
    checkPath(path, true);
    return Object.freeze({ id: idOf(path), path, get: async () => snap(path), set: ro, update: ro, delete: ro, acquire: ro,
      onSnapshot(next: (s: unknown) => void) {
        queueMicrotask(() => next(snap(path)));
        return () => {};
      },
      collection: (sub: string) => collRef(path + "/" + sub) });
  };
  const collRef = (path: string): any => {
    checkPath(path, false);
    return Object.freeze({ ...query(path, { coll: path }), path, doc: (id: string) => docRef(path + "/" + id), add: ro });
  };
  return Object.freeze({ doc: docRef, collection: collRef });
}

export const staticUser = Object.freeze({
  isOwner: async () => false,
  canEdit: async () => false,
  can: async () => false,
  me: async () => freeze({ id: null, name: "", avatarUrl: "", color: "hsl(0 0% 55%)", email: null, isOwner: false, canEdit: false }),
  id: async () => null,
  profiles: async () => freeze({}),
});
