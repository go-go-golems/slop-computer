// transport.ts's rpc with a scripted fetch: a request that failed in the
// network is sent again; one that is not harmless to run twice carries a
// key, the same on the resend, so the server runs it once (review of
// PR #13; SLOP3-005 S2).
import assert from "node:assert/strict";
import { test } from "node:test";

const PARENT = "https://shell.example";
const parent = { postMessage() {} };
const on: Record<string, (e: unknown) => void> = {};
Object.assign(globalThis, {
  document: { getElementById: () => ({ textContent: JSON.stringify({ mode: "app", parentOrigin: PARENT }) }) },
  window: { parent, addEventListener: (type: string, h: (e: unknown) => void) => (on[type] = h) },
});
const sent: string[] = [];
const keys: (string | undefined)[] = [];
let failNext = 0;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (url.startsWith("/_rt/events")) return new Promise(() => {}); // the stream stays open
  const { method, key } = JSON.parse(String(init?.body));
  sent.push(method);
  keys.push(key);
  if (failNext > 0) {
    failNext--;
    throw new TypeError("network error");
  }
  return new Response(JSON.stringify({ result: method }), { status: 200 });
}) as typeof fetch;

const { rpc } = await import("../src/transport.ts");
on.message({ origin: PARENT, source: parent, data: { slop: 1, type: "view", view: "v1", secret: "s1" } });

test("a read that failed in the network is sent again, without a key", async () => {
  sent.length = keys.length = 0;
  failNext = 1;
  assert.equal(await rpc("db.get", { path: "notes/a" }), "db.get");
  assert.deepEqual(sent, ["db.get", "db.get"]);
  assert.deepEqual(keys, [undefined, undefined]);
});

test("an action that failed in the network is sent again with the same key", async () => {
  sent.length = keys.length = 0;
  failNext = 1;
  assert.equal(await rpc("slop.call", { action: "sign" }), "slop.call");
  assert.deepEqual(sent, ["slop.call", "slop.call"]);
  assert.ok(keys[0] && keys[0] === keys[1], `keys: ${keys}`);
});

test("each call has its own key, and a second network failure gives up", async () => {
  sent.length = keys.length = 0;
  await rpc("db.write", { path: "notes/a", op: "set", body: {} });
  await rpc("db.write", { path: "notes/a", op: "set", body: {} });
  assert.notEqual(keys[0], keys[1]);
  failNext = 2;
  await assert.rejects(rpc("room.emit", { topic: "t" }), (e: any) => e.code === "unavailable");
  assert.deepEqual(sent.slice(2), ["room.emit", "room.emit"]);
});
