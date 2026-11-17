// frames/streams.js — what happens in frames, as a stream panels and the
// agent can follow: clicks, changes, navigation, loads, console lines.
//
// Frame hosts append to it; session.stream (agent/) and panels (ui/) read
// it merged with the project's timeline. Owns: the last 500 frame events.
// Public API: Streams (frame, merged, clear, ev 'frameevent').
import { clamp, emitter, now } from '../lib/util.js';

export const Streams = {
  frames: [], ev: emitter(),
  frame(fh, kind, detail, extra) {
    const e = { t: now(), kind, frame: fh.route, w: fh.w, fid: fh.fid, ws: fh.ws, detail: String(detail || '').slice(0, 200), ...(extra || {}) }
    this.frames.push(e)
    if (this.frames.length > 500) this.frames.shift()
    this.ev.emit('frameevent', e)
  },
  // project events and frame events in one list, oldest first
  merged(P, { kind, frame, since, limit = 50 } = {}) {
    const kinds = kind ? [].concat(kind) : null
    const keep = (t, k) => (since == null || t > since) && (!kinds || kinds.includes(k))
    const proj = frame ? [] : P.events.filter(e => keep(e.at, e.kind)).map(e => ({
      t: e.at, source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, ref: e.ref || undefined, n: e.n ?? undefined,
      paths: e.paths, detail: e.label || e.note || '', thread: e.thread || undefined
    }))
    const fr = this.frames.filter(e => keep(e.t, e.kind) && (!frame || e.frame === frame || e.fid === frame)).map(e => ({
      t: e.t, source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail
    }))
    return [...proj, ...fr].sort((a, b) => a.t - b.t).slice(-clamp(+limit || 50, 1, 500))
  },
  clear() { this.frames = [] }
}
