// lib/css.js — finding and changing rules in a stylesheet's text.
//
// cssBlocks lists the rule blocks (selector and body offsets; at-rules are
// entered, not listed); findRule finds a selector's block; cssSet sets,
// adds or removes one declaration in it and returns the new text.
//
// Public API: cssBlocks, normSel, findRule, cssSet.
export function cssBlocks(text) {
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
export const normSel = s => s.replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim()
export function findRule(text, selector) { const n = normSel(selector); return cssBlocks(text).find(b => normSel(b.sel) === n) }
export function cssSet(text, selector, prop, value) {
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
