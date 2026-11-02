// ---------- state ----------
const S = {
  file: { name: 'Untitled', pages: [{ id: 'p1', name: 'Page 1' }], tokens: { colors: {}, type: {} }, v: 1 },
  nodes: new Map(),
  pageId: 'p1',
  sel: [],
  tool: 'move',
  views: lsGet('pinup.views', {}),
  tab: 'design',
  ltab: 'layers',
  canEdit: true,
  canFeedback: true,
  roReason: '',
  open: new Set(lsGet('pinup.open', [])),
  hover: null,
  editing: null,
  loaded: false,
  me: { id: null, name: 'You', color: '#2B59FF', peer: uid(8) },
  peers: [],
  threads: [],
  commentMode: false,
  grid: lsGet('pinup.grid', true),
};

const TYPES = ['frame', 'rect', 'ellipse', 'line', 'text', 'icon', 'svg', 'instance'];
const TEXT_DEFAULTS = { font: 'Inter', size: 16, weight: 400, lh: 1.4, ls: 0, talign: 'left' };

// Fill in defaults and coerce types so data written by anyone (people, Claude, older versions) renders.
function norm(id, d) {
  const n = Object.assign({}, d || {});
  n.id = id;
  if (!TYPES.includes(n.type)) n.type = n.type === 'group' ? 'frame' : (n.type === 'image' ? 'rect' : 'rect');
  if (d && d.type === 'group') n.group = true;
  n.page = n.page || S.pageId || (S.file.pages[0] && S.file.pages[0].id);
  n.parent = n.parent || null;
  n.name = n.name == null || n.name === '' ? defaultName(n) : String(n.name);
  for (const k of ['x', 'y']) n[k] = Number.isFinite(+n[k]) ? +n[k] : 0;
  for (const k of ['w', 'h']) n[k] = Number.isFinite(+n[k]) ? Math.max(0, +n[k]) : (n.type === 'text' ? 0 : 100);
  n.z = Number.isFinite(+n.z) ? +n.z : 0;
  n.rot = +n.rot || 0;
  n.visible = n.visible !== false;
  n.locked = !!n.locked;
  n.opacity = n.opacity == null ? 1 : clamp(+n.opacity, 0, 1);
  if (!Array.isArray(n.fills)) n.fills = n.fills && typeof n.fills === 'object' ? [n.fills] : defaultFills(n);
  n.fills = n.fills.filter(f => f && typeof f === 'object').map(f => Object.assign({ t: f.t || (f.css ? 'gradient' : f.src ? 'image' : 'solid') }, f));
  if (n.stroke && typeof n.stroke !== 'object') n.stroke = null;
  if (n.stroke) n.stroke = Object.assign({ c: '#000000', w: 1, style: 'solid' }, n.stroke);
  if (!Array.isArray(n.effects)) n.effects = [];
  if (n.type === 'frame') { if (n.clip == null) n.clip = !n.group; }
  if (n.layout && typeof n.layout === 'object') {
    const L = n.layout;
    n.layout = {
      dir: L.dir === 'row' ? 'row' : 'col',
      gap: L.gap === 'auto' ? 'auto' : (+L.gap || 0),
      pad: Array.isArray(L.pad) ? [0, 1, 2, 3].map(i => +L.pad[i] || 0) : [+L.pad || 0, +L.pad || 0, +L.pad || 0, +L.pad || 0],
      align: L.align || 'start', justify: L.justify || 'start', wrap: !!L.wrap,
    };
  } else n.layout = null;
  n.sw = ['fixed', 'hug', 'fill'].includes(n.sw) ? n.sw : (n.type === 'text' && !d?.w ? 'hug' : 'fixed');
  n.sh = ['fixed', 'hug', 'fill'].includes(n.sh) ? n.sh : (n.type === 'text' ? 'hug' : 'fixed');
  if (n.type === 'text') {
    n.text = n.text == null ? '' : String(n.text);
    for (const k in TEXT_DEFAULTS) if (n[k] == null || n[k] === '') n[k] = TEXT_DEFAULTS[k];
    n.size = +n.size || 16; n.weight = +n.weight || 400; n.lh = +n.lh || 1.4; n.ls = +n.ls || 0;
  }
  if (n.type === 'icon') { n.icon = n.icon || 'square'; if (!n.svg) n.svg = iconMarkup(n.icon); n.iw = +n.iw || 2; }
  if (n.type === 'instance') { n.ov = n.ov && typeof n.ov === 'object' ? n.ov : {}; }
  if (n.link && (!n.link.to)) n.link = null;
  return n;
}
function defaultName(n) {
  return { frame: n.group ? 'Group' : 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: (n.text || 'Text').slice(0, 40), icon: n.icon || 'Icon', svg: 'Vector', instance: 'Instance' }[n.type] || 'Layer';
}
function defaultFills(n) {
  if (n.type === 'text') return [{ t: 'solid', c: '#111111' }];
  if (n.type === 'icon') return [{ t: 'solid', c: '#111111' }];
  if (n.type === 'frame') return n.group ? [] : [{ t: 'solid', c: '#FFFFFF' }];
  if (n.type === 'rect' || n.type === 'ellipse') return [{ t: 'solid', c: '#D9D9DE' }];
  return [];
}

// ---------- tree index ----------
let _kids = null;
function pkey(n) { return n.parent ? n.parent : 'page:' + n.page; }
function index() {
  if (_kids) return _kids;
  _kids = new Map();
  for (const n of S.nodes.values()) {
    const k = pkey(n);
    let a = _kids.get(k); if (!a) _kids.set(k, (a = []));
    a.push(n);
  }
  for (const a of _kids.values()) a.sort((p, q) => p.z - q.z || (p.id < q.id ? -1 : 1));
  return _kids;
}
function invalidate() { _kids = null; }
const get = id => S.nodes.get(id);
const kids = id => index().get(id) || [];
const roots = pageId => index().get('page:' + (pageId || S.pageId)) || [];
function parentOf(id) { const n = get(id); return n && n.parent ? get(n.parent) : null; }
function ancestors(id) { const out = []; let n = get(id); let guard = 0; while (n && n.parent && guard++ < 200) { n = get(n.parent); if (n) out.push(n); } return out; }
function topOf(id) { let n = get(id), guard = 0; while (n && n.parent && guard++ < 200) { const p = get(n.parent); if (!p) break; n = p; } return n; }
function isAnc(a, b) { return ancestors(b).some(n => n.id === a); } // a is ancestor of b
function descendants(id, out = []) { for (const k of kids(id)) { out.push(k); descendants(k.id, out); } return out; }
function inLayout(n) { const p = n && n.parent && get(n.parent); return !!(p && p.layout && !n.abs); }
function isContainer(n) { return n && n.type === 'frame'; }
function masterOf(n) { return n && n.type === 'instance' ? get(n.of) : null; }
function inComponent(id) { const n = get(id); if (!n) return null; if (n.component) return n; return ancestors(id).find(a => a.component) || null; }
function pageName(pid) { const p = S.file.pages.find(p => p.id === pid); return p ? p.name : 'Page'; }
function framesOnPage(pid) { return roots(pid).filter(n => n.type === 'frame' && !n.group); }
function allFrames() { const out = []; for (const p of S.file.pages) out.push(...framesOnPage(p.id)); return out; }
function components() { return [...S.nodes.values()].filter(n => n.component).sort((a, b) => a.name.localeCompare(b.name)); }
function findByName(name, type) { name = String(name).trim().toLowerCase(); return [...S.nodes.values()].find(n => n.name.toLowerCase() === name && (!type || n.type === type)); }

// ---------- history + commit ----------
const H = { undo: [], redo: [], tx: null };
let CUR_GROUP = null;
let CUR_META = null; // {by:'claude', feedback, label} while Claude works on a step
function newEntry(label, changes, extra) {
  const m = CUR_META || {};
  return Object.assign({ label, changes, t: Date.now(), logId: 'L' + Date.now().toString(36) + uid(4), agent: m.by === 'claude', feedback: m.feedback || null, revertOf: m.revertOf || null }, extra);
}
// key-order-independent equality (db round trips may reorder keys)
function stable(v) { if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'; return JSON.stringify(v === undefined ? null : v); }
const stableEq = (a, b) => stable(a == null ? null : a) === stable(b == null ? null : b);
// changes: [{id, after, before?}] — after null = delete. id '__file' = file meta.
function commit(changes, opts = {}) {
  if (!changes.length) return;
  if (!S.canEdit && !opts.force) { toast('Editing is off for you here — you can view, present and comment.'); return; }
  const rec = [];
  for (const c of changes) {
    const before = c.before !== undefined ? c.before : (c.id === '__file' ? clone(S.file) : clone(get(c.id) || null));
    let after = c.after == null ? null : clone(c.after);
    if (c.id === '__file') { S.file = Object.assign({ pages: [], tokens: { colors: {}, type: {} } }, after); }
    else if (after) { after = norm(c.id, after); S.nodes.set(c.id, after); }
    else S.nodes.delete(c.id);
    rec.push({ id: c.id, before, after: clone(after) });
    if (opts.write !== false) queueWrite(c.id, after);
    markDirty(c.id, before, after);
  }
  invalidate();
  if (opts.history !== false) record(rec, opts);
  scheduleRender();
}
function record(rec, opts) {
  if (H.tx) { mergeInto(H.tx.changes, rec); return; }
  const now = Date.now();
  const last = H.undo[H.undo.length - 1];
  const g = opts.group || CUR_GROUP;
  let entry;
  if (g && last && last.group === g) { mergeInto(last.changes, rec); last.t = now; entry = last; }
  else if (opts.coalesce && last && last.key === opts.coalesce && now - last.t < 1200) { mergeInto(last.changes, rec); last.t = now; entry = last; }
  else { entry = newEntry(g && CUR_META && CUR_META.label ? CUR_META.label : g ? 'Claude' : (opts.label || 'Edit'), rec, { key: opts.coalesce || null, group: g || null }); H.undo.push(entry); if (H.undo.length > 200) H.undo.shift(); }
  logTouch(entry);
  H.redo.length = 0;
  updateUndoButtons();
}
function mergeInto(list, rec) {
  for (const r of rec) { const ex = list.find(x => x.id === r.id); if (ex) ex.after = r.after; else list.push(r); }
}
function begin(label) { if (!H.tx) H.tx = { label, changes: [], depth: 0 }; H.tx.depth++; }
function end() {
  if (!H.tx) return; if (--H.tx.depth > 0) return;
  const tx = H.tx; H.tx = null;
  const ch = tx.changes.filter(c => !same(c.before, c.after));
  if (ch.length) { const e = newEntry(tx.label, ch, {}); H.undo.push(e); H.redo.length = 0; logTouch(e); }
  updateUndoButtons();
}
function txn(label, fn) { begin(label); try { return fn(); } finally { end(); } }
function applyStates(list, which) {
  const ch = list.map(c => ({ id: c.id, after: c[which] }));
  commit(ch, { history: false });
  S.sel = S.sel.filter(id => S.nodes.has(id));
}
function undo() { if (!S.canEdit) return; const e = H.undo.pop(); if (!e) return; applyStates([...e.changes].reverse(), 'before'); H.redo.push(e); updateUndoButtons(); logMark(e.logId, { undone: true }); toast('Undo: ' + e.label, 1200); }
function redo() { if (!S.canEdit) return; const e = H.redo.pop(); if (!e) return; applyStates(e.changes, 'after'); H.undo.push(e); updateUndoButtons(); logMark(e.logId, { undone: false }); toast('Redo: ' + e.label, 1200); }
function updateUndoButtons() { const u = $('#bUndo'), r = $('#bRedo'); if (u) u.disabled = !H.undo.length || !S.canEdit; if (r) r.disabled = !H.redo.length || !S.canEdit; }

// convenience
function patch(id, p, opts = {}) { const n = get(id); if (!n) return; commit([{ id, after: Object.assign({}, n, p) }], Object.assign({ label: 'Edit' }, opts)); }
function patchMany(pairs, opts = {}) { commit(pairs.filter(([id]) => get(id)).map(([id, p]) => ({ id, after: Object.assign({}, get(id), p) })), Object.assign({ label: 'Edit' }, opts)); }
function setFile(p, opts = {}) { commit([{ id: '__file', after: Object.assign(clone(S.file), p) }], Object.assign({ label: 'File' }, opts)); }
function removeNodes(ids, label = 'Delete') {
  const all = new Set();
  for (const id of ids) { if (!get(id)) continue; all.add(id); descendants(id).forEach(d => all.add(d.id)); }
  // instances of deleted components become detached copies would be ideal; keep them but they render as missing
  // feedback pinned to deleted layers moves up to the nearest surviving ancestor
  const survivor = id => { let n = get(id); while (n && all.has(n.id)) n = n.parent ? get(n.parent) : null; return n ? n.id : null; };
  const moves = [...FB.items.values()].filter(it => all.has(it.node)).map(it => [it.id, survivor(it.node), it.node]);
  commit([...all].map(id => ({ id, after: null })), { label });
  S.sel = S.sel.filter(id => !all.has(id));
  for (const [fid, to, from] of moves) fbPatch(fid, { node: to, was: from });
}
function nextZ(pk) { const a = index().get(pk) || []; return a.length ? a[a.length - 1].z + 1 : 0; }

// ---------- persistence ----------
// Two backends with one shape: the artifact db (shared, Claude can read/write) or this browser only.
const DB = { kind: 'none', db: null, pending: new Map(), inflight: 0, queue: [], firstNodes: false, firstFile: false, errors: 0 };
const MAX_INFLIGHT = 12;
function queueWrite(id, data) {
  const key = id === '__file' ? '__file' : id;
  const ex = DB.pending.get(key);
  if (ex) { ex.data = data; ex.dirty = true; return; }
  DB.pending.set(key, { data, dirty: true, busy: false });
  DB.queue.push(key);
  pump();
}
function pump() {
  while (DB.inflight < MAX_INFLIGHT && DB.queue.length) {
    const key = DB.queue.shift();
    const p = DB.pending.get(key); if (!p || p.busy) continue;
    p.busy = true; p.dirty = false; DB.inflight++;
    const data = p.data ? JSON.parse(JSON.stringify(p.data)) : null;
    writeDoc(key, data).then(() => {}, err => onWriteError(key, err)).finally(() => {
      DB.inflight--; p.busy = false;
      if (p.dirty) DB.queue.push(key); else DB.pending.delete(key);
      pump();
      if (!DB.pending.size) saveState('idle');
    });
  }
  saveState(DB.pending.size ? 'saving' : 'idle');
}
async function writeDoc(key, data) {
  if (DB.kind === 'remote') {
    const sep = key.indexOf(':');
    const ref = key === '__file' ? DB.db.doc('meta/file') : sep > 0 ? DB.db.doc(key.slice(0, sep) + '/' + key.slice(sep + 1)) : DB.db.doc('nodes/' + key);
    if (data) { if (key !== '__file') delete data._m; return ref.set(data); }
    return ref.delete();
  }
  if (DB.kind === 'local') { localSave(); return; }
}
function onWriteError(key, err) {
  const code = err && err.code;
  console.warn('[pinup] write failed', key, code, err && err.message);
  if (key.startsWith('log:')) return; // history is best-effort
  if (key.startsWith('feedback:')) { if (code === 'invalid_argument' && !/size|large|bytes/i.test(err.message || '')) { S.canFeedback = false; toast('You can view this file but not leave feedback here.'); } else toast('That feedback could not be saved.'); return; }
  if (code === 'invalid_argument' && /size|large|bytes|limit/i.test(err.message || '')) { toast('That layer is too large to save (images over ~200 KB). Try a smaller image.'); return; }
  if (code === 'quota_exceeded') { toast('This file has hit its storage limit — delete unused layers or images.'); return; }
  if (code === 'not_granted' || code === 'invalid_argument' || code === 'revoked' || code === 'capability_disabled') {
    if (S.canEdit) { setReadOnly('You can view, present and comment. Ask the owner for edit access to change the design.'); }
    return;
  }
  if (code === 'resource_exhausted' || code === 'unavailable') {
    if (++DB.errors < 5) setTimeout(() => queueWrite(key, key === '__file' ? S.file : (get(key) || null)), 1500 * DB.errors);
    else toast('Saving is having trouble. Your changes stay here; keep this tab open.');
  }
}
let saveStateT;
function saveState(s) { clearTimeout(saveStateT); saveStateT = setTimeout(() => { const el = $('#saveState'); if (el) el.textContent = s === 'saving' ? 'Saving…' : ''; }, s === 'saving' ? 300 : 0); }

// local backend
const LOCAL_KEY = 'pinup.local.v1';
const localSave = debounce(() => lsSet(LOCAL_KEY, { file: S.file, nodes: [...S.nodes.values()], feedback: [...FB.items.values()], log: [...LOG.items.values()].slice(-150) }), 250);

// incoming remote changes
function applyRemoteNode(id, data) {
  if (DB.pending.has(id)) return; // our newer local state wins until our write lands
  const before = get(id) || null;
  if (data) { const n = norm(id, data); if (before && same(before, n)) return; S.nodes.set(id, n); markDirty(id, before, n); }
  else { if (!before) return; S.nodes.delete(id); markDirty(id, before, null); S.sel = S.sel.filter(x => x !== id); }
  invalidate();
  scheduleRender();
}
function applyRemoteFile(data) {
  if (DB.pending.has('__file') || !data) return;
  const f = Object.assign({ name: 'Untitled', pages: [], tokens: { colors: {}, type: {} } }, data);
  if (!Array.isArray(f.pages) || !f.pages.length) f.pages = S.file.pages.length ? S.file.pages : [{ id: 'p1', name: 'Page 1' }];
  f.tokens = Object.assign({ colors: {}, type: {} }, f.tokens || {});
  if (same(f, S.file)) return;
  S.file = f;
  if (!f.pages.find(p => p.id === S.pageId)) S.pageId = f.pages[0].id;
  markAllDirty();
  scheduleRender();
}

// ---------- dirty tracking (render) ----------
const DIRTY = { roots: new Set(), all: false, chrome: true };
function markDirty(id, before, after) {
  DIRTY.chrome = true;
  if (id === '__file') { DIRTY.all = true; return; }
  for (const n of [before, after]) {
    if (!n) continue;
    if (n.page !== S.pageId) { if (inComponent(n.id) || n.component) DIRTY.all = true; continue; }
    const t = n.parent ? (topOf(n.parent) || n) : n;
    DIRTY.roots.add(t.id);
    if (n.component || (n.parent && inComponent(n.parent))) DIRTY.all = true; // instances elsewhere must follow their main
  }
  if (before && after && before.parent !== after.parent && before.parent) { const t = topOf(before.parent); t && DIRTY.roots.add(t.id); }
  if (before && !after) DIRTY.roots.add(before.id);
}
function markAllDirty() { DIRTY.all = true; DIRTY.chrome = true; }
