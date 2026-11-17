// The bench's import lines, kept by a tool: node tools/imports.mjs [--write]
//
// Every module under src/ (except the workers, built on their own) says what it
// uses from the others with `import { … } from './…'` lines at its top. This
// tool parses each module (acorn), finds the names it uses but does not
// declare, and resolves them against what the other modules export:
//
//   --write   rewrites each module's leading import lines to exactly what it
//             uses (sorted, one line per module)
//   (none)    checks: exits 1 when a module's imports differ from that, or
//             when a name resolves nowhere (not declared, not exported by a
//             module, not a browser global): a ReferenceError waiting to
//             happen. build.mjs runs the check.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { parse } from 'acorn';

const ROOT = new URL('../src/', import.meta.url).pathname;
const SKIP = new Set(['worker/worker.js', 'worker/core.js', 'checker/checker.js']);
// globals of a page (and of the bench's own window.claude runtime)
const GLOBALS = new Set(('window document navigator location history console localStorage sessionStorage fetch URL URLSearchParams Blob File FileReader ' +
  'TextEncoder TextDecoder crypto performance requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval queueMicrotask ' +
  'addEventListener removeEventListener dispatchEvent getComputedStyle matchMedia innerWidth innerHeight devicePixelRatio scrollX scrollY open alert ' +
  'ResizeObserver MutationObserver IntersectionObserver Worker MessageChannel CompressionStream DecompressionStream Response Request Headers AbortController AbortSignal Event CustomEvent KeyboardEvent MouseEvent ' +
  'Node Element HTMLElement HTMLIFrameElement HTMLInputElement HTMLTextAreaElement SVGElement DocumentFragment DOMParser XMLSerializer Range Selection ' +
  'CSS CSSRule CSSStyleRule CSSMediaRule structuredClone btoa atob escape unescape encodeURIComponent decodeURIComponent encodeURI decodeURI ' +
  'Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError ReferenceError Promise Proxy Reflect ' +
  'Map Set WeakMap WeakSet WeakRef Intl ArrayBuffer Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array DataView ' +
  'isNaN isFinite parseInt parseFloat Infinity NaN undefined globalThis self arguments eval Function ClipboardItem Image Option ' +
  'getSelection screen print close focus blur scrollTo name frames parent top opener postMessage').split(/\s+/));

function walkDir(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

function patternNames(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patternNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((e) => patternNames(e, out));
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  return out;
}

// Scopes, as JavaScript has them in a module (strict): var and parameters
// belong to the nearest function; let, const, class and function
// declarations to the nearest block. Pass 1 records each scope's names (so
// hoisting is right); pass 2 resolves every reference through the scope
// chain, and what resolves nowhere is free: an import, a global, or a bug.
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCK = new Set(['Program', 'BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause', 'ClassExpression']);
function isRef(n, parent, key) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false;
  if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed) return false;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false;
  if (/^(Import|Export)/.test(parent.type)) return false;
  if (parent.type === 'MetaProperty') return false;
  return true;
}
function analyze(file) {
  const src = readFileSync(file, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const exports = new Set(), top = new Set(), imports = [];
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') { imports.push(n); continue; }
    if (n.type === 'ExportNamedDeclaration' && !n.declaration) for (const sp of n.specifiers) exports.add(sp.exported.name);
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : null;
    if (d) (d.type === 'VariableDeclaration' ? d.declarations.flatMap((x) => patternNames(x.id, [])) : [d.id.name]).forEach((x) => exports.add(x));
  }
  // pass 1: declarations per scope node
  const names = new Map();
  const declare = (scope, list) => { if (!names.has(scope)) names.set(scope, new Set()); list.forEach((x) => names.get(scope).add(x)); };
  const decl = (node, stack) => {
    const fnScope = [...stack].reverse().find((s) => FN.has(s.type) || s.type === 'Program');
    const block = stack[stack.length - 1];
    if (node.type === 'VariableDeclaration') {
      const where = node.kind === 'var' ? fnScope : block;
      declare(where, node.declarations.flatMap((x) => patternNames(x.id, [])));
    } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declare(block, [node.id.name]);
    else if (node.type === 'ImportDeclaration') declare(block, node.specifiers.map((x) => x.local.name));
  };
  const scan = (node, stack) => {
    if (!node || typeof node.type !== 'string') return;
    decl(node, stack);
    const opens = FN.has(node.type) || BLOCK.has(node.type);
    if (opens) {
      stack = [...stack, node];
      if (FN.has(node.type)) declare(node, [...node.params.flatMap((x) => patternNames(x, [])), ...(node.type === 'FunctionExpression' && node.id ? [node.id.name] : [])]);
      if (node.type === 'CatchClause' && node.param) declare(node, patternNames(node.param, []));
      if (node.type === 'ClassExpression' && node.id) declare(node, [node.id.name]);
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => scan(c, stack));
      else if (v && typeof v.type === 'string') scan(v, stack);
    }
  };
  scan(ast, []);
  for (const x of names.get(ast) || []) top.add(x);
  // pass 2: references, resolved through the chain
  const free = new Set();
  const resolve = (node, parent, key, stack) => {
    if (!node || typeof node.type !== 'string') return;
    if (FN.has(node.type) || BLOCK.has(node.type)) stack = [...stack, node];
    if (node.type === 'Identifier' && isRef(node, parent, key)) {
      const known = stack.some((s) => names.has(s) && names.get(s).has(node.name));
      if (!known) free.add(node.name);
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => resolve(c, node, k, stack));
      else if (v && typeof v.type === 'string') resolve(v, node, k, stack);
    }
  };
  resolve(ast, null, '', []);
  // names an import line provides count as free (the tool decides them)
  for (const i of imports) for (const sp of i.specifiers) { top.delete(sp.local.name); }
  const used = new Set(free);
  for (const i of imports) for (const sp of i.specifiers) if (usedBelowImports(ast, sp.local.name)) used.add(sp.local.name);
  const end = imports.length ? imports[imports.length - 1].end : 0;
  return { file, src, exports, top, local: new Set(), used, imports, end, head: imports.length ? imports[0].start : 0 };
}
// whether a name imported now is referenced (pass 2 saw it as declared by its import)
function usedBelowImports(ast, name) {
  let hit = false;
  const visit = (node, parent, key) => {
    if (hit || !node || typeof node.type !== 'string') return;
    if (node.type === 'ImportDeclaration') return;
    if (node.type === 'Identifier' && node.name === name && isRef(node, parent, key)) { hit = true; return; }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, k));
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
  };
  visit(ast, null, '');
  return hit;
}

const files = walkDir(ROOT).filter((f) => !SKIP.has(relative(ROOT, f)));
const mods = files.map(analyze);
const owner = new Map();
for (const m of mods) for (const x of m.exports) {
  if (owner.has(x)) { console.error(`${x} is exported by both ${relative(ROOT, owner.get(x))} and ${relative(ROOT, m.file)}`); process.exitCode = 1; }
  owner.set(x, m.file);
}
// Layers, lowest first: a module imports from its own layer or below
// (the design doc, section 6.3). main.js is the top.
const LAYERS = ['lib', 'core', 'server', 'model', 'frames', 'agent', 'ui', 'main.js'];
const layerOf = (f) => LAYERS.indexOf(relative(ROOT, f).split('/')[0]);
for (const m of mods) if (layerOf(m.file) < 0) { console.error(`${relative(ROOT, m.file)}: not in a layer (${LAYERS.join(', ')})`); process.exitCode = 1; }

const write = process.argv.includes('--write');
let bad = 0;
for (const m of mods) {
  if (layerOf(m.file) < 0) continue;   // reported above; never rewritten
  const want = new Map();
  const unresolved = [];
  for (const x of m.used) {
    if (m.top.has(x) && !m.imports.some((i) => i.specifiers.some((s) => s.local.name === x))) continue;
    const o = owner.get(x);
    if (o && o !== m.file) { if (!want.has(o)) want.set(o, new Set()); want.get(o).add(x); continue; }
    if (o === m.file || m.local.has(x) || GLOBALS.has(x)) continue;
    unresolved.push(x);
  }
  for (const [f, names] of want) if (layerOf(f) > layerOf(m.file)) {
    console.error(`${relative(ROOT, m.file)}: uses ${[...names].sort().join(', ')} from ${relative(ROOT, f)}, a higher layer: pass it down instead`); bad++;
  }
  const lines = [...want].map(([f, names]) => {
    let p = relative(dirname(m.file), f).replace(/\\/g, '/');
    if (!p.startsWith('.')) p = './' + p;
    return `import { ${[...names].sort().join(', ')} } from '${p}';`;
  }).sort();
  const block = lines.join('\n');
  const cur = m.src.slice(m.head, m.end).trim();
  const rel = relative(ROOT, m.file);
  if (unresolved.length) { console.error(`${rel}: unresolved ${unresolved.sort().join(', ')}`); bad++; }
  if (cur !== block) {
    if (write) {
      const rest = m.imports.length ? m.src.slice(0, m.head) + (block ? block : '') + m.src.slice(m.end) : insertAfterHeader(m.src, block);
      writeFileSync(m.file, rest);
      console.log(`${rel}: imports rewritten`);
    } else { console.error(`${rel}: imports differ from what it uses (run node tools/imports.mjs --write)`); bad++; }
  }
}
// a module's leading comment block stays first
function insertAfterHeader(src, block) {
  if (!block) return src;
  const m = /^(?:\/\/[^\n]*\n)*/.exec(src);
  const at = m ? m[0].length : 0;
  return src.slice(0, at) + block + '\n' + (src.slice(at).startsWith('\n') ? '' : '\n') + src.slice(at);
}
if (bad && !write) process.exit(1);
