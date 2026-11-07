/* Pinboard · renderer: builders → DOM, with a context that tracks what each window read. */
(function (PB) {
  'use strict';
  const ui = PB.ui;
  PB.dropzones = new WeakMap();   // el → { accepts, fire, ctx }
  PB.dragItems = new WeakMap();   // el → { kind, payload, ctx }
  PB.track = null;

  function el(tag, cls, ...kids) { const e = document.createElement(tag); if (cls) e.className = cls; kids.forEach(k => { if (k == null || k === false) return; e.append(k.nodeType ? k : document.createTextNode(String(k))); }); return e; }
  PB.el = el;

  // ---------- context ----------
  PB.makeCtx = function (clip, extra = {}) {
    const id = clip.id; const deps = new Set();
    const track = k => deps.add(k);
    const def = clip.kind === 'app' && PB.apps ? PB.apps.def(clip.app) : null;
    const ctx = {
      clip, window: clip, id, deps, def,
      state: new Proxy({}, { get: (_, k) => { if (typeof k !== 'string') return undefined; track('state:' + id + ':' + k); return (PB.S.clips[id] && PB.S.clips[id].state || {})[k]; }, has: (_, k) => k in ((PB.S.clips[id] || {}).state || {}), ownKeys: () => Object.keys((PB.S.clips[id] || {}).state || {}), getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: ((PB.S.clips[id] || {}).state || {})[k] }) }),
      set: (k, v) => PB.setState(id, typeof k === 'object' ? k : { [k]: v }),
      param: (name) => { track('param:' + id + ':' + name); const c = PB.S.clips[id] || clip; if (c.params && name in c.params) return c.params[name]; const pd = def && (def.params || []).find(p => p.name === name); if (!pd) throw new Error('no param "' + name + '" in app ' + (clip.app || id) + '. Declared: ' + ((def && def.params) || []).map(p => p.name).join(', ')); return pd.def; },
      setParam: (name, v) => PB.mutate(m => m.setParam(id, name, v), PB.actor),
      attr: (name) => { track('clip:' + id); const c = PB.S.clips[id] || clip; return c[name]; },
      db: PB.db,
      board: PB.boardAPI,
      mutate: (fn) => PB.mutate(fn, clip.kind === 'app' ? 'app:' + clip.app : PB.actor),
      toast: (msg) => PB.toast(msg),
      sel: () => { const c = PB.S.clips[id] || clip; return c.binding ? PB.S.records[c.binding.id] : null; },
      agent: () => PB.agent, apps: PB.apps,
      ui, fragment: PB.fragment, ago: PB.ago, match: PB.match, clock: PB.clock,
    };
    return Object.assign(ctx, extra);
  };
  PB.withCtx = function (ctx, fn) { const prev = PB.track; PB.track = k => ctx.deps.add(k); try { return fn(); } finally { PB.track = prev; } };

  function val(v, ctx) { if (typeof v === 'function') return PB.withCtx(ctx, () => v(ctx)); return v; }
  function errEl(e, where) { console.warn('render error in ' + where, e); const d = el('span', 'rerr', '⚠ ' + where + ': ' + (e && e.message || e)); d.title = String(e && e.stack || e); return d; }
  function fire(b, ev, ctx, ...args) { (b.handlers[ev] || []).forEach(h => { try { h(...args, ctx); } catch (e) { console.error(e); PB.toast('⚠ ' + ev + ': ' + e.message); } }); }
  function styleBox(e, p, ctx) {
    const gap = val(p.gap, ctx), pad = val(p.pad, ctx);
    if (gap != null) e.style.gap = gap + 'px'; if (pad != null) e.style.padding = pad + 'px';
    if (p.w != null) e.style.width = typeof p.w === 'number' ? p.w + 'px' : p.w; if (p.h != null) e.style.height = typeof p.h === 'number' ? p.h + 'px' : p.h;
    if (p.grow) e.style.flex = p.grow + ' 1 0'; if (p.align) e.style.alignItems = p.align; if (p.justify) e.style.justifyContent = p.justify; if (p.wrap) e.style.flexWrap = 'wrap';
    if (p.cls) String(p.cls).split(' ').filter(Boolean).forEach(x => e.classList.add(x)); if (p.style) Object.assign(e.style, p.style);
    if (p.small) e.classList.add('small'); if (p.bold) e.classList.add('bold'); if (p.mono) e.classList.add('mono'); if (p.muted) e.classList.add('muted');
    if (p.tooltip) e.title = val(p.tooltip, ctx);
  }
  function resolveSrc(src) {
    if (!src) return '';
    if (src instanceof Blob) { if (!src._url) src._url = URL.createObjectURL(src); return src._url; }
    if (PB.isAssetRef(src)) return PB.blobURL(src);
    return String(src);
  }
  PB.resolveSrc = resolveSrc;
  function items(src, ctx) {
    let s = val(src, ctx);
    if (s && s._isQuery) s = PB.withCtx(ctx, () => s.all());
    if (!Array.isArray(s)) { if (s && typeof s === 'object') return Object.values(s); return []; }
    return s;
  }
  function cellText(v) { if (v == null) return ''; if (Array.isArray(v)) return v.map(cellText).join(' · '); if (typeof v === 'object') return JSON.stringify(v); if (typeof v === 'number' && v > 1e12) return PB.ago(v); return String(v); }
  function optionsFor(b, ctx) {
    let o = val(b.props.options, ctx);
    if (!o && ctx.def) { const pd = (ctx.def.params || []).find(p => p.name === b.props.key); if (pd) o = pd.options; }
    return (o || []).map(x => typeof x === 'object' ? x : { value: x, label: String(x) });
  }
  function keyGet(b, ctx) { const k = b.props.key; const c = PB.S.clips[ctx.id] || ctx.clip; if (c.params && k in c.params) return ctx.param(k); if (ctx.def && (ctx.def.params || []).some(p => p.name === k)) return ctx.param(k); return ctx.state[k]; }
  function keySet(b, ctx, v) { const k = b.props.key; const c = PB.S.clips[ctx.id] || ctx.clip; if ((c.params && k in c.params) || (ctx.def && (ctx.def.params || []).some(p => p.name === k))) ctx.setParam(k, v); else ctx.set(k, v); }

  // ---------- render ----------
  PB.render = function render(b, ctx) {
    if (b == null || b === false) return document.createTextNode('');
    if (b.nodeType) return b;
    if (typeof b === 'string' || typeof b === 'number') return document.createTextNode(String(b));
    if (!b._isBuilder) return el('span', 'rerr', '⚠ not a builder: ' + PB.toYAML(b).slice(0, 80));
    try {
      if (b.props.when !== undefined && !val(b.props.when, ctx)) return document.createTextNode('');
      const p = b.props; let e;
      switch (b.kind) {
        case 'text': { e = el('span', 't'); const v = val(p.value, ctx); e.textContent = v == null ? '' : String(v); if (String(v).includes('\n')) e.style.whiteSpace = 'pre-wrap'; break; }
        case 'h': { e = el('h' + (p.level || 2), 'h'); e.textContent = String(val(p.value, ctx) ?? ''); break; }
        case 'note': { e = el('div', 'notetext'); e.textContent = String(val(p.value, ctx) ?? ''); break; }
        case 'doc': { e = el('div', 'doc'); e.innerHTML = PB.md(val(p.value, ctx)); break; }
        case 'image': {
          e = el('figure', 'img'); const src = val(p.src, ctx); const url = resolveSrc(src);
          if (/^https?:/.test(url)) { const a = el('a', 'linkcard remote', el('span', 'fav', '▢'), el('span', 'ttl', 'remote image'), el('span', 'host', PB.host(url) + ' · this page cannot load images from the web; paste the image instead')); a.href = url; a.target = '_blank'; a.rel = 'noopener'; e.append(a); }
          else { const im = el('img'); im.src = url; im.alt = p.alt || ''; im.draggable = false; if (p.fit) im.style.objectFit = p.fit; e.append(im); }
          if (p.caption) { const c = el('figcaption'); c.append(render(typeof p.caption === 'string' ? ui.text(p.caption) : p.caption, ctx)); e.append(c); }
          break;
        }
        case 'link': {
          const url = String(val(p.url, ctx) || ''); e = el('a', 'linkcard'); e.href = url; e.target = '_blank'; e.rel = 'noopener';
          const host = PB.host(url); e.append(el('span', 'fav', (host[0] || '?').toUpperCase()), el('span', 'ttl', val(p.title, ctx) || p.label || host || url), el('span', 'host', url.replace(/^https?:\/\//, '').slice(0, 80)));
          break;
        }
        case 'file': { e = el('div', 'filecard', '▤ ' + (p.file && p.file.name || 'file')); break; }
        case 'input': {
          const v = keyGet(b, ctx);
          if (p.multiline) { e = el('textarea', 'in' + (p.code ? ' code' : '')); e.rows = p.rows || (p.code ? 12 : 3); if (p.code) e.spellcheck = false; }
          else { e = el('input', 'in'); e.type = p.type || 'text'; }
          e.value = v == null ? '' : String(v); e.dataset.key = p.key; e.placeholder = val(p.placeholder, ctx) || '';
          let t; e.addEventListener('input', () => { const nv = e.type === 'number' ? Number(e.value) : e.value; clearTimeout(t); const go = () => keySet(b, ctx, nv); if (p.debounce) t = setTimeout(go, p.debounce); else go(); });
          e.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Enter' && !p.multiline) fire(b, 'enter', ctx, ev); if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) fire(b, 'submit', ctx, ev); if (ev.key === 'Tab' && p.code) { ev.preventDefault(); const s0 = e.selectionStart; e.setRangeText('  ', s0, e.selectionEnd, 'end'); e.dispatchEvent(new Event('input')); } });
          e.addEventListener('change', ev => fire(b, 'change', ctx, e.value, ev));
          break;
        }
        case 'button': { e = el('button', 'btn' + (p.primary ? ' primary' : '') + (p.small ? ' sm' : '')); e.textContent = String(val(p.label, ctx) ?? ''); if (val(p.disabled, ctx)) e.disabled = true; e.addEventListener('click', ev => { ev.stopPropagation(); fire(b, 'click', ctx, ev); }); break; }
        case 'chip': { e = el('span', 'chip'); e.textContent = String(val(p.value, ctx) ?? ''); if (b.handlers.click) { e.classList.add('clickable'); e.addEventListener('click', ev => { ev.stopPropagation(); fire(b, 'click', ctx, ev); }); } break; }
        case 'swatch': { e = el('span', 'swatch'); e.style.background = String(val(p.value, ctx) || '#000'); e.title = String(val(p.value, ctx) || ''); if (p.w) e.style.width = p.w + 'px'; if (p.h) e.style.height = p.h + 'px'; break; }
        case 'sep': { e = el('hr', 'sep'); break; }
        case 'spacer': { e = el('span', 'spacer'); break; }
        case 'kv': { e = el('dl', 'kv'); const pairs = val(p.pairs, ctx) || {}; (Array.isArray(pairs) ? pairs : Object.entries(pairs)).forEach(([k, v]) => e.append(el('dt', '', k), el('dd', '', cellText(val(v, ctx))))); break; }
        case 'stack': case 'row': case 'list': { e = el('div', b.kind); b.children.forEach(c => e.append(render(c, ctx))); break; }
        case 'grid': {
          e = el('div', 'grid' + (p.masonry ? ' masonry' : '')); const cols = val(p.cols, ctx) || 3;
          if (p.masonry) e.style.columnCount = cols; else e.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
          b.children.forEach(c => e.append(render(c, ctx))); break;
        }
        case 'each': { e = el('div', 'each'); const list = items(p.src, ctx); list.forEach((it, i) => { try { e.append(render(p.fn(it, i, ctx), ctx)); } catch (err) { e.append(errEl(err, 'each item ' + i)); } }); if (!list.length && p.hint) e.append(el('div', 'empty', val(p.hint, ctx))); break; }
        case 'when': { const ok = val(p.pred, ctx); const t = ok ? p.then : p.else; e = el('span', 'when'); if (t) e.append(render(typeof t === 'function' ? t(ctx) : t, ctx)); break; }
        case 'table': {
          const rows = items(p.rows, ctx); let cols = val(p.columns, ctx);
          if (!cols) { const ks = new Set(); rows.slice(0, 20).forEach(r => Object.keys(r || {}).forEach(k => ks.add(k))); cols = [...ks].filter(k => !['id', 'coll', 'clipId'].includes(k)); }
          cols = cols.map(c => typeof c === 'string' ? { key: c, label: c } : c);
          e = el('table', 'rt'); const th = el('tr'); cols.forEach(c => th.append(el('th', '', c.label))); e.append(el('thead', '', th)); const tb = el('tbody');
          rows.forEach(r => {
            const tr = el('tr'); if (p.selected && val(p.selected, ctx) === (r && r.id)) tr.classList.add('sel');
            cols.forEach(c => { const td = el('td', '', c.render ? c.render(r, ctx) : cellText(r == null ? '' : r[c.key])); if (p.editable && !c.render) { td.addEventListener('dblclick', ev => { ev.stopPropagation(); editCell(td, r, c.key, b, ctx); }); } tr.append(td); });
            if (b.handlers.row) tr.classList.add('clickable'); tr.addEventListener('click', ev => fire(b, 'row', ctx, r, ev)); tb.append(tr);
          });
          e.append(tb); if (!rows.length) e.append(el('caption', 'empty', val(p.hint, ctx) || 'nothing here yet')); break;
        }
        case 'dropzone': {
          e = el('div', 'dz'); const accepts = val(p.accepts, ctx) || ['*']; e.dataset.accepts = accepts.join(',');
          b.children.forEach(c => e.append(render(c, ctx))); if (p.hint) e.append(el('div', 'dzhint', val(p.hint, ctx)));
          const zone = { accepts, ctx, fire: (item) => { try { const ok = accepts.includes('*') || accepts.some(a => item.kind === a || (a.endsWith(':*') && item.kind.startsWith(a.slice(0, -1))) || (a === 'Files' && item.files) || (a === 'text/uri-list' && item.url && !item.clipId)); if (!ok) { fire(b, 'reject', ctx, item); if (!b.handlers.reject) PB.toast(item.kind + ' is not accepted here (' + accepts.join(', ') + ')'); return false; } fire(b, 'drop', ctx, item); return true; } catch (err) { PB.toast('⚠ drop: ' + err.message); return false; } } };
          PB.dropzones.set(e, zone);
          e.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); e.classList.add('over'); });
          e.addEventListener('dragleave', () => e.classList.remove('over'));
          e.addEventListener('drop', async ev => { ev.preventDefault(); ev.stopPropagation(); e.classList.remove('over'); const item = await PB.itemFromDataTransfer(ev.dataTransfer); if (item) zone.fire(item); });
          break;
        }
        case 'segmented': {
          e = el('div', 'seg'); const cur = keyGet(b, ctx);
          optionsFor(b, ctx).forEach(o => { const s = el('button', 'segb' + (o.value === cur ? ' on' : ''), o.label); s.addEventListener('click', ev => { ev.stopPropagation(); keySet(b, ctx, o.value); fire(b, 'change', ctx, o.value); }); e.append(s); });
          break;
        }
        case 'select': { e = el('select', 'in'); const cur = keyGet(b, ctx); optionsFor(b, ctx).forEach(o => { const op = el('option', '', o.label); op.value = String(o.value); if (o.value === cur) op.selected = true; e.append(op); }); e.addEventListener('change', () => { const o = optionsFor(b, ctx).find(x => String(x.value) === e.value); keySet(b, ctx, o ? o.value : e.value); fire(b, 'change', ctx, e.value); }); break; }
        case 'toggle': { e = el('button', 'tog' + (keyGet(b, ctx) ? ' on' : '')); e.append(el('span', 'box'), val(p.label, ctx) || p.key); e.addEventListener('click', ev => { ev.stopPropagation(); keySet(b, ctx, !keyGet(b, ctx)); fire(b, 'change', ctx); }); break; }
        case 'slider': { e = el('label', 'slider'); const i = el('input'); i.type = 'range'; i.min = p.min ?? 0; i.max = p.max ?? 100; i.step = p.step ?? 1; i.value = keyGet(b, ctx) ?? 0; const out = el('span', 'val', String(i.value) + (p.unit ? ' ' + p.unit : '')); i.addEventListener('input', () => { out.textContent = i.value + (p.unit ? ' ' + p.unit : ''); keySet(b, ctx, Number(i.value)); }); e.append(el('span', 'lbl', val(p.label, ctx) || p.key), i, out); break; }
        case 'slot': { e = el('span', 'slot'); break; }
        case 'frame': { e = el('div', 'frame'); e.append(render(p.body, ctx)); break; }
        default: e = el('span', 'rerr', '⚠ unknown kind ' + b.kind);
      }
      styleBox(e, p, ctx);
      if (p.id) e.dataset.nid = p.id;
      if (p.hint && !['dropzone', 'each', 'table'].includes(b.kind)) e.title = val(p.hint, ctx);
      if (p.selected !== undefined && b.kind !== 'table' && val(p.selected, ctx)) e.classList.add('selected');
      if (b.handlers.click && !['button', 'chip', 'table'].includes(b.kind)) { e.classList.add('clickable'); e.addEventListener('click', ev => fire(b, 'click', ctx, ev)); }
      if (b.handlers.dblclick) e.addEventListener('dblclick', ev => { ev.stopPropagation(); fire(b, 'dblclick', ctx, ev); });
      if (p.menu) { e.dataset.menu = '1'; PB.nodeMenus.set(e, { items: p.menu, ctx }); }
      if (p.draggable) { e.classList.add('drg'); PB.dragItems.set(e, { kind: p.draggable.kind, payload: () => { const pl = p.draggable.payload; return typeof pl === 'function' ? pl(ctx) : pl || {}; }, ctx }); }
      // frames from fragments: footer / strip / after
      if (p.footer || p.after) { const w = el('div', 'withfoot'); w.append(e); (p.after || []).forEach(n => w.append(render(n, ctx))); (p.footer || []).forEach(n => { const f = el('div', 'nfoot'); f.append(render(n, ctx)); w.append(f); }); return w; }
      return e;
    } catch (err) { return errEl(err, b.kind + (b.props.id ? '#' + b.props.id : '')); }
  };
  function editCell(td, row, key, b, ctx) {
    const old = td.textContent; td.contentEditable = 'true'; td.classList.add('editing'); td.focus(); document.execCommand && document.execCommand('selectAll', false, null);
    const done = (commit) => { td.contentEditable = 'false'; td.classList.remove('editing'); if (!commit) { td.textContent = old; return; } let v = td.textContent; if (Array.isArray(row[key])) v = v.split(/\s*[·,]\s*/).filter(Boolean); else if (typeof row[key] === 'number') v = Number(v); if (b.handlers.edit) fire(b, 'edit', ctx, row, key, v); else if (row.coll && row.id) PB.mutate(m => m.update(row.coll, row.id, { [key]: v }), PB.actor); };
    td.addEventListener('blur', () => done(true), { once: true });
    td.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); td.blur(); } if (ev.key === 'Escape') { done(false); } ev.stopPropagation(); });
  }
  PB.mount = function (b, host, ctx) { host.innerHTML = ''; host.append(PB.render(b, ctx)); return { el: host, ctx }; };

  // Re-render a container while keeping the focused input and its caret.
  PB.rerender = function (host, build) {
    const a = document.activeElement; let keep = null;
    if (a && host.contains(a) && a.dataset && a.dataset.key) keep = { key: a.dataset.key, s: a.selectionStart, e: a.selectionEnd, top: a.scrollTop };
    const scrolls = [...host.querySelectorAll('.scroll, .body')].map(x => [x.className, x.scrollTop]);
    build();
    if (keep) { const n = host.querySelector('[data-key="' + CSS.escape(keep.key) + '"]'); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.e); } catch (e) { } n.scrollTop = keep.top; } }
    [...host.querySelectorAll('.scroll, .body')].forEach((x, i) => { const s = scrolls.find(y => y[0] === x.className); if (s) x.scrollTop = s[1]; });
  };

  // ---------- external drops ----------
  PB.itemFromDataTransfer = async function (dt) {
    if (!dt) return null;
    const pb = dt.getData('application/x-pinboard'); if (pb) { try { return JSON.parse(pb); } catch (e) { } }
    let files = [...(dt.files || [])];
    if (!files.length && dt.items) files = [...dt.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { const imgs = files.filter(f => f.type.startsWith('image/')); return { kind: imgs.length ? 'clip:image' : 'Files', files, image: imgs[0] || null, title: files[0].name }; }
    const uri = dt.getData('text/uri-list') || ''; const text = dt.getData('text/plain') || ''; const html = dt.getData('text/html') || '';
    const url = (uri.split('\n').find(l => l && !l.startsWith('#')) || (PB.isURL(text) ? text.trim() : '')).trim();
    if (url) { const t = /<title>([^<]*)/i.exec(html); const img = /<img[^>]+src="([^"]+)"/i.exec(html); return { kind: 'clip:link', url, title: t ? t[1] : (/>([^<]{3,80})</.exec(html) || [])[1] || '', text, html, image: null, imageURL: img ? img[1] : null }; }
    if (html || text) return { kind: 'clip:note', text, html, title: '' };
    return null;
  };
})(window.PB);
