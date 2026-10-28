/* slop preview bridge: runs inside Workshop previews (sandbox origin). It
   reports clicked elements for comments, draws comment pins, and hands link
   clicks to the Workshop. It only talks to the Workshop's origin, named in
   the boot data. Ported from the Workshop prototype's render.js bridge(). */
(function () {
  'use strict';
  var el = document.getElementById('slop-boot');
  var D = {};
  try { D = JSON.parse(el ? el.textContent : '{}'); } catch (e) { D = {}; }
  var MODE = D.mode || 'preview', PARENT = D.parentOrigin || '';
  var picking = false, pins = [], focusId = null;
  function post(m) { if (!PARENT || window.parent === window) return; m.slop = 1; try { window.parent.postMessage(m, PARENT); } catch (e) { /* no parent */ } }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }
  // the shortest chain of tag.class parts, from the element up, that matches only this element
  function sel(node) {
    var parts = [], cur = node;
    var count = function (q) { try { return document.querySelectorAll(q).length; } catch (e) { return 99; } };
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      if (cur.id && cur.id.indexOf('__slop') !== 0) { parts.unshift('#' + esc(cur.id)); break; }
      var s = cur.tagName.toLowerCase();
      var cls = Array.prototype.filter.call(cur.classList, function (c) { return c.indexOf('__slop') !== 0; }).slice(0, 2);
      if (cls.length) s += '.' + cls.map(esc).join('.');
      var p = cur.parentElement;
      if (p) {
        var c0 = cur;
        var twins = Array.prototype.filter.call(p.children, function (c) { return c.tagName === c0.tagName && cls.every(function (k) { return c.classList.contains(k); }); });
        if (twins.length > 1) {
          var sameTag = Array.prototype.filter.call(p.children, function (c) { return c.tagName === c0.tagName; });
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
      var t = e.target; if (!t || t.nodeType !== 1 || /^__slop/.test(t.id || '')) return;
      var r = t.getBoundingClientRect(), cs = getComputedStyle(t);
      post({ type: 'pick', selector: sel(t), tag: t.tagName.toLowerCase(), text: (t.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        fx: r.width ? (e.clientX - r.left) / r.width : 0, fy: r.height ? (e.clientY - r.top) / r.height : 0,
        box: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)],
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
    var t = e.target; if (!t || t.nodeType !== 1 || /^__slop/.test(t.id || '')) return;
    var r = t.getBoundingClientRect();
    var h = layer('__slop_hover', 'position:fixed;pointer-events:none;z-index:2147483646;outline:2px solid #e2001a;background:rgba(226,0,26,.06)');
    if (!h) return;
    h.style.left = r.left + 'px'; h.style.top = r.top + 'px'; h.style.width = r.width + 'px'; h.style.height = r.height + 'px'; h.style.display = 'block';
  }, true);
  function draw() {
    var l = layer('__slop_pins', 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none');
    if (!l) return;
    l.innerHTML = '';
    var found = [], missing = [];
    pins.forEach(function (p) {
      var t = null; try { t = document.querySelector(p.selector); } catch (e) { t = null; }
      if (!t) { missing.push(p.id); return; }
      found.push(p.id);
      var r = t.getBoundingClientRect(), x = r.left + scrollX + (p.fx || 0) * r.width, y = r.top + scrollY + (p.fy || 0) * r.height;
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
    if (e.origin !== PARENT) return;
    var m = e.data; if (!m || !m.slop) return;
    if (m.type === 'pick') {
      picking = !!m.on; document.documentElement.style.cursor = picking ? 'crosshair' : '';
      var h = document.getElementById('__slop_hover'); if (h && !picking) h.style.display = 'none';
    }
    if (m.type === 'pins') { pins = m.pins || []; focusId = m.focus || null; draw(); }
    if (m.type === 'focus') {
      focusId = m.id; draw();
      var p = pins.filter(function (x) { return x.id === m.id; })[0], t = null;
      try { t = p && document.querySelector(p.selector); } catch (e2) { t = null; }
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
  window.addEventListener('resize', draw);
  window.addEventListener('load', function () { draw(); setTimeout(draw, 250); setTimeout(draw, 900); post({ type: 'ready', title: document.title }); });
  if (MODE === 'thumb') {
    var raf = window.requestAnimationFrame.bind(window), frames = 0;
    window.requestAnimationFrame = function (f) { return ++frames < 40 ? raf(f) : 0; };
    var si = window.setInterval.bind(window); window.setInterval = function (f, t) { return si(f, Math.max(t || 0, 1e9)); };
  }
})();
