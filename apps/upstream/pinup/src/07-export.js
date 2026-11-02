// ---------- code export / handoff ----------
const exVar = id => '--' + slug((S.file.tokens.colors[id] || {}).name || id);
const EXO = { export: true, var: exVar };
function tokensCSS() {
  const C = S.file.tokens.colors || {}; const ids = Object.keys(C); if (!ids.length) return '';
  const L = ids.map(id => `  ${exVar(id)}: ${C[id].light};`).join('\n');
  const D = ids.map(id => `  ${exVar(id)}: ${C[id].dark || C[id].light};`).join('\n');
  return `:root {\n${L}\n}\n.dark {\n${D}\n}`;
}
function usedFonts(ids) {
  const set = new Set();
  const visit = n => { if (n.type === 'text') set.add((n.tstyle && S.file.tokens.type[n.tstyle] || {}).font || n.font); if (n.type === 'instance' && get(n.of)) visit(get(n.of)); for (const k of kids(n.id)) visit(k); };
  ids.forEach(id => get(id) && visit(get(id)));
  return [...set].filter(f => GFONTS[f]);
}
function fontLink(fonts) { if (!fonts.length) return ''; return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts.map(f => 'family=' + f.replace(/ /g, '+') + ':wght@' + GFONTS[f]).join('&')}&display=swap">`; }

// Walk a subtree as it renders (instances expanded with overrides) → [{n, P, kids, inst}]
function expand(n, P, ov, depth = 0) {
  if (depth > 30) return null;
  n = ov ? withOv(n, ov) : n;
  if (!n.visible) return null;
  if (n.type === 'instance') {
    const m = get(n.of); if (!m) return null;
    const r = instRoot(n, m); const sub = Object.assign({}, n.ov, ov || {});
    return { n: r, P, inst: n, main: m, kids: kids(m.id).map(k => expand(k, r, sub, depth + 1)).filter(Boolean) };
  }
  return { n, P, kids: n.type === 'frame' ? kids(n.id).map(k => expand(k, n, ov, depth + 1)).filter(Boolean) : [] };
}
function tagFor(n, inst) {
  const nm = (inst ? (get(inst.of) || {}).name : n.name || '').toLowerCase();
  if (n.type === 'text') { if (n.size >= 32) return 'h1'; if (n.size >= 24) return 'h2'; if (n.size >= 19) return 'h3'; return n.text && n.text.length < 40 && /label|caption|tag|badge/.test(nm) ? 'span' : 'p'; }
  if (/\b(button|btn|cta)\b/.test(nm) || nm.startsWith('button')) return 'button';
  if (n.type === 'frame' && /^(nav|navigation|tab ?bar|tabbar)/.test(nm)) return 'nav';
  if (n.type === 'frame' && /^header|top ?bar|app ?bar/.test(nm)) return 'header';
  if (n.type === 'frame' && /^footer/.test(nm)) return 'footer';
  if (n.type === 'line') return 'hr';
  return 'div';
}
function iconSVG(n) { return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="${n.iw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${n.svg || iconMarkup(n.icon)}</svg>`; }

function exportHTMLParts(ids) {
  const used = new Map(); const rules = []; const body = [];
  const cls = n => { let b = slug(n.name).slice(0, 32); if (/^\d/.test(b)) b = 'l-' + b; let c = b, i = 2; while (used.has(c)) c = b + '-' + i++; used.set(c, n.id); return c; };
  const emit = (t, depth, isRoot) => {
    const n = t.n; const c = cls(n);
    const css = cssFor(n, t.P, Object.assign({ root: isRoot }, EXO));
    if (n.type === 'line') { css.border = '0'; css.margin = '0'; }
    rules.push(`.${c} { ${Object.entries(css).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
    const tag = tagFor(n, t.inst);
    const pad = '  '.repeat(depth + 1);
    const link = (t.inst && t.inst.link) || n.link;
    const attrs = `class="${c}${isRoot && n.mode === 'dark' ? ' dark' : ''}"${link ? ` data-link="${esc(link.to === 'back' ? 'back' : (get(link.to) || {}).name || '')}"` : ''}${t.inst ? ` data-component="${esc(t.main.name)}"` : ''}`;
    if (n.type === 'text') return `${pad}<${tag} ${attrs}>${esc(n.text)}</${tag}>`;
    if (n.type === 'icon') return `${pad}<span ${attrs} data-icon="${esc(n.icon)}">${iconSVG(n)}</span>`;
    if (n.type === 'svg') return `${pad}<div ${attrs}>${cleanSVG(n.markup)}</div>`;
    if (n.type === 'line') return `${pad}<hr ${attrs}>`;
    const imgFill = (n.fills || []).find(f => f.t === 'image');
    const role = imgFill && !t.kids.length ? ` role="img" aria-label="${esc(n.name)}"` : '';
    if (!t.kids.length) return `${pad}<${tag} ${attrs}${role}></${tag}>`;
    return `${pad}<${tag} ${attrs}${role}>\n${t.kids.map(k => emit(k, depth + 1, false)).join('\n')}\n${pad}</${tag}>`;
  };
  for (const id of ids) { const n = get(id); if (!n) continue; const t = expand(n, null); if (!t) continue; body.push(emit(t, 0, true)); }
  return { rules, body, used };
}
function exportHTMLFragment(ids) {
  const { rules, body } = exportHTMLParts(ids);
  const tk = tokensCSS();
  return `<style>\n*{box-sizing:border-box;margin:0}\n${tk}\n${rules.join('\n')}\n</style>\n${body.join('\n')}`;
}
function exportHTMLDoc(ids, opts = {}) {
  const { rules, body } = exportHTMLParts(ids);
  const fonts = usedFonts(ids);
  const title = ids.length === 1 && get(ids[0]) ? get(ids[0]).name : S.file.name;
  const gallery = opts.gallery || ids.length > 1;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${fontLink(fonts)}
<style>
/* Exported from Pinup — ${esc(S.file.name)}. Auto layout → flexbox; free placement → absolute positions. */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; ${gallery ? 'display: flex; flex-wrap: wrap; gap: 48px; align-items: flex-start; padding: 48px; background: #E8E8EB;' : ''} }
p, h1, h2, h3, h4 { margin: 0; }
button { all: unset; box-sizing: border-box; cursor: pointer; }
hr { margin: 0; border: 0; }
${tokensCSS()}
${rules.join('\n')}
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}

// ---------- Tailwind ----------
const tws = v => String(v).replace(/\s*,\s*/g, ',').replace(/\s+/g, '_');
function twFor(css) {
  const out = [];
  for (const [k, v] of Object.entries(css)) {
    switch (k) {
      case 'position': out.push(v); break;
      case 'left': out.push(`left-[${v}]`); break;
      case 'top': out.push(`top-[${v}]`); break;
      case 'width': out.push(`w-[${v}]`); break;
      case 'height': out.push(`h-[${v}]`); break;
      case 'min-width': out.push(v === '0' || v === '0px' ? 'min-w-0' : `min-w-[${v}]`); break;
      case 'min-height': out.push(v === '0' || v === '0px' ? 'min-h-0' : `min-h-[${v}]`); break;
      case 'display': out.push(v === 'flex' ? 'flex' : `[display:${v}]`); break;
      case 'flex-direction': if (v === 'column') out.push('flex-col'); break;
      case 'flex-wrap': out.push('flex-wrap'); break;
      case 'gap': out.push(`gap-[${v}]`); break;
      case 'padding': { const p = v.split(' '); const z = x => x === '0px'; if (p.every(x => x === p[0])) out.push(`p-[${p[0]}]`); else if (p[0] === p[2] && p[1] === p[3]) { if (!z(p[1])) out.push(`px-[${p[1]}]`); if (!z(p[0])) out.push(`py-[${p[0]}]`); } else ['pt', 'pr', 'pb', 'pl'].forEach((k, i) => { if (!z(p[i])) out.push(`${k}-[${p[i]}]`); }); break; }
      case 'align-items': out.push({ 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end', baseline: 'items-baseline', stretch: 'items-stretch' }[v] || `[align-items:${v}]`); break;
      case 'justify-content': out.push({ 'flex-start': 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', 'space-between': 'justify-between' }[v] || `[justify-content:${v}]`); break;
      case 'flex': out.push(v === '1 1 0px' ? 'flex-1' : `[flex:${tws(v)}]`); break;
      case 'flex-shrink': out.push(v === '0' ? 'shrink-0' : `shrink-[${v}]`); break;
      case 'align-self': out.push(v === 'stretch' ? 'self-stretch' : `self-[${v}]`); break;
      case 'background-color': out.push(`bg-[${tws(v)}]`); break;
      case 'color': out.push(v === 'transparent' ? 'text-transparent' : `text-[${tws(v)}]`); break;
      case 'font-family': { const f = v.match(/"([^"]+)"/); out.push(`font-['${(f ? f[1] : v).replace(/ /g, '_')}']`); break; }
      case 'font-size': out.push(`text-[${v}]`); break;
      case 'font-weight': out.push(`font-[${v}]`); break;
      case 'line-height': out.push(`leading-[${v}]`); break;
      case 'letter-spacing': out.push(`tracking-[${v}]`); break;
      case 'text-align': out.push(`text-${v}`); break;
      case 'font-style': out.push('italic'); break;
      case 'text-decoration': out.push(v === 'underline' ? 'underline' : v === 'line-through' ? 'line-through' : `[text-decoration:${tws(v)}]`); break;
      case 'text-transform': out.push(v); break;
      case 'white-space': out.push(v === 'pre' ? 'whitespace-pre' : v === 'pre-wrap' ? 'whitespace-pre-wrap' : `whitespace-${v}`); break;
      case 'overflow-wrap': out.push('break-words'); break;
      case 'border-radius': out.push(v === '50%' ? 'rounded-full' : `rounded-[${tws(v)}]`); break;
      case 'box-shadow': out.push(`shadow-[${tws(v)}]`); break;
      case 'opacity': out.push(`opacity-[${v}]`); break;
      case 'transform': { const m = v.match(/rotate\(([-\d.]+deg)\)/); out.push(m ? `rotate-[${m[1]}]` : `[transform:${tws(v)}]`); break; }
      case 'overflow': out.push(`overflow-${v}`); break;
      case 'filter': { const m = v.match(/^blur\(([^)]+)\)$/); out.push(m ? `blur-[${m[1]}]` : `[filter:${tws(v)}]`); break; }
      case 'backdrop-filter': { const m = v.match(/^blur\(([^)]+)\)$/); out.push(m ? `backdrop-blur-[${m[1]}]` : `[backdrop-filter:${tws(v)}]`); break; }
      case '-webkit-backdrop-filter': break;
      case 'background-clip': out.push('bg-clip-text'); break;
      case '-webkit-background-clip': break;
      default: out.push(`[${k}:${tws(v)}]`);
    }
  }
  return out.join(' ');
}
function jsxText(s) { return /[{}<>]/.test(s) || /\n/.test(s) ? `{${JSON.stringify(s)}}` : s; }
function exportReact(ids, opts = {}) {
  ids = ids.filter(id => get(id));
  const comps = new Map(); // mainId → {name, props:[{prop, mid, def}]}
  const compName = m => { let b = pascal(m.name); if (/^\d/.test(b)) b = 'C' + b; return b; };
  const ensureComp = m => {
    if (comps.has(m.id)) return comps.get(m.id);
    const info = { name: compName(m), props: [], code: '' };
    comps.set(m.id, info);
    const usedP = new Set();
    for (const d of descendants(m.id)) if (d.type === 'text') { const par = get(d.parent); const auto = !d.name || d.name === (d.text || '').slice(0, 40); let p = camel(auto && par && par.id !== m.id && kids(par.id).length === 1 ? par.name : d.name || 'text'); if (/^\d/.test(p)) p = 'text' + p; if (['class', 'for', 'key', 'ref'].includes(p)) p += 'Text'; let q = p, i = 2; while (usedP.has(q)) q = p + i++; usedP.add(q); info.props.push({ prop: q, mid: d.id, def: d.text }); }
    info.code = `export function ${info.name}({ ${info.props.map(p => `${p.prop} = ${JSON.stringify(p.def)}`).join(', ')}${info.props.length ? ', ' : ''}...props }) {\n  return (\n${emit(expand(Object.assign({}, m, { x: 0, y: 0 }), null), 2, true, info)}\n  );\n}`;
    return info;
  };
  function emit(t, depth, isRoot, compCtx) {
    const pad = '  '.repeat(depth);
    if (t.inst && !isRoot) {
      const info = ensureComp(t.main);
      const o = t.inst.ov || {};
      const attrs = info.props.filter(p => o[p.mid] && o[p.mid].text != null && o[p.mid].text !== p.def).map(p => `${p.prop}=${JSON.stringify(o[p.mid].text)}`);
      const pos = cssFor(Object.assign({}, t.n, { fills: [], effects: [], stroke: null, radius: 0, layout: null, opacity: 1, clip: false, type: 'rect' }), t.P, EXO);
      for (const k of ['background-color', 'overflow']) delete pos[k];
      const link = t.inst.link ? ` /* on ${t.inst.link.on} → ${t.inst.link.to === 'back' ? 'back' : (get(t.inst.link.to) || {}).name} */` : '';
      return `${pad}<${info.name}${attrs.length ? ' ' + attrs.join(' ') : ''} className="${twFor(pos)}" />${link ? '\n' + pad + `{${link.trim()}}` : ''}`;
    }
    const n = t.n;
    const css = cssFor(n, t.P, Object.assign({ root: isRoot }, EXO));
    if (n.type === 'line') { css.border = '0'; css.margin = '0'; }
    let cls = twFor(css);
    if (isRoot && n.mode === 'dark') cls += ' dark';
    const tag = tagFor(n, t.inst);
    const link = n.link;
    const linkC = link ? ` data-link="${esc(link.to === 'back' ? 'back' : (get(link.to) || {}).name || '')}"` : '';
    const extra = isRoot && compCtx ? ` {...props}` : '';
    const clsAttr = isRoot && compCtx ? `className={\`${cls} \${props.className || ''}\`}` : `className="${cls}"`;
    if (n.type === 'text') {
      let content = jsxText(n.text);
      if (compCtx) { const p = compCtx.props.find(p => p.mid === n.id); if (p) content = `{${p.prop}}`; }
      return `${pad}<${tag} ${clsAttr}${linkC}${extra}>${content}</${tag}>`;
    }
    if (n.type === 'icon') return `${pad}<svg ${clsAttr} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={${n.iw || 2}} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(n.svg || iconMarkup(n.icon))} }} />`;
    if (n.type === 'svg') return `${pad}<div ${clsAttr} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanSVG(n.markup))} }} />`;
    if (n.type === 'line') return `${pad}<hr ${clsAttr} />`;
    if (!t.kids.length) return `${pad}<${tag} ${clsAttr}${linkC}${extra} />`;
    return `${pad}<${tag} ${clsAttr}${linkC}${extra}>\n${t.kids.map(k => emit(k, depth + 1, false, compCtx)).join('\n')}\n${pad}</${tag}>`;
  }
  const screens = [];
  for (const id of ids) {
    const n = get(id); const t = expand(Object.assign({}, n, n.parent ? {} : { x: 0, y: 0 }), null); if (!t) continue;
    if (n.component) { ensureComp(n); continue; }
    let name = pascal(n.name); if (/^\d/.test(name)) name = 'Screen' + name;
    screens.push(`export default function ${name}() {\n  return (\n${emit(t, 2, true, null)}\n  );\n}`);
  }
  const fonts = usedFonts(ids);
  const head = `// ${S.file.name} — exported from Pinup (React + Tailwind, arbitrary values).\n` +
    (fonts.length ? `// Fonts: ${fonts.join(', ')} — load from Google Fonts.\n` : '') +
    (Object.keys(S.file.tokens.colors).length ? `// Colour tokens are CSS variables; add to your global CSS:\n${tokensCSS().split('\n').map(l => '//   ' + l).join('\n')}\n` : '');
  return head + '\n' + [...[...comps.values()].map(c => c.code), ...screens].join('\n\n') + '\n';
}

function handoffMarkdown() {
  const lines = [];
  const date = new Date().toISOString().slice(0, 10);
  lines.push(`# ${S.file.name} — design handoff`, '', `Exported from Pinup on ${date}. The Pinup file is the source of truth; this is a snapshot.`, '');
  lines.push('## How to build this', '', '- Auto layout frames map 1:1 to flexbox (direction, gap, padding, alignment). Layers placed freely are absolutely positioned; prefer flex/grid in production where the intent is obvious.', '- Sizes are in CSS px at 1x. "Hug" = size to content, "Fill" = flex: 1 / stretch.', '- Colours reference tokens (CSS variables). Screens marked dark use the `.dark` values.', '- `data-link` attributes describe prototype navigation; implement as routes or state.', '');
  const tk = tokensCSS();
  if (tk) lines.push('## Colour tokens', '', '```css', tk, '```', '');
  const T = S.file.tokens.type || {};
  if (Object.keys(T).length) { lines.push('## Text styles', '', '| Style | Font | Size / line height | Weight | Tracking |', '|---|---|---|---|---|'); for (const t of Object.values(T)) lines.push(`| ${t.name} | ${t.font} | ${t.size}px / ${t.lh <= 4 ? t.lh : t.lh + 'px'} | ${t.weight} | ${t.ls || 0}px |`); lines.push(''); }
  const comps = components();
  if (comps.length) { lines.push('## Components', ''); lines.push('```jsx', exportReact(comps.map(c => c.id)).replace(/^\/\/.*\n/gm, '').trim(), '```', ''); }
  lines.push('## Screens', '');
  for (const p of S.file.pages) {
    const fs = framesOnPage(p.id).filter(f => !f.component);
    if (!fs.length) continue;
    for (const f of fs) {
      lines.push(`### ${p.name} / ${f.name}`, '', `${Math.round(f.w)} × ${Math.round(f.h)} · ${f.mode || 'light'} mode${f.flow ? ` · starts flow “${f.flow}”` : ''}`);
      const links = [f, ...descendants(f.id)].filter(n => n.link);
      if (links.length) { lines.push('', 'Interactions:'); for (const n of links) lines.push(`- “${n.name}” (${n.link.on}) → ${n.link.to === 'back' ? 'back' : (get(n.link.to) || {}).name || '?'}${n.link.tr && n.link.tr !== 'instant' ? ` · ${n.link.tr} ${n.link.dur || 250}ms` : ''}`); }
      lines.push('', '```jsx', exportReact([f.id]).replace(/^\/\/.*\n/gm, '').replace(/^export function[\s\S]*?\n}\n\n/gm, '').trim(), '```', '');
    }
  }
  const open = (S.threads || []).filter(t => !t.resolved);
  const ofb = [...FB.items.values()].filter(isOpen).sort((x, y) => x.n - y.n);
  if (ofb.length) lines.push('## Open feedback', '', ...ofb.map(it => `- #${it.n} [${fbCat(it.cat).name}] ${fbWhere(it)}: ${(it.text || '(sketch)').replace(/\n/g, ' ')}`), '');
  if (open.length) lines.push('## Open review comments', '', `${open.length} unresolved comment thread(s) are pinned on the design (anchors below name the layer and its id). Read them in the artifact's comments.`, '', ...open.map(t => `- ${t.anchor}`), '');
  return lines.join('\n');
}

// ---------- files ----------
async function saveFile(filename, data) {
  const D = await capDownloads();
  if (D) {
    try { await D.save({ filename, data }); return true; }
    catch (err) { if (err && err.code === 'declined') return false; console.warn('[pinup] save failed', err); }
  }
  if (typeof data === 'string') { copyText(data, 'Downloads are off here — copied to clipboard instead'); return false; }
  toast('Downloads are not available in this view.');
  return false;
}
async function inlineImages(root) {
  const els = [root, ...root.querySelectorAll('*')];
  for (const el of els) {
    const bg = el.style.background || el.style.backgroundImage;
    if (!bg || !/url\(/.test(bg)) continue;
    const urls = [...bg.matchAll(/url\("?([^")]+)"?\)/g)].map(m => m[1]).filter(u => !u.startsWith('data:'));
    let out = bg;
    for (const u of urls) {
      try { const r = await fetch(u); const b = await r.blob(); const d = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); out = out.split(u).join(d); } catch {}
    }
    if (el.style.background) el.style.background = out; else el.style.backgroundImage = out;
  }
}
async function renderSVGString(id) {
  const n = get(id); if (!n) return null;
  const r = wrect(id) || n;
  const el = buildEl(Object.assign({}, n, { x: 0, y: 0, rot: 0 }), null, { mode: 'static', depth: 0, root: true });
  el.style.position = 'relative'; el.classList.add('m-' + modeOf(id));
  const holder = h('div', { class: 'tokroot', style: { position: 'fixed', left: '-99999px', top: '0' } }, el);
  document.body.append(holder);
  await inlineImages(el);
  const w = Math.ceil(r.w), hh = Math.ceil(r.h);
  const css = tokenCSS('.tokroot').replace(/\.tokroot/g, '.r');
  const xhtml = new XMLSerializer().serializeToString(el);
  holder.remove();
  return { w, h: hh, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" class="r m-${modeOf(id)}" style="width:${w}px;height:${hh}px;font-family:Arial,sans-serif"><style>*{box-sizing:border-box} ${css}</style>${xhtml}</div></foreignObject></svg>` };
}
async function exportImage(id, scale) {
  if (!id) return;
  const n = get(id); const res = await renderSVGString(id); if (!res) return;
  const base = slug(n.name);
  if (scale === 'svg') return saveFile(base + '.svg', res.svg);
  try {
    const img = new Image(); img.decoding = 'sync';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(res.svg);
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const cv = h('canvas', { width: res.w * scale, height: res.h * scale });
    const cx = cv.getContext('2d'); cx.scale(scale, scale); cx.drawImage(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('no blob');
    const ok = await saveFile(base + '@' + scale + 'x.png', blob);
    if (ok) toast('PNG saved (web fonts fall back to system fonts in image export)', 3000);
  } catch (err) {
    console.warn('[pinup] png export failed', err);
    toast('This browser blocks PNG export here — saving SVG instead');
    saveFile(base + '.svg', res.svg);
  }
}
