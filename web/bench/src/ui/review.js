// ui/review.js — the Review view: open proposals with their changes,
// checks (layout against draft on every board frame, scenarios on both),
// accepting or rejecting them; and the comment pins.
//
// A proposal is a ref (proposal/<id>) made at a draft snapshot (its base).
// Its changes are what its head (with the person's edits) has against that
// base. Accepting commits the chosen changes onto draft over the base, so
// the server merges them with what reached draft since; a file both
// changed is a conflict and nothing is accepted.
//
// Public API: REVIEW (a view).
import { App } from './app.js';
import { Dock } from './dock.js';
import { clear, confirmBox, h, toast } from '../lib/dom.js';
import { debounce, fmtAgo, now, plural } from '../lib/util.js';
import { diffStat, diffView } from '../lib/text.js';
import { diffSummary, layoutDiff, layoutIn } from '../frames/layout.js';
import { runAllScenarios } from '../frames/scenarios.js';

const Checks = new Map()   // ref → {busy, t, layout, scen}

export const REVIEW = {
  title: 'Review', sub: 'proposals and pins',
  badge: () => { const n = App.P ? App.P.openProposals().length : 0; return n ? h('span.count', String(n)) : null },
  make() {
    const body = h('div.scroll'), el = h('div', body)
    const S = { picked: {}, shown: {}, changes: new Map(), seq: 0 }
    async function load() {
      const P = App.P, my = ++S.seq
      if (!P) return
      const all = await Promise.all(P.openProposals().map(async p => [p.ref, await P.changes(p.ref).catch(e => ({ error: e.message }))]))
      if (my !== S.seq) return
      S.changes = new Map(all)
      paint()
    }
    function paint() {
      clear(body)
      const P = App.P
      if (!P) return
      const open = P.openProposals()
      body.appendChild(h('div.toolbar', h('b', 'Proposals'), h('span.note', 'copies of draft; nothing lands until you accept'), h('span.sp'),
        h('button.btn.sm', { on: { click: () => App.newProposal() } }, '+ Proposal')))
      if (!open.length) body.appendChild(h('p.empty', 'No open proposals. Agent threads work in one by default; you can also start one and edit in it.'))
      for (const p of open) body.appendChild(card(P, p))
      const closed = [...P.proposals.values()].filter(p => p.status !== 'open' && p.status !== 'discarded').sort((a, b) => (b.closed || 0) - (a.closed || 0)).slice(0, 12)
      if (closed.length) {
        body.appendChild(h('div.toolbar', h('b', 'Closed')))
        body.appendChild(h('div.rows', { style: { padding: '0 12px 8px' } }, closed.map(p => h('div', h('span', p.title), h('span.note', p.status), h('span.sp'), h('span.note', p.closed ? fmtAgo(p.closed) : '')))))
      }
      const pins = P.meta.pins || []
      body.appendChild(h('div.toolbar', h('b', 'Pins'), h('span.note', 'Comment mode: click a frame to pin a note'), h('span.sp'), h('span.note', pins.filter(p => !p.resolved).length + ' open')))
      body.appendChild(h('div.rows', { style: { padding: '0 12px 12px' } }, pins.length ? pins.slice().sort((a, b) => a.resolved - b.resolved || b.n - a.n).map(p => h('div', { style: { opacity: p.resolved ? 0.55 : 1 } },
        h('b', '#' + p.n), h('span', { style: { flex: 1 } }, p.text, p.reply ? h('div.note', '↳ ' + p.reply) : null), h('span.note', p.route),
        !p.resolved ? h('button.link.note', { on: { click: () => App.askAgent('Address pin #' + p.n + ' on ' + p.route + ' (' + (p.src || '') + '): ' + p.text) } }, 'ask agent') : null,
        h('button.link.note', { on: { click: () => { p.resolved = !p.resolved; P.saveMeta(); App.ev.emit('pins') } } }, p.resolved ? 'reopen' : 'resolve'))) : h('p.note', 'No pins.')))
    }
    function card(P, p) {
      const ch = S.changes.get(p.ref), th = p.thread && P.threads.get(p.thread), pick = S.picked[p.ref] = S.picked[p.ref] || {}
      const list = Array.isArray(ch) ? ch : []
      for (const c of list) if (!(c.path in pick)) pick[c.path] = true
      const n = list.filter(c => pick[c.path]).length, all = list.length
      const c = h('div.ovcard', h('header', h('h3', p.title), th ? h('span.tag.ws', th.role || 'agent') : h('span.tag.ws', 'you'), th ? h('span.note', th.title) : null, h('span.note', fmtAgo(p.created)), h('span.sp'),
        h('button.btn.sm' + (App.ws === p.ref ? '.on' : ''), { on: { click: () => App.setWs(App.ws === p.ref ? 'draft' : p.ref) } }, App.ws === p.ref ? 'Viewing' : 'View'),
        h('button.btn.sm', { disabled: !all, title: 'Draft above, proposal below on the canvas', on: { click: () => { App.setWs(p.ref); App.compare(true) } } }, 'Compare'),
        h('button.btn.sm.primary', { disabled: !n, on: { click: () => accept(P, p, list.filter(x => pick[x.path]).map(x => x.path), list.filter(x => !pick[x.path]).map(x => x.path)) } }, 'Accept ' + (n === all ? 'all' : n + ' of ' + all)),
        h('button.btn.sm.danger', { on: { click: async () => { if (!all || await confirmBox('Reject "' + p.title + '"?', 'Its ' + plural(all, 'change') + ' are discarded with the proposal. The timeline keeps its commits.', 'Reject')) { await P.reject(p.ref); if (App.ws === p.ref) App.setWs('draft') } } } }, 'Reject')))
      const files = h('div.files')
      if (!ch) files.appendChild(h('p.note', 'Reading its changes…'))
      else if (ch.error) files.appendChild(h('p.note', { style: { color: 'var(--accent)' } }, 'Could not read its changes: ' + ch.error))
      else if (!all) files.appendChild(h('p.note', 'No changes yet.'))
      for (const x of list) {
        const text = x.after !== null || x.before !== null, st = text ? diffStat(x.before ?? '', x.after ?? '') : null, key = p.ref + x.path, shown = S.shown[key] ?? list.length <= 3
        const cb = h('input', { type: 'checkbox', checked: pick[x.path], on: { change: () => { pick[x.path] = cb.checked; paint() } } })
        // only the checkbox takes a file in or out: clicking a file's name to look at it unticked it
        // (a persona's accept then dropped actor.ts and broke the draft)
        files.appendChild(h('div', h('label', { title: 'Include this file when you accept' }, cb), text ? h('button.link', { style: { padding: 0 }, on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, x.path) : h('span', x.path), h('span', h('span.note', !x.existed ? 'new' : !x.entry ? 'deleted' : st ? '+' + st.add + ' −' + st.del : 'replaced (kept by hash)'), h('span.sp'),
          text ? h('button.link.note', { on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, shown ? 'hide diff' : 'show diff') : null, ' ',
          x.entry ? h('button.link.note', { on: { click: e => { e.preventDefault(); App.setWs(p.ref); App.reveal(x.path, 1) } } }, 'open') : null),
          shown && text ? diffView(x.before ?? '', x.after ?? '') : null))
      }
      c.appendChild(files)
      if (all) c.appendChild(checksPanel(P, p))
      return c
    }
    async function accept(P, p, paths, left = []) {
      // accepting part of a proposal closes it: what is left out goes with it, so say which
      if (left.length && !await confirmBox('Accept ' + paths.length + ' of ' + (paths.length + left.length) + ' files?', 'Left out, and discarded with the proposal: ' + left.join(', ') + '. Files that belong together (a migration and the code that uses it) should go in together.', 'Accept ' + paths.length)) return
      const r = await P.accept(p.ref, paths, 'you').catch(e => ({ status: 'failed', error: e.message }))
      if (r.status === 'committed') { toast('Accepted ' + plural(paths.length, 'change') + ' into draft ' + r.n + (r.merged ? ' (merged with what changed since)' : '')); if (App.ws === p.ref) App.setWs('draft') }
      else if (r.status === 'conflict') toast('Not accepted: draft also changed ' + r.conflicts.join(', ') + ' since the proposal began. Bring those files up to date in the proposal, or leave them out.', 8000)
      else toast('Not accepted: ' + (r.error || r.status), 6000)
    }
    function checksPanel(P, p) {
      const st = Checks.get(p.ref) || {}, box = h('div.checks')
      const paintBox = () => {
        clear(box)
        box.append(h('div.toolbar.sub', h('b', 'Checks'), h('span.note', st.t ? 'as of ' + fmtAgo(st.t) : 'layout against draft, and the scenarios on both'), h('span.sp'),
          h('button.btn.sm', { disabled: st.busy, on: { click: () => runChecks(P, p, st, paintBox) } }, st.busy ? 'Checking…' : st.t ? 'Check again' : 'Check layout and scenarios')))
        if (st.layout) for (const f of st.layout) box.appendChild(h('div.lyt', h('div.lh', h('b', f.frame), h('span.note', f.lines.length ? plural(f.changes, 'change') : 'no layout changes'), h('span.sp'),
          f.lines.length ? h('button.link.note', { on: { click: () => App.canvas && App.canvas.compareWs(f.fid, 'draft', p.ref) } }, 'compare frozen frames') : null),
          f.lines.length ? h('pre.mono.lines', f.lines.join('\n')) : null))
        if (st.scen) {
          if (!st.scen.length) box.appendChild(h('p.note', 'No scenarios yet: record one from a frame\'s ⋯ menu, or ask the agent (or a qa subagent) to write some.'))
          for (const r of st.scen) box.appendChild(h('div.sres' + (r.ok ? '.ok' : '.bad'), h('span', r.ok ? '✓' : '✗'), h('b', r.name),
            h('span.note', r.ok ? (r.base === false ? 'fixed by this proposal' : 'passes') : (r.base === true ? 'regression: passes in draft' : 'fails') + ' · step ' + ((r.failedAt ?? -1) + 1) + ': ' + (r.error || ''))))
        }
      }
      paintBox()
      return box
    }
    async function runChecks(P, p, st, repaint) {
      st.busy = true; Checks.set(p.ref, st); repaint()
      try {
        const layout = []
        for (const f of P.board().frames) {
          try {
            const A = await layoutIn(P, f, 'draft', { headless: true }), B = await layoutIn(P, f, p.ref, { headless: true }), d = layoutDiff(A.layout, B.layout)
            layout.push({ fid: f.id, frame: (f.label ? f.label + ' · ' : '') + A.fh.route + ' ' + f.w + 'px', changes: d.changes.length, lines: diffSummary(d, 14) })
          } catch (e) { layout.push({ fid: f.id, frame: f.route + ' ' + f.w + 'px', changes: 0, lines: ['could not load: ' + e.message] }) }
        }
        st.layout = layout
        const inProp = await runAllScenarios(P, { ws: p.ref, who: 'you' })
        const inDraft = new Map((await runAllScenarios(P, { ws: 'draft', who: 'you' })).map(r => [r.name, r.ok]))
        st.scen = inProp.map(r => ({ ...r, base: inDraft.get(r.name) }))
        st.t = now()
        App.ev.emit('scenarios')
      } finally { st.busy = false; repaint() }
    }
    const later = debounce(() => { if (Dock.visible('review')) load(); Dock.refreshTabs() }, 300)
    App.ev.on('proposals', later); App.ev.on('files', later); App.ev.on('pins', later); App.ev.on('ws', later); App.ev.on('project', later)
    return { el, show: load }
  }
}
