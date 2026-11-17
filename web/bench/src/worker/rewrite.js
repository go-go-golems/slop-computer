// worker/rewrite.js — the eval session's top-level declarations, rewritten
// into assignments the session keeps (worker.js runs the result).
//
// Pure: acorn only. Public API: rewrite, freeNames, paramsOf, collectPattern (lib.def uses the last three).
import * as acorn from 'acorn'

// ---------- persistent top-level declarations: rewrite them into assignments the session keeps ----------
// const/let/var x = … becomes x = … (a global of the session); function f(){} stays where it is (so it still hoists)
// and is copied out by __keep at the top; class C {} becomes C = class C {}. Every edit stays on its own line,
// so error line numbers still match the code as written. Names the API uses are left local.
export function collectPattern(p, out) {
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
  const edits = [], names = [], keep = [], shadows = []
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') {
      const ids = []; for (const d of st.declarations) collectPattern(d.id, ids)
      // a top-level name that is also an API name hides the API for the whole eval
      // (const [info, app] = await par([app.info(), …]): "app is not initialized")
      const hit = ids.filter(n => reserved.has(n))
      if (hit.length) {
        // a namespace (files, app, frames …) is refused outright. A flat name (s, id, help, sleep) is refused
        // only when the eval uses it before its declaration ends (const [info, id] = await par([id(…)]): the
        // dead zone); otherwise the declaration stays a local of this eval, not kept, and the API is untouched
        // after it (agents named a variable s 21 times, and every one was refused: round 4)
        const ns = reserved.ns || new Set(), before = code.slice(0, st.start) + code.slice(st.declarations[0].id.end, st.end)
        const early = hit.filter(n => ns.has(n) || new RegExp('(^|[^\\w$.])' + n.replace(/\$/g, '\\$') + '(?![\\w$])').test(before))
        if (early.length) shadows.push(...early)
        continue
      }
      if (!ids.length) continue
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
    } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id && reserved.has(st.id.name)) {
      shadows.push(st.id.name)
    } else if (st.type === 'FunctionDeclaration' && st.id && !reserved.has(st.id.name)) {
      keep.push(st.id.name)
    } else if (st.type === 'ClassDeclaration' && st.id && !reserved.has(st.id.name)) {
      names.push(st.id.name)
      edits.push({ at: st.start, del: 0, text: ';' + st.id.name + ' = ' }, { at: st.end, del: 0, text: ';' })
    }
  }
  // from the end; at one position a replacement (the comma becoming ";") goes first, so what is inserted there
  // (" = undefined", a closing parenthesis) lands before it ("let applied, rowsNow;" failed to parse, round 5)
  edits.sort((a, b) => b.at - a.at || (b.del > 0) - (a.del > 0))
  let out = code
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.del)
  return { code: out, names, keep, shadows: [...new Set(shadows)] }
}

// the names a function uses but does not declare (a saved lib function is rebuilt from its source alone)
export function freeNames(node) {
  const declared = new Set(), refs = new Set()
  const visit = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'Identifier') {
      if (parent) {
        if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return
        if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return
        if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type)) return
      }
      refs.add(n.name); return
    }
    if (n.type === 'VariableDeclarator') collectPattern(n.id, []).forEach(x => declared.add(x))
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') { if (n.id) declared.add(n.id.name); for (const p of n.params) collectPattern(p, []).forEach(x => declared.add(x)) }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) declared.add(n.id.name)
    if (n.type === 'CatchClause' && n.param) collectPattern(n.param, []).forEach(x => declared.add(x))
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue
      const v = n[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, n, k) }
      else if (v && typeof v.type === 'string') visit(v, n, k)
    }
  }
  visit(node, null, null)
  return [...refs].filter(x => !declared.has(x))
}
export function paramsOf(fn) { return fn.params.map(p => p.type === 'Identifier' ? p.name : p.type === 'AssignmentPattern' && p.left.type === 'Identifier' ? p.left.name + '?' : p.type === 'RestElement' ? '...' + (p.argument.name || 'rest') : p.type === 'ObjectPattern' ? '{' + collectPattern(p, []).join(', ') + '}' : '[…]') }
