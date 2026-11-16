// ---------- dock: tiles of tabbed views, split by dragging, gutters, floating windows, named layouts (form-skate) ----------
import { $$, clear, h, popMenu } from './lib/dom.js';
import { clamp, debounce, emitter, uid } from './lib/util.js';

const Views = {}            // id -> {title, make(): {el, show?, hide?}}
function registerView(id, def) { Views[id] = def }
const tile = (views, active) => ({ t: 'tile', id: uid('t'), views, active: active || views[0] })
const split = (dir, kids, sizes) => ({ t: 'split', id: uid('s'), dir, kids, sizes: sizes || kids.map(() => 1 / kids.length) })

const LAYOUTS = {
  Build: () => split('row', [
    tile(['agent', 'evalrepl']),
    split('col', [tile(['canvas', 'timeline']), tile(['console', 'data', 'scenarios'])], [0.7, 0.3]),
    split('col', [tile(['code', 'review', 'docs']), tile(['inspector', 'layers', 'panels'])], [0.56, 0.44])
  ], [0.24, 0.47, 0.29]),
  Code: () => split('row', [
    tile(['code']), split('col', [tile(['canvas']), tile(['agent', 'console'])], [0.55, 0.45])
  ], [0.55, 0.45]),
  Review: () => split('row', [
    tile(['review', 'scenarios', 'timeline', 'docs']), split('col', [tile(['canvas']), tile(['agent', 'code'])], [0.6, 0.4])
  ], [0.42, 0.58]),
  Data: () => split('row', [
    split('col', [tile(['data']), tile(['evalrepl', 'console'])], [0.6, 0.4]), tile(['canvas', 'agent'])
  ], [0.5, 0.5]),
  Canvas: () => split('row', [tile(['canvas']), tile(['inspector', 'layers', 'agent', 'panels'])], [0.74, 0.26])
}

function normalize(n) {
  if (!n) return null
  if (n.t === 'tile') { if (!n.views.length) return null; if (!n.views.includes(n.active)) n.active = n.views[0]; return n }
  const kids = [], sizes = []
  n.kids.forEach((k, i) => {
    const c = normalize(k); if (!c) return
    if (c.t === 'split' && c.dir === n.dir) c.kids.forEach((kk, j) => { kids.push(kk); sizes.push(n.sizes[i] * c.sizes[j]) })
    else { kids.push(c); sizes.push(n.sizes[i]) }
  })
  if (!kids.length) return null
  if (kids.length === 1) return kids[0]
  const sum = sizes.reduce((a, b) => a + b, 0) || 1
  return Object.assign(n, { kids, sizes: sizes.map(s => s / sum) })
}
function walkTiles(n, fn, parent) { if (!n) return; if (n.t === 'tile') fn(n, parent); else n.kids.forEach(k => walkTiles(k, fn, n)) }
function tileOf(layout, view) { let r = null; walkTiles(layout, t => { if (t.views.includes(view)) r = t }); return r }
function tileById(layout, id) { let r = null; walkTiles(layout, t => { if (t.id === id) r = t }); return r }
function replaceNode(n, id, rep) { if (!n) return n; if (n.id === id) return rep; if (n.t === 'split') n.kids = n.kids.map(k => replaceNode(k, id, rep)); return n }

const Dock = {
  layout: null, floats: [], inst: {}, el: null, work: null, ev: emitter(), dragging: null, z: 0,
  mount(work) {
    this.work = work; this.el = h('div.dock'); work.appendChild(this.el)
    new ResizeObserver(() => this.ev.emit('resize')).observe(this.el)
  },
  instance(id) {
    if (!this.inst[id]) {
      const def = Views[id]; if (!def) return null
      const v = def.make(); v.el.classList.add('view'); v.el.dataset.view = id; this.inst[id] = v
    }
    return this.inst[id]
  },
  isOpen(id) { return !!tileOf(this.layout, id) || this.floats.some(f => f.view === id) },
  set(layout, floats) { this.layout = normalize(layout); if (floats) this.floats = floats.filter(f => Views[f.view] && !tileOf(this.layout, f.view)); this.render(); this.changed() },
  changed: debounce(function () { App.savePrefs() }, 600),
  // ---- operations ----
  detach(view) {
    walkTiles(this.layout, t => { const i = t.views.indexOf(view); if (i >= 0) { t.views.splice(i, 1); if (t.active === view) t.active = t.views[Math.max(0, i - 1)] } })
    this.floats = this.floats.filter(f => f.view !== view)
  },
  addTab(view, tileId, index) {
    this.detach(view); const t = tileById(this.layout, tileId) || this.biggest()
    if (!t) { this.layout = tile([view]); return }
    t.views.splice(index == null ? t.views.length : clamp(index, 0, t.views.length), 0, view); t.active = view
  },
  splitWith(view, tileId, side) {
    const t0 = tileById(this.layout, tileId); if (!t0) return
    if (t0.views.length === 1 && t0.views[0] === view) return
    this.detach(view)
    const t = tileById(this.layout, tileId) || this.biggest()
    const nt = tile([view]), dir = side === 'left' || side === 'right' ? 'row' : 'col', first = side === 'left' || side === 'top'
    const copy = { ...t }, sp = split(dir, first ? [nt, copy] : [copy, nt], [0.5, 0.5])
    this.layout = t === this.layout ? sp : replaceNode(this.layout, t.id, sp)
  },
  float(view, x, y) {
    const r = this.work.getBoundingClientRect()
    this.detach(view)
    this.floats.push({ view, x: clamp(x ?? r.width / 2 - 220, 0, r.width - 200), y: clamp(y ?? 60, 0, r.height - 120), w: 460, h: 380 })
  },
  open(view, near) {         // show a view: activate if docked, else add it beside `near` or in the biggest tile
    if (!Views[view]) return
    const t = tileOf(this.layout, view)
    if (t) { t.active = view; this.renderTile(t); return this.changed() }
    if (this.floats.some(f => f.view === view)) return
    const target = near ? tileOf(this.layout, near) : null
    this.addTab(view, (target || this.biggest() || {}).id); this.apply()
  },
  close(view) { this.detach(view); this.apply() },
  biggest() { let best = null, area = -1; walkTiles(this.layout, t => { const el = this.el.querySelector('[data-tile="' + t.id + '"]'); const r = el ? el.getBoundingClientRect() : { width: 1, height: 1 }; if (r.width * r.height > area) { area = r.width * r.height; best = t } }); return best },
  apply() { this.layout = normalize(this.layout); if (!this.layout) this.layout = tile(['canvas']); this.render(); this.changed() },

  // ---- rendering ----
  render() {
    for (const v of Object.values(this.inst)) v.el.remove()
    clear(this.el)
    if (this.layout) this.el.appendChild(this.node(this.layout))
    $$('.float', this.work).forEach(f => f.remove())
    for (const f of this.floats) this.work.appendChild(this.floatEl(f))
    for (const [id, v] of Object.entries(this.inst)) { const vis = this.visible(id); if (vis !== v._vis) { v._vis = vis; vis ? v.show && v.show() : v.hide && v.hide() } }
    this.ev.emit('render')
  },
  visible(id) { const t = tileOf(this.layout, id); return t ? t.active === id : this.floats.some(f => f.view === id) },
  node(n) {
    if (n.t === 'tile') return h('div.dcell', { style: { flex: '1 1 0' } }, this.tileEl(n))
    const wrap = h('div.dsplit.' + n.dir)
    n.kids.forEach((k, i) => {
      if (i) wrap.appendChild(this.gutter(n, i, wrap))
      const c = k.t === 'tile' ? h('div.dcell', this.tileEl(k)) : h('div.dcell', this.node(k))
      c.style.flex = n.sizes[i] + ' 1 0'; wrap.appendChild(c)
    })
    return wrap
  },
  tileEl(t) {
    const strip = h('div.dstrip'), tabs = h('div.dtabs'), body = h('div.tilebody')
    const el = h('div.tile', { 'data-tile': t.id }, strip, body)
    for (const v of t.views) {
      const def = Views[v]; if (!def) continue
      const tab = h('div.dtab' + (t.active === v ? '.on' : ''), { 'data-view': v },
        h('button.lbl', { title: def.title + ' (drag to move or split)', on: { pointerdown: e => this.tabDown(e, v, t) } }, def.title, def.badge ? def.badge() : null),
        h('button.x', { title: 'Close ' + def.title, on: { click: e => { e.stopPropagation(); this.close(v) } } }, '×'))
      tabs.appendChild(tab)
    }
    strip.append(tabs, h('span.sp'),
      h('button.tabact', { title: 'Add a view here', on: { click: e => this.pick(e.currentTarget, t) } }, '+'),
      h('button.tabact', { title: 'Float this view', on: { click: () => { this.float(t.active); this.apply() } } }, '⧉'))
    for (const v of t.views) { const inst = this.instance(v); if (!inst) continue; inst.el.style.display = v === t.active ? '' : 'none'; body.appendChild(inst.el) }
    return el
  },
  renderTile(t) {
    const el = this.el.querySelector('[data-tile="' + t.id + '"]'); if (!el) return this.render()
    $$('.dtab', el).forEach(tb => tb.classList.toggle('on', tb.dataset.view === t.active))
    for (const v of t.views) { const inst = this.inst[v]; if (!inst) continue; const on = v === t.active; inst.el.style.display = on ? '' : 'none'; if (on !== inst._vis) { inst._vis = on; on ? inst.show && inst.show() : inst.hide && inst.hide() } }
  },
  refreshTabs() { walkTiles(this.layout, t => { const el = this.el.querySelector('[data-tile="' + t.id + '"]'); if (!el) return; for (const v of t.views) { const lbl = el.querySelector('.dtab[data-view="' + v + '"] .lbl'); if (lbl && Views[v].badge) { lbl.querySelector('.count')?.remove(); const b = Views[v].badge(); if (b) lbl.appendChild(b) } } }) },
  pick(btn, t) {
    const items = [{ group: 'Views' }]
    for (const [id, def] of Object.entries(Views)) items.push({ label: def.title, sub: this.isOpen(id) ? (t.views.includes(id) ? 'here' : 'move here') : def.sub || '', run: () => { this.addTab(id, t.id); this.apply() } })
    popMenu(btn, items, { right: true })
  },
  gutter(n, i, wrap) {
    const g = h('div.gutter.' + n.dir)
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); g.setPointerCapture(e.pointerId)
      const cells = [...wrap.children].filter(c => c.classList.contains('dcell')), a = cells[i - 1], b = cells[i]
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), total = n.sizes[i - 1] + n.sizes[i]
      const span = n.dir === 'row' ? ra.width + rb.width : ra.height + rb.height, start = n.dir === 'row' ? e.clientX : e.clientY, s0 = n.sizes[i - 1]
      document.body.classList.add(n.dir === 'row' ? 'resizing-x' : 'resizing-y')
      const move = ev => {
        const d = ((n.dir === 'row' ? ev.clientX : ev.clientY) - start) / span * total
        const s = clamp(s0 + d, 0.06 * total, total - 0.06 * total)
        n.sizes[i - 1] = s; n.sizes[i] = total - s; a.style.flex = s + ' 1 0'; b.style.flex = (total - s) + ' 1 0'
      }
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); document.body.classList.remove('resizing-x', 'resizing-y'); this.changed(); this.ev.emit('resize') }
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up)
    })
    return g
  },
  // ---- tab drag: tabs zone (insert), edges (split), center (join), outside (float) ----
  tabDown(e, view, t) {
    if (e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    let ghost = null, hint = null, target = null
    const move = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        ghost = h('div.drag-ghost', Views[view].title, ' ', h('small', 'drop on a tab strip, an edge, or outside to float'))
        hint = h('div.drop-hint'); document.body.append(ghost, hint); document.body.classList.add('dragging-view')
      }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px'
      target = this.dropTarget(ev.clientX, ev.clientY, view)
      if (!target) { hint.hidden = true; return }
      hint.hidden = false; hint.className = 'drop-hint' + (target.marker ? ' marker' : '')
      Object.assign(hint.style, { left: target.rect.x + 'px', top: target.rect.y + 'px', width: target.rect.w + 'px', height: target.rect.h + 'px' })
      hint.innerHTML = target.marker ? '' : '<span>' + target.label + '</span>'
    }
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      if (!ghost) { t.active = view; this.renderTile(t); this.changed(); return }
      ghost.remove(); hint.remove(); document.body.classList.remove('dragging-view')
      if (!target) return
      if (target.kind === 'tabs') this.addTab(view, target.tile, target.index)
      else if (target.kind === 'edge') this.splitWith(view, target.tile, target.side)
      else if (target.kind === 'center') this.addTab(view, target.tile)
      else if (target.kind === 'float') { const r = this.work.getBoundingClientRect(); this.float(view, ev.clientX - r.left - 100, ev.clientY - r.top - 15) }
      this.apply()
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  },
  dropTarget(x, y, view) {
    const dr = this.el.getBoundingClientRect()
    if (x < dr.left || x > dr.right || y < dr.top || y > dr.bottom) return { kind: 'float', label: 'Float', rect: { x: x - 110, y: y - 16, w: 220, h: 32 } }
    for (const el of $$('.tile', this.el)) {
      const r = el.getBoundingClientRect(); if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const id = el.dataset.tile, strip = el.querySelector('.dstrip').getBoundingClientRect()
      if (y <= strip.bottom) {
        const tabs = $$('.dtab', el).filter(tb => tb.dataset.view !== view)
        let index = tabs.length, mx = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : strip.left + 4
        for (let i = 0; i < tabs.length; i++) { const tr = tabs[i].getBoundingClientRect(); if (x < tr.left + tr.width / 2) { index = i; mx = tr.left; break } }
        return { kind: 'tabs', tile: id, index, marker: true, rect: { x: mx - 1, y: strip.top + 4, w: 2, h: strip.height - 8 } }
      }
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height, band = 0.22
      const sides = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].filter(s => s[1] < band).sort((a, b) => a[1] - b[1])
      if (sides.length) {
        const s = sides[0][0], R = { x: r.left, y: r.top, w: r.width, h: r.height }
        if (s === 'left') R.w /= 2; if (s === 'right') { R.x += r.width / 2; R.w /= 2 } if (s === 'top') R.h /= 2; if (s === 'bottom') { R.y += r.height / 2; R.h /= 2 }
        return { kind: 'edge', tile: id, side: s, label: 'Split ' + s, rect: R }
      }
      return { kind: 'center', tile: id, label: 'Add as tab', rect: { x: r.left + 8, y: r.top + 8, w: r.width - 16, h: r.height - 16 } }
    }
    return null
  },
  floatEl(f) {
    const def = Views[f.view], inst = this.instance(f.view)
    const head = h('div.fhead', h('span', def.title), h('small', 'floating'), h('span.sp'),
      h('button.ibtn', { title: 'Dock it back', on: { click: () => { this.addTab(f.view, (this.biggest() || {}).id); this.apply() } } }, '⇲'),
      h('button.ibtn', { title: 'Close', on: { click: () => this.close(f.view) } }, '×'))
    const body = h('div.fbody'), el = h('div.float', { style: { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' } }, head, body)
    if (inst) { inst.el.style.display = ''; body.appendChild(inst.el) }
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return
      e.preventDefault(); head.setPointerCapture(e.pointerId); document.body.classList.add('moving')
      const sx = e.clientX - f.x, sy = e.clientY - f.y, R = this.work.getBoundingClientRect()
      const move = ev => { f.x = clamp(ev.clientX - sx, -f.w + 80, R.width - 80); f.y = clamp(ev.clientY - sy, 0, R.height - 30); el.style.left = f.x + 'px'; el.style.top = f.y + 'px' }
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); document.body.classList.remove('moving'); this.changed() }
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up)
    })
    new ResizeObserver(() => { if (!el.isConnected) return; const w = el.offsetWidth, hh = el.offsetHeight; if (w && (w !== f.w || hh !== f.h)) { f.w = w; f.h = hh; this.changed(); this.ev.emit('resize') } }).observe(el)
    el.addEventListener('pointerdown', () => { el.style.zIndex = 30 + (++this.z) }, true)
    return el
  }
}
