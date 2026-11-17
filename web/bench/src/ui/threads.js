// ui/threads.js — the Agent view: threads with Claude, each reply with its
// evals (code, result, effects), panels and approval cards; the composer
// with the thread's mode (auto, ask, read-only), where its commits go
// (a proposal of its own, or draft) and its model.
//
// A thread's messages load from the bench actor the first time it is
// shown. The running summary of a long thread is shown, editable.
//
// Public API: THREADS (a view); App.agentView = {compose, open, thread,
// paintAll}.
import { $$, clear, confirmBox, h, modal, popMenu, promptBox, put, toast } from '../lib/dom.js';
import { Agent } from '../agent/agent.js';
import { App } from './app.js';
import { Dock } from './dock.js';
import { Panels, panelEl } from './panels.js';
import { Sandbox } from '../agent/sandbox.js';
import { effectsLine } from '../agent/effects.js';
import { fmtAgo, fmtTime, now, plural } from '../lib/util.js';
import { hlJS, hlYAML, renderMarkdown } from '../lib/text.js';
import { libEntries } from '../agent/api/lib.js';
import { saveFile, slug, transcriptMd } from './archive.js';

// "Working for 2 min 5 s: writing its next step (3 steps done)"; refreshed every second
function elapsedText(since, steps, note) {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  const d = s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'
  const what = note || (steps ? 'writing its next step (' + plural(steps, 'step') + ' done)' : 'reading your app and planning')
  return 'Working for ' + d + ': ' + what + (s >= 240 ? '. A long one: you can Stop it and ask for a smaller step.' : '.')
}
setInterval(() => { for (const e of document.querySelectorAll('.elapsed')) e.textContent = elapsedText(+e.dataset.since, +e.dataset.steps, e.dataset.note) }, 1000)

const MODELS = [
  { v: 'quick', label: 'Quick' }, { v: 'default', label: 'Default' }, { v: 'complex', label: 'Complex' },
  { v: 'm:claude-haiku-5-5', label: 'Haiku 5.5' }, { v: 'm:claude-sonnet-5-5', label: 'Sonnet 5.5' }, { v: 'm:claude-opus-5-5', label: 'Opus 5.5' }
]
export const THREADS = {
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
        { label: 'Download transcript', sub: 'Markdown, with every eval', disabled: !t.msgs || !t.msgs.length, run: () => saveFile(slug(P().app) + '-' + slug(t.title) + '.md', transcriptMd(P(), t)) },
        ...(() => { const kids = [...P().threads.values()].filter(x => x.parent).sort((a, b) => b.created - a.created).slice(0, 12); return kids.length ? [{ group: 'Subagent threads' }, ...kids.map(k => ({ label: '↳ ' + k.title, sub: (Agent.busy(k.id) ? 'working · ' : '') + fmtAgo(k.created), run: () => { S.tid = k.id; paintAll() } })), { hr: true }] : [] })(),
        { group: 'Context' },
        { label: 'Summarize earlier messages now', sub: t.summary ? 'messages 1–' + t.summary.upTo + ' are summarized' : 'happens on its own when the thread gets long', disabled: !t.msgs || Agent.busy(t.id) || t.msgs.length - (t.summary ? t.summary.upTo : 0) < 4, run: () => compactNow(t) },
        t.summary ? { label: 'Edit the summary…', run: () => editSummary(t) } : null,
        t.summary ? { label: 'Forget the summary', sub: 'Claude sees the full history again (as much as fits)', run: () => { t.summary = null; P().saveThread(t); paintChat(); paintChips() } } : null,
        { hr: true },
        { label: 'Download as JSON', disabled: !t.msgs || !t.msgs.length, run: () => saveFile(slug(P().app) + '-' + slug(t.title) + '.json', JSON.stringify({ ...t, saved: undefined }, null, 1)) },
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
      if (s.children && s.children.length) d.appendChild(h('div.kids', s.children.map(c => { const ct = P().threads.get(c.thread); const last = ct && ct.msgs && [...ct.msgs].reverse().find(m => m.role === 'agent')
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
        renderMarkdown(sm.text, f => P().read(f, 'draft') !== null))
    }
    function editSummary(t) {
      const ta = h('textarea.mono', { style: { width: '100%', minHeight: '260px', fontSize: '12px' } }); ta.value = t.summary.text
      modal({ title: 'What Claude remembers of messages 1–' + t.summary.upTo, wide: true, body: [h('p.note', 'Claude reads this instead of the older messages. Fix anything wrong or missing; it can still look up the originals with session.recall.'), ta],
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: () => { t.summary = { ...t.summary, text: ta.value.trim(), by: 'you', t: now() }; P().saveThread(t); P().log({ kind: 'compact', who: 'you', thread: t.id, note: 'edited the summary of "' + t.title + '"' }); paintChat() } }] })
    }
    async function compactNow(t) {
      toast('Summarizing…')
      try { const r = await Agent.compact(P(), t, { force: true }); toast(r ? 'Summarized messages 1–' + r.upTo : 'Too short to summarize') } catch (e) { toast('Could not summarize: ' + e.message) }
      paintChat(); paintChips()
    }
    async function acceptProp(prop) {
      const r = await P().accept(prop.ref, null, 'you').catch(e => ({ status: 'failed', error: e.message }))
      if (r.status === 'committed') { toast('Accepted "' + prop.title + '": the changes are in your draft now (test data you entered in its preview stays behind)', 6000); if (App.ws === prop.ref) App.setWs('draft') }
      else if (r.status === 'conflict') toast('Not accepted: the draft also changed ' + r.conflicts.join(', ') + '. Open Review to sort it out.', 8000)
      else toast('Not accepted: ' + (r.error || r.status), 6000)
      paintChat()
    }
    function msgEl(m, i, t) {
      if (m.role === 'user') return h('div.msg.user', h('div.who', m.from ? 'From the ' + m.from : 'You', h('span', fmtTime(m.t)), m.ctx && m.ctx.sel ? h('span.tag', m.ctx.sel.tag + ' ' + m.ctx.sel.src) : null), h('div.body', m.text))
      const prop = m.ws && m.ws !== 'draft' ? P().proposals.get(m.ws) : null
      return h('div.msg.agent',
        h('div.who', 'Claude', h('span', fmtTime(m.t)), m.model ? h('span', m.model) : null, m.status === 'running' ? h('span.dot.busy') : null, h('span.sp'),
          h('button.link.note', { title: 'Bookmark this reply on the timeline', on: { click: () => { P().mark({ label: (m.text || 'reply').split('\n')[0].slice(0, 40), by: 'you', thread: t.id }); toast('Marked on the timeline') } } }, '☆ mark')),
        (m.steps || []).map(stepEl),
        (m.panels || []).map(id => { const pn = Panels.get(P(), id); return pn ? panelEl(P(), pn, { inline: true }) : null }),
        m.auto ? h('div.note', 'Claude ended without a reply; the bench says what happened:') : null,
        m.text ? renderMarkdown(m.text, file => P().read(file, 'draft') !== null || (!!prop && prop.status === 'open' && P().read(file, m.ws) !== null)) : null,
        // a running turn says how long and what it is doing (persona reviews: 9-13 minute turns showed only "Working")
        m.status === 'running' ? h('div.note.elapsed', { 'data-since': String(m.t || Date.now()), 'data-steps': String((m.steps || []).length), 'data-note': m.note || '' }, elapsedText(m.t || Date.now(), (m.steps || []).length, m.note)) : null,
        m.error ? h('div.note', { style: { color: 'var(--accent)' } }, m.error) : null,
        m.approval ? h('div.approval', h('b', m.approval.title), m.approval.detail ? h('pre', m.approval.detail) : null,
          h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm.primary', { on: { click: () => m.approval && m.approval.decide(true) } }, 'Approve'), h('button.btn.sm', { on: { click: () => m.approval && m.approval.decide(false) } }, 'Decline'))) : null,
        prop ? h('div.ctx', prop.status === 'open'
          ? [h('span.tag.ws', 'proposal'), ' ', m.summary || 'working in "' + prop.title + '"',
            m.summary && m.status !== 'running' ? h('div.note', 'These changes are in a proposal: a copy of your app. Your app does not change until you accept them. What you type into its preview stays with the preview: accepting takes the changes, not that test data.') : null,
            // real buttons, Accept first and filled: as grey links at the foot of a reply they were missed (round 3)
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
              m.summary && m.status !== 'running' ? h('button.btn.sm.primary', { title: 'Take these changes into your app', on: { click: () => acceptProp(prop) } }, 'Accept the changes') : null,
              h('button.btn.sm', { on: { click: () => { App.setWs(prop.ref); Dock.open('review') } } }, 'Review them'),
              App.ws !== prop.ref ? h('button.btn.sm', { on: { click: () => App.setWs(prop.ref) } }, 'Show it') : null)]
          // a proposal closed because the turn changed nothing: its title is the person's message, so
          // '"…" was discarded' read as "your message was discarded" (a persona review found it)
          : prop.status === 'discarded' ? h('span.note', 'Nothing in the app changed in this turn.')
          : h('span', 'The proposal "' + prop.title + '" was ' + prop.status + '.')) : null)
    }
    let raf = 0
    function paintChat() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0; const t = th(); if (!t) return
        if (!t.msgs) { clear(chat).appendChild(h('div.note', { style: { padding: '8px 2px' } }, 'Loading…')); P().loadThread(t.id).then(() => paintAll(), e => toast('Could not load the thread: ' + e.message)); return }
        const atEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60
        const open = new Set($$('details.step[open]', chat).map(d => d.dataset.k))
        clear(chat)
        if (!t.msgs.length) chat.appendChild(h('div.note', { style: { padding: '8px 2px' } }, 'Each turn, Claude works through one tool: eval, JavaScript run in a QuickJS sandbox against this app (files, instances, frames, scenarios, pins, timeline), each eval one commit. Changes land in a proposal you review, unless you pick Draft.'))
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
      const t = th(), vars = t && t.scope && t.scope.vars ? Object.keys(t.scope.vars) : [], lib = libEntries(p.view(App.ws))
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
        t.mode !== 'read' && t.mode !== 'tests' ? seg([['proposal', 'Proposal'], ['draft', 'Draft']], t.target, v => { t.target = v }, 'Where the agent\'s commits go: a proposal of its own, or draft directly') : null,
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
}

