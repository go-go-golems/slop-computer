// agent/eval.js — one eval: code run in the sandbox as one transaction.
//
// An eval's writes go to a transaction (ctx.tx, core/draft.js) begun on the
// workspace's head, or, for a subagent working in the same workspace, inside
// the transaction of the eval that delegated it. Code that throws drops the
// transaction: there is nothing to undo. Code that returns commits it: one
// change list against the snapshot the eval began on, merged per file on the
// server with whatever landed since — or a conflict (someone else changed a
// file it changed), which writes nothing and fails the eval. A subagent's
// eval folds into its caller's instead, and lands with it. After a commit,
// the frames come up on the new snapshot before the eval's frame effects are
// measured (agent/effects.js). In an app with TypeScript, the effects say
// which type errors the eval introduced and how many it fixed (types: the
// checker's view before the eval against after its commit; agent/types.js).
//
// The same path serves the agent and the person's Eval panel: the context
// says who is running and where (makeContext).
//
// Owns: eval contexts. Public API: AgentUI, makeContext, runEval.
import { API } from './api/index.js';
import { FrameHosts, showing } from '../frames/host.js';
import { ROLES } from './roles.js';
import { Sandbox } from './sandbox.js';
import { Slop } from '../server/slop.js';
import { Types } from './types.js';
import { fileEffects, frameEffects, framesBefore } from './effects.js';
import { h, modal, toast } from '../lib/dom.js';
import { libEntries } from './api/lib.js';
import { now } from '../lib/util.js';

// What only the page can do, set by the shell (ui/app.js): the workspace
// the person views, the canvas selection and view, notices.
export const AgentUI = {
  ws: () => 'draft', setWs: () => { }, selection: () => null,
  focusFrame: () => { }, fit: () => { }, notify: text => toast(text),
}

// o: {ws, who, thread, mode, role, depth, budget, tier, model, signal,
// parentTx, agent, api}
export function makeContext(P, o = {}) {
  const ws = o.ws || 'draft'
  const ctx = {
    project: P, ws, draft: P.draftOf(ws), who: o.who || 'you', thread: o.thread || null, mode: o.mode || 'auto', role: o.role || null,
    depth: o.depth || 0, budget: o.budget || null, tier: o.tier, model: o.model, signal: o.signal || null,
    parentTx: o.parentTx || null, agent: o.agent || null, api: o.api || API, ui: AgentUI,
    tx: null, stack: [], logs: [], changesets: new Map(), children: [],
    onApproval: null,       // a turn shows approvals as cards in its reply
    onPanel: null,          // and panels in its reply
  }
  ctx.approve = (title, detail) => approvalCard(ctx, title, detail)
  return ctx
}

const firstLine = code => (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90)

export async function runEval(ctx, code, { sid, restore, timeoutMs } = {}) {
  const P = ctx.project, d = ctx.draft
  if (d.head == null) await d.open()
  const parent = ctx.parentTx && ctx.parentTx.open && ctx.parentTx.draft === d ? ctx.parentTx : null
  const line = firstLine(code), t0 = now()
  const before = parent ? null : await framesBefore(P, ctx.ws)
  const tx = parent ? parent.child({ label: 'eval' }) : d.begin({ label: 'eval', event: { who: ctx.who, thread: ctx.thread, note: line } })
  // the types before the eval: checked while it runs (the files are taken now)
  const typesBefore = !parent && Types.wants(tx) ? Types.check(P, tx, { timeoutMs: 15000 }) : null
  ctx.tx = tx; ctx.stack = []; ctx.logs = []
  let r
  try {
    r = await Sandbox.run(code, { api: ctx.api, ctx, sid, restore, timeoutMs, lib: libEntries(tx).map(l => ({ name: l.name, source: l.source })), roles: Object.keys(ROLES) })
  } finally {
    // atomic or dry steps the code left open end with it
    while (ctx.stack.length) { ctx.tx.abort(); ctx.tx = ctx.stack.pop() }
    ctx.tx = null
  }
  if (ctx.logs.length) r.logs = [...(r.logs || []), ...ctx.logs.map(text => ({ level: 'log', text }))]
  const effects = {}
  if (!r.ok) {
    if (tx.changes.size) effects.rolledBack = tx.paths()
    tx.abort()
  } else if (tx.changes.size) {
    const files = fileEffects(tx)
    const c = await tx.commit({ message: (ctx.who === 'agent' ? 'claude' : ctx.who) + ': ' + line })
    if (c.status === 'folded') Object.assign(effects, { files, folded: true })
    else if (c.status === 'committed') {
      Object.assign(effects, { files, commit: { ref: d.ref, n: c.n, merged: c.merged } })
      if (c.activated.length) effects.instances = c.activated.map(a => ({ store: a.store, n: a.n, broken: a.broken || a.error || undefined }))
      Object.assign(effects, await afterCommit(ctx, c, before, t0))
      if (typesBefore || Types.wants(tx)) {
        if (c.activated.length) Types.invalidate(P) // actions.d.ts follows the dev instance's actor
        const t = Types.diff(typesBefore ? await typesBefore : { diags: [] }, await Types.check(P, tx))
        if (t.skipped || t.new.length || t.fixed) effects.types = t
      }
    } else {
      tx.abort()
      r.ok = false
      if (c.status === 'conflict') {
        effects.conflict = { ref: d.ref, at: c.at, paths: c.conflicts }
        r.error = { kind: 'conflict', message: d.ref + ' moved to ' + c.at + ' since this eval began on ' + tx.base + ', and that also changed ' + c.conflicts.join(', ') + ': nothing was written. Read those files again and redo the change.' }
        await d.refresh().catch(() => { })
      } else r.error = { kind: 'commit', message: 'the commit failed (' + (c.code || 'error') + '): ' + c.error + '. Nothing was written.' }
    }
  }
  r.effects = Object.keys(effects).length ? effects : null
  return r
}

// After a commit: the frames that show the workspace come up on it (when
// the instance did), the instance's new warnings, the frames' effects.
async function afterCommit(ctx, c, before, t0) {
  const P = ctx.project, out = {}, up = c.activated.filter(a => !a.broken && !a.error)
  if (!up.length) return out
  await Promise.all([...FrameHosts].filter(fh => fh.project === P && fh.ws === ctx.ws && fh.kind !== 'test').map(fh => fh.waitVersion(c.n)))
  try {
    const l = await Slop.call('logs', { app: P.app, ...showing(ctx.ws) })
    const bad = (l.lines || []).filter(x => x.at >= t0 && (x.level === 'error' || x.level === 'warn')).map(x => x.level + ': ' + x.text)
    if (bad.length) out.actorLogs = bad.slice(-6)
  } catch { }
  return Object.assign(out, await frameEffects(P, ctx.ws, before, t0))
}

// An approval asked from inside an eval (step.approve(), publish.run): a
// card in the turn's reply, or a dialog when the person runs the eval.
function approvalCard(ctx, title, detail) {
  return new Promise(resolve => {
    if (ctx.onApproval) {
      const done = v => { ctx.onApproval(null); resolve(v) }
      ctx.onApproval({ title, detail, decide: done })
      if (ctx.signal) ctx.signal.addEventListener('abort', () => done(false))
      return
    }
    let answered = false
    modal({
      title, body: [h('p.note', 'Code in the sandbox asks before it continues.'), detail ? h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '300px', overflow: 'auto', margin: 0 } }, detail) : null],
      onClose: () => { if (!answered) resolve(false) },
      actions: [{ label: 'Decline', run: () => { answered = true; resolve(false) } }, { label: 'Approve', primary: true, run: () => { answered = true; resolve(true) } }]
    })
  })
}
