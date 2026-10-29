// ---------- Claude inside the page (sample) ----------
const SAMPLE = { fn: null, ctrl: null, history: [], busy: false };
async function initSample() {
  const s = await cap('sample');
  SAMPLE.fn = s || null;
  updateAskUI();
  DIRTY.chrome = true; scheduleRender();
}
function updateAskUI() {
  const ask = $('#ask'); if (!ask) return;
  const show = (!!SAMPLE.fn && S.canEdit) || canSend();
  ask.hidden = !show;
  $('#askGo').hidden = !(SAMPLE.fn && S.canEdit);
  $('#askChat').hidden = !canSend();
  const narrow = innerWidth < 600;
  $('#askIn').placeholder = SAMPLE.fn && S.canEdit ? (narrow ? 'Ask Claude…' : 'Ask Claude to design or change something…') : (narrow ? 'Note for Claude…' : 'Add a note and send the selection to Claude in the chat…');
}
function focusAsk() { const a = $('#ask'); if (a.hidden) { toast('Claude is not available in this view.'); return; } a.classList.remove('min'); $('#askIn').focus(); }
function renderAskScope() {
  const sc = $('#askScope'); if (!sc) return;
  sc.textContent = '';
  const sel = selRoots();
  sc.append(h('span', { text: sel.length ? 'About:' : 'On:' }), h('b', { text: sel.length ? sel.slice(0, 3).map(id => get(id).name).join(', ') + (sel.length > 3 ? ` +${sel.length - 3}` : '') : pageName(S.pageId) }));
  if (!SAMPLE.busy && S.canEdit && SAMPLE.fn) {
    const sug = sel.length ? (get(sel[0]).type === 'frame' && !get(sel[0]).parent ? ['Make a dark version', 'Critique this screen', 'Add an empty state'] : ['Tighten the spacing', 'Make this a component', 'Try 3 variations']) : roots().length ? ['Add a settings screen', 'Critique the flow'] : ['Design a sign-up screen', 'Design a pricing page'];
    for (const s of sug) sc.append(h('button', { class: 'chip', text: s, onclick: () => { $('#askIn').value = s; runAsk(); } }));
  }
}
function compactNode(n, depth, out = []) {
  const o = { id: n.id, type: n.type, name: n.name };
  if (n.component) o.component = true;
  if (n.type === 'instance') { o.of = n.of; o.mainName = (get(n.of) || {}).name; if (Object.keys(n.ov || {}).length) o.ov = n.ov; }
  const r = elOf(n.id) ? lrect(n.id) : n;
  o.box = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)];
  if (n.sw !== 'fixed' || n.sh !== 'fixed') o.sizing = [n.sw, n.sh];
  if (n.layout) o.layout = n.layout;
  if (n.abs) o.abs = true;
  if (n.type === 'text') Object.assign(o, { text: n.text.slice(0, 400), font: n.font, size: n.size, weight: n.weight, lh: n.lh, ls: n.ls || undefined, talign: n.talign !== 'left' ? n.talign : undefined, tstyle: n.tstyle || undefined });
  if (n.type === 'icon') o.icon = n.icon;
  const fills = (n.fills || []).map(f => f.t === 'image' ? { t: 'image', fit: f.fit } : f);
  if (fills.length && n.type !== 'instance') o.fills = fills;
  if (n.stroke) o.stroke = n.stroke;
  if (n.radius) o.radius = n.radius;
  if (n.effects && n.effects.length) o.effects = n.effects;
  if (n.opacity < 1) o.opacity = n.opacity;
  if (!n.visible) o.visible = false;
  if (n.mode) o.mode = n.mode;
  if (n.link) o.link = n.link;
  if (n.flow) o.flow = n.flow;
  if (n.type === 'frame') { const ks = kids(n.id); if (depth > 0) o.children = ks.map(k => compactNode(k, depth - 1)); else if (ks.length) o.childCount = ks.length; }
  return o;
}
function fileContext() {
  return {
    file: S.file.name, pages: S.file.pages.map(p => ({ id: p.id, name: p.name, current: p.id === S.pageId || undefined })),
    screens: roots().map(n => ({ id: n.id, name: n.name, type: n.type, w: Math.round((wrect(n.id) || n).w), h: Math.round((wrect(n.id) || n).h), mode: n.mode || undefined, flow: n.flow || undefined, component: n.component || undefined })),
    colorTokens: Object.fromEntries(Object.entries(S.file.tokens.colors).map(([id, t]) => [id, t])),
    textStyles: S.file.tokens.type,
    components: components().map(c => ({ id: c.id, name: c.name, page: c.page, w: Math.round(c.w), h: Math.round(c.h), texts: descendants(c.id).filter(d => d.type === 'text').map(d => d.name) })),
    selection: selRoots().map(id => compactNode(get(id), 2)),
    openFeedback: [...FB.items.values()].filter(isOpen).sort((a, b) => a.n - b.n).slice(0, 40).map(fbBrief),
  };
}
const ALLOWED_KEYS = new Set(['name', 'x', 'y', 'w', 'h', 'rot', 'visible', 'locked', 'opacity', 'fills', 'stroke', 'radius', 'effects', 'clip', 'mode', 'layout', 'sw', 'sh', 'abs', 'text', 'font', 'size', 'weight', 'lh', 'ls', 'talign', 'italic', 'deco', 'tcase', 'tstyle', 'icon', 'iw', 'link', 'flow', 'ov', 'parent', 'z', 'component']);
function claudeTools() {
  return [
    { name: 'get_file', description: 'Overview of the Pinup file: pages, screens on the current page, colour tokens, text styles, components, and the user\'s current selection (as compact layer trees).', inputSchema: { type: 'object', properties: {} }, execute: () => fileContext() },
    { name: 'get_nodes', description: 'Read layers as compact trees. box = [x, y, w, h] relative to the parent.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, depth: { type: 'number', description: 'child levels to include, default 3' } }, required: ['ids'] },
      execute: ({ ids, depth }) => (ids || []).slice(0, 20).map(id => get(id) ? compactNode(get(id), depth == null ? 3 : Math.min(8, depth)) : { id, missing: true }) },
    { name: 'write_html', description: 'Create layers from HTML with inline styles (or one <style> block). Flexbox becomes auto layout. Use data-name for layer names, <i data-icon="lucide-name" style="width:20px;height:20px;color:..."></i> for icons, data-instance="Component name" (with child data-name overrides) to place components, data-link="Screen name"|"back" for prototype links, var(--tk-<tokenId>) for token colours. Give the root an explicit width (390 phone, 1440 desktop) and height for full screens. Omit parent to add a new screen on the canvas; pass parent to insert into a frame; pass replace to swap an existing layer (keeps its id).',
      inputSchema: { type: 'object', properties: { html: { type: 'string' }, name: { type: 'string' }, parent: { type: 'string' }, replace: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['html'] },
      execute: async (a) => { const res = await importHTML(a.html, { parent: a.parent, replace: a.replace, name: a.name, x: a.x, y: a.y, label: 'Claude' }); if (!res) throw new Error('import failed'); requestAnimationFrame(() => { select(res.ids); }); return { created: res.ids, layers: res.count }; } },
    { name: 'update_nodes', description: 'Change properties of existing layers. Each update is {id, ...fields} using the Pinup node schema (fills [{t:"solid",c:"#hex"|"$token",o}], stroke {c,w,style}, radius, layout {dir,gap,pad:[t,r,b,l],align,justify}, sw/sh fixed|hug|fill, text, font, size, weight, lh, ls, talign, visible, opacity, link {to:frameId|"back", on:"click", tr, dur}, mode, parent, z, ov for instance overrides keyed by main-child id).',
      inputSchema: { type: 'object', properties: { updates: { type: 'array', items: { type: 'object' } } }, required: ['updates'] },
      execute: ({ updates }) => {
        const ch = []; const bad = [];
        for (const u of (updates || []).slice(0, 300)) {
          const n = get(u.id); if (!n) { bad.push(u.id); continue; }
          const p = {}; for (const k in u) if (ALLOWED_KEYS.has(k)) p[k] = u[k];
          if (p.icon && ICONS[p.icon]) p.svg = iconMarkup(p.icon);
          if (p.parent !== undefined && p.parent && !get(p.parent)) delete p.parent;
          ch.push({ id: n.id, after: Object.assign({}, n, p) });
        }
        commit(ch, { label: 'Claude' });
        return { updated: ch.length, missing: bad };
      } },
    { name: 'delete_nodes', description: 'Delete layers (and their children).', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      execute: ({ ids }) => { const ok = (ids || []).filter(id => get(id)); removeNodes(ok, 'Claude'); return { deleted: ok.length }; } },
    { name: 'set_tokens', description: 'Add or change colour tokens {id:{name, light, dark}} and text styles {id:{name, font, size, weight, lh, ls}}. Existing ids are replaced; others are kept.',
      inputSchema: { type: 'object', properties: { colors: { type: 'object' }, type: { type: 'object' } } },
      execute: ({ colors, type }) => { const t = clone(S.file.tokens); if (colors) for (const id in colors) { const c = colors[id]; const l = normHex(c.light), d = normHex(c.dark || c.light); if (l) t.colors[slug(id)] = { name: c.name || id, light: l, dark: d || l }; } if (type) for (const id in type) t.type[slug(id)] = Object.assign({ font: 'Inter', size: 16, weight: 400, lh: 1.4, ls: 0, name: id }, type[id]); setFile({ tokens: t }, { label: 'Claude' }); return { colors: Object.keys(t.colors), type: Object.keys(t.type) }; } },
    { name: 'make_component', description: 'Turn a frame into a main component (so it can be reused with data-instance).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] },
      execute: ({ id, name }) => { const n = get(id); if (!n || n.type !== 'frame') throw new Error('not a frame'); patch(id, { component: true, name: name || n.name }, { label: 'Claude' }); return { ok: true }; } },
  ];
}
const CLAUDE_BRIEF = `You are Claude, designing inside Pinup — a Figma-like design file the user shares with you and with collaborators. You make real, editable layers with the tools; never just describe a design.

How to work:
- Start with get_file unless the context below already answers your question.
- New screens or sections: write_html. Small changes (copy, colour, spacing, sizing, links): update_nodes. Swap a whole layer: write_html with replace.
- HTML for write_html: inline styles or one <style> block, no scripts, no Tailwind classes, no external images (use solid or gradient blocks as image placeholders). Use display:flex with gap and padding for anything stacked (it becomes auto layout). Root gets explicit width and height (phone 390×844, desktop 1440×1024). Name layers with data-name. Icons: <i data-icon="arrow-right" style="width:20px;height:20px;color:#111"></i> (Lucide names). Reuse existing components with data-instance="Exact component name" and override texts with child elements carrying the component's text layer data-name. Prototype: data-link="Screen name" or "back".
- Use the file's tokens: colours as var(--tk-<id>), and match its text styles' fonts and sizes. Fonts available from Google Fonts by name (Inter, Space Grotesk, Geist, Fraunces, DM Sans, IBM Plex Sans, …).
- Design quality: real content (no lorem ipsum), clear hierarchy, consistent 4/8px spacing, accessible contrast, sensible touch targets (≥44px on phones).
- When asked for critique, read the layers and answer with specific, actionable points; change nothing unless asked.
- Finish with one or two plain sentences on what you changed or found.`;
const ASK = { turn: 0 };
async function runAsk() {
  const inp = $('#askIn'); const text = inp.value.trim();
  if (SAMPLE.busy) { if (SAMPLE.ctrl) SAMPLE.ctrl.abort(); return; }
  if (!text) { inp.focus(); return; }
  if (!SAMPLE.fn || !S.canEdit) { sendSelectionToChat(text); inp.value = ''; return; }
  const out = $('#askOut'); const go = $('#askGo');
  $('#ask').classList.remove('min');
  out.textContent = 'Thinking…';
  SAMPLE.busy = true; go.textContent = 'Stop'; renderAskScope();
  const ctrl = new AbortController(); SAMPLE.ctrl = ctrl;
  const group = 'claude-' + (++ASK.turn);
  CUR_GROUP = group;
  const ctx = fileContext();
  const msg = `${CLAUDE_BRIEF}\n\nCurrent context (JSON):\n${JSON.stringify(ctx).slice(0, 60000)}\n\nRequest: ${text}`;
  const messages = [...SAMPLE.history.slice(-6), { role: 'user', content: msg }];
  try {
    const res = await SAMPLE.fn(messages, { tools: claudeTools(), signal: ctrl.signal, onText: u => { out.textContent = u.text || 'Working…'; }, cache: false });
    out.textContent = res.text || 'Done.';
    SAMPLE.history.push({ role: 'user', content: `(Earlier request) ${text}` }, { role: 'assistant', content: (res.text || 'Done.').slice(0, 2000) });
    inp.value = '';
  } catch (err) {
    const c = err && err.code;
    out.textContent = c === 'cancelled' ? 'Stopped.' + (err.text ? '\n' + err.text : '') : c === 'not_granted' ? 'Claude was not allowed to run here.' : c === 'rate_limited' ? 'Too many requests — wait a moment and try again.' : c === 'prompt_too_large' ? 'The file is too large to send in one request — select a single screen and try again.' : 'Something went wrong: ' + ((err && err.message) || c || 'unknown');
    if (c === 'not_granted' || c === 'sampling_disabled') { SAMPLE.fn = null; updateAskUI(); }
  } finally {
    CUR_GROUP = null; SAMPLE.busy = false; SAMPLE.ctrl = null; go.textContent = 'Ask'; renderAskScope();
  }
}
function bindAsk() {
  const inp = $('#askIn');
  inp.addEventListener('focus', () => $('#ask').classList.remove('min'));
  inp.addEventListener('blur', () => setTimeout(() => { if (!inp.value && !SAMPLE.busy && document.activeElement !== inp) $('#ask').classList.add('min'); }, 200));
  inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; });
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAsk(); } if (e.key === 'Escape') { inp.blur(); $('#askOut').textContent = ''; $('#ask').classList.add('min'); $('#stage').focus(); } });
  $('#askGo').onclick = runAsk;
  $('#askChat').onclick = () => { const t = inp.value.trim(); sendSelectionToChat(t); inp.value = ''; };
}
