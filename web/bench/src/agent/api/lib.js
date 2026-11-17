// agent/api/lib.js — lib.* (saved functions), log and sleep.
//
// A saved function is a file, .agent/lib/<name>.js, reviewed and proposed
// like any other: a header line with its description and parameters, then
// `export default <source>`. The sandbox rebuilds each one from its source
// alone (it may use the API, its arguments and other lib functions); the
// worker has checked a function's free variables before lib.def gets here.
//
// Public API: LIB (an API table), LIB_DIR, libEntries.
import { clamp, now, sleep } from '../../lib/util.js';
import { missing, readText } from './files.js';

export const LIB_DIR = '.agent/lib/'
const libPath = name => LIB_DIR + name + '.js'

// the saved functions in a view of files (a Tx, or a Draft)
export function libEntries(view) {
  return view.list().filter(p => p.startsWith(LIB_DIR) && p.endsWith('.js')).map(path => {
    const text = view.read(path) || '', name = path.slice(LIB_DIR.length, -3)
    let meta = {}
    const mm = /^\/\/ @lib (\{.*\})$/m.exec(text)
    if (mm) { try { meta = JSON.parse(mm[1]) } catch { } }
    const i = text.indexOf('export default ')
    return { name, path, source: (i >= 0 ? text.slice(i + 15) : text).trim(), description: meta.description || '', params: meta.params || [] }
  }).filter(l => /^[A-Za-z_$][\w$]*$/.test(l.name))
}

export const LIB = {
  // the sandbox calls it as lib.def(name, fn, {description}) and adds the parameters it found
  'lib.def': {
    sig: 'name, source, {description}?, params?', internal: true, writes: 'files', pathOf: ([name]) => libPath(name),
    run: (ctx, name, source, o = {}, params = []) => {
      const path = libPath(name), existed = ctx.tx.has(path)
      const head = { name, description: String(o.description || '').slice(0, 200), params, by: ctx.who, t: now() }
      ctx.tx.write(path, '// lib.' + name + (head.description ? ': ' + head.description : '') + '\n// @lib ' + JSON.stringify(head) +
        '\n// Saved with lib.def; rebuilt by running the source below. It may use the host API and other lib functions.\nexport default ' + source + '\n')
      return { saved: 'lib.' + name, path, params, replaced: existed }
    }
  },
  'lib.list': { sig: '', internal: true, run: ctx => libEntries(ctx.tx).map(l => ({ name: l.name, params: l.params, description: l.description, path: l.path })) },
  'lib.remove': {
    sig: 'name', internal: true, writes: 'files', pathOf: ([name]) => libPath(name),
    run: (ctx, name) => { if (!ctx.tx.has(libPath(name))) throw missing('no lib.' + name); ctx.tx.remove(libPath(name)); return { removed: 'lib.' + name } }
  },
  'lib.source': { sig: 'name', internal: true, run: (ctx, name) => readText(ctx.tx, libPath(name)) },
  'log': { sig: '...values', internal: true, run: (ctx, ...a) => { ctx.logs.push(a.join(' ')); return true } },
  'sleep': { sig: 'ms?', doc: 'waits (at most 5 s)', run: (ctx, ms) => sleep(clamp(+ms || 0, 0, 5000)) },
}
