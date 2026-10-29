// ---------- slop UI (web/pinup/slop; not part of upstream Pinup) ----------
// Tool mode: a "slop" menu beside Share — save the live file as a version of
// the design artifact, publish it as a prototype on a site host, hand it to
// a coding agent. Player mode: hide the editor, present the bound design,
// keep the URL on the current screen.

// A saved version: the file, one record per page (a version holds at most
// 2000 files, a design can have more layers), and the handoff brief.
// Feedback stays in the live file: a published prototype reads the version.
function slopSnapshotFiles() {
  const strip = (k, v) => (k === '_m' ? undefined : v);
  const files = { 'file.json': JSON.stringify(S.file, strip) };
  for (const pg of S.file.pages) {
    files['pages/' + pg.id + '.json'] = JSON.stringify({ id: pg.id, name: pg.name, nodes: [...S.nodes.values()].filter(n => n.page === pg.id) }, strip);
  }
  files['handoff.md'] = handoffMarkdown();
  return files;
}

async function slopSaveVersion(note) {
  const api = SLOP.api, id = encodeURIComponent(SLOP.file);
  const a = await api.get('/artifacts/' + id);
  const r = await slopPush(SLOP.file, slopSnapshotFiles(), { base: a.main, message: note || 'Saved from Pinup' });
  const v = r && r.version ? r.version.n : (r && r.n) || a.main + 1;
  if (r && r.unchanged) toast('Nothing changed since v' + v + '.');
  else toast('Saved ' + SLOP.file + ' v' + v + '.');
  return v;
}

function slopNoteSheet(title, intro, button, act) {
  const ta = h('textarea', { rows: 3, placeholder: 'What changed (optional)', style: { width: '100%' } });
  const go = h('button', { class: 'btn primary sm', text: button, onclick: async () => {
    go.disabled = true;
    try { await act(ta.value.trim()); sh.close(); } catch (e) { go.disabled = false; toast('Failed: ' + (e.message || e), 4000); }
  } });
  const sh = sheet(title, [h('p', { text: intro }), ta, h('div', { class: 'acts' }, go)], { width: 520 });
}

function slopPublishSheet() {
  const api = SLOP.api;
  const hosts = (api.config && api.config.siteHosts) || [];
  const host = h('select', { 'aria-label': 'Site host' }, ...hosts.map(x => h('option', { value: x, text: x })));
  const path = h('input', { type: 'text', value: '/proto/' + slug(S.file.name), 'aria-label': 'Path', style: { width: '100%' } });
  const out = h('span', { class: 'muted' });
  const go = h('button', { class: 'btn primary sm', text: 'Save and publish', onclick: async () => {
    const p = '/' + path.value.trim().replace(/^\/+|\/+$/g, '');
    if (!/^\/[a-z0-9][a-z0-9/_-]*$/.test(p)) { out.textContent = 'A path is lowercase letters, digits, - and /.'; return; }
    go.disabled = true; out.textContent = 'Saving…';
    try {
      await api.get('/artifacts/pinup-player').catch(() => { throw new Error('the pinup-player page is not on this server yet (make pinup-push)'); });
      const v = await slopSaveVersion('Published from Pinup');
      const route = sp => ({ host: host.value, path: sp, page: 'pinup-player', version: null, access: 'public',
        bindings: { design: { artifact: SLOP.file, version: null } }, note: 'Pinup prototype of ' + SLOP.file + ' (v' + v + ', follows main)' });
      await api.put('/routes', route(p));
      await api.put('/routes', route(p + '/:screen'));
      const url = location.protocol + '//' + host.value + p;
      out.textContent = '';
      out.append('Live at ', h('a', { href: url, target: '_blank', rel: 'noopener', text: url }), '. Each Save version updates it.');
    } catch (e) { go.disabled = false; out.textContent = 'Could not publish: ' + (e.message || e); }
  } });
  const can = api.can('routes:write');
  sheet('Publish prototype', [
    h('p', { text: 'Saves a version of this design and serves it as a clickable prototype: one URL per screen, following the design’s main.' }),
    h('div', { class: 'opt' }, h('b', { text: 'Where' }), host, path),
    can ? h('div', { class: 'acts' }, go) : h('p', { class: 'muted', text: 'This tool was not granted routes:write. An admin can publish it with: slop route set ' + path.value + '/:screen pinup-player --bind design=' + SLOP.file }),
    out,
  ], { width: 560 });
}

async function slopHandOff(note) {
  const api = SLOP.api, id = encodeURIComponent(SLOP.file);
  const v = await slopSaveVersion('Handed off from Pinup');
  const text = [
    'Build the app designed in ' + SLOP.file + ' v' + v + '.',
    '`slop pull ' + SLOP.file + '` gives handoff.md (tokens, components, screens as JSX, the prototype map) and pages/*.json (every layer).',
    'Push the app as a page artifact, route it on the site, and reply here with the URL. Design changes go through `slop docs` (see `slop help pinup`).',
    note ? 'Notes: ' + note : '',
  ].filter(Boolean).join('\n\n');
  await api.post('/artifacts/' + id + '/threads', { version: v, anchor: { pinup: { file: SLOP.file, handoff: true } }, text });
  toast('Handed off: a thread on ' + SLOP.file + ' v' + v + ' is waiting for an agent.', 3500);
}

function slopBrief() {
  return [
    'Pinup design on slop: ' + SLOP.file + ' (' + S.file.name + ').',
    'Read it:   slop docs ls ' + SLOP.file + ' nodes/      slop docs get ' + SLOP.file + ' meta/file',
    'Change it: write HTML or a step to inbox/<id>:  slop docs put ' + SLOP.file + ' inbox/s1 step.json',
    'Follow it: slop docs watch ' + SLOP.file,
    'Formats:   slop help pinup',
  ].join('\n');
}

function slopMenu() {
  const ready = !!(SLOP.api && SLOP.file);
  const push = ready && SLOP.api.can('versions:push');
  return [
    { head: ready ? 'slop · ' + SLOP.file : 'slop' },
    { label: 'Save version…', icon: 'save', disabled: !push, act: () => slopNoteSheet('Save version', 'Writes the live file as a new version of ' + SLOP.file + '. Published prototypes follow it.', 'Save', slopSaveVersion) },
    { label: 'Publish prototype…', icon: 'presentation', disabled: !push, act: slopPublishSheet },
    '-',
    S.file.app
      ? { label: 'App settings…', icon: 'settings', disabled: !push, act: slopAppSheet }
      : { label: 'Make this an app…', icon: 'globe', disabled: !push, act: slopAppSheet },
    { label: LP.open ? 'Hide live preview' : 'Live preview', icon: 'app-window', disabled: !ready, act: () => lpToggle() },
    { label: 'Preview app', icon: 'eye', disabled: !push || !S.file.app, act: () => slopAppRun(true) },
    { label: 'Publish app', icon: 'rocket', disabled: !push || !S.file.app || !SLOP.api.can('routes:write'), act: () => slopAppRun(false) },
    '-',
    { label: 'Hand off to an agent…', icon: 'bot', disabled: !push || !SLOP.api.can('threads:write'), act: () => slopNoteSheet('Hand off to an agent', 'Saves a version and opens a thread asking a coding agent (slop comments wait) to build the app from it.', 'Hand off', slopHandOff) },
    '-',
    { label: 'Copy agent brief', icon: 'clipboard-copy', disabled: !ready, act: () => copyText(slopBrief(), 'Agent brief copied') },
    { label: 'Open another design…', icon: 'folder-open', disabled: !ready, act: () => { SLOP.api.setArgs({}); location.reload(); } },
  ];
}

function slopPlayerStart() {
  const params = (window.slop.route && window.slop.route.params) || {};
  const frames = allFrames().filter(f => !f.component && f.visible);
  const pick = params.screen && frames.find(f => slug(f.name) === params.screen);
  openPresent(pick ? pick.id : undefined);
  if (params.screen && !pick) toast('No screen called “' + params.screen + '”: showing the start.', 3500);
}

// The URL names the screen on show: /proto/x/<screen slug>.
function slopScreenURL(id) {
  const f = get(id); const r = window.slop.route || {};
  if (!f || !r.path) return;
  const base = (r.params && r.params.screen) ? r.path.slice(0, r.path.lastIndexOf('/')) : r.path.replace(/\/+$/, '');
  try { history.replaceState(null, '', base + '/' + slug(f.name)); } catch {}
}

if (SLOP.mode === 'player') {
  document.head.append(h('style', { text: 'body.slop-player #app{display:none!important} body.slop-player #pvClose{display:none!important} body.slop-player #present{position:fixed}' }));
  document.body.classList.add('slop-player');
  const loaded = onLoaded;
  onLoaded = function () { loaded(); slopPlayerStart(); };
  const show = showFrame;
  showFrame = function (id, ...rest) { show(id, ...rest); slopScreenURL(id); };
} else if (SLOP.mode === 'tool') {
  // After boot: boot() loads the icon set that ico() reads.
  const booted = boot;
  boot = function () {
    booted();
    const b = h('button', { class: 'btn', id: 'bSlop', title: 'Save, publish and hand off on slop', onclick: e => menuAt(e.currentTarget, slopMenu()) },
      ico('cloud-upload'), h('span', { class: 'wide-only', text: 'slop' }));
    const share = $('#bShare'); if (share) share.before(b);
  };
}
