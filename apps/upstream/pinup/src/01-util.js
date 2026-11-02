// ---------- small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const modKey = e => (isMac ? e.metaKey : e.ctrlKey);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (v, p = 2) => { const m = Math.pow(10, p); return Math.round(v * m) / m; };
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALPH = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function uid(n = 10) { let s = ''; const a = crypto.getRandomValues(new Uint8Array(n)); for (const b of a) s += ALPH[b % ALPH.length]; return s; }
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const camel = s => { const p = String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); return p.map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)).join('') || 'value'; };
const pascal = s => { const c = camel(s); return c[0].toUpperCase() + c.slice(1); };

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

// ---------- icons (Lucide, ISC) ----------
let ICONS = {};
let ICON_NAMES = [];
function loadIcons() {
  try { ICONS = JSON.parse($('#icons').textContent); } catch { ICONS = {}; }
  ICON_NAMES = Object.keys(ICONS).sort();
}
function iconMarkup(name) { return ICONS[name] || ICONS['square'] || ''; }
function ico(name, cls) {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'i' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
  s.innerHTML = iconMarkup(name);
  return s;
}

// ---------- toast / menus / sheets ----------
let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}
let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
// items: {label, kbd, act, disabled, icon} | '-' | {head}
function menu(items, x, y, opts = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('hr')); continue; }
    if (it.head) { m.append(h('div', { class: 'mh', text: it.head })); continue; }
    m.append(h('button', { role: 'menuitem', disabled: !!it.disabled, onclick: e => { e.stopPropagation(); closeMenu(); it.act && it.act(); } },
      it.icon ? ico(it.icon) : null, it.swatch ? h('span', { class: 'sw', style: { width: '12px', height: '12px', borderRadius: '3px', background: it.swatch, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', flex: 'none' } }) : null,
      h('span', { text: it.label, style: { overflow: 'hidden', textOverflow: 'ellipsis' } }), it.kbd ? h('span', { class: 'kbd', text: it.kbd }) : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  m.style.left = clamp(x, 8, Math.max(8, W - r.width - 8)) + 'px';
  m.style.top = (y + r.height > H - 8 ? Math.max(8, (opts.above != null ? opts.above : y) - r.height) : y) + 'px';
  openMenuEl = m;
  const first = m.querySelector('button:not(:disabled)'); if (first && opts.focus) first.focus();
  return m;
}
addEventListener('pointerdown', e => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', e => {
  if (!openMenuEl) return;
  if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); e.preventDefault(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const bs = $$('button:not(:disabled)', openMenuEl); const i = bs.indexOf(document.activeElement);
    const n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n && n.focus(); e.preventDefault(); e.stopPropagation();
  }
}, true);
function menuAt(btn, items) { const r = btn.getBoundingClientRect(); return menu(items, r.left, r.bottom + 4, { above: r.top - 4, focus: true }); }

function sheet(title, body, opts = {}) {
  const close = () => { scrim.remove(); opts.onclose && opts.onclose(); };
  const scrim = h('div', { class: 'scrim', onpointerdown: e => { if (e.target === scrim) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title, style: opts.width ? { width: `min(${opts.width}px, 100%)` } : null },
      h('header', null, h('h2', { text: title }), opts.actions || null, h('button', { class: 'btn ghost sm', onclick: close, text: 'Close' })),
      h('div', { class: 'body' }, body)));
  scrim.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(scrim);
  setTimeout(() => { const f = scrim.querySelector('input,textarea,select,button.primary') || scrim.querySelector('button'); f && f.focus(); });
  return { close, el: scrim };
}

async function copyText(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what); return true; }
  catch {
    // fall back: show the text selected so the viewer can copy it themselves
    const ta = h('textarea', { class: 'code', style: { width: '100%', height: '300px', whiteSpace: 'pre' }, readOnly: true });
    ta.value = text;
    sheet('Copy', [h('p', { text: 'Copying is blocked here. The text is selected below. Press ' + MOD + 'C.' }), ta]);
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
    return false;
  }
}

// ---------- numbers ----------
// Fields accept simple math: "24*2", "100/3", "+8" (relative), "50%" of a base
function evalNum(str, cur, base) {
  let s = String(str).trim().replace(/,/g, '.');
  if (s === '') return null;
  let rel = 0;
  if (/^[+\-*/]\s*\d/.test(s) && cur != null && /^[+*/]/.test(s)) s = cur + s;
  const pct = s.match(/^(-?\d*\.?\d+)\s*%$/);
  if (pct && base != null) return base * parseFloat(pct[1]) / 100;
  if (!/^[\d\s.+\-*/()]+$/.test(s)) return null;
  const v = calc(s); return Number.isFinite(v) ? v + rel : null;
}
// tiny arithmetic parser (no eval): + - * / and parentheses
function calc(src) {
  const t = src.replace(/\s+/g, ''); let i = 0;
  const num = () => { const m = t.slice(i).match(/^\d*\.?\d+/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (t[i] === '(') { i++; const v = expr(); if (t[i++] !== ')') throw 0; return v; } if (t[i] === '-') { i++; return -atom(); } if (t[i] === '+') { i++; return atom(); } return num(); };
  const term = () => { let v = atom(); while (t[i] === '*' || t[i] === '/') { const op = t[i++]; const r = atom(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); return i === t.length ? v : NaN; } catch { return NaN; }
}
const fmt = v => (v == null || v === '' ? '' : (Math.round(v * 100) / 100).toString());

// ---------- colour ----------
const _cx = document.createElement('canvas').getContext('2d');
function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let x = m[1];
    if (x.length === 3 || x.length === 4) x = x.split('').map(c => c + c).join('');
    const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
    const a = x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (m) { let a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return { r: +m[1], g: +m[2], b: +m[3], a }; }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  _cx.fillStyle = '#000'; _cx.fillStyle = s; const v = _cx.fillStyle;
  if (v !== s && (v[0] === '#' || v.startsWith('rgb'))) return parseColor(v);
  return null;
}
const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
function toHex(c) { return ('#' + hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase(); }
function normHex(s) { const c = parseColor(s); return c ? toHex(c) : null; }
function rgba(hex, o) { const c = parseColor(hex) || { r: 0, g: 0, b: 0, a: 1 }; const a = rnd((c.a == null ? 1 : c.a) * (o == null ? 1 : o), 3); return a >= 1 ? toHex(c) : `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`; }
function lum(hex) { const c = parseColor(hex); if (!c) return 1; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const PEER_COLORS = ['#E5484D', '#2B59FF', '#1E9E6A', '#C2410C', '#8A4FFF', '#D6336C', '#0E7C86', '#A16207'];
function colorFor(id) { let s = 0; for (const c of String(id)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return PEER_COLORS[s % PEER_COLORS.length]; }
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

function rafThrottle(fn) { let q = false, args; return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); }; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
