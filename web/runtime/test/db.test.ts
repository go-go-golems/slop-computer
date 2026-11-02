// db.ts against a scripted transport: a subscription's snapshot and the
// stream's events, in the orders that lost updates (review of PR #13).
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const handlers = new Map<string, ((d: any) => void)[]>();
const cursor: number[] = []; // what moved the stream's resume cursor
let answer: (res: unknown) => void = () => {};
mock.module("../src/transport.ts", {
  namedExports: {
    connect: async () => ({}),
    on: (type: string, h: (d: any) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), h]);
      return () => {};
    },
    rpc: (method: string) => (method === "db.subscribe" ? new Promise((r) => (answer = r)) : Promise.resolve({})),
    seenRev: (rev: number) => cursor.push(rev),
    state: { terminal: "" },
  },
});
const { db } = await import("../src/db.ts");
const emit = (type: string, d: unknown) => (handlers.get(type) ?? []).forEach((h) => h(d));
const settle = () => new Promise((r) => setTimeout(r, 0));

test("a creation streamed while the snapshot was out survives it", async () => {
  const seen: string[][] = [];
  const stop = db.collection("notes").onSnapshot((s: any) => seen.push(s.docs.map((d: any) => d.id)));
  await settle(); // db.subscribe is out
  emit("doc", { path: "notes/n1", version: 1, body: { text: "new" }, rev: 5 });
  answer({ rev: 4, docs: [] }); // read before n1 was created
  await settle();
  assert.deepEqual(seen.at(-1), ["n1"]);
  stop();
});

test("a subscription's snapshot does not move the stream's cursor", async () => {
  const stop = db.collection("other").onSnapshot(() => {});
  await settle();
  answer({ rev: 9, docs: [{ path: "other/o1", version: 3, body: { x: 1 } }] });
  await settle();
  assert.deepEqual(cursor, []);
  stop();
});
