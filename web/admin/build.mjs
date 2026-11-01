// Builds the back office into pkg/server/admin (embedded with go:embed):
// app.js (React, bundled), styles.css (the lab's design system, then
// admin.css). With --app <dir>, builds it as an app instead: the same UI
// with api-app.js (verbs through the app's actor), into <dir>/app.js and
// <dir>/styles.css beside the app's index.html, app.json and actor.js.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const i = process.argv.indexOf('--app');
const app = i > 0 ? process.argv[i + 1] : '';
const out = app || '../../pkg/server/admin';
const swapAPI = {
  name: 'api-app',
  setup(b) { b.onResolve({ filter: /^\.\/api\.js$/ }, () => ({ path: resolve('src/api-app.js') })); },
};
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['src/main.jsx'], outfile: `${out}/app.js`, bundle: true, format: 'esm', platform: 'browser',
  jsx: 'automatic', minify: true, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  plugins: app ? [swapAPI] : [],
});
const css = readFileSync('../../lab/dist/styles.css', 'utf8') + '\n/* admin.css */\n' + readFileSync('src/admin.css', 'utf8');
writeFileSync(`${out}/styles.css`, css);
console.log('built', out);
