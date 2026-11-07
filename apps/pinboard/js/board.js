/* Pinboard · the board: canvas, clips, drag and drop, paste, selection, pinning, dock, quicklaunch. */
(function (PB) {
  'use strict';
  const ui = PB.ui, el = PB.el;
  const GLYPH = { note: '■', link: 'λ', image: '▢', doc: '▤', app: '△', group: '○' };
  PB.GLYPH = GLYPH;
  const B = PB.board = { els: {}, sel: new Set(), view: { x: 40, y: 40, z: 1 }, cursor: { x: 120, y: 120 }, filterTag: null, q: '' };
  let $wrap, $canvas, $pins, $dock, $marq;

  // ---------- default fragments on every clip ----------
  const taggable = PB.fragment('taggable')
    .attr('tags', [])
    .method('tag', (b, ...t) => b.set('tags', x => [...new Set([...(x || []), ...t])]))
    .method('untag', (b, t) => b.set('tags', x => (x || []).filter(y => y !== t)))
    .query('hasTag', (node, t) => (node.attrs.tags || []).includes(t))
    .decorate(b => b.strip(ui.each(c => c.attr('tags') || [], t => ui.chip(t).on('click', (ev, c) => c.board.filter({ tag: t })).tooltip('filter by ' + t))));
  const sourced = PB.fragment('sourced')
    .attr('source', null)
    .on('paste', (b, data) => b.set('source', { from: data.origin || 'clipboard', at: Date.now() }))
    .decorate(b => b.footer(ui.text(c => { const s = c.attr('source'); return s ? 'pasted ' + PB.ago(s.at) + ' · ' + s.from : 'added ' + PB.ago(c.attr('added')); }).small().muted()));
  const bound = PB.fragment('bound')
    .decorate(b => b.footer(ui.when(c => c.attr('binding'), c => ui.text(c => { const bd = c.attr('binding'); return '→ ' + bd.coll + ' · ' + bd.id.replace('rec:', ''); }).small().on('click', (ev, c) => c.board.openCollection(c.attr('binding').coll)))));
  const annotated = PB.fragment('annotated').attr('note', '');
  B.clipFrags = [taggable, sourced, bound, annotated];

  // ---------- geometry ----------
  const snap = v => Math.round(v / 8) * 8;
  B.toWorld = (sx, sy) => { const r = $wrap.getBoundingClientRect(); return { x: (sx - r.left - B.view.x) / B.view.z, y: (sy - r.top - B.view.y) / B.view.z }; };
  B.applyView = () => { B.minimap && B.minimap.on && requestAnimationFrame(B.drawMinimap); $canvas.style.transform = 'translate(' + B.view.x + 'px,' + B.view.y + 'px) scale(' + B.view.z + ')'; $wrap.style.backgroundPosition = B.view.x + 'px ' + B.view.y + 'px'; $wrap.style.backgroundSize = (24 * B.view.z) + 'px ' + (24 * B.view.z) + 'px'; clearTimeout(B._vt); B._vt = setTimeout(() => PB.meta('view', B.view), 300); };
  B.center = () => { const r = $wrap.getBoundingClientRect(); return B.toWorld(r.left + r.width / 2 - 120, r.top + r.height / 2 - 80); };
  let cascade = 0;
  B.nextPos = (near) => { const base = near ? { x: near.x + near.w + 24, y: near.y } : { x: B.cursor.x, y: B.cursor.y }; cascade = (cascade + 1) % 8; return { x: snap(base.x + cascade * 16), y: snap(base.y + cascade * 16) }; };

  // ---------- creating clips from pasted / dropped items ----------
  PB.clipFromItem = async function (item, pos, m) {
    const place = (spec) => { const c = Object.assign({ x: pos.x, y: pos.y, source: { from: item.origin || 'clipboard', at: Date.now() } }, spec); return m ? m.place(c) : PB.mutate(mm => mm.place(c), 'you'); };
    if (item.kind === 'clip:image' || (item.files && item.image)) {
      const ids = []; const files = (item.files || [item.image]).filter(f => f && f.type && f.type.startsWith('image/'));
      for (const f of files) { const blobId = await PB.putBlob(f); const dims = await imageDims(f); ids.push(place({ kind: 'image', title: (f.name || item.title || 'image').replace(/\.[a-z0-9]+$/i, ''), blobId, w: Math.min(360, Math.max(160, Math.round(dims.w / 4))), h: Math.min(300, Math.max(120, Math.round(dims.h / 4))) + 28, dims, mime: f.type })); pos = { x: pos.x + 24, y: pos.y + 24 }; }
      return ids;
    }
    if (item.files && item.files.length) {
      const ids = [];
      for (const f of item.files) {
        if (/^text\/|json|markdown/.test(f.type) || /\.(md|txt|json|csv|js|html?)$/i.test(f.name)) { const text = await f.text(); ids.push(place({ kind: 'doc', title: f.name, md: /\.(md|txt)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain' ? text : '```\n' + text.slice(0, 20000) + '\n```', w: 320, h: 300 })); }
        else ids.push(place({ kind: 'note', title: f.name, text: f.name + ' · ' + f.type + ' · ' + f.size + ' B (binary files are not kept)', w: 220, h: 100 }));
        pos = { x: pos.x + 24, y: pos.y + 24 };
      }
      return ids;
    }
    if (item.kind === 'clip:link' || item.url) return [place({ kind: 'link', title: item.title || '', url: item.url, desc: item.desc || '', w: 260, h: 110 })];
    if (item.kind === 'clip:note' || item.text != null) {
      const text = String(item.text || '').replace(/\r/g, '');
      if (item.html && /<(h[1-6]|table|ul|ol|pre)\b/i.test(item.html) && text.length > 200) return [place({ kind: 'doc', title: item.title || '', md: htmlToMd(item.html), w: 340, h: 300 })];
      if (text.length > 600 || /^#\s|\n\n/.test(text)) return [place({ kind: 'doc', title: item.title || '', md: text, w: 340, h: 300 })];
      return [place({ kind: 'note', title: item.title || '', text, w: 200, h: Math.min(260, 60 + 18 * (text.split('\n').length + 1)) })];
    }
    return [];
  };
  function htmlToMd(html) {
    const d = document.createElement('div'); d.innerHTML = html;
    d.querySelectorAll('script,style').forEach(x => x.remove());
    const walk = (n) => { if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' '); if (n.nodeType !== 1) return ''; const t = n.tagName.toLowerCase(); const inner = [...n.childNodes].map(walk).join(''); switch (t) { case 'h1': return '\n# ' + inner.trim() + '\n'; case 'h2': return '\n## ' + inner.trim() + '\n'; case 'h3': case 'h4': return '\n### ' + inner.trim() + '\n'; case 'p': case 'div': case 'section': return '\n' + inner.trim() + '\n'; case 'li': return '\n- ' + inner.trim(); case 'ul': case 'ol': return '\n' + inner + '\n'; case 'br': return '\n'; case 'a': return '[' + inner.trim() + '](' + (n.getAttribute('href') || '') + ')'; case 'b': case 'strong': return '**' + inner + '**'; case 'i': case 'em': return '*' + inner + '*'; case 'code': return '`' + inner + '`'; case 'pre': return '\n```\n' + n.textContent + '\n```\n'; case 'img': return ''; default: return inner; } };
    return walk(d).replace(/\n{3,}/g, '\n\n').trim();
  }
  function imageDims(blob) { return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 320, h: 240 }); im.src = URL.createObjectURL(blob); }); }
  PB.imageDims = imageDims;

  // ---------- clip DOM ----------
  const wins = {}; // id → { el, ctx, deps }
  B.wins = wins;
  function visible(c) { if (!c || c.group) return false; if (B.filterTag && !(c.tags || []).includes(B.filterTag)) return false; if (B.q && !PB.match([c.title, c.text, c.url, c.md, c.tags, c.app], B.q)) return false; return true; }
  B.renderAll = function () {
    const ids = new Set(Object.keys(PB.S.clips).filter(id => visible(PB.S.clips[id])));
    Object.keys(wins).forEach(id => { if (!ids.has(id)) { wins[id].el.remove(); delete wins[id]; } });
    ids.forEach(id => B.renderClip(id));
    B.layoutPins();
    PB.zTop = Math.max(PB.zTop, ...Object.values(PB.S.clips).map(c => c.z || 0));
    $pins.classList.toggle('empty', !$pins.children.length);
  };
  B.renderClip = function (id) {
    const c = PB.S.clips[id]; if (!c || !visible(c)) { if (wins[id]) { wins[id].el.remove(); delete wins[id]; } return; }
    let w = wins[id];
    if (!w) { w = wins[id] = { el: el('div', 'clip'), ctx: null }; w.el.dataset.id = id; bindClip(w.el, id); }
    const e = w.el; e.className = 'clip k-' + c.kind + (B.sel.has(id) ? ' sel' : '') + (c.pinned ? ' pinned' : '') + (c.kind === 'app' ? ' app' : '');
    if (c.pinned) { e.style.cssText = ''; if (e.parentNode !== $pins) $pins.append(e); }
    else { e.style.left = c.x + 'px'; e.style.top = c.y + 'px'; e.style.width = c.w + 'px'; e.style.height = c.h + 'px'; e.style.zIndex = c.z || 1; if (e.parentNode !== $canvas) $canvas.append(e); }
    const ctx = w.ctx = PB.makeCtx(c);
    PB.rerender(e, () => { e.innerHTML = ''; e.append(strip(c, ctx), bodyWrap(c, ctx), foot(c, ctx), el('div', 'rz')); });
    w.deps = ctx.deps;
  };
  function strip(c, ctx) {
    const s = el('div', 'strip');
    const g = el('span', 'glyph', GLYPH[c.kind] || '▢'); if (c.kind === 'app' && PB.apps.def(c.app)) g.textContent = PB.apps.def(c.app).icon || '△';
    const t = el('span', 'ttl', c.title || (c.kind === 'app' ? c.app : c.kind === 'link' ? PB.host(c.url) : c.kind));
    if (!c.title && c.kind !== 'app') t.classList.add('muted');
    t.title = 'double-click to rename'; t.addEventListener('dblclick', ev => { ev.stopPropagation(); renameInline(t, c.id); });
    s.append(g, t);
    // fragment strip decorations (chips)
    const frame = frameFor(c); (frame.props.strip || []).forEach(n => { const x = el('span', 'chips'); x.append(PB.render(n, ctx)); s.append(x); });
    s.append(el('span', 'sp'));
    if (c.kind === 'group') { const u = el('button', 'ib', '⊟'); u.title = 'ungroup'; u.addEventListener('click', ev => { ev.stopPropagation(); PB.mutate(m => m.ungroup(c.id)); }); s.append(u); }
    const pr = el('button', 'ib' + (c.side ? ' on' : ''), '◇'); pr.title = c.kind === 'app' ? 'params and properties' : 'properties'; pr.addEventListener('click', ev => { ev.stopPropagation(); PB.quiet('clips', c.id, { side: !c.side }); B.renderClip(c.id); });
    const pin = el('button', 'ib' + (c.pinned ? ' on' : ''), c.pinned ? '⊡' : '⊞'); pin.title = c.pinned ? 'unpin to the canvas' : 'pin to the side column'; pin.addEventListener('click', ev => { ev.stopPropagation(); PB.mutate(m => m.pin(c.id, !c.pinned)); });
    const x = el('button', 'ib x', '×'); x.title = 'close'; x.addEventListener('click', ev => { ev.stopPropagation(); PB.mutate(m => m.remove(c.id)); PB.toast('removed ' + (c.title || c.kind) + ' · ⌘Z undoes', 'ok'); });
    s.append(pr, pin, x); return s;
  }
  function frameFor(c) { let f = ui.frame(null); B.clipFrags.forEach(fr => { f = f.use(fr); }); return f; }
  function foot(c, ctx) { const f = el('div', 'foot'); const frame = frameFor(c); (frame.props.footer || []).forEach(n => f.append(PB.render(n, ctx))); if (c.kind === 'image' && c.dims) f.append(el('span', 'small muted', c.dims.w + ' × ' + c.dims.h)); return f; }
  function bodyWrap(c, ctx) { const w = el('div', 'bodywrap'); const b = el('div', 'body'); try { b.append(body(c, ctx)); } catch (e) { b.append(el('div', 'rerr', '⚠ ' + e.message)); console.error(e); } w.append(b); if (c.side) w.append(sidePanel(c, ctx)); return w; }
  const editing = new Set();
  function body(c, ctx) {
    switch (c.kind) {
      case 'note': { const d = el('div', 'notetext'); d.contentEditable = 'plaintext-only'; d.textContent = c.text || ''; d.dataset.key = '_note'; d.addEventListener('input', () => PB.quiet('clips', c.id, { text: d.textContent }, [])); d.addEventListener('keydown', ev => PB.keyStop(ev)); d.addEventListener('paste', ev => ev.stopPropagation()); if (!c.text) d.dataset.placeholder = 'type here'; return d; }
      case 'link': { const a = PB.render(ui.link(c.url).title(c.title || undefined), ctx); const d = el('div', 'linkbody', a); if (c.desc) d.append(el('p', 'small', c.desc)); if (c.note) d.append(el('p', 'small muted', c.note)); return d; }
      case 'image': { const d = el('div', 'imgbody'); const im = el('img'); im.src = c.blobId ? PB.blobURL(c.blobId) : (c.url || ''); im.alt = c.title || ''; im.draggable = false; im.addEventListener('dblclick', () => openLightbox(c)); d.append(im); if (c.caption) d.append(el('div', 'caption small', c.caption)); return d; }
      case 'doc': {
        if (editing.has(c.id)) { const ta = el('textarea', 'in code docedit'); ta.value = c.md || ''; ta.dataset.key = '_doc'; ta.spellcheck = false; ta.addEventListener('input', () => PB.quiet('clips', c.id, { md: ta.value }, [])); ta.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Escape') { editing.delete(c.id); B.renderClip(c.id); } }); ta.addEventListener('blur', () => { editing.delete(c.id); B.renderClip(c.id); }); setTimeout(() => ta.focus(), 0); return ta; }
        const d = el('div', 'doc'); d.innerHTML = PB.md(c.md || '*empty · double-click to write*'); d.title = 'double-click to edit'; d.addEventListener('dblclick', ev => { ev.stopPropagation(); editing.add(c.id); B.renderClip(c.id); }); return d;
      }
      case 'app': return PB.apps.view(c, ctx);
      case 'group': {
        const d = el('div', 'groupbody'); const tabs = el('div', 'tabs'); const kids = (c.children || []).map(k => PB.S.clips[k]).filter(Boolean);
        kids.forEach(k => { const t = el('button', 'tab' + (k.id === c.active ? ' on' : ''), (GLYPH[k.kind] || '') + ' ' + (k.title || k.kind)); t.addEventListener('click', ev => { ev.stopPropagation(); PB.quiet('clips', c.id, { active: k.id }); B.renderClip(c.id); }); tabs.append(t); });
        const act = kids.find(k => k.id === c.active) || kids[0]; d.append(tabs);
        if (act) { const sub = el('div', 'subbody'); const sctx = PB.makeCtx(act); try { sub.append(body(act, sctx)); } catch (e) { sub.append(el('div', 'rerr', '⚠ ' + e.message)); } d.append(sub); const out = el('button', 'btn sm', 'take out'); out.addEventListener('click', ev => { ev.stopPropagation(); PB.mutate(m => { m.set('clips', act.id, x => (x.group = null, x.x = c.x + c.w + 16, x.y = c.y, x), 'out of group'); m.set('clips', c.id, g => { g.children = g.children.filter(i => i !== act.id); if (g.children.length < 2) { const last = g.children[0]; if (last) m.set('clips', last, x => (x.group = null, x.x = g.x, x.y = g.y, x), 'out of group'); return null; } g.active = g.children[0]; return g; }, 'group'); }); }); d.append(out); }
        return d;
      }
    }
    return el('div', 'muted', c.kind);
  }
  function sidePanel(c, ctx) {
    const s = el('aside', 'side');
    const row = (label, input) => { const r = el('div', 'prow'); r.append(el('span', 'plbl', label), input); return r; };
    if (c.kind === 'app') {
      const def = PB.apps.def(c.app);
      s.append(el('h2', '', 'Params'));
      if (!def) s.append(el('div', 'rerr', 'app ' + c.app + ' is not registered'));
      (def && def.params || []).forEach(p => {
        const cur = c.params && p.name in c.params ? c.params[p.name] : p.def;
        let inp;
        if (p.type === 'slider') { inp = el('span', 'sl'); const i = el('input'); i.type = 'range'; i.min = p.min ?? 0; i.max = p.max ?? 100; i.step = p.step ?? 1; i.value = cur; const v = el('span', 'val', cur + (p.unit ? ' ' + p.unit : '')); i.addEventListener('input', () => { v.textContent = i.value + (p.unit ? ' ' + p.unit : ''); }); i.addEventListener('change', () => ctx.setParam(p.name, Number(i.value))); inp.append(i, v); }
        else if (p.type === 'toggle') { inp = el('button', 'tog' + (cur ? ' on' : '')); inp.append(el('span', 'box')); inp.addEventListener('click', () => ctx.setParam(p.name, !cur)); }
        else if (p.type === 'select') { inp = el('select', 'in'); (p.options || []).forEach(o => { const op = el('option', '', String(o)); op.value = String(o); if (o === cur) op.selected = true; inp.append(op); }); inp.addEventListener('change', () => { const o = (p.options || []).find(x => String(x) === inp.value); ctx.setParam(p.name, o); }); }
        else { inp = el('input', 'in'); inp.value = cur ?? ''; inp.placeholder = p.placeholder || ''; inp.addEventListener('change', () => ctx.setParam(p.name, p.type === 'number' ? Number(inp.value) : inp.value)); }
        s.append(row(p.name, inp));
      });
      if (!(def && def.params && def.params.length)) s.append(el('div', 'small muted', 'this app declares no params'));
      const b1 = el('button', 'btn sm', 'edit source'); b1.addEventListener('click', () => PB.apps.edit(c.app));
      const b2 = el('button', 'btn sm', 'reset state'); b2.addEventListener('click', () => { PB.mutate(m => m.setAttr(c.id, { state: PB.clone(def && def.state || {}) })); });
      const b3 = el('button', 'btn sm', 'describe'); b3.addEventListener('click', () => PB.agent.prefill('describe window ' + c.id));
      s.append(el('div', 'actions', b1, b2, b3));
      s.append(el('hr', 'sep'));
    }
    s.append(el('h2', '', 'Properties'));
    const kv = el('dl', 'kv'); kv.append(el('dt', '', 'id'), el('dd', 'mono', c.id), el('dt', '', 'kind'), el('dd', '', c.kind), el('dt', '', 'added'), el('dd', '', PB.ago(c.added)));
    if (c.dims) kv.append(el('dt', '', 'size'), el('dd', '', c.dims.w + ' × ' + c.dims.h));
    s.append(kv);
    const ti = el('input', 'in'); ti.value = c.title || ''; ti.placeholder = 'title'; ti.addEventListener('change', () => PB.mutate(m => m.retitle(c.id, ti.value))); s.append(row('title', ti));
    const tg = el('input', 'in'); tg.value = (c.tags || []).join(', '); tg.placeholder = 'a, b'; tg.addEventListener('change', () => PB.mutate(m => m.setAttr(c.id, { tags: tg.value.split(/\s*,\s*/).filter(Boolean) }))); s.append(row('tags', tg));
    if (c.kind === 'link') { const u = el('input', 'in'); u.value = c.url || ''; u.addEventListener('change', () => PB.mutate(m => m.setAttr(c.id, { url: u.value }))); s.append(row('url', u)); const d = el('input', 'in'); d.value = c.desc || ''; d.placeholder = 'description'; d.addEventListener('change', () => PB.mutate(m => m.setAttr(c.id, { desc: d.value }))); s.append(row('desc', d)); }
    if (c.kind === 'image') { const cp = el('input', 'in'); cp.value = c.caption || ''; cp.placeholder = 'caption'; cp.addEventListener('change', () => PB.mutate(m => m.setAttr(c.id, { caption: cp.value }))); s.append(row('caption', cp)); }
    const nt = el('textarea', 'in'); nt.rows = 3; nt.value = c.note || ''; nt.placeholder = 'your note on the clip'; nt.addEventListener('change', () => PB.mutate(m => m.setAttr(c.id, { note: nt.value }))); s.append(row('note', nt));
    if (c.kind !== 'app' && c.kind !== 'group') {
      const colls = Object.keys(PB.S.collections);
      if (c.binding) { const r = el('div', 'small'); r.append('row of ', el('b', '', c.binding.coll), ' · '); const b = el('a', '', 'unbind'); b.href = '#'; b.addEventListener('click', ev => { ev.preventDefault(); PB.mutate(m => m.demote(c.id)); }); r.append(b); s.append(row('binding', r)); }
      else { const sel = el('select', 'in'); sel.append(el('option', '', '— promote to …')); colls.forEach(n => sel.append(el('option', '', n))); const nw = el('option', '', '+ new collection'); nw.value = '__new'; sel.append(nw); sel.addEventListener('change', () => { let name = sel.value; if (name === '__new') { name = prompt('collection name'); if (!name) return; } if (!name || name.startsWith('—')) return; PB.mutate(m => m.promote(c.id, name)); PB.toast('promoted to ' + name); }); s.append(row('promote', sel)); }
    }
    const src = c.source ? el('div', 'small muted', 'from ' + c.source.from + ' · ' + new Date(c.source.at).toLocaleString()) : el('div', 'small muted', 'made here'); s.append(row('source', src));
    const dup = el('button', 'btn sm', 'duplicate'); dup.addEventListener('click', () => B.duplicate([c.id]));
    const ag = el('button', 'btn sm', 'ask the agent'); ag.addEventListener('click', () => { B.select([c.id]); PB.agent.prefill('about ' + c.id + ': '); });
    s.append(el('div', 'actions', dup, ag));
    s.addEventListener('keydown', ev => PB.keyStop(ev)); s.addEventListener('paste', ev => ev.stopPropagation());
    return s;
  }
  function renameInline(t, id) {
    const c = PB.S.clips[id]; const i = el('input', 'in rename'); i.value = c.title || ''; t.replaceWith(i); i.focus(); i.select();
    const done = (ok) => { if (ok && i.value !== (c.title || '')) PB.mutate(m => m.retitle(id, i.value)); else B.renderClip(id); };
    i.addEventListener('blur', () => done(true)); i.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Enter') i.blur(); if (ev.key === 'Escape') done(false); }); i.addEventListener('pointerdown', ev => ev.stopPropagation());
  }
  function openLightbox(c) { const lb = el('div', 'lightbox'); const im = el('img'); im.src = PB.blobURL(c.blobId); lb.append(im, el('div', 'small', (c.title || '') + (c.dims ? ' · ' + c.dims.w + ' × ' + c.dims.h : '') + ' · click to close')); lb.addEventListener('click', () => lb.remove()); document.body.append(lb); }

  // ---------- selection ----------
  B.select = function (ids, add) { const next = new Set(add ? B.sel : []); ids.forEach(i => next.add(i)); const changed = [...new Set([...next, ...B.sel])]; B.sel = next; changed.forEach(i => { const w = wins[i]; if (w) w.el.classList.toggle('sel', next.has(i)); }); PB.emit('selection', [...next]); };
  B.toggle = (id) => { const n = new Set(B.sel); n.has(id) ? n.delete(id) : n.add(id); B.select([...n]); };
  B.clearSel = () => B.select([]);
  B.focus = function (id) { const c = PB.S.clips[id]; if (!c) return; if (c.group) { PB.quiet('clips', c.group, { active: id }); B.renderClip(c.group); return B.focus(c.group); } if (!c.pinned) { const r = $wrap.getBoundingClientRect(); B.view.x = r.width / 2 - (c.x + c.w / 2) * B.view.z; B.view.y = r.height / 2 - (c.y + c.h / 2) * B.view.z; B.applyView(); } B.front(id); B.select([id]); };
  B.front = (id) => { const c = PB.S.clips[id]; if (!c) return; if ((c.z || 0) < PB.zTop) { c.z = ++PB.zTop; PB.save('clips', id); const w = wins[id]; if (w) w.el.style.zIndex = c.z; } };
  B.duplicate = function (ids) { const made = []; PB.mutate(m => ids.forEach(id => { const c = PB.clone(PB.S.clips[id]); if (!c) return; delete c.id; delete c.binding; delete c.pinned; delete c.group; c.x += 24; c.y += 24; c.title = c.title ? c.title + ' copy' : ''; made.push(m.place(c)); })); B.select(made); };

  // ---------- pointer interactions ----------
  function bindClip(e, id) {
    e.addEventListener('pointerdown', ev => {
      const c = PB.S.clips[id]; if (!c) return;
      B.front(id);
      if (ev.target.closest('.rz')) { startResize(ev, id); return; }
      const onStrip = ev.target.closest('.strip') && !ev.target.closest('button,input,.chip');
      const drg = ev.target.closest('.drg');
      if (drg && e.contains(drg) && !onStrip) { startItemDrag(ev, drg); return; }
      if (onStrip) { if (ev.shiftKey) B.toggle(id); else if (!B.sel.has(id)) B.select([id]); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); $wrap.focus({ preventScroll: true }); startClipDrag(ev, id); return; }
      if (!ev.target.closest('input,textarea,select,button,a,[contenteditable],.dz,.rt')) { if (ev.shiftKey) B.toggle(id); else if (!B.sel.has(id)) B.select([id]); if (document.activeElement && document.activeElement !== document.body && !e.contains(document.activeElement)) { document.activeElement.blur(); $wrap.focus({ preventScroll: true }); } }
      ev.stopPropagation();
    });
    e.addEventListener('dragover', ev => { if (!ev.target.closest('.dz')) { ev.preventDefault(); if (ev.target.closest('.strip')) e.classList.add('dropstrip'); } });
    e.addEventListener('dragleave', () => e.classList.remove('dropstrip'));
    e.addEventListener('drop', async ev => { e.classList.remove('dropstrip'); if (ev.target.closest('.dz')) return; ev.preventDefault(); ev.stopPropagation(); const item = await PB.itemFromDataTransfer(ev.dataTransfer); if (!item) return; const c = PB.S.clips[id]; const ids = await PB.clipFromItem(Object.assign(item, { origin: 'drop' }), { x: c.x + c.w + 16, y: c.y }); if (ev.target.closest('.strip') && ids.length) PB.mutate(m => c.kind === 'group' ? ids.forEach(k => m.set('clips', k, x => (x.group = id, x), 'into group')) && m.set('clips', id, g => (g.children.push(...ids), g), 'group') : m.group([id, ...ids])); });
  }
  let drag = null;
  function startClipDrag(ev, id) {
    const ids = [...B.sel].filter(i => PB.S.clips[i]); if (!ids.includes(id)) ids.push(id);
    const start = { x: ev.clientX, y: ev.clientY }; const orig = Object.fromEntries(ids.map(i => [i, { x: PB.S.clips[i].x, y: PB.S.clips[i].y, pinned: PB.S.clips[i].pinned }]));
    drag = { kind: 'clips', ids, start, orig, moved: false, target: null, ghost: null };
    ev.preventDefault(); document.body.classList.add('dragging');
  }
  function startItemDrag(ev, drgEl) {
    const d = PB.dragItems.get(drgEl); if (!d) return;
    const payload = d.payload() || {}; const item = Object.assign({ kind: d.kind, origin: 'drag', fromWindow: d.ctx.id }, payload);
    const g = el('div', 'dragghost', (payload.title || payload.caption || payload.url || d.kind)); document.body.append(g);
    drag = { kind: 'item', item, start: { x: ev.clientX, y: ev.clientY }, ghost: g, moved: false, target: null }; ev.preventDefault(); document.body.classList.add('dragging');
  }
  function startResize(ev, id) { const c = PB.S.clips[id]; drag = { kind: 'resize', id, start: { x: ev.clientX, y: ev.clientY }, ow: c.w, oh: c.h, ratio: c.kind === 'image' && c.dims ? c.dims.w / c.dims.h : null, shift: ev.shiftKey }; ev.preventDefault(); ev.stopPropagation(); }
  function hitTarget(ev) {
    const under = document.elementsFromPoint(ev.clientX, ev.clientY);
    for (const u of under) {
      if (u.classList && u.classList.contains('dragghost')) continue;
      if (drag.kind === 'clips' && u.closest && u.closest('.clip') && drag.ids.includes(u.closest('.clip').dataset.id)) continue;
      if (!u.closest) continue;
      const dz = u.closest('.dz'); if (dz) return { type: 'dz', el: dz };
      const strip = u.closest('.strip'); if (strip && drag.kind === 'clips') return { type: 'strip', el: strip.parentElement };
      if (u.closest('#dock')) return { type: 'dock', el: $dock };
      if (u.closest('#agentpanel') && u.closest('.composer')) return { type: 'composer', el: u.closest('.composer') };
      if (u.closest('#pins') || u.id === 'pinzone') return { type: 'pin', el: $pins };
      if (u === $canvas || u === $wrap) return { type: 'canvas', el: $canvas };
      if (u.closest('.clip')) return { type: 'clipbody', el: u.closest('.clip') };
    }
    return null;
  }
  function setTarget(t) {
    if (drag.target && drag.target.el !== (t && t.el)) drag.target.el.classList.remove('droptarget', 'dropstrip');
    drag.target = t; if (!t) { $wrap.classList.remove('pinhint'); return; }
    if (t.type === 'dz') { const z = PB.dropzones.get(t.el); const item = itemForDrag(); const ok = z && (z.accepts.includes('*') || z.accepts.some(a => item.kind === a || (a.endsWith(':*') && item.kind.startsWith(a.slice(0, -1))))); t.el.classList.toggle('droptarget', !!ok); if (!ok) drag.target = null; }
    else if (t.type === 'strip') t.el.classList.add('dropstrip');
    else if (t.type === 'dock' || t.type === 'composer') t.el.classList.add('droptarget');
    $wrap.classList.toggle('pinhint', t.type === 'pin');
  }
  function itemForDrag() { return drag.kind === 'item' ? drag.item : itemForDragFor(drag); }
  document.addEventListener('pointermove', ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.start.x, dy = ev.clientY - drag.start.y;
    if (drag.kind === 'resize') { const c = PB.S.clips[drag.id]; let w = Math.max(120, drag.ow + dx / B.view.z), h = Math.max(60, drag.oh + dy / B.view.z); if (drag.ratio && !drag.shift) h = (w / drag.ratio) + 28; const e = wins[drag.id].el; e.style.width = w + 'px'; e.style.height = h + 'px'; drag.w = w; drag.h = h; return; }
    if (!drag.moved && Math.hypot(dx, dy) < 4) return; drag.moved = true;
    if (drag.kind === 'clips') { drag.ids.forEach(i => { const o = drag.orig[i]; const e = wins[i] && wins[i].el; if (!e) return; if (o.pinned) { if (!drag.ghost) { drag.ghost = el('div', 'dragghost', PB.S.clips[i].title || PB.S.clips[i].kind); document.body.append(drag.ghost); } } else { e.style.left = (o.x + dx / B.view.z) + 'px'; e.style.top = (o.y + dy / B.view.z) + 'px'; } }); }
    if (drag.ghost) { drag.ghost.style.left = ev.clientX + 12 + 'px'; drag.ghost.style.top = ev.clientY + 12 + 'px'; }
    setTarget(hitTarget(ev));
  });
  document.addEventListener('pointerup', async ev => {
    if (!drag) return; const d = drag; drag = null; document.body.classList.remove('dragging'); $wrap.classList.remove('pinhint');
    if (d.ghost) d.ghost.remove(); if (d.target) d.target.el.classList.remove('droptarget', 'dropstrip');
    if (d.kind === 'resize') { if (d.w) PB.mutate(m => m.resize(d.id, { w: d.w, h: d.h })); return; }
    if (!d.moved) return;
    const t = d.target;
    const restore = () => d.kind === 'clips' && d.ids.forEach(i => B.renderClip(i));
    if (d.kind === 'clips') {
      const anyPinned = d.ids.some(i => d.orig[i].pinned);
      if (t && t.type === 'dz') { const z = PB.dropzones.get(t.el); restore(); if (z) { const ok = z.fire(itemForDragFor(d)); if (ok) PB.toast('dropped into ' + (z.ctx.clip.title || z.ctx.clip.app || 'app'), 'ok'); } return; }
      if (t && t.type === 'strip') { const tid = t.el.dataset.id; const tc = PB.S.clips[tid]; restore(); PB.mutate(m => tc.kind === 'group' ? (d.ids.forEach(k => m.set('clips', k, x => (x.group = tid, x), 'into group')), m.set('clips', tid, g => (g.children.push(...d.ids.filter(k => !g.children.includes(k))), g), 'group')) : m.group([tid, ...d.ids.filter(k => k !== tid)])); PB.toast('grouped · ⊟ ungroups', 'ok'); return; }
      if (t && t.type === 'dock') { restore(); const c = PB.S.clips[d.ids[0]]; if (c.kind === 'app') PB.toast(c.app + ' is already in the quicklaunch'); else { B.select(d.ids); PB.agent.prefill('wrap ' + d.ids.join(', ') + ' as an app that '); PB.toast('tell the agent what the app should do'); } return; }
      if (t && t.type === 'composer') { restore(); B.select(d.ids); PB.agent.prefill(d.ids.join(', ') + ' '); return; }
      if (t && t.type === 'pin') { if (!anyPinned) PB.mutate(m => d.ids.forEach(i => m.pin(i, true))); else restore(); return; }
      if (anyPinned && t && (t.type === 'canvas' || t.type === 'clipbody')) { const w = B.toWorld(ev.clientX, ev.clientY); PB.mutate(m => d.ids.forEach((i, k) => { m.pin(i, false); m.move(i, { x: snap(w.x + 16 * k), y: snap(w.y + 16 * k) }); })); return; }
      const dx = (ev.clientX - d.start.x) / B.view.z, dy = (ev.clientY - d.start.y) / B.view.z;
      PB.mutate(m => d.ids.forEach(i => { const o = d.orig[i]; if (!o.pinned) m.move(i, { x: snap(o.x + dx), y: snap(o.y + dy) }); }), 'you', { coalesce: 'move:' + d.ids.join(',') });
      return;
    }
    if (d.kind === 'item') {
      if (t && t.type === 'dz') { const z = PB.dropzones.get(t.el); if (z && z.fire(d.item)) PB.toast('dropped', 'ok'); return; }
      if (t && (t.type === 'canvas' || t.type === 'clipbody' || t.type === 'pin')) { const w = B.toWorld(ev.clientX, ev.clientY); const it = d.item; let spec = null; if (it.src || it.image) spec = { kind: 'image', blobId: typeof it.src === 'string' && PB.blobs[it.src] ? it.src : null, title: it.title || it.caption || '', caption: it.caption, tags: it.tags || [], w: 260, h: 220 }; else if (it.url) spec = { kind: 'link', url: it.url, title: it.title || '', tags: it.tags || [], w: 260, h: 110 }; else if (it.text) spec = { kind: 'note', text: it.text, title: it.title || '', tags: it.tags || [], w: 200, h: 120 }; if (spec && (spec.kind !== 'image' || spec.blobId)) { const id = PB.mutate(m => m.place(Object.assign(spec, { x: snap(w.x), y: snap(w.y), source: { from: 'app ' + (PB.S.clips[it.fromWindow] || {}).app, at: Date.now() } }))); if (t.type === 'pin') PB.mutate(m => m.pin(id, true)); B.select([id]); } else PB.toast('nothing to place from ' + it.kind); return; }
      if (t && t.type === 'composer') { PB.agent.prefill(JSON.stringify(d.item).slice(0, 200) + ' '); return; }
    }
  });
  function itemForDragFor(d) { const id = d.ids[d.ids.length - 1]; const c = PB.S.clips[id]; return { kind: 'clip:' + c.kind, clipId: id, clipIds: d.ids, title: c.title, url: c.url, text: c.text || c.md, image: c.blobId ? PB.blobs[c.blobId] : null, src: c.blobId, tags: c.tags || [], clip: c, origin: 'board' }; }

  // canvas: marquee, pan, zoom
  function bindCanvas() {
    let marq = null, pan = null, space = false;
    $wrap.addEventListener('pointerdown', ev => {
      if (ev.target !== $wrap && ev.target !== $canvas) return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      $wrap.focus({ preventScroll: true });
      if (ev.button === 1 || space || ev.altKey) { pan = { x: ev.clientX, y: ev.clientY, vx: B.view.x, vy: B.view.y }; $wrap.classList.add('panning'); ev.preventDefault(); return; }
      if (!ev.shiftKey) B.clearSel();
      marq = { x: ev.clientX, y: ev.clientY, add: ev.shiftKey }; $marq.style.display = 'block'; ev.preventDefault();
    });
    document.addEventListener('pointermove', ev => {
      if (pan) { B.view.x = pan.vx + ev.clientX - pan.x; B.view.y = pan.vy + ev.clientY - pan.y; B.applyView(); }
      if (marq) { const r = $wrap.getBoundingClientRect(); const x1 = Math.min(marq.x, ev.clientX) - r.left, y1 = Math.min(marq.y, ev.clientY) - r.top, x2 = Math.max(marq.x, ev.clientX) - r.left, y2 = Math.max(marq.y, ev.clientY) - r.top; Object.assign($marq.style, { left: x1 + 'px', top: y1 + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' }); const a = B.toWorld(r.left + x1, r.top + y1), b = B.toWorld(r.left + x2, r.top + y2); const ids = Object.values(PB.S.clips).filter(c => visible(c) && !c.pinned && c.x < b.x && c.x + c.w > a.x && c.y < b.y && c.y + c.h > a.y).map(c => c.id); B.select(ids, marq.add); }
      const w = B.toWorld(ev.clientX, ev.clientY); if (ev.target === $wrap || ev.target === $canvas) B.cursor = { x: snap(w.x), y: snap(w.y) };
    });
    document.addEventListener('pointerup', () => { if (pan) { pan = null; $wrap.classList.remove('panning'); } if (marq) { marq = null; $marq.style.display = 'none'; } });
    const scrollableUnder = (ev) => {
      let n = ev.target; const clip = n.closest && n.closest('.clip'); if (!clip) return false;
      while (n && n !== clip.parentNode) {
        const cs = getComputedStyle(n); const oy = cs.overflowY, ox = cs.overflowX;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && ((ev.deltaY < 0 && n.scrollTop > 0) || (ev.deltaY > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1))) return true;
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1 && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) && ((ev.deltaX < 0 && n.scrollLeft > 0) || (ev.deltaX > 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1))) return true;
        n = n.parentNode;
      }
      return false;
    };
    $wrap.addEventListener('wheel', ev => {
      if (!(ev.ctrlKey || ev.metaKey) && scrollableUnder(ev)) return;   // the window scrolls its own content
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) { const r = $wrap.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top; const z0 = B.view.z; const z = Math.min(3, Math.max(0.25, z0 * Math.exp(-ev.deltaY * 0.002))); B.view.x = mx - (mx - B.view.x) * z / z0; B.view.y = my - (my - B.view.y) * z / z0; B.view.z = z; }
      else { B.view.x -= ev.deltaX; B.view.y -= ev.deltaY; }
      B.applyView();
    }, { passive: false });
    document.addEventListener('keydown', ev => { if (ev.code === 'Space' && !isEditing()) { space = true; $wrap.classList.add('spacedown'); } });
    document.addEventListener('keyup', ev => { if (ev.code === 'Space') { space = false; $wrap.classList.remove('spacedown'); } });
    $wrap.addEventListener('dblclick', ev => { if (ev.target !== $wrap && ev.target !== $canvas) return; const w = B.toWorld(ev.clientX, ev.clientY); const id = PB.mutate(m => m.place({ kind: 'note', text: '', x: snap(w.x), y: snap(w.y), w: 200, h: 120 })); B.select([id]); setTimeout(() => { const n = wins[id] && wins[id].el.querySelector('.notetext'); n && n.focus(); }, 0); });
    // external drops
    $wrap.addEventListener('dragover', ev => { ev.preventDefault(); $wrap.classList.add('dropping'); });
    $wrap.addEventListener('dragleave', ev => { if (ev.target === $wrap) $wrap.classList.remove('dropping'); });
    $wrap.addEventListener('drop', async ev => { ev.preventDefault(); $wrap.classList.remove('dropping'); if (ev.target.closest('.dz, .clip')) return; const item = await PB.itemFromDataTransfer(ev.dataTransfer); if (!item) return; const w = B.toWorld(ev.clientX, ev.clientY); const ids = await PB.clipFromItem(Object.assign(item, { origin: 'drop' }), { x: snap(w.x), y: snap(w.y) }); B.select(ids); if (ids.length) PB.toast(ids.length + ' clip' + (ids.length > 1 ? 's' : '') + ' added', 'ok'); });
  }
  PB.keyStop = (ev) => { const mod = ev.metaKey || ev.ctrlKey; if (mod && ['k', 'z'].includes(ev.key.toLowerCase()) && !(ev.target && (ev.target.tagName === 'TEXTAREA' || ev.target.isContentEditable) && ev.key.toLowerCase() === 'z')) return; ev.stopPropagation(); };
  function isEditing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); }
  B.isEditing = isEditing;

  // ---------- paste / copy ----------
  function bindClipboard() {
    document.addEventListener('paste', async ev => {
      if (ev.target.closest && ev.target.closest('#agentpanel')) return;
      if (isEditing()) return;
      const dt = ev.clipboardData; if (!dt) return; ev.preventDefault();
      const text = dt.getData('text/plain') || '';
      if (text.startsWith('{"pinboard":1')) { try { await B.importJSON(JSON.parse(text), B.nextPos()); return; } catch (e) { console.warn(e); } }
      const item = await PB.itemFromDataTransfer(dt); if (!item) return;
      const ids = await PB.clipFromItem(Object.assign(item, { origin: 'clipboard' }), B.nextPos()); B.select(ids);
      if (ids.length) PB.toast('pasted ' + ids.map(i => PB.S.clips[i].kind).join(', '), 'ok');
    });
    document.addEventListener('copy', ev => { if (isEditing() || !B.sel.size) return; ev.preventDefault(); const data = B.exportJSON([...B.sel]); ev.clipboardData.setData('text/plain', JSON.stringify(data)); PB.toast('copied ' + B.sel.size + ' clip' + (B.sel.size > 1 ? 's' : '') + ' · paste into any pinboard', 'ok'); });
    document.addEventListener('cut', ev => { if (isEditing() || !B.sel.size) return; ev.preventDefault(); const ids = [...B.sel]; ev.clipboardData.setData('text/plain', JSON.stringify(B.exportJSON(ids))); PB.mutate(m => ids.forEach(i => PB.S.clips[i] && m.remove(i))); });
  }
  B.exportJSON = function (ids) {
    const clips = ids.map(i => PB.S.clips[i]).filter(Boolean).map(c => { const o = PB.clone(c); delete o.binding; delete o.group; delete o.pinned; delete o.side; if (o.blobId && PB.blobs[o.blobId]) o.blob = { type: PB.blobs[o.blobId].type, data: blobCache[o.blobId] || null }; return o; });
    return { pinboard: 1, clips, text: clips.map(c => c.title || c.url || c.text || c.kind).join('\n') };
  };
  const blobCache = {}; // id → base64 (filled lazily for copy)
  // Images live in assets; copying clips carries their bytes, so the selected
  // image clips are fetched ahead of a copy (and for the agent to look at).
  B.cacheBlobs = async function (ids) {
    const want = (ids || []).map(i => PB.S.clips[i]).filter(c => c && c.kind === 'image' && c.blobId).map(c => c.blobId);
    let got = 0;
    for (const id of want) if (!blobCache[id]) { try { blobCache[id] = await blobToB64(await PB.fetchBlob(id)); got++; } catch (e) { } }
    if (got) PB.emit('blobs', want);
  };
  function blobToB64(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(b); }); }
  B.importJSON = async function (data, pos) {
    const ids = []; const idmap = {};
    for (const c of data.clips || []) {
      const o = PB.clone(c); const oldId = o.id; delete o.id; delete o.z;
      if (o.blob && o.blob.data) { const bin = atob(o.blob.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); o.blobId = await PB.putBlob(new Blob([u8], { type: o.blob.type })); } else if (o.blobId && !PB.isAssetRef(o.blobId) && !PB.blobs[o.blobId]) { o.kind = 'note'; o.text = '(image not carried over)'; }
      delete o.blob; o.x = pos.x + (o.x - (data.clips[0].x || 0)); o.y = pos.y + (o.y - (data.clips[0].y || 0));
      const id = PB.mutate(m => m.place(o)); idmap[oldId] = id; ids.push(id);
    }
    B.select(ids); if (ids.length) PB.toast('imported ' + ids.length + ' clips', 'ok'); return ids;
  };

  // ---------- keyboard ----------
  function bindKeys() {
    document.addEventListener('keydown', ev => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); B.quicklaunch(); return; }
      if (ev.key === 'Escape') { if (document.getElementById('ql').classList.contains('open')) { B.quicklaunchClose(); return; } if (isEditing()) { document.activeElement.blur(); return; } B.clearSel(); B.filter({}); return; }
      if (isEditing()) { if (mod && ev.key === 'z' && ev.target.closest('.notetext')) { /* let browser handle */ } return; }
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) { PB.redo() ? PB.toast('redo') : PB.toast('nothing to redo'); } else { PB.undo() ? PB.toast('undo') : PB.toast('nothing to undo'); } return; }
      if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); B.select(Object.keys(PB.S.clips).filter(i => visible(PB.S.clips[i]))); return; }
      if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); if (B.sel.size) B.duplicate([...B.sel]); return; }
      if (mod && ev.key.toLowerCase() === 'g') { ev.preventDefault(); if (ev.shiftKey) { [...B.sel].forEach(i => PB.S.clips[i] && PB.S.clips[i].kind === 'group' && PB.mutate(m => m.ungroup(i))); } else if (B.sel.size > 1) PB.mutate(m => m.group([...B.sel])); return; }
      if (mod && ev.key.toLowerCase() === 'p') { ev.preventDefault(); [...B.sel].forEach(i => PB.mutate(m => m.pin(i, !PB.S.clips[i].pinned))); return; }
      if (mod && ev.key === 'Enter') { ev.preventDefault(); PB.agent.toggle(true); return; }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && B.sel.size) { ev.preventDefault(); const ids = [...B.sel]; PB.mutate(m => ids.forEach(i => PB.S.clips[i] && m.remove(i))); PB.toast('removed ' + ids.length + ' · ⌘Z undoes'); return; }
      if (ev.key === 'n' && !mod) { const p = B.nextPos(); const id = PB.mutate(m => m.place({ kind: 'note', text: '', x: p.x, y: p.y, w: 200, h: 120 })); B.select([id]); setTimeout(() => { const n = wins[id] && wins[id].el.querySelector('.notetext'); n && n.focus(); }, 0); }
      if (ev.key === 'm' && !mod) B.toggleMinimap();
      if (ev.key === '0' && mod) { ev.preventDefault(); B.view = { x: 40, y: 40, z: 1 }; B.applyView(); }
      if (ev.key === 'Tab' && B.sel.size === 1) { ev.preventDefault(); const id = [...B.sel][0]; PB.quiet('clips', id, { side: !PB.S.clips[id].side }); B.renderClip(id); }
    });
  }

  // ---------- filter / search ----------
  B.filter = function (o = {}) { B.filterTag = o.tag || null; B.q = o.q || ''; const f = document.getElementById('filter'); if (f && f.value !== B.q) f.value = B.q; const fb = document.getElementById('filterbar'); fb.innerHTML = ''; if (B.filterTag) { const x = el('button', 'btn sm', 'tag ' + B.filterTag + ' ×'); x.addEventListener('click', () => B.filter({ q: B.q })); fb.append(x); } B.renderAll(); };

  // ---------- pins column ----------
  B.layoutPins = function () { const n = $pins.children.length; $pins.classList.toggle('empty', !n); [...$pins.children].forEach(ch => { ch.style.flex = '1 1 0'; }); };

  // ---------- dock & quicklaunch ----------
  B.renderDock = function () {
    $dock.innerHTML = '';
    const apps = Object.values(PB.S.apps).filter(a => !a.hidden).sort((a, b) => (a.order || 99) - (b.order || 99) || a.name.localeCompare(b.name));
    apps.forEach(a => { const b = el('button', 'dk'); b.append(el('span', 'ic', a.icon || '△'), el('span', 'nm', a.title || a.name)); b.title = (a.about || a.title || a.name) + (a.shortcut ? ' · ' + a.shortcut : ''); b.addEventListener('click', () => PB.apps.open(a.name, { place: true })); b.addEventListener('contextmenu', ev => { ev.preventDefault(); PB.apps.edit(a.name); }); $dock.append(b); });
    $dock.append(el('span', 'dksep'));
    const nb = el('button', 'dk'); nb.append(el('span', 'ic', '+'), el('span', 'nm', 'new app')); nb.addEventListener('click', () => PB.apps.edit(null)); $dock.append(nb);
    const nn = el('button', 'dk'); nn.append(el('span', 'ic', '■'), el('span', 'nm', 'note')); nn.title = 'n'; nn.addEventListener('click', () => B.placeOrNext({ w: 200, h: 120 }, p => { const id = PB.mutate(m => m.place({ kind: 'note', text: '', x: p.x, y: p.y, w: 200, h: 120 })); B.select([id]); })); $dock.append(nn);
    const k = el('button', 'dk'); k.append(el('span', 'ic', '⌘K'), el('span', 'nm', 'launch')); k.addEventListener('click', () => B.quicklaunch()); $dock.append(k);
  };
  B.quicklaunch = function (prefill = '') {
    const ql = document.getElementById('ql'); ql.classList.add('open'); const inp = ql.querySelector('input'); inp.value = prefill; inp.focus(); B.qlRender();
  };
  B.quicklaunchClose = () => { document.getElementById('ql').classList.remove('open'); };
  B.qlRender = function () {
    const ql = document.getElementById('ql'); const q = ql.querySelector('input').value.trim().toLowerCase(); const list = ql.querySelector('.qllist'); list.innerHTML = '';
    const items = [];
    Object.values(PB.S.apps).forEach(a => items.push({ t: 'app', icon: a.icon || '△', label: a.title || a.name, sub: 'app · ' + (a.about || a.shortcut || ''), run: () => PB.apps.open(a.name, { place: true }), s: (a.name + ' ' + (a.title || '')).toLowerCase() }));
    Object.values(PB.S.clips).filter(c => c.kind !== 'app').forEach(c => items.push({ t: 'clip', icon: GLYPH[c.kind], label: c.title || (c.text || c.url || c.kind).slice(0, 50), sub: c.kind + ' · ' + (c.tags || []).join(', '), run: () => B.focus(c.id), s: ((c.title || '') + ' ' + (c.text || '') + ' ' + (c.url || '') + ' ' + (c.tags || []).join(' ')).toLowerCase() }));
    Object.values(PB.S.collections).forEach(cl => items.push({ t: 'coll', icon: '▤', label: cl.name, sub: 'collection · ' + Object.values(PB.S.records).filter(r => r.coll === cl.name).length + ' rows', run: () => B.openCollection(cl.name), s: cl.name }));
    items.push({ t: 'act', icon: '+', label: 'new app', sub: 'open the editor with a template', run: () => PB.apps.edit(null), s: 'new app editor' });
    items.push({ t: 'act', icon: '■', label: 'new note', sub: 'n', run: () => B.placeOrNext({ w: 200, h: 120 }, p => { const id = PB.mutate(m => m.place({ kind: 'note', text: '', x: p.x, y: p.y, w: 200, h: 120 })); B.select([id]); }), s: 'new note' });
    items.push({ t: 'act', icon: '◎', label: 'ask the agent', sub: 'open the panel', run: () => PB.agent.toggle(true), s: 'agent ask' });
    const hits = items.filter(i => !q || i.s.includes(q)).slice(0, 14);
    hits.forEach((h, i) => { const r = el('div', 'qlrow' + (i === 0 ? ' on' : '')); r.append(el('span', 'ic', h.icon), el('span', 'lb', h.label), el('span', 'sb', h.sub)); r.addEventListener('click', () => { B.quicklaunchClose(); h.run(); }); list.append(r); });
    if (!hits.length) list.append(el('div', 'empty padded', 'nothing matches · Enter asks the agent'));
    list._hits = hits;
  };
  function bindQL() {
    const ql = document.getElementById('ql'); const inp = ql.querySelector('input'); const list = ql.querySelector('.qllist');
    inp.addEventListener('input', B.qlRender);
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); const rows = [...list.querySelectorAll('.qlrow')]; let i = rows.findIndex(r => r.classList.contains('on')); if (ev.key === 'ArrowDown') { ev.preventDefault(); rows[i] && rows[i].classList.remove('on'); rows[(i + 1) % rows.length] && rows[(i + 1) % rows.length].classList.add('on'); } if (ev.key === 'ArrowUp') { ev.preventDefault(); rows[i] && rows[i].classList.remove('on'); rows[(i - 1 + rows.length) % rows.length] && rows[(i - 1 + rows.length) % rows.length].classList.add('on'); } if (ev.key === 'Enter') { ev.preventDefault(); const h = list._hits[Math.max(0, rows.findIndex(r => r.classList.contains('on')))]; B.quicklaunchClose(); if (h) h.run(); else if (inp.value.trim()) { PB.agent.toggle(true); PB.agent.prefill(inp.value.trim()); } } if (ev.key === 'Escape') B.quicklaunchClose(); });
    ql.addEventListener('click', ev => { if (ev.target === ql) B.quicklaunchClose(); });
  }
  B.openCollection = function (name) { const existing = Object.values(PB.S.clips).find(c => c.kind === 'app' && c.app === 'collections'); if (existing) { PB.setState(existing.id, { coll: name }); B.focus(existing.id); } else PB.apps.open('collections', { state: { coll: name } }); };

  // ---------- placement (twm style): an outline follows the cursor, click places it ----------
  B.placeMode = true;
  let placing = null;
  B.pickPlace = function (size, cb, label) {
    B.cancelPlace();
    const g = el('div', 'placeghost'); g.style.width = size.w + 'px'; g.style.height = size.h + 'px'; g.append(el('span', 'small', label || 'click to place · Esc cancels'));
    $canvas.append(g); $wrap.classList.add('placing');
    const at = (ev) => { const w = B.toWorld(ev.clientX, ev.clientY); const x = snap(w.x - 20), y = snap(w.y - 14); g.style.left = x + 'px'; g.style.top = y + 'px'; placing.pos = { x, y }; };
    placing = { g, cb, pos: B.nextPos() };
    g.style.left = placing.pos.x + 'px'; g.style.top = placing.pos.y + 'px';
    const move = ev => at(ev);
    const click = ev => { if (ev.target.closest('#dock, #agentpanel, #pins, .bar, #ql, .cmenu')) return; ev.preventDefault(); ev.stopPropagation(); const pos = placing.pos; B.cancelPlace(); cb(pos); };
    const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); B.cancelPlace(); PB.toast('placement cancelled'); } };
    placing.off = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerdown', click, true); document.removeEventListener('keydown', key, true); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerdown', click, true); document.addEventListener('keydown', key, true);
  };
  B.cancelPlace = () => { if (!placing) return; placing.off(); placing.g.remove(); placing = null; $wrap.classList.remove('placing'); };
  B.placeOrNext = (size, cb) => { if (B.placeMode) B.pickPlace(size, cb); else cb(B.nextPos()); };

  // ---------- minimap ----------
  B.minimap = { on: false, el: null, cv: null };
  B.toggleMinimap = function (on) { const mm = B.minimap; mm.on = on === undefined ? !mm.on : !!on; mm.el.classList.toggle('on', mm.on); PB.meta('minimap', mm.on); document.getElementById('mapbtn').classList.toggle('on', mm.on); B.drawMinimap(); };
  B.drawMinimap = function () {
    const mm = B.minimap; if (!mm.on || !mm.cv) return;
    const cv = mm.cv, g = cv.getContext('2d'); const W = cv.width, H = cv.height; const cs = getComputedStyle(document.documentElement);
    const clips = Object.values(PB.S.clips).filter(c => visible(c) && !c.pinned);
    const r = $wrap.getBoundingClientRect(); const vx = -B.view.x / B.view.z, vy = -B.view.y / B.view.z, vw = r.width / B.view.z, vh = r.height / B.view.z;
    let x0 = vx, y0 = vy, x1 = vx + vw, y1 = vy + vh; clips.forEach(c => { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); });
    const pad = 80; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; const sc = Math.min(W / (x1 - x0), H / (y1 - y0)); const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    mm.map = { x0, y0, sc, ox, oy };
    g.clearRect(0, 0, W, H); g.fillStyle = cs.getPropertyValue('--bg').trim(); g.fillRect(0, 0, W, H);
    const ink = cs.getPropertyValue('--ink').trim(), hair = cs.getPropertyValue('--hair').trim(), acc = cs.getPropertyValue('--accent').trim(), fill = cs.getPropertyValue('--fill-2').trim();
    clips.forEach(c => { const x = ox + (c.x - x0) * sc, y = oy + (c.y - y0) * sc, w = Math.max(2, c.w * sc), h = Math.max(2, c.h * sc); g.fillStyle = c.kind === 'app' ? fill : cs.getPropertyValue('--bg').trim(); g.fillRect(x, y, w, h); g.strokeStyle = B.sel.has(c.id) ? acc : ink; g.lineWidth = 1; g.strokeRect(Math.round(x) + .5, Math.round(y) + .5, Math.round(w), Math.round(h)); });
    g.setLineDash([3, 2]); g.strokeStyle = acc; g.strokeRect(Math.round(ox + (vx - x0) * sc) + .5, Math.round(oy + (vy - y0) * sc) + .5, Math.round(vw * sc), Math.round(vh * sc)); g.setLineDash([]);
    g.strokeStyle = hair; g.strokeRect(.5, .5, W - 1, H - 1);
  };
  function bindMinimap() {
    const mm = B.minimap; mm.el = document.getElementById('minimap'); mm.cv = mm.el.querySelector('canvas');
    const go = (ev) => { const m = mm.map; if (!m) return; const rc = mm.cv.getBoundingClientRect(); const wx = m.x0 + (ev.clientX - rc.left - m.ox) / m.sc, wy = m.y0 + (ev.clientY - rc.top - m.oy) / m.sc; const r = $wrap.getBoundingClientRect(); B.view.x = r.width / 2 - wx * B.view.z; B.view.y = r.height / 2 - wy * B.view.z; B.applyView(); B.drawMinimap(); };
    let down = false; mm.cv.addEventListener('pointerdown', ev => { down = true; go(ev); ev.stopPropagation(); }); document.addEventListener('pointermove', ev => { if (down) go(ev); }); document.addEventListener('pointerup', () => down = false);
    mm.el.querySelector('.ib').addEventListener('click', () => B.toggleMinimap(false));
    document.getElementById('mapbtn').addEventListener('click', () => B.toggleMinimap());
    B.toggleMinimap(PB.meta('minimap') === true);
    const ro = new ResizeObserver(() => B.drawMinimap()); ro.observe($wrap);
  }

  // ---------- context menus ----------
  PB.menus = { canvas: [], clip: [], app: {} };   // target → items; items: { label, run(c), when?(c), hint?, sep? } or '-'
  let $menu = null;
  PB.menu = {
    show(x, y, items, ctx) {
      PB.menu.hide();
      const list = items.filter(Boolean).map(it => typeof it === 'function' ? it(ctx) : it).flat().filter(Boolean);
      const m = el('div', 'cmenu'); let lastSep = true;
      list.forEach(it => {
        if (it === '-' || it.sep) { if (!lastSep) m.append(el('hr', 'sep')); lastSep = true; return; }
        if (it.when && !safe(() => it.when(ctx), false)) return;
        const label = typeof it.label === 'function' ? safe(() => it.label(ctx), '?') : it.label;
        const row = el('button', 'mi' + (it.disabled ? ' off' : ''), el('span', 'ml', label)); if (it.hint) row.append(el('span', 'mh', typeof it.hint === 'function' ? safe(() => it.hint(ctx), '') : it.hint));
        if (it.disabled) row.disabled = true;
        row.addEventListener('click', ev => { ev.stopPropagation(); PB.menu.hide(); try { const r = it.run && it.run(ctx, ev); if (r && r.then) r.catch(e => PB.toast('⚠ ' + e.message)); } catch (e) { PB.toast('⚠ ' + e.message); console.error(e); } });
        m.append(row); lastSep = false;
      });
      if (lastSep && m.lastChild) m.lastChild.remove();
      if (!m.children.length) return;
      document.body.append(m); $menu = m;
      const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
      setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
    },
    hide() { if ($menu) { $menu.remove(); $menu = null; document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); } },
    register(target, items) {   // 'canvas' | 'clip' | 'clip:<kind>' | 'app:<name>'
      if (!Array.isArray(items)) throw new Error('board.menu(target, items): items is an array of { label, run(c), when?, hint? } or "-"');
      let host; if (target === 'canvas') host = PB.menus.canvas; else if (target === 'clip' || target.startsWith('clip:')) host = PB.menus[target] = PB.menus[target] || []; else if (target.startsWith('app:')) host = PB.menus.app[target.slice(4)] = PB.menus.app[target.slice(4)] || []; else throw new Error('board.menu: target is canvas, clip, clip:<kind> or app:<name>; got ' + target);
      items.forEach(it => { const i = host.findIndex(x => x && x.label === it.label && x.label); if (i >= 0) host.splice(i, 1); host.push(it); });
      return host.length;
    },
    items(target) { return target === 'canvas' ? PB.menus.canvas : target.startsWith('app:') ? (PB.menus.app[target.slice(4)] || []) : (PB.menus[target] || []); },
  };
  function safe(fn, dflt) { try { return fn(); } catch (e) { console.warn(e); return dflt; } }
  function onDown(ev) { if ($menu && !$menu.contains(ev.target)) PB.menu.hide(); }
  function onKey(ev) { if (ev.key === 'Escape') { PB.menu.hide(); ev.stopPropagation(); } }
  const K = (label, run, extra = {}) => Object.assign({ label, run }, extra);
  function clipMenu(c) {
    const ids = B.sel.has(c.id) ? [...B.sel] : [c.id]; const many = ids.length > 1;
    const colls = Object.keys(PB.S.collections);
    const items = [
      K(many ? 'rename ' + ids.length + ' clips' : 'rename', () => { const t = prompt('title', c.title || ''); if (t != null) PB.mutate(m => ids.forEach(i => m.retitle(i, t))); }, { hint: 'dbl-click' }),
      K('tags…', () => { const t = prompt('tags, comma separated', (c.tags || []).join(', ')); if (t != null) PB.mutate(m => ids.forEach(i => m.setAttr(i, { tags: t.split(/\s*,\s*/).filter(Boolean) }))); }),
      K(c.side ? 'hide properties' : 'properties', () => { PB.quiet('clips', c.id, { side: !c.side }); B.renderClip(c.id); }, { hint: 'Tab' }),
      '-',
      K('duplicate', () => B.duplicate(ids), { hint: '⌘D' }),
      K('group', () => PB.mutate(m => m.group(ids)), { when: () => many, hint: '⌘G' }),
      K('ungroup', () => PB.mutate(m => m.ungroup(c.id)), { when: () => c.kind === 'group', hint: '⌘⇧G' }),
      K(c.pinned ? 'unpin' : 'pin to the side', () => PB.mutate(m => ids.forEach(i => m.pin(i, !c.pinned))), { hint: '⌘P' }),
      K('bring to front', () => ids.forEach(i => B.front(i))),
      '-',
      c.kind !== 'app' && c.kind !== 'group' && !c.binding ? { label: 'promote to…', run: () => { const n = prompt('collection' + (colls.length ? ' (' + colls.join(', ') + ')' : ''), colls[0] || ''); if (n) PB.mutate(m => ids.forEach(i => !PB.S.clips[i].binding && m.promote(i, n))); } } : null,
      c.binding ? K('open its collection', () => B.openCollection(c.binding.coll)) : null,
      c.kind === 'app' ? K('edit app source', () => PB.apps.edit(c.app)) : null,
      c.kind === 'app' ? K('reset app state', () => PB.mutate(m => m.setAttr(c.id, { state: PB.clone((PB.apps.def(c.app) || {}).state || {}) }))) : null,
      K('copy', () => { const data = B.exportJSON(ids); navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(data)).then(() => PB.toast('copied ' + ids.length), () => PB.toast('⚠ clipboard refused; use ⌘C')); }, { hint: '⌘C' }),
      K('ask the agent about this', () => { B.select(ids); PB.agent.prefill(ids.join(', ') + ': '); }),
      '-',
      ...PB.menu.items('clip'), ...PB.menu.items('clip:' + c.kind), ...(c.kind === 'app' ? [...PB.menu.items('app:' + c.app), ...(((PB.apps.def(c.app) || {}).menu) || [])] : []),
      '-',
      K(many ? 'remove ' + ids.length + ' clips' : 'remove', () => { PB.mutate(m => ids.forEach(i => PB.S.clips[i] && m.remove(i))); PB.toast('removed · ⌘Z undoes'); }, { hint: '⌫' }),
    ];
    return items;
  }
  function canvasMenu(pos) {
    return [
      K('new note here', () => { const id = PB.mutate(m => m.place({ kind: 'note', text: '', x: pos.x, y: pos.y, w: 200, h: 120 })); B.select([id]); setTimeout(() => { const n = wins[id] && wins[id].el.querySelector('.notetext'); n && n.focus(); }, 0); }, { hint: 'n' }),
      K('paste here', async () => { try { const items = await navigator.clipboard.read(); for (const it of items) { const type = it.types.find(t => t.startsWith('image/')) || (it.types.includes('text/plain') ? 'text/plain' : null); if (!type) continue; const blob = await it.getType(type); if (type.startsWith('image/')) { const f = new File([blob], 'pasted.png', { type }); await PB.clipFromItem({ kind: 'clip:image', files: [f], image: f, origin: 'clipboard' }, pos); } else { const text = await blob.text(); if (text.startsWith('{"pinboard":1')) await B.importJSON(JSON.parse(text), pos); else await PB.clipFromItem({ kind: PB.isURL(text) ? 'clip:link' : 'clip:note', url: PB.isURL(text) ? text.trim() : undefined, text, origin: 'clipboard' }, pos); } } } catch (e) { PB.toast('⚠ the browser refused clipboard access; press ⌘V instead'); } }, { hint: '⌘V' }),
      K('open app…', () => B.quicklaunch(), { hint: '⌘K' }),
      '-',
      K('select all', () => B.select(Object.keys(PB.S.clips).filter(i => visible(PB.S.clips[i]))), { hint: '⌘A' }),
      K('reset zoom', () => { B.view = { x: 40, y: 40, z: 1 }; B.applyView(); B.drawMinimap(); }, { hint: '⌘0' }),
      K(() => (B.minimap.on ? 'hide' : 'show') + ' minimap', () => B.toggleMinimap(), { hint: 'm' }),
      K(() => (B.placeMode ? 'disable' : 'enable') + ' click-to-place for new windows', () => { B.placeMode = !B.placeMode; PB.meta('placeMode', B.placeMode); PB.toast('click-to-place ' + (B.placeMode ? 'on' : 'off')); }),
      K(() => (PB.agent.open ? 'hide' : 'show') + ' the agent', () => PB.agent.toggle()),
      '-',
      ...PB.menu.items('canvas'),
    ];
  }
  function bindMenus() {
    document.addEventListener('contextmenu', ev => {
      if (ev.target.closest('#agentpanel, .bar, #ql, textarea, input')) return;
      const nodeEl = ev.target.closest('[data-menu]'); const clipEl = ev.target.closest('.clip');
      if (nodeEl && clipEl) { const spec = PB.nodeMenus.get(nodeEl); if (spec) { ev.preventDefault(); const c = PB.S.clips[clipEl.dataset.id]; PB.menu.show(ev.clientX, ev.clientY, [...spec.items, '-', ...clipMenu(c)], spec.ctx); return; } }
      if (clipEl) { if (ev.target.closest('.notetext, [contenteditable], .docedit')) return; ev.preventDefault(); const c = PB.S.clips[clipEl.dataset.id]; if (!c) return; if (!B.sel.has(c.id)) B.select([c.id]); PB.menu.show(ev.clientX, ev.clientY, clipMenu(c), PB.makeCtx(c)); return; }
      if (ev.target === $wrap || ev.target === $canvas) { ev.preventDefault(); const w = B.toWorld(ev.clientX, ev.clientY); PB.menu.show(ev.clientX, ev.clientY, canvasMenu({ x: snap(w.x), y: snap(w.y) }), { board: PB.boardAPI, pos: { x: snap(w.x), y: snap(w.y) } }); }
    });
  }
  PB.nodeMenus = new WeakMap();

  // ---------- public API (apps and the agent use this) ----------
  function placer(id) {
    const p = { id, at: (x, y) => (PB.mutate(m => m.move(id, { x, y }), PB.actor, { coalesce: 'place:' + id }), p), near: (win) => { const w = typeof win === 'string' ? PB.S.clips[win] : win && win.id ? PB.S.clips[win.id] : null; const pos = B.nextPos(w); PB.mutate(m => m.move(id, pos), PB.actor, { coalesce: 'place:' + id }); return p; }, tag: (...t) => (PB.mutate(m => m.tag(id, ...t), PB.actor, { coalesce: 'place:' + id }), p), title: (t) => (PB.mutate(m => m.retitle(id, t), PB.actor, { coalesce: 'place:' + id }), p), pin: () => (PB.mutate(m => m.pin(id, true), PB.actor), p), get clip() { return PB.S.clips[id]; }, toYAML: () => PB.toYAML(PB.describeClip(PB.S.clips[id])) };
    return p;
  }
  PB.boardAPI = {
    clip(x, opts = {}) {
      let spec;
      if (typeof x === 'string') { const c = PB.S.clips[x]; if (!c) throw new Error('no clip ' + x); const p = placer(x); p.promote = (coll, fn) => PB.mutate(m => m.promote(x, coll, fn), PB.actor); p.remove = () => PB.mutate(m => m.remove(x), PB.actor); p.set = (patch) => PB.mutate(m => m.setAttr(x, patch), PB.actor); p.demote = () => PB.mutate(m => m.demote(x), PB.actor); return p; }
      if (x && x._isBuilder) {
        const p = x.props; const k = x.kind;
        if (k === 'note' || k === 'text') spec = { kind: 'note', text: String(typeof p.value === 'function' ? '' : p.value || ''), w: 200, h: 120 };
        else if (k === 'link') spec = { kind: 'link', url: String(p.url), title: p.title || '', w: 260, h: 110 };
        else if (k === 'doc') spec = { kind: 'doc', md: String(p.value || ''), w: 340, h: 300 };
        else if (k === 'image') { const src = p.src; spec = { kind: 'image', blobId: typeof src === 'string' && PB.blobs[src] ? src : null, url: typeof src === 'string' && !PB.blobs[src] ? src : null, w: 260, h: 220 }; if (!spec.blobId && !spec.url) throw new Error('ui.image(src) on the board needs a blob id (blob:…) or a URL'); }
        else throw new Error('board.clip(builder): a ' + k + ' cannot be a clip by itself; clips are note, link, doc, image. Put a custom view in an app: app(name).view(…).register(), then board.open(name).');
        if (x.attrs && x.attrs.tags) spec.tags = x.attrs.tags.slice();
        if (p.title && typeof p.title === 'string') spec.title = p.title;
      } else if (x && typeof x === 'object') spec = Object.assign({}, x);
      else throw new Error('board.clip(builder | spec | id)');
      const pos = opts.at || B.nextPos(); const id = PB.mutate(m => m.place(Object.assign({ x: pos.x, y: pos.y, source: { from: PB.actor === 'agent' ? 'agent' : 'api', at: Date.now() } }, spec, opts.tags ? { tags: opts.tags } : {})), PB.actor);
      return placer(id);
    },
    clips: (f) => { PB.track && PB.track('clips'); const all = Object.values(PB.S.clips); return f ? all.filter(f) : all; },
    get: (id) => PB.S.clips[id],
    selection: () => { PB.track && PB.track('selection'); return [...B.sel].map(i => PB.S.clips[i]).filter(Boolean); },
    select: (ids) => B.select([].concat(ids)),
    find: (q) => Object.values(PB.S.clips).filter(c => PB.match(c, q)),
    focus: (id) => B.focus(id),
    filter: (o) => B.filter(o),
    open: (name, opts) => PB.apps.open(name, opts),
    openCollection: (n) => B.openCollection(n),
    apps: () => Object.values(PB.S.apps),
    toast: (m) => PB.toast(m),
    putBlob: (b) => PB.putBlob(b), imageDims: (b) => imageDims(b), blobURL: (id) => PB.blobURL(id),
    mutate: (fn) => PB.mutate(fn, PB.actor),
    undo: () => PB.undo(), redo: () => PB.redo(),
    history: () => PB.history.txs.slice(Math.max(0, PB.history.idx - 20), PB.history.idx).map(t => PB.clock(t.at) + ' ' + t.by + ' ' + t.label),
    describe: (o) => PB.describe(o),
    view: () => B.view,
    quicklaunch: (q) => B.quicklaunch(q),
    menu: (target, items) => PB.menu.register(target, items),
    pickPlace: (size) => new Promise(res => B.pickPlace(size, res)),
    minimap: (on) => B.toggleMinimap(on),
    export: (ids) => B.exportJSON(ids || Object.keys(PB.S.clips)),
    import: (data) => B.importJSON(data, B.nextPos()),
    toYAML: () => PB.describe({ clips: true }),
  };
  PB.describeClip = function (c) {
    if (!c) return null;
    const o = { id: c.id, kind: c.kind, title: c.title || '' };
    if (c.kind === 'note') o.text = (c.text || '').slice(0, 300);
    if (c.kind === 'link') { o.url = c.url; if (c.desc) o.desc = c.desc.slice(0, 200); }
    if (c.kind === 'doc') o.text = (c.md || '').slice(0, 400) + ((c.md || '').length > 400 ? '…' : '');
    if (c.kind === 'image') { o.image = (c.dims ? c.dims.w + '×' + c.dims.h : '') + ' ' + (c.mime || ''); if (c.caption) o.caption = c.caption; o.see = 'select it and send, or say "look at ' + c.id + '"'; }
    if (c.kind === 'app') { o.app = c.app; o.state = c.state; o.params = c.params; }
    if (c.kind === 'group') o.children = c.children;
    if (c.tags && c.tags.length) o.tags = c.tags; if (c.note) o.note = c.note.slice(0, 200); if (c.binding) o.binding = c.binding.coll + '/' + c.binding.id; if (c.pinned) o.pinned = true; if (c.group) o.inGroup = c.group;
    o.at = [c.x, c.y]; o.size = [c.w, c.h];
    return o;
  };
  PB.describe = function (o = {}) {
    const clips = Object.values(PB.S.clips); const sel = [...B.sel];
    const out = {
      board: { clips: clips.length, groups: clips.filter(c => c.kind === 'group').length, apps: Object.keys(PB.S.apps).length, collections: Object.keys(PB.S.collections).length, zoom: Math.round(B.view.z * 100) / 100, filter: B.filterTag || B.q || null, history: PB.history.idx + ' transactions' },
      selection: sel.map(i => PB.describeClip(PB.S.clips[i])),
    };
    if (o.clips !== false) { const list = clips.filter(c => !sel.includes(c.id)).sort((a, b) => (b.z || 0) - (a.z || 0)); out.clips = list.slice(0, o.max || 60).map(PB.describeClip); if (list.length > (o.max || 60)) out.more = (list.length - (o.max || 60)) + ' more clips not listed; use board.clips() or board.find(q)'; }
    if (o.apps !== false) out.apps = Object.values(PB.S.apps).map(a => ({ name: a.name, icon: a.icon, title: a.title, about: a.about, params: (PB.apps.def(a.name) || {}).params ? PB.apps.def(a.name).params.map(p => p.name + ':' + p.type) : [], windows: clips.filter(c => c.kind === 'app' && c.app === a.name).map(c => c.id), describe: (() => { try { const d = PB.apps.def(a.name); const w = clips.find(c => c.kind === 'app' && c.app === a.name); return d && d.agentDescribe && w ? d.agentDescribe(PB.makeCtx(w)) : undefined; } catch (e) { return 'describe failed: ' + e.message; } })() }));
    if (o.collections !== false) out.collections = Object.values(PB.S.collections).map(c => ({ name: c.name, fields: (c.fields || []).map(f => f.name + ':' + f.type + (f.required ? '!' : '')), rows: Object.values(PB.S.records).filter(r => r.coll === c.name).length, sample: Object.values(PB.S.records).filter(r => r.coll === c.name).slice(0, 2).map(r => { const x = Object.assign({}, r); delete x.coll; return x; }) }));
    return out;
  };

  // ---------- toast ----------
  PB.toast = function (msg, kind) { const t = el('div', 'toast' + (kind ? ' ' + kind : '') + (String(msg).startsWith('⚠') ? ' err' : ''), String(msg)); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), kind === 'long' ? 8000 : 3200); };

  // ---------- boot ----------
  B.init = function () {
    $wrap = document.getElementById('boardwrap'); $canvas = document.getElementById('canvas'); $pins = document.getElementById('pins'); $dock = document.getElementById('dock'); $marq = document.getElementById('marquee');
    B.view = Object.assign({ x: 40, y: 40, z: 1 }, PB.meta('view') || {}); B.applyView();
    bindCanvas(); bindClipboard(); bindKeys(); bindQL(); bindMenus(); bindMinimap(); B.placeMode = PB.meta('placeMode') !== false;
    const f = document.getElementById('filter'); f.addEventListener('input', () => B.filter({ q: f.value, tag: B.filterTag })); f.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Escape') { f.value = ''; B.filter({}); f.blur(); } });
    PB.on('mutation', (tx, keys) => B.onChange(keys, tx));
    PB.on('change', keys => B.onChange(keys));
    B.renderAll(); B.renderDock();
  };
  B.onChange = function (keys, tx) {
    let dockDirty = false, allDirty = false;
    for (const k of keys) { if (k === 'apps' || k.startsWith('apps:')) dockDirty = true; if (k === 'clips') allDirty = true; }
    if (dockDirty) B.renderDock();
    const touched = new Set();
    for (const k of keys) { if (k.startsWith('clips:')) touched.add(k.slice(6)); }
    // app windows whose deps intersect
    Object.keys(wins).forEach(id => { const w = wins[id]; if (touched.has(id)) return; const c = PB.S.clips[id]; if (!c) return; if (!w.deps) return; for (const k of keys) { if (w.deps.has(k) || (k.startsWith('coll:') && w.deps.has(k)) || (k === 'records' && [...w.deps].some(d => d.startsWith('coll:'))) || (k === 'clips' && w.deps.has('clips')) || (k === 'selection' && w.deps.has('selection'))) { touched.add(id); break; } } });
    if (allDirty) B.renderAll(); else touched.forEach(id => B.renderClip(id));
    // groups containing touched clips
    touched.forEach(id => { const c = PB.S.clips[id]; if (c && c.group && PB.S.clips[c.group]) B.renderClip(c.group); });
    $pins.classList.toggle('empty', !$pins.children.length);
    B.layoutPins(); B.drawMinimap();
  };
  PB.on('selection', ids => { B.drawMinimap(); Object.keys(wins).forEach(id => { const w = wins[id]; if (w.deps && w.deps.has('selection')) B.renderClip(id); }); });
})(window.PB);
