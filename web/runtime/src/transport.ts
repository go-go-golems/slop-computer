// The runtime's connection to slop: the view secret from the shell (by
// postMessage, never in a URL), one fetch-based event stream with resume,
// and one RPC endpoint. Everything is same-origin: the target's origin
// serves /_rt/events and /_rt/rpc.
import { fail } from "./util.ts";

export type Boot = {
  mode: string;
  parentOrigin?: string;
  runtime?: { target: string; app: string; version: number; caps: Record<string, unknown>; docs?: Record<string, unknown> };
  version?: { artifact: string; n: number };
};

export type Hello = {
  view: string;
  target: string;
  app: string;
  version: number;
  kind: string;
  level: string;
  caps: Record<string, Record<string, unknown>>;
  rev: number;
  me: { id?: string; isOwner: boolean; canEdit: boolean; can: Record<string, boolean>; profile?: Record<string, unknown> };
  permissions: Record<string, string>;
};

const el = document.getElementById("slop-boot");
export const boot: Boot = (() => {
  try {
    return JSON.parse(el ? el.textContent || "{}" : "{}");
  } catch {
    return { mode: "site" };
  }
})();

const PARENT = boot.parentOrigin || "";
const framed = window.parent !== window && !!PARENT;

export function post(m: Record<string, unknown>, transfer?: Transferable[]) {
  if (!framed) return;
  try {
    window.parent.postMessage({ ...m, slop: 1 }, PARENT, transfer ?? []);
  } catch {
    /* no parent */
  }
}

type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();
export function on(type: string, h: Handler): () => void {
  let s = handlers.get(type);
  if (!s) handlers.set(type, (s = new Set()));
  s.add(h);
  return () => s!.delete(h);
}
function emit(type: string, data: unknown) {
  for (const h of [...(handlers.get(type) ?? [])]) {
    try {
      h(data);
    } catch (e) {
      console.error(e);
    }
  }
}

// --- shell messages -----------------------------------------------------

type Pending = { resolve: (v: any) => void };
const replies = new Map<string, Pending>();
let seq = 0;

/** Asks the shell something and waits for its answer (same id). */
export function ask(type: string, payload: Record<string, unknown>, transfer?: Transferable[]): Promise<any> {
  if (!framed) return Promise.reject(fail("unavailable", "no shell around this page"));
  const id = "m" + ++seq;
  return new Promise((resolve) => {
    replies.set(id, { resolve });
    post({ type, id, ...payload }, transfer);
  });
}

let secret = "";
let viewId = "";
let waitingView: Array<(ok: boolean) => void> = [];

window.addEventListener("message", (e) => {
  if (e.origin !== PARENT || e.source !== window.parent) return;
  const m = e.data;
  if (!m || m.slop !== 1) return;
  if (m.type === "view") {
    const changed = viewId !== "" && m.view !== viewId;
    secret = m.secret;
    viewId = m.view;
    waitingView.splice(0).forEach((w) => w(true));
    if (changed) emit("newview", m.view);
    startStream();
    return;
  }
  if (m.id && replies.has(m.id)) {
    replies.get(m.id)!.resolve(m);
    replies.delete(m.id);
    return;
  }
  emit("shell:" + m.type, m);
});

function awaitView(ms: number): Promise<boolean> {
  if (secret) return Promise.resolve(true);
  return new Promise((resolve) => {
    waitingView.push(resolve);
    setTimeout(() => resolve(!!secret), ms);
  });
}

/** Asks the shell for a fresh view (the old one closed or expired). */
let renewing: Promise<boolean> | null = null;
function renew(): Promise<boolean> {
  if (!renewing) {
    secret = "";
    renewing = new Promise<boolean>((resolve) => {
      waitingView.push(resolve);
      post({ type: "renew" });
      setTimeout(() => resolve(!!secret), 10000);
    }).finally(() => (renewing = null));
  }
  return renewing;
}

// --- the stream ---------------------------------------------------------

let hello: Hello | null = null;
let helloWaiters: Array<(h: Hello | null) => void> = [];
// lastRev is the newest target rev this view has seen; -1 until the first
// hello, so a resume from rev 0 (an empty target) still catches up.
let lastRev = -1;
let connected = false;
let streamGen = 0;
let terminal = "";

export const state = {
  get connected() {
    return connected;
  },
  get view() {
    return viewId;
  },
  get hello() {
    return hello;
  },
  get terminal() {
    return terminal;
  },
};

function setConnected(c: boolean) {
  if (c !== connected) {
    connected = c;
    emit("connection", c);
  }
}

/** Notes the newest target rev a doc event carried (for resume). */
export function seenRev(rev: number) {
  if (rev > lastRev) lastRev = rev;
}

function startStream() {
  const gen = ++streamGen;
  let backoff = 500;
  (async function loop() {
    while (gen === streamGen && !terminal) {
      try {
        const url = "/_rt/events" + (lastRev >= 0 ? "?after=" + lastRev : "");
        const r = await fetch(url, { headers: { Authorization: "Bearer " + secret }, credentials: "omit", cache: "no-store" });
        if (r.status === 401) {
          setConnected(false);
          if (!(await renew())) {
            terminal = "revoked";
            emit("terminal", "revoked");
            resolveHello(null);
            return;
          }
          continue;
        }
        if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
        backoff = 500;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const x = await reader.read();
          if (x.done || gen !== streamGen) break;
          buf += dec.decode(x.value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let type = "message", data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) type = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!data) continue;
            let ev: any = null;
            try {
              ev = JSON.parse(data);
            } catch {
              continue;
            }
            dispatch(type, ev);
          }
        }
        if (gen !== streamGen) return;
        setConnected(false);
      } catch (e) {
        setConnected(false);
        if (gen !== streamGen) return;
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 8000);
    }
  })();
}

function resolveHello(h: Hello | null) {
  helloWaiters.splice(0).forEach((w) => w(h));
}

function dispatch(type: string, ev: any) {
  switch (type) {
    case "hello":
      hello = ev as Hello;
      if (lastRev < 0) lastRev = ev.rev;
      setConnected(true);
      resolveHello(hello);
      emit("hello", ev);
      return;
    case "doc":
      emit("doc", ev);
      if (ev.rev) seenRev(ev.rev);
      return;
    case "revoked":
      terminal = "revoked";
      setConnected(false);
      emit("terminal", "revoked");
      return;
    case "reload":
      // The app published a new version. This frame's URL names the old
      // one, so the shell reopens the view on the new version; a plain
      // reload is the fallback when no shell answers.
      post({ type: "reload", version: ev.version });
      setTimeout(() => location.reload(), framed ? 5000 : 0);
      return;
  }
  emit(type, ev);
}

/** The view's hello, or null when this page has no view (not in the
 *  Workshop, no capabilities, or the shell never answered). */
let ready: Promise<Hello | null> | null = null;
export function connect(): Promise<Hello | null> {
  if (!ready) {
    ready = (async () => {
      if (!framed || boot.mode !== "app") return null;
      post({ type: "hello", runtime: true });
      if (!(await awaitView(10000))) return null;
      if (hello) return hello;
      return new Promise<Hello | null>((resolve) => {
        helloWaiters.push(resolve);
        setTimeout(() => resolve(hello), 15000);
      });
    })();
  }
  return ready;
}

/** Calls a capability method as this view. Rejects {code, message}. */
export async function rpc<T = any>(method: string, args?: unknown): Promise<T> {
  if (terminal) throw fail(terminal, "this view was closed");
  for (let attempt = 0; ; attempt++) {
    if (!secret && !(await awaitView(10000))) throw fail("unavailable", "no view");
    let r: Response;
    try {
      r = await fetch("/_rt/rpc", {
        method: "POST",
        headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ method, args: args ?? {} }),
      });
    } catch {
      if (attempt < 1) {
        await new Promise((res) => setTimeout(res, 300 + Math.random() * 400));
        continue;
      }
      throw fail("unavailable", "the server did not answer");
    }
    if (r.status === 401 && attempt < 1 && (await renew())) continue;
    let body: any = null;
    try {
      body = await r.json();
    } catch {
      /* not JSON */
    }
    if (body && body.error) throw fail(body.error.code || "unavailable", body.error.message || "failed");
    if (!r.ok) throw fail("unavailable", "HTTP " + r.status);
    return body.result as T;
  }
}

/** A raw same-origin request with the view's secret (assets, slop). */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (!secret && !(await awaitView(10000))) throw fail("unavailable", "no view");
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + secret);
    const r = await fetch(path, { ...init, headers, credentials: "omit" });
    if (r.status === 401 && attempt < 1 && (await renew())) continue;
    return r;
  }
}
