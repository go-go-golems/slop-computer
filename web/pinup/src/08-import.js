// ---------- HTML → layers ----------
// The HTML is laid out in a sandboxed, script-free iframe; computed boxes and styles become nodes.
// Flexbox becomes auto layout; evenly stacked blocks become vertical auto layout; anything else keeps absolute positions.
const INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'SPAN', 'A', 'SMALL', 'CODE', 'SUP', 'SUB', 'U', 'S', 'MARK', 'ABBR', 'TIME', 'LABEL', 'Q', 'CITE', 'KBD', 'BR', 'WBR', 'DEL', 'INS']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'META', 'LINK', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT', 'EMBED']);
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,base,meta,noscript,frame,frameset').forEach(e => e.remove());
  doc.querySelectorAll('link').forEach(l => { if (!/^https:\/\/fonts\.googleapis\.com\//.test(l.getAttribute('href') || '')) l.remove(); });
  for (const e of doc.querySelectorAll('*')) for (const a of [...e.attributes]) { if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) e.removeAttribute(a.name); }
  const styles = [...doc.querySelectorAll('style')].map(s => s.outerHTML).join('\n');
  doc.querySelectorAll('style').forEach(s => s.remove());
  const links = [...doc.querySelectorAll('link')].map(l => l.outerHTML).join('\n');
  return { styles, links, body: doc.body ? doc.body.innerHTML : '', bodyStyle: doc.body ? doc.body.getAttribute('style') || '' : '' };
}
function guessWidth(html, fallback) {
  const m = String(html).match(/<(?:div|section|main|article|header|body)[^>]*style="[^"]*?(?:^|;|\s)width:\s*(\d{2,4})px/i) || String(html).match(/max-width:\s*(\d{3,4})px/i);
  return m ? +m[1] : fallback;
}
async function importHTML(html, opts = {}) {
  if (!S.canEdit && !opts.force) { toast('Editing is off for you here.'); return null; }
  const s = sanitizeHTML(html);
  const page = opts.page || S.pageId;
  const replaced = opts.replace && get(opts.replace) ? get(opts.replace) : null;
  const parentId = replaced ? replaced.parent : (opts.parent && get(opts.parent) ? opts.parent : null);
  const P = parentId ? get(parentId) : null;
  let W = opts.width;
  if (!W && replaced) W = Math.round((wrect(replaced.id) || replaced).w);
  if (!W && P) { const pr = wrect(P.id) || P; const pad = P.layout ? P.layout.pad : [0, 0, 0, 0]; W = Math.round(pr.w - pad[1] - pad[3]); }
  if (!W) W = guessWidth(html, 390);
  const fonts = new Set(); for (const f in GFONTS) if (html.includes(f)) fonts.add(f);
  const C = S.file.tokens.colors || {};
  const tokVars = Object.keys(C).map(id => `${tokVar(id)}:${C[id].light};--${slug(C[id].name)}:${C[id].light}`).join(';');
  const doc = `<!doctype html><html><head><meta charset="utf-8">${[...fonts].map(f => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.replace(/ /g, '+')}:wght@${GFONTS[f]}&display=swap">`).join('')}${s.links}
<style>html,body{margin:0;padding:0;background:transparent}*,*::before,*::after{box-sizing:border-box}:root{${tokVars}}body{font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.4;color:#111;width:${W}px}[data-icon],[data-lucide]{display:inline-block;width:1.25em;height:1.25em;flex:none;vertical-align:middle}img{display:block;max-width:100%}button{font:inherit}</style>${s.styles}</head><body style="${esc(s.bodyStyle)}">${s.body}</body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:4000px;border:0;visibility:hidden;pointer-events:none`;
  document.body.append(frame);
  await new Promise(res => { frame.onload = res; frame.srcdoc = doc; setTimeout(res, 3000); });
  const d = frame.contentDocument;
  if (!d || !d.body) { frame.remove(); toast('Could not read that HTML'); return null; }
  try { await Promise.race([d.fonts.ready, sleep(2500)]); } catch {}
  await sleep(30);
  const win = frame.contentWindow;
  // give instance placeholders their main component's size before anything is measured
  for (const el of d.querySelectorAll('[data-instance]')) {
    const nm = el.getAttribute('data-instance');
    const sm = components().find(c => c.name === nm);
    const de = !sm && d.querySelector(`[data-component="${CSS.escape(nm)}"]`);
    const sz = sm ? (wrect(sm.id) || sm) : de ? de.getBoundingClientRect() : null;
    if (!sz) continue;
    if (!el.style.width) el.style.width = (sz.w || sz.width) + 'px';
    if (!el.style.height) el.style.height = (sz.h || sz.height) + 'px';
    el.style.flexShrink = '0'; el.style.overflow = 'hidden';
    el.setAttribute('data-sized', (el.getAttribute('style') || ''));
  }
  const batch = new Map(); const order = [];
  const pendingLinks = [];
  const add = n => { batch.set(n.id, n); order.push(n.id); return n; };
  const tokenFor = hex => { if (!hex) return null; for (const id in C) if ((C[id].light || '').toUpperCase() === hex) return '$' + id; return null; };
  const colorFill = (str) => { const c = parseColor(str); if (!c || c.a === 0) return null; const hex = toHex(c); const f = { t: 'solid', c: tokenFor(hex) || hex }; if (c.a < 1) f.o = rnd(c.a, 3); return f; };
  const px = v => parseFloat(v) || 0;
  const nameOf = (el, fallback) => el.getAttribute && (el.getAttribute('data-name') || el.getAttribute('aria-label') || (el.id && el.id.length < 40 ? el.id.replace(/[-_]/g, ' ') : '')) || fallback;
  const tagName = el => ({ BUTTON: 'Button', NAV: 'Nav', HEADER: 'Header', FOOTER: 'Footer', SECTION: 'Section', MAIN: 'Main', ARTICLE: 'Article', ASIDE: 'Aside', UL: 'List', OL: 'List', LI: 'Item', FORM: 'Form', INPUT: 'Input', A: 'Link', IMG: 'Image', FIGURE: 'Figure' }[el.tagName] || 'Frame');
  const natural = (el, prop) => {
    const prev = el.getAttribute('style');
    el.style.setProperty(prop, 'max-content', 'important'); el.style.setProperty('flex', 'none', 'important');
    const v = el.getBoundingClientRect()[prop];
    if (prev == null) el.removeAttribute('style'); else el.setAttribute('style', prev);
    return v;
  };
  const isTextLeaf = el => {
    if (el.hasAttribute('data-icon') || el.hasAttribute('data-lucide') || el.hasAttribute('data-instance')) return false;
    let text = false;
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { if (c.textContent.trim()) text = true; continue; }
      if (c.nodeType !== 1) continue;
      if (!INLINE_TAGS.has(c.tagName)) return false;
      if (c.hasAttribute('data-icon') || c.hasAttribute('data-lucide') || c.tagName === 'svg' || c.tagName === 'IMG') return false;
      const cs = win.getComputedStyle(c);
      if (cs.display !== 'inline' && c.tagName !== 'BR') return false;
      if (!isTextLeaf(c) && c.tagName !== 'BR' && c.textContent.trim()) return false;
      if (c.textContent.trim()) text = true;
    }
    return text;
  };
  const textOf = el => {
    let out = '';
    const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) out += c.textContent; else if (c.nodeType === 1) { if (c.tagName === 'BR') out += '\n'; else walk(c); } } };
    walk(el);
    const ws = win.getComputedStyle(el).whiteSpace;
    if (!/pre/.test(ws)) out = out.split('\n').map(l => l.replace(/[ \t\r\f]+/g, ' ')).join('\n').replace(/[ ]*\n[ ]*/g, '\n');
    return out.replace(/^\s+|\s+$/g, m => /\n/.test(m) && /pre/.test(ws) ? m : '');
  };
  const fontFrom = ff => {
    const first = (ff || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (!first || /^(system-ui|-apple-system|BlinkMacSystemFont|sans-serif|ui-sans-serif|Segoe UI)$/i.test(first)) return 'Inter';
    if (/^(serif|ui-serif)$/i.test(first)) return 'Georgia';
    if (/^(monospace|ui-monospace|Menlo|Consolas|SFMono-Regular)$/i.test(first)) return 'IBM Plex Mono';
    return first;
  };
  const textProps = (cs) => {
    const size = px(cs.fontSize) || 16;
    const lh = cs.lineHeight === 'normal' ? 1.2 : rnd(px(cs.lineHeight) / size, 3);
    const ls = cs.letterSpacing === 'normal' ? 0 : rnd(px(cs.letterSpacing), 2);
    const ta = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end') ? 'right' : cs.textAlign === 'justify' ? 'justify' : 'left';
    const tc = { uppercase: 'upper', lowercase: 'lower', capitalize: 'title' }[cs.textTransform] || 'none';
    const deco = /underline/.test(cs.textDecorationLine) ? 'underline' : /line-through/.test(cs.textDecorationLine) ? 'line-through' : 'none';
    const fill = cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text' ? { t: 'gradient', css: cs.backgroundImage } : colorFill(cs.color) || { t: 'solid', c: '#111111' };
    return { font: fontFrom(cs.fontFamily), size: rnd(size, 2), weight: +cs.fontWeight || 400, lh, ls, talign: ta, tcase: tc, deco, italic: cs.fontStyle === 'italic', fills: [fill] };
  };
  const boxStyle = (el, cs, r) => {
    const o = {};
    const fills = [];
    const bg = colorFill(cs.backgroundColor); if (bg) fills.push(bg);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      for (const part of splitTop(cs.backgroundImage).reverse()) {
        const u = part.match(/^url\("?(.*?)"?\)$/);
        if (u) fills.push({ t: 'image', src: u[1], fit: /contain/.test(cs.backgroundSize) ? 'contain' : 'cover' });
        else if (/gradient\(/.test(part)) fills.push({ t: 'gradient', css: part });
      }
    }
    o.fills = fills;
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map(s => cs['border' + s + 'Style'] === 'none' ? 0 : px(cs['border' + s + 'Width']));
    const effects = [];
    if (bw.every(w => w > 0 && w === bw[0])) { const c = parseColor(cs.borderTopColor); if (c && c.a > 0) o.stroke = { c: toHex(c), w: bw[0], style: ['dashed', 'dotted'].includes(cs.borderTopStyle) ? cs.borderTopStyle : 'solid', o: c.a < 1 ? rnd(c.a, 3) : undefined }; }
    else bw.forEach((w, i) => { if (!w) return; const c = cs['border' + ['Top', 'Right', 'Bottom', 'Left'][i] + 'Color']; const ofs = [[0, w], [-w, 0], [0, -w], [w, 0]][i]; effects.push({ t: 'shadow', inset: true, x: ofs[0], y: ofs[1], b: 0, s: 0, c }); });
    o.bw = bw;
    const rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(k => { const v = cs['border' + k + 'Radius']; return /%/.test(v) ? Math.min(r.width, r.height) * parseFloat(v) / 100 : px(v); }).map(v => (v >= Math.min(r.width, r.height) / 2 - 0.5 && v > 0 ? 999 : rnd(v, 1)));
    if (rad.some(Boolean)) o.radius = rad.every(v => v === rad[0]) ? rad[0] : rad;
    if (cs.boxShadow && cs.boxShadow !== 'none') for (const sh of splitTop(cs.boxShadow)) { const e = parseShadow(sh); if (e) effects.push(e); }
    const fb = cs.filter && cs.filter.match(/blur\(([\d.]+)px\)/); if (fb) effects.push({ t: 'blur', r: +fb[1] });
    const bb = (cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/); if (bb) effects.push({ t: 'bgblur', r: +bb[1] });
    if (effects.length) o.effects = effects;
    if (+cs.opacity < 1) o.opacity = +cs.opacity;
    if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflow === 'clip') o.clip = true; else o.clip = false;
    const tm = cs.transform && cs.transform.match(/^matrix\(([^)]+)\)/);
    if (tm) { const [a, b] = tm[1].split(',').map(Number); const ang = Math.atan2(b, a) * 180 / Math.PI; if (Math.abs(ang) > 0.1) o.rot = rnd(ang, 2); }
    return o;
  };
  const hasBox = (cs) => { const c = parseColor(cs.backgroundColor); return (c && c.a > 0) || (cs.backgroundImage && cs.backgroundImage !== 'none') || ['Top', 'Right', 'Bottom', 'Left'].some(s => cs['border' + s + 'Style'] !== 'none' && px(cs['border' + s + 'Width']) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || ['Top', 'Right', 'Bottom', 'Left'].some(s => px(cs['padding' + s]) > 0); };
  const rectOf = el => { const r = el.getBoundingClientRect(); if (r.width || r.height) return r; return r; };
  const relRect = (r, pr) => ({ x: rnd(r.left - pr.left, 1), y: rnd(r.top - pr.top, 1), w: rnd(r.width, 1), h: rnd(r.height, 1) });

  // build one element → node (recursive). ctx: {pid, prect, playout, pcs, pel}
  function convert(el, ctx, z) {
    if (SKIP_TAGS.has(el.tagName)) return null;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.tagName === 'BR') return null;
    const r = rectOf(el);
    if (r.width === 0 && r.height === 0 && !el.children.length) return null;
    const rr = relRect(r, ctx.prect);
    const abs = cs.position === 'absolute' || cs.position === 'fixed';
    const base = { id: uid(), page, parent: ctx.pid, z, x: rr.x, y: rr.y, w: rr.w, h: rr.h };
    if (abs && ctx.playout) base.abs = true;
    if (el.hasAttribute('data-link')) pendingLinks.push({ id: base.id, to: el.getAttribute('data-link'), tr: el.getAttribute('data-transition') || 'dissolve' });
    // icon
    const iconName = el.getAttribute('data-icon') || el.getAttribute('data-lucide');
    if (iconName) {
      const nm = ICONS[iconName] ? iconName : ICONS[iconName.toLowerCase()] ? iconName.toLowerCase() : 'circle-help';
      return add(Object.assign(base, { type: 'icon', icon: nm, svg: iconMarkup(nm), name: nameOf(el, nm), fills: [colorFill(cs.color) || { t: 'solid', c: '#111111' }], iw: +(el.getAttribute('data-stroke') || 2), sw: 'fixed', sh: 'fixed' }));
    }
    // instance of an existing component
    const instName = el.getAttribute('data-instance');
    if (instName) {
      const m = [...batch.values()].find(n => n.component && n.name === instName) || components().find(c => c.name === instName);
      if (m) {
        const ov = {};
        const mdesc = batch.has(m.id) ? batchDesc(m.id) : descendants(m.id);
        el.querySelectorAll('[data-name]').forEach(sub => {
          let md = mdesc.find(d => d.name === sub.getAttribute('data-name')); if (!md) return;
          if (md.type === 'frame') { const only = mdesc.filter(d => d.parent === md.id); if (only.length === 1 && only[0].type === 'text') md = only[0]; }
          if (md.type === 'text') { const t = textOf(sub); if (t && t !== md.text) ov[md.id] = Object.assign({}, ov[md.id], { text: t }); }
          if (md.type === 'icon') { const ic = sub.getAttribute('data-icon'); if (ic && ic !== md.icon && ICONS[ic]) ov[md.id] = Object.assign({}, ov[md.id], { icon: ic, svg: iconMarkup(ic) }); }
          if (sub.hasAttribute('data-hidden')) ov[md.id] = Object.assign({}, ov[md.id], { visible: false });
        });
        const n = add(Object.assign(base, { type: 'instance', of: m.id, name: nameOf(el, m.name), ov, sw: 'fixed', sh: 'fixed' }));
        const L = ctx.playout;
        if (L && !n.abs) {
          const pad = L.pad; const contentW = ctx.prect.width - pad[1] - pad[3];
          if (L.dir === 'col' && Math.abs(r.width - contentW) <= 1) n.sw = 'fill';
          else if (L.dir === 'row' && +cs.flexGrow > 0) n.sw = 'fill';
          else if (m.sw === 'hug') n.sw = 'hug';
          if (m.sh === 'hug') n.sh = 'hug';
        }
        return n;
      }
    }
    if (el.tagName === 'IMG') {
      const src = el.currentSrc || el.getAttribute('src') || '';
      const fit = cs.objectFit === 'contain' ? 'contain' : cs.objectFit === 'fill' ? 'fill' : 'cover';
      const n = add(Object.assign(base, { type: 'rect', name: nameOf(el, el.getAttribute('alt') || 'Image') }, boxStyle(el, cs, r), { fills: [{ t: 'solid', c: '#E4E4E8' }, { t: 'image', src, fit }] }));
      delete n.bw; sizing(n, el, cs, r, ctx); return n;
    }
    if (el.tagName.toLowerCase() === 'svg') {
      const clone = el.cloneNode(true);
      const col = cs.color;
      clone.querySelectorAll('*').forEach(x => { for (const a of ['fill', 'stroke']) if (x.getAttribute(a) === 'currentColor') x.setAttribute(a, col); });
      for (const a of ['fill', 'stroke']) if (clone.getAttribute(a) === 'currentColor') clone.setAttribute(a, col);
      if (!clone.getAttribute('viewBox') && r.width) clone.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      clone.setAttribute('preserveAspectRatio', clone.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
      const n = add(Object.assign(base, { type: 'svg', name: nameOf(el, 'Vector'), markup: cleanSVG(new XMLSerializer().serializeToString(clone)).replace('preserveAspectRatio="none"', 'preserveAspectRatio="xMidYMid meet"'), fills: [] }));
      sizing(n, el, cs, r, ctx); return n;
    }
    if (el.tagName === 'HR') {
      const c = parseColor(cs.borderTopColor) || parseColor(cs.backgroundColor) || { r: 228, g: 228, b: 232, a: 1 };
      const n = add(Object.assign(base, { type: 'line', name: 'Divider', h: 0, stroke: { c: toHex(c), w: Math.max(1, px(cs.borderTopWidth) || r.height || 1), style: 'solid' }, fills: [] }));
      sizing(n, el, cs, r, ctx); if (ctx.playout && ctx.playout.dir === 'col') n.sw = 'fill'; return n;
    }
    // text leaf (a plain run of text, possibly with a box around it)
    if (isTextLeaf(el)) {
      const tp = textProps(cs);
      const text = textOf(el);
      const box = hasBox(cs);
      const rng = d.createRange(); rng.selectNodeContents(el); const tr = rng.getBoundingClientRect();
      if (box) {
        // badge / button: frame with padding around a text layer
        const bs = boxStyle(el, cs, r); const bw = bs.bw; delete bs.bw;
        const pad = ['Top', 'Right', 'Bottom', 'Left'].map((s, i) => rnd(px(cs['padding' + s]) + bw[i], 1));
        const fr = add(Object.assign(base, { type: 'frame', name: nameOf(el, el.tagName === 'BUTTON' ? 'Button' : text.slice(0, 30)), layout: { dir: 'row', gap: 0, pad, align: 'center', justify: tp.talign === 'center' ? 'center' : tp.talign === 'right' ? 'end' : 'start', wrap: false } }, bs));
        sizing(fr, el, cs, r, ctx, true);
        const wraps = tr.height > (px(cs.lineHeight) || tp.size * tp.lh) * 1.5;
        add(Object.assign({ id: uid(), page, parent: fr.id, z: 0, type: 'text', text, name: text.slice(0, 40), x: 0, y: 0, w: rnd(tr.width, 1), h: rnd(tr.height, 1), sw: wraps || fr.sw !== 'hug' && tp.talign !== 'left' ? 'fill' : 'hug', sh: 'hug' }, tp));
        if (fr.sw !== 'hug' && batch.get(order[order.length - 1]).sw === 'fill') {} // fills the button width
        return fr;
      }
      const n = add(Object.assign(base, { type: 'text', text, name: nameOf(el, text.slice(0, 40)) }, tp));
      if (+cs.opacity < 1) n.opacity = +cs.opacity;
      const lineH = px(cs.lineHeight) || tp.size * tp.lh;
      const wraps = tr.height > lineH * 1.5;
      textSizing(n, el, cs, r, tr, ctx, wraps);
      return n;
    }
    // container
    const bs = boxStyle(el, cs, r); const bw = bs.bw; delete bs.bw;
    const fr = add(Object.assign(base, { type: 'frame', name: nameOf(el, tagName(el)) }, bs));
    if (el.hasAttribute('data-component')) { fr.component = true; fr.name = el.getAttribute('data-component') || fr.name; }
    if (el.hasAttribute('data-flow')) fr.flow = el.getAttribute('data-flow') || fr.name;
    if (el.getAttribute('data-mode') === 'dark' || el.classList.contains('dark')) fr.mode = 'dark';
    const padC = ['Top', 'Right', 'Bottom', 'Left'].map((s, i) => rnd(px(cs['padding' + s]) + bw[i], 1));
    const kidsEls = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 1 && !SKIP_TAGS.has(c.tagName)) { const ccs = win.getComputedStyle(c); if (ccs.display !== 'none' && c.tagName !== 'BR') kidsEls.push(c); }
      else if (c.nodeType === 3 && c.textContent.trim()) kidsEls.push(c);
    }
    const flow = kidsEls.filter(c => c.nodeType === 3 || !/absolute|fixed/.test(win.getComputedStyle(c).position));
    let layout = null;
    const isFlex = /flex/.test(cs.display);
    if (isFlex) {
      const row = /row/.test(cs.flexDirection);
      const gapV = px(row ? cs.columnGap : cs.rowGap);
      const jc = cs.justifyContent;
      const ai = cs.alignItems;
      layout = { dir: row ? 'row' : 'col', gap: /space-between/.test(jc) && flow.length > 1 ? 'auto' : rnd(gapV, 1), pad: padC, align: /center/.test(ai) ? 'center' : /end/.test(ai) ? 'end' : /baseline/.test(ai) ? 'baseline' : 'start', justify: /center|space-around|space-evenly/.test(jc) ? 'center' : /end/.test(jc) ? 'end' : 'start', wrap: cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse' };
      if (/reverse/.test(cs.flexDirection)) flow.reverse();
    } else if (flow.length >= 1 && (cs.display === 'block' || cs.display === 'list-item' || cs.display === 'inline-block' || cs.display === 'flow-root')) {
      // evenly stacked blocks → vertical auto layout
      const rs = flow.map(c => c.nodeType === 3 ? rangeRect(c) : c.getBoundingClientRect());
      let stacked = true; const gaps = [];
      for (let i = 1; i < rs.length; i++) { if (rs[i].top < rs[i - 1].bottom - 0.5) { stacked = false; break; } gaps.push(rs[i].top - rs[i - 1].bottom); }
      const even = gaps.every(g => Math.abs(g - (gaps[0] || 0)) <= 1.01);
      if (stacked && even) {
        const ct = r.top + padC[0], cl = r.left + padC[3], cw = r.width - padC[1] - padC[3];
        const lefts = rs.map(q => q.left - cl), centers = rs.map(q => q.left + q.width / 2 - (cl + cw / 2));
        const align = rs.every((q, i) => Math.abs(lefts[i]) <= 1 || Math.abs(q.width - cw) <= 1) ? 'start' : rs.every(q => Math.abs(q.left + q.width / 2 - (cl + cw / 2)) <= 1.5) ? 'center' : rs.every(q => Math.abs(q.right - (cl + cw)) <= 1) ? 'end' : null;
        if (align) {
          const topPad = rnd(rs[0].top - r.top, 1); const bottomPad = rnd(r.bottom - rs[rs.length - 1].bottom, 1);
          layout = { dir: 'col', gap: rnd(gaps[0] || 0, 1), pad: [topPad, padC[1], Math.max(0, bottomPad), padC[3]], align, justify: 'start', wrap: false };
          fr._blockStack = true;
        }
      }
    }
    fr.layout = layout;
    const blockStack = !!fr._blockStack; delete fr._blockStack;
    sizing(fr, el, cs, r, ctx, !!layout);
    if (layout && blockStack && fr.sh === 'fixed') { const lastB = flow.length ? (flow[flow.length - 1].nodeType === 3 ? rangeRect(flow[flow.length - 1]) : flow[flow.length - 1].getBoundingClientRect()).bottom : r.top; if (r.bottom - lastB > padC[2] + 1) layout.pad[2] = padC[2]; }
    const sub = { pid: fr.id, prect: r, playout: layout, pcs: cs, pel: el, pnode: fr, block: blockStack };
    let zi = 0;
    for (const c of (layout ? [...flow, ...kidsEls.filter(k => !flow.includes(k))] : kidsEls)) {
      if (c.nodeType === 3) {
        const tr = rangeRect(c); if (!tr.width) continue;
        const tp = textProps(cs); const text = c.textContent.replace(/\s+/g, ' ').trim();
        const rr2 = relRect(tr, r);
        const t = add(Object.assign({ id: uid(), page, parent: fr.id, z: zi++, type: 'text', text, name: text.slice(0, 40), x: rr2.x, y: rr2.y, w: rr2.w, h: rr2.h, sw: 'hug', sh: 'hug' }, tp));
        if (layout && tr.height > (px(cs.lineHeight) || tp.size * 1.3) * 1.5) t.sw = 'fill';
        continue;
      }
      convert(c, sub, zi++);
    }
    return fr;
  }
  function rangeRect(t) { const rg = d.createRange(); rg.selectNodeContents(t); return rg.getBoundingClientRect(); }
  function batchDesc(id) { const out = []; const walk = pid => { for (const n of batch.values()) if (n.parent === pid) { out.push(n); walk(n.id); } }; walk(id); return out; }
  function sizing(n, el, cs, r, ctx, hugable) {
    const L = ctx.playout;
    n.sw = 'fixed'; n.sh = 'fixed';
    if (L && !n.abs) {
      const row = L.dir === 'row';
      const pr = ctx.prect; const pad = L.pad;
      const contentW = pr.width - pad[1] - pad[3], contentH = pr.height - pad[0] - pad[2];
      const grow = +cs.flexGrow > 0;
      const selfStretch = cs.alignSelf === 'stretch' || ((cs.alignSelf === 'auto' || cs.alignSelf === 'normal') && /normal|stretch/.test(ctx.pcs.alignItems)) || (ctx.block && !/inline/.test(cs.display));
      // main axis
      if (row) {
        if (grow) n.sw = 'fill'; else if (hugable && Math.abs(natural(el, 'width') - r.width) <= 1) n.sw = 'hug';
        if (Math.abs(r.height - contentH) <= 1 && selfStretch && L.align !== 'center') n.sh = 'fill'; else if (hugable && Math.abs(natural(el, 'height') - r.height) <= 1) n.sh = 'hug';
      } else {
        if (grow) n.sh = 'fill'; else if (hugable && Math.abs(natural(el, 'height') - r.height) <= 1) n.sh = 'hug';
        if (Math.abs(r.width - contentW) <= 1 && (selfStretch || !/inline/.test(cs.display))) n.sw = 'fill'; else if (hugable && Math.abs(natural(el, 'width') - r.width) <= 1) n.sw = 'hug';
      }
    } else if (hugable && !ctx.pid) {
      // root: keep the screen size fixed; only shrink-wrapped roots hug
      if (Math.abs(natural(el, 'width') - r.width) <= 1 && r.width < W - 1) n.sw = 'hug';
    } else if (hugable && ctx.pid) {
      if (Math.abs(natural(el, 'width') - r.width) <= 1) n.sw = 'hug';
      if (Math.abs(natural(el, 'height') - r.height) <= 1) n.sh = 'hug';
    }
  }
  function textSizing(n, el, cs, r, tr, ctx, wraps) {
    const L = ctx.playout;
    n.sh = 'hug';
    if (L && !n.abs) {
      const row = L.dir === 'row'; const pr = ctx.prect; const pad = L.pad;
      const contentW = pr.width - pad[1] - pad[3];
      const full = Math.abs(r.width - contentW) <= 1;
      if (+cs.flexGrow > 0 && row) n.sw = 'fill';
      else if (!row && full && (wraps || n.talign !== 'left')) n.sw = 'fill';
      else if (wraps) { n.sw = 'fixed'; n.w = rnd(r.width, 1); }
      else { n.sw = 'hug'; n.w = rnd(tr.width, 1); }
      if (n.sw === 'hug') { n.x = rnd(tr.left - pr.left, 1); }
    } else {
      if (wraps || (n.talign !== 'left' && r.width > tr.width + 1)) { n.sw = 'fixed'; }
      else { n.sw = 'hug'; n.x = rnd(tr.left - ctx.prect.left, 1); n.w = rnd(tr.width, 1); }
    }
    n.h = rnd(r.height, 1);
  }

  // roots
  const bodyRect = d.body.getBoundingClientRect();
  const rootEls = [...d.body.childNodes].filter(c => (c.nodeType === 1 && !SKIP_TAGS.has(c.tagName)) || (c.nodeType === 3 && c.textContent.trim()));
  const rootIds = [];
  let ox = opts.x != null ? opts.x : 0, oy = opts.y != null ? opts.y : 0;
  if (!P && opts.x == null && !replaced) { const sp = spotForFrame(W, 800); ox = sp.x; oy = sp.y; }
  const pk = parentId || 'page:' + page;
  let z = replaced ? replaced.z : nextZ(pk);
  let cursorX = ox;
  for (const el of rootEls) {
    if (el.nodeType === 3) {
      const tr = rangeRect(el); const tp = textProps(win.getComputedStyle(d.body)); const text = el.textContent.trim();
      const t = add(Object.assign({ id: uid(), page, parent: parentId, z: z++, type: 'text', text, name: text.slice(0, 40), x: cursorX, y: oy, w: rnd(tr.width, 1), h: rnd(tr.height, 1), sw: 'hug', sh: 'hug' }, tp));
      rootIds.push(t.id); continue;
    }
    const before = order.length;
    const n = convert(el, { pid: parentId, prect: el.getBoundingClientRect(), playout: null, pcs: P ? { alignItems: 'normal' } : win.getComputedStyle(d.body), pel: d.body }, z++);
    if (!n) continue;
    n.x = cursorX; n.y = oy;
    if (!P && !opts.name && rootEls.length === 1 && n.type === 'frame' && n.name === 'Frame') n.name = opts.label && opts.label !== 'Pasted HTML' ? opts.label : 'Screen';
    if (opts.name && rootIds.length === 0) n.name = opts.name;
    if (!P) { n.sw = n.sw === 'fill' ? 'fixed' : n.sw; n.sh = n.sh === 'fill' ? 'fixed' : n.sh; if (n.type === 'frame' && !n.fills.length && !n.component) n.fills = [{ t: 'solid', c: '#FFFFFF' }]; if (n.type === 'frame') n.clip = true; }
    if (P && P.layout) { n.abs = false; if (n.sw === 'fixed' && Math.abs(n.w - W) <= 1 && P.layout.dir === 'col') n.sw = 'fill'; }
    if (!P) cursorX += n.w + 80;
    else if (!P.layout) { oy += n.h + 16; }
    rootIds.push(n.id);
  }
  frame.remove();
  if (replaced) {
    // the new root keeps the replaced node's id so links and comments that point at it still work
    const oldId = replaced.id; const newRoot = batch.get(rootIds[0]);
    if (newRoot) {
      const tmp = newRoot.id; newRoot.id = oldId; batch.delete(tmp); batch.set(oldId, newRoot);
      for (const n of batch.values()) if (n.parent === tmp) n.parent = oldId;
      for (const pl of pendingLinks) if (pl.id === tmp) pl.id = oldId;
      newRoot.x = opts.x != null ? opts.x : replaced.x; newRoot.y = opts.y != null ? opts.y : replaced.y;
      newRoot.flow = newRoot.flow || replaced.flow; newRoot.link = newRoot.link || replaced.link; newRoot.abs = replaced.abs;
      if (replaced.component) newRoot.component = true;
      rootIds[0] = oldId;
    }
  }
  // prototype links by frame name (within this import or the file)
  for (const pl of pendingLinks) {
    const n = batch.get(pl.id); if (!n) continue;
    if (pl.to === 'back') { n.link = { to: 'back', on: 'click', tr: pl.tr, dur: 250 }; continue; }
    const want = pl.to.trim().toLowerCase();
    const t = [...batch.values()].find(x => !x.parent && x.type === 'frame' && x.name.toLowerCase() === want) || allFrames().find(f => f.name.toLowerCase() === want);
    if (t) n.link = { to: t.id, on: 'click', tr: pl.tr || 'dissolve', dur: 250 };
  }
  const changes = [];
  if (replaced) for (const d0 of descendants(replaced.id)) changes.push({ id: d0.id, after: null });
  for (const n of batch.values()) { delete n._blockStack; changes.push({ id: n.id, before: replaced && n.id === replaced.id ? clone(replaced) : null, after: n }); }
  if (opts.noCommit) return { ids: rootIds, count: batch.size, nodes: [...batch.values()] };
  commit(changes, { label: opts.label || 'Import HTML', force: opts.force });
  return { ids: rootIds, count: batch.size };
}
function splitTop(s) { const out = []; let depth = 0, cur = ''; for (const ch of String(s)) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function parseShadow(s) {
  const inset = /\binset\b/.test(s); s = s.replace(/\binset\b/, '').trim();
  const cm = s.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)(?![^(]*\))/i);
  let color = 'rgba(0, 0, 0, 0.15)';
  if (cm && !/^\d/.test(cm[1])) { color = cm[1]; s = s.replace(cm[1], '').trim(); }
  const nums = s.split(/\s+/).map(parseFloat).filter(v => !isNaN(v));
  if (nums.length < 2) return null;
  const c = parseColor(color); if (c && c.a === 0) return null;
  return { t: 'shadow', x: nums[0], y: nums[1], b: nums[2] || 0, s: nums[3] || 0, c: c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${rnd(c.a, 3)})` : color, inset };
}
