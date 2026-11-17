// ui/data.js — the Data view: the data of the person's instances (dev, or
// test after a scenario run), read from the server.
//
// Tables are the SQL tables the app's migrations made (read-only queries
// through the bench actor); documents are the app's db collections. The
// view can seed the dev instance from a fixture, save rows as a fixture,
// and reset the dev instance. Nothing here is the app store's data or
// production's.
//
// Public API: DATA (a view).
import { App } from './app.js';
import { Dock } from './dock.js';
import { FIX_DIR, checkFixture, fixtureList, fixturePath } from '../core/scenario.js';
import { Slop } from '../server/slop.js';
import { clear, confirmBox, h, popMenu, promptBox, put, toast } from '../lib/dom.js';
import { debounce, plural } from '../lib/util.js';

const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name"
const cell = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

export const DATA = {
  title: 'Data', sub: 'your instances\' data',
  make() {
    const S = { kind: 'dev', tables: [], cur: null, rows: null, query: '', coll: '', docs: null, error: '', seq: 0 }
    const P = () => App.P
    const tl = h('div.tlist'), head = h('div.toolbar'), grid = h('div.scroll')
    const el = h('div', h('div.dview', tl, h('div.cmain', head, grid)))
    // prop: the open proposal's preview instance (what the canvas shows while you look at a proposal)
    const call = (action, args) => Slop.call(action, { app: P().app, kind: S.kind, ...(S.kind === 'prop' ? { ref: App.ws } : {}), ...args })

    async function loadTables() {
      const my = ++S.seq
      try { S.tables = (await call('sql', { query: TABLES, args: [] })).map(r => r.name); S.error = '' } catch (e) { S.tables = []; S.error = e.message || String(e) }
      if (my !== S.seq) return
      if (S.cur && !S.tables.includes(S.cur)) S.cur = null
      if (!S.cur && !S.query && !S.coll) S.cur = S.tables[0] || null
      if (S.cur) await loadRows(); else paint()
    }
    async function loadRows() {
      const my = ++S.seq
      // a table's rows carry their rowid, so one can be deleted (a table without one: read-only)
      const q = S.query || 'SELECT rowid AS __rowid, * FROM "' + S.cur + '" LIMIT 300'
      try { S.rows = await call('sql', { query: q, args: [] }); S.error = '' } catch (e) {
        if (!S.query) { try { S.rows = await call('sql', { query: 'SELECT * FROM "' + S.cur + '" LIMIT 300', args: [] }); S.error = '' } catch (e2) { S.rows = null; S.error = e2.message || String(e2) } }
        else { S.rows = null; S.error = e.message || String(e) }
      }
      if (my === S.seq) paint()
    }
    async function loadDocs() {
      const my = ++S.seq
      try { S.docs = await call('docs', { coll: S.coll }); S.error = '' } catch (e) { S.docs = null; S.error = e.message || String(e) }
      if (my === S.seq) paint()
    }
    function paint() {
      clear(tl); clear(head); clear(grid)
      if (!P()) return
      const kinds = [['dev', 'Draft', 'Your dev instance: the draft, what the canvas shows on draft'], ...(App.ws !== 'draft' ? [['prop', 'Proposal', 'The proposal\'s preview: what the canvas shows while you look at the proposal']] : []), ['test', 'Test', 'Your test instance: where the last scenario ran']]
      tl.appendChild(h('div.seg.sm', { style: { margin: '6px' } }, kinds.map(([k, l, t]) => h('button' + (S.kind === k ? '.on' : ''), { title: t, on: { click: () => { S.kind = k; S.cur = null; S.rows = null; S.docs = null; loadTables() } } }, l))))
      tl.appendChild(h('div.fi.dir', 'Tables'))
      for (const t of S.tables) tl.appendChild(h('button.fi' + (t === S.cur && !S.query && !S.coll ? '.on' : ''), { on: { click: () => { S.cur = t; S.query = ''; S.coll = ''; loadRows() } } }, t))
      if (!S.tables.length) tl.appendChild(h('div.note', { style: { padding: '0 10px' } }, 'No tables: the app has no migrations, or this instance has not run yet.'))
      tl.appendChild(h('div.fi.dir', 'Documents'))
      tl.appendChild(h('button.fi' + (S.coll ? '.on' : ''), { on: { click: async () => { const c = await promptBox('Documents', 'A collection of the app\'s db', S.coll || 'notes'); if (c) { S.coll = c; S.query = ''; loadDocs() } } } }, S.coll ? 'collection ' + S.coll : 'a collection…'))
      tl.appendChild(h('button.fi', { style: { color: 'var(--ink-2)' }, on: { click: async () => { const q = await promptBox('Query', 'Read-only SQL on this instance', S.query || 'SELECT * FROM ' + (S.cur || 'notes') + ' LIMIT 50'); if (q) { S.query = q; S.coll = ''; loadRows() } } } }, 'SQL query…'))

      put(head, h('b', S.coll ? 'collection ' + S.coll : S.query ? 'query' : S.cur || ''), h('span.tag', S.kind + ' instance'), h('span.sp'),
        h('div.rel', h('button.btn.sm', { title: 'Add a fixture\'s documents and rows to the dev instance', disabled: S.kind !== 'dev', on: { click: e => seedMenu(e.currentTarget) } }, 'Seed from fixture')),
        !S.coll && S.rows && S.rows.length && S.cur && !S.query ? h('button.btn.sm', { title: 'Save these rows in a fixture: scenarios can start from it', on: { click: saveFixture } }, 'Save as fixture') : null,
        h('button.btn.sm', { on: { click: () => (S.coll ? loadDocs() : loadTables()) } }, 'Refresh'),
        S.kind === 'dev' ? h('button.btn.sm.danger', { on: { click: () => App.resetDev().then(() => setTimeout(loadTables, 800)) } }, 'Reset dev data') : null)
      if (S.query) grid.appendChild(h('pre.mono.note', { style: { margin: '6px 10px' } }, S.query))
      if (S.error) { grid.appendChild(h('p.empty', { style: { color: 'var(--accent)' } }, S.error)); return }
      if (S.coll) {
        if (!S.docs) return
        if (!S.docs.length) { grid.appendChild(h('p.empty', 'No documents in ' + S.coll + '.')); return }
        grid.appendChild(h('div.rows', { style: { padding: '6px 10px' } }, S.docs.slice(0, 300).map(d => h('div', h('b.mono', d.path), h('span.mono.note', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, JSON.stringify(d.body))))))
        return
      }
      if (!S.rows) return
      if (!S.rows.length) { grid.appendChild(h('p.empty', 'No rows.')); return }
      const cols = [...new Set(S.rows.flatMap(r => Object.keys(r)))].filter(c => c !== '__rowid')
      // one row out of the instance's data (only an instance's: never the published app's)
      const del = r => async () => {
        if (!await confirmBox('Delete this row?', 'From ' + S.cur + ' in your ' + (S.kind === 'dev' ? 'dev' : S.kind === 'prop' ? 'proposal\'s preview' : 'test') + ' data: ' + cols.slice(0, 4).map(c => c + ' ' + cell(r[c]).slice(0, 30)).join(', '), 'Delete')) return
        try { await call('exec', { query: 'DELETE FROM "' + S.cur + '" WHERE rowid = ?', args: [r.__rowid] }); toast('Deleted the row'); loadRows(); if (S.kind === 'dev') App.reloadDev() } catch (e) { toast('Not deleted: ' + (e.message || e), 6000) }
      }
      const canDel = !S.query && S.rows.some(r => r.__rowid != null)
      grid.appendChild(h('table.grid.ro', h('thead', h('tr', cols.map(c => h('th', c)), canDel ? h('th', '') : null)), h('tbody', S.rows.map(r => h('tr', cols.map(c => h('td', cell(r[c]))), canDel ? h('td', h('button.link.note', { title: 'Delete this row', on: { click: del(r) } }, '✕')) : null)))))
      if (S.rows.length >= 300) grid.appendChild(h('p.note', { style: { padding: '0 10px' } }, 'The first 300 rows.'))
    }
    function seedMenu(btn) {
      const fx = fixtureList(P(), App.ws)
      popMenu(btn, [{ group: 'Fixtures (' + FIX_DIR + ')' }, ...fx.map(f => ({
        label: f.name, sub: f.error || f.parts.join(', ') || 'empty', disabled: !!f.error, run: async () => {
          try { await Slop.call('seed', { app: P().app, kind: 'dev', docs: f.spec.docs || {}, tables: f.spec.tables || {} }); toast('Seeded the dev instance from ' + f.name + '; the frames reload'); App.reloadDev(); loadTables() } catch (e) { toast('Not seeded: ' + (e.message || e), 5000) }
        }
      })), ...(fx.length ? [] : [{ note: 'No fixtures yet: save rows as one, or write fixtures/<name>.json.' }])])
    }
    async function saveFixture() {
      const n = await promptBox('Save as fixture', 'A fixture is data a test instance starts from. Rows of ' + S.cur + ' go into it (others it has stay). Name:', S.cur + '-sample')
      if (!n) return
      const path = fixturePath(n.replace(/[^\w-]/g, '-')), ex = P().read(path, App.ws)
      let spec = { description: '', docs: {}, tables: {} }
      if (ex) { try { spec = JSON.parse(ex) } catch { } }
      spec.tables = spec.tables || {}
      spec.tables[S.cur] = S.rows
      const bad = checkFixture(spec)
      if (bad) return toast(path + ': ' + bad)
      P().write(path, JSON.stringify(spec, null, 2) + '\n', App.ws)
      toast('Saved ' + plural(S.rows.length, 'row') + ' in ' + path)
    }
    const later = debounce(() => { if (Dock.visible('data')) loadTables() }, 300)
    App.ev.on('project', () => { S.cur = null; S.query = ''; S.coll = ''; S.kind = 'dev'; later() })
    // the data follows the workspace: a proposal's preview while you look at it, the draft's otherwise
    App.ev.on('ws', ws => { const k = ws === 'draft' ? 'dev' : 'prop'; if (S.kind !== 'test' && S.kind !== k) { S.kind = k; S.cur = null; S.rows = null; S.docs = null; later() } })
    App.ev.on('scenarios', () => { if (S.kind === 'test') later() })
    return { el, show: loadTables }
  }
}
