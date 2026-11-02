// ---------- view ----------
function view() { let v = S.views[S.pageId]; if (!v) v = S.views[S.pageId] = { x: 80, y: 80, z: 1 }; return v; }
const saveViews = debounce(() => lsSet('pinup.views', S.views), 400);
function applyView() {
  const v = view(), st = $('#stage');
  $('#world').style.transform = `translate(${rnd(v.x, 2)}px, ${rnd(v.y, 2)}px) scale(${v.z})`;
  const fl = $('#fbLayer'); if (fl) fl.style.transform = $('#world').style.transform;
  const g = 24 * v.z;
  st.classList.toggle('grid-dots', S.grid && v.z >= 0.35);
  st.style.backgroundSize = `${g}px ${g}px`;
  st.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('#bZoom').textContent = Math.round(v.z * 100) + '%';
  saveViews();
  drawOverlaySoon();
}
function stageRect() { return $('#stage').getBoundingClientRect(); }
function toWorld(cx, cy) { const r = stageRect(), v = view(); return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; }
function toStage(wx, wy) { const v = view(); return { x: wx * v.z + v.x, y: wy * v.z + v.y }; }
function zoomAt(z, sx, sy) {
  const v = view(); z = clamp(z, 0.02, 64);
  if (sx == null) { const r = stageRect(); sx = r.width / 2; sy = r.height / 2; }
  const wx = (sx - v.x) / v.z, wy = (sy - v.y) / v.z;
  v.z = z; v.x = sx - wx * z; v.y = sy - wy * z; applyView();
}
function fitRect(r, pad = 60, maxZ = 1) {
  if (!r) return;
  const sr = stageRect(); const v = view();
  const askH = $('#ask').hidden ? 0 : 70;
  const W = Math.max(50, sr.width - pad * 2), Hh = Math.max(50, sr.height - pad * 2 - askH);
  const z = clamp(Math.min(W / Math.max(1, r.w), Hh / Math.max(1, r.h), maxZ), 0.02, 8);
  v.z = z; v.x = (sr.width - r.w * z) / 2 - r.x * z; v.y = (sr.height - askH - r.h * z) / 2 - r.y * z; applyView();
}
function zoomFitAll() { const rs = roots().filter(n => n.visible).map(n => wrect(n.id)); fitRect(union(rs)); }
function zoomFitSel() { if (!S.sel.length) return zoomFitAll(); fitRect(union(S.sel.map(id => wrect(id))), 60, 4); }
function centerOn(id) {
  const r = wrect(id); if (!r) return;
  const sr = stageRect(), v = view();
  if (r.w * v.z > sr.width * 0.9 || r.h * v.z > sr.height * 0.9) return fitRect(r);
  v.x = sr.width / 2 - (r.x + r.w / 2) * v.z; v.y = sr.height / 2 - (r.y + r.h / 2) * v.z; applyView();
}
function union(rs) {
  rs = rs.filter(Boolean); if (!rs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
const hit = (r, x, y) => r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const overlaps = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// world rect of a node from the DOM (unrotated box when the node itself is rotated)
function wrect(id, mid) {
  const el = elOf(id, mid);
  if (!el) { const n = get(id); if (!n) return null; let x = n.x, y = n.y; for (const a of ancestors(id)) { x += a.x; y += a.y; } return { x, y, w: n.w, h: n.h }; }
  const v = view(), wr = $('#world').getBoundingClientRect(), b = el.getBoundingClientRect();
  const n = get(id);
  if (n && n.rot && !mid) {
    const cx = (b.left + b.width / 2 - wr.left) / v.z, cy = (b.top + b.height / 2 - wr.top) / v.z;
    return { x: cx - el.offsetWidth / 2, y: cy - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight };
  }
  return { x: (b.left - wr.left) / v.z, y: (b.top - wr.top) / v.z, w: b.width / v.z, h: b.height / v.z };
}
// rect relative to its parent's box
function lrect(id) {
  const n = get(id); const r = wrect(id); if (!r) return null;
  if (!n.parent) return r;
  const p = wrect(n.parent); return { x: r.x - p.x, y: r.y - p.y, w: r.w, h: r.h };
}

// ---------- selection ----------
function select(ids, opts = {}) {
  ids = [...new Set(ids)].filter(id => S.nodes.has(id));
  if (same(ids, S.sel) && !opts.force) return;
  S.sel = ids;
  for (const id of ids) for (const a of ancestors(id)) S.open.add(a.id);
  lsSet('pinup.open', [...S.open].slice(-300));
  DIRTY.chrome = true; scheduleRender();
  presenceSoon();
  if (opts.reveal) setTimeout(() => { const row = $(`#tree [data-id="${ids[0]}"]`); row && row.scrollIntoView({ block: 'nearest' }); }, 30);
}
function selNodes() { return S.sel.map(get).filter(Boolean); }
// drop children whose ancestor is also selected
function selRoots(ids = S.sel) { const set = new Set(ids); return ids.filter(id => !ancestors(id).some(a => set.has(a.id))); }

// hit chain under a point: deepest → top-level, skipping locked and anything inside instances
function chainAt(cx, cy) {
  const els = document.elementsFromPoint(cx, cy);
  const world = $('#world');
  for (const e of els) {
    if (!world.contains(e) || e === world) continue;
    const t = e.closest('[data-nid]'); if (!t) continue;
    const chain = []; let x = t;
    while (x && x !== world) { if (x.dataset && x.dataset.nid) { const id = x.dataset.nid; if (chain[chain.length - 1] !== id) chain.push(id); } x = x.parentElement; }
    const ok = chain.filter(id => { const n = get(id); return n && !n.locked; });
    if (!ok.length || chain.some(id => get(id) && get(id).locked && ok.indexOf(id) === -1 && ok.length === 0)) continue;
    // a locked ancestor locks its subtree
    const lockedAt = chain.findIndex(id => get(id) && get(id).locked);
    const usable = lockedAt === -1 ? chain : chain.slice(lockedAt + 1);
    if (!usable.length) continue;
    return { chain: usable, el: e };
  }
  return null;
}
function pickFrom(chain, e) {
  if (!chain || !chain.length) return null;
  if (e && modKey(e)) return chain[0];
  const selSet = new Set(S.sel);
  const already = chain.find(id => selSet.has(id));
  if (already) return already;
  if (S.sel.length) {
    const p = get(S.sel[0]) ? get(S.sel[0]).parent : null;
    const sib = chain.find(id => get(id).parent === p && p !== null);
    if (sib) return sib;
    const deeper = chain.find(id => S.sel.some(s => isAnc(s, id)) && get(id).parent && S.sel.includes(get(id).parent));
    if (deeper) return deeper;
  }
  const top = chain[chain.length - 1];
  const tn = get(top);
  if (chain.length === 1) return top;
  if (tn.type === 'frame' && !tn.group) return chain[chain.length - 2];
  return top; // groups and loose nodes select whole
}

// ---------- overlay ----------
const OV = { guides: [], marquee: null, ins: null, drop: null, wire: null, area: null, measure: null };
const drawOverlaySoon = rafThrottle(() => drawOverlay());
function drawOverlay() {
  const ov = $('#ov'); if (!ov) return;
  const v = view(), z = v.z;
  const sp = (x, y) => ({ x: x * z + v.x, y: y * z + v.y });
  let html = '', svg = '';
  const proto = S.tab === 'proto';
  // frame labels
  for (const n of roots()) {
    if (!n.visible || n.type !== 'frame' || n.group) continue;
    const r = wrect(n.id); if (!r) continue;
    const p = sp(r.x, r.y); const w = Math.max(24, r.w * z);
    const on = S.sel.includes(n.id);
    html += `<div class="flabel${on ? ' on' : ''}${n.component ? ' comp' : ''}" data-frame="${n.id}" style="transform:translate(${p.x}px,${p.y - 20}px);max-width:${w}px">${n.flow ? `<span class="flow">▶ ${esc(n.flow)}</span>` : ''}${n.component ? '◆ ' : ''}${esc(n.name)}</div>`;
  }
  const box = (r, cls, extra = '') => { const p = sp(r.x, r.y); return `<div class="box ${cls}" style="transform:translate(${p.x}px,${p.y}px);width:${r.w * z}px;height:${r.h * z}px;${extra}"></div>`; };
  // peers' selections
  for (const pr of S.peers) {
    if (pr.isMe || !pr.presence || pr.presence.page !== S.pageId) continue;
    for (const id of (pr.presence.sel || []).slice(0, 20)) { const r = get(id) && wrect(id); if (r) html += box(r, 'peer', `--pc:${pr._color}`); }
  }
  // hover
  if (S.hover && !S.sel.includes(S.hover) && get(S.hover) && !DRAG.active) { const r = wrect(S.hover); if (r) html += box(r, 'hov' + (get(S.hover).type === 'instance' ? ' inst' : '')); }
  // selection
  const sel = S.sel.filter(id => get(id) && get(id).page === S.pageId && elOf(id));
  if (sel.length && !S.editingOnly) {
    const rs = sel.map(id => wrect(id));
    if (sel.length > 1) rs.forEach(r => (html += box(r, '')));
    const u = union(rs);
    if (u && !(DRAG.active && DRAG.kind === 'move')) {
      html += box(u, sel.length === 1 && get(sel[0]).type === 'instance' ? 'inst' : '');
      if (S.canEdit && !S.editing && !proto && S.tool === 'move') {
        const n0 = get(sel[0]);
        const lineOnly = sel.length === 1 && n0.type === 'line';
        const hs = lineOnly ? ['w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const small = u.w * z < 24 || u.h * z < 24;
        for (const hnd of hs) {
          if (small && hnd.length === 1 && !lineOnly) continue;
          const hx = u.x + u.w * (hnd.includes('w') ? 0 : hnd.includes('e') ? 1 : 0.5);
          const hy = u.y + u.h * (hnd.includes('n') ? 0 : hnd.includes('s') ? 1 : 0.5);
          const p = sp(hx, hy);
          html += `<div class="hdl" data-h="${hnd}" style="transform:translate(${p.x}px,${p.y}px);cursor:${hcur(hnd)}"></div>`;
        }
      }
      const pb = sp(u.x + u.w / 2, u.y + u.h);
      const n0 = get(sel[0]);
      const tag = sel.length === 1 ? `${fmt(rnd(u.w, 1))} × ${fmt(rnd(u.h, 1))}${n0.sw === 'hug' || n0.sh === 'hug' ? ' hug' : ''}${n0.sw === 'fill' || n0.sh === 'fill' ? ' fill' : ''}` : `${fmt(rnd(u.w, 1))} × ${fmt(rnd(u.h, 1))}`;
      if (!S.editing) html += `<div class="dims" style="transform:translate(calc(${pb.x}px - 50%),${pb.y + 6}px)">${tag}</div>`;
    }
  }
  // drag feedback
  if (OV.drop) { const r = wrect(OV.drop); if (r) { const p = sp(r.x, r.y); html += `<div class="drop-frame" style="transform:translate(${p.x}px,${p.y}px);width:${r.w * z}px;height:${r.h * z}px"></div>`; } }
  if (OV.ins) { const p = sp(OV.ins.x, OV.ins.y); html += `<div class="ins" style="transform:translate(${p.x}px,${p.y}px);width:${Math.max(2, OV.ins.w * z)}px;height:${Math.max(2, OV.ins.h * z)}px"></div>`; }
  if (OV.marquee) { const m = OV.marquee, p = sp(m.x, m.y); html += `<div class="mq" style="transform:translate(${p.x}px,${p.y}px);width:${m.w * z}px;height:${m.h * z}px"></div>`; }
  if (OV.area) { const m = OV.area, p = sp(m.x, m.y); html += `<div class="mq" style="transform:translate(${p.x}px,${p.y}px);width:${m.w * z}px;height:${m.h * z}px;background:rgba(242,92,5,.08);box-shadow:0 0 0 1.5px var(--measure)"></div>`; }
  for (const g of OV.guides) { const a = sp(g.x1, g.y1), b = sp(g.x2, g.y2); svg += `<line class="guide" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }
  // measurements (hold Alt)
  if (OV.measure) for (const m of OV.measure) {
    const a = sp(m.x1, m.y1), b = sp(m.x2, m.y2);
    svg += `<line class="measure" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    html += `<div class="mtag" style="left:${(a.x + b.x) / 2}px;top:${(a.y + b.y) / 2}px">${fmt(rnd(m.d, 1))}</div>`;
  }
  // prototype wires
  if (proto) {
    for (const n of S.nodes.values()) {
      if (!n.link || n.page !== S.pageId || !elOf(n.id)) continue;
      const showAll = !S.sel.length || S.sel.includes(n.id) || S.sel.includes(topOf(n.id).id);
      if (!showAll) continue;
      const a = wrect(n.id); const on = S.sel.includes(n.id);
      if (n.link.to === 'back') { const p = sp(a.x + a.w, a.y + a.h / 2); html += `<div class="wtag" data-wire="${n.id}" style="left:${p.x + 26}px;top:${p.y}px">← Back</div>`; svg += `<path class="wire${on ? ' on' : ''}" d="M${p.x} ${p.y} h18"/><circle class="wdot" cx="${p.x}" cy="${p.y}" r="3"/>`; continue; }
      const t = get(n.link.to); if (!t || t.page !== S.pageId) continue;
      const b = wrect(t.id); if (!b) continue;
      const s = sp(a.x + a.w, a.y + a.h / 2), e = sp(b.x, b.y + Math.min(40, b.h / 2));
      const back = e.x < s.x;
      const e2 = back ? sp(b.x + b.w, b.y + Math.min(40, b.h / 2)) : e;
      const dx = Math.max(40, Math.abs(e2.x - s.x) / 2);
      svg += `<path class="wire${on ? ' on' : ''}" d="M${s.x} ${s.y} C${s.x + dx} ${s.y} ${back ? e2.x + dx : e2.x - dx} ${e2.y} ${e2.x} ${e2.y}"/><circle class="wdot" cx="${s.x}" cy="${s.y}" r="3"/><path class="wdot" d="M${e2.x} ${e2.y} l${back ? 7 : -7} -4.5 v9z"/>`;
    }
    if (S.canEdit && sel.length === 1 && !(DRAG.active && DRAG.kind === 'move')) {
      const r = wrect(sel[0]); const p = sp(r.x + r.w, r.y + r.h / 2);
      html += `<div class="wlink" data-wsrc="${sel[0]}" title="Drag to a frame to link" style="transform:translate(${p.x + 14}px,${p.y}px)"></div>`;
    }
    if (OV.wire) { svg += `<path class="wire on" d="M${OV.wire.x1} ${OV.wire.y1} L${OV.wire.x2} ${OV.wire.y2}"/>`; }
  }
  // peers' cursors
  for (const pr of S.peers) {
    const c = pr.presence && pr.presence.cur; if (pr.isMe || !c || pr.presence.page !== S.pageId) continue;
    const p = sp(c.x, c.y);
    html += `<div class="cursor" style="transform:translate(${p.x}px,${p.y}px);--pc:${pr._color}"><svg viewBox="0 0 16 16"><path d="M1 1l5 14 2-6 6-2z" fill="${pr._color}" stroke="#fff" stroke-width="1.2"/></svg><span>${esc(pr._name)}</span></div>`;
  }
  html += fbOverlayHTML(sp, z);
  ov.innerHTML = html + `<svg class="lines">${svg}</svg>`;
  placeComposer();
  reportPinsSoon();
}
function hcur(hd) { return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[hd]; }

// ---------- pointer interaction ----------
const DRAG = { active: false };
const PTRS = new Map();
let spaceDown = false, altDown = false;
let lastPointer = { x: 0, y: 0 };

const st0 = () => $('#stage');
function setTool(t) {
  if (t === 'comment' && !CA.ctl) { toast('Comments are not available in this view.'); return; }
  if (S.tool === 'comment' && t !== 'comment' && CA.ctl) { try { CA.ctl.exitMode(); } catch {} }
  if (!S.canEdit && !['move', 'hand', 'comment', 'feedback'].includes(t)) return;
  if (t !== 'feedback' && FB.draft && !(FB.draft.text || (FB.draft.marks || []).length)) closeComposer();
  S.tool = t;
  st0().classList.toggle('fbtool', t === 'feedback');
  const st = $('#stage');
  st.classList.toggle('draw', ['frame', 'rect', 'ellipse', 'line', 'text'].includes(t));
  st.classList.toggle('hand', t === 'hand');
  st.classList.toggle('comment', t === 'comment');
  $$('#tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  DIRTY.chrome = true; scheduleRender();
}

function onStageDown(e) {
  const stage = $('#stage');
  if (e.target.closest('#ask, .empty')) return;
  if (S.editing && e.target.closest('[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
  if (S.editing) finishEdit();
  closeMenu();
  if (e.target.closest('#fbEd')) return;
  const fa = e.target.closest('[data-fbact]');
  if (fa) { e.preventDefault(); fbAction(fa.dataset.fbact, fa.closest('[data-fbcard]').dataset.fbcard); return; }
  if (e.target.closest('.fbcard')) return;
  const fp = e.target.closest('[data-fb]');
  if (fp && fp.dataset.fb !== 'draft' && !(FB.draft && FB.sketch)) { e.preventDefault(); if (FB.sel === fp.dataset.fb) { FB.sel = null; drawOverlay(); } else selectFeedback(fp.dataset.fb); return; }
  if (FB.sel && S.tool !== 'feedback') { FB.sel = null; FB.confirmDel = null; drawOverlaySoon(); renderMarks(); }
  PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (PTRS.size === 2) { startPinch(); return; }
  if (PTRS.size > 2) return;
  stage.focus({ preventScroll: true });
  const w = toWorld(e.clientX, e.clientY);
  const base = { active: true, id0: e.pointerId, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, moved: false, shift: e.shiftKey, alt: e.altKey, mod: modKey(e) };
  // pan
  if (e.button === 1 || spaceDown || S.tool === 'hand' || (e.button === 0 && e.pointerType === 'touch' && !e.target.closest('[data-nid],.hdl,.flabel,.wlink') && S.tool === 'move')) {
    const v = view(); Object.assign(DRAG, base, { kind: 'pan', vx: v.x, vy: v.y }); stage.classList.add('panning'); capture(e); return;
  }
  if (e.button === 2) return;
  const hd = e.target.closest('.hdl');
  if (hd) return startResize(e, hd.dataset.h, base);
  const wl = e.target.closest('.wlink');
  if (wl) { Object.assign(DRAG, base, { kind: 'wire', src: wl.dataset.wsrc }); capture(e); return; }
  const wt = e.target.closest('.wtag');
  if (wt) { select([wt.dataset.wire]); return; }
  if (S.tool === 'comment') return commentDown(e, base);
  if (S.tool === 'feedback') { FB.sel = null; return fbDown(e, base); }
  const fl = e.target.closest('.flabel');
  if (fl) {
    const id = fl.dataset.frame;
    if (e.shiftKey) select(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]);
    else if (!S.sel.includes(id)) select([id]);
    if (S.canEdit && !get(id).locked) { Object.assign(DRAG, base, { kind: 'pending-move' }); capture(e); }
    return;
  }
  if (['frame', 'rect', 'ellipse', 'line', 'text'].includes(S.tool)) return startDraw(e, base);
  const hc = chainAt(e.clientX, e.clientY);
  if (hc) {
    const id = pickFrom(hc.chain, e);
    const tn = get(hc.chain[hc.chain.length - 1]);
    // empty area of a screen with children: click selects it, drag draws a marquee inside it
    if (id === tn.id && tn.type === 'frame' && !tn.group && kids(tn.id).length && hc.chain.length === 1 && !S.sel.includes(id)) {
      Object.assign(DRAG, base, { kind: 'marquee', scope: tn.id, clickSelect: id, prev: e.shiftKey ? [...S.sel] : [] }); capture(e); return;
    }
    if (e.shiftKey) { select(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel.filter(x => !isAnc(x, id) && !isAnc(id, x)), id]); }
    else if (!S.sel.includes(id)) select([id]);
    if (S.canEdit && !e.shiftKey) { Object.assign(DRAG, base, { kind: 'pending-move', clicked: id, multi: S.sel.length > 1 }); capture(e); }
    return;
  }
  // empty canvas
  Object.assign(DRAG, base, { kind: 'marquee', scope: null, prev: e.shiftKey ? [...S.sel] : [] });
  if (!e.shiftKey) select([]);
  capture(e);
}
function capture(e) { try { $('#stage').setPointerCapture(e.pointerId); } catch {} }

function onStageMove(e) {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (PTRS.has(e.pointerId)) PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (PINCH.on) return movePinch();
  const w = toWorld(e.clientX, e.clientY);
  presenceCursor(w);
  if (!DRAG.active) { hoverAt(e); return; }
  if (e.pointerId !== DRAG.id0) return;
  const dxs = e.clientX - DRAG.sx, dys = e.clientY - DRAG.sy;
  if (!DRAG.moved && Math.hypot(dxs, dys) < 3) return;
  const first = !DRAG.moved; DRAG.moved = true;
  const z = view().z;
  const dx = dxs / z, dy = dys / z;
  switch (DRAG.kind) {
    case 'pan': { const v = view(); v.x = DRAG.vx + dxs; v.y = DRAG.vy + dys; applyView(); break; }
    case 'pending-move': if (first) startMove(e); if (DRAG.kind === 'move') moveMove(e, dx, dy); break;
    case 'move': moveMove(e, dx, dy); break;
    case 'resize': moveResize(e, dx, dy); break;
    case 'draw': moveDraw(e, w); break;
    case 'marquee': moveMarquee(w); break;
    case 'area': OV.area = rectFrom(DRAG.wx, DRAG.wy, w.x, w.y); drawOverlaySoon(); break;
    case 'fbmark': case 'fbnew': fbMove(e, w); break;
    case 'wire': { const r = stageRect(); const src = wrect(DRAG.src); const p = toStage(src.x + src.w, src.y + src.h / 2); OV.wire = { x1: p.x, y1: p.y, x2: e.clientX - r.left, y2: e.clientY - r.top }; const t = frameAt(e.clientX, e.clientY, true); OV.drop = t && t !== topOf(DRAG.src).id ? t : null; drawOverlaySoon(); break; }
  }
}
function onStageUp(e) {
  PTRS.delete(e.pointerId);
  if (PINCH.on) { if (PTRS.size < 2) PINCH.on = false; return; }
  if (!DRAG.active || e.pointerId !== DRAG.id0) return;
  const d = Object.assign({}, DRAG);
  DRAG.active = false;
  $('#stage').classList.remove('panning');
  switch (d.kind) {
    case 'pending-move': if (d.multi && !d.moved && d.clicked && !d.shift) select([d.clicked]); break;
    case 'move': endMove(e); break;
    case 'resize': endResize(); break;
    case 'draw': endDraw(e); break;
    case 'marquee': if (!d.moved) { if (d.clickSelect) select([d.clickSelect]); else if (!d.shift) select([]); } break;
    case 'area': endArea(e); break;
    case 'fbmark': case 'fbnew': fbUp(e); break;
    case 'wire': {
      OV.wire = null; const t = OV.drop; OV.drop = null;
      if (t && d.moved) { const n = get(d.src); patch(d.src, { link: Object.assign({ on: 'click', tr: 'dissolve', dur: 250 }, n.link || {}, { to: t }) }, { label: 'Link' }); toast('Linked to ' + get(t).name); }
      drawOverlay(); break;
    }
  }
  OV.marquee = null; OV.guides = []; OV.ins = null; OV.drop = null;
  drawOverlaySoon();
}
function hoverAt(e) {
  if (S.tool !== 'move' || e.target.closest('#ov .flabel,#ov .hdl,#ask')) { if (S.hover) { S.hover = null; drawOverlaySoon(); } return; }
  const hc = chainAt(e.clientX, e.clientY);
  let id = hc ? pickFrom(hc.chain, e) : null;
  if (hc && id === hc.chain[hc.chain.length - 1] && hc.chain.length === 1 && get(id).type === 'frame' && kids(id).length) id = null;
  if (altDown && S.sel.length) { measureTo(id || (hc && hc.chain[hc.chain.length - 1]) || null); }
  if (id !== S.hover) { S.hover = id; drawOverlaySoon(); }
}
function rectFrom(x1, y1, x2, y2) { return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }; }

// ----- pinch (touch) -----
const PINCH = { on: false };
function startPinch() {
  DRAG.active = false; OV.marquee = null;
  const [a, b] = [...PTRS.values()]; const v = view(); const r = stageRect();
  Object.assign(PINCH, { on: true, d0: Math.hypot(a.x - b.x, a.y - b.y), z0: v.z, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, vx: v.x, vy: v.y });
}
function movePinch() {
  const [a, b] = [...PTRS.values()]; if (!a || !b) return;
  const r = stageRect(); const v = view();
  const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
  const z = clamp(PINCH.z0 * d / Math.max(1, PINCH.d0), 0.02, 64);
  const wx = (PINCH.cx - PINCH.vx) / PINCH.z0, wy = (PINCH.cy - PINCH.vy) / PINCH.z0;
  v.z = z; v.x = cx - wx * z; v.y = cy - wy * z; applyView();
}

// ----- move -----
function frameAt(cx, cy, topOnly, exclude) {
  const els = document.elementsFromPoint(cx, cy); const world = $('#world');
  for (const e of els) {
    if (!world.contains(e) || e === world) continue;
    let x = e.closest('[data-nid]');
    while (x && x !== world) {
      const id = x.dataset.nid, n = get(id);
      if (n && !x.dataset.mid && n.type === 'frame' && !n.locked && !(exclude && exclude(id))) { if (!topOnly || !n.parent) return id; }
      x = x.parentElement && x.parentElement.closest('[data-nid]');
    }
  }
  return null;
}
function startMove(e) {
  let ids = selRoots().filter(id => get(id) && !get(id).locked);
  if (!ids.length) { DRAG.kind = 'none'; return; }
  if (DRAG.alt) { ids = duplicate(ids, { inPlace: true, select: true, label: 'Duplicate' }); renderNow(); }
  DRAG.kind = 'move'; DRAG.ids = ids; DRAG.startSel = clone(ids.map(get));
  DRAG.rects = ids.map(id => wrect(id));
  DRAG.bbox = union(DRAG.rects);
  DRAG.origParents = ids.map(id => get(id).parent);
  // lift elements into a drag layer so clipping and flow don't fight the pointer
  const world = $('#world');
  const layer = h('div', { id: 'dragLayer', style: { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '9' } });
  layer.className = 'm-light';
  world.append(layer);
  DRAG.els = ids.map((id, i) => {
    const el = elOf(id); if (!el) return null; const r = DRAG.rects[i];
    const n = get(id);
    const mode = modeOf(n.parent || id);
    const wrap = h('div', { class: 'm-' + mode, style: { position: 'absolute', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } });
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; el.style.flex = 'none'; el.style.margin = '0';
    if (n.rot) { el.style.left = '0'; }
    wrap.append(el); layer.append(wrap); return wrap;
  });
  // snap candidates
  const ref = get(ids[0]);
  const sibs = (ref.parent ? kids(ref.parent) : roots()).filter(n => !ids.includes(n.id) && n.visible);
  const xs = [], ys = [];
  for (const s of sibs) { const r = wrect(s.id); if (!r) continue; xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h); }
  if (ref.parent) { const r = wrect(ref.parent); if (r) { xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h); } }
  DRAG.snapX = xs; DRAG.snapY = ys;
  S.hover = null;
}
function moveMove(e, dx, dy) {
  if (!DRAG.ids) return;
  const z = view().z; const b = DRAG.bbox;
  let nx = Math.round(b.x + dx), ny = Math.round(b.y + dy);
  OV.guides = [];
  if (!modKey(e)) {
    const th = 6 / z;
    const sx = snap1([nx, nx + b.w / 2, nx + b.w], DRAG.snapX, th), sy = snap1([ny, ny + b.h / 2, ny + b.h], DRAG.snapY, th);
    if (sx) { nx += sx.d; OV.guides.push({ x1: sx.v, y1: Math.min(ny, sx.v) - 4000, x2: sx.v, y2: ny + 4000 }); }
    if (sy) { ny += sy.d; OV.guides.push({ x1: nx - 4000, y1: sy.v, x2: nx + 4000, y2: sy.v }); }
    OV.guides = OV.guides.map(g => clipGuide(g, nx, ny, b));
  }
  if (e.shiftKey) { if (Math.abs(nx - b.x) > Math.abs(ny - b.y)) ny = b.y; else nx = b.x; }
  DRAG.ddx = nx - b.x; DRAG.ddy = ny - b.y;
  DRAG.els.forEach((w, i) => { if (w) { w.style.left = (DRAG.rects[i].x + DRAG.ddx) + 'px'; w.style.top = (DRAG.rects[i].y + DRAG.ddy) + 'px'; } });
  // drop target
  const dragged = new Set(DRAG.ids);
  const isTopScreen = DRAG.ids.every(id => { const n = get(id); return !n.parent && n.type === 'frame' && !n.group; });
  let target = isTopScreen ? null : frameAt(e.clientX, e.clientY, false, id => dragged.has(id) || DRAG.ids.some(d => isAnc(d, id)));
  DRAG.target = target;
  OV.drop = null; OV.ins = null;
  if (target) {
    const t = get(target);
    if (t.layout) { const ins = insertionFor(t, e, dragged); DRAG.insIndex = ins.index; OV.ins = ins.line; }
    else if (target !== get(DRAG.ids[0]).parent) OV.drop = target;
  }
  drawOverlaySoon();
}
function snap1(vals, cands, th) {
  let best = null;
  for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: c }; }
  return best;
}
function clipGuide(g, nx, ny, b) { return g; }
function insertionFor(t, e, dragged) {
  const w = toWorld(e.clientX, e.clientY);
  const row = t.layout.dir === 'row';
  const list = kids(t.id).filter(k => !dragged.has(k.id) && k.visible && !k.abs);
  const tr = wrect(t.id);
  let index = list.length, line;
  for (let i = 0; i < list.length; i++) {
    const r = wrect(list[i].id); if (!r) continue;
    const mid = row ? r.x + r.w / 2 : r.y + r.h / 2;
    if ((row ? w.x : w.y) < mid) { index = i; break; }
  }
  const pad = t.layout.pad || [0, 0, 0, 0];
  if (!list.length) line = row ? { x: tr.x + pad[3], y: tr.y + pad[0], w: 2, h: Math.max(16, tr.h - pad[0] - pad[2]) } : { x: tr.x + pad[3], y: tr.y + pad[0], w: Math.max(16, tr.w - pad[1] - pad[3]), h: 2 };
  else {
    const ref = index < list.length ? wrect(list[index].id) : wrect(list[list.length - 1].id);
    const gap = t.layout.gap === 'auto' ? 0 : (t.layout.gap || 0);
    if (row) { const x = index < list.length ? ref.x - gap / 2 - 1 : ref.x + ref.w + gap / 2 - 1; line = { x, y: ref.y, w: 2, h: ref.h }; }
    else { const y = index < list.length ? ref.y - gap / 2 - 1 : ref.y + ref.h + gap / 2 - 1; line = { x: ref.x, y, w: ref.w, h: 2 }; }
  }
  return { index, line };
}
function endMove(e) {
  const layer = $('#dragLayer'); if (layer) layer.remove();
  if (!DRAG.ids || !DRAG.moved) { markAllDirty(); scheduleRender(); return; }
  const ids = DRAG.ids, ddx = DRAG.ddx || 0, ddy = DRAG.ddy || 0;
  const target = DRAG.target ? get(DRAG.target) : null;
  const changes = [];
  const parentsTouched = new Set();
  if (target && target.layout) {
    const dragged = new Set(ids);
    const list = kids(target.id).filter(k => !dragged.has(k.id));
    const flow = list.filter(k => k.visible && !k.abs);
    const at = DRAG.insIndex == null ? flow.length : DRAG.insIndex;
    const anchor = flow[at];
    const ordered = [];
    for (const k of list) { if (k === anchor) ordered.push(...ids.map(get)); ordered.push(k); }
    if (!anchor) ordered.push(...ids.map(get));
    ordered.forEach((k, i) => { const moving = dragged.has(k.id); const nn = Object.assign({}, k, { z: i }); if (moving) { nn.parent = target.id; nn.page = target.page; nn.abs = false; if (nn.sw === 'fill' && target.layout.dir !== 'row' && false) nn.sw = 'fixed'; } if (moving || k.z !== i) changes.push({ id: k.id, after: nn }); });
    ids.forEach(id => parentsTouched.add(get(id).parent));
  } else {
    const tr = target ? wrect(target.id) : { x: 0, y: 0 };
    ids.forEach((id, i) => {
      const n = get(id); const r = DRAG.rects[i];
      const newParent = target ? target.id : null;
      const pr = target ? tr : { x: 0, y: 0 };
      const nn = Object.assign({}, n, { x: Math.round(r.x + ddx - pr.x), y: Math.round(r.y + ddy - pr.y) });
      if (newParent !== n.parent) { nn.parent = newParent; nn.z = nextZ(newParent || 'page:' + n.page) + i; parentsTouched.add(n.parent); }
      const np = newParent ? get(newParent) : null;
      if (inLayout(n) && !(np && np.layout)) { nn.w = Math.round(r.w); nn.h = Math.round(r.h); if (nn.sw === 'fill') nn.sw = 'fixed'; if (nn.sh === 'fill') nn.sh = 'fixed'; }
      if (np && np.layout) nn.abs = true;
      changes.push({ id, after: nn });
    });
  }
  commit(changes, { label: 'Move' });
  refitGroups([...parentsTouched, ...(target ? [target.id] : [])]);
  markAllDirty(); scheduleRender();
}

// ----- resize -----
function startResize(e, hd, base) {
  const ids = selRoots().filter(id => !get(id).locked);
  if (!ids.length || !S.canEdit) return;
  Object.assign(DRAG, base, { kind: 'resize', hd, ids, before: clone(ids.map(get)), rects: ids.map(id => wrect(id)), locals: ids.map(id => lrect(id)) });
  DRAG.bbox = union(DRAG.rects);
  capture(e);
}
function moveResize(e, dx, dy) {
  const hd = DRAG.hd, b = DRAG.bbox;
  let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
  if (hd.includes('w')) x1 += dx; if (hd.includes('e')) x2 += dx;
  if (hd.includes('n')) y1 += dy; if (hd.includes('s')) y2 += dy;
  if (e.altKey) { if (hd.includes('w')) x2 -= dx; if (hd.includes('e')) x1 -= dx; if (hd.includes('n')) y2 -= dy; if (hd.includes('s')) y1 -= dy; }
  let w = x2 - x1, hh = y2 - y1;
  if (e.shiftKey && b.w && b.h) {
    const ar = b.w / b.h;
    if (hd.length === 2) { if (Math.abs(w) / ar > Math.abs(hh)) hh = Math.sign(hh || 1) * Math.abs(w) / ar; else w = Math.sign(w || 1) * Math.abs(hh) * ar; }
    else if (hd === 'e' || hd === 'w') hh = Math.abs(w) / ar; else w = Math.abs(hh) * ar;
    if (hd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
    if (hd.includes('n')) y1 = y2 - hh; else if (hd.length === 2 || hd === 'n' || hd === 's') y2 = y1 + hh;
    if (hd === 'e' || hd === 'w') { y1 = b.y + (b.h - hh) / 2; y2 = y1 + hh; }
  }
  const nb = rectFrom(Math.round(x1), Math.round(y1), Math.round(x1 + (x2 - x1)), Math.round(y1 + (y2 - y1)));
  nb.w = Math.max(1, nb.w); nb.h = Math.max(1, nb.h);
  const horiz = /[ew]/.test(hd), vert = /[ns]/.test(hd);
  const changes = DRAG.ids.map((id, i) => {
    const n0 = DRAG.before[i], r = DRAG.rects[i], l = DRAG.locals[i];
    let nr;
    if (DRAG.ids.length === 1) nr = nb;
    else { const sx = nb.w / Math.max(1, b.w), sy = nb.h / Math.max(1, b.h); nr = { x: nb.x + (r.x - b.x) * sx, y: nb.y + (r.y - b.y) * sy, w: r.w * sx, h: r.h * sy }; }
    const nn = Object.assign({}, n0);
    const lay = inLayout(n0);
    if (!lay) { nn.x = Math.round(l.x + (nr.x - r.x)); nn.y = Math.round(l.y + (nr.y - r.y)); }
    if (horiz) { nn.w = Math.max(1, Math.round(nr.w)); if (nn.sw !== 'fixed') nn.sw = 'fixed'; }
    else if (n0.sw !== 'fixed') nn.w = Math.round(l.w);
    if (vert) { nn.h = Math.max(1, Math.round(nr.h)); if (nn.sh !== 'fixed') nn.sh = 'fixed'; }
    else if (n0.sh !== 'fixed') nn.h = Math.round(l.h);
    if (n0.type === 'text' && horiz && !vert && n0.sh === 'hug') nn.sh = 'hug';
    if (n0.type === 'line') { nn.h = n0.h; nn.sh = n0.sh; }
    return { id, after: nn };
  });
  commit(changes, { history: false, write: false });
}
function endResize() {
  if (!DRAG.moved) return;
  const changes = DRAG.ids.map((id, i) => ({ id, before: DRAG.before[i], after: get(id) }));
  commit(changes, { label: 'Resize' });
  refitGroups(DRAG.ids.map(id => get(id) && get(id).parent));
}

// ----- draw -----
function startDraw(e, base) {
  if (!S.canEdit) return;
  const t = S.tool;
  const parentId = frameAt(e.clientX, e.clientY, false, id => { const n = get(id); return n.group; });
  const P = parentId ? get(parentId) : null;
  const pr = P ? wrect(parentId) : { x: 0, y: 0 };
  const id = uid();
  const x = Math.round(base.wx - pr.x), y = Math.round(base.wy - pr.y);
  const n = { id, type: t === 'frame' ? 'frame' : t, page: S.pageId, parent: parentId, z: nextZ(parentId || 'page:' + S.pageId), x, y, w: 1, h: 1 };
  if (t === 'text') Object.assign(n, { text: '', sw: 'hug', sh: 'hug', fills: [{ t: 'solid', c: defaultInk(parentId) }], w: 0, h: 0 });
  if (t === 'line') Object.assign(n, { h: 0, stroke: { c: defaultInk(parentId), w: 1, style: 'solid' }, fills: [] });
  if (t === 'frame') Object.assign(n, { fills: [{ t: 'solid', c: '#FFFFFF' }], clip: true });
  Object.assign(DRAG, base, { kind: 'draw', id, node: n, P, pr });
  capture(e);
}
function defaultInk(parentId) { return modeOf(parentId || '') === 'dark' ? '#F4F4F5' : '#111111'; }
function moveDraw(e, w) {
  const d = DRAG; if (d.P && d.P.layout) return;
  let x1 = d.wx, y1 = d.wy, x2 = w.x, y2 = w.y;
  const n = Object.assign({}, d.node);
  if (n.type === 'line') {
    if (e.shiftKey) { const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4); const L = Math.hypot(x2 - x1, y2 - y1); x2 = x1 + Math.cos(a) * L; y2 = y1 + Math.sin(a) * L; }
    const L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const sw = (n.stroke && n.stroke.w) || 1;
    n.w = Math.round(L); n.rot = rnd(ang, 2); n.x = Math.round((x1 + x2) / 2 - L / 2 - d.pr.x); n.y = Math.round((y1 + y2) / 2 - sw / 2 - d.pr.y);
  } else {
    if (e.shiftKey) { const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); x2 = x1 + Math.sign(x2 - x1 || 1) * s; y2 = y1 + Math.sign(y2 - y1 || 1) * s; }
    if (e.altKey) { x1 = d.wx - (x2 - d.wx); y1 = d.wy - (y2 - d.wy); }
    const r = rectFrom(x1, y1, x2, y2);
    n.x = Math.round(r.x - d.pr.x); n.y = Math.round(r.y - d.pr.y); n.w = Math.max(1, Math.round(r.w)); n.h = Math.max(1, Math.round(r.h));
    if (n.type === 'text') { n.sw = 'fixed'; n.sh = 'hug'; }
  }
  d.node = n;
  commit([{ id: d.id, after: n }], { history: false, write: false });
}
function endDraw(e) {
  const d = DRAG;
  let n = Object.assign({}, get(d.id) || d.node);
  if (!d.moved || (d.P && d.P.layout)) {
    // click: sensible default size
    if (n.type === 'frame') { if (!d.P) Object.assign(n, { w: 390, h: 844, name: 'Screen' }); else Object.assign(n, { w: 100, h: 100 }); }
    else if (n.type === 'line') Object.assign(n, { w: 120, rot: 0 });
    else if (n.type === 'text') Object.assign(n, { sw: 'hug', sh: 'hug' });
    else Object.assign(n, { w: 100, h: 100 });
    if (n.type === 'frame' && !d.P) { n.x = Math.round(d.wx); n.y = Math.round(d.wy); }
  }
  if (n.type === 'frame' && !d.P && !n.name) n.name = 'Frame';
  if (n.type === 'text' && n.sw === 'fixed' && n.w < 8) n.sw = 'hug';
  commit([{ id: d.id, before: null, after: n }], { label: 'Add ' + n.type });
  select([d.id]);
  setTool('move');
  if (n.type === 'text') { renderNow(); editText(d.id, null, true); }
}

// ----- marquee -----
function moveMarquee(w) {
  const m = rectFrom(DRAG.wx, DRAG.wy, w.x, w.y); OV.marquee = m;
  const pool = DRAG.scope ? kids(DRAG.scope) : roots();
  const ids = pool.filter(n => n.visible && !n.locked && overlaps(wrect(n.id), m)).map(n => n.id);
  S.sel = [...new Set([...(DRAG.prev || []), ...ids])]; DIRTY.chrome = true; scheduleRender();
}

// ----- double click / text editing -----
function onDouble(e, hc) {
  const id = S.sel[0]; const n = get(id); if (!n) return;
  const mel = e.target.closest('[data-mid]');
  if (n.type === 'instance') {
    // edit a text override directly on canvas
    const tEl = e.target.closest('[data-mid]');
    const mid = tEl && tEl.dataset.mid; const mn = mid && get(mid);
    if (mn && mn.type === 'text' && S.canEdit) { editText(id, mid); return; }
    return;
  }
  if (n.type === 'text') { if (S.canEdit) editText(id); return; }
  // go one level deeper toward the clicked point
  const i = hc.chain.indexOf(id);
  if (i > 0) select([hc.chain[i - 1]]);
}
function onStageDbl(e) {
  if (S.tool !== 'move' || S.editing) return;
  const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  const fl = under.closest('.flabel');
  if (fl) { renameFrameLabel(fl.dataset.frame, fl); return; }
  if (under.closest('#ov .hdl, #ask, .empty')) return;
  const hc = chainAt(e.clientX, e.clientY);
  if (!hc) return;
  if (!S.sel.length || !hc.chain.includes(S.sel[0])) { select([pickFrom(hc.chain, e)]); }
  onDouble(e, hc);
}
function editText(id, mid, fresh) {
  const el = elOf(id, mid); if (!el) return;
  S.editing = { id, mid, fresh, before: clone(get(id)) };
  try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  if (el.textContent === '​') el.textContent = '';
  el.style.minWidth = '2px';
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  el.addEventListener('input', drawOverlaySoon);
  el.addEventListener('blur', finishEdit, { once: true });
  el.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && modKey(ev))) { ev.preventDefault(); el.blur(); }
  });
  el.addEventListener('paste', ev => { ev.preventDefault(); ev.stopPropagation(); const t = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, t); });
  drawOverlay();
}
function finishEdit() {
  const ed = S.editing; if (!ed) return; S.editing = null;
  const el = elOf(ed.id, ed.mid);
  const text = el ? el.innerText.replace(/\n$/, '') : null;
  if (el) { el.contentEditable = 'false'; el.removeAttribute('contenteditable'); }
  const n = get(ed.id);
  if (!n || text == null) return;
  if (ed.mid) {
    const ov = clone(n.ov || {}); const m = get(ed.mid);
    if (m && text === m.text) { if (ov[ed.mid]) delete ov[ed.mid].text; } else ov[ed.mid] = Object.assign({}, ov[ed.mid], { text });
    commit([{ id: n.id, after: Object.assign({}, n, { ov }) }], { label: 'Edit text' });
  } else if (!text.trim() && n.type === 'text') {
    if (ed.fresh) commit([{ id: n.id, before: null, after: null }], { history: false }); else removeNodes([n.id], 'Delete text');
    S.sel = S.sel.filter(x => x !== n.id);
  } else if (text !== n.text) {
    const autoName = !n.name || n.name === defaultName(Object.assign({}, n, { text: n.text })) || n.name === (n.text || '').slice(0, 40);
    commit([{ id: n.id, before: ed.fresh ? null : ed.before, after: Object.assign({}, n, { text, name: autoName ? text.slice(0, 40) : n.name }) }], { label: 'Edit text' });
  }
  markDirty(n.id, n, n); scheduleRender();
}
function renameFrameLabel(id, label) {
  if (!S.canEdit) return;
  const r = label.getBoundingClientRect(), sr = stageRect();
  const inp = h('input', { value: get(id).name, style: { position: 'absolute', left: (r.left - sr.left) + 'px', top: (r.top - sr.top - 2) + 'px', width: Math.max(140, r.width + 20) + 'px', height: '22px', font: '11px Arial', border: '1px solid var(--sel)', borderRadius: '4px', padding: '0 4px', zIndex: '6', background: 'var(--panel)', color: 'var(--ink)' } });
  $('#stage').append(inp); inp.focus(); inp.select();
  const done = ok => { if (!inp.isConnected) return; const v = inp.value.trim(); inp.remove(); if (ok && v && v !== get(id).name) patch(id, { name: v }, { label: 'Rename' }); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
}

// ----- measuring (hold Alt) -----
function measureTo(otherId) {
  OV.measure = null;
  if (!S.sel.length) return;
  const a = union(S.sel.map(id => wrect(id)));
  let bId = otherId && !S.sel.includes(otherId) ? otherId : (get(S.sel[0]) && get(S.sel[0]).parent);
  if (!bId) return drawOverlaySoon();
  const b = wrect(bId); if (!a || !b) return;
  const ms = [];
  const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
  if (inside) {
    ms.push({ x1: b.x, y1: cy, x2: a.x, y2: cy, d: a.x - b.x }, { x1: a.x + a.w, y1: cy, x2: b.x + b.w, y2: cy, d: b.x + b.w - a.x - a.w });
    ms.push({ x1: cx, y1: b.y, x2: cx, y2: a.y, d: a.y - b.y }, { x1: cx, y1: a.y + a.h, x2: cx, y2: b.y + b.h, d: b.y + b.h - a.y - a.h });
  } else {
    if (b.x >= a.x + a.w) ms.push({ x1: a.x + a.w, y1: cy, x2: b.x, y2: cy, d: b.x - a.x - a.w });
    if (b.x + b.w <= a.x) ms.push({ x1: b.x + b.w, y1: cy, x2: a.x, y2: cy, d: a.x - b.x - b.w });
    if (b.y >= a.y + a.h) ms.push({ x1: cx, y1: a.y + a.h, x2: cx, y2: b.y, d: b.y - a.y - a.h });
    if (b.y + b.h <= a.y) ms.push({ x1: cx, y1: b.y + b.h, x2: cx, y2: a.y, d: a.y - b.y - b.h });
  }
  OV.measure = ms.filter(m => m.d > 0.01);
  drawOverlaySoon();
}

// ---------- wheel ----------
function onWheel(e) {
  if (e.target.closest('#ask')) return;
  e.preventDefault();
  const r = stageRect();
  if (e.ctrlKey || e.metaKey) { const v = view(); zoomAt(v.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1)), e.clientX - r.left, e.clientY - r.top); }
  else { const v = view(); const k = e.deltaMode === 1 ? 16 : 1; if (e.shiftKey && !e.deltaX) v.x -= e.deltaY * k; else { v.x -= e.deltaX * k; v.y -= e.deltaY * k; } applyView(); }
}

// ---------- structure actions ----------
function cloneTree(id, map = new Map()) {
  // returns list of new nodes for the subtree rooted at id (ids remapped)
  const out = [];
  const walk = (n, newParent) => {
    const nid = uid(); map.set(n.id, nid);
    const c = Object.assign(clone(n), { id: nid, parent: newParent });
    if (c.component) c.component = false; // a copy of a main is a plain frame; use Insert instance for instances
    out.push(c);
    for (const k of kids(n.id)) walk(k, nid);
  };
  walk(get(id), get(id).parent);
  // remap prototype links inside the copy
  for (const c of out) if (c.link && map.has(c.link.to)) c.link = Object.assign({}, c.link, { to: map.get(c.link.to) });
  return out;
}
function duplicate(ids, opts = {}) {
  ids = selRoots(ids);
  const created = [];
  const changes = [];
  for (const id of ids) {
    const n = get(id); const keepComp = false;
    const list = cloneTree(id);
    const root = list[0];
    if (!opts.inPlace) {
      if (!n.parent && n.type === 'frame') root.x = n.x + Math.round(wrect(id).w) + 80;
      else if (!inLayout(n)) { root.x += 16; root.y += 16; }
    }
    root.z = n.z + 0.5;
    if (n.component && opts.asInstance) {}
    for (const c of list) changes.push({ id: c.id, before: null, after: c });
    created.push(root.id);
  }
  commit(changes, { label: opts.label || 'Duplicate' });
  normalizeZ([...new Set(ids.map(id => pkey(get(id))))]);
  if (opts.select !== false) select(created);
  return created;
}
function normalizeZ(pks) {
  const ch = [];
  for (const pk of pks) (index().get(pk) || []).forEach((n, i) => { if (n.z !== i) ch.push({ id: n.id, after: Object.assign({}, n, { z: i }) }); });
  if (ch.length) commit(ch, { label: 'Order' });
}
function wrapSelection(kind) {
  const ids = selRoots(); if (!ids.length) return;
  const p0 = get(ids[0]).parent;
  if (!ids.every(id => get(id).parent === p0)) { toast('Select layers that share a parent.'); return; }
  const rs = ids.map(id => lrect(id)); const u = union(rs);
  const P = p0 ? get(p0) : null;
  const gid = uid();
  const sorted = ids.slice().sort((a, b) => get(a).z - get(b).z);
  const g = { id: gid, type: 'frame', page: S.pageId, parent: p0, z: Math.max(...ids.map(id => get(id).z)), x: Math.round(u.x), y: Math.round(u.y), w: Math.round(u.w), h: Math.round(u.h), name: kind === 'group' ? 'Group' : 'Frame', fills: kind === 'group' ? [] : [], clip: kind !== 'group', group: kind === 'group' };
  if (P && P.layout) { g.sw = 'hug'; }
  const changes = [{ id: gid, before: null, after: g }];
  sorted.forEach((id, i) => { const r = lrect(id); changes.push({ id, after: Object.assign({}, get(id), { parent: gid, x: Math.round(r.x - u.x), y: Math.round(r.y - u.y), z: i, abs: false }) }); });
  if (kind === 'autolayout') {
    const row = u.w > u.h * 1.2 && rs.every((r, i) => i === 0 || true);
    const order = ids.slice().sort((a, b) => { const A = lrect(a), B = lrect(b); return row ? A.x - B.x : A.y - B.y; });
    const gaps = [];
    for (let i = 1; i < order.length; i++) { const A = lrect(order[i - 1]), B = lrect(order[i]); gaps.push(row ? B.x - (A.x + A.w) : B.y - (A.y + A.h)); }
    const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : 8;
    g.layout = { dir: row ? 'row' : 'col', gap, pad: [0, 0, 0, 0], align: 'start', justify: 'start', wrap: false };
    g.sw = 'hug'; g.sh = 'hug'; g.name = 'Auto layout'; g.group = false; g.clip = false;
    order.forEach((id, i) => { const c = changes.find(c => c.id === id); c.after.z = i; });
  }
  commit(changes, { label: kind === 'group' ? 'Group' : kind === 'autolayout' ? 'Add auto layout' : 'Frame selection' });
  select([gid]);
}
function ungroup() {
  const ids = selRoots().filter(id => get(id).type === 'frame' && kids(id).length);
  if (!ids.length) return;
  const changes = []; const out = [];
  for (const gid of ids) {
    const g = get(gid); const gr = lrect(gid);
    const ks = kids(gid);
    ks.forEach((k, i) => { const r = lrect(k.id); changes.push({ id: k.id, after: Object.assign({}, k, { parent: g.parent, x: Math.round(gr.x + r.x), y: Math.round(gr.y + r.y), w: Math.round(r.w), h: k.type === 'line' ? k.h : Math.round(r.h), z: g.z + (i + 1) / (ks.length + 1), sw: k.sw === 'fill' ? 'fixed' : k.sw, sh: k.sh === 'fill' ? 'fixed' : k.sh }) }); out.push(k.id); });
    changes.push({ id: gid, after: null });
  }
  commit(changes, { label: 'Ungroup' });
  select(out);
}
function refitGroups(pids) {
  const ch = [];
  for (const pid of new Set(pids.filter(Boolean))) {
    const g = get(pid); if (!g || !g.group) continue;
    const ks = kids(pid); if (!ks.length) { ch.push({ id: pid, after: null }); continue; }
    const rs = ks.map(k => lrect(k.id)).filter(Boolean); const u = union(rs); if (!u) continue;
    if (Math.abs(u.x) < 0.5 && Math.abs(u.y) < 0.5 && Math.abs(u.w - g.w) < 0.5 && Math.abs(u.h - g.h) < 0.5) continue;
    ch.push({ id: pid, after: Object.assign({}, g, { x: Math.round(g.x + u.x), y: Math.round(g.y + u.y), w: Math.round(u.w), h: Math.round(u.h) }) });
    ks.forEach((k, i) => { if (!inLayout(k)) ch.push({ id: k.id, after: Object.assign({}, k, { x: Math.round(rs[i].x - u.x), y: Math.round(rs[i].y - u.y) }) }); });
  }
  if (ch.length) commit(ch, { label: 'Fit group', coalesce: 'fit' });
}
function toggleAutoLayout(remove) {
  const ids = selRoots();
  if (!ids.length) return;
  const n = get(ids[0]);
  if (ids.length === 1 && n.type === 'frame' && !n.group) {
    if (remove || n.layout) {
      if (!n.layout) return;
      const ch = [{ id: n.id, after: Object.assign({}, n, { layout: null, sw: n.sw === 'hug' ? 'fixed' : n.sw, sh: n.sh === 'hug' ? 'fixed' : n.sh, w: Math.round(lrect(n.id).w), h: Math.round(lrect(n.id).h) }) }];
      kids(n.id).forEach(k => { const r = lrect(k.id); ch.push({ id: k.id, after: Object.assign({}, k, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: k.type === 'line' ? k.h : Math.round(r.h), sw: k.sw === 'fill' ? 'fixed' : k.sw, sh: k.sh === 'fill' ? 'fixed' : k.sh, abs: false }) }); });
      commit(ch, { label: 'Remove auto layout' });
      return;
    }
    const ks = kids(n.id).filter(k => k.visible);
    const rs = ks.map(k => lrect(k.id));
    const u = union(rs) || { x: 0, y: 0, w: 0, h: 0 };
    const spreadX = rs.reduce((a, r) => a + r.w, 0) <= u.w * 1.05 && u.w > u.h;
    const row = ks.length > 1 ? spreadX : false;
    const order = ks.slice().sort((a, b) => { const A = lrect(a.id), B = lrect(b.id); return row ? A.x - B.x : A.y - B.y; });
    const gaps = [];
    for (let i = 1; i < order.length; i++) { const A = lrect(order[i - 1].id), B = lrect(order[i].id); gaps.push(row ? B.x - (A.x + A.w) : B.y - (A.y + A.h)); }
    const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : 8;
    const pad = ks.length ? [Math.max(0, Math.round(u.y)), Math.max(0, Math.round(n.w - u.x - u.w)), Math.max(0, Math.round(n.h - u.y - u.h)), Math.max(0, Math.round(u.x))] : [16, 16, 16, 16];
    const top = !n.parent;
    const ch = [{ id: n.id, after: Object.assign({}, n, { layout: { dir: row ? 'row' : 'col', gap, pad: top ? pad : pad.map(p => Math.min(p, 64)), align: 'start', justify: 'start', wrap: false }, sw: top ? 'fixed' : 'hug', sh: top ? 'fixed' : 'hug' }) }];
    order.forEach((k, i) => ch.push({ id: k.id, after: Object.assign({}, k, { z: i, abs: false }) }));
    commit(ch, { label: 'Add auto layout' });
  } else wrapSelection('autolayout');
}
function reorder(dir) {
  // dir: +1 forward, -1 backward, 'front', 'back'
  const ids = selRoots(); if (!ids.length) return;
  const ch = [];
  const byParent = new Map();
  for (const id of ids) { const k = pkey(get(id)); if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(id); }
  for (const [pk, sids] of byParent) {
    const list = (index().get(pk) || []).slice();
    const set = new Set(sids);
    if (dir === 'front') { const rest = list.filter(n => !set.has(n.id)); list.splice(0, list.length, ...rest, ...list.filter(n => set.has(n.id))); }
    else if (dir === 'back') { const rest = list.filter(n => !set.has(n.id)); list.splice(0, list.length, ...list.filter(n => set.has(n.id)), ...rest); }
    else if (dir > 0) { for (let i = list.length - 2; i >= 0; i--) if (set.has(list[i].id) && !set.has(list[i + 1].id)) { [list[i], list[i + 1]] = [list[i + 1], list[i]]; } }
    else { for (let i = 1; i < list.length; i++) if (set.has(list[i].id) && !set.has(list[i - 1].id)) { [list[i], list[i - 1]] = [list[i - 1], list[i]]; } }
    list.forEach((n, i) => { if (n.z !== i) ch.push({ id: n.id, after: Object.assign({}, n, { z: i }) }); });
  }
  commit(ch, { label: 'Reorder' });
}
function nudge(dx, dy) {
  const ids = selRoots().filter(id => !get(id).locked); if (!ids.length) return;
  const ch = [];
  for (const id of ids) {
    const n = get(id);
    if (inLayout(n)) {
      // arrows reorder inside auto layout
      const P = get(n.parent); const row = P.layout.dir === 'row';
      const step = row ? Math.sign(dx) : Math.sign(dy); if (!step) continue;
      const list = kids(P.id).slice(); const i = list.findIndex(k => k.id === id); const j = i + step;
      if (j < 0 || j >= list.length) continue;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((k, idx) => { if (k.z !== idx) ch.push({ id: k.id, after: Object.assign({}, k, { z: idx }) }); });
    } else ch.push({ id, after: Object.assign({}, n, { x: n.x + dx, y: n.y + dy }) });
  }
  commit(ch, { label: 'Nudge', coalesce: 'nudge' });
  refitGroups(ids.map(id => get(id).parent));
}
function alignSel(how) {
  const ids = selRoots().filter(id => !inLayout(get(id))); if (!ids.length) return;
  let ref;
  if (ids.length === 1) { const n = get(ids[0]); if (!n.parent) return; const pr = wrect(n.parent); ref = pr; }
  else ref = union(ids.map(id => wrect(id)));
  const ch = ids.map(id => {
    const n = get(id), r = wrect(id); let dx = 0, dy = 0;
    if (how === 'left') dx = ref.x - r.x; if (how === 'hcenter') dx = ref.x + ref.w / 2 - (r.x + r.w / 2); if (how === 'right') dx = ref.x + ref.w - (r.x + r.w);
    if (how === 'top') dy = ref.y - r.y; if (how === 'vcenter') dy = ref.y + ref.h / 2 - (r.y + r.h / 2); if (how === 'bottom') dy = ref.y + ref.h - (r.y + r.h);
    return { id, after: Object.assign({}, n, { x: Math.round(n.x + dx), y: Math.round(n.y + dy) }) };
  });
  commit(ch, { label: 'Align' });
}
function distribute(axis) {
  const ids = selRoots().filter(id => !inLayout(get(id))); if (ids.length < 3) { toast('Select 3 or more layers to distribute.'); return; }
  const items = ids.map(id => ({ id, r: wrect(id) })).sort((a, b) => axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y);
  const first = items[0].r, last = items[items.length - 1].r;
  const total = axis === 'h' ? (last.x + last.w - first.x) : (last.y + last.h - first.y);
  const sizes = items.reduce((a, it) => a + (axis === 'h' ? it.r.w : it.r.h), 0);
  const gap = (total - sizes) / (items.length - 1);
  let cur = axis === 'h' ? first.x : first.y;
  const ch = items.map(it => { const n = get(it.id); const d = cur - (axis === 'h' ? it.r.x : it.r.y); cur += (axis === 'h' ? it.r.w : it.r.h) + gap; return { id: it.id, after: Object.assign({}, n, axis === 'h' ? { x: Math.round(n.x + d) } : { y: Math.round(n.y + d) }) }; });
  commit(ch, { label: 'Distribute' });
}
function makeComponent() {
  const ids = selRoots(); if (!ids.length) return;
  if (ids.length === 1 && get(ids[0]).type === 'frame' && !get(ids[0]).group) {
    const n = get(ids[0]);
    if (n.component) { toast('Already a component'); return; }
    patch(n.id, { component: true, name: n.name === 'Frame' || n.name === 'Auto layout' ? 'Component' : n.name }, { label: 'Create component' });
    toast('Component created — find it under Assets'); return;
  }
  wrapSelection('frame');
  const id = S.sel[0]; patch(id, { component: true, name: 'Component', fills: [] }, { label: 'Create component' });
}
function insertInstance(mid, at) {
  const m = get(mid); if (!m) return;
  const mr = wrect(mid) || { w: m.w, h: m.h };
  let parent = null, x, y;
  const s = S.sel.length === 1 ? get(S.sel[0]) : null;
  if (at) { parent = at.parent || null; x = at.x; y = at.y; }
  else if (s && s.type === 'frame' && !s.component && s.page === S.pageId && !inComponent(s.id)) { parent = s.id; const sr = wrect(s.id); x = Math.round((sr.w - mr.w) / 2); y = Math.round((sr.h - mr.h) / 2); }
  else { const c = viewCenter(); x = Math.round(c.x - mr.w / 2); y = Math.round(c.y - mr.h / 2); }
  if (parent && inComponent(parent) && isAnc(mid, parent)) { toast('A component cannot contain itself.'); return; }
  const id = uid();
  const n = { id, type: 'instance', of: mid, page: S.pageId, parent, z: nextZ(parent || 'page:' + S.pageId), x, y, w: Math.round(mr.w), h: Math.round(mr.h), sw: m.sw, sh: m.sh, name: m.name, ov: {} };
  commit([{ id, before: null, after: n }], { label: 'Insert ' + m.name });
  select([id]);
  return id;
}
function detachInstance() {
  const ids = S.sel.filter(id => get(id) && get(id).type === 'instance'); if (!ids.length) return;
  const ch = []; const out = [];
  for (const id of ids) {
    const inst = get(id); const m = get(inst.of); if (!m) continue;
    const r = instRoot(inst, m);
    const root = Object.assign(clone(r), { id, type: 'frame', component: false, of: undefined, ov: undefined });
    delete root.of; delete root.ov;
    ch.push({ id, after: root });
    const walk = (src, parent) => { for (const k of kids(src)) { const nid = uid(); const c = Object.assign(clone(withOv(k, inst.ov)), { id: nid, parent, page: inst.page }); ch.push({ id: nid, before: null, after: c }); walk(k.id, nid); } };
    walk(m.id, id); out.push(id);
  }
  commit(ch, { label: 'Detach instance' });
  select(out, { force: true });
}
function viewCenter() { const r = stageRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2 - 30); }
function spotForFrame(w, h) {
  const fs = roots().filter(n => !n.parent);
  if (!fs.length) return { x: 0, y: 0 };
  let maxX = -Infinity, topY = Infinity;
  for (const f of fs) { const r = wrect(f.id) || f; maxX = Math.max(maxX, r.x + r.w); topY = Math.min(topY, r.y); }
  return { x: Math.round(maxX + 80), y: Math.round(topY) };
}
function addFrame(preset) {
  const p = spotForFrame(preset.w, preset.h);
  const id = uid();
  commit([{ id, before: null, after: { id, type: 'frame', page: S.pageId, parent: null, z: nextZ('page:' + S.pageId), x: p.x, y: p.y, w: preset.w, h: preset.h, name: preset.name, fills: [{ t: 'solid', c: '#FFFFFF' }], clip: true } }], { label: 'Add frame' });
  select([id]); setTool('move');
  requestAnimationFrame(() => centerOn(id));
}
const PRESETS = [
  { group: 'Phone', name: 'iPhone 16', w: 393, h: 852 }, { group: 'Phone', name: 'iPhone 16 Pro Max', w: 440, h: 956 }, { group: 'Phone', name: 'iPhone SE', w: 375, h: 667 },
  { group: 'Phone', name: 'Android', w: 412, h: 917 }, { group: 'Tablet', name: 'iPad mini', w: 744, h: 1133 }, { group: 'Tablet', name: 'iPad Pro 11"', w: 834, h: 1194 },
  { group: 'Desktop', name: 'Desktop', w: 1440, h: 1024 }, { group: 'Desktop', name: 'MacBook Air', w: 1280, h: 832 }, { group: 'Desktop', name: 'Wide', w: 1920, h: 1080 },
  { group: 'Other', name: 'Watch 45mm', w: 198, h: 242 }, { group: 'Other', name: 'Slide 16:9', w: 1920, h: 1080 }, { group: 'Other', name: 'Social post', w: 1080, h: 1080 },
];

// ---------- clipboard ----------
let memClip = null;
function serializeSel() {
  const ids = selRoots(); if (!ids.length) return null;
  const nodes = []; for (const id of ids) { nodes.push(clone(get(id))); descendants(id).forEach(d => nodes.push(clone(d))); }
  return { pinup: 1, roots: ids, nodes, rects: ids.map(id => wrect(id)) };
}
function onCopy(e, cut) {
  if (isTyping()) return;
  const data = serializeSel(); if (!data) return;
  e.preventDefault();
  memClip = data;
  const json = JSON.stringify(data);
  try {
    e.clipboardData.setData('text/plain', 'pinup:' + json);
    e.clipboardData.setData('text/html', `<!--pinup:${btoa(unescape(encodeURIComponent(json)))}-->` + exportHTMLFragment(data.roots));
  } catch {}
  if (cut) removeNodes(data.roots, 'Cut');
  toast(cut ? 'Cut' : 'Copied — paste here, or as HTML into other tools');
}
function onPaste(e) {
  if (isTyping()) return;
  if (!S.canEdit) return;
  const cd = e.clipboardData; if (!cd) return;
  e.preventDefault();
  const files = [...(cd.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) { files.forEach((f, i) => addImageFile(f, null, i * 24)); return; }
  const htm = cd.getData('text/html'), txt = cd.getData('text/plain');
  let m = htm && htm.match(/<!--pinup:([A-Za-z0-9+/=]+)-->/);
  if (m) { try { return pasteNodes(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); } catch {} }
  if (txt && txt.startsWith('pinup:')) { try { return pasteNodes(JSON.parse(txt.slice(6))); } catch {} }
  if (txt && /^\s*<svg[\s>]/i.test(txt)) return pasteSVG(txt);
  if (htm && htm.replace(/<!--[\s\S]*?-->/g, '').trim() && !/^\s*<meta[^>]*>\s*[^<]*$/i.test(htm)) return importInto(htm, 'Pasted HTML');
  if (txt && /^\s*</.test(txt) && /<\/?[a-z][\s\S]*>/i.test(txt)) return importInto(txt, 'Pasted HTML');
  if (txt) return pasteText(txt);
}
function pasteTarget() {
  const s = S.sel.length === 1 ? get(S.sel[0]) : null;
  if (s && s.type === 'frame' && !s.group && s.page === S.pageId) return s.id;
  return null;
}
function pasteNodes(data) {
  if (!data || !data.nodes) return;
  const map = new Map(); data.nodes.forEach(n => map.set(n.id, uid()));
  const target = pasteTarget();
  const tr = target ? wrect(target) : null;
  const ch = []; const newRoots = [];
  const c = viewCenter();
  const u = union(data.rects || []);
  data.nodes.forEach(n0 => {
    const n = clone(n0); n.id = map.get(n0.id); n.page = S.pageId;
    if (n.link && map.has(n.link.to)) n.link.to = map.get(n.link.to);
    if (n.component && get(n0.id)) n.component = false;
    const ri = data.roots.indexOf(n0.id);
    if (ri >= 0) {
      newRoots.push(n.id);
      const r = (data.rects || [])[ri] || { x: n.x, y: n.y };
      if (target && target !== n0.id && !data.roots.includes(target)) {
        n.parent = target; n.z = nextZ(target) + ri;
        const T = get(target);
        if (!T.layout) { n.x = Math.round(r.x - u.x + Math.max(0, (tr.w - u.w) / 2)); n.y = Math.round(r.y - u.y + Math.max(0, (tr.h - u.h) / 2)); }
        n.abs = false;
      } else {
        const orig = get(n0.id);
        if (orig && orig.page === S.pageId && orig.parent === n0.parent) { n.parent = n0.parent; n.z = orig.z + 0.5; if (!inLayout(orig)) { n.x += 16; n.y += 16; } }
        else { n.parent = null; n.x = Math.round(c.x - u.w / 2 + (r.x - u.x)); n.y = Math.round(c.y - u.h / 2 + (r.y - u.y)); n.z = nextZ('page:' + S.pageId) + ri; }
      }
    } else n.parent = map.get(n0.parent) || n.parent;
    ch.push({ id: n.id, before: null, after: n });
  });
  commit(ch, { label: 'Paste' });
  normalizeZ([...new Set(newRoots.map(id => pkey(get(id))))]);
  select(newRoots);
}
function pasteText(txt) {
  const target = pasteTarget(); const c = viewCenter();
  const id = uid();
  const n = { id, type: 'text', page: S.pageId, parent: target, z: nextZ(target || 'page:' + S.pageId), x: target ? 24 : Math.round(c.x), y: target ? 24 : Math.round(c.y), text: txt.slice(0, 5000), sw: txt.length > 60 ? 'fixed' : 'hug', w: 320, fills: [{ t: 'solid', c: defaultInk(target) }] };
  commit([{ id, before: null, after: n }], { label: 'Paste text' });
  select([id]);
}
function pasteSVG(markup) {
  const clean = cleanSVG(markup); if (!clean) return toast('That SVG could not be read.');
  const tmp = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  const vb = (tmp.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = +tmp.getAttribute('width') || vb[2] || 100, hh = +tmp.getAttribute('height') || vb[3] || 100;
  const target = pasteTarget(); const c = viewCenter(); const id = uid();
  commit([{ id, before: null, after: { id, type: 'svg', page: S.pageId, parent: target, z: nextZ(target || 'page:' + S.pageId), x: target ? 0 : Math.round(c.x - w / 2), y: target ? 0 : Math.round(c.y - hh / 2), w: Math.round(w), h: Math.round(hh), markup: clean.replace(/preserveAspectRatio="none"/, 'preserveAspectRatio="xMidYMid meet"'), fills: [], name: 'Vector' } }], { label: 'Paste SVG' });
  select([id]);
}
async function importInto(html, label) {
  const target = pasteTarget(); const c = viewCenter();
  const res = await importHTML(html, { parent: target, x: target ? 0 : Math.round(c.x), y: target ? 0 : Math.round(c.y), label });
  if (res && res.ids.length) { select(res.ids); toast('Imported ' + res.count + ' layers'); }
}

// ---------- images ----------
async function imageSrcFor(file) {
  const AS = await capAssets();
  if (AS) { try { const r = await AS.upload(file); return r.url; } catch (err) { console.warn('[pinup] upload failed', err); } }
  // no asset store: shrink into a data URL small enough for a layer document
  const bmp = await createImageBitmap(file);
  let w = bmp.width, hh = bmp.height; const maxSide = 1200; const k = Math.min(1, maxSide / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k);
  const cv = h('canvas', { width: w, height: hh }); cv.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  let q = 0.85, url = cv.toDataURL('image/jpeg', q);
  while (url.length > 180000 && q > 0.3) { q -= 0.15; url = cv.toDataURL('image/jpeg', q); }
  if (url.length > 180000) { const s = Math.sqrt(180000 / url.length); const c2 = h('canvas', { width: Math.round(w * s), height: Math.round(hh * s) }); c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); url = c2.toDataURL('image/jpeg', 0.7); }
  return url;
}
async function addImageFile(file, at, off = 0) {
  if (!S.canEdit) return;
  toast('Adding image…', 1200);
  let dims; try { const b = await createImageBitmap(file); dims = { w: b.width, h: b.height }; } catch { toast('That image could not be read.'); return; }
  const src = await imageSrcFor(file);
  const target = at ? at.parent : pasteTarget();
  const k = Math.min(1, 600 / Math.max(dims.w, dims.h));
  const w = Math.round(dims.w * k), hh = Math.round(dims.h * k);
  let x, y; if (at) { x = at.x; y = at.y; } else if (target) { x = 0; y = 0; } else { const c = viewCenter(); x = Math.round(c.x - w / 2) + off; y = Math.round(c.y - hh / 2) + off; }
  const id = uid();
  commit([{ id, before: null, after: { id, type: 'rect', page: S.pageId, parent: target, z: nextZ(target || 'page:' + S.pageId), x, y, w, h: hh, name: (file.name || 'Image').replace(/\.[a-z0-9]+$/i, ''), fills: [{ t: 'image', src, fit: 'cover' }] } }], { label: 'Add image' });
  select([id]);
}
