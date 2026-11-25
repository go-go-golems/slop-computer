#!/usr/bin/env node
// look.mjs RUN TAG < actions.json: the persona's browser. The persona has no
// tools of its own; when it asks to look at the site, run.mjs passes its
// actions here and gives it back what a person at that screen would see:
// the page's text, its buttons, links and fields, pictures, downloaded
// files, and what did not work. One screenshot per person per call lands in
// RUN/shots/TAG-<who>.png.
//
// actions: [{as: "me"|"colleague"|"guest"}, {open: "/path"}, {click: "text"},
//           {type: "field label or placeholder", text: "..."}, {press: "Enter"},
//           {choose_file: "photo"}, {wait: seconds}]
// Each person keeps their sign-in between calls (RUN/look/<who>.json), not
// their open pages: a call starts by opening a page.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(path.join(process.env.PW_DIR || process.cwd(), 'x.js'))('playwright');
const [RUN, TAG] = process.argv.slice(2);
const PORT = process.env.PORT;
const SLOP = `http://slop.localhost:${PORT}`, LIVE = `http://apps.localhost:${PORT}`;
const WHO = { me: { email: 'sam@example.com', name: 'Sam' }, colleague: { email: 'kim@example.com', name: 'Kim' }, guest: null };
const STATE = path.join(RUN, 'look');
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(path.join(RUN, 'shots'), { recursive: true });

const actions = (() => { try { const a = JSON.parse(fs.readFileSync(0, 'utf8')); return Array.isArray(a) ? a.slice(0, 12) : []; } catch { return []; } })();
const b = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--no-proxy-server'], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const people = {}; // who → {ctx, page, downloads, dialogs, problems}
const problems = [];
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i');

async function person(who) {
  if (people[who]) return people[who];
  const id = WHO[who], file = path.join(STATE, who + '.json');
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 }, ...(id && fs.existsSync(file) ? { storageState: file } : {}) });
  const p = { who, ctx, page: null, downloads: [], dialogs: [] };
  if (id && !fs.existsSync(file)) {
    // Sign in on the main host, then hand the session to the live host.
    const pg = await ctx.newPage();
    await pg.goto(`${SLOP}/auth/login?return=/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await pg.locator('input[name=email]').count()) {
      await pg.fill('input[name=email]', id.email);
      if (await pg.locator('input[name=name]').count()) await pg.fill('input[name=name]', id.name);
      await Promise.all([pg.waitForLoadState('domcontentloaded'), pg.locator('form button, form input[type=submit]').first().click()]).catch(() => {});
    }
    await pg.goto(`${LIVE}/_site/login?return=/`, { waitUntil: 'load' }).catch(() => {});
    const go = pg.getByRole('button', { name: /continue|allow|approve|sign in/i });
    if (await go.count()) await Promise.all([pg.waitForLoadState('load'), go.first().click()]).catch(() => {});
    await pg.close();
    await ctx.storageState({ path: file });
  }
  return (people[who] = p);
}

// find(p, roles, text): the first visible control with that name in any frame.
async function find(p, roles, text) {
  for (const f of p.page.frames()) {
    for (const role of roles) {
      const l = f.getByRole(role, { name: rx(text) });
      for (let i = 0; i < await l.count(); i++) if (await l.nth(i).isVisible().catch(() => false)) return l.nth(i);
    }
  }
  return null;
}
async function field(p, text) {
  for (const f of p.page.frames()) {
    for (const l of [f.getByLabel(rx(text)), f.getByPlaceholder(rx(text)), f.getByRole('textbox', { name: rx(text) })]) {
      for (let i = 0; i < await l.count(); i++) if (await l.nth(i).isVisible().catch(() => false)) return l.nth(i);
    }
  }
  // No label to go by: the only text field on the page.
  const all = [];
  for (const f of p.page.frames()) { const l = f.locator('textarea:visible, input:visible:not([type]), input[type=text]:visible, input[type=search]:visible, input[type=email]:visible, input[type=number]:visible'); for (let i = 0; i < await l.count(); i++) all.push(l.nth(i)); }
  return all.length === 1 ? all[0] : null;
}
let picture = null;
async function samplePicture() {
  if (picture) return picture;
  const pg = await (await b.newContext()).newPage();
  await pg.setContent('<div style="width:480px;height:320px;background:linear-gradient(135deg,#1d6f5f,#9ad1b9);font:bold 44px sans-serif;color:#fff;display:grid;place-items:center">team photo</div>');
  picture = path.join(STATE, 'team-photo.png');
  await pg.locator('div').screenshot({ path: picture });
  return picture;
}

let cur = await person('me');
for (const a of actions) {
  try {
    if (a.as) { if (!(a.as in WHO)) { problems.push(`nobody called "${a.as}"; use me, colleague or guest`); continue; } cur = await person(a.as); continue; }
    if (a.open !== undefined) {
      const u = /^https?:/.test(a.open) ? a.open.replace(/^https?:\/\/[^/]+/, LIVE) : LIVE + (a.open.startsWith('/') ? '' : '/') + a.open;
      if (!cur.page) {
        cur.page = await cur.ctx.newPage();
        cur.page.on('download', (d) => cur.downloads.push(d));
        cur.page.on('dialog', (d) => { cur.dialogs.push(`${d.type()}: ${d.message()}`); d.accept().catch(() => {}); });
      }
      const r = await cur.page.goto(u, { waitUntil: 'load', timeout: 20000 }).catch((e) => ({ status: () => e.message.split('\n')[0] }));
      const st = r && r.status();
      if (st !== 200) problems.push(`${cur.who}: opening ${a.open} gave ${st}`);
      await cur.page.waitForTimeout(2500);
      continue;
    }
    if (!cur.page) { problems.push(`${cur.who}: open a page first`); continue; }
    if (a.click !== undefined) {
      const c = await find(cur, ['button', 'link', 'checkbox', 'tab', 'menuitem', 'radio'], a.click);
      if (!c) { problems.push(`${cur.who}: no button or link called "${a.click}" on the page`); continue; }
      await c.click({ timeout: 5000 });
      await cur.page.waitForTimeout(1500);
    } else if (a.type !== undefined) {
      const f = await field(cur, a.type);
      if (!f) { problems.push(`${cur.who}: no field called "${a.type}"`); continue; }
      await f.fill(String(a.text ?? ''), { timeout: 5000 });
      cur.lastField = f;
    } else if (a.press) {
      await (cur.lastField || cur.page.keyboard).press(a.press);
      await cur.page.waitForTimeout(1500);
    } else if (a.choose_file !== undefined) {
      let input = null;
      for (const f of cur.page.frames()) { const l = f.locator('input[type=file]'); if (await l.count()) { input = l.first(); break; } }
      if (!input) { problems.push(`${cur.who}: no way to choose a file on the page`); continue; }
      await input.setInputFiles(await samplePicture());
      await cur.page.waitForTimeout(2500);
    } else if (a.wait) {
      await cur.page.waitForTimeout(Math.min(Number(a.wait) || 1, 15) * 1000);
    }
  } catch (e) { problems.push(`${cur.who}: ${Object.keys(a)[0]} ${JSON.stringify(Object.values(a)[0])} did not work (${e.message.split('\n')[0].slice(0, 120)})`); }
}

// ---- what each person sees now --------------------------------------------------
const out = [], shots = [];
for (const p of Object.values(people)) {
  if (!p.page) continue;
  await p.page.waitForTimeout(1000);
  const shot = `${TAG}-${p.who}.png`;
  await p.page.screenshot({ path: path.join(RUN, 'shots', shot), fullPage: true }).catch(() => {});
  shots.push(shot);
  const seen = await Promise.all(p.page.frames().map((f) => f.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const label = (e) => (e.labels && e.labels[0] && e.labels[0].innerText.trim()) || e.placeholder || e.getAttribute('aria-label') || e.name || '';
    return {
      text: document.body ? document.body.innerText : '',
      buttons: [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')].filter(vis).map(name).filter(Boolean),
      links: [...document.querySelectorAll('a[href]')].filter(vis).map(name).filter(Boolean),
      fields: [...document.querySelectorAll('input, textarea, select')].filter((e) => vis(e) && !['submit', 'button', 'hidden'].includes(e.type)).map((e) =>
        e.type === 'file' ? 'a file chooser' : e.type === 'checkbox' ? `a checkbox "${label(e)}" (${e.checked ? 'ticked' : 'not ticked'})` : `a text field "${label(e)}"${e.value ? ` containing "${e.value.slice(0, 40)}"` : ''}`),
      pictures: [...document.images].filter(vis).map((i) => (i.complete && i.naturalWidth > 0 ? 'shown' : 'broken')),
    };
  }).catch(() => null)));
  const s = seen.filter(Boolean);
  const join = (k) => [...new Set(s.flatMap((x) => x[k]))];
  const text = s.map((x) => x.text.trim()).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 2500);
  const pics = s.flatMap((x) => x.pictures);
  const lines = [`[${p.who === 'guest' ? 'not signed in' : `${p.who}, signed in as ${WHO[p.who].name}`}] ${p.page.url().replace(/^https?:\/\/[^/]+/, '')}`, 'The page says:', text || '(nothing)'];
  if (join('buttons').length) lines.push('Buttons: ' + join('buttons').map((x) => `"${x}"`).join(', '));
  if (join('links').length) lines.push('Links: ' + join('links').slice(0, 20).map((x) => `"${x}"`).join(', '));
  if (join('fields').length) lines.push('Fields: ' + join('fields').join(', '));
  if (pics.length) lines.push(`Pictures: ${pics.filter((x) => x === 'shown').length} shown, ${pics.filter((x) => x === 'broken').length} not loading`);
  for (const d of p.dialogs) lines.push(`A browser popup said: ${d}`);
  for (const d of p.downloads) {
    const f = await d.path().catch(() => null), body = f ? fs.readFileSync(f, 'utf8') : '';
    const keep = path.join(RUN, 'look', `${TAG}-${d.suggestedFilename()}`);
    if (f) fs.copyFileSync(f, keep);
    const ls = body.split(/\r?\n/);
    lines.push(`Downloaded a file: ${d.suggestedFilename()} (${ls.length} lines). It starts:\n${ls.slice(0, 15).join('\n')}`);
  }
  out.push(lines.join('\n'));
}
if (problems.length) out.push('What did not work:\n' + problems.map((x) => '- ' + x).join('\n'));
await b.close();
process.stdout.write(JSON.stringify({ seen: out.join('\n\n---\n\n') || '(no page open: start with {"open": "/path"})', shots }));
