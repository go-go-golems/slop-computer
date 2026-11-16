// Builds the bench (web/bench, Sitebench) into apps/bench, beside the app's
// app.json and actor.js:
//
//   app.js      src/NN-*.js concatenated in order, in one strict function
//   index.html  src/index.html (the page and all its CSS)
//   sandbox.js  src/worker.js bundled with QuickJS and acorn; src/core.js
//               (the term core) inlined as __CORE_SRC__
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
console.log('built', out, '(app.js', app.length, 'bytes)');
