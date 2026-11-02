// ---------- chrome: everything around the canvas ----------
function renderChrome() {
  const f = $('#fname'); if (document.activeElement !== f) f.value = S.file.name || 'Untitled';
  document.title = (S.file.name || 'Untitled') + ' — Pinup';
  renderPages();
  renderTree();
  if (S.ltab === 'assets') renderAssets();
  if (S.ltab === 'feedback') renderFeedbackPanel();
  if (S.ltab === 'history') renderHistory();
  updateTabCounts();
  renderInspector();
  renderEmpty();
  renderAskScope();
  updateUndoButtons();
  const role = $('#role');
  role.hidden = S.canEdit; role.textContent = S.canEdit ? '' : (CA.ctl ? 'View · comment' : 'View only');
}

// ---------- top bar ----------
const TOOLS = [
  { t: 'move', icon: 'mouse-pointer-2', label: 'Move', k: 'V' },
  { t: 'frame', icon: 'frame', label: 'Frame', k: 'F' },
  { t: 'rect', icon: 'square', label: 'Rectangle', k: 'R' },
  { t: 'ellipse', icon: 'circle', label: 'Ellipse', k: 'O' },
  { t: 'line', icon: 'minus', label: 'Line', k: 'L' },
  { t: 'text', icon: 'type', label: 'Text', k: 'T' },
  { t: 'image', icon: 'image', label: 'Image', k: '⇧⌘K', act: () => pickImage() },
  { t: 'hand', icon: 'hand', label: 'Hand', k: 'H' },
  { t: 'feedback', icon: 'message-square-plus', label: 'Feedback', k: 'N' },
  { t: 'comment', icon: 'message-circle', label: 'Comment', k: 'C' },
];
function buildTopBar() {
  const tools = $('#tools'); tools.textContent = '';
  for (const t of TOOLS) {
    const b = h('button', { class: 'tb', 'data-tool': t.act ? null : t.t, title: `${t.label} (${t.k})`, 'aria-label': t.label, 'aria-pressed': t.act ? null : String(S.tool === t.t), onclick: () => (t.act ? t.act() : setTool(t.t)) }, ico(t.icon));
    if (['rect', 'ellipse', 'line', 'image', 'hand'].includes(t.t)) b.classList.add('wide-only');
    tools.append(b);
  }
  $('#bUndo').append(ico('undo-2')); $('#bUndo').onclick = undo;
  $('#bRedo').append(ico('redo-2')); $('#bRedo').onclick = redo;
  $('#bLeft').append(ico('layers')); $('#bRight').append(ico('sliders-horizontal'));
  $('#bLeft').onclick = () => { $('#app').classList.toggle('show-left'); $('#app').classList.remove('show-right'); };
  $('#bRight').onclick = () => { $('#app').classList.toggle('show-right'); $('#app').classList.remove('show-left'); };
  $('#bPlay').append(ico('play'), h('span', { class: 'wide-only', text: 'Present' }));
  $('#bPlay').onclick = () => openPresent();
  $('#bShare').onclick = openShare;
  $('#bShare').prepend(ico('users'));
  $('#bAddPage').append(ico('plus')); $('#bAddPage').onclick = addPage;
  $('#bZoom').onclick = e => menuAt(e.currentTarget, [
    { label: 'Zoom in', kbd: MOD + '+', act: () => zoomAt(view().z * 1.25) },
    { label: 'Zoom out', kbd: MOD + '−', act: () => zoomAt(view().z / 1.25) },
    { label: 'Zoom to fit', kbd: '⇧1', act: zoomFitAll },
    { label: 'Zoom to selection', kbd: '⇧2', act: zoomFitSel, disabled: !S.sel.length },
    { label: 'Zoom to 100%', kbd: '⇧0', act: () => zoomAt(1) },
    '-',
    { label: (S.grid ? 'Hide' : 'Show') + ' dot grid', act: () => { S.grid = !S.grid; lsSet('pinup.grid', S.grid); applyView(); } },
    { label: 'Keyboard shortcuts', kbd: '?', act: showShortcuts },
  ]);
  const fn = $('#fname');
  fn.addEventListener('keydown', e => { if (e.key === 'Enter') fn.blur(); if (e.key === 'Escape') { fn.value = S.file.name; fn.blur(); } e.stopPropagation(); });
  fn.addEventListener('change', () => { const v = fn.value.trim() || 'Untitled'; if (v !== S.file.name && S.canEdit) setFile({ name: v }, { label: 'Rename file' }); });
  const top = $('.top'); top.insertBefore(h('span', { id: 'saveState', class: 'wide-only', style: { color: 'var(--muted)', fontSize: '11px', whiteSpace: 'nowrap' } }), $('#avatars'));
  $$('[data-ltab]').forEach(b => b.onclick = () => setLTab(b.dataset.ltab));
  $$('[data-rtab]').forEach(b => b.onclick = () => setTab(b.dataset.rtab));
}
function setLTab(t) {
  S.ltab = t; lsSet('pinup.ltab', t);
  $$('[data-ltab]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.ltab === t)));
  $('#lLayers').style.display = t === 'layers' ? 'flex' : 'none';
  $('#lAssets').hidden = t !== 'assets'; $('#lFeedback').hidden = t !== 'feedback'; $('#lHistory').hidden = t !== 'history';
  if (t === 'assets') renderAssets(); if (t === 'feedback') renderFeedbackPanel(); if (t === 'history') renderHistory();
  updateTabCounts();
}
function setTab(t) {
  S.tab = t; $$('[data-rtab]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.rtab === t)));
  INSP.force = true; DIRTY.chrome = true; scheduleRender(); presenceSoon();
}
function pickImage() {
  if (!S.canEdit) return;
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  inp.onchange = () => { [...inp.files].forEach((f, i) => addImageFile(f, null, i * 24)); inp.remove(); };
  document.body.append(inp); inp.click();
}

// ---------- pages ----------
function renderPages() {
  const box = $('#pages'); box.textContent = '';
  for (const p of S.file.pages) {
    const row = h('div', { class: 'prow', 'aria-current': String(p.id === S.pageId), role: 'button', tabindex: 0,
      onclick: () => goPage(p.id),
      ondblclick: () => S.canEdit && renamePage(p.id, row),
      oncontextmenu: e => { e.preventDefault(); menu([
        { label: 'Rename', act: () => renamePage(p.id, row), disabled: !S.canEdit },
        { label: 'Duplicate page', act: () => duplicatePage(p.id), disabled: !S.canEdit },
        { label: 'Delete page', act: () => deletePage(p.id), disabled: !S.canEdit || S.file.pages.length < 2 },
      ], e.clientX, e.clientY); },
      onkeydown: e => { if (e.key === 'Enter') goPage(p.id); } },
      h('span', { style: { width: '12px', display: 'grid', placeItems: 'center', color: 'var(--sel)' } }, p.id === S.pageId ? ico('check') : null),
      h('span', { text: p.name, style: { overflow: 'hidden', textOverflow: 'ellipsis' } }),
      h('span', { class: 'grow' }), h('span', { text: String(roots(p.id).length || ''), style: { color: 'var(--faint)', fontSize: '11px' } }));
    const svgc = row.querySelector('svg'); if (svgc) { svgc.style.width = '12px'; svgc.style.height = '12px'; }
    box.append(row);
  }
}
function goPage(id, keepSel) {
  if (id === S.pageId) return;
  finishEdit();
  S.pageId = id; if (!keepSel) S.sel = []; S.hover = null;
  markAllDirty(); scheduleRender(); applyView(); presenceSoon();
  if (!S.views[id]) requestAnimationFrame(() => requestAnimationFrame(zoomFitAll));
}
function addPage() {
  if (!S.canEdit) return;
  const id = 'p' + uid(6); const pages = [...S.file.pages, { id, name: 'Page ' + (S.file.pages.length + 1) }];
  setFile({ pages }, { label: 'Add page' }); goPage(id);
  setTimeout(() => { const row = $$('#pages .prow').pop(); row && renamePage(id, row); }, 50);
}
function renamePage(id, row) {
  const p = S.file.pages.find(p => p.id === id); if (!p) return;
  const inp = h('input', { value: p.name });
  row.textContent = ''; row.append(inp); inp.focus(); inp.select();
  const done = ok => { const v = inp.value.trim(); if (ok && v && v !== p.name) setFile({ pages: S.file.pages.map(x => x.id === id ? Object.assign({}, x, { name: v }) : x) }, { label: 'Rename page' }); else renderPages(); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.onblur = null; done(false); } };
  inp.onblur = () => done(true);
}
function deletePage(id) {
  const n = roots(id).length;
  const go = () => txn('Delete page', () => {
    const all = [...S.nodes.values()].filter(x => x.page === id).map(x => x.id);
    commit(all.map(i => ({ id: i, after: null })), { label: 'Delete page' });
    const pages = S.file.pages.filter(p => p.id !== id); setFile({ pages }, { label: 'Delete page' });
    if (S.pageId === id) { S.pageId = pages[0].id; markAllDirty(); applyView(); }
  });
  if (!n) return go();
  const s = sheet('Delete page?', [h('p', { text: `“${pageName(id)}” has ${n} top-level layer${n === 1 ? '' : 's'}. You can undo this.` }), h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn primary', text: 'Delete page', onclick: () => { s.close(); go(); } }), h('button', { class: 'btn', text: 'Keep it', onclick: () => s.close() }))]);
}
function duplicatePage(id) {
  const nid = 'p' + uid(6);
  txn('Duplicate page', () => {
    const pages = S.file.pages.slice(); const i = pages.findIndex(p => p.id === id); pages.splice(i + 1, 0, { id: nid, name: pageName(id) + ' copy' });
    setFile({ pages });
    const map = new Map(); const nodes = [...S.nodes.values()].filter(n => n.page === id);
    nodes.forEach(n => map.set(n.id, uid()));
    commit(nodes.map(n => { const c = clone(n); c.id = map.get(n.id); c.page = nid; c.parent = n.parent ? map.get(n.parent) : null; if (c.link && map.has(c.link.to)) c.link.to = map.get(c.link.to); if (c.component) c.component = false; return { id: c.id, before: null, after: c }; }));
  });
  goPage(nid);
}

// ---------- layers tree ----------
const TYPE_ICON = { frame: 'hash', rect: 'square', ellipse: 'circle', line: 'minus', text: 'type', icon: 'star', svg: 'pen-tool', instance: 'diamond' };
function nodeIcon(n) {
  if (n.component) return 'component';
  if (n.type === 'frame' && n.group) return 'group';
  if (n.type === 'frame' && n.layout) return n.layout.dir === 'row' ? 'columns-3' : 'rows-3';
  if (n.type === 'rect' && (n.fills || []).some(f => f.t === 'image')) return 'image';
  return TYPE_ICON[n.type] || 'square';
}
const TREE = { drag: null };
function renderTree() {
  const box = $('#tree'); if (!box) return;
  const scroll = box.scrollTop;
  box.textContent = '';
  const selSet = new Set(S.sel);
  const rows = [];
  const walk = (list, depth) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      const ks = n.type === 'frame' ? kids(n.id) : [];
      const open = S.open.has(n.id);
      rows.push({ n, depth, has: ks.length > 0, open });
      if (ks.length && open) walk(ks, depth + 1);
    }
  };
  walk(roots(), 0);
  if (!rows.length) { box.append(h('div', { class: 'blank', text: 'No layers on this page yet.' })); return; }
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const n = r.n;
    const row = h('div', { class: 'lr' + (!n.parent && n.type === 'frame' && !n.group ? ' top-frame' : '') + (n.component || n.type === 'instance' ? ' comp' : '') + (!n.visible ? ' hidden' : ''), role: 'treeitem', 'aria-selected': String(selSet.has(n.id)), 'aria-expanded': r.has ? String(r.open) : null, 'data-id': n.id, style: { paddingLeft: (6 + r.depth * 14) + 'px' } },
      h('button', { class: 'tw', 'aria-label': r.open ? 'Collapse' : 'Expand', 'aria-expanded': String(r.open), style: { visibility: r.has ? 'visible' : 'hidden' }, onclick: e => { e.stopPropagation(); toggleOpen(n.id); } }, ico('chevron-right')),
      h('span', { class: 'ic' }, ico(nodeIcon(n))),
      h('span', { class: 'nm', text: n.name }),
      h('button', { class: 'tg' + (n.locked ? ' on' : ''), title: n.locked ? 'Unlock' : 'Lock', 'aria-label': n.locked ? 'Unlock' : 'Lock', onclick: e => { e.stopPropagation(); if (S.canEdit) patch(n.id, { locked: !n.locked }, { label: n.locked ? 'Unlock' : 'Lock' }); } }, ico(n.locked ? 'lock' : 'lock-open')),
      h('button', { class: 'tg' + (!n.visible ? ' on' : ''), title: n.visible ? 'Hide' : 'Show', 'aria-label': n.visible ? 'Hide' : 'Show', onclick: e => { e.stopPropagation(); if (S.canEdit) patch(n.id, { visible: !n.visible }, { label: n.visible ? 'Hide' : 'Show' }); } }, ico(n.visible ? 'eye' : 'eye-off')));
    frag.append(row);
  }
  box.append(frag);
  box.scrollTop = scroll;
}
function toggleOpen(id) { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); lsSet('pinup.open', [...S.open].slice(-300)); renderTree(); }
function bindTree() {
  const box = $('#tree');
  box.addEventListener('pointerdown', e => {
    const row = e.target.closest('.lr'); if (!row || e.target.closest('button') || e.button !== 0) return;
    const id = row.dataset.id;
    if (e.shiftKey && S.sel.length) {
      const rows = $$('.lr', box).map(r => r.dataset.id); const a = rows.indexOf(S.sel[S.sel.length - 1]), b = rows.indexOf(id);
      const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1); select([...new Set([...S.sel, ...range])]);
    } else if (modKey(e)) select(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]);
    else if (!S.sel.includes(id)) select([id]);
    if (S.canEdit) TREE.drag = { id, y: e.clientY, x: e.clientX, started: false, pid: e.pointerId };
  });
  box.addEventListener('dblclick', e => {
    const row = e.target.closest('.lr'); if (!row || e.target.closest('button')) return;
    if (e.target.closest('.nm')) renameRow(row.dataset.id); else { centerOn(row.dataset.id); }
  });
  box.addEventListener('contextmenu', e => { const row = e.target.closest('.lr'); if (!row) return; e.preventDefault(); if (!S.sel.includes(row.dataset.id)) select([row.dataset.id]); selectionMenu(e.clientX, e.clientY); });
  addEventListener('pointermove', e => {
    const d = TREE.drag; if (!d) return;
    if (!d.started && Math.abs(e.clientY - d.y) < 4) return;
    d.started = true;
    $$('.drop-line', box).forEach(x => x.remove()); $$('.drop-in', box).forEach(x => x.classList.remove('drop-in'));
    const row = document.elementFromPoint(e.clientX, e.clientY); const r = row && row.closest && row.closest('.lr');
    d.target = null;
    if (!r || !box.contains(r)) return;
    const tid = r.dataset.id; const t = get(tid);
    if (!t || S.sel.includes(tid) || S.sel.some(s => isAnc(s, tid))) return;
    const rr = r.getBoundingClientRect(); const rel = (e.clientY - rr.top) / rr.height;
    const canIn = t.type === 'frame' && !inComponentBlocked(tid);
    let mode = rel < 0.3 ? 'above' : rel > 0.7 ? 'below' : (canIn ? 'in' : rel < 0.5 ? 'above' : 'below');
    if (mode === 'in') r.classList.add('drop-in');
    else { const ln = h('div', { class: 'drop-line', style: { top: (r.offsetTop + (mode === 'above' ? 0 : rr.height) - 1) + 'px', left: r.style.paddingLeft } }); box.append(ln); }
    d.target = { id: tid, mode };
  });
  addEventListener('pointerup', () => {
    const d = TREE.drag; TREE.drag = null;
    $$('.drop-line', box).forEach(x => x.remove()); $$('.drop-in', box).forEach(x => x.classList.remove('drop-in'));
    if (!d || !d.started || !d.target) return;
    treeDrop(d.target);
  });
}
function inComponentBlocked(tid) { return S.sel.some(id => get(id).component && isAnc(id, tid)); }
function treeDrop(tg) {
  const t = get(tg.id); const ids = selRoots();
  let parent, list;
  // layers panel lists top-most first, so "above" a row means a higher z
  if (tg.mode === 'in') { parent = t.id; list = kids(t.id).filter(k => !ids.includes(k.id)); list = [...list, ...ids.map(get)]; }
  else {
    parent = t.parent; list = (parent ? kids(parent) : roots(t.page)).filter(k => !ids.includes(k.id));
    const i = list.findIndex(k => k.id === t.id);
    list.splice(tg.mode === 'above' ? i + 1 : i, 0, ...ids.map(get));
  }
  const P = parent ? get(parent) : null;
  const ch = [];
  list.forEach((k, i) => {
    const moving = ids.includes(k.id);
    if (!moving && k.z === i) return;
    const nn = Object.assign({}, k, { z: i });
    if (moving && k.parent !== parent) {
      const r = wrect(k.id), pr = P ? wrect(P.id) : { x: 0, y: 0 };
      nn.parent = parent; nn.page = t.page; nn.x = Math.round(r.x - pr.x); nn.y = Math.round(r.y - pr.y);
      if (inLayout(k) && !(P && P.layout)) { nn.w = Math.round(r.w); nn.h = Math.round(r.h); if (nn.sw === 'fill') nn.sw = 'fixed'; if (nn.sh === 'fill') nn.sh = 'fixed'; }
      nn.abs = false;
    }
    ch.push({ id: k.id, after: nn });
  });
  commit(ch, { label: 'Move layers' });
  if (P) S.open.add(P.id);
}
function renameRow(id) {
  if (!S.canEdit) return;
  const row = $(`#tree [data-id="${id}"] .nm`); if (!row) return;
  const n = get(id); const inp = h('input', { value: n.name }); row.textContent = ''; row.append(inp); inp.focus(); inp.select();
  const done = ok => { if (!inp.isConnected) return; const v = inp.value.trim(); if (ok && v && v !== n.name) patch(id, { name: v }, { label: 'Rename' }); else renderTree(); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); if (e.key === 'Tab') { e.preventDefault(); done(true); } };
  inp.onblur = () => done(true);
  inp.onpointerdown = e => e.stopPropagation();
}

// ---------- assets ----------
let iconQuery = '', iconLimit = 160;
function renderAssets() {
  const box = $('#lAssets'); if (!box || box.hidden) return;
  const keepFocus = document.activeElement && box.contains(document.activeElement) && document.activeElement.classList.contains('search');
  box.textContent = '';
  const wrap = h('div', { class: 'assets' });
  // components
  const comps = components();
  wrap.append(h('div', { class: 'hd', style: { padding: '10px 0 6px' } }, 'Components', h('span', { class: 'grow' }), h('span', { text: String(comps.length || ''), style: { color: 'var(--faint)' } })));
  if (!comps.length) wrap.append(h('p', { class: 'note', style: { color: 'var(--muted)', margin: '0 0 8px', lineHeight: '1.45' }, text: `Select a frame and press ${MOD.replace('+', '')}⌥K to make it a component. Instances update when the main changes.` }));
  const grid = h('div', { class: 'agrid' });
  for (const c of comps) {
    const th = h('div', { class: 'th tokroot m-light' });
    const card = h('button', { class: 'acard', title: `Insert ${c.name} · drag onto the canvas`, onclick: () => { if (!S.canEdit) return; if (get(c.id)) insertInstance(c.id); } }, th, h('b', { text: c.name }));
    card.addEventListener('pointerdown', e => assetDragStart(e, { kind: 'comp', id: c.id }));
    try {
      const el = buildEl(Object.assign({}, c, { x: 0, y: 0 }), null, { mode: 'static', depth: 0, root: true });
      const r = wrect(c.id) || c;
      if (el) { const k = Math.min(1, 84 / Math.max(1, r.w), 52 / Math.max(1, r.h)); const holder = h('div', { style: { position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${k})`, width: r.w + 'px', height: r.h + 'px', pointerEvents: 'none' } }, el); th.append(holder); }
    } catch {}
    grid.append(card);
  }
  wrap.append(grid);
  // colour tokens
  const C = S.file.tokens.colors || {};
  wrap.append(h('div', { class: 'hd', style: { padding: '16px 0 6px' } }, 'Colour tokens', h('span', { class: 'grow' }), S.canEdit ? h('button', { class: 'ib', title: 'Add colour token', 'aria-label': 'Add colour token', onclick: addColorToken }, ico('plus')) : null));
  if (!Object.keys(C).length) wrap.append(h('p', { style: { color: 'var(--muted)', margin: '0 0 8px', lineHeight: '1.45' }, text: 'Tokens keep colours consistent and give each one a light and a dark value. Frames switch with the Mode setting.' }));
  for (const id in C) wrap.append(colorTokenRow(id, C[id]));
  // text styles
  const T = S.file.tokens.type || {};
  wrap.append(h('div', { class: 'hd', style: { padding: '16px 0 6px' } }, 'Text styles', h('span', { class: 'grow' }), S.canEdit ? h('button', { class: 'ib', title: 'Add text style from selection', 'aria-label': 'Add text style', onclick: addTextStyle }, ico('plus')) : null));
  if (!Object.keys(T).length) wrap.append(h('p', { style: { color: 'var(--muted)', margin: '0 0 8px', lineHeight: '1.45' }, text: 'Select a text layer and press + to save its type as a style.' }));
  for (const id in T) {
    const t = T[id]; ensureFont(t.font);
    wrap.append(h('div', { class: 'tok', style: { gridTemplateColumns: 'minmax(0,1fr) auto', height: 'auto', padding: '4px 0' } },
      h('button', { style: { all: 'unset', cursor: 'pointer', display: 'grid', gap: '2px', minWidth: 0 }, title: 'Apply to selected text', onclick: () => applyTextStyle(id) },
        h('span', { text: t.name, style: { fontFamily: fontStack(t.font), fontWeight: t.weight, fontSize: Math.min(22, t.size) + 'px', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
        h('span', { class: 'mono', text: `${t.font} · ${t.size}/${t.lh <= 4 ? t.lh : t.lh + 'px'} · ${t.weight}`, style: { color: 'var(--muted)', fontSize: '10.5px' } })),
      S.canEdit ? h('button', { class: 'tb', style: { width: '24px', height: '24px' }, title: 'Delete style', 'aria-label': 'Delete style', onclick: () => { const ty = clone(S.file.tokens.type); delete ty[id]; setFile({ tokens: Object.assign({}, S.file.tokens, { type: ty }) }, { label: 'Delete text style' }); } }, ico('trash-2')) : null));
  }
  // icons
  wrap.append(h('div', { class: 'hd', style: { padding: '16px 0 6px' } }, 'Icons', h('span', { class: 'grow' }), h('span', { text: 'Lucide', style: { color: 'var(--faint)' } })));
  const search = h('input', { class: 'search', placeholder: `Search ${ICON_NAMES.length} icons`, value: iconQuery, 'aria-label': 'Search icons', oninput: e => { iconQuery = e.target.value; iconLimit = 160; renderIconGrid(ig); } });
  search.addEventListener('keydown', e => e.stopPropagation());
  const ig = h('div', { class: 'icon-grid' });
  wrap.append(search, ig);
  renderIconGrid(ig);
  box.append(wrap);
  if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}
function renderIconGrid(ig) {
  ig.textContent = '';
  const q = iconQuery.trim().toLowerCase();
  const list = q ? ICON_NAMES.filter(n => n.includes(q)) : ICON_NAMES;
  for (const name of list.slice(0, iconLimit)) {
    const b = h('button', { title: name, 'aria-label': 'Insert icon ' + name, onclick: () => insertIcon(name) }, ico(name));
    b.addEventListener('pointerdown', e => assetDragStart(e, { kind: 'icon', name }));
    ig.append(b);
  }
  if (list.length > iconLimit) ig.append(h('button', { style: { gridColumn: '1/-1', fontSize: '11px' }, text: `Show more (${list.length - iconLimit})`, onclick: () => { iconLimit += 320; renderIconGrid(ig); } }));
  if (!list.length) ig.append(h('div', { style: { gridColumn: '1/-1', color: 'var(--muted)', padding: '8px 0' }, text: 'No icon by that name.' }));
}
function insertIcon(name, at) {
  if (!S.canEdit) return;
  const s = S.sel.length === 1 ? get(S.sel[0]) : null;
  if (s && s.type === 'icon' && !at) { patch(s.id, { icon: name, svg: iconMarkup(name), name }, { label: 'Swap icon' }); return; }
  const target = at ? at.parent : (s && s.type === 'frame' && !s.group ? s.id : null);
  const c = viewCenter(); const id = uid();
  commit([{ id, before: null, after: { id, type: 'icon', icon: name, svg: iconMarkup(name), name, page: S.pageId, parent: target, z: nextZ(target || 'page:' + S.pageId), x: at ? at.x : (target ? 16 : Math.round(c.x - 12)), y: at ? at.y : (target ? 16 : Math.round(c.y - 12)), w: 24, h: 24, fills: [{ t: 'solid', c: defaultInk(target) }], iw: 2 } }], { label: 'Insert icon' });
  select([id]);
}
// drag an asset onto the canvas
function assetDragStart(e, what) {
  if (!S.canEdit || e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY; let ghost = null;
  const mv = ev => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    if (!ghost) { ghost = h('div', { style: { position: 'fixed', zIndex: 90, pointerEvents: 'none', padding: '4px 8px', borderRadius: '6px', background: 'var(--sel)', color: '#fff', font: '600 11px Arial' }, text: what.kind === 'comp' ? get(what.id).name : what.name }); document.body.append(ghost); }
    ghost.style.left = ev.clientX + 10 + 'px'; ghost.style.top = ev.clientY + 10 + 'px';
    const over = $('#stage').contains(document.elementFromPoint(ev.clientX, ev.clientY));
    OV.drop = over ? frameAt(ev.clientX, ev.clientY, false, id => get(id).group || inComponentBlockedId(what, id)) : null; drawOverlaySoon();
  };
  const up = ev => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!ghost) return; ghost.remove(); OV.drop = null;
    if (!$('#stage').contains(document.elementFromPoint(ev.clientX, ev.clientY))) { drawOverlay(); return; }
    const parent = frameAt(ev.clientX, ev.clientY, false, id => get(id).group || inComponentBlockedId(what, id));
    const w = toWorld(ev.clientX, ev.clientY); const pr = parent ? wrect(parent) : { x: 0, y: 0 };
    if (what.kind === 'comp') { const m = get(what.id); insertInstance(what.id, { parent, x: Math.round(w.x - pr.x - m.w / 2), y: Math.round(w.y - pr.y - m.h / 2) }); }
    else insertIcon(what.name, { parent, x: Math.round(w.x - pr.x - 12), y: Math.round(w.y - pr.y - 12) });
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function inComponentBlockedId(what, id) { return what.kind === 'comp' && (id === what.id || isAnc(what.id, id)); }
function colorTokenRow(id, t) {
  const upd = p => { const C = clone(S.file.tokens.colors); C[id] = Object.assign({}, C[id], p); setFile({ tokens: Object.assign({}, S.file.tokens, { colors: C }) }, { label: 'Edit token', coalesce: 'tok' + id }); };
  const swatch = (k) => {
    const b = h('span', { class: 'sw', style: { background: t[k] || t.light, position: 'relative', overflow: 'hidden', cursor: S.canEdit ? 'pointer' : 'default' }, title: k === 'light' ? 'Light value' : 'Dark value' });
    if (S.canEdit) { const ci = h('input', { type: 'color', value: (normHex(t[k] || t.light) || '#000000').toLowerCase(), style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' } }); ci.oninput = () => upd({ [k]: ci.value.toUpperCase() }); b.append(ci); }
    return b;
  };
  const name = h('input', { value: t.name, readOnly: !S.canEdit, 'aria-label': 'Token name', onchange: e => upd({ name: e.target.value.trim() || t.name }) });
  name.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); };
  const row = h('div', { class: 'tok', style: { gridTemplateColumns: '20px 20px minmax(0,1fr) auto' } }, swatch('light'), swatch('dark'), name,
    h('button', { class: 'tb', style: { width: '24px', height: '24px' }, title: 'More', 'aria-label': 'Token options', onclick: e => menuAt(e.currentTarget, [
      { label: 'Apply as fill', act: () => applyTokenFill(id), disabled: !S.sel.length || !S.canEdit },
      { label: 'Edit values…', act: () => editTokenValues(id), disabled: !S.canEdit },
      { label: 'Delete token', act: () => { const C = clone(S.file.tokens.colors); const v = C[id]; delete C[id]; txn('Delete token', () => { setFile({ tokens: Object.assign({}, S.file.tokens, { colors: C }) }); detachTokenEverywhere(id, v); }); }, disabled: !S.canEdit },
    ]) }, ico('ellipsis')));
  return row;
}
function editTokenValues(id) {
  const t = S.file.tokens.colors[id]; if (!t) return;
  const L = h('input', { class: 'sel mono', value: t.light }), D = h('input', { class: 'sel mono', value: t.dark || t.light }), N = h('input', { class: 'sel', value: t.name });
  const s = sheet('Colour token', [h('div', { class: 'stack' }, h('label', { text: 'Name' }), N, h('label', { text: 'Light mode' }), L, h('label', { text: 'Dark mode' }), D,
    h('p', { class: 'mono', style: { color: 'var(--muted)', fontSize: '11px' }, text: 'CSS: var(--' + slug(t.name) + ')' }),
    h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn primary', text: 'Save', onclick: () => {
      const l = normHex(L.value), d = normHex(D.value); if (!l || !d) { toast('Use colours like #1A1A1A'); return; }
      const C = clone(S.file.tokens.colors); C[id] = { name: N.value.trim() || t.name, light: l, dark: d }; setFile({ tokens: Object.assign({}, S.file.tokens, { colors: C }) }, { label: 'Edit token' }); s.close(); } }))) ], { width: 380 });
}
function addColorToken() {
  const s = S.sel.length ? get(S.sel[0]) : null;
  const f = s && (s.fills || []).find(f => f.t === 'solid' && f.c && f.c[0] !== '$');
  const base = f ? normHex(f.c) : '#2B59FF';
  const used = new Set(Object.keys(S.file.tokens.colors));
  let name = 'Color ' + (used.size + 1), id = slug(name); while (used.has(id)) id += '-2';
  const C = Object.assign({}, S.file.tokens.colors, { [id]: { name, light: base, dark: base } });
  txn('Add token', () => { setFile({ tokens: Object.assign({}, S.file.tokens, { colors: C }) }); if (f) applyTokenFill(id); });
  setTimeout(() => editTokenValues(id), 30);
}
function applyTokenFill(id) {
  const ids = S.sel; if (!ids.length) return;
  patchMany(ids.map(i => { const n = get(i); const fills = (n.fills || []).slice(); const k = fills.findIndex(f => f.t === 'solid'); if (k >= 0) fills[k] = Object.assign({}, fills[k], { c: '$' + id }); else fills.push({ t: 'solid', c: '$' + id }); return [i, { fills }]; }), { label: 'Apply token' });
}
function detachTokenEverywhere(id, val) {
  const ch = [];
  for (const n of S.nodes.values()) {
    let dirty = false; const nn = clone(n);
    (nn.fills || []).forEach(f => { if (f.c === '$' + id) { f.c = val.light; dirty = true; } });
    if (nn.stroke && nn.stroke.c === '$' + id) { nn.stroke.c = val.light; dirty = true; }
    if (dirty) ch.push({ id: n.id, after: nn });
  }
  if (ch.length) commit(ch);
}
function addTextStyle() {
  const n = S.sel.map(get).find(n => n && n.type === 'text');
  if (!n) { toast('Select a text layer first'); return; }
  const T = S.file.tokens.type || {};
  const name = n.size >= 32 ? 'Display' : n.size >= 22 ? 'Title' : n.size >= 15 ? 'Body' : 'Caption';
  let id = slug(name); while (T[id]) id += '-2';
  const ty = Object.assign({}, T, { [id]: { name: name + (T[slug(name)] ? ' 2' : ''), font: n.font, size: n.size, weight: n.weight, lh: n.lh, ls: n.ls } });
  txn('Add text style', () => { setFile({ tokens: Object.assign({}, S.file.tokens, { type: ty }) }); patch(n.id, { tstyle: id }); });
}
function applyTextStyle(id) {
  const ids = S.sel.filter(i => get(i) && get(i).type === 'text'); if (!ids.length || !S.canEdit) { toast('Select text layers to apply a style'); return; }
  const t = S.file.tokens.type[id];
  patchMany(ids.map(i => [i, { tstyle: id, font: t.font, size: t.size, weight: t.weight, lh: t.lh, ls: t.ls }]), { label: 'Apply text style' });
}

// ---------- empty state ----------
function renderEmpty() {
  const box = $('#empty');
  const empty = S.loaded && roots().length === 0;
  box.hidden = !empty;
  if (!empty) return;
  box.textContent = '';
  const anyNodes = S.nodes.size > 0;
  const card = h('div', null,
    h('h2', { text: anyNodes ? 'This page is empty' : 'Start a design' }),
    h('p', { text: S.canEdit ? 'Add a screen, start from a small example app, or describe what you want and let Claude draft it as editable layers.' : 'Nothing on this page yet. You can view, present and comment once there is.' }));
  if (S.canEdit) {
    card.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => addFrame(PRESETS[0]) }, ico('smartphone'), 'Phone screen'),
      h('button', { class: 'btn', onclick: () => addFrame(PRESETS[6]) }, ico('monitor'), 'Desktop screen'),
      h('button', { class: 'btn', onclick: () => { setTool('frame'); toast('Drag on the canvas to draw a frame'); } }, ico('frame'), 'Draw a frame')));
    const row2 = h('div', { class: 'row' });
    if (!anyNodes) row2.append(h('button', { class: 'btn primary', onclick: () => loadExample() }, ico('sparkles'), 'Start with an example app'));
    if (SAMPLE.fn) row2.append(h('button', { class: 'btn', onclick: () => { $('#ask').classList.remove('min'); $('#askIn').focus(); } }, ico('message-square'), 'Ask Claude'));
    card.append(row2);
  }
  box.append(card);
}

// ---------- inspector ----------
const INSP = { force: false, pending: false, key: '' };
function renderInspector() {
  const box = $('#insp'); if (!box) return;
  const key = S.tab + '|' + S.sel.join(',') + '|' + S.pageId + '|' + S.tool;
  const a = document.activeElement;
  if (key === INSP.key && !INSP.force && box.contains(a) && a.matches('input:not([type=checkbox]):not([type=color]),textarea')) { INSP.pending = true; return; }
  INSP.key = key; INSP.force = false; INSP.pending = false;
  const scroll = box.scrollTop;
  const focusK = a && box.contains(a) && a.dataset && a.dataset.k;
  box.textContent = '';
  const out = S.tab === 'proto' ? protoPanel() : S.tab === 'inspect' ? inspectPanel() : designPanel();
  add(box, [out]);
  box.scrollTop = scroll;
  if (focusK) { const f = box.querySelector(`[data-k="${focusK}"]`); f && f.focus(); }
}
function bindInspector() {
  const box = $('#insp');
  box.addEventListener('focusout', () => setTimeout(() => { if (INSP.pending && !box.contains(document.activeElement)) { INSP.force = true; renderInspector(); } }, 0));
  box.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); else { e.target.blur && e.target.blur(); $('#stage').focus(); } });
}
// field helpers
function sec(title, actions, ...body) { return h('div', { class: 'sec' }, h('h3', null, h('span', { text: title }), h('span', { class: 'grow' }), actions || null), ...body); }
function ib(icon, title, act, opts = {}) { return h('button', { class: 'ib', title, 'aria-label': title, disabled: opts.disabled || !S.canEdit, onclick: act, style: opts.style }, ico(icon)); }
function numField(label, value, onSet, o = {}) {
  const inp = h('input', { value: value === 'mixed' ? '' : fmt(value), placeholder: value === 'mixed' ? 'Mixed' : (o.ph || ''), 'aria-label': o.aria || label, inputmode: 'decimal', disabled: !S.canEdit || o.disabled, 'data-k': o.k || label });
  const set = (v, coalesce) => { if (v == null || !Number.isFinite(v)) { inp.value = value === 'mixed' ? '' : fmt(value); return; } if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); onSet(o.int === false ? v : (o.dec ? rnd(v, o.dec) : Math.round(v)), coalesce); };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { set(evalNum(inp.value, value === 'mixed' ? 0 : value, o.base)); inp.select(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const cur = evalNum(inp.value, 0) ?? (value === 'mixed' ? 0 : value) ?? 0; const step = (o.step || 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1); const v = rnd(cur + step, 3); inp.value = fmt(v); set(v, 'arrow-' + label); }
  });
  inp.addEventListener('change', () => set(evalNum(inp.value, value === 'mixed' ? 0 : value, o.base)));
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  const lab = h('span', { class: o.wideLabel ? 'wide' : '', title: o.title || label }, o.icon ? ico(o.icon) : label);
  const lsvg = lab.querySelector('svg'); if (lsvg) { lsvg.style.width = '12px'; lsvg.style.height = '12px'; lsvg.style.verticalAlign = '-2px'; }
  // scrub by dragging the label
  if (S.canEdit && !o.disabled) lab.addEventListener('pointerdown', e => {
    e.preventDefault(); const sx = e.clientX; const v0 = value === 'mixed' ? 0 : +value || 0; let moved = false;
    lab.setPointerCapture(e.pointerId);
    const mv = ev => { const d = ev.clientX - sx; if (!moved && Math.abs(d) < 2) return; moved = true; const v = v0 + Math.round(d / 2) * (o.step || 1) * (ev.shiftKey ? 10 : 1); inp.value = fmt(v); set(v, 'scrub-' + label); };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
  });
  return h('label', { class: 'nf' }, lab, inp, o.suffix ? h('span', { text: o.suffix, style: { width: 'auto', paddingRight: '8px' } }) : null);
}
function segm(opts, value, onSet, o = {}) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': o.aria || '' }, opts.map(op => h('button', { 'aria-pressed': String(value === op.v), title: op.title || op.label || op.v, 'aria-label': op.title || op.label || op.v, disabled: !S.canEdit || op.disabled, onclick: () => onSet(op.v) }, op.icon ? ico(op.icon) : op.label)));
}
function selField(opts, value, onSet, o = {}) {
  const s = h('select', { class: 'sel', disabled: !S.canEdit || o.disabled, 'aria-label': o.aria || '', 'data-k': o.k });
  for (const op of opts) { if (op.group) { const g = h('optgroup', { label: op.group }); op.items.forEach(it => g.append(h('option', { value: it.v, text: it.label, selected: it.v === value }))); s.append(g); } else s.append(h('option', { value: op.v, text: op.label, selected: op.v === value })); }
  if (value === 'mixed') s.prepend(h('option', { value: '', text: 'Mixed', selected: true, disabled: true }));
  s.onchange = () => onSet(s.value);
  return s;
}
function commonVal(nodes, f) { if (!nodes.length) return null; const v0 = f(nodes[0]); for (const n of nodes) if (!same(f(n), v0)) return 'mixed'; return v0; }
function applySel(fn, label, coalesce) {
  const ids = S.sel.filter(id => get(id));
  commit(ids.map(id => { const n = get(id); const p = fn(n); return p ? { id, after: Object.assign({}, n, p) } : null; }).filter(Boolean), { label, coalesce });
}

function designPanel() {
  const ns = selNodes().filter(n => n.page === S.pageId || true);
  if (!ns.length) return designEmpty();
  const n = ns[0];
  const out = [];
  const single = ns.length === 1;
  // header
  const typeLabel = single ? (n.component ? 'Component' : n.type === 'instance' ? 'Instance' : n.group ? 'Group' : n.type === 'frame' ? (n.parent ? 'Frame' : 'Screen') : n.type === 'rect' && n.fills.some(f => f.t === 'image') ? 'Image' : n.type[0].toUpperCase() + n.type.slice(1)) : `${ns.length} layers`;
  const head = h('div', { class: 'sec', style: { display: 'grid', gap: '8px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } }, h('span', { style: { color: n.component || n.type === 'instance' ? '#8A4FFF' : 'var(--muted)', display: 'grid' } }, ico(single ? nodeIcon(n) : 'layers')),
      h('b', { text: single ? n.name : typeLabel, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }),
      h('span', { text: single ? typeLabel : '', style: { color: 'var(--muted)', fontSize: '11px' } })));
  if (S.canEdit) {
    const acts = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    if (single && n.type === 'instance') acts.append(h('button', { class: 'btn sm', onclick: () => goToMain(n.of) }, 'Go to main'), h('button', { class: 'btn sm', onclick: detachInstance }, 'Detach'), Object.keys(n.ov || {}).length ? h('button', { class: 'btn sm', onclick: () => patch(n.id, { ov: {} }, { label: 'Reset overrides' }) }, 'Reset') : null);
    else if (single && n.component) acts.append(h('button', { class: 'btn sm', onclick: () => insertInstance(n.id) }, 'Insert instance'), h('span', { style: { color: 'var(--muted)', fontSize: '11px', alignSelf: 'center' }, text: countInstances(n.id) + ' instances' }));
    else if (ns.some(x => x.type === 'frame' || ns.length > 1)) acts.append(h('button', { class: 'btn sm', title: `Create component (${MOD}⌥K)`, onclick: makeComponent }, ico('component'), 'Make component'));
    if (acts.childNodes.length) head.append(acts);
  }
  out.push(head);
  // align
  if (S.canEdit && (ns.length > 1 || (single && n.parent && !inLayout(n)))) {
    out.push(h('div', { class: 'sec', style: { padding: '8px 12px' } }, h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap' } },
      ...[['left', 'align-horizontal-justify-start'], ['hcenter', 'align-horizontal-justify-center'], ['right', 'align-horizontal-justify-end'], ['top', 'align-vertical-justify-start'], ['vcenter', 'align-vertical-justify-center'], ['bottom', 'align-vertical-justify-end']].map(([k, ic]) => h('button', { class: 'tb', title: 'Align ' + k, 'aria-label': 'Align ' + k, onclick: () => alignSel(k) }, ico(ic))),
      h('span', { class: 'grow' }),
      h('button', { class: 'tb', title: 'Distribute horizontal spacing', 'aria-label': 'Distribute horizontally', disabled: ns.length < 3, onclick: () => distribute('h') }, ico('align-horizontal-space-around')),
      h('button', { class: 'tb', title: 'Distribute vertical spacing', 'aria-label': 'Distribute vertically', disabled: ns.length < 3, onclick: () => distribute('v') }, ico('align-vertical-space-around')))));
  }
  // screen / frame
  if (single && n.type === 'frame' && !n.group) {
    const rows = [];
    if (!n.parent) rows.push(selField([{ v: '', label: 'Resize to device…' }, ...['Phone', 'Tablet', 'Desktop', 'Other'].map(g => ({ group: g, items: PRESETS.filter(p => p.group === g).map(p => ({ v: p.name, label: `${p.name}  ${p.w}×${p.h}` })) }))], '', v => { const p = PRESETS.find(p => p.name === v); if (p) patch(n.id, { w: p.w, h: p.h, sw: 'fixed', sh: 'fixed' }, { label: 'Resize frame' }); }, { aria: 'Device size' }));
    rows.push(h('div', { class: 'g2' },
      segm([{ v: 'light', label: 'Light', title: 'Light token mode' }, { v: 'dark', label: 'Dark', title: 'Dark token mode' }], n.mode || (n.parent ? modeOf(n.parent) : 'light'), v => patch(n.id, { mode: v }, { label: 'Mode' }), { aria: 'Token mode' }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!n.clip, disabled: !S.canEdit, onchange: e => patch(n.id, { clip: e.target.checked }, { label: 'Clip content' }) }), 'Clip content')));
    out.push(sec(n.parent ? 'Frame' : 'Screen', null, h('div', { class: 'stack' }, rows)));
  }
  // position & size
  {
    const rs = ns.map(x => lrect(x.id) || x);
    const lay = ns.every(inLayout);
    const pos = h('div', { class: 'stack' });
    const vx = commonVal(ns.map((x, i) => ({ v: Math.round(rs[i].x) })), o => o.v), vy = commonVal(ns.map((x, i) => ({ v: Math.round(rs[i].y) })), o => o.v);
    const vw = commonVal(ns.map((x, i) => ({ v: rnd(rs[i].w, 1) })), o => o.v), vh = commonVal(ns.map((x, i) => ({ v: rnd(rs[i].h, 1) })), o => o.v);
    pos.append(h('div', { class: 'g2' },
      numField('X', vx, (v, c) => applySel(x => inLayout(x) ? null : { x: v }, 'Move', c || 'x'), { disabled: lay, title: lay ? 'Set by auto layout' : 'X' }),
      numField('Y', vy, (v, c) => applySel(x => inLayout(x) ? null : { y: v }, 'Move', c || 'y'), { disabled: lay, title: lay ? 'Set by auto layout' : 'Y' })));
    pos.append(h('div', { class: 'g2' },
      numField('W', vw, (v, c) => applySel(x => ({ w: Math.max(1, v), sw: x.sw === 'hug' || x.sw === 'fill' ? 'fixed' : x.sw }), 'Resize', c || 'w'), { min: 1, int: false, dec: 1 }),
      numField('H', vh, (v, c) => applySel(x => x.type === 'line' ? null : ({ h: Math.max(1, v), sh: x.sh === 'hug' || x.sh === 'fill' ? 'fixed' : x.sh }), 'Resize', c || 'h'), { min: 1, int: false, dec: 1, disabled: single && n.type === 'line' })));
    // sizing modes
    const canHug = x => x.type === 'text' || (x.type === 'frame' && !!x.layout) || (x.type === 'instance' && get(x.of) && !!get(x.of).layout);
    const canFill = x => inLayout(x);
    if (ns.some(x => canHug(x) || canFill(x))) {
      const sizing = (k, label) => segm([{ v: 'fixed', label: 'Fixed' }, { v: 'hug', label: 'Hug', disabled: !ns.every(canHug) }, { v: 'fill', label: 'Fill', disabled: !ns.every(canFill) }], commonVal(ns, x => x[k]), v => applySel(x => {
        const p = { [k]: v }; if (v === 'fixed') { const r = lrect(x.id); if (r) p[k === 'sw' ? 'w' : 'h'] = Math.round(k === 'sw' ? r.w : r.h); } return p;
      }, 'Sizing'), { aria: label });
      pos.append(h('div', { class: 'g2' }, h('div', { class: 'stack', style: { gap: '2px' } }, h('span', { text: 'Width', style: { color: 'var(--muted)', fontSize: '10.5px' } }), sizing('sw', 'Width sizing')), h('div', { class: 'stack', style: { gap: '2px' } }, h('span', { text: 'Height', style: { color: 'var(--muted)', fontSize: '10.5px' } }), sizing('sh', 'Height sizing'))));
    }
    const vr = commonVal(ns, x => x.rot || 0);
    const rad = commonVal(ns, x => Array.isArray(x.radius) ? 'mixed' : (x.radius || 0));
    const showRad = ns.every(x => ['frame', 'rect', 'instance', 'svg'].includes(x.type));
    pos.append(h('div', { class: 'g2' },
      numField('°', vr, (v, c) => applySel(() => ({ rot: ((v % 360) + 360) % 360 > 180 ? ((v % 360) + 360) % 360 - 360 : ((v % 360) + 360) % 360 }), 'Rotate', c || 'rot'), { title: 'Rotation', icon: 'rotate-cw', dec: 1, int: false }),
      showRad ? numField('R', rad, (v, c) => applySel(() => ({ radius: Math.max(0, v) }), 'Radius', c || 'radius'), { min: 0, icon: 'radius', title: 'Corner radius' }) : h('span')));
    if (single && showRad && Array.isArray(n.radius)) pos.append(h('div', { class: 'g4' }, ...[0, 1, 2, 3].map(i => numField(['↖', '↗', '↘', '↙'][i], n.radius[i] || 0, (v, c) => { const r = n.radius.slice(); r[i] = Math.max(0, v); patch(n.id, { radius: r }, { label: 'Radius', coalesce: c || 'rad' + i }); }, { k: 'rad' + i }))));
    if (single && showRad) pos.append(h('button', { class: 'btn ghost sm', style: { justifySelf: 'start' }, disabled: !S.canEdit, onclick: () => patch(n.id, { radius: Array.isArray(n.radius) ? (n.radius[0] || 0) : [n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0] }, { label: 'Radius' }) }, Array.isArray(n.radius) ? 'Same corners' : 'Independent corners'));
    if (ns.some(x => x.parent && get(x.parent) && get(x.parent).layout)) pos.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', disabled: !S.canEdit, checked: ns.every(x => x.abs), onchange: e => applySel(x => { const r = lrect(x.id); return e.target.checked ? { abs: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } : { abs: false }; }, 'Absolute position') }), 'Ignore auto layout (absolute)'));
    out.push(sec('Layout', null, pos));
  }
  // auto layout
  if (single && n.type === 'frame' && !n.group) out.push(autoLayoutSec(n));
  if (single && n.type === 'instance') out.push(instanceSec(n));
  if (ns.every(x => x.type === 'text')) out.push(textSec(ns));
  if (single && n.type === 'icon') out.push(iconSec(n));
  // appearance
  out.push(sec('Appearance', null, h('div', { class: 'g2' },
    numField('%', commonVal(ns, x => Math.round(x.opacity * 100)), (v, c) => applySel(() => ({ opacity: clamp(v, 0, 100) / 100 }), 'Opacity', c || 'op'), { min: 0, max: 100, icon: 'blend', title: 'Opacity', suffix: '%' }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', disabled: !S.canEdit, checked: ns.every(x => x.visible), onchange: e => applySel(() => ({ visible: e.target.checked }), 'Visibility') }), 'Visible'))));
  if (!ns.some(x => x.type === 'line' || x.type === 'svg' || x.type === 'instance')) out.push(fillSec(ns));
  if (!ns.some(x => x.type === 'text' || x.type === 'icon' || x.type === 'svg')) out.push(strokeSec(ns));
  if (!ns.some(x => x.type === 'line')) out.push(effectsSec(ns));
  out.push(exportSec(ns));
  return out;
}
function countInstances(mid) { let c = 0; for (const n of S.nodes.values()) if (n.type === 'instance' && n.of === mid) c++; return c; }
function goToMain(mid) { const m = get(mid); if (!m) return toast('The main component is missing.'); if (m.page !== S.pageId) goPage(m.page, true); select([mid], { reveal: true }); requestAnimationFrame(() => requestAnimationFrame(() => centerOn(mid))); }

function designEmpty() {
  const out = [];
  out.push(sec('Add a screen', null, h('div', { class: 'stack' }, ...['Phone', 'Tablet', 'Desktop', 'Other'].map(g => h('div', null,
    h('div', { text: g, style: { color: 'var(--muted)', fontSize: '10.5px', margin: '4px 0' } }),
    h('div', { style: { display: 'grid', gap: '2px' } }, ...PRESETS.filter(p => p.group === g).map(p => h('button', { class: 'prow', style: { border: 0, background: 'transparent', width: '100%', textAlign: 'left' }, disabled: !S.canEdit, onclick: () => addFrame(p) }, h('span', { text: p.name }), h('span', { class: 'grow' }), h('span', { class: 'mono', text: `${p.w}×${p.h}`, style: { color: 'var(--faint)', fontSize: '11px' } })))))))));
  out.push(sec('Tips', null, h('div', { class: 'tips' },
    h('span', { class: 'kbd', text: 'F' }), h('span', { text: 'Draw a frame; click inside one to nest' }),
    h('span', { class: 'kbd', text: '⇧A' }), h('span', { text: 'Auto layout on a frame or selection' }),
    h('span', { class: 'kbd', text: MOD.replace('+', '') + 'D' }), h('span', { text: 'Duplicate; ⌥-drag also duplicates' }),
    h('span', { class: 'kbd', text: '⌥' }), h('span', { text: 'Hold over a layer to measure distances' }),
    h('span', { class: 'kbd', text: 'C' }), h('span', { text: 'Pin a comment on any layer' }),
    h('span', { class: 'kbd', text: MOD.replace('+', '') + 'K' }), h('span', { text: 'Ask Claude about the selection' }),
    h('span', { class: 'kbd', text: '?' }), h('span', { text: 'All shortcuts' }))));
  return out;
}
function autoLayoutSec(n) {
  const L = n.layout;
  if (!L) return sec('Auto layout', ib('plus', 'Add auto layout (⇧A)', () => { select([n.id], { force: true }); toggleAutoLayout(); }), h('p', { class: 'note', text: 'Stack children in a row or column with spacing and padding, like CSS flexbox.' }));
  const setL = (p, c) => patch(n.id, { layout: Object.assign({}, L, p) }, { label: 'Auto layout', coalesce: c });
  const pad = L.pad;
  const uniformPad = pad[0] === pad[2] && pad[1] === pad[3];
  const row = L.dir === 'row';
  // 3x3 alignment pad: rows = vertical position, columns = horizontal
  const A = ['start', 'center', 'end'];
  const grid = h('div', { class: 'a9' + (row ? '' : ' col'), role: 'group', 'aria-label': 'Alignment' });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const main = row ? A[c] : A[r], cross = row ? A[r] : A[c];
    const on = (L.gap === 'auto' ? (row ? true : true) : (L.justify || 'start') === main) && (L.align || 'start') === cross;
    grid.append(h('button', { 'aria-pressed': String(on && (L.gap !== 'auto' ? true : (row ? c === 1 : r === 1))), title: `${row ? 'Horizontal' : 'Vertical'} ${main}, ${row ? 'vertical' : 'horizontal'} ${cross}`, 'aria-label': `Align ${main} ${cross}`, disabled: !S.canEdit, onclick: () => setL({ justify: main, align: cross, gap: L.gap === 'auto' ? 0 : L.gap }) }));
  }
  const body = h('div', { class: 'stack' },
    h('div', { class: 'g2' }, segm([{ v: 'col', icon: 'arrow-down', title: 'Vertical' }, { v: 'row', icon: 'arrow-right', title: 'Horizontal' }, { v: 'wrap', icon: 'wrap-text', title: 'Wrap' }], L.wrap ? 'wrap' : L.dir, v => setL(v === 'wrap' ? { dir: 'row', wrap: true } : { dir: v, wrap: false }), { aria: 'Direction' }),
      segm([{ v: 'packed', label: 'Packed' }, { v: 'auto', label: 'Spread', title: 'Space between' }], L.gap === 'auto' ? 'auto' : 'packed', v => setL({ gap: v === 'auto' ? 'auto' : 8 }), { aria: 'Distribution' })),
    h('div', { class: 'alignpad' }, grid, h('div', { class: 'stack' },
      numField('Gap', L.gap === 'auto' ? 'mixed' : L.gap, (v, c) => setL({ gap: Math.max(0, v) }, c || 'gap'), { icon: row ? 'between-vertical-start' : 'between-horizontal-start', title: 'Gap between items', ph: L.gap === 'auto' ? 'Auto' : '', min: 0 }),
      uniformPad ? h('div', { class: 'g2' },
        numField('↔', pad[1], (v, c) => setL({ pad: [pad[0], Math.max(0, v), pad[2], Math.max(0, v)] }, c || 'padh'), { title: 'Horizontal padding', min: 0 }),
        numField('↕', pad[0], (v, c) => setL({ pad: [Math.max(0, v), pad[1], Math.max(0, v), pad[3]] }, c || 'padv'), { title: 'Vertical padding', min: 0 })) : h('span', { class: 'mono', style: { color: 'var(--muted)' }, text: 'Padding ' + pad.join(' ') }))),
    h('div', { class: 'g4' }, ...['T', 'R', 'B', 'L'].map((s, i) => numField(s, pad[i], (v, c) => { const p = pad.slice(); p[i] = Math.max(0, v); setL({ pad: p }, c || 'pad' + i); }, { title: ['Top', 'Right', 'Bottom', 'Left'][i] + ' padding', min: 0, k: 'pad' + i }))),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', disabled: !S.canEdit, checked: L.align === 'baseline', onchange: e => setL({ align: e.target.checked ? 'baseline' : 'start' }) }), 'Align text baselines'));
  return sec('Auto layout', ib('minus', 'Remove auto layout (⌥⇧A)', () => { select([n.id], { force: true }); toggleAutoLayout(true); }), body);
}
function textSec(ns) {
  const n = ns[0];
  const tsId = commonVal(ns, x => x.tstyle || '');
  const T = S.file.tokens.type || {};
  const setT = (p, c) => applySel(() => Object.assign({ tstyle: null }, p), 'Text', c);
  const font = commonVal(ns, x => x.font), weight = commonVal(ns, x => x.weight);
  const weights = fontWeights(font === 'mixed' ? n.font : font);
  const body = h('div', { class: 'stack' });
  if (Object.keys(T).length) body.append(selField([{ v: '', label: 'No text style' }, ...Object.entries(T).map(([id, t]) => ({ v: id, label: `${t.name} · ${t.size}` }))], tsId === 'mixed' ? 'mixed' : tsId, v => v ? applyTextStyle(v) : applySel(() => ({ tstyle: null }), 'Detach style'), { aria: 'Text style' }));
  body.append(selField(FONT_LIST.map(f => ({ v: f, label: f })), font, v => { ensureFont(v); const ws = fontWeights(v); setT({ font: v }); applySel(x => ws.includes(+x.weight) ? null : { weight: ws.reduce((a, b) => Math.abs(b - x.weight) < Math.abs(a - x.weight) ? b : a) }, 'Weight'); }, { aria: 'Font family', k: 'font' }));
  body.append(h('div', { class: 'g2' },
    selField(weights.map(w => ({ v: String(w), label: `${WEIGHT_NAMES[w] || w}` })), weight === 'mixed' ? 'mixed' : String(weight), v => setT({ weight: +v }), { aria: 'Font weight' }),
    numField('Size', commonVal(ns, x => x.size), (v, c) => setT({ size: Math.max(1, v) }, c || 'size'), { icon: 'a-large-small', title: 'Font size', min: 1, int: false, dec: 1 })));
  body.append(h('div', { class: 'g2' },
    numField('LH', commonVal(ns, x => x.lh), (v, c) => setT({ lh: Math.max(0.5, v) }, c || 'lh'), { icon: 'unfold-vertical', title: 'Line height (≤4 is a multiplier, more is px)', step: 0.05, int: false, dec: 2 }),
    numField('LS', commonVal(ns, x => x.ls), (v, c) => setT({ ls: v }, c || 'ls'), { icon: 'unfold-horizontal', title: 'Letter spacing (px)', step: 0.1, int: false, dec: 2 })));
  body.append(h('div', { class: 'g2' },
    segm([{ v: 'left', icon: 'align-left' }, { v: 'center', icon: 'align-center' }, { v: 'right', icon: 'align-right' }, { v: 'justify', icon: 'align-justify' }], commonVal(ns, x => x.talign), v => applySel(() => ({ talign: v }), 'Align text'), { aria: 'Text align' }),
    segm([{ v: 'none', label: 'Aa', title: 'As typed' }, { v: 'upper', label: 'AA', title: 'Uppercase' }, { v: 'lower', label: 'aa', title: 'Lowercase' }, { v: 'title', label: 'Ab', title: 'Title case' }], commonVal(ns, x => x.tcase || 'none'), v => applySel(() => ({ tcase: v }), 'Case'), { aria: 'Case' })));
  body.append(h('div', { class: 'g2' },
    segm([{ v: 'none', icon: 'x', title: 'No decoration' }, { v: 'underline', icon: 'underline' }, { v: 'line-through', icon: 'strikethrough' }], commonVal(ns, x => x.deco || 'none'), v => applySel(() => ({ deco: v }), 'Decoration'), { aria: 'Decoration' }),
    segm([{ v: false, icon: 'type', title: 'Upright' }, { v: true, icon: 'italic', title: 'Italic' }], commonVal(ns, x => !!x.italic), v => applySel(() => ({ italic: v }), 'Italic'), { aria: 'Italic' })));
  if (ns.length === 1) {
    const ta = h('textarea', { class: 'sel', rows: 3, style: { height: 'auto', padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit' }, disabled: !S.canEdit, 'aria-label': 'Text content', 'data-k': 'textcontent' });
    ta.value = n.text; ta.onchange = () => patch(n.id, { text: ta.value }, { label: 'Edit text' });
    body.append(ta);
  }
  return sec('Text', S.canEdit && Object.keys(T).length < 30 ? ib('bookmark-plus', 'Save as text style', addTextStyle) : null, body);
}
function iconSec(n) {
  return sec('Icon', null, h('div', { class: 'stack' },
    h('button', { class: 'btn', disabled: !S.canEdit, onclick: () => { setLTab('assets'); $('#app').classList.add('show-left'); setTimeout(() => { const s = $('#lAssets .search'); s && (s.scrollIntoView({ block: 'center' }), s.focus()); }, 30); toast('Click an icon to swap'); } }, ico(n.icon), h('span', { text: n.icon }), h('span', { class: 'grow' }), 'Swap'),
    numField('Stroke', n.iw || 2, (v, c) => patch(n.id, { iw: clamp(v, 0.25, 4) }, { label: 'Icon stroke', coalesce: c || 'iw' }), { wideLabel: true, step: 0.25, int: false, dec: 2 })));
}
function instanceSec(n) {
  const m = get(n.of);
  if (!m) return sec('Instance', null, h('p', { class: 'note', text: 'The main component was deleted. Detach to keep this as plain layers.' }));
  const body = h('div', { class: 'ovr' });
  const texts = descendants(m.id).filter(k => k.type === 'text');
  const icons = descendants(m.id).filter(k => k.type === 'icon');
  if (!texts.length && !icons.length) body.append(h('p', { class: 'note', text: 'No text in this component to override.' }));
  for (const t of texts.slice(0, 24)) {
    const cur = n.ov && n.ov[t.id] && n.ov[t.id].text != null ? n.ov[t.id].text : t.text;
    const inp = h('input', { value: cur, disabled: !S.canEdit, 'data-k': 'ov' + t.id, 'aria-label': t.name });
    inp.onchange = () => { const ov = clone(n.ov || {}); if (inp.value === t.text) { if (ov[t.id]) delete ov[t.id].text; } else ov[t.id] = Object.assign({}, ov[t.id], { text: inp.value }); patch(n.id, { ov }, { label: 'Override text' }); };
    body.append(h('label', { text: t.name }), inp);
  }
  for (const t of icons.slice(0, 8)) {
    const cur = n.ov && n.ov[t.id] && n.ov[t.id].icon || t.icon;
    const inp = h('input', { value: cur, disabled: !S.canEdit, list: 'iconlist', 'data-k': 'ovi' + t.id, 'aria-label': t.name + ' icon' });
    inp.onchange = () => { const name = inp.value.trim(); if (!ICONS[name]) { toast('No icon called “' + name + '”'); return; } const ov = clone(n.ov || {}); ov[t.id] = Object.assign({}, ov[t.id], { icon: name, svg: iconMarkup(name) }); patch(n.id, { ov }, { label: 'Swap icon' }); };
    body.append(h('label', { text: t.name + ' (icon)' }), inp);
  }
  // visibility toggles for direct children
  const vis = kids(m.id).filter(k => k.type !== 'text' || true).slice(0, 12);
  if (vis.length > 1) {
    body.append(h('label', { text: 'Show layers' }));
    for (const k of vis) {
      const shown = n.ov && n.ov[k.id] && n.ov[k.id].visible != null ? n.ov[k.id].visible : k.visible;
      body.append(h('label', { class: 'chk', style: { height: '22px' } }, h('input', { type: 'checkbox', checked: shown, disabled: !S.canEdit, onchange: e => { const ov = clone(n.ov || {}); ov[k.id] = Object.assign({}, ov[k.id], { visible: e.target.checked }); patch(n.id, { ov }, { label: 'Toggle layer' }); } }), k.name));
    }
  }
  return sec('Instance of ' + m.name, null, body);
}
function paintSwatchBg(f, mode) {
  if (f.t === 'solid') return resolveColor(f.c, mode);
  if (f.t === 'gradient') return f.css;
  if (f.t === 'image') return `url("${f.src}") center/cover`;
  return '#ccc';
}
function fillSec(ns) {
  const n = ns[0];
  const fills = commonVal(ns, x => x.fills);
  const setFills = (fs, c) => applySel(() => ({ fills: fs }), 'Fill', c);
  const body = h('div', { class: 'stack', style: { gap: '2px' } });
  if (fills === 'mixed') body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--muted)' } }, 'Mixed fills', h('button', { class: 'btn sm', disabled: !S.canEdit, onclick: () => setFills(clone(n.fills)) }, 'Use first')));
  else {
    const list = fills || [];
    list.slice().reverse().forEach((f, ri) => {
      const i = list.length - 1 - ri;
      const upd = (p, c) => { const fs = clone(list); fs[i] = Object.assign({}, fs[i], p); setFills(fs, c); };
      body.append(paintRow(f, upd, () => { const fs = clone(list); fs.splice(i, 1); setFills(fs); }, modeOf(n.id), n.type === 'text'));
    });
  }
  return sec(ns.every(x => x.type === 'text') ? 'Text colour' : 'Fill', fills === 'mixed' ? null : ib('plus', 'Add fill', () => setFills([...(fills || []), { t: 'solid', c: (fills || []).length ? '#000000' : '#D9D9DE', o: (fills || []).length ? 0.2 : 1 }])), body);
}
function paintRow(f, upd, del, mode, isText) {
  const sw = h('button', { class: 'sw', title: 'Change paint', style: { background: paintSwatchBg(f, mode) } });
  const tok = f.t === 'solid' && typeof f.c === 'string' && f.c[0] === '$';
  let main;
  if (f.t === 'solid' && !tok) {
    const ci = h('input', { type: 'color', value: (normHex(f.c) || '#000000').toLowerCase(), disabled: !S.canEdit, 'aria-label': 'Colour picker' });
    ci.oninput = () => upd({ c: ci.value.toUpperCase() }, 'color'); sw.append(ci);
    main = h('input', { class: 'sel mono', value: (normHex(f.c) || f.c).replace('#', ''), disabled: !S.canEdit, 'aria-label': 'Hex colour', 'data-k': 'hex' + Math.random() });
    main.onchange = () => { const v = normHex(main.value.startsWith('#') ? main.value : '#' + main.value) || normHex(main.value); if (v) upd({ c: v }); else main.value = (normHex(f.c) || '').replace('#', ''); };
  } else if (tok) {
    main = h('button', { class: 'tokchip', disabled: !S.canEdit, title: 'Token — click to change', onclick: e => tokenMenu(e.currentTarget, f, upd) }, h('span', { text: tokenName(f.c) }));
  } else if (f.t === 'gradient') {
    main = h('input', { class: 'sel mono', value: f.css || '', disabled: !S.canEdit, 'aria-label': 'Gradient CSS', title: f.css });
    main.onchange = () => upd({ css: main.value });
  } else if (f.t === 'image') {
    main = selField([{ v: 'cover', label: 'Image · Fill' }, { v: 'contain', label: 'Image · Fit' }, { v: 'fill', label: 'Image · Stretch' }, { v: 'tile', label: 'Image · Tile' }], f.fit || 'cover', v => upd({ fit: v }), { aria: 'Image fit' });
  }
  sw.addEventListener('click', e => {
    if (e.target.tagName === 'INPUT') return;
    if (!S.canEdit) return;
    menuAt(sw, [
      { head: 'Paint' },
      { label: 'Solid colour', act: () => upd({ t: 'solid', c: f.t === 'solid' ? f.c : '#D9D9DE', css: undefined, src: undefined }) },
      { label: 'Gradient', act: () => upd({ t: 'gradient', css: f.css || 'linear-gradient(180deg, #2B59FF 0%, #8A4FFF 100%)' }) },
      { label: isText ? 'Image (clipped to text)' : 'Image…', act: () => { const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } }); inp.onchange = async () => { const fl = inp.files[0]; if (fl) upd({ t: 'image', src: await imageSrcFor(fl), fit: 'cover' }); inp.remove(); }; document.body.append(inp); inp.click(); } },
      '-',
      { head: 'Colour tokens' },
      ...Object.entries(S.file.tokens.colors).map(([id, t]) => ({ label: t.name, swatch: t[mode] || t.light, act: () => upd({ t: 'solid', c: '$' + id }) })),
      { label: 'New token from this colour', act: () => { if (f.t !== 'solid') return; addColorToken(); }, disabled: f.t !== 'solid' || tok },
    ]);
  });
  const op = h('input', { class: 'sel', value: Math.round((f.o == null ? 1 : f.o) * 100) + '%', disabled: !S.canEdit || f.t !== 'solid', 'aria-label': 'Paint opacity', style: { textAlign: 'right' } });
  op.onchange = () => { const v = evalNum(op.value.replace('%', ''), 100); if (v != null) upd({ o: clamp(v, 0, 100) / 100 }); };
  return h('div', { class: 'paint' }, sw, main, op, h('button', { class: 'x', title: 'Remove', 'aria-label': 'Remove paint', disabled: !S.canEdit, onclick: del }, ico('minus')));
}
function tokenMenu(btn, f, upd) {
  menuAt(btn, [
    ...Object.entries(S.file.tokens.colors).map(([id, t]) => ({ label: t.name, swatch: t.light, act: () => upd({ c: '$' + id }) })),
    '-',
    { label: 'Detach token', act: () => upd({ c: resolveColor(f.c) }) },
  ]);
}
function strokeSec(ns) {
  const n = ns[0];
  const st = commonVal(ns, x => x.stroke);
  const setS = (p, c) => applySel(x => ({ stroke: p === null ? null : Object.assign({ c: '#111111', w: 1, style: 'solid' }, x.stroke, p) }), 'Stroke', c);
  if (!st) return sec(n.type === 'line' ? 'Line' : 'Stroke', ib('plus', 'Add stroke', () => setS({ c: '#111111', w: 1 })));
  if (st === 'mixed') return sec('Stroke', null, h('p', { class: 'note', text: 'Mixed strokes' }));
  const body = h('div', { class: 'stack' },
    paintRow({ t: 'solid', c: st.c, o: st.o }, (p, c) => setS({ c: p.c != null ? p.c : st.c, o: p.o != null ? p.o : st.o }, c), () => setS(null), modeOf(n.id)),
    h('div', { class: 'g2' }, numField('W', st.w, (v, c) => setS({ w: Math.max(0, v) }, c || 'sw'), { title: 'Stroke weight', icon: 'minus', min: 0, int: false, dec: 1 }),
      selField([{ v: 'solid', label: 'Solid' }, { v: 'dashed', label: 'Dashed' }, { v: 'dotted', label: 'Dotted' }], st.style || 'solid', v => setS({ style: v }), { aria: 'Stroke style' })));
  return sec(n.type === 'line' ? 'Line' : 'Stroke', n.type === 'line' ? null : ib('minus', 'Remove stroke', () => setS(null)), body);
}
function effectsSec(ns) {
  const n = ns[0];
  const ef = commonVal(ns, x => x.effects || []);
  const setE = (list, c) => applySel(() => ({ effects: list }), 'Effects', c);
  const body = h('div', { class: 'stack' });
  if (ef === 'mixed') body.append(h('p', { class: 'note', text: 'Mixed effects' }));
  else ef.forEach((e, i) => {
    const upd = (p, c) => { const l = clone(ef); l[i] = Object.assign({}, l[i], p); setE(l, c); };
    const head = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 22px', gap: '6px', alignItems: 'center' } },
      selField([{ v: 'shadow', label: 'Drop shadow' }, { v: 'inner', label: 'Inner shadow' }, { v: 'blur', label: 'Layer blur' }, { v: 'bgblur', label: 'Background blur' }], e.t === 'shadow' && e.inset ? 'inner' : e.t, v => upd(v === 'inner' ? { t: 'shadow', inset: true } : v === 'shadow' ? { t: 'shadow', inset: false } : { t: v, r: e.r || 8 }), { aria: 'Effect type' }),
      h('button', { class: 'x', style: { width: '22px', height: '22px', border: 0, background: 'transparent', color: 'var(--faint)' }, 'aria-label': 'Remove effect', disabled: !S.canEdit, onclick: () => { const l = clone(ef); l.splice(i, 1); setE(l); } }, ico('minus')));
    body.append(head);
    if (e.t === 'shadow') {
      body.append(h('div', { class: 'g4' }, numField('X', e.x || 0, (v, c) => upd({ x: v }, c || 'ex' + i), { k: 'ex' + i }), numField('Y', e.y || 0, (v, c) => upd({ y: v }, c || 'ey' + i), { k: 'ey' + i }), numField('B', e.b || 0, (v, c) => upd({ b: Math.max(0, v) }, c || 'eb' + i), { title: 'Blur', k: 'eb' + i }), numField('S', e.s || 0, (v, c) => upd({ s: v }, c || 'es' + i), { title: 'Spread', k: 'es' + i })));
      const pc = parseColor(e.c || 'rgba(0,0,0,.15)') || { r: 0, g: 0, b: 0, a: 0.15 };
      body.append(paintRow({ t: 'solid', c: toHex(pc), o: pc.a }, p => { const c2 = parseColor(p.c || toHex(pc)) || pc; const a = p.o != null ? p.o : pc.a; upd({ c: `rgba(${c2.r}, ${c2.g}, ${c2.b}, ${rnd(a, 3)})` }); }, () => { const l = clone(ef); l.splice(i, 1); setE(l); }, 'light'));
    } else body.append(numField('Blur', e.r || 0, (v, c) => upd({ r: Math.max(0, v) }, c || 'er' + i), { wideLabel: true, k: 'er' + i }));
  });
  return sec('Effects', ef === 'mixed' ? null : ib('plus', 'Add drop shadow', () => setE([...ef, { t: 'shadow', x: 0, y: 4, b: 16, s: 0, c: 'rgba(0, 0, 0, 0.12)' }])), body);
}
function exportSec(ns) {
  const ids = selRoots();
  return sec('Export', null, h('div', { class: 'stack' },
    h('div', { class: 'g2' },
      h('button', { class: 'btn', onclick: () => exportImage(ids[0], 2) }, 'PNG @2x'),
      h('button', { class: 'btn', onclick: () => exportImage(ids[0], 'svg') }, 'SVG')),
    h('div', { class: 'g2' },
      h('button', { class: 'btn', onclick: () => copyText(exportHTMLDoc(ids), 'HTML copied') }, 'Copy HTML'),
      h('button', { class: 'btn', onclick: () => copyText(exportReact(ids), 'React copied') }, 'Copy React'))));
}

// ---------- prototype panel ----------
const TRANS = [{ v: 'instant', label: 'Instant' }, { v: 'dissolve', label: 'Dissolve' }, { v: 'slide-left', label: 'Slide in ←' }, { v: 'slide-right', label: 'Slide in →' }, { v: 'slide-up', label: 'Slide up' }, { v: 'push-left', label: 'Push ←' }, { v: 'push-right', label: 'Push →' }, { v: 'scale', label: 'Scale in' }];
function protoPanel() {
  const ns = selNodes();
  const out = [];
  if (!ns.length) {
    const flows = allFrames().filter(f => f.flow);
    out.push(sec('Flows', null, h('div', { class: 'stack' },
      flows.length ? flows.map(f => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { style: { color: 'var(--proto)', display: 'grid' } }, ico('play')), h('span', { text: f.flow, style: { flex: 1, fontWeight: 600 } }), h('span', { text: f.name, style: { color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' } }), h('button', { class: 'btn sm', onclick: () => openPresent(f.id) }, 'Present'))) : h('p', { class: 'note', text: 'No flows yet. Select a screen and mark it as a flow start, or just press Present to start from the first screen.' }))));
    out.push(sec('How to wire a prototype', null, h('ol', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.6, color: 'var(--ink-2)' } },
      h('li', { text: 'Select a button, card or any layer.' }), h('li', { text: 'Drag the pink handle on its right edge onto the screen it should open.' }), h('li', { text: 'Pick the trigger and animation here, then Present.' }))));
    return out;
  }
  const n = ns[0];
  const single = ns.length === 1;
  if (single && !n.parent && n.type === 'frame' && !n.group) {
    out.push(sec('Flow starting point', null, h('div', { class: 'stack' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!n.flow, disabled: !S.canEdit, onchange: e => patch(n.id, { flow: e.target.checked ? (n.name || 'Flow') : null }, { label: 'Flow' }) }), 'Start a flow here'),
      n.flow ? h('input', { class: 'sel', value: n.flow, disabled: !S.canEdit, 'aria-label': 'Flow name', onchange: e => patch(n.id, { flow: e.target.value.trim() || n.name }, { label: 'Rename flow' }) }) : null,
      h('button', { class: 'btn', onclick: () => openPresent(n.id) }, ico('play'), 'Present from here'))));
  }
  const L = commonVal(ns, x => x.link || null);
  const setLink = p => applySel(x => ({ link: p === null ? null : Object.assign({ on: 'click', tr: 'dissolve', dur: 250 }, x.link, p) }), 'Interaction');
  const dests = [{ v: '', label: 'None' }, { v: 'back', label: '← Back' }, ...S.file.pages.map(p => ({ group: p.name, items: framesOnPage(p.id).filter(f => !f.component && f.id !== topOf(n.id).id).map(f => ({ v: f.id, label: f.name })) })).filter(g => g.items.length)];
  const lk = L === 'mixed' ? null : L;
  const body = h('div', { class: 'stack' },
    h('div', { class: 'g2' }, h('span', { text: 'Trigger', style: { color: 'var(--muted)', alignSelf: 'center' } }, ), segm([{ v: 'click', label: 'Click' }, { v: 'hover', label: 'Hover' }], lk ? lk.on : 'click', v => setLink({ on: v, to: lk ? lk.to : '' }), { aria: 'Trigger' })),
    h('div', { class: 'g2' }, h('span', { text: 'Navigate to', style: { color: 'var(--muted)', alignSelf: 'center' } }), selField(dests, L === 'mixed' ? 'mixed' : (lk ? lk.to : ''), v => setLink(v ? { to: v } : null), { aria: 'Destination' })),
    lk ? h('div', { class: 'g2' }, h('span', { text: 'Animation', style: { color: 'var(--muted)', alignSelf: 'center' } }), selField(TRANS, lk.tr || 'instant', v => setLink({ tr: v }), { aria: 'Animation' })) : null,
    lk && lk.tr !== 'instant' ? h('div', { class: 'g2' }, h('span', { text: 'Duration', style: { color: 'var(--muted)', alignSelf: 'center' } }), numField('ms', lk.dur || 250, v => setLink({ dur: clamp(v, 50, 3000) }), { suffix: 'ms', title: 'Duration' })) : null);
  out.push(sec('Interaction', null, body));
  if (single && n.type === 'instance' && get(n.of)) {
    const inner = descendants(n.of).filter(k => k.link);
    if (inner.length) out.push(sec('From the component', null, h('p', { class: 'note', text: inner.map(k => `${k.name} → ${k.link.to === 'back' ? 'Back' : (get(k.link.to) || {}).name || '?'}`).join('\n') })));
  }
  return out;
}

// ---------- inspect panel (developer handoff) ----------
let inspectLang = lsGet('pinup.lang', 'react');
function inspectPanel() {
  const ns = selNodes();
  const out = [];
  if (!ns.length) {
    out.push(sec('Handoff', null, h('div', { class: 'stack' },
      h('p', { class: 'note', text: 'Everything a developer (or Claude Code) needs: tokens as CSS variables, each screen as code, components, and the prototype map.' }),
      h('button', { class: 'btn primary', onclick: () => copyText(handoffMarkdown(), 'Handoff copied — paste it into Claude Code') }, ico('clipboard-copy'), 'Copy handoff for Claude Code'),
      h('button', { class: 'btn', onclick: () => saveFile(slug(S.file.name) + '-handoff.md', handoffMarkdown()) }, ico('download'), 'Download handoff (.md)'),
      h('button', { class: 'btn', onclick: () => saveFile(slug(S.file.name) + '.html', exportHTMLDoc(roots().map(n => n.id), { gallery: true })) }, ico('file-code'), 'Download this page as HTML'),
      h('button', { class: 'btn', onclick: () => saveFile(slug(S.file.name) + '.pinup.json', JSON.stringify({ file: S.file, nodes: [...S.nodes.values()] }, null, 1)) }, ico('braces'), 'Download file (.json)'))));
    out.push(sec('Tokens', h('button', { class: 'btn sm ghost', onclick: () => copyText(tokensCSS(), 'Tokens copied') }, 'Copy'), h('pre', { class: 'code', text: tokensCSS() || '/* No tokens yet */' })));
    return out;
  }
  const n = ns[0]; const r = lrect(n.id) || n; const mode = modeOf(n.id);
  const kv = h('dl', { class: 'kv' });
  const row = (k, v, sw) => kv.append(h('dt', { text: k }), h('dd', null, sw ? h('span', { class: 'sw', style: { background: sw } }) : null, v));
  row('Layer', n.name);
  row('Size', `${fmt(rnd(r.w, 1))} × ${fmt(rnd(r.h, 1))}${n.sw !== 'fixed' || n.sh !== 'fixed' ? `  (${n.sw} / ${n.sh})` : ''}`);
  if (n.parent) row('Position', inLayout(n) ? 'auto layout' : `${fmt(rnd(r.x, 1))}, ${fmt(rnd(r.y, 1))}`);
  if (n.layout) row('Layout', `${n.layout.dir === 'row' ? 'row' : 'column'} · gap ${n.layout.gap} · pad ${n.layout.pad.join(' ')}`);
  if (n.radius) row('Radius', Array.isArray(n.radius) ? n.radius.join(' ') : n.radius);
  if (n.opacity < 1) row('Opacity', Math.round(n.opacity * 100) + '%');
  if (n.type === 'text') {
    const ts = n.tstyle && S.file.tokens.type[n.tstyle];
    if (ts) row('Style', ts.name);
    row('Font', `${n.font} ${n.weight}`); row('Size', `${n.size}px / ${n.lh <= 4 ? n.lh : n.lh + 'px'}`); if (n.ls) row('Tracking', n.ls + 'px');
  }
  for (const f of (n.type === 'instance' ? [] : n.fills || [])) {
    if (f.t === 'solid') { const hex = resolveColor(f.c, mode); row(n.type === 'text' ? 'Colour' : 'Fill', `${tokenName(f.c) ? tokenName(f.c) + ' · ' : ''}${hex}${f.o != null && f.o < 1 ? ' · ' + Math.round(f.o * 100) + '%' : ''}`, hex); }
    else if (f.t === 'gradient') row('Fill', f.css);
    else if (f.t === 'image') row('Fill', 'image (' + (f.fit || 'cover') + ')');
  }
  if (n.stroke) row('Stroke', `${n.stroke.w}px ${n.stroke.style || 'solid'} ${resolveColor(n.stroke.c, mode)}`, resolveColor(n.stroke.c, mode));
  if (n.type === 'text') {
    const f = n.fills[0]; const bg = backgroundBehind(n.id);
    if (f && f.t === 'solid' && bg) { const cr = contrast(resolveColor(f.c, mode), bg); row('Contrast', `${rnd(cr, 2)}:1 ${cr >= 4.5 ? 'AA ✓' : cr >= 3 ? (n.size >= 18 || (n.size >= 14 && n.weight >= 700) ? 'AA large ✓' : 'below AA') : 'fails AA'}`); }
  }
  if (n.link) row('On ' + n.link.on, n.link.to === 'back' ? 'Back' : '→ ' + ((get(n.link.to) || {}).name || '?'));
  out.push(sec('Properties', null, kv));
  const css = cssFor(n.type === 'instance' && get(n.of) ? instRoot(n, get(n.of)) : n, n.parent ? get(n.parent) : null, { export: true, var: id => '--' + slug((S.file.tokens.colors[id] || {}).name || id), root: !n.parent });
  delete css.position; if (!n.parent) { delete css.left; delete css.top; }
  const cssStr = Object.entries(css).map(([k, v]) => `${k}: ${v};`).join('\n');
  out.push(sec('CSS', h('button', { class: 'btn sm ghost', onclick: () => copyText(cssStr, 'CSS copied') }, 'Copy'), h('pre', { class: 'code', text: cssStr })));
  const ids = selRoots();
  const code = inspectLang === 'react' ? exportReact(ids) : exportHTMLDoc(ids);
  out.push(sec('Code', h('div', { style: { display: 'flex', gap: '4px' } },
    h('button', { class: 'btn sm ' + (inspectLang === 'react' ? 'on' : 'ghost'), onclick: () => { inspectLang = 'react'; lsSet('pinup.lang', 'react'); INSP.force = true; renderInspector(); } }, 'React'),
    h('button', { class: 'btn sm ' + (inspectLang === 'html' ? 'on' : 'ghost'), onclick: () => { inspectLang = 'html'; lsSet('pinup.lang', 'html'); INSP.force = true; renderInspector(); } }, 'HTML')),
    h('pre', { class: 'code', text: code }),
    h('div', { class: 'g2', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => copyText(code, 'Code copied') }, 'Copy'), h('button', { class: 'btn', onclick: () => saveFile(slug(n.name) + (inspectLang === 'react' ? '.jsx' : '.html'), code) }, 'Download'))));
  return out;
}
function backgroundBehind(id) {
  for (const a of ancestors(id)) { const f = (a.fills || []).find(f => f.t === 'solid' && (f.o == null || f.o >= 0.95)); if (f) return resolveColor(f.c, modeOf(a.id)); }
  return '#FFFFFF';
}

// ---------- context menu ----------
function selectionMenu(x, y) {
  const ns = selNodes(); const n = ns[0];
  const e = S.canEdit;
  if (!ns.length) return menu([
    { label: 'Paste here', kbd: MOD + 'V', disabled: !memClip || !e, act: () => pasteNodes(memClip) },
    { label: 'Add screen', disabled: !e, act: () => addFrame(PRESETS[0]) },
    '-', { label: 'Zoom to fit', kbd: '⇧1', act: zoomFitAll },
    { label: (S.grid ? 'Hide' : 'Show') + ' dot grid', act: () => { S.grid = !S.grid; lsSet('pinup.grid', S.grid); applyView(); } },
  ], x, y);
  menu([
    { label: 'Ask Claude about this…', kbd: MOD + 'K', act: () => focusAsk(), disabled: !SAMPLE.fn },
    { label: 'Comment here', kbd: 'C', act: () => commentOnSelection(), disabled: !CA.ctl },
    '-',
    { label: 'Copy', kbd: MOD + 'C', act: () => document.execCommand('copy') },
    { label: 'Paste into', kbd: MOD + 'V', disabled: !memClip || !e, act: () => pasteNodes(memClip) },
    { label: 'Duplicate', kbd: MOD + 'D', disabled: !e, act: () => duplicate(S.sel) },
    { label: 'Delete', kbd: '⌫', disabled: !e, act: () => removeNodes(S.sel) },
    '-',
    { label: 'Group', kbd: MOD + 'G', disabled: !e, act: () => wrapSelection('group') },
    { label: 'Frame selection', kbd: MOD + '⌥G', disabled: !e, act: () => wrapSelection('frame') },
    { label: 'Ungroup', kbd: '⇧' + MOD + 'G', disabled: !e || !ns.some(x => x.type === 'frame'), act: ungroup },
    { label: n.layout ? 'Remove auto layout' : 'Add auto layout', kbd: n.layout ? '⌥⇧A' : '⇧A', disabled: !e, act: () => toggleAutoLayout(!!n.layout) },
    n.type === 'instance' ? { label: 'Detach instance', kbd: MOD + '⌥B', disabled: !e, act: detachInstance } : { label: 'Create component', kbd: MOD + '⌥K', disabled: !e || n.component, act: makeComponent },
    n.type === 'instance' ? { label: 'Go to main component', act: () => goToMain(n.of) } : null,
    '-',
    { label: 'Bring to front', kbd: MOD + '⌥]', disabled: !e, act: () => reorder('front') },
    { label: 'Send to back', kbd: MOD + '⌥[', disabled: !e, act: () => reorder('back') },
    { label: n.visible ? 'Hide' : 'Show', kbd: '⇧' + MOD + 'H', disabled: !e, act: () => applySel(x => ({ visible: !n.visible }), 'Visibility') },
    { label: n.locked ? 'Unlock' : 'Lock', kbd: '⇧' + MOD + 'L', disabled: !e, act: () => applySel(x => ({ locked: !n.locked }), 'Lock') },
    '-',
    { label: 'Copy as HTML', act: () => copyText(exportHTMLDoc(selRoots()), 'HTML copied') },
    { label: 'Copy as React', act: () => copyText(exportReact(selRoots()), 'React copied') },
    { label: 'Export PNG @2x', act: () => exportImage(selRoots()[0], 2) },
  ], x, y);
}

function showShortcuts() {
  const rows = [
    ['V', 'Move'], ['F / A', 'Frame'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['L', 'Line'], ['T', 'Text'], ['H / Space', 'Hand (pan)'], ['C', 'Comment'],
    [MOD + 'D', 'Duplicate'], ['⌥ drag', 'Duplicate while moving'], [MOD + 'G', 'Group'], [MOD + '⌥G', 'Frame selection'], ['⇧' + MOD + 'G', 'Ungroup'],
    ['⇧A', 'Add auto layout'], ['⌥⇧A', 'Remove auto layout'], [MOD + '⌥K', 'Create component'], [MOD + '⌥B', 'Detach instance'],
    ['Enter / ⇧Enter', 'Select children / parent'], ['Tab', 'Next sibling'], ['Arrows', 'Nudge 1 (⇧ 10); reorder in auto layout'], [MOD + '] / [', 'Bring forward / backward'],
    ['⇧' + MOD + 'H', 'Show / hide'], ['⇧' + MOD + 'L', 'Lock / unlock'], ['⌥ hover', 'Measure distances'], [MOD + '-click', 'Select deep'], ['Double-click', 'Go deeper / edit text'],
    ['⇧1 / ⇧2 / ⇧0', 'Fit all / selection / 100%'], [MOD + '+ / −', 'Zoom'], [MOD + 'Enter', 'Present'], [MOD + 'K', 'Ask Claude'], [MOD + 'Z / ⇧' + MOD + 'Z', 'Undo / redo'],
  ];
  sheet('Keyboard shortcuts', h('div', { class: 'tips', style: { gridTemplateColumns: 'minmax(110px,auto) 1fr' } }, ...rows.flatMap(([k, v]) => [h('span', { class: 'kbd', text: k, style: { justifySelf: 'start' } }), h('span', { text: v })])), { width: 520 });
}
