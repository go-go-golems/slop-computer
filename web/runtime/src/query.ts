// Query semantics, ported from pkg/rt/query.go: both run the vectors in
// pkg/rt/testdata/query.json.
import { canon, equal, idOf } from "./util.ts";

export type Filter = { field: string; op: string; value: unknown };
export type Query = { coll: string; filters?: Filter[]; order?: string; desc?: boolean; limit?: number };
export type Doc = { path: string; body: Record<string, unknown>; version: number };

const rank = (v: unknown) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);

function compare(a: unknown, b: unknown): number {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
  if (ra === 1) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ra === 2) return a === b ? 0 : a ? 1 : -1;
  const ca = canon(a), cb = canon(b);
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

function matches(v: unknown, f: Filter): boolean {
  switch (f.op) {
    case "==": return equal(v, f.value);
    case "!=": return !equal(v, f.value);
    case "<": case "<=": case ">": case ">=": {
      if (rank(v) !== rank(f.value) || rank(v) === 3) return false;
      const c = compare(v, f.value);
      return f.op === "<" ? c < 0 : f.op === "<=" ? c <= 0 : f.op === ">" ? c > 0 : c >= 0;
    }
    case "in": case "not-in": {
      const found = (f.value as unknown[]).some((x) => equal(v, x));
      return found === (f.op === "in");
    }
    case "array-contains":
      return Array.isArray(v) && v.some((x) => equal(x, f.value));
  }
  return false;
}

export function match(q: Query, body: Record<string, unknown>): boolean {
  return (q.filters ?? []).every((f) => Object.prototype.hasOwnProperty.call(body, f.field) && matches(body[f.field], f));
}

/** Byte-order string comparison, as Go compares strings. */
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sort<T extends { path: string; body: Record<string, unknown> }>(q: Query, docs: T[]): T[] {
  const o = q.order;
  return docs.sort((a, b) => {
    if (o) {
      const ah = Object.prototype.hasOwnProperty.call(a.body, o), bh = Object.prototype.hasOwnProperty.call(b.body, o);
      if (ah !== bh) return ah ? -1 : 1;
      if (ah) {
        const c = compare(a.body[o], b.body[o]);
        if (c !== 0) return q.desc ? -c : c;
      }
    }
    return byId(idOf(a.path), idOf(b.path));
  });
}

export function apply<T extends { path: string; body: Record<string, unknown> }>(q: Query, docs: T[]): T[] {
  const out = sort(q, docs.filter((d) => match(q, d.body)));
  return q.limit && q.limit > 0 ? out.slice(0, q.limit) : out;
}

const ops = new Set(["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains"]);

/** Throws on a query the contract refuses (the caller maps to invalid_argument). */
export function validate(q: Query): string | null {
  if ((q.filters ?? []).length > 10) return "at most 10 filters";
  for (const f of q.filters ?? []) {
    if (typeof f.field !== "string" || !f.field || f.field.includes(".")) return "a filter names one top-level field";
    if (!ops.has(f.op)) return `unknown operator ${f.op}`;
    if ((f.op === "in" || f.op === "not-in") && (!Array.isArray(f.value) || f.value.length === 0 || f.value.length > 30))
      return `${f.op} takes 1-30 values`;
  }
  if (q.order !== undefined && (typeof q.order !== "string" || q.order.includes("."))) return "orderBy names one top-level field";
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 1000)) return "limit is 1-1000";
  return null;
}
