// agent/hints.js — words added to an eval's error so the agent can act on it.
//
// Pure: no DOM, no network. Public API: notAFunctionHint.

// QuickJS's "not a function (line 7)" does not say which: an agent that
// guessed an API (app.sql, vars()) retried the same line again and again (a
// persona review saw five evals fail so). The hint quotes the line and
// names the calls on it the API does not have, with the closest that it has.
export function notAFunctionHint(error, code, api) {
  if (!error || !/not a function|is not a function/.test(error.message || '') || !error.line) return ''
  const text = String(code || '').split('\n')[error.line - 1]
  if (text == null) return ''
  const names = api && api.names ? api.names() : []
  const unknown = []
  for (const m of text.matchAll(/\b([a-z][A-Za-z]*)\.([A-Za-z]+)\s*\(/g)) {
    const name = m[1] + '.' + m[2]
    const ns = names.filter(n => n.startsWith(m[1] + '.'))
    if (ns.length && !names.includes(name) && !unknown.some(u => u.name === name)) {
      const close = names.filter(n => n.endsWith('.' + m[2]) || n.startsWith(m[1] + '.' + m[2].slice(0, 3))).slice(0, 4)
      unknown.push({ name, hint: close.length ? close.join(', ') : ns.slice(0, 6).join(', ') })
    }
  }
  return ' — the line: `' + text.trim().slice(0, 160) + '`' + unknown.map(u => '. ' + u.name + ' is not in the API (did you mean ' + u.hint + '?)').join('')
}

// A reply that holds bench API calls as code: evals written as text, never run (a model imitating the
// history's "[evals: …]"). Page code (claude.use, db.doc) is not matched.
export const FAKED_EVAL = /\[evals?\b[^\]\n]{0,12}\n?[\s\S]{0,400}?\bawait\s+(files|app|frames|scenarios|fixtures|session|types|lib|ui|publish)\.\w+\(|```(js|javascript|ts)?\s*\n[\s\S]{0,600}?\bawait\s+(files|app|frames|scenarios|fixtures|session|types|lib|ui|publish)\.\w+\(/
