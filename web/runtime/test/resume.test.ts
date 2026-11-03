// transport.ts's stream resume: another store's changes carry that store's
// key and, on a commit's last document, its rev there; a reconnect sends
// back the newest received, so the server resumes from what arrived, not
// from what it wrote (review of PR #20).
import assert from "node:assert/strict";
import { test } from "node:test";

const PARENT = "https://shell.example";
const parent = { postMessage() {} };
const on: Record<string, (e: unknown) => void> = {};
Object.assign(globalThis, {
  document: { getElementById: () => ({ textContent: JSON.stringify({ mode: "app", parentOrigin: PARENT }) }) },
  window: { parent, addEventListener: (type: string, h: (e: unknown) => void) => (on[type] = h) },
});
const sse = (type: string, d: unknown) => `event: ${type}\ndata: ${JSON.stringify(d)}\n\n`;
const streams: string[] = [];
globalThis.fetch = (async (url: string) => {
  if (!url.startsWith("/_rt/events")) return new Response(JSON.stringify({ result: {} }), { status: 200 });
  streams.push(url);
  if (streams.length > 1) return new Promise(() => {}); // the second stream stays open
  // The first: hello, a remote commit of two documents (the rev on the
  // last), then the start of another whose last document never arrives.
  return new Response(
    sse("hello", { view: "v1", rev: 3 }) +
      sse("doc", { path: "contacts/c1", version: 1, body: { n: 1 }, remote: "1" }) +
      sse("doc", { path: "contacts/c2", version: 1, body: { n: 2 }, remote: "1", remoteRev: 5 }) +
      sse("doc", { path: "contacts/c3", version: 1, body: { n: 3 }, remote: "1" }),
    { status: 200 },
  );
}) as typeof fetch;

await import("../src/transport.ts");
on.message({ origin: PARENT, source: parent, data: { slop: 1, type: "view", view: "v1", secret: "s1" } });

test("a reconnect sends back the newest remote rev received", async () => {
  for (let i = 0; i < 40 && streams.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(streams[0], "/_rt/events");
  assert.equal(streams[1], "/_rt/events?after=3&remote=" + encodeURIComponent("1:5"));
});
