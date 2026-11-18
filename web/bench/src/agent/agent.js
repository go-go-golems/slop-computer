// agent/agent.js — the agent: a model turn per message, the eval tool in a
// loop; subagents; what the model sees of a thread.
//
// A turn picks the thread's workspace (draft, or a proposal of its own when
// the thread works in proposals), builds an eval context (agent/eval.js) and
// lets the model call eval until it answers. Each eval is a transaction; a
// subagent working in the caller's workspace runs its evals inside the
// caller's, so its changes land with the caller's commit. A long thread's
// older messages are folded into a running summary (compact).
//
// Owns: turns in flight. Public API: Agent (init, send, stop, delegate,
// busy, anyBusy, compact, sample, ev 'ready' | 'turn' | 'step' | 'text').
import { AgentUI, makeContext, runEval } from './eval.js';
import { FAKED_EVAL, fitPrompt } from './hints.js';
import { FrameHost, FrameHosts } from '../frames/host.js';
import { MAX_DEPTH, ROLES } from './roles.js';
import { Types } from './types.js';
import { Watch } from '../server/instances.js';
import { diffText, parseJSONReply, toYAML } from '../lib/text.js';
import { effectsLine, scopeSummary } from './effects.js';
import { emitter, now, plural, trunc } from '../lib/util.js';
import { guide } from './guide.js';
import { libEntries } from './api/lib.js';

const BUDGET = 30
// evals one model call can run: the server's tool rounds for a page's sample call (pkg/llm/request.go,
// MaxRounds 10), less the last round, which offers no tools; and how often a turn continues a full call
const CALL_EVALS = 9, MAX_CONTINUES = 2
const firstLine = code => (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90)

export const Agent = {
  sample: null, ready: false, ev: emitter(), turns: new Map(),
  async init() {
    try { if (window.claude && window.claude.use) this.sample = await window.claude.use('sample') } catch { this.sample = null }
    this.ready = true; this.ev.emit('ready')
  },
  busy(tid) { return this.turns.has(tid) },
  anyBusy() { return this.turns.size > 0 },

  // ---- what the model sees: the state of the project, then the thread ----
  context(P, ws, th) {
    const view = P.view(ws), st = Watch.status || {}
    const files = view.list().map(p => { const t = view.read(p); return p + (t === null ? ' (kept by hash)' : ' (' + t.split('\n').length + ' lines)') }).join(', ')
    const inst = [...['dev', 'test'].filter(k => st[k]).map(k => [k, st[k]]), ...(st.props || []).map(s => ['prop', s])]
      .map(([k, s]) => k + ' ' + s.ref + ' @' + s.n + (s.broken ? ' BROKEN: ' + s.broken.slice(0, 160) : '')).join('; ') || 'none yet'
    const frames = P.board().frames.map(f => {
      const v = FrameHost.ui.hostFor(f.id)
      return f.id + (f.label ? ' "' + f.label + '"' : '') + ' ' + (v ? v.route : f.route) + ' ' + f.w + 'x' + f.h + ' at ' + f.x + ',' + f.y + (v && v.errors ? ' ' + v.errors + ' errors' : '') + (v && v.issues.length ? ' ' + v.issues.length + ' issues' : '')
    }).join('; ')
    const s = AgentUI.selection()
    const sel = s ? s.tag + (s.id ? '#' + s.id : '') + (s.cls ? '.' + s.cls.split(' ').join('.') : '') + ' at ' + s.src + ' in ' + s.route + (s.text ? ' "' + s.text.slice(0, 60) + '"' : '') : 'nothing'
    const pins = (P.meta.pins || []).filter(p => !p.resolved).map(p => '#' + p.n + ' on ' + p.route + ' @' + (p.src || '?') + ': ' + p.text).join('\n') || 'none'
    const issues = []
    for (const fh of FrameHosts) if (!fh.headless && fh.project === P) for (const i of fh.issues) issues.push(fh.route + ' ' + fh.w + 'px: ' + i.message + (i.src ? ' @' + i.src : ''))
    const props = P.openProposals().map(p => p.ref + ' "' + p.title + '"').join('; ') || 'none'
    const where = ws === 'draft' ? 'draft ' + P.draftOf(ws).head : 'proposal ' + ws + ' "' + (P.proposals.get(ws) || {}).title + '" at ' + P.draftOf(ws).head
    // the person's own date and zone: an eval's new Date() prints UTC, and a persona near midnight
    // was told "today is 17 November" while the app printed the 16th (round 3)
    const d = new Date(), tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return '' } })()
    const when = 'The person\'s local time: ' + d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + (tz ? ' (' + tz + ')' : '') + '; dates you tell them use this, not UTC.\n'
    return when + 'App "' + P.title + '" (' + P.app + '). Your writes go to ' + where + '; main is ' + (P.refs.main ?? 'not published yet') +
      '.\nFiles: ' + files + '\nInstances: ' + inst + '\nFrames: ' + frames + '\nOpen proposals: ' + props + '\nSelected: ' + sel + '\nOpen pins:\n' + pins +
      '\nCurrent check issues: ' + (issues.slice(0, 8).join('; ') || 'none') +
      '\nSaved lib functions: ' + (libEntries(view).map(l => 'lib.' + l.name + '(' + l.params.join(', ') + ')' + (l.description ? ' — ' + l.description : '')).join('; ') || 'none') +
      '\nYour variables from earlier evals: ' + (th && th.scope ? (scopeSummary(th.scope) || 'none') + (th.scope.skipped && th.scope.skipped.length ? ' (not kept: ' + th.scope.skipped.join(', ') + ')' : '') : 'none')
  },
  HIST_CHARS: 28000, KEEP_CHARS: 12000, KEEP_MIN: 4, MAX_MSGS: 30,
  // one message as history; detail adds a line per eval (what it ran, how it went, what it changed)
  renderMsg(m, detail) {
    if (m.role === 'user') return (m.from ? '(from the ' + m.from + ') ' : '') + (m.text || '')
    const steps = m.steps || [], wrote = [...new Set(steps.flatMap(s => (s.calls || []).filter(c => /write|replace|remove|copy|save|seed|reset/.test(c))))]
    // a past reply that wrote evals as text (from before FAKED_EVAL was caught) would teach the model to do
    // it again (a thread in round 4 did it twice in a row): the history says what it was instead
    if (!steps.length && FAKED_EVAL.test(m.text || '')) return '(this reply wrote eval code as text; none of it ran, and what it reported did not happen)'
    const t = m.text || (m.error ? '(failed: ' + m.error + ')' : '(no reply)')
    if (!steps.length) return t
    if (!detail) return t + '\n[' + plural(steps.length, 'eval') + (wrote.length ? ', used ' + wrote.join(', ') : '') + ']'
    return t + '\n[evals: ' + steps.map((s, k) => '\n  ' + (k + 1) + '. ' + (s.status === 'ok' ? '' : (s.status || '?') + ' ') + firstLine(s.code || '') +
      (s.status === 'error' && s.out ? ' → ' + s.out.slice(0, 120) : '') + (effectsLine(s.effects) ? ' → ' + effectsLine(s.effects).slice(0, 140) : '')).join('') + ']'
  },
  // Fold older messages into th.summary when the history gets long. end:
  // the messages before the current exchange.
  async compact(P, th, { end = th.msgs.length, force = false, signal, onStart } = {}) {
    const start = th.summary ? th.summary.upTo : 0
    if (end - start < 2) return null
    const sizes = th.msgs.slice(start, end).map(m => this.renderMsg(m, false).length), total = sizes.reduce((a, b) => a + b, 0)
    if (!force && total <= this.HIST_CHARS && sizes.length <= this.MAX_MSGS) return null
    // keep the newest messages verbatim (at least KEEP_MIN, up to KEEP_CHARS); the cut lands on a message from the person
    let keep = 0, acc = 0
    for (let k = sizes.length - 1; k >= 0; k--) { if (keep >= (force ? 2 : this.KEEP_MIN) && (force || acc + sizes[k] > this.KEEP_CHARS)) break; acc += sizes[k]; keep++ }
    let cut = end - keep
    while (cut > start && th.msgs[cut] && th.msgs[cut].role !== 'user') cut--
    if (cut <= start) { cut = end - keep; while (cut < end && th.msgs[cut].role !== 'user') cut++ }
    if (cut <= start || cut >= end) return null
    if (onStart) onStart(cut - start)
    const part = th.msgs.slice(start, cut), lastT = part[part.length - 1].t
    const marks = P.events.filter(e => e.kind === 'mark' && e.thread === th.id && e.at <= lastT && (!th.summary || e.at > th.summary.t0)).map(e => '- ' + (e.mk || 'mark') + ': ' + e.label + (e.note ? ' (' + e.note + ')' : ''))
    const transcript = part.map((m, k) => '[' + (start + k + 1) + '] ' + (m.role === 'user' ? 'Person: ' : 'Claude: ') + trunc(this.renderMsg(m, true), 3000)).join('\n\n')
    const prompt = 'You keep the running summary of a conversation between a person and Claude, a coding agent inside the bench (an IDE for slop apps). Older messages are about to leave Claude\'s context; your summary replaces them, so Claude must be able to continue the work from it alone. Merge the previous summary with the new messages.\n\n' +
      'Write Markdown, at most 350 words, under these bold headings, skipping any with nothing under it:\n**Goals** what the person wants, constraints and preferences (their words where it matters)\n**Decisions** what was decided and why\n**Done** what was built or changed: files, migrations, scenarios, fixtures, proposals (accepted, open or rejected)\n**Didn\'t work** what was tried and dropped, and why\n**Open** unanswered questions, things promised for later, known problems\n**Names** frame ids, variables, lib functions, fixtures and scenarios worth remembering\n\n' +
      'Be specific (file:line, names, numbers). Do not add anything that is not in the messages. Reply with the summary only.\n\n' +
      'Previous summary:\n' + (th.summary ? th.summary.text : '(none: this is the start of the thread)') + '\n\nMessages ' + (start + 1) + '–' + cut + ':\n' + trunc(transcript, 40000) + (marks.length ? '\n\nMarks on the timeline from this stretch:\n' + marks.join('\n') : '')
    let text = '', by = 'claude'
    try { if (this.sample) { const r = await this.sample(fitPrompt([{ role: 'user', content: prompt }]).msgs[0].content, { modelTier: 'quick', cache: false, signal }); text = ((r && r.text) || '').trim() } } catch (e) { if (signal && signal.aborted) throw e }
    if (text.length < 40) { by = 'fallback'; text = this.plainSummary(th, start, cut) }
    th.summary = { upTo: cut, text: trunc(text, 6000), by, t: now(), t0: lastT, chars: total }
    P.saveThread(th)
    P.log({ kind: 'compact', who: 'ide', thread: th.id, note: 'summarized messages 1–' + cut + ' of "' + th.title + '" for Claude' + (by === 'fallback' ? ' (without a model)' : '') })
    P.ev.emit('threads')
    return th.summary
  },
  // a summary without a model: the requests, the first line of each reply, the files written
  plainSummary(th, start, cut) {
    const out = th.summary ? [th.summary.text, ''] : [], req = [], rep = [], files = new Set()
    th.msgs.slice(start, cut).forEach((m, k) => {
      const n = start + k + 1
      if (m.role === 'user') req.push('- [' + n + '] ' + trunc((m.text || '').replace(/\s+/g, ' '), 200))
      else {
        const l = (m.text || m.error || '').split('\n').find(x => x.trim())
        if (l) rep.push('- [' + n + '] ' + trunc(l.replace(/^#+\s*/, ''), 160))
        for (const s of m.steps || []) for (const f of (s.effects && s.effects.files) || []) files.add(f.path)
      }
    })
    if (req.length) out.push('**Requests**', ...req)
    if (rep.length) out.push('**Replies**', ...rep)
    if (files.size) out.push('**Files written** ' + [...files].join(', '))
    return out.join('\n')
  },
  // the conversation so far (the model is memoryless), then the current state on the last message
  messages(P, th, ws, text, head) {
    const start = th.summary ? th.summary.upTo : 0, end = Math.max(start, th.msgs.length - 2)
    const hist = th.msgs.slice(start, end), agentIdx = hist.map((m, k) => m.role === 'agent' ? k : -1).filter(k => k >= 0).slice(-2)
    const rendered = hist.map((m, k) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: this.renderMsg(m, agentIdx.includes(k)), skip: m.role !== 'user' && !m.text && !(m.steps && m.steps.length) })).filter(m => !m.skip)
    // still too long (no summary yet, or one huge message): drop the oldest and say so
    let dropped = 0
    while (rendered.length > 2 && rendered.reduce((a, m) => a + m.content.length, 0) > this.HIST_CHARS) { rendered.shift(); dropped++ }
    while (rendered.length && rendered[0].role !== 'user') { rendered.shift(); dropped++ }
    const merged = []
    for (const m of rendered) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ role: m.role, content: m.content }) }
    let earlier = ''
    if (th.summary) earlier = 'Earlier in this thread (messages 1–' + th.summary.upTo + ', summarized; session.recall(query) searches them and session.message(n) reads one in full):\n' + th.summary.text + '\n\n' + (merged.length ? 'The conversation continues:\n\n' : '')
    if (dropped) earlier += '(' + plural(dropped, 'older message') + ' not shown; session.recall(query) searches them.)\n\n'
    const cur = 'Current state:\n' + this.context(P, ws, th) + '\n\n' + (th.parent ? 'The main agent asks:\n' : 'The person says:\n') + text
    if (merged.length) {
      merged[0].content = head + earlier + merged[0].content
      if (merged[merged.length - 1].role === 'user') merged.push({ role: 'assistant', content: '(continuing)' })
      merged.push({ role: 'user', content: cur })
    } else merged.push({ role: 'user', content: head + earlier + cur })
    return merged
  },

  // ---- one model turn on a thread; the eval tool runs in the thread's sandbox session. Throws on failure. ----
  async turn(P, th, msg, text, o) {
    const ctx = makeContext(P, { ws: o.ws, who: 'agent', thread: th.id, mode: th.mode, role: th.role || null, depth: o.depth || 0, budget: o.budget, tier: th.tier, model: th.model, signal: o.signal, parentTx: o.parentTx || null, agent: this })
    ctx.onApproval = card => { msg.approval = card; this.ev.emit('step', th.id) }
    ctx.onPanel = id => { msg.panels = msg.panels || []; if (!msg.panels.includes(id)) msg.panels.push(id); this.ev.emit('step', th.id) }
    const tool = {
      name: 'eval',
      description: 'Run a JavaScript async function body in the bench sandbox with the host API in scope (files, app, frames, fixtures, scenarios, session, ui, lib, publish) and the step core (step, seq, par, delegate, …). Use `return` for the result. Returns {ok, value, logs, error, effects}.',
      inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript statements; may use await; return the value you want back' }, ts: { type: 'boolean', description: 'the code is TypeScript: its types are stripped before it runs (they are not checked)' } }, required: ['code'] },
      execute: async input => {
        let code = String((input && input.code) || '')
        const step = { code, t: now(), status: 'running' }
        msg.steps.push(step); this.ev.emit('step', th.id)
        const b = o.budget
        if (b.used >= b.max) { step.status = 'error'; step.out = 'eval budget used up'; this.ev.emit('step', th.id); throw new Error('eval budget (' + b.max + ' for this ' + (th.parent ? 'delegation' : 'turn') + ') used up: stop and summarize') }
        for (let x = b; x; x = x.parent) x.used++
        if (th.mode === 'ask') {
          step.status = 'ask'; this.ev.emit('step', th.id)
          const ok = await new Promise(res => { step.decide = res; if (o.signal) o.signal.addEventListener('abort', () => res(false)) })
          delete step.decide
          if (!ok) { step.status = 'skipped'; this.ev.emit('step', th.id); return JSON.stringify({ ok: false, error: { kind: 'declined', message: 'the person declined to run this eval; ask or try something else' } }) }
          step.status = 'running'; this.ev.emit('step', th.id)
        }
        if (input && input.ts) {
          const t = await Types.transpile(code)
          if (t.error) {
            Object.assign(step, { ok: false, status: 'error', out: 'syntax: ' + t.error + (t.line ? ' (line ' + t.line + ')' : '') }); this.ev.emit('step', th.id)
            return JSON.stringify({ ok: false, error: { kind: 'syntax', message: 'the TypeScript does not compile: ' + t.error, line: t.line || undefined } })
          }
          code = t.code
        }
        let r = await runEval(ctx, code, { sid: th.id, restore: th.scope && th.scope.vars })
        // TypeScript sent without ts: true ("catch (e: any)", "const rows: Row[] = …") fails to parse, so nothing
        // ran: it is run again with its types stripped (two evals in round 5)
        // (and typed parameters, "(p: string, from: number) =>", which the first pattern missed: the chess thread on
        // staging). A syntax error means nothing ran, so any one is tried once as TypeScript; the run counts only if
        // stripping the types changed the code
        if (!r.ok && !(input && input.ts) && r.error && r.error.kind === 'SyntaxError' && /\w\s*\??\s*:\s*[\w[{(<'"]|\bas\s+[A-Z\w[]|\b(interface|type)\s+\w+/.test(code)) {
          const t = await Types.transpile(code).catch(() => ({ error: 'no transpiler' }))
          if (!t.error && t.code && t.code !== code) { r = await runEval(ctx, t.code, { sid: th.id, restore: th.scope && th.scope.vars }); step.note = 'ran as TypeScript (pass ts: true for TypeScript)' }
        }
        Object.assign(step, { ok: r.ok, ms: r.ms, engine: r.engine, calls: r.calls, effects: r.effects || undefined })
        if (ctx.children.length) step.children = ctx.children.splice(0)
        if (r.scope) th.scope = r.scope
        step.logs = (r.logs || []).map(l => (l.level !== 'log' ? l.level + ': ' : '') + l.text)
        step.out = r.ok ? trunc(toYAML(r.value), 6000) : (r.error.kind + ': ' + r.error.message + (r.error.line ? ' (line ' + r.error.line + ')' : ''))
        step.fmt = r.ok ? 'yaml' : undefined
        step.status = r.ok ? 'ok' : 'error'
        P.log({ kind: 'eval', who: 'agent', ref: ctx.ws, thread: th.id, ok: r.ok, note: firstLine(code), calls: [...new Set(r.calls || [])].slice(0, 12), n: r.effects && r.effects.commit ? r.effects.commit.n : undefined })
        this.ev.emit('step', th.id)
        const out = { ok: r.ok, value: r.ok ? r.value : undefined, logs: step.logs.length ? step.logs : undefined, error: r.ok ? undefined : r.error, effects: r.effects || undefined }
        return trunc(JSON.stringify(out), 8000)
      }
    }
    const R = th.role && ROLES[th.role]
    const head = (R ? 'You are the ' + th.role + ' subagent, called by the main agent through delegate(). ' + R.describe +
      (R.mode === 'read' ? ' Writes are refused (policy errors); canvas arrangement and ui.pin are allowed.' : R.mode === 'tests' ? ' You may write only scenarios/ and fixtures/ (other writes are refused); canvas arrangement and ui.pin are allowed.' : '') +
      ' Reply to the main agent, briefly. Your budget is ' + o.budget.max + ' evals.\n\n' : '') + guide(P, ctx.api) + '\n\n'
    // a long thread: fold older messages into the summary first
    try {
      await this.compact(P, th, { end: th.msgs.length - 2, signal: o.signal, onStart: n => { msg.note = 'Summarizing ' + plural(n, 'earlier message') + '…'; this.ev.emit('text', th.id) } })
    } catch (e) { if (o.signal && o.signal.aborted) throw e }
    if (msg.note) { delete msg.note; this.ev.emit('text', th.id) }
    // One model call runs at most CALL_EVALS evals (the server's tool rounds, less the last, which
    // has no tools). A call that used them all, with turn budget left, is continued: the model sees
    // what it did in this turn and a note from the bench. 60 of 97 turns in the persona reviews
    // stopped at exactly 9 evals, mid-task, and the person had to say "continue".
    let msgs = this.messages(P, th, o.ws, text, head), res = null, prev = '', faked = false
    for (let call = 0; ; call++) {
      const before = msg.steps.length
      const fit = fitPrompt(msgs)
      if (fit.cut.length) msg.promptCut = { parts: msgs.map(m => m.role[0] + m.content.length), cut: fit.cut }
      res = await this.sample(fit.msgs, { tools: [tool], onText: ({ text: t }) => { msg.text = (prev ? prev + '\n\n' : '') + t; this.ev.emit('text', th.id) }, signal: o.signal, modelTier: th.tier || 'default', cache: false, ...(th.model ? { model: th.model } : {}) })
      const made = msg.steps.length - before, left = o.budget.max - o.budget.used
      // evals written as text: a model imitating the history's "[evals: …]" wrote code into its reply,
      // never called the tool, and reported results it invented (round 4: "written and verified", and
      // nothing landed). Its text is dropped, and it is told once that nothing ran.
      if (!made && !faked && FAKED_EVAL.test((res && res.text) || '') && left > 0 && !(o.signal && o.signal.aborted)) {
        faked = true; msg.text = prev; this.ev.emit('text', th.id)
        msgs = [...msgs, { role: 'assistant', content: '(a reply with eval code written as text)' },
          { role: 'user', content: '(From the bench, not the person: your last reply wrote eval code as text instead of calling the eval tool, so none of it ran and nothing it described happened. Call the eval tool to run code, and report only results you saw in its output.)' }]
        continue
      }
      if (o.signal && o.signal.aborted) break
      // a call that ran evals and then said nothing ends the turn on a half sentence (round 5: 27 evals, then
      // only "Feature 2 it is — … makes 'exactly one winn"): it gets the same report call as a spent turn
      const silent = made > 0 && !((res && res.text) || '').trim()
      if (made < CALL_EVALS && !silent) break
      // out of evals or continuations mid-work, or silent: one more call without the tool, for a report to the
      // person (a turn ended on "Now verifying the refactor live —" after 27 evals, and the person had nothing: round 4)
      if (silent || left <= 0 || call >= MAX_CONTINUES) {
        prev = (prev ? prev + '\n\n' : '') + ((res && res.text) || '').trim()
        const fin = fitPrompt([...msgs, { role: 'assistant', content: this.renderMsg({ ...msg, text: (res && res.text) || '' }, true) || '(evals)' },
          { role: 'user', content: '(From the bench, not the person: ' + (silent && left > 0 && call < MAX_CONTINUES ? 'your last call ran evals and then said nothing.' : 'this turn has used all its evals.') + ' Reply to the person now, without evals: what you changed, what you checked and how, what is not done or not verified yet, and any temporary code (probes, console.log) still in the files. They can send a message to let you go on.)' }])
        try {
          res = await this.sample(fin.msgs, { onText: ({ text: t }) => { msg.text = (prev ? prev + '\n\n' : '') + t; this.ev.emit('text', th.id) }, signal: o.signal, modelTier: th.tier || 'default', cache: false, ...(th.model ? { model: th.model } : {}) })
        } catch (e) { if (o.signal && o.signal.aborted) throw e; res = { text: '(The turn used all its evals before Claude could report; send a message to go on.)' } }
        break
      }
      prev = (prev ? prev + '\n\n' : '') + ((res && res.text) || '').trim()
      msg.text = prev; this.ev.emit('text', th.id)
      msgs = [...msgs, { role: 'assistant', content: this.renderMsg({ ...msg, text: (res && res.text) || '' }, true) || '(evals)' },
        { role: 'user', content: '(From the bench, not the person: that model call reached its limit of ' + CALL_EVALS + ' evals. This turn has ' + left + ' evals left. Carry on with the work where you stopped; when it is done, or you need the person, reply to them.)' }]
    }
    if (res && res.modelApplied) msg.model = res.modelApplied
    msg.text = (prev ? prev + (res && res.text ? '\n\n' + res.text : '') : (res && res.text)) || msg.text
    if (res && res.truncated) msg.text += '\n[reply truncated]'
    return msg.text
  },

  // The thread's workspace for a message: a proposal of its own when it
  // works in proposals (made on its first message, kept while open), the
  // viewed workspace for read and tests threads, else draft.
  async workspace(P, th, text) {
    if (th.mode === 'read' || th.mode === 'tests') return AgentUI.ws()
    if (th.target !== 'proposal') return 'draft'
    const cur = th.proposal && P.proposals.get(th.proposal)
    if (cur && cur.status === 'open') return cur.ref
    const p = await P.propose({ title: text.slice(0, 40) + (text.length > 40 ? '…' : ''), thread: th.id })
    th.proposal = p.ref
    return p.ref
  },
  // An agent's proposal that ended with no changes is discarded.
  async proposalDone(P, ref) {
    const p = P.proposals.get(ref)
    if (!p || p.status !== 'open') return []
    const paths = (await P.changes(ref)).map(c => c.path)
    if (!paths.length) await P.close(ref, 'discarded')
    return paths
  },

  async send(P, th, text) {
    if (!this.sample) throw new Error('Claude is not available in this view')
    if (this.busy(th.id)) return
    await P.loadThread(th.id)
    const s = AgentUI.selection()
    th.msgs.push({ role: 'user', text, t: now(), ctx: { sel: s ? { src: s.src, tag: s.tag, route: s.route } : null, pins: (P.meta.pins || []).filter(p => !p.resolved).length } })
    if (th.msgs.filter(m => m.role === 'user').length === 1 && /^Thread \d+$/.test(th.title)) th.title = text.slice(0, 32) + (text.length > 32 ? '…' : '')
    const msg = { role: 'agent', text: '', steps: [], t: now(), status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController()
    this.turns.set(th.id, { abort, msg, thread: th }); this.ev.emit('turn', th.id)
    let ws = 'draft'
    try {
      ws = msg.ws = await this.workspace(P, th, text)
      if (ws !== 'draft' && AgentUI.ws() !== ws) AgentUI.setWs(ws)
      P.log({ kind: 'msg', who: 'you', ref: ws, thread: th.id, note: text.slice(0, 140) })
      await this.turn(P, th, msg, text, { ws, depth: 0, budget: { max: BUDGET, used: 0, parent: null }, signal: abort.signal })
      msg.status = 'done'
    } catch (e) {
      const code = e && e.code
      msg.status = abort.signal.aborted ? 'stopped' : 'error'
      msg.error = abort.signal.aborted ? 'Stopped.' : code === 'not_granted' ? 'Claude is not available for this page (not granted).' : code === 'rate_limited' ? 'Rate limited: wait a little and send again.' : ((e && e.message) || String(e))
      if (e && e.text && !msg.text) msg.text = e.text
      if (code === 'not_granted') { this.sample = null; this.ev.emit('ready') }
    } finally {
      this.turns.delete(th.id); msg.approval = null
      for (const st of msg.steps) if (st.status === 'running' || st.status === 'ask') st.status = 'skipped'
      let changed = []
      if (ws !== 'draft' && th.proposal === ws) {
        changed = await this.proposalDone(P, ws).catch(() => [])
        if (!changed.length) { th.proposal = null; if (AgentUI.ws() === ws) AgentUI.setWs('draft') }
      }
      msg.summary = changed.length ? plural(changed.length, 'file') + ' changed in "' + P.proposals.get(ws).title + '"' : ''
      // A turn that ran evals but said nothing leaves the person with a row of
      // ticks (a persona review found it): the bench says what happened.
      if (msg.status === 'done' && !(msg.text || '').trim() && msg.steps.length) msg.text = autoSummary(msg, changed, ws === 'draft' ? null : (P.proposals.get(ws) || {}).title), msg.auto = true
      P.log({ kind: 'turn', who: 'agent', ref: ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads')
      this.ev.emit('turn', th.id)
      if (changed.length) AgentUI.notify('Proposal ready: ' + plural(changed.length, 'file') + ' to review')
    }
  },

  // delegate(role, task): a subagent with its own thread, sandbox session
  // and timeline lane. Its evals come out of the caller's budget; it may
  // delegate in turn, to a depth of MAX_DEPTH. Working in the caller's
  // workspace, its evals run inside the caller's transaction.
  async delegate(pctx, role, task, opts = {}) {
    const R = ROLES[role]
    if (!R) throw Object.assign(new Error('no role "' + role + '". Roles: ' + Object.keys(ROLES).join(', ')), { kind: 'invalid' })
    if (!this.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
    if ((pctx.depth || 0) >= MAX_DEPTH) throw Object.assign(new Error('delegation depth is capped at ' + MAX_DEPTH), { kind: 'budget' })
    const pb = pctx.budget || { max: BUDGET, used: 0, parent: null }
    let room = Infinity
    for (let x = pb; x; x = x.parent) room = Math.min(room, x.max - x.used)
    const want = Math.min(opts.evals || R.evals, room - 1)
    if (want < 1) throw Object.assign(new Error('not enough eval budget left to delegate (' + room + ' left)'), { kind: 'budget' })
    const budget = { max: want, used: 0, parent: pb }
    const P = pctx.project, short = task.replace(/\s+/g, ' ')
    const th = P.newThread(role + ': ' + short.slice(0, 40), { parent: pctx.thread || 'eval', role, mode: R.mode, target: R.own ? 'proposal' : 'draft', tier: opts.tier || pctx.tier || 'default', model: opts.model !== undefined ? opts.model : (pctx.model || null) })
    let ws = pctx.ws, prompt = task
    if (R.own) { const p = await P.propose({ title: role + ': ' + short.slice(0, 36), thread: th.id }); th.proposal = p.ref; ws = p.ref }
    if (role === 'reviewer') {
      const target = opts.proposal || (pctx.ws !== 'draft' ? pctx.ws : (P.openProposals().slice(-1)[0] || {}).ref)
      if (!target || !P.proposals.get(target)) throw Object.assign(new Error('reviewer needs a proposal: pass { proposal: ref } (open: ' + (P.openProposals().map(p => p.ref).join(', ') || 'none') + ')'), { kind: 'invalid' })
      ws = target
      const ch = await P.changes(target)
      prompt += '\n\nYou are reviewing proposal "' + P.proposals.get(target).title + '" (' + target + '; your reads and frame checks see it). frames.compare(frameId) lists its layout changes against draft; scenarios.runAll() runs the scenarios against it. Its changes against its base:\n' +
        trunc(ch.map(c => c.after === null && c.entry ? '~ ' + c.path + ' (kept by hash)' : diffText(c.path, c.before ?? '', c.after ?? '')).join('\n\n'), 7000)
    }
    const out = opts.output || R.output
    if (out) prompt += '\n\nEnd your reply with JSON only (no code fences), matching: ' + out
    th.msgs.push({ role: 'user', text: task, t: now(), from: pctx.role || 'main agent' })
    const msg = { role: 'agent', text: '', steps: [], t: now(), ws, status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController()
    if (pctx.signal) { if (pctx.signal.aborted) abort.abort(); else pctx.signal.addEventListener('abort', () => abort.abort()) }
    this.turns.set(th.id, { abort, msg, thread: th }); this.ev.emit('turn', th.id); P.ev.emit('threads')
    pctx.children.push({ thread: th.id, role })
    P.log({ kind: 'delegate', who: pctx.who || 'agent', ref: pctx.ws, thread: pctx.thread, note: role + ': ' + task.slice(0, 120), child: th.id })
    let failure = null
    try {
      await this.turn(P, th, msg, prompt, { ws, depth: (pctx.depth || 0) + 1, budget, signal: abort.signal, parentTx: ws === pctx.ws ? pctx.tx : null })
      msg.status = 'done'
    } catch (e) { failure = e; msg.status = abort.signal.aborted ? 'stopped' : 'error'; msg.error = (e && e.message) || String(e) } finally {
      this.turns.delete(th.id)
      for (const st of msg.steps) if (st.status === 'running' || st.status === 'ask') st.status = 'skipped'
      P.log({ kind: 'turn', who: 'agent', ref: ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads'); this.ev.emit('turn', th.id)
    }
    const changes = R.own ? await this.proposalDone(P, ws).catch(() => []) : undefined
    if (failure) throw Object.assign(new Error(role + ' failed: ' + (msg.error || 'unknown') + ' (thread ' + th.id + ')'), { kind: abort.signal.aborted ? 'cancelled' : 'agent' })
    const parsed = out ? parseJSONReply(msg.text || '') : undefined
    return {
      role, thread: th.id, evals: budget.used, result: parsed !== undefined ? parsed : (msg.text || ''), text: trunc(msg.text || '', 4000),
      proposal: R.own && changes.length ? ws : undefined, changes
    }
  },
  stop(tid) { const t = this.turns.get(tid); if (t) t.abort.abort() }
}

// What a turn did, in words, from its evals' effects: for a turn whose
// model ended without a reply.
function autoSummary(msg, changed, proposal) {
  const files = new Set(), bad = msg.steps.filter(st => st.status === 'error').length
  for (const st of msg.steps) for (const f of (st.effects && st.effects.files) || []) files.add(f.path)
  const parts = []
  if (files.size) parts.push('Changed ' + [...files].slice(0, 6).join(', ') + (files.size > 6 ? ' and ' + (files.size - 6) + ' more' : '') + (proposal ? ' in the proposal "' + proposal + '" (a copy of your app: look at it, then accept it to keep the changes)' : ' in the draft') + '.')
  else parts.push('Looked at the app; nothing was changed.')
  if (bad) parts.push(plural(bad, 'step') + ' failed along the way.')
  return parts.join(' ')
}
