// agent/api/tx.js — tx.* and dry.*: the sandbox's own calls for atomic and
// dry steps (step.atomic(), tx(fn), step.dry()), as nested transactions.
//
// The eval's writes go to ctx.tx. tx.begin opens a child of it: writes
// inside it fold into the eval on tx.commit, and tx.rollback drops them. A
// dry run is a child that is never folded: dry.end keeps its changes as a
// changeset (for the turn) and returns what they would do; dry.apply copies
// the changes (or some) into the eval, dry.discard drops them. ctx.stack
// holds the transactions under the current one.
//
// Public API: TX (an API table).
import { diffStat, diffText } from '../../lib/text.js';
import { trunc, uid } from '../../lib/util.js';

const invalid = msg => Object.assign(new Error(msg), { kind: 'invalid' })
const open = (ctx, label, dry) => { const c = ctx.tx.child({ label }); c.dry = dry || !!ctx.tx.dry; ctx.stack.push(ctx.tx); ctx.tx = c; return ctx.stack.length }
const close = ctx => { const c = ctx.tx; ctx.tx = ctx.stack.pop(); return c }

export const TX = {
  'tx.begin': { sig: '', internal: true, run: ctx => open(ctx, 'atomic', false) },
  'tx.commit': {
    sig: '', internal: true,
    run: async ctx => { if (!ctx.stack.length) throw invalid('no atomic step is open'); const r = await close(ctx).commit(); return r.status === 'folded' },
  },
  'tx.rollback': {
    sig: '', internal: true,
    run: ctx => { if (!ctx.stack.length) return []; const c = close(ctx), paths = c.paths(); c.abort(); return paths },
  },
  'dry.begin': { sig: '', internal: true, run: ctx => { if (ctx.tx.dry) throw invalid('a dry run is already open'); return open(ctx, 'dry', true) } },
  'dry.end': {
    sig: '', internal: true,
    run: ctx => {
      if (!ctx.tx.dry || !ctx.stack.length) throw invalid('no dry run is open')
      const c = close(ctx), files = [], diffs = []
      for (const d of c.diff()) {
        const ch = c.changes.get(d.path)
        if (ch.remove) { if (d.existed) { files.push({ path: d.path, change: 'remove' }); diffs.push(diffText(d.path, d.before ?? '', '')) } continue }
        if (typeof ch.text !== 'string') { files.push({ path: d.path, change: d.existed ? 'replace' : 'create', kept: 'by hash' }); continue }
        if (d.existed && d.before === ch.text) continue
        files.push(d.existed ? { path: d.path, change: 'edit', ...diffStat(d.before ?? '', ch.text) } : { path: d.path, change: 'create', lines: ch.text.split('\n').length })
        diffs.push(diffText(d.path, d.before ?? '', ch.text))
      }
      const id = uid('cs')
      ctx.changesets.set(id, new Map(c.changes))
      c.abort()
      return { id, files, diff: trunc(diffs.join('\n\n'), 8000) }
    }
  },
  'dry.apply': {
    sig: 'id, paths?', internal: true, writes: 'files',
    pathOf: ([id, paths], ctx) => [...((ctx.changesets && ctx.changesets.get(id)) || new Map()).keys()].filter(p => !paths || paths.includes(p)),
    run: (ctx, id, paths) => {
      const cs = ctx.changesets.get(id)
      if (!cs) throw Object.assign(new Error('no changeset ' + id + ' (changesets last for the turn)'), { kind: 'missing' })
      let n = 0
      for (const [path, c] of cs) {
        if (paths && !paths.includes(path)) continue
        if (c.remove) ctx.tx.remove(path); else if (typeof c.text === 'string') ctx.tx.write(path, c.text); else ctx.tx.copy(path, c)
        n++
      }
      return { applied: n }
    }
  },
  'dry.discard': { sig: 'id', internal: true, run: (ctx, id) => ctx.changesets.delete(id) },
}
