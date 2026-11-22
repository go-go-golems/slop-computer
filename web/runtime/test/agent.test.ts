// agent.ts against a scripted server: open by key (list, then create), the
// page's tool runs when a call names its assignment and its result is
// posted, the answer is every text segment of the run, failures carry the
// run's code, an abort stops the run, and a run that ended while the stream
// was down settles from the next snapshot (SLOP3-025).
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
let streams = 0, runs = 0;
let hold202: Promise<void> | null = null; // when set, the next 202 waits for it
const streamsOf = new Map<string, ReadableStreamDefaultController<Uint8Array>>(); // per session
const lastRun = new Map<string, string>(); // session -> the run id of its last 202
let failResults = 0; // result posts to fail at the network
const sid = (url: string) => url.split("/")[4];
const enc = new TextEncoder();
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  reqs.push({ method, url, body });
  if (url.startsWith("/_rt/events")) return new Promise(() => {});
  if (url.endsWith("/events")) {
    const rs = new ReadableStream<Uint8Array>({ start: (c) => { if (sid(url) === "s1") stream = c; streamsOf.set(sid(url), c); } });
    streams++;
    queueMicrotask(streamOpened);
    return new Response(rs, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.startsWith("/_rt/agent/sessions?label=")) return json({ sessions: [] });
  if (url === "/_rt/agent/sessions" && method === "POST") {
    const id = body.labels.key === "t1" ? "s1" : "s-" + body.labels.key;
    return json({ sessionId: id, session: { id, labels: { key: body.labels.key, app: "bench" } } }, 201);
  }
  if (url.endsWith("/tools/manifest")) return json({ accepted: true, executor: { assignmentId: "a1", connectionId: body.connectionId } });
  if (url.endsWith("/messages")) {
    const id = "r" + ++runs;
    lastRun.set(sid(url), id);
    if (hold202) await hold202;
    return json({ sessionId: "s1", accepted: true, messageId: id }, 202);
  }
  if (url.endsWith("/tools/results")) {
    if (failResults > 0) {
      failResults--;
      throw new TypeError("network error");
    }
    return json({ ok: true });
  }
  if (url.endsWith("/stop")) return json({ sessionId: "s1", accepted: true }, 202);
  return json({ error: "no route " + url, code: "invalid_request" }, 404);
}) as typeof fetch;

const { grantFor, initPermissions } = await import("../src/consent.ts");
const { agent } = await import("../src/agent.ts");
on.message({ origin: PARENT, source: parent, data: { slop: 1, type: "view", view: "v1", secret: "s1" } });
// An app that declares agent without sample: the agent's own consent.
initPermissions({ permissions: { agent: "granted" } } as any);

let ordinal = 1;
const push = (name: string, payload: unknown) => stream!.enqueue(enc.encode(`id: ${++ordinal}\nevent: ui\ndata: ${JSON.stringify({ sessionId: "s1", ordinal: String(ordinal), name, payload })}\n\n`));
const waitFor = async (pred: () => boolean) => {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(pred(), "condition not reached");
};

const ran: unknown[] = [];
const tools = [{ name: "eval", description: "run code", inputSchema: { type: "object" }, execute: async (input: any) => (ran.push(input), 42) }];
const a = agent(grantFor("agent"));
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
});

test("a run that ends while the stream is down settles from the next snapshot", async () => {
  const answer = s.send("while offline");
  await waitFor(() => reqs.filter((r) => r.url.endsWith("/messages")).length === 4);
  push("ChatRunStarted", { messageId: "r4" });
  const before = streams;
  stream!.close(); // the connection drops; the run finishes meanwhile
  await waitFor(() => streams > before);
  const ent = (kind: string, id: string, ord: number, payload: unknown) => ({ kind, id, createdOrdinal: String(ord), payload });
  const entities = [
    ent("ChatRun", "r4", 20, { messageId: "r4", status: "finished", truncated: true, reason: "max_rounds" }),
    ent("ChatMessage", "r4:text:a", 21, { role: "assistant", text: "first part", parentMessageId: "r4" }),
    ent("ChatMessage", "r4:text:b", 23, { role: "assistant", text: "second part", parentMessageId: "r4" }),
    ent("ChatMessage", "r3:text:a", 15, { role: "assistant", text: "another run", parentMessageId: "r3" }),
  ];
  stream!.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify({ sessionId: "s1", snapshotOrdinal: "30", entities })}\n\n`));
  const r = await answer;
  assert.equal(r.text, "first part\n\nsecond part");
  assert.equal(r.truncated, true);
});

test("a run whose events all arrive before its 202 settles when the 202 names it", async () => {
  let release!: () => void;
  hold202 = new Promise((r) => (release = r));
  const answer = s.send("fast run");
  await waitFor(() => reqs.filter((r) => r.url.endsWith("/messages")).length === 5);
  push("ChatRunStarted", { messageId: "r5" });
  push("ChatTextSegmentFinished", { messageId: "r5:text:a", content: "done before you knew" });
  push("ChatRunFinished", { messageId: "r5", status: "finished" });
  await new Promise((r) => setTimeout(r, 20));
  hold202 = null;
  release();
  const r = await answer;
  assert.equal(r.text, "done before you knew");
});

test("a tool call requested while the stream was down runs from the next snapshot, once", async () => {
  ran.length = 0;
  const answer = s.send("tool while offline");
  await waitFor(() => reqs.filter((r) => r.url.endsWith("/messages")).length === 6);
  const before = streams;
  stream!.close();
  await waitFor(() => streams > before);
  const results = () => reqs.filter((r) => r.url.endsWith("/tools/results") && r.body.toolCallId === "call6").length;
  const call = { kind: "ChatFrontendToolCall", id: "call6", createdOrdinal: "40", payload: { toolCallId: "call6", toolName: "eval", input: { code: "1+1" }, status: "requested", executor: { assignmentId: "a1" } } };
  const other = { kind: "ChatFrontendToolCall", id: "call7", createdOrdinal: "41", payload: { toolCallId: "call7", toolName: "eval", input: {}, status: "requested", executor: { assignmentId: "other-tab" } } };
  stream!.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify({ sessionId: "s1", snapshotOrdinal: "41", entities: [{ kind: "ChatRun", id: "r6", createdOrdinal: "39", payload: { status: "running" } }, call, other] })}\n\n`));
  await waitFor(() => results() === 1);
  assert.deepEqual(ran, [{ code: "1+1" }], "only the call assigned to this page");
  push("ChatTextPatch", { messageId: "r6:text:a", mode: "CHAT_STREAM_PATCH_MODE_APPEND", text: "eval returned: 42", offset: "0" });
  push("ChatRunFinished", { messageId: "r6", status: "finished" });
  assert.equal((await answer).text, "eval returned: 42");
  assert.equal(results(), 1, "a call runs once, however many times the copy changes");
  s.close();
});

// --- the run's lifecycle (design 02, change 5) and the outbox (change 6) ---

const to = (id: string, name: string, payload: unknown) =>
  streamsOf.get(id)!.enqueue(enc.encode(`id: ${++ordinal}\nevent: ui\ndata: ${JSON.stringify({ sessionId: id, ordinal: String(ordinal), name, payload })}\n\n`));
const snapshotTo = (id: string, entities: unknown[]) =>
  streamsOf.get(id)!.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify({ sessionId: id, snapshotOrdinal: String(++ordinal), entities })}\n\n`));
const posted = (id: string, path: string) => reqs.filter((r) => r.url === `/_rt/agent/sessions/${id}${path}`);

const s3 = await a.open("t3", { tools });
await waitFor(() => streamsOf.has("s-t3"));
snapshotTo("s-t3", []);

test("two sends without awaiting: the second is refused at once, the first is answered", async () => {
  const first = s3.send("one");
  await assert.rejects(s3.send("two"), (e: any) => e.code === "run_active");
  await waitFor(() => posted("s-t3", "/messages").length === 1);
  await waitFor(() => lastRun.has("s-t3"));
  const run = lastRun.get("s-t3")!;
  to("s-t3", "ChatRunStarted", { messageId: run });
  to("s-t3", "ChatTextSegmentFinished", { messageId: run + ":text:a", content: "answer one" });
  to("s-t3", "ChatRunFinished", { messageId: run });
  assert.equal((await first).text, "answer one");
});

test("an abort before the session is ready posts nothing", async () => {
  const s4 = await a.open("t4", { tools });
  const ctrl = new AbortController();
  const answer = s4.send("never sent", { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(answer, (e: any) => e.code === "cancelled");
  await waitFor(() => streamsOf.has("s-t4"));
  snapshotTo("s-t4", []);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posted("s-t4", "/messages").length, 0);
  s4.close();
});

test("an abort while the 202 is pending rejects the send and stops the run it names", async () => {
  let release!: () => void;
  hold202 = new Promise((r) => (release = r));
  const ctrl = new AbortController();
  const answer = s3.send("abort me while posting", { signal: ctrl.signal });
  await waitFor(() => posted("s-t3", "/messages").length === 2);
  ctrl.abort();
  hold202 = null;
  release();
  await assert.rejects(answer, (e: any) => e.code === "cancelled");
  await waitFor(() => posted("s-t3", "/stop").length === 1);
  const run = lastRun.get("s-t3")!;
  to("s-t3", "ChatRunStarted", { messageId: run });
  to("s-t3", "ChatRunStopped", { messageId: run });
});

test("a tool result lost at the network is delivered again after a reconnect, without running the tool again", { todo: "design 02, change 6: the outbox" }, async () => {
  ran.length = 0;
  failResults = 1;
  const answer = s3.send("tool, then a flaky network");
  await waitFor(() => posted("s-t3", "/messages").length === 3);
  await waitFor(() => lastRun.get("s-t3") !== undefined && posted("s-t3", "/messages").length === 3);
  const run = lastRun.get("s-t3")!;
  const call = { toolCallId: "call9", toolName: "eval", input: { code: "2+2" }, executor: { assignmentId: "a1" }, messageId: run };
  to("s-t3", "ChatRunStarted", { messageId: run });
  to("s-t3", "ChatFrontendToolCallRequested", call);
  const results = () => posted("s-t3", "/tools/results").filter((r) => r.body.toolCallId === "call9");
  await waitFor(() => results().length === 1); // failed at the network
  streamsOf.get("s-t3")!.close(); // the connection drops; the server still waits for the result
  await waitFor(() => streamsOf.get("s-t3") !== undefined && results().length === 1);
  await new Promise((r) => setTimeout(r, 300)); // the reconnect
  snapshotTo("s-t3", [
    { kind: "ChatRun", id: run, createdOrdinal: "1", payload: { status: "running" } },
    { kind: "ChatFrontendToolCall", id: "call9", createdOrdinal: "2", payload: { ...call, status: "requested" } },
  ]);
  await waitFor(() => results().length === 2);
  assert.deepEqual(ran, [{ code: "2+2" }], "the tool ran once");
  assert.equal(results()[1].body.result, 42);
  to("s-t3", "ChatFrontendToolResultReceived", { toolCallId: "call9", status: "success" });
  to("s-t3", "ChatTextSegmentFinished", { messageId: run + ":text:a", content: "eval returned: 42" });
  to("s-t3", "ChatRunFinished", { messageId: run });
  assert.equal((await answer).text, "eval returned: 42");
  assert.equal(results().length, 2, "a received result is not sent again");
  s3.close();
});
