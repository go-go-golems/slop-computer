// The renderer: a folded workspace's pages as static HTML. It walks the
// same tree the editor draws (page.ui.<n>, kinds at .k, props evaluated by
// Fruit) and prints markup that needs no script: a toggle is <details>, a
// to-do is a list item with a check glyph, colours are classes. Every
// string from the workspace goes through esc(); links are http(s) or
// mailto only (the prose grammar admits nothing else).
const { H, F, B } = require('./blocks.js');
const CSS = require('./style.js');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const COLORS = new Set(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
const TONE_BG = { accent: 'orange', good: 'green', bad: 'red', warn: 'yellow', muted: 'gray', you: 'blue' };
const LISTS = { bullet: 'ul', numbered: 'ol', todo: 'ul' };

/* ---------- prose ---------- */
// The editor's prose grammar (blocks-kit.js), compiled for each call:
// Blocks.tokens shares one global RegExp across its recursion and never
// returns on a bold, italic or struck span.
const PROSE = /(\{[^{}\n]+\}|\*\*(?:\{[^{}\n]+\}|[^*\n])+?\*\*|~~[^~\n]+~~|`[^`\n]+`|\[\[[A-Za-z_][\w.]*\]\]|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*(?!\s)(?:\{[^{}\n]+\}|[^*\n])+?\*|(?:^|(?<=\s))https?:\/\/[^\s<]+[^\s<.,;:!?)])/.source;
function tokens(s) {
  const re = new RegExp(PROSE, 'g'), out = [];
  let last = 0, m;
  s = String(s == null ? '' : s);
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    const x = m[0];
    if (x[0] === '{') out.push({ t: 'expr', src: x.slice(1, -1).trim() });
    else if (x.startsWith('**')) out.push({ t: 'b', kids: tokens(x.slice(2, -2)) });
    else if (x.startsWith('~~')) out.push({ t: 's', kids: tokens(x.slice(2, -2)) });
    else if (x[0] === '`') out.push({ t: 'code', v: x.slice(1, -1) });
    else if (x.startsWith('[[')) out.push({ t: 'page', name: x.slice(2, -2) });
    else if (x[0] === '[') { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(x); out.push({ t: 'a', v: mm[1], url: mm[2] }); }
    else if (x[0] === '*') out.push({ t: 'i', kids: tokens(x.slice(1, -1)) });
    else out.push({ t: 'a', v: x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48), url: x });
    last = m.index + x.length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

// A value as a reader sees it: an error is a dash, a value waiting on a hole is an ellipsis.
const shown = (v) => (H.isErr(v) ? '—' : H.unfinished(v) ? '…' : F.fmt(v));

function prose(cx, q, s) {
  const walk = (list) => list.map((tk) => {
    switch (tk.t) {
      case 'text': return esc(tk.v);
      case 'b': return `<strong>${walk(tk.kids)}</strong>`;
      case 'i': return `<em>${walk(tk.kids)}</em>`;
      case 's': return `<s>${walk(tk.kids)}</s>`;
      case 'code': return `<code>${esc(tk.v)}</code>`;
      case 'a': return `<a href="${esc(tk.url)}" rel="noopener noreferrer nofollow">${esc(tk.v)}</a>`;
      case 'page': return mention(cx, tk.name);
      case 'expr': return `<span class="val">${esc(shown(B.valueOf(cx.site.K, q, tk.src, cx.env)))}</span>`;
    }
    return '';
  }).join('');
  return walk(tokens(s));
}
function plain(cx, q, s) {
  const walk = (list) => list.map((tk) => (tk.kids ? walk(tk.kids) : tk.t === 'page' ? (cx.site.has(tk.name) ? cx.site.title(tk.name) : tk.name)
    : tk.t === 'expr' ? shown(B.valueOf(cx.site.K, q, tk.src, cx.env)) : tk.v)).join('');
  return walk(tokens(s));
}
// [[page]]: a link when the page is published; otherwise its name, not its title.
function mention(cx, n) {
  if (!cx.site.has(n)) return `<span class="mention">${esc(n.replace(/_/g, ' '))}</span>`;
  const ic = cx.site.icon(n);
  return `<a class="mention" href="${esc(cx.link(n))}">${ic ? `<span class="i">${esc(ic)}</span>` : ''}${esc(cx.site.title(n))}</a>`;
}

/* ---------- blocks ---------- */
const prop = (cx, q, name) => F.prop(cx.site.K, q, name, cx.env);
// A block's text prop as HTML: a literal is prose; a formula's value is formatted, then read as prose.
function textOf(cx, q, name) {
  const c = cx.site.K.cells.get(q + '.' + name);
  if (c && c.kind === 'lit' && typeof c.v === 'string') return prose(cx, q, c.v);
  const v = prop(cx, q, name);
  if (v == null) return '';
  if (H.isErr(v) || H.unfinished(v)) return esc(shown(v));
  return prose(cx, q, typeof v === 'string' ? v : F.fmt(v));
}
function plainOf(cx, q, name) {
  const v = prop(cx, q, name);
  if (v == null) return '';
  return typeof v === 'string' ? plain(cx, q, v) : shown(v);
}
function tint(cx, q) {
  const c = prop(cx, q, 'color'), b = prop(cx, q, 'bg');
  return (COLORS.has(c) ? ' c-' + c : '') + (COLORS.has(b) ? ' bg-' + b : '');
}
const anchor = (q) => 'b' + q.slice(q.indexOf('.ui.') + 4).replace(/\./g, '-');
const kidsOf = (cx, q) => F.kidsOf(cx.site.K, q);
const below = (cx, q) => (kidsOf(cx, q).length ? blocks(cx, q) : '');

function blocks(cx, parent) {
  const items = kidsOf(cx, parent);
  let out = '';
  for (let i = 0; i < items.length;) {
    const kind = F.kindOf(cx.site.K, items[i]);
    if (LISTS[kind]) {
      let j = i;
      while (j < items.length && F.kindOf(cx.site.K, items[j]) === kind) j++;
      out += `<${LISTS[kind]} class="${kind}">${items.slice(i, j).map((q) => item(cx, q, kind)).join('')}</${LISTS[kind]}>`;
      i = j;
    } else {
      out += block(cx, items[i], kind);
      i++;
    }
  }
  return out;
}

function item(cx, q, kind) {
  const cls = tint(cx, q).trim(), t = textOf(cx, q, 'text'), kids = below(cx, q);
  if (kind !== 'todo') return `<li${cls ? ` class="${cls}"` : ''}>${t}${kids}</li>`;
  const done = !!prop(cx, q, 'done');
  return `<li class="${((done ? 'done ' : '') + cls).trim()}"><span class="check" aria-hidden="true">${done ? '☑' : '☐'}</span>`
    + `<span class="sr">${done ? 'Done: ' : 'To do: '}</span><span class="t">${t}</span>${kids}</li>`;
}

function labelled(cx, q, cls) {
  const label = prop(cx, q, 'label');
  return `<p class="labelled${cls}">${label ? `<span class="ql">${esc(shown(label))}</span>` : ''}<b class="val">${esc(shown(prop(cx, q, 'of')))}</b></p>`;
}

function block(cx, q, kind) {
  const tc = tint(cx, q), K = cx.site.K;
  switch (kind) {
    case 'p': case 'text': case 'md': {
      const t = textOf(cx, q, 'text'), kids = below(cx, q);
      return (t.trim() ? `<p${tc ? ` class="${tc.trim()}"` : ''}>${t}</p>` : '') + (kids ? `<div class="kids">${kids}</div>` : '');
    }
    case 'h1': case 'h2': case 'h3': {
      const n = +kind[1] + 1;
      return `<h${n} id="${anchor(q)}"${tc ? ` class="${tc.trim()}"` : ''}>${textOf(cx, q, 'text')}</h${n}>`;
    }
    case 'quote': return `<blockquote${tc ? ` class="${tc.trim()}"` : ''}>${textOf(cx, q, 'text')}${below(cx, q)}</blockquote>`;
    case 'callout': case 'note': {
      const icon = prop(cx, q, 'icon'), tone = prop(cx, q, 'tone');
      const bg = !COLORS.has(prop(cx, q, 'bg')) && TONE_BG[tone] ? ' bg-' + TONE_BG[tone] : '';
      return `<aside class="callout${tc}${bg}"><span class="ci" aria-hidden="true">${esc(typeof icon === 'string' && icon ? icon : '💡')}</span>`
        + `<div class="ct">${textOf(cx, q, 'text')}${below(cx, q)}</div></aside>`;
    }
    case 'code': {
      const v = prop(cx, q, 'text');
      return `<pre><code>${esc(typeof v === 'string' ? v : shown(v))}</code></pre>`;
    }
    case 'divider': return '<hr>';
    case 'fold': return `<details${prop(cx, q, 'open') ? ' open' : ''}${tc ? ` class="${tc.trim()}"` : ''}><summary>${textOf(cx, q, 'title')}</summary><div class="kids">${below(cx, q)}</div></details>`;
    case 'columns': return `<div class="cols">${kidsOf(cx, q).map((c) => `<div class="col">${blocks(cx, c)}</div>`).join('')}</div>`;
    case 'col': return `<div class="col">${blocks(cx, q)}</div>`;
    case 'page': {
      // as the editor: a formula names its target by its source, a literal by its value
      const c = K.cells.get(q + '.of'), name = c && c.kind === 'formula' ? c.src || '' : String(prop(cx, q, 'of') || '');
      if (!cx.site.has(name)) return '';
      cx.linked.add(name);
      return `<a class="pagelink" href="${esc(cx.link(name))}"><span class="i">${esc(cx.site.icon(name) || '📄')}</span><span class="t">${esc(cx.site.title(name))}</span></a>`;
    }
    case 'toc': {
      const list = headings(cx, cx.page);
      return list.length ? `<nav class="toc" aria-label="On this page">${list.map((x) => `<a class="l${x.level}" href="#${anchor(x.q)}">${esc(x.text || 'Heading')}</a>`).join('')}</nav>` : '';
    }
    case 'table': {
      let rows = prop(cx, q, 'of');
      if (rows && typeof rows === 'object' && !Array.isArray(rows)) rows = Object.values(rows);
      rows = [].concat(rows || []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
      const cols = [...new Set(rows.flatMap(Object.keys))];
      if (!cols.length) return '';
      return `<div class="table"><table><thead><tr>${cols.map((k) => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>`
        + rows.map((r) => `<tr>${cols.map((k) => `<td>${r[k] == null ? '' : typeof r[k] === 'string' ? prose(cx, q, r[k]) : esc(shown(r[k]))}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>';
    }
    case 'stat': {
      const label = prop(cx, q, 'label');
      return `<div class="stat${tc}"><div class="sv val">${esc(shown(prop(cx, q, 'of')))}</div>${label ? `<div class="sl">${esc(shown(label))}</div>` : ''}</div>`;
    }
    case 'progress': {
      const v = prop(cx, q, 'of'), label = prop(cx, q, 'label');
      const pct = typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round((v <= 1 ? v * 100 : v)))) : 0;
      return `<div class="progress${tc}">${label ? `<span class="ql">${esc(shown(label))}</span> ` : ''}<progress max="100" value="${pct}">${pct}%</progress> <span class="val">${pct}%</span></div>`;
    }
    case 'num': case 'date': case 'slider': return labelled(cx, q, tc);
    case 'image': {
      const src = prop(cx, q, 'src'), alt = prop(cx, q, 'alt');
      return typeof src === 'string' && /^https?:\/\//.test(src) ? `<p><img src="${esc(src)}" alt="${esc(typeof alt === 'string' ? alt : '')}" loading="lazy"></p>` : '';
    }
  }
  // holes and interactive widgets (buttons, programs, browsers ...) have no place on a read-only page: their child blocks do
  return below(cx, q);
}

function headings(cx, page) {
  const out = [];
  const walk = (p) => {
    for (const q of kidsOf(cx, p)) {
      const k = F.kindOf(cx.site.K, q);
      if (k === 'h1' || k === 'h2' || k === 'h3') out.push({ q, level: +k[1], text: plainOf(cx, q, 'text') });
      walk(q);
    }
  };
  if (cx.site.K.exists(page + '.ui')) walk(page + '.ui');
  return out;
}

/* ---------- documents ---------- */
// opts: {link(page) -> href, home -> href, admin: {source, href} | null, note}
function context(site, page, link) {
  return { site, page, link, env: { app: page, al: new Map(), depth: 0 }, linked: new Set() };
}

function tree(site, current, link) {
  const open = new Set(current ? site.chain(current) : []);
  const list = (pages) => `<ul>${pages.map((p) => {
    const kids = site.kids(p);
    return `<li><a href="${esc(link(p))}"${p === current ? ' aria-current="page"' : ''}>${site.icon(p) ? esc(site.icon(p)) + ' ' : ''}${esc(site.title(p))}</a>`
      + (kids.length && open.has(p) ? list(kids) : '') + '</li>';
  }).join('')}</ul>`;
  return list(site.roots);
}

function layout(site, { title, current, link, home, admin, body }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${esc(title)}</title><meta name="generator" content="slop blocks-site"><style>${CSS}</style></head><body>`
    + `<header class="top"><a class="brand" href="${esc(home)}">${esc(site.name)}</a>`
    + (admin ? `<div class="admin">Live from <b>${esc(admin.source)}</b> · <a href="${esc(admin.href)}">Settings and publishing</a></div>` : '')
    + '</header><div class="shell">'
    + `<nav class="side" aria-label="Pages">${site.pages.length ? tree(site, current, link) : '<p class="empty">No pages yet.</p>'}</nav>`
    + `<main>${body}</main></div><footer>Published from Claude Blocks</footer></body></html>`;
}

function page(site, n, opts) {
  const cx = context(site, n, opts.link);
  const chain = site.chain(n);
  const crumbs = chain.length > 1 ? `<nav class="crumbs" aria-label="Breadcrumb">${chain.slice(0, -1).map((p) => `<a href="${esc(opts.link(p))}">${esc(site.title(p))}</a> / `).join('')}${esc(site.title(n))}</nav>` : '';
  const icon = site.icon(n);
  const body = blocks(cx, n + '.ui');
  const sub = site.kids(n).filter((k) => !cx.linked.has(k));
  const more = sub.length ? `<section class="sub"><h2>Pages in this section</h2>${sub.map((k) => `<a class="pagelink" href="${esc(opts.link(k))}"><span class="i">${esc(site.icon(k) || '📄')}</span><span class="t">${esc(site.title(k))}</span></a>`).join('')}</section>` : '';
  const main = `${crumbs}<article><h1 class="title">${icon ? `<span class="pi">${esc(icon)}</span>` : ''}${esc(site.title(n))}</h1>${body}</article>${more}`;
  return layout(site, { title: n === site.home && !site.config.title ? site.title(n) : `${site.title(n)} · ${site.name}`, current: n, link: opts.link, home: opts.home, admin: opts.admin, body: main });
}

// A page for a site with nothing to show yet (no pages, or a missing one).
function message(site, title, text, opts) {
  return layout(site, { title, current: '', link: opts.link, home: opts.home, admin: opts.admin, body: `<article><h1 class="title">${esc(title)}</h1><p class="empty">${esc(text)}</p></article>` });
}

// The live reader's links: absolute, under the mount.
function liveLinks(site, base) {
  return { link: (n) => base + '/' + (n === site.home ? '' : site.slug(n)), home: base + '/' };
}

// Static output: index.html for the home page, <slug>/index.html for the rest, relative links.
function staticFiles(site) {
  return site.pages.map((p) => {
    const up = p === site.home ? '' : '../';
    const link = (n) => (n === site.home ? up || './' : up + site.slug(n) + '/');
    return { path: p === site.home ? 'index.html' : site.slug(p) + '/index.html', text: page(site, p, { link, home: up || './', admin: null }) };
  });
}

// The settings and publishing page (admins only), plain forms.
function adminPage(site, { base, source, rev, published, note, bad }) {
  const opts = liveLinks(site, base), c = site.config;
  const pageOpts = (sel, none) => `<option value="">${esc(none)}</option>`
    + site.all.map((p) => `<option value="${esc(p)}"${p === sel ? ' selected' : ''}>${esc(site.title(p))} (${esc(p)})</option>`).join('');
  const last = published ? `<dt>Last publication</dt><dd>#${esc(published.n)} to <b>${esc(published.to)}</b> (${published.live ? 'live' : 'draft'}), ${esc(new Date(published.at).toISOString().replace('T', ' ').slice(0, 16))} UTC, ${esc(published.pages)} pages</dd>` : '<dt>Last publication</dt><dd>none yet</dd>';
  const body = `<article class="form"><h1 class="title">Settings and publishing</h1>`
    + (note ? `<p class="note${bad ? ' bad' : ''}">${esc(note)}</p>` : '')
    + `<dl class="facts"><dt>Source workspace</dt><dd>${esc(source)} (rev ${esc(rev)})</dd><dt>Published pages</dt><dd>${site.pages.length}</dd>${last}</dl>`
    + `<form method="post" action="${esc(base)}/_publish"><fieldset><legend>Publish a snapshot</legend>`
    + `<label for="to">Static store</label><input id="to" name="to" value="${esc(c.to || '')}" placeholder="team-static" pattern="[a-z0-9][a-z0-9-]*" required>`
    + `<p class="hint">The pages are rendered now and pushed into this store. You need to be an admin of it.</p>`
    + `<div class="row"><button class="primary" name="live" value="1">Publish now</button><button name="live" value="0">Push a draft for review</button></div>`
    + `<p class="hint">A draft moves the store's draft ref only: review it in the Workshop, then publish there.</p></fieldset></form>`
    + `<form method="post" action="${esc(base)}/_site"><fieldset><legend>Settings</legend>`
    + `<label for="title">Site title</label><input id="title" name="title" value="${esc(c.title || '')}" placeholder="${esc(site.home ? site.title(site.home) : 'Blocks')}">`
    + `<label for="root">Publish</label><select id="root" name="root">${pageOpts(c.root, 'the whole workspace')}</select>`
    + `<p class="hint">Or one page and its sub-pages; the rest stays private.</p>`
    + `<label for="home">Home page</label><select id="home" name="home">${pageOpts(c.home, 'the first page')}</select>`
    + `<input type="hidden" name="to" value="${esc(c.to || '')}">`
    + `<div class="row"><button class="primary">Save</button></div></fieldset></form></article>`;
  return layout(site, { title: 'Settings · ' + site.name, current: '', link: opts.link, home: opts.home, admin: { source, href: base + '/_site' }, body });
}

module.exports = { page, message, staticFiles, liveLinks, adminPage, tokens, esc };
