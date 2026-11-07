/* Pinboard · presence: who else is here, their cursors and selections, the
 * clips they are dragging, and following someone's view.
 *
 * Presence is the room's small per-person object (at most 4 KiB), sent at most
 * about 15 times a second:
 *   { cursor: {x, y} | absent,   world coordinates on the canvas
 *     sel: [clip ids],           what they have selected (first 50)
 *     view: {x, y, z},           their pan and zoom
 *     drag: {ids, dx, dy} | absent  clips they are dragging, by how much }
 * Nothing here is durable: a dropped clip becomes one db write (board.js).
 */
(function (PB) {
  'use strict';
  const P = PB.presence = { peers: [], following: null };
  const el = PB.el;
  let room = null, out = {}, timer = null, layer = null, bar = null;
  const names = {};                    // user id → profile {name, color}
  const marked = new Map();            // clip id → element outlined for someone else's selection
  const moved = new Set();             // clip ids shown at someone else's drag position

  const initials = (t) => (t || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const colorOf = (id) => {
    const p = names[id]; if (p && p.color) return p.color;
    let h = 0; for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 'hsl(' + (h % 360) + ' 65% 45%)';
  };
  const nameOf = (peer) => (names[peer.by] && names[peer.by].name) || (peer.guest ? 'guest' : 'someone');

  // ---------- sending ----------
  function send(patch) {
    if (!room) return;
    Object.assign(out, patch);
    if (!timer) timer = setTimeout(flush, 66);
  }
  function flush() {
    timer = null; const p = out; out = {};
    room.presence(p).catch(e => console.warn('presence', e));
  }
  P.drag = (d) => send({ drag: d ? { ids: d.ids.slice(0, 50), dx: Math.round(d.dx), dy: Math.round(d.dy) } : null });

  // ---------- names ----------
  async function resolve(ids) {
    const want = [...new Set(ids.filter(id => id && !names[id]))];
    if (!want.length || !PB.rt.user || !PB.rt.user.profiles) return;
    try { Object.assign(names, await PB.rt.user.profiles(want)); } catch (e) { want.forEach(id => names[id] = names[id] || {}); }
    draw();
  }

  // ---------- drawing ----------
  function draw() {
    if (!layer) return;
    const peers = P.peers;
    // cursors (in world coordinates, inside the transformed canvas; scaled back to a constant size)
    const z = (PB.board.view && PB.board.view.z) || 1;
    const seen = new Set();
    peers.forEach(p => {
      const c = p.presence && p.presence.cursor; const key = p.peer;
      let e = layer.querySelector('[data-peer="' + CSS.escape(key) + '"]');
      if (!c) { if (e) e.remove(); return; }
      seen.add(key);
      if (!e) { e = el('div', 'peercursor'); e.dataset.peer = key; e.append(el('span', 'arrow'), el('span', 'who')); layer.append(e); }
      e.style.left = c.x + 'px'; e.style.top = c.y + 'px'; e.style.transform = 'scale(' + (1 / z) + ')';
      e.style.setProperty('--peer', colorOf(p.by));
      e.querySelector('.who').textContent = nameOf(p);
    });
    layer.querySelectorAll('.peercursor').forEach(e => { if (!seen.has(e.dataset.peer)) e.remove(); });
    // others' selections: an outline in their colour
    const want = new Map();
    peers.forEach(p => ((p.presence && p.presence.sel) || []).forEach(id => { if (!want.has(id)) want.set(id, p); }));
    marked.forEach((e, id) => { if (!want.has(id)) { e.style.boxShadow = ''; e.removeAttribute('data-peersel'); marked.delete(id); } });
    want.forEach((p, id) => {
      const e = document.querySelector('#canvas .clip[data-id="' + CSS.escape(id) + '"], #pins .clip[data-id="' + CSS.escape(id) + '"]');
      if (!e) return;
      e.style.boxShadow = '0 0 0 2px ' + colorOf(p.by); e.dataset.peersel = nameOf(p); marked.set(id, e);
    });
    // others' drags: their clips move on my screen while they drag; the drop arrives as a db change
    const dragging = new Set();
    peers.forEach(p => {
      const d = p.presence && p.presence.drag; if (!d) return;
      (d.ids || []).forEach(id => {
        const c = PB.S.clips[id]; if (!c || c.pinned) return;
        if (PB.board.dragIds && PB.board.dragIds().includes(id)) return;
        const e = document.querySelector('#canvas .clip[data-id="' + CSS.escape(id) + '"]'); if (!e) return;
        e.style.left = (c.x + d.dx) + 'px'; e.style.top = (c.y + d.dy) + 'px'; e.classList.add('peerdrag');
        dragging.add(id);
      });
    });
    moved.forEach(id => { if (!dragging.has(id)) { const e = document.querySelector('#canvas .clip[data-id="' + CSS.escape(id) + '"]'); if (e) e.classList.remove('peerdrag'); PB.board.renderClip(id); } });
    moved.clear(); dragging.forEach(id => moved.add(id));
    drawBar();
    follow();
  }
  // People here, at the right of the title: click someone to follow their view.
  function drawBar() {
    if (!bar) return;
    const sig = P.peers.map(p => p.peer + ':' + (names[p.by] && names[p.by].name || '') + ':' + (P.following === p.peer)).join('|');
    if (bar.dataset.sig === sig) return; bar.dataset.sig = sig;
    bar.innerHTML = '';
    const byPerson = new Map(); P.peers.forEach(p => { if (!byPerson.has(p.by || p.peer)) byPerson.set(p.by || p.peer, p); });
    byPerson.forEach((p) => {
      const b = el('button', 'peer' + (P.following === p.peer ? ' on' : ''), initials(nameOf(p)));
      b.style.background = colorOf(p.by);
      b.title = (P.following === p.peer ? 'following ' : 'follow ') + nameOf(p) + (p.guest ? ' (guest)' : '');
      b.addEventListener('click', () => { P.following = P.following === p.peer ? null : p.peer; drawBar(); follow(); PB.toast(P.following ? 'following ' + nameOf(p) + ' · pan or zoom to stop' : 'stopped following'); });
      bar.append(b);
    });
  }
  function follow() {
    if (!P.following) return;
    const p = P.peers.find(x => x.peer === P.following);
    if (!p) { P.following = null; drawBar(); return; }
    const v = p.presence && p.presence.view; if (!v) return;
    const B = PB.board; if (B.view.x === v.x && B.view.y === v.y && B.view.z === v.z) return;
    P._applying = true; B.view = { x: v.x, y: v.y, z: v.z }; B.applyView(); P._applying = false;
  }
  const stopFollowing = () => { if (P.following) { P.following = null; drawBar(); } };

  // ---------- start ----------
  P.init = function () {
    room = PB.rt.room; if (!room) return;
    const canvas = document.getElementById('canvas'), wrap = document.getElementById('boardwrap');
    layer = el('div', 'peerlayer'); canvas.append(layer);
    bar = document.getElementById('people');
    room.onPeers(ch => {
      P.peers = (ch.peers || []).filter(p => !p.isMe && p.peer);
      resolve(P.peers.map(p => p.by));
      draw();
    }, e => console.warn('peers', e));
    // what I send: cursor, selection, view, drags
    let last = 0;
    wrap.addEventListener('pointermove', ev => {
      const now = performance.now(); if (now - last < 50) return; last = now;
      const w = PB.board.toWorld(ev.clientX, ev.clientY); send({ cursor: { x: Math.round(w.x), y: Math.round(w.y) } });
    });
    wrap.addEventListener('pointerleave', () => send({ cursor: null }));
    wrap.addEventListener('wheel', stopFollowing, { capture: true, passive: true });
    wrap.addEventListener('pointerdown', ev => { if (ev.target === wrap || ev.target === canvas) stopFollowing(); }, { capture: true });
    PB.on('selection', ids => send({ sel: ids.slice(0, 50) }));
    PB.on('view', v => { send({ view: { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z * 1000) / 1000 } }); if (!P._applying) draw(); });
    PB.on('drag', P.drag);
    // re-apply outlines and drags after the board re-renders windows
    PB.on('change', () => requestAnimationFrame(draw));
    PB.on('mutation', () => requestAnimationFrame(draw));
    send({ view: PB.board.view, sel: [...PB.board.sel] });
  };
})(window.PB);
