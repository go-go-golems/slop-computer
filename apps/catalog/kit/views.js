// SLOP3-015: the catalog views' shared kit. A view page includes this file
// and views.css, then:
//
//   const { catalog, views } = await SlopCatalog.load();
//   SlopCatalog.header(document.querySelector("#head"), "list");
//   SlopCatalog.viewer.bind(catalog);   // ?open=<id> opens the viewer
//
// Events on window: "catalog:search" {query} as the search box changes,
// "catalog:viewer" {open, id} as the viewer opens and closes.
//
// The header also brings the command palette (⌘K / Ctrl K) to every view.
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
        sw, search,
        el("button", { class: "cv-kbd", type: "button", title: "Command palette", "aria-label": "Command palette",
          onclick: () => palette.open() }, /Mac|iP/.test(navigator.platform) ? "⌘K" : "Ctrl K"))));
    document.addEventListener("keydown", (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        palette.toggle();
      } else if (e.key === "/" && !typing(e.target)) {
        e.preventDefault();
        search.focus();
      }
    });
    return search;
  }


  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }


  // --- pages ------------------------------------------------------------------

  // paged returns this page's slice of items (?page=N, 1-based) and draws the
  // pager into each of hosts. Choosing a page updates the address, scrolls to
  // the top and calls redraw(). A view resets to page 1 with paged.reset()
  // when its filters change.
  function paged(items, size, hosts, redraw) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    let p = parseInt(new URLSearchParams(location.search).get("page"), 10) || 1;
    p = Math.min(Math.max(1, p), pages);
    const go = (n) => {
      setPage(n);
      window.scrollTo({ top: 0 });
      redraw();
    };
    const nums = [];
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - p) <= 2) nums.push(n);
      else if (nums[nums.length - 1] !== "…") nums.push("…");
    }
    const from = items.length ? (p - 1) * size + 1 : 0;
    const to = Math.min(items.length, p * size);
    for (const host of hosts.filter(Boolean)) {
      host.replaceChildren(...(pages < 2 ? [] : [el("nav", { class: "cv-pager", "aria-label": "Pages" },
        el("button", { type: "button", disabled: p === 1, onclick: () => go(p - 1) }, "‹ Prev"),
        nums.map((n) => n === "…" ? el("span", { class: "gap" }, "…")
          : el("button", { type: "button", "aria-current": n === p ? "page" : null, onclick: () => go(n) }, n)),
        el("button", { type: "button", disabled: p === pages, onclick: () => go(p + 1) }, "Next ›"),
        el("span", { class: "cv-meta" }, `${from}–${to} of ${items.length}`))]));
    }
    return items.slice((p - 1) * size, p * size);
  }
  function setPage(n) {
    const u = new URL(location.href);
    if (n > 1) u.searchParams.set("page", n); else u.searchParams.delete("page");
    history.replaceState(history.state, "", u);
  }
  paged.reset = () => setPage(1);

  // --- the command palette ----------------------------------------------------

  // fuzzy scores how well q matches text as a subsequence: points for each
  // matched character, more at word starts and for runs; -1 when q is not a
  // subsequence of text. A plain substring match always ranks above.
  function fuzzy(text, q) {
    text = text.toLowerCase();
    if (!q) return 0;
    const at = text.indexOf(q);
    if (at >= 0) return 100 + (at === 0 ? 50 : /\W/.test(text[at - 1]) ? 25 : 0) - text.length / 100;
    let score = 0, ti = 0, run = 0;
    for (const ch of q) {
      const i = text.indexOf(ch, ti);
      if (i < 0) return -1;
      run = i === ti && ti > 0 ? run + 1 : 0;
      score += 1 + run * 2 + (i === 0 || /\W/.test(text[i - 1]) ? 3 : 0);
      ti = i + 1;
    }
    return score - text.length / 100;
  }

  // Entries: views (go there), apps (open the viewer here, or on the first
  // view when this page has none), tags (the index filtered), capabilities
  // (the capability map, when there is one).
  function entries(catalog, views) {
    const has = (id) => views.find((v) => v.id === id);
    const first = views[0] ? views[0].path : ROOT;
    const go = (url) => () => { location.href = url; };
    const out = views.map((v) => ({ kind: "view", label: v.title, hint: v.blurb, run: go(v.path) }));
    for (const item of catalog.items) {
      out.push({
        kind: "app", label: item.title, hint: item.description, item,
        words: (item.id + " " + item.tags.join(" ") + " " + item.capabilities.join(" ") + " " + item.description).toLowerCase(),
        run: () => (viewer.catalog ? viewer.open(item) : go(first + "?open=" + encodeURIComponent(item.id))()),
      });
    }
    const list = has("list") ? has("list").path : first;
    for (const t of catalog.tags) out.push({ kind: "tag", label: "#" + t.tag, hint: t.count + " apps", run: go(list + "?tag=" + encodeURIComponent(t.tag)) });
    const caps = has("caps");
    if (caps) {
      const n = {};
      catalog.items.forEach((i) => i.capabilities.forEach((c) => { n[c] = (n[c] || 0) + 1; }));
      for (const c of Object.keys(n).sort()) out.push({ kind: "capability", label: c, hint: n[c] + " apps need it", run: go(caps.path + "#" + c) });
    }
    return out;
  }

  const palette = {
    node: null, input: null, list: null, all: null, shown: [], sel: 0, back: null,

    async open() {
      if (this.node) return this.input.focus();
      const { catalog, views } = await load();
      this.all = this.all || entries(catalog, views);
      this.back = document.activeElement;
      this.input = el("input", { class: "cv-pinput", type: "text", placeholder: "Find an app, a view, #tag or capability…",
        "aria-label": "Command", role: "combobox", "aria-controls": "cv-plist", "aria-expanded": "true", autocomplete: "off",
        oninput: () => { this.sel = 0; this.render(); }, onkeydown: (e) => this.key(e) });
      this.list = el("ul", { class: "cv-plist", id: "cv-plist", role: "listbox" });
      this.node = el("div", { class: "cv-palette", onmousedown: (e) => { if (e.target === this.node) this.close(); } },
        el("div", { class: "cv-pbox", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, this.input, this.list,
          el("div", { class: "cv-pfoot cv-meta" }, "↑↓ choose · Enter open · Esc close")));
      document.body.append(this.node);
      this.render();
      this.input.focus();
    },

    close() {
      if (!this.node) return;
      this.node.remove();
      this.node = null;
      if (this.back && this.back.focus) this.back.focus();
    },

    toggle() { if (this.node) this.close(); else this.open(); },

    // Empty query: the views, then the newest apps. Otherwise the best 30.
    render() {
      const q = this.input.value.trim().toLowerCase();
      if (!q) {
        this.shown = this.all.filter((e) => e.kind === "view").concat(this.all.filter((e) => e.kind === "app").slice(0, 8));
      } else {
        const words = q.split(/\s+/);
        this.shown = this.all.map((e) => {
          let s = fuzzy(e.label, q.replace(/\s+/g, " "));
          if (s < 0 && e.words && words.every((w) => e.words.includes(w))) s = 1; // found in the details only
          return [s + (e.kind === "app" ? 0.5 : 0), e];
        }).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, 30).map(([, e]) => e);
      }
      this.sel = Math.min(this.sel, Math.max(0, this.shown.length - 1));
      this.list.replaceChildren(...(this.shown.length ? this.shown.map((e, i) => el("li", {
        role: "option", id: "cv-p" + i, "aria-selected": i === this.sel ? "true" : "false",
        onmousemove: () => { if (this.sel !== i) { this.sel = i; this.mark(); } },
        onclick: () => this.run(i),
      }, el("span", { class: "k" }, e.kind), el("b", {}, e.label),
        e.item && !e.item.free ? el("span", { class: "cv-paid" }, "subscribers") : null,
        el("span", { class: "h" }, e.hint || ""))) : [el("li", { class: "cv-empty" }, "Nothing matches.")]));
      this.mark();
    },

    mark() {
      [...this.list.children].forEach((li, i) => li.setAttribute("aria-selected", i === this.sel ? "true" : "false"));
      this.input.setAttribute("aria-activedescendant", "cv-p" + this.sel);
      const li = this.list.children[this.sel];
      if (li) li.scrollIntoView({ block: "nearest" });
    },

    key(e) {
      const n = this.shown.length;
      if (e.key === "ArrowDown") { e.preventDefault(); this.sel = n ? (this.sel + 1) % n : 0; this.mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.sel = n ? (this.sel - 1 + n) % n : 0; this.mark(); }
      else if (e.key === "Enter") { e.preventDefault(); this.run(this.sel); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
    },

    run(i) {
      const e = this.shown[i];
      if (!e) return;
      this.back = null; // the action decides where focus goes
      this.close();
      e.run();
    },
  };

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

  // live mounts an app's preview into box: a sandboxed frame at the device's
  // size (DEVICES key, or [w, h]), scaled to box's width and height, never up.
  // Free apps only; others get their cover. Returns stop(), which removes it.
  function live(box, item, device) {
    const [w, h] = Array.isArray(device) ? device : DEVICES[device || "desktop"];
    if (!item.preview) {
      box.replaceChildren(item.cover ? el("img", { src: item.cover.src, alt: item.title, class: "cv-livecover" }) : monogram(item, "cv-livecover"));
      return () => box.replaceChildren();
    }
    const f = el("iframe", { sandbox: "allow-scripts allow-forms allow-modals", referrerpolicy: "no-referrer",
      title: item.title + " (preview)", class: "cv-liveframe", style: `width:${w}px;height:${h}px` });
    const fit = () => {
      const s = Math.min(1, box.clientWidth / w, box.clientHeight / h || Infinity);
      f.style.transform = `translate(${(box.clientWidth - w * s) / 2}px, 0) scale(${s})`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    box.replaceChildren(f);
    fit();
    let stopped = false;
    previewDoc(item).then((doc) => { if (!stopped) f.srcdoc = doc; })
      .catch(() => { if (!stopped) box.replaceChildren(item.cover ? el("img", { src: item.cover.src, alt: item.title, class: "cv-livecover" }) : monogram(item, "cv-livecover")); });
    return () => { stopped = true; ro.disconnect(); box.replaceChildren(); };
  }

  // related ranks other apps by how much they share with item: tags (Jaccard)
  // plus a little for the same capabilities. Most similar first.
  function related(item, items) {
    const jac = (a, b) => { const A = new Set(a), B = new Set(b); let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return n / (A.size + B.size - n || 1); };
    return items.filter((o) => o.id !== item.id)
      .map((o) => [jac(item.tags, o.tags) + 0.25 * jac(item.capabilities, o.capabilities), o])
      .sort((a, b) => b[0] - a[0]).map(([s, o]) => Object.assign({ score: s }, { item: o }));
  }

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
      if (this.node) window.dispatchEvent(new CustomEvent("catalog:viewer", { detail: { open: false } }));
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
      window.dispatchEvent(new CustomEvent("catalog:viewer", { detail: { open: true, id: item.id } }));
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

  window.SlopCatalog = { load, header, viewer, palette, paged, live, related, previewDoc, DEVICES, fuzzy, el, bytes, date, monogram, matches };
})();
