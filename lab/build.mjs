import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
const out = process.argv[2] || 'dist';
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: 'esm', platform: 'browser', logLevel: 'warning', external: ['fs', 'path'],
  nodePaths: ['/opt/node-tools/node_modules', '/home/claude/.npm-global/lib/node_modules'], loader: { '.txt': 'text' }, minify: !!process.env.MIN, legalComments: 'none' };
await build({ ...common, entryPoints: ['src/worker.js'], outfile: `${out}/kernel.js` });
if (process.env.UI !== '0') {
  await build({ ...common, entryPoints: ['src/ui/main.jsx'], outfile: `${out}/app.js`, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const DS = '/home/claude/up2';
  const css = [
    `${DS}/3b9603cd-form-skate-workbench-design-system_1/form-skate-workbench/tokens.css`,
    `${DS}/3b9603cd-form-skate-workbench-design-system_1/form-skate-workbench/components/bundle.css`,
    `${DS}/35eca965-form-skate-agent-design-system_1/form-skate-agent/components/bundle.css`,
    'src/ui/lab.css',
  ].map(f => `/* ${f.split('/').slice(-3).join('/')} */\n` + readFileSync(f, 'utf8')).join('\n');
  writeFileSync(`${out}/styles.css`, css);
  copyFileSync('src/index.html', `${out}/index.html`);
}
copyFileSync('../vendor/sqlite-wasm/src/bin/sqlite3.wasm', `${out}/sqlite3.wasm`);
console.log('built', out);
