// agent/api/session.js — session.*: the timeline, the thread's history, what
// happens in frames, where the eval writes.
//
// Public API: SESSION (an API table).
import { Streams } from '../../frames/streams.js';
import { changesSince, snapshotAt } from '../../model/timeline.js';
import { clamp, now, trunc } from '../../lib/util.js';
import { diffText } from '../../lib/text.js';
import { effectsLine } from '../effects.js';
import { missing } from './files.js';

const MARK_KINDS = ['bookmark', 'milestone', 'decision', 'question', 'checkpoint']
const invalid = msg => Object.assign(new Error(msg), { kind: 'invalid' })
const roleOf = m => m.role === 'user' ? (m.from ? 'main agent' : 'person') : 'claude'
const iso = t => new Date(t).toISOString()

export const SESSION = {
  'session.mark': {
    sig: 'label, {kind, why}?', doc: 'kind: milestone (default), decision (you chose between options; say why), question (you guessed instead of asking), checkpoint (before a risky step)',
    run: (ctx, label, o) => {
      const opts = typeof o === 'string' ? { why: o } : (o || {})
      if (opts.kind && !MARK_KINDS.includes(opts.kind)) throw invalid('mark kinds: ' + MARK_KINDS.join(', '))
      const e = ctx.project.mark({ label, note: opts.why || opts.note, by: ctx.who, thread: ctx.thread, kind: opts.kind, ref: ctx.ws })
      return { kind: e.mk, label: e.label }
    }
  },
  'session.marks': { sig: '', doc: 'marks, each in the workspace it was made in (where: draft or a proposal)', run: ctx => ctx.project.marks().map(e => ({ seq: e.seq, label: e.label, kind: e.mk || 'bookmark', by: e.who, why: e.note, where: e.ref, when: iso(e.at) })) },
  'session.events': {
    sig: '{kind, path, since, limit}?', doc: 'timeline events, oldest first (since: a seq)',
    run: (ctx, o = {}) => ctx.project.events
      .filter(e => (!o.kind || e.kind === o.kind) && (!o.path || (e.paths || []).includes(o.path)) && (o.since == null || (e.seq ?? Infinity) > o.since))
      .slice(-clamp(+o.limit || 40, 1, 300))
  },
  'session.diff': {
    sig: 'markLabelOrSeq', doc: 'a unified diff of the workspace since then (an event or mark in this workspace)',
    run: async (ctx, at) => {
      const P = ctx.project
      const marks = typeof at === 'number' ? [] : P.marks().filter(m => m.label === at).reverse()
      const seq = typeof at === 'number' ? at : ((marks.find(m => m.ref === ctx.ws) || marks[0]) || {}).seq
      if (seq == null) throw invalid('pass an event seq or a mark label (session.marks())')
      const then = snapshotAt(P, seq, ctx.ws), e = P.event(seq)
      if (then == null) throw Object.assign(new Error(!e ? 'no event ' + seq : (e.kind === 'mark' ? 'the mark "' + e.label + '"' : 'event ' + seq) + ' is in ' + e.ref + ', and this eval works in ' + ctx.ws + ': a diff is within one workspace'), { kind: 'missing' })
      const ch = await changesSince(P, ctx.ws, then, ctx.tx)
      return ch.map(c => c.after === null && c.entry ? '~ ' + c.path + ' (kept by hash)' : diffText(c.path, c.before ?? '', c.after ?? '')).join('\n\n') || 'no changes in ' + ctx.ws + ' since then'
    }
  },
  // the full history behind the summary: search it, read one message
  'session.recall': {
    sig: 'query, {limit, thread, all}?', doc: 'earlier messages that mention the words: [{n, role, when, text}] (this thread; all: every thread)',
    run: async (ctx, query, o = {}) => {
      const P = ctx.project, words = String(query).toLowerCase().split(/[^\p{L}\p{N}_.#-]+/u).filter(w => w.length > 1)
      if (!words.length) throw invalid('give a few words to look for')
      const own = ctx.thread && P.threads.get(ctx.thread)
      const ths = o.thread ? [P.threads.get(o.thread)].filter(Boolean) : own && !o.all ? [own] : [...P.threads.values()]
      const hits = []
      for (const t of ths) {
        await P.loadThread(t.id)
        t.msgs.forEach((m, i) => {
          if (t === own && i >= t.msgs.length - 2) return
          const body = [m.text || '', ...(m.steps || []).flatMap(s => [s.code || '', s.out || ''])].join('\n'), low = body.toLowerCase()
          const found = words.filter(w => low.includes(w))
          if (!found.length) return
          const at = low.indexOf(found[0]), a = Math.max(0, at - 90)
          hits.push({ thread: t === own ? undefined : t.title, threadId: t === own ? undefined : t.id, n: i + 1, role: roleOf(m), when: iso(m.t), score: found.length / words.length, summarized: !!(t.summary && i < t.summary.upTo), text: (a ? '…' : '') + body.slice(a, at + 160).replace(/\s+/g, ' ') + '…' })
        })
      }
      return hits.sort((x, y) => y.score - x.score || y.when.localeCompare(x.when)).slice(0, clamp(+o.limit || 8, 1, 30))
    }
  },
  'session.message': {
    sig: 'n, {thread}?', doc: 'one message in full, with its evals',
    run: async (ctx, n, o = {}) => {
      const P = ctx.project, id = o.thread || ctx.thread
      if (!id) throw invalid('pass {thread: id} (from session.recall) outside a thread')
      const t = await P.loadThread(id), m = t.msgs[(+n || 0) - 1]
      if (!m) throw missing('no message ' + n + ' (the thread has ' + t.msgs.length + ')')
      return { n: +n, role: roleOf(m), when: iso(m.t), text: m.text || '', evals: (m.steps || []).map(s => ({ code: trunc(s.code || '', 2000), status: s.status, result: trunc(s.out || '', 1500), effects: effectsLine(s.effects) || undefined })) }
    }
  },
  // project events (commits, marks, scenarios, …) and what happens in canvas frames
  'session.stream': {
    sig: '{kind, frame, since, limit}?', doc: 'recent events, oldest first: the timeline and canvas frame events (click, change, nav, load, console, error)',
    run: (ctx, o = {}) => Streams.merged(ctx.project, o).map(e => ({ ...e, when: iso(e.t) }))
  },
  'session.waitFor': {
    sig: 'kind, {frame, match, timeout}?', doc: 'waits for the next such event (default 30 s), e.g. a click the person was asked to make', long: true,
    run: (ctx, kind, o = {}) => new Promise((resolve, reject) => {
      const kinds = [].concat(kind), timeout = clamp(+o.timeout || 30000, 500, 300000), t0 = now()
      const ok = e => kinds.includes(e.kind) && (!o.frame || e.frame === o.frame || e.fid === o.frame) && (!o.match || JSON.stringify(e).toLowerCase().includes(String(o.match).toLowerCase()))
      const done = (v, err) => { offs.forEach(f => f()); clearTimeout(timer); err ? reject(err) : resolve(v) }
      const offs = [
        Streams.ev.on('frameevent', e => { if (ok(e)) done({ source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail, when: iso(e.t), waited: now() - t0 }) }),
        ctx.project.ev.on('events', e => { if (e && e.at >= t0 && ok({ ...e, detail: e.label || e.note || '' })) done({ source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, paths: e.paths, detail: e.label || e.note || '', when: iso(e.at), waited: now() - t0 }) }),
      ]
      const timer = setTimeout(() => done(null, Object.assign(new Error('no ' + kinds.join(' or ') + ' event within ' + timeout + ' ms'), { kind: 'timeout' })), timeout)
      if (ctx.signal) ctx.signal.addEventListener('abort', () => done(null, Object.assign(new Error('cancelled'), { kind: 'cancelled' })))
    })
  },
  'session.workspace': {
    sig: '', doc: 'where this eval writes: {ws, title, base, head, writes (this eval\'s, not yet committed)}',
    run: ctx => {
      const P = ctx.project, d = P.draftOf(ctx.ws), p = P.proposals.get(ctx.ws)
      return { ws: ctx.ws, title: p ? p.title : 'draft', base: ctx.tx.base, head: d.head, writes: ctx.tx.paths() }
    }
  },
}
