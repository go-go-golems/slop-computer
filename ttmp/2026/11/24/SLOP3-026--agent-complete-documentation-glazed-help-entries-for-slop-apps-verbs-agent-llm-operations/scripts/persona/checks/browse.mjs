// browse.mjs: the browser side of the checkers. A checker drives the real
// page as a guest or as a named person on the run's --local server.
//   import { browser, person, open, frameText } from './browse.mjs'
// Playwright comes from PW_DIR; CHROME may name the browser binary.
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(path.join(process.env.PW_DIR || process.cwd(), 'x.js'))('playwright');
const PORT = process.env.PORT;
export const SLOP = `http://slop.localhost:${PORT}`;
export const LIVE = `http://apps.localhost:${PORT}`;
const ARGS = ['--host-resolver-rules=MAP *.localhost 127.0.0.1'];

export async function browser() {
  return chromium.launch({ args: ARGS, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
}

// person(b, email|null): a browser context, signed in on the live host
// as email (any address works on --local), or a guest for null.
export async function person(b, email) {
  const ctx = await b.newContext();
  const errors = [];
  ctx.on('page', (pg) => watch(pg, errors));
  ctx.errors = errors;
  if (email) {
    const p = await ctx.newPage();
    // Sign in on the main host, then hand the session to the live host
    // (/_site/login → main /auth/handoff → /_site/callback): sessions are
    // cookies per host.
    await p.goto(`${SLOP}/auth/login?return=/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await p.locator('input[name=email]').count()) {
      await p.fill('input[name=email]', email);
      if (await p.locator('input[name=name]').count()) await p.fill('input[name=name]', email.split('@')[0]);
      await Promise.all([p.waitForLoadState('domcontentloaded'), p.locator('form button, form input[type=submit]').first().click()]);
    }
    await p.goto(`${LIVE}/_site/login?return=/`, { waitUntil: 'load' }).catch(() => {});
    const go = p.getByRole('button', { name: /continue|allow|approve|sign in/i });
    if (await go.count()) await Promise.all([p.waitForLoadState('load'), go.first().click()]).catch(() => {});
    ctx.signedIn = (await ctx.cookies()).some((c) => c.domain.startsWith('apps.localhost'));
    await p.close();
  }
  return ctx;
}
function watch(pg, errors) {
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  pg.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
}

// open(ctx, path): the page at path on the live host, after the app's frames
// have had ms to run. Returns the page.
export async function open(ctx, p, ms = 4000) {
  const pg = await ctx.newPage();
  const r = await pg.goto(LIVE + p, { waitUntil: 'domcontentloaded' }).catch((e) => ({ status: () => 'error: ' + e.message }));
  pg.status = r && r.status ? r.status() : '?';
  await pg.waitForTimeout(ms);
  return pg;
}

// frameText(pg): the visible text of the page and every frame in it.
export async function frameText(pg) {
  const out = [];
  for (const f of pg.frames()) {
    try { out.push(await f.evaluate(() => document.body ? document.body.innerText : '')); } catch {}
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// appFrame(pg): the frame the app runs in (the innermost with a body), or the page.
export function appFrame(pg) {
  const fs = pg.frames();
  return fs[fs.length - 1] || pg.mainFrame();
}

// emit(check, ok, detail): one checker line.
export const emit = (check, ok, detail = '') => console.log(JSON.stringify({ check, ok: !!ok, detail: String(detail).slice(0, 600) }));

// ---- the server side, through the CLI as the admin ----------------------------
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
export const RUN = process.env.RUN;
export const EXPECTED = (() => { try { return JSON.parse(fs.readFileSync(path.join(RUN, 'expected.json'), 'utf8')); } catch { return {}; } })();
// sl(...args): the CLI's JSON answer, or {error} when it fails.
export function sl(...args) {
  try { return JSON.parse(execFileSync(process.env.SLOP, [...args, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || 'null'); }
  catch (e) { return { error: String(e.stderr || e.message).trim().slice(0, 400) }; }
}
// mounted(path): the store of the live mount at path, or ''.
export function mounted(p) {
  const rows = sl('mount', 'ls');
  for (const e of Array.isArray(rows) ? rows : []) { const m = e.mount || e; if (m.path === p && (e.kind || 'live') === 'live') return m.store || m.storeParam || '?'; }
  return '';
}
export const appOf = (st) => (sl('app', 'status', st) || {}).app || '';
// manifest(st): the app.json of the app the store runs, parsed ({} if none).
export function manifest(st) {
  try { return JSON.parse(execFileSync(process.env.SLOP, ['files', 'cat', appOf(st) || st, 'app.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return {}; }
}
// source(st): the app's text files, joined (for the judge and for checks).
export function source(st) {
  const app = appOf(st) || st, files = sl('files', 'ls', app);
  const names = (Array.isArray(files) ? files : (files.entries || files.files || [])).map((f) => f.path || f.name || f).filter((n) => /\.(js|html|json|sql|css)$/.test(n));
  return names.map((n) => { try { return `--- ${n}\n` + execFileSync(process.env.SLOP, ['files', 'cat', app, n], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } }).join('\n');
}
// shot(pg, name): a full-page screenshot in RUN/shots for the review page.
export async function shot(pg, name) {
  fs.mkdirSync(path.join(RUN, 'shots'), { recursive: true });
  await pg.screenshot({ path: path.join(RUN, 'shots', name + '.png'), fullPage: true }).catch(() => {});
}
// base(st, cap…): the checks every JS-API scenario starts with.
export function base(p, ...caps) {
  const st = mounted(p);
  emit(`mounted at ${p}`, st, st ? `store ${st}` : '');
  if (!st) return '';
  const s = sl('app', 'status', st);
  emit('app not broken', !s.broken && !s.error, s.broken || s.error || '');
  const m = manifest(st), c = Object.keys(m.capabilities || {});
  for (const cap of caps) emit(`declares ${cap}`, c.includes(cap), `capabilities: ${c.join(', ')}`);
  return st;
}
// inApp(pg): the app's frame (the sandbox origin), or null.
export const inApp = (pg) => pg.frames().find((f) => /\.sbx\.localhost/.test(f.url())) || null;
