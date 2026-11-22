// agent.ts against a scripted server: open by key (list, then create), the
// page's tool runs when a call names its assignment and its result is
// posted, the answer is every text segment of the run, failures carry the
// run's code, and an abort stops the run (SLOP3-025).
import assert from "node:assert/strict";
import { test } from "node:test";

const PARENT = "https://shell.example";
const parent = { postMessage() {} };
const on: Record<string, (e: unknown) => void> = {};
Object.assign(globalThis, {
  document: { getElementById: () => ({ textContent: JSON.stringify({ mode: "app", parentOrigin: PARENT }) }) },
  window: { parent, addEventListener: (type: string, h: (e: unknown) => void) => (on[type] = h) },
});

type Req = { method: string; url: string; body: any };
const reqs: Req[] = [];
let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
let streamOpened!: () => void;
const opened = new Promise<void>((r) => (streamOpened = r));
const enc = new TextEncoder();
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  reqs.push({ method, url, body });
  if (url.startsWith("/_rt/events")) return new Promise(() => {});
  if (url.endsWith("/events")) {
    const rs = new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } });
    queueMicrotask(streamOpened);
    return new Response(rs, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.startsWith("/_rt/agent/sessions?label=")) return json({ sessions: [] });
  if (url === "/_rt/agent/sessions" && method === "POST") return json({ sessionId: "s1", session: { id: "s1", labels: { key: body.labels.key, app: "bench" } } }, 201);
  if (url.endsWith("/tools/manifest")) return json({ accepted: true, executor: { assignmentId: "a1", connectionId: body.connectionId } });
  if (url.endsWith("/messages")) return json({ sessionId: "s1", accepted: true }, 202);
  if (url.endsWith("/tools/results")) return json({ ok: true });
  if (url.endsWith("/stop")) return json({ sessionId: "s1", accepted: true }, 202);
  return json({ error: "no route " + url, code: "invalid_request" }, 404);
}) as typeof fetch;

const { initPermissions } = await import("../src/caps.ts");
const { agent } = await import("../src/agent.ts");
on.message({ origin: PARENT, source: parent, data: { slop: 1, type: "view", view: "v1", secret: "s1" } });
initPermissions({ permissions: { sample: "granted" } } as any);

let ordinal = 1;
const push = (name: string, payload: unknown) => stream!.enqueue(enc.encode(`id: ${++ordinal}\nevent: ui\ndata: ${JSON.stringify({ sessionId: "s1", ordinal: String(ordinal), name, payload })}\n\n`));
const waitFor = async (pred: () => boolean) => {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(pred(), "condition not reached");
};

const ran: unknown[] = [];
const tools = [{ name: "eval", description: "run code", inputSchema: { type: "object" }, execute: async (input: any) => (ran.push(input), 42) }];
const a = agent();
const s = await a.open("t1", { system: "You are a test.", modelTier: "default", maxRounds: 12, tools });

test("open creates the session with its key and settings when none exists", async () => {
  const create = reqs.find((r) => r.method === "POST" && r.url === "/_rt/agent/sessions")!;
  assert.deepEqual(create.body, { labels: { key: "t1", tier: "default" }, data: { system: "You are a test.", maxRounds: 12 } });
  assert.equal(s.id, "s1");
  assert.equal(s.fresh, true);
  await opened;
  stream!.enqueue(enc.encode(`event: snapshot\ndata: {"sessionId":"s1","snapshotOrdinal":"1","entities":[]}\n\n`));
  await waitFor(() => reqs.some((r) => r.url.endsWith("/tools/manifest")));
  const m = reqs.find((r) => r.url.endsWith("/tools/manifest"))!;
  assert.equal(m.body.tools[0].name, "eval");
  assert.equal(m.body.tools[0].mode, "frontend");
});

test("a message: the page runs its tool, posts the result, and gets the answer of all segments", async () => {
  const texts: string[] = [];
  const answer = s.send("compute", { context: "Files: a.js", onText: ({ text }) => texts.push(text) });
  await waitFor(() => reqs.some((r) => r.url.endsWith("/messages")));
  assert.deepEqual(reqs.find((r) => r.url.endsWith("/messages"))!.body, { prompt: "compute", context: "Files: a.js" });
  push("ChatRunStarted", { messageId: "r1" });
  push("ChatTextSegmentStarted", { messageId: "r1:text:a" });
  push("ChatTextPatch", { messageId: "r1:text:a", mode: "CHAT_STREAM_PATCH_MODE_APPEND", text: "Let me ", offset: "0" });
  push("ChatTextPatch", { messageId: "r1:text:a", mode: "CHAT_STREAM_PATCH_MODE_APPEND", text: "check.", offset: "7" });
  push("ChatFrontendToolCallRequested", { messageId: "r1", toolCallId: "call-elsewhere", toolName: "eval", input: {}, executor: { assignmentId: "other-tab" } });
  push("ChatFrontendToolCallRequested", { messageId: "r1", toolCallId: "call1", toolName: "eval", input: { code: "6*7" }, executor: { assignmentId: "a1" } });
  await waitFor(() => reqs.some((r) => r.url.endsWith("/tools/results")));
  assert.deepEqual(ran, [{ code: "6*7" }], "only the call assigned to this page runs");
  const res = reqs.find((r) => r.url.endsWith("/tools/results"))!.body;
  assert.equal(res.toolCallId, "call1");
  assert.equal(res.status, "success");
  assert.equal(res.result, 42);
  assert.deepEqual(res.executor, { assignmentId: "a1", connectionId: res.executor.connectionId });
  push("ChatTextSegmentFinished", { messageId: "r1:text:b", content: "eval returned: 42" });
  push("ChatRunFinished", { messageId: "r1", status: "finished" });
  const r = await answer;
  assert.equal(r.text, "Let me check.\n\neval returned: 42");
  assert.equal(r.truncated, false);
  assert.equal(texts.at(-1), r.text);
});

test("a failed run rejects with its code and the text so far; a second send waits for none", async () => {
  const answer = s.send("again");
  await waitFor(() => reqs.filter((r) => r.url.endsWith("/messages")).length === 2);
  await assert.rejects(s.send("third"), (e: any) => e.code === "run_active");
  push("ChatRunStarted", { messageId: "r2" });
  push("ChatTextPatch", { messageId: "r2:text:a", mode: "CHAT_STREAM_PATCH_MODE_APPEND", text: "partial", offset: "0" });
  push("ChatRunFailed", { messageId: "r2", code: "quota_exceeded", error: "token budget used up for this month" });
  await assert.rejects(answer, (e: any) => e.code === "quota_exceeded" && e.text === "partial");
});

test("an abort stops the run", async () => {
  const ctrl = new AbortController();
  const answer = s.send("long", { signal: ctrl.signal });
  await waitFor(() => reqs.filter((r) => r.url.endsWith("/messages")).length === 3);
  push("ChatRunStarted", { messageId: "r3" });
  ctrl.abort();
  await waitFor(() => reqs.some((r) => r.url.endsWith("/stop")));
  push("ChatRunStopped", { messageId: "r3" });
  await assert.rejects(answer, (e: any) => e.code === "cancelled");
  s.close();
});
