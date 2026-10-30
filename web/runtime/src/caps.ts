// The smaller capabilities: user, permissions, comments, assets, downloads,
// artifact and slop (slop's own: the management API an admin approved).
import { limits } from "./limits.ts";
import { ask, boot, connect, on, post, request as fetchView, rpc, state, type Hello } from "./transport.ts";
import { bytes, fail, freeze } from "./util.ts";

// --- user -------------------------------------------------------------------

type Profile = { id: string; name?: string; avatar?: string; color: string; email?: string };

const profileCache = new Map<string, Readonly<Record<string, unknown>>>();
function asProfile(p: Profile, meId: string | null) {
  return freeze({ id: p.id, name: p.name ?? "", avatarUrl: p.avatar ?? "", color: p.color, email: p.email ?? null, isMe: p.id === meId, guest: false });
}

export function user(h: Hello) {
  const me = h.me;
  const declared = !!h.caps.user;
  const scopes = new Set<string>(((h.caps.user as any)?.scopes as string[]) ?? []);
  const meId = declared ? (me.id ?? null) : null;
  const prof = (me.profile ?? {}) as Profile;
  const viewer = freeze({
    id: meId, name: scopes.has("profile") ? (prof.name ?? "") : "", avatarUrl: scopes.has("profile") ? (prof.avatar ?? "") : "",
    color: prof.color ?? "hsl(210 50% 45%)", email: scopes.has("email") ? (prof.email ?? null) : null, isOwner: me.isOwner, canEdit: me.canEdit,
  });
  const base: Record<string, unknown> = {
    isOwner: async () => me.isOwner,
    canEdit: async () => me.canEdit,
    can: async (name: string) => (name in me.can ? me.can[name] : null),
    me: async () => viewer,
  };
  if (declared) {
    base.id = async () => meId;
    base.profiles = async (ids: readonly string[] | string) => {
      const list = (typeof ids === "string" ? [ids] : [...ids]).filter((x) => typeof x === "string");
      const missing = list.filter((id) => !profileCache.has(id));
      if (missing.length) {
        try {
          const got = await rpc<Record<string, Profile>>("user.profiles", { ids: missing });
          for (const [id, p] of Object.entries(got)) profileCache.set(id, asProfile(p, meId));
        } catch {
          /* reads never reject */
        }
      }
      const out: Record<string, unknown> = {};
      for (const id of list) out[id] = profileCache.get(id) ?? freeze({ id, name: "", avatarUrl: "", color: "hsl(0 0% 55%)", email: null, isMe: id === meId, guest: false });
      return freeze(out);
    };
    if (scopes.has("profile")) {
      base.name = async () => viewer.name;
      base.avatarUrl = async () => viewer.avatarUrl || null;
      base.search = async (q: string) => {
        try {
          const got = await rpc<Profile[]>("user.search", { q: String(q ?? "") });
          return freeze(got.map((p) => asProfile(p, meId)));
        } catch {
          return freeze([]);
        }
      };
    }
    if (scopes.has("email")) base.email = async () => viewer.email;
  }
  return Object.freeze(base);
}

// --- permissions --------------------------------------------------------------

let states: Record<string, string> = {};
const denied = new Set<string>(); // a "no" is final for the page load

export function initPermissions(h: Hello | null) {
  states = { ...(h?.permissions ?? {}) };
}

function stateOf(name: string): string {
  if (denied.has(name)) return "denied";
  return states[name] ?? "unavailable";
}

/** Asks the shell's dialog for capabilities still at "prompt". */
export async function request(names?: readonly string[]): Promise<Record<string, string>> {
  const want = (names ?? Object.keys(states)).filter((n) => stateOf(n) === "prompt");
  if (want.length) {
    try {
      const res = await ask("consent", { names: want, app: boot.runtime?.app });
      const got = (res.states ?? {}) as Record<string, string>;
      for (const n of want) {
        if (got[n] === "granted") states[n] = "granted";
        else denied.add(n);
      }
    } catch {
      for (const n of want) denied.add(n);
    }
  }
  const out: Record<string, string> = {};
  for (const n of names ?? Object.keys(states)) out[n] = stateOf(n);
  return freeze(out);
}

/** Before a capability call that needs consent: asks once, then holds. */
export async function consent(name: string, code = "not_granted") {
  if (stateOf(name) === "granted") return;
  const r = await request([name]);
  if (r[name] !== "granted") throw fail(code, `the viewer has not allowed ${name}`);
}

export const permissions = Object.freeze({
  async state(name?: string) {
    await connect();
    if (typeof name === "string") return stateOf(name);
    const out: Record<string, string> = {};
    for (const n of Object.keys(states)) out[n] = stateOf(n);
    return freeze(out);
  },
  async request(names?: readonly string[]) {
    await connect();
    return request(names);
  },
  async manage() {
    try {
      await ask("permissions", {});
    } catch {
      throw fail("unavailable", "the permissions panel did not open");
    }
  },
});

// --- comments -----------------------------------------------------------------

function anchorOf(el: Element) {
  const r = el.getBoundingClientRect();
  const path: string[] = [];
  for (let cur: Element | null = el; cur && cur !== document.body && path.length < 8; cur = cur.parentElement) {
    if (cur.id) {
      path.unshift("#" + CSS.escape(cur.id));
      break;
    }
    const p: Element | null = cur.parentElement;
    const i = p ? Array.prototype.indexOf.call(p.children, cur) + 1 : 1;
    path.unshift(cur.tagName.toLowerCase() + ":nth-child(" + i + ")");
  }
  return freeze({ path: path.join(" > "), x: r.width ? 0.5 : 0, y: r.height ? 0.5 : 0 });
}

export function comments(h: Hello) {
  const composerOnly = !!(h.caps.comments as any)?.composer_only;
  const base: Record<string, unknown> = {
    async openComposer(t: { element?: Element; range?: Range }) {
      const el = t?.element ?? (t?.range ? (t.range.commonAncestorContainer as Element).parentElement ?? document.body : null);
      if (!el) throw fail("invalid", "openComposer takes {element} or {range}");
      const res = await ask("compose", { anchor: anchorOf(el), text: (el.textContent ?? "").slice(0, 200) });
      return freeze({ opened: !!res.opened });
    },
    anchorFor: async (el: Element) => anchorOf(el),
  };
  if (composerOnly) return Object.freeze(base);
  const text = (t: unknown) => {
    if (typeof t !== "string" || !t.trim() || bytes(t) > limits.MaxCommentBytes) throw fail("invalid", `a comment is 1-${limits.MaxCommentBytes} bytes`);
    return t;
  };
  const call = async (method: string, args: unknown) => {
    await consent("comments", "consent_required");
    try {
      return await rpc(method, args);
    } catch (e: any) {
      throw e?.code === "invalid_argument" ? fail("invalid", e.message) : e;
    }
  };
  Object.assign(base, {
    async create(o: { anchor: unknown; text: string }) {
      const t: any = await call("comments.create", { anchor: o?.anchor ?? {}, text: text(o?.text) });
      return freeze({ threadId: t.id, commentId: String(t.comments?.[0]?.id ?? "") });
    },
    async reply(threadId: string, t: string) {
      const c: any = await call("comments.reply", { thread: threadId, text: text(t) });
      return freeze({ commentId: String(c.id) });
    },
    async resolve(threadId: string, resolved: boolean) {
      await call("comments.resolve", { thread: threadId, resolved: resolved !== false });
    },
    async delete(threadId: string) {
      await call("comments.resolve", { thread: threadId, resolved: true });
    },
    async sendToClaude(t: { anchor?: unknown; threadId?: string; text: string }) {
      const r: any = await call("comments.sendToClaude", { anchor: t?.anchor, thread: t?.threadId, text: text(t?.text) });
      return freeze({ threadId: r.thread, commentId: String(r.comment ?? "") });
    },
    canSendToClaude: async () => {
      const r = await rpc<string>("room.canSendToClaudeSession").catch(() => "off");
      return r === "available" ? "available" : "no_session";
    },
  });
  return Object.freeze(base);
}

// --- assets -------------------------------------------------------------------

export const assets = Object.freeze({
  async upload(blob: Blob, opts?: { type?: string }) {
    if (!(blob instanceof Blob)) throw fail("invalid_request", "upload takes a Blob");
    const type = opts?.type || blob.type || "application/octet-stream";
    if (type === "image/svg+xml") throw fail("unsupported_type", "SVG uploads are not accepted yet");
    const r = await fetchView("/_rt/assets", { method: "POST", headers: { "Content-Type": type }, body: blob });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw fail(body?.error?.code || "upstream_error", body?.error?.message || "upload failed");
    return freeze(body);
  },
  async list() {
    const r: any = await rpc("assets.list");
    return freeze({ assets: r.assets, usage: { files: r.usage.count, bytes: r.usage.bytes, maxFiles: 1000, maxBytes: 1 << 30 } });
  },
  async delete(ref: string) {
    const id = String(ref).replace(/^.*\/_blob\//, "");
    try {
      return freeze(await rpc("assets.delete", { id }));
    } catch (e: any) {
      if (e?.code === "not_found") return freeze({ deleted: false });
      throw e;
    }
  },
});

// --- downloads ----------------------------------------------------------------

const allowedExt = /\.(txt|md|csv|tsv|json|jsonl|html|htm|css|svg|png|jpe?g|gif|webp|pdf|zip|ics|vcf|xml|yaml|yml|log|mp3|wav|mp4|webm)$/i;
let saving = false;

export const downloads = Object.freeze({
  async save(req: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }) {
    const name = req?.filename;
    if (typeof name !== "string" || !name || name.length > 200 || /[\/\\\0]/.test(name)) throw fail("bad_request", "a filename is 1-200 characters without slashes");
    if (!allowedExt.test(name)) throw fail("rejected_extension", "this file type is not offered for download");
    const d = req.data;
    const blob = d instanceof Blob ? d : new Blob([d as BlobPart]);
    if (blob.size > 50 << 20) throw fail("too_large", "a download is at most 50 MiB");
    if (saving) throw fail("rate_limited", "a save is already waiting for the viewer");
    saving = true;
    try {
      const res = await ask("download", { filename: name, data: blob });
      if (res.status === "saved") return freeze({ status: "saved" });
      throw fail(res.status === "declined" ? "declined" : "unavailable", "the viewer did not save the file");
    } finally {
      saving = false;
    }
  },
});

// --- artifact -----------------------------------------------------------------

export const artifact = Object.freeze({
  async publish(input: string | Record<string, unknown>) {
    if (typeof input !== "string") throw fail("invalid_content", "this runtime publishes a complete HTML document");
    const r: any = await rpc("artifact.publish", { html: input });
    return freeze({ version: String(r.version) });
  },
  async edit() {
    throw fail("capability_removed", "edit is not served here");
  },
  async sync(fn: () => unknown) {
    await fn();
  },
  async metadata(refs: readonly string[]) {
    const out: Record<string, unknown> = {};
    for (const id of refs) out[id] = freeze({ id, title: id, type: null });
    return freeze(out);
  },
});

// --- slop ---------------------------------------------------------------------

/** The management API an admin approved for this app version: the old
 *  tool API, same-origin through /_rt/api/. */
export function slop(h: Hello) {
  const perms: string[] = ((h.caps.slop as any)?.permissions as string[]) ?? [];
  const handlers = new Map<string, Set<(ev: unknown, type: string) => void>>();
  let streaming = false;
  let args: Record<string, string> = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const call = async (method: string, path: string, o: { params?: Record<string, unknown>; body?: unknown; raw?: BodyInit; type?: string; keepalive?: boolean } = {}) => {
    let url = "/_rt/api" + (path.startsWith("/") ? path : "/" + path);
    if (o.params) {
      const q = Object.entries(o.params).filter(([, v]) => v != null).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v))).join("&");
      if (q) url += (url.includes("?") ? "&" : "?") + q;
    }
    const init: RequestInit = { method, headers: {}, keepalive: o.keepalive };
    if (o.raw !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = o.type || "application/octet-stream";
      init.body = o.raw;
    } else if (o.body !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(o.body);
    }
    const r = await fetchView(url, init);
    const t = await r.text();
    let body: any = null;
    try {
      body = t ? JSON.parse(t) : null;
    } catch {
      body = t;
    }
    if (!r.ok) {
      const err = (body && body.error) || {};
      throw Object.assign(new Error(err.message || "HTTP " + r.status), { status: r.status, code: err.code || "" });
    }
    return body;
  };
  const sse = (path: string, after: () => unknown, onEv: (type: string, data: unknown, id: number | null) => void) => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    (async function connectLoop() {
      while (!stopped) {
        try {
          const cur = after();
          let url = "/_rt/api" + path;
          if (cur) url += (url.includes("?") ? "&" : "?") + "after=" + encodeURIComponent(String(cur));
          ctrl = new AbortController();
          const r = await fetchView(url, { signal: ctrl.signal });
          if (!r.ok || !r.body) throw new Error(path + ": HTTP " + r.status);
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
              let type = "message", data = "", id: number | null = null;
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) type = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
                else if (line.startsWith("id: ")) id = +line.slice(4) || null;
              }
              if (!data) continue;
              let ev: unknown = data;
              try {
                ev = JSON.parse(data);
              } catch {
                /* text */
              }
              try {
                onEv(type, ev, id);
              } catch (e) {
                console.error(e);
              }
            }
          }
        } catch (e: any) {
          if (!stopped) console.warn("slop:", e?.message);
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => {
      stopped = true;
      ctrl?.abort();
    };
  };
  const api = {
    get: (path: string, params?: Record<string, unknown>) => call("GET", path, { params }),
    post: (path: string, body?: unknown) => call("POST", path, { body }),
    put: (path: string, body?: unknown) => call("PUT", path, { body }),
    patch: (path: string, body?: unknown) => call("PATCH", path, { body }),
    del: (path: string, params?: Record<string, unknown>) => call("DELETE", path, { params }),
    putRaw: (path: string, raw: BodyInit, type?: string) => call("PUT", path, { raw, type }),
    beacon: (method: string, path: string, body?: unknown) => call(method, path, { body, keepalive: true }).catch(() => {}),
    on(type: string, h: (ev: unknown, type: string) => void) {
      let s = handlers.get(type);
      if (!s) handlers.set(type, (s = new Set()));
      s.add(h);
      if (!streaming) {
        streaming = true;
        let last = 0;
        sse("/events", () => last, (t, ev, id) => {
          if (id) last = id;
          for (const fn of [...(handlers.get(t) ?? []), ...(handlers.get("*") ?? [])]) fn(ev, t);
        });
      }
      return api;
    },
    stream: (path: string, o: { after?: () => unknown; on: (type: string, data: unknown, id: number | null) => void }) => sse(path, o.after ?? (() => 0), o.on),
    setArgs(a: Record<string, string>) {
      args = { ...(a ?? {}) };
      post({ type: "args", args });
    },
    can: (perm: string) => perms.includes(perm),
    get permissions() {
      return perms.slice();
    },
    get user() {
      return h.me.profile ?? null;
    },
    get args() {
      return args;
    },
    get view() {
      return state.view;
    },
    /** Asks the Workshop to open another target (the app on it). */
    open(target: string) {
      post({ type: "navigate", target: String(target) });
    },
    config: ((h.caps.slop as any)?.config ?? {}) as { siteHosts?: string[]; publicUrl?: string },
    target: h.target,
    app: h.app,
    version: h.version,
  };
  on("shell:args", (m: { args: Record<string, string> }) => {
    args = m.args ?? {};
  });
  return Object.freeze(api);
}
