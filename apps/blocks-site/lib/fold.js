// The fold: a workspace's stored ops replayed into a fresh kernel, exactly
// as the editor's Net.load does (slop-computer web/blocks/src/blocks.js),
// so that a published page is what its author sees. The source is a store
// handle (use('stores').open(alias)) or anything with the same docs API.
const { H } = require('./blocks.js');

const MARGIN = 15 * 60 * 1000; // chunks this much older than the checkpoint may still hold new ops

// FNV-1a, as blocks.js: a peer's user part is "u" + hash32(writer id) in base 36.
function hash32(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function roleOf(id) { const i = id.indexOf(':'); return i < 0 ? { u: '', role: id } : { u: id.slice(0, i), role: id.slice(i + 1) }; }
const kindOfPeer = (id) => (roleOf(id).role === 'you' ? 'human' : 'agent');
function ensurePeer(K, id) { if (!K.peers.has(id)) K.peer({ id, kind: kindOfPeer(id) }); }
// An op counts only if its peer belongs to the chunk's writer (a chunk without a writer is taken as is).
function owns(by, peer) { if (!by || typeof peer !== 'string') return true; return roleOf(peer).u === 'u' + hash32(by).toString(36); }

function fold(src) {
  const K = new H.Kernel();
  let base = null, folded = {};
  const ptr = src.docs.get('meta/snap'), snap = ptr && ptr.exists ? ptr.data() : null;
  if (snap && snap.id && snap.parts) {
    const parts = [];
    for (let i = 0; i < snap.parts; i++) parts.push(src.docs.get(`snaps/${snap.id}-${i}`));
    if (parts.every((p) => p.exists)) {
      const cp = { clock: snap.clock || 0, ops: [], stamps: [] };
      for (const p of parts) { const d = p.data() || {}; cp.ops.push(...(d.ops || [])); cp.stamps.push(...(d.stamps || [])); }
      for (const [peer] of cp.ops) ensurePeer(K, peer);
      K.restore(cp, snap.id);
      base = snap; folded = snap.folded || {};
    }
  }
  const q = base ? { filters: [{ field: 'at', op: '>=', value: base.at - MARGIN }] } : {};
  const fresh = [];
  let last = base ? base.at || 0 : 0;
  for (const doc of src.docs.query('chunks', q)) {
    const d = doc.data() || {}, ops = Array.isArray(d.ops) ? d.ops : [], f = folded[doc.id];
    ops.forEach((o, i) => {
      if (!Array.isArray(o) || typeof o[3] !== 'string') return;
      if (f && (i < f[0] - 1 || (i === f[0] - 1 && o[0] === f[1]))) return;
      if (K.seen.has(o[0]) || !owns(d.by, o[1])) return;
      fresh.push({ id: o[0], peer: o[1], clock: +o[2] || 0, text: o[3], at: +o[4] || 0 });
    });
  }
  fresh.sort((a, b) => (a.clock - b.clock) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
  K.batch(() => {
    for (const d of fresh) {
      ensurePeer(K, d.peer);
      K.receive({ id: d.id, peer: d.peer, clock: d.clock, text: String(d.text), at: d.at || Date.now() });
      if (d.at > last) last = d.at;
    }
  });
  return { K, ops: fresh.length, at: last };
}

module.exports = { fold, owns, hash32 };
