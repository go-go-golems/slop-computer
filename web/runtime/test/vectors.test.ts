// The runtime's query and diff run the same vectors as pkg/rt (Go).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyPatch, diff, patchSize } from "../src/diff.ts";
import { apply, validate, type Query } from "../src/query.ts";
import { canon, idOf } from "../src/util.ts";

const data = (name: string) => JSON.parse(readFileSync(new URL("../../../pkg/rt/testdata/" + name, import.meta.url), "utf8"));

test("query vectors", () => {
  const v = data("query.json");
  for (const c of v.cases) {
    const q: Query = { ...c.query, coll: "tasks" };
    assert.equal(validate(q), null, c.name);
    const got = apply(q, v.docs.map((d: any) => ({ ...d }))).map((d: any) => idOf(d.path));
    assert.deepEqual(got, c.want ?? [], c.name);
  }
});

test("diff vectors", () => {
  for (const [i, p] of data("diff.json").entries()) {
    const patch = diff(p.A, p.B);
    if (!patch) {
      assert.equal(canon(p.A), canon(p.B), "pair " + i);
      continue;
    }
    const wire = JSON.parse(JSON.stringify(patch));
    assert.equal(canon(applyPatch(p.A, wire)), canon(p.B), "pair " + i);
  }
});

test("diff property and append size", () => {
  let seed = 1;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const gen = (d: number): unknown => {
    const k = rnd(7);
    if (k === 0 || d > 3) return rnd(5);
    if (k === 1) return ["a", "b", "c"][rnd(3)];
    if (k === 2) return rnd(2) === 0;
    if (k === 3) return null;
    if (k === 4) return Array.from({ length: rnd(5) }, () => gen(d + 1));
    const o: Record<string, unknown> = {};
    for (let i = rnd(4); i > 0; i--) o["abcd"[rnd(4)]] = gen(d + 1);
    return o;
  };
  for (let i = 0; i < 3000; i++) {
    const a = gen(0), b = gen(0);
    const p = diff(a, b);
    if (p) assert.equal(canon(applyPatch(a, JSON.parse(JSON.stringify(p)))), canon(b));
    else assert.equal(canon(a), canon(b));
  }
  const ops = Array.from({ length: 500 }, (_, i) => ["o" + i, "u1:you", i, "x".repeat(80), 1]);
  const p = diff({ ops: ops.slice(0, 499), n: 499 }, { ops, n: 500 })!;
  assert.ok(patchSize(p) <= 200, "append patch " + patchSize(p));
});
