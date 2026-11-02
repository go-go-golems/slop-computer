// transport.ts's rpc with a scripted fetch: a request that failed in the
// network is sent again only when doing it twice is harmless (review of
// PR #13).
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
let failNext = 0;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (url.startsWith("/_rt/events")) return new Promise(() => {}); // the stream stays open
  const { method } = JSON.parse(String(init?.body));
  sent.push(method);
  if (failNext > 0) {
    failNext--;
    throw new TypeError("network error");
  }
  return new Response(JSON.stringify({ result: method }), { status: 200 });
}) as typeof fetch;

const { rpc } = await import("../src/transport.ts");
on.message({ origin: PARENT, source: parent, data: { slop: 1, type: "view", view: "v1", secret: "s1" } });

test("a read that failed in the network is sent again", async () => {
  sent.length = 0;
  failNext = 1;
  assert.equal(await rpc("db.get", { path: "notes/a" }), "db.get");
  assert.deepEqual(sent, ["db.get", "db.get"]);
});

test("an action that failed in the network is not sent twice", async () => {
  sent.length = 0;
  failNext = 1;
  await assert.rejects(rpc("slop.call", { action: "sign" }), (e: any) => e.code === "unavailable");
  assert.deepEqual(sent, ["slop.call"]);
});
