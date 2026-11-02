// Small helpers shared by the kernel: hashing, ids, paths, JSON, levels.

// SHA-256, synchronous (turns are synchronous, so crypto.subtle is not an option).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor((l * 8) / 2 ** 32));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function rid(prefix, n = 8) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return prefix + Array.from(a, x => B32[x & 31]).join('');
}

export const LEVELS = ['none', 'view', 'interact', 'admin', 'owner'];
export const lv = (l) => Math.max(0, LEVELS.indexOf(l || 'none'));
export const maxLevel = (a, b) => (lv(a) >= lv(b) ? a : b);
export const minLevel = (a, b) => (lv(a) <= lv(b) ? a : b);

export class SlopError extends Error {
  constructor(code, message, extra) { super(message || code); this.code = code; if (extra) Object.assign(this, extra); }
}
export const err = (code, message, extra) => new SlopError(code, message, extra);

export function segs(path) {
  if (typeof path !== 'string' || !path) throw err('invalid_argument', 'path must be a non-empty string');
  const s = path.split('/');
  if (s.some(x => !x) || s.length > 16 || path.length > 1000 || s.some(x => x.length > 200)) throw err('invalid_argument', `bad path "${path}"`);
  return s;
}
export function docPath(path) {
  const s = segs(path);
  if (s.length % 2) throw err('invalid_argument', `"${path}" names a collection; documents have an even number of segments`);
  return { coll: s.slice(0, -1).join('/'), id: s[s.length - 1] };
}
export function collPath(path) {
  const s = segs(path);
  if (!(s.length % 2)) throw err('invalid_argument', `"${path}" names a document; collections have an odd number of segments`);
  return path;
}

export function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  return o;
}
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
export function depth(v, d = 0) {
  if (d > 40) return d;
  if (Array.isArray(v)) return v.reduce((m, x) => Math.max(m, depth(x, d + 1)), d + 1);
  if (isObj(v)) return Object.values(v).reduce((m, x) => Math.max(m, depth(x, d + 1)), d + 1);
  return d;
}

// Values crossing a boundary: integers beyond 2^53 - 1 become decimal strings, never BigInt.
export function clean(v) {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (Array.isArray(v)) return v.map(clean);
  if (v instanceof Uint8Array) return { $bytes: v.length };
  if (isObj(v)) { const o = {}; for (const k in v) o[k] = clean(v[k]); return o; }
  return v;
}

export const enc = (s) => new TextEncoder().encode(s);
export const dec = (b) => new TextDecoder().decode(b);

export function globMatch(glob, s) {
  if (glob === '*' || glob === '**') return true;
  const re = new RegExp('^' + glob.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(s);
}

export function parseEvery(spec) {
  if (typeof spec === 'number') return spec;
  const m = /^\s*(\d+)\s*(ms|s|m|min|h|d)\s*$/.exec(String(spec || ''));
  if (!m) throw err('invalid_argument', `alarm interval "${spec}" is not like 30s, 5m, 1h or 1d`);
  return Number(m[1]) * { ms: 1, s: 1e3, m: 6e4, min: 6e4, h: 36e5, d: 864e5 }[m[2]];
}

export function guessType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ({ html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', md: 'text/markdown', sql: 'application/sql', txt: 'text/plain', csv: 'text/csv', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ext] || 'application/octet-stream';
}
export const isText = (type) => /^text\/|json|javascript|sql|svg|markdown/.test(type);
