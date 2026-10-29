// ---------- present (prototype player) ----------
const PV = { on: false, cur: null, stack: [], start: null, busy: false };
function openPresent(startId) {
  finishEdit();
  const frames = allFrames().filter(f => !f.component && f.visible);
  if (!frames.length) { toast('Add a screen first'); return; }
  let start = startId && get(startId) ? startId : null;
  if (!start) { const sel = S.sel[0] && topOf(S.sel[0]); if (sel && sel.type === 'frame' && !sel.component) start = sel.id; }
  if (!start) { const f = framesOnPage(S.pageId).find(f => f.flow) || allFrames().find(f => f.flow) || framesOnPage(S.pageId)[0] || frames[0]; start = f.id; }
  PV.on = true; PV.start = start; PV.stack = [];
  const box = $('#present'); box.hidden = false;
  const fl = $('#pvFlow'); fl.textContent = '';
  const flows = allFrames().filter(f => f.flow);
  for (const f of flows) fl.append(h('option', { value: f.id, text: '▶ ' + f.flow, selected: f.id === start }));
  const og = h('optgroup', { label: 'Screens' });
  for (const f of frames) og.append(h('option', { value: f.id, text: f.name, selected: !flows.some(x => x.id === start) && f.id === start }));
  fl.append(og);
  $('#pvComment').hidden = !CA.ctl;
  showFrame(start, 'instant');
  try { if (location.hash !== '#present') history.replaceState(null, '', '#present'); } catch {}
  setTimeout(() => $('#pv').focus && $('#pv').focus(), 0);
}
function closePresent() {
  PV.on = false; $('#present').hidden = true; $('#pvclip').textContent = '';
  try { if (location.hash === '#present') history.replaceState(null, '', location.pathname + location.search); } catch {}
  if (PV.cur && get(PV.cur)) { const f = get(PV.cur); if (f.page !== S.pageId) goPage(f.page); select([PV.cur]); requestAnimationFrame(() => centerOn(PV.cur)); }
}
function pvScale(f) {
  const pv = $('#pv'); const W = pv.clientWidth - 48, Hh = pv.clientHeight - 48;
  const mode = $('#pvFit').value;
  if (mode === '1') return 1;
  if (mode === 'width') return Math.min(1, W / f.w);
  return Math.min(1, W / f.w, Hh / f.h);
}
function buildPresentEl(f) {
  const el = buildEl(Object.assign({}, f, { x: 0, y: 0 }), null, { mode: 'present', depth: 0, root: true });
  el.style.position = 'relative'; el.style.left = '0'; el.style.top = '0';
  el.classList.add('m-' + (f.mode || 'light'));
  return el;
}
function showFrame(id, tr = 'instant', dur = 250, back = false) {
  const f = get(id); if (!f) return;
  const clip = $('#pvclip'), box = $('#pvbox');
  const k = pvScale(f);
  const old = clip.firstElementChild;
  const el = buildPresentEl(f);
  box.style.width = f.w * k + 'px'; box.style.height = f.h * k + 'px';
  clip.style.width = f.w + 'px'; clip.style.height = f.h + 'px'; clip.style.transform = `scale(${k})`; clip.style.transformOrigin = '0 0';
  // tall screens scroll inside the device box
  clip.style.overflowY = 'hidden';
  $('#pvName').textContent = f.name + (PV.stack.length ? `  ·  ${PV.stack.length} back` : '');
  $('#pvBack').disabled = !PV.stack.length;
  PV.cur = id;
  if (!old || tr === 'instant' || matchMedia('(prefers-reduced-motion: reduce)').matches) { clip.textContent = ''; clip.append(el); presenceSoon(); return; }
  el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0';
  old.style.position = 'absolute'; old.style.left = '0'; old.style.top = '0';
  clip.append(el);
  const W = f.w; const ease = 'cubic-bezier(.2,.7,.2,1)';
  const flip = s => back ? ({ 'slide-left': 'slide-right', 'slide-right': 'slide-left', 'push-left': 'push-right', 'push-right': 'push-left' }[s] || s) : s;
  const t = flip(tr);
  let a1, a2;
  const o = { duration: dur, easing: ease, fill: 'both' };
  if (t === 'dissolve') { a1 = el.animate([{ opacity: 0 }, { opacity: 1 }], o); }
  else if (t === 'slide-left') a1 = el.animate([{ transform: `translateX(${W}px)` }, { transform: 'none' }], o);
  else if (t === 'slide-right') a1 = el.animate([{ transform: `translateX(${-W}px)` }, { transform: 'none' }], o);
  else if (t === 'slide-up') a1 = el.animate([{ transform: `translateY(${f.h}px)` }, { transform: 'none' }], o);
  else if (t === 'push-left') { a1 = el.animate([{ transform: `translateX(${W}px)` }, { transform: 'none' }], o); a2 = old.animate([{ transform: 'none' }, { transform: `translateX(${-W}px)` }], o); }
  else if (t === 'push-right') { a1 = el.animate([{ transform: `translateX(${-W}px)` }, { transform: 'none' }], o); a2 = old.animate([{ transform: 'none' }, { transform: `translateX(${W}px)` }], o); }
  else if (t === 'scale') a1 = el.animate([{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], o);
  else a1 = el.animate([{ opacity: 0 }, { opacity: 1 }], o);
  PV.busy = true;
  a1.finished.catch(() => {}).then(() => { old.remove(); el.style.position = 'relative'; a1.cancel(); a2 && a2.cancel(); PV.busy = false; });
  presenceSoon();
}
function linkFor(target) {
  // walk up from the clicked element to the first layer with an interaction (instances honour their main's links)
  let x = target; const root = $('#pvclip');
  while (x && x !== root) {
    if (x.dataset) {
      const nid = x.dataset.nid, mid = x.dataset.mid;
      if (mid) { const sub = x.dataset.sub ? get(x.dataset.sub) : null; if (sub && sub.link) return sub.link; const m = get(mid); if (m && m.link) return m.link; if (!x.dataset.sub && nid && get(nid) && get(nid).type === 'instance' && get(nid).link && mid === get(nid).of) return get(nid).link; }
      else if (nid) { const n = get(nid); if (n && n.link) return n.link; }
    }
    x = x.parentElement;
  }
  return null;
}
function follow(link) {
  if (!link || PV.busy) return;
  if (link.to === 'back') return goBack();
  if (!get(link.to)) { toast('That link points to a screen that no longer exists'); return; }
  PV.stack.push({ id: PV.cur, tr: link.tr, dur: link.dur });
  showFrame(link.to, link.tr || 'instant', link.dur || 250);
}
function goBack() {
  const prev = PV.stack.pop(); if (!prev) return;
  showFrame(prev.id, prev.tr || 'instant', prev.dur || 250, true);
}
function flashHotspots() {
  const clip = $('#pvclip'); const k = parseFloat((clip.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || 1);
  const cr = clip.getBoundingClientRect();
  $$('[data-nid]', clip).forEach(el => {
    if (!linkFor(el) || (el.parentElement && el.parentElement.closest('[data-nid]') && linkFor(el.parentElement) === linkFor(el))) return;
    const r = el.getBoundingClientRect();
    clip.parentElement.append(h('div', { class: 'hot', style: { left: (r.left - cr.left) + 'px', top: (r.top - cr.top) + 'px', width: r.width + 'px', height: r.height + 'px' } }));
  });
  setTimeout(() => $$('.hot').forEach(x => x.remove()), 1000);
}
function bindPresent() {
  $('#pvClose').onclick = closePresent;
  $('#pvBack').onclick = goBack;
  $('#pvRestart').onclick = () => { PV.stack = []; showFrame(PV.start, 'dissolve'); };
  $('#pvFlow').onchange = e => { PV.start = e.target.value; PV.stack = []; showFrame(PV.start, 'dissolve'); };
  $('#pvFit').onchange = () => showFrame(PV.cur, 'instant');
  $('#pvComment').onclick = () => { closePresent(); setTimeout(() => setTool('comment'), 50); toast('Click anywhere on the design to pin a comment'); };
  $('#pv').tabIndex = -1;
  $('#pvclip').addEventListener('click', e => { const l = linkFor(e.target); if (l && l.on !== 'hover') follow(l); else if (!l) flashHotspots(); });
  $('#pvclip').addEventListener('mouseover', e => { const l = linkFor(e.target); if (l && l.on === 'hover' && !PV.busy) follow(l); });
  $('#pv').addEventListener('click', e => { if (e.target === $('#pv')) flashHotspots(); });
  addEventListener('resize', () => { if (PV.on && PV.cur) showFrame(PV.cur, 'instant'); });
  $('#present').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') closePresent();
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') goBack();
    if (e.key === 'r' || e.key === 'R') { PV.stack = []; showFrame(PV.start, 'dissolve'); }
  });
}
