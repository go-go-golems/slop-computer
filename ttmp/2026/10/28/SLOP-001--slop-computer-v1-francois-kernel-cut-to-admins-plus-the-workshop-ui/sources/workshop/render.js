/* render.js · what the server does when it serves a version: inline the version's own files, inject window.slop
   (route, params and the data each name is bound to), turn a tokens artifact into CSS variables, and, in previews
   only, add a small bridge for links, pointing at elements and drawing comment pins. Pages run in sandboxed frames. */
(function () {
  'use strict';
  const api = window.slop;

  // ------------------------------------------------------------------ Markdown and front matter (enough for posts)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="u" href="$2">$1</a>');
  }
  function md(src) {
    const out = [], lines = String(src || '').replace(/\r/g, '').split('\n');
    let para = [], list = null;
    const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('<ul>' + list.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = null; } };
    for (const l of lines) {
      let m;
      if (!l.trim()) { flush(); continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } (list = list || []).push(m[1]); continue; }
      if ((m = /^>\s?(.*)$/.exec(l))) { flush(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if (list) flush();
      para.push(l.trim());
    }
    flush();
    return out.join('\n');
  }
  function frontMatter(text) {
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text || '').replace(/\r/g, ''));
    if (!m) return { meta: {}, body: text || '' };
    const meta = {};
    m[1].split('\n').forEach(l => {
      const i = l.indexOf(':'); if (i < 0) return;
      const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
      else if (v === 'true' || v === 'false') v = v === 'true';
      meta[k] = v;
    });
    return { meta, body: m[2] };
  }
  const base = p => p.split('/').pop().replace(/\.[^.]+$/, '');

  // the records of one data version, as pages see them
  function records(artifactId, n) {
    const a = api.artifacts.get(artifactId), v = api.versions.get(artifactId, n);
    if (!a || !v) return [];
    const type = (v.manifest && v.manifest.type) || a.type;
    if (type === 'tokens') return [];
    return Object.keys(v.files).sort().map(path => {
      const text = v.files[path];
      if (/\.md$/.test(path)) {
        const { meta, body } = frontMatter(text);
        const words = body.split(/\s+/).filter(Boolean).length;
        return Object.assign({ id: base(path), path, tags: [] }, meta, { body, html: md(body), minutes: Math.max(1, Math.round(words / 200)) });
      }
      if (/\.json$/.test(path)) { try { return Object.assign({ id: base(path), path }, JSON.parse(text)); } catch (e) { return { id: base(path), path, error: 'not valid JSON' }; } }
      if (/\.csv$/.test(path)) return { id: base(path), path, csv: text };
      return { id: base(path), path, text };
    });
  }
  function tokensOf(artifactId, n) {
    const v = api.versions.get(artifactId, n); if (!v || !v.files['tokens.json']) return null;
    try { return JSON.parse(v.files['tokens.json']); } catch (e) { return null; }
  }
  function tokensCSS(t) {
    if (!t) return '';
    const vars = Object.entries(t.colors || {}).map(([k, v]) => `--${k}:${v}`);
    if (t.type && t.type.sans) vars.push('--sans:' + t.type.sans);
    if (t.type && t.type.mono) vars.push('--mono:' + t.type.mono);
    if (t.radius) vars.push('--radius:' + t.radius);
    return `html:root{${vars.join(';')}}`;
  }

  // ------------------------------------------------------------------ the bridge that runs inside preview frames
  function bridge(MODE) {
    var picking = false, pins = [], hover = null, focusId = null;
    function post(m) { m.slop = 1; try { parent.postMessage(m, '*'); } catch (e) { /* no parent */ } }
    function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }
    // the shortest chain of tag.class parts, from the element up, that matches only this element
    function sel(el) {
      var parts = [], cur = el;
      var count = function (q) { try { return document.querySelectorAll(q).length; } catch (e) { return 99; } };
      while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
        if (cur.id && cur.id.indexOf('__slop') !== 0) { parts.unshift('#' + esc(cur.id)); break; }
        var s = cur.tagName.toLowerCase();
        var cls = Array.prototype.filter.call(cur.classList, function (c) { return c.indexOf('__slop') !== 0; }).slice(0, 2);
        if (cls.length) s += '.' + cls.map(esc).join('.');
        var p = cur.parentElement;
        if (p) {
          var twins = Array.prototype.filter.call(p.children, function (c) { return c.tagName === cur.tagName && cls.every(function (k) { return c.classList.contains(k); }); });
          if (twins.length > 1) {
            var sameTag = Array.prototype.filter.call(p.children, function (c) { return c.tagName === cur.tagName; });
            s += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
          }
        }
        parts.unshift(s);
        if (count(parts.join(' > ')) === 1) break;
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
    document.addEventListener('click', function (e) {
      if (picking) {
        e.preventDefault(); e.stopPropagation();
        var el = e.target; if (!el || el.nodeType !== 1 || /^__slop/.test(el.id || '')) return;
        var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        post({ type: 'pick', selector: sel(el), tag: el.tagName.toLowerCase(), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          fx: r.width ? (e.clientX - r.left) / r.width : 0, fy: r.height ? (e.clientY - r.top) / r.height : 0,
          styles: { gap: cs.gap, rowGap: cs.rowGap, columnGap: cs.columnGap, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
            fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, color: cs.color, backgroundColor: cs.backgroundColor, textAlign: cs.textAlign, borderRadius: cs.borderRadius, display: cs.display, marginTop: cs.marginTop, marginBottom: cs.marginBottom } });
        return;
      }
      if (MODE === 'thumb') { e.preventDefault(); return; }
      var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
      var href = a.getAttribute('href'); if (!href || href.charAt(0) === '#') return;
      e.preventDefault();
      if (/^(https?:)?\/\//.test(href) || /^(mailto|tel):/.test(href)) post({ type: 'external', href: href }); else post({ type: 'nav', href: href });
    }, true);
    document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    function layer(id, css) {
      var l = document.getElementById(id);
      if (!l && document.body) { l = document.createElement('div'); l.id = id; l.style.cssText = css; document.body.appendChild(l); }
      return l;
    }
    document.addEventListener('mousemove', function (e) {
      if (!picking) return;
      var el = e.target; if (!el || el.nodeType !== 1 || /^__slop/.test(el.id || '')) return;
      var r = el.getBoundingClientRect();
      var h = layer('__slop_hover', 'position:fixed;pointer-events:none;z-index:2147483646;outline:2px solid #e2001a;background:rgba(226,0,26,.06)');
      if (!h) return;
      h.style.left = r.left + 'px'; h.style.top = r.top + 'px'; h.style.width = r.width + 'px'; h.style.height = r.height + 'px'; h.style.display = 'block';
      hover = el;
    }, true);
    function draw() {
      var l = layer('__slop_pins', 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none');
      if (!l) return;
      l.innerHTML = '';
      var found = [], missing = [];
      pins.forEach(function (p) {
        var el = null; try { el = document.querySelector(p.selector); } catch (e) { el = null; }
        if (!el) { missing.push(p.id); return; }
        found.push(p.id);
        var r = el.getBoundingClientRect(), x = r.left + scrollX + (p.fx || 0) * r.width, y = r.top + scrollY + (p.fy || 0) * r.height;
        if (p.id === focusId) {
          var o = document.createElement('div');
          o.style.cssText = 'position:absolute;pointer-events:none;outline:2px solid #e2001a;outline-offset:2px;left:' + (r.left + scrollX) + 'px;top:' + (r.top + scrollY) + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
          l.appendChild(o);
        }
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = p.n; b.title = p.title || '';
        b.style.cssText = 'position:absolute;pointer-events:auto;cursor:pointer;left:' + (x - 11) + 'px;top:' + (y - 11) + 'px;width:22px;height:22px;padding:0;border:2px solid #fff;border-radius:0;font:700 11px/18px Arial,sans-serif;color:#fff;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3);background:' + (p.id === focusId ? '#e2001a' : p.resolved ? '#9a9a9a' : '#1a1a1a');
        b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); post({ type: 'pin', id: p.id }); });
        l.appendChild(b);
      });
      post({ type: 'pins', found: found, missing: missing });
    }
    window.addEventListener('message', function (e) {
      var m = e.data; if (!m || !m.slop) return;
      if (m.type === 'pick') {
        picking = !!m.on; document.documentElement.style.cursor = picking ? 'crosshair' : '';
        var h = document.getElementById('__slop_hover'); if (h && !picking) h.style.display = 'none';
      }
      if (m.type === 'pins') { pins = m.pins || []; focusId = m.focus || null; draw(); }
      if (m.type === 'focus') {
        focusId = m.id; draw();
        var p = pins.filter(function (x) { return x.id === m.id; })[0], el = null;
        try { el = p && document.querySelector(p.selector); } catch (e2) { el = null; }
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    window.addEventListener('resize', draw);
    window.addEventListener('load', function () { draw(); setTimeout(draw, 250); setTimeout(draw, 900); post({ type: 'ready', title: document.title }); });
    if (MODE === 'thumb') {
      var raf = window.requestAnimationFrame.bind(window), frames = 0;
      window.requestAnimationFrame = function (f) { return ++frames < 40 ? raf(f) : 0; };
      var si = window.setInterval.bind(window); window.setInterval = function (f, t) { return si(f, Math.max(t || 0, 1e9)); };
    }
  }

  // ------------------------------------------------------------------ the runtime pages get as window.slop
  function runtime(D) {
    var data = {};
    Object.keys(D.data).forEach(function (k) {
      var rows = D.data[k];
      data[k] = { list: function () { return Promise.resolve(rows.slice()); }, get: function (id) { return Promise.resolve(rows.filter(function (r) { return r.id === id; })[0] || null); }, all: rows };
    });
    window.slop = { route: D.route, data: data, record: D.record, version: D.version, mode: D.mode, tokens: D.tokens };
  }

  const json = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  // inline the version's own stylesheets and scripts, the way the server serves sibling files
  function inlineFiles(html, files) {
    html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, tag => {
      const m = /href=["']?([^"'\s>]+)/i.exec(tag); const f = m && files[m[1].replace(/^\.\//, '')];
      return f != null ? `<style data-file="${esc(m[1])}">${f}</style>` : tag;
    });
    html = html.replace(/<script\b([^>]*)\bsrc=["']?([^"'\s>]+)["']?([^>]*)><\/script>/gi, (tag, a, src, b) => {
      const f = files[src.replace(/^\.\//, '')];
      return f != null ? `<script data-file="${esc(src)}"${a}${b}>${f.replace(/<\/script/gi, '<\\/script')}</script>` : tag;
    });
    return html;
  }

  // ctx: { mode: 'preview' | 'thumb' | 'site', bindings, params, path, host, record }
  function doc(artifactId, n, ctx) {
    ctx = ctx || {};
    const v = api.versions.get(artifactId, n);
    if (!v) return '<!doctype html><p style="font:13px Arial;padding:20px">No such version.</p>';
    let html = v.files['index.html'];
    if (html == null) return '<!doctype html><p style="font:13px Arial;padding:20px">This version has no index.html.</p>';
    html = inlineFiles(html, v.files);
    const bindings = ctx.bindings || api.routes.bindingsFor(v, null);
    const data = {};
    let tokens = null;
    for (const [name, b] of Object.entries(bindings)) {
      if (name === '$tokens') { tokens = tokensOf(b.artifact, b.n); continue; }
      data[name] = records(b.artifact, b.n);
    }
    if (ctx.tokensOverride) tokens = ctx.tokensOverride;
    const D = { data, route: { host: ctx.host || null, path: ctx.path || null, params: ctx.params || {} }, record: ctx.record || null, version: { artifact: artifactId, n: v.n }, mode: ctx.mode || 'preview', tokens };
    const head = `<script>(${runtime})(${json(D)});</script>` + (ctx.mode === 'site' ? `<script>(${bridge})("site");</script>` : `<script>(${bridge})(${json(ctx.mode || 'preview')});</script>`);
    const tail = tokens ? `<style data-slop="tokens">${tokensCSS(tokens)}</style>` : '';
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + head) : head + html;
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tail + '</head>') : html + tail;
    return html;
  }

  // a route context for previewing a page outside the Site screen: the first route that serves it,
  // with a sample record when the route has parameters
  function previewContext(artifactId, opt) {
    opt = opt || {};
    const routes = api.routes.using(artifactId).filter(r => r.path !== '*');
    const fallback = api.routes.using(artifactId)[0];
    const r = routes[0] || fallback || null;
    const v = api.versions.get(artifactId, opt.n);
    const bindings = api.routes.bindingsFor(v, r);
    if (opt.dataOverride) for (const [name, b] of Object.entries(bindings)) if (b.artifact === opt.dataOverride.artifact) { b.n = opt.dataOverride.n; b.version = opt.dataOverride.n; }
    let params = {}, path = r ? r.path : null, record = null, samples = [];
    if (r && /[:*]/.test(r.path) && r.path !== '*') {
      const names = (r.path.match(/:(\w+)/g) || []).map(s => s.slice(1));
      if (r.record) {
        const m = /\{(\w+)\}/.exec(r.record), prefix = r.record.slice(0, r.record.indexOf('{'));
        const dataName = Object.keys(bindings).find(k => k !== '$tokens' && records(bindings[k].artifact, bindings[k].n).some(x => x.path && x.path.indexOf(prefix) === 0));
        const recs = dataName ? records(bindings[dataName].artifact, bindings[dataName].n).filter(x => x.path.indexOf(prefix) === 0) : [];
        recs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        samples = recs.map(x => x.id);
        const pick = opt.sample && samples.includes(opt.sample) ? opt.sample : samples[0];
        if (m && pick) params[m[1]] = pick;
      }
      names.forEach(k => { if (!params[k]) params[k] = 'example'; });
      path = r.path.replace(/:(\w+)/g, (_, k) => params[k]);
      record = r.record ? r.record.replace(/\{(\w+)\}/g, (_, k) => params[k] || '') : null;
    } else if (r && r.path === '*') path = '/press';
    return { route: r, host: r ? r.host : null, path, params, record, bindings, samples };
  }

  window.SlopRender = { doc, md, frontMatter, records, tokensOf, tokensCSS, previewContext, esc };
})();
