/* CC5 · THE COMPUTER: files, time and programs
   Files: drop, paste or attach anything; each file becomes an app. Pictures, video, sound and PDFs show; tables
     (csv), text, markdown, json and the text of a PDF become cells, so formulas and Claude can read them.
   Time: every page keeps clock.* ticking (clock.now, clock.time, clock.date, …) without writing to the log, so
     formulas that read it are live. jobs.<name> = {every | at, run, ask} runs on schedule while a page is open.
   Programs: a text cell typed `:: program` is JavaScript that runs in a sandboxed worker on one page at a time;
     it reads and writes the tree like any other peer. Code someone else wrote runs only after you read it.  */
(function (root) {
"use strict";
const H = root.Hypha, F = root.Fruit, { h, R, prop, bind, write, styleOf, uid, fmt } = F;
let X = null;   // the host: the desktop's doors, given at init

/* ---------- time ---------- */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = n => String(n).padStart(2, "0");
const Clock = {
  values(t) {
    const d = new Date(t);
    return { now: t, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, seconds: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), weekday: DAYS[d.getDay()], day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "") };
  },
  apply(K, t) { K.local("clock", this.values(t)); },
  start() { const tick = () => { this.apply(X.K(), Date.now()); }; tick(); setInterval(tick, 1000); },
};
/* when: "every 15 min" · "hourly" · "every 2 h" · "daily 08:00" · "weekdays 09:30" · "weekends 10:00" · "mon,thu 17:30" */
function nextRun(when, after) {
  let s = String(when || "").trim().toLowerCase().replace(/\s+/g, " "); if (s === "hourly") s = "every 60 min";
  let m = /^every (\d+) ?(m|min|mins|minute|minutes|h|hour|hours)$/.exec(s);
  if (m) { const n = +m[1] * (m[2][0] === "h" ? 60 : 1); return n > 0 ? after + n * 60000 : null; }
  m = /^(.+?) (\d{1,2}):(\d{2})$/.exec(s); if (!m) return null;
  const D = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }, d = m[1];
  const days = d === "daily" ? [0, 1, 2, 3, 4, 5, 6] : d === "weekdays" ? [1, 2, 3, 4, 5] : d === "weekends" ? [0, 6] : d.split(",").map(x => D[x.trim().slice(0, 3)]).filter(x => x != null);
  if (!days.length) return null;
  const base = new Date(after);
  for (let k = 0; k < 9; k++) { const c = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k, +m[2], +m[3]); if (days.includes(c.getDay()) && +c > after) return +c; }
  return null;
}
function atTime(at) { const t = Date.parse(String(at).replace(" ", "T")); return isFinite(t) ? t : null; }
const rel = (t, now) => { if (!t) return "–"; const d = t - now, a = Math.abs(d), s = a < 60000 ? Math.round(a / 1000) + " s" : a < 3600000 ? Math.round(a / 60000) + " min" : a < 86400000 ? Math.round(a / 3600000) + " h" : Math.round(a / 86400000) + " d"; return d >= 0 ? "in " + s : s + " ago"; };
const Jobs = {
  list(K) { if (!K.isBranch("jobs")) return []; return K.children("jobs").filter(s => { const v = K.valueAt("jobs." + s); return v && typeof v === "object" && !Array.isArray(v) && (v.every || v.at); }); },
  running: new Set(),
  async tick() {
    const K = X.K(); if (X.readonly() || X.past()) return;
    const now = Date.now();
    for (const j of this.list(K)) {
      const p = "jobs." + j, v = K.valueAt(p);
      if (v.on === false || this.running.has(j)) continue;
      let next = typeof v.next === "number" ? v.next : null;
      if (next == null) { next = v.at ? atTime(v.at) : nextRun(v.every, now); if (next == null) { if (v.status !== "cannot read when") X.write(`${p}.status = "cannot read when"`, "clock"); continue; } X.write(`${p}.next = ${next}`, "clock"); continue; }
      if (next > now) continue;
      if (v.ask && !(X.isOwner() && X.sample())) continue;   // a job that asks Claude runs on the owner's page, with its Claude
      if (!(await X.lease(`job-${j}-${next}`, 10 * 60000))) continue;
      this.running.add(j);
      try { await this.run(j, v); X.write(`${p}.status = "done"`, "clock"); }
      catch (e) { X.write(`${p}.status = ${JSON.stringify("failed: " + String(e && e.message || e).slice(0, 120))}`, "clock"); }
      finally {
        this.running.delete(j);
        const after = Date.now(), nx = v.at ? null : nextRun(v.every, after);
        X.write(`${p}.last = ${after}\n${p}.runs = ${(+v.runs || 0) + 1}` + (nx ? `\n${p}.next = ${nx}` : `\n${p}.on = false`), "clock");
      }
    }
  },
  async run(j, v) {
    if (typeof v.run === "string" && v.run.trim()) F.runAction(X.K(), "jobs." + j, X.env("jobs", "clock"), v.run);
    if (typeof v.ask === "string" && v.ask.trim()) await X.ask(v.ask, { app: v.app && X.K().exists(v.app) ? v.app : null });
  },
  start() { setInterval(() => this.tick().catch(e => console.warn("jobs", e)), 5000); setTimeout(() => this.tick(), 1500); },
};
R.jobs = (K, p, env) => {
  const list = Jobs.list(K), now = Date.now();
  if (!list.length) return h("div", { class: "f-empty" }, "No jobs yet. A job is jobs.name = {every: \"daily 08:00\", run: \"…\"} or {at: \"2026-11-01 09:00\", ask: \"…\"}.");
  return h("div", { class: "f-jobs", style: styleOf(K, p, env) }, list.map(j => {
    const v = K.valueAt("jobs." + j), on = v.on !== false;
    return h("div", { class: "f-job" + (on ? "" : " off"), key: j },
      h("button", { type: "button", class: "f-switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": `Job ${j} on`, disabled: env.readonly, on: { click: () => env.write(`jobs.${j}.on = ${!on}`) } }),
      h("div", { class: "f-job-main" }, h("b", null, j.replace(/_/g, " ")), h("span", { class: "w" }, v.at ? "once, " + v.at : String(v.every)),
        h("span", { class: "d" }, v.ask ? "asks Claude: " + v.ask : "runs: " + v.run)),
      h("div", { class: "f-job-when" }, h("span", null, on ? (Jobs.running.has(j) ? "running" : "next " + rel(v.next, now)) : "off"), h("span", { class: "s" + (/^failed/.test(v.status || "") ? " bad" : "") }, v.last ? `${v.status || "ran"} ${rel(v.last, now)}` : "")),
      h("button", { type: "button", class: "f-btn ghost", disabled: env.readonly || Jobs.running.has(j), on: { click: () => env.write(`jobs.${j}.next = ${Date.now() - 1}\njobs.${j}.on = true`) } }, "Run now"));
  }));
};

/* ---------- files ---------- */
const KINDS = [
  ["image", /^image\/(png|jpe?g|gif|webp|avif|bmp)$/, /\.(png|jpe?g|gif|webp|avif|bmp)$/i],
  ["svg", /^image\/svg\+xml$/, /\.svg$/i],
  ["pdf", /^application\/pdf$/, /\.pdf$/i],
  ["video", /^video\//, /\.(mp4|webm|mov|m4v)$/i],
  ["audio", /^audio\//, /\.(mp3|wav|m4a|ogg|aac|flac)$/i],
  ["csv", /^text\/(csv|tab-separated-values)$/, /\.(csv|tsv)$/i],
  ["json", /^application\/json$/, /\.json$/i],
  ["md", /^text\/markdown$/, /\.(md|markdown)$/i],
  ["text", /^text\/plain$/, /\.(txt|log)$/i],
];
const isHypha = f => /\.(hypha|cc5)$/i.test(f.name || "");
const kindOfFile = f => { for (const [k, mt, ext] of KINDS) if (mt.test(f.type || "") || ext.test(f.name || "")) return k; return "other"; };
const TEXT_TYPE = { csv: "text/csv", json: "application/json", md: "text/markdown", text: "text/plain" };
const size = n => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : (n / 1048576).toFixed(1) + " MB");
function slug(name, K) {
  let s = String(name).replace(/\.[^.]+$/, "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "file";
  if (/^\d/.test(s)) s = "f_" + s;
  if (["desk", "sys", "clock", "jobs", "ui"].includes(s)) s += "_file";
  let n = s, i = 2; while (K.exists(n)) n = `${s}_${i++}`;
  return n;
}
function csv(text) {
  const sep = text.split("\n")[0].includes("\t") ? "\t" : text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x !== "")) rows.push(row); row = []; } else cell += c;
  }
  row.push(cell); if (row.some(x => x !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((x, i) => (x.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "col" + (i + 1)).replace(/^(\d)/, "c$1"));
  return rows.slice(1).map(r => { const o = {}; head.forEach((k, i) => { const v = (r[i] || "").trim(); const n = v !== "" && /^-?\d+([.,]\d+)?$/.test(v) ? parseFloat(v.replace(",", ".")) : null; o[k] = n != null ? n : v; }); return o; });
}
/* pdf.js, loaded the first time a PDF is shown; its worker runs on the page (no separate worker file) */
let pdfjs = null;
function loadPdf() {
  if (pdfjs) return pdfjs;
  const add = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load the PDF reader")); document.head.appendChild(s); });
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  pdfjs = add(base + "pdf.min.js").then(() => add(base + "pdf.worker.min.js")).then(() => window.pdfjsLib);
  return pdfjs;
}
async function pdfOpen(src) { const lib = await loadPdf(); return lib.getDocument(typeof src === "string" ? { url: src } : { data: src }).promise; }
async function pdfText(doc, max = 60000) {
  let out = "";
  for (let i = 1; i <= doc.numPages && out.length < max; i++) { const pg = await doc.getPage(i), tc = await pg.getTextContent(); out += (i > 1 ? "\n\n" : "") + tc.items.map(t => t.str + (t.hasEOL ? "\n" : "")).join("").replace(/[ \t]+\n/g, "\n"); }
  return out.slice(0, max);
}
const textBlock = (path, text, ind) => { const pad = " ".repeat(ind); const lines = String(text).replace(/\r/g, "").split("\n"); return `${pad}${path} = |\n` + lines.map(l => `${pad}  ${l}`).join("\n"); };
const Files = {
  noted: false,
  /* where a file lives: the desktop's asset store when this viewer may store files; this tab only otherwise */
  async store(file, kind) {
    const assets = X.assets();
    if (assets) {
      try { const r = await assets.upload(file, TEXT_TYPE[kind] && !Object.values(TEXT_TYPE).includes(file.type) ? { type: TEXT_TYPE[kind] } : undefined); return { url: "/_blob/" + r.id, id: r.id }; }
      catch (e) { if (e && e.code !== "unsupported_type") X.toast(`Could not store ${file.name}: ${e.code === "too_large" ? "it is too large (20 MB at most)" : e.code === "quota_exceeded" ? "this desktop's storage is full" : e.message || e.code}`); }
    }
    if (!this.noted) { this.noted = true; X.toast(assets ? "This kind of file stays in this tab only; others here will not see it." : "Files you add here stay in this tab only. Inside Claude, the desktop's owner and editors store them with the desktop."); }
    return { url: URL.createObjectURL(file), local: true };
  },
  async ingest(files, opts = {}) {
    if (X.readonly()) return X.toast("You can look at this desktop but not change it.");
    const K = X.K(), made = [];
    for (const file of [...files].slice(0, 12)) {
      if (file.size > 20 * 1048576) { X.toast(`${file.name} is over 20 MB, the most a desktop can hold in one file.`); continue; }
      if (isHypha(file)) { X.install(await file.text(), opts.at); continue; }
      const kind = kindOfFile(file), st = await this.store(file, kind);
      const rec = { name: file.name, kind, type: file.type || TEXT_TYPE[kind] || "", size: file.size, url: st.url };
      if (st.id) rec.id = st.id; if (st.local) rec.local = true;
      if (opts.into && K.exists(opts.into)) { X.writeText(`${opts.into}.files += ${H.showLit(rec)}`); X.toast(`Added ${file.name} to ${X.title(opts.into)} as ${opts.into}.files`); continue; }
      const a = slug(file.name, K), lines = [`${a}:`, `  title = ${JSON.stringify(file.name)}`, `  file = ${H.showLit(rec)}`];
      let ui = ["file file"], w = 460;
      try {
        if (kind === "csv") { const rows = csv(await file.text()).slice(0, 3000); lines.push("  rows:"); rows.forEach((r, i) => lines.push(`    ${i} = ${H.showLit(r)}`)); lines.push(`  count = len(rows)`); ui = [`table rows`]; w = 620; }
        else if (kind === "json") { const t = await file.text(); if (t.length < 200000) { const v = JSON.parse(t); lines.push(`  data = ${H.showLit(v)}`); ui = ["cells data"]; } }
        else if (kind === "md" || kind === "text") { const t = (await file.text()).slice(0, 200000); lines.push(textBlock("text", t, 2)); ui = [kind === "md" ? "md text" : "code text"]; w = 520; }
        else if (kind === "pdf") w = 520;
        else if (kind === "other") w = 360;
      } catch (e) { X.toast(`Read ${file.name} as a file only: ${e.message || e}`); }
      lines.push("  ui:"); for (const u of ui) lines.push("    " + u);
      X.writeText(lines.join("\n"));
      const at = X.spot(opts.at, w); X.frame(a, { x: at.x, y: at.y, w }); made.push(a);
      if (kind === "pdf") this.pdfIntoCells(a, file).catch(e => console.warn("pdf", e));
    }
    if (made.length > 1) X.toast(`Added ${made.length} files`);
    return made;
  },
  async pdfIntoCells(a, file) {
    const doc = await pdfOpen(new Uint8Array(await file.arrayBuffer())), t = await pdfText(doc);
    X.writeText(`${a}.pages = ${doc.numPages}\n` + textBlock(`${a}.text`, t || "(no text in this PDF: it may be scanned images)", 0));
  },
  async save(rec) {
    const dl = X.downloads();
    try {
      const blob = await (await fetch(rec.url)).blob();
      if (dl) { await dl.save({ filename: rec.name || "file", data: blob }); return; }
      X.toast("Saving files works when this page is open inside Claude.");
    } catch (e) { if (!(e && e.code === "declined")) X.toast("Could not save it: " + (e.message || e.code || e)); }
  },
};
const pdfDocs = new Map();
function pdfPages(rec, key) {
  let st = pdfDocs.get(key);
  if (!st) {
    st = { doc: null, err: null, shown: 2 }; pdfDocs.set(key, st);
    pdfOpen(rec.url).then(d => { st.doc = d; X.rerender(); }, e => { st.err = e.message || String(e); X.rerender(); });
  }
  return st;
}
function drawPage(doc, n) {
  return el => {
    if (el._drawn === doc && el._n === n) return; el._drawn = doc; el._n = n;
    doc.getPage(n).then(pg => { const w = el.parentNode ? el.parentNode.clientWidth || 480 : 480, v1 = pg.getViewport({ scale: 1 }), sc = Math.min(2.5, (w * (devicePixelRatio || 1)) / v1.width), vp = pg.getViewport({ scale: sc }); el.width = vp.width; el.height = vp.height; pg.render({ canvasContext: el.getContext("2d"), viewport: vp }); });
  };
}
R.file = (K, p, env) => {
  const b = bind(K, p, "of", env), rec = b.v && typeof b.v === "object" ? b.v : null;
  if (!rec || !rec.url) return h("div", { class: "f-empty" }, "No file here yet");
  const kind = rec.kind || kindOfFile(rec), st = styleOf(K, p, env), hh = prop(K, p, "h", env);
  const cap = h("div", { class: "f-file-cap" }, h("span", { class: "n" }, rec.name || "file"), h("span", null, [kind.toUpperCase(), rec.size ? size(rec.size) : null, rec.local ? "this tab only" : null].filter(Boolean).join(" · ")),
    h("button", { type: "button", class: "f-btn ghost", on: { click: () => Files.save(rec) } }, "Save a copy"));
  let body;
  if (kind === "image" || kind === "svg") body = h("img", { class: "f-file-img", src: rec.url, alt: rec.alt || rec.name || "", loading: "lazy", style: typeof hh === "number" ? { maxHeight: hh + "px", objectFit: "contain" } : null });
  else if (kind === "video") body = h("video", { class: "f-file-media", src: rec.url, controls: true, preload: "metadata", style: typeof hh === "number" ? { maxHeight: hh + "px" } : null });
  else if (kind === "audio") body = h("audio", { class: "f-file-audio", src: rec.url, controls: true, preload: "metadata" });
  else if (kind === "pdf") {
    const key = rec.url, s = pdfPages(rec, key);
    body = s.err ? h("div", { class: "f-err" }, s.err) : !s.doc ? h("div", { class: "f-empty" }, "Opening the PDF…")
      : h("div", { class: "f-pdf", style: typeof hh === "number" ? { maxHeight: hh + "px" } : null }, Array.from({ length: Math.min(s.doc.numPages, s.shown) }, (_, i) => h("canvas", { key: "pg" + (i + 1), class: "f-pdf-page", "aria-label": `Page ${i + 1}`, ref: drawPage(s.doc, i + 1) })),
        s.doc.numPages > s.shown ? h("button", { type: "button", class: "f-btn ghost", key: "more", on: { click: () => { s.shown += 4; env.rerender(); } } }, `Show more pages (${s.doc.numPages - s.shown} left)`) : null);
  } else body = h("div", { class: "f-file-other" }, h("b", null, (String(rec.name || "").split(".").pop() || "file").toUpperCase()));
  return h("figure", { class: "f-file", style: st }, body, prop(K, p, "caption", env) === false ? null : cap);
};
R.image = (K, p, env) => {
  const v = prop(K, p, "src", env), src = v && typeof v === "object" ? v.url : v, hh = prop(K, p, "h", env), fit = prop(K, p, "fit", env);
  if (typeof src !== "string" || !src) return h("div", { class: "f-empty" }, "No picture yet");
  const st = styleOf(K, p, env); if (typeof hh === "number") { st.height = hh + "px"; st.objectFit = fit === "contain" ? "contain" : "cover"; }
  return h("img", { class: "f-image", src, alt: fmt(prop(K, p, "alt", env) || ""), loading: "lazy", style: st });
};


/* ---------- media: sound and speech, video and audio, a camera and a file picker ---------- */
const NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const Sound = {
  ctx: null,
  freq(n) { if (typeof n === "number") return n; const m = /^([a-g])(#|b)?(\d)?$/i.exec(String(n).trim()); if (!m) return 440; const semi = NOTES[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + ((m[3] ? +m[3] : 4) - 4) * 12 - 9; return 440 * Math.pow(2, semi / 12); },
  play(note = "a4", ms = 220, type = "sine") {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = ["sine", "square", "triangle", "sawtooth"].includes(type) ? type : "sine"; o.frequency.value = this.freq(note);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, ms / 1000));
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + ms / 1000 + 0.05);
    } catch (e) { }
  },
  speak(text) { try { const u = new SpeechSynthesisUtterance(String(text)); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { X.toast("This view cannot speak."); } },
};
const srcOf = v => (v && typeof v === "object" ? v.url : typeof v === "string" ? v : null);
R.video = (K, p, env) => { const s = srcOf(prop(K, p, "src", env)); return s ? h("video", { class: "f-file-media", src: s, controls: true, preload: "metadata", loop: !!prop(K, p, "loop", env), muted: !!prop(K, p, "muted", env), style: styleOf(K, p, env) }) : h("div", { class: "f-empty" }, "No video yet"); };
R.audio = (K, p, env) => { const s = srcOf(prop(K, p, "src", env)); return s ? h("audio", { class: "f-file-audio", src: s, controls: true, preload: "metadata", style: styleOf(K, p, env) }) : h("div", { class: "f-empty" }, "No sound yet"); };
/* upload of: a file record into a cell (or onto a list); camera of: the same, from a phone's camera */
const picker = camera => (K, p, env) => {
  const b = bind(K, p, "of", env), id = uid(p + (env.keySuffix || "") + "#pick"), accept = prop(K, p, "accept", env);
  const list = Array.isArray(b.v), cur = list ? null : b.v && typeof b.v === "object" ? b.v : null;
  const take = async files => {
    if (!files.length || !b.path) return;
    for (const f of [...files].slice(0, list ? 12 : 1)) {
      const kind = kindOfFile(f), st = await Files.store(f, kind);
      const rec = { name: f.name, kind, type: f.type || "", size: f.size, url: st.url }; if (st.id) rec.id = st.id; if (st.local) rec.local = true;
      env.write(list ? `${b.path} += ${H.showLit(rec)}` : `${b.path} = ${H.showLit(rec)}`);
    }
  };
  return h("div", { class: "f-upload", style: styleOf(K, p, env) },
    h("input", { type: "file", id, hidden: true, multiple: list, accept: camera ? "image/*" : typeof accept === "string" ? accept : null, capture: camera ? "environment" : null, on: { change: e => { take(e.target.files); e.target.value = ""; } } }),
    cur && cur.kind === "image" ? h("img", { class: "f-file-img", src: cur.url, alt: cur.name || "" }) : cur ? h("div", { class: "f-file-cap" }, h("span", { class: "n" }, cur.name)) : null,
    h("button", { type: "button", class: "f-btn" + (cur ? " ghost" : ""), disabled: env.readonly || !b.can, on: { click: () => document.getElementById(id).click() } },
      F.label(K, p, env, camera ? (cur ? "Take another" : "Take a photo") : list ? "Add files" : cur ? "Replace" : "Choose a file")));
};
R.upload = picker(false); R.camera = picker(true);

/* ---------- programs ---------- */
const PRELUDE = `"use strict";
const __rid = { n: 0 }, __wait = new Map(), __watch = new Map();
const __post = m => postMessage(m);
const __call = (t, data) => new Promise(res => { const rid = ++__rid.n; __wait.set(rid, res); __post(Object.assign({ t, rid }, data)); });
onmessage = e => { const m = e.data; if (m.t === "reply") { const f = __wait.get(m.rid); if (f) { __wait.delete(m.rid); f(m.value); } } else if (m.t === "watch") { const f = __watch.get(m.id); if (f) Promise.resolve().then(() => f(m.value)).catch(err => print("watch failed: " + err)); } };
const read = path => __call("read", { path: String(path) });
const write = text => __post({ t: "write", text: String(text) });
const set = (path, value) => __post({ t: "set", path: String(path), value: JSON.parse(JSON.stringify(value === undefined ? null : value)) });
const print = (...xs) => __post({ t: "print", text: xs.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const every = (ms, f) => { let busy = false; return setInterval(async () => { if (busy) return; busy = true; try { await f(); } catch (err) { print("error: " + (err && err.message || err)); } busy = false; }, Math.max(16, ms)); };
const watch = (path, f) => { const id = ++__rid.n; __watch.set(id, f); __post({ t: "watch", id, path: String(path) }); return id; };
const ask = prompt => __call("ask", { prompt: String(prompt) });
const now = () => Date.now();
const play = (note, ms, type) => __post({ t: "play", note, ms, type });
const speak = text => __post({ t: "speak", text: String(text) });
`;
const Programs = {
  runs: new Map(),   // program path -> { worker, peer, out, status, startedAt, watches, leaseT }
  trusted: new Set(),
  out(path) { const r = this.runs.get(path); return r ? r.out : []; },
  async start(path) {
    const K = X.K(), code = K.valueAt(path);
    if (typeof code !== "string" || !code.trim()) return X.toast("This program has no code yet.");
    if (this.runs.has(path) && this.runs.get(path).status === "running") return;
    if (X.readonly()) return X.toast("You can look at this desktop but not change it.");
    if (!(await X.lease("program-" + path, 20000))) return X.toast("This program is already running on someone else's page.");
    const app = path.split(".")[0], peer = X.peer("p-" + app);
    const run = { worker: null, peer, out: (this.runs.get(path) || {}).out || [], status: "running", startedAt: Date.now(), watches: [], app, path };
    this.runs.set(path, run);
    const src = PRELUDE + "\n(async () => {\n" + code + "\n})().then(() => __post({ t: 'end' }), err => __post({ t: 'error', text: String(err && err.stack || err) }));";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    try { run.worker = new Worker(url); } catch (e) { run.status = "error"; this.say(run, "Could not start: " + e.message); return; }
    URL.revokeObjectURL(url);
    run.worker.onerror = e => { e.preventDefault(); run.status = "error"; this.say(run, (e.message || "error") + (e.lineno ? ` (line ${Math.max(1, e.lineno - PRELUDE.split("\n").length - 1)})` : "")); this.stop(path, true); };
    run.worker.onmessage = e => this.msg(run, e.data);
    run.leaseT = setInterval(() => X.lease("program-" + path, 20000), 8000);
    this.say(run, "started on this page"); X.presence(); X.rerender();
  },
  stop(path, keep) {
    const r = this.runs.get(path); if (!r) return;
    if (r.worker) r.worker.terminate(); clearInterval(r.leaseT);
    if (!keep || r.status === "running") r.status = r.status === "error" ? "error" : "stopped";
    if (r.status === "stopped") this.say(r, "stopped");
    X.presence(); X.rerender();
  },
  say(run, text) { run.out.push({ at: Date.now(), text: String(text).slice(0, 2000) }); if (run.out.length > 200) run.out.splice(0, run.out.length - 200); X.rerender(); },
  resolve(run, path) { return F.refPath(X.K(), path, run.app); },
  plain(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v, (k, x) => (H.isRes(x) || H.isErr(x) ? null : x))); },
  msg(run, m) {
    if (!m || run.status !== "running") return;
    const K = X.K();
    switch (m.t) {
      case "read": run.worker.postMessage({ t: "reply", rid: m.rid, value: this.plain(K.valueAt(this.resolve(run, m.path) || "")) }); break;
      case "set": { const p = this.resolve(run, m.path); if (p) X.commit(`${p} = ${H.showLit(m.value)}`, run.peer); break; }
      case "write": X.stream(m.text, run.peer); break;
      case "print": this.say(run, m.text); break;
      case "watch": { const p = this.resolve(run, m.path); run.watches.push({ id: m.id, path: p, last: JSON.stringify(this.plain(K.valueAt(p))) }); break; }
      case "ask": X.sampleText(m.prompt).then(v => run.worker && run.worker.postMessage({ t: "reply", rid: m.rid, value: v }), e => run.worker && run.worker.postMessage({ t: "reply", rid: m.rid, value: "(Claude could not answer: " + (e.message || e.code || e) + ")" })); break;
      case "play": Sound.play(m.note, m.ms, m.type); break;
      case "speak": Sound.speak(m.text); break;
      case "end": this.say(run, "finished"); run.status = "done"; this.stop(run.path, true); break;
      case "error": run.status = "error"; this.say(run, m.text.split("\n").slice(0, 3).join("\n")); this.stop(run.path, true); break;
    }
  },
  /* the tree changed: tell each program watching a value that moved */
  changed() {
    const K = X.K();
    for (const r of this.runs.values()) {
      if (r.status !== "running") continue;
      for (const w of r.watches) { const v = this.plain(K.valueAt(w.path)), j = JSON.stringify(v); if (j !== w.last) { w.last = j; r.worker.postMessage({ t: "watch", id: w.id, value: v }); } }
    }
  },
  running() { return [...this.runs.entries()].filter(([, r]) => r.status === "running").map(([p]) => p); },
  /* programs typed `:: program auto` start by themselves on the page of the person who wrote them */
  autostart() {
    const K = X.K();
    for (const [p, t] of K.types) if (t.name === "program" && t.args && t.args.includes("auto") && !this.runs.has(p) && K.cells.has(p) && X.mine(K.cells.get(p).by)) this.start(p);
  },
};
R.program = (K, p, env) => {
  const b = bind(K, p, "of", env), path = b.path;
  if (!path || !K.cells.has(path)) return h("div", { class: "f-empty" }, "program needs a cell of code: program run");
  const c = K.cells.get(path), run = Programs.runs.get(path), status = run ? run.status : "stopped";
  const elsewhere = X.runningElsewhere(path);
  const trusted = X.mine(c.by) || Programs.trusted.has(path + "#" + c.clock);
  const code = typeof c.v === "string" ? c.v : "";
  const lines = (run ? run.out : []).slice(-14);
  const since = run && status === "running" ? Math.round((Date.now() - run.startedAt) / 1000) : 0;
  const label = elsewhere && status !== "running" ? `running on ${elsewhere}'s page` : status === "running" ? `running · ${since < 60 ? since + " s" : Math.round(since / 60) + " min"}` : status;
  const showCode = env.local.get(p + "#code");
  return h("div", { class: "f-program " + status, style: styleOf(K, p, env) },
    h("div", { class: "f-program-h" }, h("span", { class: "dot" }), h("b", null, prop(K, p, "label", env) != null ? fmt(prop(K, p, "label", env)) : path.split(".").slice(1).join(".") || path), h("span", { class: "st" }, label), h("span", { class: "grow" }),
      h("button", { type: "button", class: "f-btn ghost", on: { click: () => { env.local.set(p + "#code", !showCode); env.rerender(); } } }, showCode ? "Hide code" : "Code"),
      status === "running" ? h("button", { type: "button", class: "f-btn", on: { click: () => Programs.stop(path) } }, "Stop")
        : trusted ? h("button", { type: "button", class: "f-btn primary", disabled: env.readonly || !!elsewhere, on: { click: () => Programs.start(path) } }, status === "stopped" ? "Run" : "Run again") : null),
    !trusted && status !== "running" ? h("div", { class: "f-program-trust" }, h("p", null, `${X.nameOf(c.by)} wrote this code. It runs in a sandbox on your page and can change this desktop. Read it, then run it.`), h("pre", { class: "f-code" }, code),
      h("button", { type: "button", class: "f-btn primary", disabled: env.readonly || !!elsewhere, on: { click: () => { Programs.trusted.add(path + "#" + c.clock); Programs.start(path); } } }, "I read it: run it")) : null,
    showCode && trusted ? h("pre", { class: "f-code f-program-code" }, code) : null,
    lines.length ? h("pre", { class: "f-program-out", "aria-live": "polite" }, lines.map(l => l.text).join("\n")) : null);
};

/* ---------- init ---------- */
const Computer = {
  Clock, Jobs, Files, Programs, Sound, nextRun, kindOfFile,
  init(host) { X = host; Clock.start(); Jobs.start(); setTimeout(() => Programs.autostart(), 2500); },
};
root.CC5Computer = Computer;
})(typeof window !== "undefined" ? window : globalThis);
