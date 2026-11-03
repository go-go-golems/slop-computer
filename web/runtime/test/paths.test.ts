// Path checks: the page's own paths keep the contract's limits; another
// store's documents under _stores/<id>/ keep theirs, two segments further in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPath } from "../src/util.ts";

const deep = Array.from({ length: 8 }, (_, i) => `a/${i}`).join("/"); // 16 segments, a document

test("own paths: at most 16 segments", () => {
  assert.equal(checkPath(deep, true), deep);
  assert.throws(() => checkPath(deep + "/x/y", true), /at most 16 segments/);
});

test("_stores paths: a store's 16 segments, two further in", () => {
  assert.equal(checkPath("_stores/crm/" + deep, true), "_stores/crm/" + deep);
  assert.throws(() => checkPath("_stores/crm/" + deep + "/x/y", true), /at most 18 segments/);
  assert.equal(checkPath("_stores", false), "_stores");
  assert.equal(checkPath("_stores/crm", true), "_stores/crm");
});

test("parity still decides documents and collections", () => {
  assert.throws(() => checkPath("_stores/crm/contacts", true), /odd number|even number/);
});
