// The bench actor's file actions over snapshots in memory, for tests of the
// page's core under Node; and files.commit's rule for a change list, which
// every stand-in server here applies.
//
// A stand-in that accepts what the real server refuses tests the page
// against its own assumptions. The rule here is pkg/commands/files.go
// readChanges: a path at most once; each change exactly one of text, data,
// sha256 (with a blob the server has) or delete. pkg/host/bench_test.go
// checks that the actor passes changes on to it unchanged.
import { createHash } from 'node:crypto'

export const sha = t => createHash('sha256').update(t, 'utf8').digest('hex')

export function checkChanges(changes, hasBlob) {
  if (!Array.isArray(changes) || !changes.length) throw Object.assign(new Error('changes is a non-empty list'), { code: 'invalid_argument' })
  const seen = new Set()
  for (const c of changes) {
    if (!c || typeof c.path !== 'string' || !c.path) throw Object.assign(new Error('a change has no path'), { code: 'invalid_argument' })
    if (seen.has(c.path)) throw Object.assign(new Error(c.path + ' appears twice'), { code: 'invalid_argument' })
    seen.add(c.path)
    const given = [typeof c.text === 'string', typeof c.data === 'string', !!c.sha256, c.delete === true].filter(Boolean).length
    if (given !== 1) throw Object.assign(new Error(c.path + ': give exactly one of text, data, sha256 or delete'), { code: 'invalid_argument' })
    if (c.sha256 && !hasBlob(c.sha256)) throw Object.assign(new Error(c.path + ': no blob ' + c.sha256), { code: 'missing_blobs' })
  }
}

// One writer, no merging: each commit is on the latest snapshot. files: the
// first snapshot ({path: text}). Answers as the actor does.
export function fakeActor(files) {
  const snaps = [new Map(), new Map(Object.entries(files))], commits = []
  const listing = n => [...snaps[n]].map(([path, t]) => ({ path, sha256: sha(t), size: t.length, type: '' }))
  const blobs = () => new Map(snaps.flatMap(s => [...s.values()]).map(t => [sha(t), t]))
  const call = async (action, a) => {
    if (action === 'head') return { n: snaps.length - 1 }
    if (action === 'files') return listing(a.at)
    if (action === 'read') return { texts: Object.fromEntries(a.paths.map(p => [p, snaps[a.at].get(p)])), binary: [], more: [] }
    if (action === 'commit') {
      const known = blobs()
      checkChanges(a.changes, s => known.has(s))
      commits.push(a)
      const next = new Map(snaps[snaps.length - 1])
      for (const c of a.changes) c.delete ? next.delete(c.path) : next.set(c.path, c.text ?? known.get(c.sha256))
      snaps.push(next)
      return { n: snaps.length - 1, at: a.base, merged: false, files: listing(snaps.length - 1), activated: [], event: null }
    }
    throw new Error('no action ' + action)
  }
  return { call, commits, snaps }
}
