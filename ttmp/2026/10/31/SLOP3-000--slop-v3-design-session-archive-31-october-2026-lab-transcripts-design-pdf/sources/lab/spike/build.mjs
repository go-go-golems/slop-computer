import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['spike/spike-worker.js'], bundle: true, format: 'esm', outfile: 'spike/out/spike-worker.js',
  nodePaths: ['/opt/node-tools/node_modules', '/home/claude/.npm-global/lib/node_modules'], platform: 'browser', logLevel: 'warning', external: ['fs','path'] });
