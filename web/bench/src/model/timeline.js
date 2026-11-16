// model/timeline.js — questions about an app's history, answered from its
// snapshots and the timeline's events.
//
// The timeline (P.events) records what happened: a commit names the snapshot
// it made (ref, n) and the paths it changed; a message, a reply, a mark or a
// delegation names its thread. File texts are not in events: a version of a
// file is its text in a snapshot, read through the Draft (by hash, cached).
// Every function here takes the project; those that read snapshots are async.
//
// Public API: stampEvent, snapshotAt, versions, blame, why, since, restore.
import { diffLines } from '../lib/text.js';

// What an event records when it is logged: its ref (draft unless it names
// one) and that ref's snapshot as the page sees it (headOf(ref)), unless it
// says which. Restoring to it, or a diff since it, starts from there, so
// nothing has to be inferred from earlier events, which may not have seen
// every move of the ref (the bench closed, another tab, a push).
export function stampEvent(e, headOf) {
  const ref = e.ref || 'draft'
  let n = e.n
  if (n == null) { try { n = headOf(ref) } catch (err) { n = null } }
  return { ...e, ref, n: n ?? null }
}

// The snapshot of a ref just after event seq. An event on the ref records
// it (model/project.js log). For an event on another ref: that of the
// latest event on this ref before it. null: the timeline does not know,
// which is not the empty tree.
export function snapshotAt(P, seq, ref = 'draft') {
  let n = null
  for (const e of P.events) {
    if (e.seq == null || e.seq > seq) break
    if (e.n != null && e.ref === ref) n = e.n
  }
  return n
}
function knownAt(P, seq, ref) {
  const n = snapshotAt(P, seq, ref)
  if (n == null) throw Object.assign(new Error('the timeline does not know ' + ref + '\'s snapshot at event ' + seq + ': nothing on ' + ref + ' was recorded by then'), { kind: 'missing' })
  return n
}

// Events that made the snapshot they record; any other event only saw it.
const MADE = new Set(['commit', 'outside'])

// The versions of a file on a ref: each state of it the timeline knows,
// oldest first: [{seq, n, at, who, kind, thread, note, sha256 (null:
// removed), observed}]. A version is a commit's or an outside change's;
// one first seen at another event (the file as it was when the timeline
// began, or changed while the bench was closed) is observed: who made it
// is not known.
export async function versions(P, path, ref = 'draft', limit = 200) {
  const d = P.draftOf(ref), out = []
  let last
  for (const e of P.events.filter(e => e.n != null && e.ref === ref).slice(-limit)) {
    const f = (await d.listingOf(e.n)).get(path), sum = f ? f.sha256 : null
    if (sum === last) continue
    last = sum
    out.push({ seq: e.seq, n: e.n, at: e.at, who: e.who, kind: e.kind, thread: e.thread, note: e.note || e.label || '', sha256: sum, observed: !MADE.has(e.kind) })
  }
  return out
}

// For each line of a file at the ref's head: the seq of the event whose
// snapshot last changed it (undefined: older than the timeline, or changed
// where the timeline did not see who). Cached per path and head.
const blames = new Map()
export async function blame(P, path, ref = 'draft') {
  const d = P.draftOf(ref), key = P.app + '|' + ref + '|' + path + '|' + d.head
  if (blames.has(key)) return blames.get(key)
  let attrib = [], prev = ''
  for (const v of await versions(P, path, ref)) {
    const text = v.sha256 ? await d.text(v.n, path) : null
    if (text === null) { attrib = []; prev = ''; continue }
    const next = []
    for (const x of diffLines(prev, text)) {
      if (x.op === ' ') next.push(attrib[x.a - 1])
      else if (x.op === '+') next.push(v.observed ? undefined : v.seq)
    }
    attrib = next; prev = text
  }
  if (blames.size > 50) blames.delete(blames.keys().next().value)
  blames.set(key, attrib)
  return attrib
}

// Why an event happened: the person's request in its thread, Claude's
// reply, the marks in between; a subagent's work answers its parent's
// delegation.
export function why(P, seq) {
  const e = P.event(seq)
  if (!e) return null
  const out = { seq, at: e.at, who: e.who, kind: e.kind, ref: e.ref, n: e.n, note: e.note || e.label || '', thread: e.thread || null }
  const th = e.thread && P.threads.get(e.thread)
  if (!th) return out
  out.threadTitle = th.title; out.role = th.role || null
  const evs = P.events, i = evs.indexOf(e)
  let msg = null
  for (let j = i; j >= 0; j--) if (evs[j].kind === 'msg' && evs[j].thread === th.id) { msg = evs[j]; break }
  if (msg) out.request = msg.note
  else if (th.parent) {
    const d = evs.slice(0, i + 1).reverse().find(x => x.kind === 'delegate' && x.child === th.id)
    if (d) { out.request = d.note; out.delegatedBy = d.thread }
  }
  const turn = evs.slice(i).find(x => x.kind === 'turn' && x.thread === th.id)
  if (turn) out.reply = (turn.note || '').replace(/^#+\s*/, '')
  const lo = msg ? evs.indexOf(msg) : Math.max(0, i - 200), hi = turn ? evs.indexOf(turn) : i + 200
  out.marks = evs.slice(lo, hi + 1).filter(x => x.kind === 'mark' && x.thread === th.id).map(x => ({ seq: x.seq, kind: x.mk, label: x.label, why: x.note || undefined }))
  return out
}

// What changed in the person's view of a ref since event seq:
// [{path, before, after, entry}] (texts null for files kept by hash; entry
// is the file now, null when removed).
export async function since(P, seq, ref = 'draft') {
  const d = P.draftOf(ref), view = P.view(ref), then = knownAt(P, seq, ref)
  const old = await d.listingOf(then), out = []
  for (const path of new Set([...old.keys(), ...view.list()])) {
    const a = old.get(path), b = view.entry(path)
    const same = a && b ? (typeof b.text === 'string' ? (await d.text(then, path)) === b.text : a.sha256 === b.sha256) : !a && !b
    if (same) continue
    out.push({ path, before: a ? await d.text(then, path) : null, after: b && typeof b.text === 'string' ? b.text : null, entry: b })
  }
  return out.sort((x, y) => x.path.localeCompare(y.path))
}

// Put a ref back as it was just after event seq, as one commit of the
// person's (or the agent's): {status, …} as Tx.commit answers. Throws (kind
// missing) when the timeline does not know that state.
export async function restore(P, seq, who = 'you') {
  const ref = 'draft', then = knownAt(P, seq, ref), d = P.draftOf(ref)
  await d.settle()
  const e = P.event(seq), label = e ? (e.label || e.note || 'event ' + seq) : 'the start'
  const tx = d.begin({ label: 'restore', event: { who, note: 'restored to ' + label } })
  for (const path of new Set([...(await d.listingOf(then)).keys(), ...d.list()])) {
    const a = (await d.listingOf(then)).get(path), b = d.entry(path)
    if (!a) { if (b) tx.remove(path); continue }
    if (b && b.sha256 === a.sha256) continue
    const text = await d.text(then, path)
    if (text !== null) { if (!b || b.text !== text) tx.write(path, text) } else tx.copy(path, a)
  }
  return await tx.commit()
}
