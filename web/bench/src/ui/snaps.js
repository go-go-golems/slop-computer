// ui/snaps.js — showing layout snapshots: two frozen pages side by side
// with their differences outlined, and strips of thumbnails.
//
// Public API: compareModal, snapStrip, compareSnapNow.
import { Snaps, diffBoxes, diffSummary, hostIn, layoutDiff } from '../frames/layout.js';
import { fmtTime } from '../lib/util.js';
import { h, modal, toast } from '../lib/dom.js';

// left, right: {label, doc: {html, css, layout, scroll}, meta: {route, w, h}}
export function compareModal(title, left, right, diff) {
  const boxes = diffBoxes(diff), scale = Math.min(1, 400 / Math.max(left.meta.w, 1)), lines = diffSummary(diff, 40)
  modal({
    title, wide: true, actions: [{ label: 'Close' }], body: [
      h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', overflow: 'auto', maxHeight: '62vh' } },
        h('div', h('div.note', left.label), Snaps.frozen(left.doc, left.meta, { scale, boxes: boxes.before, full: true })),
        h('div', h('div.note', right.label), Snaps.frozen(right.doc, right.meta, { scale, boxes: boxes.after, full: true }))),
      h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11.5px', margin: 0 } }, lines.length ? lines.join('\n') : 'No layout changes.')]
  })
}

// thumbnails of snapshots; clicking one compares it with the same page now
export function snapStrip(P, shots, title, hint) {
  const row = h('div.snapstrip')
  for (const s of shots.slice(0, 8)) {
    const cell = h('button.snap', { title: (s.label || s.route) + ' · ' + s.w + 'px · ' + fmtTime(s.t) + (hint ? '\n' + hint : ''), on: { click: () => compareSnapNow(P, s) } },
      h('div.ph', { style: { width: s.w * 0.2 + 'px', height: s.h * 0.2 + 'px' } }), h('span.note', s.route + ' ' + s.w))
    row.appendChild(cell)
    Snaps.load(P, s.id).then(doc => { const ph = cell.querySelector('.ph'); if (ph) ph.replaceWith(Snaps.frozen(doc, s, { scale: 0.2 })) }).catch(() => { })
  }
  return h('div', h('div.note', { style: { margin: '8px 0 4px' } }, title), row)
}

// a snapshot against the same page as its workspace shows it now (draft
// when that proposal has closed)
export async function compareSnapNow(P, s) {
  try {
    const doc = await Snaps.load(P, s.id)
    const ws = s.ws === 'draft' || (P.proposals.get(s.ws) || {}).status === 'open' ? s.ws : 'draft'
    const fr = P.board().frames.find(f => f.w === s.w && f.route === s.route) || { id: null, route: s.route, w: s.w, h: s.h }
    const cur = await Snaps.capture(await hostIn(P, fr, ws))
    compareModal(s.route + ' ' + s.w + 'px: ' + (s.label || fmtTime(s.t)) + ' → now', { label: (s.label || '') + ' ' + fmtTime(s.t), doc, meta: s }, { label: 'now', doc: cur.doc, meta: cur }, layoutDiff(doc.layout, cur.doc.layout))
  } catch (e) { toast('Could not compare: ' + (e.message || e)) }
}
