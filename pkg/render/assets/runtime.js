/* slop runtime: defines window.slop for a page from the boot data the
   server injects (#slop-boot). Ported from the Workshop prototype's
   render.js runtime(). */
(function () {
  'use strict';
  var el = document.getElementById('slop-boot');
  var D = {};
  try { D = JSON.parse(el ? el.textContent : '{}'); } catch (e) { D = {}; }
  var data = {};
  Object.keys(D.data || {}).forEach(function (k) {
    var rows = D.data[k] || [];
    data[k] = {
      list: function () { return Promise.resolve(rows.slice()); },
      get: function (id) { return Promise.resolve(rows.filter(function (r) { return r.id === id; })[0] || null); },
      all: rows,
    };
  });
  // image(src, width): src scaled to width by the server (snapped up to its
  // ladder of widths, never enlarged). srcset(src, widths): a srcset value.
  function image(src, w) { return w ? src + (String(src).indexOf('?') < 0 ? '?' : '&') + 'w=' + w : src; }
  function srcset(src, widths) {
    return (widths || [320, 480, 640, 960, 1280]).map(function (w) { return image(src, w) + ' ' + w + 'w'; }).join(', ');
  }
  window.slop = { route: D.route || { params: {} }, data: data, record: D.record || null, version: D.version || null, mode: D.mode || 'site', tokens: D.tokens || null,
    image: image, srcset: srcset };
})();
