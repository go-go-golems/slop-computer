// Builds the bench (web/bench, Sitebench) into apps/bench, beside the app's
// app.json and actor.js:
//
//   app.js      src/NN-*.js concatenated in order, in one strict function
//   index.html  src/index.html (the page and all its CSS)
//   sandbox.js  src/worker.js bundled with QuickJS and acorn; src/core.js
//               (the term core) inlined as __CORE_SRC__
//
// and pkg/doors/pages/assets/probe.js: src/05a-probe.js's PROBE, started
// in embedded mode, which slop's sandbox adds to dev embeds (the frames
// the bench shows of an app's dev instance).
//
// `make bench` runs it. Each output's first line is its source stamp
// (../build-stamp.mjs), which pkg/host's TestBuildOutputsFresh checks.
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { stamp } from '../build-stamp.mjs';

const out = '../../apps/bench';
const banner = stamp('the bench, built from web/bench');
mkdirSync(out, { recursive: true });

const parts = readdirSync('src').filter((f) => /^\d\d[a-z]?-.*\.js$/.test(f)).sort();
let app = banner + '\n// Sitebench: a live-site workbench. Built from src/*.js\n"use strict";\n(() => {\n';
for (const f of parts) app += '\n// ===== ' + f + ' =====\n' + readFileSync('src/' + f, 'utf8');
app += '\n})();\n';
writeFileSync(`${out}/app.js`, app);

// A comment before the doctype leaves the page in standards mode.
writeFileSync(`${out}/index.html`, '<!-- ' + banner + ' -->\n' + readFileSync('src/index.html', 'utf8'));

// The worker runs in the browser; QuickJS's emscripten build asks for node
// modules it never uses there.
const stubNode = {
  name: 'stub-node',
  setup(b) {
    b.onResolve({ filter: /^(fs|path|crypto)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {}', loader: 'js' }));
  },
};
await build({
  entryPoints: ['src/worker.js'], outfile: `${out}/sandbox.js`, bundle: true, format: 'iife', platform: 'browser',
  target: 'es2020', minify: true, legalComments: 'none', logLevel: 'warning', banner: { js: banner },
  define: { 'process.env.NODE_ENV': '"production"', __CORE_SRC__: JSON.stringify(readFileSync('src/core.js', 'utf8')) },
  plugins: [stubNode],
});
// The server's probe: the boot data names the bench (parentOrigin); the
// frame address carries the bench's load nonce (sbn).
const probe = readFileSync('src/05a-probe.js', 'utf8');
writeFileSync('../../pkg/doors/pages/assets/probe.js', banner + `
// slop's dev probe (SLOP3-022): Sitebench's PROBE from web/bench/src/05a-probe.js,
// which the sandbox adds to dev embeds only, after the runtime. It answers the
// tool that framed the view (the boot data's parentOrigin) and nothing else.
(() => {
  'use strict';
  const bootEl = document.getElementById('slop-boot');
  let boot = {};
  try { boot = JSON.parse((bootEl && bootEl.textContent) || '{}'); } catch (e) { boot = {}; }
  if (!boot.parentOrigin || window.parent === window) return;
  const q = new URLSearchParams(location.search);
${probe}
  PROBE({ embedded: true, origin: boot.parentOrigin, nonce: q.get('sbn') || '', route: location.pathname.split('/').slice(5).join('/') || 'index.html', mode: 'select', pins: [], store: {} });
})();
`);
console.log('built', out, '(app.js', app.length, 'bytes) and the server probe');
