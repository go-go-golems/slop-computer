// agent/api/files.js — files.*: the workspace's files, read and written
// through the eval's transaction (ctx.tx, core/draft.js).
//
// Reads see the eval's own writes over the snapshot it began on; writes
// stay in the transaction until the eval ends (committed as one change
// list, or dropped if it fails). A file kept by hash (binary, or larger
// than the bench edits) can be listed, copied and removed, not read.
//
// Public API: FILES (an API table), missing, readText.
import { blame, why } from '../../model/timeline.js';

export const missing = msg => Object.assign(new Error(msg), { kind: 'missing' })
const invalid = msg => Object.assign(new Error(msg), { kind: 'invalid' })

export function readText(tx, path) {
  if (typeof path !== 'string' || !path) throw invalid('path must be a non-empty string')
  const t = tx.read(path)
  if (t !== null) return t
  if (tx.entry(path)) throw Object.assign(new Error(path + ' is kept by hash (binary, or too large to edit): it can be copied or removed, not read as text'), { kind: 'binary' })
  const near = tx.list().filter(p => p.split('/').pop() === path.split('/').pop())
  throw missing('no file ' + path + (near.length ? '. Did you mean ' + near.join(' or ') + '?' : '. Files: ' + tx.list().slice(0, 60).join(', ')))
}
const sizeOf = e => typeof e.text === 'string' ? e.text.length : e.size

export const FILES = {
  'files.list': {
    sig: 'prefix?', doc: '[{path, size, lines}] (lines: null for files kept by hash)',
    run: (ctx, prefix) => ctx.tx.list().filter(p => !prefix || p.startsWith(prefix)).map(path => {
      const e = ctx.tx.entry(path)
      return { path, size: sizeOf(e), lines: typeof e.text === 'string' ? e.text.split('\n').length : null }
    })
  },
  'files.read': { sig: 'path', doc: 'text', run: (ctx, path) => readText(ctx.tx, path) },
  'files.exists': { sig: 'path', doc: 'bool', run: (ctx, path) => ctx.tx.has(path) },
  'files.lines': {
    sig: 'path, from?, to?', doc: 'numbered lines "12| …" (200 by default)',
    run: (ctx, path, from = 1, to) => {
      const ls = readText(ctx.tx, path).split('\n')
      from = Math.max(1, +from || 1); to = Math.min(ls.length, +to || from + 199)
      const w = String(to).length
      return ls.slice(from - 1, to).map((l, i) => String(from + i).padStart(w) + '| ' + l).join('\n')
    }
  },
  'files.grep': {
    sig: 'regex, {path, flags}?', doc: '[{path, line, text}] (text files; at most 200)',
    run: (ctx, pattern, o = {}) => {
      let re
      try { re = new RegExp(String(pattern), o.flags || 'i') } catch (e) { throw invalid('bad regex: ' + e.message) }
      const out = []
      for (const path of ctx.tx.list()) {
        if (o.path && !path.startsWith(o.path)) continue
        const t = ctx.tx.read(path)
        if (t === null) continue
        t.split('\n').forEach((l, i) => { if (out.length < 200 && re.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 200) }) })
      }
      return out
    }
  },
  'files.write': {
    sig: 'path, text', doc: 'creates or replaces the whole file', writes: 'files',
    run: (ctx, path, text) => {
      const created = !ctx.tx.has(path)
      ctx.tx.write(path, String(text))
      return { path, created, lines: String(text).split('\n').length }
    }
  },
  'files.replace': {
    sig: 'path, find, replacement, {all}?', doc: 'exact-text edit; error kind anchor when the text is not found or found more than once', writes: 'files',
    run: (ctx, path, find, repl, o = {}) => {
      const t = readText(ctx.tx, path)
      if (typeof find !== 'string' || !find) throw invalid('find must be a non-empty string')
      const n = t.split(find).length - 1
      if (!n) throw Object.assign(new Error('text not found in ' + path + '; read the file and copy the exact text, whitespace included'), { kind: 'anchor' })
      if (n > 1 && !o.all) {
        const lines = t.split('\n').map((l, i) => l.includes(find.split('\n')[0]) ? i + 1 : 0).filter(Boolean).slice(0, 6)
        throw Object.assign(new Error('text found ' + n + ' times in ' + path + ' (lines ' + lines.join(', ') + '); include more surrounding text, or pass {all: true}'), { kind: 'anchor' })
      }
      ctx.tx.write(path, o.all ? t.split(find).join(String(repl)) : t.replace(find, () => String(repl)))
      return { path, replaced: o.all ? n : 1 }
    }
  },
  'files.remove': {
    sig: 'path', writes: 'files',
    run: (ctx, path) => { if (!ctx.tx.has(path)) throw missing('no file ' + path); ctx.tx.remove(path); return { path, removed: true } }
  },
  // who last changed each run of lines (at the workspace's head), and why:
  // the request, reply and marks of that turn
  'files.blame': {
    sig: 'path, {from, to}?', doc: 'runs of lines with who last changed them, when and why (look before undoing someone\'s change)',
    run: async (ctx, path, o = {}) => {
      const P = ctx.project, text = P.draftOf(ctx.ws).read(path)
      if (text === null) throw missing('no text file ' + path + ' at ' + ctx.ws + ' ' + P.draftOf(ctx.ws).head)
      const at = await blame(P, path, ctx.ws), lines = text.split('\n')
      const from = Math.max(1, +o.from || 1), to = Math.min(lines.length, +o.to || lines.length), runs = []
      for (let k = from; k <= to; k++) {
        const seq = at[k - 1], last = runs[runs.length - 1]
        if (last && last.seq === seq) last.to = k; else runs.push({ from: k, to: k, seq })
      }
      return runs.map(r => {
        const w = r.seq != null ? why(P, r.seq) : null
        return {
          lines: r.from === r.to ? String(r.from) : r.from + '–' + r.to, seq: r.seq,
          who: !w ? 'before the timeline' : w.who === 'agent' ? 'claude' + (w.role ? ' (' + w.role + ')' : '') : w.who,
          when: w ? new Date(w.at).toISOString() : undefined, request: w && w.request || undefined, reply: w && w.reply || undefined,
          marks: w && w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label + (m.why ? ' (' + m.why + ')' : '')) : undefined,
          note: w && !w.request && w.note || undefined, thread: w && w.thread || undefined
        }
      })
    }
  },
  'files.copy': {
    sig: 'from, to', doc: 'copies a file, text or kept by hash', writes: 'files', pathOf: ([, to]) => to,
    run: (ctx, from, to) => {
      const e = ctx.tx.entry(from)
      if (!e) throw missing('no file ' + from)
      typeof e.text === 'string' ? ctx.tx.write(to, e.text) : ctx.tx.copy(to, e)
      return { from, to }
    }
  },
}
