// ---------- slop context (web/pinup/slop; not part of upstream Pinup) ----------
// Pinup runs on slop's native runtime: window.claude comes from
// /_slop/claude.js, so db, room, user, downloads and sample are the
// contract's own. This module only gives slop's panels (95-97) their
// context, in one of two modes, read from the boot data:
//   tool    the Workshop runs Pinup on a design (/run/<design>): a data
//           artifact with app = pinup. SLOP.api is claude.use("slop"), the
//           management API an admin approved (push, routes, threads);
//           SLOP.file is the design.
//   player  a site route binds a design (slop route set /proto/x/:screen
//           pinup-player --bind target=<design>): the runtime is in static
//           mode, db is the design's saved db.json, read-only.
const SLOP = { mode: null, api: null, file: null, boot: {} };
try { SLOP.boot = JSON.parse((document.getElementById('slop-boot') || {}).textContent || '{}'); } catch {}
if (SLOP.boot.mode === 'static') SLOP.mode = 'player';
else if (SLOP.boot.mode === 'app' && SLOP.boot.runtime && SLOP.boot.runtime.caps && 'slop' in SLOP.boot.runtime.caps) {
  SLOP.mode = 'tool';
  SLOP.file = SLOP.boot.runtime.target;
}
// The slop capability resolves once the shell hands over the view; null
// when this version's permissions are not approved (the menus then stay
// disabled and say so).
const SLOP_READY = SLOP.mode === 'tool' && window.claude
  ? window.claude.use('slop').then(api => { SLOP.api = api; if (api && SLOP.file === api.app) slopPick(api); return api; }, () => null)
  : Promise.resolve(null);

// ---------- pushing versions (Save version, Publish app) ----------
async function slopSha(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// files: path → string or bytes. o: {message, base | create, manifest, moveMain}.
async function slopPush(artifact, files, o) {
  const api = SLOP.api, enc = new TextEncoder(), tree = {}, bytes = {};
  for (const p of Object.keys(files)) { const b = typeof files[p] === 'string' ? enc.encode(files[p]) : files[p]; const sha = await slopSha(b); tree[p] = sha; bytes[sha] = b; }
  const m = await api.post('/blobs/missing', { sha256: Object.values(tree) });
  for (const sha of (m && m.missing) || []) await api.putRaw('/blobs/' + sha, bytes[sha], 'application/octet-stream');
  const body = { tree, message: o.message || 'Saved from Pinup' };
  if (o.create) body.create = o.create; else body.base = o.base;
  if (o.manifest) body.manifest = o.manifest;
  if (o.moveMain === false) body.moveMain = false;
  return api.post('/artifacts/' + encodeURIComponent(artifact) + '/versions', body);
}

// ---------- choosing the design (Pinup opened on itself) ----------
document.head.append(h('style', { text: `
.slop-designs { display: flex; flex-direction: column; gap: 4px; max-height: min(320px, 45vh); overflow: auto; padding-bottom: 12px; }
.slop-design { display: flex; align-items: baseline; gap: 12px; width: 100%; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: var(--r); background: var(--panel); text-align: left; cursor: pointer; flex: none; }
.slop-design:hover { background: var(--panel-2); }
.slop-design b { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slop-design span { flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11.5px; }
` }));
// A design is a data artifact whose app is pinup; picking one asks the
// Workshop to open it (/run/<design>), so its state is its own db.
function slopPick(api) {
  const list = h('div', { class: 'slop-designs' }, h('span', { class: 'muted', text: 'Loading…' }));
  const name = h('input', { type: 'text', placeholder: 'Name, e.g. Pace Club', 'aria-label': 'Design name', style: { width: '100%' } });
  const proj = h('select', { 'aria-label': 'Project' }, h('option', { value: '', text: 'No project' }));
  const err = h('span', { class: 'muted' });
  const create = h('button', { class: 'btn primary sm', text: 'Create', onclick: async () => {
    const n = name.value.trim(); if (!n) { name.focus(); return; }
    const id = ('design-' + slug(n)).slice(0, 63);
    create.disabled = true; err.textContent = 'Creating ' + id + '…';
    try {
      await api.post('/artifacts', { id, title: n, kind: 'data', type: 'pinup', app: api.app, project: proj.value || null });
      api.open(id);
    } catch (e) { create.disabled = false; err.textContent = 'Could not create ' + id + ': ' + (e.message || e); }
  } });
  const body = [h('div', { class: 'opt', style: { paddingBottom: '6px' } }, h('b', { text: 'Designs' })), list,
    h('div', { class: 'opt' }, h('b', { text: 'New design' }), name, h('div', { class: 'acts' }, proj, create), err)];
  sheet('Open a design', body, { width: 520 });
  const projects = api.get('/projects').then(ps => ps || [], () => []);
  projects.then(ps => { for (const p of ps) proj.append(h('option', { value: p.id, text: p.name })); });
  Promise.all([api.get('/artifacts'), projects]).then(([arts, ps]) => {
    const pname = new Map(ps.map(p => [p.id, p.name]));
    const ds = (arts || []).filter(a => a.kind === 'data' && a.app === api.app)
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
    list.textContent = '';
    if (!ds.length) list.append(h('span', { class: 'muted', text: 'No designs yet: create one below.' }));
    for (const a of ds) {
      list.append(h('button', { class: 'slop-design', title: 'Open ' + a.id, onclick: () => api.open(a.id) },
        h('b', { text: a.title || a.id }),
        h('span', { text: [a.project && (pname.get(a.project) || a.project), a.id, a.main ? 'v' + a.main : 'no version yet'].filter(Boolean).join(' · ') })));
    }
  }, e => { list.textContent = 'Could not list designs: ' + (e.message || e); });
}
