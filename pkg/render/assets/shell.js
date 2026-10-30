// The shell of a live route on a site host (SLOP-011). It opens a view for
// whoever is signed in on this host and frames the app on its target's own
// origin, speaking the protocol the Workshop's /run speaks (AppScreen): the
// secret goes to the frame by postMessage, never in a URL, and consent and
// downloads are asked here, where the page cannot fake them.
(() => {
  "use strict";
  const boot = JSON.parse(document.getElementById("slop-shell").textContent);
  const frame = document.getElementById("app");
  const note = document.getElementById("note");
  const meEl = document.getElementById("me");
  const RENEW_MS = 45 * 60 * 1000;
  let view = null;

  const call = async (method, url, body) => {
    const r = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const here = () => location.pathname + location.search;
  const signIn = () => "/_site/login?return=" + encodeURIComponent(here());
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  // say shows a message instead of the app, with an optional link.
  const say = (text, link, label) => {
    frame.hidden = true;
    note.hidden = false;
    note.replaceChildren(text, ...(link ? [" ", el("a", { href: link, textContent: label })] : []));
  };

  const fromFrame = (e) => {
    if (!view || e.source !== frame.contentWindow || e.origin !== view.origin) return false;
    try { return new URL(e.origin).host.endsWith("." + boot.sandbox); } catch { return false; }
  };
  const post = (m) => { if (view) frame.contentWindow.postMessage({ ...m, slop: 1 }, view.origin); };
  const give = () => { if (view) post({ type: "view", view: view.view, secret: view.secret, expiresAt: view.expiresAt }); };

  async function me() {
    const { body } = await call("GET", "/_site/me");
    if (body.kind === "user") {
      const out = el("button", { type: "button", className: "shell-link", textContent: "Sign out" });
      out.onclick = async () => { await call("POST", "/_site/logout", {}); location.reload(); };
      meEl.replaceChildren(el("span", { textContent: body.name || "Signed in" }), out);
    } else {
      meEl.replaceChildren(el("a", { href: signIn(), textContent: "Sign in" }));
    }
  }

  async function open(keepFrame) {
    const { status, body } = await call("POST", "/_site/views", { path: location.pathname });
    if (status === 401) return say("Sign in to open this.", signIn(), "Sign in");
    if (status === 403) return say("You do not have access to this.");
    if (status !== 200) return say(body.error?.message || "This could not be opened.");
    const old = view;
    view = body;
    if (keepFrame && old) {
      view.url = old.url;
    } else {
      frame.src = view.url + location.hash;
    }
    frame.hidden = false;
    note.hidden = true;
    if (old && old.view !== view.view && !keepFrame) close(old);
  }

  // renew keeps the secret fresh; a view the server forgot (a restart) is
  // reopened, and the frame keeps its place.
  async function renew() {
    if (!view) return;
    const { status, body } = await call("POST", `/_site/views/${view.view}/renew`, {});
    if (status === 200) Object.assign(view, body);
    else await open(true);
    give();
  }

  function close(v) {
    fetch(`/_site/views/${v.view}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
  }

  // ask shows a dialog; resolves true for ok.
  function ask(title, text, ok) {
    return new Promise((resolve) => {
      const done = (yes) => { box.remove(); resolve(yes); };
      const cancel = el("button", { type: "button", className: "shell-btn", textContent: "Cancel", onclick: () => done(false) });
      const go = el("button", { type: "button", className: "shell-btn primary", textContent: ok, onclick: () => done(true) });
      const box = el("div", { className: "shell-modal" },
        el("div", { className: "shell-dialog", role: "dialog", ariaLabel: title },
          el("h2", { textContent: title }), el("p", { textContent: text }), el("footer", {}, cancel, go)));
      box.onclick = (e) => { if (e.target === box) done(false); };
      document.body.append(box);
      go.focus();
    });
  }

  const what = { sample: "Claude (sample): it sends text you see to a model, as you", comments: "comments: it writes threads as you" };

  addEventListener("message", async (e) => {
    if (!fromFrame(e)) return;
    const m = e.data;
    if (!m || m.slop !== 1) return;
    switch (m.type) {
      case "hello": give(); return;
      case "renew": await renew(); return;
      case "consent": {
        const names = Array.isArray(m.names) ? m.names : [];
        const yes = await ask(`Allow ${boot.title}?`, `It asks to use ${names.map((n) => what[n] || n).join("; ")}.`, "Allow");
        const states = Object.fromEntries(names.map((n) => [n, yes ? "granted" : "denied"]));
        if (yes) await call("POST", `/_site/views/${view.view}/consent`, states);
        post({ id: m.id, states });
        return;
      }
      case "download": {
        if (!(m.data instanceof Blob)) return post({ id: m.id, status: "declined" });
        const kb = Math.max(1, Math.round(m.data.size / 1024));
        if (!(await ask("Save a file?", `${boot.title} offers ${m.filename} (${kb} KB).`, "Save"))) return post({ id: m.id, status: "declined" });
        const url = URL.createObjectURL(m.data);
        el("a", { href: url, download: String(m.filename) }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        post({ id: m.id, status: "saved" });
        return;
      }
      case "compose": post({ id: m.id, opened: false }); return; // no comments on the site yet
      case "permissions": post({ id: m.id }); return;
      case "reload": await open(false); return; // the route serves the new version
      case "args": {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(m.args || {})) if (typeof v === "string" && v) q.set(k, v);
        const h = q.toString();
        history.replaceState(history.state, "", here() + (h ? "#" + h : ""));
        return;
      }
    }
  });
  addEventListener("pagehide", () => { if (view) close(view); });
  setInterval(renew, RENEW_MS);
  me();
  open(false);
})();
