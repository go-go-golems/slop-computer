// ---------- history log: every change is a step anyone can revert on its own ----------
const LOG = { items: new Map(), timers: new Map(), filter: lsGet('pinup.logfilter', 'all'), confirm: null, max: 400 };
function entryDoc(e) {
  const changes = e.changes.map(c => ({ id: c.id, before: c.before == null ? null : c.before, after: c.after == null ? null : c.after }));
  const names = [];
  for (const c of changes) { const n = c.after || c.before; if (n && n.name && names.length < 6 && c.id !== '__file') names.push(n.name); }
  const doc = { t: e.t, at: new Date(e.t).toISOString(), by: e.agent ? 'claude' : (S.me.id || null), label: e.label, feedback: e.feedback || null, revertOf: e.revertOf || null, page: S.pageId, count: changes.length, names, changes };
  if (JSON.stringify(doc).length > 200000) { doc.changes = []; doc.big = true; }
  return doc;
}
function logTouch(e) {
  if (!e || !e.logId) return;
  clearTimeout(LOG.timers.get(e.logId));
  LOG.timers.set(e.logId, setTimeout(() => { LOG.timers.delete(e.logId); writeLog(e); }, 450));
}
function writeLog(e) {
  if (!S.canEdit) return;
  const prev = LOG.items.get(e.logId) || {};
  const doc = Object.assign(entryDoc(e), { undone: !!prev.undone, revertedBy: prev.revertedBy || null });
  LOG.items.set(e.logId, Object.assign({ id: e.logId }, doc));
  queueWrite('log:' + e.logId, doc);
  if (e.revertOf) logMark(e.revertOf, { revertedBy: e.logId });
  logChanged();
}
function flushLog() { for (const [id, t] of LOG.timers) { clearTimeout(t); const e = [...H.undo, ...H.redo].find(x => x.logId === id); if (e) writeLog(e); } LOG.timers.clear(); }
function logMark(id, p, tries = 0) {
  const it = LOG.items.get(id);
  if (!it) { if (LOG.timers.has(id)) flushLog(); if (tries < 3) setTimeout(() => logMark(id, p, tries + 1), 600); return; }
  Object.assign(it, p);
  const d = Object.assign({}, it); delete d.id;
  queueWrite('log:' + id, d);
  logChanged();
}
function applyRemoteLog(id, data) {
  if (DB.pending.has('log:' + id)) return;
  if (data) LOG.items.set(id, Object.assign({}, data, { id })); else LOG.items.delete(id);
  logChanged();
}
const logChanged = rafThrottle(() => { if (S.ltab === 'history') renderHistory(); if (S.ltab === 'feedback') renderFeedbackPanel(); if (FB.sel) drawOverlay(); });
const curOf = id => (id === '__file' ? S.file : (get(id) || null));
const normFor = (id, v) => (v == null ? null : id === '__file' ? v : norm(id, v));
function logConflicts(it) { return (it.changes || []).filter(c => !stableEq(normFor(c.id, curOf(c.id)), normFor(c.id, c.after))); }
// mode: undefined = check first; 'force' = revert everything; 'safe' = only layers nobody changed since
function revertLog(id, mode) {
  const it = LOG.items.get(id);
  if (!it) return { ok: false };
  if (!S.canEdit) { toast('Only editors can revert changes.'); return { ok: false }; }
  if (it.big || !(it.changes || []).length) { toast('This step was too large to keep in history.'); return { ok: false }; }
  const conflicts = logConflicts(it);
  if (conflicts.length && !mode) { LOG.confirm = { id, n: conflicts.length, total: it.changes.length }; renderHistory(); return { ok: false, conflicts }; }
  const list = mode === 'safe' ? it.changes.filter(c => !conflicts.includes(c)) : it.changes;
  if (!list.length) { toast('Nothing left to revert — every layer changed since.'); return { ok: false }; }
  CUR_META = { revertOf: id };
  try { commit(list.slice().reverse().map(c => ({ id: c.id, after: c.before })), { label: (it.revertOf ? 'Restore: ' : 'Revert: ') + it.label.replace(/^(Revert|Restore): /, '') }); }
  finally { CUR_META = null; }
  S.sel = S.sel.filter(x => S.nodes.has(x));
  LOG.confirm = null;
  if (it.revertOf) logMark(it.revertOf, { revertedBy: null });
  // a reverted step reopens the feedback it closed
  if (it.feedback && !it.revertOf && FB.items.get(it.feedback)) { const f = FB.items.get(it.feedback); if (!isOpen(f)) fbPatch(f.id, { status: 'open' }); }
  return { ok: true };
}
function showStep(it) {
  const ids = (it.changes || []).map(c => c.id).filter(id => id !== '__file' && get(id));
  if (!ids.length) { toast('Those layers no longer exist'); return; }
  const pg = get(ids[0]).page; if (pg !== S.pageId) goPage(pg, true);
  const here = ids.filter(id => get(id).page === pg);
  const tops = selRoots(here);
  select(tops.slice(0, 50));
  requestAnimationFrame(() => requestAnimationFrame(() => zoomFitSel()));
}
function renderHistory() {
  const box = $('#lHistory'); if (!box || box.hidden) return;
  const scroll = box.scrollTop;
  box.textContent = '';
  const all = [...LOG.items.values()].sort((a, b) => b.t - a.t);
  const list = all.filter(it => LOG.filter === 'all' || (LOG.filter === 'claude' ? it.by === 'claude' : !!it.feedback));
  const wrap = h('div', { class: 'logpanel' });
  wrap.append(h('div', { class: 'stack', style: { padding: '10px 12px', gap: '8px', borderBottom: '1px solid var(--line)' } },
    segm([{ v: 'all', label: 'All' }, { v: 'claude', label: 'Claude' }, { v: 'feedback', label: 'Feedback' }], LOG.filter, v => { LOG.filter = v; lsSet('pinup.logfilter', v); renderHistory(); }, { aria: 'Filter history' }),
    h('p', { class: 'note', style: { margin: 0 }, text: 'Every change is a step. Revert any step on its own; reverting is a step too, so it can be restored.' })));
  if (!list.length) wrap.append(h('div', { class: 'blank', text: all.length ? 'No steps match this filter.' : 'Changes to the design appear here as steps, newest first.' }));
  let lastDay = '';
  for (const it of list.slice(0, 300)) {
    const day = new Date(it.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (day !== lastDay) { wrap.append(h('div', { class: 'hd', text: day })); lastDay = day; }
    const claude = it.by === 'claude';
    const who = claude ? 'Claude' : nameOf(it.by);
    const fb = it.feedback && FB.items.get(it.feedback);
    const reverted = !!it.revertedBy, undone = !!it.undone;
    const row = h('div', { class: 'logrow' + (reverted || undone ? ' off' : ''), role: 'button', tabindex: 0, onclick: e => { if (!e.target.closest('button')) showStep(it); }, onkeydown: e => { if (e.key === 'Enter') showStep(it); } },
      h('span', { class: 'av', style: { background: claude ? '#D97757' : colorFor(it.by || 'x'), border: 0, width: '22px', height: '22px', fontSize: '10px', marginLeft: 0 }, text: claude ? 'C' : initials(who) }),
      h('div', { class: 'fbbody' },
        h('div', { class: 'logl', text: it.label }),
        h('div', { class: 'fbmeta' }, `${who} · ${new Date(it.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`, it.count ? ` · ${it.count} layer${it.count === 1 ? '' : 's'}` : '', fb ? cssVar(h('button', { class: 'chipl', onclick: () => selectFeedback(fb.id, true) }, '#' + fb.n), '--c', fbCat(fb.cat).color) : null),
        it.names && it.names.length ? h('div', { class: 'fbmeta', text: it.names.slice(0, 4).join(', ') + (it.count > 4 ? '…' : '') }) : null,
        LOG.confirm && LOG.confirm.id === it.id ? h('div', { class: 'logconf' },
          h('span', { text: `${LOG.confirm.n} of ${LOG.confirm.total} layer${LOG.confirm.total === 1 ? '' : 's'} changed after this step.` }),
          h('div', { class: 'fbacts' },
            h('button', { class: 'btn sm', onclick: () => { revertLog(it.id, 'force'); } }, 'Revert anyway'),
            LOG.confirm.n < LOG.confirm.total ? h('button', { class: 'btn sm', onclick: () => { revertLog(it.id, 'safe'); } }, 'Only unchanged') : null,
            h('button', { class: 'btn sm ghost', onclick: () => { LOG.confirm = null; renderHistory(); } }, 'Cancel'))) :
          h('div', { class: 'fbacts' },
            reverted ? h('span', { class: 'fbst st-wontfix', text: it.revertOf ? 'Undone' : 'Reverted' }) : undone ? h('span', { class: 'fbst st-wontfix', text: 'Undone' }) : null,
            S.canEdit && !it.big && !undone ? (reverted ? h('button', { class: 'btn sm ghost', onclick: () => revertLog(it.revertedBy) }, 'Restore') : h('button', { class: 'btn sm ghost', onclick: () => revertLog(it.id) }, it.revertOf ? 'Undo revert' : 'Revert')) : null,
            it.big ? h('span', { class: 'fbmeta', text: 'too large to revert' }) : null)));
    wrap.append(row);
  }
  box.append(wrap);
  box.scrollTop = scroll;
}
// keep the shared log bounded
function pruneLog() {
  if (!S.canEdit || LOG.items.size <= LOG.max + 50) return;
  const old = [...LOG.items.values()].sort((a, b) => a.t - b.t).slice(0, LOG.items.size - LOG.max);
  for (const it of old) { LOG.items.delete(it.id); queueWrite('log:' + it.id, null); }
}
