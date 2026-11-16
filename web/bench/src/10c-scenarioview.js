// ---------- scenarios panel: flows that pass or fail, the fixtures they run on ----------
import { clear, h, promptBox, toast } from './lib/dom.js';
import { debounce, fmtAgo, plural } from './lib/util.js';

registerView('scenarios', {
  title: 'Scenarios', sub: 'flows that pass or fail',
  badge: () => { const P = App.P; if (!P) return null; const bad = scenarioList(P, App.ws).filter(s => s.last && !s.last.ok).length; return bad ? h('span.count', String(bad)) : null },
  make() {
    const S = { open: {}, live: {}, busy: false }
    const body = h('div.scroll'), el = h('div', body)
    const P = () => App.P
    function paint() {
      clear(body); const p = P(); if (!p) return
      const ws = App.ws, list = scenarioList(p, ws), fxs = fixtureList(p, ws)
      body.appendChild(h('div.toolbar', h('b', 'Scenarios'), h('span.note', 'each runs in a frame of its own on a copy of the data' + (ws !== 'main' ? ', in this proposal' : '')), h('span.sp'),
        h('button.btn.sm', { disabled: S.busy || !list.length, on: { click: runAll } }, S.busy ? 'Running…' : 'Run all'),
        h('button.btn.sm', { on: { click: newScenario } }, '+ New')))
      if (!list.length) body.appendChild(h('div.empty', h('p', 'No scenarios yet.'), h('p.note', 'Record one from a frame\'s ⋯ menu (click and type in Play mode; pick an element in Select mode to check its text), write scenarios/<name>.json by hand, or ask Claude: "write scenarios for ordering and run them".')))
      for (const s of list) body.appendChild(card(p, s))
      body.appendChild(h('div.toolbar', h('b', 'Fixtures'), h('span.note', 'fixed data for frames and scenarios'), h('span.sp'), h('button.btn.sm', { on: { click: newFixture } }, '+ New')))
      if (!fxs.length) body.appendChild(h('p.note', { style: { padding: '0 12px 12px' } }, 'None yet. A fixture holds rows (and optionally a clock) to run a page against instead of the live data: an empty menu, very long names, a hundred orders, a time after closing.'))
      else body.appendChild(h('div.rows', { style: { padding: '0 12px 12px' } }, fxs.map(f => h('div', h('b', f.name), h('span', { style: { flex: 1 } }, f.error ? h('span', { style: { color: 'var(--accent)' } }, f.error) : [f.description ? f.description + ' · ' : '', f.tables.map(t => t + ' (' + (Array.isArray(f.spec.tables[t]) ? f.spec.tables[t].length : f.spec.tables[t]) + ')').join(', '), f.clock ? ' · clock ' + f.clock : '']),
        h('button.link.note', { on: { click: () => App.reveal(f.path, 1) } }, 'edit')))))
    }
    function card(p, s) {
      const live = S.live[s.name], last = s.last, shown = S.open[s.name] ?? (!!live || (last && !last.ok))
      const state = live ? (live.done ? (live.ok ? 'ok' : 'bad') : 'run') : last ? (last.ok ? 'ok' : 'bad') : 'none'
      const icon = { ok: '✓', bad: '✗', run: '◌', none: '○' }[state]
      const head = h('div.sh', h('span.si.' + state, icon), h('button.link', { on: { click: () => { S.open[s.name] = !shown; paint() } } }, h('b', s.name)),
        s.spec && s.spec.description ? h('span.note', s.spec.description) : null, h('span.sp'),
        s.spec ? h('span.note', s.spec.page + (s.spec.fixture ? ' · fixture ' + s.spec.fixture : '') + ' · ' + plural(s.spec.steps.length, 'step')) : null,
        last && !live ? h('span.note', fmtAgo(last.t)) : null,
        h('button.btn.sm', { disabled: !!s.error || S.busy, on: { click: () => run(s) } }, 'Run'),
        h('button.btn.sm', { on: { click: () => App.reveal(s.path, 1) } }, 'Edit'))
      const c = h('div.scard.' + state, head)
      if (s.error) { c.appendChild(h('p.note', { style: { color: 'var(--accent)', margin: '4px 0 0 26px' } }, s.error)); return c }
      if (!shown) return c
      const res = live || last, steps = h('ol.ssteps')
      s.spec.steps.forEach((st, i) => {
        const r = res && res.steps && res.steps[i], cls = !r ? (live && live.cur === i ? 'run' : '') : r.ok ? 'ok' : 'bad'
        steps.appendChild(h('li.' + (cls || 'todo'), h('span.m', cls === 'ok' ? '✓' : cls === 'bad' ? '✗' : cls === 'run' ? '◌' : '·'), h('span', stepLabel(st)), r && r.ms != null ? h('span.note', r.ms + ' ms') : null,
          r && r.error ? h('div.err', r.error) : null))
      })
      c.appendChild(steps)
      if (res && res.snaps && res.snaps.length) {
        const shots = res.snaps.map(x => Snaps.list(p).find(m => m.id === x.id)).filter(Boolean)
        if (shots.length) c.appendChild(snapStrip(p, shots, res.ok ? 'Where it ended' : 'Where it failed', 'Click to compare with the page now'))
      }
      if (res && !res.ok && !live) c.appendChild(h('div', { style: { margin: '6px 0 0 26px' } }, h('button.btn.sm', { on: { click: () => App.askAgent('Scenario "' + s.name + '" fails at step ' + (res.failedAt + 1) + ' (' + res.steps[res.failedAt].label + '): ' + res.steps[res.failedAt].error + '. Find out why (scenarios.read, scenarios.run, frames.*) and fix the page, or the scenario if the page is right.') } }, 'Ask Claude to fix')))
      return c
    }
    async function run(s) {
      const p = P(); S.live[s.name] = { steps: [], cur: 0 }; S.open[s.name] = true; paint()
      try {
        const r = await runScenario(p, s.spec, { ws: App.ws, name: s.name, onStep: st => { const L = S.live[s.name]; if (!L) return; if (st.running) L.cur = st.i; else L.steps[st.i] = st; later() } })
        S.live[s.name] = { ...r, done: true }
      } catch (e) { toast(s.name + ': ' + e.message); delete S.live[s.name] }
      setTimeout(() => { delete S.live[s.name]; later() }, 1200); paint()
    }
    async function runAll() {
      S.busy = true; paint()
      try { for (const s of scenarioList(P(), App.ws)) if (!s.error) await run(s) } finally { S.busy = false; paint() }
      const list = scenarioList(P(), App.ws), bad = list.filter(s => s.last && !s.last.ok).length
      toast(bad ? plural(bad, 'scenario') + ' failed' : 'All ' + plural(list.length, 'scenario') + ' passed')
    }
    async function newScenario() {
      const p = P(), n = await promptBox('New scenario', 'A name (letters, digits, -). You can also record one from a frame\'s ⋯ menu.', 'order-a-drink'); if (!n) return
      const page = (p.board().frames[0] || {}).route || 'index.html', path = SCEN_DIR + n.replace(/[^\w-]+/g, '-') + '.json'
      if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: '', page, steps: [{ waitFor: 'body' }, { click: 'a:has-text("Menu")' }, { expect: 'h1', text: 'Menu' }] }, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'new scenario' })
      App.reveal(path, 1)
    }
    async function newFixture() {
      const p = P(), n = await promptBox('New fixture', 'Starts as a copy of the current tables; edit the rows to make the case you want.', 'empty-menu'); if (!n) return
      const tables = {}; for (const [k, t] of p.tablesIn(App.ws)) tables[k] = t.rows
      const path = fixturePath(n.replace(/[^\w-]+/g, '-'))
      if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: '', tables, clock: null }, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'new fixture' })
      App.reveal(path, 1)
    }
    const later = debounce(() => { if (Dock.visible('scenarios')) paint(); Dock.refreshTabs() }, 80)
    App.ev.on('scenarios', later); App.ev.on('files', later); App.ev.on('ws', later); App.ev.on('project', () => { S.live = {}; later() })
    return { el, show: paint }
  }
})
