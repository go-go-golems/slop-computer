// agent/api/frames.js — frames.* and snapshots.*: the canvas, and pages as
// the instances serve them.
//
// A board frame is a page at a size. Arranging frames changes the canvas
// only (a view), so every mode may do it. Reading a frame (text, layout,
// checks, clicks) uses the canvas's frame when it shows the eval's
// workspace, else a headless one: the dev instance for draft, the prop
// instance for a proposal. Frames show committed snapshots: an eval's own
// writes are not in them until it ends.
//
// Public API: FRAMES (an API table).
import { FrameHost } from '../../frames/host.js';
import { Snaps, diffSummary, hostIn, layoutDiff, layoutIn } from '../../frames/layout.js';
import { clamp, plural, sleep } from '../../lib/util.js';
import { missing } from './files.js';

const frameOf = (ctx, id) => {
  const P = ctx.project, f = id ? P.frame(id) : P.board().frames[0]
  if (!f) throw missing('no frame ' + id + '. Frames: ' + (P.board().frames.map(x => x.id + ' ' + x.route).join(', ') || 'none'))
  return f
}
const hostOf = (ctx, id) => hostIn(ctx.project, frameOf(ctx, id), ctx.ws)
const info = f => {
  const v = FrameHost.ui.hostFor(f.id)
  return { id: f.id, label: f.label || undefined, route: v ? v.route : f.route, w: f.w, h: f.h, x: f.x, y: f.y, errors: v ? v.errors : 0, issues: v ? v.issues.length : 0 }
}
const canvasLog = (ctx, note) => ctx.project.log({ kind: 'canvas', who: ctx.who, thread: ctx.thread, note })
const changed = P => { P.saveMeta(); P.ev.emit('frames') }

export const FRAMES = {
  'frames.list': { sig: '', doc: '[{id, label, route, w, h, x, y, errors, issues}]', run: ctx => ctx.project.board().frames.map(info) },
  'frames.open': {
    sig: 'route, {w, h, x, y, label, new}?', ret: '{id, label, route, w, h, x, y, errors, issues, reused?}', doc: 'a frame (reuses one showing that page at that size unless new: true)',
    run: (ctx, route, o = {}) => {
      const P = ctx.project, w = o.w || 375, hh = o.h || 720
      const ex = !o.new && P.board().frames.find(f => info(f).route === route && f.w === w && f.h === hh)
      if (ex) return { ...info(ex), reused: true, note: 'a frame already shows ' + route + ' at this size; pass {new: true} for another' }
      const f = P.addFrame({ route, w, h: hh, x: o.x, y: o.y })
      if (o.label) { f.label = String(o.label).slice(0, 60); changed(P) }
      canvasLog(ctx, 'opened ' + route + ' ' + w + '×' + hh)
      return info(f)
    }
  },
  'frames.update': {
    sig: 'frameId, {route, w, h, x, y, label}', ret: '{id, label, route, w, h, x, y, errors, issues}',
    run: (ctx, id, o) => {
      const f = frameOf(ctx, id)
      if (o.w != null) f.w = clamp(Math.round(+o.w) || f.w, 240, 2400)
      if (o.h != null) f.h = clamp(Math.round(+o.h) || f.h, 200, 4000)
      if (o.x != null) f.x = Math.round(+o.x) || 0
      if (o.y != null) f.y = Math.round(+o.y) || 0
      if (o.label !== undefined) f.label = o.label ? String(o.label).slice(0, 60) : undefined
      if (o.route && o.route !== f.route) { const v = FrameHost.ui.hostFor(f.id); f.route = o.route; if (v) v.navigate(o.route) }
      changed(ctx.project)
      return info(f)
    }
  },
  'frames.move': { sig: 'frameId, x, y', run: (ctx, id, x, y) => FRAMES['frames.update'].run(ctx, id, { x, y }) },
  'frames.label': { sig: 'frameId, label?', run: (ctx, id, label) => FRAMES['frames.update'].run(ctx, id, { label: label || null }) },
  'frames.close': {
    sig: 'frameId', ret: '{closed, remaining}',
    run: (ctx, id) => { const f = frameOf(ctx, id); ctx.project.removeFrame(f.id); canvasLog(ctx, 'closed ' + (f.label || f.route)); return { closed: f.id, remaining: ctx.project.board().frames.length } }
  },
  'frames.arrange': {
    sig: 'rows, {gap, rowGap, x, y}?', doc: 'lays frames out in rows ([[id, id], [id]]), left to right, then fits the view',
    run: (ctx, rows, o = {}) => {
      if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('rows is a list of rows, each a list of frame ids: [["f1", "f2"], ["f3"]]'), { kind: 'invalid' })
      const gap = o.gap ?? 60, rowGap = o.rowGap ?? 110
      let y = o.y ?? 0, placed = 0
      for (const row of rows) {
        let x = o.x ?? 0, hmax = 0
        for (const id of [].concat(row)) { const f = frameOf(ctx, id); f.x = x; f.y = y; x += f.w + gap; hmax = Math.max(hmax, f.h); placed++ }
        y += hmax + rowGap
      }
      changed(ctx.project)
      canvasLog(ctx, 'arranged ' + plural(placed, 'frame') + ' in ' + plural(rows.length, 'row'))
      setTimeout(() => ctx.ui.fit(), 120)
      return ctx.project.board().frames.map(info)
    }
  },
  'frames.focus': { sig: 'frameId?', run: (ctx, id) => { const f = id ? frameOf(ctx, id) : null; setTimeout(() => f ? ctx.ui.focusFrame(f.id) : ctx.ui.fit(), 60); return true } },

  'frames.check': {
    sig: 'frameId?', doc: '{errors, issues}: layout overflow, contrast, a11y, console errors',
    run: async (ctx, id) => { const fh = await hostOf(ctx, id), issues = await fh.call('check', [], 4000); return { route: fh.route, errors: fh.logs.filter(l => l.level === 'error').map(l => l.text + (l.src ? ' @' + l.src : '')).slice(-10), issues } }
  },
  'frames.outline': {
    sig: 'frameId?', ret: 'a string, one element per line', doc: 'the DOM as an indented tree, with @file:line for each element',
    run: async (ctx, id) => {
      const nodes = await (await hostOf(ctx, id)).call('outline', [300])
      return nodes.map(n => '  '.repeat(n.d) + n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '') + (n.text ? ' "' + n.text + '"' : '') + (n.src ? '  @' + n.src : '')).join('\n')
    }
  },
  'frames.inspect': {
    sig: 'frameId, target', doc: 'box, computed styles, matched CSS rules with their files',
    run: async (ctx, id, target) => { const r = await (await hostOf(ctx, id)).call('inspect', [target]); r.rules = r.rules.map(x => ({ file: x.file, selector: x.selector, media: x.media || undefined, css: x.text })); return r }
  },
  'frames.query': { sig: 'frameId, selector', doc: 'matches, each with attrs (data-*, href, name, value, checked, aria-*)', run: async (ctx, id, sel) => (await hostOf(ctx, id)).call('query', [sel]) },
  'frames.count': { sig: 'frameId, selector', ret: 'a number', run: async (ctx, id, sel) => { const fh = await hostOf(ctx, id); await fh.call('settle', [600], 2000).catch(() => { }); return fh.call('count', [sel]) } },
  'frames.text': { sig: 'frameId?, target?', ret: 'a string', doc: 'visible text', run: async (ctx, id, target) => (await hostOf(ctx, id)).call('text', [target || null]) },
  'frames.click': { sig: 'frameId, target', run: async (ctx, id, target) => { const r = await (await hostOf(ctx, id)).call('click', [target]); await sleep(120); return r } },
  'frames.type': { sig: 'frameId, target, text', run: async (ctx, id, target, text) => (await hostOf(ctx, id)).call('type', [target, text]) },
  'frames.waitFor': {
    sig: 'frameId, selector, {timeout}?', doc: 'waits for a visible match',
    run: async (ctx, id, sel, o = {}) => { const fh = await hostOf(ctx, id), t = clamp(+o.timeout || 2000, 50, 15000); return fh.call('waitFor', [sel, t], t + 1500) }
  },
  'frames.console': { sig: 'frameId?', run: async (ctx, id) => (await hostOf(ctx, id)).logs.slice(-30).map(l => l.level + ': ' + l.text + (l.src ? ' @' + l.src : '')) },
  'frames.reload': { sig: 'frameId?', ret: '{route, errors}', run: async (ctx, id) => { const fh = await hostOf(ctx, id); await fh.load({ keepState: false }); return { route: fh.route, errors: fh.errors } } },
  'frames.layout': {
    sig: 'frameId?, {near}?', ret: '{route, width, height, count, items: [{key, tag, box: [x, y, w, h], text, src, hidden?}]}: an object; the elements are in .items (at most 150)', doc: 'every rendered element: key, tag, box [x, y, w, h], own text, src',
    run: async (ctx, id, o = {}) => {
      const fh = await hostOf(ctx, id), L = await fh.call('layout', [], 5000)
      let items = L.items
      if (o.near) { const q = String(o.near); items = items.filter(i => (i.s || '').startsWith(q) || i.k.includes(q) || i.t.includes(q) || (i.x || '').includes(q)) }
      return { route: fh.route, width: L.w, height: L.h, count: L.items.length, items: items.slice(0, 150).map(i => ({ key: i.k, tag: i.t, box: i.b, text: i.x, src: i.s, hidden: i.hid ? true : undefined })) }
    }
  },
  'frames.snapshot': {
    sig: 'frameId?, label?', ret: '{id, route, w, ws, label, t}', doc: 'a frozen copy of the page and its layout',
    run: async (ctx, id, label) => {
      const m = await Snaps.take(ctx.project, await hostOf(ctx, id), { label: label || null, by: ctx.who })
      return { id: m.id, route: m.route, w: m.w, ws: m.ws, label: m.label, t: new Date(m.t).toISOString() }
    }
  },
  // layout differences: this workspace against another (a proposal against
  // draft by default; in draft, against the newest snapshot of the page)
  'frames.compare': {
    sig: 'frameId, {with}?', ret: '{frame, from, to, changes, summary}', doc: 'layout differences against draft (from a proposal), a proposal ref, or a snapshot id',
    run: async (ctx, id, o = {}) => {
      const P = ctx.project, f = frameOf(ctx, id), cur = await layoutIn(P, f, ctx.ws, { headless: true })
      let what = o.with, other
      if (!what) {
        if (ctx.ws !== 'draft') what = 'draft'
        else {
          const s = Snaps.list(P).filter(x => x.route === cur.fh.route && x.w === f.w && x.ws === 'draft').slice(-1)[0]
          if (!s) throw missing('nothing to compare with: in draft, take a snapshot first (frames.snapshot) or pass {with: proposalRef}')
          what = s.id
        }
      }
      if (/^sn/.test(what)) other = (await Snaps.load(P, what)).layout
      else {
        if (what !== 'draft' && (P.proposals.get(what) || {}).status !== 'open') throw missing('no workspace ' + what + ' (draft or an open proposal)')
        other = (await layoutIn(P, f, what, { headless: true })).layout
      }
      const d = layoutDiff(other, cur.layout)
      return { frame: cur.fh.route + ' ' + f.w + 'px', from: what, to: ctx.ws, changes: d.changes.length, summary: diffSummary(d, 30) }
    }
  },
  'snapshots.list': {
    sig: '{route}?',
    run: (ctx, o = {}) => Snaps.list(ctx.project).filter(s => !o.route || s.route === o.route).slice(-40)
      .map(s => ({ id: s.id, route: s.route, w: s.w, ws: s.ws, label: s.label || undefined, note: s.note, t: new Date(s.t).toISOString() }))
  },
}
