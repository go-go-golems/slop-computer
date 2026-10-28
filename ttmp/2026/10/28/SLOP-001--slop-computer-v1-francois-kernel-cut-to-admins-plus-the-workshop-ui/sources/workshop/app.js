/* app.js · the shell screens of slop.computer, direction A (the contact sheet):
   Watch (an artifact's versions, comments and the route that serves it), Routes, Artifacts, Site and Admin.
   On slop.computer each of these is a shell artifact; here they talk to the fake API in api.js. */
(function () {
  'use strict';
  const api = window.slop, R = window.SlopRender, AG = window.SlopAgent;
  const $ = (s, el) => (el || document).querySelector(s);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'checked' || k === 'srcdoc' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const sel = (attrs, options, onchange) => h('select', Object.assign({ class: 'sel', onchange: e => onchange(e.target.value) }, attrs),
    options.map(o => h('option', { value: o.value, selected: o.selected ? 'selected' : null }, o.label)));
  const prefs = {
    get(k, d) { try { const v = localStorage.getItem('slopcomputer:a:ui:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('slopcomputer:a:ui:' + k, JSON.stringify(v)); } catch (e) { /* storage may be unavailable */ } },
  };

  // ------------------------------------------------------------------ state
  const SCREENS = ['watch', 'routes', 'artifacts', 'site', 'admin'];
  const NAMES = { watch: 'Watch', routes: 'Routes', artifacts: 'Artifacts', site: 'Site', admin: 'Admin' };
  const hashScreen = () => { const s = (location.hash || '').slice(1); return SCREENS.includes(s) ? s : null; };
  const UI = {
    screen: hashScreen() || prefs.get('screen', 'watch'),
    me: prefs.get('me', 'manuel'),
    artifact: prefs.get('artifact', 'pricing'),
    n: null, ltab: 'comments', rtab: 'preview', device: prefs.get('device', window.innerWidth < 900 ? 'fit' : 'desktop'),
    picking: false, pending: null, focus: null, missing: new Set(), showResolved: false, replyOpen: null,
    cmpLeft: null, sample: null, rec: null, recEdit: null, file: 'index.html', tokDraft: null,
    routeSel: { host: 'slop.boutique', path: '/pricing' }, routesHost: 'slop.boutique', adding: null, confirmRemove: false,
    site: { host: 'slop.boutique', path: '/', back: [], fwd: [] },
    arts: { kind: 'all', q: '', project: 'all' },
    adminTab: 'people', newToken: null, tokenForm: false,
    sideW: prefs.get('sideW', 380), menu: null, resetArmed: false,
  };
  if (!api.artifacts.get(UI.artifact)) UI.artifact = 'pricing';
  const FR = new Map();   // frame window → role

  // ------------------------------------------------------------------ small helpers
  const ago = t => {
    const d = (Date.now() - t) / 1000;
    if (d < 45) return 'just now'; if (d < 90) return '1 min ago'; if (d < 3600) return Math.round(d / 60) + ' min ago';
    if (d < 5400) return '1 h ago'; if (d < 86400) return Math.round(d / 3600) + ' h ago';
    const days = Math.round(d / 86400); return days === 1 ? 'yesterday' : days + ' d ago';
  };
  const until = t => { const d = Math.round((t - Date.now()) / 86400e3); return d < 0 ? 'expired' : d === 0 ? 'today' : 'in ' + d + ' d'; };
  const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const uname = id => (api.users.get(id) || {}).name || id;
  const vBy = v => v.via === 'claude' ? `Claude Code (${uname(v.by)}’s)` : v.via === 'browser' ? `${uname(v.by)}, in the browser` : `${uname(v.by)}, slop push`;
  const av = (v, lg) => v.via === 'claude' ? h('span', { class: 'av ag' + (lg ? ' lg' : ''), title: vBy(v) }, 'C') : h('span', { class: 'av' + (lg ? ' lg' : ''), title: vBy(v) }, uname(v.by).charAt(0));
  const art = () => api.artifacts.get(UI.artifact);
  const curV = () => { const a = art(); return (UI.n && a.versions.find(v => v.n === UI.n)) || a.versions[a.versions.length - 1]; };
  const kindLabel = a => a.kind === 'data' ? 'data' : a.trust === 'shell' ? 'shell' : 'page';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const recWord = a => a.type === 'post' ? 'post' : 'record';
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    $('#toasts').append(t); setTimeout(() => t.remove(), 4200);
  }
  const cli = text => api.console.add({ who: uname(UI.me), kind: 'ui', text: 'same as: ' + text });

  // ------------------------------------------------------------------ frames
  function frameEl(role, srcdoc, title) {
    const fr = h('iframe', { sandbox: 'allow-scripts', title: title || 'Preview', srcdoc });
    fr.dataset.role = role;
    return fr;
  }
  function registerFrames(root) {
    (root || document).querySelectorAll('iframe[data-role]').forEach(f => { if (f.contentWindow) FR.set(f.contentWindow, f.dataset.role); });
  }
  function fitDevice(stage, wrap, dev, mode) {
    const W = Math.max(100, stage.clientWidth - 32), H = Math.max(100, stage.clientHeight - 32);
    let w, hh, s;
    if (mode === 'fit') { w = W; hh = H; s = 1; }
    else if (mode === 'phone') { w = 390; hh = 844; s = Math.min(1, W / w, H / hh); }
    else { w = 1280; s = Math.min(1, W / w); hh = H / s; }
    dev.style.width = w + 'px'; dev.style.height = hh + 'px'; dev.style.transform = `scale(${s})`;
    wrap.style.width = Math.floor(w * s) + 'px'; wrap.style.height = Math.floor(hh * s) + 'px';
  }
  function stageEl(role, srcdoc, mode, extraClass) {
    const fr = frameEl(role, srcdoc);
    const dev = h('div', { class: 'device' }, fr), wrap = h('div', { class: 'dwrap' }, dev);
    const stage = h('div', { class: 'stage' + (extraClass ? ' ' + extraClass : '') }, wrap);
    const fit = () => fitDevice(stage, wrap, dev, typeof mode === 'function' ? mode() : mode);
    try { new ResizeObserver(fit).observe(stage); } catch (e) { window.addEventListener('resize', fit); }
    stage._fit = fit; stage._frame = fr;
    return stage;
  }
  const thumbCache = new Map();
  function thumbDoc(id, n) {
    const k = id + ':' + n;
    if (!thumbCache.has(k)) { const c = R.previewContext(id, { n }); thumbCache.set(k, R.doc(id, n, Object.assign({ mode: 'thumb' }, c))); }
    return thumbCache.get(k);
  }
  const lazy = (() => {
    let io = null;
    try { io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const f = e.target; io.unobserve(f); f.srcdoc = f._doc(); } }), { rootMargin: '200px' }); } catch (e) { io = null; }
    return (fr, make) => { fr._doc = make; if (io) io.observe(fr); else fr.srcdoc = make(); };
  })();
  function thumbFrame(id, n, width) {
    const fr = h('iframe', { sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy', style: `transform:scale(${width / 1280})` });
    lazy(fr, () => thumbDoc(id, n));
    return fr;
  }

  // ------------------------------------------------------------------ bar
  function drawBar() {
    const bar = $('#bar'); bar.innerHTML = '';
    const a = art();
    const artBtn = h('button', { class: 'projbtn', id: 'artBtn', 'aria-haspopup': 'true', onclick: e => { e.stopPropagation(); openMenu('art'); } },
      h('span', { class: 'pcode' }, kindLabel(a)), h('span', { class: 'ptitle' }, a.id), h('span', { class: 'caret' }, '▾'));
    const projWrap = h('div', { class: 'proj' }, artBtn, UI.menu === 'art' ? artMenu() : null);
    const nav = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Screens' }, SCREENS.map(s => h('button', { 'aria-pressed': String(UI.screen === s), onclick: () => go(s) }, NAMES[s])));
    const v = curV(), open = api.comments.list(a.id).filter(t => !t.resolved).length;
    const pill = UI.screen === 'watch' ? h('button', { class: 'pill', id: 'verPill', title: 'Versions', onclick: () => { UI.ltab = 'versions'; drawLeftTabs(); drawLeft(); } },
      h('b', null, 'v' + v.n), h('span', null, (v.n === a.refs.main ? 'main' : 'of ' + a.versions.length) + (open ? ' · ' + plural(open, 'open thread') : ''))) : null;
    const busy = AG.busy.size > 0, agents = api.agents.list();
    const agentPill = h('button', { class: 'pill' + (busy ? ' busy' : '') + (AG.enabled ? '' : ' off'), id: 'agentPill', title: 'Simulated Claude Code agents. Click to turn them on or off.', onclick: () => { AG.setEnabled(!AG.enabled); toast(AG.enabled ? 'Simulated agents are listening again.' : 'Simulated agents are off. Comments will wait.'); } },
      h('b', null, !AG.enabled ? 'Agents off' : busy ? 'Claude Code' : plural(agents.length, 'agent')), h('span', null, !AG.enabled ? 'click to listen' : busy ? 'writing…' : 'listening, simulated'));
    const me = h('label', { class: 'fld' }, h('span', null, 'You'), sel({ id: 'meSel', 'aria-label': 'Signed in as' }, api.users.list().filter(u => u.role === 'admin').map(u => ({ value: u.id, label: u.name, selected: u.id === UI.me })), val => { UI.me = val; prefs.set('me', val); toast('Signed in as ' + uname(val) + '.'); render(); }));
    const more = h('div', { class: 'proj' }, h('button', { class: 'ibtn', 'aria-label': 'More', onclick: e => { e.stopPropagation(); openMenu('more'); } }, '⋯'), UI.menu === 'more' ? moreMenu() : null);
    bar.append(...[h('div', { class: 'brand' }, 'slop.computer', h('i', null, 'workshop · ', h('b', null, 'fake data'))), projWrap, pill, nav, h('span', { class: 'sp' }), agentPill, me, more].filter(Boolean));
  }
  function openMenu(m) { UI.menu = UI.menu === m ? null : m; UI.resetArmed = false; drawBar(); }
  function artMenu() {
    const m = h('div', { class: 'menu', role: 'menu', onclick: e => e.stopPropagation() });
    api.projects.list().forEach(p => {
      m.append(h('div', { class: 'grp' }, p.name));
      api.artifacts.list().filter(a => a.project === p.id).forEach(a => {
        const v = a.versions[a.versions.length - 1];
        m.append(h('button', { class: a.id === UI.artifact ? 'on' : '', role: 'menuitem', onclick: () => { UI.menu = null; openArtifact(a.id); } },
          h('span', { class: 'code' }, kindLabel(a)), h('span', { class: 't' }, a.id), h('small', null, `v${v.n} · ${ago(v.at)} · ${vBy(v)}`)));
      });
    });
    m.append(h('p', { class: 'mnote' }, 'A new artifact starts with its first push: slop push ./folder -a name, or Push a file on the Artifacts screen.'));
    return m;
  }
  function moreMenu() {
    const m = h('div', { class: 'menu right', role: 'menu', onclick: e => e.stopPropagation() });
    m.append(h('button', { class: 'act', onclick: () => { UI.menu = null; aboutDialog(); } }, h('span', { class: 't' }, 'About this prototype')));
    m.append(h('button', { class: 'act', onclick: () => {
      if (!UI.resetArmed) { UI.resetArmed = true; drawBar(); return; }
      UI.menu = null; UI.resetArmed = false; thumbCache.clear(); api.reset(); UI.n = null; UI.pending = null; UI.picking = false; toast('Fake data reset to the seed.'); render();
    } }, h('span', { class: 't', style: UI.resetArmed ? 'color:var(--accent)' : '' }, UI.resetArmed ? 'Click again to drop your changes' : 'Reset fake data'), h('small', { style: 'grid-column:1' }, 'Your comments, pushes and route changes are kept in this browser.')));
    return m;
  }
  function aboutDialog() {
    const close = () => d.remove();
    const d = h('div', { class: 'modal', onclick: e => { if (e.target === d) close(); } }, h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'About this prototype' },
      h('header', null, h('h2', null, 'slop.computer, direction A'), h('button', { class: 'ibtn', 'aria-label': 'Close', onclick: close }, '×')),
      h('div', { class: 'form', style: 'font-size:13px;line-height:1.55;color:var(--ink)' },
        h('p', { style: 'margin:0' }, 'The contact sheet: agents push versions, people look, point and comment, and routes decide what each address serves.'),
        h('p', { style: 'margin:0' }, 'Everything here is fake data in your browser. The API in api.js has the shape the real server will have; the screens are the shells that would be artifacts on slop.computer.'),
        h('p', { style: 'margin:0' }, 'The two Claude Code agents are simulated. They answer new comments on pages in their project (Manuel’s: Lab site, Ramon’s: Play), and they only know a dozen words: tighter, more space, bigger, smaller, bold, mono, centre, hide, invert, stand out, uppercase, rounded, square, blue, muted or a #hex colour.'),
        h('p', { style: 'margin:0' }, 'Try: Watch → pricing → Comment → click the tiers → “tighter on phones”. Then Routes → /press, which has no route yet.')),
      h('footer', null, h('button', { class: 'btn primary', onclick: close }, 'Close'))));
    document.body.append(d);
  }

  // ------------------------------------------------------------------ navigation
  function go(s) {
    if (UI.screen === s) return;
    UI.screen = s; prefs.set('screen', s); UI.menu = null; UI.picking = false;
    try { history.replaceState(null, '', '#' + s); } catch (e) { location.hash = s; }
    render();
  }
  function openArtifact(id, o) {
    o = o || {};
    UI.artifact = id; prefs.set('artifact', id);
    UI.n = o.n || null; UI.pending = null; UI.picking = false; UI.focus = o.focus || null; UI.sample = null; UI.rec = null; UI.recEdit = null; UI.tokDraft = null; UI.cmpLeft = null; UI.file = 'index.html';
    const a = api.artifacts.get(id);
    UI.rtab = a.kind === 'data' ? 'records' : 'preview';
    if (o.focus) UI.ltab = 'comments';
    if (UI.screen !== 'watch') { UI.screen = 'watch'; prefs.set('screen', 'watch'); try { history.replaceState(null, '', '#watch'); } catch (e) { /* ignore */ } }
    render();
  }
  function render() {
    drawBar();
    const work = $('#work'); work.innerHTML = '';
    ({ watch: renderWatch, routes: renderRoutes, artifacts: renderArtifacts, site: renderSite, admin: renderAdmin })[UI.screen]();
    registerFrames(work);
  }

  // ================================================================== WATCH
  function renderWatch() {
    const side = h('section', { class: 'tile side', id: 'wSide', style: `width:${UI.sideW}px` },
      h('div', { class: 'dstrip' }, h('div', { class: 'dtabs', id: 'wLTabs', role: 'tablist' })),
      h('div', { class: 'tilebody', id: 'wLeft' }));
    const gut = gutter(side);
    const main = h('section', { class: 'tile main' },
      h('div', { class: 'dstrip' }, h('div', { class: 'dtabs', id: 'wRTabs', role: 'tablist' })),
      h('div', { class: 'toolbar', id: 'wTool' }),
      h('div', { class: 'visit', id: 'wVisit' }),
      h('div', { class: 'tilebody', id: 'wRight' }),
      h('div', { class: 'film', id: 'wFilm' }));
    $('#work').append(h('div', { class: 'split' }, side, gut, main));
    const a = art();
    if (a.kind === 'data' && !['records', 'files'].includes(UI.rtab)) UI.rtab = 'records';
    if (a.kind !== 'data' && !['preview', 'compare', 'files'].includes(UI.rtab)) UI.rtab = 'preview';
    drawRightTabs(); drawTool(); drawVisit(); drawRight(); drawFilm(); drawLeftTabs(); drawLeft();
  }
  function gutter(side) {
    const g = h('div', { class: 'gutter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize' });
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); g.classList.add('drag');
      const x0 = e.clientX, w0 = side.getBoundingClientRect().width, right = side.nextElementSibling === g && side.previousElementSibling == null ? 1 : -1;
      const move = ev => { const w = Math.max(260, Math.min(640, w0 + (ev.clientX - x0) * right)); side.style.width = w + 'px'; UI.sideW = w; };
      const up = () => { document.body.classList.remove('resizing'); g.classList.remove('drag'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); prefs.set('sideW', UI.sideW); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
    });
    return g;
  }

  // ---- left: comments, versions, console
  function drawLeftTabs() {
    const el = $('#wLTabs'); if (!el) return;
    const a = art(), open = api.comments.list(a.id).filter(t => !t.resolved).length;
    el.innerHTML = '';
    [['comments', 'Comments', open], ['versions', 'Versions', a.versions.length], ['console', 'Console', null]].forEach(([k, l, c]) => {
      el.append(h('button', { class: 'dtab' + (UI.ltab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(UI.ltab === k), onclick: () => { UI.ltab = k; drawLeftTabs(); drawLeft(); } }, l, c != null ? h('span', { class: 'count' + (k === 'comments' && c ? ' bad' : '') }, String(c)) : null));
    });
  }
  function drawLeft() {
    const el = $('#wLeft'); if (!el) return;
    el.innerHTML = '';
    if (UI.ltab === 'versions') el.append(versionsPane());
    else if (UI.ltab === 'console') el.append(consolePane());
    else el.append(...commentsPane());
  }
  function threadNumbers(id) {
    const m = new Map();
    api.comments.list(id).slice().sort((x, y) => x.at - y.at).forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }
  function commentsPane() {
    const a = art(), v = curV(), out = [];
    // composer
    if (UI.pending) {
      const p = UI.pending, ta = h('textarea', { id: 'cmtText', placeholder: 'What should change?', 'aria-label': 'Comment' });
      const post = () => {
        const text = ta.value.trim(); if (!text) { ta.focus(); return; }
        const anchor = p.record ? { record: p.record } : { selector: p.selector, fx: p.fx, fy: p.fy, text: p.text, styles: p.styles };
        const res = api.comments.create(a.id, { version: v.n, anchor, by: UI.me, text });
        UI.pending = null; UI.focus = res.thread.id;
        const agent = AG.agentFor(a.id);
        toast(agent && AG.enabled && a.kind === 'page' ? `Posted. ${agent.name} picks it up from slop comments wait.` : 'Comment posted.');
        drawLeftTabs(); drawLeft(); sendPins(); drawBar();
      };
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); if (e.key === 'Escape') { UI.pending = null; drawLeftTabs(); drawLeft(); } });
      out.push(h('div', { class: 'composer live' },
        h('div', { class: 'on-what' }, h('span', null, `On v${v.n} of ${a.id}`), p.record ? h('code', null, p.record) : h('code', null, p.selector), p.text ? h('span', null, '“' + p.text.slice(0, 70) + (p.text.length > 70 ? '…' : '') + '”') : null),
        ta,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: post }, 'Post'), h('button', { class: 'btn', onclick: () => { UI.pending = null; drawLeftTabs(); drawLeft(); } }, 'Cancel'), h('span', { class: 'sp' }), h('span', { class: 'note' }, '⌘↩ posts'))));
      setTimeout(() => ta.focus(), 0);
    } else if (UI.picking) {
      out.push(h('div', { class: 'composer live' }, h('div', { class: 'on-what' }, h('span', { style: 'color:var(--ink)' }, 'Click anything on the page to comment on it.'), h('span', null, 'Esc cancels.'))));
    } else {
      const all = api.comments.list(a.id), resolved = all.filter(t => t.resolved).length;
      const canPoint = a.kind !== 'data' && UI.rtab === 'preview';
      out.push(h('div', { class: 'composer' }, h('div', { class: 'row' },
        a.kind === 'data'
          ? h('button', { class: 'btn', disabled: !UI.rec, onclick: () => { UI.pending = { record: recPath(UI.rec) }; drawLeftTabs(); drawLeft(); } }, UI.rec ? `Comment on ${UI.rec}` : `Select a ${recWord(a)} to comment on it`)
          : h('button', { class: 'btn', disabled: !canPoint, onclick: togglePick, title: 'Shortcut: C' }, canPoint ? 'Comment on the page' : 'Open Preview to comment'), canPoint && a.kind !== 'data' ? h('span', { class: 'muted', style: 'font-size:var(--fs-xs)' }, 'or press C') : null,
        h('span', { class: 'sp' }),
        resolved ? h('button', { class: 'tog' + (UI.showResolved ? ' on' : ''), onclick: () => { UI.showResolved = !UI.showResolved; drawLeft(); sendPins(); } }, `Resolved ${resolved}`) : null)));
    }
    // threads
    const nums = threadNumbers(a.id);
    const list = api.comments.list(a.id).filter(t => UI.showResolved || !t.resolved).slice().sort((x, y) => (x.resolved - y.resolved) || (y.at - x.at));
    const box = h('div', { class: 'scroll', id: 'threads' });
    if (!list.length) box.append(h('p', { class: 'empty' }, a.kind === 'data' ? `No open threads. Select a ${recWord(a)} and comment on it.` : 'No open threads. Comment on the page and the agent listening on this project picks it up.'));
    list.forEach(t => box.append(threadEl(t, nums.get(t.id))));
    out.push(box);
    // who listens
    const agent = AG.agentFor(a.id);
    const busy = agent && AG.busy.has(agent.id);
    out.push(agent
      ? h('div', { class: 'listen' + (busy ? ' busy' : ''), id: 'listen' }, h('span', null, h('span', { class: 'dot' }), h('b', null, agent.name), AG.enabled ? (busy ? ' is writing a version…' : ' is waiting, simulated') : ' is off'), h('code', null, `slop comments wait --project ${agent.project}`), h('span', null, `session ${agent.session} · since ${clock(agent.since)}`))
      : h('div', { class: 'listen', id: 'listen' }, h('span', null, 'No agent listens on ', h('b', null, (api.projects.get(a.project) || {}).name || a.project), '. Comments wait for a person.')));
    return out;
  }
  function threadEl(t, num) {
    const a = art(), v = curV();
    const onPage = t.anchor && t.anchor.selector;
    const gone = onPage && UI.rtab === 'preview' && UI.missing.has(t.id);
    const el = h('div', { class: 'thread' + (UI.focus === t.id ? ' focus' : '') + (t.resolved ? ' resolved' : ''), id: 'th-' + t.id });
    el.append(h('div', { class: 'th-h' }, h('button', { class: 'pinno', title: 'Show on the page', onclick: () => focusThread(t.id, true) }, String(num)),
      h('span', null, `${uname(t.by)} · on v${t.version} · ${ago(t.at)}`), h('span', { class: 'sp' }), t.resolved ? h('span', { class: 'tag' }, 'resolved') : null));
    el.append(h('button', { class: 'anchor' + (gone ? ' gone' : ''), onclick: () => focusThread(t.id, true), title: 'Show on the page' },
      onPage ? t.anchor.selector : t.anchor && t.anchor.record ? t.anchor.record + (t.anchor.field ? ' · ' + t.anchor.field : '') : 'the page'));
    if (gone) el.append(h('span', { class: 'muted', style: 'font-size:var(--fs-xs)' }, `Not found in v${v.n}: the element changed or went away.`));
    t.comments.forEach(c => {
      const isAgent = !!c.agent, agent = isAgent ? (api.agents.list().find(x => x.owner === c.by) || {}) : null;
      el.append(h('div', { class: 'cm' + (isAgent ? ' agent' : '') }, isAgent ? h('span', { class: 'av ag' }, 'C') : h('span', { class: 'av' }, uname(c.by).charAt(0)),
        h('div', { class: 'who' }, h('b', null, isAgent ? agent.name || 'Claude Code' : uname(c.by)), h('span', null, ago(c.at)),
          c.version ? h('button', { class: 'link', onclick: () => selectVersion(c.version) }, `see v${c.version}`) : null),
        h('div', { class: 'txt' }, c.text)));
    });
    if (UI.replyOpen === t.id) {
      const ta = h('textarea', { class: 'inp', rows: '2', placeholder: 'Reply', 'aria-label': 'Reply', style: 'width:100%' });
      const send = () => { const text = ta.value.trim(); if (!text) return; UI.replyOpen = null; api.comments.reply(t.id, { by: UI.me, text }); };
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
      el.append(h('div', { style: 'padding-left:24px;display:flex;flex-direction:column;gap:6px' }, ta, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: send }, 'Reply'), h('button', { class: 'btn sm', onclick: () => { UI.replyOpen = null; drawLeft(); } }, 'Cancel'))));
      setTimeout(() => ta.focus(), 0);
    }
    el.append(h('div', { class: 'th-act' },
      h('button', { class: 'link', onclick: () => { UI.replyOpen = t.id; drawLeft(); } }, 'Reply'),
      h('button', { class: 'link', onclick: () => { api.comments.resolve(t.id, UI.me, !t.resolved); toast(t.resolved ? 'Reopened.' : 'Resolved.'); } }, t.resolved ? 'Reopen' : 'Resolve')));
    return el;
  }
  function focusThread(id, scrollPage) {
    UI.focus = id;
    const t = api.comments.get(id);
    if (t && t.resolved && !UI.showResolved) UI.showResolved = true;
    if (UI.ltab !== 'comments') { UI.ltab = 'comments'; drawLeftTabs(); }
    drawLeft();
    const el = document.getElementById('th-' + id); if (el) el.scrollIntoView({ block: 'nearest' });
    if (t && t.anchor && t.anchor.record && art().kind === 'data') { UI.rec = t.anchor.record.split('/').pop().replace(/\.[^.]+$/, ''); drawRight(); }
    sendPins(scrollPage ? id : null);
  }
  function versionsPane() {
    const a = art(), v = curV(), box = h('div', { class: 'scroll' });
    const routes = a.kind === 'data' ? [] : api.routes.using(a.id);
    a.versions.slice().reverse().forEach(x => {
      const tags = [];
      if (x.n === a.refs.main) tags.push(h('span', { class: 'tag ink' }, 'main'));
      routes.forEach(r => { if ((r.version && r.version === x.n) || (!r.version && x.n === a.refs.main)) tags.push(h('span', { class: 'tag ' + (r.version ? 'red' : 'ink') }, r.host === 'slop.boutique' ? r.path : r.host + r.path)); });
      const files = Object.keys(x.files).length;
      box.append(h('div', { class: 'hrow' + (x.n === v.n ? ' on' : '') }, av(x, true),
        h('button', { class: 'ht', onclick: () => selectVersion(x.n) }, h('b', null, `v${x.n}`), h('span', { class: 'msg' }, x.message), h('small', null, `${vBy(x)} · ${ago(x.at)} · ${plural(files, 'file')}${x.session ? ' · ' + x.session : ''}`), tags.length ? h('span', { class: 'tags' }, tags) : null)));
    });
    return box;
  }
  function consolePane() {
    const box = h('div', { class: 'console', id: 'console', 'aria-live': 'polite' });
    api.console.list().slice(-200).forEach(l => box.append(consoleLine(l)));
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    return box;
  }
  const consoleLine = l => h('div', { class: 'cl ' + l.kind }, h('span', { class: 't' }, clock(l.at)), h('span', { class: 'x' }, h('span', { class: 'w' }, l.who), h('span', { class: 'c' }, l.text)));

  // ---- right: tabs, toolbar, route line
  function drawRightTabs() {
    const el = $('#wRTabs'); if (!el) return;
    const a = art();
    const tabs = a.kind === 'data' ? [['records', a.type === 'tokens' ? 'Tokens' : a.type === 'post' ? 'Posts' : 'Records'], ['files', 'Files']] : [['preview', 'Preview'], ['compare', 'Compare'], ['files', 'Files']];
    el.innerHTML = '';
    tabs.forEach(([k, l]) => el.append(h('button', { class: 'dtab' + (UI.rtab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(UI.rtab === k), onclick: () => { if (UI.rtab === k) return; UI.rtab = k; if (UI.picking) setPick(false); drawRightTabs(); drawTool(); drawRight(); drawLeft(); } }, l)));
  }
  function deviceSeg(onchange) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Width' }, [['fit', 'Fit'], ['desktop', 'Desktop'], ['phone', 'Phone']].map(([k, l]) =>
      h('button', { 'aria-pressed': String(UI.device === k), onclick: () => { UI.device = k; prefs.set('device', k); onchange(); } }, l)));
  }
  function drawTool() {
    const el = $('#wTool'); if (!el) return;
    el.innerHTML = '';
    const a = art(), v = curV();
    if (a.kind === 'data') {
      const recs = R.records(a.id, v.n), readers = api.routes.readers(a.id);
      el.append(h('div', { class: 'addr' }, h('span', null, a.type), h('span', { class: 'ro' }, a.type === 'tokens' ? 'tokens.json' : plural(recs.length, recWord(a))), h('span', null, '· read by ' + (readers.length ? readers.slice(0, 4).map(r => r.path).join('  ') + (readers.length > 4 ? `  +${readers.length - 4}` : '') : 'nothing yet'))));
      if (a.type !== 'tokens' && UI.rtab === 'records') el.append(h('button', { class: 'btn', onclick: () => { UI.recEdit = { isNew: true }; drawRight(); } }, a.type === 'post' ? 'New post' : 'New record'));
      if (UI.rtab === 'records') el.append(deviceSeg(() => { drawTool(); drawRight(); }));
      return;
    }
    const ctx = R.previewContext(a.id, { n: v.n, sample: UI.sample });
    const addr = h('div', { class: 'addr' }, h('span', null, ctx.host || 'not routed'), h('span', { class: 'ro' }, ctx.route ? (ctx.route.path === '*' ? '* (any path with no route)' : ctx.route.path) : ''));
    if (ctx.samples && ctx.samples.length) addr.append(h('span', null, '·'), sel({ 'aria-label': 'Which record', style: 'border:0;background:transparent;height:26px;font:400 12px var(--code);color:var(--ink)' }, ctx.samples.map(s => ({ value: s, label: s, selected: s === (ctx.params && Object.values(ctx.params)[0]) })), val => { UI.sample = val; drawTool(); drawRight(); }));
    el.append(addr);
    if (UI.rtab === 'preview' || UI.rtab === 'compare') el.append(deviceSeg(() => { drawTool(); drawRight(); }));
    if (UI.rtab === 'compare') {
      const left = UI.cmpLeft || Math.max(1, v.n - 1);
      el.append(h('label', { class: 'fld' }, h('span', null, 'Left'), sel({ 'aria-label': 'Compare with' }, a.versions.map(x => ({ value: String(x.n), label: `v${x.n}`, selected: x.n === left })), val => { UI.cmpLeft = +val; drawRight(); })));
    }
    if (ctx.route && ctx.host === 'slop.boutique') el.append(h('button', { class: 'btn', onclick: () => { UI.site.host = ctx.host; navigate(ctx.path, true); go('site'); } }, 'Open in Site'));
  }
  function drawVisit() {
    const el = $('#wVisit'); if (!el) return;
    el.innerHTML = ''; el.className = 'visit';
    const a = art(), v = curV();
    if (a.kind === 'data') {
      const readers = api.routes.readers(a.id);
      if (!readers.length) { el.className = 'visit calm'; el.append(h('span', { class: 'muted' }, 'No page reads this data yet.')); return; }
      const follow = readers.filter(r => { const b = Object.values(api.routes.bindingsFor(api.versions.get(r.page, r.version), r)).find(x => x.artifact === a.id); return b && !b.version; });
      el.append(h('span', null, h('b', null, plural(readers.length, 'route')), ' read ', h('code', null, a.id), follow.length === readers.length ? ` and follow main, so v${a.refs.main} is live.` : '.'));
      if (v.n !== a.refs.main) el.append(h('span', { class: 'muted' }, `You are looking at v${v.n}, not what visitors see.`));
      else el.className = 'visit calm';
      return;
    }
    const routes = api.routes.using(a.id);
    if (!routes.length) {
      el.className = 'visit';
      el.append(h('span', null, h('b', null, 'Not routed.'), ' No address serves this page yet.'), h('button', { class: 'btn sm', onclick: () => { UI.adding = { page: a.id }; UI.routesHost = 'slop.boutique'; go('routes'); } }, 'Add a route…'));
      return;
    }
    const r = routes.find(x => x.path !== '*') || routes[0];
    const served = r.version || a.refs.main;
    const label = r.host === 'slop.boutique' ? r.path : r.host + r.path;
    if (a.trust === 'shell') { el.className = 'visit calm'; el.append(h('span', null, 'Shell at ', h('code', null, label), ` on slop.computer, served with the API. v${served} is live.`)); return; }
    if (r.version) el.append(h('span', null, h('code', null, label), ` serves `, h('b', null, `v${served}`), ', pinned.'));
    else el.append(h('span', null, h('code', null, label), ' follows main: ', h('b', null, `v${served}`), ' is live.'));
    if (v.n === served) { el.className = 'visit calm'; el.append(h('span', { class: 'muted' }, 'This is what visitors see.')); }
    else {
      el.append(h('span', { class: 'muted' }, `You are looking at v${v.n}.`));
      el.append(h('button', { class: 'btn sm primary', onclick: () => pointRoute(r, v.n) }, `Point ${label} at v${v.n}`));
    }
    if (routes.length > 1) el.append(h('span', { class: 'muted' }, `+ ${plural(routes.length - 1, 'other route')}`));
  }
  function pointRoute(r, n) {
    const before = r.version;
    api.routes.set(Object.assign({}, r, { version: n }), UI.me, `pinned v${n}`);
    cli(`slop route set ${r.host}${r.path} ${r.page}@${n}`);
    toast(`${r.path} now serves v${n}${before ? ` (was v${before}). Roll back on Routes.` : '.'}`);
  }

  // ---- right: the preview, compare, files, records
  let watchStage = null;
  function watchDoc() {
    const a = art(), v = curV();
    const ctx = R.previewContext(a.id, { n: v.n, sample: UI.sample });
    return R.doc(a.id, v.n, Object.assign({ mode: 'preview' }, ctx));
  }
  function drawRight() {
    const el = $('#wRight'); if (!el) return;
    el.innerHTML = ''; watchStage = null;
    const a = art(), v = curV();
    if (a.kind === 'data') { (UI.rtab === 'files' ? drawFiles : drawRecords)(el); registerFrames(el); return; }
    if (UI.rtab === 'files') { drawFiles(el); return; }
    if (UI.rtab === 'compare') {
      const left = UI.cmpLeft || Math.max(1, v.n - 1);
      const pane = n => {
        const ctx = R.previewContext(a.id, { n, sample: UI.sample });
        const st = stageEl('cmp', R.doc(a.id, n, Object.assign({ mode: 'preview' }, ctx)), () => UI.device);
        const x = a.versions.find(q => q.n === n);
        return h('div', null, h('div', { class: 'cmphead' }, av(x), h('b', null, `v${n}`), h('span', { class: 'muted', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, x.message)), h('div', { class: 'cmpstage' }, st));
      };
      const wrap = h('div', { class: 'stage', style: 'padding:12px' }, h('div', { class: 'cmp' }, pane(left), pane(v.n)));
      el.append(wrap);
      wrap.querySelectorAll('.cmpstage .stage').forEach(s => { s.style.position = 'absolute'; s.style.inset = '0'; s.style.padding = '0'; s.style.background = 'transparent'; });
      registerFrames(el);
      return;
    }
    const st = stageEl('watch', watchDoc(), () => UI.device, UI.picking ? 'picking' : '');
    if (UI.picking) st.append(h('div', { class: 'pickhint' }, 'Click an element to comment on it · Esc cancels'));
    watchStage = st;
    el.append(st);
    registerFrames(el);
  }
  function sendPins(focusScroll) {
    if (!watchStage || !watchStage._frame.contentWindow) return;
    const a = art(), nums = threadNumbers(a.id);
    const pins = api.comments.list(a.id).filter(t => t.anchor && t.anchor.selector && (UI.showResolved || !t.resolved))
      .map(t => ({ id: t.id, n: nums.get(t.id), selector: t.anchor.selector, fx: t.anchor.fx, fy: t.anchor.fy, resolved: t.resolved, title: t.comments[0].text }));
    const w = watchStage._frame.contentWindow;
    w.postMessage({ slop: 1, type: 'pins', pins, focus: UI.focus }, '*');
    if (focusScroll) w.postMessage({ slop: 1, type: 'focus', id: focusScroll }, '*');
    w.postMessage({ slop: 1, type: 'pick', on: UI.picking }, '*');
  }
  function setPick(on) {
    UI.picking = on;
    if (on) UI.pending = null;
    if (watchStage) {
      watchStage.classList.toggle('picking', on);
      const hint = watchStage.querySelector('.pickhint');
      if (on && !hint) watchStage.append(h('div', { class: 'pickhint' }, 'Click an element to comment on it · Esc cancels'));
      if (!on && hint) hint.remove();
      if (watchStage._frame.contentWindow) watchStage._frame.contentWindow.postMessage({ slop: 1, type: 'pick', on }, '*');
    }
    drawLeftTabs(); if (UI.ltab !== 'comments') UI.ltab = 'comments'; drawLeftTabs(); drawLeft();
  }
  function togglePick() {
    const a = art();
    if (UI.screen !== 'watch') return;
    if (a.kind === 'data') { if (UI.rec) { UI.pending = { record: recPath(UI.rec) }; UI.ltab = 'comments'; drawLeftTabs(); drawLeft(); } else toast(`Select a ${recWord(a)} first.`); return; }
    if (UI.rtab !== 'preview') { UI.rtab = 'preview'; drawRightTabs(); drawTool(); drawRight(); }
    setPick(!UI.picking);
  }
  function onPick(m) {
    setPick(false);
    UI.pending = { selector: m.selector, fx: m.fx, fy: m.fy, text: m.text, styles: m.styles, tag: m.tag };
    UI.ltab = 'comments'; drawLeftTabs(); drawLeft();
  }
  function selectVersion(n) {
    const a = art();
    UI.n = n === a.versions[a.versions.length - 1].n ? null : n;
    UI.tokDraft = null; UI.recEdit = null;
    drawBar(); drawLeftTabs(); drawLeft(); drawTool(); drawVisit(); drawRight(); markFilm();
  }

  // files and a line diff against the previous version
  function drawFiles(el) {
    const a = art(), v = curV(), prev = a.versions.find(x => x.n === v.n - 1);
    const names = Object.keys(v.files).sort((x, y) => (x === 'index.html' ? -1 : y === 'index.html' ? 1 : x.localeCompare(y)));
    if (!v.files[UI.file]) UI.file = names[0];
    const list = h('div', { class: 'files', style: 'flex:none;max-height:38%;overflow:auto;border-bottom:1px solid var(--hair)' });
    names.forEach(f => {
      const same = prev && prev.files[f] === v.files[f], isNew = prev && prev.files[f] == null;
      list.append(h('button', { class: 'frow' + (f === UI.file ? ' on' : ''), onclick: () => { UI.file = f; drawRight(); } }, h('code', null, f), h('span', null, (v.files[f].length / 1024).toFixed(1) + ' KB'), h('span', null, api.hash(v.files[f])), h('span', null, !prev ? 'first version' : isNew ? 'new' : same ? `same as v${prev.n}` : 'changed')));
    });
    if (prev) Object.keys(prev.files).filter(f => v.files[f] == null).forEach(f => list.append(h('div', { class: 'frow' }, h('code', { style: 'text-decoration:line-through;color:var(--ink-2)' }, f), h('span', null, ''), h('span', null, ''), h('span', null, 'removed'))));
    el.append(h('div', { class: 'pane-head' }, h('h2', null, `v${v.n} · ${plural(names.length, 'file')}`), h('span', { class: 'note' }, 'A version is a file tree. Files that did not change are shared, by hash.')), list);
    const text = v.files[UI.file] || '';
    if (prev && prev.files[UI.file] != null && prev.files[UI.file] !== text) {
      const a1 = prev.files[UI.file].split('\n'), b1 = text.split('\n'), sa = new Set(a1), sb = new Set(b1);
      const added = b1.filter(l => !sa.has(l)), removed = a1.filter(l => !sb.has(l));
      const d = h('pre', { class: 'diff', 'aria-label': `Changes since v${prev.n}` });
      removed.slice(0, 40).forEach(l => d.append(h('div', { class: 'dr' }, l.slice(0, 400))));
      added.slice(0, 60).forEach(l => d.append(h('div', { class: 'da' }, l.slice(0, 400))));
      if (added.length + removed.length > 100) d.append(h('div', { class: 'muted' }, `… ${added.length + removed.length - 100} more changed lines`));
      el.append(d);
    }
    el.append(h('div', { class: 'scroll' }, h('pre', { class: 'src' }, text.length > 60000 ? text.slice(0, 60000) + '\n…' : text)));
  }

  // data artifacts: posts, records, tokens
  const recPath = id => { const v = curV(); return Object.keys(v.files).find(p => p.split('/').pop().replace(/\.[^.]+$/, '') === id) || id; };
  function drawRecords(el) {
    const a = art(), v = curV();
    if (a.type === 'tokens') return drawTokens(el);
    const recs = R.records(a.id, v.n).slice().sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || String(x.title || x.id).localeCompare(String(y.title || y.id)));
    if (!UI.rec || !recs.some(r => r.id === UI.rec)) UI.rec = recs[0] ? recs[0].id : null;
    const threads = api.comments.list(a.id).filter(t => !t.resolved && t.anchor && t.anchor.record);
    const left = h('div', { class: 'dlist' });
    if (UI.recEdit) left.append(recordForm(a, v, recs));
    else {
      const tb = h('table', { class: 'rt' });
      const cols = a.type === 'post' ? [['title', 'Title'], ['date', 'Date'], ['tags', 'Tags']] : [['no', 'No'], ['title', 'Title'], ['kind', 'Kind'], ['date', 'Date']];
      tb.append(h('thead', null, h('tr', null, cols.map(([, l]) => h('th', null, l)), h('th', null, ''))));
      const body = h('tbody');
      recs.forEach(r => {
        const n = threads.filter(t => t.anchor.record === r.path).length;
        body.append(h('tr', { class: 'click' + (r.id === UI.rec ? ' on' : ''), onclick: () => { UI.rec = r.id; drawRight(); drawLeft(); } },
          cols.map(([k]) => h('td', { class: k === 'title' ? '' : 'dim' }, k === 'tags' ? (r.tags || []).join(', ') : k === 'no' ? String(r.no).padStart(3, '0') : String(r[k] == null ? '' : r[k]))),
          h('td', null, n ? h('span', { class: 'count bad' }, String(n)) : '')));
      });
      tb.append(body);
      left.append(h('div', { class: 'pane-head' }, h('h2', null, plural(recs.length, recWord(a))), h('span', { class: 'note' }, `v${v.n}`), h('span', { class: 'sp' }), UI.rec ? h('button', { class: 'btn sm', onclick: () => { UI.recEdit = { id: UI.rec }; drawRight(); } }, 'Edit') : null), h('div', { class: 'scroll' }, tb));
    }
    const right = h('div', { class: 'dright' });
    const viewer = a.viewer && api.artifacts.get(a.viewer);
    if (viewer && UI.rec) {
      const ctx = R.previewContext(viewer.id, { sample: UI.rec, dataOverride: { artifact: a.id, n: v.n } });
      right.append(h('div', { class: 'pane-head' }, h('h2', null, `Through ${viewer.id}`), h('span', { class: 'note' }, ctx.route ? ctx.route.host + ctx.path : ''), h('span', { class: 'sp' }), ctx.route ? h('button', { class: 'btn sm', onclick: () => { UI.site.host = ctx.host; navigate(ctx.path, true); go('site'); } }, 'Open in Site') : null));
      right.append(stageEl('data', R.doc(viewer.id, null, Object.assign({ mode: 'preview' }, ctx)), () => UI.device));
    } else right.append(h('p', { class: 'empty' }, `Select a ${recWord(a)}.`));
    el.append(h('div', { class: 'dsplit' }, left, right));
  }
  function recordForm(a, v, recs) {
    const e = UI.recEdit, r = e.isNew ? null : recs.find(x => x.id === e.id);
    const f = h('form', { class: 'form', onsubmit: ev => { ev.preventDefault(); save(); } });
    const cancel = () => { UI.recEdit = null; drawRight(); };
    let save;
    if (a.type === 'post') {
      const today = new Date().toISOString().slice(0, 10);
      const fields = { title: h('input', { class: 'inp', id: 'f-title', value: r ? r.title : '', required: true }), date: h('input', { class: 'inp', id: 'f-date', type: 'date', value: r ? r.date : today }), tags: h('input', { class: 'inp', id: 'f-tags', value: r ? (r.tags || []).join(', ') : '' }), summary: h('input', { class: 'inp', id: 'f-summary', value: r ? r.summary || '' : '' }), body: h('textarea', { class: 'inp body', id: 'f-body' }) };
      fields.body.value = r ? r.body.trim() : 'Write the post in Markdown.';
      f.append(h('label', null, 'Title', fields.title), h('label', null, 'Date', fields.date), h('label', null, 'Tags, comma separated', fields.tags), h('label', null, 'Summary', fields.summary), h('label', null, 'Body · Markdown', fields.body));
      save = () => {
        const title = fields.title.value.trim(); if (!title) { fields.title.focus(); return; }
        const slug = r ? r.id : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post';
        const path = r ? r.path : `posts/${slug}.md`;
        const tags = fields.tags.value.split(',').map(s => s.trim()).filter(Boolean);
        const text = `---\ntitle: ${title}\ndate: ${fields.date.value}\ntags: [${tags.join(', ')}]\nauthor: ${r && r.author ? r.author : uname(UI.me)}\nsummary: ${fields.summary.value.trim()}\n---\n${fields.body.value.trim()}\n`;
        const out = api.push(a.id, { files: { [path]: text }, base: v.n, message: r ? `Edit “${title}”` : `New post: “${title}”`, by: UI.me, via: 'browser' });
        cli(`slop push ./${a.id} -a ${a.id} -m "${r ? 'Edit' : 'New post'}"   (${path})`);
        UI.recEdit = null; UI.rec = slug; UI.n = null;
        toast(`${a.id} v${out.version.n}: ${r ? 'post updated' : 'post added'}. Routes that follow main show it now.`);
      };
    } else {
      const ta = h('textarea', { class: 'inp body', id: 'f-json', 'aria-label': 'Record as JSON' });
      ta.value = r ? JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && k !== 'path')), null, 2) : JSON.stringify({ no: recs.length + 1, title: 'New experiment', kind: 'Toy', date: new Date().toISOString().slice(0, 10), size: '10 KB', tags: ['toy'], summary: 'One sentence about it.', colors: ['#2F2D2A', '#CEE5FF', '#F4F3F0', '#FFFFFF'], by: uname(UI.me), href: null }, null, 2);
      const idIn = h('input', { class: 'inp', id: 'f-id', value: r ? r.id : 'new-experiment' });
      const err = h('span', { class: 'muted', style: 'color:var(--accent)' });
      f.append(h('label', null, 'File name', idIn), h('label', null, 'Record · JSON', ta), err);
      save = () => {
        let obj; try { obj = JSON.parse(ta.value); } catch (x) { err.textContent = 'That is not valid JSON: ' + x.message; return; }
        const id = idIn.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'); if (!id) { idIn.focus(); return; }
        const dir = (Object.keys(v.files)[0] || 'records/x').split('/')[0];
        const path = r ? r.path : `${dir}/${id}.json`;
        const out = api.push(a.id, { files: { [path]: JSON.stringify(obj, null, 2) + '\n' }, base: v.n, message: r ? `Edit ${id}` : `New record: ${id}`, by: UI.me, via: 'browser' });
        UI.recEdit = null; UI.rec = id; UI.n = null;
        toast(`${a.id} v${out.version.n}: ${r ? 'record updated' : 'record added'}.`);
      };
    }
    f.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, `Save as v${Math.max(...a.versions.map(x => x.n)) + 1}`), h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel')),
      h('span', { class: 'muted', style: 'font-size:var(--fs-xs)' }, 'Saving makes a new version of the whole collection. Only this file changes; the others are shared.'));
    return h('div', { class: 'scroll' }, h('div', { class: 'pane-head' }, h('h2', null, e.isNew ? (a.type === 'post' ? 'New post' : 'New record') : 'Edit ' + (r ? r.id : ''))), f);
  }
  function drawTokens(el) {
    const a = art(), v = curV(), saved = R.tokensOf(a.id, v.n) || { colors: {} };
    const t = UI.tokDraft || JSON.parse(JSON.stringify(saved));
    const changed = JSON.stringify(t) !== JSON.stringify(saved);
    const sw = h('div', { class: 'swatches' });
    Object.entries(t.colors).forEach(([k, val]) => {
      const set = nv => { if (!/^#[0-9a-f]{6}$/i.test(nv)) return; UI.tokDraft = JSON.parse(JSON.stringify(t)); UI.tokDraft.colors[k] = nv; drawRight(); };
      sw.append(h('div', { class: 'swatch' }, h('input', { type: 'color', value: val, 'aria-label': k, onchange: e => set(e.target.value) }), h('b', null, '--' + k), h('input', { type: 'text', value: val, 'aria-label': k + ' hex', onchange: e => set(e.target.value.trim()) })));
    });
    const left = h('div', { class: 'dlist' }, h('div', { class: 'pane-head' }, h('h2', null, 'Colours'), h('span', { class: 'note' }, `tokens.json · v${v.n}`), h('span', { class: 'sp' }),
      changed ? h('button', { class: 'btn sm primary', onclick: () => { const out = api.push(a.id, { files: { 'tokens.json': JSON.stringify(t, null, 2) + '\n' }, base: v.n, message: 'Colours: ' + Object.keys(t.colors).filter(k => t.colors[k] !== saved.colors[k]).map(k => `${k} ${t.colors[k]}`).join(', '), by: UI.me, via: 'browser' }); UI.tokDraft = null; UI.n = null; thumbCache.clear(); toast(`lab-tokens v${out.version.n}: every page that reads the tokens has the new colours.`); } }, 'Save as new version') : null,
      changed ? h('button', { class: 'btn sm', onclick: () => { UI.tokDraft = null; drawRight(); } }, 'Discard') : null),
      h('div', { class: 'scroll' }, sw, h('p', { class: 'empty' }, changed ? 'Not saved. The preview shows your draft.' : 'Pick a colour to try it on the front page. Saving makes a new version of lab-tokens.')));
    const ctx = R.previewContext('front-page', {});
    const right = h('div', { class: 'dright' }, h('div', { class: 'pane-head' }, h('h2', null, 'Through front-page'), h('span', { class: 'note' }, changed ? 'draft colours' : `v${v.n}`)),
      stageEl('data', R.doc('front-page', null, Object.assign({ mode: 'preview', tokensOverride: t }, ctx)), () => UI.device));
    el.append(h('div', { class: 'dsplit' }, left, right));
  }

  // filmstrip
  function drawFilm() {
    const el = $('#wFilm'); if (!el) return;
    el.innerHTML = '';
    const a = art(), v = curV();
    el.append(h('span', { class: 'lbl', 'aria-hidden': 'true' }, 'VERSIONS'));
    const routes = a.kind === 'data' ? [] : api.routes.using(a.id);
    a.versions.forEach((x, i) => {
      const prev = a.versions[i - 1];
      const shot = h('div', { class: 'shot' });
      if (a.kind === 'data') {
        const recs = R.records(a.id, x.n);
        const add = prev ? Object.keys(x.files).filter(f => prev.files[f] == null).length : Object.keys(x.files).length;
        const chg = prev ? Object.keys(x.files).filter(f => prev.files[f] != null && prev.files[f] !== x.files[f]).length : 0;
        shot.append(h('div', { class: 'dsum' }, a.type === 'tokens' ? h('b', null, 'tokens') : h('b', null, String(recs.length)), h('span', null, a.type === 'tokens' ? 'colours and type' : plural(recs.length, recWord(a))), h('span', null, prev ? [add ? `+${add} new` : '', chg ? `${chg} changed` : ''].filter(Boolean).join(' · ') || 'no change' : 'first version')));
      } else shot.append(thumbFrame(a.id, x.n, 132));
      routes.forEach(r => { if ((r.version && r.version === x.n) || (!r.version && x.n === a.refs.main)) shot.append(h('span', { class: 'flag' }, r.path === '*' ? '*' : r.path)); });
      if (x.n === a.refs.main) shot.append(h('span', { class: 'flag main' }, 'main'));
      el.append(h('button', { class: 'frame' + (x.n === v.n ? ' on' : ''), 'data-n': String(x.n), title: `v${x.n} · ${x.message}`, onclick: () => selectVersion(x.n) }, shot,
        h('span', { class: 'meta' }, av(x), h('b', null, 'v' + x.n), h('span', null, ago(x.at)))));
    });
    setTimeout(() => { const on = el.querySelector('.frame.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 0);
    registerFrames(el);
  }
  function markFilm() { const el = $('#wFilm'); if (!el) return; const v = curV(); el.querySelectorAll('.frame').forEach(f => f.classList.toggle('on', +f.dataset.n === v.n)); }

  // ================================================================== ROUTES
  function renderRoutes() {
    const host = UI.routesHost;
    const rows = api.routes.list(host).slice().sort((x, y) => (x.path === '*') - (y.path === '*') || x.path.localeCompare(y.path));
    if (!rows.some(r => r.host === UI.routeSel.host && r.path === UI.routeSel.path)) UI.routeSel = rows[0] ? { host, path: rows[0].path } : { host, path: null };
    const list = h('section', { class: 'tile main' },
      h('div', { class: 'dstrip' }, h('div', { class: 'dtabs', role: 'tablist' }, api.routes.hosts().concat(api.routes.hosts().includes('slop.boutique') ? [] : ['slop.boutique']).sort().reverse().map(hs =>
        h('button', { class: 'dtab' + (hs === host ? ' on' : ''), role: 'tab', onclick: () => { UI.routesHost = hs; UI.adding = null; UI.confirmRemove = false; render(); } }, hs, h('span', { class: 'count' }, String(api.routes.list(hs).length))))),
        h('span', { class: 'sp' }), h('button', { class: 'tabact' + (UI.adding ? ' on' : ''), onclick: () => { UI.adding = UI.adding ? null : {}; render(); } }, '+ Add route')),
      h('div', { class: 'tilebody' }, h('div', { class: 'scroll' }, UI.adding ? addRouteForm(host) : null, routeTable(rows),
        h('p', { class: 'empty' }, host === 'slop.computer' ? 'These are slop.computer’s own screens. Each is a shell artifact, served with the API. /_/ is the one page built into the server, so a bad push can always be undone.' : 'The most specific route wins. * catches every path with no route of its own. A route either follows its page’s main version or is pinned to one; data bindings work the same way.'))));
    const side = h('section', { class: 'tile side', style: 'width:440px' }, routeDetail());
    $('#work').append(h('div', { class: 'split' }, list, h('div', { class: 'gutter', style: 'cursor:default' }), side));
  }
  function routeTable(rows) {
    const tb = h('table', { class: 'rt' });
    tb.append(h('thead', null, h('tr', null, ['Path', 'Page', 'Data', 'Points at', 'Access', 'Changed'].map(t => h('th', null, t)))));
    const body = h('tbody');
    rows.forEach(r => {
      const a = api.artifacts.get(r.page), main = a ? a.refs.main : null;
      const v = api.versions.get(r.page, r.version);
      const b = Object.entries(api.routes.bindingsFor(v, r)).filter(([k]) => k !== '$tokens');
      const on = UI.routeSel.host === r.host && UI.routeSel.path === r.path;
      body.append(h('tr', { class: 'click' + (on ? ' on' : ''), onclick: () => { UI.routeSel = { host: r.host, path: r.path }; UI.confirmRemove = false; render(); } },
        h('td', null, h('code', { style: 'font-weight:700' }, r.path)),
        h('td', null, r.page, a && a.trust === 'shell' ? h('span', { class: 'tag ink', style: 'margin-left:6px' }, 'shell') : null),
        h('td', { class: 'dim' }, b.length ? b.map(([k, x]) => h('div', null, h('code', null, `${x.artifact}@${x.version ? 'v' + x.version : 'main'}`))) : '–', r.record ? h('div', null, h('code', { style: 'color:var(--ink-2)' }, r.record)) : null),
        h('td', null, r.version ? [h('code', null, `v${r.version}`), ' pinned ', main > r.version ? h('span', { class: 'tag red' }, `v${main} newer`) : null] : h('code', null, `main → v${main}`)),
        h('td', { class: 'dim' }, r.access),
        h('td', { class: 'dim' }, `${uname(r.changedBy)} · ${ago(r.changedAt)}`)));
    });
    if (!rows.length) body.append(h('tr', null, h('td', { colspan: '6', class: 'dim' }, 'No routes on this host yet.')));
    tb.append(body);
    return h('div', { class: 'tablewrap' }, tb);
  }
  function addRouteForm(host) {
    const pages = api.artifacts.list().filter(a => a.kind === 'page');
    const pre = UI.adding || {};
    const path = h('input', { class: 'inp', id: 'nr-path', placeholder: '/press', value: pre.path || (pre.page === 'press-kit' ? '/press' : '') });
    const pageSel = sel({ id: 'nr-page', 'aria-label': 'Page' }, pages.map(p => ({ value: p.id, label: `${p.id} · v${p.refs.main}`, selected: p.id === (pre.page || 'press-kit') })), () => {});
    const pin = sel({ id: 'nr-pin', 'aria-label': 'Points at' }, [{ value: 'main', label: 'Follow main' }, { value: 'pin', label: 'Pin the current main version' }], () => {});
    const rec = h('input', { class: 'inp', id: 'nr-rec', placeholder: 'only for paths with :params, e.g. posts/{slug}.md' });
    const err = h('span', { style: 'color:var(--accent);font-size:var(--fs-xs)' });
    const add = () => {
      let p = path.value.trim(); if (p && p !== '*' && !p.startsWith('/')) p = '/' + p;
      if (!p) { err.textContent = 'A route needs a path, like /press.'; path.focus(); return; }
      if (!/^(\*|\/[A-Za-z0-9_\-./:*]*)$/.test(p)) { err.textContent = 'Paths use letters, digits, - _ . / and :params.'; return; }
      if (api.routes.get(host, p)) { err.textContent = `${p} already has a route. Select it in the table to change it.`; return; }
      const page = pageSel.value, a = api.artifacts.get(page);
      api.routes.set({ host, path: p, page, version: pin.value === 'pin' ? a.refs.main : null, record: rec.value.trim() || null, access: host === 'slop.computer' ? 'admins' : 'public' }, UI.me, 'created');
      cli(`slop route set ${host}${p} ${page}@${pin.value === 'pin' ? a.refs.main : 'main'}`);
      UI.adding = null; UI.routeSel = { host, path: p };
      toast(`${p} now serves ${page}.`); render();
    };
    return h('div', { class: 'box', style: 'margin:12px' }, h('h4', null, `New route on ${host}`),
      h('div', { class: 'kv' }, h('span', null, 'Path'), path, h('span', null, 'Page'), pageSel, h('span', null, 'Points at'), pin, h('span', null, 'Record'), rec),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: add }, 'Add route'), h('button', { class: 'btn', onclick: () => { UI.adding = null; render(); } }, 'Cancel'), err));
  }
  function routeDetail() {
    const r = UI.routeSel.path ? api.routes.get(UI.routeSel.host, UI.routeSel.path) : null;
    if (!r) return h('p', { class: 'empty' }, 'Select a route.');
    const a = api.artifacts.get(r.page), v = api.versions.get(r.page, r.version);
    const set = (patch, note, line) => { api.routes.set(Object.assign({}, r, patch), UI.me, note); if (line) cli(line); toast(`${r.path}: ${note}.`); };
    const d = h('div', { class: 'det' });
    d.append(h('h3', null, r.path), h('p', { class: 'sub' }, `${r.host} · ${r.page}${a && a.trust === 'shell' ? ' · shell' : ''} · changed by ${uname(r.changedBy)} ${ago(r.changedAt)}`));
    // preview of what this route serves
    let ctx;
    if (/[:*]/.test(r.path) && r.path !== '*') { const c = R.previewContext(r.page, { n: v && v.n }); ctx = { host: r.host, path: c.path, params: c.params, record: c.record, bindings: api.routes.bindingsFor(v, r) }; }
    else ctx = { host: r.host, path: r.path === '*' ? '/press' : r.path, params: {}, record: null, bindings: api.routes.bindingsFor(v, r) };
    const st = stageEl('route', R.doc(r.page, v ? v.n : null, Object.assign({ mode: 'site' }, ctx)), 'desktop');
    st.style.padding = '10px';
    d.append(h('div', { class: 'mini' }, st));
    st.style.position = 'absolute'; st.style.inset = '0';
    // fields
    const pages = api.artifacts.list().filter(x => x.kind === 'page');
    const kv = h('div', { class: 'kv' });
    kv.append(h('span', null, 'Page'), sel({ 'aria-label': 'Page' }, pages.map(p => ({ value: p.id, label: p.id, selected: p.id === r.page })), val => set({ page: val, version: null }, `page is now ${val}, following main`, `slop route set ${r.host}${r.path} ${val}@main`)));
    kv.append(h('span', null, 'Points at'), sel({ 'aria-label': 'Version' }, [{ value: 'main', label: `Follow main (now v${a.refs.main})`, selected: !r.version }].concat(a.versions.slice().reverse().map(x => ({ value: String(x.n), label: `v${x.n} · ${x.message}`, selected: r.version === x.n }))),
      val => val === 'main' ? set({ version: null }, 'follows main', `slop route set ${r.host}${r.path} ${r.page}@main`) : set({ version: +val }, `pinned v${val}`, `slop route set ${r.host}${r.path} ${r.page}@${val}`)));
    const binds = Object.entries(api.routes.bindingsFor(v, r));
    binds.forEach(([name, b]) => {
      const da = api.artifacts.get(b.artifact); if (!da) return;
      kv.append(h('span', null, name === '$tokens' ? 'Tokens' : `Data: ${name}`), sel({ 'aria-label': 'Data ' + name }, [{ value: 'main', label: `${b.artifact} · follow main (v${da.refs.main})`, selected: !b.version }].concat(da.versions.slice().reverse().map(x => ({ value: String(x.n), label: `${b.artifact} v${x.n} · ${x.message}`, selected: b.version === x.n }))),
        val => { const bindings = Object.assign({}, r.bindings || {}); bindings[name] = { artifact: b.artifact, version: val === 'main' ? null : +val }; set({ bindings }, val === 'main' ? `${b.artifact} follows main` : `${b.artifact} pinned v${val}`, `slop route set ${r.host}${r.path} --data ${name}=${b.artifact}@${val}`); }));
    });
    if (r.record) kv.append(h('span', null, 'Record'), h('code', null, r.record));
    kv.append(h('span', null, 'Access'), h('div', { class: 'seg sm' }, ['public', 'admins'].map(x => h('button', { 'aria-pressed': String(r.access === x), onclick: () => { if (r.access !== x) set({ access: x }, `access ${x}`); } }, x))));
    d.append(kv);
    d.append(h('div', { class: 'row' },
      r.host === 'slop.boutique' ? h('button', { class: 'btn', onclick: () => { UI.site.host = r.host; navigate(ctx.path, true); go('site'); } }, 'Open in Site') : null,
      h('button', { class: 'btn', onclick: () => openArtifact(r.page) }, `Watch ${r.page}`), h('span', { class: 'sp' }),
      h('button', { class: 'btn danger', onclick: () => { UI.confirmRemove = true; render(); } }, 'Remove route')));
    if (UI.confirmRemove) d.append(h('div', { class: 'box red' }, h('span', null, `Remove ${r.path}? Visitors get the * route instead. It stays in the history below.`), h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: () => { api.routes.remove(r.host, r.path, UI.me); cli(`slop route rm ${r.host}${r.path}`); UI.confirmRemove = false; toast(`${r.path} removed.`); render(); } }, 'Remove'),
      h('button', { class: 'btn', onclick: () => { UI.confirmRemove = false; render(); } }, 'Keep it'))));
    // history
    const log = api.routes.log(r.host, r.path);
    d.append(h('div', { class: 'pane-head', style: 'padding-left:0;padding-right:0' }, h('h2', null, 'History'), h('span', { class: 'note' }, 'Every change is kept. Roll back by pointing again.')));
    const hist = h('div', { style: 'margin:-14px -14px 0' });
    log.forEach((l, i) => {
      const target = l.to ? l.to.version : null, cur = r.version || null;
      const can = l.to && i > 0 && target !== cur && (!l.to.page || l.to.page === r.page);
      hist.append(h('div', { class: 'hrow' + (i === 0 ? ' on' : '') }, h('span', { class: 'av' }, uname(l.by).charAt(0)),
        h('div', { class: 'ht', style: 'cursor:default' }, h('b', null, l.note || (l.to ? (l.to.version ? `pinned v${l.to.version}` : 'follows main') : 'removed')), h('small', null, `${uname(l.by)} · ${ago(l.at)}`)),
        can ? h('button', { class: 'btn sm', onclick: () => set({ version: target }, target ? `rolled back to v${target}` : 'rolled back to follow main', `slop route set ${r.host}${r.path} ${r.page}@${target || 'main'}`) }, 'Roll back to this') : null));
    });
    if (!log.length) hist.append(h('p', { class: 'empty' }, 'No changes since the seed.'));
    d.append(hist);
    return h('div', { class: 'tilebody' }, h('div', { class: 'scroll' }, d));
  }

  // ================================================================== SITE
  function navigate(path, quiet) {
    const s = UI.site;
    if (!path.startsWith('/')) { const base = s.path.replace(/[^/]*$/, ''); path = base + path; }
    if (path !== s.path) { s.back.push(s.path); s.fwd = []; }
    s.path = path;
    if (!quiet && UI.screen === 'site') renderSiteFrame();
  }
  function renderSite() {
    const s = UI.site;
    const input = h('input', { id: 'siteAddr', value: s.path, 'aria-label': 'Path', spellcheck: 'false', onkeydown: e => { if (e.key === 'Enter') navigate(e.target.value.trim() || '/'); } });
    const hostSel = h('select', { 'aria-label': 'Host', onchange: e => { s.host = e.target.value; s.back = []; s.fwd = []; s.path = '/'; render(); } }, ['slop.boutique', 'slop.computer'].map(x => h('option', { value: x, selected: x === s.host ? 'selected' : null }, 'https://' + x)));
    const tile = h('section', { class: 'tile main' },
      h('div', { class: 'toolbar' },
        h('button', { class: 'ibtn', 'aria-label': 'Back', disabled: !s.back.length, onclick: () => { s.fwd.push(s.path); s.path = s.back.pop(); render(); } }, '←'),
        h('button', { class: 'ibtn', 'aria-label': 'Forward', disabled: !s.fwd.length, onclick: () => { s.back.push(s.path); s.path = s.fwd.pop(); render(); } }, '→'),
        h('button', { class: 'ibtn', 'aria-label': 'Reload', onclick: () => renderSiteFrame() }, '↻'),
        h('div', { class: 'addr' }, hostSel, input), h('button', { class: 'btn', onclick: () => navigate(input.value.trim() || '/') }, 'Go'),
        deviceSeg(() => render()), h('button', { class: 'btn', id: 'siteWatch', onclick: () => { const res = api.routes.resolve(s.host, s.path); if (res) openArtifact(res.page, { n: res.version ? res.n : null }); } }, 'Watch this page')),
      h('div', { class: 'visit', id: 'siteVisit' }), h('div', { class: 'tilebody', id: 'siteBody' }));
    $('#work').append(h('div', { class: 'split' }, tile));
    renderSiteFrame();
  }
  function renderSiteFrame() {
    const s = UI.site, body = $('#siteBody'), visit = $('#siteVisit'); if (!body) return;
    const inp = $('#siteAddr'); if (inp) inp.value = s.path;
    body.innerHTML = ''; visit.innerHTML = ''; visit.className = 'visit calm';
    const res = api.routes.resolve(s.host, s.path);
    if (!res) { visit.className = 'visit'; visit.append(h('span', null, h('b', null, 'No route'), ` matches ${s.path} on ${s.host}, and there is no * route.`)); body.append(h('p', { class: 'empty' }, 'A visitor would get the server’s plain 404.')); return; }
    if (res.page && api.artifacts.get(res.page).trust === 'shell') {
      visit.append(h('span', null, h('code', null, res.route.path), ` → shell `, h('b', null, res.page), ` v${res.n}`));
      body.append(h('div', { class: 'empty', style: 'padding:24px' }, h('p', { style: 'margin:0 0 10px' }, `${s.path} on slop.computer is the ${NAMES[res.page] || res.page} shell, the screen this prototype draws itself.`), h('button', { class: 'btn primary', onclick: () => go(SCREENS.includes(res.page) ? res.page : 'watch') }, `Go to ${NAMES[res.page] || 'Watch'}`)));
      return;
    }
    const parts = [h('code', null, res.route.path), ' → ', h('b', null, `${res.page} v${res.n}`), res.route.version ? ' (pinned)' : ' (main)'];
    Object.entries(res.bindings).filter(([k]) => k !== '$tokens').forEach(([k, b]) => parts.push(h('span', { class: 'muted' }, ` · ${k} = ${b.artifact} v${b.n}${b.version ? ' pinned' : ''}`)));
    if (res.record) parts.push(h('span', { class: 'muted' }, ' · record '), h('code', null, res.record));
    if (res.bindings.$tokens) parts.push(h('span', { class: 'muted' }, ` · tokens v${res.bindings.$tokens.n}`));
    if (res.fallback) { visit.className = 'visit'; parts.unshift(h('b', null, 'No route of its own. '), ''); parts.push(h('button', { class: 'btn sm', onclick: () => { UI.adding = { path: s.path, page: s.path === '/press' ? 'press-kit' : undefined }; UI.routesHost = s.host; go('routes'); } }, `Add a route for ${s.path}…`)); }
    visit.append(h('span', null, parts));
    const st = stageEl('site', R.doc(res.page, res.n, { mode: 'site', host: s.host, path: res.path, params: res.params, record: res.record, bindings: res.bindings }), () => UI.device);
    body.append(st);
    registerFrames(body);
  }

  // ================================================================== ARTIFACTS
  function renderArtifacts() {
    const f = UI.arts;
    const tool = h('div', { class: 'toolbar' },
      h('input', { class: 'filter', type: 'search', placeholder: 'Find an artifact', 'aria-label': 'Find an artifact', value: f.q, oninput: e => { f.q = e.target.value; drawGrid(); } }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Kind' }, [['all', 'All'], ['page', 'Pages'], ['data', 'Data'], ['shell', 'Shells']].map(([k, l]) => h('button', { 'aria-pressed': String(f.kind === k), onclick: () => { f.kind = k; render(); } }, l))),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn primary', onclick: pushDialog }, 'Push a file…'));
    const grid = h('div', { class: 'scroll', id: 'agrid' });
    $('#work').append(h('div', { class: 'split' }, h('section', { class: 'tile main' }, tool, h('div', { class: 'tilebody' }, grid))));
    drawGrid();
  }
  function drawGrid() {
    const box = $('#agrid'); if (!box) return;
    const f = UI.arts, q = f.q.trim().toLowerCase();
    box.innerHTML = '';
    const grid = h('div', { class: 'agrid' });
    api.projects.list().forEach(p => {
      const items = api.artifacts.list().filter(a => a.project === p.id && (f.kind === 'all' || kindLabel(a) === f.kind) && (!q || (a.id + ' ' + a.title + ' ' + (a.versions[a.versions.length - 1].message)).toLowerCase().includes(q)));
      if (!items.length) return;
      grid.append(h('div', { class: 'grp-h' }, h('b', null, p.name), h('span', null, plural(items.length, 'artifact') + ' · ' + p.brief)));
      items.forEach(a => {
        const v = a.versions[a.versions.length - 1];
        const shot = h('div', { class: 'shot' });
        if (a.kind === 'data') {
          const recs = R.records(a.id, v.n), t = a.type === 'tokens' ? R.tokensOf(a.id, v.n) : null;
          shot.append(h('div', { class: 'dsum' }, h('b', null, a.type === 'tokens' ? 'tokens.json' : plural(recs.length, recWord(a))), a.type === 'tokens'
            ? h('div', { style: 'display:flex;gap:4px;margin-top:6px' }, Object.values(t.colors).map(c => h('span', { style: `width:22px;height:22px;background:${c};box-shadow:0 0 0 1px var(--hair)` })))
            : recs.slice().sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 5).map(r => h('span', null, (r.date ? r.date + '  ' : '') + (r.title || r.id)))));
        } else {
          const fr = h('iframe', { sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true' });
          lazy(fr, () => thumbDoc(a.id, a.refs.main));
          shot.append(fr);
          requestAnimationFrame(() => { const w = shot.clientWidth || 250; fr.style.transform = `scale(${w / 1280})`; });
        }
        const routes = a.kind === 'data' ? api.routes.readers(a.id) : api.routes.using(a.id);
        const open = api.comments.list(a.id).filter(t => !t.resolved).length;
        grid.append(h('button', { class: 'acard', onclick: () => openArtifact(a.id) }, shot, h('div', { class: 'ab' },
          h('div', { class: 't' }, h('b', null, a.id), h('span', { class: 'tag' + (kindLabel(a) === 'shell' ? ' ink' : '') }, a.kind === 'data' ? a.type : kindLabel(a)), open ? h('span', { class: 'count bad', title: 'open threads' }, String(open)) : null),
          h('small', null, `v${v.n} · ${ago(v.at)} · ${vBy(v)}`), h('small', null, v.message),
          h('span', { class: 'tags' }, routes.length ? routes.slice(0, 3).map(r => h('span', { class: 'tag' }, r.path)) : h('span', { class: 'tag red' }, a.kind === 'data' ? 'read by no route' : 'not routed')))));
      });
    });
    box.append(grid);
    registerFrames(box);
  }
  function pushDialog() {
    const arts = api.artifacts.list();
    const close = () => d.remove();
    const target = sel({ id: 'pushTarget', 'aria-label': 'Artifact' }, arts.map(a => ({ value: a.id, label: `${a.id} · ${a.kind === 'data' ? a.type : kindLabel(a)} · v${a.refs.main}`, selected: a.id === UI.artifact })).concat([{ value: '__new', label: 'A new artifact…' }]), () => sync());
    const newId = h('input', { class: 'inp', id: 'pushNew', placeholder: 'name, e.g. colophon' });
    const kind = sel({ id: 'pushKind', 'aria-label': 'Kind' }, [{ value: 'page', label: 'Page: HTML, CSS, JS' }, { value: 'post', label: 'Data: Markdown posts' }, { value: 'records', label: 'Data: JSON records' }], () => sync());
    const proj = sel({ id: 'pushProj', 'aria-label': 'Project' }, api.projects.list().map(p => ({ value: p.id, label: p.name })), () => {});
    const file = h('input', { type: 'file', id: 'pushFiles', multiple: true, accept: '.html,.htm,.css,.js,.md,.json,.csv,.txt' });
    const paste = h('textarea', { class: 'inp', id: 'pushPaste', rows: '6', placeholder: 'Or paste a whole HTML page here', style: 'font:400 11px/1.5 var(--code)' });
    const msg = h('input', { class: 'inp', id: 'pushMsg', placeholder: 'What changed' });
    const equiv = h('code', { style: 'word-break:break-all' });
    const err = h('span', { style: 'color:var(--accent);font-size:var(--fs-xs)' });
    const newRow = h('div', { class: 'kv' }, h('span', null, 'Name'), newId, h('span', null, 'Kind'), kind, h('span', null, 'Project'), proj);
    const sync = () => {
      const isNew = target.value === '__new', a = api.artifacts.get(target.value);
      newRow.hidden = !isNew;
      const isPage = isNew ? kind.value === 'page' : a.kind === 'page';
      paste.hidden = !isPage;
      equiv.textContent = `slop push ./${isNew ? (newId.value || 'folder') : target.value} -a ${isNew ? (newId.value || 'name') : target.value} -m "${msg.value || '…'}"`;
    };
    [newId, msg].forEach(x => x.addEventListener('input', sync));
    const doPush = async () => {
      err.textContent = '';
      const isNew = target.value === '__new';
      const id = isNew ? newId.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') : target.value;
      if (!id) { err.textContent = 'Give the new artifact a name.'; newId.focus(); return; }
      if (isNew && api.artifacts.get(id)) { err.textContent = `${id} exists already. Pick it in the list to push a new version.`; return; }
      const a = api.artifacts.get(id), k = isNew ? kind.value : a.kind === 'page' ? 'page' : a.type;
      const files = {};
      const read = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsText(f); });
      const dir = k === 'post' ? 'posts/' : k === 'records' ? ((a && Object.keys(a.versions[a.versions.length - 1].files)[0] || 'records/x').split('/')[0] + '/') : '';
      for (const f of Array.from(file.files || [])) {
        const text = await read(f); if (text == null) continue;
        let name = f.name;
        if (k === 'page' && /\.html?$/i.test(name) && Array.from(file.files).filter(x => /\.html?$/i.test(x.name)).length === 1) name = 'index.html';
        files[(k === 'page' ? '' : dir) + name] = text;
      }
      if (paste.value.trim() && k === 'page') files['index.html'] = paste.value;
      if (!Object.keys(files).length) { err.textContent = 'Choose a file, or paste a page.'; return; }
      if (k === 'page' && isNew && !files['index.html']) { err.textContent = 'A new page needs an index.html.'; return; }
      const message = msg.value.trim() || (isNew ? 'First version' : `${Object.keys(files).join(', ')}`);
      const create = isNew ? { title: id, kind: k === 'page' ? 'page' : 'data', type: k === 'page' ? undefined : k, project: proj.value, trust: k === 'page' ? 'app' : null, viewer: k === 'post' ? 'journal-post' : null } : null;
      const out = api.push(id, { files, message, by: UI.me, via: 'cli', create, manifest: isNew ? (k === 'page' ? { reads: {}, tokens: 'lab-tokens' } : { type: k }) : undefined });
      cli(`slop push ./${id} -a ${id} -m "${message}"`);
      close(); toast(`Pushed ${id} v${out.version.n}.`); openArtifact(id);
    };
    const d = h('div', { class: 'modal', onclick: e => { if (e.target === d) close(); } }, h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Push a version' },
      h('header', null, h('h2', null, 'Push a version'), h('button', { class: 'ibtn', 'aria-label': 'Close', onclick: close }, '×')),
      h('div', { class: 'form' },
        h('div', { class: 'kv' }, h('span', null, 'Artifact'), target), newRow,
        h('label', null, 'Files: .html .css .js for a page, .md or .json for data', file), paste,
        h('label', null, 'Message', msg),
        h('span', { class: 'muted', style: 'font-size:var(--fs-xs)' }, 'From a terminal this is'), equiv, err),
      h('footer', null, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: doPush }, 'Push'))));
    document.body.append(d); sync();
  }

  // ================================================================== ADMIN
  function renderAdmin() {
    const tabs = [['people', 'People', api.users.list().filter(u => u.role === 'pending').length], ['tokens', 'Tokens', null], ['audit', 'Audit log', null]];
    const strip = h('div', { class: 'dstrip' }, h('div', { class: 'dtabs', role: 'tablist' }, tabs.map(([k, l, c]) => h('button', { class: 'dtab' + (UI.adminTab === k ? ' on' : ''), role: 'tab', onclick: () => { UI.adminTab = k; render(); } }, l, c ? h('span', { class: 'count bad' }, String(c)) : null))));
    const body = h('div', { class: 'scroll' });
    if (UI.adminTab === 'people') {
      body.append(h('div', { class: 'pane-head' }, h('h2', null, 'People'), h('span', { class: 'note' }, 'Anyone who signs in through ZITADEL lands here as pending and sees nothing until an admin lets them in. There are no plans, no billing and no other roles.')));
      const tb = h('table', { class: 'rt' }, h('thead', null, h('tr', null, ['Name', 'Email', 'Role', 'Last seen', 'Since', ''].map(t => h('th', null, t)))));
      const tbody = h('tbody');
      api.users.list().slice().sort((a, b) => (a.role === 'pending' ? -1 : 0) - (b.role === 'pending' ? -1 : 0)).forEach(u => {
        const me = u.id === UI.me;
        tbody.append(h('tr', null, h('td', null, h('span', { class: 'av', style: 'margin-right:8px' }, u.initial), u.name, me ? h('span', { class: 'muted' }, ' (you)') : null), h('td', { class: 'dim' }, u.email),
          h('td', null, me ? u.role : sel({ 'aria-label': 'Role of ' + u.name }, ['admin', 'pending', 'disabled'].map(r => ({ value: r, label: r, selected: u.role === r })), val => { api.users.setRole(u.id, val, UI.me); toast(`${u.name} is now ${val}.`); render(); })),
          h('td', { class: 'dim' }, ago(u.lastSeen)), h('td', { class: 'dim' }, ago(u.created)),
          h('td', null, u.role === 'pending' ? h('button', { class: 'btn sm primary', onclick: () => { api.users.setRole(u.id, 'admin', UI.me); toast(`${u.name} is an admin now.`); render(); } }, 'Let in as admin') : null)));
      });
      tb.append(tbody); body.append(h('div', { class: 'tablewrap' }, tb));
    } else if (UI.adminTab === 'tokens') {
      body.append(h('div', { class: 'pane-head' }, h('h2', null, 'Tokens'), h('span', { class: 'note' }, 'What the CLI and agents use. slop auth login gets one through the browser, without copying it.'), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => { UI.tokenForm = !UI.tokenForm; UI.newToken = null; render(); } }, UI.tokenForm ? 'Cancel' : 'New token')));
      if (UI.newToken) body.append(h('div', { class: 'box red', style: 'margin:12px' }, h('h4', null, `${UI.newToken.token.name}: copy it now, it is shown once`), h('div', { class: 'secret' }, UI.newToken.secret),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: e => { const b = e.target; navigator.clipboard.writeText(UI.newToken.secret).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Select it and copy'; }); } }, 'Copy'), h('code', null, 'slop auth login --with-token --server https://slop.computer < token.txt'))));
      if (UI.tokenForm && !UI.newToken) {
        const name = h('input', { class: 'inp', id: 'tokName', value: 'claude code agent' });
        const scopes = { read: true, write: true, admin: false };
        const days = sel({ id: 'tokDays', 'aria-label': 'Lifetime' }, [30, 90].map(n => ({ value: String(n), label: n + ' days', selected: n === 90 })), () => {});
        body.append(h('div', { class: 'box', style: 'margin:12px' }, h('h4', null, 'New token'), h('div', { class: 'kv' }, h('span', null, 'Name'), name, h('span', null, 'Scopes'),
          h('div', { class: 'row' }, Object.keys(scopes).map(k => { const b = h('button', { class: 'tog' + (scopes[k] ? ' on' : ''), type: 'button', onclick: () => { scopes[k] = !scopes[k]; b.classList.toggle('on', scopes[k]); } }, k); return b; })),
          h('span', null, 'Lifetime'), days), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { const sc = Object.keys(scopes).filter(k => scopes[k]); if (!sc.length) return; UI.newToken = api.tokens.create({ by: UI.me, name: name.value.trim() || 'token', scopes: sc, days: +days.value }); UI.tokenForm = false; render(); } }, 'Create token'))));
      }
      const tb = h('table', { class: 'rt' }, h('thead', null, h('tr', null, ['Name', 'Owner', 'Scopes', 'Created', 'Last used', 'Expires', ''].map(t => h('th', null, t)))));
      const tbody = h('tbody');
      api.tokens.list().forEach(t => tbody.append(h('tr', null, h('td', null, t.name), h('td', { class: 'dim' }, uname(t.owner)), h('td', null, h('span', { class: 'tags' }, t.scopes.map(s => h('span', { class: 'tag' + (s === 'admin' ? ' ink' : '') }, s)))),
        h('td', { class: 'dim' }, ago(t.created)), h('td', { class: 'dim' }, t.lastUsed ? ago(t.lastUsed) : 'never'), h('td', { class: 'dim' }, t.revoked ? 'revoked ' + ago(t.revoked) : until(t.expires)),
        h('td', null, t.revoked ? null : h('button', { class: 'btn sm danger', onclick: () => { api.tokens.revoke(t.id, UI.me); toast(`${t.name} revoked. The CLI using it has to log in again.`); render(); } }, 'Revoke')))));
      tb.append(tbody); body.append(h('div', { class: 'tablewrap' }, tb));
    } else {
      body.append(h('div', { class: 'pane-head' }, h('h2', null, 'Audit log'), h('span', { class: 'note' }, 'Every change, with the token or agent it came through.')));
      const tb = h('table', { class: 'rt' }, h('thead', null, h('tr', null, ['When', 'Who', 'Through', 'What', 'Subject'].map(t => h('th', null, t)))));
      const tbody = h('tbody');
      api.audit.list().slice(0, 200).forEach(e => tbody.append(h('tr', null, h('td', { class: 'dim' }, ago(e.at)), h('td', null, uname(e.actor)), h('td', { class: 'dim' }, e.via), h('td', null, h('code', null, e.action)), h('td', null, e.subject))));
      tb.append(tbody); body.append(h('div', { class: 'tablewrap' }, tb));
    }
    $('#work').append(h('div', { class: 'split' }, h('section', { class: 'tile main' }, strip, h('div', { class: 'tilebody' }, body))));
  }

  // ================================================================== events
  window.addEventListener('message', e => {
    const m = e.data; if (!m || !m.slop) return;
    const role = FR.get(e.source); if (!role) return;
    if (m.type === 'pick' && role === 'watch') onPick(m);
    else if (m.type === 'pin' && role === 'watch') focusThread(m.id, false);
    else if (m.type === 'pins' && role === 'watch') {
      const before = [...UI.missing].join(); UI.missing = new Set(m.missing || []);
      if (before !== [...UI.missing].join() && UI.ltab === 'comments' && !UI.pending && UI.screen === 'watch') drawLeft();
    }
    else if (m.type === 'ready' && role === 'watch') sendPins();
    else if (m.type === 'nav') {
      const href = m.href;
      if (role === 'site') navigate(href);
      else if (role !== 'thumb') { UI.site.host = 'slop.boutique'; navigate(href, true); go('site'); toast(`Opened ${href} in Site.`); }
    }
    else if (m.type === 'external') toast('Links to other sites stay outside the prototype: ' + m.href);
  });
  document.addEventListener('click', () => { if (UI.menu) { UI.menu = null; UI.resetArmed = false; drawBar(); } });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    if (e.key === 'Escape') {
      if ($('.modal')) { $('.modal').remove(); return; }
      if (UI.menu) { UI.menu = null; drawBar(); return; }
      if (UI.picking) { setPick(false); return; }
      if (UI.pending && !typing) { UI.pending = null; drawLeftTabs(); drawLeft(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'c' || e.key === 'C') && UI.screen === 'watch') { e.preventDefault(); togglePick(); }
  });
  window.addEventListener('hashchange', () => { const s = hashScreen(); if (s && s !== UI.screen) { UI.screen = s; render(); } });

  api.on('push', ev => {
    const a = ev.artifact, v = ev.version;
    if (v.via === 'claude') toast(`${vBy(v)} pushed ${a.id} v${v.n}.`);
    if (UI.screen === 'watch' && UI.artifact === a.id) {
      drawBar(); drawLeftTabs(); if (UI.ltab !== 'comments') drawLeft(); drawFilm(); drawVisit(); drawTool();
      if (UI.n === null && !UI.pending && !UI.picking) drawRight();
    } else if (UI.screen === 'watch') drawBar();
    else if (UI.screen === 'artifacts') drawGrid();
    else if (UI.screen === 'routes') render();
    else if (UI.screen === 'site') { const res = api.routes.resolve(UI.site.host, UI.site.path); if (res && (res.page === a.id || Object.values(res.bindings).some(b => b.artifact === a.id))) renderSiteFrame(); }
  });
  const onThreads = ev => {
    const t = ev.thread;
    if (UI.screen === 'watch' && t && t.artifact === UI.artifact) {
      drawBar(); drawLeftTabs();
      // a reply you just sent closes your reply box; anything else waits so typed text is not lost
      if (ev.op && ev.op.t === 'thread.reply' && ev.comment && ev.comment.by === UI.me && !ev.comment.agent) UI.replyOpen = null;
      if (UI.ltab === 'comments' && !UI.pending && UI.replyOpen == null) drawLeft();
      sendPins();
    }
    if (UI.screen === 'artifacts') drawGrid();
  };
  api.on('thread.create', onThreads); api.on('thread.reply', onThreads); api.on('thread.resolve', onThreads);
  const onRoutes = () => {
    if (UI.screen === 'routes') render();
    else if (UI.screen === 'watch') { drawVisit(); drawFilm(); if (UI.ltab === 'versions') drawLeft(); }
    else if (UI.screen === 'site') renderSiteFrame();
    else if (UI.screen === 'artifacts') drawGrid();
  };
  api.on('route.set', onRoutes); api.on('route.remove', onRoutes);
  api.on('console', l => { const c = document.getElementById('console'); if (c) { const near = c.scrollHeight - c.scrollTop - c.clientHeight < 60; c.append(consoleLine(l)); if (near) c.scrollTop = c.scrollHeight; } });
  api.on('agent', () => { drawBar(); const l = document.getElementById('listen'); if (l && UI.screen === 'watch' && UI.ltab === 'comments' && !UI.pending && UI.replyOpen == null) drawLeft(); });

  // ------------------------------------------------------------------ start
  document.body.prepend(h('div', { id: 'app' }, h('header', { class: 'bar', id: 'bar' }), h('main', { id: 'work' })), h('div', { class: 'toasts', id: 'toasts', 'aria-live': 'polite' }));
  try { history.replaceState(null, '', '#' + UI.screen); } catch (e) { /* ignore */ }
  render();
  window.__slopUI = UI;
})();
