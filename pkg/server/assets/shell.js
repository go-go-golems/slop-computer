// The shell of a mount on a live host (ported from slop-computer SLOP-011).
// It opens a view for whoever this browser is on this host (a user, a
// guest, or nobody) and frames the app on its store's sandbox origin: the
// secret goes to the frame by postMessage, never in a URL, and consent and
// downloads are asked here, where the page cannot fake them.
(() => {
  "use strict";
  const boot = JSON.parse(document.getElementById("slop-shell").textContent);
  const frame = document.getElementById("app");
  const note = document.getElementById("note");
  const meEl = document.getElementById("me");
  const shareEl = document.getElementById("share");
  const RENEW_MS = 45 * 60 * 1000;
  let view = null;
  let signedIn = false;
  let kind = "none"; // none, guest or user: who /_site/me said this is
  let role = "";

  const call = async (method, url, body) => {
    const r = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // A share link's token arrives as ?k=; it is sent once, then taken out
  // of the address bar so it is not bookmarked, shared or sent as a Referer.
  const params = new URLSearchParams(location.search);
  let link = params.get("k") || "";
  if (link) {
    params.delete("k");
    const q = params.toString();
    history.replaceState(history.state, "", location.pathname + (q ? "?" + q : "") + location.hash);
  }
  const here = () => location.pathname + location.search;
  // signIn keeps a share link that has not been used yet across the
  // handoff, and the page's place (the fragment).
  const signIn = () => {
    const back = here() + (link ? (location.search ? "&" : "?") + "k=" + encodeURIComponent(link) : "") + location.hash;
    return "/_site/login?return=" + encodeURIComponent(back);
  };
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  // say shows a message instead of the app, with an optional link or
  // button (a function).
  const say = (text, action, label) => {
    frame.hidden = true;
    note.hidden = false;
    const more = typeof action === "function"
      ? el("button", { type: "button", className: "shell-btn primary", textContent: label, onclick: action })
      : action ? el("a", { href: action, textContent: label }) : null;
    note.replaceChildren(el("div", {}, el("p", { textContent: text }), ...(more ? [more] : [])));
  };

  // create makes a new instance of this route's app and goes there.
  async function create() {
    const { status, body } = await call("POST", "/_site/create", { path: location.pathname });
    if (status === 201) return location.assign(body.path);
    if (status === 401) return say("Sign in to create one.", signIn(), "Sign in");
    say(body.error?.message || "It could not be created.");
  }

  const fromFrame = (e) => {
    if (!view || e.source !== frame.contentWindow || e.origin !== view.origin) return false;
    try { return new URL(e.origin).host.endsWith("." + boot.sandbox); } catch { return false; }
  };
  const post = (m) => { if (view) frame.contentWindow.postMessage({ ...m, slop: 1 }, view.origin); };
  const give = () => { if (view) post({ type: "view", view: view.view, secret: view.secret, expiresAt: view.expiresAt }); };

  async function me() {
    const { body } = await call("GET", "/_site/me");
    kind = body.kind;
    role = body.role || "";
    signedIn = kind === "user";
    if (body.kind === "guest") {
      meEl.replaceChildren(el("span", { textContent: "Guest" }), el("a", { href: signIn(), textContent: "Sign in" }));
    } else if (signedIn) {
      const out = el("button", { type: "button", className: "shell-link", textContent: "Sign out" });
      out.onclick = async () => { await call("POST", "/_site/logout", {}); location.reload(); };
      meEl.replaceChildren(el("span", { textContent: body.name || "Signed in" }), out);
    } else {
      meEl.replaceChildren(el("a", { href: signIn(), textContent: "Sign in" }));
    }
    return body;
  }

  async function open(keepFrame) {
    const { status, body } = await call("POST", "/_site/views", { path: location.pathname, link });
    if (status === 401) return say(link ? "Sign in to open what was shared with you." : "Sign in to open this.", signIn(), "Sign in");
    if (body.error?.code === "no_instance") {
      if (body.mayCreate) return say("There is nothing here yet.", create, "Create a new one");
      if (body.create && !signedIn) return say("There is nothing here yet. Sign in to create one.", signIn(), "Sign in");
      return say("There is nothing here.");
    }
    if (body.error?.code === "link_invalid") { link = ""; return say("This share link has expired or was revoked.", here(), "Try without it"); }
    if (status === 403) return say("You do not have access to this.");
    if (status !== 200) return say(body.error?.message || "This could not be opened.");
    const old = view;
    view = body;
    link = "";
    if (kind === "none") me(); // opening a public route made this browser a guest
    shareEl.hidden = !(view.level === "owner" || role === "admin");
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

  // ask shows a dialog: true for ok, false for the other button, null when
  // dismissed.
  function ask(title, text, ok, no = "Cancel") {
    return new Promise((resolve) => {
      const done = (yes) => { box.remove(); resolve(yes); };
      const cancel = el("button", { type: "button", className: "shell-btn", textContent: no, onclick: () => done(false) });
      const go = el("button", { type: "button", className: "shell-btn primary", textContent: ok, onclick: () => done(true) });
      const box = el("div", { className: "shell-modal" },
        el("div", { className: "shell-dialog", role: "dialog", ariaLabel: title },
          el("h2", { textContent: title }), el("p", { textContent: text }), el("footer", {}, cancel, go)));
      box.onclick = (e) => { if (e.target === box) done(null); };
      document.body.append(box);
      go.focus();
    });
  }

  // share is the owner's dialog: who may open this, and links to it. Owners
  // give view or interact; more is for admins in the Workshop.
  async function share() {
    const body = el("div", { className: "shell-share" });
    const close = el("button", { type: "button", className: "shell-btn", textContent: "Done" });
    const box = el("div", { className: "shell-modal" },
      el("div", { className: "shell-dialog wide", role: "dialog", ariaLabel: "Share" }, el("h2", { textContent: "Share " + boot.title }), body, el("footer", {}, close)));
    const done = () => box.remove();
    close.onclick = done;
    box.onclick = (e) => { if (e.target === box) done(); };
    document.body.append(box);
    const path = location.pathname;
    const levels = [["", "No"], ["view", "Can view"], ["interact", "Can edit"]];
    const said = { view: "Can view", interact: "Can edit", admin: "Admin", owner: "Owner" };
    const select = (value, onchange) => {
      const s = el("select", { className: "shell-sel" }, ...levels.map(([v, t]) => el("option", { value: v, textContent: t, selected: v === value })));
      s.onchange = () => onchange(s.value);
      return s;
    };
    const render = async () => {
      const { status, body: a } = await call("POST", "/_site/access", { path });
      if (status !== 200) return body.replaceChildren(el("p", { textContent: a.error?.message || "Sharing is not available." }));
      const level = (sub) => a.grants.find((g) => g.subject === sub)?.level || "";
      const grant = async (subject, lv) => {
        const r = await call("POST", "/_site/grants", { path, subject, level: lv });
        if (r.status !== 200) alert(r.body.error?.message || "That did not work.");
        render();
      };
      const people = a.grants.filter((g) => g.subject[0] !== "@").map((g) =>
        el("div", { className: "shell-line" }, el("span", { textContent: (g.name || g.subject) + (g.via && g.via.startsWith("lnk_") ? " (by link)" : "") }), el("span", { className: "shell-dim", textContent: said[g.level] || g.level }),
          el("button", { type: "button", className: "shell-link", textContent: "Remove", onclick: () => grant(g.subject, "") })));
      const out = el("div", { className: "shell-made" });
      const make = el("button", { type: "button", className: "shell-btn", textContent: "Make a link" });
      const lv = select("view", () => {});
      lv.querySelector('option[value=""]').remove();
      make.onclick = async () => {
        const r = await call("POST", "/_site/links", { path, level: lv.value, days: 30 });
        if (r.status !== 201) return alert(r.body.error?.message || "No link was made.");
        const input = el("input", { className: "shell-url", readOnly: true, value: r.body.url });
        const copy = el("button", { type: "button", className: "shell-btn primary", textContent: "Copy", onclick: async () => { await navigator.clipboard.writeText(r.body.url).catch(() => input.select()); copy.textContent = "Copied"; } });
        out.replaceChildren(input, copy, el("p", { className: "shell-dim", textContent: "Shown once. It works for 30 days, for whoever opens it." }));
      };
      const links = a.links.map((l) =>
        el("div", { className: "shell-line" }, el("span", { textContent: `Link ${l.id.slice(4, 10)}` }), el("span", { className: "shell-dim", textContent: said[l.level] }),
          el("button", { type: "button", className: "shell-link", textContent: "Revoke", onclick: async () => { await call("POST", `/_site/links/${l.id}/revoke`, { path }); render(); } })));
      body.replaceChildren(
        el("div", { className: "shell-line" }, el("span", { textContent: "Everyone signed in" }), select(level("@member"), (v) => grant("@member", v))),
        el("div", { className: "shell-line" }, el("span", { textContent: "Anyone, guests too" }), select(level("@guest"), (v) => grant("@guest", v))),
        ...(people.length ? [el("h3", { textContent: "People" }), ...people] : []),
        el("h3", { textContent: "Links" }), ...links,
        el("div", { className: "shell-line" }, lv, make), out);
    };
    render();
  }
  shareEl.onclick = share;

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
      case "confirm": { // an app asks to change something for this person (SLOP3-002)
        const id = encodeURIComponent(String(m.confirm || ""));
        const c = await call("GET", `/_site/confirm/${id}`);
        if (c.status !== 200) return post({ id: m.id, approved: false });
        const yes = await ask(`Allow ${c.body.title || boot.title} to do this?`, c.body.summary, "Allow");
        const ok = !!yes && (await call("POST", `/_site/confirm/${id}`)).status === 200;
        post({ id: m.id, approved: ok });
        return;
      }
      case "compose": post({ id: m.id, opened: false }); return; // no comments on the site yet
      case "permissions": post({ id: m.id }); return;
      case "signin": location.assign(signIn()); return; // the page asked: claude.use("slop").signIn()
      case "reload": await open(false); return; // the route serves the new version
      case "reopen": await open(false); return; // access changed: a new view, a fresh frame
      case "hash": {
        // the page's place in itself, mirrored into the address bar (a deep
        // link); only the fragment, never the path
        const h = typeof m.hash === "string" ? m.hash : "";
        if (h.length > 1024 || (h && h[0] !== "#") || /\s/.test(h)) return;
        if (h !== location.hash) history.replaceState(history.state, "", here() + h);
        return;
      }
    }
  });
  addEventListener("pagehide", () => { if (view) close(view); });
  // a fragment typed into the address bar (or Back over one) goes to the page
  addEventListener("hashchange", () => post({ type: "hash", hash: location.hash }));
  setInterval(renew, RENEW_MS);
  // offer asks once whether to keep what this person did as a guest before
  // signing in; dismissing the dialog asks again next time.
  async function offer(claim) {
    const what = [claim.docs ? `${claim.docs} of your own ${claim.docs === 1 ? "entry" : "entries"}` : "", claim.grants ? `access to ${claim.grants} ${claim.grants === 1 ? "thing" : "things"}` : ""].filter(Boolean).join(" and ");
    const yes = await ask("Keep what you did as a guest?", `Before you signed in, you used this site as a guest: ${what}. Keep it in your account?`, "Keep it", "Leave it");
    if (yes === null) return;
    await call("POST", "/_site/claim", { keep: yes });
    if (yes) await open(false);
  }

  me().then((m) => { open(false); if (m?.claim) offer(m.claim); }, () => open(false)); // open needs to know whether someone is signed in
})();
