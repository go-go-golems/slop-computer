// The agent capability (slop's extension, SLOP3-025): agent sessions that
// live on the server. A page opens a session by its own key, sends one
// message at a time and gets the answer; the server keeps the conversation
// (append-only, so the provider's prompt cache holds) and runs the tool
// loop; the page runs the tools it registered when the model calls them.
// Spending is the sample capability's: the viewer's consent to sample and
// the person's LLM budget, held before every model round.
import { consent } from "./caps.ts";
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
    throw fail(code, (typeof e === "object" && e ? e.message : e) || "HTTP " + r.status);
  }
  return data;
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

type Run = {
  id: string;
  segments: Map<string, string>;
  order: string[];
  visible: string;
  onText?: SendOptions["onText"];
  tools: AbortController;
  resolve: (r: Result) => void;
  reject: (e: unknown) => void;
};

class Session {
  readonly id: string;
  readonly key: string;
  /** True when open() created the session: the server has no conversation yet. */
  readonly fresh: boolean;
  info: any;
  running = false;
  #tools: Tool[];
  #connection = "c-" + Math.random().toString(36).slice(2, 10);
  #executor: any = null;
  #stream: AbortController | null = null;
  #ready: Promise<void>;
  #onReady!: () => void;
  #closed = false;
  #run: Run | null = null;
  #seen = new Set<string>();
  #listeners = new Set<(e: UIEvent) => void>();

  constructor(info: any, tools: Tool[], fresh: boolean) {
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
  async send(prompt: string, o: SendOptions = {}): Promise<Result> {
    if (typeof prompt !== "string" || !prompt.trim()) throw fail("invalid_request", "the message is empty");
    if (this.#closed) throw fail("cancelled", "the session is closed");
    if (this.#run) throw fail("run_active", "an answer is still running in this session");
    if (o.signal?.aborted) throw fail("cancelled", "the call was aborted");
    await consent("sample");
    await this.#ready;
    if (this.#tools.length) await this.#register(); // the tab that sends runs the tools
    return new Promise<Result>((resolve, reject) => {
      const run: Run = { id: "", segments: new Map(), order: [], visible: "", onText: o.onText, tools: new AbortController(), resolve, reject };
      this.#run = run;
      const onAbort = () => void this.stop();
      o.signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => {
        o.signal?.removeEventListener("abort", onAbort);
        run.tools.abort();
        if (this.#run === run) this.#run = null;
      };
      run.resolve = (r) => (done(), resolve(r));
      run.reject = (e) => (done(), reject(e));
      api("POST", `/sessions/${this.id}/messages`, clean({ prompt, context: o.context })).catch((e) => run.reject(e));
    });
  }

  async stop(): Promise<void> {
    await api("POST", `/sessions/${this.id}/stop`).catch(() => {});
  }

  /** The conversation so far: [{role, text}] (user, assistant, thinking, error). */
  async history(): Promise<{ role: string; text: string }[]> {
    const v = await api("GET", `/sessions/${this.id}`);
    this.info = v.session;
    this.running = !!v.running;
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

  async #snapshot(snap: any) {
    if (this.#tools.length) await this.#register().catch(() => {});
    this.#onReady();
    // A call requested while the stream was down, assigned to this page.
    for (const e of snap.entities ?? []) {
      const p = e.payload;
      if (e.kind === "ChatFrontendToolCall" && p && p.status === "requested") this.#call(p);
    }
  }

  #event(ev: UIEvent) {
    const p = ev.payload ?? {};
    for (const fn of [...this.#listeners]) {
      try {
        fn(ev);
      } catch (e) {
        console.error(e);
      }
    }
    const run = this.#run;
    switch (ev.name) {
      case "ChatRunStarted":
        this.running = true;
        if (run && !run.id) run.id = p.messageId ?? "";
        return;
      case "ChatFrontendToolCallRequested":
        this.#call(p);
        return;
      case "ChatTextSegmentStarted":
      case "ChatTextPatch":
      case "ChatTextSegmentFinished":
        if (run && ownedBy(run, p.messageId)) this.#text(run, ev.name, p);
        return;
      case "ChatRunFinished":
      case "ChatRunFailed":
      case "ChatRunStopped":
        this.running = false;
        if (!run || (run.id && p.messageId && p.messageId !== run.id)) return;
        if (ev.name === "ChatRunFinished") run.resolve(freeze({ text: run.visible, truncated: !!p.truncated }));
        else if (ev.name === "ChatRunStopped") run.reject(fail("cancelled", "the answer was stopped", run.visible ? { text: run.visible } : undefined));
        else run.reject(fail(p.code || "upstream_error", p.error || "the run failed", run.visible ? { text: run.visible } : undefined));
    }
  }

  // The answer so far: every text segment of the run, in order, as sample's
  // text is every round's text.
  #text(run: Run, name: string, p: any) {
    const seg = String(p.messageId);
    if (!run.segments.has(seg)) {
      run.segments.set(seg, "");
      run.order.push(seg);
    }
    let t = run.segments.get(seg)!;
    if (name === "ChatTextSegmentFinished") t = p.content ?? p.text ?? t;
    else if (name === "ChatTextPatch") {
      if (p.mode === "CHAT_STREAM_PATCH_MODE_APPEND") t = t.slice(0, p.offset !== undefined ? Number(p.offset) : t.length) + (p.text ?? "");
      else if (p.text !== undefined) t = p.text;
    }
    run.segments.set(seg, t);
    const before = run.visible;
    run.visible = run.order.map((s) => run.segments.get(s)!).filter((s) => s !== "").join("\n\n");
    if (run.visible !== before) run.onText?.({ text: run.visible, delta: run.visible.startsWith(before) ? run.visible.slice(before.length) : "" });
  }

  async #call(p: any) {
    const id = p.toolCallId;
    if (!id || this.#seen.has(id) || !this.#executor || p.executor?.assignmentId !== this.#executor.assignmentId) return;
    this.#seen.add(id);
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
    if (signal.aborted) return;
    await api("POST", `/sessions/${this.id}/tools/results`, clean({ toolCallId: id, toolName: p.toolName, status, result, error, executor: this.#executor }))
      .catch(() => {}); // late (the call timed out) or the run was stopped
  }
}

// A text segment's id is "<run id>:text:<segment>".
const ownedBy = (run: Run, messageId: unknown) => !run.id || String(messageId ?? "").startsWith(run.id);

export function agent() {
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
      return new Session(info, tools, fresh);
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
