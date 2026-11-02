// SLOP3-003 investigation: do the Blocks libraries load without a DOM, and
// does the editor's prose tokenizer work outside the editor?
//
//   node 01-load-blocks-libs.mjs <slop-computer>/web/blocks/src
//
// Loads hypha.js, fruit.js and blocks-kit.js into a fresh context (no
// window, no document), as the blocks-site actor's require() would, folds
// a few ops, and prints the tree. Then calls Blocks.tokens on plain text
// and on text with a bold span. The second call does not return: tokens()
// recurses into the bold span with the same global RegExp, the inner call
// resets lastIndex to 0, and the outer loop matches "**bold**" again. The
// script runs it in a worker with a time limit to show that.
import vm from 'node:vm';
import fs from 'node:fs';
import { Worker, isMainThread, workerData } from 'node:worker_threads';

const B = isMainThread ? process.argv[2] : workerData.B;
const ctx = vm.createContext({ console });
for (const f of ['hypha.js', 'fruit.js', 'blocks-kit.js']) vm.runInContext(fs.readFileSync(`${B}/${f}`, 'utf8'), ctx, { filename: f });

if (isMainThread) {
  console.log('globals:', Object.keys(vm.runInContext('globalThis', ctx)).join(' '));
  vm.runInContext(`
    const K = new Hypha.Kernel();
    const ops = ['home.title = "Home"', 'home.ui.0 is h1 "Welcome"', 'home.ui.1 is p "Two plus three is {2+3}"', 'about.title = "About"', 'about.parent = "home"'];
    K.batch(() => ops.forEach((t, i) => K.receive({ id: 'x' + i, peer: 'u1:you', clock: i + 1, text: t, at: 1 })));
    console.log('tree:', JSON.stringify(K.snapshot()));
    console.log('kind of home.ui.0:', Fruit.kindOf(K, 'home.ui.0'), '| {2+3} =', Fruit.fmt(Blocks.valueOf(K, 'home.ui.1', '2+3', { al: new Map() })));
    console.log('tokens("plain"):', JSON.stringify(Blocks.tokens('plain')));
  `, ctx);
  // The loop keeps pushing tokens, so the worker gets a small heap and dies of it.
  const w = new Worker(new URL(import.meta.url), { workerData: { B }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
  w.on('error', (e) => { clearTimeout(t); console.log('tokens("Some **bold**"): never returned (' + e.code + ')'); });
  const t = setTimeout(() => { console.log('tokens("Some **bold**"): no answer after 2 s (the loop)'); w.terminate(); }, 2000);
  w.on('message', (m) => { clearTimeout(t); console.log('tokens("Some **bold**"):', m); w.terminate(); });
} else {
  const { parentPort } = await import('node:worker_threads');
  parentPort.postMessage(JSON.stringify(vm.runInContext('Blocks.tokens("Some **bold**")', ctx)));
}
