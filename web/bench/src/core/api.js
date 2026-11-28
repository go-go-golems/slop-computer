// core/api.js — the host API as one declared table, and the one dispatcher.
//
// Every call the agent's code can make is declared once:
//
//   'files.write': {
//     sig: 'path, text',                  // a parameter ending in ? is optional; ...x is the rest
//     doc: 'creates or replaces the whole file',
//     ret: '{path, lines}',               // what awaiting it gives, when doc does not say (the reference shows "→ ret")
//     writes: 'files',                    // what it changes: files (the eval's transaction) | dev (the dev
//                                         // instance's data) | main (publishing); absent: reads and canvas views
//     pathOf: (args, ctx) => args[0],     // writes: 'files': the path (or paths) it writes (default args[0])
//     long: true,                         // may wait on a person or a model: pauses the eval's time budget
//     internal: true,                     // called by the sandbox's own code (tx, dry, sleep): not in the reference
//     run: (ctx, path, text) => …,
//   }
//
// From the table come: argument checks and the usage line in errors; the
// mode guards (a read thread changes nothing; a tests thread writes only
// scenarios/ and fixtures/); the dry-run guard (a dry run captures file
// writes in its transaction, so every other write is refused in one); the
// worker's list of long calls; the API reference in the agent's
// instructions. Nothing checks these rules by hand.
//
// Public API: defineAPI, checkArgs, parseSig, policy. No DOM, no network.
// Tested by test/api.test.mjs.

export const policy = msg => Object.assign(new Error(msg), { kind: 'policy' })
const WRITES = new Set(['files', 'dev', 'main'])
const TEST_PATH = /^(scenarios|fixtures)\//

// 'route, {w, h}?, ...rest' → [{name, optional, rest}] (commas inside {} do not split)
export function parseSig(sig) {
  if (!sig) return []
  return sig.split(/,\s*(?![^{]*})/).map(p => p.trim()).filter(Boolean).map(p => ({
    name: p.replace(/^\.\.\./, '').replace(/\?$/, ''), optional: p.endsWith('?') || p.startsWith('...'), rest: p.startsWith('...')
  }))
}
export function checkArgs(name, sig, args) {
  const params = parseSig(sig)
  if (params.some(p => p.rest)) return null
  const missing = params.filter((p, i) => !p.optional && (args[i] === undefined || args[i] === null)).map(p => p.name)
  if (!missing.length) return null
  return name + ' needs ' + params.filter(p => !p.optional).map(p => p.name).join(', ') + ' (missing ' + missing.join(', ') + ') · usage: ' + name + '(' + sig + ')'
}

// defineAPI(...tables): one API from several tables of entries (namespaces
// may come from different layers: the shell adds ui.*).
export function defineAPI(...tables) {
  const entries = new Map()
  const add = table => {
    for (const [name, e] of Object.entries(table)) {
      if (entries.has(name)) throw new Error('API ' + name + ' is declared twice')
      if (typeof e.run !== 'function') throw new Error('API ' + name + ' has no run')
      if (e.writes && !WRITES.has(e.writes)) throw new Error('API ' + name + ': writes is one of ' + [...WRITES].join(', '))
      entries.set(name, Object.freeze({ sig: '', doc: '', ...e }))
    }
  }
  tables.forEach(add)
  return {
    entries,
    add,
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    long: () => [...entries].filter(([, e]) => e.long).map(([n]) => n),
    // check, guard, run: what the sandbox's calls go through
    async call(ctx, name, args = []) {
      const e = entries.get(name)
      if (!e) throw Object.assign(new Error(name + ' is not part of the API'), { kind: 'unknown' })
      const bad = checkArgs(name, e.sig, args)
      if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
      guard(ctx, name, e, args)
      try {
        return await e.run(ctx, ...args)
      } catch (err) {
        if (err && err.kind === 'invalid' && !/· usage:/.test(err.message)) err.message += ' · usage: ' + name + '(' + e.sig + ')'
        throw err
      }
    },
    // the reference the agent reads: one line per call, by namespace, each
    // namespace followed by its note (notes: {ns: text})
    reference(notes = {}) {
      const groups = new Map()
      for (const [name, e] of entries) {
        if (e.internal) continue
        const ns = name.includes('.') ? name.slice(0, name.indexOf('.')) : ''
        if (!groups.has(ns)) groups.set(ns, [])
        groups.get(ns).push(name + '(' + e.sig + ')' + (e.ret ? ' → ' + e.ret : '') + (e.doc ? ' — ' + e.doc : ''))
      }
      return [...groups].map(([ns, lines]) => lines.join('\n') + (notes[ns] ? '\n  ' + notes[ns].trim().split('\n').join('\n  ') : '')).join('\n')
    },
  }
}

function guard(ctx, name, e, args) {
  if (!e.writes) return
  if (ctx.mode === 'read') throw policy('read-only mode: this thread may read and check but not write (' + name + ')')
  if (ctx.mode === 'tests') {
    if (e.writes !== 'files') throw policy('this thread may write only scenarios/ and fixtures/ (' + name + ' changes ' + (e.writes === 'dev' ? 'the dev instance' : 'main') + ')')
    const paths = [].concat(e.pathOf ? e.pathOf(args, ctx) : args[0])
    const bad = paths.find(p => !TEST_PATH.test(String(p || '')))
    if (bad !== undefined) throw policy('this thread may write only scenarios/ and fixtures/ (tests), not ' + (bad || 'code'))
  }
  if (e.writes !== 'files' && ctx.tx && ctx.tx.dry) throw policy(name + ' is refused in a dry run: a dry run captures file writes only')
}
