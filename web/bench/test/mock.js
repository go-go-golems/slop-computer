// mock window.claude for local tests: db (with path grammar checks), user, sample (scripted tool loop)
(() => {
  const store = new Map(), calls = []
  const seg = p => { const s = p.split('/'); for (const x of s) if (!/^[A-Za-z0-9_\-.~:@+]+$/.test(x) || x === '.' || x === '..') throw new TypeError('bad segment "' + x + '" in ' + p); if (s.length > 16) throw new TypeError('too deep ' + p); return s }
  const snap = (p, d) => ({ id: p.split('/').pop(), exists: d !== undefined, data: () => d === undefined ? undefined : JSON.parse(JSON.stringify(d)), metadata: { fromCache: false, hasPendingWrites: false } })
  const doc = p => { if (seg(p).length % 2) throw new TypeError('doc path needs even segments: ' + p); return {
    id: p.split('/').pop(), path: p,
    get: async () => { calls.push(['get', p]); return snap(p, store.get(p)) },
    set: async d => { calls.push(['set', p]); if (JSON.stringify(d).length > 262144) throw { code: 'invalid_argument', message: 'too big' }; store.set(p, JSON.parse(JSON.stringify(d))) },
    update: async d => { if (!store.has(p)) throw { code: 'invalid_argument' }; store.set(p, { ...store.get(p), ...d }) },
    delete: async () => { calls.push(['del', p]); store.delete(p) },
    collection: c => coll(p + '/' + c) } }
  const coll = p => { if (seg(p).length % 2 === 0) throw new TypeError('collection path needs odd segments: ' + p); const q = {
    path: p, limit: () => q, where: () => q, orderBy: () => q,
    get: async () => { const docs = [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).sort().map(k => snap(k, store.get(k))); return { docs, size: docs.length, empty: !docs.length } },
    doc: id => doc(p + '/' + (id || Math.random().toString(36).slice(2))) }; return q }
  const db = { doc, collection: coll }
  const user = { id: async () => 'user-1', can: async () => true, canEdit: async () => true, isOwner: async () => true }
  const script = [
    `const fl = await files.list(); const c = await frames.check(); return { files: fl.map(f => f.path), c }`,
    `const fs = await frames.list(); const menu = fs.find(f => f.route === 'menu.html'); return await frames.check(menu.id)`,
    `return await files.replace('styles.css', '.cats { display: flex; gap: 8px; margin-bottom: 12px; }', '.cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }')`,
    `const fs = await frames.list(); const menu = fs.find(f => f.route === 'menu.html'); const r = await frames.check(menu.id); await session.mark('cats wrap'); return r`,
    `while (true) {}`
  ]
  const ROLE_SCRIPTS = {
    explorer: [["return (await files.list()).filter(f => f.path.endsWith('.html')).length"], 'Counted the routes.\n{"pages": 4}'],
    reviewer: [["return await session.workspace()", "return await frames.check()"], '{"verdict": "approve", "comments": "small, safe change"}'],
    qa: [["return await scenarios.runAll()",
          "await scenarios.save('qa-menu-lists-all', { description: 'every menu row is listed', page: 'menu.html', steps: [{ waitFor: '#items li' }, { expect: '#items li', count: (await data.rows('menu')).length }] })\nreturn await scenarios.run('qa-menu-lists-all')",
          "return await files.write('qa.css', 'a {}')",
          "const fs = await frames.list(); const m = fs.find(f => f.route === 'menu.html'); return await ui.pin(m.id, '#cats', 'category buttons overflow at 375px')"],
      '{"pins": 1, "scenarios": {"passed": 1, "failed": 0, "added": 1}, "summary": "one overflow on the menu; added a scenario for the menu list"}'],
    builder: [["return await files.replace('styles.css', '.logo {', '.logo { letter-spacing: .04em;')"], 'Spaced the logo out in `styles.css:31`.']
  }
  async function sample(input, opts = {}) {
    const last = Array.isArray(input) ? input[input.length - 1].content : input
    const all = Array.isArray(input) ? input.map(m => m.content).join('\n') : String(input)
    window.__samples = (window.__samples || 0) + 1
    if (!opts.tools && /running summary of a conversation/.test(all) && window.__noSummary) return { text: "" }
    if (!opts.tools && /running summary of a conversation/.test(all)) { window.__summaryPrompts = (window.__summaryPrompts || []).concat([all]); await new Promise(r => setTimeout(r, 30)); const nums = [...all.matchAll(/\[(\d+)\] Person: ([^\n]{0,40})/g)].map(m => m[2]); return { text: '**Goals**\n- ' + nums.join('\n- ') + '\n\n**Done**\n- summarized by the mock (' + nums.length + ' requests)' } }
    if (!opts.tools) { await new Promise(r => setTimeout(r, 20)); return { text: /Reply with JSON/.test(all) ? (/"yes"\|"no"/.test(all) ? '"yes"' : '{"answer": "yes"}') : 'Yes.' } }
    const rm = /You are the (\w+) subagent/.exec(all)
    if (rm && ROLE_SCRIPTS[rm[1]]) {
      const [codes, reply] = ROLE_SCRIPTS[rm[1]], tool = opts.tools[0], outs = []
      for (const code of codes) { outs.push(await tool.execute({ code })); await new Promise(r => setTimeout(r, 20)) }
      window.__childOuts = (window.__childOuts || []).concat(outs)
      return { text: reply }
    }
    window.__lastPrompt = last
    window.__lastInput = input
    if (/^CHAT \d+/m.test(last.split('The person says:\n').pop())) { const n = /CHAT (\d+)/.exec(last.split('The person says:\n').pop())[1]; const tool = opts.tools[0]; await tool.execute({ code: "return (await files.list()).length // chat " + n }); return { text: 'Reply ' + n + ': ' + 'lorem ipsum dolor sit amet '.repeat(90).trim() + ' end ' + n + '.' } }
    const tool = (opts.tools || [])[0], log = []
    let text = ''
    const PANEL = [
      "await fixtures.save('two-items', { tables: { menu: [{ id: 1, name: 'Flat white', desc: 'x', price: 4.2, cat: 'coffee' }, { id: 2, name: 'Scone', desc: 'y', price: 3, cat: 'bakery' }] } })\nawait data.insert('orders', { name: 'Bo', items: '1× Scone', total: 3, status: 'ready' })\nreturn await ui.panel('menu-tuning', { title: 'Menu tuning', description: 'try values, then Keep', items: [\n  { type: 'slider', id: 'gap', label: 'Category gap', min: 0, max: 24, step: 1, bind: { style: { selector: '.cats', prop: 'gap' }, unit: 'px' } },\n  { type: 'color', id: 'crema', label: 'Accent', bind: { cssVar: '--crema' } },\n  { type: 'toggle', id: 'short', label: 'Short menu fixture', bind: { fixture: { on: 'two-items', frames: ['menu.html'] } } },\n  { type: 'slider', id: 'markup', label: 'Price markup', min: 1, max: 1.5, step: 0.05, value: 1 },\n  { type: 'value', label: 'Average price after markup', unit: ' $', from: { eval: 'const r = await data.rows(\"menu\"); return Math.round(r.reduce((a, x) => a + x.price, 0) / r.length * values.markup * 100) / 100' } },\n  { type: 'value', label: 'In the cart', from: { store: 'cart', count: true } },\n  { type: 'chart', kind: 'bar', label: 'Orders by status', from: { data: 'orders', group: 'status' } },\n  { type: 'chart', kind: 'line', label: 'Check issues', from: { issues: true } },\n  { type: 'table', label: 'Scenarios', from: { scenarios: true } },\n  { type: 'button', label: 'Count menu rows', run: 'return { rows: (await data.rows(\"menu\")).length, markup: values.markup }' } ] })"
    ]
    const steps = /PANEL TEST/.test(last) ? PANEL : /ASK TEST/.test(last) ? ["const v = await ui.ask('pick', { title: 'Pick a direction', items: [{ type: 'select', id: 'dir', label: 'Direction', options: ['editorial', 'playful'] }, { type: 'text', id: 'note', label: 'Anything else' }] }, { label: 'Use this' })\nawait session.mark('picked ' + v.dir, { kind: 'decision' })\nreturn v"] : /loop forever/.test(last) ? [script[4]] : /DELEGATE TEST/.test(last) ? ["const r = await delegate('explorer', 'How many pages?', { output: s.object({ pages: s.int() }) })\nawait session.mark('counted pages', { kind: 'decision', why: 'explorer said ' + r.result.pages })\nreturn r.result"] : script.slice(0, 4)
    for (const code of steps) {
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' })
      opts.onText && opts.onText({ text: text = 'Working… (' + log.length + ')' })
      const out = await tool.execute({ code }); log.push(out)
      await new Promise(r => setTimeout(r, 30))
    }
    window.__toolLog = log
    return { text: '### Fixed the menu overflow\n\nThe category buttons now **wrap** instead of running off the edge at 375px.\n\n- Added `flex-wrap: wrap` to `.cats` in `styles.css:73`\n- The buttons live at menu.html:19\n  - nested note with *emphasis*\n\n| Frame | Before | After |\n|---|---|---|\n| menu 375px | 1 issue | 0 |\n\n```css\n.cats { display: flex; flex-wrap: wrap; }\n```\n\n> Still open: the buttons have a fixed `min-width`.', truncated: false, modelApplied: opts.model || opts.modelTier }
  }
  sample.json = async () => ({})
  window.__mock = { store, calls }
  window.claude = { use: async name => { await new Promise(r => setTimeout(r, 50)); return name === 'db' ? db : name === 'user' ? user : name === 'sample' ? sample : null } }
})()
