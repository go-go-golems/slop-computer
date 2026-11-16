// ---------- canvas: boards of live frames, pan and zoom, flows, pins, proposal rows (shop-next's app side) ----------
const SIZES = [{ w: 375, h: 720, n: 'Phone' }, { w: 768, h: 900, n: 'Tablet' }, { w: 1280, h: 800, n: 'Desktop' }]
registerView('canvas', {
  title: 'Canvas', sub: 'live frames',
  badge: () => { const n = App.health(); return n ? h('span.count.bad', String(n)) : null },
  make() {
    const C = { views: new Map(), z: 1, x: 40, y: 40, compare: false, flows: true, fitted: false }
    const world = h('div.world'), flows = svgEl('svg', { class: 'flows', width: 1, height: 1 })
    const hud = h('div.cvhud'), pop = h('div')
    const cv = h('div.cv', world, hud, pop)
    world.appendChild(flows)
    const zoomLbl = h('button.btn.sm', { title: 'Reset to 100%', on: { click: () => zoomTo(1) } }, '100%')
    const cmpBtn = h('button.btn.sm', { title: 'Show main and the proposal one above the other', on: { click: () => { C.compare = !C.compare; sync() } } }, 'Compare')
    const mxRoute = h('select.sel', { title: 'Page shown in every cell of the matrix', style: { height: '24px', fontSize: '11px' }, hidden: true, on: { change: () => { C.mxRoute = mxRoute.value; sync() } } })
    const mxBtn = h('button.btn.sm', { title: 'Matrix: one row per proposal (and main), one column per viewport', on: { click: () => { C.matrix = !C.matrix; C.fitted = false; sync() } } }, 'Matrix')
    const flowBtn = h('button.btn.sm.on', { title: 'Arrows for links between pages', on: { click: () => { C.flows = !C.flows; flowBtn.classList.toggle('on', C.flows); drawFlows() } } }, 'Flows')
    const bar = h('div.toolbar',
      h('div.rel', h('button.btn.sm', { on: { click: e => addFrameMenu(e.currentTarget) } }, '+ Frame')),
      h('span.lbl', 'Zoom'), h('button.btn.sm', { on: { click: () => zoomTo(C.z / 1.25) } }, '−'), zoomLbl, h('button.btn.sm', { on: { click: () => zoomTo(C.z * 1.25) } }, '+'),
      h('button.btn.sm', { on: { click: () => fit() } }, 'Fit'), h('span.sp'), mxRoute, mxBtn, cmpBtn, flowBtn,
      h('button.btn.sm', { title: 'Run layout and accessibility checks on every frame', on: { click: () => { for (const v of C.views.values()) v.host.runCheck(); toast('Checking frames…') } } }, 'Check'))
    const el = h('div', bar, cv)

    function apply() {
      world.style.transform = `translate(${C.x}px, ${C.y}px) scale(${C.z})`
      world.style.setProperty('--zb', (1 / C.z) + 'px')    // frame outlines stay one screen pixel at any zoom
      zoomLbl.textContent = Math.round(C.z * 100) + '%'; positionPop()
      for (const v of C.views.values()) v.scaleHead()
    }
    function zoomTo(z, cx, cy) {
      const r = cv.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2
      const nz = clamp(z, 0.1, 3), wx = (cx - C.x) / C.z, wy = (cy - C.y) / C.z
      C.z = nz; C.x = cx - wx * nz; C.y = cy - wy * nz; apply(); saveView()
    }
    function bounds() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const v of C.views.values()) { const p = v.pos(); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y - 30); x1 = Math.max(x1, p.x + v.fr.w); y1 = Math.max(y1, p.y + v.fr.h) }
      return isFinite(x0) ? { x0, y0, x1, y1 } : null
    }
    function fit() {
      const b = bounds(), r = cv.getBoundingClientRect(); if (!b || !r.width) { C.fitted = false; return }
      const z = clamp(Math.min((r.width - 60) / (b.x1 - b.x0), (r.height - 60) / (b.y1 - b.y0)), 0.1, 1.2)
      C.z = z; C.x = (r.width - (b.x1 - b.x0) * z) / 2 - b.x0 * z; C.y = (r.height - (b.y1 - b.y0) * z) / 2 - b.y0 * z; apply(); saveView()
    }
    const saveView = debounce(() => { const P = App.P; if (P) { P.meta.view = { x: C.x, y: C.y, z: C.z }; P.saveMeta() } }, 800)

    // pan: drag the background; wheel pans, ctrl/cmd+wheel (or pinch) zooms
    cv.addEventListener('pointerdown', e => {
      if (e.target !== cv && e.target !== world && e.target !== flows) return
      if (e.button !== 0 && e.button !== 1) return
      e.preventDefault(); cv.setPointerCapture(e.pointerId); cv.classList.add('panning'); document.body.classList.add('moving')
      const sx = e.clientX - C.x, sy = e.clientY - C.y
      const move = ev => { C.x = ev.clientX - sx; C.y = ev.clientY - sy; apply() }
      const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.classList.remove('panning'); document.body.classList.remove('moving'); saveView() }
      cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up)
      closePop()
    })
    cv.addEventListener('wheel', e => {
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomTo(C.z * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top)
      else { C.x -= e.deltaX; C.y -= e.deltaY; apply(); saveView() }
    }, { passive: false })

    // ---- frames ----
    function frameView(fr, role, ws) {
      const P = App.P
      const host = new FrameHost({ project: P, route: fr.route, w: fr.w, h: fr.h, ws, fid: fr.id + (role === 'p' ? ':p' : ''), fixture: fr.fixture || null, at: role === 'a' ? App.playhead : null })
      const routeSel = h('select.route', { title: 'Page in this frame', on: { change: () => { if (host.rec) host.recStep({ go: routeSel.value }); else if (role === 'a') { fr.route = routeSel.value; App.P.saveMeta() } host.navigate(routeSel.value) } } })
      const back = h('button.fact', { title: 'Back to this frame\'s page', hidden: true, on: { click: () => host.navigate(fr.route) } }, '↩')
      const meta = h('span.meta'), status = h('div.fstatus', { hidden: true }), flabel = h('b.flabel', { title: 'Double-click the header to rename' })
      const fxTag = h('span.tag.fx', { hidden: true, title: 'This frame runs against a fixture, not the live data', on: { click: e => frameMenu(e.currentTarget, v) } })
      const recBar = h('div.recbar', { hidden: true })
      const v = { fr, role, host, el: null, pos: () => role === 'p' ? { x: v.fr.x, y: v.fr.y + C.rowH + 110 } : { x: v.fr.x, y: v.fr.y } }
      const head = h('div.fh', flabel, routeSel, meta, h('span.sp'),
        role === 'p' ? h('span.tag.ws', 'proposal') : null, fxTag, back,
        role === 'a' ? h('div.rel', h('button.fact', { title: 'Viewport size', on: { click: e => sizeMenu(e.currentTarget, fr) } }, '⇔')) : null,
        role !== 'm' ? h('button.fact', { title: 'Data, snapshots, recording', on: { click: e => frameMenu(e.currentTarget, v) } }, '⋯') : null,
        h('button.fact', { title: 'Reload', on: { click: () => host.load({ keepState: false }) } }, '↻'),
        role === 'a' ? h('button.fact', { title: 'Close frame', on: { click: () => App.P.removeFrame(fr.id) } }, '×') : null)
      const body = h('div.fb', host.el, status, recBar)
      v.el = h('div.frm' + (ws !== 'main' ? '.prop' : '') + (role === 'm' ? '.mx' : ''), head, body)
      v.scaleHead = () => { const k = clamp(1 / C.z, 0.6, 6); head.style.transform = 'scale(' + k + ')'; head.style.width = fr.w / k + 'px' }
      v.paint = () => {
        const p = v.pos(); Object.assign(v.el.style, { left: p.x + 'px', top: p.y + 'px', width: v.fr.w + 'px' })
        clear(routeSel); for (const r of App.P.list(host.ws).filter(x => /\.html?$/.test(x))) routeSel.appendChild(h('option', { value: r, selected: r === host.route }, r))
        routeSel.hidden = role === 'm'
        if (![...routeSel.options].some(o => o.value === host.route)) routeSel.appendChild(h('option', { value: host.route, selected: true }, host.route + ' (missing)'))
        back.hidden = role === 'm' || host.route === v.fr.route; back.title = 'Back to ' + v.fr.route
        flabel.textContent = v.fr.label || ''; flabel.hidden = !v.fr.label; routeSel.classList.toggle('sub', !!fr.label)
        meta.textContent = v.fr.w + '×' + v.fr.h + (host.errors ? ' · ' + plural(host.errors, 'error') : '') + (host.issues.length ? ' · ' + plural(host.issues.length, 'issue') : '')
        meta.style.color = host.errors || host.issues.length ? 'var(--accent)' : ''
        v.el.classList.toggle('past', host.at != null)
        fxTag.hidden = !host.fixture && !host.rec; fxTag.textContent = host.rec ? 'recording' : host.fixture ? 'fixture: ' + host.fixture : ''; fxTag.title = host.rec ? 'Recording on a copy of the data' : 'Runs on fixtures/' + host.fixture + '.json instead of the live data (click to change)'
        recBar.hidden = !host.rec
        if (host.rec) put(clear(recBar), h('span.dot'), h('b', 'Recording'), h('span', plural(host.rec.steps.length, 'step') + (host.rec.steps.length ? ' · last: ' + stepLabel(host.rec.steps[host.rec.steps.length - 1]).slice(0, 48) : ' · click and type in Play mode; pick an element in Select mode to check its text')), h('span.sp'),
          h('button.btn.sm', { on: { click: async () => { await host.stopRecording(); v.paint() } } }, 'Discard'),
          h('button.btn.sm.primary', { on: { click: async () => { const r = await host.stopRecording(); v.paint(); await saveRecording(App.P, r, host.ws) } } }, 'Stop and save'))
        status.hidden = !host.errors; status.textContent = host.errors ? (host.logs.filter(l => l.level === 'error').slice(-1)[0] || {}).text || '' : ''
        v.el.classList.toggle('sel', !!App.sel && App.sel.fid === host.fid)
        v.scaleHead()
      }
      host.ev.on('rec', () => v.paint()); host.ev.on('issues', () => { v.paint(); Dock.refreshTabs() }); host.ev.on('log', l => { if (l.level === 'error') v.paint() })
      host.ev.on('nav', () => { v.paint(); drawFlows() })   // following a link is temporary: the frame keeps its page (↩ goes back)
      head.addEventListener('dblclick', async e => {
        if (e.target.closest('button, select') || role !== 'a') return
        const n = await promptBox('Label this frame', 'A name shown above the frame (empty to clear)', fr.label || ''); if (n === null) return
        fr.label = n || undefined; App.P.saveMeta(); v.paint()
      })
      // drag the header to move the frame
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button, select') || role !== 'a') return
        e.preventDefault(); head.setPointerCapture(e.pointerId); document.body.classList.add('moving')
        const sx = e.clientX, sy = e.clientY, x0 = fr.x, y0 = fr.y
        const move = ev => { fr.x = Math.round(x0 + (ev.clientX - sx) / C.z); fr.y = Math.round(y0 + (ev.clientY - sy) / C.z); v.paint(); for (const o of C.views.values()) if (o.fr === fr && o !== v) o.paint(); drawFlows() }
        const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); document.body.classList.remove('moving'); layoutRows(); App.P.saveMeta() }
        head.addEventListener('pointermove', move); head.addEventListener('pointerup', up)
      })
      world.appendChild(v.el); v.paint(); host.load()
      return v
    }
    function layoutRows() { const fs = App.P && !C.matrix ? App.P.board().frames : []; C.rowH = fs.reduce((m, f) => Math.max(m, f.y + f.h), 0); for (const v of C.views.values()) v.paint(); drawFlows() }
    function sync() {
      const P = App.P, props = P ? P.openOverlays() : []
      mxBtn.hidden = !P || !props.length; if (mxBtn.hidden) C.matrix = false
      mxBtn.classList.toggle('on', !!C.matrix); mxRoute.hidden = !C.matrix
      cmpBtn.hidden = !P || App.ws === 'main' || C.matrix; cmpBtn.classList.toggle('on', C.compare && App.ws !== 'main')
      const want = new Map()
      if (P && C.matrix) {
        // one row per workspace (main, then each open proposal), one column per viewport the board uses
        const routes = [...new Set([...P.list('main'), ...props.flatMap(o => P.list(o.id))].filter(x => /\.html?$/.test(x)))]
        if (!routes.includes(C.mxRoute)) C.mxRoute = (App.sel && routes.includes(App.sel.route) && App.sel.route) || (P.board().frames[0] || {}).route || routes[0]
        clear(mxRoute); for (const r of routes) mxRoute.appendChild(h('option', { value: r, selected: r === C.mxRoute }, r))
        const sizes = [...new Map(P.board().frames.map(f => [f.w + 'x' + f.h, { w: f.w, h: f.h }])).values()].sort((a, b) => a.w - b.w)
        if (!sizes.length) sizes.push({ w: 375, h: 720 })
        const rowH = Math.max(...sizes.map(s => s.h)) + 120
        ;[{ id: 'main', title: 'main' }, ...props].forEach((o, r) => {
          let x = 0
          for (const sz of sizes) {
            const key = 'mx|' + o.id + '|' + sz.w + 'x' + sz.h + '|' + C.mxRoute
            want.set(key, { role: 'm', ws: o.id, fr: { id: 'mx:' + o.id + ':' + sz.w + 'x' + sz.h, route: C.mxRoute, w: sz.w, h: sz.h, x, y: r * rowH, label: (o.id === 'main' ? 'main' : o.title) + ' · ' + sz.w + 'px' } })
            x += sz.w + 60
          }
        })
      } else if (P) for (const fr of P.board().frames) {
        const past = App.playhead != null
        want.set(fr.id + '|a', { fr, role: 'a', ws: past || (C.compare && App.ws !== 'main') ? 'main' : App.ws })
        if (!past && C.compare && App.ws !== 'main') want.set(fr.id + '|p', { fr, role: 'p', ws: App.ws })
      }
      for (const [k, v] of C.views) {
        const w = want.get(k)
        if (!w || v.host.ws !== w.ws || v.host.project !== P) { v.host.dispose(); v.el.remove(); C.views.delete(k) }
        else { if (w.role === 'm') v.fr = w.fr; if (v.host.w !== w.fr.w || v.host.h !== w.fr.h) { v.host.size(w.fr.w, w.fr.h); v.host.load() } }
      }
      for (const [k, w] of want) if (!C.views.has(k)) C.views.set(k, frameView(w.fr, w.role, w.ws))
      layoutRows(); hudPaint()
      if (P && !C.fitted) { C.fitted = true; if (P.meta.view) { Object.assign(C, P.meta.view); apply() } else requestAnimationFrame(fit) }
    }
    function drawFlows() {
      clear(flows); if (!C.flows || !App.P) return
      const P = App.P, prim = [...C.views.values()].filter(v => v.role === 'a'), first = new Map()
      for (const v of prim) if (!first.has(v.host.route)) first.set(v.host.route, v)
      flows.appendChild(svgEl('defs', {}, svgEl('marker', { id: 'arr', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--ink-2)' }))))
      const seen = new Set()
      for (const v of first.values()) {
        const html = P.read(v.host.route, v.host.ws) || ''
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+\.html?)/gi)) {
          const to = first.get(m[1]); if (!to || to === v || seen.has(v.host.route + '>' + m[1])) continue
          seen.add(v.host.route + '>' + m[1])
          const a = v.pos(), b = to.pos(), right = b.x > a.x
          const x1 = right ? a.x + v.fr.w : a.x, y1 = a.y + 30 + Math.min(80, v.fr.h / 4), x2 = right ? b.x : b.x + to.fr.w, y2 = b.y + 30 + Math.min(80, to.fr.h / 4)
          const back = seen.has(m[1] + '>' + v.host.route)
          flows.appendChild(svgEl('path', { d: `M${x1},${y1 + (back ? 24 : 0)} C${x1 + (right ? 30 : -30)},${y1 + (back ? 24 : 0)} ${x2 + (right ? -30 : 30)},${y2 + (back ? 24 : 0)} ${x2},${y2 + (back ? 24 : 0)}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 / Math.max(C.z, 0.3), 'stroke-dasharray': back ? '4 4' : null, 'marker-end': 'url(#arr)' }))
        }
      }
    }
    // move every primary frame to the playhead; while a step is loading, only the latest one is kept
    let phBusy = false, phNext = undefined
    async function playhead() {
      if (phBusy) { phNext = App.playhead; return }
      phBusy = true
      try {
        const at = App.playhead
        await Promise.all([...C.views.values()].filter(v => v.role === 'a' && v.host.at !== at).map(v => { v.host.at = at; v.host.fx = null; v.host.saved = null; return v.host.load({ keepState: false }).then(() => v.paint()) }))
      } finally { phBusy = false }
      hudPaint()
      if (phNext !== undefined) { phNext = undefined; playhead() }
    }
    C.playhead = playhead
    function hudPaint() {
      clear(hud)
      if (App.playhead != null && App.P) {
        const P = App.P, e = P.events[App.playhead] || {}, pe = App.pageEvents(P), k = pe.findIndex(x => x.i >= App.playhead)
        const step = d => { const list = App.pageEvents(P), j = d < 0 ? [...list].reverse().find(x => x.i < App.playhead) : list.find(x => x.i > App.playhead); if (j) App.setPlayhead(j.i); else if (d > 0) App.setPlayhead(null) }
        hud.append(h('span.chip.on.past', 'as of ' + fmtTime(e.t)), h('span.note', (e.kind === 'write' ? (e.created ? 'created ' : 'wrote ') + e.path : e.kind === 'remove' ? 'removed ' + e.path : e.label || e.note || e.kind) + (e.who === 'agent' ? ' · Claude' : '')),
          h('button.btn.sm', { title: 'Previous change to the pages', on: { click: () => step(-1) } }, '◀'), h('button.btn.sm', { title: 'Next change to the pages', on: { click: () => step(1) } }, '▶'),
          h('button.btn.sm.primary', { title: 'Back to the pages as they are now', on: { click: () => App.setPlayhead(null) } }, 'Now'))
        return
      }
      hud.append(h('span.chip.on', App.mode), h('span.chip', App.ws === 'main' ? 'main' : 'proposal: ' + ((App.P && App.P.overlays.get(App.ws)) || {}).title))
      if (App.mode === 'select') hud.append(h('span.note', 'click to select · double-click text to edit'))
      if (App.mode === 'comment') hud.append(h('span.note', 'click to drop a pin'))
    }
    function addFrameMenu(btn) {
      const P = App.P; if (!P) return
      const routes = P.list(App.ws).filter(x => /\.html?$/.test(x)), items = []
      for (const r of routes) { items.push({ group: r }); for (const s of SIZES) items.push({ label: s.n + ' ' + s.w + '×' + s.h, run: () => { const f = P.addFrame({ route: r, w: s.w, h: s.h }); setTimeout(() => focusFrame(f.id), 50) } }) }
      popMenu(btn, items)
    }
    // the frame's ⋯ menu: which data it runs against, snapshots and comparisons, recording a scenario
    function frameMenu(btn, v) {
      const P = App.P, host = v.host, fr = v.fr, fxs = fixtureList(P, host.ws)
      const snaps = Snaps.list(P).filter(s => s.route === host.route && s.w === fr.w).slice(-6).reverse()
      const items = [{ group: 'Data' },
        { label: 'Live data', sub: host.ws === 'main' ? 'main' : 'this proposal', on: !host.fixture, disabled: !!host.rec, run: () => setFx(v, null) },
        ...fxs.map(x => ({ label: 'Fixture: ' + x.name, sub: x.error ? 'invalid JSON' : [x.tables.join(', '), x.clock ? 'clock ' + x.clock : ''].filter(Boolean).join(' · '), on: host.fixture === x.name, disabled: !!x.error || !!host.rec, run: () => setFx(v, x.name) })),
        host.fixture ? { label: 'Reset fixture data', sub: 'undo what the page changed', run: () => host.resetData() } : null,
        { label: 'New fixture from live data…', run: async () => { const n = await promptBox('New fixture', 'Saves a copy of the current tables as fixtures/<name>.json; edit it to make edge cases (empty, long names, many rows).', 'sample'); if (!n) return
          const tables = {}; for (const [k, t] of P.tablesIn(host.ws)) tables[k] = t.rows
          const name = n.replace(/[^\w-]/g, '-'); P.write(fixturePath(name), JSON.stringify({ description: '', tables, clock: null }, null, 2) + '\n', { ws: host.ws, who: 'you', note: 'new fixture' }); setFx(v, name); App.code && App.code.open(fixturePath(name)) } },
        { hr: true }, { group: 'Snapshots' },
        { label: 'Take snapshot', sub: 'a frozen copy of the page and its layout', run: async () => { const m = await Snaps.take(P, host, { label: (fr.label || host.route) + ' ' + fmtTime(now()) }); if (m) toast('Snapshot of ' + host.route + ' kept') } },
        ...snaps.map(s => ({ label: 'Compare with ' + (s.label || fmtTime(s.t)), sub: s.ws !== host.ws ? s.ws === 'main' ? 'main' : 'proposal' : s.note || '', run: () => compareWithSnap(v, s) })),
        App.ws !== 'main' ? { label: 'Compare main with this proposal', sub: 'layout differences on ' + host.route, run: () => compareWs(v, 'main', App.ws) } : null,
        { hr: true }, { group: 'Scenarios' },
        host.rec ? { label: 'Stop recording…', run: async () => { const r = await host.stopRecording(); v.paint(); await saveRecording(P, r, host.ws) } }
          : { label: 'Record a scenario', sub: 'on a copy of the data; replays with Run', disabled: role(v) === 'm', run: async () => { if (App.mode !== 'play') App.setMode('play'); await host.startRecording(fr); v.paint() } }]
      popMenu(btn, items, { right: true })
    }
    const role = v => v.role
    function setFx(v, name) { v.fr.fixture = name || undefined; App.P.saveMeta(); for (const o of C.views.values()) if (o.fr === v.fr) o.host.setFixture(name).then(() => o.paint()); App.P.log({ kind: 'canvas', ws: 'main', who: 'you', note: (v.fr.label || v.fr.route) + (name ? ' runs on fixture ' + name : ' runs on live data') }) }
    async function compareWithSnap(v, s) {
      const P = App.P, doc = await Snaps.load(P, s.id); if (!doc) return toast('That snapshot is gone')
      const cur = await Snaps.capture(v.host), diff = layoutDiff(doc.layout, cur.layout)
      compareModal(P, v.host.route + ': ' + (s.label || fmtTime(s.t)) + ' → now', { label: s.label || fmtTime(s.t), doc, meta: s }, { label: 'now', doc: cur, meta: cur }, diff)
    }
    async function compareWs(v, a, b) {
      const P = App.P, fr = { ...v.fr, route: v.host.route }
      try {
        const A = (await layoutIn(P, fr, a, { headless: true })).fh, B = (await layoutIn(P, fr, b, { headless: true })).fh
        const [sa, sb] = [await Snaps.capture(A), await Snaps.capture(B)]
        const title = t => t === 'main' ? 'main' : 'proposal: ' + ((P.overlays.get(t) || {}).title || t)
        compareModal(P, v.host.route + ' ' + fr.w + 'px: ' + title(a) + ' → ' + title(b), { label: title(a), doc: sa, meta: sa }, { label: title(b), doc: sb, meta: sb }, layoutDiff(sa.layout, sb.layout))
      } catch (e) { toast('Could not compare: ' + e.message) }
    }
    C.compareWs = (fid, a, b) => { const v = [...C.views.values()].find(x => x.fr.id === fid && x.role === 'a'); if (v) return compareWs(v, a, b) }
    function sizeMenu(btn, fr) {
      popMenu(btn, SIZES.map(s => ({ label: s.n, sub: s.w + '×' + s.h, on: fr.w === s.w && fr.h === s.h, run: () => { fr.w = s.w; fr.h = s.h; App.P.saveMeta(); App.P.ev.emit('frames') } })), { right: true })
    }
    function focusFrame(fid) {
      const v = [...C.views.values()].find(x => x.host.fid === fid || x.fr.id === fid); if (!v) return
      const r = cv.getBoundingClientRect(), p = v.pos()
      const vis = p.x * C.z + C.x > 0 && (p.x + v.fr.w) * C.z + C.x < r.width && p.y * C.z + C.y > 0
      if (!vis) { C.x = r.width / 2 - (p.x + v.fr.w / 2) * C.z; C.y = 50 - (p.y - 30) * C.z; apply(); saveView() }
    }

    // ---- pins popover ----
    let popState = null
    function closePop() { clear(pop); popState = null }
    function positionPop() {
      if (!popState) return
      const v = [...C.views.values()].find(x => x.host === popState.host); if (!v) return closePop()
      const p = v.pos(), box = pop.firstChild; if (!box) return
      box.style.left = clamp((p.x + popState.x) * C.z + C.x + 14, 4, cv.clientWidth - 270) + 'px'; box.style.top = clamp((p.y + popState.y) * C.z + C.y - 10, 4, cv.clientHeight - 140) + 'px'
    }
    C.newPin = (host, m) => {
      closePop()
      const ta = h('textarea.txt', { placeholder: 'What should change here?' })
      const save = () => {
        const text = ta.value.trim(); if (!text) return closePop()
        const P = App.P, n = (P.meta.pins || []).reduce((a, p) => Math.max(a, p.n), 0) + 1
        P.meta.pins.push({ id: 'pin' + uid(), n, route: host.route, src: m.info.src, selector: m.info.selector, rx: +m.rx.toFixed(3), ry: +m.ry.toFixed(3), text, by: 'you', t: now(), resolved: false })
        P.saveMeta(); P.log({ kind: 'pin', who: 'you', ws: 'main', note: '#' + n + ' ' + text.slice(0, 100), path: m.info.src.split(':')[0] }); App.ev.emit('pins'); closePop()
      }
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') closePop() })
      pop.appendChild(h('div.pinpop', h('b', 'Pin on ' + (m.info.tag || 'element') + ' '), h('span.note', m.info.src || host.route), ta,
        h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm.primary', { on: { click: save } }, 'Save pin'), h('button.btn.sm', { on: { click: closePop } }, 'Cancel'), h('span.sp'), h('span.note', '⌘↵'))))
      popState = { host, x: m.x, y: m.y }; positionPop(); setTimeout(() => ta.focus(), 20)
    }
    C.showPin = (id, host) => {
      const P = App.P, p = (P.meta.pins || []).find(x => x.id === id); if (!p) return
      closePop()
      pop.appendChild(h('div.pinpop', h('b', '#' + p.n + ' '), h('span.note', (p.by === 'you' ? 'You' : p.by) + ' · ' + fmtAgo(p.t) + (p.resolved ? ' · resolved' : '')),
        h('div', { style: { whiteSpace: 'pre-wrap' } }, p.text), p.reply ? h('div.note', '↳ ' + p.reply) : null,
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          !p.resolved ? h('button.btn.sm', { on: { click: () => { App.askAgent('Address pin #' + p.n + ' on ' + p.route + ': ' + p.text); closePop() } } }, 'Ask agent') : null,
          h('button.btn.sm', { on: { click: () => { p.resolved = !p.resolved; P.saveMeta(); App.ev.emit('pins'); closePop() } } }, p.resolved ? 'Reopen' : 'Resolve'),
          h('button.btn.sm.danger', { on: { click: () => { P.meta.pins = P.meta.pins.filter(x => x !== p); P.saveMeta(); App.ev.emit('pins'); closePop() } } }, 'Delete'),
          h('span.sp'), h('button.btn.sm', { on: { click: closePop } }, 'Close'))))
      const hostRef = host || [...C.views.values()].find(v => v.host.route === p.route)?.host
      if (!hostRef) return
      popState = { host: hostRef, x: hostRef.w * 0.5, y: 40 }; positionPop()
    }
    C.sync = sync; C.paintAll = () => { for (const v of C.views.values()) v.paint(); hudPaint() }; C.focusFrame = focusFrame; C.fit = fit; C.zoomTo = zoomTo
    C.hostsFor = fid => [...C.views.values()].filter(v => v.fr.id === fid).map(v => v.host)
    C.hostFor = fid => { for (const v of C.views.values()) if (v.fr.id === fid && v.role === 'a') return v.host; return null }
    C.reset = () => { for (const v of C.views.values()) { v.host.dispose(); v.el.remove() } C.views.clear(); C.fitted = false; C.compare = false; closePop() }
    App.canvas = C
    return { el, show: () => { if (!C.fitted) sync() } }
  }
})
