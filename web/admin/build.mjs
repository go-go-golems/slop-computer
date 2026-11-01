// Builds the back office into pkg/server/admin (embedded with go:embed):
// app.js (React, bundled), styles.css (the lab's design system, then
// admin.css).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const out = '../../pkg/server/admin';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['src/main.jsx'], outfile: `${out}/app.js`, bundle: true, format: 'esm', platform: 'browser',
  jsx: 'automatic', minify: true, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
const css = readFileSync('../../lab/dist/styles.css', 'utf8') + '\n/* admin.css */\n' + readFileSync('src/admin.css', 'utf8');
writeFileSync(`${out}/styles.css`, css);
console.log('built', out);
