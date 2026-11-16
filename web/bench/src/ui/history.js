// ui/history.js — the Timeline view (lanes of who did what, the story, an
// event's details: its snapshot, its diff, restoring to it) and the blame
// card for a run of lines.
//
// Events come from the project's timeline (P.events, numbered by seq on the
// server). A commit event names the snapshot it made (ref, n) and the
// paths it changed; diffs and restores read snapshots (model/timeline.js).
//
// Public API: TIMELINE (a view), blameCard, blameTitle; App.timeline =
// {select}.
import { App } from './app.js';
import { Dock } from './dock.js';
import { Snaps } from '../frames/layout.js';
import { clear, confirmBox, h, modal, put, svgEl, toast } from '../lib/dom.js';
import { debounce, fmtAgo, fmtTime, plural } from '../lib/util.js';
import { diffView } from '../lib/text.js';
import { restore, since, versions, why } from '../model/timeline.js';
import { snapStrip } from './snaps.js';

// mark kinds: who makes them and how they look
const MARK_STYLE = { bookmark: ['◆', 'var(--accent)', 'Bookmark'], milestone: ['◆', 'var(--a1)', 'Milestone'], decision: ['◆', 'var(--a2)', 'Decision'], question: ['?', 'var(--a4)', 'Question'], checkpoint: ['■', 'var(--ink)', 'Checkpoint'], auto: ['◇', 'var(--ink-2)', 'Automatic'] }
const markStyle = e => MARK_STYLE[e.mk || (e.who === 'agent' ? 'milestone' : 'bookmark')] || MARK_STYLE.bookmark
const STORY_KINDS = ['mark', 'msg', 'turn', 'accept', 'reject', 'delegate', 'scenario', 'publish']
const KIND_STYLE = { commit: 'var(--ink)', outside: 'var(--warn)', scenario: 'var(--a4)', canvas: 'var(--ink-2)', delegate: 'var(--a2)', eval: 'var(--a1)', turn: 'var(--a2)', msg: 'var(--ink-2)', accept: 'var(--good)', reject: 'var(--accent)', mark: 'var(--accent)', pin: 'var(--a4)', publish: 'var(--good)', compact: 'var(--ink-2)' }
const whoName = (P, e) => e.who === 'agent' ? 'Claude' + ((P.threads.get(e.thread) || {}).title ? ' · ' + P.threads.get(e.thread).title : '') : e.who === 'push' ? 'outside the bench' : e.who === 'ide' ? 'the bench' : 'you'
const label = e => e.kind === 'commit' ? 'committed ' + (e.paths || []).slice(0, 3).join(', ') + ((e.paths || []).length > 3 ? ' +' + (e.paths.length - 3) : '') + (e.ref && e.ref !== 'draft' ? ' (proposal)' : '')
  : e.kind === 'outside' ? 'changed outside: ' + (e.paths || []).slice(0, 3).join(', ')
    : e.kind === 'mark' ? e.label + (e.mk && e.mk !== 'bookmark' && e.mk !== 'milestone' ? ' (' + e.mk + ')' : '')
      : e.kind === 'eval' ? 'eval: ' + (e.calls && e.calls.length ? e.calls.join(', ') : e.note) : e.kind === 'turn' ? 'reply: ' + (e.note || '') : e.kind === 'msg' ? 'asked: ' + e.note
        : e.kind + (e.note || e.label ? ': ' + (e.note || e.label) : '')

export const TIMELINE = {
  title: 'Timeline', sub: 'session history',
  make() {
    const S = { kind: 'all', path: null, sel: null }
    const P = () => App.P
    const svgWrap = h('div', { style: { overflowX: 'auto', borderBottom: '1px solid var(--hair)', flex: 'none' } }), story = h('div.story'), side = h('div.tlside')
    const bar = h('div.toolbar')
    const el = h('div', bar, h('div.tl', h('div.tlmain', svgWrap, story), side))
    const filt = e => (S.kind === 'all' || (S.kind === 'files' && (e.kind === 'commit' || e.kind === 'outside' || e.kind === 'accept')) || (S.kind === 'agent' && e.who === 'agent') || (S.kind === 'story' && STORY_KINDS.includes(e.kind))) && (!S.path || (e.paths || []).includes(S.path))
    const laneOf = e => e.kind === 'mark' ? 'marks' : e.who === 'agent' ? 'agent:' + (e.thread || '?') : e.who === 'push' ? 'outside' : 'you'
    const keyOf = e => e.seq ?? 'p' + P().events.indexOf(e)
    function paintBar() {
      clear(bar)
      put(bar, h('div.seg.sm', [['all', 'All'], ['files', 'Files'], ['agent', 'Agent'], ['story', 'Story']].map(([k, l]) => h('button' + (S.kind === k ? '.on' : ''), { on: { click: () => { S.kind = k; paint() } } }, l))),
        S.path ? h('span.tag', S.path, h('button', { style: { background: 'none', border: 0 }, on: { click: () => { S.path = null; paint() } } }, '×')) : null, h('span.sp'),
        h('span.note', P() ? plural(P().events.length, 'event') : ''),
        h('button.btn.sm', { on: { click: () => App.addMark() } }, '+ Mark'))
    }
    function paintLanes() {
      clear(svgWrap)
      const p = P()
      if (!p) return
      const evs = p.events.filter(filt), lanes = ['you']
      for (const e of evs) { const l = laneOf(e); if (!lanes.includes(l)) lanes.push(l) }
      if (lanes.includes('marks')) { lanes.splice(lanes.indexOf('marks'), 1); lanes.push('marks') }
      const LW = 110, DX = 14, W = Math.max(400, LW + evs.length * DX + 40), H = 26 + lanes.length * 26 + 10
      const svg = svgEl('svg', { class: 'tlsvg', width: W, height: H })
      lanes.forEach((l, i) => {
        const y = 26 + i * 26 + 13, th = l.startsWith('agent:') ? p.threads.get(l.slice(6)) : null
        svg.appendChild(svgEl('line', { x1: LW, x2: W - 10, y1: y, y2: y, stroke: 'var(--rule)' }))
        svg.appendChild(svgEl('text', { x: 10, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)', text: l === 'you' ? 'You' : l === 'outside' ? 'Outside' : l === 'marks' ? 'Marks' : 'Claude · ' + ((th && th.role) || (th && th.title) || 'thread').slice(0, 12) }))
      })
      let lastDay = '', lastLabel = -1e9
      evs.forEach((e, k) => {
        const x = LW + 10 + k * DX, y = 26 + lanes.indexOf(laneOf(e)) * 26 + 13
        const tm = fmtTime(e.at).slice(0, 5)
        if (k % 12 === 0 && tm !== lastDay) { lastDay = tm; svg.appendChild(svgEl('text', { x, y: 12, 'font-size': 9.5, fill: 'var(--ink-2)', text: tm })) }
        if (e.kind === 'mark' && e.mk !== 'auto') {
          const mc = markStyle(e)[1]
          svg.appendChild(svgEl('line', { x1: x, x2: x, y1: 16, y2: H - 4, stroke: mc, 'stroke-dasharray': '3 3', opacity: 0.7 }))
          if (x - lastLabel > 96) { svg.appendChild(svgEl('text', { x: x + 3, y: 22, 'font-size': 9.5, fill: mc, text: e.label.slice(0, 16) })); lastLabel = x }
        }
        const c = e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)', on = S.sel === keyOf(e)
        const shape = e.kind === 'mark'
          ? (e.mk === 'auto' ? svgEl('path', { d: `M${x},${y - 4} L${x + 4},${y} L${x},${y + 4} L${x - 4},${y} z`, fill: 'var(--bg)', stroke: c, 'stroke-width': 1.2 }) : e.mk === 'checkpoint' ? svgEl('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: c }) : svgEl('path', { d: `M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} z`, fill: c }))
          : svgEl('circle', { cx: x, cy: y, r: on ? 6 : 4.5, fill: e.kind === 'msg' || (e.kind === 'commit' && e.ref && e.ref !== 'draft') ? 'var(--bg)' : c, stroke: c, 'stroke-width': 1.5 })
        const g = svgEl('g', { style: 'cursor:pointer' }, svgEl('title', { text: fmtTime(e.at) + ' ' + label(e) }), shape)
        if (on) g.appendChild(svgEl('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: 'var(--ink)' }))
        g.addEventListener('click', () => { S.sel = keyOf(e); paint() })
        svg.appendChild(g)
      })
      svgWrap.appendChild(svg)
      svgWrap.scrollLeft = svgWrap.scrollWidth
    }
    function paintStory() {
      clear(story)
      const p = P()
      if (!p) return
      const evs = p.events.filter(filt).slice(-300)
      if (!evs.length) story.appendChild(h('p.empty', 'Nothing yet.'))
      for (const e of evs) {
        story.appendChild(h('button', { style: S.sel === keyOf(e) ? { background: 'var(--sel)' } : null, on: { click: () => { S.sel = keyOf(e); paint() } } },
          h('span', { style: { color: e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)' } }, e.kind === 'mark' ? markStyle(e)[0] : '●'), h('span.t', fmtTime(e.at)), h('span', label(e), e.who === 'agent' ? h('span.note', ' · Claude') : null)))
      }
      const selB = story.querySelector('[style*="var(--sel)"]')
      if (selB) selB.scrollIntoView({ block: 'nearest' })
    }
    function paintSide() {
      clear(side)
      const p = P()
      if (!p) return
      const e = S.sel != null ? p.events.find(x => keyOf(x) === S.sel) : null
      if (e) {
        const ref = e.ref || 'draft', open = ref === 'draft' || (p.proposals.get(ref) || {}).status === 'open'
        const blk = h('div.block', h('header', h('h3', e.kind), h('span.sub', new Date(e.at).toLocaleString())),
          h('dl.kv', h('dt', 'Who'), h('dd', whoName(p, e)),
            h('dt', 'Where'), h('dd', ref === 'draft' ? 'draft' : 'proposal "' + ((p.proposals.get(ref) || {}).title || ref) + '"'),
            e.n != null ? [h('dt', 'Snapshot'), h('dd', String(e.n))] : null,
            e.paths && e.paths.length ? [h('dt', 'Files'), h('dd', e.paths.slice(0, 12).map(path => h('button.link', { style: { marginRight: '6px' }, on: { click: () => { S.path = path; paint() } } }, path)))] : null,
            e.note || e.label ? [h('dt', 'Note'), h('dd', e.label || e.note)] : null))
        const acts = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } })
        if (e.kind === 'commit' && e.paths && e.paths.length === 1 && open) acts.appendChild(h('button.btn.sm.primary', { title: 'Open the file as it was right after this commit', on: { click: () => { if (ref !== App.ws) App.setWs(ref); App.viewVersion(e.paths[0], e.seq) } } }, 'View this version'))
        if (e.thread && p.threads.get(e.thread)) acts.appendChild(h('button.btn.sm', { on: { click: () => App.showThread(e.thread) } }, 'Open thread'))
        if (e.seq != null) {
          acts.appendChild(h('button.btn.sm', { on: { click: () => showSince(e) } }, 'Diff since'))
          acts.appendChild(h('button.btn.sm.danger', {
            on: {
              click: async () => {
                let n
                try { n = (await since(p, e.seq, 'draft')).length } catch (err) { return toast(err.message, 6000) }
                if (!n) return toast('Draft is already as it was then')
                if (!await confirmBox('Restore draft to this point?', plural(n, 'file') + ' go back to how they were just after this event, as one commit. That is on the timeline too, so you can return.', 'Restore')) return
                const r = await restore(p, e.seq, 'you')
                toast(r.status === 'committed' ? 'Restored ' + plural(r.paths.length, 'file') + ' (draft ' + r.n + ')' : 'Not restored: ' + (r.status === 'conflict' ? 'draft changed meanwhile' : r.error))
              }
            }
          }, 'Restore'))
        }
        blk.appendChild(acts)
        const shots = Snaps.list(p).filter(s => s.seq === e.seq)
        if (shots.length) blk.appendChild(snapStrip(p, shots, 'Frames at this point', 'Click one to compare it with the page now'))
        if (e.kind === 'commit' && e.paths && e.paths.length === 1) blk.appendChild(commitDiff(p, e))
        side.appendChild(blk)
      }
      const marks = p.marks()
      side.appendChild(h('div.block', h('header', h('h3', 'Marks'), h('span.sub', 'yours and Claude\'s')),
        marks.length ? h('div.rows', marks.slice().reverse().map(m => h('button', { on: { click: () => { S.sel = keyOf(m); paint() } } }, h('span', { style: { color: markStyle(m)[1] } }, markStyle(m)[0]), h('span', { style: { flex: 1 } }, m.label, m.note ? h('div.note', m.note) : null), h('span.note', markStyle(m)[2] + ' · ' + (m.who === 'agent' ? 'Claude · ' : m.who === 'ide' ? '' : 'you · ') + fmtTime(m.at))))) : h('p.note', 'Add one with + Mark; Claude marks milestones, decisions and guesses with session.mark().')))
      const files = new Map()
      for (const x of p.events) if (x.kind === 'commit' || x.kind === 'outside') for (const path of x.paths || []) { const f = files.get(path) || { n: 0, at: 0, agent: 0 }; f.n++; f.at = x.at; if (x.who === 'agent') f.agent++; files.set(path, f) }
      side.appendChild(h('div.block', h('header', h('h3', 'Files changed'), h('span.sub', 'click to filter')),
        h('div.rows', [...files].sort((a, b) => b[1].at - a[1].at).slice(0, 60).map(([path, f]) => h('button' + (S.path === path ? '.on' : ''), { on: { click: () => { S.path = S.path === path ? null : path; S.kind = 'all'; paint() } } }, h('span.mono', { style: { flex: 1, fontSize: '11.5px' } }, path), h('span.note', f.n + '×' + (f.agent ? ' (' + f.agent + ' Claude)' : '')), h('span.note', fmtTime(f.at)))))))
    }
    // a one-file commit's change, read from the snapshots before and after it
    function commitDiff(p, e) {
      const box = h('div', h('p.note', '…')), path = e.paths[0], d = p.draftOf(e.ref === 'draft' || !e.ref ? 'draft' : (p.proposals.get(e.ref) || {}).status === 'open' ? e.ref : 'draft')
      versions(p, path, e.ref || 'draft').then(async vs => {
        const k = vs.findIndex(v => v.seq === e.seq), cur = vs[k], before = k > 0 ? vs[k - 1] : null
        const a = before && before.sha256 ? await d.text(before.n, path) : '', b = cur && cur.sha256 ? await d.text(cur.n, path) : ''
        clear(box).appendChild(diffView(a ?? '', b ?? ''))
      }).catch(err => { clear(box).appendChild(h('p.note', 'Could not read the change: ' + err.message)) })
      return box
    }
    async function showSince(e) {
      const p = P()
      let ch
      try { ch = await since(p, e.seq, 'draft') } catch (err) { return toast(err.message, 6000) }
      modal({
        title: 'Draft since ' + fmtTime(e.at) + ' · ' + label(e).slice(0, 40), wide: true, actions: [{ label: 'Close' }],
        body: ch.length ? ch.map(c => h('div', h('b.mono', c.path), ' ', h('span.note', c.before === null ? 'new' : !c.entry ? 'deleted' : ''), diffView(c.before ?? '', c.after ?? ''))) : h('p', 'No changes in draft since then.')
      })
    }
    function paint() { paintBar(); paintLanes(); paintStory(); paintSide() }
    const later = debounce(() => { if (Dock.visible('timeline')) paint() }, 200)
    App.ev.on('events', later); App.ev.on('project', () => { S.sel = null; S.path = null; later() })
    App.ev.on('version', v => { if (v && S.sel !== v.seq) { S.sel = v.seq; later() } })
    App.timeline = { select(seq, path) { S.sel = seq; S.kind = 'all'; S.path = path || null; Dock.open('timeline'); paint() } }
    return { el, show: paint }
  }
}

// ---------- blame details ----------
export function blameTitle(w) {
  const who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ')' : '') : w.who === 'ide' ? 'the bench' : w.who === 'push' ? 'outside the bench' : 'you'
  return [who + ' · ' + new Date(w.at).toLocaleString(), w.request ? 'asked: ' + w.request : '', w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label).join(' · ') : '', w.note && !w.request ? w.note : ''].filter(Boolean).join('\n')
}
export function blameCard(P, path, seq, a, b) {
  const w = why(P, seq)
  if (!w) return
  const who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ' subagent)' : '') : w.who === 'ide' ? 'The bench' : w.who === 'push' ? 'Outside the bench' : 'You'
  const body = [
    h('dl.kv', h('dt', 'Who'), h('dd', who + (w.threadTitle ? ' · thread "' + w.threadTitle + '"' : '')), h('dt', 'When'), h('dd', new Date(w.at).toLocaleString() + ' (' + fmtAgo(w.at) + ')'),
      w.n != null ? [h('dt', 'Snapshot'), h('dd', (w.ref || 'draft') + ' ' + w.n)] : null,
      w.request ? [h('dt', w.delegatedBy ? 'Asked by the main agent' : 'Asked'), h('dd', w.request)] : null,
      w.reply ? [h('dt', 'Reply'), h('dd', w.reply)] : null,
      !w.request && w.note ? [h('dt', 'Note'), h('dd', w.note)] : null),
    w.marks && w.marks.length ? h('div', h('div.note', 'Marks from that turn'), h('ul', { style: { margin: '4px 0', paddingLeft: '18px' } }, w.marks.map(m => h('li', h('b', m.kind + ': '), m.label, m.why ? h('span.note', ' (' + m.why + ')') : null)))) : null]
  modal({
    title: path + ' · line' + (a === b ? ' ' + a : 's ' + a + '–' + b), wide: true, body, actions: [
      { label: 'Close' },
      w.thread && P.threads.get(w.thread) ? { label: 'Open thread', run: () => App.showThread(w.thread) } : null,
      { label: 'Select on timeline', primary: true, run: () => App.timeline && App.timeline.select(seq) }].filter(Boolean)
  })
}
