/* slop page runtime (window.claude), built from web/runtime: do not edit. source sha256:2742b183359686d8b41d44c50afcd7ecf0b2e30a4a0be990943d8be56a7b79a6 */
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
  var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
  var __privateWrapper = (obj, member, setter, getter) => ({
    set _(value) {
      __privateSet(obj, member, value, setter);
    },
    get _() {
      return __privateGet(obj, member, getter);
    }
  });

  // src/limits.ts
  var limits = {
    MaxDocBytes: 256 << 10,
    MaxDocDepth: 32,
    MaxDocsPerTarget: 25e3,
    MaxPathBytes: 1e3,
    MaxPathSegments: 16,
    MaxSegmentBytes: 200,
    MaxRules: 64,
    MaxFilters: 10,
    MaxInValues: 30,
    MaxQueryLimit: 1e3,
    MaxSubscriptions: 64,
    MinLeaseMs: 1e3,
    MaxLeaseMs: 6e5,
    DefaultLeaseMs: 3e4,
    MaxRoomData: 4 << 10,
    MaxPresence: 4 << 10,
    MaxTopics: 16,
    MaxRooms: 16,
    MaxCommentBytes: 4 << 10,
    MaxAssetBytes: 20 << 20,
    MaxCodeAssetBytes: 16 << 20,
    MaxPromptBytes: 256 << 10,
    MaxToolResultBytes: 32 << 10,
    MaxSendToClaude: 4 << 10
  };

  // src/util.ts
  function fail(code, message, extra) {
    return Object.assign(new Error(message), { code }, extra ?? {});
  }
  var segment = /^[A-Za-z0-9_.~:@+-]+$/;
  var utf8 = new TextEncoder();
  var bytes = (s) => utf8.encode(s).length;
  function checkPath(p, doc) {
    if (typeof p !== "string" || p === "") throw new TypeError("a db path is a non-empty string");
    const nested = p.startsWith("_stores/");
    const maxBytes = limits.MaxPathBytes + (nested ? "_stores/".length + limits.MaxSegmentBytes + 1 : 0);
    const maxSegs = limits.MaxPathSegments + (nested ? 2 : 0);
    if (bytes(p) > maxBytes) throw new TypeError(`a db path is at most ${maxBytes} bytes`);
    const segs = p.split("/");
    if (segs.length > maxSegs) throw new TypeError(`a db path has at most ${maxSegs} segments`);
    for (const s of segs) {
      if (s === "" || s === "." || s === ".." || !segment.test(s)) throw new TypeError(`invalid path segment ${JSON.stringify(s)} in ${p}`);
      if (bytes(s) > limits.MaxSegmentBytes) throw new TypeError(`a path segment is at most ${limits.MaxSegmentBytes} bytes`);
    }
    if (segs.length % 2 === 0 !== doc) {
      throw new TypeError(`${p} has ${segs.length} segments: a ${doc ? "document" : "collection"} path has an ${doc ? "even" : "odd"} number`);
    }
    return p;
  }
  var collOf = (p) => p.slice(0, p.lastIndexOf("/"));
  var idOf = (p) => p.slice(p.lastIndexOf("/") + 1);
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    const o = v;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== void 0).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  var equal = (a, b) => a === b || canon(a) === canon(b);
  function depth(v) {
    if (v === null || typeof v !== "object") return 0;
    let d = 0;
    for (const x of Object.values(v)) d = Math.max(d, depth(x));
    return d + 1;
  }
  var isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  function freeze(v) {
    if (v && typeof v === "object" && !ArrayBuffer.isView(v) && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const x of Object.values(v)) freeze(x);
    }
    return v;
  }
  function plain(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function randomId(n = 20) {
    const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const r = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(r, (x) => a[x % a.length]).join("");
  }

  // src/transport.ts
  var el = document.getElementById("slop-boot");
  var boot = (() => {
    try {
      return JSON.parse(el ? el.textContent || "{}" : "{}");
    } catch {
      return { mode: "site" };
    }
  })();
  var PARENT = boot.parentOrigin || "";
  var framed = window.parent !== window && !!PARENT;
  function post(m, transfer) {
    if (!framed) return;
    try {
      window.parent.postMessage({ ...m, slop: 1 }, PARENT, transfer ?? []);
    } catch {
    }
  }
  var handlers = /* @__PURE__ */ new Map();
  function on(type, h) {
    let s = handlers.get(type);
    if (!s) handlers.set(type, s = /* @__PURE__ */ new Set());
    s.add(h);
    return () => s.delete(h);
  }
  function emit(type, data) {
    for (const h of [...handlers.get(type) ?? []]) {
      try {
        h(data);
      } catch (e) {
        console.error(e);
      }
    }
  }
  var replies = /* @__PURE__ */ new Map();
  var seq = 0;
  function ask(type, payload, transfer) {
    if (!framed) return Promise.reject(fail("unavailable", "no shell around this page"));
    const id = "m" + ++seq;
    return new Promise((resolve2) => {
      replies.set(id, { resolve: resolve2 });
      post({ type, id, ...payload }, transfer);
    });
  }
  var secret = "";
  var viewId = "";
  var waitingView = [];
  window.addEventListener("message", (e) => {
    if (e.origin !== PARENT || e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.slop !== 1) return;
    if (m.type === "view") {
      const changed = viewId !== "" && m.view !== viewId;
      secret = m.secret;
      viewId = m.view;
      waitingView.splice(0).forEach((w) => w(true));
      if (changed) {
        remoteRevs.clear();
        emit("newview", m.view);
      }
      startStream();
      return;
    }
    if (m.id && replies.has(m.id)) {
      replies.get(m.id).resolve(m);
      replies.delete(m.id);
      return;
    }
    emit("shell:" + m.type, m);
  });
  function awaitView(ms) {
    if (secret) return Promise.resolve(true);
    return new Promise((resolve2) => {
      waitingView.push(resolve2);
      setTimeout(() => resolve2(!!secret), ms);
    });
  }
  var renewing = null;
  function renew() {
    if (!renewing) {
      secret = "";
      renewing = new Promise((resolve2) => {
        waitingView.push(resolve2);
        post({ type: "renew" });
        setTimeout(() => resolve2(!!secret), 1e4);
      }).finally(() => renewing = null);
    }
    return renewing;
  }
  var hello = null;
  var helloWaiters = [];
  var lastRev = -1;
  var remoteRevs = /* @__PURE__ */ new Map();
  var connected = false;
  var streamGen = 0;
  var terminal = "";
  var state = {
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
    }
  };
  function setConnected(c) {
    if (c !== connected) {
      connected = c;
      emit("connection", c);
    }
  }
  function seenRev(rev) {
    if (rev > lastRev) lastRev = rev;
  }
  function startStream() {
    const gen = ++streamGen;
    let backoff = 500;
    (async function loop() {
      while (gen === streamGen && !terminal) {
        try {
          const q = [];
          if (lastRev >= 0) q.push("after=" + lastRev);
          if (remoteRevs.size) q.push("remote=" + encodeURIComponent([...remoteRevs].map(([k, r2]) => k + ":" + r2).join(",")));
          const url = "/_rt/events" + (q.length ? "?" + q.join("&") : "");
          const r = await fetch(url, { headers: { Authorization: "Bearer " + secret }, credentials: "omit", cache: "no-store" });
          if (r.status === 401) {
            setConnected(false);
            if (!await renew()) {
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
          for (; ; ) {
            const x = await reader.read();
            if (x.done || gen !== streamGen) break;
            buf += dec.decode(x.value, { stream: true });
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              let type = "message", data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) type = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
              }
              if (!data) continue;
              let ev = null;
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
        backoff = Math.min(backoff * 2, 8e3);
      }
    })();
  }
  function resolveHello(h) {
    helloWaiters.splice(0).forEach((w) => w(h));
  }
  function dispatch(type, ev) {
    switch (type) {
      case "hello":
        hello = ev;
        if (lastRev < 0) lastRev = ev.rev;
        setConnected(true);
        resolveHello(hello);
        emit("hello", ev);
        return;
      case "doc":
        emit("doc", ev);
        if (ev.rev) seenRev(ev.rev);
        if (ev.remote && ev.remoteRev > (remoteRevs.get(ev.remote) ?? 0)) remoteRevs.set(ev.remote, ev.remoteRev);
        return;
      case "revoked":
        terminal = "revoked";
        setConnected(false);
        emit("terminal", "revoked");
        return;
      case "access":
        streamGen++;
        setConnected(false);
        post({ type: "reopen" });
        setTimeout(() => location.reload(), framed ? 5e3 : 0);
        return;
      case "reload":
        post({ type: "reload", version: ev.version });
        setTimeout(() => location.reload(), framed ? 5e3 : 0);
        return;
    }
    emit(type, ev);
  }
  var ready = null;
  function connect() {
    if (!ready) {
      ready = (async () => {
        if (!framed || boot.mode !== "app") return null;
        post({ type: "hello", runtime: true });
        if (!await awaitView(1e4)) return null;
        if (hello) return hello;
        return new Promise((resolve2) => {
          helloWaiters.push(resolve2);
          setTimeout(() => resolve2(hello), 15e3);
        });
      })();
    }
    return ready;
  }
  var absolute = /* @__PURE__ */ new Set([
    "db.get",
    "db.query",
    "db.subscribe",
    "db.unsubscribe",
    "slop.read",
    "assets.list",
    "user.profiles",
    "user.search",
    "sample.limits",
    "room.join",
    "room.leave",
    "room.presence"
  ]);
  function newKey() {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  async function rpc(method, args) {
    if (terminal) throw fail(terminal, "this view was closed");
    const key = absolute.has(method) ? void 0 : newKey();
    for (let attempt = 0; ; attempt++) {
      if (!secret && !await awaitView(1e4)) throw fail("unavailable", "no view");
      let r;
      try {
        r = await fetch("/_rt/rpc", {
          method: "POST",
          headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify({ method, args: args ?? {}, key })
        });
      } catch {
        if (attempt < 1) {
          await new Promise((res) => setTimeout(res, 300 + Math.random() * 400));
          continue;
        }
        throw fail("unavailable", "the server did not answer");
      }
      if (r.status === 401 && attempt < 1 && await renew()) continue;
      let body = null;
      try {
        body = await r.json();
      } catch {
      }
      if (body && body.error)
        throw fail(body.error.code || "unavailable", body.error.message || "failed", body.error.confirm ? { confirm: body.error.confirm } : void 0);
      if (!r.ok) throw fail("unavailable", "HTTP " + r.status);
      return body.result;
    }
  }
  async function request(path, init = {}) {
    for (let attempt = 0; ; attempt++) {
      if (!secret && !await awaitView(1e4)) throw fail("unavailable", "no view");
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer " + secret);
      const r = await fetch(path, { ...init, headers, credentials: "omit" });
      if (r.status === 401 && attempt < 1 && await renew()) continue;
      return r;
    }
  }

  // src/caps.ts
  var profileCache = /* @__PURE__ */ new Map();
  function asProfile(p, meId) {
    return freeze({ id: p.id, name: p.name ?? "", avatarUrl: p.avatar ?? "", color: p.color, email: p.email ?? null, isMe: p.id === meId, guest: false });
  }
  function user(h) {
    const me = h.me;
    const declared = !!h.caps.user;
    const scopes = new Set(h.caps.user?.scopes ?? []);
    const meId = declared ? me.id ?? null : null;
    const prof = me.profile ?? {};
    const viewer = freeze({
      id: meId,
      name: scopes.has("profile") ? prof.name ?? "" : "",
      avatarUrl: scopes.has("profile") ? prof.avatar ?? "" : "",
      color: prof.color ?? "hsl(210 50% 45%)",
      email: scopes.has("email") ? prof.email ?? null : null,
      isOwner: me.isOwner,
      canEdit: me.canEdit,
      // Guide §10: the visitor as the platform sees them, the same facts an
      // actor reads from ctx.visitor.
      audience: me.audience ?? "guest",
      level: me.level ?? h.level,
      guest: me.guest ?? !meId,
      subscribed: !!me.subscribed,
      llm: me.llm ?? { allowed: false, remaining: null }
    });
    const base = {
      isOwner: async () => me.isOwner,
      canEdit: async () => me.canEdit,
      can: async (name) => name in me.can ? me.can[name] : null,
      me: async () => viewer
    };
    if (declared) {
      base.id = async () => meId;
      base.profiles = async (ids) => {
        const list = (typeof ids === "string" ? [ids] : [...ids]).filter((x) => typeof x === "string");
        const missing = list.filter((id) => !profileCache.has(id));
        if (missing.length) {
          try {
            const got = await rpc("user.profiles", { ids: missing });
            for (const [id, p] of Object.entries(got)) profileCache.set(id, asProfile(p, meId));
          } catch {
          }
        }
        const out = {};
        for (const id of list) out[id] = profileCache.get(id) ?? freeze({ id, name: "", avatarUrl: "", color: "hsl(0 0% 55%)", email: null, isMe: id === meId, guest: false });
        return freeze(out);
      };
      if (scopes.has("profile")) {
        base.name = async () => viewer.name;
        base.avatarUrl = async () => viewer.avatarUrl || null;
        base.search = async (q) => {
          try {
            const got = await rpc("user.search", { q: String(q ?? "") });
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
  function anchorOf(el2) {
    const r = el2.getBoundingClientRect();
    const path = [];
    for (let cur = el2; cur && cur !== document.body && path.length < 8; cur = cur.parentElement) {
      if (cur.id) {
        path.unshift("#" + CSS.escape(cur.id));
        break;
      }
      const p = cur.parentElement;
      const i = p ? Array.prototype.indexOf.call(p.children, cur) + 1 : 1;
      path.unshift(cur.tagName.toLowerCase() + ":nth-child(" + i + ")");
    }
    return freeze({ path: path.join(" > "), x: r.width ? 0.5 : 0, y: r.height ? 0.5 : 0 });
  }
  function comments(h, grant) {
    const composerOnly = !!h.caps.comments?.composer_only;
    const base = {
      async openComposer(t) {
        const el2 = t?.element ?? (t?.range ? t.range.commonAncestorContainer.parentElement ?? document.body : null);
        if (!el2) throw fail("invalid", "openComposer takes {element} or {range}");
        const res = await ask("compose", { anchor: anchorOf(el2), text: (el2.textContent ?? "").slice(0, 200) });
        return freeze({ opened: !!res.opened });
      },
      anchorFor: async (el2) => anchorOf(el2)
    };
    if (composerOnly) return Object.freeze(base);
    const text = (t) => {
      if (typeof t !== "string" || !t.trim() || bytes(t) > limits.MaxCommentBytes) throw fail("invalid", `a comment is 1-${limits.MaxCommentBytes} bytes`);
      return t;
    };
    const call3 = async (method, args) => {
      await grant.consent("consent_required");
      try {
        return await rpc(method, args);
      } catch (e) {
        throw e?.code === "invalid_argument" ? fail("invalid", e.message) : e;
      }
    };
    Object.assign(base, {
      async create(o) {
        const t = await call3("comments.create", { anchor: o?.anchor ?? {}, text: text(o?.text) });
        return freeze({ threadId: t.id, commentId: String(t.comments?.[0]?.id ?? "") });
      },
      async reply(threadId, t) {
        const c = await call3("comments.reply", { thread: threadId, text: text(t) });
        return freeze({ commentId: String(c.id) });
      },
      async resolve(threadId, resolved) {
        await call3("comments.resolve", { thread: threadId, resolved: resolved !== false });
      },
      async delete(threadId) {
        await call3("comments.resolve", { thread: threadId, resolved: true });
      },
      async sendToClaude(t) {
        const r = await call3("comments.sendToClaude", { anchor: t?.anchor, thread: t?.threadId, text: text(t?.text) });
        return freeze({ threadId: r.thread, commentId: String(r.comment ?? "") });
      },
      canSendToClaude: async () => {
        const r = await rpc("room.canSendToClaudeSession").catch(() => "off");
        return r === "available" ? "available" : "no_session";
      }
    });
    return Object.freeze(base);
  }
  var assets = Object.freeze({
    async upload(blob, opts) {
      if (!(blob instanceof Blob)) throw fail("invalid_request", "upload takes a Blob");
      const type = opts?.type || blob.type || "application/octet-stream";
      if (type === "image/svg+xml") throw fail("unsupported_type", "SVG uploads are not accepted yet");
      const r = await request("/_rt/assets", { method: "POST", headers: { "Content-Type": type }, body: blob });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw fail(body?.error?.code || "upstream_error", body?.error?.message || "upload failed");
      return freeze(body);
    },
    async list() {
      const r = await rpc("assets.list");
      return freeze({ assets: r.assets, usage: { files: r.usage.count, bytes: r.usage.bytes, maxFiles: 1e3, maxBytes: 1 << 30 } });
    },
    async delete(ref) {
      const id = String(ref).replace(/^.*\/_blob\//, "");
      try {
        return freeze(await rpc("assets.delete", { id }));
      } catch (e) {
        if (e?.code === "not_found") return freeze({ deleted: false });
        throw e;
      }
    }
  });
  var allowedExt = /\.(txt|md|csv|tsv|json|jsonl|html|htm|css|svg|png|jpe?g|gif|webp|pdf|zip|ics|vcf|xml|yaml|yml|log|mp3|wav|mp4|webm)$/i;
  var saving = false;
  var downloads = Object.freeze({
    async save(req) {
      const name = req?.filename;
      if (typeof name !== "string" || !name || name.length > 200 || /[\/\\\0]/.test(name)) throw fail("bad_request", "a filename is 1-200 characters without slashes");
      if (!allowedExt.test(name)) throw fail("rejected_extension", "this file type is not offered for download");
      const d = req.data;
      const blob = d instanceof Blob ? d : new Blob([d]);
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
    }
  });
  var artifact = Object.freeze({
    async publish(input) {
      if (typeof input !== "string") throw fail("invalid_content", "this runtime publishes a complete HTML document");
      const r = await rpc("artifact.publish", { html: input });
      return freeze({ version: String(r.version) });
    },
    async edit() {
      throw fail("capability_removed", "edit is not served here");
    },
    async sync(fn) {
      await fn();
    },
    async metadata(refs) {
      const out = {};
      for (const id of refs) out[id] = freeze({ id, title: id, type: null });
      return freeze(out);
    }
  });
  function slop(h) {
    const cfg = h.caps.slop ?? {};
    const call3 = async (action, args) => {
      for (let asked = 0; ; asked++) {
        try {
          return await rpc("slop.call", { action: String(action), args: args ?? {} });
        } catch (e) {
          if (e?.code !== "confirmation_required" || !e.confirm || asked >= 4) throw e;
          const r = await ask("confirm", { confirm: e.confirm }).catch(() => null);
          if (!r?.approved) throw fail("confirmation_declined", "not allowed: " + e.message);
        }
      }
    };
    const actions = new Proxy({}, {
      get: (_t, name) => typeof name === "string" && name !== "then" ? (args) => call3(name, args) : void 0
    });
    const open = (alias) => freeze({
      doc: (path) => rpc("slop.read", { alias, op: "get", path }),
      query: (coll, query2) => rpc("slop.read", { alias, op: "query", coll, query: query2 ?? {} }),
      file: (path) => rpc("slop.read", { alias, op: "file", path }),
      files: () => rpc("slop.read", { alias, op: "files" })
    });
    return freeze({
      actions,
      call: call3,
      // open(alias) reads a store bound to this app; list({type, title?}) lists
      // the stores of a type the visitor can open (a "my boards" page), with
      // each one's title read from the document at `title` (e.g. board/meta).
      stores: freeze({ open, list: async (o) => (await rpc("slop.stores", o ?? {})).stores }),
      visitor: async () => h.me.visitor ?? null,
      signIn: () => post({ type: "signin" }),
      subscribeUrl: () => String(cfg.subscribeUrl ?? "")
    });
  }
  var blockedDownload = /\.(exe|msi|com|scr|bat|cmd|ps1|sh|vbs|jar|js|mjs|cjs)$/i;
  var fileCodes = /* @__PURE__ */ new Set(["not_found", "not_granted", "changed", "rate_limited", "too_large", "declined", "bad_request"]);
  function fileFail(e) {
    const code = e?.code === "invalid_argument" ? "bad_request" : fileCodes.has(e?.code) ? e.code : "unavailable";
    return fail(code, e?.message || "project files are unavailable");
  }
  function fromBase64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function files() {
    const list = async (o) => {
      try {
        const r = await rpc("files.list", { path: o?.path ?? "", recursive: !!o?.recursive, cursor: o?.cursor ?? "" });
        const entries = (r.entries ?? []).map((e) => freeze({ path: e.path, isDirectory: !!e.isDirectory, size: e.size }));
        return freeze(r.cursor ? { entries, cursor: String(r.cursor) } : { entries });
      } catch (e) {
        throw fileFail(e);
      }
    };
    const read = async (path, o) => {
      if (typeof path !== "string" || !path) throw fail("bad_request", "read takes a file path");
      try {
        const r = await rpc("files.read", { path, offset: o?.offset ?? 0, length: o?.length });
        return freeze({ bytes: fromBase64(r.bytes), size: r.size, revision: String(r.revision) });
      } catch (e) {
        throw fileFail(e);
      }
    };
    const download = async (path) => {
      if (typeof path !== "string" || !path) throw fail("bad_request", "download takes a file path");
      if (blockedDownload.test(path)) throw fail("bad_request", "this file type cannot be saved from a page");
      const chunks = [];
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
      const res = await ask("download", { filename: name, data: new Blob(chunks) }).catch(() => ({ status: "unavailable" }));
      if (res.status === "saved") return freeze({ status: "saved" });
      throw fail(res.status === "declined" ? "declined" : "unavailable", "the file was not saved");
    };
    const asSampleTools = async () => freeze([
      freeze({
        name: "list_project_files",
        description: "List files and folders of the project. path: a folder (omit for the top level); recursive: everything below it.",
        inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } } },
        execute: async (i) => (await list(i)).entries.slice(0, 200)
      }),
      freeze({
        name: "read_project_file",
        description: "Read a text file of the project (about 12 KB per call; pass offset to continue).",
        inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" } }, required: ["path"] },
        execute: async (i) => {
          const r = await read(i.path, { offset: i.offset ?? 0, length: 12 * 1024 });
          const next = (i.offset ?? 0) + r.bytes.length;
          return { text: new TextDecoder().decode(r.bytes), size: r.size, ...next < r.size ? { next } : {} };
        }
      })
    ]);
    return Object.freeze({ list, read, download, asSampleTools });
  }

  // src/consent.ts
  var states = {};
  var denied = /* @__PURE__ */ new Set();
  function initPermissions(h) {
    states = { ...h?.permissions ?? {} };
  }
  function stateOf(name) {
    if (denied.has(name)) return "denied";
    return states[name] ?? "unavailable";
  }
  async function request2(names) {
    const want = (names ?? Object.keys(states)).filter((n) => stateOf(n) === "prompt");
    if (want.length) {
      try {
        const res = await ask("consent", { names: want, app: boot.runtime?.app });
        const got = res.states ?? {};
        for (const n of want) {
          if (got[n] === "granted") states[n] = "granted";
          else denied.add(n);
        }
      } catch {
        for (const n of want) denied.add(n);
      }
    }
    const out = {};
    for (const n of names ?? Object.keys(states)) out[n] = stateOf(n);
    return freeze(out);
  }
  async function consent(name, code = "not_granted") {
    if (stateOf(name) === "granted") return;
    const r = await request2([name]);
    if (r[name] !== "granted") throw fail(code, `the viewer has not allowed ${name}`);
  }
  function grantFor(name) {
    return Object.freeze({ name, consent: (code) => consent(name, code) });
  }
  var permissions = Object.freeze({
    async state(name) {
      await connect();
      if (typeof name === "string") return stateOf(name);
      const out = {};
      for (const n of Object.keys(states)) out[n] = stateOf(n);
      return freeze(out);
    },
    async request(names) {
      await connect();
      return request2(names);
    },
    async manage() {
      try {
        await ask("permissions", {});
      } catch {
        throw fail("unavailable", "the permissions panel did not open");
      }
    }
  });

  // src/diff.ts
  function diff(a, b) {
    if (equal(a, b)) return null;
    const ao = a !== null && typeof a === "object", bo = b !== null && typeof b === "object";
    if (ao && bo && !Array.isArray(a) && !Array.isArray(b)) {
      const x = a, y = b;
      const k = {};
      for (const key of Object.keys(x)) {
        if (!(key in y)) k[key] = { t: "del" };
        else {
          const d = diff(x[key], y[key]);
          if (d) k[key] = d;
        }
      }
      for (const key of Object.keys(y)) if (!(key in x)) k[key] = { t: "set", v: y[key] };
      return { t: "obj", k };
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      let pre = 0;
      while (pre < a.length && pre < b.length && equal(a[pre], b[pre])) pre++;
      let suf = 0;
      while (suf < a.length - pre && suf < b.length - pre && equal(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
      return { t: "arr", s: pre, d: a.length - pre - suf, i: b.slice(pre, b.length - suf) };
    }
    return { t: "set", v: b };
  }
  function applyPatch(a, p) {
    switch (p.t) {
      case "set":
        return p.v === void 0 ? null : p.v;
      case "obj": {
        if (a === null || typeof a !== "object" || Array.isArray(a)) throw new Error("patch does not apply");
        const out = { ...a };
        for (const [key, sub] of Object.entries(p.k ?? {})) {
          if (sub.t === "del") delete out[key];
          else out[key] = applyPatch(a[key], sub);
        }
        return out;
      }
      case "arr": {
        const s = p.s ?? 0, d = p.d ?? 0;
        if (!Array.isArray(a) || s + d > a.length) throw new Error("patch does not apply");
        return [...a.slice(0, s), ...p.i ?? [], ...a.slice(s + d)];
      }
    }
    throw new Error("patch does not apply");
  }
  var patchSize = (p) => JSON.stringify(p).length;

  // src/query.ts
  var rank = (v) => typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3;
  function compare(a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a < b ? -1 : a > b ? 1 : 0;
    if (ra === 1) return a < b ? -1 : a > b ? 1 : 0;
    if (ra === 2) return a === b ? 0 : a ? 1 : -1;
    const ca = canon(a), cb = canon(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  }
  function matches(v, f) {
    switch (f.op) {
      case "==":
        return equal(v, f.value);
      case "!=":
        return !equal(v, f.value);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        if (rank(v) !== rank(f.value) || rank(v) === 3) return false;
        const c = compare(v, f.value);
        return f.op === "<" ? c < 0 : f.op === "<=" ? c <= 0 : f.op === ">" ? c > 0 : c >= 0;
      }
      case "in":
      case "not-in": {
        const found = f.value.some((x) => equal(v, x));
        return found === (f.op === "in");
      }
      case "array-contains":
        return Array.isArray(v) && v.some((x) => equal(x, f.value));
    }
    return false;
  }
  function match(q, body) {
    return (q.filters ?? []).every((f) => Object.prototype.hasOwnProperty.call(body, f.field) && matches(body[f.field], f));
  }
  var byId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function sort(q, docs) {
    const o = q.order;
    return docs.sort((a, b) => {
      if (o) {
        const ah = Object.prototype.hasOwnProperty.call(a.body, o), bh = Object.prototype.hasOwnProperty.call(b.body, o);
        if (ah !== bh) return ah ? -1 : 1;
        if (ah) {
          const c = compare(a.body[o], b.body[o]);
          if (c !== 0) return q.desc ? -c : c;
        }
      }
      return byId(idOf(a.path), idOf(b.path));
    });
  }
  function apply(q, docs) {
    const out = sort(q, docs.filter((d) => match(q, d.body)));
    return q.limit && q.limit > 0 ? out.slice(0, q.limit) : out;
  }
  var ops = /* @__PURE__ */ new Set(["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains"]);
  function validate(q) {
    if ((q.filters ?? []).length > 10) return "at most 10 filters";
    for (const f of q.filters ?? []) {
      if (typeof f.field !== "string" || !f.field || f.field.includes(".")) return "a filter names one top-level field";
      if (!ops.has(f.op)) return `unknown operator ${f.op}`;
      if ((f.op === "in" || f.op === "not-in") && (!Array.isArray(f.value) || f.value.length === 0 || f.value.length > 30))
        return `${f.op} takes 1-30 values`;
    }
    if (q.order !== void 0 && (typeof q.order !== "string" || q.order.includes("."))) return "orderBy names one top-level field";
    if (q.limit !== void 0 && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 1e3)) return "limit is 1-1000";
    return null;
  }

  // src/db.ts
  var META_OK = Object.freeze({ fromCache: false, hasPendingWrites: false });
  var META_PENDING = Object.freeze({ fromCache: false, hasPendingWrites: true });
  function snapOf(path, body, meta) {
    const b = body === void 0 ? void 0 : freeze(body);
    return Object.freeze({ id: idOf(path), exists: b !== void 0, data: () => b, metadata: meta });
  }
  var known = /* @__PURE__ */ new Map();
  function remember(path, version, body) {
    const k = known.get(path);
    if (k && k.version > version) return;
    if (body) known.set(path, { version, body });
    else known.delete(path);
    if (known.size > 2e3) known.delete(known.keys().next().value);
  }
  var pending = /* @__PURE__ */ new Map();
  var queues = /* @__PURE__ */ new Map();
  function serial(path, fn) {
    const prev = queues.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {
    });
    queues.set(path, tail);
    tail.then(() => queues.get(path) === tail && queues.delete(path));
    return next;
  }
  var listeners = /* @__PURE__ */ new Map();
  function covers(l, path) {
    return l.coll ? collOf(path) === l.path : l.path === path;
  }
  function intoMirror(l, d) {
    const seen = l.seen.get(d.path) ?? 0;
    if (d.version <= seen) return false;
    if (d.deleted || d.exists === false || d.body === null) {
      l.seen.set(d.path, d.version);
      return l.mirror.delete(d.path);
    }
    let body = d.body;
    if (d.patch) {
      const cur = l.mirror.get(d.path);
      if (!cur || cur.version !== d.base) return "refetch";
      try {
        body = applyPatch(cur.body, d.patch);
      } catch {
        return "refetch";
      }
    }
    if (!body) return false;
    l.seen.set(d.path, d.version);
    l.mirror.set(d.path, { path: d.path, version: d.version, body });
    return true;
  }
  function deliver(l) {
    if (l.dead || !l.ready) return;
    if (!l.coll) {
      const p = pending.get(l.path);
      const e = l.mirror.get(l.path);
      let snap;
      if (p) snap = snapOf(l.path, p.body ?? void 0, META_PENDING);
      else if (e) snap = e.snap ?? (e.snap = snapOf(l.path, e.body, META_OK));
      else snap = snapOf(l.path, void 0, META_OK);
      const prev2 = l.last;
      if (prev2 && prev2 === snap) return;
      if (prev2 && !p && !e && !prev2.exists && !prev2.metadata.hasPendingWrites) return;
      l.last = snap;
      call(l, snap);
      return;
    }
    const rows = /* @__PURE__ */ new Map();
    for (const e of l.mirror.values()) rows.set(e.path, { path: e.path, body: e.body, snap: e.snap ?? (e.snap = snapOf(e.path, e.body, META_OK)) });
    let pend = false;
    for (const [path, p] of pending) {
      if (collOf(path) !== l.path) continue;
      pend = true;
      if (p.body) rows.set(path, { path, body: p.body, snap: snapOf(path, p.body, META_PENDING) });
      else rows.delete(path);
    }
    const docs = apply(l.query, [...rows.values()]).map((r) => r.snap);
    const prev = l.last ?? null;
    if (prev && prev.length === docs.length && prev.every((d, i) => d === docs[i])) return;
    const changes = docChanges(prev ?? [], docs);
    l.last = docs;
    const meta = pend ? META_PENDING : META_OK;
    call(l, Object.freeze({ docs: Object.freeze(docs), size: docs.length, empty: docs.length === 0, docChanges: () => changes, metadata: meta }));
  }
  function docChanges(prev, next) {
    const out = [];
    const pi = new Map(prev.map((d, i) => [d.id, i]));
    const ni = new Map(next.map((d, i) => [d.id, i]));
    prev.forEach((d, i) => {
      if (!ni.has(d.id)) out.push(Object.freeze({ type: "removed", doc: d, oldIndex: i, newIndex: -1 }));
    });
    next.forEach((d, i) => {
      const o = pi.get(d.id);
      if (o === void 0) out.push(Object.freeze({ type: "added", doc: d, oldIndex: -1, newIndex: i }));
      else if (prev[o] !== d || o !== i) out.push(Object.freeze({ type: "modified", doc: d, oldIndex: o, newIndex: i }));
    });
    return Object.freeze(out);
  }
  function call(l, s) {
    try {
      l.next(s);
    } catch (e) {
      console.error(e);
    }
  }
  function kill(l, code, message) {
    if (l.dead) return;
    l.dead = true;
    listeners.delete(l.id);
    const e = fail(code, message);
    if (l.error) l.error(e);
    else reportError(e);
  }
  on("doc", (d) => {
    if (d.body !== void 0 && d.body !== null && !d.patch) remember(d.path, d.version, d.body);
    for (const l of listeners.values()) {
      if (!covers(l, d.path)) continue;
      l.streamed.add(d.path);
      const r = intoMirror(l, d);
      if (r === "refetch") refetch(l, d.path);
      else if (r) deliver(l);
    }
    const k = known.get(d.path);
    if (d.patch && k && k.version === d.base) {
      try {
        remember(d.path, d.version, applyPatch(k.body, d.patch));
      } catch {
        known.delete(d.path);
      }
    } else if (d.deleted) known.delete(d.path);
  });
  async function refetch(l, path) {
    try {
      const d = await rpc("db.get", { path });
      if (intoMirror(l, { ...d, deleted: !d.exists }) === true) deliver(l);
    } catch {
    }
  }
  async function register(l) {
    l.streamed.clear();
    try {
      const res = await rpc("db.subscribe", {
        sub: l.id,
        path: l.path,
        coll: l.coll,
        query: l.coll ? { coll: l.path, filters: l.query.filters ?? [] } : void 0
      });
      if (l.dead) {
        rpc("db.unsubscribe", { sub: l.id }).catch(() => {
        });
        return;
      }
      if (l.coll) {
        const fresh = new Set((res.docs ?? []).map((d) => d.path));
        for (const p of [...l.mirror.keys()]) if (!fresh.has(p) && !l.streamed.has(p)) l.mirror.delete(p);
        for (const d of res.docs ?? []) {
          intoMirror(l, d);
          remember(d.path, d.version, d.body);
        }
      } else if (res.doc) {
        if (res.doc.exists) {
          intoMirror(l, res.doc);
          remember(res.doc.path, res.doc.version, res.doc.body);
        } else if (!l.streamed.has(l.path)) l.mirror.delete(l.path);
      }
      l.ready = true;
      deliver(l);
    } catch (e) {
      if (e?.code === "unavailable") {
        setTimeout(() => !l.dead && register(l), 2e3);
        return;
      }
      kill(l, e?.code || "unavailable", e?.message || "subscribe failed");
    }
  }
  on("newview", () => {
    for (const l of listeners.values()) {
      l.seen.clear();
      register(l);
    }
  });
  on("terminal", (code) => {
    for (const l of [...listeners.values()]) kill(l, code, "this view was closed");
  });
  function subscribe(path, coll, query2, next, error) {
    if (typeof next !== "function") throw new TypeError("onSnapshot needs a callback");
    const l = { id: randomId(12), path, coll, query: query2, mirror: /* @__PURE__ */ new Map(), seen: /* @__PURE__ */ new Map(), streamed: /* @__PURE__ */ new Set(), ready: false, dead: false, last: null, next, error };
    queueMicrotask(() => {
      if (l.dead) return;
      if (state.terminal) return kill(l, state.terminal, "this view was closed");
      if (listeners.size >= limits.MaxSubscriptions) return kill(l, "resource_exhausted", `at most ${limits.MaxSubscriptions} subscriptions per view`);
      if (coll) {
        const bad = validate(query2);
        if (bad) return kill(l, "invalid_argument", bad);
      }
      listeners.set(l.id, l);
      register(l);
    });
    return () => {
      if (l.dead) return;
      l.dead = true;
      if (listeners.delete(l.id)) rpc("db.unsubscribe", { sub: l.id }).catch(() => {
      });
    };
  }
  function redeliver(path) {
    for (const l of listeners.values()) if (covers(l, path)) deliver(l);
  }
  function checkBody(data) {
    if (!isPlain(data)) throw fail("invalid_argument", "a document body is a plain JSON object");
    const body = plain(data);
    const n = bytes(JSON.stringify(body));
    if (n > limits.MaxDocBytes) throw fail("invalid_argument", `a document is at most ${limits.MaxDocBytes} bytes (this one is ${n})`);
    if (depth(body) > limits.MaxDocDepth) throw fail("invalid_argument", `a document is at most ${limits.MaxDocDepth} levels deep`);
    return body;
  }
  function merge(cur, patch) {
    const out = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = isPlain(v) && isPlain(cur[k]) ? merge(cur[k], v) : v;
    }
    return out;
  }
  function localBody(path) {
    const p = pending.get(path);
    if (p) return p.body ?? void 0;
    for (const l of listeners.values()) {
      const e = l.mirror.get(path);
      if (e) return e.body;
    }
    return known.get(path)?.body;
  }
  async function writeRPC(args) {
    for (let asked = 0; ; asked++) {
      try {
        return await rpc("db.write", args);
      } catch (e) {
        if (e?.code !== "confirmation_required" || !e.confirm || asked >= 4) throw e;
        const r = await ask("confirm", { confirm: e.confirm }).catch(() => null);
        if (!r?.approved) throw fail("confirmation_declined", "not allowed: " + e.message);
      }
    }
  }
  async function write(path, op, body) {
    if (!await connect()) throw fail("not_granted", "db is not available in this view");
    const optimistic = op === "delete" ? null : op === "update" ? localBody(path) ? merge(localBody(path), body) : void 0 : body;
    const mark = { n: 0 };
    if (optimistic !== void 0) {
      const p = { body: optimistic, n: (pending.get(path)?.n ?? 0) + 1 };
      mark.n = p.n;
      pending.set(path, p);
      redeliver(path);
    }
    try {
      const version = await serial(path, async () => {
        if (op === "set") {
          const k = known.get(path);
          if (k) {
            const p = diff(k.body, body);
            if (p && patchSize(p) <= JSON.stringify(body).length / 4) {
              try {
                return (await rpc("db.write", { path, op: "patch", patch: p, base: k.version })).version;
              } catch (e) {
                if (e?.code !== "conflict_base") throw e;
              }
            }
          }
        }
        return (await writeRPC({ path, op, body })).version;
      });
      if (version > 0 && op !== "update" && optimistic !== void 0) {
        remember(path, version, optimistic);
        const w = optimistic ? { path, version, body: optimistic } : { path, version, deleted: true };
        for (const l of listeners.values()) if (covers(l, path)) intoMirror(l, w);
      }
    } finally {
      if (pending.get(path)?.n === mark.n) {
        pending.delete(path);
        redeliver(path);
      }
    }
  }
  function docRef(path) {
    checkPath(path, true);
    return Object.freeze({
      id: idOf(path),
      path,
      async get() {
        if (!await connect()) throw fail("not_granted", "db is not available in this view");
        const p = pending.get(path);
        if (p) return snapOf(path, p.body ?? void 0, META_PENDING);
        const d = await rpc("db.get", { path });
        if (d.exists) remember(path, d.version, d.body);
        return snapOf(path, d.exists ? d.body : void 0, META_OK);
      },
      set(data) {
        try {
          return write(path, "set", checkBody(data));
        } catch (e) {
          return Promise.reject(e);
        }
      },
      update(data) {
        try {
          return write(path, "update", checkBody(data));
        } catch (e) {
          return Promise.reject(e);
        }
      },
      delete() {
        return write(path, "delete");
      },
      async acquire(o) {
        if (!o || typeof o.holder !== "string" || !o.holder) throw fail("invalid_argument", "acquire needs a holder");
        if (!await connect()) throw fail("not_granted", "db is not available in this view");
        return Object.freeze(await rpc("db.acquire", { path, holder: o.holder, ttlMs: o.ttlMs ?? 0, data: o.data ? checkBody(o.data) : void 0 }));
      },
      onSnapshot(next, error) {
        return subscribe(path, false, { coll: collOf(path) }, next, error);
      },
      collection(sub) {
        return collRef(path + "/" + sub);
      }
    });
  }
  function query(coll, q) {
    const self = {
      where(field, op, value) {
        const filters = [...q.filters ?? [], { field, op, value: plain(value) }];
        if (filters.length > limits.MaxFilters) throw fail("invalid_argument", `at most ${limits.MaxFilters} filters`);
        return query(coll, { ...q, filters });
      },
      orderBy(field, dir = "asc") {
        if (q.order) throw fail("invalid_argument", "at most one orderBy");
        return query(coll, { ...q, order: field, desc: dir === "desc" });
      },
      limit(n) {
        return query(coll, { ...q, limit: n });
      },
      async get() {
        const bad = validate(q);
        if (bad) throw fail("invalid_argument", bad);
        if (!await connect()) throw fail("not_granted", "db is not available in this view");
        const res = await rpc("db.query", { coll, filters: q.filters ?? [], order: q.order, desc: q.desc, limit: q.limit ?? 0 });
        const docs = res.docs.map((d) => snapOf(d.path, d.body, META_OK));
        return Object.freeze({
          docs: Object.freeze(docs),
          size: docs.length,
          empty: docs.length === 0,
          docChanges: () => docChanges([], docs),
          metadata: META_OK
        });
      },
      onSnapshot(next, error) {
        return subscribe(coll, true, q, next, error);
      }
    };
    return self;
  }
  function collRef(path) {
    checkPath(path, false);
    const q = query(path, { coll: path });
    return Object.freeze({
      ...q,
      path,
      doc(id) {
        return docRef(path + "/" + (id ?? randomId(20)));
      },
      async add(data) {
        const ref = docRef(path + "/" + randomId(20));
        await ref.set(data);
        return ref;
      }
    });
  }
  var db = Object.freeze({
    doc: (path) => docRef(path),
    collection: (path) => collRef(path)
  });

  // src/room.ts
  var topicRe = /^[a-z][a-z0-9_.-]{0,47}$/;
  var roomRe = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
  var rooms = /* @__PURE__ */ new Map();
  var EMPTY = Object.freeze([]);
  function roomOf(name) {
    let r = rooms.get(name);
    if (!r) {
      r = { name, joined: false, left: false, presence: {}, peers: EMPTY, topics: /* @__PURE__ */ new Map(), peerHandlers: /* @__PURE__ */ new Set(), connHandlers: /* @__PURE__ */ new Set(), errHandlers: /* @__PURE__ */ new Set() };
      rooms.set(name, r);
    }
    return r;
  }
  function asPeer(p, prev) {
    const me = p.peer === state.view;
    if (prev && prev.updatedAt === p.updatedAt && canon(prev.presence) === canon(p.presence) && prev.isMe === me) return prev;
    return freeze({ ...p, presence: p.presence ?? {}, isMe: me, sameTab: me });
  }
  on("peers", (ev) => {
    const r = rooms.get(ev.room);
    if (!r || r.left) return;
    const before = new Map(r.peers.map((p) => [p.peer, p]));
    const next = Object.freeze(ev.peers.map((p) => asPeer(p, before.get(p.peer))));
    const joined = next.filter((p) => !before.has(p.peer));
    const nextIds = new Set(next.map((p) => p.peer));
    const left = r.peers.filter((p) => !nextIds.has(p.peer));
    const updated = next.filter((p) => before.has(p.peer) && before.get(p.peer) !== p);
    r.peers = next;
    if (!joined.length && !left.length && !updated.length) return;
    const change = Object.freeze({ peers: next, joined: Object.freeze(joined), left: Object.freeze(left), updated: Object.freeze(updated) });
    for (const h of [...r.peerHandlers]) safe(() => h(change));
  });
  on("room", (ev) => {
    const r = rooms.get(ev.room);
    if (!r || r.left) return;
    const me = ev.peer === state.view;
    const msg = freeze({ topic: ev.topic, data: ev.data, peer: ev.peer, by: ev.by, isMe: me, sameTab: me, kind: ev.kind, guest: !!ev.guest });
    for (const h of [...r.topics.get(ev.topic) ?? []]) safe(() => h(msg));
  });
  on("connection", (c) => {
    for (const r of rooms.values()) if (!r.left) for (const h of [...r.connHandlers]) safe(() => h(c));
  });
  on("newview", () => {
    for (const r of rooms.values()) if (r.joined && !r.left) join(r).catch(() => {
    });
  });
  on("terminal", (code) => {
    for (const r of rooms.values()) {
      const e = fail(code, "this view was closed");
      for (const h of [...r.errHandlers]) safe(() => h(e));
      r.peers = EMPTY;
    }
  });
  function safe(fn) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
  async function join(r) {
    const res = await rpc("room.join", { room: r.name });
    r.joined = true;
    if (Object.keys(r.presence).length) await rpc("room.presence", { room: r.name, patch: r.presence });
    if (r.peers === EMPTY) r.peers = Object.freeze(res.peers.map((p) => asPeer(p)));
  }
  function api(r) {
    const check = () => {
      if (r.left) throw fail("invalid_argument", "you left this room");
      if (state.terminal) throw fail(state.terminal, "this view was closed");
    };
    const listen = (set, h, onError) => {
      if (typeof h !== "function") throw fail("invalid_argument", "a handler is a function");
      set.add(h);
      if (onError) r.errHandlers.add(onError);
      return () => {
        set.delete(h);
        if (onError) r.errHandlers.delete(onError);
      };
    };
    return {
      async emit(topic, data) {
        check();
        if (typeof topic !== "string" || !topicRe.test(topic)) throw fail("invalid_argument", `a topic matches ${topicRe}`);
        const d = data === void 0 ? null : plain(data);
        if (bytes(JSON.stringify(d)) > limits.MaxRoomData) throw fail("invalid_argument", `data is at most ${limits.MaxRoomData} bytes of JSON`);
        if (!state.connected) return;
        await rpc("room.emit", { room: r.name, topic, data: d });
      },
      on(topic, h, onError) {
        if (!topicRe.test(topic)) throw fail("invalid_argument", `a topic matches ${topicRe}`);
        let set = r.topics.get(topic);
        if (!set) r.topics.set(topic, set = /* @__PURE__ */ new Set());
        return listen(set, h, onError);
      },
      async presence(patch) {
        check();
        if (!isPlain(patch)) throw fail("invalid_argument", "presence takes a plain object");
        const next = { ...r.presence };
        for (const [k, v] of Object.entries(plain(patch))) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        if (bytes(JSON.stringify(next)) > limits.MaxPresence || depth(next) > 8)
          throw fail("invalid_argument", `presence is at most ${limits.MaxPresence} bytes and 8 levels`);
        r.presence = next;
        r.peers = Object.freeze(r.peers.map((p) => p.isMe ? freeze({ ...p, presence: next, updatedAt: Date.now() }) : p));
        if (state.connected) await rpc("room.presence", { room: r.name, patch });
      },
      peers: () => r.peers,
      onPeers(h, onError) {
        const off = listen(r.peerHandlers, h, onError);
        queueMicrotask(() => {
          if (r.peerHandlers.has(h) && r.peers !== EMPTY) safe(() => h(Object.freeze({ peers: r.peers, joined: r.peers, left: EMPTY, updated: EMPTY })));
        });
        return off;
      },
      connected: () => state.connected && !r.left,
      onConnection(h, onError) {
        const off = listen(r.connHandlers, h, onError);
        queueMicrotask(() => r.connHandlers.has(h) && safe(() => h(state.connected)));
        return off;
      }
    };
  }
  async function lobby() {
    const r = roomOf("");
    if (!r.api) {
      await join(r);
      const base = api(r);
      r.api = Object.freeze({
        ...base,
        async join(name) {
          if (typeof name !== "string" || !roomRe.test(name)) throw fail("invalid_argument", `a room name matches ${roomRe}`);
          const nr = roomOf(name);
          if (nr.api && !nr.left) return nr.api;
          nr.left = false;
          try {
            await join(nr);
          } catch (e) {
            throw e?.code === "limit_reached" ? e : fail(e?.code === "invalid_argument" ? e.code : "upstream_error", e?.message || "join failed");
          }
          nr.api = Object.freeze({
            name,
            ...api(nr),
            async leave() {
              if (nr.left) return;
              nr.left = true;
              nr.joined = false;
              nr.peers = EMPTY;
              nr.topics.clear();
              nr.peerHandlers.clear();
              nr.connHandlers.clear();
              await rpc("room.leave", { room: name }).catch(() => {
              });
            }
          });
          return nr.api;
        },
        async sendToClaudeSession(data, opts) {
          if (!isPlain(data) || !Object.keys(data).length) throw fail("invalid_argument", "send a non-empty plain object");
          const body = { ...plain(data) };
          if (opts?.attachPresence !== false && Object.keys(r.presence).length) body.presence = r.presence;
          return Object.freeze(await rpc("room.sendToClaudeSession", { data: body, deliver: opts?.deliver === "send" ? "send" : "stage" }));
        },
        canSendToClaudeSession: () => rpc("room.canSendToClaudeSession").catch(() => "off")
      });
    }
    return r.api;
  }

  // src/chatapp/timeline.ts
  var TERMINAL = /* @__PURE__ */ new Set(["finished", "failed", "stopped"]);
  var num = (v) => typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0;
  var str = (v) => typeof v === "string" ? v : "";
  var first = (...vs) => {
    for (const v of vs) if (typeof v === "string" && v !== "") return v;
    return "";
  };
  var TEXT_SEP = ":text:";
  var parentOf = (segmentId) => {
    const i = segmentId.lastIndexOf(TEXT_SEP);
    return i > 0 ? segmentId.slice(0, i) : "";
  };
  var APPEND = /* @__PURE__ */ new Set(["CHAT_STREAM_PATCH_MODE_APPEND", "CHAT_STREAM_PATCH_MODE_UNSPECIFIED", "", void 0]);
  var applyPatch2 = (current, patch, mode) => APPEND.has(mode) ? current + patch : patch;
  var mergeCorrelation = (a, b) => {
    if (!b) return a;
    const out = { ...a || {} };
    for (const [k, v] of Object.entries(b)) if (v !== "" && v !== void 0 && v !== null) out[k] = v;
    return out;
  };
  var addUsage = (a, b) => {
    const out = {};
    for (const k of ["inputTokens", "outputTokens", "cachedTokens", "cacheCreationInputTokens", "cacheReadInputTokens"]) {
      const v = num(a?.[k]) + num(b?.[k]);
      if (v) out[k] = v;
    }
    return out;
  };
  var _entities, _ordinal, _fallback, _Timeline_instances, get_fn, put_fn, run_fn, reduce_fn, text_fn, thinking_fn, toolCall_fn;
  var Timeline = class {
    constructor() {
      __privateAdd(this, _Timeline_instances);
      __privateAdd(this, _entities, /* @__PURE__ */ new Map());
      __privateAdd(this, _ordinal, 0);
      // the ordinal the copy is current at
      __privateAdd(this, _fallback, 0);
      // creation order for events without an ordinal
      /** Increases with every change. */
      __publicField(this, "version", 0);
    }
    /** The ordinal of the last snapshot or event applied. */
    get ordinal() {
      return __privateGet(this, _ordinal);
    }
    /** A snapshot replaces the copy. */
    reset(snap) {
      __privateGet(this, _entities).clear();
      for (const e of snap.entities ?? []) {
        if (!e.tombstone) __privateGet(this, _entities).set(e.kind + "/" + e.id, { kind: e.kind, id: e.id, created: num(e.createdOrdinal), payload: e.payload ?? {} });
      }
      __privateSet(this, _ordinal, num(snap.snapshotOrdinal));
      this.version++;
    }
    /** Applies one UI event; true when the copy changed. An event the copy already reflects is ignored. */
    apply(ev) {
      const ord = num(ev.ordinal);
      if (ord && ord <= __privateGet(this, _ordinal)) return false;
      const changed = __privateMethod(this, _Timeline_instances, reduce_fn).call(this, ev.name, ev.payload ?? {}, ord);
      if (ord) __privateSet(this, _ordinal, ord);
      if (changed) this.version++;
      return changed;
    }
    entity(kind, id) {
      return __privateGet(this, _entities).get(kind + "/" + id);
    }
    /** Entities (of one kind), in creation order. */
    entities(kind) {
      const out = [...__privateGet(this, _entities).values()].filter((e) => !kind || e.kind === kind);
      return out.sort((a, b) => a.created - b.created);
    }
    /** Whether a run of the session is running. */
    get running() {
      return this.entities("ChatRun").some((e) => e.payload.status === "running");
    }
    /** The conversation: each question with its answer, in order. */
    answers() {
      const turns = /* @__PURE__ */ new Map();
      const turnOf = (run, order) => {
        let t = turns.get(run);
        if (!t) turns.set(run, t = { turn: { question: null, answer: null }, order });
        t.order = Math.min(t.order, order);
        return t.turn;
      };
      const answers = /* @__PURE__ */ new Map();
      for (const e of this.entities("ChatRun")) {
        const a = toAnswer(e.payload, e.id);
        answers.set(e.id, a);
        turnOf(e.id, e.created).answer = a;
      }
      const tools = /* @__PURE__ */ new Map();
      const parts = [];
      for (const e of this.entities()) {
        const p = e.payload;
        if (e.kind === "ChatMessage") {
          if (p.role === "user") {
            const run = e.id.endsWith("-user") ? e.id.slice(0, -5) : e.id;
            turnOf(run, e.created).question = { id: e.id, text: first(p.text, p.content), at: num(p.startedAtMs) };
          } else if (p.role === "assistant" || p.role === "thinking") {
            parts.push({
              run: str(p.parentMessageId),
              created: e.created,
              part: { kind: p.role === "thinking" ? "thinking" : "text", id: e.id, text: first(p.text, p.content), streaming: !!p.streaming, startedAt: num(p.startedAtMs), finishedAt: num(p.finishedAtMs) }
            });
          }
        } else if (e.kind === "ChatToolCall" || e.kind === "ChatToolResult" || e.kind === "ChatFrontendToolCall") {
          const call3 = str(p.toolCallId) || e.id;
          let t = tools.get(call3);
          if (!t) {
            t = { part: { kind: "tool", id: call3, name: "", input: void 0, result: void 0, error: "", status: "", state: "", where: "server", mode: "", executor: null, startedAt: 0, finishedAt: 0 }, created: e.created };
            tools.set(call3, t);
            parts.push({ run: str(e.kind === "ChatFrontendToolCall" ? p.parentMessageId : p.messageId), created: e.created, part: t.part });
          }
          mergeTool(t.part, e.kind, p);
          const run = str(e.kind === "ChatFrontendToolCall" ? p.parentMessageId : p.messageId);
          const holder = parts.find((x) => x.part === t.part);
          if (holder && !holder.run && run) holder.run = run;
        }
      }
      parts.sort((a, b) => a.created - b.created);
      for (const { run, part } of parts) {
        const a = answers.get(run);
        if (a) a.parts.push(part);
      }
      for (const a of answers.values()) a.text = a.parts.filter((x) => x.kind === "text").map((x) => x.text).join("\n\n");
      return [...turns.values()].sort((a, b) => a.order - b.order).map((t) => t.turn);
    }
    /** One answer by its run's message id. */
    answer(id) {
      for (const t of this.answers()) if (t.answer?.id === id) return t.answer;
      return null;
    }
  };
  _entities = new WeakMap();
  _ordinal = new WeakMap();
  _fallback = new WeakMap();
  _Timeline_instances = new WeakSet();
  get_fn = function(kind, id) {
    return __privateGet(this, _entities).get(kind + "/" + id)?.payload;
  };
  put_fn = function(kind, id, payload, ord) {
    const key = kind + "/" + id;
    const cur = __privateGet(this, _entities).get(key);
    __privateGet(this, _entities).set(key, { kind, id, created: cur ? cur.created : ord || ++__privateWrapper(this, _fallback)._, payload });
    return true;
  };
  run_fn = function(id, ord, fn) {
    if (!id) return false;
    const r = { ...__privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatRun", id) ?? {}, messageId: id };
    fn(r);
    return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatRun", id, r, ord);
  };
  reduce_fn = function(name, p, ord) {
    const id = str(p.messageId).trim();
    switch (name) {
      case "ChatUserMessageAccepted": {
        if (!id) return false;
        const content = first(p.content, p.text);
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatMessage", id, {
          messageId: id,
          role: first(p.role, "user"),
          prompt: p.prompt,
          content,
          text: content,
          status: first(p.status, "accepted"),
          attachments: p.attachments,
          startedAtMs: p.atMs,
          finishedAtMs: p.atMs
        }, ord);
      }
      case "ChatRunStarted":
        return __privateMethod(this, _Timeline_instances, run_fn).call(this, id, ord, (r) => Object.assign(r, { status: "running", prompt: p.prompt, model: p.model, startedAtMs: p.startedAtMs }));
      case "ChatRunFinished":
        return __privateMethod(this, _Timeline_instances, run_fn).call(this, id, ord, (r) => Object.assign(r, { status: "finished", truncated: p.truncated, reason: p.reason, finishedAtMs: p.finishedAtMs }));
      case "ChatRunStopped":
        return __privateMethod(this, _Timeline_instances, run_fn).call(this, id, ord, (r) => Object.assign(r, { status: "stopped", finishedAtMs: p.finishedAtMs }));
      case "ChatRunFailed": {
        if (!id) return false;
        __privateMethod(this, _Timeline_instances, run_fn).call(this, id, ord, (r) => Object.assign(r, { status: "failed", code: p.code, error: p.error, finishedAtMs: p.finishedAtMs }));
        const content = first(p.error, "Chat run failed");
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatMessage", id, {
          messageId: id,
          role: "error",
          content,
          text: content,
          status: first(p.status, "failed"),
          final: true,
          correlation: p.correlation,
          startedAtMs: p.finishedAtMs,
          finishedAtMs: p.finishedAtMs
        }, ord);
      }
      case "ChatProviderCallFinished":
        return __privateMethod(this, _Timeline_instances, run_fn).call(this, id, ord, (r) => {
          r.usage = addUsage(r.usage, p.usage);
          r.providerCalls = num(r.providerCalls) + 1;
        });
      case "ChatTextSegmentStarted":
      case "ChatTextPatch":
      case "ChatTextSegmentFinished":
        return __privateMethod(this, _Timeline_instances, text_fn).call(this, name, id, p, ord);
      case "ChatReasoningSegmentStarted":
      case "ChatReasoningPatch":
      case "ChatReasoningSegmentFinished":
        return __privateMethod(this, _Timeline_instances, thinking_fn).call(this, name, id, p, ord);
      case "ChatToolCallStarted":
      case "ChatToolArgumentsPatch":
      case "ChatToolCallRequested":
      case "ChatToolExecutionStarted":
      case "ChatToolCallFinished":
        return __privateMethod(this, _Timeline_instances, toolCall_fn).call(this, name, p, ord);
      case "ChatToolResultReady": {
        const call3 = str(p.toolCallId);
        if (!call3) return false;
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatToolResult", call3 + ":result", {
          messageId: p.messageId,
          toolCallId: call3,
          toolName: p.toolName,
          result: p.result,
          status: p.status,
          correlation: p.correlation
        }, ord);
      }
      case "ChatToolCallProgress": {
        const call3 = str(p.toolCallId);
        if (!call3) return false;
        const cur = { ...__privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatToolCall", call3) ?? {}, toolCallId: call3 };
        if (!cur.messageId) cur.messageId = p.messageId;
        cur.state = p.state;
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatToolCall", call3, cur, ord);
      }
      case "ChatFrontendToolCallRequested": {
        const call3 = str(p.toolCallId);
        if (!call3) return false;
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatFrontendToolCall", call3, {
          toolCallId: call3,
          toolName: p.toolName,
          parentMessageId: p.messageId,
          mode: p.mode,
          status: first(p.status, "requested"),
          input: p.input,
          executor: p.executor,
          requestedAtMs: p.atMs
        }, ord);
      }
      case "ChatFrontendToolResultReceived": {
        const call3 = str(p.toolCallId);
        if (!call3) return false;
        const cur = { ...__privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatFrontendToolCall", call3) ?? {}, toolCallId: call3 };
        if (p.toolName) cur.toolName = p.toolName;
        if (p.messageId) cur.parentMessageId = p.messageId;
        Object.assign(cur, { result: p.result, status: first(p.status, "success"), error: p.error, executor: p.executor, finishedAtMs: p.atMs });
        return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatFrontendToolCall", call3, cur, ord);
      }
      default:
        return false;
    }
  };
  // projections.go: ChatTextSegmentStarted / ChatTextPatch / ChatTextSegmentFinished
  text_fn = function(name, id, p, ord) {
    if (!id) return false;
    const had = __privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatMessage", id);
    const e = { ...had ?? {} };
    const current = first(e.content, e.text);
    let content;
    if (name === "ChatTextPatch") {
      content = applyPatch2(current, str(p.text), p.mode);
      if (content === "") return false;
    } else if (name === "ChatTextSegmentFinished") {
      content = first(p.content, p.text, current);
      if (content === "" && !had) return false;
    } else {
      content = current;
      if (content === "" && !had) return false;
    }
    e.messageId = id;
    e.role = first(p.role, "assistant");
    e.prompt = first(p.prompt, e.prompt);
    e.content = content;
    e.text = content;
    if (name === "ChatTextPatch") {
      e.status = first(p.status, "streaming");
      e.streaming = !p.final;
      e.final = p.final;
    } else if (name === "ChatTextSegmentFinished") {
      e.status = first(p.status, "finished");
      e.streaming = p.streaming;
      e.final = p.final;
    } else {
      e.status = first(p.status, "streaming");
      e.streaming = p.streaming;
    }
    if (!num(e.startedAtMs) && num(p.atMs)) e.startedAtMs = p.atMs;
    if (name === "ChatTextSegmentFinished") e.finishedAtMs = p.atMs;
    e.parentMessageId = parentOf(id);
    e.correlation = mergeCorrelation(e.correlation, p.correlation);
    return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatMessage", id, e, ord);
  };
  // plugins/reasoning.go: reasoningEntityFromFields
  thinking_fn = function(name, id, p, ord) {
    if (!id) return false;
    const had = __privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatMessage", id);
    const e = { ...had ?? {} };
    let content;
    if (name === "ChatReasoningPatch") content = applyPatch2(first(e.content, e.text), str(p.text), p.mode);
    else if (name === "ChatReasoningSegmentFinished") content = first(p.content, p.text);
    else content = "";
    if (content === "") content = first(e.content, e.text);
    if (content === "" && !had) return false;
    e.messageId = id;
    e.role = first(p.role, "thinking");
    e.content = content;
    e.text = content;
    e.parentMessageId = first(p.parentMessageId, e.parentMessageId);
    e.correlation = mergeCorrelation(e.correlation, p.correlation);
    e.segmentType = "reasoning";
    if (!num(e.startedAtMs) && num(p.atMs)) e.startedAtMs = p.atMs;
    if (name === "ChatReasoningSegmentFinished") {
      e.status = first(p.status, "finished");
      e.streaming = false;
      e.finishedAtMs = p.atMs;
    } else {
      e.status = first(p.status, "streaming");
      e.streaming = name === "ChatReasoningPatch" ? !p.final : p.streaming;
    }
    return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatMessage", id, e, ord);
  };
  // plugins/toolcall.go: toolCallFieldsFromCanonical + mergeToolCallFields
  toolCall_fn = function(name, p, ord) {
    const call3 = str(p.toolCallId);
    const status = first(
      p.status,
      { ChatToolCallStarted: "pending", ChatToolArgumentsPatch: "streaming_args", ChatToolCallRequested: "pending", ChatToolExecutionStarted: "executing", ChatToolCallFinished: "completed" }[name]
    );
    const input = name === "ChatToolArgumentsPatch" ? str(p.arguments) : name === "ChatToolCallFinished" ? "" : str(p.input);
    const e = { ...__privateMethod(this, _Timeline_instances, get_fn).call(this, "ChatToolCall", call3) ?? {} };
    if (p.messageId) e.messageId = p.messageId;
    if (call3) e.toolCallId = call3;
    if (p.toolName) e.toolName = p.toolName;
    if (input) e.input = status === "streaming_args" ? str(e.input) + input : input;
    e.executing = name === "ChatToolCallFinished" || name === "ChatToolArgumentsPatch" ? false : !!p.executing;
    if (status) e.status = status;
    e.correlation = mergeCorrelation(e.correlation, p.correlation);
    if (name === "ChatToolExecutionStarted") {
      if (!num(e.startedAtMs)) e.startedAtMs = p.atMs;
      e.state = "running";
    } else if (name === "ChatToolCallFinished") {
      e.status = "completed";
      e.executing = false;
      e.finishedAtMs = p.atMs;
      e.state = "";
    }
    return __privateMethod(this, _Timeline_instances, put_fn).call(this, "ChatToolCall", call3, e, ord);
  };
  function toAnswer(p, id) {
    const u = p.usage ?? {};
    return {
      id,
      status: first(p.status, "running"),
      code: str(p.code),
      error: str(p.error),
      truncated: !!p.truncated,
      reason: str(p.reason),
      model: str(p.model),
      startedAt: num(p.startedAtMs),
      finishedAt: num(p.finishedAtMs),
      usage: { input: num(u.inputTokens), output: num(u.outputTokens), cachedInput: num(u.cachedTokens) + num(u.cacheReadInputTokens) },
      providerCalls: num(p.providerCalls),
      parts: [],
      text: ""
    };
  }
  var parseMaybe = (v) => {
    if (typeof v !== "string" || v === "") return v === "" ? void 0 : v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  function mergeTool(t, kind, p) {
    t.name = first(p.toolName, t.name);
    if (kind === "ChatFrontendToolCall") {
      t.where = "browser";
      if (p.input !== void 0) t.input = p.input;
      if (p.result !== void 0) t.result = p.result;
      t.error = first(p.error, t.error);
      t.status = first(p.status, t.status);
      t.mode = first(p.mode, t.mode);
      t.executor = p.executor ?? t.executor;
      t.startedAt = num(p.requestedAtMs) || t.startedAt;
      t.finishedAt = num(p.finishedAtMs) || t.finishedAt;
    } else if (kind === "ChatToolCall") {
      if (t.input === void 0 && p.input !== void 0) t.input = parseMaybe(p.input);
      if (t.where === "server") t.status = first(p.status, t.status);
      t.state = str(p.state);
      t.startedAt = t.startedAt || num(p.startedAtMs);
      t.finishedAt = t.finishedAt || num(p.finishedAtMs);
    } else if (kind === "ChatToolResult") {
      if (t.result === void 0) t.result = parseMaybe(p.result);
      if (p.status === "error" && !t.error) t.error = typeof t.result === "string" ? t.result : "error";
    }
  }

  // src/chatapp/session.ts
  var ChatError = class extends Error {
    constructor(code, message, status = 0) {
      super(message);
      __publicField(this, "code");
      __publicField(this, "status");
      this.code = code;
      this.status = status;
    }
  };
  var clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0 && v !== null && v !== ""));
  var rid = (p) => p + Math.random().toString(36).slice(2, 10);
  var sleep = (ms, signal) => new Promise((resolve2) => {
    const t = setTimeout(resolve2, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve2()), { once: true });
  });
  async function request3(base, method, path, body, o) {
    const f = o.fetch ?? globalThis.fetch;
    const r = await f(base + path, {
      method,
      headers: { ...body === void 0 ? {} : { "Content-Type": "application/json" }, ...o.headers ?? {} },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const txt = await r.text();
    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = null;
    }
    if (!r.ok) {
      const e = data?.error;
      const code = (typeof e === "object" && e ? e.code : data?.code) || "http_" + r.status;
      throw new ChatError(code, (typeof e === "object" && e ? e.message : e) || "HTTP " + r.status, r.status);
    }
    return data;
  }
  async function readSSE(body, fn) {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (; ; ) {
      const x = await reader.read();
      if (x.done) return;
      buf += dec.decode(x.value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = "message";
        const data = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) await fn(event, data.join("\n"));
      }
    }
  }
  var _o, _listeners, _waits, _stream, _closed, _ready, _error, _tools, _client, _connection, _revision, _executor, _ran, _outbox, _calls, _Session_static, start_fn, _Session_instances, api_fn, register_fn, connect_fn, notify_fn, derive_fn, call_fn, deliver_fn;
  var _Session = class _Session {
    constructor(base, id, info, o) {
      __privateAdd(this, _Session_instances);
      __publicField(this, "id");
      __publicField(this, "base");
      __publicField(this, "timeline", new Timeline());
      __publicField(this, "info");
      __privateAdd(this, _o);
      __privateAdd(this, _listeners, /* @__PURE__ */ new Set());
      __privateAdd(this, _waits, /* @__PURE__ */ new Set());
      __privateAdd(this, _stream, new AbortController());
      __privateAdd(this, _closed, false);
      __privateAdd(this, _ready);
      __privateAdd(this, _error, null);
      // browser tools
      __privateAdd(this, _tools, []);
      __privateAdd(this, _client, rid("page-"));
      __privateAdd(this, _connection, rid("c-"));
      __privateAdd(this, _revision, 0);
      __privateAdd(this, _executor, null);
      __privateAdd(this, _ran, /* @__PURE__ */ new Set());
      __privateAdd(this, _outbox, /* @__PURE__ */ new Map());
      __privateAdd(this, _calls, /* @__PURE__ */ new Map());
      this.base = base.replace(/\/$/, "");
      this.id = id;
      this.info = info;
      __privateSet(this, _o, o);
    }
    /** Creates a session ({labels, data, id?}) and opens it. */
    static async create(base, req = {}, o = {}) {
      var _a;
      const out = await request3(base.replace(/\/$/, ""), "POST", "/sessions", clean(req), o);
      return __privateMethod(_a = _Session, _Session_static, start_fn).call(_a, base, out.sessionId, out.session ?? { id: out.sessionId }, o);
    }
    /** Opens an existing session: resolves after its first snapshot. */
    static async open(base, id, o = {}) {
      var _a;
      const out = await request3(base.replace(/\/$/, ""), "GET", "/sessions/" + encodeURIComponent(id), void 0, o);
      return __privateMethod(_a = _Session, _Session_static, start_fn).call(_a, base, id, out.session ?? { id }, o);
    }
    /** Connects to a session the caller already has (its info from create or list): resolves after the first snapshot. */
    static async attach(base, info, o = {}) {
      var _a;
      if (!info?.id) throw new ChatError("invalid_request", "attach needs the session's info with its id");
      return __privateMethod(_a = _Session, _Session_static, start_fn).call(_a, base, info.id, info, o);
    }
    /** Lists sessions that have all these labels. */
    static async list(base, labels = {}, o = {}) {
      const q = Object.entries(labels).map(([k, v]) => "label=" + encodeURIComponent(k + ":" + v)).join("&");
      const out = await request3(base.replace(/\/$/, ""), "GET", "/sessions" + (q ? "?" + q : ""), void 0, o);
      return out?.sessions ?? [];
    }
    /** Calls fn after every change (ev: the UI event; null: a snapshot). Returns an unsubscribe function. */
    on(fn) {
      __privateGet(this, _listeners).add(fn);
      return () => __privateGet(this, _listeners).delete(fn);
    }
    /** Sends a message; resolves with the run's message id (the answer's id). */
    async send(prompt, extra = {}) {
      const out = await __privateMethod(this, _Session_instances, api_fn).call(this, "POST", "/messages", { ...extra, prompt });
      const id = out?.messageId;
      if (!id) throw new ChatError("invalid_response", "the server accepted the message without naming its run");
      return id;
    }
    /** Resolves with the answer once it is finished, failed or stopped. */
    wait(id, signal) {
      return new Promise((resolve2, reject) => {
        const check = () => {
          if (signal?.aborted) return done(() => reject(signal.reason ?? new ChatError("aborted", "aborted")));
          if (__privateGet(this, _closed)) return done(() => reject(__privateGet(this, _error) ?? new ChatError("closed", "the session was closed")));
          const a = this.timeline.answer(id);
          if (a && TERMINAL.has(a.status)) done(() => resolve2(a));
        };
        const done = (fn) => {
          __privateGet(this, _waits).delete(check);
          fn();
        };
        __privateGet(this, _waits).add(check);
        signal?.addEventListener("abort", check, { once: true });
        check();
      });
    }
    async stop() {
      await __privateMethod(this, _Session_instances, api_fn).call(this, "POST", "/stop");
    }
    async delete() {
      await __privateMethod(this, _Session_instances, api_fn).call(this, "DELETE", "");
      this.close();
    }
    /** Stops the stream and the page's running tool calls. */
    close() {
      if (__privateGet(this, _closed)) return;
      __privateSet(this, _closed, true);
      __privateGet(this, _stream).abort();
      for (const c of __privateGet(this, _calls).values()) c.abort();
      __privateMethod(this, _Session_instances, notify_fn).call(this, null);
    }
    /** Registers the page's browser tools (replacing earlier ones) and runs the calls the server assigns to this page. */
    async tools(list) {
      __privateSet(this, _tools, list);
      await __privateMethod(this, _Session_instances, register_fn).call(this);
      __privateMethod(this, _Session_instances, derive_fn).call(this);
    }
  };
  _o = new WeakMap();
  _listeners = new WeakMap();
  _waits = new WeakMap();
  _stream = new WeakMap();
  _closed = new WeakMap();
  _ready = new WeakMap();
  _error = new WeakMap();
  _tools = new WeakMap();
  _client = new WeakMap();
  _connection = new WeakMap();
  _revision = new WeakMap();
  _executor = new WeakMap();
  _ran = new WeakMap();
  _outbox = new WeakMap();
  _calls = new WeakMap();
  _Session_static = new WeakSet();
  start_fn = async function(base, id, info, o) {
    var _a;
    const s = new _Session(base, id, info, o);
    let ready2;
    __privateSet(s, _ready, new Promise((r) => ready2 = r));
    void __privateMethod(_a = s, _Session_instances, connect_fn).call(_a, ready2);
    await __privateGet(s, _ready);
    if (__privateGet(s, _error)) throw __privateGet(s, _error);
    return s;
  };
  _Session_instances = new WeakSet();
  api_fn = async function(method, path, body) {
    return request3(this.base, method, "/sessions/" + encodeURIComponent(this.id) + path, body, __privateGet(this, _o));
  };
  register_fn = async function() {
    const out = await __privateMethod(this, _Session_instances, api_fn).call(this, "POST", "/tools/manifest", {
      clientInstanceId: __privateGet(this, _client),
      connectionId: __privateGet(this, _connection),
      revision: ++__privateWrapper(this, _revision)._,
      tools: __privateGet(this, _tools).map((t) => clean({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? { type: "object" }, mode: t.mode ?? "frontend", available: true }))
    });
    __privateSet(this, _executor, out?.executor ?? null);
  };
  connect_fn = async function(ready2) {
    const f = __privateGet(this, _o).fetch ?? globalThis.fetch;
    for (let attempt = 0; !__privateGet(this, _closed); attempt++) {
      try {
        const r = await f(this.base + "/sessions/" + encodeURIComponent(this.id) + "/events", { headers: __privateGet(this, _o).headers ?? {}, signal: __privateGet(this, _stream).signal });
        if (!r.ok || !r.body) {
          if (r.status >= 400 && r.status < 500) {
            __privateSet(this, _error, new ChatError(r.status === 404 ? "session_not_found" : "http_" + r.status, "the session's events are not available", r.status));
            ready2();
            this.close();
            return;
          }
          throw new Error("HTTP " + r.status);
        }
        await readSSE(r.body, async (event, data) => {
          if (event === "snapshot") {
            attempt = 0;
            this.timeline.reset(JSON.parse(data));
            if (__privateGet(this, _tools).length) await __privateMethod(this, _Session_instances, register_fn).call(this).catch(() => {
            });
            for (const o of __privateGet(this, _outbox).values()) o.next = 0;
            ready2();
            __privateMethod(this, _Session_instances, notify_fn).call(this, null);
          } else if (event === "ui") {
            const ev = JSON.parse(data);
            if (this.timeline.apply(ev)) __privateMethod(this, _Session_instances, notify_fn).call(this, ev);
          }
        });
      } catch {
        if (__privateGet(this, _closed)) return;
      }
      await sleep(Math.min(5e3, 250 * 2 ** attempt), __privateGet(this, _stream).signal);
    }
  };
  notify_fn = function(ev) {
    __privateMethod(this, _Session_instances, derive_fn).call(this);
    for (const fn of [...__privateGet(this, _listeners)]) {
      try {
        fn(ev);
      } catch (e) {
        console.error(e);
      }
    }
    for (const check of [...__privateGet(this, _waits)]) check();
  };
  // The browser tool calls this page must run or deliver, from the timeline.
  derive_fn = function() {
    if (!__privateGet(this, _tools).length) return;
    for (const e of this.timeline.entities("ChatFrontendToolCall")) {
      const p = e.payload;
      if (p.status === "requested") {
        if (__privateGet(this, _outbox).has(e.id)) __privateMethod(this, _Session_instances, deliver_fn).call(this, e.id);
        else void __privateMethod(this, _Session_instances, call_fn).call(this, e.id, p);
      } else {
        __privateGet(this, _outbox).delete(e.id);
        __privateGet(this, _calls).get(e.id)?.abort();
      }
    }
  };
  call_fn = async function(id, p) {
    if (__privateGet(this, _ran).has(id) || !__privateGet(this, _executor) || p.executor?.assignmentId !== __privateGet(this, _executor).assignmentId) return;
    __privateGet(this, _ran).add(id);
    const tool = __privateGet(this, _tools).find((t) => t.name === p.toolName);
    const ctrl = new AbortController();
    __privateGet(this, _calls).set(id, ctrl);
    let status = "success";
    let result = null;
    let error = "";
    try {
      if (!tool) throw new Error("this page has no tool " + p.toolName);
      result = await tool.execute(p.input ?? {}, { signal: ctrl.signal, callId: id });
      if (result === void 0) result = null;
      if (JSON.stringify(result) === void 0) result = String(result);
    } catch (e) {
      status = "failed";
      error = String(e?.message ?? e);
    } finally {
      __privateGet(this, _calls).delete(id);
    }
    if (ctrl.signal.aborted || __privateGet(this, _closed)) return;
    __privateGet(this, _outbox).set(id, { toolName: p.toolName, status, result, error, sending: false, tries: 0, next: 0 });
    __privateMethod(this, _Session_instances, deliver_fn).call(this, id);
  };
  // One delivery attempt; a network or server failure keeps the result for a later attempt.
  deliver_fn = function(id) {
    const r = __privateGet(this, _outbox).get(id);
    if (!r || r.sending || Date.now() < r.next) return;
    r.sending = true;
    __privateMethod(this, _Session_instances, api_fn).call(this, "POST", "/tools/results", clean({ toolCallId: id, toolName: r.toolName, status: r.status, result: r.result, error: r.error, executor: __privateGet(this, _executor) })).then(() => __privateGet(this, _outbox).delete(id)).catch((e) => {
      if (e instanceof ChatError && e.status >= 400 && e.status < 500) __privateGet(this, _outbox).delete(id);
      else {
        r.tries++;
        const wait = Math.min(5e3, 200 * 2 ** r.tries);
        r.next = Date.now() + wait;
        setTimeout(() => !__privateGet(this, _closed) && __privateMethod(this, _Session_instances, derive_fn).call(this), wait);
      }
    }).finally(() => {
      r.sending = false;
    });
  };
  __privateAdd(_Session, _Session_static);
  var Session = _Session;

  // src/agent.ts
  var BASE = "/_rt/agent";
  async function api2(method, path, body) {
    const r = await request(BASE + path, {
      method,
      headers: body === void 0 ? {} : { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const txt = await r.text();
    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = null;
    }
    if (!r.ok) {
      const e = data?.error;
      const code = (typeof e === "object" && e ? e.code : data?.code) || (r.status === 409 ? "run_active" : "upstream_error");
      throw fail(code, (typeof e === "object" && e ? e.message : e) || "HTTP " + r.status, { status: r.status });
    }
    return data;
  }
  var clean2 = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0 && v !== null && v !== ""));
  var asFail = (e) => e instanceof ChatError ? fail(e.code, e.message, { status: e.status }) : e;
  var fetchVia = ((input, init) => request(String(input), init));
  var _grant, _tools2, _core, _chat, _closed2, _run, _listeners2, _Session_instances2, start_fn2, derive_fn2, abort_fn;
  var Session2 = class {
    constructor(info, tools, fresh, grant) {
      __privateAdd(this, _Session_instances2);
      __publicField(this, "id");
      __publicField(this, "key");
      /** True when open() created the session: the server has no conversation yet. */
      __publicField(this, "fresh");
      __publicField(this, "info");
      __privateAdd(this, _grant);
      __privateAdd(this, _tools2);
      __privateAdd(this, _core);
      __privateAdd(this, _chat, null);
      __privateAdd(this, _closed2, false);
      __privateAdd(this, _run, null);
      __privateAdd(this, _listeners2, /* @__PURE__ */ new Set());
      __privateSet(this, _grant, grant);
      this.id = info.id;
      this.fresh = fresh;
      this.key = info.labels?.key ?? "";
      this.info = info;
      __privateSet(this, _tools2, tools);
      __privateSet(this, _core, Session.attach(BASE, info, { fetch: fetchVia }).then(
        async (chat) => {
          __privateSet(this, _chat, chat);
          chat.on((ev) => {
            if (ev) for (const fn of [...__privateGet(this, _listeners2)]) {
              try {
                fn(ev);
              } catch (e) {
                console.error(e);
              }
            }
            __privateMethod(this, _Session_instances2, derive_fn2).call(this);
          });
          if (__privateGet(this, _closed2)) chat.close();
          else if (__privateGet(this, _tools2).length) await chat.tools(__privateGet(this, _tools2)).catch(() => {
          });
          return chat;
        },
        (e) => {
          __privateGet(this, _run)?.reject(asFail(e));
          throw asFail(e);
        }
      ));
      __privateGet(this, _core).catch(() => {
      });
    }
    /** Whether a run of this session is running (from the timeline). */
    get running() {
      return !!__privateGet(this, _chat)?.timeline.running;
    }
    /** Calls fn with every UI event of the session (chatapp's names); returns an unsubscribe. */
    on(fn) {
      __privateGet(this, _listeners2).add(fn);
      return () => __privateGet(this, _listeners2).delete(fn);
    }
    /** Sends a message and resolves with the answer when the run ends. */
    send(prompt, o = {}) {
      if (typeof prompt !== "string" || !prompt.trim()) return Promise.reject(fail("invalid_request", "the message is empty"));
      if (__privateGet(this, _closed2)) return Promise.reject(fail("cancelled", "the session is closed"));
      if (__privateGet(this, _run)) return Promise.reject(fail("run_active", "an answer is still running in this session"));
      if (o.signal?.aborted) return Promise.reject(fail("cancelled", "the call was aborted"));
      let resolve2, reject, onCancel;
      const promise = new Promise((a, b) => (resolve2 = a, reject = b));
      const run = {
        id: "",
        stage: "preparing",
        aborted: false,
        settled: false,
        cancelled: new Promise((r) => onCancel = r),
        cancel: () => onCancel(),
        text: "",
        onText: o.onText,
        resolve: resolve2,
        reject
      };
      const onAbort = () => __privateMethod(this, _Session_instances2, abort_fn).call(this, run);
      const settle = () => {
        run.settled = true;
        o.signal?.removeEventListener("abort", onAbort);
        if (__privateGet(this, _run) === run) __privateSet(this, _run, null);
      };
      run.resolve = (r) => {
        if (!run.settled) {
          settle();
          resolve2(r);
        }
      };
      run.reject = (e) => {
        if (!run.settled) {
          settle();
          reject(e);
        }
      };
      run.cancelled.then(() => run.stage === "preparing" && run.reject(fail("cancelled", "the call was aborted")));
      __privateSet(this, _run, run);
      o.signal?.addEventListener("abort", onAbort, { once: true });
      void __privateMethod(this, _Session_instances2, start_fn2).call(this, run, prompt, o.context);
      return promise;
    }
    async stop() {
      await api2("POST", `/sessions/${this.id}/stop`).catch(() => {
      });
    }
    /** The conversation so far: [{role, text}] (user, assistant, thinking, error). */
    async history() {
      const v = await api2("GET", `/sessions/${this.id}`);
      this.info = v.session;
      const out = [];
      for (const e of v.snapshot?.entities ?? []) {
        if (e.kind === "ChatMessage" && e.payload && !e.tombstone) out.push({ role: e.payload.role, text: e.payload.text ?? e.payload.content ?? "" });
      }
      return freeze(out);
    }
    async delete() {
      this.close();
      await api2("DELETE", `/sessions/${this.id}`);
    }
    /** Ends the event stream; a run in progress keeps going on the server. */
    close() {
      __privateSet(this, _closed2, true);
      __privateGet(this, _chat)?.close();
      __privateGet(this, _run)?.reject(fail("cancelled", "the session was closed"));
    }
  };
  _grant = new WeakMap();
  _tools2 = new WeakMap();
  _core = new WeakMap();
  _chat = new WeakMap();
  _closed2 = new WeakMap();
  _run = new WeakMap();
  _listeners2 = new WeakMap();
  _Session_instances2 = new WeakSet();
  start_fn2 = async function(run, prompt, context) {
    const live = () => !run.settled && !run.aborted;
    try {
      await __privateGet(this, _grant).consent();
      if (!live()) return;
      const chat = await Promise.race([__privateGet(this, _core), run.cancelled.then(() => null)]);
      if (!chat || !live()) return;
      if (__privateGet(this, _tools2).length) await chat.tools(__privateGet(this, _tools2));
      if (!live()) return;
      run.stage = "posting";
      run.id = await chat.send(prompt, clean2({ context }));
      run.stage = "running";
      if (run.aborted) {
        run.reject(fail("cancelled", "the call was aborted"));
        void this.stop();
        return;
      }
      __privateMethod(this, _Session_instances2, derive_fn2).call(this);
    } catch (e) {
      run.reject(asFail(e));
    }
  };
  // The pending send's text and outcome, from the answer in the timeline.
  derive_fn2 = function() {
    const run = __privateGet(this, _run);
    if (!run || !run.id || !__privateGet(this, _chat)) return;
    const a = __privateGet(this, _chat).timeline.answer(run.id);
    if (!a) return;
    if (a.text !== run.text) {
      const before = run.text;
      run.text = a.text;
      run.onText?.({ text: a.text, delta: a.text.startsWith(before) ? a.text.slice(before.length) : "" });
    }
    if (!TERMINAL.has(a.status)) return;
    const extra = run.text ? { text: run.text } : void 0;
    if (a.status === "finished") run.resolve(freeze({ text: run.text, truncated: a.truncated }));
    else if (a.status === "stopped") run.reject(fail("cancelled", "the answer was stopped", extra));
    else run.reject(fail(a.code || "upstream_error", a.error || "the run failed", extra));
  };
  // An abort, at whatever stage the run is: preparing → nothing was posted,
  // the send rejects now; posting → #start stops the run once the 202 names
  // it; running → stop, and the run's answer settles it.
  abort_fn = function(run) {
    if (run.settled || run.aborted) return;
    run.aborted = true;
    run.cancel();
    if (run.stage === "running") void this.stop();
  };
  function agent(grant) {
    return freeze({
      /** Resumes the session with this key, or creates it with these settings. */
      async open(key, o = {}) {
        if (typeof key !== "string" || !key || key.length > 200) throw fail("invalid_request", "a session key is a string of 1 to 200 characters");
        const tools = o.tools ?? [];
        for (const t of tools) if (!t || typeof t.name !== "string" || typeof t.execute !== "function") throw fail("invalid_request", "a tool is {name, description, inputSchema, execute}");
        const find = async () => (await api2("GET", "/sessions?label=" + encodeURIComponent("key:" + key))).sessions?.[0] ?? null;
        let info = await find();
        let fresh = false;
        if (!info) {
          try {
            info = (await api2("POST", "/sessions", clean2({
              title: o.title,
              labels: clean2({ key, tier: o.modelTier, model: o.model, effort: o.effort }),
              data: clean2({ system: o.system, maxRounds: o.maxRounds, toolTimeout: o.toolTimeout, maxTokens: o.maxTokens })
            }))).session;
            fresh = true;
          } catch (e) {
            if (e?.code !== "session_exists" || !(info = await find())) throw e;
          }
        }
        return new Session2(info, tools, fresh, grant);
      },
      /** The person's sessions in this app. */
      async list() {
        const l = await api2("GET", "/sessions");
        return freeze((l.sessions ?? []).map((s) => freeze({
          id: s.id,
          key: s.labels?.key ?? "",
          title: s.title ?? "",
          created: s.created,
          updated: s.updated,
          running: !!s.running,
          usage: s.usage
        })));
      },
      async limits() {
        return freeze(await rpc("agent.limits"));
      }
    });
  }

  // src/sample.ts
  var cache = /* @__PURE__ */ new Map();
  function checkInput(input) {
    if (typeof input === "string") {
      if (!input.trim()) throw fail("invalid_request", "the prompt is empty");
      if (bytes(input) > limits.MaxPromptBytes) throw fail("prompt_too_large", `a prompt is at most ${limits.MaxPromptBytes} bytes`);
      return input;
    }
    if (!Array.isArray(input) || !input.length) throw fail("invalid_request", "input is a string or a list of turns");
    let n = 0;
    for (const t of input) {
      if (!t || t.role !== "user" && t.role !== "assistant" || typeof t.content !== "string") throw fail("invalid_request", "a turn is {role: user|assistant, content: string}");
      n += bytes(t.content);
    }
    if (input[0].role !== "user" || input[input.length - 1].role !== "user") throw fail("invalid_request", "turns begin and end with a user turn");
    if (n > limits.MaxPromptBytes) throw fail("prompt_too_large", `a prompt is at most ${limits.MaxPromptBytes} bytes`);
    return input.map((t) => ({ role: t.role, content: t.content }));
  }
  async function prepare(blob) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(blob.type)) throw fail("image_rejected", "images are JPEG, PNG, WebP or GIF");
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const buf = new Uint8Array(await jpeg.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
    return { mimeType: "image/jpeg", data: btoa(bin) };
  }
  var codes = {
    cancelled: "cancelled",
    images_unavailable: "images_unavailable",
    prompt_too_large: "prompt_too_large",
    empty_completion: "empty_completion",
    rate_limited: "rate_limited",
    invalid_request: "invalid_request",
    sampling_disabled: "sampling_disabled",
    not_granted: "not_granted",
    not_declared: "not_declared",
    session_expired: "session_expired",
    image_rejected: "image_rejected"
  };
  async function call2(images, grant, input, o = {}) {
    const prompt = checkInput(input);
    const tools = o.tools ?? [];
    if (tools.length > 16) throw fail("tools_unavailable", "at most 16 tools");
    for (const t of tools) if (!t || typeof t.name !== "string" || typeof t.execute !== "function") throw fail("invalid_request", "a tool is {name, description, execute}");
    const list = o.images ? o.images instanceof Blob ? [o.images] : Array.from(o.images) : [];
    if (list.length && !images) throw fail("images_unavailable", "declare sample: {images: true} to send images");
    if (o.signal?.aborted) throw fail("cancelled", "the call was aborted");
    const tier = o.modelTier && o.modelTier !== "inherit" ? o.modelTier : "default";
    const useCache = o.cache !== false && !tools.length && !list.length && !o.onText;
    const ttl = typeof o.cache === "object" && o.cache.gcTime ? o.cache.gcTime : 5 * 6e4;
    const key = canon({ prompt, tier, model: o.model ?? null, effort: o.effort ?? null });
    if (useCache && !(typeof o.cache === "object" && o.cache.refresh)) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < hit.ttl) return hit.result;
    }
    await grant.consent();
    const body = {
      input: prompt,
      modelTier: tier,
      model: o.model,
      effort: o.effort,
      tools: tools.map((t) => ({ name: t.name, description: String(t.description ?? ""), inputSchema: t.inputSchema })),
      images: list.length ? await Promise.all(list.map(prepare)) : void 0
    };
    const ctrl = new AbortController();
    let callId = "";
    let text = "";
    const onAbort = () => {
      if (callId) void request(`/_rt/sample/${callId}/cancel`, { method: "POST" }).catch(() => {
      });
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
      for (; ; ) {
        const x = await reader.read();
        if (x.done) break;
        buf += dec.decode(x.value, { stream: true });
        let i;
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
              break;
            case "text":
              text = ev.text;
              o.onText?.({ text: ev.text, delta: ev.delta });
              break;
            case "tool":
              void runTool(callId, tools, ev, ctrl.signal);
              break;
            case "result": {
              const res = freeze({
                text: ev.text,
                truncated: !!ev.truncated,
                modelTierApplied: ev.modelTierApplied ?? tier,
                ...ev.modelApplied ? { modelApplied: ev.modelApplied } : {}
              });
              if (useCache) cache.set(key, { at: Date.now(), ttl, result: res });
              return res;
            }
            case "error":
              throw fail(codes[ev.code] ?? "upstream_error", ev.message ?? "the model call failed", ev.text || text ? { text: ev.text || text } : void 0);
          }
        }
      }
      if (o.signal?.aborted) throw fail("cancelled", "the call was aborted", text ? { text } : void 0);
      throw fail("upstream_error", "the call ended without a result", text ? { text } : void 0);
    } catch (e) {
      if (o.signal?.aborted || e?.name === "AbortError") throw fail("cancelled", "the call was aborted", text ? { text } : void 0);
      throw e;
    } finally {
      o.signal?.removeEventListener("abort", onAbort);
    }
  }
  async function runTool(callId, tools, ev, signal) {
    const t = tools.find((x) => x.name === ev.name);
    let value, isError = false;
    try {
      if (!t) throw new Error("no tool " + ev.name);
      value = await t.execute(ev.input ?? {}, { signal });
      if (value === void 0) value = null;
      let s = JSON.stringify(value);
      if (s === void 0) s = "null";
      if (bytes(s) > limits.MaxToolResultBytes) {
        value = "The tool result exceeded 32 KB and was dropped.";
        isError = true;
      }
    } catch (e) {
      value = String(e?.message ?? e);
      isError = true;
    }
    if (signal.aborted) return;
    await request(`/_rt/sample/${callId}/tools/${encodeURIComponent(ev.use)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, isError })
    }).catch(() => {
    });
  }
  function parseJSON(text) {
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
      }
    }
    throw fail("invalid_json", "the reply is not JSON", { text });
  }
  function sample(h, grant) {
    const images = !!h.caps.sample?.images;
    const fn = (input, o) => call2(images, grant, input, o);
    return Object.freeze(Object.assign(fn, {
      json: async (input, o) => parseJSON((await call2(images, grant, input, o)).text),
      limits: async () => {
        try {
          return freeze(await rpc("sample.limits"));
        } catch {
          return freeze({ maxPromptBytes: limits.MaxPromptBytes });
        }
      }
    }));
  }

  // src/static.ts
  var META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  function staticDb(docs) {
    const snap = (path) => {
      const b = docs[path] ? freeze(docs[path]) : void 0;
      return Object.freeze({ id: idOf(path), exists: !!b, data: () => b, metadata: META });
    };
    const ro = () => Promise.reject(fail("invalid_argument", "this page is read-only"));
    const query2 = (coll, q) => ({
      where: (field, op, value) => query2(coll, { ...q, filters: [...q.filters ?? [], { field, op, value }] }),
      orderBy: (field, dir = "asc") => query2(coll, { ...q, order: field, desc: dir === "desc" }),
      limit: (n) => query2(coll, { ...q, limit: n }),
      async get() {
        const bad = validate(q);
        if (bad) throw fail("invalid_argument", bad);
        const rows = Object.keys(docs).filter((p) => collOf(p) === coll && !p.slice(coll.length + 1).includes("/")).map((p) => ({ path: p, body: docs[p], version: 1 }));
        const out = apply(q, rows).map((r) => snap(r.path));
        const changes = Object.freeze(out.map((doc, i) => Object.freeze({ type: "added", doc, oldIndex: -1, newIndex: i })));
        return Object.freeze({ docs: Object.freeze(out), size: out.length, empty: !out.length, docChanges: () => changes, metadata: META });
      },
      onSnapshot(next) {
        this.get().then(next);
        return () => {
        };
      }
    });
    const docRef2 = (path) => {
      checkPath(path, true);
      return Object.freeze({
        id: idOf(path),
        path,
        get: async () => snap(path),
        set: ro,
        update: ro,
        delete: ro,
        acquire: ro,
        onSnapshot(next) {
          queueMicrotask(() => next(snap(path)));
          return () => {
          };
        },
        collection: (sub) => collRef2(path + "/" + sub)
      });
    };
    const collRef2 = (path) => {
      checkPath(path, false);
      return Object.freeze({ ...query2(path, { coll: path }), path, doc: (id) => docRef2(path + "/" + id), add: ro });
    };
    return Object.freeze({ doc: docRef2, collection: collRef2 });
  }
  var staticUser = Object.freeze({
    isOwner: async () => false,
    canEdit: async () => false,
    can: async () => false,
    me: async () => freeze({ id: null, name: "", avatarUrl: "", color: "hsl(0 0% 55%)", email: null, isOwner: false, canEdit: false }),
    id: async () => null,
    profiles: async () => freeze({})
  });

  // src/url.ts
  var MAX = 1024;
  function syncFragment() {
    if (window.parent === window || boot.mode !== "app") return;
    let last = location.hash;
    const report = () => {
      if (location.hash === last) return;
      last = location.hash;
      post({ type: "hash", hash: last.length <= MAX ? last : "" });
    };
    addEventListener("hashchange", report);
    addEventListener("popstate", report);
    for (const k of ["pushState", "replaceState"]) {
      const f = history[k].bind(history);
      history[k] = (data, unused, url) => {
        f(data, unused, url);
        report();
      };
    }
    on("shell:hash", (m) => {
      const h = m.hash;
      if (typeof h !== "string" || h.length > MAX || h !== "" && h[0] !== "#" || h === location.hash) return;
      const oldURL = location.href;
      last = h;
      if (h) {
        location.replace(oldURL.split("#")[0] + h);
      } else {
        history.replaceState(history.state, "", location.pathname + location.search);
        dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
      }
    });
  }

  // src/index.ts
  var memo = /* @__PURE__ */ new Map();
  async function resolve(name) {
    if (boot.mode === "static") {
      if (name === "db") return staticDb(boot.runtime?.docs ?? {});
      if (name === "user") return staticUser;
      return null;
    }
    const h = await connect();
    initPermissions(h);
    if (name === "permissions") return permissions;
    if (!h) return null;
    if (name === "self") name = "artifact";
    if (!(name in h.caps)) return null;
    switch (name) {
      case "db":
        return db;
      case "user":
        return user(h);
      case "room":
        return lobby();
      case "comments":
        return comments(h, grantFor(name));
      case "assets":
        return assets;
      case "downloads":
        return downloads;
      case "files":
        return files();
      case "artifact":
        return artifact;
      case "sample":
        return sample(h, grantFor(name));
      case "agent":
        return agent(grantFor(name));
      case "slop":
        return slop(h);
    }
    return null;
  }
  function use(name) {
    if (typeof name !== "string") return Promise.resolve(null);
    let p = memo.get(name);
    if (!p) {
      p = new Promise((r) => setTimeout(r, 0)).then(() => resolve(name)).catch((e) => {
        console.warn("claude.use(" + name + "):", e);
        return null;
      });
      memo.set(name, p);
    }
    return p;
  }
  var claude = Object.freeze({ use });
  try {
    Object.defineProperty(window, "claude", { value: claude, writable: false, configurable: false, enumerable: true });
  } catch {
    window.claude = claude;
  }
  if (boot.mode === "app") void connect();
  syncFragment();
})();
