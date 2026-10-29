// ---------- feedback: pinned, sketchable, actionable review items ----------
// Each item is a task for Claude (or a person): pinned to a layer or an area, with optional sketch marks.
// Claude works through items one at a time; every change it makes is its own history step that can be reverted.
const FB_CATS = {
  visual: { name: 'Visual', color: '#D6336C' },
  layout: { name: 'Layout', color: '#2B59FF' },
  copy: { name: 'Copy', color: '#C2410C' },
  interaction: { name: 'Interaction', color: '#8A4FFF' },
  a11y: { name: 'Accessibility', color: '#1E9E6A' },
  question: { name: 'Question', color: '#A16207' },
};
const FB_STATUS = { open: 'Open', doing: 'In progress', done: 'Done', wontfix: "Won't do" };
const MARK_COLORS = ['#FF3B30', '#FF9500', '#2B59FF', '#1E9E6A', '#111111'];
const FB = { items: new Map(), sel: null, draft: null, sketch: null, color: '#FF3B30', filter: lsGet('pinup.fbfilter', 'open'), show: lsGet('pinup.fbshow', true), busy: new Set(), confirmDel: null };
const fbCat = c => FB_CATS[c] || FB_CATS.visual;
const isOpen = it => it.status === 'open' || it.status === 'doing' || !it.status;

// ----- data -----
function fbSave(it) {
  const data = clone(it); delete data.id;
  FB.items.set(it.id, Object.assign({}, it));
  queueWrite('feedback:' + it.id, data);
  fbChanged();
}
function fbPatch(id, p) { const it = FB.items.get(id); if (!it) return; fbSave(Object.assign({}, it, p, { upd: Date.now() })); }
function fbDelete(id) { if (!FB.items.has(id)) return; FB.items.delete(id); queueWrite('feedback:' + id, null); if (FB.sel === id) FB.sel = null; fbChanged(); }
function applyRemoteFeedback(id, data) {
  if (DB.pending.has('feedback:' + id)) return;
  if (data) FB.items.set(id, Object.assign({}, data, { id })); else { FB.items.delete(id); if (FB.sel === id) FB.sel = null; }
  fbChanged();
}
const fbChanged = rafThrottle(() => { renderMarks(); drawOverlay(); if (S.ltab === 'feedback') renderFeedbackPanel(); updateTabCounts(); presenceSoon(); });
function nextFbNumber() { let m = 0; for (const it of FB.items.values()) m = Math.max(m, +it.n || 0); return m + 1; }
function fbVisible(it) {
  if (it.id === FB.sel) return true;
  if (!FB.show) return false;
  if (FB.filter === 'open') return isOpen(it);
  if (FB.filter === 'done') return !isOpen(it);
  return true;
}
function fbAnchor(it) {
  if (it.node) { const n = get(it.node); if (!n || n.page !== S.pageId || !elOf(it.node)) return null; return wrect(it.node); }
  return it.page === S.pageId ? { x: 0, y: 0, w: 0, h: 0 } : null;
}
function fbPoint(it) {
  const r = fbAnchor(it); if (!r) return null;
  if (it.area) return { x: r.x + it.area.x + it.area.w, y: r.y + it.area.y };
  return { x: r.x + (it.dx || 0), y: r.y + (it.dy || 0) };
}
function fbWhere(it) {
  if (!it.node) return pageName(it.page);
  const n = get(it.node); if (!n) return 'deleted layer';
  const t = topOf(it.node);
  return t && t.id !== n.id ? `${t.name} › ${n.name}` : n.name;
}

// ----- canvas: sketch marks live in world space under the overlay -----
function renderMarks() {
  const L = $('#fbLayer'); if (!L) return;
  let svg = '';
  const list = [...FB.items.values()].filter(fbVisible);
  if (FB.draft) list.push(FB.draft);
  for (const it of list) {
    if (!it.marks || !it.marks.length) continue;
    const r = fbAnchor(it); if (!r) continue;
    const dim = !isOpen(it) && it.id !== FB.sel ? ' opacity="0.35"' : '';
    svg += `<g${dim} data-fbm="${esc(it.id)}">`;
    for (const m of it.marks) svg += markSVG(m, r.x, r.y);
    svg += '</g>';
  }
  L.innerHTML = `<svg width="1" height="1" style="overflow:visible;position:absolute;left:0;top:0">${svg}</svg>`;
}
function markSVG(m, ox, oy) {
  const p = m.pts || []; if (p.length < 4) return '';
  const P = i => `${rnd(ox + p[i], 1)} ${rnd(oy + p[i + 1], 1)}`;
  const w = m.w || 3, c = esc(m.c || '#FF3B30');
  if (m.t === 'box') { const x = ox + Math.min(p[0], p[2]), y = oy + Math.min(p[1], p[3]); return `<rect x="${rnd(x, 1)}" y="${rnd(y, 1)}" width="${rnd(Math.abs(p[2] - p[0]), 1)}" height="${rnd(Math.abs(p[3] - p[1]), 1)}" rx="${w * 1.5}" fill="none" stroke="${c}" stroke-width="${w}"/>`; }
  if (m.t === 'arrow') {
    const x1 = ox + p[0], y1 = oy + p[1], x2 = ox + p[2], y2 = oy + p[3];
    const a = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(10, w * 4);
    const h1 = `${rnd(x2 - hl * Math.cos(a - 0.45), 1)} ${rnd(y2 - hl * Math.sin(a - 0.45), 1)}`, h2 = `${rnd(x2 - hl * Math.cos(a + 0.45), 1)} ${rnd(y2 - hl * Math.sin(a + 0.45), 1)}`;
    return `<path d="M${rnd(x1, 1)} ${rnd(y1, 1)} L${rnd(x2, 1)} ${rnd(y2, 1)} M${h1} L${rnd(x2, 1)} ${rnd(y2, 1)} L${h2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  let d = 'M' + P(0); for (let i = 2; i < p.length; i += 2) d += ' L' + P(i);
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${m.t === 'marker' ? ' opacity="0.35"' : ''}/>`;
}
// pins, areas and the selected item's card, in screen space (called from drawOverlay)
function fbOverlayHTML(sp, z) {
  let html = '';
  const list = [...FB.items.values()].filter(fbVisible).sort((a, b) => (a.n || 0) - (b.n || 0));
  if (FB.draft) list.push(FB.draft);
  for (const it of list) {
    const r = fbAnchor(it); if (!r) continue;
    const cat = fbCat(it.cat); const on = it.id === FB.sel || it === FB.draft;
    if (it.area) { const a = sp(r.x + it.area.x, r.y + it.area.y); html += `<div class="fbarea${on ? ' on' : ''}" style="transform:translate(${a.x}px,${a.y}px);width:${it.area.w * z}px;height:${it.area.h * z}px;--c:${cat.color}"></div>`; }
    else if (on && it.node) { const a = sp(r.x, r.y); html += `<div class="fbarea on" style="transform:translate(${a.x}px,${a.y}px);width:${r.w * z}px;height:${r.h * z}px;--c:${cat.color};border-style:dashed;background:transparent"></div>`; }
    const pt = fbPoint(it); if (!pt) continue;
    const p = sp(pt.x, pt.y);
    const done = !isOpen(it);
    const label = it === FB.draft ? '+' : done ? '✓' : String(it.n || '?');
    html += `<div class="fbpin${on ? ' on' : ''}${done ? ' done' : ''}${it.status === 'doing' ? ' doing' : ''}" data-fb="${esc(it.id || 'draft')}" title="${esc('#' + (it.n || '') + ' ' + (it.text || ''))}" style="transform:translate(${p.x}px,${p.y}px);--c:${cat.color}">${label}</div>`;
  }
  const s = FB.sel && FB.items.get(FB.sel);
  if (s && !FB.draft) { const pt = fbPoint(s); if (pt) { const p = sp(pt.x, pt.y); html += fbCardHTML(s, p); } }
  return html;
}
function fbCardHTML(it, p) {
  const cat = fbCat(it.cat);
  const who = it.by === 'claude' ? 'Claude' : nameOf(it.by);
  const logs = (it.log || []).filter(id => LOG.items.get(id) && !LOG.items.get(id).revertedBy);
  const canAct = S.canFeedback;
  const st = it.status || 'open';
  let acts = '';
  if (canAct) {
    acts += `<button data-fbact="edit">Edit</button>`;
    if (isOpen(it)) acts += `<button data-fbact="status:done">Mark done</button>`; else acts += `<button data-fbact="status:open">Reopen</button>`;
    if (SAMPLE.fn && S.canEdit && isOpen(it)) acts += `<button data-fbact="fix" class="pri">${FB.busy.has(it.id) ? 'Working…' : 'Fix with Claude'}</button>`;
    if (logs.length && S.canEdit) acts += `<button data-fbact="revert">Revert ${logs.length > 1 ? logs.length + ' steps' : 'change'}</button>`;
    acts += `<button data-fbact="del" class="danger">${FB.confirmDel === it.id ? 'Confirm delete' : 'Delete'}</button>`;
  }
  return `<div class="fbcard" data-fbcard="${esc(it.id)}" style="left:${p.x + 18}px;top:${p.y - 8}px;--c:${cat.color}">
    <div class="fbh"><b>#${it.n || ''}</b><span class="fbcat">${esc(cat.name)}</span><span class="fbst st-${st}">${esc(FB_STATUS[st] || st)}</span><button data-fbact="close" aria-label="Close" class="x">×</button></div>
    <div class="fbt">${esc(it.text || '(sketch only)')}</div>
    <div class="fbm">${esc(who)} · ${esc(relTime(it.at))} · ${esc(fbWhere(it))}</div>
    ${it.reply ? `<div class="fbr"><b>${it.doneBy === 'claude' ? 'Claude' : 'Note'}:</b> ${esc(it.reply)}</div>` : ''}
    ${acts ? `<div class="fba">${acts}</div>` : ''}
  </div>`;
}
function nameOf(uidv) { if (!uidv) return 'Someone'; if (uidv === S.me.id) return 'You'; const p = PEOPLE.profiles[uidv]; if (!p) resolveProfile(uidv); return (p && p.name) || 'Someone'; }
const _pq = new Set();
const resolveProfile = id => { if (_pq.has(id) || !PEOPLE.user || !PEOPLE.user.profiles) return; _pq.add(id); PEOPLE.user.profiles([id]).then(ps => { Object.assign(PEOPLE.profiles, ps); fbChanged(); logChanged(); }).catch(() => {}); };
function relTime(at) {
  const t = typeof at === 'number' ? at : Date.parse(at || ''); if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 50) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ----- the feedback tool -----
function fbDown(e, base) {
  if (!S.canFeedback) { toast('You can view this file but not leave feedback here. Comments (C) still work if you can comment.'); return; }
  if (FB.draft && FB.sketch) { Object.assign(DRAG, base, { kind: 'fbmark', pts: [base.wx, base.wy] }); capture(e); return; }
  Object.assign(DRAG, base, { kind: 'fbnew' }); capture(e);
}
function fbMove(e, w) {
  if (DRAG.kind === 'fbmark') {
    const z = view().z; const p = DRAG.pts;
    if (FB.sketch === 'pen' || FB.sketch === 'marker') { const lx = p[p.length - 2], ly = p[p.length - 1]; if (Math.hypot(w.x - lx, w.y - ly) > 2 / z) p.push(w.x, w.y); }
    else { p.length = 2; p.push(w.x, w.y); }
    drawDraftMark(); return;
  }
  if (DRAG.kind === 'fbnew') { OV.area = rectFrom(DRAG.wx, DRAG.wy, w.x, w.y); drawOverlaySoon(); }
}
function drawDraftMark() {
  const L = $('#fbLayer'); if (!L) return;
  let g = L.querySelector('#fbLive'); if (!g) { renderMarks(); const svg = L.querySelector('svg'); g = svgEl('g', { id: 'fbLive' }); svg.append(g); }
  const z = view().z; const m = { t: FB.sketch, c: FB.color, w: rnd((FB.sketch === 'marker' ? 16 : 3) / z, 2), pts: DRAG.pts };
  g.innerHTML = markSVG(m, 0, 0);
}
function fbUp(e) {
  const d = Object.assign({}, DRAG);
  if (d.kind === 'fbmark') {
    const r = fbAnchor(FB.draft) || { x: 0, y: 0 };
    const z = view().z;
    if (d.pts.length >= 4) {
      const pts = []; for (let i = 0; i < d.pts.length; i += 2) pts.push(rnd(d.pts[i] - r.x, 1), rnd(d.pts[i + 1] - r.y, 1));
      FB.draft.marks = [...(FB.draft.marks || []), { t: FB.sketch, c: FB.color, w: rnd((FB.sketch === 'marker' ? 16 : 3) / z, 2), pts: pts.slice(0, 1600) }];
    }
    renderMarks(); updateComposer(); return;
  }
  // a click pins to the layer under the pointer; a drag marks an area of the screen
  const area = OV.area; OV.area = null;
  if (FB.draft && (FB.draft.text || (FB.draft.marks || []).length)) { flashComposer(); return; }
  let it;
  if (d.moved && area && area.w > 6 && area.h > 6) {
    const fid = frameAt(d.sx, d.sy, false) || frameAt(d.sx, d.sy, true);
    const r = fid ? wrect(fid) : { x: 0, y: 0 };
    it = { node: fid || null, area: { x: rnd(area.x - r.x, 1), y: rnd(area.y - r.y, 1), w: rnd(area.w, 1), h: rnd(area.h, 1) } };
  } else {
    const hc = chainAt(e.clientX, e.clientY);
    const w = toWorld(e.clientX, e.clientY);
    if (hc) { const id = e.altKey ? hc.chain[Math.min(1, hc.chain.length - 1)] : hc.chain[0]; const r = wrect(id); it = { node: id, dx: rnd(w.x - r.x, 1), dy: rnd(w.y - r.y, 1) }; }
    else it = { node: null, dx: rnd(w.x, 1), dy: rnd(w.y, 1) };
  }
  openComposer(Object.assign({ id: null, page: S.pageId, cat: FB.lastCat || 'visual', text: '', marks: [], status: 'open' }, it));
}

// ----- composer -----
function openComposer(item) {
  FB.draft = item; FB.sel = null; FB.sketch = null; FB.confirmDel = null;
  let ed = $('#fbEd');
  if (!ed) { ed = h('div', { id: 'fbEd', role: 'dialog', 'aria-label': 'Feedback' }); $('#stage').append(ed); }
  ed.textContent = '';
  const ta = h('textarea', { rows: 3, placeholder: 'What should change? e.g. “More space between the cards”', 'aria-label': 'Feedback' });
  ta.value = item.text || '';
  ta.addEventListener('input', () => { FB.draft.text = ta.value; });
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && modKey(e)) { e.preventDefault(); postDraft(); } if (e.key === 'Escape') { e.preventDefault(); closeComposer(); } });
  const cats = h('div', { class: 'fbcats', role: 'group', 'aria-label': 'Kind of feedback' });
  for (const [k, c] of Object.entries(FB_CATS)) {
    const b = h('button', { 'aria-pressed': String(item.cat === k), onclick: () => { FB.draft.cat = k; FB.lastCat = k; $$('button', cats).forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawOverlaySoon(); } }, c.name);
    b.style.setProperty('--c', c.color); cats.append(b);
  }
  const sk = h('div', { class: 'fbsk' },
    h('span', { text: 'Sketch', style: { color: 'var(--muted)', fontSize: '11px', marginRight: '2px' } }),
    ...[['pen', 'pencil', 'Pen'], ['marker', 'highlighter', 'Highlighter'], ['arrow', 'move-up-right', 'Arrow'], ['box', 'square', 'Box']].map(([k, ic, t]) => h('button', { class: 'tb', 'data-sk': k, title: t + ' — draw on the canvas', 'aria-label': t, 'aria-pressed': 'false', onclick: () => { FB.sketch = FB.sketch === k ? null : k; updateComposer(); } }, ico(ic))),
    h('span', { class: 'sep' }),
    ...MARK_COLORS.map(c => h('button', { class: 'dot', 'data-c': c, title: c, 'aria-label': 'Colour ' + c, style: { background: c }, onclick: () => { FB.color = c; updateComposer(); } })),
    h('button', { class: 'tb', title: 'Remove last mark', 'aria-label': 'Remove last mark', 'data-undo': '1', onclick: () => { FB.draft.marks = (FB.draft.marks || []).slice(0, -1); renderMarks(); updateComposer(); } }, ico('undo-2')));
  ed.append(
    h('div', { class: 'fbh' }, h('b', { text: item.id ? '#' + item.n : 'New feedback' }), h('span', { text: 'on ' + fbWhere(item), style: { color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } })),
    cats, ta, sk,
    h('div', { class: 'fbf' }, h('span', { class: 'kbd', text: MOD + '↵' }), h('span', { class: 'grow' }), h('button', { class: 'btn sm ghost', onclick: closeComposer }, 'Cancel'), h('button', { class: 'btn sm primary', id: 'fbPost', onclick: postDraft }, item.id ? 'Save' : 'Post')));
  ed.hidden = false;
  updateComposer(); placeComposer(); renderMarks(); drawOverlay();
  setTimeout(() => ta.focus(), 0);
}
function updateComposer() {
  const ed = $('#fbEd'); if (!ed || !FB.draft) return;
  $$('[data-sk]', ed).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sk === FB.sketch)));
  $$('.dot', ed).forEach(b => b.classList.toggle('on', b.dataset.c === FB.color));
  const u = $('[data-undo]', ed); if (u) u.disabled = !(FB.draft.marks || []).length;
  $('#stage').classList.toggle('sketching', !!FB.sketch);
}
function placeComposer() {
  const ed = $('#fbEd'); if (!ed || ed.hidden || !FB.draft) return;
  const pt = fbPoint(FB.draft); const sr = stageRect();
  let x = 40, y = 40;
  if (pt) { const p = toStage(pt.x, pt.y); x = p.x + 20; y = p.y - 10; }
  const W = ed.offsetWidth || 320, Hh = ed.offsetHeight || 220;
  if (x + W > sr.width - 8) x = Math.max(8, (pt ? toStage(pt.x, pt.y).x : x) - W - 20);
  ed.style.left = clamp(x, 8, Math.max(8, sr.width - W - 8)) + 'px';
  ed.style.top = clamp(y, 8, Math.max(8, sr.height - Hh - 8)) + 'px';
}
function flashComposer() { const ed = $('#fbEd'); if (!ed) return; ed.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 240 }); const t = $('textarea', ed); t && t.focus(); }
function closeComposer() { FB.draft = null; FB.sketch = null; const ed = $('#fbEd'); if (ed) ed.hidden = true; $('#stage').classList.remove('sketching'); renderMarks(); drawOverlay(); $('#stage').focus({ preventScroll: true }); }
function postDraft() {
  const d = FB.draft; if (!d) return;
  if (!(d.text || '').trim() && !(d.marks || []).length) { flashComposer(); return; }
  const it = Object.assign({}, d);
  if (!it.id) Object.assign(it, { id: 'F' + Date.now().toString(36) + uid(4), n: nextFbNumber(), by: S.me.id || null, at: new Date().toISOString(), status: 'open' });
  it.text = (it.text || '').trim().slice(0, 4000);
  FB.draft = null; FB.sketch = null;
  fbSave(it);
  const ed = $('#fbEd'); if (ed) ed.hidden = true; $('#stage').classList.remove('sketching');
  FB.sel = null; renderMarks(); drawOverlay();
  toast(`Feedback #${it.n} added`);
}
function fbAction(act, id) {
  const it = FB.items.get(id); if (!it) return;
  if (act === 'close') { FB.sel = null; FB.confirmDel = null; drawOverlay(); return; }
  if (act === 'edit') { openComposer(clone(it)); return; }
  if (act.startsWith('status:')) { fbPatch(id, { status: act.slice(7) }); return; }
  if (act === 'fix') { fixWithClaude([id]); return; }
  if (act === 'revert') { revertFeedback(id); return; }
  if (act === 'del') { if (FB.confirmDel === id) { FB.confirmDel = null; fbDelete(id); } else { FB.confirmDel = id; drawOverlay(); } return; }
}
function selectFeedback(id, reveal) {
  const it = FB.items.get(id); if (!it) return;
  FB.sel = id; FB.confirmDel = null;
  if (it.node && get(it.node) && get(it.node).page !== S.pageId) goPage(get(it.node).page, true);
  else if (!it.node && it.page !== S.pageId) goPage(it.page, true);
  renderMarks(); drawOverlay();
  if (S.ltab === 'feedback') renderFeedbackPanel();
  if (reveal) requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = fbAnchor(it); if (!r) return;
    const box = it.area ? { x: r.x + it.area.x, y: r.y + it.area.y, w: it.area.w, h: it.area.h } : it.node ? r : { x: r.x + it.dx - 100, y: r.y + it.dy - 100, w: 200, h: 200 };
    const v = view(), sr = stageRect(); const inView = box.x * v.z + v.x > 0 && box.y * v.z + v.y > 0 && (box.x + box.w) * v.z + v.x < sr.width - 300 && (box.y + box.h) * v.z + v.y < sr.height - 80;
    if (!inView) { const z = Math.min(1.5, Math.max(v.z, 0.4)); v.z = z; v.x = (sr.width - 300) / 2 - (box.x + box.w / 2) * z; v.y = (sr.height - 80) / 2 - (box.y + box.h / 2) * z; applyView(); }
    drawOverlay();
  }));
}
// reverting an item undoes every history step linked to it, newest first, then reopens it
function revertFeedback(id) {
  const it = FB.items.get(id); if (!it) return;
  const steps = (it.log || []).map(l => LOG.items.get(l)).filter(l => l && !l.revertedBy).sort((a, b) => b.t - a.t);
  if (!steps.length) { toast('No changes to revert for this item'); return; }
  let n = 0; for (const s of steps) { const r = revertLog(s.id, 'force'); if (r && r.ok) n++; }
  fbPatch(id, { status: 'open', reply: (it.reply ? it.reply + ' ' : '') + '(reverted)' });
  toast(`Reverted ${n} step${n === 1 ? '' : 's'} for #${it.n}`);
}

// ----- the Feedback panel -----
function updateTabCounts() {
  const b = $('[data-ltab="feedback"]'); if (!b) return;
  const n = [...FB.items.values()].filter(isOpen).length;
  b.textContent = 'Feedback'; if (n) b.append(h('span', { class: 'cnt', text: String(n) }));
}
function renderFeedbackPanel() {
  const box = $('#lFeedback'); if (!box || box.hidden) return;
  const scroll = box.scrollTop;
  box.textContent = '';
  const all = [...FB.items.values()];
  const open = all.filter(isOpen);
  const wrap = h('div', { class: 'fbpanel' });
  wrap.append(h('div', { class: 'stack', style: { padding: '10px 12px', gap: '8px', borderBottom: '1px solid var(--line)' } },
    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      segm([{ v: 'open', label: `Open ${open.length}` }, { v: 'done', label: `Done ${all.length - open.length}` }, { v: 'all', label: 'All' }], FB.filter, v => { FB.filter = v; lsSet('pinup.fbfilter', v); renderMarks(); drawOverlay(); renderFeedbackPanel(); }, { aria: 'Filter' }),
      h('button', { class: 'tb', title: FB.show ? 'Hide pins on canvas' : 'Show pins on canvas', 'aria-label': 'Toggle pins', 'aria-pressed': String(FB.show), onclick: () => { FB.show = !FB.show; lsSet('pinup.fbshow', FB.show); renderMarks(); drawOverlay(); renderFeedbackPanel(); } }, ico(FB.show ? 'eye' : 'eye-off'))),
    open.length ? h('div', { class: 'stack', style: { gap: '6px' } },
      h('button', { class: 'btn primary', disabled: !canSend(), title: canSend() ? 'Hand the open items to Claude in this conversation' : 'Open this artifact beside a Claude conversation to send', onclick: () => sendFeedbackToChat(open) }, ico('send'), `Send ${open.length} open to Claude`),
      SAMPLE.fn && S.canEdit ? h('button', { class: 'btn', onclick: () => fixWithClaude(open.map(i => i.id)) }, ico('sparkles'), 'Fix them here, one by one') : null) : null,
    h('button', { class: 'btn ghost sm', style: { justifySelf: 'start' }, disabled: !S.canFeedback, onclick: () => { setTool('feedback'); toast('Click a layer, or drag over an area'); } }, ico('message-square-plus'), 'New feedback (N)')));
  const list = all.filter(it => FB.filter === 'all' || (FB.filter === 'open' ? isOpen(it) : !isOpen(it))).sort((a, b) => (a.n || 0) - (b.n || 0));
  if (!all.length) wrap.append(h('div', { class: 'blank' }, h('b', { text: 'Leave feedback right on the design.' }), h('p', { style: { margin: '6px 0 0' }, text: 'Pick the Feedback tool (N), click any layer or drag over an area, say what should change, and sketch arrows or boxes if it helps. Then send the list to Claude: it works through the items one at a time, and every change lands as its own step in History that you can revert.' })));
  else if (!list.length) wrap.append(h('div', { class: 'blank', text: FB.filter === 'open' ? 'Nothing open. Nice.' : 'Nothing here yet.' }));
  // group by screen
  const groups = new Map();
  for (const it of list) { const n = it.node && get(it.node); const t = n ? topOf(it.node) : null; const k = t ? t.id : 'page:' + it.page; if (!groups.has(k)) groups.set(k, { name: t ? t.name : pageName(it.page), items: [] }); groups.get(k).items.push(it); }
  for (const g of groups.values()) {
    wrap.append(h('div', { class: 'hd', text: g.name }));
    for (const it of g.items) {
      const cat = fbCat(it.cat); const st = it.status || 'open';
      const logs = (it.log || []).filter(l => LOG.items.get(l) && !LOG.items.get(l).revertedBy);
      const row = h('div', { class: 'fbrow' + (FB.sel === it.id ? ' on' : ''), role: 'button', tabindex: 0, onclick: e => { if (e.target.closest('button')) return; selectFeedback(it.id, true); }, onkeydown: e => { if (e.key === 'Enter') selectFeedback(it.id, true); } },
        cssVar(h('span', { class: 'fbnum' + (isOpen(it) ? '' : ' done'), text: isOpen(it) ? String(it.n || '') : '✓' }), '--c', cat.color),
        h('div', { class: 'fbbody' },
          h('div', { class: 'fbtx', text: it.text || '(sketch only)' }),
          h('div', { class: 'fbmeta' }, h('span', { text: cat.name, style: { color: cat.color, fontWeight: 600 } }), ` · ${it.by === 'claude' ? 'Claude' : nameOf(it.by)} · ${relTime(it.at)}${(it.marks || []).length ? ' · sketch' : ''}${it.area ? ' · area' : ''}`),
          it.reply ? h('div', { class: 'fbreply' }, h('b', { text: it.doneBy === 'claude' ? 'Claude: ' : 'Note: ' }), it.reply) : null,
          h('div', { class: 'fbacts' },
            st === 'doing' || FB.busy.has(it.id) ? h('span', { class: 'fbst st-doing', text: 'In progress' }) : null,
            S.canFeedback ? (isOpen(it) ? h('button', { class: 'btn sm ghost', onclick: () => fbPatch(it.id, { status: 'done' }) }, 'Done') : h('button', { class: 'btn sm ghost', onclick: () => fbPatch(it.id, { status: 'open' }) }, 'Reopen')) : null,
            SAMPLE.fn && S.canEdit && isOpen(it) ? h('button', { class: 'btn sm ghost', disabled: FB.busy.has(it.id), onclick: () => fixWithClaude([it.id]) }, 'Fix with Claude') : null,
            logs.length && S.canEdit ? h('button', { class: 'btn sm ghost', onclick: () => revertFeedback(it.id) }, `Revert ${logs.length === 1 ? 'change' : logs.length + ' steps'}`) : null)));
      wrap.append(row);
    }
  }
  // reviewer comments live in the platform's own comment threads
  wrap.append(h('div', { class: 'sec', style: { borderTop: '1px solid var(--line)', borderBottom: 0, marginTop: '8px' } },
    h('h3', null, h('span', { text: 'Reviewer comments' })),
    h('p', { class: 'note', text: 'People who can only comment use the comment tool (C). Their threads are pinned to layers too, and Claude can read them.' }),
    h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      CA.ctl ? h('button', { class: 'btn sm', onclick: () => setTool('comment') }, 'Show comments') : null,
      h('button', { class: 'btn sm', disabled: !canSend(), onclick: () => sendCommentsToChat() }, 'Send comments to Claude'))));
  box.append(wrap);
  box.scrollTop = scroll;
}

// ----- handing feedback to Claude in the conversation -----
function fbBrief(it) {
  const n = it.node && get(it.node);
  const out = { id: it.id, n: it.n, cat: it.cat, text: (it.text || '').slice(0, 400), layer: n ? { id: n.id, name: n.name, screen: (topOf(n.id) || n).name } : null };
  if (it.area) out.area = it.area;
  if ((it.marks || []).length) out.sketch = it.marks.map(m => m.t === 'arrow' ? `arrow ${m.pts.slice(0, 2).map(Math.round)}→${m.pts.slice(2, 4).map(Math.round)}` : m.t === 'box' ? `box ${m.pts.slice(0, 4).map(Math.round)}` : m.t).join('; ');
  return out;
}
function sendFeedbackToChat(items) {
  if (!PEOPLE.room || !canSend()) { toast('No conversation is open beside this page.'); return; }
  const what = 'Pinup feedback to work through one item at a time. For each item write ONE step doc to the artifact db: inbox/<stepId> = {kind:"step", feedback:"<item id>", label:"short description", reply:"one line on what you changed", ops:[{op:"update",id,data}|{op:"set",id,data}|{op:"delete",id}|{op:"html",html,parent?,replace?}]}. The open editor tab applies each step as its own history entry the user can revert, and marks the item done. Read full items in the feedback collection; coordinates are px relative to the layer.';
  const data = { label: `Pinup feedback · ${items.length} open`, what, file: S.file.name, items: [] };
  for (const it of items.sort((a, b) => a.n - b.n)) { const b = fbBrief(it); data.items.push(b); if (JSON.stringify(data).length > 3600) { data.items.pop(); data.more = items.length - data.items.length; break; } }
  PEOPLE.room.sendToClaudeSession(data, { deliver: 'send' }).then(() => toast('Sent to Claude — check the conversation')).catch(err => toast(err && err.code === 'rate_limited' ? 'Slow down a moment, then try again' : 'Could not reach the conversation'));
}

// ----- Claude in the page fixes items one by one -----
async function fixWithClaude(ids) {
  if (!SAMPLE.fn || !S.canEdit) { toast('Claude is not available here — send the items to the chat instead.'); return; }
  const queue = ids.map(id => FB.items.get(id)).filter(it => it && isOpen(it) && !FB.busy.has(it.id)).sort((a, b) => a.n - b.n);
  for (const it of queue) {
    FB.busy.add(it.id); fbPatch(it.id, { status: 'doing' });
    const g = 'fb-' + it.id + '-' + Date.now();
    const label = `#${it.n} ${(it.text || 'Sketch').slice(0, 48)}`;
    CUR_GROUP = g; CUR_META = { by: 'claude', feedback: it.id, label };
    let reply = null;
    try {
      const n = it.node && get(it.node); const t = n ? topOf(n.id) : null;
      const ctx = { item: fbBrief(it), screen: t ? compactNode(t, 5) : null, layer: n && n !== t ? compactNode(n, 3) : null, tokens: S.file.tokens, components: components().map(c => ({ id: c.id, name: c.name })) };
      const prompt = `${CLAUDE_BRIEF}\n\nYou are resolving ONE review item on this design. Make the smallest set of changes that fully addresses it, and nothing else. If it is a question, answer it and change nothing. Sketch coordinates are px relative to the pinned layer's top-left.\n\nContext (JSON):\n${JSON.stringify(ctx).slice(0, 50000)}\n\nFeedback #${it.n} (${fbCat(it.cat).name}): ${it.text || '(see sketch)'}`;
      const res = await SAMPLE.fn(prompt, { tools: claudeTools(), cache: false, onText: u => { const o = $('#askOut'); if (o) { $('#ask').classList.remove('min'); o.textContent = `#${it.n}: ` + (u.text || 'Working…'); } } });
      reply = (res.text || 'Done.').trim().slice(0, 600);
    } catch (err) { toast(`#${it.n}: ` + ((err && err.message) || 'Claude could not finish this one')); }
    finally { CUR_GROUP = null; CUR_META = null; FB.busy.delete(it.id); }
    const logIds = H.undo.filter(e => e.group === g).map(e => e.logId);
    if (reply != null) fbPatch(it.id, { status: logIds.length || fbCat(it.cat) === FB_CATS.question ? 'done' : 'open', reply, doneBy: 'claude', doneAt: new Date().toISOString(), log: [...(it.log || []), ...logIds] });
    else fbPatch(it.id, { status: 'open' });
    await sleep(400);
  }
}

// ----- steps Claude writes into inbox/ from the conversation -----
const STEP_KEYS = ALLOWED_KEYS;
async function applyStep(id, d) {
  let it = null;
  if (d.feedback) { const k = String(d.feedback).replace(/^#/, ''); it = FB.items.get(d.feedback) || [...FB.items.values()].find(x => String(x.n) === k); }
  const label = (it ? `#${it.n} ` : '') + String(d.label || 'Claude step').slice(0, 80);
  const g = 'step-' + id;
  if (it) fbPatch(it.id, { status: 'doing' });
  CUR_GROUP = g; CUR_META = { by: 'claude', feedback: it ? it.id : null, label };
  let ok = true;
  try {
    const ops = Array.isArray(d.ops) ? d.ops : [];
    if (d.html) ops.push({ op: 'html', html: d.html, parent: d.parent, replace: d.replace, x: d.x, y: d.y, name: d.name, page: d.page });
    for (const op of ops.slice(0, 400)) {
      if (!op || typeof op !== 'object') continue;
      if (op.op === 'html' && op.html) await importHTML(op.html, { page: op.page && S.file.pages.find(p => p.id === op.page) ? op.page : (op.replace && get(op.replace) ? get(op.replace).page : S.pageId), parent: op.parent || null, replace: op.replace, x: op.x, y: op.y, name: op.name, label });
      else if (op.op === 'update' && op.id && get(op.id)) { const p = {}; for (const k in (op.data || {})) if (STEP_KEYS.has(k)) p[k] = op.data[k]; if (p.icon && ICONS[p.icon]) p.svg = iconMarkup(p.icon); commit([{ id: op.id, after: Object.assign({}, get(op.id), p) }], { label }); }
      else if (op.op === 'set' && op.id && op.data) commit([{ id: op.id, after: Object.assign({}, op.data, { id: op.id }) }], { label });
      else if (op.op === 'delete' && op.id && get(op.id)) removeNodes([op.id], label);
      else if (op.op === 'tokens' && op.data) { const t = clone(S.file.tokens); Object.assign(t.colors, op.data.colors || {}); Object.assign(t.type, op.data.type || {}); setFile({ tokens: t }, { label }); }
    }
  } catch (err) { ok = false; console.warn('[pinup] step failed', err); toast('A Claude step could not be applied: ' + label); }
  finally { CUR_GROUP = null; CUR_META = null; }
  const logIds = H.undo.filter(e => e.group === g).map(e => e.logId);
  if (it) fbPatch(it.id, { status: ok ? (d.status || 'done') : 'open', reply: d.reply ? String(d.reply).slice(0, 600) : (it.reply || null), doneBy: 'claude', doneAt: new Date().toISOString(), log: [...(it.log || []), ...logIds] });
  if (ok) toast('Claude · ' + label, 2600);
  return ok;
}

function cssVar(el, k, v) { el.style.setProperty(k, v); return el; }
