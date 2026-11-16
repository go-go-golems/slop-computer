// lib/util.js — small helpers with no bench concepts and no DOM: ids, time,
// numbers, text measures, an event emitter.
//
// Owns: nothing stateful. Public API: uid, now, clamp, sleep, clone, debounce,
// fmtTime, fmtAgo, trunc, plural, ext, lineOf, offsetOfLine, hashStr, emitter.

export const uid = (p = '') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7)
export const now = () => Date.now()
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const clone = v => v == null ? v : JSON.parse(JSON.stringify(v))
export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }; d.flush = (...a) => { clearTimeout(t); fn(...a) }; return d }
export function fmtTime(t) { const d = new Date(t); return d.toTimeString().slice(0, 8) }
export function fmtAgo(t) {
  const s = Math.round((now() - t) / 1000)
  if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString()
}
export function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '… (' + (s.length - n) + ' more chars)' : s }
export function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's') }
export function ext(path) { const m = /\.([a-z0-9]+)$/i.exec(path || ''); return m ? m[1].toLowerCase() : '' }
export function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }
export function offsetOfLine(text, line) { let i = 0, n = 1; while (n < line) { const j = text.indexOf('\n', i); if (j < 0) return text.length; i = j + 1; n++ } return i }
export function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) } return (x >>> 0).toString(36) }

// tiny event emitter
export function emitter() {
  const m = new Map()
  return {
    on(ev, fn) { if (!m.has(ev)) m.set(ev, new Set()); m.get(ev).add(fn); return () => m.get(ev).delete(fn) },
    emit(ev, ...a) { for (const fn of m.get(ev) || []) { try { fn(...a) } catch (e) { console.error(e) } } }
  }
}
