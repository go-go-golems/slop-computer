// The page runtime's sample stream as Claude Blocks reads it. Blocks feeds
// text.slice(prev) of every onText into its op stream and skips only the
// exact placeholder "Thinking..."; the runtime used to send "Thinking…"
// (one ellipsis character), so Blocks wrote that placeholder into the
// first line and dropped the answer's first nine characters: the first op
// of every answer was rejected ("Thinking….budget.0 = …").
//
// Asks Blocks' Claude (the demo's model) for a small change in ws-scratch
// and checks that no line of the answer was mangled.
//
//   NODE_PATH=<playwright node_modules> node 06-blocks-claude-stream-e2e.mjs [shots-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const tab = await ctx.newPage();
  await tab.goto('http://apps.localhost:18300/b/ws-scratch');
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/b\/ws-scratch/), tab.click('button')]);
  const ed = await (await tab.waitForSelector('iframe')).contentFrame();
  await ed.waitForSelector('#ph-ask', { timeout: 20000 });
  await ed.waitForTimeout(1000);
  await ed.click('#ph-ask');
  await ed.click('#ag-scope button[data-scope="page"]');
  await ed.fill('#ag-in', 'Add a heading "Yarn weights" and a bulleted list of three yarn weights with their typical needle sizes to this page.');
  await ed.waitForFunction(() => document.querySelector('#ag-send').textContent.trim() === 'Ask', null, { timeout: 3000 });
  await ed.click('#ag-send');
  const run = ed.locator('#ag-runs .run').last();
  await run.locator('xpath=self::*[contains(@class, "done")]').waitFor({ timeout: 180000 });
  const summary = (await run.innerText()).replace(/\s+/g, ' ');
  const rejected = await run.locator('details code').evaluateAll((els) => els.map((e) => e.textContent)); // inside a closed details
  console.log('run:', summary.slice(0, 200));
  for (const r of rejected) console.log('  rejected:', r.slice(0, 200));
  const ops = +(/(\d+) ops?/.exec(summary) || [])[1] || 0;
  check(ops > rejected.length, `Claude wrote ops into the page (${ops} ops, ${rejected.length} rejected)`);
  check(!rejected.some((r) => r.startsWith('Thinking')), 'no line carries the thinking placeholder');
  await tab.screenshot({ path: `${shots}/b5-claude-stream.png` });
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
