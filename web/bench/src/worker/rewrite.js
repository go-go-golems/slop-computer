// worker/rewrite.js — the eval session's top-level declarations, rewritten
// into assignments the session keeps (worker.js runs the result).
//
// Pure: acorn only. Public API: rewrite.
import * as acorn from 'acorn'

// ---------- persistent top-level declarations: rewrite them into assignments the session keeps ----------
// const/let/var x = … becomes x = … (a global of the session); function f(){} stays where it is (so it still hoists)
// and is copied out by __keep at the top; class C {} becomes C = class C {}. Every edit stays on its own line,
// so error line numbers still match the code as written. Names the API uses are left local.
function collectPattern(p, out) {
  if (!p) return out
  if (p.type === 'Identifier') out.push(p.name)
  else if (p.type === 'ObjectPattern') for (const q of p.properties) collectPattern(q.type === 'RestElement' ? q.argument : q.value, out)
  else if (p.type === 'ArrayPattern') for (const q of p.elements) collectPattern(q, out)
  else if (p.type === 'RestElement') collectPattern(p.argument, out)
  else if (p.type === 'AssignmentPattern') collectPattern(p.left, out)
  return out
}
export function rewrite(code, reserved) {
  let ast
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) }
  catch (e) { return { code, names: [], keep: [] } }
  const edits = [], names = [], keep = []
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') {
      const ids = []; for (const d of st.declarations) collectPattern(d.id, ids)
      if (!ids.length || ids.some(n => reserved.has(n))) continue
      names.push(...ids)
      // the keyword becomes ";": the assignment that follows may start with "(" (a destructuring
      // pattern is wrapped) and would otherwise continue the line before it when that line has no
      // semicolon ("files.read(x)\n([a, b] = …)" is a call: TypeError: not a function)
      edits.push({ at: st.start, del: st.kind.length, text: ';' })
      st.declarations.forEach((d, i) => {
        const paren = d.id.type !== 'Identifier'
        if (paren) edits.push({ at: d.id.start, del: 0, text: '(' })
        if (!d.init) edits.push({ at: d.id.end, del: 0, text: ' = undefined' + (paren ? ')' : '') })
        else if (paren) edits.push({ at: d.init.end, del: 0, text: ')' })
        const next = st.declarations[i + 1]
        if (next) { const between = code.slice(d.end, next.start), c = between.indexOf(','); if (c >= 0) edits.push({ at: d.end + c, del: 1, text: ';' }) }
      })
    } else if (st.type === 'FunctionDeclaration' && st.id && !reserved.has(st.id.name)) {
      keep.push(st.id.name)
    } else if (st.type === 'ClassDeclaration' && st.id && !reserved.has(st.id.name)) {
      names.push(st.id.name)
      edits.push({ at: st.start, del: 0, text: ';' + st.id.name + ' = ' }, { at: st.end, del: 0, text: ';' })
    }
  }
  edits.sort((a, b) => b.at - a.at)
  let out = code
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.del)
  return { code: out, names, keep }
}
