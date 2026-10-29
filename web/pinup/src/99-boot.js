// ---------- keyboard ----------
function onKey(e) {
  if (PV.on) {
    if (e.key === 'Escape') { e.preventDefault(); closePresent(); }
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); goBack(); }
    else if (e.key === 'r' || e.key === 'R') { PV.stack = []; showFrame(PV.start, 'dissolve'); }
    return;
  }
  if (isTyping() || $('.scrim')) return;
  const k = e.key, mod = modKey(e), sh = e.shiftKey, alt = e.altKey;
  const lk = k.length === 1 ? k.toLowerCase() : k;
  if (k === ' ' && !spaceDown) { spaceDown = true; $('#stage').classList.add('hand'); e.preventDefault(); return; }
  if (k === 'Alt') { altDown = true; if (S.hover) measureTo(S.hover); e.preventDefault(); return; }
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod) {
    if (lk === 'z') { stop(); sh ? redo() : undo(); return; }
    if (lk === 'y') { stop(); redo(); return; }
    if (lk === 'd') { stop(); if (S.canEdit && S.sel.length) duplicate(S.sel); return; }
    if (lk === 'a') { stop(); const s = S.sel[0] && get(S.sel[0]); select(s ? (s.parent ? kids(s.parent) : roots()).filter(n => n.visible && !n.locked).map(n => n.id) : roots().map(n => n.id)); return; }
    if (lk === 'g' && alt) { stop(); if (S.canEdit) wrapSelection('frame'); return; }
    if (lk === 'g' && sh) { stop(); if (S.canEdit) ungroup(); return; }
    if (lk === 'g') { stop(); if (S.canEdit) wrapSelection('group'); return; }
    if (lk === 'k' && alt) { stop(); if (S.canEdit) makeComponent(); return; }
    if (lk === 'k' && sh) { stop(); pickImage(); return; }
    if (lk === 'k') { stop(); focusAsk(); return; }
    if (lk === 'b' && alt) { stop(); if (S.canEdit) detachInstance(); return; }
    if (lk === 'h' && sh) { stop(); if (S.canEdit && S.sel.length) { const v = !get(S.sel[0]).visible; applySel(() => ({ visible: v }), 'Visibility'); } return; }
    if (lk === 'l' && sh) { stop(); if (S.canEdit && S.sel.length) { const v = !get(S.sel[0]).locked; applySel(() => ({ locked: v }), 'Lock'); } return; }
    if (k === ']' || k === '[') { stop(); if (S.canEdit) reorder(alt ? (k === ']' ? 'front' : 'back') : (k === ']' ? 1 : -1)); return; }
    if (k === '=' || k === '+') { stop(); zoomAt(view().z * 1.25); return; }
    if (k === '-') { stop(); zoomAt(view().z / 1.25); return; }
    if (k === '0') { stop(); zoomAt(1); return; }
    if (k === 'Enter') { stop(); openPresent(); return; }
    if (lk === 'r') { stop(); if (S.sel.length === 1) { S.ltab = 'layers'; renameRow(S.sel[0]); } return; }
    if (k === '\\') { stop(); $('#app').classList.toggle('show-left'); return; }
    return;
  }
  if (sh && (k === '!' || k === '1' || e.code === 'Digit1')) { stop(); zoomFitAll(); return; }
  if (sh && (k === '@' || k === '2' || e.code === 'Digit2')) { stop(); zoomFitSel(); return; }
  if (sh && (k === ')' || k === '0' || e.code === 'Digit0')) { stop(); zoomAt(1); return; }
  if (k === '?') { stop(); showShortcuts(); return; }
  if (lk === 'a' && sh && alt) { stop(); if (S.canEdit) toggleAutoLayout(true); return; }
  if (lk === 'a' && sh) { stop(); if (S.canEdit && S.sel.length) toggleAutoLayout(false); return; }
  if (k === 'Escape') {
    if (DRAG.active) { DRAG.active = false; const l = $('#dragLayer'); if (l) l.remove(); OV.marquee = OV.ins = OV.drop = null; OV.guides = []; markAllDirty(); scheduleRender(); return; }
    if (FB.draft) { closeComposer(); return; }
    if (FB.sel) { FB.sel = null; FB.confirmDel = null; drawOverlay(); renderMarks(); return; }
    if (S.tool !== 'move') { setTool('move'); return; }
    const p = S.sel[0] && get(S.sel[0]) && get(S.sel[0]).parent; select(p ? [p] : []); return;
  }
  if (k === 'Enter') {
    stop(); const n = S.sel[0] && get(S.sel[0]); if (!n) return;
    if (sh) { if (n.parent) select([n.parent]); return; }
    if (n.type === 'text' && S.canEdit) { editText(n.id); return; }
    const ks = kids(n.id); if (ks.length) select(ks.map(x => x.id)); return;
  }
  if (k === 'Tab') {
    const n = S.sel[0] && get(S.sel[0]); if (!n) return; stop();
    const sib = n.parent ? kids(n.parent) : roots(); const i = sib.findIndex(x => x.id === n.id);
    const j = (i + (sh ? -1 : 1) + sib.length) % sib.length; select([sib[j].id]); return;
  }
  if (k === 'Delete' || k === 'Backspace') { stop(); if (S.canEdit && S.sel.length) removeNodes(S.sel); return; }
  if (k.startsWith('Arrow')) {
    if (!S.sel.length || !S.canEdit) return; stop();
    const d = sh ? 10 : 1;
    nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0); return;
  }
  if (alt) return;
  const map = { v: 'move', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', t: 'text', h: 'hand', c: 'comment', n: 'feedback' };
  if (map[lk] && !sh) { stop(); setTool(map[lk]); return; }
}
function onKeyUp(e) {
  if (e.key === ' ') { spaceDown = false; if (S.tool !== 'hand') $('#stage').classList.remove('hand'); }
  if (e.key === 'Alt') { altDown = false; OV.measure = null; drawOverlaySoon(); }
}

// ---------- boot ----------
function boot() {
  loadIcons();
  document.body.append(h('datalist', { id: 'iconlist' }, ICON_NAMES.map(n => h('option', { value: n }))));
  buildTopBar();
  bindTree();
  bindInspector();
  bindPresent();
  bindAsk();
  const st = $('#stage');
  st.addEventListener('pointerdown', onStageDown);
  st.addEventListener('pointermove', onStageMove);
  st.addEventListener('pointerup', onStageUp);
  st.addEventListener('pointercancel', e => { PTRS.delete(e.pointerId); if (PINCH.on && PTRS.size < 2) PINCH.on = false; if (DRAG.active && e.pointerId === DRAG.id0) onStageUp(e); });
  st.addEventListener('pointerleave', () => { if (S.hover && !DRAG.active) { S.hover = null; drawOverlaySoon(); } });
  st.addEventListener('wheel', onWheel, { passive: false });
  st.addEventListener('dblclick', onStageDbl);
  st.addEventListener('contextmenu', e => {
    if (e.target.closest('#ask')) return;
    e.preventDefault();
    const hc = chainAt(e.clientX, e.clientY);
    if (hc) { const id = pickFrom(hc.chain, e); if (!S.sel.includes(id)) select([id]); }
    else if (!e.target.closest('.flabel')) select([]);
    else { const id = e.target.closest('.flabel').dataset.frame; if (!S.sel.includes(id)) select([id]); }
    selectionMenu(e.clientX, e.clientY);
  });
  st.addEventListener('dragover', e => { if ([...(e.dataTransfer.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  st.addEventListener('drop', e => {
    const files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type)); if (!files.length) return;
    e.preventDefault(); if (!S.canEdit) return;
    const parent = frameAt(e.clientX, e.clientY, false, id => get(id).group);
    const w = toWorld(e.clientX, e.clientY); const pr = parent ? wrect(parent) : { x: 0, y: 0 };
    files.forEach((f, i) => addImageFile(f, { parent, x: Math.round(w.x - pr.x) + i * 24, y: Math.round(w.y - pr.y) + i * 24 }));
  });
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', () => { spaceDown = false; altDown = false; OV.measure = null; });
  document.addEventListener('copy', e => onCopy(e, false));
  document.addEventListener('cut', e => { if (S.canEdit) onCopy(e, true); });
  document.addEventListener('paste', onPaste);
  new ResizeObserver(() => { drawOverlaySoon(); }).observe(st);
  try { document.fonts.addEventListener('loadingdone', () => { drawOverlaySoon(); }); } catch {}
  addEventListener('hashchange', () => { if (location.hash === '#present' && !PV.on) openPresent(); if (location.hash === '#inspect') setTab('inspect'); });
  afterRender.push(() => { lsSet('pinup.page', S.pageId); renderMarks(); });
  setLTab(lsGet('pinup.ltab', 'layers'));
  setTool('move');
  applyView();
  updateUndoButtons();
  renderChrome();
  initData();
  initPeople();
  initComments();
  initSample();
}
boot();
