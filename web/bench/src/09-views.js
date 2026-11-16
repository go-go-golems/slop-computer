// ---------- code view: file list, tabs, editor with highlighting; edits write to the current workspace ----------
registerView('code', {
  title: 'Code', sub: 'files',
  make() {
    const S = { tabs: [], cur: null, filter: '', pending: null, hiLine: 0 }
    const list = h('div.fl'), filter = h('input.txt', { placeholder: 'Filter files', style: { margin: '6px', width: 'calc(100% - 12px)' }, on: { input: () => { S.filter = filter.value.toLowerCase(); paintList() } } })
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Files'), h('span.sp'), h('button.btn.sm', { title: 'New file', on: { click: newFile } }, '+ New')), filter, list)
    const tabs = h('div.ftabs')
    const gin = h('div.gin'), gutter = h('div.egutter', gin), bin = h('div.bin'), bcol = h('div.eblame', { hidden: true }, bin)
    const pre = h('pre'), band = h('div', { style: { position: 'absolute', left: 0, right: 0, height: '18px', background: 'var(--sel)', pointerEvents: 'none', display: 'none' } })
    const ta = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off' })
    const code = h('div.code', band, pre, ta), ed = h('div.ed', bcol, gutter, code)
    const prev = h('div.mdprev', { hidden: true }), edrow = h('div.edrow', ed, prev)
    S.view = {}
    const isMd = p => /\.(md|markdown)$/i.test(p || '')
    const mdMode = () => isMd(S.cur) ? (S.view[S.cur] || (main.clientWidth >= 640 ? 'split' : 'code')) : 'code'
    function paintPreview() {
      const m = mdMode()
      prev.hidden = m === 'code'; ed.hidden = m === 'preview'
      if (m === 'code') return
      const st = prev.scrollTop
      clear(prev).appendChild(renderMarkdown(ta.value, f => !!P() && P().read(f, App.ws) !== null, { doc: true }))
      prev.scrollTop = st
    }
    const previewSoon = debounce(paintPreview, 150)
    prev.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (r) { e.preventDefault(); isMd(r.dataset.file) ? open(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1) } })
    const foot = h('div.efoot'), empty = h('p.empty', 'Open a file from the list, or select an element on the canvas to jump to its source.')
    const main = h('div.cmain', tabs, edrow, foot, empty)
    const el = h('div', h('div.cview', side, main))
    const P = () => App.P

    function paintList() {
      clear(list); if (!P()) return
      const ws = App.ws, ch = ws !== 'main' ? new Set(P().changes(ws).map(c => c.path)) : new Set()
      let dir = null
      for (const path of P().list(ws)) {
        if (S.filter && !path.toLowerCase().includes(S.filter)) continue
        const d = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (d !== dir) { dir = d; if (d) list.appendChild(h('div.fi.dir', d + '/')) }
        list.appendChild(h('button.fi' + (path === S.cur ? '.on' : ''), { title: path, on: { click: () => open(path) } }, d ? path.slice(d.length + 1) : path, ch.has(path) ? h('span.ch', 'M') : null))
      }
      if (ws !== 'main') for (const c of P().changes(ws)) if (c.deleted) list.appendChild(h('button.fi', { disabled: true, style: { textDecoration: 'line-through', opacity: 0.6 } }, c.path))
    }
    function paintTabs() {
      clear(tabs)
      for (const p of S.tabs) tabs.appendChild(h('span.ftab' + (p === S.cur ? '.on' : ''), h('button', { on: { click: () => open(p) } }, p.split('/').pop()), h('button.x', { title: 'Close', on: { click: () => closeTab(p) } }, '×')))
    }
    function closeTab(p) { commit(); S.tabs = S.tabs.filter(x => x !== p); if (S.cur === p) S.cur = S.tabs[S.tabs.length - 1] || null; load(); paintTabs(); paintList() }
    function paintCode() {
      pre.innerHTML = highlight(S.cur, ta.value) + '\n'
      const n = ta.value.split('\n').length; let s = ''
      for (let i = 1; i <= n; i++) s += '<div' + (i === S.hiLine ? ' class="hit"' : '') + '>' + i + '</div>'
      gin.innerHTML = s; paintBlame(); scroll()
    }
    function scroll() { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gin.style.transform = bin.style.transform = `translateY(${-ta.scrollTop}px)`; if (S.hiLine) band.style.top = (10 + (S.hiLine - 1) * 18 - ta.scrollTop) + 'px' }
    // blame: who last changed each run of lines (through accepted proposals, back to who wrote them)
    function blameData() {
      const p = P(), snap = S.snap && S.snap.path === S.cur ? S.snap : null
      const key = S.cur + '|' + App.ws + '|' + p.events.length + '|' + (snap ? snap.i : '')
      if (S.bkey !== key) { S.bkey = key; S.bdata = snap ? p.blame(S.cur, 'main', snap.i) : p.blame(S.cur, App.ws) }
      return S.bdata
    }
    function paintBlame() {
      bcol.hidden = !S.blame || !S.cur || !P(); if (bcol.hidden) return
      const p = P(), at = blameData(), n = ta.value.split('\n').length, saved = S.snap && S.snap.path === S.cur ? S.snap.text : p.read(S.cur, App.ws)
      const ids = [...new Set(at)].sort((a, b) => a - b), rank = new Map(ids.map((x, k) => [x, ids.length > 1 ? k / (ids.length - 1) : 1]))
      let s = '', prev = null
      for (let k = 0; k < n; k++) {
        const i = ta.value === saved ? at[k] : (k < at.length ? at[k] : undefined), e = i != null ? p.events[i] : null
        if (!e) { s += '<div class="u">' + (prev === 'u' ? '' : 'unsaved') + '</div>'; prev = 'u'; continue }
        const who = e.who === 'agent' ? 'Claude' : e.who === 'ide' ? 'Sitebench' : e.kind === 'init' ? 'template' : 'you', head = i !== prev
        s += '<div class="' + (head ? 'h' : 'c') + '" data-i="' + i + '" style="--age:' + (0.25 + 0.75 * rank.get(i)).toFixed(2) + '">' + (head ? escHtml(who + ' · ' + fmtAgo(e.t2 || e.t)) : '') + '</div>'
        prev = i
      }
      bin.innerHTML = s
    }
    bin.addEventListener('click', ev => {
      const d = ev.target.closest('[data-i]'); if (!d) return
      const i = +d.dataset.i, rows = [...bin.children], k = rows.indexOf(d)
      let a = k; while (a > 0 && rows[a - 1].dataset.i === d.dataset.i) a--
      let b = k; while (b < rows.length - 1 && rows[b + 1].dataset.i === d.dataset.i) b++
      blameCard(P(), S.cur, i, a + 1, b + 1)
    })
    bin.addEventListener('mouseover', ev => { const d = ev.target.closest('[data-i]'); if (!d || d.title) return; const w = P().why(+d.dataset.i); if (w) d.title = blameTitle(w) })
    function paintFoot() {
      clear(foot); if (!S.cur || !P()) return
      if (S.snap && S.snap.path === S.cur) return paintHistFoot()
      const ws = App.ws, inOv = ws !== 'main', changed = inOv && P().changes(ws).some(c => c.path === S.cur)
      const nv = P().versions(S.cur, ws).length
      const pos = ta.value.slice(0, ta.selectionStart).split('\n')
      put(foot, h('b', S.cur), h('span', 'Ln ' + pos.length + ', Col ' + (pos[pos.length - 1].length + 1)), h('span', inOv ? 'editing proposal "' + (P().overlays.get(ws) || {}).title + '"' : 'editing main'),
        S.pending ? h('span', 'unsaved…') : null,
        S.trace ? h('span', { style: { color: S.trace.elements ? 'var(--a1)' : '' } }, '↳ ' + (S.trace.selector ? S.trace.selector.slice(0, 30) + ' matches ' : 'renders ') + plural(S.trace.elements, 'element') + (S.trace.elements ? ' in ' + plural(S.trace.frames, 'frame') : ''),
          ' ', h('button.link', { title: 'Clear the outlines (Esc)', on: { click: () => { App.trace(null); S.trace = null; paintFoot() } } }, '×')) : null,
        h('span.sp'),
        isMd(S.cur) ? h('div.seg.sm', [['code', 'Code'], ['split', 'Split'], ['preview', 'Preview']].map(([v, l]) => h('button' + (mdMode() === v ? '.on' : ''), { on: { click: () => { S.view[S.cur] = v; paintPreview(); paintFoot() } } }, l))) : null,
        isMd(S.cur) ? h('button.btn.sm', { on: { click: () => App.openDoc(S.cur) } }, 'Open in Docs') : null,
        changed ? h('button.btn.sm', { on: { click: () => { const ov = P().overlays.get(ws); delete ov.files[S.cur]; delete ov.base[S.cur]; P().saveOverlay(ov); P().ev.emit('files', ws, [S.cur]); P().ev.emit('overlays') } } }, 'Revert to main') : null,
        nv > 1 ? h('div.rel', h('button.btn.sm', { title: 'Earlier versions of this file, from the timeline', on: { click: e => historyMenu(e.currentTarget) } }, 'History ' + nv)) : null,
        h('button.btn.sm' + (S.blame ? '.on' : ''), { title: 'Who last changed each line, and why', on: { click: () => { S.blame = !S.blame; paintBlame(); paintFoot() } } }, 'Blame'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ' line ' + pos.length + ': ') } }, 'Ask agent'),
        h('button.btn.sm.danger', { on: { click: async () => { if (await confirmBox('Delete ' + S.cur + '?', inOv ? 'The deletion goes into the proposal.' : 'This removes the file from main. The timeline keeps its history.', 'Delete')) { P().remove(S.cur, { ws: App.ws }); closeTab(S.cur) } } } }, 'Delete'))
    }
    function load(keepView) {
      const snap = S.snap && S.snap.path === S.cur ? S.snap : null
      const has = !!S.cur && !!P() && (!!snap || P().read(S.cur, App.ws) !== null)
      edrow.hidden = foot.hidden = !has; empty.hidden = has
      ta.readOnly = !!snap; edrow.classList.toggle('hist', !!snap); foot.classList.toggle('hist', !!snap)
      if (!has) return
      const st = ta.scrollTop, sl = ta.scrollLeft, ss = ta.selectionStart, se = ta.selectionEnd
      ta.value = snap ? (snap.text ?? '') : P().read(S.cur, App.ws)
      if (keepView) { ta.scrollTop = st; ta.scrollLeft = sl; ta.setSelectionRange(Math.min(ss, ta.value.length), Math.min(se, ta.value.length)) } else { ta.scrollTop = 0; ta.scrollLeft = 0 }
      paintCode(); paintFoot(); paintPreview()
    }
    function open(path, line, keepSnap) {
      commit()
      if (!keepSnap && S.snap) S.snap = null
      if (!S.tabs.includes(path)) S.tabs.push(path)
      const same = S.cur === path; S.cur = path; paintTabs(); paintList(); load(same)
      if (line) goto(line)
    }
    function goto(line) {
      const off = offsetOfLine(ta.value, line); ta.focus({ preventScroll: true }); ta.setSelectionRange(off, off)
      ta.scrollTop = Math.max(0, (line - 1) * 18 - ta.clientHeight / 3)
      S.hiLine = line; band.style.display = ''; paintCode(); clearTimeout(S.hiT); S.hiT = setTimeout(() => { S.hiLine = 0; band.style.display = 'none'; paintCode() }, 2600)
    }
    const commitSoon = debounce(() => commit(), 450)
    function commit() {
      if (!S.pending || !P()) return
      const { path, ws, text } = S.pending; S.pending = null
      try { P().write(path, text, { ws, who: 'you' }) } catch (e) { toast(e.message) }
      paintFoot()
    }
    ta.addEventListener('input', () => { S.pending = { path: S.cur, ws: App.ws, text: ta.value }; paintCode(); commitSoon(); if (isMd(S.cur)) previewSoon() })
    ta.addEventListener('scroll', scroll)
    ta.addEventListener('keyup', () => { paintFoot(); traceSoon() }); ta.addEventListener('click', () => { paintFoot(); traceSoon() })
    // the caret's line (HTML) or rule (CSS) outlines what it renders in every frame
    const traceSoon = debounce(async () => {
      let t = null
      if (S.cur && !S.snap && document.activeElement === ta) {
        const off = ta.selectionStart, line = ta.value.slice(0, off).split('\n').length
        if (/\.html?$/i.test(S.cur)) t = { file: S.cur, line }
        else if (/\.css$/i.test(S.cur)) { const b = cssBlocks(ta.value).find(b => off >= b.selStart && off <= b.bodyEnd + 1); if (b && b.sel) t = { selector: b.sel.replace(/\s+/g, ' ').trim(), file: S.cur } }
      }
      if (!t && !App.traceTarget) return
      S.trace = await App.trace(t); paintFoot()
    }, 200)
    App.ev.on('trace', () => { S.trace = null; paintFoot() })
    ta.addEventListener('blur', () => commit())
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')) }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); toast('Saved') }
    })
    async function newFile() {
      const p = await promptBox('New file', 'Path, like about.html or css/theme.css', 'about.html'); if (!p) return
      const bad = validPath(p); if (bad) return toast(bad)
      if (P().read(p, App.ws) !== null) return open(p)
      const tpl = /\.md$/i.test(p) ? '# ' + p.replace(/\.md$/i, '').split('/').pop() + '\n\n' : /\.html?$/.test(p) ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + p + '</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <h1>' + p + '</h1>\n</body>\n</html>\n' : ''
      P().write(p, tpl, { ws: App.ws }); open(p)
    }
    App.ev.on('project', () => { S.tabs = []; S.cur = null; S.pending = null; paintTabs(); paintList(); load() })
    App.ev.on('ws', () => { commit(); paintList(); load(true) })
    App.ev.on('files', (ws, paths) => { paintList(); if (S.snap) { paintFoot(); return } if (S.cur && paths.includes(S.cur) && !S.pending && (ws === App.ws || ws === 'main')) load(true) })
    // ---- history: any saved version of the file, read-only, in step with the timeline ----
    const who = v => v.who === 'agent' ? 'Claude' : v.who === 'site' ? 'a page' : 'you'
    const vlabel = v => (v.kind === 'init' ? 'start' : v.kind === 'remove' ? 'removed' : 'saved') + ' by ' + who(v) + (v.ws !== 'main' ? ' (proposal)' : '')
    function showVersion(path, i) {
      const list = P().versions(path, App.ws); if (!list.length) return toast('No saved versions of ' + path)
      const v = list.find(x => x.i === i) || list[list.length - 1]
      commit(); S.snap = { path, ...v, list }
      if (!S.tabs.includes(path)) S.tabs.push(path)
      S.cur = path; paintTabs(); paintList(); load(false)
      App.ev.emit('version', { path, i: v.i })
    }
    function historyMenu(btn) {
      const list = P().versions(S.cur, App.ws)
      popMenu(btn, [{ group: S.cur + ' · ' + plural(list.length, 'version') }, ...list.slice().reverse().slice(0, 40).map((v, k) => ({
        label: (k === 0 ? 'Latest · ' : '') + fmtTime(v.t), sub: vlabel(v) + (v.note ? ' · ' + v.note.slice(0, 40) : ''), run: () => showVersion(S.cur, v.i) }))], { right: true })
    }
    function paintHistFoot() {
      const s = S.snap, k = s.list.findIndex(x => x.i === s.i), cur = P().read(s.path, App.ws)
      const same = cur === s.text, latest = k === s.list.length - 1
      put(foot, h('b', s.path), h('span', 'version ' + (k + 1) + ' of ' + s.list.length + ' · ' + fmtTime(s.t) + ' · ' + vlabel(s)), s.note ? h('span', s.note.slice(0, 60)) : null,
        h('span', same ? '(same as current)' : latest ? '' : ''), h('span.sp'),
        h('button.btn.sm', { disabled: k <= 0, title: 'Older version', on: { click: () => showVersion(s.path, s.list[k - 1].i) } }, '◀'),
        h('button.btn.sm', { disabled: latest, title: 'Newer version', on: { click: () => showVersion(s.path, s.list[k + 1].i) } }, '▶'),
        h('button.btn.sm', { disabled: same, on: { click: () => modal({ title: s.path + ': ' + fmtTime(s.t) + ' → current', wide: true, body: diffView(s.text ?? '', cur ?? ''), actions: [{ label: 'Close' }] }) } }, 'Diff vs current'),
        h('button.btn.sm', { disabled: same || s.text === null, on: { click: () => { P().write(s.path, s.text, { ws: App.ws, who: 'you', note: 'restored the ' + fmtTime(s.t) + ' version' }); S.snap = null; load(true); toast('Restored ' + s.path) } } }, 'Restore this version'),
        h('button.btn.sm.primary', { on: { click: () => { S.snap = null; load(false); App.ev.emit('version', null) } } }, 'Back to current'))
    }
    App.ev.on('sel', s => { if (s && s.src && Dock.visible('code')) { const [f, l] = s.src.split(':'); if (P().read(f, App.ws) !== null) open(f, +l) } })
    App.code = { open, commit, showVersion }
    return { el, show: () => { paintList(); load(true) } }
  }
})

// ---------- data view: tables as an editable grid ----------
registerView('data', {
  title: 'Data', sub: 'tables',
  make() {
    const S = { cur: null }
    const tl = h('div.tlist'), head = h('div.toolbar'), grid = h('div.scroll')
    const el = h('div', h('div.dview', tl, h('div.cmain', head, grid)))
    const P = () => App.P
    const parse = v => v === '' ? '' : v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
    function paint() {
      clear(tl); clear(head); clear(grid); if (!P()) return
      const ws = App.ws, inOv = ws !== 'main', tabs = P().tablesIn(ws), tch = inOv ? new Map(P().tableChanges(ws).map(c => [c.name, c])) : new Map()
      if (S.cur && !tabs.has(S.cur)) S.cur = null
      if (!S.cur) S.cur = [...tabs.keys()][0] || null
      for (const t of tabs.values()) tl.appendChild(h('button.fi' + (t.name === S.cur ? '.on' : '') + (tch.has(t.name) ? '.mod' : ''), { title: tch.has(t.name) ? 'Changed in this proposal' : '', on: { click: () => { S.cur = t.name; paint() } } }, t.name, h('span.ch', String(t.rows.length))))
      tl.appendChild(h('button.fi', { style: { color: 'var(--ink-2)' }, on: { click: newTable } }, '+ table'))
      if (!S.cur) { grid.appendChild(h('p.empty', 'No tables yet. Pages read them with site.db.rows(name).')); return }
      const t = tabs.get(S.cur), c = tch.get(S.cur)
      const changedIds = c ? new Set([...c.added, ...c.changed]) : new Set()
      head.append(h('b', t.name), h('span.lbl', plural(t.rows.length, 'row')),
        inOv ? h('span.tag.ws', { title: 'Edits here go into the proposal; main\'s data is unchanged until it is accepted' }, c ? 'proposal copy: +' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length : 'proposal') : null, h('span.sp'),
        h('button.btn.sm', { on: { click: () => { const r = {}; for (const c of t.cols) if (c !== 'id') r[c] = ''; P().insert(t.name, r, 'you', ws) } } }, '+ Row'),
        h('button.btn.sm', { on: { click: async () => { const c = await promptBox('Add column', 'Column name'); if (c) P().define(t.name, [...t.cols, c], 'you', ws) } } }, '+ Column'),
        h('button.btn.sm', { title: 'Save these rows as a fixture: frames and scenarios can run against it', on: { click: () => saveFixture(t) } }, 'Save as fixture'),
        h('button.btn.sm.danger', { on: { click: async () => { if (await confirmBox('Drop table ' + t.name + '?', 'Its ' + plural(t.rows.length, 'row') + ' go with it.' + (inOv ? ' (In this proposal only.)' : ''), 'Drop')) P().dropTable(t.name, 'you', ws) } } }, 'Drop'))
      const table = h('table.grid', h('thead', h('tr', t.cols.map(c => h('th', c)), h('th'))))
      const body = h('tbody')
      for (const r of t.rows) body.appendChild(h('tr' + (changedIds.has(String(r.id)) ? '.mod' : ''), t.cols.map(c => h('td', h('input', {
        value: r[c] == null ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c]), readOnly: c === 'id',
        on: { change: e => { try { P().update(t.name, r.id, { [c]: parse(e.target.value) }, 'you', ws) } catch (err) { toast(err.message) } } }
      }))), h('td.rx', h('button', { title: 'Delete row', on: { click: () => P().removeRow(t.name, r.id, 'you', ws) } }, '×'))))
      table.appendChild(body); grid.appendChild(table)
    }
    async function saveFixture(t) {
      const n = await promptBox('Save as fixture', 'A fixture is a fixed set of rows (and optionally a clock) that a frame or a scenario runs against instead of the live data. Name:', t.name + '-sample'); if (!n) return
      const path = fixturePath(n.replace(/[^\w-]/g, '-')), ex = P().read(path, App.ws)
      let spec = { description: '', tables: {} }; if (ex) { try { spec = JSON.parse(ex) } catch { } }
      spec.tables = spec.tables || {}; spec.tables[t.name] = t.rows
      P().write(path, JSON.stringify(spec, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'fixture from table ' + t.name })
      toast('Saved ' + path + '. Pick it from a frame\'s ⋯ menu.')
    }
    async function newTable() {
      const n = await promptBox('New table', 'Name (letters, digits, _)', 'items'); if (!n) return
      try { P().define(n, ['name'], 'you', App.ws); S.cur = n; paint() } catch (e) { toast(e.message) }
    }
    const later = debounce(paint, 120)
    App.ev.on('project', paint); App.ev.on('ws', later); App.ev.on('overlays', later); App.ev.on('tables', () => { if (!el.contains(document.activeElement)) later() })
    return { el, show: paint }
  }
})

// ---------- inspector: box, computed styles, matched rules with editable declarations ----------
function cssBlocks(text) {
  const out = []; let i = 0, depth = 0, start = 0
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  for (; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '{') {
      const sel = clean.slice(start, i).trim()
      if (sel.startsWith('@')) { depth++; start = i + 1; continue }
      const close = clean.indexOf('}', i); const end = close < 0 ? clean.length : close
      out.push({ sel, selStart: start + clean.slice(start, i).search(/\S/), bodyStart: i + 1, bodyEnd: end })
      i = end; start = end + 1
    } else if (ch === '}') { depth = Math.max(0, depth - 1); start = i + 1 } else if (ch === ';' && depth >= 0 && !clean.slice(start, i).includes('{')) { if (clean.slice(start, i).trim().startsWith('@')) start = i + 1 }
  }
  return out
}
const normSel = s => s.replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim()
function findRule(text, selector) { const n = normSel(selector); return cssBlocks(text).find(b => normSel(b.sel) === n) }
function cssSet(text, selector, prop, value) {
  const b = findRule(text, selector); if (!b) return null
  const body = text.slice(b.bodyStart, b.bodyEnd)
  const re = new RegExp('(^|[;{\\s])(' + prop.replace(/[-]/g, '\\-') + ')(\\s*:\\s*)([^;]*?)(\\s*(;|$))', 'm')
  let nb
  if (value === null) nb = body.replace(re, (m, pre) => pre)
  else if (re.test(body)) nb = body.replace(re, (m, pre, p, colon, v, tail) => pre + p + colon + value + tail)
  else {
    const multi = body.includes('\n'), ind = (/\n([ \t]+)\S/.exec(body) || [])[1] || '  '
    nb = multi ? body.replace(/\s*$/, '') + (body.trim() && !body.trim().endsWith(';') ? ';' : '') + '\n' + ind + prop + ': ' + value + ';\n' : body.replace(/\s*$/, '') + (body.trim() && !body.trim().endsWith(';') ? ';' : '') + ' ' + prop + ': ' + value + '; '
  }
  return text.slice(0, b.bodyStart) + nb + text.slice(b.bodyEnd)
}
registerView('inspector', {
  title: 'Inspector', sub: 'styles',
  make() {
    const body = h('div.scroll'), el = h('div', body)
    let seq = 0
    async function paint() {
      const s = App.sel, my = ++seq
      clear(body)
      if (!s) { body.appendChild(h('p.empty', 'Select an element on the canvas (Select mode, click). Its source, box and matching CSS show here, and you can edit them.')); return }
      const fh = App.hostByFid(s.fid)
      const [file, line] = (s.src || ':').split(':')
      body.appendChild(h('div.block', h('header', h('h3', s.tag + (s.id ? '#' + s.id : '') + (s.cls ? '.' + s.cls.split(' ').join('.') : '')), h('span.sp'), h('span.tag' + (s.ws !== 'main' ? '.ws' : ''), s.ws === 'main' ? 'main' : 'proposal')),
        h('dl.kv', h('dt', 'Source'), h('dd', s.src ? h('button.link', { on: { click: () => App.reveal(file, +line) } }, s.src) : '—'), h('dt', 'Page'), h('dd', s.route), s.text ? [h('dt', 'Text'), h('dd', '“' + s.text.slice(0, 120) + '”')] : null, h('dt', 'Selector'), h('dd.mono', s.selector)),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.sm', { on: { click: () => App.askAgent('About the ' + s.tag + ' at ' + s.src + ' on ' + s.route + ': ') } }, 'Ask agent about this'),
          s.leaf ? h('span.note', 'double-click it on the canvas to edit the text') : null)))
      if (!fh) return
      let r; try { r = await fh.call('inspect', [{ src: s.src }]) } catch (e) { try { r = await fh.call('inspect', [s.selector]) } catch (e2) { body.appendChild(h('p.empty', 'The element is gone from the page (' + e2.message + ').')); return } }
      if (my !== seq) return
      const c = r.computed
      body.appendChild(h('div.block', h('header', h('h3', 'Box'), h('span.sub', r.rect.w + ' × ' + r.rect.h + ' at ' + r.rect.x + ', ' + r.rect.y)),
        h('dl.kv', ['display', 'position', 'margin', 'padding', 'gap', 'font-size', 'font-family', 'color', 'background-color'].map(p => [h('dt', p), h('dd.mono', c[p])]))))
      const rules = h('div.block', h('header', h('h3', 'Rules'), h('span.sub', 'last wins · edits write to the file')))
      for (const rule of [...r.rules].reverse()) {
        const text = App.P.read(rule.file, App.ws) || '', blk = rule.inline ? null : findRule(text, rule.selector), ln = blk ? lineOf(text, blk.selStart) : null
        const box = h('div', { style: { border: '1px solid var(--rule)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, h('b.mono', rule.selector), rule.media ? h('span.note', '@media ' + rule.media) : null, h('span.sp'),
            h('button.link.note', { on: { click: () => App.reveal(rule.file, ln || 1) } }, rule.file + (ln ? ':' + ln : ''))))
        for (const [p, v, imp] of rule.decls) {
          const inp = h('input.txt.mono', { value: v + (imp ? ' !important' : ''), style: { flex: 1, padding: '1px 4px', fontSize: '11.5px' }, disabled: !blk,
            on: { change: () => edit(rule, p, inp.value.trim() || null) , keydown: e => { if (e.key === 'Enter') inp.blur() } } })
          box.appendChild(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('span.mono', { style: { minWidth: '110px', color: 'var(--ink-2)', fontSize: '11.5px' } }, p), inp))
        }
        if (blk) {
          const add = h('input.txt.mono', { placeholder: '+ property: value', style: { padding: '1px 4px', fontSize: '11.5px' }, on: { keydown: e => { if (e.key !== 'Enter') return; const m = /^\s*([\w-]+)\s*:\s*(.+?);?\s*$/.exec(add.value); if (m) edit(rule, m[1], m[2]); else toast('Write it as property: value') } } })
          box.appendChild(add)
        }
        rules.appendChild(box)
      }
      if (!r.rules.length) rules.appendChild(h('p.note', 'No project CSS rules match this element.'))
      body.appendChild(rules)
    }
    function edit(rule, prop, value) {
      const P = App.P, text = P.read(rule.file, App.ws); if (text == null) return
      const next = cssSet(text, rule.selector, prop, value)
      if (next == null) return toast('Could not find "' + rule.selector + '" in ' + rule.file)
      P.write(rule.file, next, { ws: App.ws, who: 'you', note: rule.selector + ' { ' + prop + (value ? ': ' + value : ' removed') + ' }' })
      setTimeout(paint, 450)
    }
    App.ev.on('sel', () => { if (Dock.visible('inspector')) paint() })
    App.ev.on('project', paint)
    return { el, show: paint }
  }
})

// ---------- layers: the DOM outline of the selected frame ----------
registerView('layers', {
  title: 'Layers', sub: 'DOM outline',
  make() {
    const tree = h('div.layers'), head = h('div.toolbar'), el = h('div', head, tree)
    let seq = 0
    async function paint() {
      const my = ++seq; clear(head); clear(tree)
      const fh = App.sel ? App.hostByFid(App.sel.fid) : App.firstHost()
      if (!fh) { tree.appendChild(h('p.empty', 'No frame yet.')); return }
      head.append(h('span.lbl', 'Frame'), h('b', fh.route), h('span.note', fh.w + 'px' + (fh.ws !== 'main' ? ' · proposal' : '')), h('span.sp'), h('button.btn.sm', { on: { click: paint } }, 'Refresh'))
      let nodes; try { nodes = await fh.call('outline', [500]) } catch (e) { tree.appendChild(h('p.empty', e.message)); return }
      if (my !== seq) return
      for (const n of nodes) tree.appendChild(h('button' + (App.sel && n.src && n.src === App.sel.src ? '.on' : ''), {
        style: { paddingLeft: 10 + n.d * 12 + 'px' }, title: n.src,
        on: { click: async () => { try { const info = await fh.call('select', [n.src ? { src: n.src } : n.tag]); if (info) App.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws }) } catch (e) { toast(e.message) } } }
      }, h('span', n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '')), n.text ? h('span.note', '“' + n.text + '”') : null, h('span.sp'), h('span.src', n.src)))
    }
    const later = debounce(() => { if (Dock.visible('layers')) paint() }, 300)
    App.ev.on('sel', later); App.ev.on('frameready', later); App.ev.on('project', later)
    return { el, show: paint }
  }
})

// ---------- console: page logs and errors, plus eval output ----------
registerView('console', {
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
})

// ---------- eval: run code against the host API yourself (the agent's exact tool) ----------
registerView('evalrepl', {
  title: 'Eval', sub: 'run the API yourself',
  make() {
    const ta = h('textarea.txt.mono', { spellcheck: false, style: { width: '100%', minHeight: '120px', resize: 'vertical', fontSize: '12px', lineHeight: '18px' } })
    ta.value = `// The agent's only tool: an async function body, run in a QuickJS sandbox.\n// The host API is in scope (files, data, frames, ui, session). Return a value.\nconst list = await files.list()\nconst issues = await frames.check()\nreturn { files: list.map(f => f.path), issues }`
    const res = h('div.scroll'), engine = h('span.note')
    const run = async () => {
      if (!App.P) return
      const code = ta.value, t0 = now()
      const card = h('div.block', h('header', h('h3', 'Running…'), h('span.sub', fmtTime(t0))))
      res.prepend(card)
      const ctx = { project: App.P, ws: App.ws, who: 'you', mode: 'auto' }
      const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'repl:' + App.P.id, restore: App.P.meta.replScope && App.P.meta.replScope.vars })
      if (r.scope) { App.P.meta.replScope = r.scope; App.P.saveMeta(); paintScope() }
      clear(card)
      if (r.effects) card.appendChild(h('div.fx', effectsLine(r.effects)))
      put(card, h('header', h('h3', { style: { color: r.ok ? '' : 'var(--accent)' } }, r.ok ? 'ok' : r.error.kind), h('span.sub', (r.ms ?? '?') + ' ms · ' + (r.engine || '') + ' · ' + (App.ws === 'main' ? 'main' : 'proposal')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => { ta.value = code; ta.focus() } } }, 'Edit again')),
        r.ok ? h('pre.mono.yaml', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px', maxHeight: '420px', overflow: 'auto' }, html: hlYAML(toYAML(r.value)) }) : h('pre.mono', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px' } }, r.error.message + (r.error.line ? '\n(line ' + r.error.line + ')' : '')),
        r.logs && r.logs.length ? h('pre.mono.note', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, r.logs.map(l => l.level + ': ' + l.text).join('\n')) : null)
      App.P.log({ kind: 'eval', who: 'you', ws: App.ws, ok: r.ok, note: (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12) })
    }
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() } if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end') } })
    const ref = h('details.block', h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'API reference (what the agent sees)'), h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0 } }, API_GUIDE.split('\n\nWorking rules')[0].split('\n').slice(4).join('\n')))
    const paintEngine = () => { engine.textContent = 'Sandbox: ' + ({ quickjs: 'QuickJS (wasm) in a worker', worker: 'worker realm (QuickJS failed to load)', loading: 'starting…', off: 'unavailable here' }[Sandbox.engine] || Sandbox.engine) }
    Sandbox.ev.on('engine', paintEngine); paintEngine()
    const scopeLine = h('div.toolbar', { style: { minHeight: '30px', fontSize: 'var(--fs-xs)' } })
    function paintScope() {
      clear(scopeLine); const P = App.P; if (!P) return
      const sc = P.meta.replScope, vars = sc && sc.vars ? Object.keys(sc.vars) : [], lib = libEntries(P, App.ws)
      put(scopeLine, h('span.lbl', 'Scope'), h('span.mono', vars.length ? vars.join(', ') : 'empty (top-level const/let/function persist between runs)'),
        lib.length ? [h('span.lbl', 'lib'), h('span.mono', lib.map(l => l.name).join(', '))] : null, h('span.sp'),
        vars.length ? h('button.btn.sm', { on: { click: () => { P.meta.replScope = null; P.saveMeta(); Sandbox.drop('repl:' + P.id); paintScope() } } }, 'Reset scope') : null)
    }
    App.ev.on('project', paintScope); App.ev.on('files', (ws, paths) => { if (paths.some(p => p.startsWith(LIB_DIR))) paintScope() })
    const el = h('div', h('div.toolbar', h('button.btn.sm.primary', { on: { click: run } }, 'Run ⌘↵'), engine, h('span.sp'), h('button.btn.sm', { on: { click: () => clear(res) } }, 'Clear')), scopeLine,
      h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--hair)' } }, ta), ref, res)
    return { el, show: () => { if (!Sandbox.worker) Sandbox.spawn(); paintScope() } }
  }
})

// ---------- docs: every markdown file in the project, rendered, with an outline ----------
registerView('docs', {
  title: 'Docs', sub: 'markdown files',
  make() {
    const S = { cur: null }
    const list = h('div.fl'), outline = h('div.fl.outline')
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Docs'), h('span.sp'), h('button.btn.sm', { title: 'New markdown file', on: { click: newDoc } }, '+ New')), list, h('div.toolbar', { style: { borderTop: '1px solid var(--hair)' } }, h('span.lbl', 'Outline')), outline)
    const head = h('div.toolbar'), body = h('div.scroll.docbody')
    const el = h('div', h('div.cview', side, h('div.cmain', head, body)))
    const P = () => App.P
    const docs = () => P() ? P().list(App.ws).filter(p => /\.(md|markdown)$/i.test(p)) : []
    function paint() {
      const all = docs()
      if (!S.cur || !all.includes(S.cur)) S.cur = all.find(p => /(^|\/)readme\.md$/i.test(p)) || all[0] || null
      clear(list)
      for (const p of all) list.appendChild(h('button.fi' + (p === S.cur ? '.on' : ''), { title: p, on: { click: () => { S.cur = p; paint() } } }, p))
      clear(head); clear(body); clear(outline)
      if (!S.cur) {
        body.appendChild(h('div.empty', h('p', { style: { margin: '0 0 10px' } }, 'No markdown files in this project yet. Notes, specs and READMEs written as .md files show here, rendered.'),
          h('button.btn.sm', { on: { click: () => newDoc('README.md') } }, 'Create README.md')))
        return
      }
      const text = P().read(S.cur, App.ws) || ''
      put(head, h('b', S.cur), h('span.note', text.split('\n').length + ' lines' + (App.ws !== 'main' ? ' · proposal' : '')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ': ') } }, 'Ask agent'),
        h('button.btn.sm', { on: { click: () => App.reveal(S.cur, 1) } }, 'Edit'))
      const doc = renderMarkdown(text, f => P().read(f, App.ws) !== null, { doc: true }); doc.classList.add('doc')
      body.appendChild(doc)
      for (const hd of doc.querySelectorAll('[data-level]')) {
        outline.appendChild(h('button.fi', { style: { paddingLeft: 10 + (hd.dataset.level - 1) * 12 + 'px', fontFamily: 'var(--ui)' }, on: { click: () => hd.scrollIntoView({ block: 'start', behavior: 'smooth' }) } }, hd.textContent))
      }
    }
    body.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (!r) return; e.preventDefault(); if (/\.md$/i.test(r.dataset.file)) { S.cur = r.dataset.file; paint(); body.scrollTop = 0 } else App.reveal(r.dataset.file, +r.dataset.line || 1) })
    async function newDoc(name) {
      const p = typeof name === 'string' ? name : await promptBox('New doc', 'Path, like NOTES.md or docs/plan.md', 'NOTES.md'); if (!p) return
      const path = /\.(md|markdown)$/i.test(p) ? p : p + '.md', bad = validPath(path); if (bad) return toast(bad)
      if (P().read(path, App.ws) === null) P().write(path, '# ' + path.replace(/\.md$/i, '').split('/').pop() + '\n\n', { ws: App.ws })
      S.cur = path; paint(); App.reveal(path, 3)
    }
    const later = debounce(() => { if (Dock.visible('docs')) paint() }, 200)
    App.ev.on('files', (ws, paths) => { if (paths.some(p => /\.(md|markdown)$/i.test(p))) later() })
    App.ev.on('ws', later); App.ev.on('project', () => { S.cur = null; later() })
    App.docs = { open(path) { S.cur = path; paint() } }
    return { el, show: paint }
  }
})

// ---------- blame details ----------
function blameTitle(w) {
  const who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ')' : '') : w.kind === 'init' ? 'the template' : w.who === 'ide' ? 'Sitebench' : 'you'
  return [who + ' · ' + new Date(w.t).toLocaleString(), w.proposal ? 'accepted from "' + w.proposal + '"' : '', w.request ? 'asked: ' + w.request : '', w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label).join(' · ') : '', w.note && !w.request ? w.note : ''].filter(Boolean).join('\n')
}
function blameCard(P, path, i, a, b) {
  const w = P.why(i); if (!w) return
  const e = P.events[i], who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ' subagent)' : '') : e.kind === 'init' ? 'The template' : w.who === 'ide' ? 'Sitebench' : 'You'
  const vs = P.versions(path), k = vs.findIndex(v => v.i === i), before = k > 0 ? vs.slice(0, k).reverse().find(v => v.ws === e.ws || v.ws === 'main') : null
  const body = [
    h('dl.kv', h('dt', 'Who'), h('dd', who + (w.threadTitle ? ' · thread "' + w.threadTitle + '"' : '')), h('dt', 'When'), h('dd', new Date(w.t).toLocaleString() + ' (' + fmtAgo(w.t) + ')'),
      w.proposal ? [h('dt', 'Via'), h('dd', 'accepted from proposal "' + w.proposal + '"')] : null,
      w.request ? [h('dt', w.delegatedBy ? 'Asked by the main agent' : 'Asked'), h('dd', w.request)] : null,
      w.reply ? [h('dt', 'Reply'), h('dd', w.reply)] : null,
      !w.request && w.note ? [h('dt', 'Note'), h('dd', w.note)] : null),
    w.marks && w.marks.length ? h('div', h('div.note', 'Marks from that turn'), h('ul', { style: { margin: '4px 0', paddingLeft: '18px' } }, w.marks.map(m => h('li', h('b', m.kind + ': '), m.label, m.why ? h('span.note', ' (' + m.why + ')') : null)))) : null,
    e.kind === 'write' ? h('details', h('summary', { style: { cursor: 'pointer' } }, 'The change'), diffView(before ? before.text ?? '' : '', e.after ?? '')) : null]
  modal({ title: path + ' · line' + (a === b ? ' ' + a : 's ' + a + '–' + b), wide: true, body, actions: [
    { label: 'Close' },
    w.thread && P.threads.get(w.thread) ? { label: 'Open thread', run: () => App.showThread(w.thread) } : null,
    { label: 'Select on timeline', run: () => { Dock.open('timeline'); setTimeout(() => App.timeline && App.timeline.select(i), 30) } },
    P.landed(i) != null ? { label: P.landed(i) === i ? 'Show on canvas' : 'Show on canvas (when accepted)', primary: true, run: () => App.setPlayhead(P.landed(i)) } : null].filter(Boolean) })
}
