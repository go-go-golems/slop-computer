// Keeping the world between visits. Every store is a SQLite image; the shell packs them into one
// gzip blob and keeps it in the viewer's private documents (data/users/<id>/…) in ~190 KB chunks.
// Without the db capability it falls back to IndexedDB, and without that the world lasts one visit.

export function pack(stores) {
  const ids = Object.keys(stores);
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, stores: ids.map(id => ({ id, size: stores[id].length })) }));
  const total = 4 + head.length + ids.reduce((a, id) => a + stores[id].length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  let o = 4 + head.length;
  for (const id of ids) { out.set(stores[id], o); o += stores[id].length; }
  return out;
}
export function unpack(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)));
  const stores = {}; let o = 4 + n;
  for (const s of head.stores) { stores[s.id] = bytes.slice(o, o + s.size); o += s.size; }
  return stores;
}
async function through(bytes, stream) { const r = new Response(new Blob([bytes]).stream().pipeThrough(stream)); return new Uint8Array(await r.arrayBuffer()); }
export const gzip = (b) => (typeof CompressionStream === 'function' ? through(b, new CompressionStream('gzip')) : Promise.resolve(b));
export const gunzip = (b) => (b[0] === 0x1f && b[1] === 0x8b && typeof DecompressionStream === 'function' ? through(b, new DecompressionStream('gzip')) : Promise.resolve(b));
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

const CHUNK = 190000;

function dbStorage(db, uid) {
  const manifest = db.doc(`data/users/${uid}/lab`);
  const chunks = manifest.collection('chunks');
  return {
    kind: 'your private documents',
    async load() {
      const m = await manifest.get();
      if (!m.exists) return null;
      const { gen, n } = m.data();
      const parts = await Promise.all(Array.from({ length: n }, (_, i) => chunks.doc(`g${gen}-${i}`).get()));
      if (parts.some(p => !p.exists)) throw new Error('a saved chunk is missing');
      return unpack(await gunzip(unb64(parts.map(p => p.data().b).join(''))));
    },
    async save(stores) {
      const z = await gzip(pack(stores)); const s = b64(z);
      const m = await manifest.get(); const prev = m.exists ? m.data() : null;
      const gen = (prev ? prev.gen : 0) + 1, n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) await chunks.doc(`g${gen}-${i}`).set({ b: s.slice(i * CHUNK, (i + 1) * CHUNK) });
      await manifest.set({ gen, n, bytes: z.length, savedAt: Date.now() });
      if (prev) for (let i = 0; i < prev.n; i++) chunks.doc(`g${prev.gen}-${i}`).delete().catch(() => {});
      return z.length;
    },
    async clear() { const m = await manifest.get(); if (m.exists) { const { gen, n } = m.data(); await manifest.delete(); for (let i = 0; i < n; i++) chunks.doc(`g${gen}-${i}`).delete().catch(() => {}); } },
  };
}

function idbStorage() {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('slop-lab', 1); r.onupgradeneeded = () => r.result.createObjectStore('w'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('w', mode); const q = f(t.objectStore('w')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return {
    kind: 'this browser',
    async load() { const v = await tx('readonly', s => s.get('world')); return v ? unpack(await gunzip(new Uint8Array(v))) : null; },
    async save(stores) { const z = await gzip(pack(stores)); await tx('readwrite', s => s.put(z.buffer, 'world')); return z.length; },
    async clear() { await tx('readwrite', s => s.delete('world')); },
  };
}

export async function storage() {
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const uid = user ? await user.id() : null;
      if (db && uid) return dbStorage(db, uid);
    } catch (e) { console.warn('db storage unavailable', e); }
  }
  try { if (typeof indexedDB !== 'undefined') { const s = idbStorage(); await s.load(); return s; } } catch (e) { /* fall through */ }
  return null;
}

// ---- zip: the world and single stores download as .zip files of plain .sqlite files ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function deflateRaw(b) { if (typeof CompressionStream !== 'function') return null; try { return await through(b, new CompressionStream('deflate-raw')); } catch { return null; } }
export async function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw), def = await deflateRaw(raw), useDef = !!def && def.length < raw.length, body = useDef ? def : raw;
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, useDef ? 8 : 0, true); lv.setUint16(10, time, true); lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, useDef ? 8 : 0, true); cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, body); central.push(ch); offset += lh.length + body.length;
  }
  const size = central.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  let e = bytes.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = bytes.subarray(start, start + csize);
    out[name] = method === 8 ? await through(data, new DecompressionStream('deflate-raw')) : data.slice();
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
export const STORE_README = (id) => `${id}.sqlite is one slop store: a plain SQLite 3 database. Open it with any SQLite tool
(sqlite3 ${id}.sqlite, DB Browser for SQLite, Datasette).

  _docs        documents: path, body (JSON), version, rev
  _files       the working tree (zone 'tree') and assets; contents in _blobs by sha256
  _log         one row per commit: rev, at (ms), principal, via, summary
  _changes     what each commit changed
  _snapshots   published snapshots of the tree; _refs names them (main)
  _cursors     reactor positions; _alarms scheduled alarms
  everything else is the app's own tables and views (see sql/*.sql in its app)

Example: sqlite3 ${id}.sqlite "SELECT path, json_extract(body, '$') FROM _docs WHERE body IS NOT NULL"
`;
