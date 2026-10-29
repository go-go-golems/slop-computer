// Shared helpers: contract errors, the path grammar, JSON equality.
import { limits } from "./limits.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Body = Record<string, unknown>;

/** A contract rejection: {code, message} on an Error, so stacks survive. */
export function fail(code: string, message: string, extra?: Record<string, unknown>): Error & { code: string } {
  return Object.assign(new Error(message), { code }, extra ?? {});
}

const segment = /^[A-Za-z0-9_.~:@+-]+$/;
const utf8 = new TextEncoder();
export const bytes = (s: string) => utf8.encode(s).length;

/** Checks a db path; doc says whether it must name a document (even
 *  segments) or a collection (odd). Throws TypeError like the contract. */
export function checkPath(p: unknown, doc: boolean): string {
  if (typeof p !== "string" || p === "") throw new TypeError("a db path is a non-empty string");
  if (bytes(p) > limits.MaxPathBytes) throw new TypeError(`a db path is at most ${limits.MaxPathBytes} bytes`);
  const segs = p.split("/");
  if (segs.length > limits.MaxPathSegments) throw new TypeError(`a db path has at most ${limits.MaxPathSegments} segments`);
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || !segment.test(s)) throw new TypeError(`invalid path segment ${JSON.stringify(s)} in ${p}`);
    if (bytes(s) > limits.MaxSegmentBytes) throw new TypeError(`a path segment is at most ${limits.MaxSegmentBytes} bytes`);
  }
  if ((segs.length % 2 === 0) !== doc) {
    throw new TypeError(`${p} has ${segs.length} segments: a ${doc ? "document" : "collection"} path has an ${doc ? "even" : "odd"} number`);
  }
  return p;
}

export const collOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
export const idOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Canonical JSON (sorted keys), as Go's encoding/json writes maps. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}

export const equal = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);

export function depth(v: unknown): number {
  if (v === null || typeof v !== "object") return 0;
  let d = 0;
  for (const x of Object.values(v as object)) d = Math.max(d, depth(x));
  return d + 1;
}

export const isPlain = (v: unknown): v is Body =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Deep-freeze a JSON value (snapshots are frozen). */
export function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) freeze(x);
  }
  return v;
}

/** A JSON round trip: plain data only, as the wire carries it. */
export function plain(v: unknown): Json {
  return JSON.parse(JSON.stringify(v));
}

export function randomId(n = 20): string {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, (x) => a[x % a.length]).join("");
}
