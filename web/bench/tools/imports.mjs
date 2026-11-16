// The bench's import lines, kept by a tool: node tools/imports.mjs [--write]
//
// Every module under src/ (except the worker, built on its own) says what it
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
const SKIP = new Set(['worker/worker.js', 'worker/core.js']);
// globals of a page (and of the bench's own window.claude runtime)
const GLOBALS = new Set(('window document navigator location history console localStorage sessionStorage fetch URL URLSearchParams Blob File FileReader ' +
  'TextEncoder TextDecoder crypto performance requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval queueMicrotask ' +
  'addEventListener removeEventListener dispatchEvent getComputedStyle matchMedia innerWidth innerHeight devicePixelRatio scrollX scrollY open alert ' +
  'ResizeObserver MutationObserver IntersectionObserver Worker MessageChannel AbortController AbortSignal Event CustomEvent KeyboardEvent MouseEvent ' +
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

// a tiny AST walker: calls visit(node, parent, key) for every node
function walk(node, visit, parent = null, key = '') {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, node, k));
    else if (v && typeof v.type === 'string') walk(v, visit, node, k);
  }
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

function analyze(file) {
  const src = readFileSync(file, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const exports = new Set(), top = new Set(), local = new Set(), used = new Set(), imports = [];
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') { imports.push(n); for (const s of n.specifiers) top.add(s.local.name); continue; }
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    if (n.type === 'ExportNamedDeclaration' && !n.declaration) for (const s of n.specifiers) exports.add(s.exported.name);
    if (!d) continue;
    const names = d.type === 'VariableDeclaration' ? d.declarations.flatMap((x) => patternNames(x.id, [])) : d.id ? [d.id.name] : [];
    names.forEach((x) => { top.add(x); if (n.type === 'ExportNamedDeclaration') exports.add(x); });
  }
  walk(ast, (n, parent, key) => {
    if (n.type === 'VariableDeclarator') patternNames(n.id, []).forEach((x) => local.add(x));
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) { if (n.id) local.add(n.id.name); n.params.forEach((p) => patternNames(p, []).forEach((x) => local.add(x))); }
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') { if (n.id) local.add(n.id.name); }
    if (n.type === 'CatchClause' && n.param) patternNames(n.param, []).forEach((x) => local.add(x));
    if (n.type !== 'Identifier') return;
    if (parent && (parent.type === 'MemberExpression' && key === 'property' && !parent.computed)) return;
    if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed) return;
    if (parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')) return;
    if (parent && (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier' || parent.type === 'ImportDefaultSpecifier')) return;
    used.add(n.name);
  });
  const end = imports.length ? imports[imports.length - 1].end : 0;
  return { file, src, exports, top, local, used, imports, end, head: imports.length ? imports[0].start : 0 };
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
