// ui/archive.js — an app as a zip, and a zip as a new app's files.
//
// A download holds draft's files (text; files kept by hash are listed, not
// included), the open proposals' changed files, the threads with readable
// transcripts, the timeline, and the bench's meta for the app. Importing
// takes the text files of such a download, or of any zip of an app.
//
// Public API: makeZip, readZip, appZip, readArchive, transcriptMd,
// timelineMd, saveFile, slug.
import { checkPath } from '../core/draft.js';
import { h, toast } from '../lib/dom.js';
import { now, plural } from '../lib/util.js';

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
async function viaStream(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()) }
async function deflateRaw(u8) { try { return typeof CompressionStream === 'undefined' ? null : await viaStream(u8, new CompressionStream('deflate-raw')) } catch { return null } }
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unzip compressed files')
  return viaStream(u8, new DecompressionStream('deflate-raw'))
}
// entries: [{name, data: string | Uint8Array}] -> Blob (deflate when it helps, else store; UTF-8 names)
export async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []
  const d = new Date(), dt = (((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0
  let off = 0
  for (const e of entries) {
    const name = enc.encode(e.name), raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    const crc = crc32(raw); let body = raw, method = 0
    if (raw.length > 128) { const z = await deflateRaw(raw); if (z && z.length < raw.length) { body = z; method = 8 } }
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true); lh.setUint32(10, dt, true)
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true)
    parts.push(new Uint8Array(lh.buffer), name, body)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint32(12, dt, true)
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true)
    central.push(new Uint8Array(ch.buffer), name)
    off += 30 + name.length + body.length
  }
  const size = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
export async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip file')
  const n = dv.getUint16(e + 10, true), dec = new TextDecoder(), out = []
  let p = dv.getUint32(e + 16, true)
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory')
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), body = u8.subarray(start, start + csize)
    if (method === 0) out.push({ name, data: body }); else if (method === 8) out.push({ name, data: await inflateRaw(body) })
  }
  return out
}

// ---------- readable exports ----------
const fence = (text, lang = '') => { const run = Math.max(2, ...((String(text).match(/`+/g) || []).map(s => s.length))) + 1; const f = '`'.repeat(run); return f + lang + '\n' + text + '\n' + f }
export const slug = s => String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'untitled'
const stamp = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19)
export function transcriptMd(P, th) {
  const out = ['# ' + th.title, '', 'App: ' + P.app + ' · thread started ' + stamp(th.created) + ' · exported ' + stamp(now()), 'Mode: ' + (th.mode || 'auto') + ' · commits to: ' + (th.target === 'draft' ? 'draft' : 'proposals') + ' · model: ' + (th.model || th.tier || 'default'), '']
  if (th.summary) out.push('> **Summary Claude sees in place of messages 1–' + th.summary.upTo + '** (' + (th.summary.by === 'you' ? 'edited by you' : th.summary.by === 'fallback' ? 'listed without a model' : 'by Claude') + ', ' + stamp(th.summary.t) + ')', '>', ...th.summary.text.split('\n').map(l => '> ' + l), '')
  for (const [i, m] of th.msgs.entries()) {
    if (th.summary && i === th.summary.upTo) out.push('---', '', '*Claude sees the messages from here on in full; the ones above are summarized.*', '')
    out.push('---', '')
    if (m.role === 'user') {
      out.push('## You · ' + stamp(m.t), '')
      const ctx = [m.ctx && m.ctx.sel ? 'selected ' + m.ctx.sel.tag + ' at ' + m.ctx.sel.src : '', m.ctx && m.ctx.pins ? plural(m.ctx.pins, 'open pin') : ''].filter(Boolean)
      if (ctx.length) out.push('> context: ' + ctx.join(' · '), '')
      out.push(m.text, '')
      continue
    }
    out.push('## Claude · ' + stamp(m.t) + (m.model ? ' · ' + m.model : ''), '')
    ;(m.steps || []).forEach((s, i) => {
      out.push('### eval ' + (i + 1) + ' · ' + (s.status || '?') + (s.ms != null ? ' · ' + s.ms + ' ms' : '') + (s.calls && s.calls.length ? ' · ' + [...new Set(s.calls)].join(', ') : ''), '', fence(s.code, 'js'), '')
      if (s.logs && s.logs.length) out.push('Logs:', '', fence(s.logs.join('\n')), '')
      if (s.out) out.push('Result:', '', fence(s.out, s.fmt || (s.status === 'ok' ? 'json' : '')), '')
    })
    if (m.text) out.push(m.text, '')
    if (m.error) out.push('> ' + m.error, '')
    if (m.summary) out.push('_' + m.summary + '_', '')
  }
  return out.join('\n')
}
export function timelineMd(P) {
  const who = e => e.who === 'agent' ? 'Claude' + (P.threads.get(e.thread) ? ' (' + P.threads.get(e.thread).title + ')' : '') : e.who === 'push' ? 'outside' : e.who === 'ide' ? 'bench' : 'you'
  const what = e => e.kind === 'commit' ? 'committed ' + (e.paths || []).map(p => '`' + p + '`').join(', ') : e.kind === 'mark' ? '**' + (e.mk || 'mark') + ': ' + e.label + '**' + (e.note ? ' (' + e.note + ')' : '') : e.kind === 'eval' ? 'eval' + (e.calls && e.calls.length ? ': ' + e.calls.join(', ') : '') : e.kind
  const out = ['# Timeline: ' + P.app, '', '| seq | Time | Who | What | Where | Note |', '|---|---|---|---|---|---|']
  for (const e of P.events) out.push('| ' + (e.seq ?? '') + ' | ' + stamp(e.at) + ' | ' + who(e) + ' | ' + what(e).replace(/\|/g, '/') + ' | ' + (e.ref || 'draft') + (e.n != null ? ' ' + e.n : '') + ' | ' + String(e.note || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140) + ' |')
  return out.join('\n') + '\n'
}
export async function appZip(P) {
  const E = [], add = (name, data) => E.push({ name, data: typeof data === 'string' ? data : JSON.stringify(data, null, 1) })
  const paths = P.list('draft'), hashed = paths.filter(p => P.read(p, 'draft') === null)
  for (const path of paths) { const t = P.read(path, 'draft'); if (t !== null) add('files/' + path, t) }
  for (const p of P.openProposals()) {
    const ch = await P.changes(p.ref).catch(() => [])
    add('proposals/' + p.ref.slice(9) + '.json', { ref: p.ref, title: p.title, base: p.base, thread: p.thread, changes: ch.map(c => ({ path: c.path, removed: !c.entry })) })
    for (const c of ch) if (c.after !== null) add('proposals/' + p.ref.slice(9) + '/' + c.path, c.after)
  }
  let k = 0
  for (const th of [...P.threads.values()].sort((a, b) => a.created - b.created)) {
    await P.loadThread(th.id).catch(() => null)
    if (!th.msgs) continue
    k++
    add('threads/' + th.id + '.json', { ...th, saved: undefined })
    add('transcripts/' + String(k).padStart(2, '0') + '-' + slug(th.title) + '.md', transcriptMd(P, th))
  }
  add('project.json', P.meta)
  add('timeline.json', P.events); add('timeline.md', timelineMd(P))
  add('bench.json', { bench: 3, app: P.app, title: P.title, exported: now(), refs: P.refs, draft: P.draft.head,
    counts: { files: paths.length, proposals: P.openProposals().length, threads: k, events: P.events.length },
    keptByHash: hashed, layout: 'files/ = draft (text files; keptByHash lists the others). proposals/ = open proposals, their changed files. threads/ + transcripts/ = agent threads. timeline.* = the session log.' })
  return makeZip(E)
}
// A zip (a bench download, or any folder of an app's files) → the text
// files of a new app's draft: [{path, text}].
const TEXT_EXT = /\.(html?|css|js|mjs|json|md|markdown|svg|txt|xml|csv|sql)$/i
export async function readArchive(buf, filename = 'import') {
  const head = new Uint8Array(buf.slice ? buf.slice(0, 4) : buf)
  if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error(filename + ' is not a zip')
  const entries = await readZip(buf), dec = new TextDecoder()
  const manifest = entries.find(e => /(^|\/)bench\.json$/.test(e.name))
  if (manifest) {
    const root = manifest.name.slice(0, -'bench.json'.length) + 'files/'
    return entries.filter(e => e.name.startsWith(root) && e.name.length > root.length).map(e => ({ path: e.name.slice(root.length), text: dec.decode(e.data) })).filter(f => !checkPath(f.path))
  }
  // a plain folder of files: keep text files, drop a shared top folder
  const texts = entries.filter(e => TEXT_EXT.test(e.name) && e.data.length < 240000)
  if (!texts.length) throw new Error('no text files (html, css, js, md, sql…) in that zip')
  const tops = new Set(texts.map(e => e.name.includes('/') ? e.name.split('/')[0] + '/' : ''))
  const strip = tops.size === 1 && [...tops][0] ? [...tops][0] : ''
  return texts.map(e => ({ path: e.name.slice(strip.length), text: dec.decode(e.data) })).filter(f => !checkPath(f.path))
}
// hand a file to the viewer: the downloads capability when granted, else a plain link click
export async function saveFile(filename, data) {
  let dl = null; try { dl = window.claude && await window.claude.use('downloads') } catch { }
  if (dl) {
    try { await dl.save({ filename, data }); toast('Saved ' + filename); return true }
    catch (e) { if (e && e.code === 'declined') return false; if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) { toast('Download failed: ' + (e.message || e.code)); return false } }
  }
  const blob = data instanceof Blob ? data : new Blob([data]), url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename, style: { display: 'none' } }); document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  toast('Downloading ' + filename)
  return true
}
