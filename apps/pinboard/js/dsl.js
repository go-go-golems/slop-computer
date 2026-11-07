/* Pinboard · the grammar: immutable Proxy-wrapped builders, fragments, IR, db queries, small utilities. */
(function (PB) {
  'use strict';

  // ---------- utilities ----------
  PB.lev = function (a, b) {
    const m = a.length, n = b.length, d = []; for (let i = 0; i <= m; i++) { d[i] = [i]; } for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  };
  PB.nearest = (name, list) => list.map(n => [PB.lev(name, n), n]).sort((x, y) => x[0] - y[0])[0];
  PB.ago = function (t) {
    if (!t) return ''; const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago';
  };
  PB.clock = (t) => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
  PB.esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  PB.host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return String(u || ''); } };
  PB.isURL = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
  PB.match = (obj, q) => { q = String(q || '').trim().toLowerCase(); if (!q) return true; return JSON.stringify(obj).toLowerCase().includes(q); };

  // YAML-ish formatter for results the agent reads
  PB.toYAML = function (v, indent = 0, seen = new Set()) {
    const pad = '  '.repeat(indent);
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'function') return 'λ';
    if (typeof v === 'string') return /\n|: |^\s|\s$|^[\[{\-]/.test(v) || v === '' ? JSON.stringify(v) : v;
    if (typeof v !== 'object') return String(v);
    if (v instanceof Blob) return 'blob ' + v.type + ' ' + v.size + ' B';
    if (v.nodeType) return '<' + v.tagName.toLowerCase() + '>';
    if (seen.has(v)) return '…(circular)'; seen.add(v);
    if (v._isBuilder) return PB.toYAML(PB.stripIR(v.build().root), indent, seen);
    if (v._isQuery) v = v.all();
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every(x => x === null || typeof x !== 'object')) return '[' + v.map(x => PB.toYAML(x, 0, seen)).join(', ') + ']';
      return v.map(x => pad + '- ' + PB.toYAML(x, indent + 1, seen).replace(/^\s+/, '')).join('\n');
    }
    const keys = Object.keys(v).filter(k => !k.startsWith('_'));
    if (!keys.length) return '{}';
    return keys.map(k => { const x = v[k]; const s = PB.toYAML(x, indent + 1, seen); const multi = x && typeof x === 'object' && !(x instanceof Blob) && !(x.nodeType) && (Array.isArray(x) ? /^\s*- /.test(s) : s !== '{}'); return pad + k + ': ' + (multi ? '\n' + s : s); }).join('\n');
  };

  // tiny markdown
  PB.md = function (src) {
    const esc = PB.esc; const lines = String(src || '').split('\n'); const out = []; let inCode = false, list = null, para = [];
    const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('</' + list + '>'); list = null; } };
    const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    for (const l of lines) {
      if (l.startsWith('```')) { if (inCode) { out.push('</code></pre>'); inCode = false; } else { flush(); out.push('<pre class="src"><code>'); inCode = true; } continue; }
      if (inCode) { out.push(esc(l) + '\n'); continue; }
      const h = /^(#{1,4})\s+(.*)/.exec(l); if (h) { flush(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
      const li = /^\s*[-*]\s+(.*)/.exec(l); const ol = /^\s*\d+[.)]\s+(.*)/.exec(l);
      if (li || ol) { const t = li ? 'ul' : 'ol'; if (list !== t) { flush(); out.push('<' + t + '>'); list = t; } out.push('<li>' + inline((li || ol)[1]) + '</li>'); continue; }
      if (/^\s*$/.test(l)) { flush(); continue; }
      if (/^>\s?/.test(l)) { flush(); out.push('<blockquote>' + inline(l.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
      if (/^---+$/.test(l)) { flush(); out.push('<hr>'); continue; }
      para.push(l);
    }
    flush(); if (inCode) out.push('</code></pre>'); return out.join('');
  };

  // ---------- grammar ----------
  const TOKENS = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
  const px = (v, who) => {
    if (typeof v === 'function') return v;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v in TOKENS) return TOKENS[v];
    throw new TypeError(who + ' expects a number of px or a spacing token (\'xs\' 4 · \'s\' 8 · \'m\' 12 · \'l\' 16 · \'xl\' 24); got ' + JSON.stringify(v) + '.');
  };
  const COMMON = {
    gap: (b, v) => b._p({ gap: px(v, b.kind + '.gap(value)') }),
    pad: (b, v) => b._p({ pad: px(v, b.kind + '.pad(value)') }),
    size: (b, w, h) => b._p({ w, h }),
    width: (b, w) => b._p({ w }), height: (b, h) => b._p({ h }),
    grow: (b, v = 1) => b._p({ grow: v }),
    align: (b, v) => b._p({ align: v }), justify: (b, v) => b._p({ justify: v }), wrap: (b, v = true) => b._p({ wrap: v }),
    id: (b, v) => b._p({ id: String(v) }),
    on: (b, ev, fn) => { if (typeof fn !== 'function') throw new TypeError(b.kind + '.on(event, handler): handler must be a function; got ' + typeof fn + '.'); return b._h(ev, fn); },
    bind: (b, fn) => { if (typeof fn !== 'function') throw new TypeError(b.kind + '.bind(c => value) wants a function of the context; got ' + typeof fn + '.'); return b._p({ value: fn }); },
    map: (b, fn) => { const r = fn(b); if (!r || !r._isBuilder) throw new TypeError(b.kind + '.map(b => …) must return a builder; got ' + (r === undefined ? 'undefined' : typeof r) + '.'); return r; },
    use: (b, frag) => useFragment(b, frag),
    class: (b, v) => b._p({ cls: v }), style: (b, v) => b._p({ style: v }),
    when: (b, fn) => b._p({ when: fn }),
    hint: (b, v) => b._p({ hint: v }),
    local: (b, v = true) => b._p({ local: v }),
    small: (b, v = true) => b._p({ small: v }), bold: (b, v = true) => b._p({ bold: v }), mono: (b, v = true) => b._p({ mono: v }), muted: (b, v = true) => b._p({ muted: v }),
    draggable: (b, o = {}) => b._p({ draggable: Object.assign({ kind: 'item' }, o) }),
    selected: (b, v) => b._p({ selected: v }),
    footer: (b, n) => b._p({ footer: [...(b.props.footer || []), n] }),
    strip: (b, n) => b._p({ strip: [...(b.props.strip || []), n] }),
    after: (b, n) => b._p({ after: [...(b.props.after || []), n] }),
    caption: (b, n) => b._p({ caption: n }),
    title: (b, v) => b._p({ title: v }),
    fill: (b, slot, n) => { if (!findSlot(b, slot)) throw new Error(b.kind + ' has no slot "' + slot + '". Slots here: ' + (listSlots(b).join(', ') || 'none') + '. Declare one with ui.slot(\'' + slot + '\').'); return fillSlot(b, slot, n); },
    set: (b, k, v) => b._a(k, v), get: (b, k) => b.attrs[k],
    tooltip: (b, v) => b._p({ tooltip: v }),
    menu: (b, items) => { if (!Array.isArray(items)) throw new TypeError(b.kind + '.menu(items): an array of { label, run(c), when?, hint? } or "-"'); return b._p({ menu: [...(b.props.menu || []), ...items] }); },
  };
  const BY_KIND = {
    text: {}, h: {}, note: {}, doc: {}, image: { fit: (b, v) => b._p({ fit: v }) }, link: {}, file: {}, chip: {}, swatch: {}, sep: {}, kv: {}, spacer: {}, frame: { body: (b, n) => b._p({ body: n }) },
    input: { placeholder: (b, v) => b._p({ placeholder: v }), multiline: (b, v = true) => b._p({ multiline: v }), code: (b, v = true) => b._p({ code: v, multiline: true }), type: (b, v) => b._p({ type: v }), rows: (b, v) => b._p({ rows: v }), debounce: (b, v) => b._p({ debounce: v }) },
    button: { primary: (b, v = true) => b._p({ primary: v }), disabled: (b, v) => b._p({ disabled: v }) },
    stack: { child: (b, n) => b._k(n) }, row: { child: (b, n) => b._k(n) },
    grid: { cols: (b, v) => { if (typeof v !== 'number' && typeof v !== 'function') throw new TypeError('grid.cols(n) expects a number or a lambda of the context; got ' + JSON.stringify(v) + '.'); return b._p({ cols: v }); }, child: (b, n) => b._k(n), masonry: (b, v = true) => b._p({ masonry: v }) },
    list: {}, each: {}, when: {},
    table: { columns: (b, v) => b._p({ columns: v }), editable: (b, v = true) => b._p({ editable: v }), onRow: (b, fn) => b._h('row', fn), onEdit: (b, fn) => b._h('edit', fn) },
    dropzone: { accepts: (b, v) => b._p({ accepts: v }), child: (b, n) => b._k(n) },
    segmented: { options: (b, v) => b._p({ options: v }) }, select: { options: (b, v) => b._p({ options: v }) }, toggle: {}, slider: { range: (b, min, max, step) => b._p({ min, max, step }) },
    slot: {},
  };
  const ALL_METHODS = {}; Object.keys(BY_KIND).forEach(k => Object.keys(BY_KIND[k]).forEach(mn => (ALL_METHODS[mn] = ALL_METHODS[mn] || []).push(k)));
  PB.grammar = { kinds: Object.keys(BY_KIND), common: Object.keys(COMMON), byKind: Object.fromEntries(Object.keys(BY_KIND).map(k => [k, Object.keys(BY_KIND[k])])) };

  function findSlot(b, name) { if (b.kind === 'slot' && b.props.name === name) return true; return b.children.some(c => c && c._isBuilder && findSlot(c, name)); }
  function listSlots(b) { const out = []; (function walk(n) { if (!n || !n._isBuilder) return; if (n.kind === 'slot') out.push(n.props.name); n.children.forEach(walk); })(b); return out; }
  function fillSlot(b, name, n) { if (b.kind === 'slot' && b.props.name === name) return n; return mk(b.kind, b.props, b.children.map(c => c && c._isBuilder ? fillSlot(c, name, n) : c), b.handlers, b.frags, b.attrs); }

  PB.fragments = {};
  function useFragment(b, frag) {
    if (typeof frag === 'string') frag = PB.fragments[frag];
    if (!frag || !frag._isFragment) throw new TypeError(b.kind + '.use(fragment): expected a fragment made with fragment(name); got ' + (frag && frag.name || typeof frag) + '.');
    if (b.frags.includes(frag)) return b;
    let nb = mk(b.kind, b.props, b.children, b.handlers, [...b.frags, frag], Object.assign({}, b.attrs));
    Object.keys(frag.attrs).forEach(k => { if (!(k in nb.attrs)) nb.attrs[k] = PB.clone(frag.attrs[k]); });
    frag.decorations.forEach(d => { const r = d(nb); if (r && r._isBuilder) nb = r; });
    return nb;
  }

  const KNOWN_PROPS = new Set(['then', 'toJSON', 'constructor', 'valueOf', 'toString', 'inspect', 'asymmetricMatch', 'nodeType', '$$typeof', '_isBuilder', 'kind', 'props', 'children', 'handlers', 'frags', 'attrs', 'build', 'mount', 'describe', 'toYAML', '_p', '_k', '_h', '_a', 'length']);
  const handler = {
    get(t, name, self) {
      if (typeof name !== 'string' || KNOWN_PROPS.has(name) || name in t) return t[name];
      const f = (BY_KIND[t.kind] || {})[name] || COMMON[name];
      if (f) return (...a) => f(self, ...a);
      for (const fr of t.frags) { if (fr.methods[name]) return (...a) => fr.methods[name](self, ...a); if (fr.queries[name]) return (...a) => fr.queries[name](t.build().root, ...a); }
      for (const fr of Object.values(PB.fragments)) if (fr.isGlobal && fr.methods[name]) return (...a) => fr.methods[name](self, ...a);
      // diagnostics
      const owners = ALL_METHODS[name];
      if (owners) throw new Error(t.kind + ' has no method "' + name + '". It belongs to ' + owners.join(', ') + ': use ui.' + owners[0] + '(…)' + (t.kind === 'stack' && name === 'cols' ? ' (a stack is one column; ui.grid(…).cols(n) lays out columns).' : '.'));
      for (const fr of Object.values(PB.fragments)) if (fr.methods[name]) throw new Error(t.kind + ' has no method "' + name + '". It comes from fragment ' + fr.name + '; add .use(' + fr.name + ') first.');
      const all = [...Object.keys(COMMON), ...Object.keys(BY_KIND[t.kind] || {}), ...t.frags.flatMap(f => Object.keys(f.methods))];
      const near = PB.nearest(name, all);
      throw new Error(t.kind + ' has no method "' + name + '".' + (near && near[0] <= 3 ? ' Did you mean "' + near[1] + '"?' : ' Methods here: ' + all.slice(0, 14).join(', ') + '…'));
    },
    set() { throw new Error('builders are immutable; every call returns a new one. Use b = b.pad(8).'); }
  };
  let seq = 0;
  function mk(kind, props = {}, children = [], handlers = {}, frags = [], attrs = {}) {
    const t = { _isBuilder: true, kind, props: Object.freeze(Object.assign({}, props)), children: Object.freeze(children.slice()), handlers: Object.freeze(Object.assign({}, handlers)), frags: Object.freeze(frags.slice()), attrs };
    t._p = (patch) => mk(kind, Object.assign({}, props, patch), children, handlers, frags, attrs);
    t._k = (n) => mk(kind, props, [...children, n], handlers, frags, attrs);
    t._h = (ev, fn) => mk(kind, props, children, Object.assign({}, handlers, { [ev]: [...(handlers[ev] || []), fn] }), frags, attrs);
    t._a = (k, v) => { const a = Object.assign({}, attrs); a[k] = typeof v === 'function' ? v(a[k]) : v; return mk(kind, props, children, handlers, frags, a); };
    t.build = () => buildIR(t);
    t.mount = (el, ctx) => PB.mount(t, el, ctx);
    t.describe = () => PB.toYAML(strip(buildIR(t).root));
    t.toYAML = t.describe;
    return new Proxy(t, handler);
  }
  function kids(args) { return args.flat().filter(x => x !== null && x !== undefined && x !== false).map(x => typeof x === 'string' || typeof x === 'number' ? mk('text', { value: String(x) }) : x); }
  const ui = {
    text: (v = '') => mk('text', { value: v }),
    h: (v, level = 2) => mk('h', { value: v, level }),
    note: (v = '') => mk('note', { value: v }),
    doc: (v = '') => mk('doc', { value: v }),
    image: (src) => mk('image', { src }),
    screenshot: (src) => mk('image', { src, screenshot: true }),
    link: (url) => mk('link', { url }),
    file: (f) => mk('file', { file: f }),
    input: (key) => mk('input', { key: String(key) }),
    button: (label) => mk('button', { label }),
    chip: (t) => mk('chip', { value: t }),
    swatch: (hex) => mk('swatch', { value: hex }),
    sep: () => mk('sep'), spacer: () => mk('spacer'),
    kv: (pairs) => mk('kv', { pairs }),
    stack: (...a) => mk('stack', {}, kids(a)),
    row: (...a) => mk('row', {}, kids(a)),
    grid: (...a) => mk('grid', { cols: 3 }, kids(a)),
    list: (items, fn) => { if (!Array.isArray(items)) throw new TypeError('ui.list(items, fn) expands at build time, so items must be an array. For a live query use ui.each(query, fn).'); return mk('list', {}, items.map((it, i) => fn(it, i))); },
    each: (src, fn) => { if (typeof fn !== 'function') throw new TypeError('ui.each(source, item => builder): second argument must be a function.'); return mk('each', { src, fn }); },
    when: (pred, a, b) => mk('when', { pred, then: a, else: b }),
    table: (rows, opts = {}) => mk('table', Object.assign({ rows }, opts)),
    dropzone: (opts = {}) => mk('dropzone', Object.assign({ accepts: ['*'] }, opts)),
    segmented: (key, options) => mk('segmented', { key, options }),
    select: (key, options) => mk('select', { key, options }),
    toggle: (key, label) => mk('toggle', { key, label }),
    slider: (key, opts = {}) => mk('slider', Object.assign({ key }, opts)),
    slot: (name) => mk('slot', { name }),
    frame: (body) => mk('frame', { body }),
    strict: (v = true) => { PB.strict = v; },
    tokens: TOKENS,
  };
  PB.ui = ui;

  // ---------- fragments ----------
  PB.fragment = function (name) {
    const f = { _isFragment: true, name, attrs: {}, methods: {}, queries: {}, decorations: [], hooks: {}, isGlobal: false };
    f.attr = (k, def) => (f.attrs[k] = def, f);
    f.method = (k, fn) => (f.methods[k] = fn, f);
    f.query = (k, fn) => (f.queries[k] = fn, f);
    f.decorate = (fn) => (f.decorations.push(fn), f);
    f.on = (ev, fn) => ((f.hooks[ev] = f.hooks[ev] || []).push(fn), f);
    f.global = () => (f.isGlobal = true, f);
    f.toYAML = () => PB.toYAML({ fragment: name, attrs: f.attrs, methods: Object.keys(f.methods), queries: Object.keys(f.queries), decorations: f.decorations.length, hooks: Object.keys(f.hooks) });
    PB.fragments[name] = f; return f;
  };

  // ---------- IR ----------
  function buildIR(root) {
    let n = 0; const nodes = []; const byId = {};
    function walk(b, path) {
      if (!b || !b._isBuilder) return b;
      const id = b.props.id || (b.kind + '#' + (++n));
      const node = { kind: b.kind, id, path, props: {}, children: [], handlers: Object.keys(b.handlers), frags: b.frags.map(f => f.name), attrs: b.attrs, deps: [], _b: b };
      Object.keys(b.props).forEach(k => { const v = b.props[k]; node.props[k] = v && v._isBuilder ? walk(v, path + '/' + k) : Array.isArray(v) && v.some(x => x && x._isBuilder) ? v.map((x, i) => x && x._isBuilder ? walk(x, path + '/' + k + i) : x) : v; });
      node.children = b.children.map((c, i) => walk(c, path + '/' + i));
      if (b.kind === 'each' && !b.props.id && PB.strict) throw new Error(id + ' has a runtime lambda but no .id(); the agent cannot address it. Add .id(\'rows\').');
      nodes.push(node); byId[id] = node; return node;
    }
    const r = walk(root, '');
    const ir = { root: r, nodes, node: (id) => byId[id], get edges() { return nodes.flatMap(nd => (nd.deps || []).map(d => [d, nd.id])); }, toYAML: () => PB.toYAML(strip(r)), diff: (other) => diffIR(strip(r), strip((other.root ? other : other.build()).root)) };
    return ir;
  }
  PB.stripIR = strip;
  function strip(node) { if (!node || typeof node !== 'object') return node; if (Array.isArray(node)) return node.map(strip); const o = {}; for (const k of Object.keys(node)) { if (k === '_b' || k === 'path') continue; const v = node[k]; if (typeof v === 'function') o[k] = 'λ'; else if (k === 'children' && !v.length) continue; else if (k === 'handlers' && !v.length) continue; else if (k === 'frags' && !v.length) continue; else if (k === 'deps' && !v.length) continue; else if (k === 'attrs' && !Object.keys(v).length) continue; else o[k] = strip(v); } return o; }
  function diffIR(a, b, path = '', out = []) {
    if (typeof a !== typeof b || (a && typeof a === 'object') !== (b && typeof b === 'object')) { out.push({ op: 'replace', at: path || '/', from: a, to: b }); return out; }
    if (!a || typeof a !== 'object') { if (a !== b) out.push({ op: 'set', at: path || '/', from: a, to: b }); return out; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { if (!(k in a)) out.push({ op: 'add', at: path + '/' + k, to: b[k] }); else if (!(k in b)) out.push({ op: 'remove', at: path + '/' + k, from: a[k] }); else diffIR(a[k], b[k], path + '/' + k, out); }
    return out;
  }

  // ---------- db: schema builder and queries ----------
  class Query {
    constructor(coll, filters = [], order = null, lim = null) { this.coll = coll; this.filters = filters; this.order = order; this.lim = lim; this._isQuery = true; }
    where(fn) { if (typeof fn !== 'function') throw new TypeError('where(record => boolean) wants a predicate of the record.'); return new Query(this.coll, [...this.filters, fn], this.order, this.lim); }
    orderBy(f, dir = 'asc') { if (Array.isArray(f)) { dir = f[1] || 'asc'; f = f[0]; } return new Query(this.coll, this.filters, { f, dir }, this.lim); }
    limit(n) { return new Query(this.coll, this.filters, this.order, n); }
    all() {
      PB.track && PB.track('coll:' + this.coll);
      let rows = Object.values(PB.S.records).filter(r => r.coll === this.coll);
      for (const f of this.filters) rows = rows.filter(r => { try { return f(r); } catch (e) { return false; } });
      if (this.order) { const { f, dir } = this.order; const get = typeof f === 'function' ? f : (r) => String(f).split('.').reduce((o, k) => o == null ? o : o[k], r); rows.sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); }); }
      else rows.sort((a, b) => a.added - b.added);
      if (this.lim != null) rows = rows.slice(0, this.lim);
      return rows;
    }
    count() { return this.all().length; }
    first() { return this.all()[0]; }
    get(id) { PB.track && PB.track('coll:' + this.coll); const r = PB.S.records[id]; return r && r.coll === this.coll ? r : undefined; }
    distinct(field) { const s = new Set(); this.all().forEach(r => { const v = r[field]; (Array.isArray(v) ? v : [v]).forEach(x => x != null && s.add(x)); }); return [...s]; }
    insert(data) { const c = this.coll; return PB.mutate(m => m.insert(c, data), PB.actor, { coalesce: 'insert:' + c }); }
    update(id, patch) { const c = this.coll; return PB.mutate(m => m.update(c, id, patch), PB.actor); }
    remove(id) { const c = this.coll; return PB.mutate(m => m.removeRecord(c, id), PB.actor); }
    schema() { return PB.S.collections[this.coll]; }
    toYAML() { return PB.toYAML(this.all()); }
    toJSON() { return { query: this.coll, filters: this.filters.length, order: this.order, limit: this.lim }; }
  }
  PB.Query = Query;
  function schemaBuilder(name) {
    const commit = (patch) => PB.mutate(m => m.collection(name, patch), PB.actor, { coalesce: 'collection:' + name });
    if (!PB.S.collections[name]) commit({ name });
    let last = null;
    const sb = {
      _isSchema: true, name,
      field(fname, type = 'text', opts = {}) { const s = PB.S.collections[name]; const fields = (s.fields || []).filter(f => f.name !== fname); fields.push(Object.assign({ name: fname, type }, opts)); commit({ fields }); last = fname; return sb; },
      required() { if (!last) throw new Error('required() follows field()'); const s = PB.S.collections[name]; commit({ fields: s.fields.map(f => f.name === last ? Object.assign(f, { required: true }) : f) }); return sb; },
      auto() { if (!last) throw new Error('auto() follows field()'); const s = PB.S.collections[name]; commit({ fields: s.fields.map(f => f.name === last ? Object.assign(f, { auto: true }) : f) }); return sb; },
      index(f) { const s = PB.S.collections[name]; commit({ indexes: [...new Set([...(s.indexes || []), f])] }); return sb; },
      store(kind) { commit({ store: kind }); return sb; },
      rename(from, to) { const s = PB.S.collections[name]; commit({ fields: s.fields.map(f => f.name === from ? Object.assign(f, { name: to }) : f) }); PB.mutate(m => Object.values(PB.S.records).filter(r => r.coll === name).forEach(r => m.update(name, r.id, x => { x[to] = x[from]; delete x[from]; return x; })), PB.actor); return sb; },
      migrate(version, fn) { const s = PB.S.collections[name]; if ((s.version || 1) >= version) return sb; fn(sb); commit({ version }); return sb; },
      drop() { PB.mutate(m => m.removeCollection(name), PB.actor); },
      get schema() { return PB.S.collections[name]; },
      toYAML() { return PB.toYAML(PB.S.collections[name]); },
    };
    return sb;
  }
  const dbCore = {
    collection: (name) => { if (!/^[a-z][a-z0-9_-]*$/i.test(name)) throw new Error('collection names are words: ' + JSON.stringify(name)); return schemaBuilder(name); },
    collections: () => { PB.track && PB.track('collections'); return Object.values(PB.S.collections); },
    query: (name) => new Query(name),
    has: (name) => !!PB.S.collections[name],
    record: (id) => PB.S.records[id],
    toYAML: () => PB.toYAML(Object.values(PB.S.collections).map(c => ({ name: c.name, fields: (c.fields || []).map(f => f.name + ':' + f.type), rows: Object.values(PB.S.records).filter(r => r.coll === c.name).length }))),
  };
  PB.db = new Proxy(dbCore, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (['then', 'toJSON', 'constructor', 'valueOf', 'inspect', '$$typeof', 'nodeType', 'asymmetricMatch', 'length'].includes(k)) return undefined;
      if (/^[a-z][a-z0-9_-]*$/i.test(k)) return new Query(k);
      return undefined;
    }
  });
  PB.actor = 'you';
})(window.PB);
