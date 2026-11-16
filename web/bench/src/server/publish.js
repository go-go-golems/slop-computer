// server/publish.js — moving main: preflight, publish, roll back.
//
// main moves to a draft snapshot only if main is still where the preflight
// saw it (ifAt); production instances follow on their next view (or now:
// activate). Publishing main's previous snapshot again is the rollback. The
// person's edits are committed first: a preflight of an older draft would
// approve code that is not what the editor shows.
//
// Public API: Publish (preflight, run, rollback, lines).
import { Slop } from './slop.js';

export const Publish = {
  async preflight(P) {
    const r = await P.draft.settle()
    if (r.status !== 'committed') {
      const why = r.status === 'conflict' ? 'they conflict with draft ' + r.at + ' in ' + r.conflicts.join(', ') : r.error
      throw new Error('your edits are not in draft (' + why + '): resolve that before publishing')
    }
    return await Slop.call('preflight', { app: P.app })
  },
  async run(P, pf, who = 'you', note = '') {
    const n = pf.refs.draft, at = pf.refs.main ?? 0
    const r = await Slop.call('publish', { app: P.app, n, ifAt: at, note })
    P.refs = { ...P.refs, main: n }
    const parts = [note, at ? 'main was ' + at : 'first publish', pf.migrations.length ? 'migrations: ' + pf.migrations.join(', ') : '']
    P.mark({ label: 'Published draft ' + n + ' to main', note: parts.filter(Boolean).join(' · '), by: who, kind: 'milestone' })
    Slop.refresh().catch(() => { })
    return { n, from: r.from ?? at }
  },
  async rollback(P, to, from, who = 'you') {
    await Slop.call('publish', { app: P.app, n: to, ifAt: from, note: 'rollback' })
    P.refs = { ...P.refs, main: to }
    P.mark({ label: 'Rolled main back to ' + to, note: 'from ' + from, by: who, kind: 'milestone' })
    Slop.refresh().catch(() => { })
  },
  // A preflight as lines, for the dialog and the agent's approval card.
  lines(pf) {
    const d = pf.refs.draft, m = pf.refs.main
    const out = [d === m ? 'main is already draft ' + d + ': nothing to publish' : 'draft ' + d + ' → main' + (m != null ? ' (now ' + m + ')' : ' (first publish)')]
    const files = [...pf.added.map(p => '+' + p), ...pf.changed.map(p => '~' + p), ...pf.removed.map(p => '-' + p)]
    if (files.length) out.push('files: ' + files.slice(0, 30).join(' '))
    if (pf.migrations.length) out.push('new migrations run on every production instance: ' + pf.migrations.join(', '))
    if (!pf.dev) out.push('you have no dev instance: nothing has run this draft')
    else if (pf.dev.broken) out.push('your dev instance failed on it: ' + pf.dev.broken)
    else if (pf.dev.n === d) out.push('your dev instance runs draft ' + d + ': ok')
    else out.push('your dev instance is on ' + pf.dev.n + ', not draft ' + d + (pf.dev.next === d ? ' (it has not been opened since)' : ''))
    const prod = pf.production.map(x => x.store + ' @' + x.n + (x.next ? ' (' + x.next + ' on its next view)' : '') + (x.broken ? ' (broken)' : ''))
    out.push(prod.length ? 'production: ' + prod.join(', ') : 'no production instance yet: nothing serves main')
    for (const b of pf.blockers) out.push('BLOCKED: ' + b)
    return out
  }
}
