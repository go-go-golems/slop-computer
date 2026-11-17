/* the bench, built from web/bench: do not edit. source sha256:9541841dbaeb422489e4f5c8344982757261c1a713c7c6c5de07db64df0301f9 */
// The bench: a live dev environment for slop apps. Built from web/bench/src.
(() => {
  // src/lib/util.js
  var uid = (p = "") => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
  var now = () => Date.now();
  var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  function lock() {
    let tail = Promise.resolve();
    return {
      run(fn) {
        const p = tail.then(() => fn());
        tail = p.catch(() => {
        });
        return p;
      }
    };
  }
  function debounce(fn, ms) {
    let t;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
    d.flush = (...a) => {
      clearTimeout(t);
      fn(...a);
    };
    return d;
  }
  function fmtTime(t) {
    const d = new Date(t);
    return d.toTimeString().slice(0, 8);
  }
  function fmtAgo(t) {
    const s = Math.round((now() - t) / 1e3);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(t).toLocaleDateString();
  }
  function trunc(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + "\u2026 (" + (s.length - n) + " more chars)" : s;
  }
  function plural(n, w) {
    return n + " " + w + (n === 1 ? "" : "s");
  }
  function ext(path) {
    const m = /\.([a-z0-9]+)$/i.exec(path || "");
    return m ? m[1].toLowerCase() : "";
  }
  function lineOf(text, idx) {
    let n = 1;
    for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }
  function offsetOfLine(text, line) {
    let i = 0, n = 1;
    while (n < line) {
      const j = text.indexOf("\n", i);
      if (j < 0) return text.length;
      i = j + 1;
      n++;
    }
    return i;
  }
  function hashStr(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619);
    }
    return (x >>> 0).toString(36);
  }
  function emitter() {
    const m = /* @__PURE__ */ new Map();
    return {
      on(ev, fn) {
        if (!m.has(ev)) m.set(ev, /* @__PURE__ */ new Set());
        m.get(ev).add(fn);
        return () => m.get(ev).delete(fn);
      },
      emit(ev, ...a) {
        for (const fn of m.get(ev) || []) {
          try {
            fn(...a);
          } catch (e) {
            console.error(e);
          }
        }
      }
    };
  }

  // src/lib/dom.js
  var $ = (sel, root = document) => root.querySelector(sel);
  var $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function h(tag, props, ...kids) {
    if (props == null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
      kids.unshift(props);
      props = {};
    }
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
    const el = document.createElement(m[1] || "div");
    for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) part[0] === "." ? el.classList.add(part.slice(1)) : el.id = part.slice(1);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "class") el.className += (el.className ? " " : "") + v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string" && k !== "list") el[k] = v;
      else if (k === "value" || k === "checked" || k === "disabled" || k === "readOnly" || k === "selected") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  function put(el, ...kids) {
    return append(el, kids);
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }
  function svgEl(tag, attrs = {}, ...kids) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) k === "text" ? el.textContent = v : el.setAttribute(k, v);
    for (const k of kids.flat()) if (k) el.appendChild(k);
    return el;
  }
  var toastT;
  function toast(msg, ms = 2600) {
    let el = $("#toast");
    if (!el) {
      el = h("div#toast");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }
  function modal({ title, body, actions = [], onClose, wide }) {
    const close2 = () => {
      wrap.remove();
      document.removeEventListener("keydown", key);
      onClose && onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") close2();
    };
    const box = h(
      "div.box",
      { style: wide ? { width: "min(860px, 100%)" } : null },
      h("header", h("span", title), h("span.sp"), h("button.ibtn", { title: "Close", on: { click: close2 } }, "\xD7")),
      h("div.bd", body),
      actions.length ? h("footer", actions.map((a) => h("button.btn" + (a.primary ? ".primary" : "") + (a.danger ? ".danger" : ""), { on: { click: async () => {
        if (await a.run?.() !== false) close2();
      } } }, a.label))) : null
    );
    const wrap = h("div.modal", { on: { mousedown: (e) => {
      if (e.target === wrap) close2();
    } } }, box);
    document.body.appendChild(wrap);
    document.addEventListener("keydown", key);
    setTimeout(() => {
      const f = box.querySelector("input,textarea");
      f && f.focus();
    }, 30);
    return { close: close2, box };
  }
  function confirmBox(title, text, label2 = "Confirm", danger = true) {
    return new Promise((res) => {
      let done = false;
      modal({
        title,
        body: h("p", { style: { margin: 0 } }, text),
        onClose: () => {
          if (!done) res(false);
        },
        actions: [{ label: "Cancel", run: () => {
          done = true;
          res(false);
        } }, { label: label2, danger, primary: !danger, run: () => {
          done = true;
          res(true);
        } }]
      });
    });
  }
  function promptBox(title, label2, value = "") {
    return new Promise((res) => {
      let done = false;
      const inp = h("input.txt", { value, style: { width: "100%" }, on: { keydown: (e) => {
        if (e.key === "Enter") {
          done = true;
          res(inp.value.trim());
          m.close();
        }
      } } });
      const m = modal({
        title,
        body: [h("label.note", label2), inp],
        onClose: () => {
          if (!done) res(null);
        },
        actions: [{ label: "Cancel", run: () => {
          done = true;
          res(null);
        } }, { label: "OK", primary: true, run: () => {
          done = true;
          res(inp.value.trim());
        } }]
      });
    });
  }
  var openMenu = null;
  function popMenu(anchor, items, { right } = {}) {
    closeMenu();
    const menu = h("div.menu" + (right ? ".right" : ""));
    for (const it of items) {
      if (!it) continue;
      if (it instanceof Node) menu.appendChild(it);
      else if (it.group) menu.appendChild(h("div.grp", it.group));
      else if (it.hr) menu.appendChild(h("hr"));
      else if (it.note) menu.appendChild(h("p.note", it.note));
      else menu.appendChild(h(
        "button" + (it.on ? ".on" : "") + (it.danger ? ".danger" : ""),
        { disabled: it.disabled, on: { click: (e) => {
          e.stopPropagation();
          closeMenu();
          it.run && it.run();
        } } },
        h("span.t", it.label),
        it.sub ? h("small", it.sub) : null
      ));
    }
    document.body.appendChild(menu);
    openMenu = menu;
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { position: "fixed", top: r.bottom + 6 + "px", left: "auto", right: "auto" });
    const w = menu.offsetWidth, hgt = menu.offsetHeight;
    let x = right ? r.right - w : r.left;
    x = clamp(x, 6, innerWidth - w - 6);
    let y = r.bottom + 6;
    if (y + hgt > innerHeight - 6) y = Math.max(6, r.top - 6 - hgt > 6 ? r.top - 6 - hgt : innerHeight - 6 - hgt);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    setTimeout(() => {
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", escMenu, true);
    }, 0);
    return menu;
  }
  function outside(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }
  function escMenu(e) {
    if (e.key === "Escape") closeMenu();
  }
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", escMenu, true);
  }

  // src/agent/roles.js
  var ROLES = {
    explorer: { describe: "Read-only investigator. Reads code, the dev instance's data and frames; answers with evidence and `file:line` links. Cannot write.", mode: "read", evals: 12 },
    reviewer: { describe: "Reviews a proposal: reads its diff, renders and checks its frames, runs its scenarios, and returns a verdict. Cannot write.", mode: "read", evals: 12, output: '{verdict: "approve"|"changes", comments: string}' },
    qa: { describe: "QA. Runs the scenarios (scenarios.runAll), writes scenarios for important flows that have none (scenarios.save; fixtures.save for edge-case data), sweeps every frame for overflow, contrast, accessibility and console errors, and files a pin on each problem with ui.pin(frameId, target, text). May write only scenarios/ and fixtures/.", mode: "tests", evals: 16, output: "{pins: number, scenarios: {passed: number, failed: number, added: number}, summary: string}" },
    builder: { describe: "Builds what it is asked in a proposal of its own (the person reviews it), checks the frames, and summarizes what it changed.", mode: "auto", own: true, evals: 20 }
  };
  var MAX_DEPTH = 2;

  // src/lib/text.js
  function diffLines(aText, bText) {
    const a = (aText ?? "").split("\n"), b = (bText ?? "").split("\n");
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
      ea--;
      eb--;
    }
    const A = a.slice(s, ea), B = b.slice(s, eb), out = [];
    for (let i = 0; i < s; i++) out.push({ op: " ", text: a[i], a: i + 1, b: i + 1 });
    if (A.length * B.length > 4e6) {
      A.forEach((t, i) => out.push({ op: "-", text: t, a: s + i + 1 }));
      B.forEach((t, i) => out.push({ op: "+", text: t, b: s + i + 1 }));
    } else {
      const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i2 = n - 1; i2 >= 0; i2--) for (let j2 = m - 1; j2 >= 0; j2--) L[i2][j2] = A[i2] === B[j2] ? L[i2 + 1][j2 + 1] + 1 : Math.max(L[i2 + 1][j2], L[i2][j2 + 1]);
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && A[i] === B[j]) {
          out.push({ op: " ", text: A[i], a: s + i + 1, b: s + j + 1 });
          i++;
          j++;
        } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
          out.push({ op: "+", text: B[j], b: s + j + 1 });
          j++;
        } else {
          out.push({ op: "-", text: A[i], a: s + i + 1 });
          i++;
        }
      }
    }
    for (let i = ea; i < a.length; i++) out.push({ op: " ", text: a[i], a: i + 1, b: i - ea + eb + 1 });
    return out;
  }
  function diffStat(a, b) {
    let add = 0, del = 0;
    for (const d of diffLines(a, b)) d.op === "+" ? add++ : d.op === "-" ? del++ : 0;
    return { add, del };
  }
  function diffView(aText, bText, ctx = 3) {
    const d = diffLines(aText, bText), keep = new Array(d.length).fill(false);
    d.forEach((x, i) => {
      if (x.op !== " ") for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true;
    });
    const el = h("div.diff");
    let gap = false, any = false;
    d.forEach((x, i) => {
      if (!keep[i]) {
        gap = true;
        return;
      }
      if (gap || !any && i > 0) el.appendChild(h("div.h", "@@ line " + (x.b || x.a)));
      gap = false;
      any = true;
      el.appendChild(h("div" + (x.op === "+" ? ".a" : x.op === "-" ? ".d" : ""), (x.op === " " ? "  " : x.op + " ") + x.text));
    });
    if (!any) el.appendChild(h("div.h", "no changes"));
    return el;
  }
  function diffText(path, aText, bText, ctx = 2) {
    const d = diffLines(aText, bText), keep = new Array(d.length).fill(false), out = ["--- " + path, "+++ " + path];
    d.forEach((x, i) => {
      if (x.op !== " ") for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true;
    });
    let gap = true;
    d.forEach((x, i) => {
      if (!keep[i]) {
        gap = true;
        return;
      }
      if (gap) out.push("@@ " + (x.b || x.a));
      gap = false;
      out.push((x.op === " " ? " " : x.op) + x.text);
    });
    return out.join("\n");
  }
  var escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var JS_KW = /^(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false|yield|delete|void)$/;
  function hlJS(src) {
    return src.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|([<>&"])/g, (m, c, s, n, w, x) => c ? '<span class="tk-c">' + escHtml(c) + "</span>" : s ? '<span class="tk-s">' + escHtml(s) + "</span>" : n ? '<span class="tk-n">' + n + "</span>" : w ? JS_KW.test(w) ? '<span class="tk-k">' + w + "</span>" : w : escHtml(x));
  }
  function hlCSS(src) {
    return src.replace(/(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([^{};\n/][^{};\n]*?)(?=\s*\{)|([\w-]+)(?=\s*:)|([<>&])/g, (m, c, s, sel, prop, x) => c ? '<span class="tk-c">' + escHtml(c) + "</span>" : s ? '<span class="tk-s">' + escHtml(s) + "</span>" : sel ? '<span class="tk-k">' + escHtml(sel) + "</span>" : prop ? '<span class="tk-a">' + prop + "</span>" : escHtml(x));
  }
  function hlHTML(src) {
    let out = "", i = 0;
    const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
    let m;
    while (m = re.exec(src)) {
      out += escHtml(src.slice(i, m.index));
      i = re.lastIndex;
      const t = m[0];
      if (t.startsWith("<!--")) {
        out += '<span class="tk-c">' + escHtml(t) + "</span>";
        continue;
      }
      out += t.replace(/^(<\/?)([\w-]+)|(\s)([^\s=>\/]+)(?=\s*=)|("[^"]*"|'[^']*')|(\/?>)$/g, (mm, lt, tag, sp, attr, str, gt) => lt ? escHtml(lt) + '<span class="tk-t">' + tag + "</span>" : attr ? sp + '<span class="tk-a">' + attr + "</span>" : str ? '<span class="tk-s">' + escHtml(str) + "</span>" : gt ? escHtml(gt) : escHtml(mm));
      const tm = /^<(script|style)\b/i.exec(t);
      if (tm && !t.endsWith("/>")) {
        const close2 = src.toLowerCase().indexOf("</" + tm[1].toLowerCase(), i), end = close2 < 0 ? src.length : close2;
        const inner = src.slice(i, end);
        out += tm[1].toLowerCase() === "script" ? hlJS(inner) : hlCSS(inner);
        i = end;
        re.lastIndex = end;
      }
    }
    return out + escHtml(src.slice(i));
  }
  function hlMD(src) {
    let inFence = false;
    return src.split("\n").map((l) => {
      if (/^\s*(```|~~~)/.test(l)) {
        inFence = !inFence;
        return '<span class="tk-c">' + escHtml(l) + "</span>";
      }
      if (inFence) return '<span class="tk-s">' + escHtml(l) + "</span>";
      if (/^#{1,6}\s/.test(l)) return '<span class="tk-k">' + escHtml(l) + "</span>";
      return escHtml(l).replace(/(`[^`]+`)/g, '<span class="tk-s">$1</span>').replace(/(\[[^\]]*\]\([^)]*\))/g, '<span class="tk-a">$1</span>').replace(/^(\s*(?:[-*+]|\d+[.)])\s)/, '<span class="tk-a">$1</span>').replace(/(\*\*[^*]+\*\*)/g, "<b>$1</b>").replace(/^(&gt;.*)$/, '<span class="tk-c">$1</span>');
    }).join("\n");
  }
  function highlight(path, src) {
    const e = ext(path);
    if (src.length > 16e4) return escHtml(src);
    return e === "js" || e === "mjs" || e === "json" ? hlJS(src) : e === "css" ? hlCSS(src) : e === "md" || e === "markdown" ? hlMD(src) : e === "yaml" || e === "yml" ? hlYAML(src) : e === "html" || e === "htm" || e === "svg" ? hlHTML(src) : escHtml(src);
  }
  var MD_LANG = { js: "x.js", javascript: "x.js", mjs: "x.js", ts: "x.js", json: "x.json", css: "x.css", html: "x.html", htm: "x.html", xml: "x.html", svg: "x.html" };
  var FREF = /^([\w][\w./-]*\.(?:html?|css|js|mjs|json|svg|md|txt))(?::(\d+))?(?:-\d+)?$/;
  function mdInline(src, isFile) {
    const keep = [];
    const stash = (html) => "\0" + (keep.push(html) - 1) + "\0";
    let s = src.replace(/`([^`\n]+)`/g, (m, c) => {
      const f = FREF.exec(c.trim());
      if (f && isFile(f[1])) return stash('<code class="fref" data-file="' + escHtml(f[1]) + '" data-line="' + (f[2] || 1) + '" title="Open in Code">' + escHtml(c) + "</code>");
      return stash("<code>" + escHtml(c) + "</code>");
    });
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash('<a href="' + escHtml(u) + '" target="_blank" rel="noopener noreferrer">' + escHtml(t) + "</a>"));
    s = s.replace(/\[([^\]\n]+)\]\(([\w][\w./-]*\.(?:html?|css|js|json|svg|md))(?:#L?(\d+))?\)/g, (m, t, f, l) => isFile(f) ? stash('<a class="fref" data-file="' + escHtml(f) + '" data-line="' + (l || 1) + '">' + escHtml(t) + "</a>") : m);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + stash('<a href="' + escHtml(u) + '" target="_blank" rel="noopener noreferrer">' + escHtml(u) + "</a>"));
    s = s.replace(/(^|[\s(,;])([\w][\w./-]*\.(?:html?|css|js|json|svg|md)):(\d+)(?=$|[\s),.;:])/g, (m, pre, f, l) => isFile(f) ? pre + stash('<a class="fref" data-file="' + escHtml(f) + '" data-line="' + l + '">' + escHtml(f + ":" + l) + "</a>") : m);
    s = escHtml(s).replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (m, a, b) => "<strong>" + (a || b) + "</strong>").replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>").replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
  }
  function renderMarkdown(text, isFile = () => false, opts = {}) {
    const lines = String(text || "").replace(/\r/g, "").split("\n"), root = h("div.md");
    const isList = (l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    const isBlock = (l) => /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || isList(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
    const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    function list(i, base) {
      const ordered = /^\s*\d+[.)]/.test(lines[i]), el = h(ordered ? "ol" : "ul");
      if (ordered) {
        const n = parseInt(lines[i].trim(), 10);
        if (n > 1) el.start = n;
      }
      let li = null;
      while (i < lines.length) {
        const l = lines[i], ind = l.length - l.trimStart().length;
        if (!l.trim()) {
          if (i + 1 < lines.length && isList(lines[i + 1]) && lines[i + 1].length - lines[i + 1].trimStart().length >= base) {
            i++;
            continue;
          }
          break;
        }
        if (isList(l) && ind >= base + 2 && li) {
          const [sub, j] = list(i, ind);
          li.appendChild(sub);
          i = j;
          continue;
        }
        if (isList(l) && ind >= base) {
          li = h("li", { html: mdInline(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[( |x)\]\s+/i, (m, x) => x.trim() ? "\u2611 " : "\u2610 "), isFile) });
          el.appendChild(li);
          i++;
          continue;
        }
        if (ind > base && li && !isBlock(l)) {
          li.insertAdjacentHTML("beforeend", " " + mdInline(l.trim(), isFile));
          i++;
          continue;
        }
        break;
      }
      return [el, i];
    }
    function blocks(i, end, into) {
      while (i < end) {
        const l = lines[i];
        if (!l.trim()) {
          i++;
          continue;
        }
        let m;
        if (m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l)) {
          const buf = [];
          i++;
          while (i < end && !lines[i].trim().startsWith(m[1])) buf.push(lines[i++]);
          i++;
          const code = buf.join("\n"), pre = h("pre", h("code", { html: MD_LANG[m[2].toLowerCase()] ? highlight(MD_LANG[m[2].toLowerCase()], code) : escHtml(code) }));
          pre.appendChild(h("button.cp", { title: "Copy", on: { click: async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(code);
              toast("Copied");
            } catch {
              toast("Copy is blocked here; select the text instead");
            }
          } } }, "Copy"));
          into.appendChild(pre);
          continue;
        }
        if (m = /^(#{1,6})\s+(.*)$/.exec(l)) {
          into.appendChild(h("h" + Math.min(6, m[1].length + (opts.doc ? 1 : 2)), { "data-line": i + 1, "data-level": m[1].length, html: mdInline(m[2].replace(/\s+#+\s*$/, ""), isFile) }));
          i++;
          continue;
        }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
          into.appendChild(h("hr"));
          i++;
          continue;
        }
        if (/^\s*>/.test(l)) {
          const start = i;
          while (i < end && /^\s*>/.test(lines[i])) {
            lines[i] = lines[i].replace(/^\s*>\s?/, "");
            i++;
          }
          const q = h("blockquote");
          blocks(start, i, q);
          into.appendChild(q);
          continue;
        }
        if (isList(l)) {
          const [el, j] = list(i, l.length - l.trimStart().length);
          into.appendChild(el);
          i = Math.max(j, i + 1);
          continue;
        }
        if (l.includes("|") && i + 1 < end && isSep(lines[i + 1])) {
          const head = cells(l), t = h("table", h("thead", h("tr", head.map((c) => h("th", { html: mdInline(c, isFile) })))));
          const body = h("tbody");
          i += 2;
          while (i < end && lines[i].includes("|") && lines[i].trim()) {
            body.appendChild(h("tr", cells(lines[i]).map((c) => h("td", { html: mdInline(c, isFile) }))));
            i++;
          }
          t.appendChild(body);
          into.appendChild(h("div.mdtable", t));
          continue;
        }
        const para = [l.trim()];
        i++;
        while (i < end && lines[i].trim() && !isBlock(lines[i]) && !(lines[i].includes("|") && i + 1 < end && isSep(lines[i + 1]))) para.push(lines[i++].trim());
        into.appendChild(h("p", { html: para.map((x) => mdInline(x, isFile)).join("<br>") }));
      }
    }
    blocks(0, lines.length, root);
    return root;
  }
  function toYAML(v, maxLines = 600) {
    const plainOK = (s) => s.length > 0 && s.length < 240 && !/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) && !/\s$/.test(s) && !/: |\s#|\t|:$/.test(s) && !/^(true|false|null|yes|no|on|off|~|[-+]?(\d[\d_]*\.?\d*([eE][-+]?\d+)?|\.\d+)|0x[0-9a-fA-F]+|\.inf|\.nan)$/i.test(s);
    const short = (x) => x === null || x === void 0 || typeof x === "number" || typeof x === "boolean" || typeof x === "string" && !x.includes("\n") && x.length <= 40;
    const scalar = (x, ind) => {
      if (x === null || x === void 0) return "null";
      if (typeof x === "boolean" || typeof x === "number") return String(x);
      if (typeof x === "string") {
        if (x.includes("\n")) return "|" + (x.endsWith("\n") ? "" : "-") + "\n" + x.replace(/\n$/, "").split("\n").map((l) => " ".repeat(ind) + l).join("\n");
        return plainOK(x) ? x : JSON.stringify(x);
      }
      return JSON.stringify(x);
    };
    const key = (k) => /^[A-Za-z_$][\w$.\-]*$/.test(k) && !/^(true|false|null|yes|no|on|off)$/i.test(k) ? k : JSON.stringify(k);
    const flow = (a) => {
      if (!a.length || a.length > 16 || !a.every(short)) return null;
      const t = "[" + a.map((x) => scalar(x, 0)).join(", ") + "]";
      return t.length <= 72 ? t : null;
    };
    const isObj = (x) => x && typeof x === "object";
    const empty = (x) => Array.isArray(x) ? x.length ? null : "[]" : isObj(x) && !Object.keys(x).length ? "{}" : null;
    const emit = (x, ind, out2) => {
      const pad = " ".repeat(ind);
      if (Array.isArray(x)) {
        for (const it of x) {
          if (!isObj(it)) {
            out2.push(pad + "- " + scalar(it, ind + 2));
            continue;
          }
          const e2 = empty(it), f = Array.isArray(it) && flow(it);
          if (e2 || f) {
            out2.push(pad + "- " + (e2 || f));
            continue;
          }
          const sub = [];
          emit(it, ind + 2, sub);
          out2.push(pad + "- " + sub[0].trimStart(), ...sub.slice(1));
        }
        return;
      }
      for (const [k, val] of Object.entries(x)) {
        if (val === void 0) continue;
        if (!isObj(val)) {
          out2.push(pad + key(k) + ": " + scalar(val, ind + 2));
          continue;
        }
        const e2 = empty(val), f = Array.isArray(val) && flow(val);
        if (e2 || f) {
          out2.push(pad + key(k) + ": " + (e2 || f));
          continue;
        }
        out2.push(pad + key(k) + ":");
        emit(val, ind + 2, out2);
      }
    };
    if (!isObj(v)) return scalar(v, 2);
    const e = empty(v);
    if (e) return e;
    const out = [];
    emit(v, 0, out);
    const lines = out.join("\n").split("\n");
    return lines.length > maxLines ? lines.slice(0, maxLines).join("\n") + "\n# \u2026 " + (lines.length - maxLines) + " more lines" : lines.join("\n");
  }
  function hlYAML(src) {
    const val = (v) => {
      if (!v) return "";
      if (/^(null|true|false|~)$/i.test(v)) return '<span class="y-b">' + v + "</span>";
      if (/^[-+]?(\d[\d_]*\.?\d*([eE][-+]?\d+)?|\.\d+)$/.test(v)) return '<span class="y-n">' + v + "</span>";
      if (/^[|>][-+]?$/.test(v)) return '<span class="y-p">' + v + "</span>";
      if (/^\[.*\]$/.test(v)) return '<span class="y-p">[</span>' + v.slice(1, -1).split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => val(x.trim())).join('<span class="y-p">, </span>') + '<span class="y-p">]</span>';
      if (v === "[]" || v === "{}") return '<span class="y-p">' + v + "</span>";
      return '<span class="y-s">' + escHtml(v) + "</span>";
    };
    let block = -1;
    return src.split("\n").map((line) => {
      const ind = line.length - line.trimStart().length;
      if (block >= 0) {
        if (line.trim() === "" || ind >= block) return '<span class="y-s">' + escHtml(line) + "</span>";
        block = -1;
      }
      if (/^\s*#/.test(line)) return '<span class="y-c">' + escHtml(line) + "</span>";
      const m = /^(\s*)((?:- )*)(?:("(?:[^"\\]|\\.)*"|[^\s:"'\[\]{}#][^:#]*?):(?= |$))?\s?(.*)$/.exec(line);
      if (!m) return escHtml(line);
      const [, sp, dash, k, rest] = m;
      if (/^[|>][-+]?$/.test(rest.trim())) block = ind + dash.length + (k ? 2 : 0) || ind + 1;
      return sp + (dash ? '<span class="y-p">' + dash + "</span>" : "") + (k ? '<span class="y-k">' + escHtml(k) + '</span><span class="y-p">:</span> ' : "") + val(rest.trim());
    }).join("\n");
  }
  function parseJSONReply(text) {
    const t = String(text).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try {
      return JSON.parse(t);
    } catch {
    }
    for (const [o, c] of [["{", "}"], ["[", "]"]]) {
      const i = t.lastIndexOf("\n" + o), a = i >= 0 ? i + 1 : t.indexOf(o), b = t.lastIndexOf(c);
      if (a >= 0 && b > a) {
        try {
          return JSON.parse(t.slice(a, b + 1));
        } catch {
        }
      }
    }
    return void 0;
  }

  // src/agent/api/agents.js
  var AGENTS = {
    "llm": {
      sig: "prompt, {output, tier}?",
      internal: true,
      long: true,
      run: async (ctx, prompt, o = {}) => {
        if (!ctx.agent.sample) throw Object.assign(new Error("Claude is not available in this view"), { kind: "unavailable" });
        ctx.llmCalls = (ctx.llmCalls || 0) + 1;
        if (ctx.llmCalls > 24) throw Object.assign(new Error("llm calls are capped at 24 per turn"), { kind: "budget" });
        let res;
        try {
          res = await ctx.agent.sample(String(prompt) + (o.output ? "\n\nReply with JSON only, no prose and no code fences, matching: " + o.output : ""), { modelTier: o.tier || "quick", cache: false, signal: ctx.signal });
        } catch (e) {
          throw Object.assign(new Error(e && e.message || String(e)), { kind: e && e.code === "rate_limited" ? "rate_limited" : "llm" });
        }
        const text = (res && res.text || "").trim();
        if (!o.output) return text;
        const v = parseJSONReply(text);
        if (v === void 0) throw Object.assign(new Error("the reply was not JSON: " + text.slice(0, 200)), { kind: "llm" });
        return v;
      }
    },
    "agents.delegate": { sig: "role, task, {output, evals, tier, proposal}?", internal: true, long: true, run: (ctx, role, task, o = {}) => ctx.agent.delegate(ctx, role, String(task), o) },
    "agents.roles": {
      sig: "",
      internal: true,
      run: () => Object.entries(ROLES).map(([name, r]) => ({ name, describe: r.describe, writes: r.mode === "read" ? false : r.mode === "tests" ? "scenarios/ and fixtures/ only" : true, evals: r.evals }))
    }
  };

  // src/core/draft.js
  var BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|webm|mov|zip|gz|tgz|br|zst|pdf|wasm|bin|sqlite|db)$/i;
  var TEXT_MAX = 24e4;
  var textish = (f) => !BINARY_EXT.test(f.path) && f.size <= TEXT_MAX;
  function checkPath(path) {
    if (typeof path !== "string" || !path) return "path must be a non-empty string";
    if (path.length > 200) return "a path is at most 200 characters";
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((s) => !s || s === "." || s === "..")) return "a path is relative, with / between non-empty parts and no . or .. (got " + JSON.stringify(path) + ")";
    return null;
  }
  var Tx = class _Tx {
    constructor(draft, { base, parent = null, label: label2 = "", live = false, event = null } = {}) {
      this.draft = draft;
      this.parent = parent;
      this.label = label2;
      this.event = event;
      this.live = live;
      this.base = parent ? parent.base : base;
      this.changes = /* @__PURE__ */ new Map();
      this.state = "open";
    }
    get open() {
      return this.state === "open";
    }
    must() {
      if (this.state !== "open") throw Object.assign(new Error("this transaction is " + this.state), { kind: "invalid" });
    }
    // what this Tx reads under its own changes: the parent's view, or the snapshot
    under(path) {
      return this.parent ? this.parent.entry(path) : this.draft.entry(path, this.live ? this.draft.head : this.base);
    }
    underList() {
      return this.parent ? this.parent.list() : this.draft.list(this.live ? this.draft.head : this.base);
    }
    // {text} for a text file, {sha256, size, type} for one kept by hash, null when absent
    entry(path) {
      const c = this.changes.get(path);
      if (c) return c.remove ? null : c;
      return this.under(path);
    }
    read(path) {
      const e = this.entry(path);
      return e && typeof e.text === "string" ? e.text : null;
    }
    has(path) {
      return this.entry(path) !== null;
    }
    list() {
      const set = new Set(this.underList());
      for (const [p, c] of this.changes) c.remove ? set.delete(p) : set.add(p);
      return [...set].sort();
    }
    write(path, text) {
      this.must();
      const bad = checkPath(path);
      if (bad) throw Object.assign(new Error(bad), { kind: "invalid" });
      if (typeof text !== "string") throw Object.assign(new Error("text must be a string"), { kind: "invalid" });
      this.changes.set(path, { text });
    }
    remove(path) {
      this.must();
      this.changes.set(path, { remove: true });
    }
    // put a file the server already has, by hash (a binary or large file)
    copy(path, entry) {
      this.must();
      const bad = checkPath(path);
      if (bad) throw Object.assign(new Error(bad), { kind: "invalid" });
      if (!entry || typeof entry.sha256 !== "string") throw Object.assign(new Error("copy needs an entry {sha256, size}"), { kind: "invalid" });
      this.changes.set(path, { sha256: entry.sha256, size: entry.size, type: entry.type || "" });
    }
    // drop own changes to these paths (all when none given)
    forget(paths) {
      this.must();
      for (const p of paths || [...this.changes.keys()]) this.changes.delete(p);
    }
    child(o = {}) {
      this.must();
      return new _Tx(this.draft, { ...o, parent: this });
    }
    paths() {
      return [...this.changes.keys()].sort();
    }
    // own changes as {path, before, after} (texts; null for absent or kept by hash)
    diff() {
      return this.paths().map((path) => {
        const b = this.under(path), c = this.changes.get(path);
        return { path, before: b && typeof b.text === "string" ? b.text : null, existed: b !== null, after: c.remove || typeof c.text !== "string" ? null : c.text };
      });
    }
    abort() {
      if (this.state === "open") this.state = "aborted";
    }
    async commit({ message } = {}) {
      this.must();
      const paths = this.paths();
      if (this.parent) {
        if (!this.parent.open) return { status: "failed", code: "aborted", error: "the transaction this one belongs to has ended (" + this.parent.state + ")", paths };
        for (const [p, c] of this.changes) this.parent.changes.set(p, c);
        this.state = "folded";
        return { status: "folded", paths };
      }
      this.state = "committing";
      let r;
      try {
        r = await this.draft.commitChanges(this.base, this.changes, { message, label: this.label, event: this.event });
      } catch (e) {
        r = { status: "failed", code: e.code || "", error: e.message || String(e) };
      }
      r.paths = paths;
      this.state = r.status === "committed" ? "committed" : "open";
      return r;
    }
  };
  var Draft = class _Draft {
    constructor({ app, ref = "draft", call, hash }) {
      this.app = app;
      this.ref = ref;
      this.call = call;
      this.hash = hash;
      this.head = null;
      this.listings = /* @__PURE__ */ new Map();
      this.texts = /* @__PURE__ */ new Map();
      this.binary = /* @__PURE__ */ new Set();
      this.ev = emitter();
      this.queue = Promise.resolve();
      this.epoch = 0;
      this.edits = null;
      this.conflict = null;
    }
    // ---- reading (synchronous, at a loaded snapshot) ----
    loaded(n) {
      const l = this.listings.get(n);
      return !!l && [...l.values()].every((f) => !textish(f) || this.texts.has(f.sha256) || this.binary.has(f.sha256));
    }
    listing(n = this.head) {
      return this.listings.get(n) || /* @__PURE__ */ new Map();
    }
    // {text} or {sha256, size, type} (kept by hash), or null when absent at n
    entry(path, n = this.head) {
      if (n === 0) return null;
      const f = this.listing(n).get(path);
      if (!f) return null;
      const t = this.texts.get(f.sha256);
      return typeof t === "string" ? { text: t } : { sha256: f.sha256, size: f.size, type: f.type || "" };
    }
    read(path, n = this.head) {
      const e = this.entry(path, n);
      return e && typeof e.text === "string" ? e.text : null;
    }
    list(n = this.head) {
      return n === 0 ? [] : [...this.listing(n).keys()].sort();
    }
    // paths that differ between two loaded listings
    changed(a, b) {
      const A = a === 0 ? /* @__PURE__ */ new Map() : this.listing(a), B = b === 0 ? /* @__PURE__ */ new Map() : this.listing(b), out = [];
      for (const [p, f] of B) {
        const g = A.get(p);
        if (!g || g.sha256 !== f.sha256) out.push(p);
      }
      for (const p of A.keys()) if (!B.has(p)) out.push(p);
      return out.sort();
    }
    // ---- loading ----
    remember(n, files2) {
      if (!this.listings.has(n)) this.listings.set(n, new Map(files2.map((f) => [f.path, { path: f.path, sha256: f.sha256, size: f.size, type: f.type || "" }])));
    }
    async load(n) {
      if (n === 0 || this.loaded(n)) return;
      if (!this.listings.has(n)) this.remember(n, await this.call("files", { app: this.app, at: n }));
      let want = [...this.listing(n).values()].filter((f) => textish(f) && !this.texts.has(f.sha256) && !this.binary.has(f.sha256));
      while (want.length) {
        const r = await this.call("read", { app: this.app, at: n, paths: want.map((f) => f.path) });
        const byPath = new Map(want.map((f) => [f.path, f]));
        for (const [p, t] of Object.entries(r.texts || {})) {
          const f = byPath.get(p);
          if (f) this.texts.set(f.sha256, t);
        }
        for (const p of r.binary || []) {
          const f = byPath.get(p);
          if (f) this.binary.add(f.sha256);
        }
        const more = (r.more || []).map((p) => byPath.get(p)).filter(Boolean);
        if (!more.length || more.length === want.length) break;
        want = more;
      }
    }
    // a snapshot's listing alone (history reads many snapshots, few texts)
    async listingOf(n) {
      if (n === 0) return /* @__PURE__ */ new Map();
      if (!this.listings.has(n)) this.remember(n, await this.call("files", { app: this.app, at: n }));
      return this.listing(n);
    }
    // one file's text at snapshot n (null: absent, or kept by hash)
    async text(n, path) {
      const f = (await this.listingOf(n)).get(path);
      if (!f || !textish(f) || this.binary.has(f.sha256)) return null;
      if (!this.texts.has(f.sha256)) {
        const r = await this.call("read", { app: this.app, at: n, paths: [path] });
        if (typeof (r.texts || {})[path] === "string") this.texts.set(f.sha256, r.texts[path]);
        else {
          this.binary.add(f.sha256);
          return null;
        }
      }
      return this.texts.get(f.sha256);
    }
    // Switch the shown head to n once it is loaded, in order with other
    // switches; emits 'head' (n, prev, paths that differ, source).
    moveHead(n, source) {
      return this.queue = this.queue.then(async () => {
        if (n === this.head) return;
        await this.load(n);
        const prev = this.head;
        this.head = n;
        const paths = prev == null ? this.list(n) : this.changed(prev, n);
        if (this.edits) this.rebaseEdits();
        this.ev.emit("head", n, prev, paths, source);
      }).catch((e) => {
        this.ev.emit("error", e);
      });
    }
    async open() {
      const r = await this.call("head", { app: this.app, ref: this.ref });
      await this.moveHead(r.n ?? 0, "open");
      return this.head;
    }
    // Ask where the ref is; follow it when it moved (someone else committed,
    // a push from a terminal, a rollback). A poll sent before one of this
    // Draft's commits finished is stale and ignored.
    async refresh() {
      const epoch = this.epoch;
      const r = await this.call("head", { app: this.app, ref: this.ref });
      if (epoch === this.epoch && (r.n ?? 0) !== this.head) await this.moveHead(r.n ?? 0, "poll");
      return this.head;
    }
    // ---- writing ----
    begin(o = {}) {
      return new Tx(this, { base: this.head, ...o });
    }
    async commitChanges(base, changes, { message, label: label2, event } = {}) {
      if (!changes.size) return { status: "committed", n: base, at: base, merged: false, activated: [] };
      const wire = [...changes].map(([path, c]) => c.remove ? { path, delete: true } : typeof c.text === "string" ? { path, text: c.text } : { path, sha256: c.sha256, size: c.size, ...c.type ? { type: c.type } : {} });
      let r;
      try {
        r = await this.call("commit", { app: this.app, ref: this.ref, base, changes: wire, message: message || label2 || "bench", event: event || { who: "you", note: message || label2 || "" } });
      } catch (e) {
        return { status: "failed", code: e && e.code || "", error: e && e.message || String(e) };
      }
      if (r.conflict) return { status: "conflict", at: r.conflict.at, conflicts: r.conflict.paths };
      this.epoch++;
      for (const c of changes.values()) if (typeof c.text === "string") this.texts.set(await this.hash(c.text), c.text);
      if (r.files) this.remember(r.n, r.files);
      if (this.head == null || r.n > this.head) await this.moveHead(r.n, "commit");
      const out = { status: "committed", n: r.n, at: r.at, merged: !!r.merged, activated: r.activated || [], event: r.event || null };
      this.ev.emit("commit", { ...out, paths: [...changes.keys()].sort() });
      return out;
    }
    // ---- the person's edits: one live Tx, committed after a pause ----
    // edit(path, text | null): buffered; commits EDIT_PAUSE ms after the last
    // edit. settle() commits now. A conflict keeps the edits buffered and
    // emits 'conflict' {conflicts}: keepMine() or takeTheirs() resolves it.
    edit(path, text) {
      if (!this.edits) this.edits = this.begin({ live: true, label: "you" });
      text === null ? this.edits.remove(path) : this.edits.write(path, text);
      this.ev.emit("edits", path);
      clearTimeout(this.editT);
      this.editT = setTimeout(() => {
        this.settle().catch(() => {
        });
      }, _Draft.EDIT_PAUSE);
    }
    pending() {
      return !!this.edits && this.edits.changes.size > 0;
    }
    // The edits' base follows the head while no edited path changed in
    // between; otherwise it stays, and the commit reports those paths.
    rebaseEdits() {
      const tx = this.edits;
      if (!tx || tx.base === this.head) return;
      if (!tx.changes.size || this.changed(tx.base, this.head).every((p) => !tx.changes.has(p))) tx.base = this.head;
    }
    // Keep one's own text over a conflicting change: the head is brought up
    // to where the ref is (a conflict does not move it), the base moves to
    // it, so the next commit replaces what is there.
    async keepMine() {
      if (!this.edits) return { status: "committed", n: this.head, paths: [] };
      await this.refresh();
      this.edits.base = this.head;
      return this.settle();
    }
    // Take the server's version of these paths: the edits to them are
    // dropped, and the head is brought up to show theirs.
    async takeTheirs(paths) {
      if (!this.edits) return;
      this.edits.forget(paths);
      if (this.conflict && this.conflict.conflicts.every((p) => !this.edits.changes.has(p))) this.conflict = null;
      await this.refresh();
      this.rebaseEdits();
      this.ev.emit("edits", null);
    }
    settle() {
      clearTimeout(this.editT);
      return this.settling = (this.settling || Promise.resolve()).then(async () => {
        const tx = this.edits;
        if (!tx || !tx.changes.size) return { status: "committed", n: this.head, paths: [] };
        const sent = new Map(tx.changes), base = tx.base, paths = [...sent.keys()].sort();
        const note = "edited " + paths.slice(0, 3).join(", ") + (paths.length > 3 ? ", \u2026" : "");
        const r = await this.commitChanges(base, sent, { message: note, label: "you", event: { who: "you", note } });
        r.paths = paths;
        if (r.status === "committed") {
          this.conflict = null;
          for (const [p, c] of sent) if (tx.changes.get(p) === c) tx.changes.delete(p);
          const others = this.changed(base, r.n).filter((p) => !sent.has(p));
          if (others.every((p) => !tx.changes.has(p))) tx.base = r.n;
          this.rebaseEdits();
        } else {
          if (r.status === "conflict") this.conflict = r;
          this.ev.emit(r.status === "conflict" ? "conflict" : "error", r);
        }
        this.ev.emit("edits", null);
        return r;
      });
    }
  };
  Draft.EDIT_PAUSE = 400;

  // src/server/slop.js
  var Slop = {
    actions: null,
    apps: [],
    ev: emitter(),
    error: "",
    async init() {
      const claude = window.claude;
      const s = claude && typeof claude.use === "function" ? await claude.use("slop").catch(() => null) : null;
      if (!s || !s.actions) throw new Error("the bench runs on a slop server, as the bench app with its actor (apps/bench)");
      this.actions = s.actions;
      await this.refresh().catch((e) => {
        this.error = e.message || String(e);
      });
    },
    async call(name, args) {
      return await this.actions[name](args || {});
    },
    async refresh() {
      this.apps = await this.call("apps") || [];
      this.error = "";
      this.ev.emit("apps");
      return this.apps;
    },
    app(id) {
      return this.apps.find((a) => a.id === id) || null;
    }
  };
  async function sha256hex(text) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  var Drafts = {
    map: /* @__PURE__ */ new Map(),
    for(app, ref = "draft") {
      const k = app + "|" + ref;
      if (!this.map.has(k)) this.map.set(k, new Draft({ app, ref, call: (a, x) => Slop.call(a, x), hash: sha256hex }));
      return this.map.get(k);
    },
    drop(app, ref) {
      this.map.delete(app + "|" + ref);
    }
  };

  // src/server/instances.js
  var Instances = {
    ready: /* @__PURE__ */ new Map(),
    // app|kind (prop: app|prop|ref) → {ref, p: a promise of {id, kind, ref, n, broken}}
    key(P, kind, ref) {
      return P.app + "|" + kind + (kind === "prop" ? "|" + ref : "");
    },
    ensure(P, kind, ref) {
      const k = this.key(P, kind, ref), cur = this.ready.get(k);
      if (cur && (!ref || cur.ref === ref)) return cur.p;
      const p = Slop.call("instance", { app: P.app, kind, ref: kind === "dev" ? void 0 : ref });
      this.ready.set(k, { ref, p });
      p.catch(() => {
        if (this.ready.get(k) && this.ready.get(k).p === p) this.ready.delete(k);
      });
      return p;
    },
    // a view of the instance for a frame: {src, view, origin, …}
    async embed(P, kind, ref) {
      await this.ensure(P, kind, ref);
      return await Slop.call("embed", { app: P.app, kind, ref: kind === "prop" ? ref : void 0 });
    },
    // the view of a frame that reloaded or went away (best effort: it expires anyway)
    close(e) {
      if (e && e.view) Slop.call("close", { view: e.view }).catch(() => {
      });
    },
    async reset(P, kind, ref) {
      const r = await Slop.call("reset", { app: P.app, kind, ref: kind === "prop" ? ref : void 0 });
      this.ready.delete(this.key(P, kind, ref));
      return r;
    },
    // the page slop serves with the runtime: app.json's page
    entry(P) {
      try {
        return JSON.parse(P.read("app.json") || "{}").page || "index.html";
      } catch (e) {
        return "index.html";
      }
    }
  };
  var Watch = {
    P: null,
    timer: 0,
    logT: 0,
    status: null,
    ev: emitter(),
    onLog: () => {
    },
    // the shell's: (line) → the Console
    start(P) {
      clearInterval(this.timer);
      this.P = P;
      this.status = null;
      this.logT = Date.now() - 6e4;
      if (!P) return;
      this.timer = setInterval(() => this.poll(), 3e3);
      this.poll();
    },
    async poll() {
      const P = this.P;
      if (!P || document.hidden) return;
      try {
        const st = await Slop.call("status", { app: P.app });
        if (this.P !== P) return;
        this.status = st;
        P.refs = st.refs;
        this.ev.emit("status", st);
        const drafts = [P.draft, ...P.openProposals().filter((p) => p.draft).map((p) => p.draft)];
        await Promise.all(drafts.filter((d) => (st.refs[d.ref] ?? 0) !== d.head).map((d) => d.refresh()));
        if (st.dev) await this.logs(P);
      } catch (e) {
      }
    },
    // the dev instance's new log lines go to onLog
    async logs(P) {
      const r = await Slop.call("logs", { app: P.app, kind: "dev" });
      for (const l of r.lines || []) {
        if (l.at <= this.logT) continue;
        const level = l.level === "warn" ? "warn" : l.level === "error" ? "error" : "log";
        this.onLog({ t: l.at, level, text: l.text, src: "", frame: "actor", fid: "actor" });
      }
      for (const l of r.lines || []) this.logT = Math.max(this.logT, l.at);
      return r;
    },
    // the header's words for the draft and the dev instance
    label(P) {
      const d = P.draft, dev = this.status && this.status.dev;
      const edits = d.pending() ? d.conflict ? "conflict" : "unsaved" : "";
      const devText = !dev ? "" : dev.broken ? "dev broken" : dev.n === d.head ? "dev ok" : "dev on " + dev.n;
      const conflict = d.conflict ? "your edits to " + d.conflict.conflicts.join(", ") + " conflict with draft " + d.conflict.at : "";
      return { draft: "draft " + (d.head ?? "\u2013"), edits, dev: devText, title: dev && dev.broken || conflict, bad: !!(dev && dev.broken) || !!d.conflict };
    }
  };
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") Watch.poll();
  });

  // src/frames/streams.js
  var Streams = {
    frames: [],
    ev: emitter(),
    frame(fh, kind, detail, extra) {
      const e = { t: now(), kind, frame: fh.route, w: fh.w, fid: fh.fid, ws: fh.ws, detail: String(detail || "").slice(0, 200), ...extra || {} };
      this.frames.push(e);
      if (this.frames.length > 500) this.frames.shift();
      this.ev.emit("frameevent", e);
    },
    // project events and frame events in one list, oldest first
    merged(P, { kind, frame, since, limit = 50 } = {}) {
      const kinds = kind ? [].concat(kind) : null;
      const keep = (t, k) => (since == null || t > since) && (!kinds || kinds.includes(k));
      const proj = frame ? [] : P.events.filter((e) => keep(e.at, e.kind)).map((e) => ({
        t: e.at,
        source: "project",
        kind: e.kind,
        who: e.who === "agent" ? "claude" : e.who,
        ref: e.ref || void 0,
        n: e.n ?? void 0,
        paths: e.paths,
        detail: e.label || e.note || "",
        thread: e.thread || void 0
      }));
      const fr = this.frames.filter((e) => keep(e.t, e.kind) && (!frame || e.frame === frame || e.fid === frame)).map((e) => ({
        t: e.t,
        source: "frame",
        kind: e.kind,
        frame: e.frame + " " + e.w + "px",
        detail: e.detail
      }));
      return [...proj, ...fr].sort((a, b) => a.t - b.t).slice(-clamp(+limit || 50, 1, 500));
    },
    clear() {
      this.frames = [];
    }
  };

  // src/frames/host.js
  var FrameHosts = /* @__PURE__ */ new Set();
  var hostByNonce = /* @__PURE__ */ new Map();
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.__sb !== "probe") return;
    const fh = hostByNonce.get(m.nonce);
    if (!fh) return;
    const want = fh.next && fh.next.nonce === m.nonce ? fh.next.origin : fh.origin;
    if (want && e.origin !== want) return;
    fh.onMessage(m);
  });
  var showing = (ws) => ws === "draft" ? { kind: "dev", ref: null } : { kind: "prop", ref: ws };
  var FrameHost = class _FrameHost {
    // o: {project, route, w, h, kind: dev | test | prop, ref (prop: the proposal), fid, headless}
    constructor(o) {
      Object.assign(this, { project: o.project, route: o.route, w: o.w, h: o.h, kind: o.kind || "dev", ref: o.ref || null, fid: o.fid || uid("h"), headless: !!o.headless });
      this.el = h("div", { style: { position: "relative", width: o.w + "px", height: o.h + "px", overflow: "hidden" } });
      this.iframe = null;
      this.nonce = "";
      this.readyP = null;
      this.pend = /* @__PURE__ */ new Map();
      this.seq = 0;
      this.logs = [];
      this.issues = [];
      this.errors = 0;
      this.ev = emitter();
      this.loading = false;
      this.saved = null;
      this.embed = null;
      this.origin = "";
      this.layoutMap = null;
      FrameHosts.add(this);
    }
    // the workspace this frame shows
    get ws() {
      return this.kind !== "dev" && this.ref ? this.ref : "draft";
    }
    size(w, hh) {
      this.w = w;
      this.h = hh;
      Object.assign(this.el.style, { width: w + "px", height: hh + "px" });
      if (this.iframe) Object.assign(this.iframe.style, { width: w + "px", height: hh + "px" });
    }
    async load({ keepState = true } = {}) {
      if (keepState && this.iframe && this.ready) {
        try {
          this.saved = await this.call("state", [], 400);
        } catch {
        }
      }
      const style = { width: this.w + "px", height: this.h + "px", position: "absolute", left: 0, top: 0, border: 0, opacity: this.iframe ? 0 : 1 };
      const nonce = uid("n"), ifr = h("iframe", { allow: "clipboard-write; fullscreen", title: this.route, style });
      let res;
      const p = new Promise((r) => {
        res = r;
      });
      this.next = { ifr, nonce, res };
      this.loading = true;
      this.ready = false;
      this.readyP = p;
      this.el.appendChild(ifr);
      hostByNonce.set(nonce, this);
      this.logs = this.logs.filter((l) => l.keep);
      this.errors = 0;
      try {
        const e = await Instances.embed(this.project, this.kind, this.ref);
        if (!this.next || this.next.nonce !== nonce) return this;
        const u = new URL(this.route.split("#")[0] || e.src, e.src);
        u.searchParams.set("sbn", nonce);
        u.hash = this.route.includes("#") ? this.route.slice(this.route.indexOf("#")) : "";
        this.next.embed = e;
        this.next.origin = e.origin;
        ifr.src = u.href;
      } catch (err) {
        ifr.setAttribute("sandbox", "allow-scripts");
        ifr.srcdoc = '<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">The ' + this.kind + " instance could not be shown: " + escHtml(err.message || String(err)) + '</pre><script>parent.postMessage({ __sb: "probe", nonce: ' + JSON.stringify(nonce) + ', ev: "ready" }, "*")<\/script>';
      }
      const timer = setTimeout(() => {
        if (this.next && this.next.nonce === nonce) this.swap();
      }, 1e4);
      await p;
      clearTimeout(timer);
      return this;
    }
    // on screen with a layout: a canvas frame in a hidden tab measures as 0×0, so reads go to a headless frame instead
    get shown() {
      return this.headless || this.el.isConnected && this.el.getClientRects().length > 0;
    }
    reloadSoon() {
      clearTimeout(this.reloadT);
      this.reloadT = setTimeout(() => this.load({ keepState: true }), 60);
    }
    // Loaded and showing snapshot n (or later); resolves false after ms (an
    // activation that failed never reloads the frame).
    waitVersion(n, ms = 6e3) {
      if (n == null) return Promise.resolve(false);
      const ok = () => !!this.embed && this.embed.version >= n && this.ready && !this.loading;
      if (ok()) return Promise.resolve(true);
      return new Promise((res) => {
        const iv = setInterval(() => {
          if (ok()) {
            clearInterval(iv);
            clearTimeout(t);
            res(true);
          }
        }, 40);
        const t = setTimeout(() => {
          clearInterval(iv);
          res(false);
        }, ms);
      });
    }
    swap() {
      const n = this.next;
      if (!n) return;
      if (this.iframe && this.iframe !== n.ifr) {
        hostByNonce.delete(this.nonce);
        this.iframe.remove();
        if (this.embed && (!n.embed || n.embed.view !== this.embed.view)) Instances.close(this.embed);
      }
      n.ifr.style.opacity = 1;
      this.iframe = n.ifr;
      this.nonce = n.nonce;
      this.next = null;
      this.loading = false;
      this.ready = true;
      this.embed = n.embed || null;
      this.origin = n.origin || "";
      this.greet();
      for (const [, x] of this.pend) x.rej(Object.assign(new Error("page reloaded"), { kind: "frame" }));
      this.pend.clear();
      n.res(this);
      if (this.saved) {
        this.post({ op: "restore", args: [this.saved], id: 0 });
        this.saved = null;
      }
      if (!this.headless) {
        this.runCheck();
        _FrameHost.ui.ready(this);
        Streams.frame(this, "load", this.route);
      }
      this.ev.emit("ready");
    }
    // what the probe needs to know: the mode, and on the canvas its pins and the panels' preview
    greet() {
      if (this.headless) {
        this.post({ push: "mode", mode: "play" });
        return;
      }
      this.post({ push: "mode", mode: _FrameHost.ui.mode() });
      this.post({ push: "pins", pins: _FrameHost.ui.pinsFor(this.route) });
      const pv = _FrameHost.ui.preview();
      if (pv) this.post({ push: "preview", preview: pv });
    }
    async runCheck() {
      try {
        this.issues = await this.call("check", [], 4e3);
        this.ev.emit("issues", this.issues);
        _FrameHost.ui.health();
      } catch {
      }
      try {
        this.layoutMap = await this.call("layout", [], 4e3);
      } catch {
      }
    }
    post(m, nonce) {
      const nx = this.next && nonce === this.next.nonce, ifr = nx ? this.next.ifr : this.iframe, to = (nx ? this.next.origin : this.origin) || "*";
      if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage(Object.assign({ __sb: "host" }, m), to);
    }
    push(m) {
      this.post(m);
      if (this.next && this.next.ifr.contentWindow) this.next.ifr.contentWindow.postMessage(Object.assign({ __sb: "host" }, m), this.next.origin || "*");
    }
    async call(op, args = [], timeout = 5e3) {
      if (!this.ready) {
        const t = sleep(Math.max(timeout, 4500)).then(() => {
          throw Object.assign(new Error("frame did not load"), { kind: "frame" });
        });
        await Promise.race([this.readyP, t]);
      }
      const id = ++this.seq;
      return new Promise((res, rej) => {
        const t = setTimeout(() => {
          this.pend.delete(id);
          rej(Object.assign(new Error(op + " timed out in frame " + this.route), { kind: "timeout" }));
        }, timeout);
        this.pend.set(id, { res: (v) => {
          clearTimeout(t);
          res(v);
        }, rej: (e) => {
          clearTimeout(t);
          rej(e);
        } });
        this.post({ op, args, id });
      });
    }
    onMessage(m) {
      if (this.next && m.nonce === this.next.nonce) {
        if (m.ev === "ready") this.swap();
        return;
      }
      if (m.nonce !== this.nonce) return;
      if (m.ev === "ready") {
        this.greet();
        if (!this.headless) this.runCheck();
        return;
      }
      const ui = _FrameHost.ui;
      switch (m.ev) {
        case "res": {
          const p = this.pend.get(m.id);
          if (p) {
            this.pend.delete(m.id);
            m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error), { kind: "frame" }));
          }
          break;
        }
        case "log": {
          const l = { t: now(), level: m.level, text: m.text, src: m.src || "", frame: this.route, fid: this.fid };
          this.logs.push(l);
          if (this.logs.length > 300) this.logs.shift();
          if (m.level === "error") this.errors++;
          if (!this.headless) {
            ui.log(this, l);
            Streams.frame(this, "console", m.level + ": " + m.text);
          }
          break;
        }
        case "act":
          if (!this.headless) Streams.frame(this, m.kind, m.sel + (m.text ? " \u201C" + m.text + "\u201D" : ""), { sel: m.sel, text: m.text });
          break;
        case "pick":
          ui.pick(this, { ...m.info, fid: this.fid, route: this.route, ws: this.ws });
          break;
        case "rec":
          if (this.rec) this.recStep(m.step);
          break;
        case "pin":
          ui.placePin(this, m);
          break;
        case "pinclick":
          ui.openPin(this, m.id);
          break;
        case "textedit":
          ui.textEdit(this, m);
          break;
      }
    }
    // ---- recording: interact with a frame, get a scenario's steps ----
    async startRecording(fr) {
      this.rec = { steps: [], page: this.route, size: [this.w, this.h], fid: fr ? fr.id : null, t: now() };
      await this.load({ keepState: false });
      this.ev.emit("rec", this.rec);
    }
    recStep(step) {
      const r = this.rec;
      if (!r || !step) return;
      const last = r.steps[r.steps.length - 1];
      if (step.type && last && last.type === step.type) last.text = step.text;
      else if (step.expect && last && last.expect === step.expect) Object.assign(last, step);
      else r.steps.push(step);
      this.ev.emit("rec", r);
    }
    async stopRecording() {
      const r = this.rec;
      this.rec = null;
      if (r) this.route = r.page;
      this.saved = null;
      await this.load({ keepState: false });
      this.ev.emit("nav", this.route);
      this.ev.emit("rec", null);
      return r;
    }
    // show another page of the app (a hash route, or another file)
    navigate(route) {
      this.route = route || "index.html";
      this.saved = null;
      this.ev.emit("nav", this.route);
      return this.load({ keepState: false });
    }
    dispose() {
      FrameHosts.delete(this);
      hostByNonce.delete(this.nonce);
      if (this.next) hostByNonce.delete(this.next.nonce);
      this.el.remove();
      if (this.embed) Instances.close(this.embed);
      if (this.next && this.next.embed) Instances.close(this.next.embed);
    }
  };
  FrameHost.ui = {
    mode: () => "select",
    pinsFor: () => [],
    preview: () => null,
    health: () => {
    },
    ready: () => {
    },
    hostFor: () => null,
    log: () => {
    },
    pick: () => {
    },
    placePin: () => {
    },
    openPin: () => {
    },
    textEdit: () => {
    }
  };
  addEventListener("message", async (e) => {
    const m = e.data;
    if (!m || m.slop !== 1 || typeof m.type !== "string") return;
    let fh = null, cur = false;
    for (const x of FrameHosts) {
      if (x.next && x.next.embed && x.next.ifr.contentWindow === e.source) {
        fh = x;
        break;
      }
      if (x.embed && x.iframe && x.iframe.contentWindow === e.source) {
        fh = x;
        cur = true;
        break;
      }
    }
    if (!fh) return;
    const emb = cur ? fh.embed : fh.next.embed;
    if (e.origin !== emb.origin) return;
    const reply = (r) => e.source.postMessage(Object.assign({}, r, { slop: 1 }), emb.origin);
    const give = () => reply({ type: "view", view: emb.view, secret: emb.secret, expiresAt: emb.expiresAt });
    switch (m.type) {
      case "hello":
        give();
        return;
      case "renew":
        try {
          Object.assign(emb, await Slop.call("renew", { view: emb.view }));
          give();
        } catch (err) {
          if (cur) fh.reloadSoon();
        }
        return;
      case "reload":
      case "reopen":
        if (cur) fh.reloadSoon();
        return;
      case "consent":
        reply({ id: m.id, states: Object.fromEntries((Array.isArray(m.names) ? m.names : []).map((n) => [String(n), "denied"])) });
        toast(fh.route + " asked for " + (m.names || []).join(", ") + ": not in the bench; open the app on its mount");
        return;
      case "download":
        reply({ id: m.id, status: "declined" });
        return;
      case "confirm":
        reply({ id: m.id, approved: false });
        toast(fh.route + " asked to confirm a change: not in the bench");
        return;
      case "compose":
        reply({ id: m.id, opened: false });
        return;
      case "permissions":
        reply({ id: m.id });
        return;
    }
  });
  var Headless = {
    pool: /* @__PURE__ */ new Map(),
    root() {
      let r = $("#headless");
      if (!r) {
        r = h("div#headless", { "aria-hidden": "true", style: { position: "fixed", left: "-30000px", top: 0, width: "1px", height: "1px", overflow: "hidden", pointerEvents: "none" } });
        document.body.appendChild(r);
      }
      return r;
    },
    key(project, route, { kind = "dev", ref = null, w = 375, h: h2 = 720 } = {}) {
      return project.id + "|" + kind + "|" + (ref || "") + "|" + route + "|" + w + "x" + h2;
    },
    // o: {kind, ref, w, h}
    async get(project, route, o = {}) {
      const k = this.key(project, route, o);
      let fh = this.pool.get(k);
      if (!fh) {
        fh = new FrameHost({ project, route, w: o.w || 375, h: o.h || 720, kind: o.kind, ref: o.ref, headless: true });
        this.root().appendChild(fh.el);
        this.pool.set(k, fh);
        await fh.load();
      } else if (fh.stale) {
        fh.stale = false;
        await fh.load({ keepState: false });
      } else if (!fh.ready) await fh.readyP;
      return fh;
    },
    peek(project, route, o = {}) {
      return this.pool.get(this.key(project, route, o)) || null;
    },
    // a frame of its own, outside the pool (scenario runs); dispose it when done
    async fresh(project, route, o = {}) {
      const fh = new FrameHost({ project, route, w: o.w || 375, h: o.h || 720, kind: o.kind || "test", ref: o.ref, headless: true });
      this.root().appendChild(fh.el);
      await fh.load();
      return fh;
    },
    // every pooled frame of a project reloads on its next use (the instance moved)
    stale(project) {
      for (const fh of this.pool.values()) if (fh.project === project) fh.stale = true;
    },
    clear(project) {
      for (const [k, fh] of this.pool) if (!project || fh.project === project) {
        fh.dispose();
        this.pool.delete(k);
      }
    },
    // pooled frames of refs no longer live (a closed proposal) are disposed
    prune(project, live) {
      for (const [k, fh] of this.pool) if (fh.project === project && fh.ref && !live(fh.ref)) {
        fh.dispose();
        this.pool.delete(k);
      }
    }
  };

  // src/server/publish.js
  var Publish = {
    async preflight(P) {
      const r = await P.draft.settle();
      if (r.status !== "committed") {
        const why2 = r.status === "conflict" ? "they conflict with draft " + r.at + " in " + r.conflicts.join(", ") : r.error;
        throw new Error("your edits are not in draft (" + why2 + "): resolve that before publishing");
      }
      return await Slop.call("preflight", { app: P.app });
    },
    async run(P, pf, who = "you", note = "") {
      const n = pf.refs.draft, at = pf.refs.main ?? 0;
      const r = await Slop.call("publish", { app: P.app, n, ifAt: at, note });
      P.refs = { ...P.refs, main: n };
      const parts = [note, at ? "main was " + at : "first publish", pf.migrations.length ? "migrations: " + pf.migrations.join(", ") : ""];
      P.mark({ label: "Published draft " + n + " to main", note: parts.filter(Boolean).join(" \xB7 "), by: who, kind: "milestone" });
      Slop.refresh().catch(() => {
      });
      return { n, from: r.from ?? at };
    },
    async rollback(P, to, from, who = "you") {
      await Slop.call("publish", { app: P.app, n: to, ifAt: from, note: "rollback" });
      P.refs = { ...P.refs, main: to };
      P.mark({ label: "Rolled main back to " + to, note: "from " + from, by: who, kind: "milestone" });
      Slop.refresh().catch(() => {
      });
    },
    // A preflight as lines, for the dialog and the agent's approval card.
    lines(pf) {
      const d = pf.refs.draft, m = pf.refs.main;
      const out = [d === m ? "main is already draft " + d + ": nothing to publish" : "draft " + d + " \u2192 main" + (m != null ? " (now " + m + ")" : " (first publish)")];
      const files2 = [...pf.added.map((p) => "+" + p), ...pf.changed.map((p) => "~" + p), ...pf.removed.map((p) => "-" + p)];
      if (files2.length) out.push("files: " + files2.slice(0, 30).join(" "));
      if (pf.migrations.length) out.push("new migrations run on every production instance: " + pf.migrations.join(", "));
      if (!pf.dev) out.push("you have no dev instance: nothing has run this draft");
      else if (pf.dev.broken) out.push("your dev instance failed on it: " + pf.dev.broken);
      else if (pf.dev.n === d) out.push("your dev instance runs draft " + d + ": ok");
      else out.push("your dev instance is on " + pf.dev.n + ", not draft " + d + (pf.dev.next === d ? " (it has not been opened since)" : ""));
      const prod = pf.production.map((x) => x.store + " @" + x.n + (x.next ? " (" + x.next + " on its next view)" : "") + (x.broken ? " (broken)" : ""));
      out.push(prod.length ? "production: " + prod.join(", ") : "no production instance yet: nothing serves main");
      for (const b of pf.blockers) out.push("BLOCKED: " + b);
      return out;
    }
  };

  // src/agent/api/app.js
  var READ_KINDS = ["dev", "test"];
  var kindOf = (o) => {
    const k = o && o.kind || "dev";
    if (!READ_KINDS.includes(k)) throw Object.assign(new Error("kind is dev or test"), { kind: "invalid" });
    return k;
  };
  var APP = {
    "app.info": {
      sig: "",
      doc: "{app, refs: {draft, main, proposal/\u2026}, entry, workspace, instances: {dev, test, props: [one per proposal]}}",
      run: (ctx) => {
        const P = ctx.project, st = Watch.status || {};
        return { app: P.app, refs: P.refs, entry: Instances.entry(P), workspace: ctx.ws, instances: { dev: st.dev || null, test: st.test || null, props: st.props || [] } };
      }
    },
    "app.addresses": { sig: "", doc: "{urls: [{url, kind}]}: where the published app is on the web (the mounts serving it); none means an administrator has not given it an address yet. Tell the person their link after a publish.", run: (ctx) => Slop.call("addresses", { app: ctx.project.app }) },
    "app.status": { sig: "", doc: "where the refs are and what each instance runs: {refs, dev, test, prop} ({id, ref, n, broken})", run: (ctx) => Slop.call("status", { app: ctx.project.app }) },
    "app.logs": {
      sig: "{limit, kind}?",
      doc: "{broken, lines: [{at, level, text}]}: the instance's actor console, setup and activation failures",
      run: async (ctx, o = {}) => {
        const r = await Slop.call("logs", { app: ctx.project.app, kind: kindOf(o) });
        return { broken: r.broken || "", lines: (r.lines || []).slice(-clamp(+o.limit || 50, 1, 300)) };
      }
    },
    "app.docs": { sig: "coll, {kind}?", doc: "the documents of a collection", run: (ctx, coll, o) => Slop.call("docs", { app: ctx.project.app, kind: kindOf(o), coll }) },
    "app.doc": { sig: "path, {kind}?", doc: 'one document ("coll/id")', run: (ctx, path, o) => Slop.call("doc", { app: ctx.project.app, kind: kindOf(o), path }) },
    "app.sql": { sig: "query, args?, {kind}?", doc: "rows (read-only SQL on the instance's tables)", run: (ctx, query, args, o) => Slop.call("sql", { app: ctx.project.app, kind: kindOf(o), query, args: args || [] }) },
    "app.exec": {
      sig: "query, args?, {kind}?",
      doc: "runs SQL that may write (INSERT, UPDATE, DELETE) on the dev instance's tables (or the test instance: {kind: 'test'}); for removing the test rows you added, one by one",
      writes: "dev",
      run: (ctx, query, args, o) => Slop.call("exec", { app: ctx.project.app, kind: kindOf(o), query, args: args || [] })
    },
    "app.seed": {
      sig: "{docs, tables}",
      doc: "adds data to the dev instance: docs {coll: [rows]} (a row's id field names its document), tables {name: [rows]} (tables a migration made)",
      writes: "dev",
      run: async (ctx, spec) => {
        const r = await Slop.call("seed", { app: ctx.project.app, kind: "dev", docs: spec.docs || {}, tables: spec.tables || {} });
        await Promise.all([...FrameHosts].filter((fh) => fh.project === ctx.project && fh.kind === "dev").map((fh) => fh.load({ keepState: true })));
        return r;
      }
    },
    "app.reset": {
      sig: "{why}",
      doc: "asks the person with an approval card, then drops ALL the dev instance's data (what they entered too) for a fresh one on draft. Only when a migration changed in a way old rows cannot follow; never to clean up test data",
      writes: "dev",
      long: true,
      run: async (ctx, o = {}) => {
        const P = ctx.project;
        const ok = await ctx.approve("Reset the dev data of " + P.app + "?", "Every row and document in your dev instance goes, including what you entered yourself. The app's code is not touched." + (o && o.why ? "\nWhy: " + o.why : ""));
        if (!ok) throw Object.assign(new Error("the person declined the reset"), { kind: "approval" });
        const r = await Instances.reset(P, "dev");
        await Promise.all([...FrameHosts].filter((fh) => fh.project === P && fh.kind === "dev").map((fh) => fh.load({ keepState: false })));
        return r;
      }
    },
    // publishing is the person's: the agent checks, and asks with an approval card
    "publish.check": {
      sig: "",
      doc: "what publishing would do: {refs, added, changed, removed, migrations, blockers, production, dev, summary}",
      long: true,
      run: async (ctx) => {
        const pf = await Publish.preflight(ctx.project);
        return { ...pf, summary: Publish.lines(pf) };
      }
    },
    "publish.run": {
      sig: "{note}?",
      doc: "asks the person with an approval card; publishes draft to main only if they approve",
      writes: "main",
      long: true,
      run: async (ctx, o = {}) => {
        const P = ctx.project, pf = await Publish.preflight(P);
        if (pf.refs.draft === pf.refs.main) return { published: false, why: "main is already draft " + pf.refs.draft };
        if (pf.blockers.length) throw Object.assign(new Error("not publishable: " + pf.blockers.join("; ")), { kind: "policy" });
        const note = o.note ? String(o.note) : "";
        const ok = await ctx.approve("Publish draft " + pf.refs.draft + " of " + P.app + " to main?", [note, ...Publish.lines(pf)].filter(Boolean).join("\n"));
        if (!ok) throw Object.assign(new Error("the person declined to publish"), { kind: "approval" });
        const r = await Publish.run(P, pf, ctx.who, note);
        return { published: true, n: r.n, from: r.from, rollback: "publishing " + r.from + " again rolls back; the person can do it from the rollout dialog" };
      }
    }
  };

  // src/model/timeline.js
  function stampEvent(e, headOf) {
    const ref = e.ref || "draft";
    return { ...e, ref, n: e.n ?? headOf(ref) ?? null };
  }
  function snapshotAt(P, seq, ref = "draft") {
    const e = P.event(seq);
    return e && e.ref === ref && isSnap(e.n) ? e.n : null;
  }
  var isSnap = (n) => Number.isInteger(n) && n > 0;
  function checkSnap(n) {
    if (!isSnap(n)) throw Object.assign(new Error("a snapshot number is a positive integer (got " + JSON.stringify(n) + ")"), { kind: "invalid" });
    return n;
  }
  var MADE = /* @__PURE__ */ new Set(["commit", "outside"]);
  async function versions(P, path, ref = "draft", limit = 200) {
    const d = P.draftOf(ref), out = [];
    let last;
    for (const e of P.events.filter((e2) => e2.n != null && e2.ref === ref).slice(-limit)) {
      const f = (await d.listingOf(e.n)).get(path), sum = f ? f.sha256 : null;
      if (sum === last) continue;
      last = sum;
      out.push({ seq: e.seq, n: e.n, at: e.at, who: e.who, kind: e.kind, thread: e.thread, note: e.note || e.label || "", sha256: sum, observed: !MADE.has(e.kind) });
    }
    return out;
  }
  var blames = /* @__PURE__ */ new Map();
  async function blame(P, path, ref = "draft") {
    const d = P.draftOf(ref), key = P.app + "|" + ref + "|" + path + "|" + d.head;
    if (blames.has(key)) return blames.get(key);
    let attrib = [], prev = "";
    for (const v of await versions(P, path, ref)) {
      const text = v.sha256 ? await d.text(v.n, path) : null;
      if (text === null) {
        attrib = [];
        prev = "";
        continue;
      }
      const next = [];
      for (const x of diffLines(prev, text)) {
        if (x.op === " ") next.push(attrib[x.a - 1]);
        else if (x.op === "+") next.push(v.observed ? void 0 : v.seq);
      }
      attrib = next;
      prev = text;
    }
    if (blames.size > 50) blames.delete(blames.keys().next().value);
    blames.set(key, attrib);
    return attrib;
  }
  function why(P, seq) {
    const e = P.event(seq);
    if (!e) return null;
    const out = { seq, at: e.at, who: e.who, kind: e.kind, ref: e.ref, n: e.n, note: e.note || e.label || "", thread: e.thread || null };
    const th = e.thread && P.threads.get(e.thread);
    if (!th) return out;
    out.threadTitle = th.title;
    out.role = th.role || null;
    const evs = P.events, i = evs.indexOf(e);
    let msg = null;
    for (let j = i; j >= 0; j--) if (evs[j].kind === "msg" && evs[j].thread === th.id) {
      msg = evs[j];
      break;
    }
    if (msg) out.request = msg.note;
    else if (th.parent) {
      const d = evs.slice(0, i + 1).reverse().find((x) => x.kind === "delegate" && x.child === th.id);
      if (d) {
        out.request = d.note;
        out.delegatedBy = d.thread;
      }
    }
    const turn = evs.slice(i).find((x) => x.kind === "turn" && x.thread === th.id);
    if (turn) out.reply = (turn.note || "").replace(/^#+\s*/, "");
    const lo = msg ? evs.indexOf(msg) : Math.max(0, i - 200), hi = turn ? evs.indexOf(turn) : i + 200;
    out.marks = evs.slice(lo, hi + 1).filter((x) => x.kind === "mark" && x.thread === th.id).map((x) => ({ seq: x.seq, kind: x.mk, label: x.label, why: x.note || void 0 }));
    return out;
  }
  async function changesSince(P, ref, then, view = P.view(ref)) {
    checkSnap(then);
    const d = P.draftOf(ref);
    const old = await d.listingOf(then), out = [];
    for (const path of /* @__PURE__ */ new Set([...old.keys(), ...view.list()])) {
      const a = old.get(path), b = view.entry(path);
      const same = a && b ? typeof b.text === "string" ? await d.text(then, path) === b.text : a.sha256 === b.sha256 : !a && !b;
      if (same) continue;
      out.push({ path, before: a ? await d.text(then, path) : null, after: b && typeof b.text === "string" ? b.text : null, entry: b });
    }
    return out.sort((x, y) => x.path.localeCompare(y.path));
  }
  async function restoreTo(P, ref, then, { who = "you", label: label2 = "snapshot " + then } = {}) {
    checkSnap(then);
    const d = P.draftOf(ref);
    await d.settle();
    const tx = d.begin({ label: "restore", event: { who, note: "restored to " + label2 } });
    for (const path of /* @__PURE__ */ new Set([...(await d.listingOf(then)).keys(), ...d.list()])) {
      const a = (await d.listingOf(then)).get(path), b = d.entry(path);
      if (!a) {
        if (b) tx.remove(path);
        continue;
      }
      if (b && b.sha256 === a.sha256) continue;
      const text = await d.text(then, path);
      if (text !== null) {
        if (!b || b.text !== text) tx.write(path, text);
      } else tx.copy(path, a);
    }
    return await tx.commit();
  }

  // src/agent/api/files.js
  var missing = (msg) => Object.assign(new Error(msg), { kind: "missing" });
  var invalid = (msg) => Object.assign(new Error(msg), { kind: "invalid" });
  function readText(tx, path) {
    if (typeof path !== "string" || !path) throw invalid("path must be a non-empty string");
    const t = tx.read(path);
    if (t !== null) return t;
    if (tx.entry(path)) throw Object.assign(new Error(path + " is kept by hash (binary, or too large to edit): it can be copied or removed, not read as text"), { kind: "binary" });
    const near = tx.list().filter((p) => p.split("/").pop() === path.split("/").pop());
    throw missing("no file " + path + (near.length ? ". Did you mean " + near.join(" or ") + "?" : ". Files: " + tx.list().slice(0, 60).join(", ")));
  }
  var sizeOf = (e) => typeof e.text === "string" ? e.text.length : e.size;
  var FILES = {
    "files.list": {
      sig: "prefix?",
      doc: "[{path, size, lines}] (lines: null for files kept by hash)",
      run: (ctx, prefix) => ctx.tx.list().filter((p) => !prefix || p.startsWith(prefix)).map((path) => {
        const e = ctx.tx.entry(path);
        return { path, size: sizeOf(e), lines: typeof e.text === "string" ? e.text.split("\n").length : null };
      })
    },
    "files.read": { sig: "path", doc: "text", run: (ctx, path) => readText(ctx.tx, path) },
    "files.exists": { sig: "path", doc: "bool", run: (ctx, path) => ctx.tx.has(path) },
    "files.lines": {
      sig: "path, from?, to?",
      doc: 'numbered lines "12| \u2026" (200 by default)',
      run: (ctx, path, from = 1, to) => {
        const ls = readText(ctx.tx, path).split("\n");
        from = Math.max(1, +from || 1);
        to = Math.min(ls.length, +to || from + 199);
        const w = String(to).length;
        return ls.slice(from - 1, to).map((l, i) => String(from + i).padStart(w) + "| " + l).join("\n");
      }
    },
    "files.grep": {
      sig: "regex, {path, flags}?",
      doc: "[{path, line, text}] (text files; at most 200)",
      run: (ctx, pattern, o = {}) => {
        let re;
        try {
          re = new RegExp(String(pattern), o.flags || "i");
        } catch (e) {
          throw invalid("bad regex: " + e.message);
        }
        const out = [];
        for (const path of ctx.tx.list()) {
          if (o.path && !path.startsWith(o.path)) continue;
          const t = ctx.tx.read(path);
          if (t === null) continue;
          t.split("\n").forEach((l, i) => {
            if (out.length < 200 && re.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 200) });
          });
        }
        return out;
      }
    },
    "files.write": {
      sig: "path, text",
      doc: "creates or replaces the whole file",
      writes: "files",
      run: (ctx, path, text) => {
        const created = !ctx.tx.has(path);
        ctx.tx.write(path, String(text));
        return { path, created, lines: String(text).split("\n").length };
      }
    },
    "files.replace": {
      sig: "path, find, replacement, {all}?",
      doc: "exact-text edit; error kind anchor when the text is not found or found more than once",
      writes: "files",
      run: (ctx, path, find, repl, o = {}) => {
        const t = readText(ctx.tx, path);
        if (typeof find !== "string" || !find) throw invalid("find must be a non-empty string");
        const n = t.split(find).length - 1;
        if (!n) throw Object.assign(new Error("text not found in " + path + "; read the file and copy the exact text, whitespace included"), { kind: "anchor" });
        if (n > 1 && !o.all) {
          const lines = t.split("\n").map((l, i) => l.includes(find.split("\n")[0]) ? i + 1 : 0).filter(Boolean).slice(0, 6);
          throw Object.assign(new Error("text found " + n + " times in " + path + " (lines " + lines.join(", ") + "); include more surrounding text, or pass {all: true}"), { kind: "anchor" });
        }
        ctx.tx.write(path, o.all ? t.split(find).join(String(repl)) : t.replace(find, () => String(repl)));
        return { path, replaced: o.all ? n : 1 };
      }
    },
    "files.remove": {
      sig: "path",
      writes: "files",
      run: (ctx, path) => {
        if (!ctx.tx.has(path)) throw missing("no file " + path);
        ctx.tx.remove(path);
        return { path, removed: true };
      }
    },
    // who last changed each run of lines (at the workspace's head), and why:
    // the request, reply and marks of that turn
    "files.blame": {
      sig: "path, {from, to}?",
      doc: "runs of lines with who last changed them, when and why (look before undoing someone's change)",
      run: async (ctx, path, o = {}) => {
        const P = ctx.project, text = P.draftOf(ctx.ws).read(path);
        if (text === null) throw missing("no text file " + path + " at " + ctx.ws + " " + P.draftOf(ctx.ws).head);
        const at = await blame(P, path, ctx.ws), lines = text.split("\n");
        const from = Math.max(1, +o.from || 1), to = Math.min(lines.length, +o.to || lines.length), runs = [];
        for (let k = from; k <= to; k++) {
          const seq = at[k - 1], last = runs[runs.length - 1];
          if (last && last.seq === seq) last.to = k;
          else runs.push({ from: k, to: k, seq });
        }
        return runs.map((r) => {
          const w = r.seq != null ? why(P, r.seq) : null;
          return {
            lines: r.from === r.to ? String(r.from) : r.from + "\u2013" + r.to,
            seq: r.seq,
            who: !w ? "before the timeline" : w.who === "agent" ? "claude" + (w.role ? " (" + w.role + ")" : "") : w.who,
            when: w ? new Date(w.at).toISOString() : void 0,
            request: w && w.request || void 0,
            reply: w && w.reply || void 0,
            marks: w && w.marks && w.marks.length ? w.marks.map((m) => m.kind + ": " + m.label + (m.why ? " (" + m.why + ")" : "")) : void 0,
            note: w && !w.request && w.note || void 0,
            thread: w && w.thread || void 0
          };
        });
      }
    },
    "files.copy": {
      sig: "from, to",
      doc: "copies a file, text or kept by hash",
      writes: "files",
      pathOf: ([, to]) => to,
      run: (ctx, from, to) => {
        const e = ctx.tx.entry(from);
        if (!e) throw missing("no file " + from);
        typeof e.text === "string" ? ctx.tx.write(to, e.text) : ctx.tx.copy(to, e);
        return { from, to };
      }
    }
  };

  // src/frames/layout.js
  var STYLE_PARTS = ["color", "background", "font-size", "font-weight"];
  function layoutDiff(A, B) {
    const am = new Map((A && A.items || []).map((i) => [i.k, i])), bm = new Map((B && B.items || []).map((i) => [i.k, i]));
    const out = [];
    for (const [k, b] of bm) {
      const a = am.get(k);
      if (!a) {
        out.push({ k, kind: "added", b });
        continue;
      }
      const d = [], [ax, ay, aw, ah] = a.b, [bx, by, bw, bh] = b.b;
      if (Math.abs(aw - bw) > 1 || Math.abs(ah - bh) > 1) d.push({ what: "size", from: aw + "\xD7" + ah, to: bw + "\xD7" + bh });
      if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) d.push({ what: "move", dx: bx - ax, dy: by - ay });
      if ((a.x || "") !== (b.x || "")) d.push({ what: "text", from: a.x || "", to: b.x || "" });
      if (a.st !== b.st) {
        const sa = (a.st || "").split("|"), sb = (b.st || "").split("|");
        STYLE_PARTS.forEach((p, i) => {
          if (sa[i] !== sb[i]) d.push({ what: p, from: sa[i], to: sb[i] });
        });
      }
      if (!!a.hid !== !!b.hid) d.push({ what: "visibility", from: a.hid ? "hidden" : "visible", to: b.hid ? "hidden" : "visible" });
      if (d.length) out.push({ k, kind: "changed", a, b, d });
    }
    for (const [k, a] of am) if (!bm.has(k)) out.push({ k, kind: "removed", a });
    const byKey = new Map(out.map((c) => [c.k, c]));
    const moveOf = (c) => c && c.kind === "changed" && c.d.find((x) => x.what === "move");
    const keep = out.filter((c) => {
      const it = c.b || c.a, par = byKey.get(it.p);
      if (par && (par.kind === "added" || par.kind === "removed") && par.kind === c.kind) return false;
      if (c.kind === "changed" && c.d.length === 1 && c.d[0].what === "move") {
        const pm = moveOf(par);
        if (pm && pm.dx === c.d[0].dx && pm.dy === c.d[0].dy) return false;
      }
      return true;
    });
    return { changes: keep, heightFrom: A ? A.h : 0, heightTo: B ? B.h : 0 };
  }
  function diffSummary(diff, max = 12) {
    const lines = [], label2 = (it) => it.t + (it.x ? ' "' + it.x.slice(0, 30) + '"' : "") + (it.s ? " @" + it.s : "");
    const base = (t) => t.replace(/#[^.]*/, "");
    const fmt = (x) => x.what === "move" ? "moved " + (x.dx >= 0 ? "+" : "") + x.dx + "," + (x.dy >= 0 ? "+" : "") + x.dy : x.what === "text" ? 'text "' + x.from.slice(0, 24) + '" \u2192 "' + x.to.slice(0, 24) + '"' : x.what + " " + x.from + " \u2192 " + x.to;
    if (diff.heightFrom && diff.heightTo && Math.abs(diff.heightFrom - diff.heightTo) > 1) lines.push("page height " + diff.heightFrom + " \u2192 " + diff.heightTo);
    const groups = /* @__PURE__ */ new Map();
    for (const c of diff.changes) {
      const it = c.b || c.a;
      const what = c.kind === "added" ? "added " + it.b[2] + "\xD7" + it.b[3] : c.kind === "removed" ? "removed" : c.d.map(fmt).join("; ");
      const groupable = !(c.kind === "changed" && c.d.some((x) => x.what === "text"));
      const k = groupable ? base(it.t) + "|" + what : c.k;
      if (!groups.has(k)) groups.set(k, { what, items: [] });
      groups.get(k).items.push(it);
    }
    for (const g of groups.values()) {
      const it = g.items[0], n = g.items.length;
      if (n > 1) lines.push(n + " \xD7 " + base(it.t) + ": " + g.what);
      else if (g.what.startsWith("added ")) lines.push("+ " + label2(it) + " " + g.what.slice(6));
      else if (g.what === "removed") lines.push("\u2212 " + label2(it));
      else lines.push(label2(it) + ": " + g.what);
    }
    return lines.length > max ? [...lines.slice(0, max), "\u2026 " + (lines.length - max) + " more"] : lines;
  }
  function diffBoxes(diff) {
    const parent = /* @__PURE__ */ new Map();
    for (const c of diff.changes) for (const it of [c.a, c.b]) if (it) parent.set(it.k, it.p);
    const changedKeys = new Set(diff.changes.map((c) => c.k)), hasChangedInside = /* @__PURE__ */ new Set();
    for (const k of changedKeys) {
      let p = parent.get(k), guard2 = 0;
      while (p && guard2++ < 60) {
        hasChangedInside.add(p);
        p = parent.get(p) || (p.includes(">") ? p.slice(0, p.lastIndexOf(">")) : null);
      }
    }
    const before = [], after = [];
    for (const c of diff.changes) {
      if (c.kind === "changed" && hasChangedInside.has(c.k) && c.d.every((x) => x.what === "size" || x.what === "move")) continue;
      if (c.a) before.push({ b: c.a.b, c: c.kind === "removed" ? "del" : "chg" });
      if (c.b) after.push({ b: c.b.b, c: c.kind === "added" ? "add" : "chg" });
    }
    return { before: before.slice(0, 120), after: after.slice(0, 120) };
  }
  var Snaps = {
    metas: [],
    app: null,
    docs: /* @__PURE__ */ new Map(),
    // the open project's snapshots (meta only)
    async open(P) {
      this.app = P.app;
      this.docs.clear();
      this.metas = await Slop.call("snaps", { app: P.app }).catch(() => []);
    },
    list(P) {
      return P.app === this.app ? this.metas : [];
    },
    async capture(fh) {
      const raw = await fh.call("snapshot", [], 6e3);
      return { doc: { html: raw.html, css: raw.css || {}, layout: raw.layout, scroll: raw.scroll }, route: fh.route, w: fh.w, h: fh.h, ws: fh.ws };
    },
    // take and keep one; returns its meta (the newest of the same page, size
    // and workspace when nothing changed and no label is given)
    async take(P, fh, { label: label2, by = "you", note } = {}) {
      const s = await this.capture(fh), hash = hashStr(s.doc.html);
      const last = this.list(P).filter((x) => x.route === s.route && x.w === s.w && x.ws === s.ws).slice(-1)[0];
      if (last && last.hash === hash && !label2) return last;
      const lastEvent = P.events.filter((e) => e.seq != null).slice(-1)[0];
      const meta = { route: s.route, w: s.w, h: s.h, ws: s.ws, label: label2 || null, note: note || void 0, by, hash, seq: lastEvent ? lastEvent.seq : null };
      const id = "sn" + uid();
      await Slop.call("saveSnap", { id, app: P.app, meta, doc: s.doc });
      const m = { ...meta, id, t: now() };
      this.metas.push(m);
      this.docs.set(id, s.doc);
      return m;
    },
    // a snapshot's frozen page {html, css, layout, scroll}
    async load(P, id) {
      if (!this.docs.has(id)) {
        const r = await Slop.call("snap", { id });
        this.docs.set(id, r.doc);
      }
      return this.docs.get(id);
    },
    // a frozen page: its own scripts are gone; ours restores scroll and outlines boxes
    render(doc, { boxes = [], scroll } = {}) {
      let html = doc.html;
      for (const [file, t] of Object.entries(doc.css || {})) html = html.split("/*@css " + file + "*/").join(t.replace(/<\/style/gi, "<\\/style"));
      const sc = scroll || doc.scroll || [0, 0];
      const script = "<script>(" + function(sc2, boxes2) {
        const draw = () => {
          scrollTo(sc2[0], sc2[1]);
          for (const x of boxes2) {
            const d = document.createElement("div");
            const col = x.c === "add" ? "30,138,90" : x.c === "del" ? "226,0,26" : "31,111,196";
            d.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;left:" + x.b[0] + "px;top:" + x.b[1] + "px;width:" + Math.max(2, x.b[2]) + "px;height:" + Math.max(2, x.b[3]) + "px;outline:2px solid rgb(" + col + ");background:rgba(" + col + ",.10)";
            document.documentElement.appendChild(d);
          }
        };
        document.readyState === "complete" ? draw() : addEventListener("load", draw);
      }.toString() + ")(" + JSON.stringify(sc) + "," + JSON.stringify(boxes).replace(/</g, "\\u003c") + ")<\/script>";
      return html.replace(/<\/body>/i, script + "</body>");
    },
    // an element showing a frozen page at a scale
    frozen(doc, meta, { scale = 0.25, boxes, title, full } = {}) {
      const hh = full ? clamp(Math.max(meta.h, doc.layout && doc.layout.h || 0), 200, 3e3) : meta.h;
      const ifr = h("iframe", { sandbox: "allow-scripts", title: title || meta.route, style: { width: meta.w + "px", height: hh + "px", border: 0, transform: "scale(" + scale + ")", transformOrigin: "0 0", background: "transparent", pointerEvents: scale < 0.9 ? "none" : "auto" } });
      ifr.srcdoc = this.render(doc, { boxes, scroll: full ? [0, 0] : void 0 });
      return h("div", { style: { width: meta.w * scale + "px", height: hh * scale + "px", overflow: "hidden", outline: "1px solid var(--hair)", flex: "none" } }, ifr);
    }
  };
  async function layoutIn(P, f, ws, { headless } = {}) {
    const fh = await hostIn(P, f, ws, { headless });
    return { fh, layout: await fh.call("layout", [], 5e3) };
  }
  async function hostIn(P, f, ws, { headless } = {}) {
    let fh = headless ? null : FrameHost.ui.hostFor(f.id);
    if (!fh || !fh.shown || fh.ws !== ws) {
      const vis = FrameHost.ui.hostFor(f.id);
      fh = await Headless.get(P, vis ? vis.route : f.route, { ...showing(ws), w: f.w, h: f.h });
    }
    if (!fh.ready) await fh.readyP;
    return fh;
  }

  // src/agent/api/frames.js
  var frameOf = (ctx, id) => {
    const P = ctx.project, f = id ? P.frame(id) : P.board().frames[0];
    if (!f) throw missing("no frame " + id + ". Frames: " + (P.board().frames.map((x) => x.id + " " + x.route).join(", ") || "none"));
    return f;
  };
  var hostOf = (ctx, id) => hostIn(ctx.project, frameOf(ctx, id), ctx.ws);
  var info = (f) => {
    const v = FrameHost.ui.hostFor(f.id);
    return { id: f.id, label: f.label || void 0, route: v ? v.route : f.route, w: f.w, h: f.h, x: f.x, y: f.y, errors: v ? v.errors : 0, issues: v ? v.issues.length : 0 };
  };
  var canvasLog = (ctx, note) => ctx.project.log({ kind: "canvas", who: ctx.who, thread: ctx.thread, note });
  var changed = (P) => {
    P.saveMeta();
    P.ev.emit("frames");
  };
  var FRAMES = {
    "frames.list": { sig: "", doc: "[{id, label, route, w, h, x, y, errors, issues}]", run: (ctx) => ctx.project.board().frames.map(info) },
    "frames.open": {
      sig: "route, {w, h, x, y, label, new}?",
      doc: "a frame (reuses one showing that page at that size unless new: true)",
      run: (ctx, route, o = {}) => {
        const P = ctx.project, w = o.w || 375, hh = o.h || 720;
        const ex = !o.new && P.board().frames.find((f2) => info(f2).route === route && f2.w === w && f2.h === hh);
        if (ex) return { ...info(ex), reused: true, note: "a frame already shows " + route + " at this size; pass {new: true} for another" };
        const f = P.addFrame({ route, w, h: hh, x: o.x, y: o.y });
        if (o.label) {
          f.label = String(o.label).slice(0, 60);
          changed(P);
        }
        canvasLog(ctx, "opened " + route + " " + w + "\xD7" + hh);
        return info(f);
      }
    },
    "frames.update": {
      sig: "frameId, {route, w, h, x, y, label}",
      run: (ctx, id, o) => {
        const f = frameOf(ctx, id);
        if (o.w != null) f.w = clamp(Math.round(+o.w) || f.w, 240, 2400);
        if (o.h != null) f.h = clamp(Math.round(+o.h) || f.h, 200, 4e3);
        if (o.x != null) f.x = Math.round(+o.x) || 0;
        if (o.y != null) f.y = Math.round(+o.y) || 0;
        if (o.label !== void 0) f.label = o.label ? String(o.label).slice(0, 60) : void 0;
        if (o.route && o.route !== f.route) {
          const v = FrameHost.ui.hostFor(f.id);
          f.route = o.route;
          if (v) v.navigate(o.route);
        }
        changed(ctx.project);
        return info(f);
      }
    },
    "frames.move": { sig: "frameId, x, y", run: (ctx, id, x, y) => FRAMES["frames.update"].run(ctx, id, { x, y }) },
    "frames.label": { sig: "frameId, label?", run: (ctx, id, label2) => FRAMES["frames.update"].run(ctx, id, { label: label2 || null }) },
    "frames.close": {
      sig: "frameId",
      run: (ctx, id) => {
        const f = frameOf(ctx, id);
        ctx.project.removeFrame(f.id);
        canvasLog(ctx, "closed " + (f.label || f.route));
        return { closed: f.id, remaining: ctx.project.board().frames.length };
      }
    },
    "frames.arrange": {
      sig: "rows, {gap, rowGap, x, y}?",
      doc: "lays frames out in rows ([[id, id], [id]]), left to right, then fits the view",
      run: (ctx, rows, o = {}) => {
        if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('rows is a list of rows, each a list of frame ids: [["f1", "f2"], ["f3"]]'), { kind: "invalid" });
        const gap = o.gap ?? 60, rowGap = o.rowGap ?? 110;
        let y = o.y ?? 0, placed = 0;
        for (const row of rows) {
          let x = o.x ?? 0, hmax = 0;
          for (const id of [].concat(row)) {
            const f = frameOf(ctx, id);
            f.x = x;
            f.y = y;
            x += f.w + gap;
            hmax = Math.max(hmax, f.h);
            placed++;
          }
          y += hmax + rowGap;
        }
        changed(ctx.project);
        canvasLog(ctx, "arranged " + plural(placed, "frame") + " in " + plural(rows.length, "row"));
        setTimeout(() => ctx.ui.fit(), 120);
        return ctx.project.board().frames.map(info);
      }
    },
    "frames.focus": { sig: "frameId?", run: (ctx, id) => {
      const f = id ? frameOf(ctx, id) : null;
      setTimeout(() => f ? ctx.ui.focusFrame(f.id) : ctx.ui.fit(), 60);
      return true;
    } },
    "frames.check": {
      sig: "frameId?",
      doc: "{errors, issues}: layout overflow, contrast, a11y, console errors",
      run: async (ctx, id) => {
        const fh = await hostOf(ctx, id), issues = await fh.call("check", [], 4e3);
        return { route: fh.route, errors: fh.logs.filter((l) => l.level === "error").map((l) => l.text + (l.src ? " @" + l.src : "")).slice(-10), issues };
      }
    },
    "frames.outline": {
      sig: "frameId?",
      doc: "the DOM as an indented tree, with @file:line for each element",
      run: async (ctx, id) => {
        const nodes = await (await hostOf(ctx, id)).call("outline", [300]);
        return nodes.map((n) => "  ".repeat(n.d) + n.tag + (n.id ? "#" + n.id : "") + (n.cls ? "." + n.cls : "") + (n.text ? ' "' + n.text + '"' : "") + (n.src ? "  @" + n.src : "")).join("\n");
      }
    },
    "frames.inspect": {
      sig: "frameId, target",
      doc: "box, computed styles, matched CSS rules with their files",
      run: async (ctx, id, target) => {
        const r = await (await hostOf(ctx, id)).call("inspect", [target]);
        r.rules = r.rules.map((x) => ({ file: x.file, selector: x.selector, media: x.media || void 0, css: x.text }));
        return r;
      }
    },
    "frames.query": { sig: "frameId, selector", doc: "matches, each with attrs (data-*, href, name, value, checked, aria-*)", run: async (ctx, id, sel) => (await hostOf(ctx, id)).call("query", [sel]) },
    "frames.count": { sig: "frameId, selector", run: async (ctx, id, sel) => {
      const fh = await hostOf(ctx, id);
      await fh.call("settle", [600], 2e3).catch(() => {
      });
      return fh.call("count", [sel]);
    } },
    "frames.text": { sig: "frameId?, target?", doc: "visible text", run: async (ctx, id, target) => (await hostOf(ctx, id)).call("text", [target || null]) },
    "frames.click": { sig: "frameId, target", run: async (ctx, id, target) => {
      const r = await (await hostOf(ctx, id)).call("click", [target]);
      await sleep(120);
      return r;
    } },
    "frames.type": { sig: "frameId, target, text", run: async (ctx, id, target, text) => (await hostOf(ctx, id)).call("type", [target, text]) },
    "frames.waitFor": {
      sig: "frameId, selector, {timeout}?",
      doc: "waits for a visible match",
      run: async (ctx, id, sel, o = {}) => {
        const fh = await hostOf(ctx, id), t = clamp(+o.timeout || 2e3, 50, 15e3);
        return fh.call("waitFor", [sel, t], t + 1500);
      }
    },
    "frames.console": { sig: "frameId?", run: async (ctx, id) => (await hostOf(ctx, id)).logs.slice(-30).map((l) => l.level + ": " + l.text + (l.src ? " @" + l.src : "")) },
    "frames.reload": { sig: "frameId?", run: async (ctx, id) => {
      const fh = await hostOf(ctx, id);
      await fh.load({ keepState: false });
      return { route: fh.route, errors: fh.errors };
    } },
    "frames.layout": {
      sig: "frameId?, {near}?",
      doc: "every rendered element: key, tag, box [x, y, w, h], own text, src",
      run: async (ctx, id, o = {}) => {
        const fh = await hostOf(ctx, id), L = await fh.call("layout", [], 5e3);
        let items = L.items;
        if (o.near) {
          const q = String(o.near);
          items = items.filter((i) => (i.s || "").startsWith(q) || i.k.includes(q) || i.t.includes(q) || (i.x || "").includes(q));
        }
        return { route: fh.route, width: L.w, height: L.h, count: L.items.length, items: items.slice(0, 150).map((i) => ({ key: i.k, tag: i.t, box: i.b, text: i.x, src: i.s, hidden: i.hid ? true : void 0 })) };
      }
    },
    "frames.snapshot": {
      sig: "frameId?, label?",
      doc: "a frozen copy of the page and its layout",
      run: async (ctx, id, label2) => {
        const m = await Snaps.take(ctx.project, await hostOf(ctx, id), { label: label2 || null, by: ctx.who });
        return { id: m.id, route: m.route, w: m.w, ws: m.ws, label: m.label, t: new Date(m.t).toISOString() };
      }
    },
    // layout differences: this workspace against another (a proposal against
    // draft by default; in draft, against the newest snapshot of the page)
    "frames.compare": {
      sig: "frameId, {with}?",
      doc: "layout differences against draft (from a proposal), a proposal ref, or a snapshot id",
      run: async (ctx, id, o = {}) => {
        const P = ctx.project, f = frameOf(ctx, id), cur = await layoutIn(P, f, ctx.ws, { headless: true });
        let what = o.with, other;
        if (!what) {
          if (ctx.ws !== "draft") what = "draft";
          else {
            const s = Snaps.list(P).filter((x) => x.route === cur.fh.route && x.w === f.w && x.ws === "draft").slice(-1)[0];
            if (!s) throw missing("nothing to compare with: in draft, take a snapshot first (frames.snapshot) or pass {with: proposalRef}");
            what = s.id;
          }
        }
        if (/^sn/.test(what)) other = (await Snaps.load(P, what)).layout;
        else {
          if (what !== "draft" && (P.proposals.get(what) || {}).status !== "open") throw missing("no workspace " + what + " (draft or an open proposal)");
          other = (await layoutIn(P, f, what, { headless: true })).layout;
        }
        const d = layoutDiff(other, cur.layout);
        return { frame: cur.fh.route + " " + f.w + "px", from: what, to: ctx.ws, changes: d.changes.length, summary: diffSummary(d, 30) };
      }
    },
    "snapshots.list": {
      sig: "{route}?",
      run: (ctx, o = {}) => Snaps.list(ctx.project).filter((s) => !o.route || s.route === o.route).slice(-40).map((s) => ({ id: s.id, route: s.route, w: s.w, ws: s.ws, label: s.label || void 0, note: s.note, t: new Date(s.t).toISOString() }))
    }
  };

  // src/agent/api/lib.js
  var LIB_DIR = ".agent/lib/";
  var libPath = (name) => LIB_DIR + name + ".js";
  function libEntries(view) {
    return view.list().filter((p) => p.startsWith(LIB_DIR) && p.endsWith(".js")).map((path) => {
      const text = view.read(path) || "", name = path.slice(LIB_DIR.length, -3);
      let meta = {};
      const mm = /^\/\/ @lib (\{.*\})$/m.exec(text);
      if (mm) {
        try {
          meta = JSON.parse(mm[1]);
        } catch {
        }
      }
      const i = text.indexOf("export default ");
      return { name, path, source: (i >= 0 ? text.slice(i + 15) : text).trim(), description: meta.description || "", params: meta.params || [] };
    }).filter((l) => /^[A-Za-z_$][\w$]*$/.test(l.name));
  }
  var LIB = {
    // the sandbox calls it as lib.def(name, fn, {description}) and adds the parameters it found
    "lib.def": {
      sig: "name, source, {description}?, params?",
      internal: true,
      writes: "files",
      pathOf: ([name]) => libPath(name),
      run: (ctx, name, source, o = {}, params = []) => {
        const path = libPath(name), existed = ctx.tx.has(path);
        const head = { name, description: String(o.description || "").slice(0, 200), params, by: ctx.who, t: now() };
        ctx.tx.write(path, "// lib." + name + (head.description ? ": " + head.description : "") + "\n// @lib " + JSON.stringify(head) + "\n// Saved with lib.def; rebuilt by running the source below. It may use the host API and other lib functions.\nexport default " + source + "\n");
        return { saved: "lib." + name, path, params, replaced: existed };
      }
    },
    "lib.list": { sig: "", internal: true, run: (ctx) => libEntries(ctx.tx).map((l) => ({ name: l.name, params: l.params, description: l.description, path: l.path })) },
    "lib.remove": {
      sig: "name",
      internal: true,
      writes: "files",
      pathOf: ([name]) => libPath(name),
      run: (ctx, name) => {
        if (!ctx.tx.has(libPath(name))) throw missing("no lib." + name);
        ctx.tx.remove(libPath(name));
        return { removed: "lib." + name };
      }
    },
    "lib.source": { sig: "name", internal: true, run: (ctx, name) => readText(ctx.tx, libPath(name)) },
    "log": { sig: "...values", internal: true, run: (ctx, ...a) => {
      ctx.logs.push(a.join(" "));
      return true;
    } },
    "sleep": { sig: "ms?", doc: "waits (at most 5 s)", run: (ctx, ms) => sleep(clamp(+ms || 0, 0, 5e3)) }
  };

  // src/agent/effects.js
  function fileEffects(tx) {
    return tx.diff().map((d) => {
      const c = tx.changes.get(d.path);
      if (c.remove) return d.existed ? { path: d.path, change: "removed" } : null;
      if (typeof c.text !== "string") return { path: d.path, change: d.existed ? "replaced" : "created", kept: "by hash" };
      if (!d.existed) return { path: d.path, change: "created", lines: c.text.split("\n").length };
      return d.before === c.text ? null : { path: d.path, change: "edited", ...diffStat(d.before ?? "", c.text) };
    }).filter(Boolean);
  }
  var issueKey = (fh) => (i) => fh.route + " " + fh.w + "px|" + i.kind + "|" + (i.src || i.selector);
  var frameName = (fh) => fh.route + " " + fh.w + "px";
  async function framesBefore(P, ws) {
    const out = /* @__PURE__ */ new Map();
    await Promise.all(P.board().frames.map(async (f) => {
      const v = FrameHost.ui.hostFor(f.id);
      const fh = v && v.shown && v.ws === ws ? v : Headless.peek(P, v ? v.route : f.route, { ...showing(ws), w: f.w, h: f.h });
      if (!fh || !fh.ready) return;
      const b = { route: fh.route, issues: new Set(fh.issues.map(issueKey(fh))), layout: null };
      try {
        b.layout = await fh.call("layout", [300], 1200);
      } catch {
        b.layout = fh.layoutMap;
      }
      out.set(f.id, b);
    }));
    return out;
  }
  async function frameEffects(P, ws, before, t0) {
    const added = [], fixed = [], errors = /* @__PURE__ */ new Set(), layout = [];
    for (const f of P.board().frames) {
      let fh;
      try {
        fh = await hostIn(P, f, ws);
        await fh.runCheck();
      } catch {
        continue;
      }
      const b = before.get(f.id), key = issueKey(fh);
      if (b && b.layout && b.route === fh.route && fh.layoutMap && !layout.some((x) => x.frame === frameName(fh))) {
        const d = layoutDiff(b.layout, fh.layoutMap);
        if (d.changes.length || Math.abs(d.heightFrom - d.heightTo) > 1) layout.push({ frame: frameName(fh), changes: diffSummary(d, 10) });
      }
      if (b) {
        const now2 = new Set(fh.issues.map(key));
        for (const i of fh.issues) if (!b.issues.has(key(i))) added.push({ frame: frameName(fh), kind: i.kind, message: i.message, src: i.src || void 0 });
        for (const k of b.issues) if (!now2.has(k)) fixed.push(k.split("|").slice(0, 2).join(" \xB7 "));
      }
      for (const l of fh.logs) if (l.level === "error" && l.t >= t0) errors.add(fh.route + ": " + l.text + (l.src ? " @" + l.src : ""));
    }
    const out = {};
    if (added.length) out.newIssues = added.slice(0, 8);
    if (fixed.length) out.fixedIssues = [...new Set(fixed)].slice(0, 8);
    if (errors.size) out.newErrors = [...errors].slice(0, 6);
    if (layout.length) out.layout = layout.slice(0, 5);
    return out;
  }
  function effectsLine(e) {
    if (!e) return "";
    const parts = [];
    if (e.rolledBack) parts.push("rolled back " + e.rolledBack.join(", "));
    if (e.conflict) parts.push("conflict with " + e.conflict.ref + " " + e.conflict.at + " in " + e.conflict.paths.join(", ") + ": nothing written");
    for (const f of e.files || []) parts.push(f.change === "edited" ? f.path + " +" + f.add + " \u2212" + f.del : f.change + " " + f.path);
    if (e.folded) parts.push("folded into the delegating eval");
    if (e.commit) parts.push(e.commit.ref + " " + e.commit.n + (e.commit.merged ? " (merged)" : ""));
    const broken = (e.instances || []).filter((i) => i.broken);
    if (broken.length) parts.push(broken.map((i) => i.store + " broken: " + i.broken.slice(0, 120)).join("; "));
    else if (e.instances && e.instances.length) parts.push("instances ok");
    if (e.actorLogs) parts.push(plural(e.actorLogs.length, "actor warning") + "/errors");
    if (e.fixedIssues) parts.push("fixed " + plural(e.fixedIssues.length, "issue"));
    if (e.newIssues) parts.push(plural(e.newIssues.length, "new issue"));
    if (e.newErrors) parts.push(plural(e.newErrors.length, "new error"));
    if (e.types && e.types.skipped) parts.push("types not checked");
    else if (e.types) {
      if (e.types.new.length) parts.push(plural(e.types.new.length + (e.types.more || 0), "new type error"));
      if (e.types.fixed) parts.push("fixed " + plural(e.types.fixed, "type error"));
    }
    if (e.layout) parts.push("layout changed on " + e.layout.map((l) => l.frame.split(" ")[0]).filter((x, i, a) => a.indexOf(x) === i).join(", "));
    return parts.join(" \xB7 ");
  }
  function scopeSummary(scope) {
    if (!scope || !scope.vars) return "";
    const k = (v) => v === null ? "null" : Array.isArray(v) ? "array(" + v.length + ")" : typeof v === "object" ? "object" : typeof v;
    return Object.entries(scope.vars).map(([n, v]) => n + ": " + k(v)).join(", ");
  }

  // src/agent/api/session.js
  var MARK_KINDS = ["bookmark", "milestone", "decision", "question", "checkpoint"];
  var invalid2 = (msg) => Object.assign(new Error(msg), { kind: "invalid" });
  var roleOf = (m) => m.role === "user" ? m.from ? "main agent" : "person" : "claude";
  var iso = (t) => new Date(t).toISOString();
  var SESSION = {
    "session.mark": {
      sig: "label, {kind, why}?",
      doc: "kind: milestone (default), decision (you chose between options; say why), question (you guessed instead of asking), checkpoint (before a risky step)",
      run: (ctx, label2, o) => {
        const opts = typeof o === "string" ? { why: o } : o || {};
        if (opts.kind && !MARK_KINDS.includes(opts.kind)) throw invalid2("mark kinds: " + MARK_KINDS.join(", "));
        const e = ctx.project.mark({ label: label2, note: opts.why || opts.note, by: ctx.who, thread: ctx.thread, kind: opts.kind, ref: ctx.ws });
        return { kind: e.mk, label: e.label };
      }
    },
    "session.marks": { sig: "", doc: "marks, each in the workspace it was made in (where: draft or a proposal)", run: (ctx) => ctx.project.marks().map((e) => ({ seq: e.seq, label: e.label, kind: e.mk || "bookmark", by: e.who, why: e.note, where: e.ref, when: iso(e.at) })) },
    "session.events": {
      sig: "{kind, path, since, limit}?",
      doc: "timeline events, oldest first (since: a seq)",
      run: (ctx, o = {}) => ctx.project.events.filter((e) => (!o.kind || e.kind === o.kind) && (!o.path || (e.paths || []).includes(o.path)) && (o.since == null || (e.seq ?? Infinity) > o.since)).slice(-clamp(+o.limit || 40, 1, 300))
    },
    "session.diff": {
      sig: "markLabelOrSeq",
      doc: "a unified diff of the workspace since then (an event or mark in this workspace)",
      run: async (ctx, at) => {
        const P = ctx.project;
        const marks = typeof at === "number" ? [] : P.marks().filter((m) => m.label === at).reverse();
        const seq = typeof at === "number" ? at : (marks.find((m) => m.ref === ctx.ws) || marks[0] || {}).seq;
        if (seq == null) throw invalid2("pass an event seq or a mark label (session.marks())");
        const then = snapshotAt(P, seq, ctx.ws), e = P.event(seq);
        if (then == null) throw Object.assign(new Error(!e ? "no event " + seq : (e.kind === "mark" ? 'the mark "' + e.label + '"' : "event " + seq) + " is in " + e.ref + ", and this eval works in " + ctx.ws + ": a diff is within one workspace"), { kind: "missing" });
        const ch = await changesSince(P, ctx.ws, then, ctx.tx);
        return ch.map((c) => c.after === null && c.entry ? "~ " + c.path + " (kept by hash)" : diffText(c.path, c.before ?? "", c.after ?? "")).join("\n\n") || "no changes in " + ctx.ws + " since then";
      }
    },
    // the full history behind the summary: search it, read one message
    "session.recall": {
      sig: "query, {limit, thread, all}?",
      doc: "earlier messages that mention the words: [{n, role, when, text}] (this thread; all: every thread)",
      run: async (ctx, query, o = {}) => {
        const P = ctx.project, words = String(query).toLowerCase().split(/[^\p{L}\p{N}_.#-]+/u).filter((w) => w.length > 1);
        if (!words.length) throw invalid2("give a few words to look for");
        const own = ctx.thread && P.threads.get(ctx.thread);
        const ths = o.thread ? [P.threads.get(o.thread)].filter(Boolean) : own && !o.all ? [own] : [...P.threads.values()];
        const hits = [];
        for (const t of ths) {
          await P.loadThread(t.id);
          t.msgs.forEach((m, i) => {
            if (t === own && i >= t.msgs.length - 2) return;
            const body = [m.text || "", ...(m.steps || []).flatMap((s) => [s.code || "", s.out || ""])].join("\n"), low = body.toLowerCase();
            const found = words.filter((w) => low.includes(w));
            if (!found.length) return;
            const at = low.indexOf(found[0]), a = Math.max(0, at - 90);
            hits.push({ thread: t === own ? void 0 : t.title, threadId: t === own ? void 0 : t.id, n: i + 1, role: roleOf(m), when: iso(m.t), score: found.length / words.length, summarized: !!(t.summary && i < t.summary.upTo), text: (a ? "\u2026" : "") + body.slice(a, at + 160).replace(/\s+/g, " ") + "\u2026" });
          });
        }
        return hits.sort((x, y) => y.score - x.score || y.when.localeCompare(x.when)).slice(0, clamp(+o.limit || 8, 1, 30));
      }
    },
    "session.message": {
      sig: "n, {thread}?",
      doc: "one message in full, with its evals",
      run: async (ctx, n, o = {}) => {
        const P = ctx.project, id = o.thread || ctx.thread;
        if (!id) throw invalid2("pass {thread: id} (from session.recall) outside a thread");
        const t = await P.loadThread(id), m = t.msgs[(+n || 0) - 1];
        if (!m) throw missing("no message " + n + " (the thread has " + t.msgs.length + ")");
        return { n: +n, role: roleOf(m), when: iso(m.t), text: m.text || "", evals: (m.steps || []).map((s) => ({ code: trunc(s.code || "", 2e3), status: s.status, result: trunc(s.out || "", 1500), effects: effectsLine(s.effects) || void 0 })) };
      }
    },
    // project events (commits, marks, scenarios, …) and what happens in canvas frames
    "session.stream": {
      sig: "{kind, frame, since, limit}?",
      doc: "recent events, oldest first: the timeline and canvas frame events (click, change, nav, load, console, error)",
      run: (ctx, o = {}) => Streams.merged(ctx.project, o).map((e) => ({ ...e, when: iso(e.t) }))
    },
    "session.waitFor": {
      sig: "kind, {frame, match, timeout}?",
      doc: "waits for the next such event (default 30 s), e.g. a click the person was asked to make",
      long: true,
      run: (ctx, kind, o = {}) => new Promise((resolve, reject) => {
        const kinds = [].concat(kind), timeout = clamp(+o.timeout || 3e4, 500, 3e5), t0 = now();
        const ok = (e) => kinds.includes(e.kind) && (!o.frame || e.frame === o.frame || e.fid === o.frame) && (!o.match || JSON.stringify(e).toLowerCase().includes(String(o.match).toLowerCase()));
        const done = (v, err) => {
          offs.forEach((f) => f());
          clearTimeout(timer);
          err ? reject(err) : resolve(v);
        };
        const offs = [
          Streams.ev.on("frameevent", (e) => {
            if (ok(e)) done({ source: "frame", kind: e.kind, frame: e.frame + " " + e.w + "px", detail: e.detail, when: iso(e.t), waited: now() - t0 });
          }),
          ctx.project.ev.on("events", (e) => {
            if (e && e.at >= t0 && ok({ ...e, detail: e.label || e.note || "" })) done({ source: "project", kind: e.kind, who: e.who === "agent" ? "claude" : e.who, paths: e.paths, detail: e.label || e.note || "", when: iso(e.at), waited: now() - t0 });
          })
        ];
        const timer = setTimeout(() => done(null, Object.assign(new Error("no " + kinds.join(" or ") + " event within " + timeout + " ms"), { kind: "timeout" })), timeout);
        if (ctx.signal) ctx.signal.addEventListener("abort", () => done(null, Object.assign(new Error("cancelled"), { kind: "cancelled" })));
      })
    },
    "session.workspace": {
      sig: "",
      doc: "where this eval writes: {ws, title, base, head, writes (this eval's, not yet committed)}",
      run: (ctx) => {
        const P = ctx.project, d = P.draftOf(ctx.ws), p = P.proposals.get(ctx.ws);
        return { ws: ctx.ws, title: p ? p.title : "draft", base: ctx.tx.base, head: d.head, writes: ctx.tx.paths() };
      }
    }
  };

  // src/core/scenario.js
  var SCEN_DIR = "scenarios/";
  var FIX_DIR = "fixtures/";
  var STEP_KINDS = ["go", "click", "type", "waitFor", "wait", "expect", "sql", "docs", "snapshot"];
  var STEP_KEYS = {
    go: ["go"],
    click: ["click"],
    type: ["type", "text"],
    waitFor: ["waitFor"],
    wait: ["wait"],
    expect: ["expect", "text", "exact", "match", "count", "visible", "value"],
    sql: ["sql", "args", "count", "value", "rows"],
    docs: ["docs", "where", "count"],
    snapshot: ["snapshot"]
  };
  var ANY_STEP = ["timeout", "note"];
  var fixturePath = (name) => FIX_DIR + String(name).replace(/\.json$/, "") + ".json";
  function checkFixture(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "a fixture is an object: { docs?: { coll: [rows] }, tables?: { name: [rows] } }";
    for (const part of ["docs", "tables"]) {
      const v = spec[part];
      if (v === void 0) continue;
      if (!v || typeof v !== "object" || Array.isArray(v)) return part + " is an object of lists of rows";
      for (const [n, rows] of Object.entries(v)) if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object")) return part + "." + n + " must be a list of objects";
    }
    return null;
  }
  function checkScenario(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "a scenario is an object: { page, steps: [...] }";
    if (!Array.isArray(spec.steps) || !spec.steps.length) return "steps must be a non-empty list";
    for (const [i, s] of spec.steps.entries()) {
      const k = s && typeof s === "object" ? STEP_KINDS.find((k2) => k2 in s) : null;
      if (!k) return "step " + (i + 1) + " (" + JSON.stringify(s) + ") has none of: " + STEP_KINDS.join(", ");
      if (k === "type" && s.text == null) return "step " + (i + 1) + ": type needs text";
      if (k === "expect" && typeof s.expect !== "string") return "step " + (i + 1) + ": expect is a selector";
      if (k === "sql" && typeof s.sql !== "string") return "step " + (i + 1) + ": sql is a query";
      if (k === "docs" && typeof s.docs !== "string") return "step " + (i + 1) + ": docs is a collection";
      const extra = Object.keys(s).filter((x) => !STEP_KEYS[k].includes(x) && !ANY_STEP.includes(x));
      if (extra.length) return "step " + (i + 1) + " (" + k + "): unknown " + (extra.length > 1 ? "keys " : "key ") + extra.join(", ") + "; a " + k + " step takes " + STEP_KEYS[k].join(", ") + " (and timeout, note)";
      if (k === "expect" && s.match != null) {
        try {
          new RegExp(String(s.match));
        } catch (e) {
          return "step " + (i + 1) + ": match is not a regular expression: " + e.message;
        }
      }
    }
    if (spec.size && (!Array.isArray(spec.size) || spec.size.length !== 2)) return "size is [width, height]";
    return null;
  }
  function stepLabel(s) {
    if (!s || typeof s !== "object") return String(s);
    const count = s.count != null ? " count " + s.count : "";
    if (s.go) return "go " + s.go;
    if (s.click) return "click " + s.click;
    if (s.type) return 'type "' + String(s.text ?? "").slice(0, 30) + '" into ' + s.type;
    if (s.waitFor) return "wait for " + s.waitFor;
    if (s.wait != null) return "wait " + s.wait + " ms";
    if (s.expect) {
      return "expect " + s.expect + count + (s.text != null ? ' has "' + String(s.text).slice(0, 30) + '"' : "") + (s.exact ? " (exactly)" : "") + (s.match != null ? " matches /" + s.match + "/" : "") + (s.value != null ? ' value "' + s.value + '"' : "") + (s.visible === false ? " hidden" : "");
    }
    if (s.sql) return "sql " + s.sql.slice(0, 60) + count + (s.value !== void 0 ? " = " + JSON.stringify(s.value) : "") + (s.rows ? " rows " + JSON.stringify(s.rows).slice(0, 60) : "");
    if (s.docs) return "docs " + s.docs + (s.where ? " " + JSON.stringify(s.where) : "") + count;
    if (s.snapshot != null) return "snapshot" + (s.snapshot ? ' "' + s.snapshot + '"' : "");
    return JSON.stringify(s);
  }
  function fixtureList(P, ws) {
    return P.list(ws).filter((p) => p.startsWith(FIX_DIR) && p.endsWith(".json")).map((path) => {
      const name = path.slice(FIX_DIR.length, -5);
      let spec = null, error = null;
      try {
        spec = JSON.parse(P.read(path, ws));
        error = checkFixture(spec);
      } catch (e) {
        error = "not valid JSON: " + e.message;
      }
      const parts = spec && !error ? [...Object.keys(spec.docs || {}).map((c) => "docs " + c), ...Object.keys(spec.tables || {}).map((t) => "table " + t)] : [];
      return { name, path, spec, error, description: spec && spec.description || "", parts };
    });
  }
  function scenarioList(P, ws) {
    return P.list(ws).filter((p) => p.startsWith(SCEN_DIR) && p.endsWith(".json")).map((path) => {
      const name = path.slice(SCEN_DIR.length, -5);
      let spec = null, error = null;
      try {
        spec = JSON.parse(P.read(path, ws));
        error = checkScenario(spec);
      } catch (e) {
        error = "not valid JSON: " + e.message;
      }
      return { name, path, spec, error, last: (P.meta.runs || {})[ws + "|" + name] || null };
    });
  }

  // src/frames/scenarios.js
  var turns = /* @__PURE__ */ new Map();
  function onTestInstance(P, fn) {
    if (!turns.has(P.app)) turns.set(P.app, lock());
    return turns.get(P.app).run(fn);
  }
  var Fixtures = {
    current: null,
    ev: emitter(),
    // Reset the test instance of ws to a fixture's data (null: empty). read:
    // how to read the fixture file (default: the person's view of ws; an eval
    // passes its transaction's, which has its own writes).
    apply(P, name, ws = "draft", read2) {
      return onTestInstance(P, () => applyFixture(P, name, ws, read2));
    }
  };
  async function applyFixture(P, name, ws, read2 = (path) => P.read(path, ws)) {
    let spec = null;
    if (name) {
      const text = read2(fixturePath(name));
      if (text === null) throw Object.assign(new Error("no fixture " + fixturePath(name)), { kind: "missing" });
      spec = JSON.parse(text);
      const bad = checkFixture(spec);
      if (bad) throw Object.assign(new Error(fixturePath(name) + ": " + bad), { kind: "invalid" });
    }
    await Instances.reset(P, "test");
    await Instances.ensure(P, "test", ws === "draft" ? void 0 : ws);
    if (spec) await Slop.call("seed", { app: P.app, kind: "test", docs: spec.docs || {}, tables: spec.tables || {} });
    Fixtures.current = name || null;
    for (const fh of FrameHosts) if (fh.project === P && fh.kind === "test") fh.load({ keepState: false });
    Fixtures.ev.emit("applied", Fixtures.current);
    return { fixture: Fixtures.current, ws };
  }
  async function runScenario(P, spec, opts = {}) {
    const bad = checkScenario(spec);
    if (bad) throw Object.assign(new Error(bad), { kind: "invalid" });
    return onTestInstance(P, () => {
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
      return runHolding(P, spec, opts);
    });
  }
  async function runHolding(P, spec, { ws = "draft", name = "unsaved", onStep, signal, who = "you", thread, keep = true, read: read2 } = {}) {
    const [w, hgt] = spec.size || [375, 720], t0 = now();
    const res = { name, ws, ok: true, steps: [], snaps: [], page: spec.page || "index.html", fixture: spec.fixture || null, t: t0 };
    await applyFixture(P, spec.fixture || null, ws, read2);
    const fh = await Headless.fresh(P, res.page, { kind: "test", ref: ws === "draft" ? null : ws, w, h: hgt });
    const timeout = (s) => clamp(+s.timeout || +spec.timeout || 2e3, 100, 15e3);
    const poll = async (s, test) => {
      const end = now() + timeout(s);
      for (; ; ) {
        const last = await test();
        if (last.ok || now() > end) return last;
        await sleep(60);
      }
    };
    const afterAction = async () => {
      await sleep(50);
      if (fh.loading) await fh.readyP;
      try {
        await fh.call("settle", [800], 2e3);
      } catch {
      }
    };
    const snap = async (label2) => {
      try {
        const m = await Snaps.take(P, fh, { label: label2 || null, by: who, note: "scenario " + name });
        if (m) res.snaps.push({ id: m.id, label: label2 || "", route: fh.route });
      } catch {
      }
    };
    const verify = (s, r) => {
      if (!r.ok) throw Object.assign(new Error("expected " + stepLabel(s) + ", got " + r.got), { kind: "verify" });
    };
    try {
      for (const [i, s] of spec.steps.entries()) {
        if (signal && signal.aborted) throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
        const st = { i, label: stepLabel(s), ok: true }, ts = now();
        if (onStep) onStep({ ...st, running: true });
        try {
          if (s.go) {
            await fh.navigate(s.go);
            await afterAction();
          } else if (s.click) {
            await poll(s, async () => ({ ok: await fh.call("count", [s.click]) > 0 }));
            await fh.call("click", [s.click]);
            await afterAction();
          } else if (s.type) {
            await poll(s, async () => ({ ok: await fh.call("count", [s.type]) > 0 }));
            await fh.call("type", [s.type, String(s.text)]);
            await afterAction();
          } else if (s.waitFor) await fh.call("waitFor", [s.waitFor, timeout(s)], timeout(s) + 1e3);
          else if (s.wait != null) await sleep(clamp(+s.wait || 0, 0, 1e4));
          else if (s.expect) verify(s, await poll(s, () => expectStep(fh, s)));
          else if (s.sql) verify(s, await poll(s, async () => {
            const rows = await Slop.call("sql", { app: P.app, kind: "test", query: s.sql, args: s.args || [] });
            const list = Array.isArray(rows) ? rows : [], n = list.length;
            if (s.value !== void 0) {
              const v = n ? Object.values(list[0])[0] : void 0;
              const same = typeof s.value === "number" && v != null ? Number(v) === s.value : JSON.stringify(v) === JSON.stringify(s.value);
              return { ok: same, got: n ? JSON.stringify(v) : "no rows" };
            }
            if (s.rows) return { ok: JSON.stringify(list) === JSON.stringify(s.rows), got: JSON.stringify(list).slice(0, 160) };
            return s.count != null ? { ok: n === +s.count, got: n + " rows" } : { ok: n > 0, got: "0 rows" };
          }));
          else if (s.docs) verify(s, await poll(s, async () => {
            const docs = (await Slop.call("docs", { app: P.app, kind: "test", coll: s.docs })).map((d) => d.body || {});
            const hits = s.where ? docs.filter((d) => Object.entries(s.where).every(([k, v]) => d[k] === v)) : docs;
            return s.count != null ? { ok: hits.length === +s.count, got: hits.length + " documents" } : { ok: hits.length > 0, got: "0 documents" };
          }));
          else if (s.snapshot != null) await snap(s.snapshot || "step " + (i + 1));
        } catch (e) {
          st.ok = false;
          st.error = e.message.replace(/ in frame [^ ]+$/, "");
          st.kind = e.kind || "error";
        }
        st.ms = now() - ts;
        st.route = fh.route;
        const errs = fh.logs.filter((l) => l.level === "error" && l.t >= ts && !l.keep);
        if (errs.length) st.errors = errs.map((l) => l.text).slice(0, 3);
        res.steps.push(st);
        if (onStep) onStep(st);
        if (!st.ok) {
          res.ok = false;
          res.failedAt = i;
          await snap(null);
          break;
        }
      }
      if (res.ok && keep && !res.snaps.length) await snap(null);
    } finally {
      fh.dispose();
    }
    res.ms = now() - t0;
    if (keep && name !== "unsaved") {
      P.meta.runs = P.meta.runs || {};
      P.meta.runs[ws + "|" + name] = { t: res.t, ok: res.ok, ms: res.ms, failedAt: res.failedAt, steps: res.steps.map((s) => ({ label: s.label, ok: s.ok, error: s.error, ms: s.ms })), snaps: res.snaps };
      P.saveMeta();
    }
    const note = name + (res.ok ? " passed (" + plural(res.steps.length, "step") + ")" : " failed at step " + (res.failedAt + 1) + ": " + res.steps[res.failedAt].error);
    P.log({ kind: "scenario", who, ref: ws, thread, name, ok: res.ok, note });
    return res;
  }
  async function expectStep(fh, s) {
    const n = await fh.call("count", [s.expect]);
    if (s.count != null) return { ok: n === +s.count, got: "count " + n };
    if (s.visible === false) {
      if (!n) return { ok: true };
      const [el] = await fh.call("all", [s.expect, 1]);
      return { ok: !el.rect.w || !el.rect.h, got: "visible " + el.rect.w + "\xD7" + el.rect.h };
    }
    if (!n) return { ok: false, got: "nothing matches" };
    const els = await fh.call("all", [s.expect, 20]);
    const texts = s.text != null || s.match != null ? await fh.call("texts", [s.expect, 20]).catch(() => els.map((e) => e.text)) : [];
    const got = () => 'text "' + texts.join(" | ").slice(0, 160) + '"';
    if (s.match != null) {
      let re;
      try {
        re = new RegExp(String(s.match));
      } catch (e) {
        return { ok: false, got: "match is not a regular expression: " + e.message };
      }
      return { ok: texts.some((t) => re.test(t)), got: got() };
    }
    if (s.text != null) {
      const norm = (t) => String(t).replace(/\s+/g, " ").trim().toLowerCase(), want = norm(s.text);
      return { ok: texts.some((t) => s.exact ? norm(t) === want : t.toLowerCase().includes(String(s.text).toLowerCase())), got: got() };
    }
    if (s.value != null) {
      const v = (els[0].attrs || {}).value;
      return { ok: String(v) === String(s.value), got: 'value "' + v + '"' };
    }
    return { ok: els.some((e) => e.rect.w && e.rect.h), got: "not visible" };
  }
  async function runAllScenarios(P, opts = {}) {
    const ws = opts.ws || "draft", out = [];
    for (const s of scenarioList(opts.files || P, ws)) {
      if (opts.signal && opts.signal.aborted) break;
      if (s.error) {
        out.push({ name: s.name, ok: false, error: s.error });
        continue;
      }
      const r = await runScenario(P, s.spec, { ...opts, ws, name: s.name });
      out.push({ name: s.name, ok: r.ok, failedAt: r.failedAt, error: r.ok ? void 0 : r.steps[r.failedAt].error, ms: r.ms });
    }
    return out;
  }

  // src/agent/api/tests.js
  var invalid3 = (msg) => Object.assign(new Error(msg), { kind: "invalid" });
  var files = (ctx) => ({ list: () => ctx.tx.list(), read: (path) => ctx.tx.read(path), meta: ctx.project.meta });
  var fileName = (name) => String(name).replace(/\.json$/, "").replace(/[^\w-]/g, "-");
  var save = (ctx, path, spec) => ctx.tx.write(path, JSON.stringify(spec, null, 2) + "\n");
  var read = (ctx, name) => {
    const s = scenarioList(files(ctx), ctx.ws).find((x) => x.name === name);
    if (!s) throw missing("no scenario " + name + ". Scenarios: " + (scenarioList(files(ctx), ctx.ws).map((x) => x.name).join(", ") || "none"));
    if (s.error) throw invalid3(s.path + ": " + s.error);
    return s.spec;
  };
  var runOpts = (ctx) => ({ ws: ctx.ws, who: ctx.who, thread: ctx.thread, signal: ctx.signal, read: (path) => ctx.tx.read(path) });
  var TESTS = {
    "fixtures.list": {
      sig: "",
      doc: "[{name, description, parts, error}]",
      run: (ctx) => fixtureList(files(ctx), ctx.ws).map((f) => ({ name: f.name, description: f.description || void 0, parts: f.parts, error: f.error || void 0 }))
    },
    "fixtures.save": {
      sig: "name, {description, docs, tables}",
      writes: "files",
      pathOf: ([name]) => fixturePath(fileName(name)),
      run: (ctx, name, spec) => {
        const bad = checkFixture(spec);
        if (bad) throw invalid3(bad);
        const path = fixturePath(fileName(name));
        save(ctx, path, spec);
        return { path };
      }
    },
    // the dev instance's rows as a fixture: tables by name, docs by collection
    "fixtures.capture": {
      sig: "name, {tables, docs, description}",
      doc: "saves rows of the dev instance as a fixture",
      writes: "files",
      pathOf: ([name]) => fixturePath(fileName(name)),
      run: async (ctx, name, o) => {
        const app = ctx.project.app, spec = { description: o.description || "captured from the dev instance", docs: {}, tables: {} };
        for (const t of o.tables || []) {
          if (!/^\w+$/.test(t)) throw invalid3("table names are words: " + t);
          spec.tables[t] = await Slop.call("sql", { app, kind: "dev", query: 'SELECT * FROM "' + t + '"', args: [] });
        }
        for (const c of o.docs || []) {
          spec.docs[c] = (await Slop.call("docs", { app, kind: "dev", coll: c })).map((d) => ({ id: d.path.split("/").pop(), ...d.body }));
        }
        const path = fixturePath(fileName(name));
        save(ctx, path, spec);
        return { path, tables: Object.keys(spec.tables), docs: Object.keys(spec.docs) };
      }
    },
    "fixtures.apply": {
      sig: "name?",
      doc: "resets the test instance and seeds it with a fixture (none: empty); canvas frames of the test instance reload",
      long: true,
      run: (ctx, name) => Fixtures.apply(ctx.project, name || null, ctx.ws, (path) => ctx.tx.read(path))
    },
    "scenarios.list": {
      sig: "",
      doc: "[{name, description, page, steps, fixture, error, last}]",
      run: (ctx) => scenarioList(files(ctx), ctx.ws).map((s) => ({
        name: s.name,
        description: s.spec && s.spec.description || void 0,
        page: s.spec && s.spec.page,
        steps: s.spec && Array.isArray(s.spec.steps) ? s.spec.steps.length : 0,
        fixture: s.spec && s.spec.fixture || void 0,
        error: s.error || void 0,
        last: s.last ? s.last.ok ? "passed" : "failed at step " + (s.last.failedAt + 1) : void 0
      }))
    },
    "scenarios.read": { sig: "name", run: (ctx, name) => read(ctx, name) },
    "scenarios.save": {
      sig: "name, spec",
      writes: "files",
      pathOf: ([name]) => SCEN_DIR + fileName(name) + ".json",
      run: (ctx, name, spec) => {
        const bad = checkScenario(spec);
        if (bad) throw invalid3(bad);
        const path = SCEN_DIR + fileName(name) + ".json";
        save(ctx, path, spec);
        return { path, steps: spec.steps.length };
      }
    },
    "scenarios.run": {
      sig: "nameOrSpec",
      doc: '{ok, failedAt, steps: ["\u2713 \u2026", "\u2717 \u2026: why"], snapshots}',
      long: true,
      run: async (ctx, target) => {
        const name = typeof target === "string" ? target : "unsaved", spec = typeof target === "string" ? read(ctx, target) : target;
        const r = await runScenario(ctx.project, spec, { ...runOpts(ctx), name });
        return {
          name,
          ok: r.ok,
          ms: r.ms,
          failedAt: r.ok ? void 0 : r.failedAt + 1,
          snapshots: r.snaps.map((s) => s.id),
          steps: r.steps.map((s) => (s.ok ? "\u2713 " : "\u2717 ") + s.label + (s.error ? ": " + s.error : "") + (s.errors ? " [console: " + s.errors.join("; ") + "]" : ""))
        };
      }
    },
    "scenarios.runAll": {
      sig: "",
      doc: "{passed, failed, results}",
      long: true,
      run: async (ctx) => {
        const rs = await runAllScenarios(ctx.project, { ...runOpts(ctx), files: files(ctx) });
        return { passed: rs.filter((r) => r.ok).length, failed: rs.filter((r) => !r.ok).length, results: rs.map((r) => (r.ok ? "\u2713 " : "\u2717 ") + r.name + (r.error ? " (step " + ((r.failedAt ?? -1) + 1) + "): " + r.error : "")) };
      }
    }
  };

  // src/agent/api/tx.js
  var invalid4 = (msg) => Object.assign(new Error(msg), { kind: "invalid" });
  var open = (ctx, label2, dry) => {
    const c = ctx.tx.child({ label: label2 });
    c.dry = dry || !!ctx.tx.dry;
    ctx.stack.push(ctx.tx);
    ctx.tx = c;
    return ctx.stack.length;
  };
  var close = (ctx) => {
    const c = ctx.tx;
    ctx.tx = ctx.stack.pop();
    return c;
  };
  var TX = {
    "tx.begin": { sig: "", internal: true, run: (ctx) => open(ctx, "atomic", false) },
    "tx.commit": {
      sig: "",
      internal: true,
      run: async (ctx) => {
        if (!ctx.stack.length) throw invalid4("no atomic step is open");
        const r = await close(ctx).commit();
        return r.status === "folded";
      }
    },
    "tx.rollback": {
      sig: "",
      internal: true,
      run: (ctx) => {
        if (!ctx.stack.length) return [];
        const c = close(ctx), paths = c.paths();
        c.abort();
        return paths;
      }
    },
    "dry.begin": { sig: "", internal: true, run: (ctx) => {
      if (ctx.tx.dry) throw invalid4("a dry run is already open");
      return open(ctx, "dry", true);
    } },
    "dry.end": {
      sig: "",
      internal: true,
      run: (ctx) => {
        if (!ctx.tx.dry || !ctx.stack.length) throw invalid4("no dry run is open");
        const c = close(ctx), files2 = [], diffs = [];
        for (const d of c.diff()) {
          const ch = c.changes.get(d.path);
          if (ch.remove) {
            if (d.existed) {
              files2.push({ path: d.path, change: "remove" });
              diffs.push(diffText(d.path, d.before ?? "", ""));
            }
            continue;
          }
          if (typeof ch.text !== "string") {
            files2.push({ path: d.path, change: d.existed ? "replace" : "create", kept: "by hash" });
            continue;
          }
          if (d.existed && d.before === ch.text) continue;
          files2.push(d.existed ? { path: d.path, change: "edit", ...diffStat(d.before ?? "", ch.text) } : { path: d.path, change: "create", lines: ch.text.split("\n").length });
          diffs.push(diffText(d.path, d.before ?? "", ch.text));
        }
        const id = uid("cs");
        ctx.changesets.set(id, new Map(c.changes));
        c.abort();
        return { id, files: files2, diff: trunc(diffs.join("\n\n"), 8e3) };
      }
    },
    "dry.apply": {
      sig: "id, paths?",
      internal: true,
      writes: "files",
      pathOf: ([id, paths], ctx) => [...(ctx.changesets && ctx.changesets.get(id) || /* @__PURE__ */ new Map()).keys()].filter((p) => !paths || paths.includes(p)),
      run: (ctx, id, paths) => {
        const cs = ctx.changesets.get(id);
        if (!cs) throw Object.assign(new Error("no changeset " + id + " (changesets last for the turn)"), { kind: "missing" });
        let n = 0;
        for (const [path, c] of cs) {
          if (paths && !paths.includes(path)) continue;
          if (c.remove) ctx.tx.remove(path);
          else if (typeof c.text === "string") ctx.tx.write(path, c.text);
          else ctx.tx.copy(path, c);
          n++;
        }
        return { applied: n };
      }
    },
    "dry.discard": { sig: "id", internal: true, run: (ctx, id) => ctx.changesets.delete(id) }
  };

  // src/agent/types.js
  var devKey = (st, ref = "draft") => {
    const inst = !st ? null : ref === "draft" ? st.dev : (st.props || []).find((p) => p.ref === ref);
    return inst ? inst.n + (inst.broken ? ":broken" : "") : "none";
  };
  var CODE = /\.(ts|tsx|mts|cts)$/;
  var RELEVANT = (p) => CODE.test(p) || p === "app.json" || p === "tsconfig.json" || p === "vendor/tsconfig.vendor.json";
  var Types = {
    worker: null,
    state: "off",
    version: "",
    seq: 0,
    waits: /* @__PURE__ */ new Map(),
    decl: /* @__PURE__ */ new Map(),
    // the shell's (ui/app.js): the app's status as last polled ({dev: {n, broken}}), or null
    status: () => null,
    // Whether a view is an app the checker looks at: it has TypeScript of its own.
    wants(view) {
      return view.list().some((p) => CODE.test(p) && !p.endsWith(".d.ts") && !p.startsWith("vendor/") && !p.startsWith("node_modules/"));
    },
    // The view's files the checker reads, taken now (a later write does not change them).
    filesOf(view) {
      const out = {};
      for (const p of view.list()) if (RELEVANT(p)) {
        const t = view.read(p);
        if (typeof t === "string") out[p] = t;
      }
      return out;
    },
    spawn() {
      if (this.worker) return;
      this.state = "loading";
      const attach = (w) => {
        w.onmessage = (e) => {
          const m = e.data || {};
          if (m.type === "ready") {
            this.state = "ready";
            this.version = m.version;
            return;
          }
          const wait = this.waits.get(m.id);
          if (wait) {
            this.waits.delete(m.id);
            wait(m);
          }
        };
        w.onerror = (e) => {
          e.preventDefault && e.preventDefault();
          this.fail("the checker could not start");
        };
        this.worker = w;
      };
      try {
        attach(new Worker("checker.js"));
      } catch {
        fetch("checker.js").then((r) => r.text()).then((src) => attach(new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))))).catch(() => this.fail("the checker could not load"));
      }
    },
    fail(why2) {
      this.state = "off";
      this.worker = null;
      for (const [, w] of this.waits) w({ ok: false, error: why2 });
      this.waits.clear();
    },
    // Sends a message; resolves with the answer, or {timeout} after ms (the
    // answer, when it comes, is dropped: the worker answers in order).
    post(msg, ms) {
      this.spawn();
      const id = ++this.seq;
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          if (this.waits.delete(id)) resolve({ ok: false, timeout: true });
        }, ms);
        this.waits.set(id, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        const send = () => this.worker ? this.worker.postMessage({ ...msg, id }) : setTimeout(send, 50);
        send();
      });
    },
    // The declarations ({name: text}) for a ref of the app: its actions are
    // those of the instance running that ref (a proposal's actor may differ
    // from draft's). Cached per app, ref and the version that instance runs.
    declarations(P, ref = "draft") {
      const pre = P.app + "|" + ref + "|", key = pre + devKey(this.status(P), ref);
      let d = this.decl.get(key);
      if (!d) {
        d = Slop.call("types", { app: P.app, ...ref !== "draft" ? { ref } : {} }).then((r) => Object.fromEntries((r.files || []).map((f) => [f.path, f.text])));
        d.catch(() => {
          if (this.decl.get(key) === d) this.decl.delete(key);
        });
        for (const k of [...this.decl.keys()]) if (k.startsWith(pre)) this.decl.delete(k);
        this.decl.set(key, d);
      }
      return d;
    },
    invalidate(P) {
      for (const k of [...this.decl.keys()]) if (k.startsWith(P.app + "|")) this.decl.delete(k);
    },
    // Type errors in a view: {diags: [{file, line, col, code, message,
    // program}], ms} or {skipped: why}.
    async check(P, view, { timeoutMs = 2e3, ref = "draft" } = {}) {
      const files2 = this.filesOf(view);
      let decl;
      try {
        decl = await this.declarations(P, ref);
      } catch (e) {
        return { skipped: "no declarations from the server: " + (e.message || e) };
      }
      const r = await this.post({ type: "check", files: files2, decl }, timeoutMs);
      if (r.timeout) return { skipped: this.state === "ready" ? "the check took longer than " + Math.round(timeoutMs / 1e3) + " s" : "the checker was still loading" };
      if (!r.ok) return { skipped: r.error || "the checker failed" };
      return { diags: r.diags, ms: r.ms };
    },
    // The type at a position in a file of the view: {text, doc} or null.
    async info(P, view, path, pos, ref = "draft") {
      let decl;
      try {
        decl = await this.declarations(P, ref);
      } catch {
        return null;
      }
      const r = await this.post({ type: "info", files: this.filesOf(view), decl, path, pos }, 3e3);
      return r.ok && r.text ? { text: r.text, doc: r.doc || "" } : null;
    },
    // An eval's TypeScript body with its types stripped: {code} or {error, line}.
    async transpile(code) {
      const r = await this.post({ type: "transpile", code }, 2e4);
      if (r.timeout) return { error: "the checker did not load in time to compile TypeScript" };
      return r.ok ? { code: r.code } : { error: r.error, line: r.line };
    },
    // What an eval did to the types: the errors after that were not there
    // before (by file, code and message: an error that only moved lines is
    // the same error), and how many before are gone. {new, fixed, total} or
    // {skipped}.
    diff(before, after, cap = 8) {
      if (after.skipped) return { skipped: after.skipped };
      if (before.skipped) return { skipped: "no check from before the eval (" + before.skipped + ")", total: after.diags.length };
      const key = (d) => d.file + "|" + d.code + "|" + d.message;
      const left = /* @__PURE__ */ new Map();
      for (const d of before.diags) left.set(key(d), (left.get(key(d)) || 0) + 1);
      const added = [];
      for (const d of after.diags) {
        const n = left.get(key(d)) || 0;
        if (n) left.set(key(d), n - 1);
        else added.push({ file: d.file, line: d.line, message: d.message });
      }
      const fixed = [...left.values()].reduce((a, b) => a + b, 0);
      const out = { new: added.slice(0, cap), fixed, total: after.diags.length };
      if (added.length > cap) out.more = added.length - cap;
      return out;
    }
  };
  var headView = (d) => ({ list: () => d.list(), read: (p) => d.read(p) });

  // src/agent/api/types.js
  var TYPES = {
    "types.check": {
      sig: "{file}?",
      long: true,
      doc: "{errors: [{file, line, col, message, program}], count} for the files as this eval sees them (its own writes included), or {skipped}: TypeScript errors in the pages and the actor, checked against the app's declarations",
      run: async (ctx, o = {}) => {
        const view = ctx.tx || headView(ctx.draft);
        if (!Types.wants(view)) return { errors: [], count: 0, note: "the app has no TypeScript files" };
        const r = await Types.check(ctx.project, view, { timeoutMs: 2e4, ref: ctx.draft.ref });
        if (r.skipped) return { skipped: r.skipped };
        const errors = r.diags.filter((d) => !o.file || d.file === o.file).map((d) => ({ file: d.file, line: d.line, col: d.col, message: d.message, program: d.program }));
        return { errors: errors.slice(0, 50), count: errors.length };
      }
    }
  };

  // src/agent/api/ui.js
  var pins = (P) => P.meta.pins = P.meta.pins || [];
  var UI = {
    "ui.selection": { sig: "", doc: 'what the person selected on the canvas (with src "file:line"), or null', run: (ctx) => {
      const s = ctx.ui.selection();
      return s ? { ...s, rect: void 0 } : null;
    } },
    "ui.pins": {
      sig: "{all}?",
      doc: "open comment pins [{id, n, route, src, text}]",
      run: (ctx, o = {}) => pins(ctx.project).filter((p) => o.all || !p.resolved).map((p) => ({ id: p.id, n: p.n, route: p.route, src: p.src, text: p.text, by: p.by, resolved: !!p.resolved }))
    },
    "ui.resolvePin": {
      sig: "pinId, note?",
      run: (ctx, id, note) => {
        const P = ctx.project, p = pins(P).find((x) => x.id === id || x.n === id);
        if (!p) throw missing("no pin " + id);
        p.resolved = true;
        p.reply = note || "";
        P.saveMeta();
        P.ev.emit("pins");
        return true;
      }
    },
    "ui.pin": {
      sig: "frameId, target, text",
      doc: 'files a comment pin on an element (target: a selector or {src: "file:line"})',
      run: async (ctx, id, target, text) => {
        const P = ctx.project, f = P.frame(id);
        if (!f) throw missing("no frame " + id);
        const fh = await hostIn(P, f, ctx.ws);
        const sel = typeof target === "string" ? target : target && target.src ? '[data-src="' + target.src + '"]' : null;
        const hit = sel ? (await fh.call("query", [sel, 1]))[0] : null;
        if (sel && !hit) throw missing("no element matches " + sel + " in " + fh.route);
        const n = pins(P).reduce((a, p) => Math.max(a, p.n), 0) + 1;
        pins(P).push({ id: "pin" + uid(), n, route: fh.route, src: hit ? hit.src : "", selector: hit ? hit.selector : "", rx: 0.5, ry: 0.5, text: String(text).slice(0, 500), by: ctx.role ? "Claude \xB7 " + ctx.role : ctx.who === "agent" ? "Claude" : "you", t: now(), resolved: false });
        P.saveMeta();
        P.ev.emit("pins");
        P.log({ kind: "pin", who: ctx.who, thread: ctx.thread, note: "#" + n + " " + String(text).slice(0, 100), paths: hit && hit.src ? [hit.src.split(":")[0]] : void 0 });
        return { pin: n, route: fh.route, src: hit ? hit.src : null };
      }
    },
    "ui.notify": { sig: "text", doc: "a short notice to the person", run: (ctx, text) => {
      ctx.ui.notify(String(text).slice(0, 200));
      return true;
    } },
    "ui.approve": { sig: "title, detail?", internal: true, long: true, run: (ctx, title, detail) => ctx.approve(String(title), detail ? String(detail) : "") }
  };

  // src/core/api.js
  var policy = (msg) => Object.assign(new Error(msg), { kind: "policy" });
  var WRITES = /* @__PURE__ */ new Set(["files", "dev", "main"]);
  var TEST_PATH = /^(scenarios|fixtures)\//;
  function parseSig(sig) {
    if (!sig) return [];
    return sig.split(/,\s*(?![^{]*})/).map((p) => p.trim()).filter(Boolean).map((p) => ({
      name: p.replace(/^\.\.\./, "").replace(/\?$/, ""),
      optional: p.endsWith("?") || p.startsWith("..."),
      rest: p.startsWith("...")
    }));
  }
  function checkArgs(name, sig, args) {
    const params = parseSig(sig);
    if (params.some((p) => p.rest)) return null;
    const missing3 = params.filter((p, i) => !p.optional && (args[i] === void 0 || args[i] === null)).map((p) => p.name);
    if (!missing3.length) return null;
    return name + " needs " + params.filter((p) => !p.optional).map((p) => p.name).join(", ") + " (missing " + missing3.join(", ") + ") \xB7 usage: " + name + "(" + sig + ")";
  }
  function defineAPI(...tables) {
    const entries = /* @__PURE__ */ new Map();
    const add = (table) => {
      for (const [name, e] of Object.entries(table)) {
        if (entries.has(name)) throw new Error("API " + name + " is declared twice");
        if (typeof e.run !== "function") throw new Error("API " + name + " has no run");
        if (e.writes && !WRITES.has(e.writes)) throw new Error("API " + name + ": writes is one of " + [...WRITES].join(", "));
        entries.set(name, Object.freeze({ sig: "", doc: "", ...e }));
      }
    };
    tables.forEach(add);
    return {
      entries,
      add,
      has: (name) => entries.has(name),
      names: () => [...entries.keys()],
      long: () => [...entries].filter(([, e]) => e.long).map(([n]) => n),
      // check, guard, run: what the sandbox's calls go through
      async call(ctx, name, args = []) {
        const e = entries.get(name);
        if (!e) throw Object.assign(new Error(name + " is not part of the API"), { kind: "unknown" });
        const bad = checkArgs(name, e.sig, args);
        if (bad) throw Object.assign(new Error(bad), { kind: "invalid" });
        guard(ctx, name, e, args);
        try {
          return await e.run(ctx, ...args);
        } catch (err) {
          if (err && err.kind === "invalid" && !/· usage:/.test(err.message)) err.message += " \xB7 usage: " + name + "(" + e.sig + ")";
          throw err;
        }
      },
      // the reference the agent reads: one line per call, by namespace, each
      // namespace followed by its note (notes: {ns: text})
      reference(notes = {}) {
        const groups = /* @__PURE__ */ new Map();
        for (const [name, e] of entries) {
          if (e.internal) continue;
          const ns = name.includes(".") ? name.slice(0, name.indexOf(".")) : "";
          if (!groups.has(ns)) groups.set(ns, []);
          groups.get(ns).push(name + "(" + e.sig + ")" + (e.doc ? " \u2014 " + e.doc : ""));
        }
        return [...groups].map(([ns, lines]) => lines.join("\n") + (notes[ns] ? "\n  " + notes[ns].trim().split("\n").join("\n  ") : "")).join("\n");
      }
    };
  }
  function guard(ctx, name, e, args) {
    if (!e.writes) return;
    if (ctx.mode === "read") throw policy("read-only mode: this thread may read and check but not write (" + name + ")");
    if (ctx.mode === "tests") {
      if (e.writes !== "files") throw policy("this thread may write only scenarios/ and fixtures/ (" + name + " changes " + (e.writes === "dev" ? "the dev instance" : "main") + ")");
      const paths = [].concat(e.pathOf ? e.pathOf(args, ctx) : args[0]);
      const bad = paths.find((p) => !TEST_PATH.test(String(p || "")));
      if (bad !== void 0) throw policy("this thread may write only scenarios/ and fixtures/ (tests), not " + (bad || "code"));
    }
    if (e.writes !== "files" && ctx.tx && ctx.tx.dry) throw policy(name + " is refused in a dry run: a dry run captures file writes only");
  }

  // src/agent/api/index.js
  var API = defineAPI(FILES, APP, FRAMES, TESTS, SESSION, UI, LIB, TX, AGENTS, TYPES);

  // src/model/templates.js
  var esc = (s) => String(s).replace(/[<&"]/g, "");
  var page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
${body}
</main>
<script type="module" src="main.ts"><\/script>
</body>
</html>
`;
  var TYPES2 = `Files are TypeScript; the server compiles them (types are stripped, not
checked). To check them, pull the app and run \`slop types <app>\`: it writes
the declarations into \`.slop/types/\` and the tsconfig files, then
\`tsc -p tsconfig.json\` checks the pages`;
  var STYLES = `body { font: 16px/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; }
main { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
form { display: flex; gap: .5rem; margin: 1rem 0; }
input { flex: 1; font: inherit; padding: .4rem .6rem; border: 1px solid #bbb; }
button { font: inherit; padding: .4rem .9rem; border: 1px solid #1a1a1a; background: #fff; cursor: pointer; }
li { padding: .25rem 0; }
`;
  var APP_TEMPLATES = [
    {
      id: "blank",
      name: "Simple page",
      blurb: "One page. What people type into it is saved, without any server code. Good for a form, a list or a notebook.",
      frames: [{ route: "index.html", w: 1024, h: 700 }, { route: "index.html", w: 375, h: 700 }],
      files: ({ title }) => ({
        "app.json": JSON.stringify({ title: esc(title), page: "index.html", capabilities: { db: {} } }, null, 2) + "\n",
        "index.html": page(esc(title), `<h1>${esc(title)}</h1>
<form id="add"><input name="text" placeholder="Something to remember" required><button>Add</button></form>
<ul id="list"></ul>`),
        "main.ts": `// The page: notes in the app's document database.
interface Note {
  text: string
  at: number
}

const db = await claude.use('db')
const list = document.querySelector<HTMLUListElement>('#list')!
const form = document.querySelector<HTMLFormElement>('#add')!

async function show() {
  if (!db) return
  const snap = await db.collection<Note>('notes').orderBy('at').get()
  list.replaceChildren(...snap.docs.map(d => {
    const li = document.createElement('li')
    li.textContent = d.data()?.text ?? ''
    return li
  }))
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  const input = form.elements.namedItem('text') as HTMLInputElement
  const text = input.value.trim()
  if (!text || !db) return
  const note: Note = { text, at: Date.now() }
  await db.collection<Note>('notes').add(note)
  form.reset()
  await show()
})
await show()
`,
        "styles.css": STYLES,
        "README.md": `# ${esc(title)}

A slop app: \`app.json\` is its manifest, \`index.html\` its page, and
\`main.ts\` the page's script. It keeps notes in the app's document database
(\`claude.use('db')\`).

${TYPES2}.

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run.
`
      })
    },
    {
      id: "actor",
      name: "Page with server code",
      blurb: "A page plus code that runs on the server (an actor) and keeps a table of rows (SQL). Good when many people share the same data, or for rules people must not get around.",
      frames: [{ route: "index.html", w: 1024, h: 700 }, { route: "index.html", w: 375, h: 700 }],
      files: ({ title }) => ({
        // the profile scope: ctx.visitor.name is the person's name (without it, "")
        "app.json": JSON.stringify({ title: esc(title), page: "index.html", actor: "actor.ts", capabilities: { user: { scopes: ["profile"] } } }, null, 2) + "\n",
        "actor.ts": `// The app's server half: actions the page calls, rows in SQL. Each action
// declares its arguments' JSON Schema (checked before run: a wrong shape is
// refused) and its result's; defineAction types run from them, and the
// page's types come from them too (slop types writes actions.d.ts).
const sql = use('sql')

defineActor({
  actions: {
    list: defineAction({
      requires: 'view',
      args: { type: 'object', properties: {} },
      result: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'text', 'by', 'at'],
          properties: { id: { type: 'integer' }, text: { type: 'string' }, by: { type: 'string' }, at: { type: 'integer' } },
        },
      },
      run(ctx) {
        return sql.all('SELECT id, text, by, at FROM items ORDER BY at DESC LIMIT 100')
      },
    }),
    add: defineAction({
      requires: 'interact',
      args: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: { text: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      result: { type: 'object', required: ['added'], properties: { added: { type: 'string' } } },
      run(ctx, { text }) {
        const t = text.trim()
        if (!t) ctx.fail('invalid_argument', 'text is empty')
        sql.run('INSERT INTO items (text, by, at) VALUES (?, ?, ?)', t, ctx.visitor.name || 'someone', Date.now())
        return { added: t }
      },
    }),
  },
})
`,
        "sql/001_items.sql": `-- The app's rows. A migration runs once per instance; change the schema
-- with a new file (sql/002_\u2026.sql), never by editing this one after it ran.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
`,
        "index.html": page(esc(title), `<h1>${esc(title)}</h1>
<form id="add"><input name="text" placeholder="Add an item" required><button>Add</button></form>
<ul id="list"></ul>`),
        "main.ts": `// The page: it calls the actor's actions, typed by their schemas
// (actions.d.ts, from slop types).
const slop = await claude.use('slop')
const list = document.querySelector<HTMLUListElement>('#list')!
const form = document.querySelector<HTMLFormElement>('#add')!

async function show() {
  if (!slop) return
  const rows = await slop.actions.list({})
  list.replaceChildren(...rows.map(r => {
    const li = document.createElement('li')
    li.textContent = r.text + ' \xB7 ' + r.by
    return li
  }))
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  if (!slop) return
  const input = form.elements.namedItem('text') as HTMLInputElement
  await slop.actions.add({ text: input.value })
  form.reset()
  await show()
})
await show()
`,
        "styles.css": STYLES,
        "README.md": `# ${esc(title)}

A slop app with an actor: the page (\`index.html\`, \`main.ts\`) calls the
actions in \`actor.ts\`, which keeps rows in SQL (\`sql/001_items.sql\`).
Each action declares the JSON Schema of its arguments, which the server
checks before the action runs, and of its result. They are the contract:
\`defineAction\` types the action's code from them, and \`slop types\`
declares the page's \`slop.actions\` from them (\`.slop/types/actions.d.ts\`).

${TYPES2}, and \`tsc -p tsconfig.actor.json\` the actor.

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run (their migrations
run then).
`
      })
    }
  ];

  // src/agent/sandbox.js
  var Sandbox = {
    worker: null,
    engine: "off",
    seq: 0,
    runs: /* @__PURE__ */ new Map(),
    ev: emitter(),
    async spawn() {
      this.engine = "loading";
      this.ev.emit("engine");
      const attach = (w) => {
        w.onmessage = (e) => this.onMessage(e.data || {});
        w.onerror = (e) => {
          e.preventDefault && e.preventDefault();
          if (this.engine === "loading") {
            this.engine = "off";
            this.ev.emit("engine");
          }
        };
        this.worker = w;
      };
      try {
        attach(new Worker("sandbox.js"));
      } catch (e1) {
        try {
          const src = await (await fetch("sandbox.js")).text();
          attach(new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))));
        } catch (e2) {
          this.engine = "off";
          this.ev.emit("engine");
          return;
        }
      }
      setTimeout(() => {
        if (this.engine === "loading") {
          this.engine = "off";
          this.ev.emit("engine");
        }
      }, 15e3);
    },
    onMessage(m) {
      if (m.type === "engine") {
        this.engine = m.engine;
        this.ev.emit("engine");
        return;
      }
      if (m.type === "call") {
        const run = this.runs.get(m.eid);
        const reply = (ok, v) => this.worker && this.worker.postMessage(ok ? { type: "reply", id: m.id, ok: true, value: v } : { type: "reply", id: m.id, ok: false, error: v });
        if (!run) return reply(false, { kind: "gone", message: "eval finished" });
        run.calls.push(m.name);
        const e = run.api.entries.get(m.name), long = !!(e && e.long);
        if (long && run.long++ === 0) run.pausedAt = Date.now();
        const done = () => {
          if (long && --run.long === 0) run.extra += Date.now() - run.pausedAt;
        };
        Promise.resolve().then(() => run.api.call(run.ctx, m.name, m.args || [])).finally(done).then((v) => {
          let out = v === void 0 ? null : v;
          try {
            out = JSON.parse(JSON.stringify(out));
          } catch {
            out = String(out);
          }
          reply(true, out);
        }, (err) => reply(false, { kind: err && err.kind || (err instanceof TypeError ? "invalid" : "error"), message: String(err && err.message || err) }));
        return;
      }
      if (m.type === "result") {
        const run = this.runs.get(m.id);
        if (!run) return;
        clearInterval(run.timer);
        this.runs.delete(m.id);
        run.resolve({ ok: m.ok, value: m.value, error: m.error, logs: m.logs || [], engine: m.engine, ms: m.ms, calls: run.calls, scope: m.scope, fresh: m.fresh });
      }
    },
    // Run code with an API (core/api.js) and the eval's context.
    // o: sid (a session: its variables stay between evals), restore (its
    // saved variables), lib ([{name, source}]), roles (names for help()).
    async run(code, { api, ctx, timeoutMs = 2e4, sid, restore, lib, roles = [] }) {
      if (!this.worker) await this.spawn();
      if (this.engine === "loading") await new Promise((r) => {
        const off = this.ev.on("engine", () => {
          if (this.engine !== "loading") {
            off();
            r();
          }
        });
      });
      if (this.engine === "off") return { ok: false, error: { kind: "unavailable", message: "the sandbox worker could not start in this view" }, logs: [] };
      const id = ++this.seq;
      return new Promise((resolve) => {
        const run = { resolve, api, ctx, calls: [], long: 0, extra: 0, pausedAt: 0 }, t0 = Date.now();
        run.timer = setInterval(() => {
          if (run.long > 0 || Date.now() - t0 - run.extra < timeoutMs + 5e3) return;
          clearInterval(run.timer);
          this.runs.delete(id);
          try {
            this.worker.terminate();
          } catch {
          }
          this.worker = null;
          for (const [, r] of this.runs) {
            clearInterval(r.timer);
            r.resolve({ ok: false, error: { kind: "timeout", message: "sandbox restarted" }, logs: [] });
          }
          this.runs.clear();
          resolve({ ok: false, error: { kind: "timeout", message: "eval exceeded " + Math.round(timeoutMs / 1e3) + " s; the sandbox was restarted (variables come back from their last saved values)" }, logs: [] });
          this.spawn();
        }, 1e3);
        this.runs.set(id, run);
        const sigs = Object.fromEntries([...api.entries].map(([n, e]) => [n, e.sig]));
        this.worker.postMessage({ type: "eval", id, code, api: api.names(), sigs, long: api.long(), roles, timeoutMs: clamp(timeoutMs, 1e3, 12e4), sid, restore: restore || null, lib: lib || [] });
      });
    },
    drop(sid) {
      if (this.worker) this.worker.postMessage({ type: "drop", sid });
    }
  };

  // src/agent/hints.js
  function notAFunctionHint(error, code, api) {
    if (!error || !/not a function|is not a function/.test(error.message || "") || !error.line) return "";
    const text = String(code || "").split("\n")[error.line - 1];
    if (text == null) return "";
    const names = api && api.names ? api.names() : [];
    const unknown = [];
    for (const m of text.matchAll(/\b([a-z][A-Za-z]*)\.([A-Za-z]+)\s*\(/g)) {
      const name = m[1] + "." + m[2];
      const ns = names.filter((n) => n.startsWith(m[1] + "."));
      if (ns.length && !names.includes(name) && !unknown.some((u) => u.name === name)) {
        const close2 = names.filter((n) => n.endsWith("." + m[2]) || n.startsWith(m[1] + "." + m[2].slice(0, 3))).slice(0, 4);
        unknown.push({ name, hint: close2.length ? close2.join(", ") : ns.slice(0, 6).join(", ") });
      }
    }
    return " \u2014 the line: `" + text.trim().slice(0, 160) + "`" + unknown.map((u) => ". " + u.name + " is not in the API (did you mean " + u.hint + "?)").join("");
  }

  // src/agent/eval.js
  var AgentUI = {
    ws: () => "draft",
    setWs: () => {
    },
    selection: () => null,
    focusFrame: () => {
    },
    fit: () => {
    },
    notify: (text) => toast(text)
  };
  function makeContext(P, o = {}) {
    const ws = o.ws || "draft";
    const ctx = {
      project: P,
      ws,
      draft: P.draftOf(ws),
      who: o.who || "you",
      thread: o.thread || null,
      mode: o.mode || "auto",
      role: o.role || null,
      depth: o.depth || 0,
      budget: o.budget || null,
      tier: o.tier,
      model: o.model,
      signal: o.signal || null,
      parentTx: o.parentTx || null,
      agent: o.agent || null,
      api: o.api || API,
      ui: AgentUI,
      tx: null,
      stack: [],
      logs: [],
      changesets: /* @__PURE__ */ new Map(),
      children: [],
      onApproval: null,
      // a turn shows approvals as cards in its reply
      onPanel: null
      // and panels in its reply
    };
    ctx.approve = (title, detail) => approvalCard(ctx, title, detail);
    return ctx;
  }
  var firstLine = (code) => (code.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) || "").trim().slice(0, 90);
  async function runEval(ctx, code, { sid, restore, timeoutMs } = {}) {
    const P = ctx.project, d = ctx.draft;
    if (d.head == null) await d.open();
    const parent = ctx.parentTx && ctx.parentTx.open && ctx.parentTx.draft === d ? ctx.parentTx : null;
    const line = firstLine(code), t0 = now();
    const before = parent ? null : await framesBefore(P, ctx.ws);
    const tx = parent ? parent.child({ label: "eval" }) : d.begin({ label: "eval", event: { who: ctx.who, thread: ctx.thread, note: line } });
    const typesBefore = !parent && Types.wants(tx) ? Types.check(P, tx, { timeoutMs: 15e3, ref: d.ref }) : null;
    ctx.tx = tx;
    ctx.stack = [];
    ctx.logs = [];
    let r;
    try {
      r = await Sandbox.run(code, { api: ctx.api, ctx, sid, restore, timeoutMs, lib: libEntries(tx).map((l) => ({ name: l.name, source: l.source })), roles: Object.keys(ROLES) });
    } finally {
      while (ctx.stack.length) {
        ctx.tx.abort();
        ctx.tx = ctx.stack.pop();
      }
      ctx.tx = null;
    }
    if (ctx.logs.length) r.logs = [...r.logs || [], ...ctx.logs.map((text) => ({ level: "log", text }))];
    if (!r.ok && r.error) r.error.message += notAFunctionHint(r.error, code, ctx.api);
    const effects = {};
    if (!r.ok) {
      if (tx.changes.size) effects.rolledBack = tx.paths();
      tx.abort();
    } else if (tx.changes.size) {
      const files2 = fileEffects(tx);
      const c = await tx.commit({ message: (ctx.who === "agent" ? "claude" : ctx.who) + ": " + line });
      if (c.status === "folded") Object.assign(effects, { files: files2, folded: true });
      else if (c.status === "committed") {
        Object.assign(effects, { files: files2, commit: { ref: d.ref, n: c.n, merged: c.merged } });
        if (c.activated.length) effects.instances = c.activated.map((a) => ({ store: a.store, n: a.n, broken: a.broken || a.error || void 0 }));
        Object.assign(effects, await afterCommit(ctx, c, before, t0));
        if (typesBefore || Types.wants(tx)) {
          if (c.activated.length) Types.invalidate(P);
          const t = Types.diff(typesBefore ? await typesBefore : { diags: [] }, await Types.check(P, tx, { ref: d.ref }));
          if (t.skipped || t.new.length || t.fixed) effects.types = t;
        }
      } else {
        tx.abort();
        r.ok = false;
        if (c.status === "conflict") {
          effects.conflict = { ref: d.ref, at: c.at, paths: c.conflicts };
          r.error = { kind: "conflict", message: d.ref + " moved to " + c.at + " since this eval began on " + tx.base + ", and that also changed " + c.conflicts.join(", ") + ": nothing was written. Read those files again and redo the change." };
          await d.refresh().catch(() => {
          });
        } else r.error = { kind: "commit", message: "the commit failed (" + (c.code || "error") + "): " + c.error + ". Nothing was written." };
      }
    }
    r.effects = Object.keys(effects).length ? effects : null;
    return r;
  }
  async function afterCommit(ctx, c, before, t0) {
    const P = ctx.project, out = {}, up = c.activated.filter((a) => !a.broken && !a.error);
    if (!up.length) return out;
    await Promise.all([...FrameHosts].filter((fh) => fh.project === P && fh.ws === ctx.ws && fh.kind !== "test").map((fh) => fh.waitVersion(c.n)));
    try {
      const l = await Slop.call("logs", { app: P.app, ...showing(ctx.ws) });
      const bad = (l.lines || []).filter((x) => x.at >= t0 && (x.level === "error" || x.level === "warn")).map((x) => x.level + ": " + x.text);
      if (bad.length) out.actorLogs = bad.slice(-6);
    } catch {
    }
    return Object.assign(out, await frameEffects(P, ctx.ws, before, t0));
  }
  function approvalCard(ctx, title, detail) {
    return new Promise((resolve) => {
      if (ctx.onApproval) {
        const done = (v) => {
          ctx.onApproval(null);
          resolve(v);
        };
        ctx.onApproval({ title, detail, decide: done });
        if (ctx.signal) ctx.signal.addEventListener("abort", () => done(false));
        return;
      }
      let answered = false;
      modal({
        title,
        body: [h("p.note", "Code in the sandbox asks before it continues."), detail ? h("pre.mono", { style: { whiteSpace: "pre-wrap", fontSize: "11px", maxHeight: "300px", overflow: "auto", margin: 0 } }, detail) : null],
        onClose: () => {
          if (!answered) resolve(false);
        },
        actions: [{ label: "Decline", run: () => {
          answered = true;
          resolve(false);
        } }, { label: "Approve", primary: true, run: () => {
          answered = true;
          resolve(true);
        } }]
      });
    });
  }

  // src/agent/guide.js
  var NOTES = {
    files: `Paths are relative ("index.html", "css/app.css"). Binary files and files over 240 KB are kept by hash: list, copy and remove them; they cannot be read as text.`,
    app: `kind is 'dev' (default) or 'test' (the instance scenarios ran on). app.seed and app.reset change the dev instance at once: they are not part of the eval's transaction, and dry runs refuse them.`,
    publish: `Publishing is the person's call. Run publish.check first; publish.run shows them an approval card and publishes only if they approve. Never edit a migration that main has run: add a new one.`,
    frames: `target is a CSS selector or {src: "index.html:12"}; a selector may end in :has-text("words") (e.g. 'button:has-text("Add")').
Reads wait until the page has settled (data loaded, DOM quiet). Arranging, labelling and closing frames changes only the canvas: allowed in every mode.`,
    fixtures: `A fixture (fixtures/<name>.json) is the data the test instance starts from: { description, docs: { coll: [rows] }, tables: { name: [rows] } }. A row's id field names its document; tables are those your migrations make.`,
    scenarios: `A scenario (scenarios/<name>.json) runs in a fresh frame of your test instance, after it is reset and seeded with the fixture, and passes or fails:
{ description, page: "index.html", size?: [375, 720], fixture?: name, steps: [
  { click: sel }, { type: sel, text }, { go: "#/cart" }, { waitFor: sel }, { wait: ms },
  { expect: sel } (visible) | { expect: sel, text } (contains, ignoring case) | { expect: sel, text, exact: true } (the whole text) | { expect: sel, match: "^12 kg$" } (a regular expression) | { expect: sel, count } | { expect: sel, visible: false } | { expect: sel, value },
  { sql: "SELECT \u2026 FROM notes WHERE \u2026", args?, count? } | { sql: "SELECT sum(kg) FROM \u2026", value: 30.5 } (the first column of the first row) | { sql, rows: [{\u2026}] } (exactly these rows) | { docs: coll, where?: {field: value}, count? } (the test instance's data), { snapshot: label } ] }
A step with a key its kind does not take is an error (the scenario does not run). To check a total, check it both on the page and in the data: { expect, text, exact } and { sql, value }. A number is checked with exact or match, never contains: "12" is contained in "128" and "312". Checks retry until they pass or time out ({ timeout } on a step or the scenario, default 2000 ms). A failure keeps a snapshot.`,
    session: `Long threads: older messages are folded into a summary at the top of your context; session.recall and session.message reach what it left out.`,
    ui: ``
  };
  var INTRO = `You are the coding agent inside the bench, where a person builds a slop app (pages, an optional actor, SQL migrations) and watches it run live in frames on a canvas.

You act through ONE tool, eval. Each call runs a JavaScript async function body in a QuickJS sandbox: no DOM, no network, no window. Use await, and \`return\` the value you want back (the last expression is not returned automatically). console.log output comes back too.

Your evals share a scope: top-level \`const\`/\`let\`/\`function\`/\`class\` declarations persist to your later evals in this thread (and across reloads, if they are JSON). Read once, keep the result in a variable, use it next time. vars() lists them; forget('name') drops one, forget() all.

An eval is a transaction. Its file writes are buffered: its own reads see them, nothing else does, until it ends. If the code throws, they are dropped. If it returns, they are committed as one change list against the snapshot the eval began on, and the server merges it file by file with whatever was committed since (by the person, another thread, a terminal). If someone else changed a file you also changed, that is a conflict: nothing is written, the eval fails with kind conflict and names the files. Read them again and redo the change.
Frames, scenario runs and app.* see committed snapshots only, so write in one eval and check the frames in the next. The result carries \`effects\`: the files changed (+added \u2212removed lines), the snapshot committed, the instances that came up on it (or why one broke), actor warnings, check issues that appeared or were fixed on every frame, new console errors, and \`layout\`: what moved, resized, appeared or changed text on each frame's page ("page height 900 \u2192 1020", "div.cats @menu.html:12: size 343\xD734 \u2192 343\xD776").
Save reusable helpers with lib.def(name, fn, {description}) (\u2192 .agent/lib/<name>.js, reviewed like any file); later evals, threads and sessions call lib.<name>(...). A saved function is rebuilt from its source alone: it may use the API, its arguments and other lib functions, not your variables. lib.list(), lib.source(name), lib.remove(name).

Steps. Every module call returns a Step: a plan. Awaiting a step runs it, so \`await files.read(p)\` just works. Steps also compose before they run:
  a.then(b) or seq(a, b)          b gets a's output; a function is wrapped as step(fn): (input, { input: runInput }) => value
  par([a, b]) or par({ k: a })    same input to each branch, outputs in an array or object
  alt({ k: a, other: b }).by(x => key)       one branch per input      loop(body).seed(s).until(st => \u2026).max(n).keep('best', st => score)
  .map({ concurrency }) runs a step once per element of an array input; .fold(monoid.sum | (acc, v) => \u2026, init)
  dyn(async (x, ctx) => ctx.run(term, input))   shape decided at run time       tx(async () => { \u2026 })  everything inside is atomic
  A call missing its first argument takes it from the input: files.list().then(step(fs => fs.filter(f => f.path.endsWith('.css')))).then(files.read().map())
  Wrappers: .retry({ times, when: e => e.kind === 'anchor' }) .timeout('30s') .fallback(other) .guard(x => \u2026, msg) .verify(out => \u2026, msg) .tap(fn) .approve('title') (asks the person) .named(name) .atomic() (drops every write inside if anything inside fails)
  .explain() returns the plan without running it. await step.dry() runs it with file writes captured and returns a changeset { files, diff }: await cs.apply() (or cs.only(f => \u2026).apply()). A dry run refuses writes outside files (app.seed, app.reset, publish.run).
  llm\`question about \${x => x.text}\`.output(s.enum(['yes', 'no'])) asks a quick model once. Schemas: s.string() s.number() s.int() s.boolean() s.enum([\u2026]) s.array(item) s.object({ \u2026 }), .optional() .describe(text).
  Error kinds (e.kind): anchor (replace text not found or ambiguous), missing, binary, invalid, type, timeout, guard, verify, schema, conflict, policy, approval, budget. retry and fallback never catch policy, approval, budget or cancelled.
  help() lists everything; help(files.replace) shows one call.

Subagents. delegate(role, task, { output, evals, proposal }) runs another Claude with its own thread, sandbox and timeline lane, and returns { result, thread, evals, proposal?, changes? }. Its evals come out of your budget; depth is capped at 2. A subagent working in your workspace writes into your eval: its changes commit with yours when your eval ends. Roles:
  explorer  read-only investigation, answers with file:line evidence
  reviewer  reads a proposal's diff, checks its frames and scenarios; result { verdict: 'approve' | 'changes', comments }  (pass { proposal: ref }, default: the open one)
  qa        runs and writes scenarios, sweeps frames for overflow, contrast, a11y and errors, files a pin per problem; result { pins, scenarios, summary }
  builder   builds in a proposal of its own and summarizes; result has proposal and changes
  delegate is a step, so it fans out: await par(['editorial', 'playful'].map(d => delegate('builder', brief + ' Direction: ' + d)))
  Pass { output: s.object({ \u2026 }) } to get typed JSON back. Delegate when work splits cleanly or needs a second opinion; do small things yourself.`;
  function appGuide(P) {
    return `How this app runs (the app store "${P.app}" on a slop server):
- Workspaces. draft is where the app is developed; main is what people use, and only the person publishes it. A proposal (proposal/<id>) is a copy of draft the person reviews and accepts onto draft (or rejects). session.workspace() says where your writes go.
- Instances run the app on data of their own. The canvas frames show the person's dev instance, which follows draft (a proposal is shown on their prop instance); scenarios run on their test instance, reset and seeded per run. Production instances follow main.
- app.json is the manifest: { "title", "page": "${Instances.entry(P)}" (the entry page), "actor": "actor.ts"?, "capabilities": { "db": {}, "user": {}, \u2026 }, "type"? }. Read it first, and README.md.
- Write TypeScript (.ts; .tsx for JSX): the server compiles it when it serves a page or loads the actor. It strips the types and does not check them, so write them with care: the person checks them with slop types and tsc. Apps written in .js keep working; do not convert one unless asked.
- Imports name the file with its extension: import { fmt } from './lib/fmt.ts', import type { Actions } from './api.ts'. There is no npm and no node_modules: a package is available only when the person has vendored it (vendor/, named in app.json's slop.imports). Never copy a package's code into the app. If a package would help: the person can't add one from the bench (only someone with the slop command line can: slop vendor <package>), so first build it without one when that is reasonable (a bar or line chart is a few dozen lines of SVG), and say so; otherwise tell them plainly that a developer has to add the package, in one sentence they can forward.
- Only the entry page gets the runtime; other .html files are served as plain files. Build one page and navigate inside it (hash routes: location.hash). Its script is a file: <script type="module" src="main.ts"><\/script>.
- Pages use claude (window.claude): const db = await claude.use('db'), then db.doc('notes/a').set({\u2026}), (await db.doc('notes/a').get()).data(), (await db.collection('notes').get()).docs, db.collection('notes').add({\u2026}), onSnapshot(\u2026). Capabilities the manifest does not declare are null: check before use.
- Live updates between people (a vote count on every phone, a board two people edit): don't poll. Either keep the shared state in db and render from onSnapshot, or, with an actor, send a room moment after each change so every open page refetches at once: const room = await claude.use('room'); room.on('votes', refetch); after a change, room.emit('votes', {}). Declare the topic in app.json: "capabilities": {"room": {"topics": {"votes": "interact"}}}. Say which you chose and why.
- The contract is each action's schemas: add: defineAction({ requires: 'interact', args: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', maxLength: 500 } } }, result: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }, run(ctx, { text }) { \u2026 } }). The server checks args before run (a wrong shape is invalid_argument naming the place, and run never sees it), so do not re-check types by hand; check meaning (empty after trim, ownership). defineAction types run's args and result from them; the page's slop.actions are typed from them (const slop = await claude.use('slop')). Give every action args (and a result when the page uses it). Results arrive as JSON (a Date becomes a string). An app may instead keep a types-only api.ts (defineActor({ \u2026 } satisfies ActorOf<Actions>), claude.use<Actions>('slop')): follow what the app does.
- actor.ts: defineActor({ actions: { name: { requires: 'view' | 'interact' | 'admin', async run(ctx, args) { \u2026 } } }, setup(ctx) { \u2026 } }). ctx.visitor is {id, name, level}. use('sql') runs SQL on the instance's own tables, synchronously, each argument a separate parameter (never an array): sql.all(query, ...args) -> rows, sql.one(query, ...args) -> row or null, sql.run(query, ...args). Files only the actor uses go under server/.
- sql/NNN_name.sql are migrations, applied once per instance, in order. Never edit one that has run; add a new file. app.reset() gives you a fresh dev instance when you must.
- After writing the actor or a migration, look at effects.instances and effects.actorLogs (or app.logs()) before going on.
- In an app with TypeScript, the bench type-checks the pages and the actor against the app's declarations (the same check as tsc with slop types). An eval's effects.types says what it did: {new: [{file, line, message}], fixed, total} (or {skipped} when the checker was not ready). Fix the type errors your eval introduced in your next eval; they are real mistakes (a misspelled field, a wrong argument), even though the page may still run. types.check() lists all of them, as your eval sees the files. Do not chase errors that were there before you, unless asked.
- Your eval code may be TypeScript too: pass ts: true with it (the types are stripped, not checked).
Markdown files (README.md, notes, specs) render in the Docs panel. Keep README.md current when you change pages, the actor or migrations.`;
  }
  var RULES = `Working rules:
- Look before you change: list files, read the relevant ones (files.lines for long files), check frames.
- Prefer files.replace for small edits; write whole files when creating or rewriting.
- Several small evals beat one huge one. Batch reads in one eval with par or Promise.all.
- After a change, read the effects in the eval's result; call frames.check or frames.text when you need more.
- Seed the dev instance (app.seed) to try things with data; keep production data out of it.
- When you add or change a flow (ordering, sign-up, a form), add or update a scenario for it and run it. Use a fixture for edge cases (empty collection, long names, many rows).
- Mark milestones with session.mark("short label"); mark decisions and guesses with their kind, so the person can audit them later.
- When you will need something again (a file list, rows, frame ids), keep it in a top-level variable. When a helper will be useful in later sessions, save it with lib.def.
- In a proposal, say what you changed so the person can judge it. Say which draft your change made; publishing is the person's call.
- Do not name your variables after the API's namespaces (files, app, frames, tests, session, ui, lib, types, \u2026): const [info, files] = \u2026 makes files a variable for the whole eval, and files.list() then fails.
- Talk to the person in their words, not the bench's internals: "your proposal "Add a heading"" (its title), not proposal/mwk3\u2026; "the preview of your proposal", not "the prop instance"; "the draft", not "draft 14". Explain a term the first time a person who does not program would meet it (a proposal: a copy of the app with your changes, which they look at and accept or reject).
- Say only what the effects show. A failed eval wrote nothing (its writes were rolled back: effects.rolledBack lists them), so a file it was making does not exist until an eval that succeeds writes it. Check before you tell the person something is done.
- Leave nothing of your own testing in the app: a probe action, a scratch file, a deliberate type error to see what the checker says. Remove it in the same turn, or do the probing in an eval that does not write.
- Start with what the person will see: a page they can look at and try, then the server code and tests behind it. Someone who does not program judges progress by the page.
- Tell the person everything they need to use what you made: a code or password you chose, which page to open, where to click, that a result appears below the fold.
- Questions about the bench itself are part of the job: how to try a change safely (a proposal), how to keep it (Accept in the chat or the Review tab), how to undo it (Reject; the Timeline restores earlier versions), how to see the data (the Data view), how to publish (Publish in the header; an administrator then gets a "Give it a web address" button, and app.addresses() tells you the link). Answer them plainly.
- Data you add to try things (rows, documents, test sign-ups) goes in the test instance (scenarios and fixtures), not the dev instance the person looks at: test rows in dev show up on their page. If some ended up in dev, remove just those rows (app.exec('DELETE FROM t WHERE id = ?', [id])), and say so. Never reset the dev instance to clean up: app.reset drops everything the person entered too.
- A scenario passes only if it checks what the person cares about: the numbers or words on the page, the rows in the data. Make each one fail once on purpose (change the expected value) to show it can, then put it back.
- Keep the app's README.md true: when the app's purpose or files change, update it in the same turn.
- Finish with a short summary in Markdown (short paragraphs, bullets, \`code\`; no big headings): what you changed, where, and anything left to do. Cite places as \`file:line\` (for example \`styles.css:73\`): they become links that open the file.`;
  function guide(P, api) {
    return INTRO + "\n\n" + appGuide(P) + "\n\nThe API (each call returns a Step; await it to run):\n" + api.reference(NOTES) + "\n\n" + RULES;
  }

  // src/agent/agent.js
  var BUDGET = 30;
  var firstLine2 = (code) => (code.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) || "").trim().slice(0, 90);
  var Agent = {
    sample: null,
    ready: false,
    ev: emitter(),
    turns: /* @__PURE__ */ new Map(),
    async init() {
      try {
        if (window.claude && window.claude.use) this.sample = await window.claude.use("sample");
      } catch {
        this.sample = null;
      }
      this.ready = true;
      this.ev.emit("ready");
    },
    busy(tid) {
      return this.turns.has(tid);
    },
    anyBusy() {
      return this.turns.size > 0;
    },
    // ---- what the model sees: the state of the project, then the thread ----
    context(P, ws, th) {
      const view = P.view(ws), st = Watch.status || {};
      const files2 = view.list().map((p) => {
        const t = view.read(p);
        return p + (t === null ? " (kept by hash)" : " (" + t.split("\n").length + " lines)");
      }).join(", ");
      const inst = [...["dev", "test"].filter((k) => st[k]).map((k) => [k, st[k]]), ...(st.props || []).map((s2) => ["prop", s2])].map(([k, s2]) => k + " " + s2.ref + " @" + s2.n + (s2.broken ? " BROKEN: " + s2.broken.slice(0, 160) : "")).join("; ") || "none yet";
      const frames = P.board().frames.map((f) => {
        const v = FrameHost.ui.hostFor(f.id);
        return f.id + (f.label ? ' "' + f.label + '"' : "") + " " + (v ? v.route : f.route) + " " + f.w + "x" + f.h + " at " + f.x + "," + f.y + (v && v.errors ? " " + v.errors + " errors" : "") + (v && v.issues.length ? " " + v.issues.length + " issues" : "");
      }).join("; ");
      const s = AgentUI.selection();
      const sel = s ? s.tag + (s.id ? "#" + s.id : "") + (s.cls ? "." + s.cls.split(" ").join(".") : "") + " at " + s.src + " in " + s.route + (s.text ? ' "' + s.text.slice(0, 60) + '"' : "") : "nothing";
      const pins2 = (P.meta.pins || []).filter((p) => !p.resolved).map((p) => "#" + p.n + " on " + p.route + " @" + (p.src || "?") + ": " + p.text).join("\n") || "none";
      const issues = [];
      for (const fh of FrameHosts) if (!fh.headless && fh.project === P) for (const i of fh.issues) issues.push(fh.route + " " + fh.w + "px: " + i.message + (i.src ? " @" + i.src : ""));
      const props = P.openProposals().map((p) => p.ref + ' "' + p.title + '"').join("; ") || "none";
      const where = ws === "draft" ? "draft " + P.draftOf(ws).head : "proposal " + ws + ' "' + (P.proposals.get(ws) || {}).title + '" at ' + P.draftOf(ws).head;
      return 'App "' + P.title + '" (' + P.app + "). Your writes go to " + where + "; main is " + (P.refs.main ?? "not published yet") + ".\nFiles: " + files2 + "\nInstances: " + inst + "\nFrames: " + frames + "\nOpen proposals: " + props + "\nSelected: " + sel + "\nOpen pins:\n" + pins2 + "\nCurrent check issues: " + (issues.slice(0, 8).join("; ") || "none") + "\nSaved lib functions: " + (libEntries(view).map((l) => "lib." + l.name + "(" + l.params.join(", ") + ")" + (l.description ? " \u2014 " + l.description : "")).join("; ") || "none") + "\nYour variables from earlier evals: " + (th && th.scope ? (scopeSummary(th.scope) || "none") + (th.scope.skipped && th.scope.skipped.length ? " (not kept: " + th.scope.skipped.join(", ") + ")" : "") : "none");
    },
    HIST_CHARS: 28e3,
    KEEP_CHARS: 12e3,
    KEEP_MIN: 4,
    MAX_MSGS: 30,
    // one message as history; detail adds a line per eval (what it ran, how it went, what it changed)
    renderMsg(m, detail) {
      if (m.role === "user") return (m.from ? "(from the " + m.from + ") " : "") + (m.text || "");
      const steps = m.steps || [], wrote = [...new Set(steps.flatMap((s) => (s.calls || []).filter((c) => /write|replace|remove|copy|save|seed|reset/.test(c))))];
      const t = m.text || (m.error ? "(failed: " + m.error + ")" : "(no reply)");
      if (!steps.length) return t;
      if (!detail) return t + "\n[" + plural(steps.length, "eval") + (wrote.length ? ", used " + wrote.join(", ") : "") + "]";
      return t + "\n[evals: " + steps.map((s, k) => "\n  " + (k + 1) + ". " + (s.status === "ok" ? "" : (s.status || "?") + " ") + firstLine2(s.code || "") + (s.status === "error" && s.out ? " \u2192 " + s.out.slice(0, 120) : "") + (effectsLine(s.effects) ? " \u2192 " + effectsLine(s.effects).slice(0, 140) : "")).join("") + "]";
    },
    // Fold older messages into th.summary when the history gets long. end:
    // the messages before the current exchange.
    async compact(P, th, { end = th.msgs.length, force = false, signal, onStart } = {}) {
      const start = th.summary ? th.summary.upTo : 0;
      if (end - start < 2) return null;
      const sizes = th.msgs.slice(start, end).map((m) => this.renderMsg(m, false).length), total = sizes.reduce((a, b) => a + b, 0);
      if (!force && total <= this.HIST_CHARS && sizes.length <= this.MAX_MSGS) return null;
      let keep = 0, acc = 0;
      for (let k = sizes.length - 1; k >= 0; k--) {
        if (keep >= (force ? 2 : this.KEEP_MIN) && (force || acc + sizes[k] > this.KEEP_CHARS)) break;
        acc += sizes[k];
        keep++;
      }
      let cut = end - keep;
      while (cut > start && th.msgs[cut] && th.msgs[cut].role !== "user") cut--;
      if (cut <= start) {
        cut = end - keep;
        while (cut < end && th.msgs[cut].role !== "user") cut++;
      }
      if (cut <= start || cut >= end) return null;
      if (onStart) onStart(cut - start);
      const part = th.msgs.slice(start, cut), lastT = part[part.length - 1].t;
      const marks = P.events.filter((e) => e.kind === "mark" && e.thread === th.id && e.at <= lastT && (!th.summary || e.at > th.summary.t0)).map((e) => "- " + (e.mk || "mark") + ": " + e.label + (e.note ? " (" + e.note + ")" : ""));
      const transcript = part.map((m, k) => "[" + (start + k + 1) + "] " + (m.role === "user" ? "Person: " : "Claude: ") + trunc(this.renderMsg(m, true), 3e3)).join("\n\n");
      const prompt = "You keep the running summary of a conversation between a person and Claude, a coding agent inside the bench (an IDE for slop apps). Older messages are about to leave Claude's context; your summary replaces them, so Claude must be able to continue the work from it alone. Merge the previous summary with the new messages.\n\nWrite Markdown, at most 350 words, under these bold headings, skipping any with nothing under it:\n**Goals** what the person wants, constraints and preferences (their words where it matters)\n**Decisions** what was decided and why\n**Done** what was built or changed: files, migrations, scenarios, fixtures, proposals (accepted, open or rejected)\n**Didn't work** what was tried and dropped, and why\n**Open** unanswered questions, things promised for later, known problems\n**Names** frame ids, variables, lib functions, fixtures and scenarios worth remembering\n\nBe specific (file:line, names, numbers). Do not add anything that is not in the messages. Reply with the summary only.\n\nPrevious summary:\n" + (th.summary ? th.summary.text : "(none: this is the start of the thread)") + "\n\nMessages " + (start + 1) + "\u2013" + cut + ":\n" + trunc(transcript, 4e4) + (marks.length ? "\n\nMarks on the timeline from this stretch:\n" + marks.join("\n") : "");
      let text = "", by = "claude";
      try {
        if (this.sample) {
          const r = await this.sample(prompt, { modelTier: "quick", cache: false, signal });
          text = (r && r.text || "").trim();
        }
      } catch (e) {
        if (signal && signal.aborted) throw e;
      }
      if (text.length < 40) {
        by = "fallback";
        text = this.plainSummary(th, start, cut);
      }
      th.summary = { upTo: cut, text: trunc(text, 6e3), by, t: now(), t0: lastT, chars: total };
      P.saveThread(th);
      P.log({ kind: "compact", who: "ide", thread: th.id, note: "summarized messages 1\u2013" + cut + ' of "' + th.title + '" for Claude' + (by === "fallback" ? " (without a model)" : "") });
      P.ev.emit("threads");
      return th.summary;
    },
    // a summary without a model: the requests, the first line of each reply, the files written
    plainSummary(th, start, cut) {
      const out = th.summary ? [th.summary.text, ""] : [], req = [], rep = [], files2 = /* @__PURE__ */ new Set();
      th.msgs.slice(start, cut).forEach((m, k) => {
        const n = start + k + 1;
        if (m.role === "user") req.push("- [" + n + "] " + trunc((m.text || "").replace(/\s+/g, " "), 200));
        else {
          const l = (m.text || m.error || "").split("\n").find((x) => x.trim());
          if (l) rep.push("- [" + n + "] " + trunc(l.replace(/^#+\s*/, ""), 160));
          for (const s of m.steps || []) for (const f of s.effects && s.effects.files || []) files2.add(f.path);
        }
      });
      if (req.length) out.push("**Requests**", ...req);
      if (rep.length) out.push("**Replies**", ...rep);
      if (files2.size) out.push("**Files written** " + [...files2].join(", "));
      return out.join("\n");
    },
    // the conversation so far (the model is memoryless), then the current state on the last message
    messages(P, th, ws, text, head) {
      const start = th.summary ? th.summary.upTo : 0, end = Math.max(start, th.msgs.length - 2);
      const hist = th.msgs.slice(start, end), agentIdx = hist.map((m, k) => m.role === "agent" ? k : -1).filter((k) => k >= 0).slice(-2);
      const rendered = hist.map((m, k) => ({ role: m.role === "user" ? "user" : "assistant", content: this.renderMsg(m, agentIdx.includes(k)), skip: m.role !== "user" && !m.text && !(m.steps && m.steps.length) })).filter((m) => !m.skip);
      let dropped = 0;
      while (rendered.length > 2 && rendered.reduce((a, m) => a + m.content.length, 0) > this.HIST_CHARS) {
        rendered.shift();
        dropped++;
      }
      while (rendered.length && rendered[0].role !== "user") {
        rendered.shift();
        dropped++;
      }
      const merged = [];
      for (const m of rendered) {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role) last.content += "\n\n" + m.content;
        else merged.push({ role: m.role, content: m.content });
      }
      let earlier = "";
      if (th.summary) earlier = "Earlier in this thread (messages 1\u2013" + th.summary.upTo + ", summarized; session.recall(query) searches them and session.message(n) reads one in full):\n" + th.summary.text + "\n\n" + (merged.length ? "The conversation continues:\n\n" : "");
      if (dropped) earlier += "(" + plural(dropped, "older message") + " not shown; session.recall(query) searches them.)\n\n";
      const cur = "Current state:\n" + this.context(P, ws, th) + "\n\n" + (th.parent ? "The main agent asks:\n" : "The person says:\n") + text;
      if (merged.length) {
        merged[0].content = head + earlier + merged[0].content;
        if (merged[merged.length - 1].role === "user") merged.push({ role: "assistant", content: "(continuing)" });
        merged.push({ role: "user", content: cur });
      } else merged.push({ role: "user", content: head + earlier + cur });
      return merged;
    },
    // ---- one model turn on a thread; the eval tool runs in the thread's sandbox session. Throws on failure. ----
    async turn(P, th, msg, text, o) {
      const ctx = makeContext(P, { ws: o.ws, who: "agent", thread: th.id, mode: th.mode, role: th.role || null, depth: o.depth || 0, budget: o.budget, tier: th.tier, model: th.model, signal: o.signal, parentTx: o.parentTx || null, agent: this });
      ctx.onApproval = (card) => {
        msg.approval = card;
        this.ev.emit("step", th.id);
      };
      ctx.onPanel = (id) => {
        msg.panels = msg.panels || [];
        if (!msg.panels.includes(id)) msg.panels.push(id);
        this.ev.emit("step", th.id);
      };
      const tool = {
        name: "eval",
        description: "Run a JavaScript async function body in the bench sandbox with the host API in scope (files, app, frames, fixtures, scenarios, session, ui, lib, publish) and the step core (step, seq, par, delegate, \u2026). Use `return` for the result. Returns {ok, value, logs, error, effects}.",
        inputSchema: { type: "object", properties: { code: { type: "string", description: "JavaScript statements; may use await; return the value you want back" }, ts: { type: "boolean", description: "the code is TypeScript: its types are stripped before it runs (they are not checked)" } }, required: ["code"] },
        execute: async (input) => {
          let code = String(input && input.code || "");
          const step = { code, t: now(), status: "running" };
          msg.steps.push(step);
          this.ev.emit("step", th.id);
          const b = o.budget;
          if (b.used >= b.max) {
            step.status = "error";
            step.out = "eval budget used up";
            this.ev.emit("step", th.id);
            throw new Error("eval budget (" + b.max + " for this " + (th.parent ? "delegation" : "turn") + ") used up: stop and summarize");
          }
          for (let x = b; x; x = x.parent) x.used++;
          if (th.mode === "ask") {
            step.status = "ask";
            this.ev.emit("step", th.id);
            const ok = await new Promise((res2) => {
              step.decide = res2;
              if (o.signal) o.signal.addEventListener("abort", () => res2(false));
            });
            delete step.decide;
            if (!ok) {
              step.status = "skipped";
              this.ev.emit("step", th.id);
              return JSON.stringify({ ok: false, error: { kind: "declined", message: "the person declined to run this eval; ask or try something else" } });
            }
            step.status = "running";
            this.ev.emit("step", th.id);
          }
          if (input && input.ts) {
            const t = await Types.transpile(code);
            if (t.error) {
              Object.assign(step, { ok: false, status: "error", out: "syntax: " + t.error + (t.line ? " (line " + t.line + ")" : "") });
              this.ev.emit("step", th.id);
              return JSON.stringify({ ok: false, error: { kind: "syntax", message: "the TypeScript does not compile: " + t.error, line: t.line || void 0 } });
            }
            code = t.code;
          }
          const r = await runEval(ctx, code, { sid: th.id, restore: th.scope && th.scope.vars });
          Object.assign(step, { ok: r.ok, ms: r.ms, engine: r.engine, calls: r.calls, effects: r.effects || void 0 });
          if (ctx.children.length) step.children = ctx.children.splice(0);
          if (r.scope) th.scope = r.scope;
          step.logs = (r.logs || []).map((l) => (l.level !== "log" ? l.level + ": " : "") + l.text);
          step.out = r.ok ? trunc(toYAML(r.value), 6e3) : r.error.kind + ": " + r.error.message + (r.error.line ? " (line " + r.error.line + ")" : "");
          step.fmt = r.ok ? "yaml" : void 0;
          step.status = r.ok ? "ok" : "error";
          P.log({ kind: "eval", who: "agent", ref: ctx.ws, thread: th.id, ok: r.ok, note: firstLine2(code), calls: [...new Set(r.calls || [])].slice(0, 12), n: r.effects && r.effects.commit ? r.effects.commit.n : void 0 });
          this.ev.emit("step", th.id);
          const out = { ok: r.ok, value: r.ok ? r.value : void 0, logs: step.logs.length ? step.logs : void 0, error: r.ok ? void 0 : r.error, effects: r.effects || void 0 };
          return trunc(JSON.stringify(out), 8e3);
        }
      };
      const R = th.role && ROLES[th.role];
      const head = (R ? "You are the " + th.role + " subagent, called by the main agent through delegate(). " + R.describe + (R.mode === "read" ? " Writes are refused (policy errors); canvas arrangement and ui.pin are allowed." : R.mode === "tests" ? " You may write only scenarios/ and fixtures/ (other writes are refused); canvas arrangement and ui.pin are allowed." : "") + " Reply to the main agent, briefly. Your budget is " + o.budget.max + " evals.\n\n" : "") + guide(P, ctx.api) + "\n\n";
      try {
        await this.compact(P, th, { end: th.msgs.length - 2, signal: o.signal, onStart: (n) => {
          msg.note = "Summarizing " + plural(n, "earlier message") + "\u2026";
          this.ev.emit("text", th.id);
        } });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw e;
      }
      if (msg.note) {
        delete msg.note;
        this.ev.emit("text", th.id);
      }
      const res = await this.sample(this.messages(P, th, o.ws, text, head), { tools: [tool], onText: ({ text: t }) => {
        msg.text = t;
        this.ev.emit("text", th.id);
      }, signal: o.signal, modelTier: th.tier || "default", cache: false, ...th.model ? { model: th.model } : {} });
      if (res && res.modelApplied) msg.model = res.modelApplied;
      msg.text = res && res.text || msg.text;
      if (res && res.truncated) msg.text += "\n[reply truncated]";
      return msg.text;
    },
    // The thread's workspace for a message: a proposal of its own when it
    // works in proposals (made on its first message, kept while open), the
    // viewed workspace for read and tests threads, else draft.
    async workspace(P, th, text) {
      if (th.mode === "read" || th.mode === "tests") return AgentUI.ws();
      if (th.target !== "proposal") return "draft";
      const cur = th.proposal && P.proposals.get(th.proposal);
      if (cur && cur.status === "open") return cur.ref;
      const p = await P.propose({ title: text.slice(0, 40) + (text.length > 40 ? "\u2026" : ""), thread: th.id });
      th.proposal = p.ref;
      return p.ref;
    },
    // An agent's proposal that ended with no changes is discarded.
    async proposalDone(P, ref) {
      const p = P.proposals.get(ref);
      if (!p || p.status !== "open") return [];
      const paths = (await P.changes(ref)).map((c) => c.path);
      if (!paths.length) await P.close(ref, "discarded");
      return paths;
    },
    async send(P, th, text) {
      if (!this.sample) throw new Error("Claude is not available in this view");
      if (this.busy(th.id)) return;
      await P.loadThread(th.id);
      const s = AgentUI.selection();
      th.msgs.push({ role: "user", text, t: now(), ctx: { sel: s ? { src: s.src, tag: s.tag, route: s.route } : null, pins: (P.meta.pins || []).filter((p) => !p.resolved).length } });
      if (th.msgs.filter((m) => m.role === "user").length === 1 && /^Thread \d+$/.test(th.title)) th.title = text.slice(0, 32) + (text.length > 32 ? "\u2026" : "");
      const msg = { role: "agent", text: "", steps: [], t: now(), status: "running", tier: th.tier };
      th.msgs.push(msg);
      const abort = new AbortController();
      this.turns.set(th.id, { abort, msg, thread: th });
      this.ev.emit("turn", th.id);
      let ws = "draft";
      try {
        ws = msg.ws = await this.workspace(P, th, text);
        if (ws !== "draft" && AgentUI.ws() !== ws) AgentUI.setWs(ws);
        P.log({ kind: "msg", who: "you", ref: ws, thread: th.id, note: text.slice(0, 140) });
        await this.turn(P, th, msg, text, { ws, depth: 0, budget: { max: BUDGET, used: 0, parent: null }, signal: abort.signal });
        msg.status = "done";
      } catch (e) {
        const code = e && e.code;
        msg.status = abort.signal.aborted ? "stopped" : "error";
        msg.error = abort.signal.aborted ? "Stopped." : code === "not_granted" ? "Claude is not available for this page (not granted)." : code === "rate_limited" ? "Rate limited: wait a little and send again." : e && e.message || String(e);
        if (e && e.text && !msg.text) msg.text = e.text;
        if (code === "not_granted") {
          this.sample = null;
          this.ev.emit("ready");
        }
      } finally {
        this.turns.delete(th.id);
        msg.approval = null;
        for (const st of msg.steps) if (st.status === "running" || st.status === "ask") st.status = "skipped";
        let changed2 = [];
        if (ws !== "draft" && th.proposal === ws) {
          changed2 = await this.proposalDone(P, ws).catch(() => []);
          if (!changed2.length) {
            th.proposal = null;
            if (AgentUI.ws() === ws) AgentUI.setWs("draft");
          }
        }
        msg.summary = changed2.length ? plural(changed2.length, "file") + ' changed in "' + P.proposals.get(ws).title + '"' : "";
        if (msg.status === "done" && !(msg.text || "").trim() && msg.steps.length) msg.text = autoSummary(msg, changed2, ws === "draft" ? null : (P.proposals.get(ws) || {}).title), msg.auto = true;
        P.log({ kind: "turn", who: "agent", ref: ws, thread: th.id, ok: msg.status === "done", note: (msg.text || msg.error || "").split("\n")[0].slice(0, 140), evals: msg.steps.length });
        P.saveThread(th);
        P.ev.emit("threads");
        this.ev.emit("turn", th.id);
        if (changed2.length) AgentUI.notify("Proposal ready: " + plural(changed2.length, "file") + " to review");
      }
    },
    // delegate(role, task): a subagent with its own thread, sandbox session
    // and timeline lane. Its evals come out of the caller's budget; it may
    // delegate in turn, to a depth of MAX_DEPTH. Working in the caller's
    // workspace, its evals run inside the caller's transaction.
    async delegate(pctx, role, task, opts = {}) {
      const R = ROLES[role];
      if (!R) throw Object.assign(new Error('no role "' + role + '". Roles: ' + Object.keys(ROLES).join(", ")), { kind: "invalid" });
      if (!this.sample) throw Object.assign(new Error("Claude is not available in this view"), { kind: "unavailable" });
      if ((pctx.depth || 0) >= MAX_DEPTH) throw Object.assign(new Error("delegation depth is capped at " + MAX_DEPTH), { kind: "budget" });
      const pb = pctx.budget || { max: BUDGET, used: 0, parent: null };
      let room = Infinity;
      for (let x = pb; x; x = x.parent) room = Math.min(room, x.max - x.used);
      const want = Math.min(opts.evals || R.evals, room - 1);
      if (want < 1) throw Object.assign(new Error("not enough eval budget left to delegate (" + room + " left)"), { kind: "budget" });
      const budget = { max: want, used: 0, parent: pb };
      const P = pctx.project, short = task.replace(/\s+/g, " ");
      const th = P.newThread(role + ": " + short.slice(0, 40), { parent: pctx.thread || "eval", role, mode: R.mode, target: R.own ? "proposal" : "draft", tier: opts.tier || pctx.tier || "default", model: opts.model !== void 0 ? opts.model : pctx.model || null });
      let ws = pctx.ws, prompt = task;
      if (R.own) {
        const p = await P.propose({ title: role + ": " + short.slice(0, 36), thread: th.id });
        th.proposal = p.ref;
        ws = p.ref;
      }
      if (role === "reviewer") {
        const target = opts.proposal || (pctx.ws !== "draft" ? pctx.ws : (P.openProposals().slice(-1)[0] || {}).ref);
        if (!target || !P.proposals.get(target)) throw Object.assign(new Error("reviewer needs a proposal: pass { proposal: ref } (open: " + (P.openProposals().map((p) => p.ref).join(", ") || "none") + ")"), { kind: "invalid" });
        ws = target;
        const ch = await P.changes(target);
        prompt += '\n\nYou are reviewing proposal "' + P.proposals.get(target).title + '" (' + target + "; your reads and frame checks see it). frames.compare(frameId) lists its layout changes against draft; scenarios.runAll() runs the scenarios against it. Its changes against its base:\n" + trunc(ch.map((c) => c.after === null && c.entry ? "~ " + c.path + " (kept by hash)" : diffText(c.path, c.before ?? "", c.after ?? "")).join("\n\n"), 7e3);
      }
      const out = opts.output || R.output;
      if (out) prompt += "\n\nEnd your reply with JSON only (no code fences), matching: " + out;
      th.msgs.push({ role: "user", text: task, t: now(), from: pctx.role || "main agent" });
      const msg = { role: "agent", text: "", steps: [], t: now(), ws, status: "running", tier: th.tier };
      th.msgs.push(msg);
      const abort = new AbortController();
      if (pctx.signal) {
        if (pctx.signal.aborted) abort.abort();
        else pctx.signal.addEventListener("abort", () => abort.abort());
      }
      this.turns.set(th.id, { abort, msg, thread: th });
      this.ev.emit("turn", th.id);
      P.ev.emit("threads");
      pctx.children.push({ thread: th.id, role });
      P.log({ kind: "delegate", who: pctx.who || "agent", ref: pctx.ws, thread: pctx.thread, note: role + ": " + task.slice(0, 120), child: th.id });
      let failure = null;
      try {
        await this.turn(P, th, msg, prompt, { ws, depth: (pctx.depth || 0) + 1, budget, signal: abort.signal, parentTx: ws === pctx.ws ? pctx.tx : null });
        msg.status = "done";
      } catch (e) {
        failure = e;
        msg.status = abort.signal.aborted ? "stopped" : "error";
        msg.error = e && e.message || String(e);
      } finally {
        this.turns.delete(th.id);
        for (const st of msg.steps) if (st.status === "running" || st.status === "ask") st.status = "skipped";
        P.log({ kind: "turn", who: "agent", ref: ws, thread: th.id, ok: msg.status === "done", note: (msg.text || msg.error || "").split("\n")[0].slice(0, 140), evals: msg.steps.length });
        P.saveThread(th);
        P.ev.emit("threads");
        this.ev.emit("turn", th.id);
      }
      const changes = R.own ? await this.proposalDone(P, ws).catch(() => []) : void 0;
      if (failure) throw Object.assign(new Error(role + " failed: " + (msg.error || "unknown") + " (thread " + th.id + ")"), { kind: abort.signal.aborted ? "cancelled" : "agent" });
      const parsed = out ? parseJSONReply(msg.text || "") : void 0;
      return {
        role,
        thread: th.id,
        evals: budget.used,
        result: parsed !== void 0 ? parsed : msg.text || "",
        text: trunc(msg.text || "", 4e3),
        proposal: R.own && changes.length ? ws : void 0,
        changes
      };
    },
    stop(tid) {
      const t = this.turns.get(tid);
      if (t) t.abort.abort();
    }
  };
  function autoSummary(msg, changed2, proposal) {
    const files2 = /* @__PURE__ */ new Set(), bad = msg.steps.filter((st) => st.status === "error").length;
    for (const st of msg.steps) for (const f of st.effects && st.effects.files || []) files2.add(f.path);
    const parts = [];
    if (files2.size) parts.push("Changed " + [...files2].slice(0, 6).join(", ") + (files2.size > 6 ? " and " + (files2.size - 6) + " more" : "") + (proposal ? ' in the proposal "' + proposal + '" (a copy of your app: look at it, then accept it to keep the changes)' : " in the draft") + ".");
    else parts.push("Looked at the app; nothing was changed.");
    if (bad) parts.push(plural(bad, "step") + " failed along the way.");
    return parts.join(" ");
  }

  // src/ui/dock.js
  var Views = {};
  function registerViews(defs) {
    Object.assign(Views, defs);
  }
  var tile = (views, active) => ({ t: "tile", id: uid("t"), views, active: active || views[0] });
  var split = (dir, kids, sizes) => ({ t: "split", id: uid("s"), dir, kids, sizes: sizes || kids.map(() => 1 / kids.length) });
  var LAYOUTS = {
    Build: () => split("row", [
      tile(["agent", "evalrepl"]),
      split("col", [tile(["canvas", "timeline"]), tile(["console", "data", "scenarios"])], [0.7, 0.3]),
      split("col", [tile(["code", "review", "docs"]), tile(["inspector", "layers", "panels"])], [0.56, 0.44])
    ], [0.24, 0.47, 0.29]),
    Code: () => split("row", [
      tile(["code"]),
      split("col", [tile(["canvas"]), tile(["agent", "console"])], [0.55, 0.45])
    ], [0.55, 0.45]),
    Review: () => split("row", [
      tile(["review", "scenarios", "timeline", "docs"]),
      split("col", [tile(["canvas"]), tile(["agent", "code"])], [0.6, 0.4])
    ], [0.42, 0.58]),
    Data: () => split("row", [
      split("col", [tile(["data"]), tile(["evalrepl", "console"])], [0.6, 0.4]),
      tile(["canvas", "agent"])
    ], [0.5, 0.5]),
    Canvas: () => split("row", [tile(["canvas"]), tile(["inspector", "layers", "agent", "panels"])], [0.74, 0.26])
  };
  function normalize(n) {
    if (!n) return null;
    if (n.t === "tile") {
      if (!n.views.length) return null;
      if (!n.views.includes(n.active)) n.active = n.views[0];
      return n;
    }
    const kids = [], sizes = [];
    n.kids.forEach((k, i) => {
      const c = normalize(k);
      if (!c) return;
      if (c.t === "split" && c.dir === n.dir) c.kids.forEach((kk, j) => {
        kids.push(kk);
        sizes.push(n.sizes[i] * c.sizes[j]);
      });
      else {
        kids.push(c);
        sizes.push(n.sizes[i]);
      }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    return Object.assign(n, { kids, sizes: sizes.map((s) => s / sum) });
  }
  function walkTiles(n, fn, parent) {
    if (!n) return;
    if (n.t === "tile") fn(n, parent);
    else n.kids.forEach((k) => walkTiles(k, fn, n));
  }
  function tileOf(layout, view) {
    let r = null;
    walkTiles(layout, (t) => {
      if (t.views.includes(view)) r = t;
    });
    return r;
  }
  function tileById(layout, id) {
    let r = null;
    walkTiles(layout, (t) => {
      if (t.id === id) r = t;
    });
    return r;
  }
  function replaceNode(n, id, rep) {
    if (!n) return n;
    if (n.id === id) return rep;
    if (n.t === "split") n.kids = n.kids.map((k) => replaceNode(k, id, rep));
    return n;
  }
  var Dock = {
    layout: null,
    floats: [],
    inst: {},
    el: null,
    work: null,
    ev: emitter(),
    dragging: null,
    z: 0,
    mount(work) {
      this.work = work;
      this.el = h("div.dock");
      work.appendChild(this.el);
      new ResizeObserver(() => this.ev.emit("resize")).observe(this.el);
    },
    instance(id) {
      if (!this.inst[id]) {
        const def = Views[id];
        if (!def) return null;
        const v = def.make();
        v.el.classList.add("view");
        v.el.dataset.view = id;
        this.inst[id] = v;
      }
      return this.inst[id];
    },
    isOpen(id) {
      return !!tileOf(this.layout, id) || this.floats.some((f) => f.view === id);
    },
    set(layout, floats) {
      this.layout = normalize(layout);
      if (floats) this.floats = floats.filter((f) => Views[f.view] && !tileOf(this.layout, f.view));
      this.render();
      this.changed();
    },
    // the layout changed: the shell saves it (a per-viewer preference)
    changed: debounce(function() {
      Dock.ev.emit("changed");
    }, 600),
    // ---- operations ----
    detach(view) {
      walkTiles(this.layout, (t) => {
        const i = t.views.indexOf(view);
        if (i >= 0) {
          t.views.splice(i, 1);
          if (t.active === view) t.active = t.views[Math.max(0, i - 1)];
        }
      });
      this.floats = this.floats.filter((f) => f.view !== view);
    },
    addTab(view, tileId, index) {
      this.detach(view);
      const t = tileById(this.layout, tileId) || this.biggest();
      if (!t) {
        this.layout = tile([view]);
        return;
      }
      t.views.splice(index == null ? t.views.length : clamp(index, 0, t.views.length), 0, view);
      t.active = view;
    },
    splitWith(view, tileId, side) {
      const t0 = tileById(this.layout, tileId);
      if (!t0) return;
      if (t0.views.length === 1 && t0.views[0] === view) return;
      this.detach(view);
      const t = tileById(this.layout, tileId) || this.biggest();
      const nt = tile([view]), dir = side === "left" || side === "right" ? "row" : "col", first = side === "left" || side === "top";
      const copy = { ...t }, sp = split(dir, first ? [nt, copy] : [copy, nt], [0.5, 0.5]);
      this.layout = t === this.layout ? sp : replaceNode(this.layout, t.id, sp);
    },
    float(view, x, y) {
      const r = this.work.getBoundingClientRect();
      this.detach(view);
      this.floats.push({ view, x: clamp(x ?? r.width / 2 - 220, 0, r.width - 200), y: clamp(y ?? 60, 0, r.height - 120), w: 460, h: 380 });
    },
    open(view, near) {
      if (!Views[view]) return;
      const t = tileOf(this.layout, view);
      if (t) {
        t.active = view;
        this.renderTile(t);
        return this.changed();
      }
      if (this.floats.some((f) => f.view === view)) return;
      const target = near ? tileOf(this.layout, near) : null;
      this.addTab(view, (target || this.biggest() || {}).id);
      this.apply();
    },
    close(view) {
      this.detach(view);
      this.apply();
    },
    biggest() {
      let best = null, area = -1;
      walkTiles(this.layout, (t) => {
        const el = this.el.querySelector('[data-tile="' + t.id + '"]');
        const r = el ? el.getBoundingClientRect() : { width: 1, height: 1 };
        if (r.width * r.height > area) {
          area = r.width * r.height;
          best = t;
        }
      });
      return best;
    },
    apply() {
      this.layout = normalize(this.layout);
      if (!this.layout) this.layout = tile(["canvas"]);
      this.render();
      this.changed();
    },
    // ---- rendering ----
    render() {
      for (const v of Object.values(this.inst)) v.el.remove();
      clear(this.el);
      if (this.layout) this.el.appendChild(this.node(this.layout));
      $$(".float", this.work).forEach((f) => f.remove());
      for (const f of this.floats) this.work.appendChild(this.floatEl(f));
      for (const [id, v] of Object.entries(this.inst)) {
        const vis = this.visible(id);
        if (vis !== v._vis) {
          v._vis = vis;
          vis ? v.show && v.show() : v.hide && v.hide();
        }
      }
      this.ev.emit("render");
    },
    visible(id) {
      const t = tileOf(this.layout, id);
      return t ? t.active === id : this.floats.some((f) => f.view === id);
    },
    node(n) {
      if (n.t === "tile") return h("div.dcell", { style: { flex: "1 1 0" } }, this.tileEl(n));
      const wrap = h("div.dsplit." + n.dir);
      n.kids.forEach((k, i) => {
        if (i) wrap.appendChild(this.gutter(n, i, wrap));
        const c = k.t === "tile" ? h("div.dcell", this.tileEl(k)) : h("div.dcell", this.node(k));
        c.style.flex = n.sizes[i] + " 1 0";
        wrap.appendChild(c);
      });
      return wrap;
    },
    tileEl(t) {
      const strip = h("div.dstrip"), tabs = h("div.dtabs"), body = h("div.tilebody");
      const el = h("div.tile", { "data-tile": t.id }, strip, body);
      for (const v of t.views) {
        const def = Views[v];
        if (!def) continue;
        const tab = h(
          "div.dtab" + (t.active === v ? ".on" : ""),
          { "data-view": v },
          h("button.lbl", { title: def.title + " (drag to move or split)", on: { pointerdown: (e) => this.tabDown(e, v, t) } }, def.title, def.badge ? def.badge() : null),
          h("button.x", { title: "Close " + def.title, on: { click: (e) => {
            e.stopPropagation();
            this.close(v);
          } } }, "\xD7")
        );
        tabs.appendChild(tab);
      }
      strip.append(
        tabs,
        h("span.sp"),
        h("button.tabact", { title: "Add a view here", on: { click: (e) => this.pick(e.currentTarget, t) } }, "+"),
        h("button.tabact", { title: "Float this view", on: { click: () => {
          this.float(t.active);
          this.apply();
        } } }, "\u29C9")
      );
      for (const v of t.views) {
        const inst = this.instance(v);
        if (!inst) continue;
        inst.el.style.display = v === t.active ? "" : "none";
        body.appendChild(inst.el);
      }
      return el;
    },
    renderTile(t) {
      const el = this.el.querySelector('[data-tile="' + t.id + '"]');
      if (!el) return this.render();
      $$(".dtab", el).forEach((tb) => tb.classList.toggle("on", tb.dataset.view === t.active));
      for (const v of t.views) {
        const inst = this.inst[v];
        if (!inst) continue;
        const on = v === t.active;
        inst.el.style.display = on ? "" : "none";
        if (on !== inst._vis) {
          inst._vis = on;
          on ? inst.show && inst.show() : inst.hide && inst.hide();
        }
      }
    },
    refreshTabs() {
      walkTiles(this.layout, (t) => {
        const el = this.el.querySelector('[data-tile="' + t.id + '"]');
        if (!el) return;
        for (const v of t.views) {
          const lbl = el.querySelector('.dtab[data-view="' + v + '"] .lbl');
          if (lbl && Views[v].badge) {
            lbl.querySelector(".count")?.remove();
            const b = Views[v].badge();
            if (b) lbl.appendChild(b);
          }
        }
      });
    },
    pick(btn, t) {
      const items = [{ group: "Views" }];
      for (const [id, def] of Object.entries(Views)) items.push({ label: def.title, sub: this.isOpen(id) ? t.views.includes(id) ? "here" : "move here" : def.sub || "", run: () => {
        this.addTab(id, t.id);
        this.apply();
      } });
      popMenu(btn, items, { right: true });
    },
    gutter(n, i, wrap) {
      const g = h("div.gutter." + n.dir);
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        g.setPointerCapture(e.pointerId);
        const cells = [...wrap.children].filter((c) => c.classList.contains("dcell")), a = cells[i - 1], b = cells[i];
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), total = n.sizes[i - 1] + n.sizes[i];
        const span = n.dir === "row" ? ra.width + rb.width : ra.height + rb.height, start = n.dir === "row" ? e.clientX : e.clientY, s0 = n.sizes[i - 1];
        document.body.classList.add(n.dir === "row" ? "resizing-x" : "resizing-y");
        const move = (ev) => {
          const d = ((n.dir === "row" ? ev.clientX : ev.clientY) - start) / span * total;
          const s = clamp(s0 + d, 0.06 * total, total - 0.06 * total);
          n.sizes[i - 1] = s;
          n.sizes[i] = total - s;
          a.style.flex = s + " 1 0";
          b.style.flex = total - s + " 1 0";
        };
        const up = () => {
          g.removeEventListener("pointermove", move);
          g.removeEventListener("pointerup", up);
          document.body.classList.remove("resizing-x", "resizing-y");
          this.changed();
          this.ev.emit("resize");
        };
        g.addEventListener("pointermove", move);
        g.addEventListener("pointerup", up);
      });
      return g;
    },
    // ---- tab drag: tabs zone (insert), edges (split), center (join), outside (float) ----
    tabDown(e, view, t) {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null, hint = null, target = null;
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
          ghost = h("div.drag-ghost", Views[view].title, " ", h("small", "drop on a tab strip, an edge, or outside to float"));
          hint = h("div.drop-hint");
          document.body.append(ghost, hint);
          document.body.classList.add("dragging-view");
        }
        ghost.style.left = ev.clientX + 12 + "px";
        ghost.style.top = ev.clientY + 12 + "px";
        target = this.dropTarget(ev.clientX, ev.clientY, view);
        if (!target) {
          hint.hidden = true;
          return;
        }
        hint.hidden = false;
        hint.className = "drop-hint" + (target.marker ? " marker" : "");
        Object.assign(hint.style, { left: target.rect.x + "px", top: target.rect.y + "px", width: target.rect.w + "px", height: target.rect.h + "px" });
        hint.innerHTML = target.marker ? "" : "<span>" + target.label + "</span>";
      };
      const up = (ev) => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        if (!ghost) {
          t.active = view;
          this.renderTile(t);
          this.changed();
          return;
        }
        ghost.remove();
        hint.remove();
        document.body.classList.remove("dragging-view");
        if (!target) return;
        if (target.kind === "tabs") this.addTab(view, target.tile, target.index);
        else if (target.kind === "edge") this.splitWith(view, target.tile, target.side);
        else if (target.kind === "center") this.addTab(view, target.tile);
        else if (target.kind === "float") {
          const r = this.work.getBoundingClientRect();
          this.float(view, ev.clientX - r.left - 100, ev.clientY - r.top - 15);
        }
        this.apply();
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    },
    dropTarget(x, y, view) {
      const dr = this.el.getBoundingClientRect();
      if (x < dr.left || x > dr.right || y < dr.top || y > dr.bottom) return { kind: "float", label: "Float", rect: { x: x - 110, y: y - 16, w: 220, h: 32 } };
      for (const el of $$(".tile", this.el)) {
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const id = el.dataset.tile, strip = el.querySelector(".dstrip").getBoundingClientRect();
        if (y <= strip.bottom) {
          const tabs = $$(".dtab", el).filter((tb) => tb.dataset.view !== view);
          let index = tabs.length, mx = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : strip.left + 4;
          for (let i = 0; i < tabs.length; i++) {
            const tr = tabs[i].getBoundingClientRect();
            if (x < tr.left + tr.width / 2) {
              index = i;
              mx = tr.left;
              break;
            }
          }
          return { kind: "tabs", tile: id, index, marker: true, rect: { x: mx - 1, y: strip.top + 4, w: 2, h: strip.height - 8 } };
        }
        const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height, band = 0.22;
        const sides = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]].filter((s) => s[1] < band).sort((a, b) => a[1] - b[1]);
        if (sides.length) {
          const s = sides[0][0], R = { x: r.left, y: r.top, w: r.width, h: r.height };
          if (s === "left") R.w /= 2;
          if (s === "right") {
            R.x += r.width / 2;
            R.w /= 2;
          }
          if (s === "top") R.h /= 2;
          if (s === "bottom") {
            R.y += r.height / 2;
            R.h /= 2;
          }
          return { kind: "edge", tile: id, side: s, label: "Split " + s, rect: R };
        }
        return { kind: "center", tile: id, label: "Add as tab", rect: { x: r.left + 8, y: r.top + 8, w: r.width - 16, h: r.height - 16 } };
      }
      return null;
    },
    floatEl(f) {
      const def = Views[f.view], inst = this.instance(f.view);
      const head = h(
        "div.fhead",
        h("span", def.title),
        h("small", "floating"),
        h("span.sp"),
        h("button.ibtn", { title: "Dock it back", on: { click: () => {
          this.addTab(f.view, (this.biggest() || {}).id);
          this.apply();
        } } }, "\u21F2"),
        h("button.ibtn", { title: "Close", on: { click: () => this.close(f.view) } }, "\xD7")
      );
      const body = h("div.fbody"), el = h("div.float", { style: { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" } }, head, body);
      if (inst) {
        inst.el.style.display = "";
        body.appendChild(inst.el);
      }
      head.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        e.preventDefault();
        head.setPointerCapture(e.pointerId);
        document.body.classList.add("moving");
        const sx = e.clientX - f.x, sy = e.clientY - f.y, R = this.work.getBoundingClientRect();
        const move = (ev) => {
          f.x = clamp(ev.clientX - sx, -f.w + 80, R.width - 80);
          f.y = clamp(ev.clientY - sy, 0, R.height - 30);
          el.style.left = f.x + "px";
          el.style.top = f.y + "px";
        };
        const up = () => {
          head.removeEventListener("pointermove", move);
          head.removeEventListener("pointerup", up);
          document.body.classList.remove("moving");
          this.changed();
        };
        head.addEventListener("pointermove", move);
        head.addEventListener("pointerup", up);
      });
      new ResizeObserver(() => {
        if (!el.isConnected) return;
        const w = el.offsetWidth, hh = el.offsetHeight;
        if (w && (w !== f.w || hh !== f.h)) {
          f.w = w;
          f.h = hh;
          this.changed();
          this.ev.emit("resize");
        }
      }).observe(el);
      el.addEventListener("pointerdown", () => {
        el.style.zIndex = 30 + ++this.z;
      }, true);
      return el;
    }
  };

  // src/server/records.js
  var Prefs = {
    get(key, dflt) {
      try {
        const v = localStorage.getItem("bench|" + key);
        return v == null ? dflt : JSON.parse(v);
      } catch {
        return dflt;
      }
    },
    set(key, v) {
      try {
        localStorage.setItem("bench|" + key, JSON.stringify(v));
      } catch {
      }
    }
  };
  var Records = {
    ev: emitter(),
    queues: /* @__PURE__ */ new Map(),
    error: "",
    get status() {
      return this.queues.size ? "saving" : this.error ? "error" : "saved";
    },
    save(key, fn) {
      let q = this.queues.get(key);
      if (!q) {
        q = { next: null, done: null };
        this.queues.set(key, q);
      }
      q.next = fn;
      if (!q.done) q.done = this.pump(key, q);
      this.ev.emit("status");
      return q.done;
    },
    async pump(key, q) {
      while (q.next) {
        const fn = q.next;
        q.next = null;
        try {
          await fn();
          this.error = "";
        } catch (e) {
          this.error = e && e.message || String(e);
          console.error("saving " + key, e);
        }
      }
      this.queues.delete(key);
      this.ev.emit("status");
    },
    // resolves when every save made so far has finished
    async flush() {
      while (this.queues.size) await Promise.all([...this.queues.values()].map((q) => q.done));
    }
  };
  addEventListener("beforeunload", (e) => {
    if (Records.queues.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // src/lib/css.js
  function cssBlocks(text) {
    const out = [];
    let i = 0, depth = 0, start = 0;
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "{") {
        const sel = clean.slice(start, i).trim();
        if (sel.startsWith("@")) {
          depth++;
          start = i + 1;
          continue;
        }
        const close2 = clean.indexOf("}", i);
        const end = close2 < 0 ? clean.length : close2;
        out.push({ sel, selStart: start + clean.slice(start, i).search(/\S/), bodyStart: i + 1, bodyEnd: end });
        i = end;
        start = end + 1;
      } else if (ch === "}") {
        depth = Math.max(0, depth - 1);
        start = i + 1;
      } else if (ch === ";" && depth >= 0 && !clean.slice(start, i).includes("{")) {
        if (clean.slice(start, i).trim().startsWith("@")) start = i + 1;
      }
    }
    return out;
  }
  var normSel = (s) => s.replace(/\s+/g, " ").replace(/\s*([,>+~])\s*/g, "$1").trim();
  function findRule(text, selector) {
    const n = normSel(selector);
    return cssBlocks(text).find((b) => normSel(b.sel) === n);
  }
  function cssSet(text, selector, prop, value) {
    const b = findRule(text, selector);
    if (!b) return null;
    const body = text.slice(b.bodyStart, b.bodyEnd);
    const re = new RegExp("(^|[;{\\s])(" + prop.replace(/[-]/g, "\\-") + ")(\\s*:\\s*)([^;]*?)(\\s*(;|$))", "m");
    let nb;
    if (value === null) nb = body.replace(re, (m, pre) => pre);
    else if (re.test(body)) nb = body.replace(re, (m, pre, p, colon, v, tail) => pre + p + colon + value + tail);
    else {
      const multi = body.includes("\n"), ind = (/\n([ \t]+)\S/.exec(body) || [])[1] || "  ";
      nb = multi ? body.replace(/\s*$/, "") + (body.trim() && !body.trim().endsWith(";") ? ";" : "") + "\n" + ind + prop + ": " + value + ";\n" : body.replace(/\s*$/, "") + (body.trim() && !body.trim().endsWith(";") ? ";" : "") + " " + prop + ": " + value + "; ";
    }
    return text.slice(0, b.bodyStart) + nb + text.slice(b.bodyEnd);
  }

  // src/ui/panels.js
  var PANEL_CONTROLS = ["slider", "toggle", "select", "text", "color", "button"];
  var PANEL_WIDGETS = ["value", "chart", "table", "list", "text"];
  var SOURCE_KEYS = ["sql", "docs", "issues", "scenarios", "events", "frameEvents", "frame", "eval", "lib"];
  function checkPanel(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "a panel is { title, items: [ \u2026 ] }";
    if (!Array.isArray(spec.items) || !spec.items.length) return "items must be a non-empty list of controls and widgets";
    if (spec.items.length > 24) return "at most 24 items in a panel";
    const ids = /* @__PURE__ */ new Set();
    for (const [i, it] of spec.items.entries()) {
      const where = "item " + (i + 1) + (it && it.id ? " (" + it.id + ")" : "");
      if (!it || typeof it !== "object") return where + " is not an object";
      if (![...PANEL_CONTROLS, ...PANEL_WIDGETS].includes(it.type)) return where + ": type is one of " + [...PANEL_CONTROLS, ...PANEL_WIDGETS].join(", ");
      if (PANEL_CONTROLS.includes(it.type) && it.type !== "button") {
        if (!it.id || !/^[A-Za-z_][\w-]{0,30}$/.test(it.id)) return where + ": a " + it.type + " needs an id (a word), to read its value by";
        if (ids.has(it.id)) return where + ': id "' + it.id + '" is used twice';
        ids.add(it.id);
      }
      if (it.type === "slider" && (typeof it.min !== "number" || typeof it.max !== "number" || it.max <= it.min)) return where + ": a slider needs numbers min < max";
      if (it.type === "select" && !Array.isArray(it.options) && !(it.bind && it.bind.css)) return where + ": a select needs options: [value, \u2026] or [{ value, label }, \u2026]";
      if (it.type === "button" && typeof it.run !== "string") return where + ': a button needs run: "code" (it runs as the person, with `values` in scope)';
      if (it.bind) {
        const b = it.bind, k = Object.keys(b).filter((x) => ["cssVar", "style", "css"].includes(x));
        if (k.length !== 1) return where + ': bind is one of { cssVar: "--name", unit?, file? } | { style: { selector, prop }, unit?, file? } | { css: { on: {\u2026}, off: {\u2026} } } (toggle) or { css: { optionValue: {\u2026} } } (select)';
        if (b.css) {
          if (!["toggle", "select"].includes(it.type)) return where + ": bind.css is for a toggle ({ on, off }) or a select (one entry per option)";
          if (typeof b.css !== "object" || !Object.keys(b.css).length) return where + ': bind.css maps each state to CSS: { on: { "--font": "\u2026", "body": { "font-family": "\u2026" } }, off: { \u2026 } }';
          for (const [state, map] of Object.entries(b.css)) {
            if (!map || typeof map !== "object") return where + ": bind.css." + state + " must be an object";
            for (const [key, v] of Object.entries(map)) {
              if (key.startsWith("--")) {
                if (typeof v !== "string" && typeof v !== "number") return where + ": " + key + " in bind.css." + state + " must be a value";
              } else if (!v || typeof v !== "object") return where + ": in bind.css." + state + ', "' + key + '" is a selector, so it needs { property: value }';
            }
          }
        }
        if (b.cssVar && !/^--[\w-]+$/.test(b.cssVar)) return where + ': cssVar is a custom property name like "--menu-scale"';
        if (b.style && (!b.style.selector || !b.style.prop)) return where + ": style needs selector and prop";
      }
      if (["value", "chart", "table", "list"].includes(it.type)) {
        if (!it.from || typeof it.from !== "object" || !SOURCE_KEYS.some((k) => k in it.from)) return where + ": from is one of " + SOURCE_KEYS.map((k) => "{ " + k + " }").join(", ");
      }
      if (it.type === "chart" && it.kind && !["line", "bar"].includes(it.kind)) return where + ": kind is line or bar";
    }
    return null;
  }
  var Preview = {
    vars: {},
    rules: {},
    // name -> { value, panel }, 'selector|prop' -> { selector, prop, value, panel }
    payload() {
      return { vars: Object.fromEntries(Object.entries(this.vars).map(([k, v]) => [k, v.value])), rules: Object.values(this.rules).map((r) => ({ selector: r.selector, prop: r.prop, value: r.value })) };
    },
    push() {
      const pv = this.payload();
      for (const fh of FrameHosts) if (!fh.headless && fh.project === App.P) fh.push({ push: "preview", preview: pv });
      App.ev.emit("preview");
    },
    count(panel) {
      return Object.values(this.vars).filter((v) => !panel || v.panel === panel).length + Object.values(this.rules).filter((r) => !panel || r.panel === panel).length;
    },
    clear(panel) {
      for (const [k, v] of Object.entries(this.vars)) if (!panel || v.panel === panel) delete this.vars[k];
      for (const [k, r] of Object.entries(this.rules)) if (!panel || r.panel === panel) delete this.rules[k];
      this.push();
    }
  };
  var cssFiles = (P, ws) => P.list(ws).filter((p) => p.endsWith(".css"));
  var fmtVal = (v, unit) => typeof v === "number" ? String(Math.round(v * 1e3) / 1e3) + (unit || "") : String(v);
  var Panels = {
    waiting: /* @__PURE__ */ new Map(),
    runs: /* @__PURE__ */ new Map(),
    list(P) {
      return P.meta.panels || (P.meta.panels = []);
    },
    get(P, id) {
      return this.list(P).find((p) => p.id === id) || null;
    },
    // create or replace; values the person set survive when the control is still there
    upsert(P, id, spec, o = {}) {
      const bad = checkPanel(spec);
      if (bad) throw Object.assign(new Error(bad), { kind: "invalid" });
      let p = this.get(P, id);
      const values = {};
      for (const it of spec.items) if (it.id && it.type !== "button") values[it.id] = p && p.values && it.id in p.values ? p.values[it.id] : this.initial(P, it, o.ws || "draft");
      if (!p) {
        p = { id, created: now() };
        this.list(P).push(p);
        while (this.list(P).length > 30) this.list(P).shift();
      }
      Object.assign(p, { spec: clone(spec), values, by: o.by || "agent", thread: o.thread || p.thread || null, t: now(), pinned: o.pinned ?? p.pinned ?? false });
      P.saveMeta();
      App.ev.emit("panels", id);
      return p;
    },
    // a slider bound to a CSS variable starts at the file's value when there is one
    initial(P, it, ws) {
      if (it.value !== void 0) return it.value;
      const b = it.bind || {};
      if (b.cssVar || b.style) {
        for (const f of b.file ? [b.file] : cssFiles(P, ws)) {
          const text = P.read(f, ws) || "";
          const m = b.cssVar ? new RegExp(b.cssVar.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;}]+)").exec(text) : (() => {
            const r = findRule(text, b.style.selector);
            if (!r) return null;
            return new RegExp("(?:^|[;{\\s])" + b.style.prop.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;}]+)").exec(text.slice(r.bodyStart, r.bodyEnd));
          })();
          if (m) {
            const raw = m[1].trim();
            if (it.type === "slider") {
              const n = parseFloat(raw);
              if (!isNaN(n)) return n;
            } else if (it.type !== "toggle") return raw;
          }
        }
      }
      return it.type === "slider" ? it.min : it.type === "toggle" ? false : it.type === "select" ? (this.options(P, it)[0] || {}).value ?? "" : it.type === "color" ? "#000000" : "";
    },
    options(P, it) {
      if (it.bind && it.bind.css && !it.options) return Object.keys(it.bind.css).map((k) => ({ value: k, label: k }));
      return (it.options || []).map((o) => typeof o === "object" ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) });
    },
    // the person (or ui.set) changes a value: apply its binding
    set(P, p, id, v, { by = "you" } = {}) {
      const it = p.spec.items.find((x) => x.id === id);
      if (!it) throw Object.assign(new Error('no control "' + id + '" in panel ' + p.id), { kind: "missing" });
      if (it.type === "slider") v = clamp(+v, it.min, it.max);
      p.values[id] = v;
      this.saveSoon(P);
      const b = it.bind;
      if (b && b.css) {
        for (const [k, x] of Object.entries(Preview.vars)) if (x.panel === p.id && x.item === id) delete Preview.vars[k];
        for (const [k, x] of Object.entries(Preview.rules)) if (x.panel === p.id && x.item === id) delete Preview.rules[k];
        const map = b.css[it.type === "toggle" ? v ? "on" : "off" : String(v)] || {};
        for (const [key, val] of Object.entries(map)) {
          if (key.startsWith("--")) Preview.vars[key] = { value: String(val), panel: p.id, item: id };
          else for (const [prop, pv] of Object.entries(val)) Preview.rules[key + "|" + prop] = { selector: key, prop, value: String(pv), panel: p.id, item: id };
        }
        Preview.push();
      } else if (b && b.cssVar) {
        Preview.vars[b.cssVar] = { value: fmtVal(v, b.unit), panel: p.id, item: id };
        Preview.push();
      } else if (b && b.style) {
        Preview.rules[b.style.selector + "|" + b.style.prop] = { selector: b.style.selector, prop: b.style.prop, value: fmtVal(v, b.unit), panel: p.id, item: id };
        Preview.push();
      }
      p.log = (p.log || []).concat([{ t: now(), id, v, by }]).slice(-40);
      App.ev.emit("panelvalue", p.id, id);
    },
    saveSoon: debounce((P) => P.saveMeta(), 600),
    // write the previewed values of a panel into the CSS (the workspace being viewed)
    keep(P, p) {
      const ws = App.ws, written = /* @__PURE__ */ new Map();
      const fileFor = (b) => b.file || (cssFiles(P, ws).includes("styles.css") ? "styles.css" : cssFiles(P, ws)[0]);
      const textOf = (f) => written.has(f) ? written.get(f) : P.read(f, ws) ?? "";
      for (const [name, v] of Object.entries(Preview.vars)) {
        if (v.panel !== p.id) continue;
        const it = p.spec.items.find((x) => x.id === v.item), f = fileFor(it.bind);
        if (!f) continue;
        let t = textOf(f), re = new RegExp("(" + name.replace(/[-]/g, "\\-") + "\\s*:\\s*)([^;}]+)");
        if (re.test(t)) t = t.replace(re, (m, a) => a + v.value);
        else if (findRule(t, ":root")) t = cssSet(t, ":root", name, v.value);
        else t = ":root { " + name + ": " + v.value + "; }\n" + t;
        written.set(f, t);
      }
      for (const r of Object.values(Preview.rules)) {
        if (r.panel !== p.id) continue;
        const it = p.spec.items.find((x) => x.id === r.item), f = fileFor(it.bind);
        if (!f) continue;
        let t = textOf(f);
        t = cssSet(t, r.selector, r.prop, r.value) ?? t.replace(/\s*$/, "") + "\n\n" + r.selector + " {\n  " + r.prop + ": " + r.value + ";\n}\n";
        written.set(f, t);
      }
      const what = [...Object.entries(Preview.vars).filter(([, v]) => v.panel === p.id).map(([k, v]) => k + ": " + v.value), ...Object.values(Preview.rules).filter((r) => r.panel === p.id).map((r) => r.selector + " { " + r.prop + ": " + r.value + " }")];
      for (const [f, t] of written) P.write(f, t, ws);
      Preview.clear(p.id);
      return { files: [...written.keys()], what };
    },
    // a button: its code runs as the person, in the workspace being viewed, with the panel's values in scope
    async run(P, p, it) {
      const code = "const values = " + JSON.stringify(p.values) + "\n" + it.run;
      this.runs.set(p.id, { label: it.label, busy: true });
      App.ev.emit("panelvalue", p.id);
      const r = await runEval(makeContext(P, { ws: App.ws, who: "you", mode: "auto" }), code, { sid: "panel:" + P.app + ":" + p.id });
      P.log({ kind: "eval", who: "you", ref: App.ws, ok: r.ok, note: 'panel "' + (p.spec.title || p.id) + '": ' + (it.label || "button"), calls: [...new Set(r.calls || [])].slice(0, 12) });
      this.runs.set(p.id, { label: it.label, ok: r.ok, out: r.ok ? r.value === void 0 ? "done" : trunc(toYAML(r.value), 600) : r.error.kind + ": " + r.error.message, fx: effectsLine(r.effects) });
      App.ev.emit("panelvalue", p.id);
      return r;
    },
    remove(P, id) {
      const l = this.list(P), i = l.findIndex((p) => p.id === id);
      if (i >= 0) l.splice(i, 1);
      Preview.clear(id);
      const w = this.waiting.get(id);
      if (w) w.resolve(null);
      P.saveMeta();
      App.ev.emit("panels", id);
    }
  };
  var Sources = {
    issues: [],
    init() {
      App.ev.on("health", () => {
        const v = App.health(), last = this.issues[this.issues.length - 1];
        if (!last || last.v !== v || now() - last.t > 6e4) {
          this.issues.push({ t: now(), v });
          if (this.issues.length > 240) this.issues.shift();
        }
      });
      App.ev.on("project", () => {
        this.issues = [];
      });
    },
    // what changes make a source worth reading again: [emitter, event] pairs
    triggers(from) {
      if (from.sql || from.docs) return [[App.ev, "events"], [Streams.ev, "frameevent"]];
      if (from.issues) return [[App.ev, "health"]];
      if (from.scenarios) return [[App.ev, "scenarios"], [App.ev, "files"]];
      if (from.events) return [[App.ev, "events"]];
      if (from.frameEvents) return [[Streams.ev, "frameevent"]];
      if (from.frame) return [[App.ev, "frameready"], [Streams.ev, "frameevent"]];
      return [[App.ev, "files"], [App.ev, "scenarios"], [App.ev, "panelvalue"]];
    },
    // rows: count, sum of a field, counts (or sums of `of`) per group, the last `limit`
    shape(rows, from) {
      if (from.where) rows = rows.filter((r) => Object.entries(from.where).every(([k, v]) => r[k] === v));
      if (from.count) return rows.length;
      if (from.sum) return rows.reduce((a, r) => a + (+r[from.sum] || 0), 0);
      if (from.group) {
        const m = /* @__PURE__ */ new Map();
        for (const r of rows) {
          const k = String(r[from.group] ?? "\u2014");
          m.set(k, (m.get(k) || 0) + (from.of ? +r[from.of] || 0 : 1));
        }
        return [...m].map(([label2, value]) => ({ label: label2, value }));
      }
      return from.limit ? rows.slice(-from.limit) : rows;
    },
    perBucket(times, from) {
      const per = from.per === "hour" ? 36e5 : 6e4, n = clamp(+from.buckets || 30, 5, 120), end = Math.ceil(now() / per) * per, out = Array.from({ length: n }, (_, k) => ({ t: end - (n - k) * per, value: 0 }));
      for (const t of times) {
        const k = Math.floor((t - (end - n * per)) / per);
        if (k >= 0 && k < n) out[k].value++;
      }
      return out;
    },
    async read(P, from, p) {
      if (from.sql) return this.shape(await Slop.call("sql", { app: P.app, kind: from.kind || "dev", query: from.sql, args: from.args || [] }), from);
      if (from.docs) return this.shape((await Slop.call("docs", { app: P.app, kind: from.kind || "dev", coll: from.docs })).map((d) => ({ id: d.path.split("/").pop(), ...d.body })), from);
      if (from.issues) return this.issues.map((x) => ({ t: x.t, value: x.v }));
      if (from.scenarios) {
        const l = scenarioList(P, App.ws);
        return from.count ? l.filter((s) => s.last && s.last.ok).length + " / " + l.length : l.map((s) => ({ scenario: s.name, result: s.error ? "invalid" : !s.last ? "not run" : s.last.ok ? "passes" : "fails at step " + (s.last.failedAt + 1), when: s.last ? fmtAgo(s.last.t) : "" }));
      }
      if (from.events) return this.perBucket(P.events.filter((e) => from.events === true || e.kind === from.events).map((e) => e.at), from);
      if (from.frameEvents) {
        const kinds = from.frameEvents === true ? null : [].concat(from.frameEvents);
        const evs = Streams.frames.filter((e) => (!kinds || kinds.includes(e.kind)) && (!from.frame || e.frame === from.frame || e.fid === from.frame));
        if (from.count) return evs.length;
        if (from.per) return this.perBucket(evs.map((e) => e.t), from);
        return evs.slice(-(from.limit || 20)).reverse().map((e) => ({ when: fmtTime(e.t), frame: e.frame + " " + e.w, kind: e.kind, what: e.detail }));
      }
      if (from.frame) {
        const fr = P.frame(from.frame) || P.board().frames.find((f) => f.route === from.frame);
        if (!fr) throw new Error("no frame " + from.frame);
        const { fh } = await layoutIn(P, fr, App.ws);
        if (from.count) return fh.call("count", [from.count], 3e3);
        if (from.text) return fh.call("text", [from.text], 3e3);
        throw new Error("frame sources take count or text: a selector");
      }
      if (from.eval || from.lib) {
        const code = "const values = " + JSON.stringify(p.values) + "\n" + (from.eval || "return await lib." + from.lib + "(..." + JSON.stringify(from.args || []) + ")");
        const r = await runEval(makeContext(P, { ws: App.ws, who: "you", mode: "read" }), code, { sid: "panelsrc:" + P.app + ":" + p.id });
        if (!r.ok) throw new Error(r.error.kind + ": " + r.error.message);
        return r.value;
      }
      throw new Error("unknown source");
    }
  };
  var initSources = () => Sources.init();
  function chartEl(data, it) {
    const W = 320, H = 128, L = 30, R = it.kind === "line" && Array.isArray(data) && data.series ? 54 : 10, T = 8, B = 20;
    const wrap = h("div.pchart"), tip = h("div.ptip", { hidden: true });
    let series;
    const asPoints = (arr) => arr.map((d, i) => typeof d === "number" ? { x: i, label: String(i + 1), y: d } : d && "value" in d ? { x: d.t ?? i, label: d.label ?? (d.t ? fmtTime(d.t) : String(i + 1)), y: +d.value || 0 } : { x: it.x ? d[it.x] : i, label: String(it.x ? d[it.x] : i + 1), y: +(it.y ? d[it.y] : Object.values(d).find((v) => typeof v === "number")) || 0 });
    if (data && Array.isArray(data.series)) series = data.series.slice(0, 3).map((s) => ({ name: s.name, pts: asPoints(s.points || []) }));
    else if (Array.isArray(data)) series = [{ name: it.label || "", pts: asPoints(data) }];
    else {
      wrap.appendChild(h("p.note", "Nothing to chart (expected a list)."));
      return wrap;
    }
    const kind = it.kind || (series[0].pts.every((p) => typeof p.x === "number" && p.x > 1e11) ? "line" : "bar");
    const all = series.flatMap((s) => s.pts);
    if (!all.length) {
      wrap.appendChild(h("p.note", "No data yet."));
      return wrap;
    }
    const ymax = Math.max(0, ...all.map((p) => p.y)), ymin = Math.min(0, ...all.map((p) => p.y)), span = ymax - ymin || 1;
    const nice = (v) => {
      const e = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))), f = Math.abs(v) / e;
      return Math.sign(v) * (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
    };
    const top = ymax > 0 ? nice(ymax) : 0, bot = ymin < 0 ? nice(ymin) : 0, Y = (v) => T + (H - T - B) * (1 - (v - bot) / (top - bot || span));
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": (it.label || "chart") + ": " + series.map((s) => s.pts.length + " points").join(", ") });
    const ints = all.every((p) => Number.isInteger(p.y)), mid = (bot + top) / 2;
    for (const v of ints && !Number.isInteger(mid) ? [bot, top] : [bot, mid, top]) {
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v === 0 ? "base" : "grid" }));
      const tx = svgEl("text", { x: L - 4, y: Y(v) + 3, "text-anchor": "end", class: "tick" });
      tx.textContent = fmtNum(v);
      svg.appendChild(tx);
    }
    const show = (x, y, text) => {
      tip.hidden = false;
      tip.textContent = text;
      const r = wrap.getBoundingClientRect();
      tip.style.left = clamp(x / W * r.width, 40, r.width - 40) + "px";
      tip.style.top = Math.max(0, y / H * r.height - 30) + "px";
    };
    const hide = () => {
      tip.hidden = true;
    };
    if (kind === "bar") {
      const pts = series[0].pts.slice(-40), bw = Math.min(44, (W - L - R) / pts.length), gap = Math.min(2, bw * 0.2), off = L + (W - L - R - bw * pts.length) / 2;
      pts.forEach((p, i) => {
        const x = off + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = Y(0), y1 = Y(p.y), r = Math.min(4, w / 2, Math.abs(y0 - y1));
        const d = p.y >= 0 ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z` : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
        const bar = svgEl("path", { d, class: "bar" });
        svg.appendChild(bar);
        const hit = svgEl("rect", { x: off + i * bw, y: T, width: bw, height: H - T - B, fill: "transparent" });
        hit.addEventListener("mouseenter", () => {
          bar.classList.add("on");
          show(x + w / 2, Math.min(y0, y1), p.label + ": " + fmtNum(p.y));
        });
        hit.addEventListener("mouseleave", () => {
          bar.classList.remove("on");
          hide();
        });
        svg.appendChild(hit);
        if (pts.length <= 8) {
          const tx = svgEl("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle", class: "tick" });
          tx.textContent = trunc(p.label, Math.max(4, Math.floor(bw / 6)));
          svg.appendChild(tx);
        }
      });
    } else {
      const xs = all.map((p) => +p.x), x0 = Math.min(...xs), x1 = Math.max(...xs), X = (v) => L + (W - L - R) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
      series.forEach((s, k) => {
        if (!s.pts.length) return;
        svg.appendChild(svgEl("path", { d: s.pts.map((p, i) => (i ? "L" : "M") + X(+p.x).toFixed(1) + "," + Y(p.y).toFixed(1)).join(" "), class: "line s" + (k + 1) }));
        if (series.length > 1) {
          const l = s.pts[s.pts.length - 1], tx = svgEl("text", { x: X(+l.x) + 4, y: Y(l.y) + 3, class: "tick end" });
          tx.textContent = trunc(s.name || "series " + (k + 1), 9);
          svg.appendChild(tx);
        }
      });
      for (const [v, a] of [[x0, "start"], [x1, "end"]]) {
        const tx = svgEl("text", { x: X(v), y: H - 6, "text-anchor": a, class: "tick" });
        tx.textContent = x1 > 1e11 ? fmtTime(v) : fmtNum(v);
        svg.appendChild(tx);
      }
      const cross = svgEl("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" }), dots = series.map((s, k) => svgEl("circle", { r: 4, class: "dot s" + (k + 1), visibility: "hidden" }));
      svg.append(cross, ...dots);
      const hit = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
      hit.addEventListener("mousemove", (e) => {
        const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W, near = series[0].pts.reduce((b, p) => Math.abs(X(+p.x) - vx) < Math.abs(X(+b.x) - vx) ? p : b, series[0].pts[0]);
        cross.setAttribute("x1", X(+near.x));
        cross.setAttribute("x2", X(+near.x));
        cross.setAttribute("visibility", "visible");
        const parts = series.map((s, k) => {
          const q = s.pts.find((p) => +p.x === +near.x);
          if (q) {
            dots[k].setAttribute("cx", X(+q.x));
            dots[k].setAttribute("cy", Y(q.y));
            dots[k].setAttribute("visibility", "visible");
          } else dots[k].setAttribute("visibility", "hidden");
          return q ? (series.length > 1 ? (s.name || "series " + (k + 1)) + " " : "") + fmtNum(q.y) : "";
        }).filter(Boolean);
        show(X(+near.x), Y(near.y), near.label + " \xB7 " + parts.join(" \xB7 "));
      });
      hit.addEventListener("mouseleave", () => {
        cross.setAttribute("visibility", "hidden");
        dots.forEach((d) => d.setAttribute("visibility", "hidden"));
        hide();
      });
      svg.appendChild(hit);
    }
    wrap.append(svg, tip);
    if (series.length > 1) wrap.appendChild(h("div.plegend", series.map((s, k) => h("span", h("i.s" + (k + 1)), s.name || "series " + (k + 1)))));
    return wrap;
  }
  var fmtNum = (v) => typeof v !== "number" ? String(v) : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(Math.abs(v) >= 1e5 ? 0 : 1) + "k" : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  function panelEl(P, p, { inline } = {}) {
    const card = h("div.panel" + (inline ? ".inline" : ""), { "data-panel": p.id });
    const base = [], wl = [];
    const paint = () => {
      wl.splice(0).forEach((f) => f());
      const np = Panels.get(P, p.id);
      if (!np) {
        clear(card).appendChild(h("p.note", 'Panel "' + p.id + '" was removed.'));
        return;
      }
      p = np;
      clear(card);
      const waiting = Panels.waiting.get(p.id), run = Panels.runs.get(p.id), pv = Preview.count(p.id);
      card.appendChild(h(
        "div.ph",
        h("b", p.spec.title || p.id),
        p.spec.description ? h("span.note", p.spec.description) : null,
        h("span.sp"),
        h("button.link.note", { title: "Panel actions", on: { click: (e) => popMenu(e.currentTarget, [
          { label: p.pinned ? "Unpin from the Panels tab" : "Pin to the Panels tab", run: () => {
            p.pinned = !p.pinned;
            P.saveMeta();
            App.ev.emit("panels", p.id);
            if (p.pinned) Dock.open("panels");
          } },
          { label: "Show its definition", run: () => modal({ title: 'Panel "' + p.id + '"', wide: true, body: [h("pre.mono.yaml", { html: hlYAML(toYAML(p.spec)) })], actions: [{ label: "Close" }] }) },
          { label: "Remove", danger: true, run: () => Panels.remove(P, p.id) }
        ], { right: true }) } }, "\u22EF")
      ));
      const grid = h("div.pgrid");
      for (const it of p.spec.items) grid.appendChild(PANEL_CONTROLS.includes(it.type) ? controlEl(P, p, it) : widgetEl(P, p, it, wl));
      card.appendChild(grid);
      if (run) card.appendChild(h("div.prun" + (run.busy ? "" : run.ok ? ".ok" : ".bad"), h("b", run.label || "button"), " ", h("span.note", run.busy ? "running\u2026" : (run.ok ? "done" : "failed") + (run.fx ? " \xB7 " + run.fx : "")), run.busy ? null : h("pre.mono", run.out)));
      if (pv || waiting) card.appendChild(h(
        "div.pfoot",
        pv ? [
          h("span.note", "Previewing " + plural(pv, "value") + " on the canvas, not in any file yet"),
          h("span.sp"),
          h("button.btn.sm", { on: { click: () => Preview.clear(p.id) } }, "Reset"),
          h("button.btn.sm.primary", { title: "Write the values into the CSS" + (App.ws !== "draft" ? " of this proposal" : ""), on: { click: () => {
            const r = Panels.keep(P, p);
            toast("Kept " + r.what.join(", ") + " in " + r.files.join(", "));
          } } }, "Keep")
        ] : h("span.sp"),
        waiting ? [h("button.btn.sm", { on: { click: () => waiting.resolve(null) } }, "Cancel"), h("button.btn.sm.primary", { on: { click: () => waiting.resolve(clone(p.values)) } }, waiting.label || "Done")] : null
      ));
    };
    const repaintSoon = debounce(() => {
      if (!card.contains(document.activeElement) || document.activeElement.type !== "range") paint();
    }, 60);
    base.push(
      App.ev.on("panelvalue", (id) => {
        if (id === p.id) repaintSoon();
      }),
      App.ev.on("panels", (id) => {
        if (id === p.id) paint();
      }),
      App.ev.on("preview", () => paintFoot()),
      App.ev.on("ask", (id) => {
        if (id === p.id) paint();
      })
    );
    const paintFoot = () => {
      const has = !!card.querySelector(".pfoot"), want = Preview.count(p.id) > 0 || Panels.waiting.has(p.id);
      if (has !== want) paint();
      else if (has) {
        const n = card.querySelector(".pfoot .note");
        if (n) n.textContent = "Previewing " + plural(Preview.count(p.id), "value") + " on the canvas, not in any file yet";
      }
    };
    paint();
    const mo = new MutationObserver(() => {
      if (!card.isConnected) {
        base.forEach((f) => f());
        wl.forEach((f) => f());
        mo.disconnect();
      }
    });
    setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
    return card;
  }
  function controlEl(P, p, it) {
    const v = p.values[it.id], set = (val) => {
      try {
        Panels.set(P, p, it.id, val);
      } catch (e) {
        toast(e.message);
      }
    };
    const label2 = h("label.pl", it.label || it.id), out = h("span.pv");
    const show = (val) => {
      out.textContent = it.type === "slider" ? fmtVal(val, it.bind && it.bind.unit || it.unit) : "";
    };
    let input;
    const fill = (el, val) => el.style.setProperty("--p", (val - it.min) / (it.max - it.min) * 100 + "%");
    if (it.type === "slider") {
      input = h("input", { type: "range", min: it.min, max: it.max, step: it.step || (it.max - it.min) / 100, value: v, on: { input: (e) => {
        fill(e.target, +e.target.value);
        show(+e.target.value);
        set(+e.target.value);
      } } });
      fill(input, v);
      show(v);
    } else if (it.type === "toggle") input = h("input", { type: "checkbox", checked: !!v, on: { change: (e) => set(e.target.checked) } });
    else if (it.type === "select") {
      input = h("select", { on: { change: (e) => {
        const o = Panels.options(P, it).find((o2) => String(o2.value) === e.target.value);
        set(o ? o.value : e.target.value);
      } } }, Panels.options(P, it).map((o) => h("option", { value: String(o.value), selected: String(o.value) === String(v) }, o.label)));
    } else if (it.type === "text") input = h("input", { value: v ?? "", placeholder: it.placeholder || "", on: { change: (e) => set(e.target.value) } });
    else if (it.type === "color") input = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000", on: { input: (e) => set(e.target.value) } });
    else if (it.type === "button") return h("div.prow.btnrow", h("button.btn.sm", { disabled: !!(Panels.runs.get(p.id) || {}).busy, title: it.description || "", on: { click: () => Panels.run(P, p, it) } }, it.label || "Run"), it.description ? h("span.note", it.description) : null);
    const bind = it.bind ? h("span.pb", { title: "What this control changes" }, it.bind.css ? (() => {
      const m = it.bind.css[it.type === "toggle" ? v ? "on" : "off" : String(v)] || {}, n = Object.entries(m).reduce((a, [k, x]) => a + (k.startsWith("--") ? 1 : Object.keys(x).length), 0);
      return "css: " + plural(n, "value");
    })() : it.bind.cssVar ? it.bind.cssVar : it.bind.style ? it.bind.style.selector + " " + it.bind.style.prop : "") : null;
    return h("div.prow", label2, input, out, bind);
  }
  function widgetEl(P, p, it, offs) {
    const box = h("div.pw" + (it.type === "value" ? ".val" : ""));
    if (it.type === "text" && !it.from) {
      box.appendChild(renderMarkdown(String(it.text || it.markdown || ""), (f) => P.read(f, "draft") !== null));
      return box;
    }
    let seq = 0;
    const load = async () => {
      const my = ++seq;
      let v, err;
      try {
        v = await Sources.read(P, it.from, p);
      } catch (e) {
        err = e.message;
      }
      if (my !== seq) return;
      clear(box);
      if (it.label && it.type !== "value") box.appendChild(h("div.pl", it.label));
      if (err) {
        box.appendChild(h("p.note", { style: { color: "var(--accent)" } }, err));
        return;
      }
      if (it.type === "value") box.append(h("div.big", typeof v === "number" ? fmtNum(v) + (it.unit || "") : v == null ? "\u2014" : typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v)), h("div.pl", it.label || ""));
      else if (it.type === "chart") box.appendChild(chartEl(v, it));
      else if (it.type === "table") {
        if (Array.isArray(v) && !v.length) {
          box.appendChild(h("p.note", it.empty || "Nothing yet."));
          return;
        }
        const rows = Array.isArray(v) ? v.slice(0, it.limit || 50) : v && typeof v === "object" ? Object.entries(v).map(([key, value]) => ({ key, value })) : [{ value: v }];
        const cols = it.cols || [...new Set(rows.flatMap((r) => r && typeof r === "object" ? Object.keys(r) : ["value"]))].slice(0, 8);
        box.appendChild(h("div.ptable", h("table.grid.ro", h("thead", h("tr", cols.map((c) => h("th", c)))), h("tbody", rows.map((r) => h("tr", cols.map((c) => {
          const x = r && typeof r === "object" ? r[c] : r;
          return h("td", x == null ? "" : typeof x === "object" ? JSON.stringify(x) : typeof x === "number" ? fmtNum(x) : String(x));
        })))))));
        if (Array.isArray(v) && v.length > rows.length) box.appendChild(h("div.note", "\u2026 " + (v.length - rows.length) + " more"));
      } else if (it.type === "list") box.appendChild(h("ul.plist", (Array.isArray(v) ? v : [v]).slice(0, it.limit || 30).map((x) => h("li", x && typeof x === "object" ? (x.label ?? x.name ?? Object.values(x).filter((v2) => v2 != null && v2 !== "" && typeof v2 !== "object").join(" \xB7 ")) + ((x.label ?? x.name) != null && x.value !== void 0 ? ": " + x.value : "") : String(x)))));
      else if (it.type === "text") box.appendChild(renderMarkdown(String(v ?? ""), (f) => P.read(f, "draft") !== null));
    };
    const soon = debounce(load, it.from.eval || it.from.lib ? 400 : 150);
    for (const [em, t] of Sources.triggers(it.from)) offs.push(em.on(t, (...a) => {
      if (t === "panelvalue" && a[0] !== p.id) return;
      soon();
    }));
    offs.push(App.ev.on("ws", soon));
    box.appendChild(h("p.note", "\u2026"));
    load();
    return box;
  }
  var PANELS = {
    title: "Panels",
    sub: "controls and live values",
    make() {
      const body = h("div.scroll"), el = h("div", body);
      function paint() {
        clear(body);
        const P = App.P;
        if (!P) return;
        const list = Panels.list(P).filter((p) => p.pinned);
        body.appendChild(h(
          "div.toolbar",
          h("b", "Panels"),
          h("span.note", "pinned from threads, or made in the Eval panel"),
          h("span.sp"),
          Preview.count() ? [h("span.note", "Previewing " + plural(Preview.count(), "value")), h("button.btn.sm", { on: { click: () => Preview.clear() } }, "Reset all")] : null
        ));
        if (!list.length) body.appendChild(h("div.empty", h("p", "No pinned panels."), h("p.note", `Ask Claude for one, for example: "give me sliders for the menu's font size and spacing, a dark-theme toggle, and a chart of open orders by status". Panels show in the reply; pin one here from its \u22EF menu.`)));
        for (const p of list.slice().reverse()) body.appendChild(panelEl(P, p));
      }
      const later = debounce(() => {
        if (Dock.visible("panels")) paint();
      }, 80);
      App.ev.on("panels", later);
      App.ev.on("project", () => {
        Preview.vars = {};
        Preview.rules = {};
        later();
      });
      return { el, show: paint };
    }
  };
  var missing2 = (msg) => Object.assign(new Error(msg), { kind: "missing" });
  var PANEL_API = {
    "ui.panel": {
      sig: "id, spec",
      doc: "creates or updates a panel (same id = same panel; values the person set are kept), shown in your reply",
      run: (ctx, id, spec) => {
        if (!/^[\w-]{1,40}$/.test(id)) throw Object.assign(new Error("panel ids are words: letters, digits, _ or -"), { kind: "invalid" });
        const p = Panels.upsert(ctx.project, id, spec, { by: ctx.who === "agent" ? "agent" : "you", thread: ctx.thread, ws: ctx.ws, pinned: ctx.onPanel ? void 0 : true });
        if (ctx.onPanel) ctx.onPanel(id);
        else setTimeout(() => Dock.open("panels"), 50);
        return { id, shown: ctx.onPanel ? "in your reply" : "in the Panels tab", values: p.values };
      }
    },
    "ui.values": {
      sig: "id",
      doc: "current values, and what the person changed",
      run: (ctx, id) => {
        const p = Panels.get(ctx.project, id);
        if (!p) throw missing2("no panel " + id + ". Panels: " + Panels.list(ctx.project).map((x) => x.id).join(", "));
        return { ...p.values, changed: (p.log || []).filter((l) => l.by === "you").slice(-8).map((l) => l.id + " \u2192 " + JSON.stringify(l.v)) };
      }
    },
    "ui.set": {
      sig: "id, controlId, value",
      run: (ctx, id, cid, value) => {
        const p = Panels.get(ctx.project, id);
        if (!p) throw missing2("no panel " + id);
        Panels.set(ctx.project, p, cid, value, { by: ctx.who });
        return p.values;
      }
    },
    "ui.ask": {
      sig: "id, spec?, {label}?",
      doc: "shows the panel and waits for the person to press Done: its values (Cancel throws kind approval)",
      long: true,
      run: async (ctx, id, spec, o = {}) => {
        if (spec) PANEL_API["ui.panel"].run(ctx, id, spec);
        else if (!Panels.get(ctx.project, id)) throw missing2("no panel " + id + ": pass a spec");
        else if (ctx.onPanel) ctx.onPanel(id);
        const v = await new Promise((resolve) => {
          Panels.waiting.set(id, { resolve, label: o.label });
          App.ev.emit("ask", id);
          if (ctx.signal) ctx.signal.addEventListener("abort", () => resolve(null));
        });
        Panels.waiting.delete(id);
        App.ev.emit("ask", id);
        if (!v) throw Object.assign(new Error("the person cancelled the panel"), { kind: "approval" });
        return v;
      }
    },
    "ui.panels": { sig: "", run: (ctx) => Panels.list(ctx.project).map((p) => ({ id: p.id, title: p.spec.title, values: p.values, pinned: p.pinned, items: p.spec.items.map((i) => i.id ? i.type + " " + i.id : i.type) })) },
    "ui.closePanel": { sig: "id", run: (ctx, id) => {
      Panels.remove(ctx.project, id);
      return true;
    } }
  };
  var PANEL_NOTE = `Panels: small UIs you show in your reply, to let the person tune things live or watch numbers. Keep one small (2\u20136 items).
  controls: { type: 'slider', id, label, min, max, step?, value?, unit? } | { type: 'toggle', id, label } | { type: 'select', id, options: [v | {value, label}] } | { type: 'text', id } | { type: 'color', id }
    bind (optional) previews a control live in every canvas frame; the person presses Keep to write it into the CSS:
      { cssVar: '--menu-scale', unit?: 'px', file?: 'styles.css' } | { style: { selector: '.cats', prop: 'gap' }, unit: 'px' }
      { css: { on: { '--font': '"Courier New", monospace', 'body': { background: '#000' } }, off: { \u2026 } } }: a toggle (or a select, one entry per option value) switching several CSS values at once
    { type: 'button', label, run: "code" } runs as the person, in the workspace being viewed, with \`values\` in scope
  widgets: { type: 'value' | 'chart' | 'table' | 'list' | 'text', label?, from } (charts: kind: 'line' | 'bar'; a text widget may have markdown instead of from)
    from: { sql: "SELECT \u2026", args?, kind?: 'dev' | 'test', where?, count?, sum?: field, group?: field, of?: field } | { docs: coll, the same options } (the instance's data)
          | { issues: true } | { scenarios: true, count? } | { events: kind | true, per?: 'minute' | 'hour' } | { frameEvents: 'click' | 'change' | 'nav' | 'load' | 'console' | 'error' | true, frame?, count?, per? }
          | { frame: frameIdOrRoute, count | text: selector } | { eval: "read-only code; \`values\` in scope" } | { lib: name, args? }
    widgets refresh when what they read changes (an eval source also when a control moves)
  Offer a panel when the person is tuning something visual (sliders bound to CSS variables), or asks to watch numbers.`;

  // src/model/project.js
  var DEFAULT_META = () => ({ boards: [{ id: "b1", title: "Board", frames: [{ id: "f" + uid(), route: "index.html", w: 375, h: 720, x: 0, y: 0 }] }], pins: [], panels: [], runs: {} });
  var Project = class {
    constructor(opened, rec) {
      this.app = opened.app;
      this.id = opened.app;
      this.refs = opened.refs;
      this.instances = opened.instances;
      this.meta = { ...DEFAULT_META(), ...rec.meta || {} };
      this.draft = Drafts.for(this.app, "draft");
      this.proposals = /* @__PURE__ */ new Map();
      this.threads = /* @__PURE__ */ new Map();
      for (const t of rec.threads || []) this.threads.set(t.id, { ...t.meta, id: t.id, created: t.created, updated: t.updated, count: t.count, msgs: null });
      this.events = rec.events || [];
      this.bySeq = new Map(this.events.map((e) => [e.seq, e]));
      this.outbox = [];
      this.ev = emitter();
      this.saveMeta = debounce(() => Records.save("meta|" + this.app, () => Slop.call("saveProject", { app: this.app, meta: this.meta })), 500);
      this.watch(this.draft, "draft");
    }
    get title() {
      try {
        return JSON.parse(this.read("app.json") || "{}").title || this.app;
      } catch (e) {
        return this.app;
      }
    }
    // a Draft's moves and commits, as project events
    watch(d, ws) {
      d.ev.on("head", (n, prev, paths, source) => {
        this.ev.emit("files", ws, paths);
        if (source === "poll" && prev != null) this.log({ kind: "outside", who: "push", ref: d.ref, n, paths: paths.slice(0, 50), note: "changed outside the bench" });
      });
      d.ev.on("commit", (r) => {
        if (r.event) this.addEvent(r.event);
      });
      d.ev.on("edits", (path) => this.ev.emit("files", ws, path ? [path] : []));
      d.ev.on("conflict", () => this.ev.emit("files", ws, []));
    }
    // ---- files, in a workspace ----
    draftOf(ws = "draft") {
      if (ws === "draft") return this.draft;
      const p = this.proposals.get(ws);
      if (!p) throw Object.assign(new Error("no workspace " + ws + " (draft, or an open proposal)"), { kind: "missing" });
      if (!p.draft) {
        p.draft = Drafts.for(this.app, ws);
        this.watch(p.draft, ws);
      }
      return p.draft;
    }
    // the person's view: the head, under their uncommitted edits
    view(ws = "draft") {
      const d = this.draftOf(ws);
      return d.edits || d;
    }
    read(path, ws = "draft") {
      return this.view(ws).read(path);
    }
    entry(path, ws = "draft") {
      return this.view(ws).entry(path);
    }
    list(ws = "draft") {
      return this.view(ws).list();
    }
    write(path, text, ws = "draft") {
      this.draftOf(ws).edit(path, text);
    }
    remove(path, ws = "draft") {
      this.draftOf(ws).edit(path, null);
    }
    // ---- proposals: refs the person reviews, accepts onto draft or rejects ----
    openProposals() {
      return [...this.proposals.values()].filter((p) => p.status === "open");
    }
    async loadProposals() {
      for (const p of await Slop.call("proposals", { app: this.app })) {
        const cur = this.proposals.get(p.ref);
        this.proposals.set(p.ref, { ...p, draft: cur ? cur.draft : null });
      }
      this.ev.emit("proposals");
    }
    async propose({ title, thread }) {
      const r = await Slop.call("propose", { app: this.app, title, thread });
      this.proposals.set(r.ref, { ...r, created: now(), closed: null, draft: null });
      await this.draftOf(r.ref).open();
      this.ev.emit("proposals");
      return this.proposals.get(r.ref);
    }
    // what a proposal changes: {path, before, after, entry} from its base to
    // its head (with the person's edits in it); texts are null for files kept
    // by hash
    async changes(ref) {
      const p = this.proposals.get(ref), d = this.draftOf(ref);
      if (d.head == null) await d.open();
      await d.load(p.base);
      const view = this.view(ref), base = p.base;
      const paths = new Set(d.changed(base, d.head));
      if (d.edits) for (const path of d.edits.changes.keys()) paths.add(path);
      const out = [];
      for (const path of [...paths].sort()) {
        const before = d.entry(path, base), after = view.entry(path);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        out.push({ path, before: before && typeof before.text === "string" ? before.text : null, after: after && typeof after.text === "string" ? after.text : null, existed: !!before, entry: after });
      }
      return out;
    }
    // Commit a proposal's changes (all, or these paths) onto draft over the
    // proposal's base: the server merges them file by file with what reached
    // draft since. The proposal is then closed; changes not taken go with it.
    async accept(ref, paths, who = "you") {
      const p = this.proposals.get(ref), d = this.draftOf(ref);
      await d.settle();
      const all = await this.changes(ref), take = paths ? all.filter((c) => paths.includes(c.path)) : all;
      await this.draft.load(p.base);
      const tx = this.draft.begin({ base: p.base, label: "accept", event: { who, note: 'accepted "' + p.title + '"' + (take.length < all.length ? " (" + take.length + " of " + all.length + " files)" : "") } });
      for (const c of take) {
        if (!c.entry) tx.remove(c.path);
        else if (typeof c.entry.text === "string") tx.write(c.path, c.entry.text);
        else tx.copy(c.path, c.entry);
      }
      const r = await tx.commit();
      if (r.status === "committed") await this.close(ref, "accepted");
      return r;
    }
    async reject(ref) {
      await this.close(ref, "rejected");
    }
    async close(ref, status) {
      const p = this.proposals.get(ref), d = this.draftOf(ref);
      await Slop.call("closeProposal", { app: this.app, ref, status, ifAt: d.head ?? 0 });
      p.status = status;
      p.closed = now();
      Drafts.drop(this.app, ref);
      p.draft = null;
      await this.reloadEvents();
      this.ev.emit("proposals");
    }
    // ---- the timeline ----
    // An event from the page (a message, a mark, an eval, …): shown now,
    // numbered by the server when it is saved. Commits are logged by the
    // server itself (addEvent).
    // A ref's snapshot as the page knows it: its Draft's head, or for a
    // proposal not opened here yet, the snapshot the server last gave for it
    // (its base when new). null: a ref the project does not have.
    headOf(ref) {
      if (ref === "draft") return this.draft.head;
      const p = this.proposals.get(ref);
      return p ? (p.draft && p.draft.head) ?? p.n ?? p.base ?? null : null;
    }
    // An event is on a ref and records that ref's snapshot (stampEvent). One
    // the page cannot stamp is a bug, refused here rather than by the server
    // after it was shown.
    log(e) {
      const st = stampEvent(e, (ref) => this.headOf(ref));
      if (st.n == null) throw new Error("cannot log " + e.kind + " on " + st.ref + ": its snapshot is not known");
      const ev = { ...st, seq: null, at: now(), who: e.who || "you" };
      this.events.push(ev);
      this.outbox.push(ev);
      this.ev.emit("events", ev);
      this.flushEvents();
      return ev;
    }
    flushEvents() {
      if (this.sending || !this.outbox.length) return;
      const batch = this.outbox.splice(0, 100);
      this.sending = Slop.call("logEvents", { app: this.app, events: batch.map((e) => {
        const o = { ...e };
        delete o.seq;
        delete o.at;
        return o;
      }) }).then((saved) => {
        saved.forEach((s, i) => {
          const e = batch[i], known = this.bySeq.get(s.seq);
          if (known && known !== e) {
            this.events.splice(this.events.indexOf(e), 1);
            return;
          }
          for (const k of Object.keys(e)) if (!(k in s)) delete e[k];
          Object.assign(e, s);
          this.bySeq.set(s.seq, e);
        });
        this.sortEvents();
        this.ev.emit("events", null);
      }).catch((e) => {
        Records.error = "the timeline: " + (e.message || e);
        Records.ev.emit("status");
        if (e && e.code === "invalid_argument") {
          for (const x of batch) this.events.splice(this.events.indexOf(x), 1);
          this.ev.emit("events", null);
        } else this.outbox.unshift(...batch);
      }).finally(() => {
        this.sending = null;
        if (this.outbox.length) setTimeout(() => this.flushEvents(), 1e3);
      });
    }
    addEvent(e) {
      if (this.bySeq.has(e.seq)) return;
      this.events.push(e);
      this.bySeq.set(e.seq, e);
      this.sortEvents();
      this.ev.emit("events", e);
    }
    sortEvents() {
      this.events.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
    }
    async reloadEvents() {
      const r = await Slop.call("project", { app: this.app, limit: 2e3 });
      for (const e of r.events) this.addEvent(e);
    }
    event(seq) {
      return this.bySeq.get(seq) || null;
    }
    // A mark is on the workspace it is made in (ref): a diff since it, or a
    // restore to it, is of that workspace.
    mark({ label: label2, note, by = "you", thread, kind, ref = "draft" }) {
      const mk = kind || (by === "agent" ? "milestone" : by === "ide" ? "auto" : "bookmark");
      const e = this.log({ kind: "mark", mk, who: by, ref, label: String(label2 || "Mark").slice(0, 80), note, thread });
      this.ev.emit("marks");
      return e;
    }
    marks() {
      return this.events.filter((e) => e.kind === "mark");
    }
    // ---- threads: settings and summary in the thread row, messages apart ----
    newThread(title, fields = {}) {
      const t = { id: "th" + uid(), title: title || "Thread " + (this.threads.size + 1), created: now(), mode: "auto", target: "proposal", tier: "default", ...fields, msgs: [] };
      this.threads.set(t.id, t);
      this.saveThread(t);
      this.ev.emit("threads");
      return t;
    }
    async loadThread(id) {
      const t = this.threads.get(id);
      if (!t) throw Object.assign(new Error("no thread " + id), { kind: "missing" });
      if (t.msgs) return t;
      const r = await Slop.call("thread", { id });
      t.msgs = r.messages;
      t.saved = t.msgs.map((m) => JSON.stringify(m));
      return t;
    }
    // Saves the thread's fields and the messages from the first that changed
    // since the last save (a reply grows while a turn runs).
    saveThread(t) {
      if (!t.msgs) return;
      Records.save("thread|" + t.id, async () => {
        const cur = t.msgs.map((m) => JSON.stringify(m)), was = t.saved || [];
        let from = 0;
        while (from < cur.length && from < was.length && cur[from] === was[from]) from++;
        const meta = { ...t };
        for (const k of ["id", "msgs", "saved", "count", "created", "updated"]) delete meta[k];
        const changed2 = from < cur.length || cur.length < was.length;
        await Slop.call("saveThread", { id: t.id, app: this.app, meta, ...changed2 ? { from: from + 1, messages: cur.slice(from).map((m) => JSON.parse(m)) } : {} });
        t.saved = cur;
      });
    }
    dropThread(id) {
      this.threads.delete(id);
      Records.save("thread|" + id, () => Slop.call("dropThread", { id }));
      this.ev.emit("threads");
    }
    // ---- the canvas ----
    board() {
      return this.meta.boards[0];
    }
    frame(id) {
      return this.board().frames.find((f) => f.id === id);
    }
    addFrame(f) {
      const b = this.board(), right = b.frames.reduce((m, x) => Math.max(m, x.x + x.w), 0);
      const fr = { id: "f" + uid(), route: f.route || "index.html", w: f.w || 375, h: f.h || 720, x: f.x ?? (b.frames.length ? right + 60 : 0), y: f.y ?? 0 };
      b.frames.push(fr);
      this.saveMeta();
      this.ev.emit("frames");
      return fr;
    }
    removeFrame(id) {
      const b = this.board();
      b.frames = b.frames.filter((f) => f.id !== id);
      this.saveMeta();
      this.ev.emit("frames");
    }
  };
  var Projects = {
    recent() {
      return Prefs.get("recent", []);
    },
    touch(app) {
      Prefs.set("recent", [app, ...this.recent().filter((a) => a !== app)].slice(0, 12));
    },
    async open(app) {
      const [opened, rec] = await Promise.all([Slop.call("open", { app }), Slop.call("project", { app, limit: 2e3 })]);
      const P = new Project(opened, rec);
      await P.draft.open();
      await P.loadProposals();
      if (!rec.meta) P.saveMeta();
      this.touch(app);
      return P;
    },
    // a new app store from a template, on draft
    async create({ id, title, template = "blank" }) {
      const t = APP_TEMPLATES.find((x) => x.id === template) || APP_TEMPLATES[0];
      const files2 = Object.entries(t.files({ id, title: title || id })).map(([path, text]) => ({ path, text }));
      const r = await Slop.call("create", { id, type: t.type ? t.type(id) : "", files: files2 });
      await Slop.refresh();
      return r;
    },
    async forget(app) {
      await Slop.call("forget", { app });
      Prefs.set("recent", this.recent().filter((a) => a !== app));
    }
  };

  // src/ui/archive.js
  var CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 4294967295;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  async function viaStream(u8, stream) {
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function deflateRaw(u8) {
    try {
      return typeof CompressionStream === "undefined" ? null : await viaStream(u8, new CompressionStream("deflate-raw"));
    } catch {
      return null;
    }
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot unzip compressed files");
    return viaStream(u8, new DecompressionStream("deflate-raw"));
  }
  async function makeZip(entries) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = /* @__PURE__ */ new Date(), dt = (d.getFullYear() - 1980 << 25 | d.getMonth() + 1 << 21 | d.getDate() << 16 | d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1) >>> 0;
    let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
      const crc = crc32(raw);
      let body = raw, method = 0;
      if (raw.length > 128) {
        const z = await deflateRaw(raw);
        if (z && z.length < raw.length) {
          body = z;
          method = 8;
        }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 67324752, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 2048, true);
      lh.setUint16(8, method, true);
      lh.setUint32(10, dt, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 33639248, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 2048, true);
      ch.setUint16(10, method, true);
      ch.setUint32(12, dt, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + body.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 101010256, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  async function readZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 101010256) e--;
    if (e < 0) throw new Error("not a zip file");
    const n = dv.getUint16(e + 10, true), dec = new TextDecoder(), out = [];
    let p = dv.getUint32(e + 16, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 33639248) throw new Error("damaged zip directory");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith("/") || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), body = u8.subarray(start, start + csize);
      if (method === 0) out.push({ name, data: body });
      else if (method === 8) out.push({ name, data: await inflateRaw(body) });
    }
    return out;
  }
  var fence = (text, lang = "") => {
    const run = Math.max(2, ...(String(text).match(/`+/g) || []).map((s) => s.length)) + 1;
    const f = "`".repeat(run);
    return f + lang + "\n" + text + "\n" + f;
  };
  var slug = (s) => String(s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "untitled";
  var stamp = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 19);
  function transcriptMd(P, th) {
    const out = ["# " + th.title, "", "App: " + P.app + " \xB7 thread started " + stamp(th.created) + " \xB7 exported " + stamp(now()), "Mode: " + (th.mode || "auto") + " \xB7 commits to: " + (th.target === "draft" ? "draft" : "proposals") + " \xB7 model: " + (th.model || th.tier || "default"), ""];
    if (th.summary) out.push("> **Summary Claude sees in place of messages 1\u2013" + th.summary.upTo + "** (" + (th.summary.by === "you" ? "edited by you" : th.summary.by === "fallback" ? "listed without a model" : "by Claude") + ", " + stamp(th.summary.t) + ")", ">", ...th.summary.text.split("\n").map((l) => "> " + l), "");
    for (const [i, m] of th.msgs.entries()) {
      if (th.summary && i === th.summary.upTo) out.push("---", "", "*Claude sees the messages from here on in full; the ones above are summarized.*", "");
      out.push("---", "");
      if (m.role === "user") {
        out.push("## You \xB7 " + stamp(m.t), "");
        const ctx = [m.ctx && m.ctx.sel ? "selected " + m.ctx.sel.tag + " at " + m.ctx.sel.src : "", m.ctx && m.ctx.pins ? plural(m.ctx.pins, "open pin") : ""].filter(Boolean);
        if (ctx.length) out.push("> context: " + ctx.join(" \xB7 "), "");
        out.push(m.text, "");
        continue;
      }
      out.push("## Claude \xB7 " + stamp(m.t) + (m.model ? " \xB7 " + m.model : ""), "");
      (m.steps || []).forEach((s, i2) => {
        out.push("### eval " + (i2 + 1) + " \xB7 " + (s.status || "?") + (s.ms != null ? " \xB7 " + s.ms + " ms" : "") + (s.calls && s.calls.length ? " \xB7 " + [...new Set(s.calls)].join(", ") : ""), "", fence(s.code, "js"), "");
        if (s.logs && s.logs.length) out.push("Logs:", "", fence(s.logs.join("\n")), "");
        if (s.out) out.push("Result:", "", fence(s.out, s.fmt || (s.status === "ok" ? "json" : "")), "");
      });
      if (m.text) out.push(m.text, "");
      if (m.error) out.push("> " + m.error, "");
      if (m.summary) out.push("_" + m.summary + "_", "");
    }
    return out.join("\n");
  }
  function timelineMd(P) {
    const who = (e) => e.who === "agent" ? "Claude" + (P.threads.get(e.thread) ? " (" + P.threads.get(e.thread).title + ")" : "") : e.who === "push" ? "outside" : e.who === "ide" ? "bench" : "you";
    const what = (e) => e.kind === "commit" ? "committed " + (e.paths || []).map((p) => "`" + p + "`").join(", ") : e.kind === "mark" ? "**" + (e.mk || "mark") + ": " + e.label + "**" + (e.note ? " (" + e.note + ")" : "") : e.kind === "eval" ? "eval" + (e.calls && e.calls.length ? ": " + e.calls.join(", ") : "") : e.kind;
    const out = ["# Timeline: " + P.app, "", "| seq | Time | Who | What | Where | Note |", "|---|---|---|---|---|---|"];
    for (const e of P.events) out.push("| " + (e.seq ?? "") + " | " + stamp(e.at) + " | " + who(e) + " | " + what(e).replace(/\|/g, "/") + " | " + (e.ref || "draft") + (e.n != null ? " " + e.n : "") + " | " + String(e.note || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 140) + " |");
    return out.join("\n") + "\n";
  }
  async function appZip(P) {
    const E = [], add = (name, data) => E.push({ name, data: typeof data === "string" ? data : JSON.stringify(data, null, 1) });
    const paths = P.list("draft"), hashed = paths.filter((p) => P.read(p, "draft") === null);
    for (const path of paths) {
      const t = P.read(path, "draft");
      if (t !== null) add("files/" + path, t);
    }
    for (const p of P.openProposals()) {
      const ch = await P.changes(p.ref).catch(() => []);
      add("proposals/" + p.ref.slice(9) + ".json", { ref: p.ref, title: p.title, base: p.base, thread: p.thread, changes: ch.map((c) => ({ path: c.path, removed: !c.entry })) });
      for (const c of ch) if (c.after !== null) add("proposals/" + p.ref.slice(9) + "/" + c.path, c.after);
    }
    let k = 0;
    for (const th of [...P.threads.values()].sort((a, b) => a.created - b.created)) {
      await P.loadThread(th.id).catch(() => null);
      if (!th.msgs) continue;
      k++;
      add("threads/" + th.id + ".json", { ...th, saved: void 0 });
      add("transcripts/" + String(k).padStart(2, "0") + "-" + slug(th.title) + ".md", transcriptMd(P, th));
    }
    add("project.json", P.meta);
    add("timeline.json", P.events);
    add("timeline.md", timelineMd(P));
    add("bench.json", {
      bench: 3,
      app: P.app,
      title: P.title,
      exported: now(),
      refs: P.refs,
      draft: P.draft.head,
      counts: { files: paths.length, proposals: P.openProposals().length, threads: k, events: P.events.length },
      keptByHash: hashed,
      layout: "files/ = draft (text files; keptByHash lists the others). proposals/ = open proposals, their changed files. threads/ + transcripts/ = agent threads. timeline.* = the session log."
    });
    return makeZip(E);
  }
  var TEXT_EXT = /\.(html?|css|js|mjs|json|md|markdown|svg|txt|xml|csv|sql)$/i;
  async function readArchive(buf, filename = "import") {
    const head = new Uint8Array(buf.slice ? buf.slice(0, 4) : buf);
    if (!(head[0] === 80 && head[1] === 75)) throw new Error(filename + " is not a zip");
    const entries = await readZip(buf), dec = new TextDecoder();
    const manifest = entries.find((e) => /(^|\/)bench\.json$/.test(e.name));
    if (manifest) {
      const root = manifest.name.slice(0, -"bench.json".length) + "files/";
      return entries.filter((e) => e.name.startsWith(root) && e.name.length > root.length).map((e) => ({ path: e.name.slice(root.length), text: dec.decode(e.data) })).filter((f) => !checkPath(f.path));
    }
    const texts = entries.filter((e) => TEXT_EXT.test(e.name) && e.data.length < 24e4);
    if (!texts.length) throw new Error("no text files (html, css, js, md, sql\u2026) in that zip");
    const tops = new Set(texts.map((e) => e.name.includes("/") ? e.name.split("/")[0] + "/" : ""));
    const strip = tops.size === 1 && [...tops][0] ? [...tops][0] : "";
    return texts.map((e) => ({ path: e.name.slice(strip.length), text: dec.decode(e.data) })).filter((f) => !checkPath(f.path));
  }
  async function saveFile(filename, data) {
    let dl = null;
    try {
      dl = window.claude && await window.claude.use("downloads");
    } catch {
    }
    if (dl) {
      try {
        await dl.save({ filename, data });
        toast("Saved " + filename);
        return true;
      } catch (e) {
        if (e && e.code === "declined") return false;
        if (e && !["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(e.code)) {
          toast("Download failed: " + (e.message || e.code));
          return false;
        }
      }
    }
    const blob = data instanceof Blob ? data : new Blob([data]), url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename, style: { display: "none" } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3e4);
    toast("Downloading " + filename);
    return true;
  }

  // src/ui/app.js
  var App = {
    P: null,
    ws: "draft",
    mode: "select",
    sel: null,
    logs: [],
    ev: emitter(),
    prefs: {},
    canvas: null,
    offs: [],
    traceTarget: null,
    // set by views when they are made: what other views may ask of them
    code: null,
    docs: null,
    agentView: null,
    timeline: null,
    // ---- queries ----
    health() {
      let n = 0;
      for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) n += fh.issues.length + fh.errors;
      if (Watch.status && Watch.status.dev && Watch.status.dev.broken) n++;
      return n + this.typeErrors.length;
    },
    // the type checker's errors in the workspace shown (the Code view keeps them: ui/code.js)
    typeErrors: [],
    setTypeErrors(diags) {
      this.typeErrors = diags || [];
      this.ev.emit("health");
      this.paintHeader();
    },
    hostFor(fid) {
      return this.canvas ? this.canvas.hostFor(fid) : null;
    },
    hostByFid(fid) {
      for (const fh of FrameHosts) if (fh.fid === fid) return fh;
      return null;
    },
    firstHost() {
      for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) return fh;
      return null;
    },
    pinsFor(route) {
      return this.P ? (this.P.meta.pins || []).filter((p) => p.route === route) : [];
    },
    proposal(ws = this.ws) {
      return this.P && ws !== "draft" ? this.P.proposals.get(ws) || null : null;
    },
    // ---- selection, pins, text edits ----
    // outline, in every frame, the elements a source line or CSS rule renders; resolves to how many, in how many frames
    async trace(target) {
      this.traceTarget = target || null;
      let elements = 0, frames = 0;
      await Promise.all([...FrameHosts].filter((fh) => !fh.headless && fh.project === this.P && fh.ready).map(async (fh) => {
        try {
          const r = await fh.call("trace", [target || null], 1500);
          if (r && r.count) {
            elements += r.count;
            frames++;
          }
        } catch {
        }
      }));
      return target ? { elements, frames, selector: target.selector || null } : null;
    },
    select(info2) {
      if (this.traceTarget) this.trace(null);
      this.sel = info2;
      this.ev.emit("sel", info2);
      if (this.canvas) this.canvas.paintAll();
      if (!Dock.visible("inspector") && !Dock.visible("code")) Dock.open("inspector");
    },
    placePin(host, m) {
      if (this.canvas) this.canvas.newPin(host, m);
    },
    openPin(id, host) {
      if (this.canvas) this.canvas.showPin(id, host);
    },
    // the person edited a text on the canvas: find it near its source line and replace it
    textEdit(host, m) {
      const [file, line] = (m.src || "").split(":"), P = this.P, text = P.read(file, host.ws);
      if (text == null) return;
      const off = offsetOfLine(text, +line), old = m.old.trim(), next = m.text.trim();
      const esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      for (const cand of [old, esc2(old), old.replace(/&/g, "&amp;")]) {
        const i = text.indexOf(cand, off);
        if (i >= 0 && i - off < 4e3) {
          P.write(file, text.slice(0, i) + esc2(next) + text.slice(i + cand.length), host.ws);
          toast("Text updated in " + file + ":" + lineOf(text, i));
          return;
        }
      }
      toast("Could not find that text in " + file + " (it may come from a script). Edit it in Code.");
      host.load();
    },
    consoleAdd(l) {
      this.logs.push(l);
      if (this.logs.length > 1e3) this.logs.splice(0, 200);
      this.ev.emit("log", l);
    },
    askAgent(text) {
      Dock.open("agent");
      setTimeout(() => this.agentView && this.agentView.compose(text), 30);
    },
    showThread(tid) {
      Dock.open("agent");
      if (this.agentView && this.P.threads.get(tid)) this.agentView.open(tid);
    },
    viewVersion(path, seq) {
      Dock.open("code");
      setTimeout(() => this.code && this.code.showVersion(path, seq), 20);
    },
    openDoc(path) {
      Dock.open("docs");
      setTimeout(() => this.docs && this.docs.open(path), 20);
    },
    reveal(file, line) {
      if (this.ws !== "draft" && this.P.read(file, this.ws) === null && this.P.read(file, "draft") !== null) this.setWs("draft");
      Dock.open("code");
      setTimeout(() => this.code && this.code.open(file, line), 20);
    },
    compare(on) {
      if (this.canvas) {
        this.canvas.compare = on && this.ws !== "draft";
        this.canvas.sync();
      }
      this.paintHeader();
    },
    async addMark() {
      if (!this.P) return;
      const label2 = await promptBox("Add a mark", "A label for this point in the session", "Checkpoint " + (this.P.marks().length + 1));
      if (label2) {
        this.P.mark({ label: label2, by: "you", ref: this.ws });
        toast("Marked");
      }
    },
    // ---- workspace and mode ----
    setWs(ws) {
      if (ws !== "draft" && (!this.proposal(ws) || this.proposal(ws).status !== "open")) ws = "draft";
      this.ws = ws;
      if (this.P) Prefs.set("ws|" + this.P.app, ws);
      if (ws === "draft" && this.canvas) this.canvas.compare = false;
      this.ev.emit("ws", ws);
      if (this.canvas) this.canvas.sync();
      this.paintHeader();
    },
    async newProposal() {
      const t = await promptBox("New proposal", "A copy of draft you edit and then accept onto it (or reject)", "My change " + (this.P.proposals.size + 1));
      if (!t) return;
      try {
        const p = await this.P.propose({ title: t });
        this.setWs(p.ref);
      } catch (e) {
        toast("Could not make a proposal: " + (e.message || e), 5e3);
      }
    },
    setMode(m) {
      this.mode = m;
      for (const fh of FrameHosts) if (!fh.headless) fh.push({ push: "mode", mode: m });
      if (this.canvas) this.canvas.paintAll();
      this.paintHeader();
      this.savePrefs();
    },
    // ---- preferences (this viewer's) ----
    savePrefs: debounce(function() {
      Prefs.set("prefs", { theme: App.prefs.theme || "auto", layout: Dock.layout, floats: Dock.floats, layouts: App.prefs.layouts || {}, mode: App.mode });
    }, 800),
    theme(t) {
      this.prefs.theme = t;
      if (t === "auto") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      this.savePrefs();
    },
    // ---- opening an app ----
    async openProject(app) {
      let P;
      try {
        P = await Projects.open(app);
      } catch (e) {
        toast("Could not open " + app + ": " + (e.message || e), 5e3);
        return false;
      }
      if (this.P) await this.P.draft.settle().catch(() => {
      });
      this.offs.forEach((f) => f());
      this.offs = [];
      if (this.canvas) this.canvas.reset();
      Headless.clear();
      this.P = P;
      this.ws = "draft";
      this.sel = null;
      this.logs = [];
      this.typeErrors = [];
      this.offs.push(
        P.ev.on("files", (ws, paths) => {
          this.ev.emit("files", ws, paths);
          this.paintHeader();
        }),
        P.ev.on("proposals", () => {
          if (this.ws !== "draft" && (this.proposal() || {}).status !== "open") this.setWs("draft");
          Headless.prune(P, (ref) => (P.proposals.get(ref) || {}).status === "open");
          this.ev.emit("proposals");
          this.paintHeader();
          if (this.canvas) this.canvas.sync();
        }),
        P.ev.on("frames", () => {
          if (this.canvas) this.canvas.sync();
        }),
        P.ev.on("events", (e) => this.ev.emit("events", e)),
        P.ev.on("marks", () => this.ev.emit("events")),
        P.ev.on("threads", () => this.ev.emit("threads")),
        P.ev.on("pins", () => this.ev.emit("pins")),
        this.ev.on("pins", () => {
          for (const fh of FrameHosts) if (!fh.headless && fh.project === P) fh.push({ push: "pins", pins: this.pinsFor(fh.route) });
        }),
        this.ev.on("health", () => {
          this.paintHeader();
          Dock.refreshTabs();
        }),
        ...this.autoMarks(P)
      );
      Watch.start(P);
      Snaps.open(P).catch(() => {
      });
      const head = headView(P.draftOf("draft"));
      if (Types.wants(head)) Types.check(P, head, { timeoutMs: 3e4 }).catch(() => {
      });
      this.ev.emit("project", P);
      const was = Prefs.get("ws|" + P.app, "draft");
      if (was !== "draft" && (P.proposals.get(was) || {}).status === "open") this.setWs(was);
      if (this.canvas) this.canvas.sync();
      this.paintHeader();
      return true;
    },
    // marks the bench adds by itself: every check passing again, the first error
    autoMarks(P) {
      const t0 = now();
      let prev = null, errState = false;
      const settled = () => now() - t0 > 4e3 && this.P === P;
      const hosts = () => [...FrameHosts].filter((fh) => !fh.headless && fh.project === P);
      const check = debounce(() => {
        if (hosts().some((fh) => fh.loading)) return check();
        const n = this.health(), errs = hosts().reduce((s, fh) => s + fh.errors, 0);
        if (settled() && prev > 0 && n === 0) P.mark({ label: "All checks pass", by: "ide", kind: "auto" });
        if (!errs) errState = false;
        prev = n;
      }, 1200);
      return [this.ev.on("health", check), this.ev.on("log", (l) => {
        if (l.level !== "error" || errState || !settled()) return;
        errState = true;
        P.mark({ label: "First error: " + l.text.slice(0, 60), note: l.frame + (l.src ? " @" + l.src : ""), by: "ide", kind: "auto" });
      })];
    },
    // ---- apps: new, import, forget, download ----
    newAppDialog(files2) {
      let pick = APP_TEMPLATES[0].id;
      const id = h("input.txt", { value: "", placeholder: "id: lowercase letters, digits and -", style: { width: "100%" } });
      const title = h("input.txt", { value: "", placeholder: "Title (optional)", style: { width: "100%" } });
      const cards = h("div.tcards"), who = h("div");
      Slop.call("me", {}).then((me) => {
        if (me && !me.canBuild) who.append(h("p.note", { style: { color: "var(--accent)" } }, "Only this server's administrators can create or change apps. You can use the apps you have access to; ask an administrator to create one for you."));
      }).catch(() => {
      });
      const paint = () => {
        clear(cards);
        for (const t of APP_TEMPLATES) cards.appendChild(h("button" + (t.id === pick ? ".on" : ""), { on: { click: () => {
          pick = t.id;
          paint();
        } } }, h("b", t.name), h("small", t.blurb)));
      };
      const go = async () => {
        const v = id.value.trim();
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) {
          toast("The id is a store id: lowercase letters, digits and -, at most 63");
          return false;
        }
        try {
          if (files2) {
            await Slop.call("create", { id: v, type: "", files: files2 });
            await Slop.refresh();
          } else await Projects.create({ id: v, title: title.value.trim() || v, template: pick });
          await this.openProject(v);
          toast("New app " + v + " (on draft; publish to make it visible)");
        } catch (e) {
          toast("Could not create " + v + ": " + (e.message || e), 5e3);
          return false;
        }
      };
      if (!files2) paint();
      modal({
        title: files2 ? "Import as a new app" : "New app",
        body: [who, h("p.note", files2 ? plural(files2.length, "file") + " go to the new app's draft." : "A new app. Your changes stay private (its draft) until you publish it."), files2 ? null : cards, id, files2 ? null : title],
        actions: [{ label: "Cancel" }, { label: "Create", primary: true, run: go }]
      });
      setTimeout(() => id.focus(), 0);
    },
    async forget() {
      const P = this.P;
      if (!await confirmBox("Forget " + P.app + " here?", "The bench forgets its threads, timeline, boards and snapshots for this app. The app store, its files, refs and instances stay as they are.", "Forget")) return;
      await Projects.forget(P.app);
      const next = Projects.recent()[0] || (Slop.apps[0] || {}).id;
      if (next) await this.openProject(next);
      toast("Forgot " + P.app);
    },
    async downloadProject() {
      toast("Packing " + this.P.app + "\u2026");
      try {
        await saveFile(slug(this.P.app) + ".bench.zip", await appZip(this.P));
      } catch (e) {
        toast("Could not build the zip: " + e.message);
      }
    },
    async importFile(file) {
      try {
        const files2 = await readArchive(await file.arrayBuffer(), file.name || "import");
        this.newAppDialog(files2);
        return true;
      } catch (e) {
        toast("Import failed: " + e.message, 5e3);
        return false;
      }
    },
    importDialog() {
      const input = h("input", { type: "file", accept: ".zip,application/zip", style: { display: "none" }, on: { change: async () => {
        if (input.files[0] && await this.importFile(input.files[0])) m.close();
      } } });
      const drop = h(
        "div",
        { style: { border: "1px dashed var(--ink-2)", padding: "28px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" } },
        h("b", "Drop a .zip here"),
        h("span.note", "A bench download, or any zip of an app's files: its text files become a new app's draft."),
        h("button.btn", { on: { click: () => input.click() } }, "Choose a file\u2026"),
        input
      );
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.style.borderColor = "var(--accent)";
      });
      drop.addEventListener("dragleave", () => {
        drop.style.borderColor = "";
      });
      drop.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const f = e.dataTransfer.files[0];
        if (f && await this.importFile(f)) m.close();
      });
      const m = modal({ title: "Import an app", body: [drop], actions: [{ label: "Close" }] });
    },
    // dropping a zip anywhere on the workbench imports it
    dropImport() {
      let depth = 0;
      const hint = h("div.drop-hint", { hidden: true, style: { inset: "8px" } }, h("span", "Drop to import as a new app"));
      document.body.appendChild(hint);
      const files2 = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
      addEventListener("dragenter", (e) => {
        if (!files2(e) || $(".modal")) return;
        depth++;
        hint.hidden = false;
        document.body.classList.add("moving");
      });
      addEventListener("dragleave", (e) => {
        if (!files2(e)) return;
        if (--depth <= 0) {
          depth = 0;
          hint.hidden = true;
          document.body.classList.remove("moving");
        }
      });
      addEventListener("dragover", (e) => {
        if (files2(e)) e.preventDefault();
      });
      addEventListener("drop", (e) => {
        if (!files2(e)) return;
        e.preventDefault();
        depth = 0;
        hint.hidden = true;
        document.body.classList.remove("moving");
        if ($(".modal")) return;
        const f = e.dataTransfer.files[0];
        if (f && /\.zip$/i.test(f.name)) this.importFile(f);
        else if (f) toast("Drop a .zip of an app");
      });
    },
    // ---- publishing ----
    async publishDialog() {
      const P = this.P;
      let pf;
      try {
        pf = await Publish.preflight(P);
      } catch (e) {
        toast("Could not check " + P.app + ": " + (e.message || e), 5e3);
        return;
      }
      const nothing = pf.refs.draft === pf.refs.main, blocked = pf.blockers.length > 0;
      const lines = Publish.lines(pf).map((l) => h("div", { style: { margin: "2px 0", color: /^BLOCKED/.test(l) ? "var(--bad, #c00)" : "" } }, l));
      modal({
        title: "Publish " + P.app,
        wide: true,
        body: [h("p.note", "Publishing moves main to this draft. Production instances run it on their next view; a migration runs on each. You can roll back."), h("div.mono", { style: { fontSize: "12px" } }, lines)],
        actions: [{ label: "Cancel" }, ...nothing || blocked ? [] : [{
          label: "Publish draft " + pf.refs.draft,
          primary: true,
          run: async () => {
            try {
              const r = await Publish.run(P, pf);
              toast("Published draft " + r.n + " to main");
              this.rolloutDialog(r.n, r.from);
            } catch (e) {
              toast("Not published: " + (e.message || e), 6e3);
            }
          }
        }]]
      });
    },
    async rolloutDialog(n, from) {
      const P = this.P;
      let pf;
      try {
        pf = await Slop.call("preflight", { app: P.app });
      } catch (e) {
        return;
      }
      const list = h("div.mono", { style: { fontSize: "12px" } });
      const paint = (rows) => {
        clear(list);
        for (const x of rows) {
          list.append(h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", margin: "3px 0" } },
            h("span", { style: { flex: 1 } }, x.store + " @" + x.n + (x.broken ? " \xB7 broken: " + x.broken.slice(0, 80) : x.n === n ? " \xB7 on " + n : " \xB7 activates on its next view")),
            x.n === n ? null : h("button.btn.sm", { on: { click: async () => {
              try {
                Object.assign(x, await Slop.call("activate", { store: x.store }));
                paint(rows);
              } catch (e) {
                toast(e.message || String(e));
              }
            } } }, "Activate now")
          ));
        }
      };
      paint(pf.production);
      if (!pf.production.length) list.append(h("div.note", "No other copy of the app follows main."));
      const where = h("div", h("p.note", "Looking up where the app is on the web\u2026"));
      Slop.call("addresses", { app: P.app }).then((r) => {
        clear(where);
        const live = (urls) => h("p", h("b", "Your app is live at: "), ...urls.map((u, i) => [i ? ", " : "", h("a", { href: u.url, target: "_blank", rel: "noopener" }, u.url)]));
        if (r.urls.length) {
          where.append(live(r.urls));
          return;
        }
        const none = h("p", h("b", "Your app is published, but it has no web address yet. "), "An administrator of this server gives it one; ask them, and the link will show here.");
        where.append(none);
        Slop.call("me", {}).then((me) => {
          if (!me || !me.canBuild) return;
          clear(none);
          none.append(h("b", "Your app is published, but it has no web address yet. "));
          const btn = h("button.btn.sm.primary", { on: { click: async () => {
            btn.disabled = true;
            try {
              const m = await Slop.call("putOnline", { app: P.app });
              clear(where);
              where.append(live([{ url: m.url }]));
            } catch (e) {
              btn.disabled = false;
              toast("No address: " + (e.message || e), 6e3);
            }
          } } }, "Give it a web address (/" + P.app + ")");
          none.append(btn);
        }).catch(() => {
        });
      }).catch(() => {
        clear(where);
      });
      modal({
        title: "Published draft " + n,
        wide: true,
        body: [where, h("p.note", "Instances that follow main:"), list],
        actions: [{ label: from ? "Roll back to " + from : "Close", danger: !!from, run: async () => {
          if (!from) return;
          try {
            await Publish.rollback(P, from, n);
            toast("main is back at " + from);
          } catch (e) {
            toast("Not rolled back: " + (e.message || e), 6e3);
          }
        } }, ...from ? [{ label: "Done", primary: true }] : []]
      });
    },
    // the dev instance's data changed under the frames (a seed): show it
    reloadDev() {
      for (const fh of FrameHosts) if (fh.project === this.P && fh.kind === "dev") fh.load({ keepState: true });
    },
    async resetDev() {
      const P = this.P;
      if (!await confirmBox("Reset dev data?", "Your dev instance of " + P.app + " and its data are dropped, and a fresh one runs draft. The app and its other instances are not touched.", "Reset")) return;
      try {
        await Instances.reset(P, "dev");
      } catch (e) {
        toast("Could not reset: " + (e.message || e), 5e3);
        return;
      }
      for (const fh of FrameHosts) if (fh.project === P && fh.kind === "dev") fh.load({ keepState: false });
      toast("A fresh dev instance of " + P.app);
    },
    // ---- header ----
    header() {
      this.hdr = {
        proj: h("button.projbtn", { on: { click: (e) => this.projectMenu(e.currentTarget) } }),
        ws: h("button.wsbtn", { title: "Workspace: draft, or a proposal on top of it", on: { click: (e) => this.wsMenu(e.currentTarget) } }),
        modes: h("div.seg.modes", [["select", "Select", "V"], ["play", "Play", "P"], ["comment", "Comment", "C"]].map(([m, l, k]) => h("button", { "data-m": m, title: l + " (" + k + ")", on: { click: () => this.setMode(m) } }, l))),
        health: h("button.pill", { title: "Layout, contrast and a11y checks, plus page errors", on: { click: (e) => this.healthMenu(e.currentTarget) } }),
        agent: h("button.pill.hide-s", { title: "Claude", on: { click: () => Dock.open("agent") } }),
        store: h("button.pill.hide-s", { on: { click: () => {
          if (this.P) this.P.draft.settle();
          Watch.poll();
        } } }),
        publish: h("button.btn.primary", { title: "Publish draft to main: what people use", on: { click: () => this.publishDialog() } }, "Publish")
      };
      const H = this.hdr;
      return h(
        "header.bar",
        h("div.brand", "Bench", h("i", "slop app workbench")),
        h("div.rel", H.proj),
        h("div.rel", H.ws),
        H.modes,
        h("span.sp"),
        h("div.rel", H.health),
        H.agent,
        H.store,
        H.publish,
        h("button.btn.hide-s", { title: "Bookmark this moment on the timeline", on: { click: () => this.addMark() } }, "+ Mark"),
        h("div.rel", h("button.btn", { on: { click: (e) => this.layoutMenu(e.currentTarget) } }, "Layout")),
        h("button.ibtn", { title: "Theme", on: { click: () => this.theme({ auto: "dark", dark: "light", light: "auto" }[this.prefs.theme || "auto"]) } }, "\u25D0")
      );
    },
    paintHeader() {
      const H = this.hdr;
      if (!H || !this.P) return;
      const P = this.P, prop = this.proposal();
      clear(H.proj).append(h("span.ptitle", P.title), h("span.pcode", P.app), h("span.caret", "\u25BE"));
      put(clear(H.ws), h("span.dot" + (prop ? ".busy" : ".ok")), prop ? "Proposal: " + (prop.title.length > 24 ? prop.title.slice(0, 24) + "\u2026" : prop.title) : "draft", h("span.caret", "\u25BE"));
      for (const b of H.modes.children) b.classList.toggle("on", b.dataset.m === this.mode);
      const n = this.health();
      H.health.className = "pill" + (n ? " bad" : "");
      clear(H.health).append(h("b", String(n)), h("span", n === 1 ? "issue" : "issues"));
      const busy = Agent.anyBusy();
      H.agent.className = "pill hide-s" + (busy ? " busy" : "");
      clear(H.agent).append(h("b", busy ? "Working" : Agent.sample ? "Idle" : Agent.ready ? "Off" : "\u2026"), h("span", "Claude"));
      const l = Watch.label(P), saving = Records.status;
      H.store.title = "App store " + P.app + ": your edits commit to its draft" + (l.title ? " \xB7 " + l.title : "") + (saving === "error" ? " \xB7 saving failed: " + Records.error : "") + " (click to commit now)";
      H.store.className = "pill hide-s" + (l.bad || saving === "error" ? " bad" : "");
      clear(H.store).append(h("b", l.edits || l.draft), h("span", l.dev || "no dev instance"));
    },
    projectMenu(btn) {
      const recent = Projects.recent(), items = [{ group: "Recent" }];
      for (const id of recent) {
        const a = Slop.app(id);
        items.push({ label: id, sub: a ? [a.refs.draft != null ? "draft " + a.refs.draft : "", a.refs.main != null ? "main " + a.refs.main : "not published"].filter(Boolean).join(" \xB7 ") : "", on: this.P && id === this.P.app, run: () => {
          if (!this.P || id !== this.P.app) this.openProject(id);
        } });
      }
      items.push({ group: "Apps on this server" });
      const apps = Slop.apps.filter((a) => !recent.includes(a.id));
      for (const a of apps.slice(0, 30)) items.push({ label: a.id, sub: [a.refs.draft != null ? "draft " + a.refs.draft : "", a.refs.main != null ? "main " + a.refs.main : "not published", plural(a.instances.length, "instance")].filter(Boolean).join(" \xB7 "), run: () => this.openProject(a.id) });
      if (!apps.length) items.push({ note: Slop.error || "Every app you can develop is listed above." });
      items.push({ hr: true }, { label: "New app\u2026", sub: "an app store from a template, on draft", run: () => this.newAppDialog() }, { label: "Import app\u2026", sub: "a .zip of an app's files", run: () => this.importDialog() });
      if (this.P) {
        items.push(
          { hr: true },
          { label: "Download " + this.P.app, sub: ".zip of draft, with transcripts and the timeline", run: () => this.downloadProject() },
          { label: "Reset dev data\u2026", sub: "drop your dev instance and start a fresh one", run: () => this.resetDev() },
          { label: "Forget " + this.P.app + " here\u2026", danger: true, run: () => this.forget() }
        );
      }
      popMenu(btn, items);
    },
    wsMenu(btn) {
      const P = this.P, items = [{ group: "Workspace" }, { label: "draft", sub: "where the app is developed (draft " + (P.draft.head ?? "\u2013") + ")", on: this.ws === "draft", run: () => this.setWs("draft") }];
      for (const p of P.openProposals()) items.push({ label: p.title, sub: p.ref + (p.thread && P.threads.get(p.thread) ? " \xB7 " + P.threads.get(p.thread).title : ""), on: this.ws === p.ref, run: () => this.setWs(p.ref) });
      items.push({ hr: true }, { label: "New proposal\u2026", sub: "edit in a copy of draft", run: () => this.newProposal() }, { label: "Review proposals", run: () => Dock.open("review") });
      if (this.ws !== "draft") items.push({ label: this.canvas && this.canvas.compare ? "Stop comparing" : "Compare with draft", sub: "on the canvas", run: () => this.compare(!(this.canvas && this.canvas.compare)) });
      popMenu(btn, items);
    },
    healthMenu(btn) {
      const items = [{ group: "Checks and errors" }], dev = Watch.status && Watch.status.dev;
      if (dev && dev.broken) items.push({ label: "dev instance \xB7 activation failed", sub: dev.broken.slice(0, 90), run: () => Dock.open("console") }, { label: "Reset dev data", sub: "a fresh dev instance (after a changed migration)", run: () => this.resetDev() });
      for (const fh of FrameHosts) {
        if (fh.headless || fh.project !== this.P) continue;
        for (const l of fh.logs.filter((l2) => l2.level === "error").slice(-3)) items.push({ label: fh.route + " \xB7 error", sub: l.text.slice(0, 70), run: () => Dock.open("console") });
        for (const i of fh.issues) {
          items.push({
            label: fh.route + " " + fh.w + "px \xB7 " + i.kind,
            sub: i.message.slice(0, 70),
            run: () => {
              if (i.src) {
                const [f, l] = i.src.split(":");
                this.reveal(f, +l);
              }
              fh.call("select", [i.src ? { src: i.src } : i.selector]).then((info2) => info2 && this.select({ ...info2, fid: fh.fid, route: fh.route, ws: fh.ws })).catch(() => {
              });
            }
          });
        }
      }
      if (this.typeErrors.length) {
        items.push({ group: "Type errors" });
        for (const d of this.typeErrors.slice(0, 6)) items.push({ label: d.file + ":" + d.line, sub: d.message.split("\n")[0].slice(0, 70), run: () => this.reveal(d.file, d.line) });
        if (this.typeErrors.length > 6) items.push({ note: this.typeErrors.length - 6 + " more in the Code view" });
      }
      if (items.length === 1) items.push({ note: "No issues in the frames on the canvas, and no type errors." });
      else items.push({ hr: true }, { label: "Ask Claude to fix these", run: () => this.askAgent("Fix the check issues and errors the frames report.") });
      popMenu(btn, items, { right: true });
    },
    layoutMenu(btn) {
      const saved = this.prefs.layouts || {};
      const items = [{ group: "Layouts" }, ...Object.keys(LAYOUTS).map((n) => ({ label: n, run: () => Dock.set(LAYOUTS[n](), []) }))];
      if (Object.keys(saved).length) {
        items.push({ group: "Saved" });
        for (const [n, l] of Object.entries(saved)) items.push({ label: n, run: () => Dock.set(clone(l.layout), clone(l.floats || [])) });
      }
      items.push({ hr: true }, { label: "Save current as\u2026", run: async () => {
        const n = await promptBox("Save layout", "Name", "My layout");
        if (n) {
          this.prefs.layouts = { ...saved, [n]: { layout: clone(Dock.layout), floats: clone(Dock.floats) } };
          this.savePrefs();
          toast('Saved layout "' + n + '"');
        }
      } });
      if (Object.keys(saved).length) items.push({ label: "Forget saved layouts", danger: true, run: () => {
        this.prefs.layouts = {};
        this.savePrefs();
      } });
      items.push({ note: "Drag a tab onto a strip to join, onto an edge to split, or outside to float." });
      popMenu(btn, items, { right: true });
    },
    // ---- boot: the layers get their hooks, then the first app opens ----
    wire() {
      Object.assign(FrameHost.ui, {
        mode: () => this.mode,
        pinsFor: (r) => this.pinsFor(r),
        preview: () => Preview.payload(),
        health: () => this.ev.emit("health"),
        ready: (fh) => this.ev.emit("frameready", fh),
        hostFor: (fid) => this.hostFor(fid),
        log: (fh, l) => this.consoleAdd(l),
        pick: (fh, info2) => {
          this.select(info2);
          if (!this.playHinted && /^(button|a|input|select|textarea|label|summary)\b/i.test(info2.tag || "")) {
            this.playHinted = true;
            toast("Select mode: that click picked the " + String(info2.tag).split(/[.#]/)[0] + " to inspect it. To use your app (press buttons, type), switch to Play (P) in the header.", 8e3);
          }
        },
        placePin: (fh, m) => this.placePin(fh, m),
        openPin: (fh, id) => this.openPin(id, fh),
        textEdit: (fh, m) => this.textEdit(fh, m)
      });
      Object.assign(AgentUI, {
        ws: () => this.ws,
        setWs: (ws) => this.setWs(ws),
        selection: () => this.sel,
        focusFrame: (id) => this.canvas && this.canvas.focusFrame(id),
        fit: () => this.canvas && this.canvas.fit(),
        notify: (t) => toast(t)
      });
      Watch.onLog = (l) => this.consoleAdd(l);
      Watch.ev.on("status", () => {
        this.paintHeader();
        this.ev.emit("health");
      });
      Records.ev.on("status", () => this.paintHeader());
      Agent.ev.on("turn", () => this.paintHeader());
      Agent.ev.on("ready", () => this.paintHeader());
      Dock.ev.on("changed", () => this.savePrefs());
    },
    async boot() {
      Types.status = (P) => Watch.P === P ? Watch.status : null;
      if (/(^|\.)localhost$|^127\.0\.0\.1$/.test(location.hostname)) window.__SB = { App, Snaps, Headless, Agent, Slop, Watch, Projects };
      const root = $("#app");
      clear(root);
      const work = h("div#work");
      root.append(this.header(), work);
      Dock.mount(work);
      this.wire();
      await Slop.init();
      this.prefs = Prefs.get("prefs", {});
      this.theme(this.prefs.theme || "auto");
      this.mode = this.prefs.mode || "select";
      const valid = (l) => {
        try {
          let ok = true;
          walkTiles(normalize(clone(l)), (t) => {
            t.views = t.views.filter((v) => Views[v]);
            if (!t.views.length) ok = false;
          });
          return ok;
        } catch {
          return false;
        }
      };
      Dock.set(this.prefs.layout && valid(this.prefs.layout) ? clone(this.prefs.layout) : LAYOUTS.Build(), this.prefs.floats || []);
      const first = Projects.recent().find((id) => Slop.app(id)) || (Slop.apps[0] || {}).id;
      if (!first || !await this.openProject(first)) this.newAppDialog();
      Agent.init();
      this.dropImport();
      setTimeout(() => {
        if (!Sandbox.worker) Sandbox.spawn();
      }, 1200);
      document.addEventListener("keydown", (e) => {
        const t = e.target;
        if (t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "v") this.setMode("select");
        else if (k === "p") this.setMode("play");
        else if (k === "c") this.setMode("comment");
        else if (k === "escape" && this.traceTarget) {
          this.trace(null);
          this.ev.emit("trace", null);
        } else if (k === "escape" && this.sel) {
          this.sel = null;
          this.ev.emit("sel", null);
          for (const fh of FrameHosts) if (!fh.headless) fh.post({ op: "select", args: [null], id: 0 });
          if (this.canvas) this.canvas.paintAll();
        }
      });
      this.paintHeader();
    }
  };

  // src/ui/snaps.js
  function compareModal(title, left, right, diff) {
    const boxes = diffBoxes(diff), scale = Math.min(1, 400 / Math.max(left.meta.w, 1)), lines = diffSummary(diff, 40);
    modal({
      title,
      wide: true,
      actions: [{ label: "Close" }],
      body: [
        h(
          "div",
          { style: { display: "flex", gap: "16px", alignItems: "flex-start", overflow: "auto", maxHeight: "62vh" } },
          h("div", h("div.note", left.label), Snaps.frozen(left.doc, left.meta, { scale, boxes: boxes.before, full: true })),
          h("div", h("div.note", right.label), Snaps.frozen(right.doc, right.meta, { scale, boxes: boxes.after, full: true }))
        ),
        h("pre.mono", { style: { whiteSpace: "pre-wrap", fontSize: "11.5px", margin: 0 } }, lines.length ? lines.join("\n") : "No layout changes.")
      ]
    });
  }
  function snapStrip(P, shots, title, hint) {
    const row = h("div.snapstrip");
    for (const s of shots.slice(0, 8)) {
      const cell2 = h(
        "button.snap",
        { title: (s.label || s.route) + " \xB7 " + s.w + "px \xB7 " + fmtTime(s.t) + (hint ? "\n" + hint : ""), on: { click: () => compareSnapNow(P, s) } },
        h("div.ph", { style: { width: s.w * 0.2 + "px", height: s.h * 0.2 + "px" } }),
        h("span.note", s.route + " " + s.w)
      );
      row.appendChild(cell2);
      Snaps.load(P, s.id).then((doc) => {
        const ph = cell2.querySelector(".ph");
        if (ph) ph.replaceWith(Snaps.frozen(doc, s, { scale: 0.2 }));
      }).catch(() => {
      });
    }
    return h("div", h("div.note", { style: { margin: "8px 0 4px" } }, title), row);
  }
  async function compareSnapNow(P, s) {
    try {
      const doc = await Snaps.load(P, s.id);
      const ws = s.ws === "draft" || (P.proposals.get(s.ws) || {}).status === "open" ? s.ws : "draft";
      const fr = P.board().frames.find((f) => f.w === s.w && f.route === s.route) || { id: null, route: s.route, w: s.w, h: s.h };
      const cur = await Snaps.capture(await hostIn(P, fr, ws));
      compareModal(s.route + " " + s.w + "px: " + (s.label || fmtTime(s.t)) + " \u2192 now", { label: (s.label || "") + " " + fmtTime(s.t), doc, meta: s }, { label: "now", doc: cur.doc, meta: cur }, layoutDiff(doc.layout, cur.doc.layout));
    } catch (e) {
      toast("Could not compare: " + (e.message || e));
    }
  }

  // src/ui/scenarios.js
  var SCENARIOS = {
    title: "Scenarios",
    sub: "flows that pass or fail",
    badge: () => {
      const P = App.P;
      if (!P) return null;
      const bad = scenarioList(P, App.ws).filter((s) => s.last && !s.last.ok).length;
      return bad ? h("span.count", String(bad)) : null;
    },
    make() {
      const S = { open: {}, live: {}, busy: false };
      const body = h("div.scroll"), el = h("div", body);
      const P = () => App.P;
      function paint() {
        clear(body);
        const p = P();
        if (!p) return;
        const ws = App.ws, list = scenarioList(p, ws), fxs = fixtureList(p, ws);
        body.appendChild(h(
          "div.toolbar",
          h("b", "Scenarios"),
          h("span.note", "each runs on your test instance, reset and seeded with its fixture" + (ws !== "draft" ? ", on this proposal" : "")),
          h("span.sp"),
          h("button.btn.sm", { disabled: S.busy || !list.length, on: { click: runAll } }, S.busy ? "Running\u2026" : "Run all"),
          h("button.btn.sm", { on: { click: newScenario } }, "+ New")
        ));
        if (!list.length) body.appendChild(h("div.empty", h("p", "No scenarios yet."), h("p.note", `Record one from a frame's \u22EF menu (click and type in Play mode; pick an element in Select mode to check its text), write scenarios/<name>.json by hand, or ask Claude: "write scenarios for ordering and run them".`)));
        for (const s of list) body.appendChild(card(p, s));
        body.appendChild(h(
          "div.toolbar",
          h("b", "Fixtures"),
          h("span.note", "the data a test instance starts from"),
          h("span.sp"),
          Fixtures.current !== null ? h("span.note", "test instance: " + (Fixtures.current || "empty")) : null,
          h("button.btn.sm", { on: { click: newFixture } }, "+ New")
        ));
        if (!fxs.length) body.appendChild(h("p.note", { style: { padding: "0 12px 12px" } }, "None yet. A fixture holds documents and table rows a scenario starts from: an empty menu, very long names, a hundred orders. Save rows as one from the Data view."));
        else body.appendChild(h("div.rows", { style: { padding: "0 12px 12px" } }, fxs.map((f) => h(
          "div",
          h("b", f.name),
          h("span", { style: { flex: 1 } }, f.error ? h("span", { style: { color: "var(--accent)" } }, f.error) : [f.description ? f.description + " \xB7 " : "", f.parts.join(", ") || "empty"]),
          f.error ? null : h("button.link.note", { title: "Reset your test instance to this fixture (canvas frames of the test instance reload)", on: { click: () => Fixtures.apply(p, f.name, App.ws).then(() => {
            toast("Test instance: " + f.name);
            paint();
          }, (e) => toast(e.message, 5e3)) } }, "apply"),
          " ",
          h("button.link.note", { on: { click: () => App.reveal(f.path, 1) } }, "edit")
        ))));
      }
      function card(p, s) {
        const live = S.live[s.name], last = s.last, shown = S.open[s.name] ?? (!!live || last && !last.ok);
        const state = live ? live.done ? live.ok ? "ok" : "bad" : "run" : last ? last.ok ? "ok" : "bad" : "none";
        const icon = { ok: "\u2713", bad: "\u2717", run: "\u25CC", none: "\u25CB" }[state];
        const head = h(
          "div.sh",
          h("span.si." + state, icon),
          h("button.link", { on: { click: () => {
            S.open[s.name] = !shown;
            paint();
          } } }, h("b", s.name)),
          s.spec && s.spec.description ? h("span.note", s.spec.description) : null,
          h("span.sp"),
          s.spec ? h("span.note", s.spec.page + (s.spec.fixture ? " \xB7 fixture " + s.spec.fixture : "") + " \xB7 " + plural(s.spec.steps.length, "step")) : null,
          last && !live ? h("span.note", fmtAgo(last.t)) : null,
          h("button.btn.sm", { disabled: !!s.error || S.busy, on: { click: () => run(s) } }, "Run"),
          h("button.btn.sm", { on: { click: () => App.reveal(s.path, 1) } }, "Edit")
        );
        const c = h("div.scard." + state, head);
        if (s.error) {
          c.appendChild(h("p.note", { style: { color: "var(--accent)", margin: "4px 0 0 26px" } }, s.error));
          return c;
        }
        if (!shown) return c;
        const res = live || last, steps = h("ol.ssteps");
        s.spec.steps.forEach((st, i) => {
          const r = res && res.steps && res.steps[i], cls = !r ? live && live.cur === i ? "run" : "" : r.ok ? "ok" : "bad";
          steps.appendChild(h(
            "li." + (cls || "todo"),
            h("span.m", cls === "ok" ? "\u2713" : cls === "bad" ? "\u2717" : cls === "run" ? "\u25CC" : "\xB7"),
            h("span", stepLabel(st)),
            r && r.ms != null ? h("span.note", r.ms + " ms") : null,
            r && r.error ? h("div.err", r.error) : null
          ));
        });
        c.appendChild(steps);
        if (res && res.snaps && res.snaps.length) {
          const shots = res.snaps.map((x) => Snaps.list(p).find((m) => m.id === x.id)).filter(Boolean);
          if (shots.length) c.appendChild(snapStrip(p, shots, res.ok ? "Where it ended" : "Where it failed", "Click to compare with the page now"));
        }
        if (res && !res.ok && !live) c.appendChild(h("div", { style: { margin: "6px 0 0 26px" } }, h("button.btn.sm", { on: { click: () => App.askAgent('Scenario "' + s.name + '" fails at step ' + (res.failedAt + 1) + " (" + res.steps[res.failedAt].label + "): " + res.steps[res.failedAt].error + ". Find out why (scenarios.read, scenarios.run, frames.*) and fix the page, or the scenario if the page is right.") } }, "Ask Claude to fix")));
        return c;
      }
      async function run(s) {
        const p = P();
        S.live[s.name] = { steps: [], cur: 0 };
        S.open[s.name] = true;
        paint();
        try {
          const r = await runScenario(p, s.spec, { ws: App.ws, name: s.name, onStep: (st) => {
            const L = S.live[s.name];
            if (!L) return;
            if (st.running) L.cur = st.i;
            else L.steps[st.i] = st;
            later();
          } });
          S.live[s.name] = { ...r, done: true };
        } catch (e) {
          toast(s.name + ": " + e.message);
          delete S.live[s.name];
        }
        App.ev.emit("scenarios");
        setTimeout(() => {
          delete S.live[s.name];
          later();
        }, 1200);
        paint();
      }
      async function runAll() {
        S.busy = true;
        paint();
        try {
          for (const s of scenarioList(P(), App.ws)) if (!s.error) await run(s);
        } finally {
          S.busy = false;
          paint();
        }
        const list = scenarioList(P(), App.ws), bad = list.filter((s) => s.last && !s.last.ok).length;
        toast(bad ? plural(bad, "scenario") + " failed" : "All " + plural(list.length, "scenario") + " passed");
      }
      async function newScenario() {
        const p = P(), n = await promptBox("New scenario", "A name (letters, digits, -). You can also record one from a frame's \u22EF menu.", "add-a-note");
        if (!n) return;
        const page2 = Instances.entry(p), path = SCEN_DIR + n.replace(/[^\w-]+/g, "-") + ".json";
        if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: "What this scenario proves (edit me)", page: page2, steps: [{ waitFor: "body" }, { expect: "h1", text: "The words the page must show (edit me)", exact: true }] }, null, 2) + "\n", App.ws);
        App.reveal(path, 1);
      }
      async function newFixture() {
        const p = P(), n = await promptBox("New fixture", "Documents by collection and rows by table; edit it to make the case you want (or save rows from the Data view).", "empty-menu");
        if (!n) return;
        const path = fixturePath(n.replace(/[^\w-]+/g, "-"));
        if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: "", docs: {}, tables: {} }, null, 2) + "\n", App.ws);
        App.reveal(path, 1);
      }
      const later = debounce(() => {
        if (Dock.visible("scenarios")) paint();
        Dock.refreshTabs();
      }, 80);
      App.ev.on("scenarios", later);
      App.ev.on("files", later);
      App.ev.on("ws", later);
      App.ev.on("project", () => {
        S.live = {};
        later();
      });
      Fixtures.ev.on("applied", later);
      return { el, show: paint };
    }
  };
  async function saveRecording(P, r, ws) {
    if (!r || !r.steps.length) {
      toast("Nothing was recorded");
      return null;
    }
    const name = await promptBox("Save scenario", "Recorded " + plural(r.steps.length, "step") + " starting on " + r.page + ". Name:", r.page.replace(/\.html?$/, "").replace(/[^\w-]/g, "-") + "-flow");
    if (!name) return null;
    const slug2 = name.trim().replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "scenario";
    P.write(SCEN_DIR + slug2 + ".json", JSON.stringify({ description: "", page: r.page, size: r.size, steps: r.steps }, null, 2) + "\n", ws);
    toast("Saved " + SCEN_DIR + slug2 + ".json");
    Dock.open("scenarios");
    return slug2;
  }

  // src/ui/canvas.js
  var SIZES = [{ w: 375, h: 720, n: "Phone" }, { w: 768, h: 900, n: "Tablet" }, { w: 1280, h: 800, n: "Desktop" }];
  var CANVAS = {
    title: "Canvas",
    sub: "live frames",
    badge: () => {
      const n = App.health();
      return n ? h("span.count.bad", String(n)) : null;
    },
    make() {
      const C = { views: /* @__PURE__ */ new Map(), z: 1, x: 40, y: 40, compare: false, flows: true, fitted: false };
      const world = h("div.world"), flows = svgEl("svg", { class: "flows", width: 1, height: 1 });
      const hud = h("div.cvhud"), pop = h("div");
      const cv = h("div.cv", world, hud, pop);
      world.appendChild(flows);
      const zoomLbl = h("button.btn.sm", { title: "Reset to 100%", on: { click: () => zoomTo(1) } }, "100%");
      const cmpBtn = h("button.btn.sm", { title: "Show draft and the proposal one above the other", on: { click: () => {
        C.compare = !C.compare;
        sync();
      } } }, "Compare");
      const mxRoute = h("select.sel", { title: "Page shown in every cell of the matrix", style: { height: "24px", fontSize: "11px" }, hidden: true, on: { change: () => {
        C.mxRoute = mxRoute.value;
        sync();
      } } });
      const mxBtn = h("button.btn.sm", { title: "Matrix: one row per proposal (and draft), one column per viewport", on: { click: () => {
        C.matrix = !C.matrix;
        C.fitted = false;
        sync();
      } } }, "Matrix");
      const flowBtn = h("button.btn.sm.on", { title: "Arrows for links between pages", on: { click: () => {
        C.flows = !C.flows;
        flowBtn.classList.toggle("on", C.flows);
        drawFlows();
      } } }, "Flows");
      const bar = h(
        "div.toolbar",
        h("div.rel", h("button.btn.sm", { on: { click: (e) => addFrameMenu(e.currentTarget) } }, "+ Frame")),
        h("span.lbl", "Zoom"),
        h("button.btn.sm", { on: { click: () => zoomTo(C.z / 1.25) } }, "\u2212"),
        zoomLbl,
        h("button.btn.sm", { on: { click: () => zoomTo(C.z * 1.25) } }, "+"),
        h("button.btn.sm", { on: { click: () => fit() } }, "Fit"),
        h("span.sp"),
        mxRoute,
        mxBtn,
        cmpBtn,
        flowBtn,
        h("button.btn.sm", { title: "Run layout and accessibility checks on every frame", on: { click: () => {
          for (const v of C.views.values()) v.host.runCheck();
          toast("Checking frames\u2026");
        } } }, "Check")
      );
      const el = h("div", bar, cv);
      function apply() {
        world.style.transform = `translate(${C.x}px, ${C.y}px) scale(${C.z})`;
        world.style.setProperty("--zb", 1 / C.z + "px");
        zoomLbl.textContent = Math.round(C.z * 100) + "%";
        positionPop();
        for (const v of C.views.values()) v.scaleHead();
      }
      function zoomTo(z, cx, cy) {
        const r = cv.getBoundingClientRect();
        cx = cx ?? r.width / 2;
        cy = cy ?? r.height / 2;
        const nz = clamp(z, 0.1, 3), wx = (cx - C.x) / C.z, wy = (cy - C.y) / C.z;
        C.z = nz;
        C.x = cx - wx * nz;
        C.y = cy - wy * nz;
        apply();
        saveView();
      }
      function bounds() {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const v of C.views.values()) {
          const p = v.pos();
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y - 30);
          x1 = Math.max(x1, p.x + v.fr.w);
          y1 = Math.max(y1, p.y + v.fr.h);
        }
        return isFinite(x0) ? { x0, y0, x1, y1 } : null;
      }
      function fit() {
        const b = bounds(), r = cv.getBoundingClientRect();
        if (!b || !r.width) {
          C.fitted = false;
          return;
        }
        const z = clamp(Math.min((r.width - 60) / (b.x1 - b.x0), (r.height - 60) / (b.y1 - b.y0)), 0.1, 1.2);
        C.z = z;
        C.x = (r.width - (b.x1 - b.x0) * z) / 2 - b.x0 * z;
        C.y = (r.height - (b.y1 - b.y0) * z) / 2 - b.y0 * z;
        apply();
        saveView();
      }
      const saveView = debounce(() => {
        const P = App.P;
        if (P) {
          P.meta.view = { x: C.x, y: C.y, z: C.z };
          P.saveMeta();
        }
      }, 800);
      cv.addEventListener("pointerdown", (e) => {
        if (e.target !== cv && e.target !== world && e.target !== flows) return;
        if (e.button !== 0 && e.button !== 1) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        cv.classList.add("panning");
        document.body.classList.add("moving");
        const sx = e.clientX - C.x, sy = e.clientY - C.y;
        const move = (ev) => {
          C.x = ev.clientX - sx;
          C.y = ev.clientY - sy;
          apply();
        };
        const up = () => {
          cv.removeEventListener("pointermove", move);
          cv.removeEventListener("pointerup", up);
          cv.classList.remove("panning");
          document.body.classList.remove("moving");
          saveView();
        };
        cv.addEventListener("pointermove", move);
        cv.addEventListener("pointerup", up);
        closePop();
      });
      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) zoomTo(C.z * Math.exp(-e.deltaY * 22e-4), e.clientX - r.left, e.clientY - r.top);
        else {
          C.x -= e.deltaX;
          C.y -= e.deltaY;
          apply();
          saveView();
        }
      }, { passive: false });
      function frameView(fr, role, ws) {
        const P = App.P;
        const host = new FrameHost({ project: P, route: fr.route, w: fr.w, h: fr.h, ...showing(ws), fid: fr.id + (role === "p" ? ":p" : "") });
        const routeSel = h("select.route", { title: "Page in this frame", on: { change: () => {
          if (host.rec) host.recStep({ go: routeSel.value });
          else if (role === "a") {
            fr.route = routeSel.value;
            App.P.saveMeta();
          }
          host.navigate(routeSel.value);
        } } });
        const back = h("button.fact", { title: "Back to this frame's page", hidden: true, on: { click: () => host.navigate(fr.route) } }, "\u21A9");
        const meta = h("span.meta"), status = h("div.fstatus", { hidden: true }), flabel = h("b.flabel", { title: "Double-click the header to rename" });
        const recTag = h("span.tag.fx", { hidden: true, title: "Recording a scenario" }, "recording");
        const recBar = h("div.recbar", { hidden: true });
        const v = { fr, role, host, el: null, pos: () => role === "p" ? { x: v.fr.x, y: v.fr.y + C.rowH + 110 } : { x: v.fr.x, y: v.fr.y } };
        const head = h(
          "div.fh",
          flabel,
          routeSel,
          meta,
          h("span.sp"),
          role === "p" ? h("span.tag.ws", "proposal") : null,
          recTag,
          back,
          role === "a" ? h("div.rel", h("button.fact", { title: "Viewport size", on: { click: (e) => sizeMenu(e.currentTarget, fr) } }, "\u21D4")) : null,
          role !== "m" ? h("button.fact", { title: "Snapshots, comparisons, recording", on: { click: (e) => frameMenu(e.currentTarget, v) } }, "\u22EF") : null,
          h("button.fact", { title: "Reload", on: { click: () => host.load({ keepState: false }) } }, "\u21BB"),
          role === "a" ? h("button.fact", { title: "Close frame", on: { click: () => App.P.removeFrame(fr.id) } }, "\xD7") : null
        );
        const body = h("div.fb", host.el, status, recBar);
        v.el = h("div.frm" + (ws !== "draft" ? ".prop" : "") + (role === "m" ? ".mx" : ""), head, body);
        v.scaleHead = () => {
          const k = clamp(1 / C.z, 0.6, 6);
          head.style.transform = "scale(" + k + ")";
          head.style.width = fr.w / k + "px";
        };
        v.paint = () => {
          const p = v.pos();
          Object.assign(v.el.style, { left: p.x + "px", top: p.y + "px", width: v.fr.w + "px" });
          clear(routeSel);
          for (const r of App.P.list(host.ws).filter((x) => /\.html?$/.test(x))) routeSel.appendChild(h("option", { value: r, selected: r === host.route }, r));
          routeSel.hidden = role === "m";
          if (![...routeSel.options].some((o) => o.value === host.route)) routeSel.appendChild(h("option", { value: host.route, selected: true }, host.route + " (missing)"));
          back.hidden = role === "m" || host.route === v.fr.route;
          back.title = "Back to " + v.fr.route;
          flabel.textContent = v.fr.label || "";
          flabel.hidden = !v.fr.label;
          routeSel.classList.toggle("sub", !!fr.label);
          meta.textContent = v.fr.w + "\xD7" + v.fr.h + (host.errors ? " \xB7 " + plural(host.errors, "error") : "") + (host.issues.length ? " \xB7 " + plural(host.issues.length, "issue") : "");
          meta.style.color = host.errors || host.issues.length ? "var(--accent)" : "";
          recTag.hidden = !host.rec;
          recBar.hidden = !host.rec;
          if (host.rec) put(
            clear(recBar),
            h("span.dot"),
            h("b", "Recording"),
            h("span", plural(host.rec.steps.length, "step") + (host.rec.steps.length ? " \xB7 last: " + stepLabel(host.rec.steps[host.rec.steps.length - 1]).slice(0, 48) : " \xB7 click and type in Play mode; pick an element in Select mode to check its text")),
            h("span.sp"),
            h("button.btn.sm", { on: { click: async () => {
              await host.stopRecording();
              v.paint();
            } } }, "Discard"),
            h("button.btn.sm.primary", { on: { click: async () => {
              const r = await host.stopRecording();
              v.paint();
              await saveRecording(App.P, r, host.ws);
            } } }, "Stop and save")
          );
          status.hidden = !host.errors;
          status.textContent = host.errors ? (host.logs.filter((l) => l.level === "error").slice(-1)[0] || {}).text || "" : "";
          v.el.classList.toggle("sel", !!App.sel && App.sel.fid === host.fid);
          v.scaleHead();
        };
        host.ev.on("rec", () => v.paint());
        host.ev.on("issues", () => {
          v.paint();
          Dock.refreshTabs();
        });
        host.ev.on("log", (l) => {
          if (l.level === "error") v.paint();
        });
        host.ev.on("nav", () => {
          v.paint();
          drawFlows();
        });
        head.addEventListener("dblclick", async (e) => {
          if (e.target.closest("button, select") || role !== "a") return;
          const n = await promptBox("Label this frame", "A name shown above the frame (empty to clear)", fr.label || "");
          if (n === null) return;
          fr.label = n || void 0;
          App.P.saveMeta();
          v.paint();
        });
        head.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button, select") || role !== "a") return;
          e.preventDefault();
          head.setPointerCapture(e.pointerId);
          document.body.classList.add("moving");
          const sx = e.clientX, sy = e.clientY, x0 = fr.x, y0 = fr.y;
          const move = (ev) => {
            fr.x = Math.round(x0 + (ev.clientX - sx) / C.z);
            fr.y = Math.round(y0 + (ev.clientY - sy) / C.z);
            v.paint();
            for (const o of C.views.values()) if (o.fr === fr && o !== v) o.paint();
            drawFlows();
          };
          const up = () => {
            head.removeEventListener("pointermove", move);
            head.removeEventListener("pointerup", up);
            document.body.classList.remove("moving");
            layoutRows();
            App.P.saveMeta();
          };
          head.addEventListener("pointermove", move);
          head.addEventListener("pointerup", up);
        });
        world.appendChild(v.el);
        v.paint();
        host.load();
        return v;
      }
      function layoutRows() {
        const fs = App.P && !C.matrix ? App.P.board().frames : [];
        C.rowH = fs.reduce((m, f) => Math.max(m, f.y + f.h), 0);
        for (const v of C.views.values()) v.paint();
        drawFlows();
      }
      function sync() {
        const P = App.P, props = P ? P.openProposals().map((p) => ({ id: p.ref, title: p.title })) : [];
        mxBtn.hidden = !P || !props.length;
        if (mxBtn.hidden) C.matrix = false;
        mxBtn.classList.toggle("on", !!C.matrix);
        mxRoute.hidden = !C.matrix;
        cmpBtn.hidden = !P || App.ws === "draft" || C.matrix;
        cmpBtn.classList.toggle("on", C.compare && App.ws !== "draft");
        const want = /* @__PURE__ */ new Map();
        if (P && C.matrix) {
          const routes = [...new Set([...P.list("draft"), ...props.flatMap((o) => P.list(o.id))].filter((x) => /\.html?$/.test(x)))];
          if (!routes.includes(C.mxRoute)) C.mxRoute = App.sel && routes.includes(App.sel.route) && App.sel.route || (P.board().frames[0] || {}).route || routes[0];
          clear(mxRoute);
          for (const r of routes) mxRoute.appendChild(h("option", { value: r, selected: r === C.mxRoute }, r));
          const sizes = [...new Map(P.board().frames.map((f) => [f.w + "x" + f.h, { w: f.w, h: f.h }])).values()].sort((a, b) => a.w - b.w);
          if (!sizes.length) sizes.push({ w: 375, h: 720 });
          const rowH = Math.max(...sizes.map((s) => s.h)) + 120;
          [{ id: "draft", title: "draft" }, ...props].forEach((o, r) => {
            let x = 0;
            for (const sz of sizes) {
              const key = "mx|" + o.id + "|" + sz.w + "x" + sz.h + "|" + C.mxRoute;
              want.set(key, { role: "m", ws: o.id, fr: { id: "mx:" + o.id + ":" + sz.w + "x" + sz.h, route: C.mxRoute, w: sz.w, h: sz.h, x, y: r * rowH, label: o.title + " \xB7 " + sz.w + "px" } });
              x += sz.w + 60;
            }
          });
        } else if (P) for (const fr of P.board().frames) {
          const cmp = C.compare && App.ws !== "draft";
          want.set(fr.id + "|a", { fr, role: "a", ws: cmp ? "draft" : App.ws });
          if (cmp) want.set(fr.id + "|p", { fr, role: "p", ws: App.ws });
        }
        for (const [k, v] of C.views) {
          const w = want.get(k);
          if (!w || v.host.ws !== w.ws || v.host.project !== P) {
            v.host.dispose();
            v.el.remove();
            C.views.delete(k);
          } else {
            if (w.role === "m") v.fr = w.fr;
            if (v.host.w !== w.fr.w || v.host.h !== w.fr.h) {
              v.host.size(w.fr.w, w.fr.h);
              v.host.load();
            }
          }
        }
        for (const [k, w] of want) if (!C.views.has(k)) C.views.set(k, frameView(w.fr, w.role, w.ws));
        layoutRows();
        hudPaint();
        if (P && !C.fitted) {
          C.fitted = true;
          if (P.meta.view) {
            Object.assign(C, P.meta.view);
            apply();
          } else requestAnimationFrame(fit);
        }
      }
      function drawFlows() {
        clear(flows);
        if (!C.flows || !App.P) return;
        const P = App.P, prim = [...C.views.values()].filter((v) => v.role === "a"), first = /* @__PURE__ */ new Map();
        for (const v of prim) if (!first.has(v.host.route)) first.set(v.host.route, v);
        flows.appendChild(svgEl("defs", {}, svgEl("marker", { id: "arr", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svgEl("path", { d: "M0,0 L8,4 L0,8 z", fill: "var(--ink-2)" }))));
        const seen = /* @__PURE__ */ new Set();
        for (const v of first.values()) {
          const html = P.read(v.host.route, v.host.ws) || "";
          for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+\.html?)/gi)) {
            const to = first.get(m[1]);
            if (!to || to === v || seen.has(v.host.route + ">" + m[1])) continue;
            seen.add(v.host.route + ">" + m[1]);
            const a = v.pos(), b = to.pos(), right = b.x > a.x;
            const x1 = right ? a.x + v.fr.w : a.x, y1 = a.y + 30 + Math.min(80, v.fr.h / 4), x2 = right ? b.x : b.x + to.fr.w, y2 = b.y + 30 + Math.min(80, to.fr.h / 4);
            const back = seen.has(m[1] + ">" + v.host.route);
            flows.appendChild(svgEl("path", { d: `M${x1},${y1 + (back ? 24 : 0)} C${x1 + (right ? 30 : -30)},${y1 + (back ? 24 : 0)} ${x2 + (right ? -30 : 30)},${y2 + (back ? 24 : 0)} ${x2},${y2 + (back ? 24 : 0)}`, fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.4 / Math.max(C.z, 0.3), "stroke-dasharray": back ? "4 4" : null, "marker-end": "url(#arr)" }));
          }
        }
      }
      function hudPaint() {
        clear(hud);
        hud.append(h("span.chip.on", App.mode), h("span.chip", App.ws === "draft" ? "draft" : "proposal: " + (App.proposal() || {}).title));
        if (App.mode === "select") hud.append(h("span.note", "clicks pick elements to inspect \xB7 double-click text to edit \xB7 Play (P) to use the app"));
        if (App.mode === "comment") hud.append(h("span.note", "click to drop a pin"));
      }
      function addFrameMenu(btn) {
        const P = App.P;
        if (!P) return;
        const routes = P.list(App.ws).filter((x) => /\.html?$/.test(x)), items = [];
        for (const r of routes) {
          items.push({ group: r });
          for (const s of SIZES) items.push({ label: s.n + " " + s.w + "\xD7" + s.h, run: () => {
            const f = P.addFrame({ route: r, w: s.w, h: s.h });
            setTimeout(() => focusFrame(f.id), 50);
          } });
        }
        popMenu(btn, items);
      }
      function frameMenu(btn, v) {
        const P = App.P, host = v.host, fr = v.fr;
        const snaps = Snaps.list(P).filter((s) => s.route === host.route && s.w === fr.w).slice(-6).reverse();
        const items = [
          { group: "Snapshots" },
          { label: "Take snapshot", sub: "a frozen copy of the page and its layout", run: async () => {
            await Snaps.take(P, host, { label: (fr.label || host.route) + " " + fmtTime(now()) });
            toast("Snapshot of " + host.route + " kept");
          } },
          ...snaps.map((s) => ({ label: "Compare with " + (s.label || fmtTime(s.t)), sub: s.ws !== host.ws ? s.ws === "draft" ? "draft" : "proposal" : s.note || "", run: () => compareWithSnap(v, s) })),
          App.ws !== "draft" ? { label: "Compare draft with this proposal", sub: "layout differences on " + host.route, run: () => compareWs(v, "draft", App.ws) } : null,
          { hr: true },
          { group: "Scenarios" },
          host.rec ? { label: "Stop recording\u2026", run: async () => {
            const r = await host.stopRecording();
            v.paint();
            await saveRecording(P, r, host.ws);
          } } : { label: "Record a scenario", sub: "click and type in Play mode; saved as scenarios/<name>.json", disabled: v.role === "m", run: async () => {
            if (App.mode !== "play") App.setMode("play");
            await host.startRecording(fr);
            v.paint();
          } }
        ];
        popMenu(btn, items.filter(Boolean), { right: true });
      }
      async function compareWithSnap(v, s) {
        const P = App.P, doc = await Snaps.load(P, s.id);
        const cur = await Snaps.capture(v.host), diff = layoutDiff(doc.layout, cur.doc.layout);
        compareModal(v.host.route + ": " + (s.label || fmtTime(s.t)) + " \u2192 now", { label: s.label || fmtTime(s.t), doc, meta: s }, { label: "now", doc: cur.doc, meta: cur }, diff);
      }
      async function compareWs(v, a, b) {
        const P = App.P, fr = { ...v.fr, route: v.host.route };
        try {
          const A = (await layoutIn(P, fr, a, { headless: true })).fh, B = (await layoutIn(P, fr, b, { headless: true })).fh;
          const [sa, sb] = [await Snaps.capture(A), await Snaps.capture(B)];
          const title = (t) => t === "draft" ? "draft" : "proposal: " + ((P.proposals.get(t) || {}).title || t);
          compareModal(v.host.route + " " + fr.w + "px: " + title(a) + " \u2192 " + title(b), { label: title(a), doc: sa.doc, meta: sa }, { label: title(b), doc: sb.doc, meta: sb }, layoutDiff(sa.doc.layout, sb.doc.layout));
        } catch (e) {
          toast("Could not compare: " + e.message);
        }
      }
      C.compareWs = (fid, a, b) => {
        const v = [...C.views.values()].find((x) => x.fr.id === fid && x.role === "a");
        if (v) return compareWs(v, a, b);
      };
      function sizeMenu(btn, fr) {
        popMenu(btn, SIZES.map((s) => ({ label: s.n, sub: s.w + "\xD7" + s.h, on: fr.w === s.w && fr.h === s.h, run: () => {
          fr.w = s.w;
          fr.h = s.h;
          App.P.saveMeta();
          App.P.ev.emit("frames");
        } })), { right: true });
      }
      function focusFrame(fid) {
        const v = [...C.views.values()].find((x) => x.host.fid === fid || x.fr.id === fid);
        if (!v) return;
        const r = cv.getBoundingClientRect(), p = v.pos();
        const vis = p.x * C.z + C.x > 0 && (p.x + v.fr.w) * C.z + C.x < r.width && p.y * C.z + C.y > 0;
        if (!vis) {
          C.x = r.width / 2 - (p.x + v.fr.w / 2) * C.z;
          C.y = 50 - (p.y - 30) * C.z;
          apply();
          saveView();
        }
      }
      let popState = null;
      function closePop() {
        clear(pop);
        popState = null;
      }
      function positionPop() {
        if (!popState) return;
        const v = [...C.views.values()].find((x) => x.host === popState.host);
        if (!v) return closePop();
        const p = v.pos(), box = pop.firstChild;
        if (!box) return;
        box.style.left = clamp((p.x + popState.x) * C.z + C.x + 14, 4, cv.clientWidth - 270) + "px";
        box.style.top = clamp((p.y + popState.y) * C.z + C.y - 10, 4, cv.clientHeight - 140) + "px";
      }
      C.newPin = (host, m) => {
        closePop();
        const ta = h("textarea.txt", { placeholder: "What should change here?" });
        const save2 = () => {
          const text = ta.value.trim();
          if (!text) return closePop();
          const P = App.P, n = (P.meta.pins || []).reduce((a, p) => Math.max(a, p.n), 0) + 1;
          (P.meta.pins = P.meta.pins || []).push({ id: "pin" + uid(), n, route: host.route, src: m.info.src, selector: m.info.selector, rx: +m.rx.toFixed(3), ry: +m.ry.toFixed(3), text, by: "you", t: now(), resolved: false });
          P.saveMeta();
          P.log({ kind: "pin", who: "you", note: "#" + n + " " + text.slice(0, 100), paths: m.info.src ? [m.info.src.split(":")[0]] : void 0 });
          App.ev.emit("pins");
          closePop();
        };
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save2();
          if (e.key === "Escape") closePop();
        });
        pop.appendChild(h(
          "div.pinpop",
          h("b", "Pin on " + (m.info.tag || "element") + " "),
          h("span.note", m.info.src || host.route),
          ta,
          h("div", { style: { display: "flex", gap: "6px" } }, h("button.btn.sm.primary", { on: { click: save2 } }, "Save pin"), h("button.btn.sm", { on: { click: closePop } }, "Cancel"), h("span.sp"), h("span.note", "\u2318\u21B5"))
        ));
        popState = { host, x: m.x, y: m.y };
        positionPop();
        setTimeout(() => ta.focus(), 20);
      };
      C.showPin = (id, host) => {
        const P = App.P, p = (P.meta.pins || []).find((x) => x.id === id);
        if (!p) return;
        closePop();
        pop.appendChild(h(
          "div.pinpop",
          h("b", "#" + p.n + " "),
          h("span.note", (p.by === "you" ? "You" : p.by) + " \xB7 " + fmtAgo(p.t) + (p.resolved ? " \xB7 resolved" : "")),
          h("div", { style: { whiteSpace: "pre-wrap" } }, p.text),
          p.reply ? h("div.note", "\u21B3 " + p.reply) : null,
          h(
            "div",
            { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            !p.resolved ? h("button.btn.sm", { on: { click: () => {
              App.askAgent("Address pin #" + p.n + " on " + p.route + ": " + p.text);
              closePop();
            } } }, "Ask agent") : null,
            h("button.btn.sm", { on: { click: () => {
              p.resolved = !p.resolved;
              P.saveMeta();
              App.ev.emit("pins");
              closePop();
            } } }, p.resolved ? "Reopen" : "Resolve"),
            h("button.btn.sm.danger", { on: { click: () => {
              P.meta.pins = P.meta.pins.filter((x) => x !== p);
              P.saveMeta();
              App.ev.emit("pins");
              closePop();
            } } }, "Delete"),
            h("span.sp"),
            h("button.btn.sm", { on: { click: closePop } }, "Close")
          )
        ));
        const hostRef = host || [...C.views.values()].find((v) => v.host.route === p.route)?.host;
        if (!hostRef) return;
        popState = { host: hostRef, x: hostRef.w * 0.5, y: 40 };
        positionPop();
      };
      C.sync = sync;
      C.paintAll = () => {
        for (const v of C.views.values()) v.paint();
        hudPaint();
      };
      C.focusFrame = focusFrame;
      C.fit = fit;
      C.zoomTo = zoomTo;
      C.hostsFor = (fid) => [...C.views.values()].filter((v) => v.fr.id === fid).map((v) => v.host);
      C.hostFor = (fid) => {
        for (const v of C.views.values()) if (v.fr.id === fid && v.role === "a") return v.host;
        return null;
      };
      C.reset = () => {
        for (const v of C.views.values()) {
          v.host.dispose();
          v.el.remove();
        }
        C.views.clear();
        C.fitted = false;
        C.compare = false;
        closePop();
      };
      App.canvas = C;
      return { el, show: () => {
        if (!C.fitted) sync();
      } };
    }
  };

  // src/ui/history.js
  var MARK_STYLE = { bookmark: ["\u25C6", "var(--accent)", "Bookmark"], milestone: ["\u25C6", "var(--a1)", "Milestone"], decision: ["\u25C6", "var(--a2)", "Decision"], question: ["?", "var(--a4)", "Question"], checkpoint: ["\u25A0", "var(--ink)", "Checkpoint"], auto: ["\u25C7", "var(--ink-2)", "Automatic"] };
  var markStyle = (e) => MARK_STYLE[e.mk || (e.who === "agent" ? "milestone" : "bookmark")] || MARK_STYLE.bookmark;
  var STORY_KINDS = ["mark", "msg", "turn", "accept", "reject", "delegate", "scenario", "publish"];
  var KIND_STYLE = { commit: "var(--ink)", outside: "var(--warn)", scenario: "var(--a4)", canvas: "var(--ink-2)", delegate: "var(--a2)", eval: "var(--a1)", turn: "var(--a2)", msg: "var(--ink-2)", accept: "var(--good)", reject: "var(--accent)", mark: "var(--accent)", pin: "var(--a4)", publish: "var(--good)", compact: "var(--ink-2)" };
  var whoName = (P, e) => e.who === "agent" ? "Claude" + ((P.threads.get(e.thread) || {}).title ? " \xB7 " + P.threads.get(e.thread).title : "") : e.who === "push" ? "outside the bench" : e.who === "ide" ? "the bench" : "you";
  var label = (e) => e.kind === "commit" ? "committed " + (e.paths || []).slice(0, 3).join(", ") + ((e.paths || []).length > 3 ? " +" + (e.paths.length - 3) : "") + (e.ref && e.ref !== "draft" ? " (proposal)" : "") : e.kind === "outside" ? "changed outside: " + (e.paths || []).slice(0, 3).join(", ") : e.kind === "mark" ? e.label + (e.mk && e.mk !== "bookmark" && e.mk !== "milestone" ? " (" + e.mk + ")" : "") : e.kind === "eval" ? "eval: " + (e.calls && e.calls.length ? e.calls.join(", ") : e.note) : e.kind === "turn" ? "reply: " + (e.note || "") : e.kind === "msg" ? "asked: " + e.note : e.kind + (e.note || e.label ? ": " + (e.note || e.label) : "");
  var TIMELINE = {
    title: "Timeline",
    sub: "session history",
    make() {
      const S = { kind: "all", path: null, sel: null };
      const P = () => App.P;
      const svgWrap = h("div", { style: { overflowX: "auto", borderBottom: "1px solid var(--hair)", flex: "none" } }), story = h("div.story"), side = h("div.tlside");
      const bar = h("div.toolbar");
      const el = h("div", bar, h("div.tl", h("div.tlmain", svgWrap, story), side));
      const filt = (e) => (S.kind === "all" || S.kind === "files" && (e.kind === "commit" || e.kind === "outside" || e.kind === "accept") || S.kind === "agent" && e.who === "agent" || S.kind === "story" && STORY_KINDS.includes(e.kind)) && (!S.path || (e.paths || []).includes(S.path));
      const laneOf = (e) => e.kind === "mark" ? "marks" : e.who === "agent" ? "agent:" + (e.thread || "?") : e.who === "push" ? "outside" : "you";
      const keyOf = (e) => e.seq ?? "p" + P().events.indexOf(e);
      function paintBar() {
        clear(bar);
        put(
          bar,
          h("div.seg.sm", [["all", "All"], ["files", "Files"], ["agent", "Agent"], ["story", "Story"]].map(([k, l]) => h("button" + (S.kind === k ? ".on" : ""), { on: { click: () => {
            S.kind = k;
            paint();
          } } }, l))),
          S.path ? h("span.tag", S.path, h("button", { style: { background: "none", border: 0 }, on: { click: () => {
            S.path = null;
            paint();
          } } }, "\xD7")) : null,
          h("span.sp"),
          h("span.note", P() ? plural(P().events.length, "event") : ""),
          h("button.btn.sm", { on: { click: () => App.addMark() } }, "+ Mark")
        );
      }
      function paintLanes() {
        clear(svgWrap);
        const p = P();
        if (!p) return;
        const evs = p.events.filter(filt), lanes = ["you"];
        for (const e of evs) {
          const l = laneOf(e);
          if (!lanes.includes(l)) lanes.push(l);
        }
        if (lanes.includes("marks")) {
          lanes.splice(lanes.indexOf("marks"), 1);
          lanes.push("marks");
        }
        const LW = 110, DX = 14, W = Math.max(400, LW + evs.length * DX + 40), H = 26 + lanes.length * 26 + 10;
        const svg = svgEl("svg", { class: "tlsvg", width: W, height: H });
        lanes.forEach((l, i) => {
          const y = 26 + i * 26 + 13, th = l.startsWith("agent:") ? p.threads.get(l.slice(6)) : null;
          svg.appendChild(svgEl("line", { x1: LW, x2: W - 10, y1: y, y2: y, stroke: "var(--rule)" }));
          svg.appendChild(svgEl("text", { x: 10, y: y + 4, "font-size": 11, fill: "var(--ink-2)", text: l === "you" ? "You" : l === "outside" ? "Outside" : l === "marks" ? "Marks" : "Claude \xB7 " + (th && th.role || th && th.title || "thread").slice(0, 12) }));
        });
        let lastDay = "", lastLabel = -1e9;
        evs.forEach((e, k) => {
          const x = LW + 10 + k * DX, y = 26 + lanes.indexOf(laneOf(e)) * 26 + 13;
          const tm = fmtTime(e.at).slice(0, 5);
          if (k % 12 === 0 && tm !== lastDay) {
            lastDay = tm;
            svg.appendChild(svgEl("text", { x, y: 12, "font-size": 9.5, fill: "var(--ink-2)", text: tm }));
          }
          if (e.kind === "mark" && e.mk !== "auto") {
            const mc = markStyle(e)[1];
            svg.appendChild(svgEl("line", { x1: x, x2: x, y1: 16, y2: H - 4, stroke: mc, "stroke-dasharray": "3 3", opacity: 0.7 }));
            if (x - lastLabel > 96) {
              svg.appendChild(svgEl("text", { x: x + 3, y: 22, "font-size": 9.5, fill: mc, text: e.label.slice(0, 16) }));
              lastLabel = x;
            }
          }
          const c = e.kind === "mark" ? markStyle(e)[1] : KIND_STYLE[e.kind] || "var(--ink-2)", on = S.sel === keyOf(e);
          const shape = e.kind === "mark" ? e.mk === "auto" ? svgEl("path", { d: `M${x},${y - 4} L${x + 4},${y} L${x},${y + 4} L${x - 4},${y} z`, fill: "var(--bg)", stroke: c, "stroke-width": 1.2 }) : e.mk === "checkpoint" ? svgEl("rect", { x: x - 5, y: y - 5, width: 10, height: 10, fill: c }) : svgEl("path", { d: `M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} z`, fill: c }) : svgEl("circle", { cx: x, cy: y, r: on ? 6 : 4.5, fill: e.kind === "msg" || e.kind === "commit" && e.ref && e.ref !== "draft" ? "var(--bg)" : c, stroke: c, "stroke-width": 1.5 });
          const g = svgEl("g", { style: "cursor:pointer" }, svgEl("title", { text: fmtTime(e.at) + " " + label(e) }), shape);
          if (on) g.appendChild(svgEl("circle", { cx: x, cy: y, r: 9, fill: "none", stroke: "var(--ink)" }));
          g.addEventListener("click", () => {
            S.sel = keyOf(e);
            paint();
          });
          svg.appendChild(g);
        });
        svgWrap.appendChild(svg);
        svgWrap.scrollLeft = svgWrap.scrollWidth;
      }
      function paintStory() {
        clear(story);
        const p = P();
        if (!p) return;
        const evs = p.events.filter(filt).slice(-300);
        if (!evs.length) story.appendChild(h("p.empty", "Nothing yet."));
        for (const e of evs) {
          story.appendChild(h(
            "button",
            { style: S.sel === keyOf(e) ? { background: "var(--sel)" } : null, on: { click: () => {
              S.sel = keyOf(e);
              paint();
            } } },
            h("span", { style: { color: e.kind === "mark" ? markStyle(e)[1] : KIND_STYLE[e.kind] || "var(--ink-2)" } }, e.kind === "mark" ? markStyle(e)[0] : "\u25CF"),
            h("span.t", fmtTime(e.at)),
            h("span", label(e), e.who === "agent" ? h("span.note", " \xB7 Claude") : null)
          ));
        }
        const selB = story.querySelector('[style*="var(--sel)"]');
        if (selB) selB.scrollIntoView({ block: "nearest" });
      }
      function paintSide() {
        clear(side);
        const p = P();
        if (!p) return;
        const e = S.sel != null ? p.events.find((x) => keyOf(x) === S.sel) : null;
        if (e) {
          const ref = e.ref || "draft", open2 = ref === "draft" || (p.proposals.get(ref) || {}).status === "open";
          const blk = h(
            "div.block",
            h("header", h("h3", e.kind), h("span.sub", new Date(e.at).toLocaleString())),
            h(
              "dl.kv",
              h("dt", "Who"),
              h("dd", whoName(p, e)),
              h("dt", "Where"),
              h("dd", ref === "draft" ? "draft" : 'proposal "' + ((p.proposals.get(ref) || {}).title || ref) + '"'),
              e.n != null ? [h("dt", "Snapshot"), h("dd", String(e.n))] : null,
              e.paths && e.paths.length ? [h("dt", "Files"), h("dd", e.paths.slice(0, 12).map((path) => h("button.link", { style: { marginRight: "6px" }, on: { click: () => {
                S.path = path;
                paint();
              } } }, path)))] : null,
              e.note || e.label ? [h("dt", "Note"), h("dd", e.label || e.note)] : null
            )
          );
          const acts = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
          if (e.kind === "commit" && e.paths && e.paths.length === 1 && open2) acts.appendChild(h("button.btn.sm.primary", { title: "Open the file as it was right after this commit", on: { click: () => {
            if (ref !== App.ws) App.setWs(ref);
            App.viewVersion(e.paths[0], e.seq);
          } } }, "View this version"));
          if (e.thread && p.threads.get(e.thread)) acts.appendChild(h("button.btn.sm", { on: { click: () => App.showThread(e.thread) } }, "Open thread"));
          const then = e.seq != null && open2 ? snapshotAt(p, e.seq, ref) : null;
          if (then != null) {
            const where = ref === "draft" ? "draft" : "the proposal";
            acts.appendChild(h("button.btn.sm", { on: { click: () => showSince(e, ref, then) } }, "Diff since"));
            acts.appendChild(h("button.btn.sm.danger", {
              on: {
                click: async () => {
                  const n = (await changesSince(p, ref, then)).length;
                  if (!n) return toast(where[0].toUpperCase() + where.slice(1) + " is already as it was then");
                  if (!await confirmBox("Restore " + where + " to this point?", plural(n, "file") + " go back to how they were at this event (snapshot " + then + "), as one commit. That is on the timeline too, so you can return.", "Restore")) return;
                  const r = await restoreTo(p, ref, then, { who: "you", label: e.label || e.note || "event " + e.seq });
                  toast(r.status === "committed" ? "Restored " + plural(r.paths.length, "file") + " (" + ref + " " + r.n + ")" : "Not restored: " + (r.status === "conflict" ? ref + " changed meanwhile" : r.error));
                }
              }
            }, "Restore"));
          }
          blk.appendChild(acts);
          const shots = Snaps.list(p).filter((s) => s.seq === e.seq);
          if (shots.length) blk.appendChild(snapStrip(p, shots, "Frames at this point", "Click one to compare it with the page now"));
          if (e.kind === "commit" && e.paths && e.paths.length === 1) blk.appendChild(commitDiff(p, e));
          side.appendChild(blk);
        }
        const marks = p.marks();
        side.appendChild(h(
          "div.block",
          h("header", h("h3", "Marks"), h("span.sub", "yours and Claude's")),
          marks.length ? h("div.rows", marks.slice().reverse().map((m) => h("button", { on: { click: () => {
            S.sel = keyOf(m);
            paint();
          } } }, h("span", { style: { color: markStyle(m)[1] } }, markStyle(m)[0]), h("span", { style: { flex: 1 } }, m.label, m.note ? h("div.note", m.note) : null), h("span.note", markStyle(m)[2] + " \xB7 " + (m.who === "agent" ? "Claude \xB7 " : m.who === "ide" ? "" : "you \xB7 ") + fmtTime(m.at))))) : h("p.note", "Add one with + Mark; Claude marks milestones, decisions and guesses with session.mark().")
        ));
        const files2 = /* @__PURE__ */ new Map();
        for (const x of p.events) if (x.kind === "commit" || x.kind === "outside") for (const path of x.paths || []) {
          const f = files2.get(path) || { n: 0, at: 0, agent: 0 };
          f.n++;
          f.at = x.at;
          if (x.who === "agent") f.agent++;
          files2.set(path, f);
        }
        side.appendChild(h(
          "div.block",
          h("header", h("h3", "Files changed"), h("span.sub", "click to filter")),
          h("div.rows", [...files2].sort((a, b) => b[1].at - a[1].at).slice(0, 60).map(([path, f]) => h("button" + (S.path === path ? ".on" : ""), { on: { click: () => {
            S.path = S.path === path ? null : path;
            S.kind = "all";
            paint();
          } } }, h("span.mono", { style: { flex: 1, fontSize: "11.5px" } }, path), h("span.note", f.n + "\xD7" + (f.agent ? " (" + f.agent + " Claude)" : "")), h("span.note", fmtTime(f.at)))))
        ));
      }
      function commitDiff(p, e) {
        const box = h("div", h("p.note", "\u2026")), path = e.paths[0], d = p.draftOf(e.ref === "draft" || !e.ref ? "draft" : (p.proposals.get(e.ref) || {}).status === "open" ? e.ref : "draft");
        versions(p, path, e.ref || "draft").then(async (vs) => {
          const k = vs.findIndex((v) => v.seq === e.seq), cur = vs[k], before = k > 0 ? vs[k - 1] : null;
          const a = before && before.sha256 ? await d.text(before.n, path) : "", b = cur && cur.sha256 ? await d.text(cur.n, path) : "";
          clear(box).appendChild(diffView(a ?? "", b ?? ""));
        }).catch((err) => {
          clear(box).appendChild(h("p.note", "Could not read the change: " + err.message));
        });
        return box;
      }
      async function showSince(e, ref, then) {
        const ch = await changesSince(P(), ref, then), where = ref === "draft" ? "draft" : "the proposal";
        modal({
          title: (ref === "draft" ? "Draft" : "Proposal") + " since " + fmtTime(e.at) + " \xB7 " + label(e).slice(0, 40),
          wide: true,
          actions: [{ label: "Close" }],
          body: ch.length ? ch.map((c) => h("div", h("b.mono", c.path), " ", h("span.note", c.before === null ? "new" : !c.entry ? "deleted" : ""), diffView(c.before ?? "", c.after ?? ""))) : h("p", "No changes in " + where + " since then.")
        });
      }
      function paint() {
        paintBar();
        paintLanes();
        paintStory();
        paintSide();
      }
      const later = debounce(() => {
        if (Dock.visible("timeline")) paint();
      }, 200);
      App.ev.on("events", later);
      App.ev.on("project", () => {
        S.sel = null;
        S.path = null;
        later();
      });
      App.ev.on("version", (v) => {
        if (v && S.sel !== v.seq) {
          S.sel = v.seq;
          later();
        }
      });
      App.timeline = { select(seq, path) {
        S.sel = seq;
        S.kind = "all";
        S.path = path || null;
        Dock.open("timeline");
        paint();
      } };
      return { el, show: paint };
    }
  };
  function blameTitle(w) {
    const who = w.who === "agent" ? "Claude" + (w.role ? " (" + w.role + ")" : "") : w.who === "ide" ? "the bench" : w.who === "push" ? "outside the bench" : "you";
    return [who + " \xB7 " + new Date(w.at).toLocaleString(), w.request ? "asked: " + w.request : "", w.marks && w.marks.length ? w.marks.map((m) => m.kind + ": " + m.label).join(" \xB7 ") : "", w.note && !w.request ? w.note : ""].filter(Boolean).join("\n");
  }
  function blameCard(P, path, seq, a, b) {
    const w = why(P, seq);
    if (!w) return;
    const who = w.who === "agent" ? "Claude" + (w.role ? " (" + w.role + " subagent)" : "") : w.who === "ide" ? "The bench" : w.who === "push" ? "Outside the bench" : "You";
    const body = [
      h(
        "dl.kv",
        h("dt", "Who"),
        h("dd", who + (w.threadTitle ? ' \xB7 thread "' + w.threadTitle + '"' : "")),
        h("dt", "When"),
        h("dd", new Date(w.at).toLocaleString() + " (" + fmtAgo(w.at) + ")"),
        w.n != null ? [h("dt", "Snapshot"), h("dd", (w.ref || "draft") + " " + w.n)] : null,
        w.request ? [h("dt", w.delegatedBy ? "Asked by the main agent" : "Asked"), h("dd", w.request)] : null,
        w.reply ? [h("dt", "Reply"), h("dd", w.reply)] : null,
        !w.request && w.note ? [h("dt", "Note"), h("dd", w.note)] : null
      ),
      w.marks && w.marks.length ? h("div", h("div.note", "Marks from that turn"), h("ul", { style: { margin: "4px 0", paddingLeft: "18px" } }, w.marks.map((m) => h("li", h("b", m.kind + ": "), m.label, m.why ? h("span.note", " (" + m.why + ")") : null)))) : null
    ];
    modal({
      title: path + " \xB7 line" + (a === b ? " " + a : "s " + a + "\u2013" + b),
      wide: true,
      body,
      actions: [
        { label: "Close" },
        w.thread && P.threads.get(w.thread) ? { label: "Open thread", run: () => App.showThread(w.thread) } : null,
        { label: "Select on timeline", primary: true, run: () => App.timeline && App.timeline.select(seq) }
      ].filter(Boolean)
    });
  }

  // src/ui/code.js
  var isMd = (p) => /\.(md|markdown)$/i.test(p || "");
  var CODE2 = {
    title: "Code",
    sub: "files",
    make() {
      const S = { tabs: [], cur: null, filter: "", pending: null, hiLine: 0, changed: /* @__PURE__ */ new Set(), removed: [], view: {}, versions: null, blame: false, bdata: null, bkey: "" };
      const P = () => App.P;
      const list = h("div.fl"), filter = h("input.txt", { placeholder: "Filter files", style: { margin: "6px", width: "calc(100% - 12px)" }, on: { input: () => {
        S.filter = filter.value.toLowerCase();
        paintList();
      } } });
      const side = h("div.flist", h("div.toolbar", h("span.lbl", "Files"), h("span.sp"), h("button.btn.sm", { title: "New file", on: { click: newFile } }, "+ New")), filter, list);
      const tabs = h("div.ftabs");
      const gin = h("div.gin"), gutter = h("div.egutter", gin), bin = h("div.bin"), bcol = h("div.eblame", { hidden: true }, bin);
      const pre = h("pre"), band = h("div", { style: { position: "absolute", left: 0, right: 0, height: "18px", background: "var(--sel)", pointerEvents: "none", display: "none" } });
      const ta = h("textarea", { spellcheck: false, autocapitalize: "off", autocomplete: "off", wrap: "off" });
      const code = h("div.code", band, pre, ta), ed = h("div.ed", bcol, gutter, code);
      const prev = h("div.mdprev", { hidden: true }), edrow = h("div.edrow", ed, prev);
      const foot = h("div.efoot"), empty = h("p.empty", "Open a file from the list, or select an element on the canvas to jump to its source.");
      const filesBtn = h("button.btn.sm.fbtn", { title: "Show or hide the file list", on: { click: () => cv.classList.toggle("showfiles") } }, "Files");
      const main = h("div.cmain", h("div.ftop", filesBtn, tabs), edrow, foot, empty);
      const cv = h("div.cview", side, main);
      const el = h("div", cv);
      const snapOf = () => S.snap && S.snap.path === S.cur ? S.snap : null;
      const mdMode = () => isMd(S.cur) ? S.view[S.cur] || (main.clientWidth >= 640 ? "split" : "code") : "code";
      function paintPreview() {
        const m = mdMode();
        prev.hidden = m === "code";
        ed.hidden = m === "preview";
        if (m === "code") return;
        const st = prev.scrollTop;
        clear(prev).appendChild(renderMarkdown(ta.value, (f) => !!P() && P().read(f, App.ws) !== null, { doc: true }));
        prev.scrollTop = st;
      }
      const previewSoon = debounce(paintPreview, 150);
      prev.addEventListener("click", (e) => {
        const r = e.target.closest("[data-file]");
        if (r) {
          e.preventDefault();
          isMd(r.dataset.file) ? open2(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1);
        }
      });
      async function refreshChanged() {
        const p = P(), ws = App.ws;
        if (!p || ws === "draft") {
          S.changed = /* @__PURE__ */ new Set();
          S.removed = [];
          return;
        }
        const ch = await p.changes(ws).catch(() => []);
        if (P() !== p || App.ws !== ws) return;
        S.changed = new Set(ch.map((c) => c.path));
        S.removed = ch.filter((c) => !c.entry).map((c) => c.path);
        paintList();
      }
      function paintList() {
        clear(list);
        if (!P()) return;
        let dir = null;
        for (const path of P().list(App.ws)) {
          if (S.filter && !path.toLowerCase().includes(S.filter)) continue;
          const d = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          if (d !== dir) {
            dir = d;
            if (d) list.appendChild(h("div.fi.dir", d + "/"));
          }
          list.appendChild(h("button.fi" + (path === S.cur ? ".on" : ""), { title: path, on: { click: () => open2(path) } }, d ? path.slice(d.length + 1) : path, S.changed.has(path) ? h("span.ch", "M") : null));
        }
        for (const path of S.removed) list.appendChild(h("button.fi", { disabled: true, style: { textDecoration: "line-through", opacity: 0.6 } }, path));
      }
      function paintTabs() {
        clear(tabs);
        for (const p of S.tabs) tabs.appendChild(h("span.ftab" + (p === S.cur ? ".on" : ""), h("button", { on: { click: () => open2(p) } }, p.split("/").pop()), h("button.x", { title: "Close", on: { click: () => closeTab(p) } }, "\xD7")));
      }
      function closeTab(p) {
        commit();
        S.tabs = S.tabs.filter((x) => x !== p);
        if (S.cur === p) S.cur = S.tabs[S.tabs.length - 1] || null;
        load();
        paintTabs();
        paintList();
      }
      function paintCode() {
        pre.innerHTML = highlight(S.cur, ta.value) + "\n";
        const n = ta.value.split("\n").length;
        let s = "";
        const errs = /* @__PURE__ */ new Map();
        for (const d of S.tdiags || []) if (d.file === S.cur) errs.set(d.line, (errs.has(d.line) ? errs.get(d.line) + "\n" : "") + d.message);
        for (let i = 1; i <= n; i++) {
          const cls = [i === S.hiLine ? "hit" : "", errs.has(i) ? "terr" : ""].filter(Boolean).join(" ");
          s += "<div" + (cls ? ' class="' + cls + '"' : "") + (errs.has(i) ? ' title="' + escHtml(errs.get(i)) + '"' : "") + ">" + i + "</div>";
        }
        gin.innerHTML = s;
        paintBlame();
        scroll();
      }
      function scroll() {
        pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
        gin.style.transform = bin.style.transform = `translateY(${-ta.scrollTop}px)`;
        if (S.hiLine) band.style.top = 10 + (S.hiLine - 1) * 18 - ta.scrollTop + "px";
      }
      async function loadBlame() {
        const p = P(), key = S.cur + "|" + App.ws + "|" + p.draftOf(App.ws).head;
        if (S.bkey === key) return;
        S.bkey = key;
        S.bdata = null;
        try {
          const at = await blame(p, S.cur, App.ws);
          if (S.bkey === key) {
            S.bdata = at;
            paintBlame();
          }
        } catch {
        }
      }
      function paintBlame() {
        bcol.hidden = !S.blame || !S.cur || !P() || !!snapOf();
        if (bcol.hidden) return;
        if (!S.bdata) {
          loadBlame();
          bin.innerHTML = '<div class="u">\u2026</div>';
          return;
        }
        const p = P(), at = S.bdata, n = ta.value.split("\n").length, saved = p.draftOf(App.ws).read(S.cur);
        const ids = [...new Set(at.filter((x) => x != null))].sort((a, b) => a - b), rank = new Map(ids.map((x, k) => [x, ids.length > 1 ? k / (ids.length - 1) : 1]));
        let s = "", last = null;
        for (let k = 0; k < n; k++) {
          const seq = ta.value === saved ? at[k] : k < at.length ? at[k] : void 0, e = seq != null ? p.event(seq) : null;
          if (!e) {
            s += '<div class="u">' + (last === "u" ? "" : seq === void 0 && ta.value !== saved ? "unsaved" : "earlier") + "</div>";
            last = "u";
            continue;
          }
          const who2 = e.who === "agent" ? "Claude" : e.who === "ide" ? "bench" : e.who === "push" ? "outside" : "you", head = seq !== last;
          s += '<div class="' + (head ? "h" : "c") + '" data-seq="' + seq + '" style="--age:' + (0.25 + 0.75 * rank.get(seq)).toFixed(2) + '">' + (head ? escHtml(who2 + " \xB7 " + fmtAgo(e.at)) : "") + "</div>";
          last = seq;
        }
        bin.innerHTML = s;
      }
      bin.addEventListener("click", (ev) => {
        const d = ev.target.closest("[data-seq]");
        if (!d) return;
        const rows = [...bin.children], k = rows.indexOf(d);
        let a = k;
        while (a > 0 && rows[a - 1].dataset.seq === d.dataset.seq) a--;
        let b = k;
        while (b < rows.length - 1 && rows[b + 1].dataset.seq === d.dataset.seq) b++;
        blameCard(P(), S.cur, +d.dataset.seq, a + 1, b + 1);
      });
      bin.addEventListener("mouseover", (ev) => {
        const d = ev.target.closest("[data-seq]");
        if (!d || d.title) return;
        const w = why(P(), +d.dataset.seq);
        if (w) d.title = blameTitle(w);
      });
      async function loadVersions() {
        const path = S.cur, ws = App.ws;
        S.versions = null;
        S.vhead = P().draftOf(ws).head;
        try {
          const v = await versions(P(), path, ws);
          if (S.cur === path && App.ws === ws) {
            S.versions = v;
            paintFoot();
          }
        } catch {
        }
      }
      function paintFoot() {
        clear(foot);
        if (!S.cur || !P()) return;
        if (snapOf()) return paintHistFoot();
        const ws = App.ws, prop = App.proposal(), d = P().draftOf(ws), nv = S.versions ? S.versions.length : 0;
        const pos = ta.value.slice(0, ta.selectionStart).split("\n");
        const conflict = d.conflict && d.conflict.conflicts.includes(S.cur) ? d.conflict : null;
        const terrs = (S.tdiags || []).filter((x) => x.file === S.cur);
        put(
          foot,
          h("b", S.cur),
          h("span", "Ln " + pos.length + ", Col " + (pos[pos.length - 1].length + 1)),
          h("span", prop ? 'editing proposal "' + prop.title + '"' : "editing draft"),
          S.tdiags ? h("button.link" + (terrs.length ? ".terr" : ""), { title: "TypeScript errors in this file (and in the app)", on: { click: (ev) => typeMenu(ev.currentTarget) } }, terrs.length ? plural(terrs.length, "type error") : "types ok", S.tdiags.length > terrs.length ? " (" + S.tdiags.length + " in the app)" : "") : null,
          S.tinfo ? h("span.mono.tinfo", { title: S.tinfo }, S.tinfo.length > 70 ? S.tinfo.slice(0, 70) + "\u2026" : S.tinfo) : null,
          S.pending || d.edits && d.edits.changes.has(S.cur) ? h("span", conflict ? "" : "saving\u2026") : null,
          S.trace ? h(
            "span",
            { style: { color: S.trace.elements ? "var(--a1)" : "" } },
            "\u21B3 " + (S.trace.selector ? S.trace.selector.slice(0, 30) + " matches " : "renders ") + plural(S.trace.elements, "element") + (S.trace.elements ? " in " + plural(S.trace.frames, "frame") : ""),
            " ",
            h("button.link", { title: "Clear the outlines (Esc)", on: { click: () => {
              App.trace(null);
              S.trace = null;
              paintFoot();
            } } }, "\xD7")
          ) : null,
          h("span.sp"),
          isMd(S.cur) ? h("div.seg.sm", [["code", "Code"], ["split", "Split"], ["preview", "Preview"]].map(([v, l]) => h("button" + (mdMode() === v ? ".on" : ""), { on: { click: () => {
            S.view[S.cur] = v;
            paintPreview();
            paintFoot();
          } } }, l))) : null,
          isMd(S.cur) ? h("button.btn.sm", { on: { click: () => App.openDoc(S.cur) } }, "Open in Docs") : null,
          prop && S.changed.has(S.cur) ? h("button.btn.sm", { title: "Put back draft's version of this file in the proposal", on: { click: revertToDraft } }, "Revert to draft") : null,
          nv > 1 ? h("div.rel", h("button.btn.sm", { title: "Earlier versions of this file, from the timeline", on: { click: (e) => historyMenu(e.currentTarget) } }, "History " + nv)) : null,
          h("button.btn.sm" + (S.blame ? ".on" : ""), { title: "Who last changed each line, and why", on: { click: () => {
            S.blame = !S.blame;
            paintBlame();
            paintFoot();
          } } }, "Blame"),
          h("button.btn.sm", { on: { click: () => App.askAgent("About " + S.cur + " line " + pos.length + ": ") } }, "Ask agent"),
          h("button.btn.sm.danger", { on: { click: async () => {
            if (await confirmBox("Delete " + S.cur + "?", prop ? "The deletion goes into the proposal." : "This removes the file from draft. Its history stays on the timeline.", "Delete")) {
              P().remove(S.cur, App.ws);
              closeTab(S.cur);
            }
          } } }, "Delete")
        );
        if (conflict) foot.appendChild(h(
          "div.conflict",
          { style: { flexBasis: "100%", color: "var(--accent)" } },
          "Your edit conflicts with " + d.ref + " " + conflict.at + ": someone else changed " + S.cur + " too. ",
          h("button.btn.sm", { title: "Commit your version over theirs", on: { click: async () => {
            const r = await d.keepMine();
            toast(r.status === "committed" ? "Your version is in " + d.ref + " " + r.n : "Still not committed: " + (r.error || r.status));
            load(true);
          } } }, "Keep mine"),
          " ",
          h("button.btn.sm", { title: "Drop your edit and show theirs", on: { click: async () => {
            await d.takeTheirs([S.cur]);
            load(false);
          } } }, "Take theirs")
        ));
      }
      function revertToDraft() {
        const text = P().read(S.cur, "draft");
        if (text === null) P().remove(S.cur, App.ws);
        else P().write(S.cur, text, App.ws);
        load(true);
      }
      function load(keepView) {
        const snap = snapOf(), has = !!S.cur && !!P() && (!!snap || P().read(S.cur, App.ws) !== null);
        edrow.hidden = foot.hidden = !has;
        empty.hidden = has;
        cv.classList.toggle("hasfile", has);
        ta.readOnly = !!snap;
        edrow.classList.toggle("hist", !!snap);
        foot.classList.toggle("hist", !!snap);
        if (!has) return;
        const st = ta.scrollTop, sl = ta.scrollLeft, ss = ta.selectionStart, se = ta.selectionEnd;
        ta.value = snap ? snap.text ?? "" : P().read(S.cur, App.ws);
        if (keepView) {
          ta.scrollTop = st;
          ta.scrollLeft = sl;
          ta.setSelectionRange(Math.min(ss, ta.value.length), Math.min(se, ta.value.length));
        } else {
          ta.scrollTop = 0;
          ta.scrollLeft = 0;
        }
        paintCode();
        paintFoot();
        paintPreview();
      }
      function open2(path, line, keepSnap) {
        commit();
        if (!keepSnap && S.snap) S.snap = null;
        if (!S.tabs.includes(path)) S.tabs.push(path);
        const same = S.cur === path;
        S.cur = path;
        S.bkey = "";
        S.bdata = null;
        cv.classList.remove("showfiles");
        paintTabs();
        paintList();
        load(same);
        if (!same) loadVersions();
        if (line) goto(line);
      }
      const typeView = () => {
        const d = P().draftOf(App.ws);
        return d.edits && d.edits.open ? d.edits : headView(d);
      };
      const typesSoon = debounce(async () => {
        const p = P();
        if (!p || S.snap) return;
        const view = typeView();
        if (!Types.wants(view)) {
          if (S.tdiags) {
            S.tdiags = null;
            paintCode();
            paintFoot();
            App.setTypeErrors([]);
          }
          return;
        }
        const r = await Types.check(p, view, { timeoutMs: 2e4, ref: App.ws });
        if (r.skipped || P() !== p) return;
        S.tdiags = r.diags;
        paintCode();
        paintFoot();
        App.setTypeErrors(r.diags);
      }, 500);
      const infoSoon = debounce(async () => {
        const p = P(), path = S.cur;
        if (!p || !path || S.snap || !/\.(ts|tsx|mts|cts)$/.test(path) || !S.tdiags) {
          if (S.tinfo) {
            S.tinfo = "";
            paintFoot();
          }
          return;
        }
        const i = await Types.info(p, typeView(), path, ta.selectionStart, App.ws);
        if (S.cur !== path) return;
        S.tinfo = i ? i.text : "";
        paintFoot();
      }, 300);
      function typeMenu(anchor) {
        const all = S.tdiags || [];
        if (!all.length) return toast("No type errors");
        popMenu(anchor, all.slice(0, 40).map((d) => ({ label: d.file + ":" + d.line + " " + d.message.split("\n")[0].slice(0, 90), sub: d.program, run: () => d.file === S.cur ? goto(d.line) : open2(d.file, d.line) })));
      }
      function goto(line) {
        const off = offsetOfLine(ta.value, line);
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(off, off);
        ta.scrollTop = Math.max(0, (line - 1) * 18 - ta.clientHeight / 3);
        S.hiLine = line;
        band.style.display = "";
        paintCode();
        clearTimeout(S.hiT);
        S.hiT = setTimeout(() => {
          S.hiLine = 0;
          band.style.display = "none";
          paintCode();
        }, 2600);
      }
      const commitSoon = debounce(() => commit(), 300);
      function commit() {
        if (!S.pending || !P()) return;
        const { path, ws, text } = S.pending;
        S.pending = null;
        try {
          P().write(path, text, ws);
        } catch (e) {
          toast(e.message);
        }
        paintFoot();
        typesSoon();
      }
      ta.addEventListener("input", () => {
        S.pending = { path: S.cur, ws: App.ws, text: ta.value };
        paintCode();
        commitSoon();
        if (isMd(S.cur)) previewSoon();
      });
      ta.addEventListener("scroll", scroll);
      ta.addEventListener("keyup", () => {
        paintFoot();
        traceSoon();
        infoSoon();
      });
      ta.addEventListener("click", () => {
        paintFoot();
        traceSoon();
        infoSoon();
      });
      const traceSoon = debounce(async () => {
        let t = null;
        if (S.cur && !S.snap && document.activeElement === ta) {
          const off = ta.selectionStart, line = ta.value.slice(0, off).split("\n").length;
          if (/\.html?$/i.test(S.cur)) t = { file: S.cur, line };
          else if (/\.css$/i.test(S.cur)) {
            const b = cssBlocks(ta.value).find((b2) => off >= b2.selStart && off <= b2.bodyEnd + 1);
            if (b && b.sel) t = { selector: b.sel.replace(/\s+/g, " ").trim(), file: S.cur };
          }
        }
        if (!t && !App.traceTarget) return;
        S.trace = await App.trace(t);
        paintFoot();
      }, 200);
      App.ev.on("trace", () => {
        S.trace = null;
        paintFoot();
      });
      ta.addEventListener("blur", () => commit());
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const s = ta.selectionStart;
          ta.setRangeText("  ", s, ta.selectionEnd, "end");
          ta.dispatchEvent(new Event("input"));
        }
        if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          P().draftOf(App.ws).settle();
          toast("Saved");
        }
      });
      async function newFile() {
        const p = await promptBox("New file", "Its path, like about.html or css/theme.css", "");
        if (!p) return;
        const bad = checkPath(p);
        if (bad) return toast(bad);
        if (P().read(p, App.ws) !== null) return open2(p);
        const tpl = isMd(p) ? "# " + p.replace(/\.md$/i, "").split("/").pop() + "\n\n" : /\.html?$/.test(p) ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + p + "</title>\n</head>\n<body>\n  <h1>" + p + "</h1>\n</body>\n</html>\n" : "";
        P().write(p, tpl, App.ws);
        open2(p);
      }
      Watch.ev.on("status", (st) => {
        const k = App.ws + "|" + devKey(st, App.ws);
        if (k !== S.devKey) {
          S.devKey = k;
          typesSoon();
        }
      });
      App.ev.on("project", () => {
        S.tabs = [];
        S.cur = null;
        S.pending = null;
        S.snap = null;
        S.tdiags = null;
        S.tinfo = "";
        paintTabs();
        paintList();
        load();
        refreshChanged();
        typesSoon();
      });
      App.ev.on("ws", () => {
        commit();
        S.bkey = "";
        S.bdata = null;
        paintList();
        load(true);
        refreshChanged();
        if (S.cur) loadVersions();
        typesSoon();
      });
      const changedSoon = debounce(refreshChanged, 400);
      App.ev.on("files", (ws, paths) => {
        if (ws !== App.ws) return;
        paintList();
        changedSoon();
        typesSoon();
        if (S.snap) {
          paintFoot();
          return;
        }
        const mine = S.cur && (!paths.length || paths.includes(S.cur));
        if (mine && S.vhead !== P().draftOf(ws).head) {
          S.bkey = "";
          S.bdata = null;
          loadVersions();
          paintBlame();
        }
        if (mine && !S.pending && P().read(S.cur, ws) !== ta.value) load(true);
        else paintFoot();
      });
      const who = (v) => v.who === "agent" ? "Claude" : v.who === "push" ? "outside" : "you";
      const vlabel = (v) => v.observed ? (v.sha256 ? "as it was" : "gone") + " at " + v.n + ", seen at " + v.kind : (v.sha256 ? "saved" : "removed") + " by " + who(v) + " in " + v.n;
      async function showVersion(path, seq) {
        const list2 = await versions(P(), path, App.ws);
        if (!list2.length) return toast("No saved versions of " + path);
        const v = list2.find((x) => x.seq === seq) || list2[list2.length - 1];
        commit();
        const text = v.sha256 ? await P().draftOf(App.ws).text(v.n, path) : null;
        S.snap = { path, ...v, text, list: list2 };
        if (!S.tabs.includes(path)) S.tabs.push(path);
        S.cur = path;
        paintTabs();
        paintList();
        load(false);
        App.ev.emit("version", { path, seq: v.seq });
      }
      function historyMenu(btn) {
        const list2 = S.versions || [];
        popMenu(btn, [{ group: S.cur + " \xB7 " + plural(list2.length, "version") }, ...list2.slice().reverse().slice(0, 40).map((v, k) => ({
          label: (k === 0 ? "Latest \xB7 " : "") + fmtTime(v.at),
          sub: vlabel(v) + (v.note ? " \xB7 " + v.note.slice(0, 40) : ""),
          run: () => showVersion(S.cur, v.seq)
        }))], { right: true });
      }
      function paintHistFoot() {
        const s = S.snap, k = s.list.findIndex((x) => x.seq === s.seq), cur = P().read(s.path, App.ws);
        const same = cur === s.text, latest = k === s.list.length - 1;
        put(
          foot,
          h("b", s.path),
          h("span", "version " + (k + 1) + " of " + s.list.length + " \xB7 " + fmtTime(s.at) + " \xB7 " + vlabel(s)),
          s.note ? h("span", s.note.slice(0, 60)) : null,
          h("span.sp"),
          h("button.btn.sm", { disabled: k <= 0, title: "Older version", on: { click: () => showVersion(s.path, s.list[k - 1].seq) } }, "\u25C0"),
          h("button.btn.sm", { disabled: latest, title: "Newer version", on: { click: () => showVersion(s.path, s.list[k + 1].seq) } }, "\u25B6"),
          h("button.btn.sm", { disabled: same, on: { click: () => modal({ title: s.path + ": " + fmtTime(s.at) + " \u2192 current", wide: true, body: diffView(s.text ?? "", cur ?? ""), actions: [{ label: "Close" }] }) } }, "Diff vs current"),
          h("button.btn.sm", { disabled: same || s.text === null, on: { click: () => {
            P().write(s.path, s.text, App.ws);
            S.snap = null;
            load(true);
            toast("Restored " + s.path);
          } } }, "Restore this version"),
          h("button.btn.sm.primary", { on: { click: () => {
            S.snap = null;
            load(false);
            App.ev.emit("version", null);
          } } }, "Back to current")
        );
      }
      App.ev.on("sel", (s) => {
        if (s && s.src && Dock.visible("code")) {
          const [f, l] = s.src.split(":");
          if (P().read(f, App.ws) !== null) open2(f, +l);
        }
      });
      App.code = { open: open2, showVersion };
      return { el, show: () => {
        paintList();
        load(true);
        refreshChanged();
      } };
    }
  };
  var DOCS = {
    title: "Docs",
    sub: "markdown files",
    make() {
      const S = { cur: null };
      const P = () => App.P;
      const list = h("div.fl"), outline = h("div.fl.outline");
      const side = h("div.flist", h("div.toolbar", h("span.lbl", "Docs"), h("span.sp"), h("button.btn.sm", { title: "New markdown file", on: { click: newDoc } }, "+ New")), list, h("div.toolbar", { style: { borderTop: "1px solid var(--hair)" } }, h("span.lbl", "Outline")), outline);
      const head = h("div.toolbar"), body = h("div.scroll.docbody");
      const el = h("div", h("div.cview", side, h("div.cmain", head, body)));
      const docs = () => P() ? P().list(App.ws).filter(isMd) : [];
      function paint() {
        const all = docs();
        if (!S.cur || !all.includes(S.cur)) S.cur = all.find((p) => /(^|\/)readme\.md$/i.test(p)) || all[0] || null;
        clear(list);
        for (const p of all) list.appendChild(h("button.fi" + (p === S.cur ? ".on" : ""), { title: p, on: { click: () => {
          S.cur = p;
          paint();
        } } }, p));
        clear(head);
        clear(body);
        clear(outline);
        if (!S.cur) {
          body.appendChild(h(
            "div.empty",
            h("p", { style: { margin: "0 0 10px" } }, "No markdown files in this app yet. Notes, specs and READMEs written as .md files show here, rendered."),
            h("button.btn.sm", { on: { click: () => newDoc("README.md") } }, "Create README.md")
          ));
          return;
        }
        const text = P().read(S.cur, App.ws) || "";
        put(
          head,
          h("b", S.cur),
          h("span.note", text.split("\n").length + " lines" + (App.ws !== "draft" ? " \xB7 proposal" : "")),
          h("span.sp"),
          h("button.btn.sm", { on: { click: () => App.askAgent("About " + S.cur + ": ") } }, "Ask agent"),
          h("button.btn.sm", { on: { click: () => App.reveal(S.cur, 1) } }, "Edit")
        );
        const doc = renderMarkdown(text, (f) => P().read(f, App.ws) !== null, { doc: true });
        doc.classList.add("doc");
        body.appendChild(doc);
        for (const hd of doc.querySelectorAll("[data-level]")) outline.appendChild(h("button.fi", { style: { paddingLeft: 10 + (hd.dataset.level - 1) * 12 + "px", fontFamily: "var(--ui)" }, on: { click: () => hd.scrollIntoView({ block: "start", behavior: "smooth" }) } }, hd.textContent));
      }
      body.addEventListener("click", (e) => {
        const r = e.target.closest("[data-file]");
        if (!r) return;
        e.preventDefault();
        if (isMd(r.dataset.file)) {
          S.cur = r.dataset.file;
          paint();
          body.scrollTop = 0;
        } else App.reveal(r.dataset.file, +r.dataset.line || 1);
      });
      async function newDoc(name) {
        const p = typeof name === "string" ? name : await promptBox("New doc", "Path, like NOTES.md or docs/plan.md", "NOTES.md");
        if (!p) return;
        const path = isMd(p) ? p : p + ".md", bad = checkPath(path);
        if (bad) return toast(bad);
        if (P().read(path, App.ws) === null) P().write(path, "# " + path.replace(/\.md$/i, "").split("/").pop() + "\n\n", App.ws);
        S.cur = path;
        paint();
        App.reveal(path, 3);
      }
      const later = debounce(() => {
        if (Dock.visible("docs")) paint();
      }, 200);
      App.ev.on("files", (ws, paths) => {
        if (!paths.length || paths.some(isMd)) later();
      });
      App.ev.on("ws", later);
      App.ev.on("project", () => {
        S.cur = null;
        later();
      });
      App.docs = { open(path) {
        S.cur = path;
        paint();
      } };
      return { el, show: paint };
    }
  };

  // src/ui/console.js
  var CONSOLE = {
    title: "Console",
    sub: "logs",
    badge: () => {
      const n = App.logs.filter((l) => l.level === "error" && !l.seen).length;
      return n ? h("span.count.bad", String(n)) : null;
    },
    make() {
      const S = { level: "all" };
      const out = h("div.clog");
      const seg = h("div.seg.sm", ["all", "error", "warn"].map((l) => h("button" + (l === S.level ? ".on" : ""), { on: { click: () => {
        S.level = l;
        [...seg.children].forEach((b) => b.classList.toggle("on", b.textContent.toLowerCase().startsWith(l === "all" ? "all" : l)));
        paint();
      } } }, l === "all" ? "All" : l === "error" ? "Errors" : "Warnings")));
      const el = h("div", h("div.toolbar", seg, h("span.sp"), h("button.btn.sm", { on: { click: () => {
        App.logs.length = 0;
        paint();
        Dock.refreshTabs();
      } } }, "Clear")), out);
      function row(l) {
        const [f, ln] = (l.src || "").split(":");
        return h("div." + l.level, h("span.t", fmtTime(l.t)), h("span.s", { title: l.frame }, l.frame), h("span", l.text, l.src && f ? [" ", h("button.link.note", { on: { click: () => App.reveal(f, +ln || 1) } }, l.src)] : null));
      }
      function paint() {
        clear(out);
        const ls = App.logs.filter((l) => S.level === "all" || l.level === S.level);
        for (const l of ls.slice(-400)) out.appendChild(row(l));
        if (!ls.length) out.appendChild(h("p.empty", "Nothing logged. Page console output and errors from every frame land here."));
        out.scrollTop = out.scrollHeight;
        if (Dock.visible("console")) {
          App.logs.forEach((l) => {
            l.seen = true;
          });
          Dock.refreshTabs();
        }
      }
      App.ev.on("log", (l) => {
        if (!Dock.visible("console")) {
          Dock.refreshTabs();
          return;
        }
        if (S.level !== "all" && l.level !== S.level) return;
        if (out.querySelector(".empty")) clear(out);
        l.seen = true;
        out.appendChild(row(l));
        if (out.children.length > 400) out.firstChild.remove();
        out.scrollTop = out.scrollHeight;
      });
      App.ev.on("project", paint);
      return { el, show: paint };
    }
  };
  var EVAL = {
    title: "Eval",
    sub: "run the API yourself",
    make() {
      const ta = h("textarea.txt.mono", { spellcheck: false, style: { width: "100%", minHeight: "120px", resize: "vertical", fontSize: "12px", lineHeight: "18px" } });
      ta.value = `// The agent's only tool: an async function body, run in a QuickJS sandbox,
// as one transaction on the viewed workspace. The host API is in scope
// (files, app, frames, scenarios, session, ui, lib). Return a value.
const list = await files.list()
const issues = await frames.check()
return { files: list.map(f => f.path), issues }`;
      const res = h("div.scroll"), engine = h("span.note");
      const run = async () => {
        if (!App.P) return;
        const code = ta.value, t0 = now();
        const card = h("div.block", h("header", h("h3", "Running\u2026"), h("span.sub", fmtTime(t0))));
        res.prepend(card);
        const P = App.P, ws = App.ws;
        const r = await runEval(makeContext(P, { ws, who: "you", mode: "auto" }), code, { sid: "repl:" + P.app, restore: P.meta.replScope && P.meta.replScope.vars });
        if (r.scope) {
          P.meta.replScope = r.scope;
          P.saveMeta();
          if (App.P === P) paintScope();
        }
        clear(card);
        if (r.effects) card.appendChild(h("div.fx", effectsLine(r.effects)));
        put(
          card,
          h(
            "header",
            h("h3", { style: { color: r.ok ? "" : "var(--accent)" } }, r.ok ? "ok" : r.error.kind),
            h("span.sub", (r.ms ?? "?") + " ms \xB7 " + (r.engine || "") + " \xB7 " + (ws === "draft" ? "draft" : "proposal") + (App.P !== P ? " \xB7 " + P.app : "")),
            h("span.sp"),
            h("button.btn.sm", { on: { click: () => {
              ta.value = code;
              ta.focus();
            } } }, "Edit again")
          ),
          r.ok ? h("pre.mono.yaml", { style: { margin: 0, whiteSpace: "pre-wrap", fontSize: "11.5px", maxHeight: "420px", overflow: "auto" }, html: hlYAML(toYAML(r.value)) }) : h("pre.mono", { style: { margin: 0, whiteSpace: "pre-wrap", fontSize: "11.5px" } }, r.error.message + (r.error.line ? "\n(line " + r.error.line + ")" : "")),
          r.logs && r.logs.length ? h("pre.mono.note", { style: { margin: 0, whiteSpace: "pre-wrap" } }, r.logs.map((l) => l.level + ": " + l.text).join("\n")) : null
        );
        P.log({ kind: "eval", who: "you", ref: ws, ok: r.ok, note: (code.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) || "").trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12), n: r.effects && r.effects.commit ? r.effects.commit.n : void 0 });
      };
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          run();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        }
      });
      const refText = h("pre.mono", { style: { whiteSpace: "pre-wrap", fontSize: "11px", margin: 0 } });
      const ref = h("details.block", { on: { toggle: () => {
        if (ref.open && App.P) refText.textContent = guide(App.P, API);
      } } }, h("summary", { style: { cursor: "pointer", fontWeight: 700 } }, "What the agent is told (with the API reference)"), refText);
      const paintEngine = () => {
        engine.textContent = "Sandbox: " + ({ quickjs: "QuickJS (wasm) in a worker", worker: "worker realm (QuickJS failed to load)", loading: "starting\u2026", off: "unavailable here" }[Sandbox.engine] || Sandbox.engine);
      };
      Sandbox.ev.on("engine", paintEngine);
      paintEngine();
      const scopeLine = h("div.toolbar", { style: { minHeight: "30px", fontSize: "var(--fs-xs)" } });
      function paintScope() {
        clear(scopeLine);
        const P = App.P;
        if (!P) return;
        const sc = P.meta.replScope, vars = sc && sc.vars ? Object.keys(sc.vars) : [], lib = libEntries(P.view(App.ws));
        put(
          scopeLine,
          h("span.lbl", "Scope"),
          h("span.mono", vars.length ? vars.join(", ") : "empty (top-level const/let/function persist between runs)"),
          lib.length ? [h("span.lbl", "lib"), h("span.mono", lib.map((l) => l.name).join(", "))] : null,
          h("span.sp"),
          vars.length ? h("button.btn.sm", { on: { click: () => {
            P.meta.replScope = null;
            P.saveMeta();
            Sandbox.drop("repl:" + P.app);
            paintScope();
          } } }, "Reset scope") : null
        );
      }
      App.ev.on("project", paintScope);
      App.ev.on("files", (ws, paths) => {
        if (!paths.length || paths.some((p) => p.startsWith(LIB_DIR))) paintScope();
      });
      const el = h(
        "div",
        h("div.toolbar", h("button.btn.sm.primary", { on: { click: run } }, "Run \u2318\u21B5"), engine, h("span.sp"), h("button.btn.sm", { on: { click: () => clear(res) } }, "Clear")),
        scopeLine,
        h("div", { style: { padding: "8px 10px", borderBottom: "1px solid var(--hair)" } }, ta),
        ref,
        res
      );
      return { el, show: () => {
        if (!Sandbox.worker) Sandbox.spawn();
        paintScope();
      } };
    }
  };

  // src/ui/data.js
  var TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name";
  var cell = (v) => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  var DATA = {
    title: "Data",
    sub: "your instances' data",
    make() {
      const S = { kind: "dev", tables: [], cur: null, rows: null, query: "", coll: "", docs: null, error: "", seq: 0 };
      const P = () => App.P;
      const tl = h("div.tlist"), head = h("div.toolbar"), grid = h("div.scroll");
      const el = h("div", h("div.dview", tl, h("div.cmain", head, grid)));
      const call = (action, args) => Slop.call(action, { app: P().app, kind: S.kind, ...S.kind === "prop" ? { ref: App.ws } : {}, ...args });
      async function loadTables() {
        const my = ++S.seq;
        try {
          S.tables = (await call("sql", { query: TABLES, args: [] })).map((r) => r.name);
          S.error = "";
        } catch (e) {
          S.tables = [];
          S.error = e.message || String(e);
        }
        if (my !== S.seq) return;
        if (S.cur && !S.tables.includes(S.cur)) S.cur = null;
        if (!S.cur && !S.query && !S.coll) S.cur = S.tables[0] || null;
        if (S.cur) await loadRows();
        else paint();
      }
      async function loadRows() {
        const my = ++S.seq;
        const q = S.query || 'SELECT rowid AS __rowid, * FROM "' + S.cur + '" LIMIT 300';
        try {
          S.rows = await call("sql", { query: q, args: [] });
          S.error = "";
        } catch (e) {
          if (!S.query) {
            try {
              S.rows = await call("sql", { query: 'SELECT * FROM "' + S.cur + '" LIMIT 300', args: [] });
              S.error = "";
            } catch (e2) {
              S.rows = null;
              S.error = e2.message || String(e2);
            }
          } else {
            S.rows = null;
            S.error = e.message || String(e);
          }
        }
        if (my === S.seq) paint();
      }
      async function loadDocs() {
        const my = ++S.seq;
        try {
          S.docs = await call("docs", { coll: S.coll });
          S.error = "";
        } catch (e) {
          S.docs = null;
          S.error = e.message || String(e);
        }
        if (my === S.seq) paint();
      }
      function paint() {
        clear(tl);
        clear(head);
        clear(grid);
        if (!P()) return;
        const kinds = [["dev", "Draft", "Your dev instance: the draft, what the canvas shows on draft"], ...App.ws !== "draft" ? [["prop", "Proposal", "The proposal's preview: what the canvas shows while you look at the proposal"]] : [], ["test", "Test", "Your test instance: where the last scenario ran"]];
        tl.appendChild(h("div.seg.sm", { style: { margin: "6px" } }, kinds.map(([k, l, t]) => h("button" + (S.kind === k ? ".on" : ""), { title: t, on: { click: () => {
          S.kind = k;
          S.cur = null;
          S.rows = null;
          S.docs = null;
          loadTables();
        } } }, l))));
        tl.appendChild(h("div.fi.dir", "Tables"));
        for (const t of S.tables) tl.appendChild(h("button.fi" + (t === S.cur && !S.query && !S.coll ? ".on" : ""), { on: { click: () => {
          S.cur = t;
          S.query = "";
          S.coll = "";
          loadRows();
        } } }, t));
        if (!S.tables.length) tl.appendChild(h("div.note", { style: { padding: "0 10px" } }, "No tables: the app has no migrations, or this instance has not run yet."));
        tl.appendChild(h("div.fi.dir", "Documents"));
        tl.appendChild(h("button.fi" + (S.coll ? ".on" : ""), { on: { click: async () => {
          const c = await promptBox("Documents", "A collection of the app's db", S.coll || "notes");
          if (c) {
            S.coll = c;
            S.query = "";
            loadDocs();
          }
        } } }, S.coll ? "collection " + S.coll : "a collection\u2026"));
        tl.appendChild(h("button.fi", { style: { color: "var(--ink-2)" }, on: { click: async () => {
          const q = await promptBox("Query", "Read-only SQL on this instance", S.query || "SELECT * FROM " + (S.cur || "notes") + " LIMIT 50");
          if (q) {
            S.query = q;
            S.coll = "";
            loadRows();
          }
        } } }, "SQL query\u2026"));
        put(
          head,
          h("b", S.coll ? "collection " + S.coll : S.query ? "query" : S.cur || ""),
          h("span.tag", S.kind + " instance"),
          h("span.sp"),
          h("div.rel", h("button.btn.sm", { title: "Add a fixture's documents and rows to the dev instance", disabled: S.kind !== "dev", on: { click: (e) => seedMenu(e.currentTarget) } }, "Seed from fixture")),
          !S.coll && S.rows && S.rows.length && S.cur && !S.query ? h("button.btn.sm", { title: "Save these rows in a fixture: scenarios can start from it", on: { click: saveFixture } }, "Save as fixture") : null,
          h("button.btn.sm", { on: { click: () => S.coll ? loadDocs() : loadTables() } }, "Refresh"),
          S.kind === "dev" ? h("button.btn.sm.danger", { on: { click: () => App.resetDev().then(() => setTimeout(loadTables, 800)) } }, "Reset dev data") : null
        );
        if (S.query) grid.appendChild(h("pre.mono.note", { style: { margin: "6px 10px" } }, S.query));
        if (S.error) {
          grid.appendChild(h("p.empty", { style: { color: "var(--accent)" } }, S.error));
          return;
        }
        if (S.coll) {
          if (!S.docs) return;
          if (!S.docs.length) {
            grid.appendChild(h("p.empty", "No documents in " + S.coll + "."));
            return;
          }
          grid.appendChild(h("div.rows", { style: { padding: "6px 10px" } }, S.docs.slice(0, 300).map((d) => h("div", h("b.mono", d.path), h("span.mono.note", { style: { flex: 1, whiteSpace: "pre-wrap" } }, JSON.stringify(d.body))))));
          return;
        }
        if (!S.rows) return;
        if (!S.rows.length) {
          grid.appendChild(h("p.empty", "No rows."));
          return;
        }
        const cols = [...new Set(S.rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== "__rowid");
        const del = (r) => async () => {
          if (!await confirmBox("Delete this row?", "From " + S.cur + " in your " + (S.kind === "dev" ? "dev" : S.kind === "prop" ? "proposal's preview" : "test") + " data: " + cols.slice(0, 4).map((c) => c + " " + cell(r[c]).slice(0, 30)).join(", "), "Delete")) return;
          try {
            await call("exec", { query: 'DELETE FROM "' + S.cur + '" WHERE rowid = ?', args: [r.__rowid] });
            toast("Deleted the row");
            loadRows();
            if (S.kind === "dev") App.reloadDev();
          } catch (e) {
            toast("Not deleted: " + (e.message || e), 6e3);
          }
        };
        const canDel = !S.query && S.rows.some((r) => r.__rowid != null);
        grid.appendChild(h("table.grid.ro", h("thead", h("tr", cols.map((c) => h("th", c)), canDel ? h("th", "") : null)), h("tbody", S.rows.map((r) => h("tr", cols.map((c) => h("td", cell(r[c]))), canDel ? h("td", h("button.link.note", { title: "Delete this row", on: { click: del(r) } }, "\u2715")) : null)))));
        if (S.rows.length >= 300) grid.appendChild(h("p.note", { style: { padding: "0 10px" } }, "The first 300 rows."));
      }
      function seedMenu(btn) {
        const fx = fixtureList(P(), App.ws);
        popMenu(btn, [{ group: "Fixtures (" + FIX_DIR + ")" }, ...fx.map((f) => ({
          label: f.name,
          sub: f.error || f.parts.join(", ") || "empty",
          disabled: !!f.error,
          run: async () => {
            try {
              await Slop.call("seed", { app: P().app, kind: "dev", docs: f.spec.docs || {}, tables: f.spec.tables || {} });
              toast("Seeded the dev instance from " + f.name + "; the frames reload");
              App.reloadDev();
              loadTables();
            } catch (e) {
              toast("Not seeded: " + (e.message || e), 5e3);
            }
          }
        })), ...fx.length ? [] : [{ note: "No fixtures yet: save rows as one, or write fixtures/<name>.json." }]]);
      }
      async function saveFixture() {
        const n = await promptBox("Save as fixture", "A fixture is data a test instance starts from. Rows of " + S.cur + " go into it (others it has stay). Name:", S.cur + "-sample");
        if (!n) return;
        const path = fixturePath(n.replace(/[^\w-]/g, "-")), ex = P().read(path, App.ws);
        let spec = { description: "", docs: {}, tables: {} };
        if (ex) {
          try {
            spec = JSON.parse(ex);
          } catch {
          }
        }
        spec.tables = spec.tables || {};
        spec.tables[S.cur] = S.rows;
        const bad = checkFixture(spec);
        if (bad) return toast(path + ": " + bad);
        P().write(path, JSON.stringify(spec, null, 2) + "\n", App.ws);
        toast("Saved " + plural(S.rows.length, "row") + " in " + path);
      }
      const later = debounce(() => {
        if (Dock.visible("data")) loadTables();
      }, 300);
      App.ev.on("project", () => {
        S.cur = null;
        S.query = "";
        S.coll = "";
        S.kind = "dev";
        later();
      });
      App.ev.on("ws", (ws) => {
        const k = ws === "draft" ? "dev" : "prop";
        if (S.kind !== "test" && S.kind !== k) {
          S.kind = k;
          S.cur = null;
          S.rows = null;
          S.docs = null;
          later();
        }
      });
      App.ev.on("scenarios", () => {
        if (S.kind === "test") later();
      });
      return { el, show: loadTables };
    }
  };

  // src/ui/inspect.js
  var INSPECTOR = {
    title: "Inspector",
    sub: "styles",
    make() {
      const body = h("div.scroll"), el = h("div", body);
      let seq = 0;
      async function paint() {
        const s = App.sel, my = ++seq;
        clear(body);
        if (!s) {
          body.appendChild(h("p.empty", "Select an element on the canvas (Select mode, click). Its source, box and matching CSS show here, and you can edit them."));
          return;
        }
        const fh = App.hostByFid(s.fid);
        const [file, line] = (s.src || ":").split(":");
        body.appendChild(h(
          "div.block",
          h("header", h("h3", s.tag + (s.id ? "#" + s.id : "") + (s.cls ? "." + s.cls.split(" ").join(".") : "")), h("span.sp"), h("span.tag" + (s.ws !== "draft" ? ".ws" : ""), s.ws === "draft" ? "draft" : "proposal")),
          h("dl.kv", h("dt", "Source"), h("dd", s.src ? h("button.link", { on: { click: () => App.reveal(file, +line) } }, s.src) : "\u2014"), h("dt", "Page"), h("dd", s.route), s.text ? [h("dt", "Text"), h("dd", "\u201C" + s.text.slice(0, 120) + "\u201D")] : null, h("dt", "Selector"), h("dd.mono", s.selector)),
          h(
            "div",
            { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            h("button.btn.sm", { on: { click: () => App.askAgent("About the " + s.tag + " at " + s.src + " on " + s.route + ": ") } }, "Ask agent about this"),
            s.leaf ? h("span.note", "double-click it on the canvas to edit the text") : null
          )
        ));
        if (!fh) return;
        let r;
        try {
          r = await fh.call("inspect", [{ src: s.src }]);
        } catch (e) {
          try {
            r = await fh.call("inspect", [s.selector]);
          } catch (e2) {
            body.appendChild(h("p.empty", "The element is gone from the page (" + e2.message + ")."));
            return;
          }
        }
        if (my !== seq) return;
        const c = r.computed;
        body.appendChild(h(
          "div.block",
          h("header", h("h3", "Box"), h("span.sub", r.rect.w + " \xD7 " + r.rect.h + " at " + r.rect.x + ", " + r.rect.y)),
          h("dl.kv", ["display", "position", "margin", "padding", "gap", "font-size", "font-family", "color", "background-color"].map((p) => [h("dt", p), h("dd.mono", c[p])]))
        ));
        const rules = h("div.block", h("header", h("h3", "Rules"), h("span.sub", "last wins \xB7 edits write to the file")));
        for (const rule of [...r.rules].reverse()) {
          const text = App.P.read(rule.file, App.ws) || "", blk = rule.inline ? null : findRule(text, rule.selector), ln = blk ? lineOf(text, blk.selStart) : null;
          const box = h(
            "div",
            { style: { border: "1px solid var(--rule)", padding: "6px 8px", display: "flex", flexDirection: "column", gap: "2px" } },
            h(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "baseline" } },
              h("b.mono", rule.selector),
              rule.media ? h("span.note", "@media " + rule.media) : null,
              h("span.sp"),
              h("button.link.note", { on: { click: () => App.reveal(rule.file, ln || 1) } }, rule.file + (ln ? ":" + ln : ""))
            )
          );
          for (const [p, v, imp] of rule.decls) {
            const inp = h("input.txt.mono", {
              value: v + (imp ? " !important" : ""),
              style: { flex: 1, padding: "1px 4px", fontSize: "11.5px" },
              disabled: !blk,
              on: { change: () => edit(rule, p, inp.value.trim() || null), keydown: (e) => {
                if (e.key === "Enter") inp.blur();
              } }
            });
            box.appendChild(h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span.mono", { style: { minWidth: "110px", color: "var(--ink-2)", fontSize: "11.5px" } }, p), inp));
          }
          if (blk) {
            const add = h("input.txt.mono", { placeholder: "+ property: value", style: { padding: "1px 4px", fontSize: "11.5px" }, on: { keydown: (e) => {
              if (e.key !== "Enter") return;
              const m = /^\s*([\w-]+)\s*:\s*(.+?);?\s*$/.exec(add.value);
              if (m) edit(rule, m[1], m[2]);
              else toast("Write it as property: value");
            } } });
            box.appendChild(add);
          }
          rules.appendChild(box);
        }
        if (!r.rules.length) rules.appendChild(h("p.note", "No project CSS rules match this element."));
        body.appendChild(rules);
      }
      function edit(rule, prop, value) {
        const P = App.P, text = P.read(rule.file, App.ws);
        if (text == null) return;
        const next = cssSet(text, rule.selector, prop, value);
        if (next == null) return toast('Could not find "' + rule.selector + '" in ' + rule.file);
        P.write(rule.file, next, App.ws);
        setTimeout(paint, 450);
      }
      App.ev.on("sel", () => {
        if (Dock.visible("inspector")) paint();
      });
      App.ev.on("project", paint);
      return { el, show: paint };
    }
  };
  var LAYERS = {
    title: "Layers",
    sub: "DOM outline",
    make() {
      const tree = h("div.layers"), head = h("div.toolbar"), el = h("div", head, tree);
      let seq = 0;
      async function paint() {
        const my = ++seq;
        clear(head);
        clear(tree);
        const fh = App.sel ? App.hostByFid(App.sel.fid) : App.firstHost();
        if (!fh) {
          tree.appendChild(h("p.empty", "No frame yet."));
          return;
        }
        head.append(h("span.lbl", "Frame"), h("b", fh.route), h("span.note", fh.w + "px" + (fh.ws !== "draft" ? " \xB7 proposal" : "")), h("span.sp"), h("button.btn.sm", { on: { click: paint } }, "Refresh"));
        let nodes;
        try {
          nodes = await fh.call("outline", [500]);
        } catch (e) {
          tree.appendChild(h("p.empty", e.message));
          return;
        }
        if (my !== seq) return;
        for (const n of nodes) tree.appendChild(h("button" + (App.sel && n.src && n.src === App.sel.src ? ".on" : ""), {
          style: { paddingLeft: 10 + n.d * 12 + "px" },
          title: n.src,
          on: { click: async () => {
            try {
              const info2 = await fh.call("select", [n.src ? { src: n.src } : n.tag]);
              if (info2) App.select({ ...info2, fid: fh.fid, route: fh.route, ws: fh.ws });
            } catch (e) {
              toast(e.message);
            }
          } }
        }, h("span", n.tag + (n.id ? "#" + n.id : "") + (n.cls ? "." + n.cls : "")), n.text ? h("span.note", "\u201C" + n.text + "\u201D") : null, h("span.sp"), h("span.src", n.src)));
      }
      const later = debounce(() => {
        if (Dock.visible("layers")) paint();
      }, 300);
      App.ev.on("sel", later);
      App.ev.on("frameready", later);
      App.ev.on("project", later);
      return { el, show: paint };
    }
  };

  // src/ui/review.js
  var Checks = /* @__PURE__ */ new Map();
  var REVIEW = {
    title: "Review",
    sub: "proposals and pins",
    badge: () => {
      const n = App.P ? App.P.openProposals().length : 0;
      return n ? h("span.count", String(n)) : null;
    },
    make() {
      const body = h("div.scroll"), el = h("div", body);
      const S = { picked: {}, shown: {}, changes: /* @__PURE__ */ new Map(), seq: 0 };
      async function load() {
        const P = App.P, my = ++S.seq;
        if (!P) return;
        const all = await Promise.all(P.openProposals().map(async (p) => [p.ref, await P.changes(p.ref).catch((e) => ({ error: e.message }))]));
        if (my !== S.seq) return;
        S.changes = new Map(all);
        paint();
      }
      function paint() {
        clear(body);
        const P = App.P;
        if (!P) return;
        const open2 = P.openProposals();
        body.appendChild(h(
          "div.toolbar",
          h("b", "Proposals"),
          h("span.note", "copies of draft; nothing lands until you accept"),
          h("span.sp"),
          h("button.btn.sm", { on: { click: () => App.newProposal() } }, "+ Proposal")
        ));
        if (!open2.length) body.appendChild(h("p.empty", "No open proposals. Agent threads work in one by default; you can also start one and edit in it."));
        for (const p of open2) body.appendChild(card(P, p));
        const closed = [...P.proposals.values()].filter((p) => p.status !== "open" && p.status !== "discarded").sort((a, b) => (b.closed || 0) - (a.closed || 0)).slice(0, 12);
        if (closed.length) {
          body.appendChild(h("div.toolbar", h("b", "Closed")));
          body.appendChild(h("div.rows", { style: { padding: "0 12px 8px" } }, closed.map((p) => h("div", h("span", p.title), h("span.note", p.status), h("span.sp"), h("span.note", p.closed ? fmtAgo(p.closed) : "")))));
        }
        const pins2 = P.meta.pins || [];
        body.appendChild(h("div.toolbar", h("b", "Pins"), h("span.note", "Comment mode: click a frame to pin a note"), h("span.sp"), h("span.note", pins2.filter((p) => !p.resolved).length + " open")));
        body.appendChild(h("div.rows", { style: { padding: "0 12px 12px" } }, pins2.length ? pins2.slice().sort((a, b) => a.resolved - b.resolved || b.n - a.n).map((p) => h(
          "div",
          { style: { opacity: p.resolved ? 0.55 : 1 } },
          h("b", "#" + p.n),
          h("span", { style: { flex: 1 } }, p.text, p.reply ? h("div.note", "\u21B3 " + p.reply) : null),
          h("span.note", p.route),
          !p.resolved ? h("button.link.note", { on: { click: () => App.askAgent("Address pin #" + p.n + " on " + p.route + " (" + (p.src || "") + "): " + p.text) } }, "ask agent") : null,
          h("button.link.note", { on: { click: () => {
            p.resolved = !p.resolved;
            P.saveMeta();
            App.ev.emit("pins");
          } } }, p.resolved ? "reopen" : "resolve")
        )) : h("p.note", "No pins.")));
      }
      function card(P, p) {
        const ch = S.changes.get(p.ref), th = p.thread && P.threads.get(p.thread), pick = S.picked[p.ref] = S.picked[p.ref] || {};
        const list = Array.isArray(ch) ? ch : [];
        for (const c2 of list) if (!(c2.path in pick)) pick[c2.path] = true;
        const n = list.filter((c2) => pick[c2.path]).length, all = list.length;
        const c = h("div.ovcard", h(
          "header",
          h("h3", p.title),
          th ? h("span.tag.ws", th.role || "agent") : h("span.tag.ws", "you"),
          th ? h("span.note", th.title) : null,
          h("span.note", fmtAgo(p.created)),
          h("span.sp"),
          h("button.btn.sm" + (App.ws === p.ref ? ".on" : ""), { on: { click: () => App.setWs(App.ws === p.ref ? "draft" : p.ref) } }, App.ws === p.ref ? "Viewing" : "View"),
          h("button.btn.sm", { disabled: !all, title: "Draft above, proposal below on the canvas", on: { click: () => {
            App.setWs(p.ref);
            App.compare(true);
          } } }, "Compare"),
          h("button.btn.sm.primary", { disabled: !n, on: { click: () => accept(P, p, list.filter((x) => pick[x.path]).map((x) => x.path), list.filter((x) => !pick[x.path]).map((x) => x.path)) } }, "Accept " + (n === all ? "all" : n + " of " + all)),
          h("button.btn.sm.danger", { on: { click: async () => {
            if (!all || await confirmBox('Reject "' + p.title + '"?', "Its " + plural(all, "change") + " are discarded with the proposal. The timeline keeps its commits.", "Reject")) {
              await P.reject(p.ref);
              if (App.ws === p.ref) App.setWs("draft");
            }
          } } }, "Reject")
        ));
        const files2 = h("div.files");
        if (!ch) files2.appendChild(h("p.note", "Reading its changes\u2026"));
        else if (ch.error) files2.appendChild(h("p.note", { style: { color: "var(--accent)" } }, "Could not read its changes: " + ch.error));
        else if (!all) files2.appendChild(h("p.note", "No changes yet."));
        for (const x of list) {
          const text = x.after !== null || x.before !== null, st = text ? diffStat(x.before ?? "", x.after ?? "") : null, key = p.ref + x.path, shown = S.shown[key] ?? list.length <= 3;
          const cb = h("input", { type: "checkbox", checked: pick[x.path], on: { change: () => {
            pick[x.path] = cb.checked;
            paint();
          } } });
          files2.appendChild(h(
            "div",
            h("label", { title: "Include this file when you accept" }, cb),
            text ? h("button.link", { style: { padding: 0 }, on: { click: (e) => {
              e.preventDefault();
              S.shown[key] = !shown;
              paint();
            } } }, x.path) : h("span", x.path),
            h(
              "span",
              h("span.note", !x.existed ? "new" : !x.entry ? "deleted" : st ? "+" + st.add + " \u2212" + st.del : "replaced (kept by hash)"),
              h("span.sp"),
              text ? h("button.link.note", { on: { click: (e) => {
                e.preventDefault();
                S.shown[key] = !shown;
                paint();
              } } }, shown ? "hide diff" : "show diff") : null,
              " ",
              x.entry ? h("button.link.note", { on: { click: (e) => {
                e.preventDefault();
                App.setWs(p.ref);
                App.reveal(x.path, 1);
              } } }, "open") : null
            ),
            shown && text ? diffView(x.before ?? "", x.after ?? "") : null
          ));
        }
        c.appendChild(files2);
        if (all) c.appendChild(checksPanel(P, p));
        return c;
      }
      async function accept(P, p, paths, left = []) {
        if (left.length && !await confirmBox("Accept " + paths.length + " of " + (paths.length + left.length) + " files?", "Left out, and discarded with the proposal: " + left.join(", ") + ". Files that belong together (a migration and the code that uses it) should go in together.", "Accept " + paths.length)) return;
        const r = await P.accept(p.ref, paths, "you").catch((e) => ({ status: "failed", error: e.message }));
        if (r.status === "committed") {
          toast("Accepted " + plural(paths.length, "change") + " into draft " + r.n + (r.merged ? " (merged with what changed since)" : ""));
          if (App.ws === p.ref) App.setWs("draft");
        } else if (r.status === "conflict") toast("Not accepted: draft also changed " + r.conflicts.join(", ") + " since the proposal began. Bring those files up to date in the proposal, or leave them out.", 8e3);
        else toast("Not accepted: " + (r.error || r.status), 6e3);
      }
      function checksPanel(P, p) {
        const st = Checks.get(p.ref) || {}, box = h("div.checks");
        const paintBox = () => {
          clear(box);
          box.append(h(
            "div.toolbar.sub",
            h("b", "Checks"),
            h("span.note", st.t ? "as of " + fmtAgo(st.t) : "layout against draft, and the scenarios on both"),
            h("span.sp"),
            h("button.btn.sm", { disabled: st.busy, on: { click: () => runChecks(P, p, st, paintBox) } }, st.busy ? "Checking\u2026" : st.t ? "Check again" : "Check layout and scenarios")
          ));
          if (st.layout) for (const f of st.layout) box.appendChild(h(
            "div.lyt",
            h(
              "div.lh",
              h("b", f.frame),
              h("span.note", f.lines.length ? plural(f.changes, "change") : "no layout changes"),
              h("span.sp"),
              f.lines.length ? h("button.link.note", { on: { click: () => App.canvas && App.canvas.compareWs(f.fid, "draft", p.ref) } }, "compare frozen frames") : null
            ),
            f.lines.length ? h("pre.mono.lines", f.lines.join("\n")) : null
          ));
          if (st.scen) {
            if (!st.scen.length) box.appendChild(h("p.note", "No scenarios yet: record one from a frame's \u22EF menu, or ask the agent (or a qa subagent) to write some."));
            for (const r of st.scen) box.appendChild(h(
              "div.sres" + (r.ok ? ".ok" : ".bad"),
              h("span", r.ok ? "\u2713" : "\u2717"),
              h("b", r.name),
              h("span.note", r.ok ? r.base === false ? "fixed by this proposal" : "passes" : (r.base === true ? "regression: passes in draft" : "fails") + " \xB7 step " + ((r.failedAt ?? -1) + 1) + ": " + (r.error || ""))
            ));
          }
        };
        paintBox();
        return box;
      }
      async function runChecks(P, p, st, repaint) {
        st.busy = true;
        Checks.set(p.ref, st);
        repaint();
        try {
          const layout = [];
          for (const f of P.board().frames) {
            try {
              const A = await layoutIn(P, f, "draft", { headless: true }), B = await layoutIn(P, f, p.ref, { headless: true }), d = layoutDiff(A.layout, B.layout);
              layout.push({ fid: f.id, frame: (f.label ? f.label + " \xB7 " : "") + A.fh.route + " " + f.w + "px", changes: d.changes.length, lines: diffSummary(d, 14) });
            } catch (e) {
              layout.push({ fid: f.id, frame: f.route + " " + f.w + "px", changes: 0, lines: ["could not load: " + e.message] });
            }
          }
          st.layout = layout;
          const inProp = await runAllScenarios(P, { ws: p.ref, who: "you" });
          const inDraft = new Map((await runAllScenarios(P, { ws: "draft", who: "you" })).map((r) => [r.name, r.ok]));
          st.scen = inProp.map((r) => ({ ...r, base: inDraft.get(r.name) }));
          st.t = now();
          App.ev.emit("scenarios");
        } finally {
          st.busy = false;
          repaint();
        }
      }
      const later = debounce(() => {
        if (Dock.visible("review")) load();
        Dock.refreshTabs();
      }, 300);
      App.ev.on("proposals", later);
      App.ev.on("files", later);
      App.ev.on("pins", later);
      App.ev.on("ws", later);
      App.ev.on("project", later);
      return { el, show: load };
    }
  };

  // src/ui/threads.js
  var MODELS = [
    { v: "quick", label: "Quick" },
    { v: "default", label: "Default" },
    { v: "complex", label: "Complex" },
    { v: "m:claude-haiku-5-5", label: "Haiku 5.5" },
    { v: "m:claude-sonnet-5-5", label: "Sonnet 5.5" },
    { v: "m:claude-opus-5-5", label: "Opus 5.5" }
  ];
  var THREADS = {
    title: "Agent",
    sub: "chat with Claude",
    badge: () => Agent.anyBusy() ? h("span.count", "\u2026") : null,
    make() {
      const S = { tid: null, chips: { sel: true }, early: {} };
      const strip = h("div.threads"), chat = h("div.chat"), note = h("div.block", { hidden: true });
      const ta = h("textarea.txt", { placeholder: "Ask for a change. The selection and open pins go along as context.", on: { keydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      } } });
      const chips = h("div.ctxchips"), row = h("div.row");
      const el = h("div", strip, note, chat, h("div.composer", chips, ta, row));
      chat.addEventListener("click", (e) => {
        const r = e.target.closest("[data-file]");
        if (r) {
          e.preventDefault();
          /\.md$/i.test(r.dataset.file) ? App.openDoc(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1);
        }
      });
      const P = () => App.P;
      const th = () => {
        const p = P();
        if (!p) return null;
        let t = S.tid && p.threads.get(S.tid);
        if (!t) {
          t = [...p.threads.values()].sort((a, b) => b.created - a.created)[0];
          if (!t) t = p.newThread();
          S.tid = t.id;
        }
        return t;
      };
      function paintStrip() {
        if (!P()) return clear(strip);
        const cur = th();
        clear(strip);
        for (const t of [...P().threads.values()].sort((a, b) => a.created - b.created)) {
          if (t.parent && t !== cur) continue;
          strip.appendChild(h("span.th" + (t === cur ? ".on" : "") + (t.parent ? ".child" : ""), h(
            "button",
            { title: t.title, on: { click: () => {
              S.tid = t.id;
              paintAll();
            }, dblclick: async () => {
              const n = await promptBox("Rename thread", "Title", t.title);
              if (n) {
                t.title = n;
                P().saveThread(t);
                paintStrip();
              }
            } } },
            Agent.busy(t.id) ? h("span.dot.busy") : null,
            t.parent ? "\u21B3 " : "",
            t.title.length > 22 ? t.title.slice(0, 22) + "\u2026" : t.title
          )));
        }
        strip.appendChild(h(
          "div.rel.new",
          { style: { display: "flex", padding: 0 } },
          h("button", { title: "Thread actions", on: { click: (e) => threadMenu(e.currentTarget) } }, "\u22EF"),
          h("button", { title: "New thread", on: { click: () => {
            const t = P().newThread();
            S.tid = t.id;
            paintAll();
            ta.focus();
          } } }, "+ Thread")
        ));
      }
      function threadMenu(btn) {
        const t = th();
        if (!t) return;
        popMenu(btn, [
          { group: t.title },
          { label: "Rename\u2026", run: async () => {
            const n = await promptBox("Rename thread", "Title", t.title);
            if (n) {
              t.title = n;
              P().saveThread(t);
              paintStrip();
            }
          } },
          { label: "Download transcript", sub: "Markdown, with every eval", disabled: !t.msgs || !t.msgs.length, run: () => saveFile(slug(P().app) + "-" + slug(t.title) + ".md", transcriptMd(P(), t)) },
          ...(() => {
            const kids = [...P().threads.values()].filter((x) => x.parent).sort((a, b) => b.created - a.created).slice(0, 12);
            return kids.length ? [{ group: "Subagent threads" }, ...kids.map((k) => ({ label: "\u21B3 " + k.title, sub: (Agent.busy(k.id) ? "working \xB7 " : "") + fmtAgo(k.created), run: () => {
              S.tid = k.id;
              paintAll();
            } })), { hr: true }] : [];
          })(),
          { group: "Context" },
          { label: "Summarize earlier messages now", sub: t.summary ? "messages 1\u2013" + t.summary.upTo + " are summarized" : "happens on its own when the thread gets long", disabled: !t.msgs || Agent.busy(t.id) || t.msgs.length - (t.summary ? t.summary.upTo : 0) < 4, run: () => compactNow(t) },
          t.summary ? { label: "Edit the summary\u2026", run: () => editSummary(t) } : null,
          t.summary ? { label: "Forget the summary", sub: "Claude sees the full history again (as much as fits)", run: () => {
            t.summary = null;
            P().saveThread(t);
            paintChat();
            paintChips();
          } } : null,
          { hr: true },
          { label: "Download as JSON", disabled: !t.msgs || !t.msgs.length, run: () => saveFile(slug(P().app) + "-" + slug(t.title) + ".json", JSON.stringify({ ...t, saved: void 0 }, null, 1)) },
          { hr: true },
          { label: "Delete thread\u2026", danger: true, disabled: Agent.busy(t.id), run: async () => {
            if (await confirmBox('Delete "' + t.title + '"?', "Its messages go; the timeline keeps what it did.", "Delete")) {
              P().dropThread(t.id);
              S.tid = null;
              paintAll();
            }
          } }
        ], { right: true });
      }
      function stepEl(s, i) {
        const calls = [...new Set(s.calls || [])];
        const sum = h(
          "summary",
          h("b", (s.status === "ok" ? "\u2713" : s.status === "error" ? "\u2715" : s.status === "ask" ? "?" : s.status === "skipped" ? "\u2013" : "\u2026") + " eval " + (i + 1)),
          h("span", calls.length ? calls.slice(0, 4).join(", ") + (calls.length > 4 ? " +" + (calls.length - 4) : "") : (s.code.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) || "").trim().slice(0, 60)),
          s.ms != null ? h("span", s.ms + " ms") : null
        );
        const fx = effectsLine(s.effects);
        if (fx) sum.appendChild(h("span.fx" + (s.effects.rolledBack || s.effects.newIssues || s.effects.newErrors ? ".bad" : ""), fx));
        const d = h(
          "details.step" + (s.status === "error" ? ".bad" : ""),
          sum,
          h("pre", { html: hlJS(s.code) }),
          s.logs && s.logs.length ? h("pre", s.logs.join("\n")) : null,
          s.out ? s.fmt === "yaml" ? h("pre.yaml", { html: hlYAML(s.out) }) : h("pre", s.out) : null,
          s.effects && (s.effects.newIssues || s.effects.newErrors) ? h("pre", [...(s.effects.newIssues || []).map((i2) => "new issue \xB7 " + i2.frame + " \xB7 " + i2.message + (i2.src ? " @" + i2.src : "")), ...(s.effects.newErrors || []).map((e) => "new error \xB7 " + e)].join("\n")) : null
        );
        if (s.children && s.children.length) d.appendChild(h("div.kids", s.children.map((c) => {
          const ct = P().threads.get(c.thread);
          const last = ct && ct.msgs && [...ct.msgs].reverse().find((m) => m.role === "agent");
          return h("div", h("span", "\u21B3 " + c.role), h("span", ct ? Agent.busy(ct.id) ? "working\u2026" : plural((last && last.steps || []).length, "eval") + (last && last.status === "error" ? " \xB7 failed" : "") : ""), h("button.link", { on: { click: (e) => {
            e.preventDefault();
            App.showThread(c.thread);
          } } }, "open thread"));
        })));
        if (s.status === "ask") {
          d.open = true;
          d.appendChild(h("div.ask", h("span", "Run this eval?"), h("button.btn.sm.primary", { on: { click: () => s.decide && s.decide(true) } }, "Run"), h("button.btn.sm", { on: { click: () => s.decide && s.decide(false) } }, "Skip")));
        }
        return d;
      }
      function summaryEl(t, early) {
        const sm = t.summary;
        return h(
          "div.summary",
          h(
            "div.who",
            h("b", "Earlier: " + plural(sm.upTo, "message") + " summarized for Claude"),
            h("span", sm.by === "you" ? "edited by you" : sm.by === "fallback" ? "listed without a model" : "by Claude"),
            h("span", fmtAgo(sm.t)),
            h("span.sp"),
            h("button.link.note", { on: { click: () => {
              S.early[t.id] = !early;
              paintChat();
            } } }, early ? "Hide them" : "Show them"),
            " ",
            h("button.link.note", { title: "Correct what Claude will remember", on: { click: () => editSummary(t) } }, "Edit")
          ),
          renderMarkdown(sm.text, (f) => P().read(f, "draft") !== null)
        );
      }
      function editSummary(t) {
        const ta2 = h("textarea.mono", { style: { width: "100%", minHeight: "260px", fontSize: "12px" } });
        ta2.value = t.summary.text;
        modal({
          title: "What Claude remembers of messages 1\u2013" + t.summary.upTo,
          wide: true,
          body: [h("p.note", "Claude reads this instead of the older messages. Fix anything wrong or missing; it can still look up the originals with session.recall."), ta2],
          actions: [{ label: "Cancel" }, { label: "Save", primary: true, run: () => {
            t.summary = { ...t.summary, text: ta2.value.trim(), by: "you", t: now() };
            P().saveThread(t);
            P().log({ kind: "compact", who: "you", thread: t.id, note: 'edited the summary of "' + t.title + '"' });
            paintChat();
          } }]
        });
      }
      async function compactNow(t) {
        toast("Summarizing\u2026");
        try {
          const r = await Agent.compact(P(), t, { force: true });
          toast(r ? "Summarized messages 1\u2013" + r.upTo : "Too short to summarize");
        } catch (e) {
          toast("Could not summarize: " + e.message);
        }
        paintChat();
        paintChips();
      }
      async function acceptProp(prop) {
        const r = await P().accept(prop.ref, null, "you").catch((e) => ({ status: "failed", error: e.message }));
        if (r.status === "committed") {
          toast('Accepted "' + prop.title + '": the changes are in your draft now (test data you entered in its preview stays behind)', 6e3);
          if (App.ws === prop.ref) App.setWs("draft");
        } else if (r.status === "conflict") toast("Not accepted: the draft also changed " + r.conflicts.join(", ") + ". Open Review to sort it out.", 8e3);
        else toast("Not accepted: " + (r.error || r.status), 6e3);
        paintChat();
      }
      function msgEl(m, i, t) {
        if (m.role === "user") return h("div.msg.user", h("div.who", m.from ? "From the " + m.from : "You", h("span", fmtTime(m.t)), m.ctx && m.ctx.sel ? h("span.tag", m.ctx.sel.tag + " " + m.ctx.sel.src) : null), h("div.body", m.text));
        const prop = m.ws && m.ws !== "draft" ? P().proposals.get(m.ws) : null;
        return h(
          "div.msg.agent",
          h(
            "div.who",
            "Claude",
            h("span", fmtTime(m.t)),
            m.model ? h("span", m.model) : null,
            m.status === "running" ? h("span.dot.busy") : null,
            h("span.sp"),
            h("button.link.note", { title: "Bookmark this reply on the timeline", on: { click: () => {
              P().mark({ label: (m.text || "reply").split("\n")[0].slice(0, 40), by: "you", thread: t.id });
              toast("Marked on the timeline");
            } } }, "\u2606 mark")
          ),
          (m.steps || []).map(stepEl),
          (m.panels || []).map((id) => {
            const pn = Panels.get(P(), id);
            return pn ? panelEl(P(), pn, { inline: true }) : null;
          }),
          m.auto ? h("div.note", "Claude ended without a reply; the bench says what happened:") : null,
          m.text ? renderMarkdown(m.text, (file) => P().read(file, "draft") !== null || !!prop && prop.status === "open" && P().read(file, m.ws) !== null) : m.status === "running" && !(m.steps || []).length ? h("div.body.note", m.note || "Thinking\u2026") : null,
          m.error ? h("div.note", { style: { color: "var(--accent)" } }, m.error) : null,
          m.approval ? h(
            "div.approval",
            h("b", m.approval.title),
            m.approval.detail ? h("pre", m.approval.detail) : null,
            h("div", { style: { display: "flex", gap: "6px" } }, h("button.btn.sm.primary", { on: { click: () => m.approval && m.approval.decide(true) } }, "Approve"), h("button.btn.sm", { on: { click: () => m.approval && m.approval.decide(false) } }, "Decline"))
          ) : null,
          prop ? h("div.ctx", prop.status === "open" ? [
            h("span.tag.ws", "proposal"),
            " ",
            m.summary || 'working in "' + prop.title + '"',
            m.summary && m.status !== "running" ? h("div.note", "These changes are in a proposal: a copy of your app. Your app does not change until you accept them. What you type into its preview stays with the preview: accepting takes the changes, not that test data.") : null,
            h(
              "span",
              { style: { display: "inline-flex", gap: "8px", marginLeft: "6px" } },
              App.ws !== prop.ref ? h("button.link", { on: { click: () => App.setWs(prop.ref) } }, "Show it") : null,
              h("button.link", { on: { click: () => {
                App.setWs(prop.ref);
                Dock.open("review");
              } } }, "Review"),
              m.summary && m.status !== "running" ? h("button.link", { on: { click: () => acceptProp(prop) } }, "Accept") : null
            )
          ] : prop.status === "discarded" ? h("span.note", "Nothing in the app changed in this turn.") : h("span", 'The proposal "' + prop.title + '" was ' + prop.status + ".")) : null
        );
      }
      let raf = 0;
      function paintChat() {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const t = th();
          if (!t) return;
          if (!t.msgs) {
            clear(chat).appendChild(h("div.note", { style: { padding: "8px 2px" } }, "Loading\u2026"));
            P().loadThread(t.id).then(() => paintAll(), (e) => toast("Could not load the thread: " + e.message));
            return;
          }
          const atEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
          const open2 = new Set($$("details.step[open]", chat).map((d) => d.dataset.k));
          clear(chat);
          if (!t.msgs.length) chat.appendChild(h("div.note", { style: { padding: "8px 2px" } }, "Each turn, Claude works through one tool: eval, JavaScript run in a QuickJS sandbox against this app (files, instances, frames, scenarios, pins, timeline), each eval one commit. Changes land in a proposal you review, unless you pick Draft."));
          const sm = t.summary, early = sm && S.early[t.id];
          if (sm) chat.appendChild(summaryEl(t, early));
          t.msgs.forEach((m, i) => {
            if (sm && i < sm.upTo && !early) return;
            const e = msgEl(m, i, t);
            $$("details.step", e).forEach((d, j) => {
              d.dataset.k = i + ":" + j;
              if (open2.has(d.dataset.k)) d.open = true;
            });
            chat.appendChild(e);
            if (sm && early && i === sm.upTo - 1) chat.appendChild(h("div.sumcut", "Claude sees the summary above instead of the messages before this line"));
          });
          if (atEnd) chat.scrollTop = chat.scrollHeight;
        });
      }
      function paintChips() {
        clear(chips);
        const p = P();
        if (!p) return;
        if (App.sel && S.chips.sel) chips.appendChild(h("span.tag", "Selected: " + App.sel.tag + " " + (App.sel.src || ""), h("button", { title: "Leave out", on: { click: () => {
          S.chips.sel = false;
          paintChips();
        } } }, "\xD7")));
        const pins2 = (p.meta.pins || []).filter((x) => !x.resolved).length;
        if (pins2) chips.appendChild(h("span.tag", plural(pins2, "open pin")));
        if (App.health()) chips.appendChild(h("span.tag", plural(App.health(), "check issue")));
        const t = th(), vars = t && t.scope && t.scope.vars ? Object.keys(t.scope.vars) : [], lib = libEntries(p.view(App.ws));
        if (t && t.summary) chips.appendChild(h("button.tag", { title: "Claude sees a summary of messages 1\u2013" + t.summary.upTo + " instead of the messages themselves", on: { click: () => {
          S.early[t.id] = false;
          paintChat();
          chat.scrollTop = 0;
        } } }, "Summary: 1\u2013" + t.summary.upTo));
        if (vars.length) chips.appendChild(h("div.rel", { style: { display: "inline-flex" } }, h("button.tag", { title: "Variables Claude kept from earlier evals in this thread", on: { click: (e) => scopeMenu(e.currentTarget, t) } }, "Scope: " + (vars.length > 3 ? vars.slice(0, 3).join(", ") + " +" + (vars.length - 3) : vars.join(", ")))));
        if (lib.length) chips.appendChild(h("div.rel", { style: { display: "inline-flex" } }, h("button.tag", { title: "Saved functions (.agent/lib)", on: { click: (e) => popMenu(e.currentTarget, [{ group: "lib \xB7 .agent/lib/" }, ...lib.map((l) => ({ label: "lib." + l.name + "(" + l.params.join(", ") + ")", sub: l.description, run: () => App.reveal(l.path, 1) }))]) } }, "lib: " + lib.length)));
      }
      function scopeMenu(btn, t) {
        const k = (v) => v === null ? "null" : Array.isArray(v) ? "array(" + v.length + ")" : typeof v === "object" ? "object{" + Object.keys(v).slice(0, 4).join(",") + "}" : typeof v === "string" ? '"' + v.slice(0, 24) + '"' : String(v);
        popMenu(btn, [
          { group: 'Kept between evals in "' + t.title + '"' },
          ...Object.entries(t.scope.vars).map(([n, v]) => ({ label: n, sub: k(v) })),
          ...(t.scope.skipped || []).map((x) => ({ label: x, sub: "not kept", disabled: true })),
          { hr: true },
          { label: "Forget all", danger: true, run: () => {
            t.scope = null;
            Sandbox.drop(t.id);
            P().saveThread(t);
            paintChips();
            toast("Cleared this thread's variables");
          } }
        ]);
      }
      function paintRow() {
        clear(row);
        const t = th();
        if (!t) return;
        const busy = Agent.busy(t.id);
        const seg = (vals, cur, set, title) => h("div.seg.sm", { title }, vals.map(([v, l]) => h("button" + (cur === v ? ".on" : ""), { on: { click: () => {
          set(v);
          P().saveThread(t);
          paintRow();
        } } }, l)));
        const model = h(
          "select.sel",
          { title: "Model tier, or a specific model", style: { height: "24px", fontSize: "11px" }, on: { change: () => {
            const v = model.value;
            if (v.startsWith("m:")) {
              t.model = v.slice(2);
              t.tier = "default";
            } else {
              t.model = null;
              t.tier = v;
            }
            P().saveThread(t);
          } } },
          MODELS.map((m) => h("option", { value: m.v, selected: t.model ? m.v === "m:" + t.model : m.v === (t.tier || "default") }, m.label))
        );
        put(
          row,
          seg([["auto", "Auto"], ["ask", "Ask"], ["read", "Read-only"]], t.mode, (v) => {
            t.mode = v;
          }, "Auto runs evals; Ask asks before each; Read-only refuses writes"),
          t.mode !== "read" && t.mode !== "tests" ? seg([["proposal", "Proposal"], ["draft", "Draft"]], t.target, (v) => {
            t.target = v;
          }, "Where the agent's commits go: a proposal of its own, or draft directly") : null,
          model,
          busy ? h("button.btn.sm.danger", { style: { marginLeft: "auto" }, on: { click: () => Agent.stop(t.id) } }, "Stop") : h("button.btn.sm.primary", { style: { marginLeft: "auto" }, disabled: !Agent.sample, on: { click: send } }, "Send \u21B5")
        );
      }
      function paintNote() {
        clear(note);
        note.hidden = !Agent.ready || !!Agent.sample;
        if (!note.hidden) note.append(h("b", "Claude isn't available in this view."), h("p.note", "The agent uses this page's Claude access, which needs the published artifact opened while signed in. You can still drive the same API yourself in the Eval panel."), h("div", h("button.btn.sm", { on: { click: () => Dock.open("evalrepl", "agent") } }, "Open Eval")));
      }
      async function send() {
        const t = th(), text = ta.value.trim();
        if (!t || !text || Agent.busy(t.id)) return;
        if (!S.chips.sel) {
          const keep = App.sel;
          App.sel = null;
          setTimeout(() => {
            App.sel = keep;
          }, 0);
        }
        ta.value = "";
        S.chips.sel = true;
        Agent.send(P(), t, text).catch((e) => toast(e.message));
        paintAll();
      }
      function paintAll() {
        paintStrip();
        paintChat();
        paintChips();
        paintRow();
        paintNote();
      }
      Agent.ev.on("turn", () => {
        paintStrip();
        paintChat();
        paintRow();
        Dock.refreshTabs();
      });
      Agent.ev.on("step", paintChat);
      Agent.ev.on("text", paintChat);
      Agent.ev.on("ready", () => {
        paintNote();
        paintRow();
      });
      App.ev.on("project", () => {
        S.tid = null;
        paintAll();
      });
      App.ev.on("sel", () => {
        S.chips.sel = true;
        paintChips();
      });
      App.ev.on("pins", paintChips);
      App.ev.on("health", paintChips);
      App.ev.on("threads", paintStrip);
      App.ev.on("threads", () => {
        if (Dock.visible("agent")) paintChat();
      });
      App.agentView = { compose(text) {
        ta.value = text;
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
      }, paintAll, thread: th, open(tid) {
        S.tid = tid;
        paintAll();
      } };
      return { el, show: paintAll };
    }
  };

  // src/main.js
  registerViews({
    agent: THREADS,
    evalrepl: EVAL,
    canvas: CANVAS,
    timeline: TIMELINE,
    console: CONSOLE,
    data: DATA,
    scenarios: SCENARIOS,
    code: CODE2,
    docs: DOCS,
    review: REVIEW,
    inspector: INSPECTOR,
    layers: LAYERS,
    panels: PANELS
  });
  API.add(PANEL_API);
  NOTES.ui = PANEL_NOTE;
  initSources();
  App.boot().catch((e) => {
    console.error(e);
    clear($("#app")).appendChild(h("div.boot", h("div", h("b", "The bench could not start"), h("pre.note", String(e && e.stack || e)))));
  });
})();
