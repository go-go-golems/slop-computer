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

// A model call's turns must stay under the runtime's prompt limit (256 KB): a long thread died on "a prompt
// is at most 262144 bytes" with no way to go on (round 4). The largest turns are cut in the middle, head and
// tail kept, with a note, until the prompt fits; the person's current message (the last turn) goes last.
// Returns { msgs, cut: [{ i, from, to }] } (bytes; cut is empty when it already fit).
export function fitPrompt(msgs, max = 240000) {
  const enc = new TextEncoder(), size = s => enc.encode(s).length
  const out = msgs.map(m => ({ ...m })), cut = []
  let total = out.reduce((a, m) => a + size(m.content), 0)
  for (let guard = 0; total > max && guard < 50; guard++) {
    const order = out.map((m, i) => i).sort((a, b) => (out[b].content.length - (b === out.length - 1 ? 1e9 : 0)) - (out[a].content.length - (a === out.length - 1 ? 1e9 : 0)))
    let i = order.find(k => out[k].content.length > 4000)
    if (i === undefined) i = order[0]
    const c = out[i].content, before = size(c), over = total - max
    const keep = Math.max(1500, c.length - Math.ceil(over * 1.1) - 400), half = Math.floor(keep / 2)
    if (keep >= c.length) break
    out[i].content = c.slice(0, half) + '\n…(' + (c.length - keep) + ' characters cut here to fit the prompt; session.message(n) reads a message in full)…\n' + c.slice(c.length - half)
    const after = size(out[i].content)
    cut.push({ i, from: before, to: after }); total += after - before
  }
  return { msgs: out, cut }
}
