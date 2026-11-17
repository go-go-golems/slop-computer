// agent/api/ui.js — ui.*: the person's selection, comment pins, notices and
// approvals. Panels (ui.panel, ui.ask, …) are declared by the shell's panel
// module (ui/), which adds them to the API.
//
// Public API: UI (an API table).
import { hostIn } from '../../frames/layout.js';
import { missing } from './files.js';
import { now, uid } from '../../lib/util.js';

const pins = P => (P.meta.pins = P.meta.pins || [])

export const UI = {
  'ui.selection': { sig: '', doc: 'what the person selected on the canvas (with src "file:line"), or null', run: ctx => { const s = ctx.ui.selection(); return s ? { ...s, rect: undefined } : null } },
  'ui.pins': {
    sig: '{all}?', doc: 'open comment pins [{id, n, route, src, text}]',
    run: (ctx, o = {}) => pins(ctx.project).filter(p => o.all || !p.resolved).map(p => ({ id: p.id, n: p.n, route: p.route, src: p.src, text: p.text, by: p.by, resolved: !!p.resolved }))
  },
  'ui.resolvePin': {
    sig: 'pinId, note?',
    run: (ctx, id, note) => {
      const P = ctx.project, p = pins(P).find(x => x.id === id || x.n === id)
      if (!p) throw missing('no pin ' + id)
      p.resolved = true; p.reply = note || ''
      P.saveMeta(); P.ev.emit('pins')
      return true
    }
  },
  'ui.pin': {
    sig: 'frameId, target, text', doc: 'files a comment pin on an element (target: a selector or {src: "file:line"})',
    run: async (ctx, id, target, text) => {
      const P = ctx.project, f = P.frame(id)
      if (!f) throw missing('no frame ' + id)
      const fh = await hostIn(P, f, ctx.ws)
      const sel = typeof target === 'string' ? target : target && target.src ? '[data-src="' + target.src + '"]' : null
      const hit = sel ? (await fh.call('query', [sel, 1]))[0] : null
      if (sel && !hit) throw missing('no element matches ' + sel + ' in ' + fh.route)
      const n = pins(P).reduce((a, p) => Math.max(a, p.n), 0) + 1
      pins(P).push({ id: 'pin' + uid(), n, route: fh.route, src: hit ? hit.src : '', selector: hit ? hit.selector : '', rx: 0.5, ry: 0.5, text: String(text).slice(0, 500), by: ctx.role ? 'Claude · ' + ctx.role : ctx.who === 'agent' ? 'Claude' : 'you', t: now(), resolved: false })
      P.saveMeta(); P.ev.emit('pins')
      P.log({ kind: 'pin', who: ctx.who, thread: ctx.thread, note: '#' + n + ' ' + String(text).slice(0, 100), paths: hit && hit.src ? [hit.src.split(':')[0]] : undefined })
      return { pin: n, route: fh.route, src: hit ? hit.src : null }
    }
  },
  'ui.notify': { sig: 'text', doc: 'a short notice to the person', run: (ctx, text) => { ctx.ui.notify(String(text).slice(0, 200)); return true } },
  'ui.approve': { sig: 'title, detail?', internal: true, long: true, run: (ctx, title, detail) => ctx.approve(String(title), detail ? String(detail) : '') },
}
