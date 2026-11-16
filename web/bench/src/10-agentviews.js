// ---------- agent: threads, chat with eval steps, modes, model ----------
import { $$, clear, confirmBox, h, modal, popMenu, promptBox, put, svgEl, toast } from './lib/dom.js';
import { clamp, debounce, fmtAgo, fmtTime, now, plural } from './lib/util.js';
import { diffStat, diffView, hlJS, hlYAML, renderMarkdown } from './lib/text.js';

const MODELS = [
  { v: 'quick', label: 'Quick' }, { v: 'default', label: 'Default' }, { v: 'complex', label: 'Complex' },
  { v: 'm:claude-haiku-5-5', label: 'Haiku 5.5' }, { v: 'm:claude-sonnet-5-5', label: 'Sonnet 5.5' }, { v: 'm:claude-opus-5-5', label: 'Opus 5.5' }
]
registerView('agent', {
  title: 'Agent', sub: 'chat with Claude',
  badge: () => Agent.anyBusy() ? h('span.count', '…') : null,
  make() {
    const S = { tid: null, chips: { sel: true }, early: {} }
    const strip = h('div.threads'), chat = h('div.chat'), note = h('div.block', { hidden: true })
    const ta = h('textarea.txt', { placeholder: 'Ask for a change. The selection and open pins go along as context.', on: { keydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } } } })
    const chips = h('div.ctxchips'), row = h('div.row')
    const el = h('div', strip, note, chat, h('div.composer', chips, ta, row))
    chat.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (r) { e.preventDefault(); /\.md$/i.test(r.dataset.file) ? App.openDoc(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1) } })
    const P = () => App.P
    const th = () => { const p = P(); if (!p) return null; let t = S.tid && p.threads.get(S.tid); if (!t) { t = [...p.threads.values()].sort((a, b) => b.created - a.created)[0]; if (!t) t = p.newThread(); S.tid = t.id } return t }

    function paintStrip() {
      if (!P()) return clear(strip)
      const cur = th(); clear(strip)
      for (const t of [...P().threads.values()].sort((a, b) => a.created - b.created)) {
        if (t.parent && t !== cur) continue
        strip.appendChild(h('span.th' + (t === cur ? '.on' : '') + (t.parent ? '.child' : ''), h('button', { title: t.title, on: { click: () => { S.tid = t.id; paintAll() }, dblclick: async () => { const n = await promptBox('Rename thread', 'Title', t.title); if (n) { t.title = n; P().saveThread(t); paintStrip() } } } },
          Agent.busy(t.id) ? h('span.dot.busy') : null, t.parent ? '↳ ' : '', t.title.length > 22 ? t.title.slice(0, 22) + '…' : t.title)))
      }
      strip.appendChild(h('div.rel.new', { style: { display: 'flex', padding: 0 } },
        h('button', { title: 'Thread actions', on: { click: e => threadMenu(e.currentTarget) } }, '⋯'),
        h('button', { title: 'New thread', on: { click: () => { const t = P().newThread(); S.tid = t.id; paintAll(); ta.focus() } } }, '+ Thread')))
    }
    function threadMenu(btn) {
      const t = th(); if (!t) return
      popMenu(btn, [{ group: t.title },
        { label: 'Rename…', run: async () => { const n = await promptBox('Rename thread', 'Title', t.title); if (n) { t.title = n; P().saveThread(t); paintStrip() } } },
        { label: 'Download transcript', sub: 'Markdown, with every eval', disabled: !t.msgs.length, run: () => saveFile(slug(P().title) + '-' + slug(t.title) + '.md', transcriptMd(P(), t)) },
        ...(() => { const kids = [...P().threads.values()].filter(x => x.parent).sort((a, b) => b.created - a.created).slice(0, 12); return kids.length ? [{ group: 'Subagent threads' }, ...kids.map(k => ({ label: '↳ ' + k.title, sub: (Agent.busy(k.id) ? 'working · ' : '') + fmtAgo(k.created), run: () => { S.tid = k.id; paintAll() } })), { hr: true }] : [] })(),
        { group: 'Context' },
        { label: 'Summarize earlier messages now', sub: t.summary ? 'messages 1–' + t.summary.upTo + ' are summarized' : 'happens on its own when the thread gets long', disabled: Agent.busy(t.id) || t.msgs.length - (t.summary ? t.summary.upTo : 0) < 4, run: () => compactNow(t) },
        t.summary ? { label: 'Edit the summary…', run: () => editSummary(t) } : null,
        t.summary ? { label: 'Forget the summary', sub: 'Claude sees the full history again (as much as fits)', run: () => { t.summary = null; P().saveThread(t); paintChat(); paintChips() } } : null,
        { hr: true },
        { label: 'Download as JSON', disabled: !t.msgs.length, run: () => saveFile(slug(P().title) + '-' + slug(t.title) + '.json', JSON.stringify(t, null, 1)) },
        { hr: true },
        { label: 'Delete thread…', danger: true, disabled: Agent.busy(t.id), run: async () => { if (await confirmBox('Delete "' + t.title + '"?', 'Its messages go; the timeline keeps what it did.', 'Delete')) { P().dropThread(t.id); S.tid = null; paintAll() } } }], { right: true })
    }
    function stepEl(s, i) {
      const calls = [...new Set(s.calls || [])]
      const sum = h('summary', h('b', (s.status === 'ok' ? '✓' : s.status === 'error' ? '✕' : s.status === 'ask' ? '?' : s.status === 'skipped' ? '–' : '…') + ' eval ' + (i + 1)),
        h('span', calls.length ? calls.slice(0, 4).join(', ') + (calls.length > 4 ? ' +' + (calls.length - 4) : '') : (s.code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 60)),
        s.ms != null ? h('span', s.ms + ' ms') : null)
      const fx = effectsLine(s.effects)
      if (fx) sum.appendChild(h('span.fx' + (s.effects.rolledBack || s.effects.newIssues || s.effects.newErrors ? '.bad' : ''), fx))
      const d = h('details.step' + (s.status === 'error' ? '.bad' : ''), sum, h('pre', { html: hlJS(s.code) }), s.logs && s.logs.length ? h('pre', s.logs.join('\n')) : null, s.out ? (s.fmt === 'yaml' ? h('pre.yaml', { html: hlYAML(s.out) }) : h('pre', s.out)) : null,
        s.effects && (s.effects.newIssues || s.effects.newErrors) ? h('pre', [...(s.effects.newIssues || []).map(i => 'new issue · ' + i.frame + ' · ' + i.message + (i.src ? ' @' + i.src : '')), ...(s.effects.newErrors || []).map(e => 'new error · ' + e)].join('\n')) : null)
      if (s.children && s.children.length) d.appendChild(h('div.kids', s.children.map(c => { const ct = P().threads.get(c.thread); const last = ct && [...ct.msgs].reverse().find(m => m.role === 'agent')
        return h('div', h('span', '↳ ' + c.role), h('span', ct ? (Agent.busy(ct.id) ? 'working…' : plural((last && last.steps || []).length, 'eval') + (last && last.status === 'error' ? ' · failed' : '')) : ''), h('button.link', { on: { click: e => { e.preventDefault(); App.showThread(c.thread) } } }, 'open thread')) })))
      if (s.status === 'ask') {
        d.open = true
        d.appendChild(h('div.ask', h('span', 'Run this eval?'), h('button.btn.sm.primary', { on: { click: () => s.decide && s.decide(true) } }, 'Run'), h('button.btn.sm', { on: { click: () => s.decide && s.decide(false) } }, 'Skip')))
      }
      return d
    }
    // the running summary: what Claude sees in place of the older messages; readable, editable, forgettable
    function summaryEl(t, early) {
      const sm = t.summary
      return h('div.summary',
        h('div.who', h('b', 'Earlier: ' + plural(sm.upTo, 'message') + ' summarized for Claude'), h('span', sm.by === 'you' ? 'edited by you' : sm.by === 'fallback' ? 'listed without a model' : 'by Claude'), h('span', fmtAgo(sm.t)), h('span.sp'),
          h('button.link.note', { on: { click: () => { S.early[t.id] = !early; paintChat() } } }, early ? 'Hide them' : 'Show them'), ' ',
          h('button.link.note', { title: 'Correct what Claude will remember', on: { click: () => editSummary(t) } }, 'Edit')),
        renderMarkdown(sm.text, f => P().read(f, 'main') !== null))
    }
    function editSummary(t) {
      const ta = h('textarea.mono', { style: { width: '100%', minHeight: '260px', fontSize: '12px' } }); ta.value = t.summary.text
      modal({ title: 'What Claude remembers of messages 1–' + t.summary.upTo, wide: true, body: [h('p.note', 'Claude reads this instead of the older messages. Fix anything wrong or missing; it can still look up the originals with session.recall.'), ta],
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: () => { t.summary = { ...t.summary, text: ta.value.trim(), by: 'you', t: now() }; P().saveThread(t); P().log({ kind: 'compact', who: 'you', ws: 'main', thread: t.id, note: 'edited the summary of "' + t.title + '"' }); paintChat() } }] })
    }
    async function compactNow(t) {
      toast('Summarizing…')
      try { const r = await Agent.compact(P(), t, { force: true }); toast(r ? 'Summarized messages 1–' + r.upTo : 'Too short to summarize') } catch (e) { toast('Could not summarize: ' + e.message) }
      paintChat(); paintChips()
    }
    function msgEl(m, i, t) {
      if (m.role === 'user') return h('div.msg.user', h('div.who', m.from ? 'From the ' + m.from : 'You', h('span', fmtTime(m.t)), m.ctx && m.ctx.sel ? h('span.tag', m.ctx.sel.tag + ' ' + m.ctx.sel.src) : null), h('div.body', m.text))
      const ov = m.ws && m.ws !== 'main' ? P().overlays.get(m.ws) : null
      return h('div.msg.agent',
        h('div.who', 'Claude', h('span', fmtTime(m.t)), m.model ? h('span', m.model) : null, m.status === 'running' ? h('span.dot.busy') : null, h('span.sp'),
          h('button.link.note', { title: 'Bookmark this reply on the timeline', on: { click: () => { P().mark({ label: (m.text || 'reply').split('\n')[0].slice(0, 40), by: 'you', thread: t.id, msg: i }); toast('Marked on the timeline') } } }, '☆ mark')),
        (m.steps || []).map(stepEl),
        (m.panels || []).map(id => { const pn = Panels.get(P(), id); return pn ? panelEl(P(), pn, { inline: true }) : null }),
        m.text ? renderMarkdown(m.text, file => P().read(file, 'main') !== null || (!!m.ws && m.ws !== 'main' && !!P().overlays.get(m.ws) && P().read(file, m.ws) !== null)) : m.status === 'running' && !(m.steps || []).length ? h('div.body.note', m.note || 'Thinking…') : null,
        m.error ? h('div.note', { style: { color: 'var(--accent)' } }, m.error) : null,
        m.approval ? h('div.approval', h('b', m.approval.title), m.approval.detail ? h('pre', m.approval.detail) : null,
          h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm.primary', { on: { click: () => m.approval && m.approval.decide(true) } }, 'Approve'), h('button.btn.sm', { on: { click: () => m.approval && m.approval.decide(false) } }, 'Decline'))) : null,
        ov ? h('div.ctx', ov.status === 'open' ? [h('span.tag.ws', 'proposal'), ' ', m.summary || 'working in "' + ov.title + '"', ' ', h('button.link', { on: { click: () => { App.setWs(ov.id); Dock.open('review') } } }, 'Review')] : h('span', '"' + ov.title + '" was ' + ov.status)) : null)
    }
    let raf = 0
    function paintChat() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0; const t = th(); if (!t) return
        const atEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60
        const open = new Set($$('details.step[open]', chat).map(d => d.dataset.k))
        clear(chat)
        if (!t.msgs.length) chat.appendChild(h('div.note', { style: { padding: '8px 2px' } }, 'Each turn, Claude works through one tool: eval, running JavaScript in a QuickJS sandbox against this project (files, data, frames, pins, timeline). Changes land in a proposal you review, unless you pick Main.'))
        const sm = t.summary, early = sm && S.early[t.id]
        if (sm) chat.appendChild(summaryEl(t, early))
        t.msgs.forEach((m, i) => {
          if (sm && i < sm.upTo && !early) return
          const e = msgEl(m, i, t); $$('details.step', e).forEach((d, j) => { d.dataset.k = i + ':' + j; if (open.has(d.dataset.k)) d.open = true }); chat.appendChild(e)
          if (sm && early && i === sm.upTo - 1) chat.appendChild(h('div.sumcut', 'Claude sees the summary above instead of the messages before this line'))
        })
        if (atEnd) chat.scrollTop = chat.scrollHeight
      })
    }
    function paintChips() {
      clear(chips); const p = P(); if (!p) return
      if (App.sel && S.chips.sel) chips.appendChild(h('span.tag', 'Selected: ' + App.sel.tag + ' ' + (App.sel.src || ''), h('button', { title: 'Leave out', on: { click: () => { S.chips.sel = false; paintChips() } } }, '×')))
      const pins = (p.meta.pins || []).filter(x => !x.resolved).length
      if (pins) chips.appendChild(h('span.tag', plural(pins, 'open pin')))
      if (App.health()) chips.appendChild(h('span.tag', plural(App.health(), 'check issue')))
      const t = th(), vars = t && t.scope && t.scope.vars ? Object.keys(t.scope.vars) : [], lib = libEntries(p, App.ws)
      if (t && t.summary) chips.appendChild(h('button.tag', { title: 'Claude sees a summary of messages 1–' + t.summary.upTo + ' instead of the messages themselves', on: { click: () => { S.early[t.id] = false; paintChat(); chat.scrollTop = 0 } } }, 'Summary: 1–' + t.summary.upTo))
      if (vars.length) chips.appendChild(h('div.rel', { style: { display: 'inline-flex' } }, h('button.tag', { title: 'Variables Claude kept from earlier evals in this thread', on: { click: e => scopeMenu(e.currentTarget, t) } }, 'Scope: ' + (vars.length > 3 ? vars.slice(0, 3).join(', ') + ' +' + (vars.length - 3) : vars.join(', ')))))
      if (lib.length) chips.appendChild(h('div.rel', { style: { display: 'inline-flex' } }, h('button.tag', { title: 'Saved functions (.agent/lib)', on: { click: e => popMenu(e.currentTarget, [{ group: 'lib · .agent/lib/' }, ...lib.map(l => ({ label: 'lib.' + l.name + '(' + l.params.join(', ') + ')', sub: l.description, run: () => App.reveal(l.path, 1) }))]) } }, 'lib: ' + lib.length)))
    }
    function scopeMenu(btn, t) {
      const k = v => v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v === 'object' ? 'object{' + Object.keys(v).slice(0, 4).join(',') + '}' : typeof v === 'string' ? '"' + v.slice(0, 24) + '"' : String(v)
      popMenu(btn, [{ group: 'Kept between evals in "' + t.title + '"' }, ...Object.entries(t.scope.vars).map(([n, v]) => ({ label: n, sub: k(v) })),
        ...(t.scope.skipped || []).map(x => ({ label: x, sub: 'not kept', disabled: true })),
        { hr: true }, { label: 'Forget all', danger: true, run: () => { t.scope = null; Sandbox.drop(t.id); P().saveThread(t); paintChips(); toast('Cleared this thread\'s variables') } }])
    }
    function paintRow() {
      clear(row); const t = th(); if (!t) return
      const busy = Agent.busy(t.id)
      const seg = (vals, cur, set, title) => h('div.seg.sm', { title }, vals.map(([v, l]) => h('button' + (cur === v ? '.on' : ''), { on: { click: () => { set(v); P().saveThread(t); paintRow() } } }, l)))
      const model = h('select.sel', { title: 'Model tier, or a specific model', style: { height: '24px', fontSize: '11px' }, on: { change: () => { const v = model.value; if (v.startsWith('m:')) { t.model = v.slice(2); t.tier = 'default' } else { t.model = null; t.tier = v } P().saveThread(t) } } },
        MODELS.map(m => h('option', { value: m.v, selected: t.model ? m.v === 'm:' + t.model : m.v === (t.tier || 'default') }, m.label)))
      put(row, seg([['auto', 'Auto'], ['ask', 'Ask'], ['read', 'Read-only']], t.mode, v => { t.mode = v }, 'Auto runs evals; Ask asks before each; Read-only refuses writes'),
        t.mode !== 'read' ? seg([['overlay', 'Proposal'], ['main', 'Main']], t.target, v => { t.target = v }, 'Where file writes go') : null,
        model,
        busy ? h('button.btn.sm.danger', { style: { marginLeft: 'auto' }, on: { click: () => Agent.stop(t.id) } }, 'Stop') : h('button.btn.sm.primary', { style: { marginLeft: 'auto' }, disabled: !Agent.sample, on: { click: send } }, 'Send ↵'))
    }
    function paintNote() {
      clear(note)
      note.hidden = !Agent.ready || !!Agent.sample
      if (!note.hidden) note.append(h('b', 'Claude isn\'t available in this view.'), h('p.note', 'The agent uses this page\'s Claude access, which needs the published artifact opened while signed in. You can still drive the same API yourself in the Eval panel.'), h('div', h('button.btn.sm', { on: { click: () => Dock.open('evalrepl', 'agent') } }, 'Open Eval')))
    }
    async function send() {
      const t = th(), text = ta.value.trim(); if (!t || !text || Agent.busy(t.id)) return
      if (!S.chips.sel) { const keep = App.sel; App.sel = null; setTimeout(() => { App.sel = keep }, 0) }
      ta.value = ''; S.chips.sel = true
      Agent.send(P(), t, text).catch(e => toast(e.message))
      paintAll()
    }
    function paintAll() { paintStrip(); paintChat(); paintChips(); paintRow(); paintNote() }
    Agent.ev.on('turn', () => { paintStrip(); paintChat(); paintRow(); Dock.refreshTabs() })
    Agent.ev.on('step', paintChat); Agent.ev.on('text', paintChat); Agent.ev.on('ready', () => { paintNote(); paintRow() })
    App.ev.on('project', () => { S.tid = null; paintAll() })
    App.ev.on('sel', () => { S.chips.sel = true; paintChips() }); App.ev.on('pins', paintChips); App.ev.on('health', paintChips)
    App.ev.on('threads', paintStrip)
    App.ev.on('threads', () => { if (Dock.visible('agent')) paintChat() })
    App.agentView = { compose(text) { ta.value = text; ta.focus(); ta.setSelectionRange(text.length, text.length) }, paintAll, thread: th, open(tid) { S.tid = tid; paintAll() } }
    return { el, show: paintAll }
  }
})

// ---------- review: proposals with diffs; accept or reject; pins ----------
// rows a proposal adds, removes and changes in one table
function rowDiff(c) {
  const bm = new Map((c.before ? c.before.rows : []).map(r => [String(r.id), r])), am = new Map((c.after ? c.after.rows : []).map(r => [String(r.id), r]))
  const cell = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const lines = []
  for (const id of c.added) lines.push(h('div.rd.add', '+ #' + id + ' ' + Object.entries(am.get(id)).filter(([k]) => k !== 'id').map(([k, v]) => k + ': ' + cell(v)).join(', ')))
  for (const id of c.removed) lines.push(h('div.rd.del', '− #' + id + ' ' + Object.entries(bm.get(id)).filter(([k]) => k !== 'id').map(([k, v]) => k + ': ' + cell(v)).join(', ')))
  for (const id of c.changed) { const a = bm.get(id), b = am.get(id); lines.push(h('div.rd.chg', '~ #' + id + ' ' + [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => cell(a[k]) !== cell(b[k])).map(k => k + ': ' + cell(a[k]) + ' → ' + cell(b[k])).join(', '))) }
  if (c.created || c.dropped) lines.unshift(h('div.note', c.created ? 'New table with columns ' + c.after.cols.join(', ') : 'The proposal drops this table.'))
  return h('div.rowdiff', lines.slice(0, 60), lines.length > 60 ? h('div.note', '… ' + (lines.length - 60) + ' more') : null)
}
// a proposal's checks: layout against main on every board frame, and the scenarios run on both
const ReviewChecks = new Map()
function checksPanel(P, ov) {
  const st = ReviewChecks.get(ov.id) || {}, box = h('div.checks')
  const paintBox = () => {
    clear(box)
    box.append(h('div.toolbar.sub', h('b', 'Checks'), h('span.note', st.t ? 'as of ' + fmtAgo(st.t) : 'layout against main, and the scenarios on both'), h('span.sp'),
      h('button.btn.sm', { disabled: st.busy, on: { click: () => runChecks(P, ov, st, paintBox) } }, st.busy ? 'Checking…' : st.t ? 'Check again' : 'Check layout and scenarios')))
    if (st.layout) for (const f of st.layout) box.appendChild(h('div.lyt', h('div.lh', h('b', f.frame), h('span.note', f.lines.length ? plural(f.changes, 'change') : 'no layout changes'), h('span.sp'),
      f.lines.length ? h('button.link.note', { on: { click: () => App.canvas && App.canvas.compareWs(f.fid, 'main', ov.id) } }, 'compare frozen frames') : null),
      f.lines.length ? h('pre.mono.lines', f.lines.join('\n')) : null))
    if (st.scen) {
      if (!st.scen.length) box.appendChild(h('p.note', 'No scenarios yet: record one from a frame\'s ⋯ menu, or ask the agent (or a qa subagent) to write some.'))
      for (const r of st.scen) box.appendChild(h('div.sres' + (r.ok ? '.ok' : '.bad'), h('span', r.ok ? '✓' : '✗'), h('b', r.name),
        h('span.note', r.ok ? (r.main === false ? 'fixed by this proposal' : 'passes') : (r.main === true ? 'regression: passes in main' : 'fails') + ' · step ' + ((r.failedAt ?? -1) + 1) + ': ' + (r.error || ''))))
    }
  }
  paintBox(); return box
}
async function runChecks(P, ov, st, repaint) {
  st.busy = true; ReviewChecks.set(ov.id, st); repaint()
  try {
    const layout = []
    for (const f of P.board().frames) {
      try {
        const A = await layoutIn(P, f, 'main', { headless: true }), B = await layoutIn(P, f, ov.id, { headless: true }), d = layoutDiff(A.layout, B.layout)
        layout.push({ fid: f.id, frame: (f.label ? f.label + ' · ' : '') + A.fh.route + ' ' + f.w + 'px', changes: d.changes.length, lines: diffSummary(d, 14) })
      } catch (e) { layout.push({ fid: f.id, frame: f.route + ' ' + f.w + 'px', changes: 0, lines: ['could not load: ' + e.message] }) }
    }
    st.layout = layout
    const inOv = await runAllScenarios(P, { ws: ov.id, who: 'you' })
    const inMain = new Map((await runAllScenarios(P, { ws: 'main', who: 'you' })).map(r => [r.name, r.ok]))
    st.scen = inOv.map(r => ({ ...r, main: inMain.get(r.name) }))
    st.t = now()
  } finally { st.busy = false; repaint() }
}

registerView('review', {
  title: 'Review', sub: 'proposals and pins',
  badge: () => { const n = App.P ? App.P.openOverlays().filter(o => App.P.changes(o.id).length || App.P.tableChanges(o.id).length).length : 0; return n ? h('span.count', String(n)) : null },
  make() {
    const body = h('div.scroll'), el = h('div', body)
    const S = { picked: {}, shown: {} }
    function paint() {
      clear(body); const P = App.P; if (!P) return
      const open = P.openOverlays()
      body.appendChild(h('div.toolbar', h('b', 'Proposals'), h('span.note', 'workspaces on top of main; nothing lands until you accept'), h('span.sp'),
        h('button.btn.sm', { on: { click: () => { const ov = P.newOverlay({ title: 'My draft ' + (P.overlays.size + 1) }); App.setWs(ov.id) } } }, '+ Draft')))
      if (!open.length) body.appendChild(h('p.empty', 'No open proposals. Agent turns write into one by default; you can also start a draft and edit in it.'))
      for (const ov of open) {
        const ch = P.changes(ov.id), tch = P.tableChanges(ov.id), pick = S.picked[ov.id] = S.picked[ov.id] || {}
        for (const c of ch) if (!(c.path in pick)) pick[c.path] = true
        for (const c of tch) if (!(('table:' + c.name) in pick)) pick['table:' + c.name] = true
        const th = ov.thread && P.threads.get(ov.thread)
        const nf = ch.filter(c => pick[c.path]).length, nt = tch.filter(c => pick['table:' + c.name]).length, n = nf + nt, all = ch.length + tch.length
        const card = h('div.ovcard', h('header', h('h3', ov.title), h('span.tag.ws', ov.by === 'agent' ? 'agent' : 'you'), th ? h('span.note', th.title) : null, h('span.note', fmtAgo(ov.created)), h('span.sp'),
          h('button.btn.sm' + (App.ws === ov.id ? '.on' : ''), { on: { click: () => App.setWs(App.ws === ov.id ? 'main' : ov.id) } }, App.ws === ov.id ? 'Viewing' : 'View'),
          h('button.btn.sm', { disabled: !all, title: 'Main above, proposal below on the canvas', on: { click: () => { App.setWs(ov.id); App.compare(true) } } }, 'Compare'),
          h('button.btn.sm.primary', { disabled: !n, on: { click: () => { const k = P.accept(ov.id, ch.filter(c => pick[c.path]).map(c => c.path), 'you', tch.filter(c => pick['table:' + c.name]).map(c => c.name)); toast('Accepted ' + plural(k, 'change') + ' into main'); if (P.overlays.get(ov.id).status !== 'open' && App.ws === ov.id) App.setWs('main') } } }, 'Accept ' + (n === all ? 'all' : n)),
          h('button.btn.sm.danger', { on: { click: async () => { if (!all || await confirmBox('Reject "' + ov.title + '"?', 'Its ' + plural(all, 'change') + ' are discarded. The timeline keeps them.', 'Reject')) { P.reject(ov.id); if (App.ws === ov.id) App.setWs('main') } } } }, 'Reject')))
        const files = h('div.files')
        if (!all) files.appendChild(h('p.note', 'No changes yet.'))
        for (const c of ch) {
          const st = diffStat(c.before ?? '', c.after ?? ''), key = ov.id + c.path, shown = S.shown[key] ?? ch.length <= 3
          const cb = h('input', { type: 'checkbox', checked: pick[c.path], on: { change: () => { pick[c.path] = cb.checked; paint() } } })
          files.appendChild(h('div', h('label', cb, h('span', c.path), h('span.note', c.created ? 'new' : c.deleted ? 'deleted' : '+' + st.add + ' −' + st.del), c.conflict ? h('span.tag', { style: { color: 'var(--accent)', borderColor: 'var(--accent)' } }, 'main changed since') : null,
            h('span.sp'), h('button.link.note', { on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, shown ? 'hide diff' : 'show diff'), ' ', h('button.link.note', { on: { click: e => { e.preventDefault(); App.setWs(ov.id); App.reveal(c.path, 1) } } }, 'open')),
            shown ? diffView(c.before ?? '', c.after ?? '') : null))
        }
        for (const c of tch) {
          const key = ov.id + 'table:' + c.name, shown = S.shown[key] ?? (c.added.length + c.removed.length + c.changed.length) <= 6
          const cb = h('input', { type: 'checkbox', checked: pick['table:' + c.name], on: { change: () => { pick['table:' + c.name] = cb.checked; paint() } } })
          files.appendChild(h('div', h('label', cb, h('span', 'table ' + c.name), h('span.note', c.created ? 'new table, ' + plural(c.after.rows.length, 'row') : c.dropped ? 'dropped' : '+' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length + ' rows'),
            c.conflict ? h('span.tag', { title: 'Main\'s rows changed after the proposal copied the table; accepting replaces them', style: { color: 'var(--accent)', borderColor: 'var(--accent)' } }, 'main changed since') : null,
            h('span.sp'), h('button.link.note', { on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, shown ? 'hide rows' : 'show rows')),
            shown ? rowDiff(c) : null))
        }
        card.appendChild(files)
        if (all) card.appendChild(checksPanel(P, ov))
        body.appendChild(card)
      }
      const closed = [...P.overlays.values()].filter(o => o.status !== 'open' && o.status !== 'discarded').sort((a, b) => b.updated - a.updated).slice(0, 12)
      if (closed.length) { body.appendChild(h('div.toolbar', h('b', 'Closed'))); body.appendChild(h('div.rows', { style: { padding: '0 12px 8px' } }, closed.map(o => h('div', h('span', o.title), h('span.note', o.status), h('span.sp'), h('span.note', fmtAgo(o.updated)))))) }
      const pins = P.meta.pins || []
      body.appendChild(h('div.toolbar', h('b', 'Pins'), h('span.note', 'Comment mode: click a frame to pin a note'), h('span.sp'), h('span.note', pins.filter(p => !p.resolved).length + ' open')))
      body.appendChild(h('div.rows', { style: { padding: '0 12px 12px' } }, pins.length ? pins.slice().sort((a, b) => a.resolved - b.resolved || b.n - a.n).map(p => h('div', { style: { opacity: p.resolved ? 0.55 : 1 } },
        h('b', '#' + p.n), h('span', { style: { flex: 1 } }, p.text, p.reply ? h('div.note', '↳ ' + p.reply) : null), h('span.note', p.route),
        !p.resolved ? h('button.link.note', { on: { click: () => App.askAgent('Address pin #' + p.n + ' on ' + p.route + ' (' + (p.src || '') + '): ' + p.text) } }, 'ask agent') : null,
        h('button.link.note', { on: { click: () => { p.resolved = !p.resolved; P.saveMeta(); App.ev.emit('pins') } } }, p.resolved ? 'reopen' : 'resolve'))) : h('p.note', 'No pins.')))
    }
    const later = debounce(() => { if (Dock.visible('review')) paint(); Dock.refreshTabs() }, 150)
    App.ev.on('overlays', later); App.ev.on('files', later); App.ev.on('tables', later); App.ev.on('pins', later); App.ev.on('ws', later); App.ev.on('project', later)
    return { el, show: paint }
  }
})

// ---------- timeline: lanes of who did what, marks, files written when, diff and restore ----------
// mark kinds: who makes them and how they look
const MARK_STYLE = { bookmark: ['◆', 'var(--accent)', 'Bookmark'], milestone: ['◆', 'var(--a1)', 'Milestone'], decision: ['◆', 'var(--a2)', 'Decision'], question: ['?', 'var(--a4)', 'Question'], checkpoint: ['■', 'var(--ink)', 'Checkpoint'], auto: ['◇', 'var(--ink-2)', 'Automatic'] }
const markStyle = e => MARK_STYLE[e.mk || (e.who === 'agent' ? 'milestone' : 'bookmark')] || MARK_STYLE.bookmark
const STORY_KINDS = ['mark', 'msg', 'turn', 'accept', 'reject', 'delegate', 'scenario']
const KIND_STYLE = { scenario: 'var(--a4)', canvas: 'var(--ink-2)', delegate: 'var(--a2)', write: 'var(--ink)', remove: 'var(--accent)', eval: 'var(--a1)', turn: 'var(--a2)', msg: 'var(--ink-2)', accept: 'var(--good)', reject: 'var(--accent)', mark: 'var(--accent)', data: 'var(--a3)', pin: 'var(--a4)', overlay: 'var(--a1)', init: 'var(--ink-2)', note: 'var(--ink-2)' }
// thumbnails of snapshots; clicking one compares it with the same page now
function snapStrip(P, shots, title, hint) {
  const row = h('div.snapstrip')
  for (const s of shots.slice(0, 8)) {
    const cell = h('button.snap', { title: (s.label || s.route) + ' · ' + s.w + 'px · ' + fmtTime(s.t) + (hint ? '\n' + hint : '') , on: { click: () => compareSnapNow(P, s) } }, h('div.ph', { style: { width: s.w * 0.2 + 'px', height: s.h * 0.2 + 'px' } }), h('span.note', s.route + ' ' + s.w))
    row.appendChild(cell)
    Snaps.load(P, s.id).then(async doc => { if (!doc) return; const fz = await Snaps.frozen(P, doc, s, { scale: 0.2 }); const ph = cell.querySelector('.ph'); if (ph) ph.replaceWith(fz) })
  }
  return h('div', h('div.note', { style: { margin: '8px 0 4px' } }, title), row)
}
async function compareSnapNow(P, s) {
  const doc = await Snaps.load(P, s.id); if (!doc) return toast('That snapshot is gone')
  const fr = P.board().frames.find(f => f.w === s.w && f.route === s.route) || { id: null, route: s.route, w: s.w, h: s.h }
  const live = await (s.fixture ? Headless.get(P, s.route, s.ws === 'main' || (P.overlays.get(s.ws) || {}).status === 'open' ? s.ws : 'main', s.w, s.h, s.fixture) : layoutIn(P, fr, s.ws === 'main' || (P.overlays.get(s.ws) || {}).status === 'open' ? s.ws : 'main').then(x => x.fh))
  const cur = await Snaps.capture(live)
  compareModal(P, s.route + ' ' + s.w + 'px: ' + (s.label || fmtTime(s.t)) + ' → now', { label: (s.label || '') + ' ' + fmtTime(s.t), doc, meta: s }, { label: 'now', doc: cur, meta: cur }, layoutDiff(doc.layout, cur.layout))
}

registerView('timeline', {
  title: 'Timeline', sub: 'session history',
  make() {
    const S = { kind: 'all', path: null, sel: null }
    const svgWrap = h('div', { style: { overflowX: 'auto', borderBottom: '1px solid var(--hair)', flex: 'none' } }), story = h('div.story'), side = h('div.tlside')
    const bar = h('div.toolbar')
    const el = h('div', bar, h('div.tl', h('div.tlmain', svgWrap, story), side))
    const P = () => App.P
    const filt = e => (S.kind === 'all' || (S.kind === 'files' && (e.kind === 'write' || e.kind === 'remove' || e.kind === 'accept')) || (S.kind === 'agent' && e.who === 'agent') || (S.kind === 'story' && STORY_KINDS.includes(e.kind))) && (!S.path || e.path === S.path || (e.paths || []).includes(S.path))
    const laneOf = e => e.kind === 'mark' ? 'marks' : e.who === 'agent' ? 'agent:' + (e.thread || '?') : e.who === 'site' ? 'site' : 'you'
    const label = e => e.kind === 'write' ? (e.created ? 'created ' : 'wrote ') + e.path + (e.ws !== 'main' ? ' (proposal)' : '') : e.kind === 'remove' ? 'removed ' + e.path : e.kind === 'mark' ? e.label + (e.mk && e.mk !== 'bookmark' && e.mk !== 'milestone' ? ' (' + e.mk + ')' : '') : e.kind === 'eval' ? 'eval: ' + (e.calls && e.calls.length ? e.calls.join(', ') : e.note) : e.kind === 'turn' ? 'reply: ' + (e.note || '') : e.kind === 'msg' ? 'asked: ' + e.note : e.kind === 'data' ? e.table + ' ' + e.note : (e.kind + (e.note ? ': ' + e.note : ''))
    function paintBar() {
      clear(bar)
      put(bar, h('div.seg.sm', [['all', 'All'], ['files', 'Files'], ['agent', 'Agent'], ['story', 'Story']].map(([k, l]) => h('button' + (S.kind === k ? '.on' : ''), { on: { click: () => { S.kind = k; paint() } } }, l))),
        S.path ? h('span.tag', S.path, h('button', { style: { background: 'none', border: 0 }, on: { click: () => { S.path = null; paint() } } }, '×')) : null, h('span.sp'),
        h('span.note', P() ? plural(P().events.length, 'event') : ''),
        App.playhead != null ? [h('button.btn.sm', { title: 'Step through every change to the pages up to now', on: { click: togglePlay } }, S.playing ? '■ Stop' : '▶ Play'), h('button.btn.sm.primary', { title: 'The canvas shows the pages as they are now', on: { click: () => { stopPlay(); App.setPlayhead(null) } } }, 'Now')]
          : h('button.btn.sm', { title: 'Show the pages on the canvas as they were at a point in time; drag the line along the timeline', on: { click: () => { const p = P(), pe = App.pageEvents(p); App.setPlayhead(S.sel != null ? S.sel : pe.length > 1 ? pe[pe.length - 2].i : 0) } } }, 'Playhead'),
        h('button.btn.sm', { on: { click: () => App.addMark() } }, '+ Mark'))
    }
    function stopPlay() { clearInterval(S.playT); S.playing = false }
    function togglePlay() {
      if (S.playing) { stopPlay(); paintBar(); return }
      S.playing = true; paintBar()
      S.playT = setInterval(() => { const p = P(), nx = p && App.pageEvents(p).find(x => x.i > App.playhead); if (!nx) { stopPlay(); paintBar(); return } App.setPlayhead(nx.i) }, 900)
    }
    function paintLanes() {
      clear(svgWrap); const p = P(); if (!p) return
      const evs = p.events.filter(filt), lanes = ['you']
      for (const e of evs) { const l = laneOf(e); if (!lanes.includes(l)) lanes.push(l) }
      if (lanes.includes('marks')) { lanes.splice(lanes.indexOf('marks'), 1); lanes.push('marks') }
      const LW = 110, DX = 14, W = Math.max(400, LW + evs.length * DX + 40), H = 26 + lanes.length * 26 + 10
      const svg = svgEl('svg', { class: 'tlsvg', width: W, height: H })
      lanes.forEach((l, i) => {
        const y = 26 + i * 26 + 13, th = l.startsWith('agent:') ? p.threads.get(l.slice(6)) : null
        svg.appendChild(svgEl('line', { x1: LW, x2: W - 10, y1: y, y2: y, stroke: 'var(--rule)' }))
        svg.appendChild(svgEl('text', { x: 10, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)', text: l === 'you' ? 'You' : l === 'site' ? 'Pages' : l === 'marks' ? 'Marks' : 'Claude · ' + ((th && th.role) || (th && th.title) || 'thread').slice(0, 12) }))
      })
      let lastDay = '', lastLabel = -1e9
      evs.forEach((e, k) => {
        const x = LW + 10 + k * DX, y = 26 + lanes.indexOf(laneOf(e)) * 26 + 13
        const tm = fmtTime(e.t).slice(0, 5); if (k % 12 === 0 && tm !== lastDay) { lastDay = tm; svg.appendChild(svgEl('text', { x, y: 12, 'font-size': 9.5, fill: 'var(--ink-2)', text: tm })) }
        if (e.kind === 'mark' && e.mk !== 'auto') {
          const mc = markStyle(e)[1]
          svg.appendChild(svgEl('line', { x1: x, x2: x, y1: 16, y2: H - 4, stroke: mc, 'stroke-dasharray': '3 3', opacity: 0.7 }))
          if (x - lastLabel > 96) { svg.appendChild(svgEl('text', { x: x + 3, y: 22, 'font-size': 9.5, fill: mc, text: e.label.slice(0, 16) })); lastLabel = x }
        }
        const c = e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)', on = S.sel === e.i
        const shape = e.kind === 'mark' ? (e.mk === 'auto' ? svgEl('path', { d: `M${x},${y - 4} L${x + 4},${y} L${x},${y + 4} L${x - 4},${y} z`, fill: 'var(--bg)', stroke: c, 'stroke-width': 1.2 }) : e.mk === 'checkpoint' ? svgEl('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: c }) : svgEl('path', { d: `M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} z`, fill: c })) : svgEl('circle', { cx: x, cy: y, r: on ? 6 : 4.5, fill: e.kind === 'msg' || e.ws !== 'main' && e.kind === 'write' ? 'var(--bg)' : c, stroke: c, 'stroke-width': 1.5 })
        const g = svgEl('g', { style: 'cursor:pointer' }, svgEl('title', { text: fmtTime(e.t) + ' ' + label(e) }), shape)
        if (on) g.appendChild(svgEl('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: 'var(--ink)' }))
        g.addEventListener('click', () => { S.sel = e.i; paint() })
        svg.appendChild(g)
      })
      // the playhead: a line at the last shown event at or before it; drag it (or click the time strip) to move it
      const xOf = k => LW + 10 + k * DX
      if (App.playhead != null) {
        let k = -1; evs.forEach((e, j) => { if (e.i <= App.playhead) k = j })
        const x = k < 0 ? LW : xOf(k)
        svg.append(svgEl('line', { x1: x, x2: x, y1: 14, y2: H - 2, class: 'ph-line' }), svgEl('rect', { x: x - 5, y: 2, width: 10, height: 12, class: 'ph-knob' }))
      }
      const strip = svgEl('rect', { x: LW, y: 0, width: W - LW, height: 16, fill: 'transparent', style: 'cursor:ew-resize' })
      strip.appendChild(svgEl('title', { text: 'Drag to move the playhead: the canvas shows the pages as they were' }))
      const at = ev => { const r = svg.getBoundingClientRect(), k = clamp(Math.round((ev.clientX - r.left - LW - 10) / DX), 0, evs.length - 1); if (evs[k]) { S.sel = evs[k].i; App.setPlayhead(evs[k].i) } }
      strip.addEventListener('pointerdown', ev => { ev.preventDefault(); strip.setPointerCapture(ev.pointerId); stopPlay(); at(ev); const mv = e2 => at(e2), up = () => { strip.removeEventListener('pointermove', mv); strip.removeEventListener('pointerup', up) }; strip.addEventListener('pointermove', mv); strip.addEventListener('pointerup', up) })
      svg.appendChild(strip)
      const keep = App.playhead != null && S.scrolled != null ? svgWrap.scrollLeft : null
      svgWrap.appendChild(svg)
      if (keep != null) svgWrap.scrollLeft = keep
      else svgWrap.scrollLeft = svgWrap.scrollWidth
      S.scrolled = true
    }
    function paintStory() {
      clear(story); const p = P(); if (!p) return
      const evs = p.events.filter(filt).slice(-300)
      if (!evs.length) story.appendChild(h('p.empty', 'Nothing yet.'))
      for (const e of evs) {
        const b = h('button', { style: S.sel === e.i ? { background: 'var(--sel)' } : null, on: { click: () => { S.sel = e.i; paint() } } },
          h('span', { style: { color: e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)' } }, e.kind === 'mark' ? markStyle(e)[0] : '●'), h('span.t', fmtTime(e.t)), h('span', label(e), e.who === 'agent' ? h('span.note', ' · Claude') : null))
        story.appendChild(b)
      }
      const selB = story.querySelector('[style*="var(--sel)"]'); if (selB) selB.scrollIntoView({ block: 'nearest' })
    }
    function before(p, e) {
      for (let j = e.i - 1; j >= 0; j--) { const x = p.events[j]; if (x.path === e.path && x.ws === e.ws && x.kind === 'write') return x.after; if (x.path === e.path && x.ws === e.ws && x.kind === 'remove') return null }
      const st = p.stateAt(e.i - 1); return st.has(e.path) ? st.get(e.path) : null
    }
    function paintSide() {
      clear(side); const p = P(); if (!p) return
      const e = S.sel != null ? p.events[S.sel] : null
      if (e) {
        const blk = h('div.block', h('header', h('h3', e.kind), h('span.sub', new Date(e.t).toLocaleString())),
          h('dl.kv', h('dt', 'Who'), h('dd', e.who === 'agent' ? 'Claude' + ((p.threads.get(e.thread) || {}).title ? ' · ' + p.threads.get(e.thread).title : '') : e.who === 'site' ? 'a page' : e.who === 'ide' ? 'Sitebench' : 'You'),
            h('dt', 'Where'), h('dd', e.ws === 'main' ? 'main' : 'proposal "' + ((p.overlays.get(e.ws) || {}).title || '?') + '"'),
            e.path ? [h('dt', 'File'), h('dd', h('button.link', { on: { click: () => { S.path = e.path; paint() } } }, e.path))] : null,
            e.note || e.label ? [h('dt', 'Note'), h('dd', e.label || e.note)] : null))
        const acts = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } })
        if (e.path && (e.kind === 'write' || e.kind === 'remove')) acts.appendChild(h('button.btn.sm.primary', { title: 'Open the file as it was right after this event', on: { click: () => { if (e.ws !== App.ws && e.ws !== 'main' && (p.overlays.get(e.ws) || {}).status === 'open') App.setWs(e.ws); App.viewVersion(e.path, e.i) } } }, 'View this version'))
        if (e.path && p.read(e.path, e.ws === 'main' || (p.overlays.get(e.ws) || {}).status === 'open' ? e.ws : 'main') !== null) acts.appendChild(h('button.btn.sm', { on: { click: () => { if (e.ws !== App.ws && (e.ws === 'main' || (p.overlays.get(e.ws) || {}).status === 'open')) App.setWs(e.ws); App.reveal(e.path, 1) } } }, 'Open current'))
        if (e.thread && p.threads.get(e.thread)) acts.appendChild(h('button.btn.sm', { on: { click: () => { App.showThread(e.thread) } } }, 'Open thread'))
        acts.appendChild(h('button.btn.sm', { title: 'The canvas shows the pages as they were just after this event', on: { click: () => App.setPlayhead(e.i) } }, App.playhead === e.i ? 'On the canvas' : 'Show on canvas'))
        acts.appendChild(h('button.btn.sm', { on: { click: () => showSince(e.i) } }, 'Diff since'))
        acts.appendChild(h('button.btn.sm.danger', { on: { click: async () => { const n = p.since(e.i).length; if (!n) return toast('Main is already as it was then'); if (await confirmBox('Restore main to this point?', plural(n, 'file') + ' go back to how they were just after this event. That is logged too, so you can return.', 'Restore')) toast('Restored ' + plural(p.restore(e.i), 'file')) } } }, 'Restore'))
        blk.appendChild(acts)
        const shots = Snaps.list(p).filter(s => s.events.includes(e.i))
        if (shots.length) blk.appendChild(snapStrip(p, shots, 'Frames at this point', 'Click one to compare it with the page now'))
        if (e.kind === 'write') blk.appendChild(diffView(before(p, e) ?? '', e.after ?? ''))
        side.appendChild(blk)
      }
      const marks = p.marks()
      side.appendChild(h('div.block', h('header', h('h3', 'Marks'), h('span.sub', 'yours and Claude\'s')),
        marks.length ? h('div.rows', marks.slice().reverse().map(m => h('button', { on: { click: () => { S.sel = m.i; paint() } } }, h('span', { style: { color: markStyle(m)[1] } }, markStyle(m)[0]), h('span', { style: { flex: 1 } }, m.label, m.note ? h('div.note', m.note) : null), h('span.note', markStyle(m)[2] + ' · ' + (m.who === 'agent' ? 'Claude · ' : m.who === 'ide' ? '' : 'you · ') + fmtTime(m.t))))) : h('p.note', 'Add one with + Mark; Claude marks milestones, decisions and guesses with session.mark().')))
      const files = new Map()
      for (const x of p.events) if ((x.kind === 'write' || x.kind === 'remove') && x.path) { const f = files.get(x.path) || { n: 0, t: 0, agent: 0 }; f.n++; f.t = x.t; if (x.who === 'agent') f.agent++; files.set(x.path, f) }
      side.appendChild(h('div.block', h('header', h('h3', 'Files written'), h('span.sub', 'click to filter')),
        h('div.rows', [...files].sort((a, b) => b[1].t - a[1].t).map(([path, f]) => h('button' + (S.path === path ? '.on' : ''), { on: { click: () => { S.path = S.path === path ? null : path; S.kind = 'all'; paint() } } }, h('span.mono', { style: { flex: 1, fontSize: '11.5px' } }, path), h('span.note', f.n + '×' + (f.agent ? ' (' + f.agent + ' Claude)' : '')), h('span.note', fmtTime(f.t)))))))
    }
    function showSince(i) {
      const p = P(), ch = p.since(i), e = p.events[i]
      modal({ title: 'Main since ' + fmtTime(e.t) + ' · ' + label(e).slice(0, 40), wide: true, body: ch.length ? ch.map(c => h('div', h('b.mono', c.path), ' ', h('span.note', c.before === null ? 'new' : c.after === null ? 'deleted' : ''), diffView(c.before ?? '', c.after ?? ''))) : h('p', 'No changes in main since then.'),
        actions: [{ label: 'Close' }] })
    }
    function paint() { paintBar(); paintLanes(); paintStory(); paintSide() }
    const later = debounce(() => { if (Dock.visible('timeline')) paint() }, 200)
    App.ev.on('events', later); App.ev.on('project', () => { S.sel = null; S.path = null; clearInterval(S.playT); S.playing = false; later() })
    App.ev.on('playhead', () => { if (App.playhead == null) { clearInterval(S.playT); S.playing = false } else S.sel = App.playhead; if (Dock.visible('timeline')) { paintBar(); paintLanes(); paintSide() } })
    App.timeline = { select(i) { S.sel = i; S.kind = 'all'; S.path = null; paint() } }
    // arrow keys step the playhead through changes to the pages
    el.tabIndex = -1
    el.addEventListener('keydown', ev => {
      if (App.playhead == null || !/^Arrow(Left|Right)$/.test(ev.key) || ev.target.closest('input, textarea, select')) return
      ev.preventDefault(); const list = App.pageEvents(P()), j = ev.key === 'ArrowLeft' ? [...list].reverse().find(x => x.i < App.playhead) : list.find(x => x.i > App.playhead)
      if (j) App.setPlayhead(j.i); else if (ev.key === 'ArrowRight') App.setPlayhead(null)
    })
    App.ev.on('version', v => { if (v && S.sel !== v.i) { S.sel = v.i; later() } })
    App.timeline = { focus: (i, path) => { S.sel = i; if (path) S.path = path; Dock.open('timeline'); paint() } }
    return { el, show: paint }
  }
})
