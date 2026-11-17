// Builds the bench (web/bench) into apps/bench, beside the app's app.json
// and actor.js:
//
//   app.js      src/main.js and the modules it imports (lib → core → server
//               → model → frames → agent → ui), bundled into one script
//   index.html  src/index.html (the page and all its CSS)
//   sandbox.js  src/worker/worker.js bundled with QuickJS and acorn;
//               src/worker/core.js (the term core) inlined as __CORE_SRC__
//
// and pkg/doors/pages/assets/probe.js: src/frames/probe.js's PROBE, started
// in embedded mode, which slop's sandbox adds to dev embeds (the frames the
// bench shows of an app's dev instance).
//
// Before building, tools/imports.mjs checks every module's import lines
// against what it uses: a name that resolves nowhere stops the build.
//
// `make bench` runs it. Each output's first line is its source stamp
// (../build-stamp.mjs), which pkg/host's TestBuildOutputsFresh checks.
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { stamp } from '../build-stamp.mjs';

execFileSync(process.execPath, ['tools/imports.mjs'], { stdio: 'inherit' });

const out = '../../apps/bench';
const banner = stamp('the bench, built from web/bench');
mkdirSync(out, { recursive: true });

// Not minified: the bench is read in the browser's tools while it is being
// worked on, and its size is not what makes it load slowly.
const page = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  write: false, legalComments: 'none', logLevel: 'warning', banner: { js: banner + '\n// The bench: a live dev environment for slop apps. Built from web/bench/src.' },
});
const app = page.outputFiles[0].text;
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
  entryPoints: ['src/worker/worker.js'], outfile: `${out}/sandbox.js`, bundle: true, format: 'iife', platform: 'browser',
  target: 'es2020', minify: true, legalComments: 'none', logLevel: 'warning', banner: { js: banner },
  define: { 'process.env.NODE_ENV': '"production"', __CORE_SRC__: JSON.stringify(readFileSync('src/worker/core.js', 'utf8')) },
  plugins: [stubNode],
});

// The server's probe: the boot data names the bench (parentOrigin); the
// frame address carries the bench's load nonce (sbn). probe.js is one
// self-contained function (it runs inside the app's page, not the bench's),
// spliced in as source.
const probe = readFileSync('src/frames/probe.js', 'utf8').replace(/^export function PROBE\(/m, 'function PROBE(');
if (/^\s*(import|export)\b/m.test(probe)) throw new Error('src/frames/probe.js must stay self-contained: one function, no imports or other exports');
writeFileSync('../../pkg/doors/pages/assets/probe.js', banner + `
// slop's dev probe (SLOP3-022): the bench's PROBE from web/bench/src/frames/probe.js,
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
  PROBE({ embedded: true, origin: boot.parentOrigin, nonce: q.get('sbn') || '', route: location.pathname.split('/').slice(5).join('/') || 'index.html', mode: 'select', pins: [] });
})();
`);
console.log('built', out, '(app.js', app.length, 'bytes) and the server probe');
