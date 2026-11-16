// frames/layout.js — what a page looks like, as data: layout maps and their
// differences, and frozen pages (layout snapshots).
//
// A layout map (the probe's 'layout' op) lists every rendered element keyed
// by its source line or its path, with its box, text and a few styles.
// layoutDiff compares two maps; diffSummary says it in lines; diffBoxes
// gives what to outline on two frozen pages. A snapshot freezes a frame:
// its HTML with the stylesheets inlined, its layout and scroll, saved
// through the bench actor (per person and app) and listed in Snaps.
//
// Public API: layoutDiff, diffSummary, diffBoxes, Snaps (open, list, take,
// load, render, frozen), layoutIn, snapshotBoard.
import { FrameHost, Headless } from './host.js';
import { Slop } from '../server/slop.js';
import { clamp, hashStr, now, uid } from '../lib/util.js';
import { h } from '../lib/dom.js';

const STYLE_PARTS = ['color', 'background', 'font-size', 'font-weight']
export function layoutDiff(A, B) {
  const am = new Map((A && A.items || []).map(i => [i.k, i])), bm = new Map((B && B.items || []).map(i => [i.k, i]))
  const out = []
  for (const [k, b] of bm) {
    const a = am.get(k)
    if (!a) { out.push({ k, kind: 'added', b }); continue }
    const d = [], [ax, ay, aw, ah] = a.b, [bx, by, bw, bh] = b.b
    if (Math.abs(aw - bw) > 1 || Math.abs(ah - bh) > 1) d.push({ what: 'size', from: aw + '×' + ah, to: bw + '×' + bh })
    if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) d.push({ what: 'move', dx: bx - ax, dy: by - ay })
    if ((a.x || '') !== (b.x || '')) d.push({ what: 'text', from: a.x || '', to: b.x || '' })
    if (a.st !== b.st) { const sa = (a.st || '').split('|'), sb = (b.st || '').split('|'); STYLE_PARTS.forEach((p, i) => { if (sa[i] !== sb[i]) d.push({ what: p, from: sa[i], to: sb[i] }) }) }
    if (!!a.hid !== !!b.hid) d.push({ what: 'visibility', from: a.hid ? 'hidden' : 'visible', to: b.hid ? 'hidden' : 'visible' })
    if (d.length) out.push({ k, kind: 'changed', a, b, d })
  }
  for (const [k, a] of am) if (!bm.has(k)) out.push({ k, kind: 'removed', a })
  // a move that only follows the parent's move is noise; so is everything inside an added or removed element
  const byKey = new Map(out.map(c => [c.k, c]))
  const moveOf = c => c && c.kind === 'changed' && c.d.find(x => x.what === 'move')
  const keep = out.filter(c => {
    const it = c.b || c.a, par = byKey.get(it.p)
    if (par && (par.kind === 'added' || par.kind === 'removed') && par.kind === c.kind) return false
    if (c.kind === 'changed' && c.d.length === 1 && c.d[0].what === 'move') { const pm = moveOf(par); if (pm && pm.dx === c.d[0].dx && pm.dy === c.d[0].dy) return false }
    return true
  })
  return { changes: keep, heightFrom: A ? A.h : 0, heightTo: B ? B.h : 0 }
}
export function diffSummary(diff, max = 12) {
  const lines = [], label = it => it.t + (it.x ? ' "' + it.x.slice(0, 30) + '"' : '') + (it.s ? ' @' + it.s : '')
  const base = t => t.replace(/#[^.]*/, '')
  const fmt = x => x.what === 'move' ? 'moved ' + (x.dx >= 0 ? '+' : '') + x.dx + ',' + (x.dy >= 0 ? '+' : '') + x.dy : x.what === 'text' ? 'text "' + x.from.slice(0, 24) + '" → "' + x.to.slice(0, 24) + '"' : x.what + ' ' + x.from + ' → ' + x.to
  if (diff.heightFrom && diff.heightTo && Math.abs(diff.heightFrom - diff.heightTo) > 1) lines.push('page height ' + diff.heightFrom + ' → ' + diff.heightTo)
  // the same change on elements of the same kind reads as one line: "6 × li: size 331×73 → 335×73"
  const groups = new Map()
  for (const c of diff.changes) {
    const it = c.b || c.a
    const what = c.kind === 'added' ? 'added ' + it.b[2] + '×' + it.b[3] : c.kind === 'removed' ? 'removed' : c.d.map(fmt).join('; ')
    const groupable = !(c.kind === 'changed' && c.d.some(x => x.what === 'text'))
    const k = groupable ? base(it.t) + '|' + what : c.k
    if (!groups.has(k)) groups.set(k, { what, items: [] }); groups.get(k).items.push(it)
  }
  for (const g of groups.values()) {
    const it = g.items[0], n = g.items.length
    if (n > 1) lines.push(n + ' × ' + base(it.t) + ': ' + g.what)
    else if (g.what.startsWith('added ')) lines.push('+ ' + label(it) + ' ' + g.what.slice(6))
    else if (g.what === 'removed') lines.push('− ' + label(it))
    else lines.push(label(it) + ': ' + g.what)
  }
  return lines.length > max ? [...lines.slice(0, max), '… ' + (lines.length - max) + ' more'] : lines
}
// boxes to outline on frozen frames: red where something was (removed, or before a change), green where it is now
export function diffBoxes(diff) {
  // a container that only grew or moved because something inside it changed adds no information: outline what changed inside
  const parent = new Map()
  for (const c of diff.changes) for (const it of [c.a, c.b]) if (it) parent.set(it.k, it.p)
  const changedKeys = new Set(diff.changes.map(c => c.k)), hasChangedInside = new Set()
  for (const k of changedKeys) { let p = parent.get(k), guard = 0; while (p && guard++ < 60) { hasChangedInside.add(p); p = parent.get(p) || (p.includes('>') ? p.slice(0, p.lastIndexOf('>')) : null) } }
  const before = [], after = []
  for (const c of diff.changes) {
    if (c.kind === 'changed' && hasChangedInside.has(c.k) && c.d.every(x => x.what === 'size' || x.what === 'move')) continue
    if (c.a) before.push({ b: c.a.b, c: c.kind === 'removed' ? 'del' : 'chg' })
    if (c.b) after.push({ b: c.b.b, c: c.kind === 'added' ? 'add' : 'chg' })
  }
  return { before: before.slice(0, 120), after: after.slice(0, 120) }
}

// ---------- snapshots: frozen pages, kept per person and app by the bench actor ----------
export const Snaps = {
  metas: [], app: null, docs: new Map(),
  // the open project's snapshots (meta only)
  async open(P) {
    this.app = P.app; this.docs.clear()
    this.metas = await Slop.call('snaps', { app: P.app }).catch(() => [])
  },
  list(P) { return P.app === this.app ? this.metas : [] },
  async capture(fh) {
    const raw = await fh.call('snapshot', [], 6000)
    return { doc: { html: raw.html, css: raw.css || {}, layout: raw.layout, scroll: raw.scroll }, route: fh.route, w: fh.w, h: fh.h, ws: fh.ws }
  },
  // take and keep one; returns its meta (the newest of the same page, size
  // and workspace when nothing changed and no label is given)
  async take(P, fh, { label, by = 'you', note } = {}) {
    const s = await this.capture(fh), hash = hashStr(s.doc.html)
    const last = this.list(P).filter(x => x.route === s.route && x.w === s.w && x.ws === s.ws).slice(-1)[0]
    if (last && last.hash === hash && !label) return last
    const lastEvent = P.events.filter(e => e.seq != null).slice(-1)[0]
    const meta = { route: s.route, w: s.w, h: s.h, ws: s.ws, label: label || null, note: note || undefined, by, hash, seq: lastEvent ? lastEvent.seq : null }
    const id = 'sn' + uid()
    await Slop.call('saveSnap', { id, app: P.app, meta, doc: s.doc })
    const m = { ...meta, id, t: now() }
    this.metas.push(m); this.docs.set(id, s.doc)
    return m
  },
  // a snapshot's frozen page {html, css, layout, scroll}
  async load(P, id) {
    if (!this.docs.has(id)) { const r = await Slop.call('snap', { id }); this.docs.set(id, r.doc) }
    return this.docs.get(id)
  },
  // a frozen page: its own scripts are gone; ours restores scroll and outlines boxes
  render(doc, { boxes = [], scroll } = {}) {
    let html = doc.html
    for (const [file, t] of Object.entries(doc.css || {})) html = html.split('/*@css ' + file + '*/').join(t.replace(/<\/style/gi, '<\\/style'))
    const sc = scroll || doc.scroll || [0, 0]
    const script = '<script>(' + function (sc, boxes) {
      const draw = () => { scrollTo(sc[0], sc[1]); for (const x of boxes) { const d = document.createElement('div'); const col = x.c === 'add' ? '30,138,90' : x.c === 'del' ? '226,0,26' : '31,111,196'; d.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;left:' + x.b[0] + 'px;top:' + x.b[1] + 'px;width:' + Math.max(2, x.b[2]) + 'px;height:' + Math.max(2, x.b[3]) + 'px;outline:2px solid rgb(' + col + ');background:rgba(' + col + ',.10)'; document.documentElement.appendChild(d) } }
      document.readyState === 'complete' ? draw() : addEventListener('load', draw)
    }.toString() + ')(' + JSON.stringify(sc) + ',' + JSON.stringify(boxes).replace(/</g, '\\u003c') + ')</script>'
    return html.replace(/<\/body>/i, script + '</body>')
  },
  // an element showing a frozen page at a scale
  frozen(doc, meta, { scale = 0.25, boxes, title, full } = {}) {
    // full: the whole page from the top, not just the viewport where it was scrolled
    const hh = full ? clamp(Math.max(meta.h, (doc.layout && doc.layout.h) || 0), 200, 3000) : meta.h
    const ifr = h('iframe', { sandbox: 'allow-scripts', title: title || meta.route, style: { width: meta.w + 'px', height: hh + 'px', border: 0, transform: 'scale(' + scale + ')', transformOrigin: '0 0', background: 'transparent', pointerEvents: scale < 0.9 ? 'none' : 'auto' } })
    ifr.srcdoc = this.render(doc, { boxes, scroll: full ? [0, 0] : undefined })
    return h('div', { style: { width: meta.w * scale + 'px', height: hh * scale + 'px', overflow: 'hidden', outline: '1px solid var(--hair)', flex: 'none' } }, ifr)
  }
}

// Snapshot every board frame as the workspace shows it (the canvas frame
// when it shows that workspace, else a headless one).
export async function snapshotBoard(P, ws, opts = {}) {
  const out = []
  for (const f of P.board().frames) {
    try {
      const fh = await settled(P, f, ws)
      const m = await Snaps.take(P, fh, opts)
      if (m) out.push(m)
    } catch (e) { /* a frame that will not snapshot is skipped */ }
  }
  return out
}
// The layout of a board frame in a workspace, settled. headless: true
// renders off-screen in a pooled frame even when the canvas shows this
// workspace, so two sides compare alike.
export async function layoutIn(P, f, ws, { headless } = {}) {
  const fh = await settled(P, f, ws, headless)
  return { fh, layout: await fh.call('layout', [], 5000) }
}
async function settled(P, f, ws, headless) {
  let fh = headless ? null : FrameHost.ui.hostFor(f.id)
  if (!fh || !fh.shown || fh.ws !== ws) fh = await Headless.get(P, fh ? fh.route : f.route, { kind: ws === 'draft' ? 'dev' : 'prop', ref: ws === 'draft' ? null : ws, w: f.w, h: f.h })
  if (!fh.ready) await fh.readyP
  return fh
}
