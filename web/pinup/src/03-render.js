// ---------- fonts ----------
// Google Fonts that load on demand. Weights listed are ones each family really ships (a wrong axis makes the CSS request fail).
const GFONTS = {
  'Inter': '100..900', 'Roboto': '100..900', 'Open Sans': '300..800', 'Lato': '100;300;400;700;900', 'Montserrat': '100..900',
  'Poppins': '100;200;300;400;500;600;700;800;900', 'Work Sans': '100..900', 'DM Sans': '100..900', 'Manrope': '200..800',
  'Plus Jakarta Sans': '200..800', 'IBM Plex Sans': '100;200;300;400;500;600;700', 'IBM Plex Mono': '100;200;300;400;500;600;700',
  'IBM Plex Serif': '100;200;300;400;500;600;700', 'Space Grotesk': '300..700', 'Space Mono': '400;700', 'JetBrains Mono': '100..800',
  'Geist': '100..900', 'Geist Mono': '100..900', 'Figtree': '300..900', 'Outfit': '100..900', 'Sora': '100..800', 'Archivo': '100..900',
  'Archivo Black': '400', 'Bricolage Grotesque': '200..800', 'Hanken Grotesk': '100..900', 'Schibsted Grotesk': '400..900',
  'Instrument Sans': '400..700', 'Instrument Serif': '400', 'Syne': '400..800', 'Unbounded': '200..900', 'Rubik': '300..900',
  'Nunito': '200..900', 'Karla': '200..800', 'Barlow': '100;200;300;400;500;600;700;800;900', 'Oswald': '200..700',
  'Bebas Neue': '400', 'Anton': '400', 'Fraunces': '100..900', 'Playfair Display': '400..900', 'Lora': '400..700',
  'Merriweather': '300;400;700;900', 'Source Serif 4': '200..900', 'Libre Baskerville': '400;700', 'EB Garamond': '400..800',
  'Cormorant Garamond': '300..700', 'Newsreader': '200..800', 'DM Serif Display': '400', 'Young Serif': '400', 'Caveat': '400..700',
};
const SYSFONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'system-ui'];
const FONT_LIST = [...Object.keys(GFONTS), ...SYSFONTS].sort((a, b) => a.localeCompare(b));
function fontWeights(f) {
  const s = GFONTS[f]; if (!s) return [400, 700];
  if (s.includes('..')) { const [a, b] = s.split('..').map(Number); const out = []; for (let w = Math.ceil(a / 100) * 100; w <= b; w += 100) out.push(w); return out; }
  return s.split(';').map(Number);
}
const loadedFonts = new Set();
function ensureFont(f, doc = document) {
  if (!f || !GFONTS[f]) return;
  const key = (doc === document ? '' : 'x:') + f;
  if (loadedFonts.has(key)) return; loadedFonts.add(key);
  const l = doc.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@' + GFONTS[f] + '&display=swap';
  doc.head.append(l);
}
function fontStack(f) {
  const mono = /mono|courier/i.test(f), serif = /serif|garamond|baskerville|playfair|lora|merriweather|fraunces|newsreader|georgia|times/i.test(f) && !/sans/i.test(f);
  return `"${f}", ${mono ? 'ui-monospace, Menlo, monospace' : serif ? 'Georgia, serif' : 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif'}`;
}
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

// ---------- tokens ----------
function tokVar(id) { return '--tk-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }
function tokenCSS(scope) {
  const C = S.file.tokens.colors || {};
  const L = [], D = [];
  for (const id in C) { const t = C[id]; L.push(`${tokVar(id)}:${t.light || '#000'}`); D.push(`${tokVar(id)}:${t.dark || t.light || '#000'}`); }
  return `${scope}, ${scope} .m-light{${L.join(';')}} ${scope} .m-dark{${D.join(';')}}`;
}
function updateTokenStyle() {
  let st = $('#tokcss'); if (!st) { st = h('style', { id: 'tokcss' }); document.head.append(st); }
  st.textContent = tokenCSS('#world') + '\n' + tokenCSS('#pvclip') + '\n' + tokenCSS('.tokroot');
}
// resolve '$id' to hex for a mode (inspect, export, contrast checks)
function resolveColor(c, mode = 'light') {
  if (typeof c === 'string' && c[0] === '$') { const t = S.file.tokens.colors[c.slice(1)]; return t ? (mode === 'dark' ? (t.dark || t.light) : t.light) : '#000000'; }
  return c || '#000000';
}
function modeOf(id) { const n = get(id); if (!n) return 'light'; if (n.mode) return n.mode; const a = ancestors(id).find(a => a.mode); return a ? a.mode : 'light'; }
function tokenName(c) { if (typeof c === 'string' && c[0] === '$') { const t = S.file.tokens.colors[c.slice(1)]; return t ? t.name : c.slice(1); } return null; }

// ---------- CSS for a node ----------
const px = v => rnd(v, 2) + 'px';
function paintCSS(f, o) {
  // o.var(id) → css var name; returns a CSS colour string
  const tv = o && o.var ? o.var : tokVar;
  if (f.t !== 'solid') return null;
  const op = f.o == null ? 1 : f.o;
  if (typeof f.c === 'string' && f.c[0] === '$') {
    const fb = resolveColor(f.c);
    const v = o && o.export ? `var(${tv(f.c.slice(1))})` : `var(${tv(f.c.slice(1))}, ${fb})`;
    return op >= 1 ? v : `color-mix(in srgb, ${v} ${rnd(op * 100, 1)}%, transparent)`;
  }
  return rgba(f.c || '#000000', op);
}
function fillLayers(fills, o) {
  const vis = (fills || []).filter(f => f.visible !== false);
  if (!vis.length) return null;
  if (vis.length === 1 && vis[0].t === 'solid') return { 'background-color': paintCSS(vis[0], o) };
  const layers = [];
  for (const f of vis.slice().reverse()) {
    if (f.t === 'solid') { const c = paintCSS(f, o); layers.push(`linear-gradient(${c}, ${c})`); }
    else if (f.t === 'gradient') layers.push(f.css || 'linear-gradient(#ddd, #999)');
    else if (f.t === 'image' && f.src) {
      const fit = f.fit || 'cover';
      const pos = fit === 'fill' ? '0 0 / 100% 100% no-repeat' : fit === 'tile' ? '0 0 / auto repeat' : `center / ${fit} no-repeat`;
      layers.push(`url("${String(f.src).replace(/"/g, '%22')}") ${pos}`);
    }
  }
  return layers.length ? { background: layers.join(', ') } : null;
}
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', baseline: 'baseline', stretch: 'stretch' };
const JUST = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };

// n: node (merged for instances); P: parent node (for layout rules) or null; o: {root, export, var}
function cssFor(n, P, o = {}) {
  const c = {};
  const L = P && P.layout && !n.abs ? P.layout : null;
  const isText = n.type === 'text';
  const canHug = isText || (n.type === 'frame' && !!n.layout);
  let sw = n.sw, sh = n.sh;
  if (sw === 'hug' && !canHug) sw = 'fixed';
  if (sh === 'hug' && !canHug) sh = 'fixed';
  if (!L) { if (sw === 'fill') sw = 'fixed'; if (sh === 'fill') sh = 'fixed'; }
  if (o.root) c.position = 'relative';
  else if (L) c.position = 'relative';
  else { c.position = 'absolute'; c.left = px(n.x); c.top = px(n.y); }
  const line = n.type === 'line';
  const W = line ? n.w : n.w, Hh = line ? Math.max(1, (n.stroke && n.stroke.w) || 1) : n.h;
  if (L) {
    const row = L.dir === 'row';
    // main axis
    const ms = row ? sw : sh, cs = row ? sh : sw, mk = row ? 'width' : 'height', ck = row ? 'height' : 'width';
    if (ms === 'fill') { c.flex = '1 1 0px'; c['min-' + mk] = '0'; }
    else { c['flex-shrink'] = '0'; if (ms === 'fixed') c[mk] = px(row ? W : Hh); }
    if (cs === 'fill') c['align-self'] = 'stretch';
    else if (cs === 'fixed') c[ck] = px(row ? Hh : W);
  } else {
    if (sw !== 'hug') c.width = px(W);
    if (sh !== 'hug') c.height = px(Hh);
  }
  if (n.type === 'frame' && n.layout) {
    const l = n.layout;
    c.display = 'flex';
    c['flex-direction'] = l.dir === 'row' ? 'row' : 'column';
    if (l.wrap) c['flex-wrap'] = 'wrap';
    if (l.gap === 'auto') c['justify-content'] = 'space-between';
    else { if (l.gap) c.gap = px(l.gap); if (l.justify && l.justify !== 'start') c['justify-content'] = JUST[l.justify]; }
    if (l.align && l.align !== 'stretch') c['align-items'] = ALIGN[l.align]; else c['align-items'] = 'flex-start';
    const p = l.pad || [0, 0, 0, 0];
    if (p.some(Boolean)) c.padding = p.map(px).join(' ');
  }
  // paint
  if (isText) {
    const f = (n.fills || []).find(f => f.visible !== false);
    if (f && f.t === 'solid') c.color = paintCSS(f, o);
    else if (f && (f.t === 'gradient' || f.t === 'image')) {
      Object.assign(c, fillLayers([f], o)); c['-webkit-background-clip'] = 'text'; c['background-clip'] = 'text'; c.color = 'transparent';
    }
    const ts = n.tstyle && S.file.tokens.type[n.tstyle];
    const font = ts && ts.font || n.font, size = ts && ts.size || n.size, weight = ts && ts.weight || n.weight;
    const lh = ts && ts.lh != null ? ts.lh : n.lh, ls = ts && ts.ls != null ? ts.ls : n.ls;
    if (!o.export) ensureFont(font);
    c['font-family'] = fontStack(font);
    c['font-size'] = px(size);
    c['font-weight'] = String(weight);
    c['line-height'] = lh <= 4 ? String(lh) : px(lh);
    if (ls) c['letter-spacing'] = px(ls);
    if (n.talign && n.talign !== 'left') c['text-align'] = n.talign;
    if (n.italic) c['font-style'] = 'italic';
    if (n.deco && n.deco !== 'none') c['text-decoration'] = n.deco;
    if (n.tcase && n.tcase !== 'none') c['text-transform'] = n.tcase === 'title' ? 'capitalize' : n.tcase === 'upper' ? 'uppercase' : 'lowercase';
    c['white-space'] = sw === 'hug' ? 'pre' : 'pre-wrap';
    if (sw !== 'hug') c['overflow-wrap'] = 'break-word';
  } else if (n.type === 'icon') {
    const f = (n.fills || []).find(f => f.visible !== false && f.t === 'solid');
    c.color = f ? paintCSS(f, o) : 'currentColor';
  } else if (line) {
    const s = n.stroke || { c: '#111111', w: 1 };
    c['background-color'] = paintCSS({ t: 'solid', c: s.c, o: s.o }, o);
    if (s.style === 'dashed' || s.style === 'dotted') { c['background-color'] = 'transparent'; c['border-top'] = `${px(s.w || 1)} ${s.style} ${paintCSS({ t: 'solid', c: s.c, o: s.o }, o)}`; c.height = '0px'; }
  } else if (n.type !== 'svg') {
    Object.assign(c, fillLayers(n.fills, o));
  }
  if (n.stroke && !line && !isText && (n.stroke.w || 0) > 0) {
    const s = n.stroke;
    c.outline = `${px(s.w)} ${s.style || 'solid'} ${paintCSS({ t: 'solid', c: s.c, o: s.o }, o)}`;
    c['outline-offset'] = px(-s.w);
  }
  if (n.type === 'ellipse') c['border-radius'] = '50%';
  else if (Array.isArray(n.radius)) { if (n.radius.some(Boolean)) c['border-radius'] = n.radius.map(v => px(+v || 0)).join(' '); }
  else if (+n.radius) c['border-radius'] = px(+n.radius);
  const shs = [], fl = [];
  for (const e of n.effects || []) {
    if (e.visible === false) continue;
    if (e.t === 'shadow') shs.push(`${e.inset ? 'inset ' : ''}${px(+e.x || 0)} ${px(+e.y || 0)} ${px(+e.b || 0)} ${px(+e.s || 0)} ${typeof e.c === 'string' && e.c[0] === '$' ? paintCSS({ t: 'solid', c: e.c }, o) : (e.c || 'rgba(0, 0, 0, 0.15)')}`);
    if (e.t === 'blur' && +e.r) fl.push(`blur(${px(+e.r)})`);
    if (e.t === 'bgblur' && +e.r) { c['backdrop-filter'] = `blur(${px(+e.r)})`; c['-webkit-backdrop-filter'] = c['backdrop-filter']; }
  }
  if (shs.length) c['box-shadow'] = shs.join(', ');
  if (fl.length) c.filter = fl.join(' ');
  if (n.opacity != null && n.opacity < 1) c.opacity = String(rnd(n.opacity, 3));
  if (n.rot) c.transform = `rotate(${rnd(n.rot, 2)}deg)`;
  if (n.type === 'frame' && n.clip) c.overflow = 'hidden';
  if (n.type === 'frame' && n.layout && !o.export) c['min-width'] = c['min-width'] || '0';
  return c;
}
function cssText(c) { let s = ''; for (const k in c) s += k + ':' + c[k] + ';'; return s; }

// ---------- svg safety ----------
function cleanSVG(markup) {
  const doc = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return '';
  svg.querySelectorAll('script,foreignObject,iframe,use[href^="http"],image[href^="http"]').forEach(e => e.remove());
  for (const e of [svg, ...svg.querySelectorAll('*')]) for (const a of [...e.attributes]) { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) e.removeAttribute(a.name); }
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'none');
  return new XMLSerializer().serializeToString(svg);
}
function cleanIconInner(markup) {
  const s = cleanSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + (markup || '') + '</svg>');
  return s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

// ---------- instances ----------
// The instance renders its main's subtree; its own geometry wins, and ov[mainChildId] overrides text / fills / visibility / icon.
function instRoot(inst, m) {
  const r = Object.assign({}, m, {
    id: inst.id, parent: inst.parent, page: inst.page, z: inst.z, x: inst.x, y: inst.y, w: inst.w, h: inst.h, sw: inst.sw, sh: inst.sh,
    rot: inst.rot, opacity: inst.opacity, visible: inst.visible, abs: inst.abs, name: inst.name, link: inst.link || m.link, component: false, mode: inst.mode || m.mode,
  });
  const o = inst.ov && inst.ov[m.id];
  if (o && o.fills) r.fills = o.fills;
  return r;
}
function withOv(n, ov) {
  const o = ov && ov[n.id];
  if (!o) return n;
  const r = Object.assign({}, n);
  if (o.text != null && n.type === 'text') r.text = o.text;
  if (o.fills) r.fills = o.fills;
  if (o.visible != null) r.visible = o.visible;
  if (o.svg && n.type === 'icon') { r.svg = o.svg; r.icon = o.icon || r.icon; }
  return r;
}

// ---------- DOM build ----------
const ELS = new Map(); // canvas: node id → element
function buildEl(n0, P, ctx) {
  // ctx: {mode:'canvas'|'present'|'static', inst:{id, ov}|null, depth, root}
  if (ctx.depth > 40) return null;
  let n = ctx.inst ? withOv(n0, ctx.inst.ov) : n0;
  if (!n.visible) return null;
  let el;
  if (n.type === 'instance') {
    const m = get(n.of);
    if (!m || ctx.depth > 20) {
      el = h('div');
      el.style.cssText = cssText(cssFor(Object.assign({}, n, { fills: [], stroke: { c: '#8A4FFF', w: 1, style: 'dashed' } }), P, { root: ctx.root }));
      el.append(h('div', { text: 'Missing component', style: { font: '11px Arial', color: '#8A4FFF', padding: '4px' } }));
    } else {
      const r = instRoot(n, m);
      el = h('div');
      el.style.cssText = cssText(cssFor(r, P, { root: ctx.root }));
      if (r.mode) el.classList.add('m-' + r.mode);
      const sub = { mode: ctx.mode, inst: { id: ctx.inst ? ctx.inst.id : n.id, ov: ctx.inst ? Object.assign({}, n.ov, ctx.inst.ov) : n.ov }, depth: ctx.depth + 1 };
      for (const k of kids(m.id)) { const ce = buildEl(k, r, sub); if (ce) el.append(ce); }
      el.dataset.nid = ctx.inst ? ctx.inst.id : n.id;
      el.dataset.mid = m.id;
      if (ctx.inst) el.dataset.sub = n.id;
      if (ctx.mode === 'canvas' && !ctx.inst) ELS.set(n.id, el);
      return el;
    }
  } else {
    el = h('div');
    el.style.cssText = cssText(cssFor(n, P, { root: ctx.root }));
    if (n.type === 'text') el.textContent = n.text || '​';
    else if (n.type === 'icon') { const s = svgEl('svg', { viewBox: '0 0 24 24', width: '100%', height: '100%', fill: 'none', stroke: 'currentColor', 'stroke-width': n.iw || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:block' }); s.innerHTML = n.svg || iconMarkup(n.icon); el.append(s); }
    else if (n.type === 'svg') { el.innerHTML = cleanSVG(n.markup); const s = el.firstElementChild; if (s) s.style.display = 'block'; }
    else if (n.type === 'frame') { for (const k of kids(n.id)) { const ce = buildEl(k, n, Object.assign({}, ctx, { depth: ctx.depth + 1, root: false })); if (ce) el.append(ce); } }
    if (n.mode) el.classList.add('m-' + n.mode);
  }
  if (ctx.inst) { el.dataset.nid = ctx.inst.id; el.dataset.mid = n0.id; }
  else el.dataset.nid = n.id;
  if (ctx.mode === 'canvas' && !ctx.inst) ELS.set(n.id, el);
  return el;
}

// ---------- canvas render loop ----------
let renderQueued = false;
const afterRender = [];
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(renderNow); }
function renderNow() {
  renderQueued = false;
  const world = $('#world');
  if (DIRTY.all) {
    updateTokenStyle();
    world.textContent = ''; ELS.clear();
    for (const r of roots()) { const el = buildEl(r, null, { mode: 'canvas', depth: 0 }); if (el) world.append(el); }
  } else if (DIRTY.roots.size) {
    const keep = S.editing ? (topOf(S.editing.id) || {}).id : null;
    for (const id of [...DIRTY.roots]) {
      if (id === keep) continue;
      const old = ELS.get(id);
      const n = get(id);
      if (old && old.isConnected && old.parentNode === world) old.remove();
      if (n && !n.parent && n.page === S.pageId) {
        const el = buildEl(n, null, { mode: 'canvas', depth: 0 });
        if (!el) continue;
        const list = roots(); const i = list.findIndex(x => x.id === id);
        let before = null;
        for (let j = i + 1; j < list.length; j++) { const e = ELS.get(list[j].id); if (e && e.parentNode === world) { before = e; break; } }
        world.insertBefore(el, before);
      }
    }
  }
  DIRTY.all = false;
  const keepId = S.editing ? (topOf(S.editing.id) || {}).id : null;
  const kept = keepId && DIRTY.roots.has(keepId);
  DIRTY.roots.clear(); if (kept) DIRTY.roots.add(keepId);
  if (S.editing) { const e = elOf(S.editing.id, S.editing.mid); if (e && !e.isContentEditable) S.editing = null; }
  if (DIRTY.chrome) { DIRTY.chrome = false; renderChrome(); }
  drawOverlay();
  for (const f of afterRender) f();
}
function elOf(id, mid) {
  if (mid) { const r = ELS.get(id); return r ? r.querySelector(`[data-mid="${mid}"]`) : null; }
  const e = ELS.get(id); return e && e.isConnected ? e : null;
}
