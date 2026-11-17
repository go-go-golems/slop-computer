// The smaller capabilities: user, permissions, comments, assets, downloads,
// artifact and slop (slop's own: actions, read aliases, the visitor).
import { limits } from "./limits.ts";
import { ask, boot, connect, post, request as fetchView, rpc, type Hello } from "./transport.ts";
import { bytes, fail, freeze } from "./util.ts";

// --- user -------------------------------------------------------------------

type Profile = { id: string; name?: string; avatar?: string; color: string; email?: string };

/** A person as this view may see them (name and avatar need the profile scope, email the email scope). */
export type UserProfile = Readonly<{ id: string; name: string; avatarUrl: string; color: string; email: string | null; isMe: boolean; guest: boolean }>;
/** The viewer: who they are, and who they are to the platform (the facts an actor reads from ctx.visitor). */
export type Viewer = Readonly<{
  id: string | null; name: string; avatarUrl: string; color: string; email: string | null;
  isOwner: boolean; canEdit: boolean;
  audience: string; level: string; guest: boolean; subscribed: boolean;
  llm: Readonly<{ allowed: boolean; remaining: number | null }>;
}>;
/**
 * claude.use('user'). id and profiles need the user capability declared;
 * name, avatarUrl and search its profile scope; email its email scope.
 */
export interface User {
  isOwner(): Promise<boolean>;
  canEdit(): Promise<boolean>;
  /** A named permission of the viewer; null when the app has none by that name. */
  can(name: string): Promise<boolean | null>;
  me(): Promise<Viewer>;
  id?(): Promise<string | null>;
  /** Profiles by id; an unknown id gets an empty profile. Never rejects. */
  profiles?(ids: readonly string[] | string): Promise<Readonly<Record<string, UserProfile>>>;
  name?(): Promise<string>;
  avatarUrl?(): Promise<string | null>;
  search?(q: string): Promise<readonly UserProfile[]>;
  email?(): Promise<string | null>;
}

const profileCache = new Map<string, UserProfile>();
function asProfile(p: Profile, meId: string | null): UserProfile {
  return freeze({ id: p.id, name: p.name ?? "", avatarUrl: p.avatar ?? "", color: p.color, email: p.email ?? null, isMe: p.id === meId, guest: false });
}

export function user(h: Hello): User {
  const me = h.me;
  const declared = !!h.caps.user;
  const scopes = new Set<string>(((h.caps.user as any)?.scopes as string[]) ?? []);
  const meId = declared ? (me.id ?? null) : null;
  const prof = (me.profile ?? {}) as Profile;
  const viewer: Viewer = freeze({
    id: meId, name: scopes.has("profile") ? (prof.name ?? "") : "", avatarUrl: scopes.has("profile") ? (prof.avatar ?? "") : "",
    color: prof.color ?? "hsl(210 50% 45%)", email: scopes.has("email") ? (prof.email ?? null) : null, isOwner: me.isOwner, canEdit: me.canEdit,
    // Guide §10: the visitor as the platform sees them, the same facts an
    // actor reads from ctx.visitor.
    audience: me.audience ?? "guest", level: me.level ?? h.level, guest: me.guest ?? !meId,
    subscribed: !!me.subscribed, llm: me.llm ?? { allowed: false, remaining: null },
  });
  const base: User = {
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
      const out: Record<string, UserProfile> = {};
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

/** Where a comment points: what anchorFor returns. */
export type CommentAnchor = Readonly<Record<string, unknown>>;
/**
 * claude.use('comments'). With composer_only, only openComposer and
 * anchorFor; otherwise the view writes comments itself (after the
 * viewer's consent).
 */
export interface Comments {
  openComposer(t: { element?: Element; range?: Range }): Promise<{ opened: boolean }>;
  anchorFor(el: Element): Promise<CommentAnchor>;
  create?(o: { anchor: CommentAnchor; text: string }): Promise<{ threadId: string; commentId: string }>;
  reply?(threadId: string, text: string): Promise<{ commentId: string }>;
  resolve?(threadId: string, resolved: boolean): Promise<void>;
  delete?(threadId: string): Promise<void>;
  sendToClaude?(t: { anchor?: CommentAnchor; threadId?: string; text: string }): Promise<{ threadId: string; commentId: string }>;
  canSendToClaude?(): Promise<"available" | "no_session">;
}

export function comments(h: Hello): Comments {
  const composerOnly = !!(h.caps.comments as any)?.composer_only;
  const base: Comments = {
    async openComposer(t: { element?: Element; range?: Range }) {
      const el = t?.element ?? (t?.range ? (t.range.commonAncestorContainer as Element).parentElement ?? document.body : null);
      if (!el) throw fail("invalid", "openComposer takes {element} or {range}");
      const res = await ask("compose", { anchor: anchorOf(el), text: (el.textContent ?? "").slice(0, 200) });
      return freeze({ opened: !!res.opened });
    },
    anchorFor: async (el: Element) => anchorOf(el) as CommentAnchor,
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

/** An uploaded file: url is where pages load it from. */
export type Asset = Readonly<{ id: string; url: string; sizeBytes: number; contentType: string }>;

export const assets = Object.freeze({
  async upload(blob: Blob, opts?: { type?: string }): Promise<Asset> {
    if (!(blob instanceof Blob)) throw fail("invalid_request", "upload takes a Blob");
    const type = opts?.type || blob.type || "application/octet-stream";
    if (type === "image/svg+xml") throw fail("unsupported_type", "SVG uploads are not accepted yet");
    const r = await fetchView("/_rt/assets", { method: "POST", headers: { "Content-Type": type }, body: blob });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw fail(body?.error?.code || "upstream_error", body?.error?.message || "upload failed");
    return freeze(body);
  },
  async list(): Promise<Readonly<{ assets: readonly Asset[]; usage: Readonly<{ files: number; bytes: number; maxFiles: number; maxBytes: number }> }>> {
    const r: any = await rpc("assets.list");
    return freeze({ assets: r.assets, usage: { files: r.usage.count, bytes: r.usage.bytes, maxFiles: 1000, maxBytes: 1 << 30 } });
  },
  async delete(ref: string): Promise<Readonly<{ deleted: boolean }>> {
    const id = String(ref).replace(/^.*\/_blob\//, "");
    try {
      return freeze(await rpc<{ deleted: boolean }>("assets.delete", { id }));
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
// --- slop -------------------------------------------------------------------

// slop's own namespace (slop v3): the store's actor actions, read aliases,
// who is visiting, and asking the shell to sign in.
/** A document of a bound store, as stores.open(alias) reads it. */
export type StoreDoc<T = Record<string, unknown>> = Readonly<{ path: string; exists: true; version: number; body: T } | { path: string; exists: false }>;
/** A file of a bound store's main snapshot. */
export type StoreFile = Readonly<{ path: string; sha256: string; size: number; type: string }>;
/** A store of a type the visitor can open (stores.list). */
export type StoreListing = Readonly<{ id: string; app: string; level: string; mine: boolean; createdAt: number; title?: string }>;
/** stores.open(alias): reads of a store bound to this app, as the visitor. */
export interface BoundStore {
  doc<T = Record<string, unknown>>(path: string): Promise<StoreDoc<T>>;
  query<T = Record<string, unknown>>(coll: string, query?: { filters?: { field: string; op: string; value: unknown }[]; order?: string; desc?: boolean; limit?: number }): Promise<{ docs: (StoreDoc<T> & { exists: true })[] }>;
  file(path: string): Promise<Readonly<{ path: string; type: string; text: string }>>;
  files(): Promise<readonly StoreFile[]>;
}

export function slop(h: Hello) {
  const cfg = (h.caps.slop as Record<string, unknown> | undefined) ?? {};
  // A governance change the actor makes for the visitor (roles, policy,
  // budgets…) needs their approval in the shell, outside this frame: the
  // call fails with confirmation_required, the shell asks, and an allowed
  // call is repeated (the approval holds for this view and call).
  const call = async (action: string, args?: unknown): Promise<unknown> => {
    for (let asked = 0; ; asked++) {
      try {
        return await rpc<unknown>("slop.call", { action: String(action), args: args ?? {} });
      } catch (e: any) {
        if (e?.code !== "confirmation_required" || !e.confirm || asked >= 4) throw e;
        const r = await ask("confirm", { confirm: e.confirm }).catch(() => null);
        if (!r?.approved) throw fail("confirmation_declined", "not allowed: " + e.message);
      }
    }
  };
  const actions = new Proxy({} as Record<string, (args?: unknown) => Promise<unknown>>, {
    get: (_t, name) => (typeof name === "string" && name !== "then" ? (args?: unknown) => call(name, args) : undefined),
  });
  const open = (alias: string): BoundStore =>
    freeze({
      doc: (path: string) => rpc("slop.read", { alias, op: "get", path }),
      query: (coll: string, query?: unknown) => rpc("slop.read", { alias, op: "query", coll, query: query ?? {} }),
      file: (path: string) => rpc("slop.read", { alias, op: "file", path }),
      files: () => rpc<StoreFile[]>("slop.read", { alias, op: "files" }),
    });
  return freeze({
    actions,
    call,
    // open(alias) reads a store bound to this app; list({type, title?}) lists
    // the stores of a type the visitor can open (a "my boards" page), with
    // each one's title read from the document at `title` (e.g. board/meta).
    stores: freeze({ open, list: async (o: { type: string; title?: string }): Promise<readonly StoreListing[]> => (await rpc<{ stores: StoreListing[] }>("slop.stores", o ?? {})).stores }),
    visitor: async () => (h.me as Record<string, unknown>).visitor ?? null,
    signIn: () => post({ type: "signin" }),
    subscribeUrl: () => String(cfg.subscribeUrl ?? ""),
  });
}

// --- files (SLOP3-008) --------------------------------------------------------

// files reads a store's files as the viewer: a "project" is a store's main
// snapshot, named by files.project in the manifest (_stores, or one of the
// store's aliases). The contract's shapes and error codes.

type FileEntry = { path: string; isDirectory: boolean; size: number };
const blockedDownload = /\.(exe|msi|com|scr|bat|cmd|ps1|sh|vbs|jar|js|mjs|cjs)$/i;
const fileCodes = new Set(["not_found", "not_granted", "changed", "rate_limited", "too_large", "declined", "bad_request"]);

function fileFail(e: any): Error {
  const code = e?.code === "invalid_argument" ? "bad_request" : fileCodes.has(e?.code) ? e.code : "unavailable";
  return fail(code, e?.message || "project files are unavailable");
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function files() {
  const list = async (o?: { path?: string; recursive?: boolean; cursor?: string }) => {
    try {
      const r: any = await rpc("files.list", { path: o?.path ?? "", recursive: !!o?.recursive, cursor: o?.cursor ?? "" });
      const entries = ((r.entries ?? []) as FileEntry[]).map((e) => freeze({ path: e.path, isDirectory: !!e.isDirectory, size: e.size }));
      return freeze(r.cursor ? { entries, cursor: String(r.cursor) } : { entries });
    } catch (e) {
      throw fileFail(e);
    }
  };
  const read = async (path: string, o?: { offset?: number; length?: number }) => {
    if (typeof path !== "string" || !path) throw fail("bad_request", "read takes a file path");
    try {
      const r: any = await rpc("files.read", { path, offset: o?.offset ?? 0, length: o?.length });
      return freeze({ bytes: fromBase64(r.bytes), size: r.size as number, revision: String(r.revision) });
    } catch (e) {
      throw fileFail(e);
    }
  };
  const download = async (path: string) => {
    if (typeof path !== "string" || !path) throw fail("bad_request", "download takes a file path");
    if (blockedDownload.test(path)) throw fail("bad_request", "this file type cannot be saved from a page");
    const chunks: Uint8Array[] = [];
    let offset = 0, size = 0, rev = "";
    do {
      const r = await read(path, { offset });
      if (rev && r.revision !== rev) throw fail("changed", "the file changed while it was read");
      rev = r.revision;
      size = r.size;
      chunks.push(r.bytes);
      offset += r.bytes.length;
      if (!r.bytes.length) break;
    } while (offset < size);
    const name = path.split("/").pop() || "file";
    const res = await ask("download", { filename: name, data: new Blob(chunks as BlobPart[]) }).catch(() => ({ status: "unavailable" }));
    if (res.status === "saved") return freeze({ status: "saved" });
    throw fail(res.status === "declined" ? "declined" : "unavailable", "the file was not saved");
  };
  const asSampleTools = async () =>
    freeze([
      freeze({
        name: "list_project_files",
        description: "List files and folders of the project. path: a folder (omit for the top level); recursive: everything below it.",
        inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } } },
        execute: async (i: { path?: string; recursive?: boolean }) => (await list(i)).entries.slice(0, 200),
      }),
      freeze({
        name: "read_project_file",
        description: "Read a text file of the project (about 12 KB per call; pass offset to continue).",
        inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" } }, required: ["path"] },
        execute: async (i: { path: string; offset?: number }) => {
          const r = await read(i.path, { offset: i.offset ?? 0, length: 12 * 1024 });
          const next = (i.offset ?? 0) + r.bytes.length;
          return { text: new TextDecoder().decode(r.bytes), size: r.size, ...(next < r.size ? { next } : {}) };
        },
      }),
    ]);
  return Object.freeze({ list, read, download, asSampleTools });
}
