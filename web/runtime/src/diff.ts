// Structural JSON patches, the same algorithm as pkg/rt/diff.go (shared
// vectors in pkg/rt/testdata/diff.json). Pages never see them.
import { equal } from "./util.ts";

export type Patch =
  | { t: "set"; v?: unknown }
  | { t: "del" }
  | { t: "obj"; k: Record<string, Patch> }
  | { t: "arr"; s?: number; d?: number; i?: unknown[] };

export function diff(a: unknown, b: unknown): Patch | null {
  if (equal(a, b)) return null;
  const ao = a !== null && typeof a === "object", bo = b !== null && typeof b === "object";
  if (ao && bo && !Array.isArray(a) && !Array.isArray(b)) {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    const k: Record<string, Patch> = {};
    for (const key of Object.keys(x)) {
      if (!(key in y)) k[key] = { t: "del" };
      else {
        const d = diff(x[key], y[key]);
        if (d) k[key] = d;
      }
    }
    for (const key of Object.keys(y)) if (!(key in x)) k[key] = { t: "set", v: y[key] };
    return { t: "obj", k };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    let pre = 0;
    while (pre < a.length && pre < b.length && equal(a[pre], b[pre])) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && equal(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
    return { t: "arr", s: pre, d: a.length - pre - suf, i: b.slice(pre, b.length - suf) };
  }
  return { t: "set", v: b };
}

export function applyPatch(a: unknown, p: Patch): unknown {
  switch (p.t) {
    case "set":
      return p.v === undefined ? null : p.v;
    case "obj": {
      if (a === null || typeof a !== "object" || Array.isArray(a)) throw new Error("patch does not apply");
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [key, sub] of Object.entries(p.k ?? {})) {
        if (sub.t === "del") delete out[key];
        else out[key] = applyPatch((a as Record<string, unknown>)[key], sub);
      }
      return out;
    }
    case "arr": {
      const s = p.s ?? 0, d = p.d ?? 0;
      if (!Array.isArray(a) || s + d > a.length) throw new Error("patch does not apply");
      return [...a.slice(0, s), ...(p.i ?? []), ...a.slice(s + d)];
    }
  }
  throw new Error("patch does not apply");
}

export const patchSize = (p: Patch) => JSON.stringify(p).length;
