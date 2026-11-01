// W6 figure: the shell's confirmation dialog over the back office app,
// for the project report. Sets Mira pending, clicks "Let in", captures the
// dialog, cancels, and restores Mira from the CLI.
//
//   SLOP_CREDENTIALS=<admin creds> NODE_PATH=<playwright node_modules> \
//     node 04-w6-confirm-dialog-shot.mjs <slop binary> [shots-dir]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const SLOP = process.argv[2] || 'slop';
const shots = process.argv[3] || '.';
const cli = (...a) => JSON.parse(execFileSync(SLOP, [...a, '-o', 'json'], { encoding: 'utf8' }));
const mira = cli('people', 'ls').find((p) => p.email === 'mira@example.com');
cli('people', 'role', mira.id, 'pending');
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto('http://apps.localhost:18300/admin');
  await page.click('#me a:has-text("Sign in")');
  await page.fill('input[name=email]', 'admin@example.com');
  await page.fill('input[name=name]', 'Ada Admin');
  await Promise.all([page.waitForURL(/\/admin/), page.click('button')]);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('.brand', { timeout: 15000 });
  await frame.click('a.dtab:has-text("People")');
  await frame.locator('tr', { hasText: 'mira@example.com' }).locator('button:has-text("Let in")').click();
  await page.waitForSelector('.shell-dialog', { timeout: 8000 });
  await page.screenshot({ path: `${shots}/w6-confirm-dialog.png` });
  console.log('dialog:', (await page.locator('.shell-dialog').innerText()).replace(/\s+/g, ' '));
  await page.click('.shell-dialog button:has-text("Cancel")');
} finally {
  await browser.close();
  cli('people', 'role', mira.id, 'member');
}
