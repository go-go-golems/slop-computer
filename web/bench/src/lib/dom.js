// lib/dom.js — building and showing elements: h() and friends, toasts,
// modals and popup menus (the bench never uses alert/confirm/prompt).
//
// Owns: the one toast element and the one open menu. Public API: $, $$, h,
// put, clear, svgEl, toast, modal, confirmBox, promptBox, popMenu, outside.
import { clamp } from './util.js';

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

// h('div.cls#id', {attrs, on:{click}}, ...children)
export function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {} }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || []
  const el = document.createElement(m[1] || 'div')
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1))
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v
    else if (k === 'text') el.textContent = v
    else if (k === 'html') el.innerHTML = v
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'readOnly' || k === 'selected') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  append(el, kids)
  return el
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))) }
  return el
}
export function put(el, ...kids) { return append(el, kids) }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el }
export function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) k === 'text' ? (el.textContent = v) : el.setAttribute(k, v)
  for (const k of kids.flat()) if (k) el.appendChild(k)
  return el
}

let toastT
export function toast(msg, ms = 2600) {
  let el = $('#toast'); if (!el) { el = h('div#toast'); document.body.appendChild(el) }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true }, ms)
}
export function modal({ title, body, actions = [], onClose, wide }) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); onClose && onClose() }
  const key = e => { if (e.key === 'Escape') close() }
  const box = h('div.box', { style: wide ? { width: 'min(860px, 100%)' } : null },
    h('header', h('span', title), h('span.sp'), h('button.ibtn', { title: 'Close', on: { click: close } }, '×')),
    h('div.bd', body),
    actions.length ? h('footer', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { on: { click: async () => { if ((await a.run?.()) !== false) close() } } }, a.label))) : null)
  const wrap = h('div.modal', { on: { mousedown: e => { if (e.target === wrap) close() } } }, box)
  document.body.appendChild(wrap); document.addEventListener('keydown', key)
  setTimeout(() => { const f = box.querySelector('input,textarea'); f && f.focus() }, 30)
  return { close, box }
}
export function confirmBox(title, text, label = 'Confirm', danger = true) {
  return new Promise(res => {
    let done = false
    modal({ title, body: h('p', { style: { margin: 0 } }, text), onClose: () => { if (!done) res(false) },
      actions: [{ label: 'Cancel', run: () => { done = true; res(false) } }, { label, danger, primary: !danger, run: () => { done = true; res(true) } }] })
  })
}
export function promptBox(title, label, value = '') {
  return new Promise(res => {
    let done = false
    const inp = h('input.txt', { value, style: { width: '100%' }, on: { keydown: e => { if (e.key === 'Enter') { done = true; res(inp.value.trim()); m.close() } } } })
    const m = modal({ title, body: [h('label.note', label), inp], onClose: () => { if (!done) res(null) },
      actions: [{ label: 'Cancel', run: () => { done = true; res(null) } }, { label: 'OK', primary: true, run: () => { done = true; res(inp.value.trim()) } }] })
  })
}

// popup menu anchored to a button; items: {label, sub, on, run, danger} | {group} | {hr} | {note} | Node
let openMenu = null
export function popMenu(anchor, items, { right } = {}) {
  closeMenu()
  const menu = h('div.menu' + (right ? '.right' : ''))
  for (const it of items) {
    if (!it) continue
    if (it instanceof Node) menu.appendChild(it)
    else if (it.group) menu.appendChild(h('div.grp', it.group))
    else if (it.hr) menu.appendChild(h('hr'))
    else if (it.note) menu.appendChild(h('p.note', it.note))
    else menu.appendChild(h('button' + (it.on ? '.on' : '') + (it.danger ? '.danger' : ''), { disabled: it.disabled, on: { click: e => { e.stopPropagation(); closeMenu(); it.run && it.run() } } },
      h('span.t', it.label), it.sub ? h('small', it.sub) : null))
  }
  // fixed to the viewport so scrolling strips, zoomed canvases and floats never clip or scale it
  document.body.appendChild(menu); openMenu = menu
  const r = anchor.getBoundingClientRect()
  Object.assign(menu.style, { position: 'fixed', top: r.bottom + 6 + 'px', left: 'auto', right: 'auto' })
  const w = menu.offsetWidth, hgt = menu.offsetHeight
  let x = right ? r.right - w : r.left; x = clamp(x, 6, innerWidth - w - 6)
  let y = r.bottom + 6; if (y + hgt > innerHeight - 6) y = Math.max(6, r.top - 6 - hgt > 6 ? r.top - 6 - hgt : innerHeight - 6 - hgt)
  menu.style.left = x + 'px'; menu.style.top = y + 'px'
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escMenu, true) }, 0)
  return menu
}
export function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu() }
export function escMenu(e) { if (e.key === 'Escape') closeMenu() }
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null } document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escMenu, true) }
