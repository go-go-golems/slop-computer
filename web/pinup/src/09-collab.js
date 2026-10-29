// ---------- capabilities ----------
const CAPS = {};
function cap(name) {
  if (!(name in CAPS)) CAPS[name] = (window.claude && typeof window.claude.use === 'function') ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null);
  return CAPS[name];
}
const capAssets = () => cap('assets');
const capDownloads = () => cap('downloads');
const inViewer = () => !!(window.claude && typeof window.claude.use === 'function');

function setReadOnly(reason) {
  if (!S.canEdit) return;
  S.canEdit = false; S.roReason = reason || '';
  if (!['move', 'hand', 'comment'].includes(S.tool)) setTool('move');
  $$('#tools [data-tool]').forEach(b => { if (!['move', 'hand', 'comment'].includes(b.dataset.tool)) b.hidden = true; });
  $$('#tools button:not([data-tool])').forEach(b => (b.hidden = true));
  $('#bUndo').hidden = true; $('#bRedo').hidden = true;
  if (S.tab === 'design') setTab('inspect');
  DIRTY.chrome = true; INSP.force = true; scheduleRender();
}

// ---------- data ----------
async function initData() {
  const db = await cap('db');
  if (db) {
    DB.kind = 'remote'; DB.db = db;
    let gotFile = false, gotNodes = false;
    const done = () => { if (gotFile && gotNodes && !S.loaded) onLoaded(); };
    db.doc('meta/file').onSnapshot(snap => { DB.fileExists = !!snap.exists; if (snap.exists) applyRemoteFile(snap.data()); gotFile = true; done(); }, err => { console.warn('[pinup] file listener', err); gotFile = true; done(); });
    db.collection('nodes').onSnapshot(snap => {
      for (const ch of snap.docChanges()) applyRemoteNode(ch.doc.id, ch.type === 'removed' ? null : ch.doc.data());
      gotNodes = true; done();
    }, err => { console.warn('[pinup] nodes listener', err); if (err && (err.code === 'not_granted' || err.code === 'revoked')) toast('This file is not available to you right now.'); gotNodes = true; done(); });
    db.collection('feedback').onSnapshot(snap => { for (const ch of snap.docChanges()) applyRemoteFeedback(ch.doc.id, ch.type === 'removed' ? null : ch.doc.data()); }, err => console.warn('[pinup] feedback listener', err));
    db.collection('log').onSnapshot(snap => { for (const ch of snap.docChanges()) applyRemoteLog(ch.doc.id, ch.type === 'removed' ? null : ch.doc.data()); }, err => console.warn('[pinup] log listener', err));
    db.collection('inbox').onSnapshot(snap => { for (const ch of snap.docChanges()) if (ch.type !== 'removed') inboxQueue(ch.doc.id, ch.doc.data()); }, () => {});
    setTimeout(() => { if (!S.loaded) { gotFile = gotNodes = true; done(); } }, 8000);
  } else {
    DB.kind = 'local';
    const saved = lsGet(LOCAL_KEY, null);
    if (saved && saved.file) { S.file = Object.assign(S.file, saved.file); for (const n of saved.nodes || []) S.nodes.set(n.id, norm(n.id, n)); for (const f of saved.feedback || []) FB.items.set(f.id, f); for (const l of saved.log || []) LOG.items.set(l.id, l); }
    if (!S.file.pages.find(p => p.id === S.pageId)) S.pageId = S.file.pages[0].id;
    invalidate(); markAllDirty();
    onLoaded();
    if (inViewer()) toast('Shared storage is unavailable here, so changes stay in this browser.', 4000);
  }
}
function onLoaded() {
  S.loaded = true;
  if (!S.file.pages.find(p => p.id === S.pageId)) S.pageId = S.file.pages[0].id;
  const pg = lsGet('pinup.page', null); if (pg && S.file.pages.find(p => p.id === pg)) S.pageId = pg;
  markAllDirty(); renderNow(); applyView();
  if (!lsGet('pinup.views', {})[S.pageId] && roots().length) requestAnimationFrame(() => requestAnimationFrame(zoomFitAll));
  presenceSoon();
  reportPinsSoon();
  inboxPump(); setTimeout(pruneLog, 5000);
  renderMarks(); updateTabCounts();
  if (location.hash === '#present' && allFrames().length) setTimeout(() => openPresent(), 200);
  if (location.hash === '#inspect') setTab('inspect');
  if (location.hash === '#comments') setTimeout(() => setTool('comment'), 300);
}
// first node written to an empty db also writes the file doc, so Claude can read the page list
const _qw = queueWrite;
queueWrite = function (id, data) { if (DB.kind === 'remote' && !DB.fileExists && id !== '__file') { DB.fileExists = true; _qw('__file', S.file); } return _qw(id, data); };

// inbox: Claude (or anyone) drops HTML; one editor tab imports it as layers
const INBOX = { busy: false, q: [], done: new Set(), t: 0 };
function inboxQueue(id, data) {
  if (INBOX.done.has(id) || INBOX.q.find(x => x.id === id)) return;
  INBOX.q.push({ id, data });
  const key = x => String(x.data && (x.data.seq != null ? String(x.data.seq).padStart(6, '0') : x.data.at) || x.id);
  INBOX.q.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  clearTimeout(INBOX.t); INBOX.t = setTimeout(inboxPump, 250);
}
async function inboxPump() {
  if (INBOX.busy || !S.canEdit || !S.loaded) return;
  const job = INBOX.q.shift(); if (!job) return;
  INBOX.busy = true;
  try {
    const ref = DB.db.doc('inbox/' + job.id);
    const lease = await ref.acquire({ holder: S.me.peer, ttlMs: 30000 }).catch(() => ({ acquired: false }));
    if (lease.acquired) {
      const d = Object.assign({}, job.data || {});
      if (d.html && !d.page) d.page = S.pageId;
      if (d.page && !S.file.pages.find(p => p.id === d.page)) d.page = (S.file.pages.find(p => p.name === d.page) || {}).id || S.pageId;
      if (!d.label) d.label = d.name ? 'Add ' + d.name : 'Claude step';
      const before = new Set(S.nodes.keys());
      await applyStep(job.id, d);
      INBOX.done.add(job.id);
      // bring new screens into view
      const added = [...S.nodes.values()].filter(n => !before.has(n.id) && !n.parent).map(n => n.id);
      if (added.length) { const pg = get(added[0]).page; if (pg !== S.pageId) goPage(pg); setTimeout(() => { select(added); zoomFitSel(); }, 60); }
      await ref.delete().catch(() => {});
      await sleep(500); // land steps one at a time so people can follow along
    }
  } catch (err) { console.warn('[pinup] inbox', err); }
  INBOX.busy = false;
  if (INBOX.q.length) inboxPump();
  else if (S.ltab === 'history') renderHistory();
}

// ---------- people ----------
const PEOPLE = { user: null, room: null, profiles: {} };
async function initPeople() {
  const user = await cap('user'); PEOPLE.user = user;
  if (user) {
    try { const me = await user.me(); S.me.id = me.id; S.me.name = me.name || 'You'; S.me.color = me.color || colorFor(me.id || S.me.peer); S.me.avatar = me.avatarUrl; } catch {}
    // editors (and the owner) change the design; contributors can leave feedback; commenters use comments
    try { const ed = await user.canEdit(); if (ed === false) setReadOnly('view'); } catch {}
    try { const can = await user.can('data.write'); if (can === false) { S.canFeedback = false; DIRTY.chrome = true; scheduleRender(); } } catch {}
  }
  const room = await cap('room'); PEOPLE.room = room;
  if (room) {
    room.onPeers(ch => { S.peers = ch.peers.map(decoratePeer); renderAvatars(); drawOverlaySoon(); resolveNames(); }, () => {});
    presenceSoon();
    checkSendable();
  }
  renderAvatars();
}
function decoratePeer(p) {
  const pr = p.presence || {};
  const prof = pr.u && PEOPLE.profiles[pr.u];
  return Object.assign({}, p, { _name: p.kind === 'agent' ? 'Claude' : (prof && prof.name) || pr.n || (p.guest ? 'Guest' : 'Someone'), _color: p.kind === 'agent' ? '#D97757' : (prof && prof.color) || colorFor(pr.u || p.peer), _avatar: prof && prof.avatarUrl });
}
const resolveNames = debounce(async () => {
  const ids = [...new Set(S.peers.map(p => p.presence && p.presence.u).filter(Boolean))].filter(id => !PEOPLE.profiles[id]);
  if (!ids.length || !PEOPLE.user || !PEOPLE.user.profiles) return;
  try { const ps = await PEOPLE.user.profiles(ids); Object.assign(PEOPLE.profiles, ps); S.peers = S.peers.map(decoratePeer); renderAvatars(); drawOverlaySoon(); } catch {}
}, 300);
function renderAvatars() {
  const box = $('#avatars'); if (!box) return; box.textContent = '';
  const others = S.peers.filter(p => !p.isMe);
  const seen = new Set();
  const list = others.filter(p => { const k = (p.presence && p.presence.u) || p.peer; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
  for (const p of list) {
    const pr = p.presence || {};
    const where = pr.page && pr.page !== S.pageId ? ` · on ${pageName(pr.page)}` : pr.frame ? ` · ${pr.frame}` : '';
    const b = h('button', { class: 'av', title: p._name + where + (p.kind === 'agent' ? '' : ' — click to jump to them'), 'aria-label': p._name, style: { background: p._avatar ? `url("${p._avatar}") center/cover` : p._color }, onclick: () => followPeer(p) }, p._avatar ? '' : initials(p._name));
    box.append(b);
  }
  if (others.length > list.length) box.append(h('span', { class: 'av', style: { background: 'var(--muted)' }, text: '+' + (others.length - list.length) }));
}
function followPeer(p) {
  const pr = p.presence || {};
  if (pr.page && pr.page !== S.pageId && S.file.pages.find(x => x.id === pr.page)) goPage(pr.page);
  const ids = (pr.sel || []).filter(id => get(id));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (ids.length) fitRect(union(ids.map(id => wrect(id))), 80, 2);
    else if (pr.cur) { const v = view(), sr = stageRect(); v.x = sr.width / 2 - pr.cur.x * v.z; v.y = sr.height / 2 - pr.cur.y * v.z; applyView(); }
  }));
}
// presence = what this tab is looking at; Claude in the conversation sees it too (less the cursor)
function presencePayload() {
  const sel = S.sel.filter(id => get(id)).slice(0, 20);
  const top = sel.length ? topOf(sel[0]) : null;
  return {
    u: S.me.id || null, n: S.me.id ? null : S.me.name,
    file: (S.file.name || '').slice(0, 80), page: S.pageId, pageName: pageName(S.pageId).slice(0, 60),
    frame: top ? top.name.slice(0, 60) : null, frameId: top ? top.id : null,
    sel, selection: sel.slice(0, 10).map(id => { const n = get(id); return { id, name: n.name.slice(0, 50), type: n.type === 'instance' ? 'instance of ' + ((get(n.of) || {}).name || '?').slice(0, 40) : n.type }; }),
    tab: S.tab, presenting: PV.on && PV.cur && get(PV.cur) ? get(PV.cur).name.slice(0, 60) : null,
    feedbackOpen: [...FB.items.values()].filter(isOpen).length,
    feedbackSelected: FB.sel && FB.items.get(FB.sel) ? { id: FB.sel, n: FB.items.get(FB.sel).n, text: (FB.items.get(FB.sel).text || '').slice(0, 200) } : null,
  };
}
const presenceSoon = debounce(() => { if (PEOPLE.room) PEOPLE.room.presence(presencePayload()).catch(() => {}); }, 150);
let curT = 0;
function presenceCursor(w) {
  if (!PEOPLE.room) return; const now = performance.now(); if (now - curT < 70) return; curT = now;
  PEOPLE.room.presence({ cur: { x: Math.round(w.x), y: Math.round(w.y) }, page: S.pageId }).catch(() => {});
}

// ---------- Claude in the conversation ----------
const SEND = { state: 'off' };
async function checkSendable() { if (!PEOPLE.room || !PEOPLE.room.canSendToClaudeSession) { SEND.state = 'off'; return; } try { SEND.state = await PEOPLE.room.canSendToClaudeSession(); } catch { SEND.state = 'off'; } updateAskUI(); }
const canSend = () => /^available/.test(SEND.state);
// must run synchronously inside the click
function sendSelectionToChat(note) {
  if (!PEOPLE.room || !canSend()) { toast('No conversation is open beside this page.'); return; }
  const sel = selRoots().slice(0, 12);
  const data = {
    label: sel.length ? 'Pinup · ' + sel.map(id => get(id).name).join(', ').slice(0, 60) : 'Pinup · ' + pageName(S.pageId),
    what: 'Pinup design file — the user is pointing at these layers. Edit them through the artifact db (nodes/<id>) or drop HTML into inbox/.',
    file: S.file.name, page: { id: S.pageId, name: pageName(S.pageId) },
    selection: sel.map(id => { const n = get(id); const t = topOf(id); return { id, name: n.name, type: n.type, screen: t && t.id !== id ? t.name : null, size: [Math.round((wrect(id) || n).w), Math.round((wrect(id) || n).h)] }; }),
  };
  if (note) data.note = note.slice(0, 1500);
  const deliver = note ? 'send' : 'stage';
  PEOPLE.room.sendToClaudeSession(data, { deliver }).then(r => toast(deliver === 'send' ? 'Sent to Claude — check the conversation' : 'Added to your message to Claude')).catch(err => toast(err && err.code === 'rate_limited' ? 'Slow down a moment, then try again' : 'Could not reach the conversation'));
}
function sendCommentsToChat() {
  if (!PEOPLE.room || !canSend()) { toast('No conversation is open beside this page.'); return; }
  const open = (S.threads || []).filter(t => !t.resolved).slice(0, 40);
  const data = {
    label: 'Pinup review comments' + (open.length ? ` (${open.length})` : ''),
    what: 'Review comments are pinned on this Pinup design. Read the open threads with the artifact comments tool; each anchor ends in #<nodeId>@x,y naming the layer it is about. Address them in the design and reply in the threads.',
    file: S.file.name,
    anchors: open.map(t => t.anchor),
  };
  PEOPLE.room.sendToClaudeSession(data, { deliver: 'stage' }).then(() => toast('Added to your message to Claude')).catch(() => toast('Could not reach the conversation'));
}

// ---------- comments pinned to layers ----------
const CA = { ctl: null, ns: null, composeAnchor: null, first: true };
const ANCHOR_RE = /#([A-Za-z0-9_~-]+)@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?),(\d+(?:\.\d+)?))?$/;
async function initComments() {
  const c = await cap('comments'); CA.ns = c;
  if (!c || typeof c.customAnchors !== 'function') { hideCommentUI(); return; }
  try {
    CA.ctl = await c.customAnchors({
      mode: on => { S.commentMode = on; if (on && S.tool !== 'comment') { S.tool = 'comment'; $$('#tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === 'comment'))); $('#stage').classList.add('comment'); } if (!on) { S.threads = S.threads; if (S.tool === 'comment') { S.tool = 'move'; $('#stage').classList.remove('comment'); $$('#tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === 'move'))); } OV.area = null; CA.composeAnchor = null; } reportPinsSoon(); },
      threads: list => { S.threads = list || []; reportPins(); DIRTY.chrome = true; scheduleRender(); },
      reveal: id => revealThread(id),
      composing: open => { if (!open) { OV.area = null; CA.composeAnchor = null; drawOverlaySoon(); } },
      move: (id, at) => { const a = anchorAtDoc(at.x, at.y); return a ? { anchor: a.anchor, at: a.at, label: a.label } : null; },
    });
  } catch (err) { console.warn('[pinup] comments', err); CA.ctl = null; hideCommentUI(); return; }
  reportPins();
}
function hideCommentUI() { const b = $('#tools [data-tool="comment"]'); if (b) b.hidden = true; }
function anchorFor(id, wx, wy) {
  const n = get(id); if (!n) return null; const t = topOf(id);
  const r = wrect(id) || n;
  const dx = Math.round(wx - r.x), dy = Math.round(wy - r.y);
  const cut = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);
  const label = t && t.id !== id ? `${cut(t.name, 36)} › ${cut(n.name, 36)}` : cut(n.name, 60);
  let anchor = `${label} #${id}@${dx},${dy}`;
  while (new TextEncoder().encode(anchor).length > 128) anchor = anchor.slice(0, 20) + '… ' + anchor.slice(anchor.indexOf('#'));
  return { anchor, label };
}
function anchorAtDoc(dxp, dyp) {
  // doc point → layer under it (the page does not scroll, so doc = client)
  const cx = dxp - scrollX, cy = dyp - scrollY;
  const w = toWorld(cx, cy);
  const hc = chainAt(cx, cy);
  if (hc) { const id = hc.chain[0]; const a = anchorFor(id, w.x, w.y); return a && { anchor: a.anchor, label: a.label, at: { x: dxp, y: dyp } }; }
  return { anchor: `Canvas · ${pageName(S.pageId).slice(0, 40)} #~${S.pageId}@${Math.round(w.x)},${Math.round(w.y)}`, label: 'Canvas · ' + pageName(S.pageId), at: { x: dxp, y: dyp } };
}
function pointForAnchor(anchor) {
  if (PV.on) return null;
  const m = String(anchor || '').match(ANCHOR_RE); if (!m) return null;
  const id = m[1], ax = +m[2], ay = +m[3];
  const sr = stageRect();
  let wx, wy;
  if (id[0] === '~') { if (id.slice(1) !== S.pageId) return null; wx = ax; wy = ay; }
  else {
    const n = get(id); if (!n || n.page !== S.pageId || !elOf(id)) return null;
    const r = wrect(id); if (!r) return null; wx = r.x + ax; wy = r.y + ay;
  }
  const p = toStage(wx, wy);
  if (p.x < -20 || p.y < -20 || p.x > sr.width + 20 || p.y > sr.height + 20) return null;
  return { x: sr.left + p.x + scrollX, y: sr.top + p.y + scrollY };
}
function reportPins() {
  if (!CA.ctl) return;
  const map = {};
  for (const t of S.threads || []) map[t.id] = pointForAnchor(t.anchor);
  if (CA.composeAnchor) map.composer = pointForAnchor(CA.composeAnchor);
  try { CA.ctl.placed(map); } catch {}
}
const reportPinsSoon = rafThrottle(reportPins);
function revealThread(id) {
  const t = (S.threads || []).find(x => x.id === id); if (!t) return;
  const m = String(t.anchor).match(ANCHOR_RE); if (!m) return;
  if (PV.on) closePresent();
  const nid = m[1];
  if (nid[0] === '~') { const pid = nid.slice(1); if (pid !== S.pageId && S.file.pages.find(p => p.id === pid)) goPage(pid); requestAnimationFrame(() => { const v = view(), sr = stageRect(); v.x = sr.width / 2 - +m[2] * v.z; v.y = sr.height / 2 - +m[3] * v.z; applyView(); }); return; }
  const n = get(nid); if (!n) return;
  if (n.page !== S.pageId) goPage(n.page, true);
  requestAnimationFrame(() => requestAnimationFrame(() => { centerOn(nid); reportPins(); }));
}
function commentDown(e, base) {
  if (!CA.ctl) return;
  const areasOk = (() => { try { return CA.ctl.areas; } catch { return false; } })();
  Object.assign(DRAG, base, { kind: 'area', canArea: areasOk });
  capture(e);
}
function endArea(e) {
  const d = Object.assign({}, DRAG);
  const area = OV.area;
  if (!d.moved || !area || !d.canArea || area.w < 8 || area.h < 8) { OV.area = null; return commentAt(e.clientX, e.clientY); }
  // area comment: anchored to the screen it sits on, in that screen's coordinates
  const fid = frameAt(d.sx, d.sy, true);
  const sr = stageRect();
  const p = toStage(area.x, area.y);
  const at = { x: sr.left + p.x + scrollX, y: sr.top + p.y + scrollY };
  let anchor, label;
  if (fid) { const f = get(fid); const fr = wrect(fid); const ax = Math.round(area.x - fr.x), ay = Math.round(area.y - fr.y); label = 'Area in ' + f.name.slice(0, 40); anchor = `area ${f.name.slice(0, 50)} #${fid}@${ax},${ay},${Math.round(area.w)},${Math.round(area.h)}`; }
  else { label = 'Area on ' + pageName(S.pageId); anchor = `area #~${S.pageId}@${Math.round(area.x)},${Math.round(area.y)},${Math.round(area.w)},${Math.round(area.h)}`; }
  CA.composeAnchor = anchor;
  CA.ctl.compose(anchor, at, { label, area: true }).then(r => { if (!r.opened) { OV.area = null; drawOverlaySoon(); } }).catch(commentErr);
}
function commentAt(cx, cy) {
  const a = anchorAtDoc(cx + scrollX, cy + scrollY); if (!a) return;
  CA.composeAnchor = a.anchor;
  CA.ctl.compose(a.anchor, a.at, { label: a.label }).catch(commentErr);
}
function commentOnSelection() {
  if (!CA.ctl) return;
  const id = S.sel[0]; if (!id) { setTool('comment'); return; }
  const r = wrect(id); const a = anchorFor(id, r.x + Math.min(r.w / 2, 24), r.y + Math.min(r.h / 2, 24));
  const p = toStage(r.x + Math.min(r.w / 2, 24), r.y + Math.min(r.h / 2, 24)); const sr = stageRect();
  CA.composeAnchor = a.anchor;
  CA.ctl.compose(a.anchor, { x: sr.left + p.x + scrollX, y: sr.top + p.y + scrollY }, { label: a.label }).catch(commentErr);
}
function commentErr(err) {
  const c = err && err.code;
  if (c === 'unavailable' || c === 'forbidden') { toast('Commenting is off for you here.'); hideCommentUI(); }
  else if (c === 'rate_limited') toast('One moment — then try again');
  else console.warn('[pinup] compose', err);
}

// ---------- share sheet ----------
function openShare() {
  checkSendable();
  const open = (S.threads || []).filter(t => !t.resolved).length;
  const here = S.peers.filter(p => !p.isMe);
  const body = [
    h('div', { class: 'opt' }, h('b', { text: 'Invite people to critique or co-design' }),
      h('span', { text: 'Use Share on this artifact in Claude. Editors design with you live. Contributors (“can use”) can leave feedback with the Feedback tool (N): pinned to layers, with sketches, ready to hand to Claude. Commenters use comment threads (C).' })),
    h('div', { class: 'opt' }, h('b', { text: 'Send reviewers straight to the prototype' }),
      h('span', { text: 'Add #present to the end of the artifact link. #comments opens in comment mode.' })),
    h('div', { class: 'opt' }, h('b', { text: 'Bring the feedback to Claude' }),
      h('span', { text: (open ? `${open} open thread${open === 1 ? '' : 's'} visible in comment mode. ` : '') + 'Claude reads every comment and the layer it points at, then makes the changes.' }),
      h('div', { class: 'acts' }, h('button', { class: 'btn primary sm', disabled: !canSend(), title: canSend() ? '' : 'Open this artifact beside a Claude conversation to send', onclick: () => sendCommentsToChat() }, 'Send comments to Claude'))),
    h('div', { class: 'opt' }, h('b', { text: 'Hand off to code' }),
      h('span', { text: 'Tokens, screens as React + Tailwind, components and the prototype map, ready for Claude Code.' }),
      h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => copyText(handoffMarkdown(), 'Handoff copied') }, 'Copy handoff'), h('button', { class: 'btn sm', onclick: () => saveFile(slug(S.file.name) + '-handoff.md', handoffMarkdown()) }, 'Download'))),
  ];
  if (here.length) body.push(h('div', { class: 'opt' }, h('b', { text: 'Here now' }), h('span', { text: here.map(p => p._name).join(', ') })));
  if (!S.canEdit) body.unshift(h('p', { text: 'You can view, present and comment on this file. Ask the owner for edit access to change the design.' }));
  sheet('Share & review', body, { width: 560 });
}
