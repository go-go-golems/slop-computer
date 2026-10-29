// ---------- slop apps (web/pinup/slop; not part of upstream Pinup) ----------
// A Pinup app is a real page on the site whose source is this design. Every
// top-level frame with a route (node.route = '/', '/runs', '/runs/:id') is a
// screen. Publish app compiles the screens into one page artifact (every
// screen in a <template>, one stylesheet, a small inline runtime that picks
// the screen for the URL and fills in data, images as files) and routes each
// screen on a site host. S.file.app = {page, host, base, data} says where.
// Guide: ttmp/2026/10/29/SLOP-005-…/design-doc/01.

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
const slopAppRepeat = r => (!r ? null : typeof r === 'string' ? { from: r } : r.from ? r : null);
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
    const n = t.n, link = (t.inst && t.inst.link) || n.link;
    if (link && link.to !== 'back' && !routed.has(link.to)) {
      const to = get(link.to);
      warnings.push(`${scr.name}: “${n.name}” links to ${to ? to.name : 'a deleted screen'}, which has no page path; the link is left out.`);
    }
    const rep = slopAppRepeat((t.inst && t.inst.repeat) || n.repeat);
    if (rep) {
      if (!data[rep.from]) errors.push(`${scr.name}: “${n.name}” repeats “${rep.from}”, which is not a data source of the app.`);
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
async function slopAppCompile(chk, designVersion) {
  const app = S.file.app, base = slopAppPath(app.base), screens = chk.screens;
  const byId = new Map(screens.map(f => [f.id, f]));
  const trees = screens.map(f => ({ f, t: expand(f, null) })).filter(x => x.t);
  const files = {};

  // Images held as data: URLs become files named by content, at the root of
  // the version (the site finds a page's files by base name there).
  const imgs = new Map();
  const collect = t => { for (const f of t.n.fills || []) if (f.t === 'image' && typeof f.src === 'string' && f.src.startsWith('data:')) imgs.set(f.src, null); t.kids.forEach(collect); };
  trees.forEach(x => collect(x.t));
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
    const link = depth > 0 && !inLink && ((t.inst && t.inst.link) || n.link);
    const to = link && hrefFor(link);
    if (to) {
      tag = 'a'; inLink = true;
      if (!css.display) css.display = 'block';
      attrs += to.tpl ? ` href="#" data-href="${esc(to.tpl)}"` : ` href="${esc(to.href)}"`;
      if (to.back) attrs += ' data-back';
    } else if (inLink && tag === 'button') tag = 'span';
    if (t.inst) attrs += ` data-component="${esc(t.main.name)}"`;
    const ib = slopAppImageBind(n);
    if (ib) attrs += ` data-img="${esc(ib.bind)}" data-img-fit="${esc(ib.fit || 'cover')}"`;
    rules.push(`.${c} { ${Object.entries(css).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
    const pad = '  '.repeat(depth + 1);
    if (n.type === 'text') {
      if (String(n.text).includes('{{')) attrs += ` data-t="${esc(n.text)}"`;
      return `${pad}<${tag}${attrs}>${esc(n.text)}</${tag}>`;
    }
    if (n.type === 'icon') return `${pad}<span${attrs} data-icon="${esc(n.icon)}">${iconSVG(n)}</span>`;
    if (n.type === 'svg') return `${pad}<div${attrs}>${cleanSVG(n.markup)}</div>`;
    if (n.type === 'line') return `${pad}<hr${attrs}>`;
    const rep = slopAppRepeat((t.inst && t.inst.repeat) || n.repeat);
    if (rep && t.kids.length) {
      const ra = ` data-repeat="${esc(rep.from)}"${+rep.limit > 0 ? ` data-limit="${+rep.limit}"` : ''}${rep.sort ? ` data-sort="${esc(rep.sort)}"` : ''}`;
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
  function sortRows(list, by) {
    var desc = by.charAt(0) === '-', k = desc ? by.slice(1) : by;
    return list.sort(function (a, b) {
      var x = a[k], y = b[k];
      var c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), undefined, { numeric: true });
      return desc ? -c : c;
    });
  }
  function pos(fit) { return fit === 'fill' ? '0 0 / 100% 100% no-repeat' : fit === 'tile' ? '0 0 / auto repeat' : 'center / ' + (fit === 'contain' ? 'contain' : 'cover') + ' no-repeat'; }
  // Binds a fragment: repeats first (each copy bound with its row in front of
  // the chain), then text, links and images; bound attributes are removed so
  // an outer pass does not bind them again.
  function bind(root, chain) {
    var reps = root.querySelectorAll('template[data-repeat]');
    for (var i = 0; i < reps.length; i++) {
      var tp = reps[i], list = rows(tp.getAttribute('data-repeat'));
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
      if (miss.n) hs[b].removeAttribute('href'); else hs[b].setAttribute('href', u);
      hs[b].removeAttribute('data-href');
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
