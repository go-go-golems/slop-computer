// ui/console.js — the Console (what pages and the dev instance's actor
// log, from every frame) and the Eval panel (the agent's tool, run by the
// person: an async function body in the sandbox, as one transaction on the
// viewed workspace, with the same API and effects).
//
// Public API: CONSOLE, EVAL (views).
import { API } from '../agent/api/index.js';
import { App } from './app.js';
import { Dock } from './dock.js';
import { LIB_DIR, libEntries } from '../agent/api/lib.js';
import { Sandbox } from '../agent/sandbox.js';
import { clear, h, put } from '../lib/dom.js';
import { effectsLine } from '../agent/effects.js';
import { fmtTime, now } from '../lib/util.js';
import { guide } from '../agent/guide.js';
import { hlYAML, toYAML } from '../lib/text.js';
import { makeContext, runEval } from '../agent/eval.js';

export const CONSOLE = {
  title: 'Console', sub: 'logs',
  badge: () => { const n = App.logs.filter(l => l.level === 'error' && !l.seen).length; return n ? h('span.count.bad', String(n)) : null },
  make() {
    const S = { level: 'all' }
    const out = h('div.clog')
    const seg = h('div.seg.sm', ['all', 'error', 'warn'].map(l => h('button' + (l === S.level ? '.on' : ''), { on: { click: () => { S.level = l; [...seg.children].forEach(b => b.classList.toggle('on', b.textContent.toLowerCase().startsWith(l === 'all' ? 'all' : l))); paint() } } }, l === 'all' ? 'All' : l === 'error' ? 'Errors' : 'Warnings')))
    const el = h('div', h('div.toolbar', seg, h('span.sp'), h('button.btn.sm', { on: { click: () => { App.logs.length = 0; paint(); Dock.refreshTabs() } } }, 'Clear')), out)
    function row(l) {
      const [f, ln] = (l.src || '').split(':')
      return h('div.' + l.level, h('span.t', fmtTime(l.t)), h('span.s', { title: l.frame }, l.frame), h('span', l.text, l.src && f ? [' ', h('button.link.note', { on: { click: () => App.reveal(f, +ln || 1) } }, l.src)] : null))
    }
    function paint() {
      clear(out)
      const ls = App.logs.filter(l => S.level === 'all' || l.level === S.level)
      for (const l of ls.slice(-400)) out.appendChild(row(l))
      if (!ls.length) out.appendChild(h('p.empty', 'Nothing logged. Page console output and errors from every frame land here.'))
      out.scrollTop = out.scrollHeight
      if (Dock.visible('console')) { App.logs.forEach(l => { l.seen = true }); Dock.refreshTabs() }
    }
    App.ev.on('log', l => {
      if (!Dock.visible('console')) { Dock.refreshTabs(); return }
      if (S.level !== 'all' && l.level !== S.level) return
      if (out.querySelector('.empty')) clear(out)
      l.seen = true; out.appendChild(row(l)); if (out.children.length > 400) out.firstChild.remove(); out.scrollTop = out.scrollHeight
    })
    App.ev.on('project', paint)
    return { el, show: paint }
  }
}

// ---------- eval: run code against the host API yourself (the agent's exact tool) ----------
export const EVAL = {
  title: 'Eval', sub: 'run the API yourself',
  make() {
    const ta = h('textarea.txt.mono', { spellcheck: false, style: { width: '100%', minHeight: '120px', resize: 'vertical', fontSize: '12px', lineHeight: '18px' } })
    ta.value = `// The agent's only tool: an async function body, run in a QuickJS sandbox,\n// as one transaction on the viewed workspace. The host API is in scope\n// (files, app, frames, scenarios, session, ui, lib). Return a value.\nconst list = await files.list()\nconst issues = await frames.check()\nreturn { files: list.map(f => f.path), issues }`
    const res = h('div.scroll'), engine = h('span.note')
    const run = async () => {
      if (!App.P) return
      const code = ta.value, t0 = now()
      const card = h('div.block', h('header', h('h3', 'Running…'), h('span.sub', fmtTime(t0))))
      res.prepend(card)
      // the project and workspace the eval started on keep its results, even
      // if another project is opened while it runs
      const P = App.P, ws = App.ws
      const r = await runEval(makeContext(P, { ws, who: 'you', mode: 'auto' }), code, { sid: 'repl:' + P.app, restore: P.meta.replScope && P.meta.replScope.vars })
      if (r.scope) { P.meta.replScope = r.scope; P.saveMeta(); if (App.P === P) paintScope() }
      clear(card)
      if (r.effects) card.appendChild(h('div.fx', effectsLine(r.effects)))
      put(card, h('header', h('h3', { style: { color: r.ok ? '' : 'var(--accent)' } }, r.ok ? 'ok' : r.error.kind), h('span.sub', (r.ms ?? '?') + ' ms · ' + (r.engine || '') + ' · ' + (ws === 'draft' ? 'draft' : 'proposal') + (App.P !== P ? ' · ' + P.app : '')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => { ta.value = code; ta.focus() } } }, 'Edit again')),
        r.ok ? h('pre.mono.yaml', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px', maxHeight: '420px', overflow: 'auto' }, html: hlYAML(toYAML(r.value)) }) : h('pre.mono', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px' } }, r.error.message + (r.error.line ? '\n(line ' + r.error.line + ')' : '')),
        r.logs && r.logs.length ? h('pre.mono.note', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, r.logs.map(l => l.level + ': ' + l.text).join('\n')) : null)
      P.log({ kind: 'eval', who: 'you', ref: ws, ok: r.ok, note: (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12), n: r.effects && r.effects.commit ? r.effects.commit.n : undefined })
    }
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() } if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end') } })
    // filled when opened: what the agent is told, the generated API reference included
    const refText = h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0 } })
    const ref = h('details.block', { on: { toggle: () => { if (ref.open && App.P) refText.textContent = guide(App.P, API) } } }, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'What the agent is told (with the API reference)'), refText)
    const paintEngine = () => { engine.textContent = 'Sandbox: ' + ({ quickjs: 'QuickJS (wasm) in a worker', worker: 'worker realm (QuickJS failed to load)', loading: 'starting…', off: 'unavailable here' }[Sandbox.engine] || Sandbox.engine) }
    Sandbox.ev.on('engine', paintEngine); paintEngine()
    const scopeLine = h('div.toolbar', { style: { minHeight: '30px', fontSize: 'var(--fs-xs)' } })
    function paintScope() {
      clear(scopeLine); const P = App.P; if (!P) return
      const sc = P.meta.replScope, vars = sc && sc.vars ? Object.keys(sc.vars) : [], lib = libEntries(P.view(App.ws))
      put(scopeLine, h('span.lbl', 'Scope'), h('span.mono', vars.length ? vars.join(', ') : 'empty (top-level const/let/function persist between runs)'),
        lib.length ? [h('span.lbl', 'lib'), h('span.mono', lib.map(l => l.name).join(', '))] : null, h('span.sp'),
        vars.length ? h('button.btn.sm', { on: { click: () => { P.meta.replScope = null; P.saveMeta(); Sandbox.drop('repl:' + P.app); paintScope() } } }, 'Reset scope') : null)
    }
    App.ev.on('project', paintScope); App.ev.on('files', (ws, paths) => { if (!paths.length || paths.some(p => p.startsWith(LIB_DIR))) paintScope() })
    const el = h('div', h('div.toolbar', h('button.btn.sm.primary', { on: { click: run } }, 'Run ⌘↵'), engine, h('span.sp'), h('button.btn.sm', { on: { click: () => clear(res) } }, 'Clear')), scopeLine,
      h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--hair)' } }, ta), ref, res)
    return { el, show: () => { if (!Sandbox.worker) Sandbox.spawn(); paintScope() } }
  }
}
