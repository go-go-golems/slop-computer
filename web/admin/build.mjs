// Builds the back office into pkg/server/admin (embedded with go:embed):
// app.js (React, bundled), styles.css (the Kiln design system, then
// admin.css). `make admin` runs both builds; each output's first line is
// its source stamp (../build-stamp.mjs). With --app <dir>, builds it as an
// app instead: the same UI with api-app.js (verbs through the app's
// actor), into <dir>/app.js and <dir>/styles.css beside the app's
// index.html, app.json and actor.js (apps/backoffice).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { stamp } from '../build-stamp.mjs';

const i = process.argv.indexOf('--app');
const app = i > 0 ? process.argv[i + 1] : '';
const out = app || '../../pkg/server/admin';
const banner = stamp('slop back office, built from web/admin' + (app ? ' --app' : ''));
const swapAPI = {
  name: 'api-app',
  setup(b) { b.onResolve({ filter: /^\.\/api\.js$/ }, () => ({ path: resolve('src/api-app.js') })); },
};
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['src/main.jsx'], outfile: `${out}/app.js`, bundle: true, format: 'esm', platform: 'browser',
  jsx: 'automatic', minify: true, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', banner: { js: banner },
  plugins: app ? [swapAPI] : [],
});
const css = banner + '\n' + readFileSync('src/kiln.css', 'utf8') + '\n/* admin.css */\n' + readFileSync('src/admin.css', 'utf8');
writeFileSync(`${out}/styles.css`, css);
console.log('built', out);
