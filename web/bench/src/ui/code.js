// ui/code.js — the Code view (files of the viewed workspace, an editor with
// highlighting, blame and history) and the Docs view (markdown, rendered).
//
// The person's edits go to the workspace's Draft (P.write → Draft.edit):
// buffered, committed a moment after the last keystroke. When a commit of
// them conflicts with draft (someone changed the same file), the footer
// says so and offers to keep theirs or redo the commit over the new head.
// History reads earlier versions from snapshots (model/timeline.js). In an
// app with TypeScript, the checker's errors mark their lines in the gutter
// (the message on hover), the footer counts them and jumps to each, and
// shows the type under the caret (agent/types.js).
//
// Public API: CODE, DOCS (views); App.code = {open, showVersion},
// App.docs = {open}.
import { App } from './app.js';
import { Dock } from './dock.js';
import { Types, devKey, headView } from '../agent/types.js';
import { Watch } from '../server/instances.js';
import { blame, versions, why } from '../model/timeline.js';
import { blameCard, blameTitle } from './history.js';
import { checkPath } from '../core/draft.js';
import { clear, confirmBox, h, modal, popMenu, promptBox, put, toast } from '../lib/dom.js';
import { cssBlocks } from '../lib/css.js';
import { debounce, fmtAgo, fmtTime, offsetOfLine, plural } from '../lib/util.js';
import { diffView, escHtml, highlight, renderMarkdown } from '../lib/text.js';

const isMd = p => /\.(md|markdown)$/i.test(p || '')

export const CODE = {
  title: 'Code', sub: 'files',
  make() {
    const S = { tabs: [], cur: null, filter: '', pending: null, hiLine: 0, changed: new Set(), removed: [], view: {}, versions: null, blame: false, bdata: null, bkey: '' }
    const P = () => App.P
    const list = h('div.fl'), filter = h('input.txt', { placeholder: 'Filter files', style: { margin: '6px', width: 'calc(100% - 12px)' }, on: { input: () => { S.filter = filter.value.toLowerCase(); paintList() } } })
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Files'), h('span.sp'), h('button.btn.sm', { title: 'New file', on: { click: newFile } }, '+ New')), filter, list)
    const tabs = h('div.ftabs')
    const gin = h('div.gin'), gutter = h('div.egutter', gin), bin = h('div.bin'), bcol = h('div.eblame', { hidden: true }, bin)
    const pre = h('pre'), band = h('div', { style: { position: 'absolute', left: 0, right: 0, height: '18px', background: 'var(--sel)', pointerEvents: 'none', display: 'none' } })
    const ta = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off' })
    const code = h('div.code', band, pre, ta), ed = h('div.ed', bcol, gutter, code)
    const prev = h('div.mdprev', { hidden: true }), edrow = h('div.edrow', ed, prev)
    const foot = h('div.efoot'), empty = h('p.empty', 'Open a file from the list, or select an element on the canvas to jump to its source.')
    const main = h('div.cmain', tabs, edrow, foot, empty)
    const el = h('div', h('div.cview', side, main))
    const snapOf = () => S.snap && S.snap.path === S.cur ? S.snap : null

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

    // what the viewed proposal changed (draft has nothing to compare with)
    async function refreshChanged() {
      const p = P(), ws = App.ws
      if (!p || ws === 'draft') { S.changed = new Set(); S.removed = []; return }
      const ch = await p.changes(ws).catch(() => [])
      if (P() !== p || App.ws !== ws) return
      S.changed = new Set(ch.map(c => c.path)); S.removed = ch.filter(c => !c.entry).map(c => c.path)
      paintList()
    }
    function paintList() {
      clear(list)
      if (!P()) return
      let dir = null
      for (const path of P().list(App.ws)) {
        if (S.filter && !path.toLowerCase().includes(S.filter)) continue
        const d = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (d !== dir) { dir = d; if (d) list.appendChild(h('div.fi.dir', d + '/')) }
        list.appendChild(h('button.fi' + (path === S.cur ? '.on' : ''), { title: path, on: { click: () => open(path) } }, d ? path.slice(d.length + 1) : path, S.changed.has(path) ? h('span.ch', 'M') : null))
      }
      for (const path of S.removed) list.appendChild(h('button.fi', { disabled: true, style: { textDecoration: 'line-through', opacity: 0.6 } }, path))
    }
    function paintTabs() {
      clear(tabs)
      for (const p of S.tabs) tabs.appendChild(h('span.ftab' + (p === S.cur ? '.on' : ''), h('button', { on: { click: () => open(p) } }, p.split('/').pop()), h('button.x', { title: 'Close', on: { click: () => closeTab(p) } }, '×')))
    }
    function closeTab(p) { commit(); S.tabs = S.tabs.filter(x => x !== p); if (S.cur === p) S.cur = S.tabs[S.tabs.length - 1] || null; load(); paintTabs(); paintList() }
    function paintCode() {
      pre.innerHTML = highlight(S.cur, ta.value) + '\n'
      const n = ta.value.split('\n').length
      let s = ''
      const errs = new Map()
      for (const d of S.tdiags || []) if (d.file === S.cur) errs.set(d.line, (errs.has(d.line) ? errs.get(d.line) + '\n' : '') + d.message)
      for (let i = 1; i <= n; i++) {
        const cls = [i === S.hiLine ? 'hit' : '', errs.has(i) ? 'terr' : ''].filter(Boolean).join(' ')
        s += '<div' + (cls ? ' class="' + cls + '"' : '') + (errs.has(i) ? ' title="' + escHtml(errs.get(i)) + '"' : '') + '>' + i + '</div>'
      }
      gin.innerHTML = s; paintBlame(); scroll()
    }
    function scroll() { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gin.style.transform = bin.style.transform = `translateY(${-ta.scrollTop}px)`; if (S.hiLine) band.style.top = (10 + (S.hiLine - 1) * 18 - ta.scrollTop) + 'px' }

    // blame: who last changed each run of lines at the workspace's head, and why
    async function loadBlame() {
      const p = P(), key = S.cur + '|' + App.ws + '|' + p.draftOf(App.ws).head
      if (S.bkey === key) return
      S.bkey = key; S.bdata = null
      try { const at = await blame(p, S.cur, App.ws); if (S.bkey === key) { S.bdata = at; paintBlame() } } catch { }
    }
    function paintBlame() {
      bcol.hidden = !S.blame || !S.cur || !P() || !!snapOf()
      if (bcol.hidden) return
      if (!S.bdata) { loadBlame(); bin.innerHTML = '<div class="u">…</div>'; return }
      const p = P(), at = S.bdata, n = ta.value.split('\n').length, saved = p.draftOf(App.ws).read(S.cur)
      const ids = [...new Set(at.filter(x => x != null))].sort((a, b) => a - b), rank = new Map(ids.map((x, k) => [x, ids.length > 1 ? k / (ids.length - 1) : 1]))
      let s = '', last = null
      for (let k = 0; k < n; k++) {
        const seq = ta.value === saved ? at[k] : (k < at.length ? at[k] : undefined), e = seq != null ? p.event(seq) : null
        if (!e) { s += '<div class="u">' + (last === 'u' ? '' : seq === undefined && ta.value !== saved ? 'unsaved' : 'earlier') + '</div>'; last = 'u'; continue }
        const who = e.who === 'agent' ? 'Claude' : e.who === 'ide' ? 'bench' : e.who === 'push' ? 'outside' : 'you', head = seq !== last
        s += '<div class="' + (head ? 'h' : 'c') + '" data-seq="' + seq + '" style="--age:' + (0.25 + 0.75 * rank.get(seq)).toFixed(2) + '">' + (head ? escHtml(who + ' · ' + fmtAgo(e.at)) : '') + '</div>'
        last = seq
      }
      bin.innerHTML = s
    }
    bin.addEventListener('click', ev => {
      const d = ev.target.closest('[data-seq]')
      if (!d) return
      const rows = [...bin.children], k = rows.indexOf(d)
      let a = k; while (a > 0 && rows[a - 1].dataset.seq === d.dataset.seq) a--
      let b = k; while (b < rows.length - 1 && rows[b + 1].dataset.seq === d.dataset.seq) b++
      blameCard(P(), S.cur, +d.dataset.seq, a + 1, b + 1)
    })
    bin.addEventListener('mouseover', ev => { const d = ev.target.closest('[data-seq]'); if (!d || d.title) return; const w = why(P(), +d.dataset.seq); if (w) d.title = blameTitle(w) })

    async function loadVersions() {
      const path = S.cur, ws = App.ws
      S.versions = null; S.vhead = P().draftOf(ws).head
      try { const v = await versions(P(), path, ws); if (S.cur === path && App.ws === ws) { S.versions = v; paintFoot() } } catch { }
    }
    function paintFoot() {
      clear(foot)
      if (!S.cur || !P()) return
      if (snapOf()) return paintHistFoot()
      const ws = App.ws, prop = App.proposal(), d = P().draftOf(ws), nv = S.versions ? S.versions.length : 0
      const pos = ta.value.slice(0, ta.selectionStart).split('\n')
      const conflict = d.conflict && d.conflict.conflicts.includes(S.cur) ? d.conflict : null
      const terrs = (S.tdiags || []).filter(x => x.file === S.cur)
      put(foot, h('b', S.cur), h('span', 'Ln ' + pos.length + ', Col ' + (pos[pos.length - 1].length + 1)), h('span', prop ? 'editing proposal "' + prop.title + '"' : 'editing draft'),
        S.tdiags ? h('button.link' + (terrs.length ? '.terr' : ''), { title: 'TypeScript errors in this file (and in the app)', on: { click: ev => typeMenu(ev.currentTarget) } }, terrs.length ? plural(terrs.length, 'type error') : 'types ok', S.tdiags.length > terrs.length ? ' (' + S.tdiags.length + ' in the app)' : '') : null,
        S.tinfo ? h('span.mono.tinfo', { title: S.tinfo }, S.tinfo.length > 70 ? S.tinfo.slice(0, 70) + '…' : S.tinfo) : null,
        S.pending || (d.edits && d.edits.changes.has(S.cur)) ? h('span', conflict ? '' : 'saving…') : null,
        S.trace ? h('span', { style: { color: S.trace.elements ? 'var(--a1)' : '' } }, '↳ ' + (S.trace.selector ? S.trace.selector.slice(0, 30) + ' matches ' : 'renders ') + plural(S.trace.elements, 'element') + (S.trace.elements ? ' in ' + plural(S.trace.frames, 'frame') : ''),
          ' ', h('button.link', { title: 'Clear the outlines (Esc)', on: { click: () => { App.trace(null); S.trace = null; paintFoot() } } }, '×')) : null,
        h('span.sp'),
        isMd(S.cur) ? h('div.seg.sm', [['code', 'Code'], ['split', 'Split'], ['preview', 'Preview']].map(([v, l]) => h('button' + (mdMode() === v ? '.on' : ''), { on: { click: () => { S.view[S.cur] = v; paintPreview(); paintFoot() } } }, l))) : null,
        isMd(S.cur) ? h('button.btn.sm', { on: { click: () => App.openDoc(S.cur) } }, 'Open in Docs') : null,
        prop && S.changed.has(S.cur) ? h('button.btn.sm', { title: 'Put back draft\'s version of this file in the proposal', on: { click: revertToDraft } }, 'Revert to draft') : null,
        nv > 1 ? h('div.rel', h('button.btn.sm', { title: 'Earlier versions of this file, from the timeline', on: { click: e => historyMenu(e.currentTarget) } }, 'History ' + nv)) : null,
        h('button.btn.sm' + (S.blame ? '.on' : ''), { title: 'Who last changed each line, and why', on: { click: () => { S.blame = !S.blame; paintBlame(); paintFoot() } } }, 'Blame'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ' line ' + pos.length + ': ') } }, 'Ask agent'),
        h('button.btn.sm.danger', { on: { click: async () => { if (await confirmBox('Delete ' + S.cur + '?', prop ? 'The deletion goes into the proposal.' : 'This removes the file from draft. Its history stays on the timeline.', 'Delete')) { P().remove(S.cur, App.ws); closeTab(S.cur) } } } }, 'Delete'))
      if (conflict) foot.appendChild(h('div.conflict', { style: { flexBasis: '100%', color: 'var(--accent)' } },
        'Your edit conflicts with ' + d.ref + ' ' + conflict.at + ': someone else changed ' + S.cur + ' too. ',
        h('button.btn.sm', { title: 'Commit your version over theirs', on: { click: async () => { const r = await d.keepMine(); toast(r.status === 'committed' ? 'Your version is in ' + d.ref + ' ' + r.n : 'Still not committed: ' + (r.error || r.status)); load(true) } } }, 'Keep mine'), ' ',
        h('button.btn.sm', { title: 'Drop your edit and show theirs', on: { click: async () => { await d.takeTheirs([S.cur]); load(false) } } }, 'Take theirs')))
    }
    function revertToDraft() {
      const text = P().read(S.cur, 'draft')
      if (text === null) P().remove(S.cur, App.ws); else P().write(S.cur, text, App.ws)
      load(true)
    }
    function load(keepView) {
      const snap = snapOf(), has = !!S.cur && !!P() && (!!snap || P().read(S.cur, App.ws) !== null)
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
      const same = S.cur === path
      S.cur = path; S.bkey = ''; S.bdata = null
      paintTabs(); paintList(); load(same)
      if (!same) loadVersions()
      if (line) goto(line)
    }
    // the type checker (agent/types.js): errors for the workspace as the
    // person sees it (their uncommitted edits included), and the type under
    // the caret
    const typeView = () => { const d = P().draftOf(App.ws); return d.edits && d.edits.open ? d.edits : headView(d) }
    const typesSoon = debounce(async () => {
      const p = P()
      if (!p || S.snap) return
      const view = typeView()
      if (!Types.wants(view)) { if (S.tdiags) { S.tdiags = null; paintCode(); paintFoot(); App.setTypeErrors([]) } return }
      const r = await Types.check(p, view, { timeoutMs: 20000, ref: App.ws })
      if (r.skipped || P() !== p) return
      S.tdiags = r.diags; paintCode(); paintFoot(); App.setTypeErrors(r.diags)
    }, 500)
    const infoSoon = debounce(async () => {
      const p = P(), path = S.cur
      if (!p || !path || S.snap || !/\.(ts|tsx|mts|cts)$/.test(path) || !S.tdiags) { if (S.tinfo) { S.tinfo = ''; paintFoot() } return }
      const i = await Types.info(p, typeView(), path, ta.selectionStart, App.ws)
      if (S.cur !== path) return
      S.tinfo = i ? i.text : ''; paintFoot()
    }, 300)
    function typeMenu(anchor) {
      const all = S.tdiags || []
      if (!all.length) return toast('No type errors')
      popMenu(anchor, all.slice(0, 40).map(d => ({ label: d.file + ':' + d.line + ' ' + d.message.split('\n')[0].slice(0, 90), sub: d.program, run: () => d.file === S.cur ? goto(d.line) : open(d.file, d.line) })))
    }
    function goto(line) {
      const off = offsetOfLine(ta.value, line)
      ta.focus({ preventScroll: true }); ta.setSelectionRange(off, off)
      ta.scrollTop = Math.max(0, (line - 1) * 18 - ta.clientHeight / 3)
      S.hiLine = line; band.style.display = ''; paintCode()
      clearTimeout(S.hiT); S.hiT = setTimeout(() => { S.hiLine = 0; band.style.display = 'none'; paintCode() }, 2600)
    }
    // typing is buffered here briefly, then in the Draft's edits until they commit
    const commitSoon = debounce(() => commit(), 300)
    function commit() {
      if (!S.pending || !P()) return
      const { path, ws, text } = S.pending
      S.pending = null
      try { P().write(path, text, ws) } catch (e) { toast(e.message) }
      paintFoot(); typesSoon()
    }
    ta.addEventListener('input', () => { S.pending = { path: S.cur, ws: App.ws, text: ta.value }; paintCode(); commitSoon(); if (isMd(S.cur)) previewSoon() })
    ta.addEventListener('scroll', scroll)
    ta.addEventListener('keyup', () => { paintFoot(); traceSoon(); infoSoon() }); ta.addEventListener('click', () => { paintFoot(); traceSoon(); infoSoon() })
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
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); P().draftOf(App.ws).settle(); toast('Saved') }
    })
    async function newFile() {
      const p = await promptBox('New file', 'Its path, like about.html or css/theme.css', '')
      if (!p) return
      const bad = checkPath(p)
      if (bad) return toast(bad)
      if (P().read(p, App.ws) !== null) return open(p)
      const tpl = isMd(p) ? '# ' + p.replace(/\.md$/i, '').split('/').pop() + '\n\n' : /\.html?$/.test(p) ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + p + '</title>\n</head>\n<body>\n  <h1>' + p + '</h1>\n</body>\n</html>\n' : ''
      P().write(p, tpl, App.ws); open(p)
    }
    // the dev instance came up on new code: its actions, and so the types, may differ
    Watch.ev.on('status', st => { const k = App.ws + '|' + devKey(st, App.ws); if (k !== S.devKey) { S.devKey = k; typesSoon() } })
    App.ev.on('project', () => { S.tabs = []; S.cur = null; S.pending = null; S.snap = null; S.tdiags = null; S.tinfo = ''; paintTabs(); paintList(); load(); refreshChanged(); typesSoon() })
    App.ev.on('ws', () => { commit(); S.bkey = ''; S.bdata = null; paintList(); load(true); refreshChanged(); if (S.cur) loadVersions(); typesSoon() })
    const changedSoon = debounce(refreshChanged, 400)
    App.ev.on('files', (ws, paths) => {
      if (ws !== App.ws) return
      paintList(); changedSoon(); typesSoon()
      if (S.snap) { paintFoot(); return }
      const mine = S.cur && (!paths.length || paths.includes(S.cur))
      // a commit (anyone's, the person's own too) makes a version and changes blame
      if (mine && S.vhead !== P().draftOf(ws).head) { S.bkey = ''; S.bdata = null; loadVersions(); paintBlame() }
      // a change from elsewhere (a commit, the agent, a poll): show it unless the person is typing
      if (mine && !S.pending && P().read(S.cur, ws) !== ta.value) load(true)
      else paintFoot()
    })

    // ---- history: an earlier version of the file, read-only, from a snapshot ----
    const who = v => v.who === 'agent' ? 'Claude' : v.who === 'push' ? 'outside' : 'you'
    const vlabel = v => v.observed ? (v.sha256 ? 'as it was' : 'gone') + ' at ' + v.n + ', seen at ' + v.kind : (v.sha256 ? 'saved' : 'removed') + ' by ' + who(v) + ' in ' + v.n
    async function showVersion(path, seq) {
      const list = await versions(P(), path, App.ws)
      if (!list.length) return toast('No saved versions of ' + path)
      const v = list.find(x => x.seq === seq) || list[list.length - 1]
      commit()
      const text = v.sha256 ? await P().draftOf(App.ws).text(v.n, path) : null
      S.snap = { path, ...v, text, list }
      if (!S.tabs.includes(path)) S.tabs.push(path)
      S.cur = path; paintTabs(); paintList(); load(false)
      App.ev.emit('version', { path, seq: v.seq })
    }
    function historyMenu(btn) {
      const list = S.versions || []
      popMenu(btn, [{ group: S.cur + ' · ' + plural(list.length, 'version') }, ...list.slice().reverse().slice(0, 40).map((v, k) => ({
        label: (k === 0 ? 'Latest · ' : '') + fmtTime(v.at), sub: vlabel(v) + (v.note ? ' · ' + v.note.slice(0, 40) : ''), run: () => showVersion(S.cur, v.seq)
      }))], { right: true })
    }
    function paintHistFoot() {
      const s = S.snap, k = s.list.findIndex(x => x.seq === s.seq), cur = P().read(s.path, App.ws)
      const same = cur === s.text, latest = k === s.list.length - 1
      put(foot, h('b', s.path), h('span', 'version ' + (k + 1) + ' of ' + s.list.length + ' · ' + fmtTime(s.at) + ' · ' + vlabel(s)), s.note ? h('span', s.note.slice(0, 60)) : null, h('span.sp'),
        h('button.btn.sm', { disabled: k <= 0, title: 'Older version', on: { click: () => showVersion(s.path, s.list[k - 1].seq) } }, '◀'),
        h('button.btn.sm', { disabled: latest, title: 'Newer version', on: { click: () => showVersion(s.path, s.list[k + 1].seq) } }, '▶'),
        h('button.btn.sm', { disabled: same, on: { click: () => modal({ title: s.path + ': ' + fmtTime(s.at) + ' → current', wide: true, body: diffView(s.text ?? '', cur ?? ''), actions: [{ label: 'Close' }] }) } }, 'Diff vs current'),
        h('button.btn.sm', { disabled: same || s.text === null, on: { click: () => { P().write(s.path, s.text, App.ws); S.snap = null; load(true); toast('Restored ' + s.path) } } }, 'Restore this version'),
        h('button.btn.sm.primary', { on: { click: () => { S.snap = null; load(false); App.ev.emit('version', null) } } }, 'Back to current'))
    }
    App.ev.on('sel', s => { if (s && s.src && Dock.visible('code')) { const [f, l] = s.src.split(':'); if (P().read(f, App.ws) !== null) open(f, +l) } })
    App.code = { open, showVersion }
    return { el, show: () => { paintList(); load(true); refreshChanged() } }
  }
}

export const DOCS = {
  title: 'Docs', sub: 'markdown files',
  make() {
    const S = { cur: null }
    const P = () => App.P
    const list = h('div.fl'), outline = h('div.fl.outline')
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Docs'), h('span.sp'), h('button.btn.sm', { title: 'New markdown file', on: { click: newDoc } }, '+ New')), list, h('div.toolbar', { style: { borderTop: '1px solid var(--hair)' } }, h('span.lbl', 'Outline')), outline)
    const head = h('div.toolbar'), body = h('div.scroll.docbody')
    const el = h('div', h('div.cview', side, h('div.cmain', head, body)))
    const docs = () => P() ? P().list(App.ws).filter(isMd) : []
    function paint() {
      const all = docs()
      if (!S.cur || !all.includes(S.cur)) S.cur = all.find(p => /(^|\/)readme\.md$/i.test(p)) || all[0] || null
      clear(list)
      for (const p of all) list.appendChild(h('button.fi' + (p === S.cur ? '.on' : ''), { title: p, on: { click: () => { S.cur = p; paint() } } }, p))
      clear(head); clear(body); clear(outline)
      if (!S.cur) {
        body.appendChild(h('div.empty', h('p', { style: { margin: '0 0 10px' } }, 'No markdown files in this app yet. Notes, specs and READMEs written as .md files show here, rendered.'),
          h('button.btn.sm', { on: { click: () => newDoc('README.md') } }, 'Create README.md')))
        return
      }
      const text = P().read(S.cur, App.ws) || ''
      put(head, h('b', S.cur), h('span.note', text.split('\n').length + ' lines' + (App.ws !== 'draft' ? ' · proposal' : '')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ': ') } }, 'Ask agent'),
        h('button.btn.sm', { on: { click: () => App.reveal(S.cur, 1) } }, 'Edit'))
      const doc = renderMarkdown(text, f => P().read(f, App.ws) !== null, { doc: true })
      doc.classList.add('doc')
      body.appendChild(doc)
      for (const hd of doc.querySelectorAll('[data-level]')) outline.appendChild(h('button.fi', { style: { paddingLeft: 10 + (hd.dataset.level - 1) * 12 + 'px', fontFamily: 'var(--ui)' }, on: { click: () => hd.scrollIntoView({ block: 'start', behavior: 'smooth' }) } }, hd.textContent))
    }
    body.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (!r) return; e.preventDefault(); if (isMd(r.dataset.file)) { S.cur = r.dataset.file; paint(); body.scrollTop = 0 } else App.reveal(r.dataset.file, +r.dataset.line || 1) })
    async function newDoc(name) {
      const p = typeof name === 'string' ? name : await promptBox('New doc', 'Path, like NOTES.md or docs/plan.md', 'NOTES.md')
      if (!p) return
      const path = isMd(p) ? p : p + '.md', bad = checkPath(path)
      if (bad) return toast(bad)
      if (P().read(path, App.ws) === null) P().write(path, '# ' + path.replace(/\.md$/i, '').split('/').pop() + '\n\n', App.ws)
      S.cur = path; paint(); App.reveal(path, 3)
    }
    const later = debounce(() => { if (Dock.visible('docs')) paint() }, 200)
    App.ev.on('files', (ws, paths) => { if (!paths.length || paths.some(isMd)) later() })
    App.ev.on('ws', later); App.ev.on('project', () => { S.cur = null; later() })
    App.docs = { open(path) { S.cur = path; paint() } }
    return { el, show: paint }
  }
}
