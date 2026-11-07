// SLOP3-015: the catalog views' shared kit. A view page includes this file
// and views.css, then:
//
//   const { catalog, views } = await SlopCatalog.load();
//   SlopCatalog.header(document.querySelector("#head"), "list");
//   SlopCatalog.viewer.bind(catalog);   // ?open=<id> opens the viewer
//
// Everything is read from /catalog/data/ on this (static) host.
(function () {
  "use strict";
  const ROOT = "/catalog/";
  let loaded = null;

  // el("a", {href: "/", class: "x", onclick: fn}, "text", child, …)
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }

  function bytes(n) {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i];
  }

  function date(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function monogram(item, cls) {
    const letters = (item.title || item.id).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
      .slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "·";
    return el("div", { class: "cv-mono " + (cls || ""), "aria-hidden": "true" }, letters);
  }

  // matches: every word of the query appears in the title, description, id or tags.
  function matches(item, q) {
    const hay = (item.title + " " + item.description + " " + item.id + " " + item.tags.join(" ")).toLowerCase();
    return (q || "").toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  async function load() {
    if (!loaded) {
      loaded = Promise.all([
        fetch(ROOT + "data/catalog.json").then((r) => { if (!r.ok) throw new Error("catalog: " + r.status); return r.json(); }),
        fetch(ROOT + "data/views.json").then((r) => (r.ok ? r.json() : [])),
      ]).then(([catalog, views]) => ({ catalog, views }));
    }
    return loaded;
  }

  // header renders the site bar: name, count, the view switcher and the
  // search box. Typing dispatches "catalog:search" on window with {query}.
  async function header(host, current) {
    const { catalog, views } = await load();
    const search = el("input", {
      class: "cv-search", type: "search", placeholder: "Search " + catalog.count + " apps", "aria-label": "Search",
      value: new URLSearchParams(location.search).get("q") || "",
      oninput: (e) => {
        const q = e.target.value;
        const u = new URL(location.href);
        if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
        history.replaceState(history.state, "", u);
        window.dispatchEvent(new CustomEvent("catalog:search", { detail: { query: q } }));
      },
    });
    const sw = el("nav", { class: "cv-switch", "aria-label": "Views" },
      views.map((v) => el("a", { href: v.path, "aria-current": v.id === current ? "page" : null, title: v.blurb }, v.title)));
    host.replaceChildren(el("header", { class: "cv-head" },
      el("div", { class: "wrap" },
        el("a", { class: "cv-brand", href: ROOT }, "slop catalog", el("small", {}, catalog.count + " apps")),
        sw, search)));
    document.addEventListener("keydown", (e) => {
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && document.activeElement !== search) {
        e.preventDefault();
        search.focus();
      }
    });
    return search;
  }

  // --- the viewer -----------------------------------------------------------

  // The preview runs in an opaque origin (sandbox without allow-same-origin),
  // where the browser throws on localStorage and sessionStorage. Many apps
  // read them while starting, so the preview gets in-memory stand-ins, and a
  // <base> so the app's relative URLs resolve against its own files.
  const SHIM = "(" + function () {
    function mem() {
      const m = new Map();
      return {
        getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => { m.set(String(k), String(v)); },
        removeItem: (k) => { m.delete(String(k)); },
        clear: () => m.clear(),
        key: (i) => [...m.keys()][i] ?? null,
        get length() { return m.size; },
      };
    }
    for (const name of ["localStorage", "sessionStorage"]) {
      try { void window[name].length; } catch (e) {
        try { Object.defineProperty(window, name, { value: mem(), configurable: true }); } catch (e2) { /* leave it */ }
      }
    }
  } + ")();";
  const previews = new Map();

  async function previewDoc(item) {
    if (!previews.has(item.id)) {
      previews.set(item.id, fetch(item.preview).then((r) => {
        if (!r.ok) throw new Error("preview: " + r.status);
        return r.text();
      }).then((html) => {
        const base = new URL(item.preview, location.href).href.replace(/[^/]*$/, "");
        const head = `<base href="${base}"><script>${SHIM}<\/script>`;
        const m = html.match(/<head[^>]*>/i);
        return m ? html.slice(0, m.index + m[0].length) + head + html.slice(m.index + m[0].length) : head + html;
      }).catch((e) => { previews.delete(item.id); throw e; }));
    }
    return previews.get(item.id);
  }

  const DEVICES = { phone: [390, 844], tablet: [820, 1180], desktop: [1280, 800] };
  const viewer = {
    catalog: null,
    node: null,
    device: "desktop",
    item: null,

    bind(catalog) {
      this.catalog = catalog;
      window.addEventListener("popstate", () => this.sync());
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.item) this.close(); });
      window.addEventListener("resize", () => this.fit());
      this.sync();
    },

    // sync opens or closes the viewer to match ?open= in the address.
    sync() {
      const id = new URLSearchParams(location.search).get("open");
      const item = id && this.catalog.items.find((i) => i.id === id);
      if (item) this.show(item); else this.hide();
    },

    open(item) {
      const u = new URL(location.href);
      u.searchParams.set("open", item.id);
      history.pushState({ open: item.id }, "", u);
      this.show(item);
    },

    close() {
      const u = new URL(location.href);
      u.searchParams.delete("open");
      if (history.state && history.state.open) history.back(); // the entry open() pushed
      else history.replaceState(null, "", u);
      this.hide();
    },

    hide() {
      if (this.node) this.node.remove();
      this.node = null;
      this.item = null;
      document.body.style.overflow = "";
      document.title = this.baseTitle || document.title;
    },

    show(item) {
      this.hide();
      this.item = item;
      this.baseTitle = this.baseTitle || document.title;
      document.title = item.title + " — slop catalog";
      document.body.style.overflow = "hidden";
      const devs = el("div", { class: "cv-devices", role: "group", "aria-label": "Device size" },
        Object.keys(DEVICES).map((d) => el("button", {
          type: "button", "aria-pressed": d === this.device ? "true" : "false",
          onclick: () => { this.device = d; this.show(item); },
        }, d[0].toUpperCase() + d.slice(1))));
      const [w, h] = DEVICES[this.device];
      const device = el("div", { class: "cv-device", style: `width:${w}px;height:${h}px` },
        item.preview
          ? el("iframe", { sandbox: "allow-scripts allow-forms allow-modals", referrerpolicy: "no-referrer",
            title: item.title + " (preview)" })
          : item.cover ? el("img", { src: item.cover.src, alt: item.title }) : monogram(item, "cover"));
      if (item.preview) {
        const frame = device.firstChild;
        previewDoc(item).then((doc) => { if (this.item === item) frame.srcdoc = doc; })
          .catch(() => { if (this.item === item) frame.replaceWith(item.cover ? el("img", { src: item.cover.src, alt: item.title }) : monogram(item)); });
      }
      if (!item.preview && !item.cover) device.firstChild.style.cssText = "width:100%;height:100%;font-size:96px";
      const dims = el("span", { class: "cv-meta" }, `${w} × ${h}`);
      const att = item.attachments.length
        ? [el("dt", {}, "Attachments"), el("dd", {}, item.attachments.map((a) => el("div", {},
          a.href ? el("a", { href: a.href, download: a.name }, a.label) : a.label, " ", el("span", { class: "cv-meta" }, bytes(a.size)))))]
        : [];
      const info = el("aside", { class: "cv-info" },
        el("h2", {}, item.title),
        el("p", {}, item.description || ""),
        el("div", { class: "cv-tags" }, item.tags.map((t) => el("span", { class: "cv-tag" }, t))),
        el("dl", {},
          el("dt", {}, "Access"), el("dd", {}, item.free ? "free" : el("span", { class: "cv-paid" }, "subscribers")),
          el("dt", {}, "Version"), el("dd", {}, item.version || ""),
          el("dt", {}, "Published"), el("dd", {}, date(item.publishedAt)),
          el("dt", {}, "Runtime"), el("dd", {}, item.capabilities.join(", ") || "none"),
          el("dt", {}, "Size"), el("dd", {}, bytes(item.bytes)),
          ...att),
        el("p", { class: "cv-note" }, item.preview
          ? "This preview runs the app's own HTML without slop's runtime: model calls, shared data and rooms only work when you open it."
          : "This app is for subscribers; sign in when you open it."),
        el("div", { class: "cv-actions" },
          el("a", { class: "cv-btn primary", href: item.open, target: "_blank", rel: "noopener" }, "Open ↗"),
          item.download ? el("a", { class: "cv-btn", href: item.download, download: item.id + ".html" }, "Download HTML") : null,
          el("button", {
            class: "cv-btn", type: "button",
            onclick: (e) => navigator.clipboard?.writeText(location.href).then(() => { e.target.textContent = "Copied"; }),
          }, "Copy link")));
      this.node = el("div", { class: "cv-viewer", role: "dialog", "aria-modal": "true", "aria-label": item.title },
        el("div", { class: "cv-vbar" },
          el("strong", {}, item.title),
          item.free ? null : el("span", { class: "cv-paid" }, "subscribers"),
          el("span", { class: "sp" }), devs, dims,
          el("button", { class: "cv-btn", type: "button", onclick: () => this.close() }, "Close · Esc")),
        el("div", { class: "cv-vbody" }, el("div", { class: "cv-stage" }, device), info),
        el("div", { class: "cv-vfoot cv-meta" }, item.open));
      document.body.append(this.node);
      this.fit();
    },

    // fit scales the device frame down to the stage, never up.
    fit() {
      if (!this.node) return;
      const stage = this.node.querySelector(".cv-stage");
      const device = this.node.querySelector(".cv-device");
      const [w, h] = DEVICES[this.device];
      const s = Math.min(1, (stage.clientWidth - 40) / w, (stage.clientHeight - 40) / h);
      device.style.transform = `scale(${s})`;
      device.style.margin = `${-(h * (1 - s)) / 2}px ${-(w * (1 - s)) / 2}px`;
      this.node.querySelector(".cv-vbar .cv-meta").textContent = `${w} × ${h} · ${Math.round(s * 100)}%`;
    },
  };

  window.SlopCatalog = { load, header, viewer, el, bytes, date, monogram, matches };
})();
