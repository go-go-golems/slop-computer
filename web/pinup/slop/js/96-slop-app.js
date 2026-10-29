// ---------- slop apps (web/pinup/slop; not part of upstream Pinup) ----------
// A Pinup app is a real page on the site whose source is this design. Every
// top-level frame with a route (node.route = '/', '/runs', '/runs/:id') is a
// screen. Publish app compiles the screens into one page artifact (every
// screen in a <template>, one stylesheet, a small inline runtime that picks
// the screen for the URL and fills in data, images as files) and routes each
// screen on a site host. S.file.app = {page, host, base, data} says where.
// Guide: ttmp/2026/10/29/SLOP-005-…/design-doc/01.

// Steps from agents (and Claude's tools) set only the fields Pinup allows;
// the app's own fields are among them. Image bindings travel inside fills.
for (const k of ['route', 'record', 'repeat', 'href', 'html']) ALLOWED_KEYS.add(k);

const APP_SEG = /^(?:[a-z0-9][a-z0-9_-]*|:[a-z][a-z0-9_]*)$/;
const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

// '/Runs/' → '/runs'; '' and '/' → '/'.
function slopAppPath(p) {
  const s = String(p == null ? '' : p).trim().split('/').filter(Boolean).join('/');
  return '/' + s;
}
function slopAppValidPath(p, params) {
  if (p === '/') return true;
  return p.slice(1).split('/').every(s => APP_SEG.test(s) && (params || s[0] !== ':'));
}
function slopAppJoin(base, route) {
  base = slopAppPath(base); route = slopAppPath(route);
  if (route === '/') return base;
  return base === '/' ? route : base + route;
}
// Two routes are the same pattern when they differ only in parameter names.
const slopAppPattern = p => p.replace(/:[^/]+/g, ':');
const slopAppRepeat = r => (!r ? null : typeof r === 'string' ? { from: r } : r.from || typeof r.field === 'string' ? r : null);
// A link a page may have: a site path, http(s), mailto or a fragment.
const APP_URL = /^(\/|https?:\/\/|mailto:|#)/i;
const slopAppHref = (t, n) => (t.inst && t.inst.href) || n.href || '';
const slopAppImageBind = n => (n.fills || []).find(f => f.t === 'image' && f.bind);

function slopAppScreens() {
  return allFrames().filter(f => f.route != null && f.route !== '' && !f.component && f.visible);
}
function slopAppStart(screens) {
  return screens.find(f => slopAppPath(f.route) === '/') || screens.find(f => f.flow) || screens[0];
}

// The problems that stop a publish (errors) and the ones worth knowing
// (warnings), plus the screens in publish order.
function slopAppCheck() {
  const app = S.file.app, errors = [], warnings = [];
  if (!app) return { errors: ['This design is not an app yet: slop menu → Make this an app.'], warnings, screens: [] };
  if (!APP_ID.test(app.page || '')) errors.push('The page id must be lowercase letters, digits and -.');
  if (!app.host) errors.push('Choose a site host.');
  if (!slopAppValidPath(slopAppPath(app.base), false)) errors.push('The base path is lowercase letters, digits, - and _ between slashes.');
  const data = app.data || {};
  const screens = slopAppScreens();
  if (!screens.length) errors.push('No screen has a page path. Select a screen and set its path in the Prototype tab.');
  const seen = new Map();
  for (const f of screens) {
    const p = slopAppPath(f.route);
    if (!slopAppValidPath(p, true)) { errors.push(`${f.name}: “${f.route}” is not a valid path.`); continue; }
    const k = slopAppPattern(p);
    if (seen.has(k)) errors.push(`${f.name} and ${seen.get(k).name} have the same path ${p}.`);
    else seen.set(k, f);
    if (f.record && !data[f.record]) errors.push(`${f.name} shows a record of “${f.record}”, which is not a data source of the app.`);
    if (f.record && !p.includes('/:')) warnings.push(`${f.name} shows one record but its path has no :parameter to name it.`);
  }
  const routed = new Set(screens.map(f => f.id));
  const walk = (t, scr) => {
    const n = t.n, link = (t.inst && t.inst.link) || n.link, href = slopAppHref(t, n);
    if (href && !href.includes('{{') && !APP_URL.test(href)) errors.push(`${scr.name}: “${n.name}” links to “${href}”, which is not a site path (/…) or an http(s) URL.`);
    if (!href && link && link.to !== 'back' && !routed.has(link.to)) {
      const to = get(link.to);
      warnings.push(`${scr.name}: “${n.name}” links to ${to ? to.name : 'a deleted screen'}, which has no page path; the link is left out.`);
    }
    const rep = slopAppRepeat((t.inst && t.inst.repeat) || n.repeat);
    if (rep) {
      if (!rep.from && !rep.field) errors.push(`${scr.name}: “${n.name}” repeats a list field but names none.`);
      if (rep.from && !data[rep.from]) errors.push(`${scr.name}: “${n.name}” repeats “${rep.from}”, which is not a data source of the app.`);
      for (const c of rep.where || []) if (!c.field) errors.push(`${scr.name}: “${n.name}” has a condition without a field.`);
      if (!t.kids.length) errors.push(`${scr.name}: “${n.name}” repeats records but has no child to repeat.`);
      if (!n.layout) warnings.push(`${scr.name}: “${n.name}” repeats records without auto layout, so the copies overlap.`);
      else if ((n.layout.dir === 'row' ? n.sw : n.sh) === 'fixed') warnings.push(`${scr.name}: “${n.name}” has a fixed ${n.layout.dir === 'row' ? 'width' : 'height'}; set it to Hug so it grows with the records.`);
    }
    t.kids.forEach(k => walk(k, scr));
  };
  for (const f of screens) { const t = expand(f, null); if (t) walk(t, f); }
  return { errors, warnings, screens };
}

// data: URL → bytes and a file extension.
function slopDataURL(src) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!m) return null;
  const mime = (m[1] || 'application/octet-stream').toLowerCase();
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[mime] || 'bin';
  let bytes;
  if (/;base64/i.test(m[2])) { const b = atob(m[3]); bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i); }
  else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
  return { bytes, ext };
}

// A screen root becomes the page: as wide as the window up to the frame's
// width, centred, at least as tall as the window (auto layout) or the frame.
function slopAppRootCSS(c, n) {
  delete c.left; delete c.top; delete c.width; delete c.height;
  c.position = 'relative';
  c.width = '100%';
  c['max-width'] = px(n.w);
  c.margin = '0 auto';
  c['min-height'] = n.layout ? '100vh' : px(n.h);
}

// Compiles the checked screens into the app page's files and manifest.
// designVersion is the saved design version it is compiled from.
// opts.inline keeps images as data: URLs (the live preview has no files).
async function slopAppCompile(chk, designVersion, opts = {}) {
  const app = S.file.app, base = slopAppPath(app.base), screens = chk.screens;
  const byId = new Map(screens.map(f => [f.id, f]));
  const trees = screens.map(f => ({ f, t: expand(f, null) })).filter(x => x.t);
  const files = {};

  // Images held as data: URLs become files named by content, at the root of
  // the version (the site finds a page's files by base name there).
  const imgs = new Map();
  const collect = t => { for (const f of t.n.fills || []) if (f.t === 'image' && typeof f.src === 'string' && f.src.startsWith('data:')) imgs.set(f.src, null); t.kids.forEach(collect); };
  if (!opts.inline) trees.forEach(x => collect(x.t));
  for (const src of imgs.keys()) {
    const d = slopDataURL(src); if (!d) { imgs.delete(src); continue; }
    const name = 'i-' + (await slopSha(d.bytes)).slice(0, 16) + '.' + d.ext;
    files[name] = d.bytes; imgs.set(src, name);
  }

  const used = new Set(), rules = [];
  const cls = n => { let b = slug(n.name).slice(0, 32) || 'l'; if (/^\d/.test(b)) b = 'l-' + b; let c = b, i = 2; while (used.has(c)) c = b + '-' + i++; used.add(c); return c; };
  const hrefFor = link => {
    if (link.to === 'back') return { href: slopAppJoin(base, '/'), back: true };
    const to = byId.get(link.to); if (!to) return null;
    const url = slopAppJoin(base, to.route);
    return url.includes('/:') ? { tpl: url.replace(/:([a-z][a-z0-9_]*)/g, '{{$1}}') } : { href: url };
  };
  const emit = (t, depth, inLink) => {
    let n = t.n;
    if ((n.fills || []).some(f => f.t === 'image' && imgs.has(f.src))) n = Object.assign({}, n, { fills: n.fills.map(f => (f.t === 'image' && imgs.has(f.src) ? Object.assign({}, f, { src: imgs.get(f.src) }) : f)) });
    const c = cls(n);
    const css = cssFor(n, t.P, Object.assign({ root: depth === 0 }, EXO));
    if (n.type === 'line') { css.border = '0'; css.margin = '0'; }
    if (depth === 0) slopAppRootCSS(css, n);
    // Fill height inside a parent that hugs its content has nothing to fill
    // in CSS (the bar collapses to its icons): keep the designed height.
    else if (n.sh === 'fill' && t.P && t.P.layout && t.P.sh === 'hug' && !n.abs) css['min-height'] = px(n.h);
    let tag = depth === 0 ? 'main' : tagFor(n, t.inst);
    let attrs = ` class="${c}${depth === 0 && n.mode === 'dark' ? ' dark' : ''}"`;
    const href = depth > 0 && !inLink && slopAppHref(t, n);
    const link = depth > 0 && !inLink && !href && ((t.inst && t.inst.link) || n.link);
    const to = href ? (href.includes('{{') ? { tpl: href } : { href, ext: /^https?:/i.test(href) }) : link && hrefFor(link);
    if (to) {
      tag = 'a'; inLink = true;
      if (!css.display) css.display = 'block';
      attrs += to.tpl ? ` href="#" data-href="${esc(to.tpl)}"` : ` href="${esc(to.href)}"`;
      if (to.back) attrs += ' data-back';
      if (to.ext) attrs += ' rel="noopener"';
    } else if (inLink && tag === 'button') tag = 'span';
    if (t.inst) attrs += ` data-component="${esc(t.main.name)}"`;
    const ib = slopAppImageBind(n);
    if (ib) attrs += ` data-img="${esc(ib.bind)}" data-img-fit="${esc(ib.fit || 'cover')}"`;
    rules.push(`.${c} { ${Object.entries(css).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
    const pad = '  '.repeat(depth + 1);
    if (n.type === 'text') {
      if (n.html) { // rich text from a field: block content, so a div, not a p
        if (tag !== 'a') tag = 'div';
        return `${pad}<${tag}${attrs.replace(/ class="/, ' class="pinup-rich ')} data-html="${esc(n.html)}">${esc(n.text)}</${tag}>`;
      }
      if (String(n.text).includes('{{')) attrs += ` data-t="${esc(n.text)}"`;
      return `${pad}<${tag}${attrs}>${esc(n.text)}</${tag}>`;
    }
    if (n.type === 'icon') return `${pad}<span${attrs} data-icon="${esc(n.icon)}">${iconSVG(n)}</span>`;
    if (n.type === 'svg') return `${pad}<div${attrs}>${cleanSVG(n.markup)}</div>`;
    if (n.type === 'line') return `${pad}<hr${attrs}>`;
    const rep = slopAppRepeat((t.inst && t.inst.repeat) || n.repeat);
    if (rep && t.kids.length) {
      const where = (rep.where || []).filter(c => c && c.field);
      const ra = (rep.from ? ` data-repeat="${esc(rep.from)}"` : ` data-repeat-field="${esc(rep.field)}"`) + (+rep.limit > 0 ? ` data-limit="${+rep.limit}"` : '')
        + (rep.sort ? ` data-sort="${esc(rep.sort)}"` : '') + (where.length ? ` data-where="${esc(JSON.stringify(where))}"` : '');
      return `${pad}<${tag}${attrs}>\n${pad}  <template${ra}>\n${emit(t.kids[0], depth + 2, inLink)}\n${pad}  </template>\n${pad}</${tag}>`;
    }
    const role = (n.fills || []).some(f => f.t === 'image') && !t.kids.length ? ` role="img" aria-label="${esc(n.name)}"` : '';
    if (!t.kids.length) return `${pad}<${tag}${attrs}${role}></${tag}>`;
    return `${pad}<${tag}${attrs}${role}>\n${t.kids.map(k => emit(k, depth + 1, inLink)).join('\n')}\n${pad}</${tag}>`;
  };

  const templates = trees.map(({ f, t }) => {
    const bg = (f.fills || []).find(x => x.visible !== false && x.t === 'solid');
    const bga = bg ? ` data-bg="${esc(paintCSS(bg, EXO))}"` : '';
    return `<template id="s-${esc(f.id)}"${bga}>\n${emit(t, 0, false)}\n</template>`;
  });
  const start = slopAppStart(screens);
  const appJSON = {
    name: S.file.name, base, start: start ? start.id : null,
    screens: screens.map(f => Object.assign({ id: f.id, name: f.name, route: slopAppPath(f.route) }, f.record ? { record: f.record } : {})),
  };
  const fonts = usedFonts(screens.map(f => f.id));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(S.file.name)}</title>
${fontLink(fonts)}
<style>
/* Compiled by Pinup from ${esc(SLOP.file)} v${designVersion}. Edit the design, not this file: the next Publish app replaces it. */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }
p, h1, h2, h3, h4 { margin: 0; }
a { color: inherit; text-decoration: none; }
button { all: unset; box-sizing: border-box; cursor: pointer; }
hr { margin: 0; border: 0; }
${tokensCSS()}
${rules.join('\n')}
.pinup-rich { white-space: normal; }
.pinup-rich > * { margin: 0; }
.pinup-rich > * + * { margin-top: .6em; }
.pinup-rich ul, .pinup-rich ol { padding-left: 1.4em; }
.pinup-rich img { max-width: 100%; height: auto; }
.pinup-rich a { text-decoration: underline; }
.pinup-rich pre { white-space: pre-wrap; }
</style>
</head>
<body>
<noscript><p style="font:16px system-ui;padding:24px">This page needs JavaScript.</p></noscript>
${templates.join('\n')}
<script type="application/json" id="pinup-app">${JSON.stringify(appJSON).replace(/</g, '\\u003c')}<\/script>
<script>
(${slopAppRuntime.toString()})();
<\/script>
</body>
</html>
`;
  files['index.html'] = html;
  const manifest = { title: S.file.name, pinup: { design: SLOP.file, version: designVersion } };
  if (app.data && Object.keys(app.data).length) manifest.reads = Object.assign({}, app.data);
  return { files, manifest, app: appJSON };
}

// The runtime inlined in every compiled page. It must stay self-contained
// (it is copied as source) and plain ES5-ish so any browser runs it. Path
// matching mirrors pkg/routing: :name is one segment; literal 3, :param 2.
function slopAppRuntime() {
  'use strict';
  var A = JSON.parse(document.getElementById('pinup-app').textContent);
  var W = window.slop || { route: { path: location.pathname, params: {} }, data: {}, mode: 'site' };
  var D = W.data || {};
  function segs(p) { return String(p || '').split('/').filter(Boolean); }
  function match(pat, path) {
    var ps = segs(pat), xs = segs(path), out = {};
    if (ps.length !== xs.length) return null;
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].charAt(0) === ':') { var v = xs[i]; try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ } out[ps[i].slice(1)] = v; }
      else if (ps[i] !== xs[i]) return null;
    }
    return out;
  }
  function spec(pat) { return segs(pat).reduce(function (n, s) { return n + (s.charAt(0) === ':' ? 2 : 3); }, 0); }
  function rel(path) {
    var b = segs(A.base), x = segs(path);
    for (var i = 0; i < b.length; i++) if (x[i] !== b[i]) return null;
    return '/' + x.slice(b.length).join('/');
  }
  function rows(name) { var d = D[name]; return d && d.all ? d.all.slice() : []; }
  function lookup(chain, path) {
    var ks = path.split('.');
    for (var i = 0; i < chain.length; i++) {
      var o = chain[i];
      if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, ks[0])) {
        for (var j = 0; j < ks.length && o != null; j++) o = o[ks[j]];
        return o;
      }
    }
    return undefined;
  }
  function text(v) { return v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.src || '') : String(v); }
  function fill(t, chain, miss) {
    return t.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (_, k) { var v = text(lookup(chain, k)); if (!v && miss) miss.n++; return v; });
  }
  function cmp(x, y) { return typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), undefined, { numeric: true }); }
  function sortRows(list, by) {
    var desc = by.charAt(0) === '-', k = desc ? by.slice(1) : by;
    return list.sort(function (a, b) { var c = cmp(lookup([a], k), lookup([b], k)); return desc ? -c : c; });
  }
  function empty(v) { return v == null || v === '' || (Array.isArray(v) && !v.length); }
  // One condition of a repeat's where: the row's field against a value that
  // may hold placeholders of the enclosing scope.
  function test(v, op, want) {
    var eq = function (x) { return String(x == null ? '' : x) === want; };
    switch (op) {
      case '!=': return Array.isArray(v) ? !v.some(eq) : !eq(v);
      case 'contains': return Array.isArray(v) ? v.some(eq) : String(v == null ? '' : v).toLowerCase().indexOf(want.toLowerCase()) >= 0;
      case '<': return !empty(v) && cmp(v, want) < 0;
      case '>': return !empty(v) && cmp(v, want) > 0;
      case 'exists': return !empty(v);
      case 'missing': return empty(v);
      default: return Array.isArray(v) ? v.some(eq) : eq(v);
    }
  }
  // The items of a list field: objects as they are, anything else as {value, index}.
  function items(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (x, i) { return x && typeof x === 'object' && !Array.isArray(x) ? x : { value: x, index: i }; });
  }
  var LINK = /^(\/|https?:\/\/|mailto:|#)/i;
  var KEEP = ' P BR STRONG B EM I U S A UL OL LI H1 H2 H3 H4 H5 H6 BLOCKQUOTE CODE PRE HR IMG FIGURE FIGCAPTION TABLE THEAD TBODY TR TH TD SPAN SUP SUB SMALL ';
  var DROP = ' SCRIPT STYLE IFRAME OBJECT EMBED TEMPLATE FORM INPUT BUTTON TEXTAREA SELECT OPTION LINK META BASE NOSCRIPT SVG MATH FRAME FRAMESET AUDIO VIDEO SOURCE TITLE ';
  var ATTRS = { A: ' href title ', IMG: ' src alt title ' };
  // Rich text: only the tags above, only a/img attributes with safe URLs.
  function clean(node) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 8) { node.removeChild(k); continue; }
      if (k.nodeType !== 1) continue;
      var tag = k.tagName.toUpperCase();
      if (DROP.indexOf(' ' + tag + ' ') >= 0) { node.removeChild(k); continue; }
      clean(k);
      if (KEEP.indexOf(' ' + tag + ' ') < 0) { while (k.firstChild) node.insertBefore(k.firstChild, k); node.removeChild(k); continue; }
      var at = Array.prototype.slice.call(k.attributes);
      for (var j = 0; j < at.length; j++) {
        var n = at[j].name.toLowerCase();
        if ((ATTRS[tag] || '').indexOf(' ' + n + ' ') < 0 || ((n === 'href' || n === 'src') && !LINK.test(at[j].value.trim()))) k.removeAttribute(at[j].name);
      }
    }
  }
  function rich(html) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    clean(doc.body);
    var frag = document.createDocumentFragment();
    while (doc.body.firstChild) frag.appendChild(document.adoptNode(doc.body.firstChild));
    return frag;
  }
  function pos(fit) { return fit === 'fill' ? '0 0 / 100% 100% no-repeat' : fit === 'tile' ? '0 0 / auto repeat' : 'center / ' + (fit === 'contain' ? 'contain' : 'cover') + ' no-repeat'; }
  // Binds a fragment: repeats first (each copy bound with its row in front of
  // the chain), then text, links and images; bound attributes are removed so
  // an outer pass does not bind them again.
  function bind(root, chain) {
    var reps = root.querySelectorAll('template[data-repeat], template[data-repeat-field]');
    for (var i = 0; i < reps.length; i++) {
      var tp = reps[i];
      var list = tp.hasAttribute('data-repeat') ? rows(tp.getAttribute('data-repeat')) : items(lookup(chain, tp.getAttribute('data-repeat-field')));
      if (tp.getAttribute('data-where')) {
        var conds = []; try { conds = JSON.parse(tp.getAttribute('data-where')); } catch (e) { /* none */ }
        list = list.filter(function (row) { return conds.every(function (c) { return test(lookup([row], c.field), c.op, fill(String(c.value == null ? '' : c.value), chain)); }); });
      }
      if (tp.getAttribute('data-sort')) list = sortRows(list, tp.getAttribute('data-sort'));
      var lim = +tp.getAttribute('data-limit'); if (lim > 0) list = list.slice(0, lim);
      var frag = document.createDocumentFragment();
      for (var r = 0; r < list.length; r++) { var c = tp.content.cloneNode(true); bind(c, [list[r]].concat(chain)); frag.appendChild(c); }
      tp.parentNode.replaceChild(frag, tp);
    }
    var ts = root.querySelectorAll('[data-t]');
    for (var a = 0; a < ts.length; a++) { ts[a].textContent = fill(ts[a].getAttribute('data-t'), chain); ts[a].removeAttribute('data-t'); }
    var hs = root.querySelectorAll('[data-href]');
    for (var b = 0; b < hs.length; b++) {
      var miss = { n: 0 }, u = fill(hs[b].getAttribute('data-href'), chain, miss);
      if (miss.n || !LINK.test(u.trim())) hs[b].removeAttribute('href'); else hs[b].setAttribute('href', u.trim());
      hs[b].removeAttribute('data-href');
    }
    var rs = root.querySelectorAll('[data-html]');
    for (var x = 0; x < rs.length; x++) {
      var hv = lookup(chain, rs[x].getAttribute('data-html'));
      if (!empty(hv)) { rs[x].textContent = ''; rs[x].appendChild(rich(hv)); }
      rs[x].removeAttribute('data-html');
    }
    var is = root.querySelectorAll('[data-img]');
    for (var d = 0; d < is.length; d++) {
      var src = text(lookup(chain, is[d].getAttribute('data-img')));
      if (src) is[d].style.background = 'url("' + src.replace(/"/g, '%22') + '") ' + pos(is[d].getAttribute('data-img-fit'));
      is[d].removeAttribute('data-img'); is[d].removeAttribute('data-img-fit');
    }
  }
  function notFound() {
    document.title = 'Not found';
    var p = document.createElement('p');
    p.style.cssText = 'font:16px system-ui;padding:24px';
    p.textContent = 'Not found.';
    document.body.appendChild(p);
  }
  var path = rel(W.route && W.route.path), best = null, params = null;
  if (path != null) {
    for (var s = 0; s < A.screens.length; s++) {
      var m = match(A.screens[s].route, path);
      if (m && (!best || spec(A.screens[s].route) > spec(best.route))) { best = A.screens[s]; params = m; }
    }
  }
  var site = W.mode === 'site';
  if (!best) {
    if (site) return notFound();
    best = A.screens.filter(function (x) { return x.id === A.start; })[0] || A.screens[0];
    params = {};
  }
  var chain = [{ params: params, app: { name: A.name } }];
  if (best.record) {
    var list = rows(best.record), keys = Object.keys(params), key = keys.length ? params[keys[0]] : null, rec = null;
    for (var q = 0; q < list.length && !rec; q++) if (list[q].id === key || list[q].slug === key) rec = list[q];
    if (!rec && !site) rec = list[0] || null; // previews show the first record
    if (!rec) return notFound();
    chain.unshift(rec);
  }
  var tpl = document.getElementById('s-' + best.id);
  var frag = tpl.content.cloneNode(true);
  bind(frag, chain);
  if (tpl.getAttribute('data-bg')) document.body.style.background = tpl.getAttribute('data-bg');
  document.title = best.record && chain[0].title ? chain[0].title + ' · ' + A.name : best.name + ' · ' + A.name;
  document.body.appendChild(frag);
  // Back goes back when the previous page was in this app, else to its start.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-back]');
    if (!a || !document.referrer) return;
    try { var r = new URL(document.referrer); if (r.origin === location.origin && rel(r.pathname) != null && history.length > 1) { e.preventDefault(); history.back(); } } catch (err) { /* follow the link */ }
  });
}

// ---------- publishing ----------
// Preview pushes a version of the app page without moving main and returns
// its Workshop URL. Publish moves main and routes every screen on the app's
// host: routes it would add that point at another page stop it before
// anything is written, and routes of this page that no screen has any more
// are removed. Routes elsewhere are never touched.
// replace: the person confirmed replacing a hand-written main.
async function slopAppPublish(preview, replace) {
  const api = SLOP.api, app = S.file.app, enc = encodeURIComponent;
  const chk = slopAppCheck();
  if (chk.errors.length) throw new Error(chk.errors[0] + (chk.errors.length > 1 ? ` (and ${chk.errors.length - 1} more problems)` : ''));
  const urls = chk.screens.map(f => slopAppJoin(app.base, f.route));
  let page = null;
  try { page = await api.get('/artifacts/' + enc(app.page)); } catch (e) { if (e.status !== 404) throw e; }
  if (page && page.kind !== 'page') throw new Error(`${app.page} is a ${page.kind} artifact: choose another page id in App settings.`);
  if (page && page.main) {
    const v = await api.get(`/artifacts/${enc(app.page)}/versions/${page.main}`);
    const pin = v.manifest && v.manifest.pinup;
    if (pin && pin.design !== SLOP.file) throw new Error(`${app.page} is compiled from ${pin.design}, not this design: choose another page id in App settings.`);
    if (!pin && !replace) {
      // A page that never came from this design is someone else's; one whose
      // main was pushed by hand over a Pinup version is replaced only on request.
      const vs = await api.get(`/artifacts/${enc(app.page)}/versions`);
      const ours = (vs || []).some(x => x.manifest && x.manifest.pinup && x.manifest.pinup.design === SLOP.file);
      if (!ours) throw new Error(`${app.page} exists and was not published from this design: choose another page id in App settings.`);
      throw Object.assign(new Error(`${app.page} v${page.main} was changed by hand.`), { handWritten: page.main });
    }
  }
  let routes = [];
  if (!preview) {
    routes = (await api.get('/routes', { host: app.host })) || [];
    const clash = routes.filter(r => urls.includes(r.path) && r.page !== app.page);
    if (clash.length) throw new Error(clash.map(r => `${r.path} is routed to ${r.page}`).join('; ') + '. Change the paths or the base path, or move those routes first.');
  }
  const dv = await slopSaveVersion(preview ? 'Previewed as an app' : 'Published as an app');
  const out = await slopAppCompile(chk, dv);
  const o = { message: `${preview ? 'Preview' : 'Published'} from ${SLOP.file} v${dv}`, manifest: out.manifest, moveMain: !preview };
  if (page) o.base = page.main;
  else o.create = { title: S.file.name, kind: 'page', project: (await api.get('/artifacts/' + enc(SLOP.file))).project || null };
  const r = await slopPush(app.page, out.files, o);
  const n = r && r.version ? r.version.n : null;
  if (preview) return { n, url: ((api.config && api.config.publicUrl) || '') + '/watch/' + enc(app.page) + '/' + n };
  const note = 'Pinup app ' + SLOP.file;
  for (const p of urls) {
    const cur = routes.find(x => x.path === p);
    if (cur && cur.page === app.page && cur.version == null && !cur.pageFrom && !cur.record && cur.access === 'public' && !Object.keys(cur.bindings || {}).length) continue;
    await api.put('/routes', { host: app.host, path: p, page: app.page, version: null, access: 'public', bindings: {}, note });
  }
  const gone = routes.filter(x => x.page === app.page && !urls.includes(x.path));
  for (const x of gone) await api.del('/routes', { host: app.host, path: x.path, note: note + ': no screen at this path any more' });
  return { n, urls, removed: gone.map(x => x.path) };
}

// ---------- settings ----------
// First time: every top-level frame on the current page without a path gets
// one (the flow start or first frame '/', the others their slugged name).
function slopAppAssignPaths() {
  const frames = framesOnPage(S.pageId).filter(f => !f.component && f.visible);
  if (!frames.length || slopAppScreens().length) return;
  const start = frames.find(f => f.flow) || frames[0];
  const taken = new Set();
  patchMany(frames.map(f => {
    let p = f === start ? '/' : '/' + (slug(f.name) || 'screen'), i = 2;
    while (taken.has(p)) p = '/' + slug(f.name) + '-' + i++;
    taken.add(p);
    return [f.id, { route: p }];
  }), { label: 'Page paths' });
}

function slopAppSheet() {
  const api = SLOP.api, cur = S.file.app || {};
  const hosts = (api.config && api.config.siteHosts) || [];
  const page = h('input', { type: 'text', value: cur.page || slug(S.file.name), 'aria-label': 'Page id', style: { width: '100%' } });
  const host = h('select', { 'aria-label': 'Site host' }, ...hosts.map(x => h('option', { value: x, text: x, selected: x === cur.host })));
  const base = h('input', { type: 'text', value: cur.base || '/' + slug(S.file.name), 'aria-label': 'Base path', style: { width: '100%' } });
  const rows = h('div', { class: 'stack' });
  let arts = [];
  const addRow = (name, id) => {
    const nm = h('input', { type: 'text', value: name || '', placeholder: 'name, e.g. runs', 'aria-label': 'Source name', style: { width: '120px' } });
    const sel = h('select', { 'aria-label': 'Data artifact' }, h('option', { value: '', text: 'Choose data…' }),
      h('option', { value: '$site', text: 'This site’s public pages ($site)', selected: id === '$site' }),
      ...arts.map(a => h('option', { value: a.id, text: a.title + ' · ' + a.id, selected: a.id === id })));
    if (id && id !== '$site' && !arts.some(a => a.id === id)) sel.append(h('option', { value: id, text: id, selected: true }));
    const row = h('div', { class: 'acts', style: { justifyContent: 'flex-start' } }, nm, sel, h('button', { class: 'btn sm', text: 'Remove', onclick: () => row.remove() }));
    row._get = () => [nm.value.trim(), sel.value];
    rows.append(row);
  };
  const out = h('span', { class: 'muted' });
  const save = h('button', { class: 'btn primary sm', text: S.file.app ? 'Save' : 'Make this an app', onclick: () => {
    const data = {};
    for (const r of rows.children) { const [k, v] = r._get(); if (!k && !v) continue; if (!/^[a-z][a-z0-9_]*$/.test(k) || !v) { out.textContent = 'A source is a lowercase name and a data artifact.'; return; } data[k] = v; }
    const app = { page: page.value.trim(), host: host.value, base: slopAppPath(base.value), data };
    if (!APP_ID.test(app.page)) { out.textContent = 'The page id is lowercase letters, digits and -.'; return; }
    if (!slopAppValidPath(app.base, false)) { out.textContent = 'The base path is lowercase letters, digits, - and _ between slashes.'; return; }
    const first = !S.file.app;
    setFile({ app }, { label: 'App settings' });
    if (first) slopAppAssignPaths();
    sh.close();
    toast(first ? 'This design is an app: each screen with a page path becomes a page. Prototype tab → App.' : 'App settings saved.', 3500);
    setTab('proto'); INSP.force = true; renderInspector();
  } });
  const sh = sheet(S.file.app ? 'App settings' : 'Make this an app', [
    h('p', { text: 'Publish app compiles the screens that have a page path into a page artifact and routes each screen on the site. The design stays the source: edit here, publish again.' }),
    h('div', { class: 'opt' }, h('b', { text: 'Page artifact' }), page),
    h('div', { class: 'opt' }, h('b', { text: 'Where' }), host, base),
    h('div', { class: 'opt' }, h('b', { text: 'Data sources' }), h('p', { class: 'muted', text: 'Data artifacts the pages read. Text can show {{field}}, frames can repeat once per record, a screen whose path has a :parameter can show one record.' }), rows,
      h('div', { class: 'acts', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn sm', text: 'Add source', onclick: () => addRow('', '') }))),
    h('div', { class: 'acts' }, save), out,
  ], { width: 560 });
  api.get('/artifacts').then(list => {
    arts = (list || []).filter(a => a.kind === 'data' && a.type !== 'pinup' && a.type !== 'tokens');
    for (const [k, v] of Object.entries(cur.data || {})) addRow(k, v);
  }, () => { for (const [k, v] of Object.entries(cur.data || {})) addRow(k, v); });
}

async function slopAppRun(preview, replace) {
  toast(preview ? 'Compiling a preview…' : 'Publishing…', 60000);
  try {
    const r = await slopAppPublish(preview, replace);
    if (preview) { toast(`Preview: ${S.file.app.page} v${r.n} (not live).`, 3500); window.open(r.url, '_blank', 'noopener'); return; }
    const app = S.file.app, url = location.protocol + '//' + app.host + slopAppPath(app.base);
    toast(`Published ${app.page} v${r.n} at ${url}` + (r.removed.length ? ` · removed ${r.removed.join(', ')}` : ''), 5000);
    SLOP_APP.last = { n: r.n, url };
    INSP.force = true; renderInspector();
  } catch (e) {
    if (e.handWritten) { toast('Publishing waits for you.', 1500); slopAppReplaceSheet(preview, e.handWritten); return; }
    toast((preview ? 'Preview failed: ' : 'Publish failed: ') + (e.message || e), 6000);
  }
}

function slopAppReplaceSheet(preview, n) {
  const app = S.file.app;
  const go = h('button', { class: 'btn primary sm', text: 'Replace with the design', onclick: () => { sh.close(); slopAppRun(preview, true); } });
  const sh = sheet('Replace a hand-written version?', [
    h('p', { text: `${app.page} v${n} was pushed by hand, not published from this design. Publishing replaces it on the site with the design; v${n} stays in the page’s history.` }),
    h('p', { class: 'muted', text: 'If the page is meant to be hand-written code now, keep it and remove the app from this design instead.' }),
    h('div', { class: 'acts' }, h('button', { class: 'btn sm', text: 'Keep v' + n, onclick: () => sh.close() }), go),
  ], { width: 520 });
}

// ---------- the Prototype tab ----------
const SLOP_APP = { fields: new Map(), last: null };

// The rows a data source gives the page, as the server injects them: the
// records of a data artifact's main, or the site index of the app's host.
function slopAppRows(id, host) {
  const api = SLOP.api, enc = encodeURIComponent;
  if (id === '$site') return api.get('/site', { host });
  if (id.startsWith('$')) return Promise.resolve([]);
  return api.get('/artifacts/' + enc(id)).then(a => (a.main ? api.get(`/artifacts/${enc(id)}/versions/${a.main}/records`) : []));
}
// Field names of a source's records, loaded once: a data artifact's main,
// or for $site the site index of the app's host (with record.* keys).
function slopAppFields(name) {
  const app = S.file.app, id = app && app.data && app.data[name];
  if (!id) return [];
  const key = id === '$site' ? id + '@' + app.host : id;
  const c = SLOP_APP.fields.get(key);
  if (c) return c === 'loading' ? [] : c;
  SLOP_APP.fields.set(key, 'loading');
  slopAppRows(id, app.host).then(rs => {
    const ks = new Set();
    for (const r of (rs || []).slice(0, 200)) for (const k of Object.keys(r)) {
      if (k === 'record' && r.record && typeof r.record === 'object') for (const rk of Object.keys(r.record)) ks.add('record.' + rk);
      else ks.add(k);
    }
    SLOP_APP.fields.set(key, [...ks].sort()); INSP.force = true; renderInspector();
  }, () => SLOP_APP.fields.set(key, []));
  return [];
}
// What a layer's placeholders read: the nearest repeat above it (a source,
// or a list field), else its screen's record.
function slopAppScope(n) {
  for (const a of ancestors(n.id)) { const r = slopAppRepeat(a.repeat); if (r) return r.from ? { source: r.from } : { field: r.field }; }
  const top = topOf(n.id);
  return top && top.record ? { source: top.record } : null;
}
function slopAppScopeNote(sc) {
  if (!sc) return 'Text inside a repeated frame, or on a screen that shows a record, can show {{field}}. {{params.name}} shows a part of the path.';
  if (sc.field) return `Inside a repeat over the list ${sc.field}: {{value}} is a text item, {{index}} its position; object items show their own {{fields}}.`;
  const fields = slopAppFields(sc.source);
  return `Write {{field}} to show a field of ${sc.source}` + (fields.length ? ': ' + fields.map(k => '{{' + k + '}}').join(' ') : '.');
}

function slopAppSections() {
  const out = [], ns = selNodes(), app = S.file.app, can = SLOP.api && SLOP.api.can('versions:push');
  const field = (value, ph, set, aria) => h('input', { class: 'sel', value: value || '', placeholder: ph, disabled: !S.canEdit, 'aria-label': aria, onchange: e => set(e.target.value.trim()) });
  const sources = app ? Object.keys(app.data || {}) : [];
  if (!ns.length) {
    if (!app) {
      out.push(sec('App', null, h('p', { class: 'note', text: 'Publish this design as real pages on the site: each screen gets a path, links become links, text and lists can show data.' }),
        h('button', { class: 'btn', disabled: !can, onclick: slopAppSheet }, ico('globe'), 'Make this an app…')));
      return out;
    }
    const chk = slopAppCheck();
    const list = h('div', { class: 'stack' }, ...chk.screens.map(f => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
      h('button', { class: 'btn sm', onclick: () => { if (f.page !== S.pageId) goPage(f.page); select([f.id]); centerOn(f.id); } }, f.name),
      h('code', { text: slopAppJoin(app.base, f.route), style: { color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }))));
    const probs = [...chk.errors.map(e => h('p', { class: 'note', text: '✕ ' + e, style: { color: 'var(--danger, #c0362c)' } })), ...chk.warnings.map(w => h('p', { class: 'note', text: '! ' + w }))];
    const pub = SLOP.api && SLOP.api.can('routes:write');
    out.push(sec('App', ib('settings', 'App settings', slopAppSheet, { disabled: !can }),
      h('p', { class: 'note', text: `${app.page} on ${app.host}${slopAppPath(app.base)}` + (sources.length ? ' · data: ' + sources.join(', ') : '') }),
      list, ...probs,
      SLOP_APP.last ? h('p', { class: 'note' }, 'Live: ', h('a', { href: SLOP_APP.last.url, target: '_blank', rel: 'noopener', text: SLOP_APP.last.url })) : null,
      h('div', { class: 'acts', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn', disabled: !can || chk.errors.length > 0, onclick: () => slopAppRun(true) }, ico('eye'), 'Preview'),
        h('button', { class: 'btn primary', disabled: !can || !pub || chk.errors.length > 0, title: pub ? '' : 'This tool was not granted routes:write', onclick: () => slopAppRun(false) }, ico('globe'), 'Publish app'))));
    return out;
  }
  if (ns.length !== 1) return out;
  const n = ns[0];
  if (!n.parent && n.type === 'frame' && !n.component) {
    if (!app) { out.push(sec('Page path', null, h('p', { class: 'note', text: 'Make this design an app (Prototype tab with nothing selected) to give screens paths on the site.' }))); return out; }
    const p = n.route ? slopAppPath(n.route) : '';
    const body = [field(n.route, 'not a page (e.g. /runs/:id)', v => patch(n.id, { route: v ? slopAppPath(v) : null }, { label: 'Page path' }), 'Page path'),
      h('p', { class: 'note', text: p ? location.protocol + '//' + app.host + slopAppJoin(app.base, p) : 'Without a path this screen stays design-only.' })];
    if (p.includes('/:')) body.push(h('div', { class: 'g2' }, h('span', { text: 'Shows a record of', style: { color: 'var(--muted)', alignSelf: 'center' } }),
      selField([{ v: '', label: 'None' }, ...sources.map(s => ({ v: s, label: s }))], n.record || '', v => patch(n.id, { record: v || null }, { label: 'Record' }), { aria: 'Record source' })));
    out.push(sec('Page path', null, h('div', { class: 'stack' }, ...body)));
    return out;
  }
  if (!app || !topOf(n.id).route) return out;
  const muted = text => h('span', { text, style: { color: 'var(--muted)', alignSelf: 'center' } });
  if (n.type === 'frame' || n.type === 'instance') {
    const r = slopAppRepeat(n.repeat) || {};
    const on = !!(r.from || typeof r.field === 'string');
    // Choosing a source or a list field keeps sort, limit and conditions.
    const set = p => { const next = Object.assign({}, r, p); patch(n.id, { repeat: next.from || typeof next.field === 'string' ? next : null }, { label: 'Repeat' }); };
    const kind = r.from ? r.from : r.field != null ? '@field' : '';
    const where = r.where || [];
    const setWhere = list => set({ where: list.length ? list : undefined });
    const OPS = [{ v: '=', label: '=' }, { v: '!=', label: '≠' }, { v: 'contains', label: 'contains' }, { v: '<', label: '<' }, { v: '>', label: '>' }, { v: 'exists', label: 'is set' }, { v: 'missing', label: 'is empty' }];
    // field · operator · value · remove, on one grid row
    const conds = where.map((c, i) => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px minmax(0,1fr) 28px', gap: '4px', alignItems: 'center' } },
      h('input', { class: 'sel', value: c.field || '', placeholder: 'field', 'aria-label': 'Condition field', disabled: !S.canEdit, style: { width: '100%', minWidth: 0 }, onchange: e => setWhere(where.map((x, j) => (j === i ? Object.assign({}, x, { field: e.target.value.trim() }) : x))) }),
      Object.assign(selField(OPS, c.op || '=', v => setWhere(where.map((x, j) => (j === i ? Object.assign({}, x, { op: v }) : x))), { aria: 'Condition operator' }), { style: 'width:100%;min-width:0' }),
      c.op === 'exists' || c.op === 'missing' ? h('span') : h('input', { class: 'sel', value: c.value == null ? '' : String(c.value), placeholder: 'value', 'aria-label': 'Condition value', disabled: !S.canEdit, style: { width: '100%', minWidth: 0 }, onchange: e => setWhere(where.map((x, j) => (j === i ? Object.assign({}, x, { value: e.target.value }) : x))) }),
      ib('x', 'Remove condition', () => setWhere(where.filter((x, j) => j !== i)))));
    const body = h('div', { class: 'stack' },
      h('div', { class: 'g2' }, muted('For each'),
        selField([{ v: '', label: 'Nothing (no repeat)' }, ...sources.map(s => ({ v: s, label: 'record of ' + s })), { v: '@field', label: 'item of a list field…' }], kind,
          v => (v === '' ? patch(n.id, { repeat: null }, { label: 'Repeat' }) : v === '@field' ? set({ from: undefined, field: r.field || '' }) : set({ from: v, field: undefined })), { aria: 'Repeat source' })),
      r.field != null && !r.from ? h('div', { class: 'g2' }, muted('List field'), field(r.field, 'e.g. tags, record.gallery', v => set({ field: v }), 'List field')) : null,
      on ? h('div', { class: 'stack', style: { gap: '4px' } }, muted('Only where'), ...conds,
        h('div', { class: 'acts', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn sm', disabled: !S.canEdit, onclick: () => setWhere([...where, { field: '', op: '=', value: '' }]) }, 'Add condition'))) : null,
      on ? h('div', { class: 'g2' }, muted('Sort by'), field(r.sort, 'field, or -field for descending', v => set({ sort: v || undefined }), 'Sort')) : null,
      on ? h('div', { class: 'g2' }, muted('At most'), numField('≤', +r.limit || 0, v => set({ limit: Math.max(0, v) }), { title: 'At most this many (0 shows all)', aria: 'At most' })) : null,
      h('p', { class: 'note', text: on ? 'The first child is repeated once per item; the others are sample copies and are left out of the page. Condition values can use {{placeholders}} of the screen, e.g. {{params.tag}}.' : 'Repeat this frame’s first child once per record of a data source, or per item of a list field.' }));
    out.push(sec('Repeat', null, body));
  }
  if (n.type !== 'line') {
    const sc = slopAppScope(n);
    const site = sc && sc.source && app.data && app.data[sc.source] === '$site';
    out.push(sec('Link to a URL', null, field(n.href, '/journal, {{path}}, https://…', v => patch(n.id, { href: v || null }, { label: 'Link' }), 'Link URL'),
      h('p', { class: 'note', text: (site ? 'In this list, {{path}} is each page’s URL. ' : '') + 'A site path (/…), an http(s) URL or a template with {{fields}}. It replaces the prototype link on the page.' })));
  }
  const img = (n.fills || []).findIndex(f => f.t === 'image');
  if (img >= 0) {
    const f = n.fills[img];
    out.push(sec('Image from data', null, field(f.bind, 'field, e.g. photo', v => patch(n.id, { fills: n.fills.map((x, i) => (i === img ? Object.assign({}, x, { bind: v || undefined }) : x)) }, { label: 'Image from data' }), 'Image field'),
      h('p', { class: 'note', text: 'The record’s field (an image file of the data artifact, or a URL) replaces this image on the page.' })));
  }
  if (n.type === 'text') {
    out.push(sec('Data', null, h('p', { class: 'note', text: slopAppScopeNote(slopAppScope(n)) }),
      h('div', { class: 'g2' }, muted('Rich text from'), field(n.html, 'field, e.g. html', v => patch(n.id, { html: v || null }, { label: 'Rich text' }), 'Rich text field')),
      h('p', { class: 'note', text: 'Shows the field as formatted text (a Markdown post’s html), cleaned of scripts and styles; this layer’s font and colour apply.' })));
  }
  return out;
}

if (SLOP.mode === 'tool') {
  const panel = protoPanel;
  protoPanel = function () {
    const out = panel();
    try { out.push(...slopAppSections()); } catch (e) { console.warn('[pinup/slop] app panel', e); }
    return out;
  };
}
