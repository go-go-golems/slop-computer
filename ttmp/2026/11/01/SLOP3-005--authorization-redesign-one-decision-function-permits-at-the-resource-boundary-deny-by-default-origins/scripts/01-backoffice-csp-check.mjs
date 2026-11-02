import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch();
try {
  const ctx = await b.newContext();
  const tab = await ctx.newPage();
  const problems = [];
  tab.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) problems.push(m.text()); });
  tab.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await tab.goto('http://slop.localhost:18350/auth/login?return=/');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL('http://slop.localhost:18350/'), tab.click('button')]);
  await tab.waitForSelector('#root *', { timeout: 10000 });
  await tab.waitForTimeout(1500);
  const text = (await tab.locator('#root').innerText()).slice(0, 200).replace(/\s+/g, ' ');
  const csp = (await ctx.request.get('http://slop.localhost:18350/')).headers()['content-security-policy'];
  console.log('csp:', csp);
  console.log('rendered:', text);
  console.log('problems:', JSON.stringify(problems));
  for (const v of ['People', 'Stores', 'Apps', 'Explain']) { await tab.click(`text=${v}`); await tab.waitForTimeout(500); }
  await tab.screenshot({ path: process.argv[2] });
  await Promise.all([tab.waitForURL(/\/auth\/login/, { timeout: 8000 }), tab.click('text=Sign out')]);
  const after = await (await ctx.request.get('http://slop.localhost:18350/auth/session')).json();
  console.log('after sign out:', tab.url(), JSON.stringify(after), 'problems now:', JSON.stringify(problems));
  await ctx.close();
} finally { await b.close(); }
