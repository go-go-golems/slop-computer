// agent/effects.js — what an eval did, as the agent and the person read it.
//
// effects: {files: [{path, change, add, del}], commit: {ref, n, merged},
// instances: [{store, n, broken}], actorLogs, newIssues, fixedIssues,
// newErrors, layout, types} when it committed (types: {new: [{file, line,
// message}], fixed, total} or {skipped}: agent/types.js); {folded} when its changes went to
// the eval that delegated it; {rolledBack} when it failed; {conflict}.
// Frame effects compare each board frame's issues and layout before the
// eval with after its commit, once the frames run the new snapshot.
//
// Public API: fileEffects, framesBefore, frameEffects, effectsLine, scopeSummary.
import { FrameHost, Headless, showing } from '../frames/host.js';
import { diffStat } from '../lib/text.js';
import { diffSummary, hostIn, layoutDiff } from '../frames/layout.js';
import { plural } from '../lib/util.js';

// a transaction's own changes, before it commits
export function fileEffects(tx) {
  return tx.diff().map(d => {
    const c = tx.changes.get(d.path)
    if (c.remove) return d.existed ? { path: d.path, change: 'removed' } : null
    if (typeof c.text !== 'string') return { path: d.path, change: d.existed ? 'replaced' : 'created', kept: 'by hash' }
    if (!d.existed) return { path: d.path, change: 'created', lines: c.text.split('\n').length }
    return d.before === c.text ? null : { path: d.path, change: 'edited', ...diffStat(d.before ?? '', c.text) }
  }).filter(Boolean)
}

const issueKey = fh => i => fh.route + ' ' + fh.w + 'px|' + i.kind + '|' + (i.src || i.selector)
const frameName = fh => fh.route + ' ' + fh.w + 'px'
// each board frame's issues and layout before the eval (frames already
// loaded only: measuring must not make the eval wait for a page)
export async function framesBefore(P, ws) {
  const out = new Map()
  await Promise.all(P.board().frames.map(async f => {
    const v = FrameHost.ui.hostFor(f.id)
    const fh = v && v.shown && v.ws === ws ? v : Headless.peek(P, v ? v.route : f.route, { ...showing(ws), w: f.w, h: f.h })
    if (!fh || !fh.ready) return
    const b = { route: fh.route, issues: new Set(fh.issues.map(issueKey(fh))), layout: null }
    try { b.layout = await fh.call('layout', [300], 1200) } catch { b.layout = fh.layoutMap }
    out.set(f.id, b)
  }))
  return out
}
export async function frameEffects(P, ws, before, t0) {
  const added = [], fixed = [], errors = new Set(), layout = []
  for (const f of P.board().frames) {
    let fh
    try { fh = await hostIn(P, f, ws); await fh.runCheck() } catch { continue }
    const b = before.get(f.id), key = issueKey(fh)
    if (b && b.layout && b.route === fh.route && fh.layoutMap && !layout.some(x => x.frame === frameName(fh))) {
      const d = layoutDiff(b.layout, fh.layoutMap)
      if (d.changes.length || Math.abs(d.heightFrom - d.heightTo) > 1) layout.push({ frame: frameName(fh), changes: diffSummary(d, 10) })
    }
    if (b) {
      const now = new Set(fh.issues.map(key))
      for (const i of fh.issues) if (!b.issues.has(key(i))) added.push({ frame: frameName(fh), kind: i.kind, message: i.message, src: i.src || undefined })
      for (const k of b.issues) if (!now.has(k)) fixed.push(k.split('|').slice(0, 2).join(' · '))
    }
    for (const l of fh.logs) if (l.level === 'error' && l.t >= t0) errors.add(fh.route + ': ' + l.text + (l.src ? ' @' + l.src : ''))
  }
  const out = {}
  if (added.length) out.newIssues = added.slice(0, 8)
  if (fixed.length) out.fixedIssues = [...new Set(fixed)].slice(0, 8)
  if (errors.size) out.newErrors = [...errors].slice(0, 6)
  if (layout.length) out.layout = layout.slice(0, 5)
  return out
}

export function effectsLine(e) {
  if (!e) return ''
  const parts = []
  if (e.rolledBack) parts.push('rolled back ' + e.rolledBack.join(', '))
  if (e.conflict) parts.push('conflict with ' + e.conflict.ref + ' ' + e.conflict.at + ' in ' + e.conflict.paths.join(', ') + ': nothing written')
  for (const f of e.files || []) parts.push(f.change === 'edited' ? f.path + ' +' + f.add + ' −' + f.del : f.change + ' ' + f.path)
  if (e.folded) parts.push('folded into the delegating eval')
  if (e.commit) parts.push(e.commit.ref + ' ' + e.commit.n + (e.commit.merged ? ' (merged)' : ''))
  const broken = (e.instances || []).filter(i => i.broken)
  if (broken.length) parts.push(broken.map(i => i.store + ' broken: ' + i.broken.slice(0, 120)).join('; '))
  else if (e.instances && e.instances.length) parts.push('instances ok')
  if (e.actorLogs) parts.push(plural(e.actorLogs.length, 'actor warning') + '/errors')
  if (e.fixedIssues) parts.push('fixed ' + plural(e.fixedIssues.length, 'issue'))
  if (e.newIssues) parts.push(plural(e.newIssues.length, 'new issue'))
  if (e.newErrors) parts.push(plural(e.newErrors.length, 'new error'))
  if (e.types && e.types.skipped) parts.push('types not checked')
  else if (e.types) {
    if (e.types.new.length) parts.push(plural(e.types.new.length + (e.types.more || 0), 'new type error'))
    if (e.types.fixed) parts.push('fixed ' + plural(e.types.fixed, 'type error'))
  }
  if (e.layout) parts.push('layout changed on ' + e.layout.map(l => l.frame.split(' ')[0]).filter((x, i, a) => a.indexOf(x) === i).join(', '))
  return parts.join(' · ')
}
export function scopeSummary(scope) {
  if (!scope || !scope.vars) return ''
  const k = v => v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v === 'object' ? 'object' : typeof v
  return Object.entries(scope.vars).map(([n, v]) => n + ': ' + k(v)).join(', ')
}
