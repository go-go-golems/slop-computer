// The agent capability (slop's extension, SLOP3-025): agent sessions that
// live on the server. A page opens a session by its own key, sends one
// message at a time and gets the answer; the server keeps the conversation
// (append-only, so the provider's prompt cache holds) and runs the tool
// loop; the page runs the tools it registered when the model calls them.
// Spending is the sample capability's (the sample policy, the person's LLM
// budget, held before every model round); the consent asked is agent's own,
// since a page may declare agent without sample.
//
// A run is known only by the id the server's 202 gives it. The session keeps
// a local copy of its timeline (snapshots replace it, events update it) and
// a send settles from the copy's ChatRun entity: one path for live events
// and for reconnects (SLOP3-025 design 02).
import type { Grant } from "./consent.ts";
import { request, rpc } from "./transport.ts";
import { fail, freeze } from "./util.ts";

const BASE = "/_rt/agent";
const CLIENT = "page-" + Math.random().toString(36).slice(2, 10);

type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** "human": a person approves each call (the page asks); the server waits longer. */
  mode?: "frontend" | "human";
  execute: (input: Record<string, unknown>, ctx: { signal: AbortSignal; callId: string }) => unknown;
};
type OpenOptions = {
  title?: string;
  /** The system prompt, fixed for the session's life (the prompt prefix stays the same). */
  system?: string;
  modelTier?: "default" | "complex" | "quick";
  model?: string;
  effort?: "low" | "medium" | "high";
  maxRounds?: number;
  /** Milliseconds one tool call may run. */
  toolTimeout?: number;
  maxTokens?: number;
  tools?: Tool[];
};
type SendOptions = {
  /** Appended after the message and kept in the conversation: send what changed. */
  context?: string;
  onText?: (u: { text: string; delta: string }) => void;
  signal?: AbortSignal;
};
type Result = { text: string; truncated: boolean };
type UIEvent = { name: string; payload: any; ordinal?: string };

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const r = await request(BASE + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data: any = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = null;
  }
  if (!r.ok) {
    // The service answers {error, code}; the door's checks {error: {code, message}}.
    const e = data?.error;
    const code = (typeof e === "object" && e ? e.code : data?.code) || (r.status === 409 ? "run_active" : "upstream_error");
    throw fail(code, (typeof e === "object" && e ? e.message : e) || "HTTP " + r.status, { status: r.status });
  }
  return data;
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// A send's run. send() claims the session's slot with it before anything
// else (no await comes first), and the run owns its lifecycle: stage says
// how far it got, and an abort is handled at any stage (#abort).
type Run = {
  id: string; // the 202's messageId; "" until it arrives
  stage: "preparing" | "posting" | "running";
  aborted: boolean;
  settled: boolean;
  cancelled: Promise<void>; // resolves on abort: the preparation's waits race it
  cancel: () => void; // resolves cancelled
  text: string;
  onText?: SendOptions["onText"];
  tools: AbortController;
  resolve: (r: Result) => void;
  reject: (e: unknown) => void;
};

// One timeline entity of the local copy; seq orders entities by creation.
type Entity = { kind: string; id: string; seq: number; payload: any };

const terminal = new Set(["finished", "failed", "stopped"]);

// A text segment's id is "<run id>:text:<segment>" (chatapp).
const parentOf = (segmentId: string) => {
  const i = segmentId.lastIndexOf(":text:");
  return i > 0 ? segmentId.slice(0, i) : "";
};

class Session {
  readonly id: string;
  readonly key: string;
  /** True when open() created the session: the server has no conversation yet. */
  readonly fresh: boolean;
  info: any;
  /** Whether a run of this session is running (from the timeline). */
  running = false;
  readonly #grant: Grant;
  #tools: Tool[];
  #connection = "c-" + Math.random().toString(36).slice(2, 10);
  #executor: any = null;
  #stream: AbortController | null = null;
  #ready: Promise<void>;
  #onReady!: () => void;
  #closed = false;
  #run: Run | null = null;
  #ran = new Set<string>(); // tool calls this page has run
  // Results the server does not have yet, by call id. A tool runs once; its
  // result stays here until the server accepts it, refuses it for good
  // (4xx), or no longer waits for the call (design 02, change 6).
  #outbox = new Map<string, { toolName: string; status: string; result: unknown; error: string; sending: boolean; tries: number; next: number }>();
  #listeners = new Set<(e: UIEvent) => void>();
  // The local copy of the session's timeline: a snapshot replaces it, every
  // UI event updates it (#apply), and everything a caller waits for is
  // derived from it (#derive). Live events and a reconnect's snapshot take
  // the same path, so there is no recovery logic of its own to get wrong.
  #entities = new Map<string, Entity>();
  #seq = 0;

  constructor(info: any, tools: Tool[], fresh: boolean, grant: Grant) {
    this.#grant = grant;
    this.id = info.id;
    this.fresh = fresh;
    this.key = info.labels?.key ?? "";
    this.info = info;
    this.#tools = tools;
    this.#ready = new Promise((r) => (this.#onReady = r));
    void this.#connect();
  }

  /** Calls fn with every UI event of the session (chatapp's names); returns an unsubscribe. */
  on(fn: (e: UIEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Sends a message and resolves with the answer when the run ends. */
  send(prompt: string, o: SendOptions = {}): Promise<Result> {
    if (typeof prompt !== "string" || !prompt.trim()) return Promise.reject(fail("invalid_request", "the message is empty"));
    if (this.#closed) return Promise.reject(fail("cancelled", "the session is closed"));
    if (this.#run) return Promise.reject(fail("run_active", "an answer is still running in this session"));
    if (o.signal?.aborted) return Promise.reject(fail("cancelled", "the call was aborted"));
    // Claim the slot now, synchronously: a second send sees it at once.
    let resolve!: (r: Result) => void, reject!: (e: unknown) => void, onCancel!: () => void;
    const promise = new Promise<Result>((a, b) => ((resolve = a), (reject = b)));
    const run: Run = {
      id: "", stage: "preparing", aborted: false, settled: false, cancelled: new Promise((r) => (onCancel = r)), cancel: () => onCancel(),
      text: "", onText: o.onText, tools: new AbortController(), resolve, reject,
    };
    const onAbort = () => this.#abort(run);
    const settle = () => {
      run.settled = true;
      o.signal?.removeEventListener("abort", onAbort);
      run.tools.abort();
      if (this.#run === run) this.#run = null; // only its own run frees the slot
    };
    run.resolve = (r) => { if (!run.settled) { settle(); resolve(r); } };
    run.reject = (e) => { if (!run.settled) { settle(); reject(e); } };
    run.cancelled.then(() => run.stage === "preparing" && run.reject(fail("cancelled", "the call was aborted")));
    this.#run = run;
    o.signal?.addEventListener("abort", onAbort, { once: true });
    void this.#start(run, prompt, o.context);
    return promise;
  }

  // Preparation, then the POST. After every await: still this run's turn,
  // and not aborted? An aborted preparation posts nothing.
  async #start(run: Run, prompt: string, context?: string) {
    const live = () => !run.settled && !run.aborted;
    try {
      await this.#grant.consent();
      if (!live()) return;
      await Promise.race([this.#ready, run.cancelled]);
      if (!live()) return;
      if (this.#tools.length) await this.#register(); // the tab that sends runs the tools
      if (!live()) return;
      run.stage = "posting";
      const a = await api("POST", `/sessions/${this.id}/messages`, clean({ prompt, context }));
      if (!a?.messageId) throw fail("upstream_error", "the server did not name the run");
      run.id = a.messageId; // the only way a send learns its run
      run.stage = "running";
      if (run.aborted) {
        // aborted while posting: the message was sent, so stop its run
        run.reject(fail("cancelled", "the call was aborted"));
        void this.stop();
        return;
      }
      this.#derive(); // its events may have arrived before the 202
    } catch (e) {
      run.reject(e);
    }
  }

  // An abort, at whatever stage the run is: preparing → nothing was posted,
  // the send rejects now; posting → #start stops the run once the 202 names
  // it; running → stop, and the run's ChatRun entity settles it.
  #abort(run: Run) {
    if (run.settled || run.aborted) return;
    run.aborted = true;
    run.cancel();
    if (run.stage === "running") void this.stop();
  }

  async stop(): Promise<void> {
    await api("POST", `/sessions/${this.id}/stop`).catch(() => {});
  }

  /** The conversation so far: [{role, text}] (user, assistant, thinking, error). */
  async history(): Promise<{ role: string; text: string }[]> {
    const v = await api("GET", `/sessions/${this.id}`);
    this.info = v.session;
    const out: { role: string; text: string }[] = [];
    for (const e of v.snapshot?.entities ?? []) {
      if (e.kind === "ChatMessage" && e.payload && !e.tombstone) out.push({ role: e.payload.role, text: e.payload.text ?? e.payload.content ?? "" });
    }
    return freeze(out);
  }

  async delete(): Promise<void> {
    this.close();
    await api("DELETE", `/sessions/${this.id}`);
  }

  /** Ends the event stream; a run in progress keeps going on the server. */
  close() {
    this.#closed = true;
    this.#stream?.abort();
    this.#run?.reject(fail("cancelled", "the session was closed"));
  }

  async #register() {
    const ack = await api("POST", `/sessions/${this.id}/tools/manifest`, {
      clientInstanceId: CLIENT,
      connectionId: this.#connection,
      revision: Date.now(),
      tools: this.#tools.map((t) => ({
        name: t.name, description: String(t.description ?? ""), mode: t.mode ?? "frontend",
        inputSchema: t.inputSchema ?? { type: "object" }, available: true,
      })),
    });
    this.#executor = ack.executor;
  }

  async #connect() {
    for (let attempt = 0; !this.#closed; attempt++) {
      const ctrl = new AbortController();
      this.#stream = ctrl;
      try {
        const r = await request(`${BASE}/sessions/${this.id}/events`, { signal: ctrl.signal });
        if (!r.ok || !r.body) {
          if (r.status === 403 || r.status === 404) {
            this.#closed = true;
            this.#run?.reject(fail(r.status === 404 ? "session_not_found" : "not_granted", "the session's events are not available"));
            return;
          }
          throw new Error("HTTP " + r.status);
        }
        attempt = 0;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const x = await reader.read();
          if (x.done) break;
          buf += dec.decode(x.value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let type = "", data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) type = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!data) continue;
            const ev = JSON.parse(data);
            if (type === "snapshot") await this.#snapshot(ev);
            else if (type === "ui") this.#event(ev);
          }
        }
      } catch {
        if (this.#closed) return;
      }
      // A new stream starts with a new snapshot: nothing is lost in between.
      await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** attempt)));
    }
  }

  // A snapshot replaces the local copy.
  async #snapshot(snap: any) {
    this.#entities.clear();
    const list = [...(snap.entities ?? [])].sort((a, b) => Number(a.createdOrdinal ?? 0) - Number(b.createdOrdinal ?? 0));
    for (const e of list) if (!e.tombstone) this.#put(e.kind, e.id, e.payload ?? {});
    if (this.#tools.length) await this.#register().catch(() => {});
    for (const r of this.#outbox.values()) r.next = 0; // the connection is back: deliver now
    this.#onReady();
    this.#derive();
  }

  #event(ev: UIEvent) {
    for (const fn of [...this.#listeners]) {
      try {
        fn(ev);
      } catch (e) {
        console.error(e);
      }
    }
    this.#apply(ev.name, ev.payload ?? {});
    this.#derive();
  }

  #put(kind: string, id: string, payload: any) {
    const k = kind + "/" + id;
    const cur = this.#entities.get(k);
    this.#entities.set(k, { kind, id, seq: cur ? cur.seq : ++this.#seq, payload });
  }

  #get(kind: string, id: string): any {
    return this.#entities.get(kind + "/" + id)?.payload;
  }

  // An event's change to the local copy, as chatapp projects it for the
  // kinds this client reads (ChatRun, assistant ChatMessage segments,
  // ChatFrontendToolCall).
  #apply(name: string, p: any) {
    const id = String(p.messageId ?? "");
    switch (name) {
      case "ChatRunStarted":
        this.#put("ChatRun", id, { ...this.#get("ChatRun", id), messageId: id, status: "running" });
        return;
      case "ChatRunFinished":
        this.#put("ChatRun", id, { ...this.#get("ChatRun", id), messageId: id, status: "finished", truncated: !!p.truncated, reason: p.reason ?? "" });
        return;
      case "ChatRunFailed":
        this.#put("ChatRun", id, { ...this.#get("ChatRun", id), messageId: id, status: "failed", code: p.code ?? "", error: p.error ?? "" });
        return;
      case "ChatRunStopped":
        this.#put("ChatRun", id, { ...this.#get("ChatRun", id), messageId: id, status: "stopped" });
        return;
      case "ChatTextSegmentStarted":
      case "ChatTextPatch":
      case "ChatTextSegmentFinished": {
        const cur = this.#get("ChatMessage", id);
        let text: string = cur?.text ?? "";
        if (name === "ChatTextSegmentFinished") text = p.content ?? p.text ?? text;
        else if (name === "ChatTextPatch") {
          if (p.mode === "CHAT_STREAM_PATCH_MODE_APPEND") text = text.slice(0, p.offset !== undefined ? Number(p.offset) : text.length) + (p.text ?? "");
          else if (p.text !== undefined) text = p.text;
        }
        this.#put("ChatMessage", id, { ...cur, messageId: id, role: p.role || "assistant", text, parentMessageId: parentOf(id) });
        return;
      }
      case "ChatFrontendToolCallRequested":
        if (p.toolCallId) this.#put("ChatFrontendToolCall", p.toolCallId, { ...p, status: "requested" });
        return;
      case "ChatFrontendToolResultReceived":
        if (p.toolCallId) this.#put("ChatFrontendToolCall", p.toolCallId, { ...this.#get("ChatFrontendToolCall", p.toolCallId), status: p.status || "success" });
    }
  }

  // What callers wait for, from the local copy: whether a run is running,
  // the pending send's text and outcome, and the tool calls to run here.
  #derive() {
    const ents = [...this.#entities.values()];
    this.running = ents.some((e) => e.kind === "ChatRun" && e.payload?.status === "running");
    const run = this.#run;
    if (run && run.id) {
      const text = ents
        .filter((e) => e.kind === "ChatMessage" && e.payload?.role === "assistant" && e.payload?.parentMessageId === run.id)
        .sort((a, b) => a.seq - b.seq)
        .map((e) => String(e.payload.text ?? ""))
        .filter((t) => t !== "")
        .join("\n\n");
      if (text !== run.text) {
        const before = run.text;
        run.text = text;
        run.onText?.({ text, delta: text.startsWith(before) ? text.slice(before.length) : "" });
      }
      const state = this.#get("ChatRun", run.id);
      if (state && terminal.has(state.status)) {
        const extra = run.text ? { text: run.text } : undefined;
        if (state.status === "finished") run.resolve(freeze({ text: run.text, truncated: !!state.truncated }));
        else if (state.status === "stopped") run.reject(fail("cancelled", "the answer was stopped", extra));
        else run.reject(fail(state.code || "upstream_error", state.error || "the run failed", extra));
      }
    }
    for (const e of ents) {
      if (e.kind !== "ChatFrontendToolCall") continue;
      const id = e.id;
      if (e.payload?.status === "requested") {
        if (this.#outbox.has(id)) this.#deliver(id); // still waited for: deliver again
        else void this.#call(e.payload);
      } else {
        this.#outbox.delete(id); // the server has it, or gave up on the call
      }
    }
  }

  async #call(p: any) {
    const id = p.toolCallId;
    if (!id || this.#ran.has(id) || !this.#executor || p.executor?.assignmentId !== this.#executor.assignmentId) return;
    this.#ran.add(id);
    const tool = this.#tools.find((t) => t.name === p.toolName);
    const signal = this.#run?.tools.signal ?? new AbortController().signal;
    let status = "success", result: unknown = null, error = "";
    try {
      if (!tool) throw new Error("this page has no tool " + p.toolName);
      result = await tool.execute(p.input ?? {}, { signal, callId: id });
      if (result === undefined) result = null;
      if (JSON.stringify(result) === undefined) result = String(result);
    } catch (e: any) {
      status = "failed";
      error = String(e?.message ?? e);
    }
    if (signal.aborted) return; // the run was stopped: the server no longer waits
    this.#outbox.set(id, { toolName: p.toolName, status, result, error, sending: false, tries: 0, next: 0 });
    this.#deliver(id);
  }

  // One delivery attempt of an outbox entry; a network or server failure
  // keeps it, with a backoff, for the next #derive.
  #deliver(id: string) {
    const r = this.#outbox.get(id);
    if (!r || r.sending || Date.now() < r.next) return;
    r.sending = true;
    api("POST", `/sessions/${this.id}/tools/results`, clean({ toolCallId: id, toolName: r.toolName, status: r.status, result: r.result, error: r.error, executor: this.#executor }))
      .then(() => this.#outbox.delete(id))
      .catch((e: any) => {
        if (typeof e?.status === "number" && e.status >= 400 && e.status < 500) this.#outbox.delete(id); // late, unknown or invalid: final
        else {
          r.tries++;
          const wait = Math.min(5000, 200 * 2 ** r.tries);
          r.next = Date.now() + wait;
          // try again then, if the copy still says the call is waited for
          setTimeout(() => !this.#closed && this.#derive(), wait);
        }
      })
      .finally(() => {
        r.sending = false;
      });
  }
}

export function agent(grant: Grant) {
  return freeze({
    /** Resumes the session with this key, or creates it with these settings. */
    async open(key: string, o: OpenOptions = {}) {
      if (typeof key !== "string" || !key || key.length > 200) throw fail("invalid_request", "a session key is a string of 1 to 200 characters");
      const tools = o.tools ?? [];
      for (const t of tools) if (!t || typeof t.name !== "string" || typeof t.execute !== "function") throw fail("invalid_request", "a tool is {name, description, inputSchema, execute}");
      const find = async () => (await api("GET", "/sessions?label=" + encodeURIComponent("key:" + key))).sessions?.[0] ?? null;
      let info = await find();
      let fresh = false;
      if (!info) {
        try {
          info = (await api("POST", "/sessions", clean({
            title: o.title,
            labels: clean({ key, tier: o.modelTier, model: o.model, effort: o.effort }),
            data: clean({ system: o.system, maxRounds: o.maxRounds, toolTimeout: o.toolTimeout, maxTokens: o.maxTokens }),
          }))).session;
          fresh = true;
        } catch (e: any) {
          if (e?.code !== "session_exists" || !(info = await find())) throw e;
        }
      }
      return new Session(info, tools, fresh, grant);
    },
    /** The person's sessions in this app. */
    async list() {
      const l = await api("GET", "/sessions");
      return freeze((l.sessions ?? []).map((s: any) => freeze({
        id: s.id, key: s.labels?.key ?? "", title: s.title ?? "", created: s.created, updated: s.updated, running: !!s.running, usage: s.usage,
      })));
    },
    async limits() {
      return freeze(await rpc("agent.limits"));
    },
  });
}
