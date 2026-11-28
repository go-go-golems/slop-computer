// The agent capability (slop's extension, SLOP3-025): agent sessions that
// live on the server. A page opens a session by its own key, sends one
// message at a time and gets the answer; the server keeps the conversation
// (append-only, so the provider's prompt cache holds) and runs the tool
// loop; the page runs the tools it registered when the model calls them.
// Spending is the sample capability's (the sample policy, the person's LLM
// budget, held before every model round); the consent asked is agent's own,
// since a page may declare agent without sample.
//
// A run is known only by the id the server's 202 gives it. The session's
// stream, its copy of the timeline, the page's tool calls and their outbox
// are pinocchio's chatapp client (src/chatapp, copied from the Go module by
// sync-chatapp.mjs): one path for live events and for reconnects. This file
// adds slop's consent, its open-by-key, and a send's lifecycle (claim the
// slot, prepare, post, settle from the answer).
import type { Grant } from "./consent.ts";
import { type Answer, ChatError, Session as ChatSession, TERMINAL } from "./chatapp/index.ts";
import { request, rpc } from "./transport.ts";
import { fail, freeze } from "./util.ts";

const BASE = "/_rt/agent";

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
  resolve: (r: Result) => void;
  reject: (e: unknown) => void;
};

// The chatapp client's errors in slop's error shape.
const asFail = (e: unknown) => (e instanceof ChatError ? fail(e.code, e.message, { status: e.status }) : e);
const fetchVia = ((input: RequestInfo | URL, init?: RequestInit) => request(String(input), init)) as typeof fetch;

class Session {
  readonly id: string;
  readonly key: string;
  /** True when open() created the session: the server has no conversation yet. */
  readonly fresh: boolean;
  info: any;
  readonly #grant: Grant;
  readonly #tools: Tool[];
  readonly #core: Promise<ChatSession>;
  #chat: ChatSession | null = null;
  #closed = false;
  #run: Run | null = null;
  readonly #listeners = new Set<(e: UIEvent) => void>();

  constructor(info: any, tools: Tool[], fresh: boolean, grant: Grant) {
    this.#grant = grant;
    this.id = info.id;
    this.fresh = fresh;
    this.key = info.labels?.key ?? "";
    this.info = info;
    this.#tools = tools;
    this.#core = ChatSession.attach(BASE, info, { fetch: fetchVia }).then(
      async (chat) => {
        this.#chat = chat;
        chat.on((ev) => {
          if (ev) for (const fn of [...this.#listeners]) {
            try {
              fn(ev as UIEvent);
            } catch (e) {
              console.error(e);
            }
          }
          this.#derive();
        });
        if (this.#closed) chat.close();
        else if (this.#tools.length) await chat.tools(this.#tools).catch(() => {});
        return chat;
      },
      (e) => {
        this.#run?.reject(asFail(e));
        throw asFail(e);
      },
    );
    this.#core.catch(() => {});
  }

  /** Whether a run of this session is running (from the timeline). */
  get running(): boolean {
    return !!this.#chat?.timeline.running;
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
      text: "", onText: o.onText, resolve, reject,
    };
    const onAbort = () => this.#abort(run);
    const settle = () => {
      run.settled = true;
      o.signal?.removeEventListener("abort", onAbort);
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
      const chat = await Promise.race([this.#core, run.cancelled.then(() => null)]);
      if (!chat || !live()) return;
      if (this.#tools.length) await chat.tools(this.#tools); // the tab that sends runs the tools
      if (!live()) return;
      run.stage = "posting";
      run.id = await chat.send(prompt, clean({ context })); // the only way a send learns its run
      run.stage = "running";
      if (run.aborted) {
        // aborted while posting: the message was sent, so stop its run
        run.reject(fail("cancelled", "the call was aborted"));
        void this.stop();
        return;
      }
      this.#derive(); // its events may have arrived before the 202
    } catch (e) {
      run.reject(asFail(e));
    }
  }

  // The pending send's text and outcome, from the answer in the timeline.
  #derive() {
    const run = this.#run;
    if (!run || !run.id || !this.#chat) return;
    const a: Answer | null = this.#chat.timeline.answer(run.id);
    if (!a) return;
    if (a.text !== run.text) {
      const before = run.text;
      run.text = a.text;
      run.onText?.({ text: a.text, delta: a.text.startsWith(before) ? a.text.slice(before.length) : "" });
    }
    if (!TERMINAL.has(a.status)) return;
    const extra = run.text ? { text: run.text } : undefined;
    if (a.status === "finished") run.resolve(freeze({ text: run.text, truncated: a.truncated }));
    else if (a.status === "stopped") run.reject(fail("cancelled", "the answer was stopped", extra));
    else run.reject(fail(a.code || "upstream_error", a.error || "the run failed", extra));
  }

  // An abort, at whatever stage the run is: preparing → nothing was posted,
  // the send rejects now; posting → #start stops the run once the 202 names
  // it; running → stop, and the run's answer settles it.
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
    this.#chat?.close();
    this.#run?.reject(fail("cancelled", "the session was closed"));
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
