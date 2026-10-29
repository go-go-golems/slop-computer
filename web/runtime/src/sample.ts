// The sample capability: a model call through slop's Pi worker. One call
// is one streamed POST to /_rt/sample; page tools run here and post their
// results back; aborting cancels on the server. Only admins sample; any
// model and effort Pi offers may be named.
import { limits } from "./limits.ts";
import { consent } from "./caps.ts";
import { request, rpc, type Hello } from "./transport.ts";
import { bytes, canon, fail, freeze } from "./util.ts";

type Turn = { role: "user" | "assistant"; content: string };
type Tool = { name: string; description: string; inputSchema?: Record<string, unknown>; execute: (input: Record<string, unknown>, ctx: { signal: AbortSignal }) => unknown };
type Options = {
  onText?: (u: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  images?: Blob | Blob[] | FileList;
  modelTier?: "default" | "complex" | "quick" | "inherit";
  model?: string;
  effort?: "low" | "medium" | "high";
  cache?: boolean | { gcTime?: number; refresh?: boolean };
  tools?: Tool[];
};
type Result = { text: string; truncated: boolean; modelTierApplied: string; modelApplied?: string };

const cache = new Map<string, { at: number; ttl: number; result: Result }>();

function checkInput(input: unknown): string | Turn[] {
  if (typeof input === "string") {
    if (!input.trim()) throw fail("invalid_request", "the prompt is empty");
    if (bytes(input) > limits.MaxPromptBytes) throw fail("prompt_too_large", `a prompt is at most ${limits.MaxPromptBytes} bytes`);
    return input;
  }
  if (!Array.isArray(input) || !input.length) throw fail("invalid_request", "input is a string or a list of turns");
  let n = 0;
  for (const t of input) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") throw fail("invalid_request", "a turn is {role: user|assistant, content: string}");
    n += bytes(t.content);
  }
  if (input[0].role !== "user" || input[input.length - 1].role !== "user") throw fail("invalid_request", "turns begin and end with a user turn");
  if (n > limits.MaxPromptBytes) throw fail("prompt_too_large", `a prompt is at most ${limits.MaxPromptBytes} bytes`);
  return input.map((t) => ({ role: t.role, content: t.content }));
}

/** Downscales an image to a JPEG of at most 1568 px a side. */
async function prepare(blob: Blob): Promise<{ mimeType: string; data: string }> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(blob.type)) throw fail("image_rejected", "images are JPEG, PNG, WebP or GIF");
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mimeType: "image/jpeg", data: btoa(bin) };
}

const codes: Record<string, string> = {
  cancelled: "cancelled", images_unavailable: "images_unavailable", prompt_too_large: "prompt_too_large",
  empty_completion: "empty_completion", rate_limited: "rate_limited", invalid_request: "invalid_request",
  sampling_disabled: "sampling_disabled", not_granted: "not_granted", not_declared: "not_declared",
  session_expired: "session_expired", image_rejected: "image_rejected",
};

async function call(images: boolean, input: unknown, o: Options = {}): Promise<Result> {
  const prompt = checkInput(input);
  const tools = o.tools ?? [];
  if (tools.length > 16) throw fail("tools_unavailable", "at most 16 tools");
  for (const t of tools) if (!t || typeof t.name !== "string" || typeof t.execute !== "function") throw fail("invalid_request", "a tool is {name, description, execute}");
  const list = o.images ? (o.images instanceof Blob ? [o.images] : Array.from(o.images as ArrayLike<Blob>)) : [];
  if (list.length && !images) throw fail("images_unavailable", "declare sample: {images: true} to send images");
  if (o.signal?.aborted) throw fail("cancelled", "the call was aborted");
  const tier = o.modelTier && o.modelTier !== "inherit" ? o.modelTier : "default";
  const useCache = o.cache !== false && !tools.length && !list.length && !o.onText;
  const ttl = typeof o.cache === "object" && o.cache.gcTime ? o.cache.gcTime : 5 * 60_000;
  const key = canon({ prompt, tier, model: o.model ?? null, effort: o.effort ?? null });
  if (useCache && !(typeof o.cache === "object" && o.cache.refresh)) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.result;
  }
  await consent("sample");
  const body = {
    input: prompt, modelTier: tier, model: o.model, effort: o.effort,
    tools: tools.map((t) => ({ name: t.name, description: String(t.description ?? ""), inputSchema: t.inputSchema })),
    images: list.length ? await Promise.all(list.map(prepare)) : undefined,
  };
  const ctrl = new AbortController();
  let callId = "";
  let text = "";
  const onAbort = () => {
    if (callId) void request(`/_rt/sample/${callId}/cancel`, { method: "POST" }).catch(() => {});
    ctrl.abort();
  };
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const r = await request("/_rt/sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok || !r.body) {
      const e = await r.json().catch(() => null);
      throw fail(codes[e?.error?.code] ?? "upstream_error", e?.error?.message ?? "HTTP " + r.status);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let thinking = false;
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
        switch (type) {
          case "call":
            callId = ev.call;
            break;
          case "thinking":
            if (!text && !thinking && o.onText) {
              thinking = true;
              o.onText({ text: "Thinking…", delta: "" });
            }
            break;
          case "text":
            text = ev.text;
            o.onText?.({ text: ev.text, delta: ev.delta });
            break;
          case "tool":
            void runTool(callId, tools, ev, ctrl.signal);
            break;
          case "result": {
            const res: Result = freeze({ text: ev.text, truncated: !!ev.truncated, modelTierApplied: ev.modelTierApplied ?? tier,
              ...(ev.modelApplied ? { modelApplied: ev.modelApplied } : {}) });
            if (useCache) cache.set(key, { at: Date.now(), ttl, result: res });
            return res;
          }
          case "error":
            throw fail(codes[ev.code] ?? "upstream_error", ev.message ?? "the model call failed", ev.text || text ? { text: ev.text || text } : undefined);
        }
      }
    }
    if (o.signal?.aborted) throw fail("cancelled", "the call was aborted", text ? { text } : undefined);
    throw fail("upstream_error", "the call ended without a result", text ? { text } : undefined);
  } catch (e: any) {
    if (o.signal?.aborted || e?.name === "AbortError") throw fail("cancelled", "the call was aborted", text ? { text } : undefined);
    throw e;
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
}

/** Runs a page tool and posts its result (or its error) back. */
async function runTool(callId: string, tools: Tool[], ev: { use: string; name: string; input: Record<string, unknown> }, signal: AbortSignal) {
  const t = tools.find((x) => x.name === ev.name);
  let value: unknown, isError = false;
  try {
    if (!t) throw new Error("no tool " + ev.name);
    value = await t.execute(ev.input ?? {}, { signal });
    if (value === undefined) value = null;
    let s = JSON.stringify(value);
    if (s === undefined) s = "null";
    if (bytes(s) > limits.MaxToolResultBytes) {
      value = "The tool result exceeded 32 KB and was dropped.";
      isError = true;
    }
  } catch (e: any) {
    value = String(e?.message ?? e);
    isError = true;
  }
  if (signal.aborted) return;
  await request(`/_rt/sample/${callId}/tools/${encodeURIComponent(ev.use)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value, isError }),
  }).catch(() => {});
}

/** Parses a reply as JSON: the whole text, then a fenced block, then the
 *  outermost {…} or […]. */
export function parseJSON(text: string): unknown {
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) tries.push(fence[1].trim());
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const a = text.indexOf(open), b = text.lastIndexOf(close);
    if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  }
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      /* next */
    }
  }
  throw fail("invalid_json", "the reply is not JSON", { text });
}

export function sample(h: Hello) {
  const images = !!(h.caps.sample as any)?.images;
  const fn = (input: unknown, o?: Options) => call(images, input, o);
  return Object.freeze(Object.assign(fn, {
    json: async (input: unknown, o?: Options) => parseJSON((await call(images, input, o)).text),
    limits: async () => {
      try {
        return freeze(await rpc("sample.limits"));
      } catch {
        return freeze({ maxPromptBytes: limits.MaxPromptBytes });
      }
    },
  }));
}
