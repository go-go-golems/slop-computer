/* slop tool client: injected into tools (pages with a "tool" section in
   slop.json) when the Workshop opens them at /tools/<id>. A tool never sees
   cookies or CSRF tokens: the Workshop hands it a short-lived grant (slg_…)
   over postMessage, and every call carries it as a bearer token. The grant
   only allows the permissions an admin approved for this tool.

     const api = await slop.tool.ready()        // rejects outside the Workshop
     const routes = await api.get('/routes', { host: 'site.localhost:8080' })
     await api.put('/routes', { ...routes[0], version: 3, note: 'shipped' })
     api.on('route.set', e => …)                 // needs events:read
*/
(function () {
  'use strict';
  var el = document.getElementById('slop-boot');
  var D = {};
  try { D = JSON.parse(el ? el.textContent : '{}'); } catch (e) { D = {}; }
  var PARENT = D.parentOrigin || '';
  var grant = null, waiting = [], handlers = {}, streaming = false;

  function post(m) { if (PARENT && window.parent !== window) { m.slop = 1; window.parent.postMessage(m, PARENT); } }

  window.addEventListener('message', function (e) {
    if (e.origin !== PARENT || e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.slop !== 1 || m.type !== 'grant') return;
    grant = { secret: m.grant, expiresAt: m.expiresAt, permissions: m.permissions || [], user: m.user || null };
    waiting.splice(0).forEach(function (w) { w.resolve(api); });
  });

  function ApiError(status, body) {
    var err = (body && body.error) || {};
    var e = new Error(err.message || ('HTTP ' + status));
    e.status = status; e.code = err.code || ''; return e;
  }

  function call(method, path, opts) {
    if (!grant) return Promise.reject(new Error('slop.tool: no grant yet; await slop.tool.ready() first'));
    var url = PARENT + '/api' + (path.charAt(0) === '/' ? path : '/' + path);
    if (opts && opts.params) {
      var q = Object.keys(opts.params).filter(function (k) { return opts.params[k] != null; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(opts.params[k]); }).join('&');
      if (q) url += (url.indexOf('?') < 0 ? '?' : '&') + q;
    }
    var init = { method: method, headers: { Authorization: 'Bearer ' + grant.secret }, credentials: 'omit', mode: 'cors' };
    if (opts && opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(url, init).then(function (r) {
      return r.text().then(function (t) {
        var body = null; try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; }
        if (!r.ok) throw ApiError(r.status, body);
        return body;
      });
    });
  }

  // Server-sent events over fetch, so the grant can go in a header.
  function stream() {
    if (streaming) return;
    streaming = true;
    var last = 0;
    (function connect() {
      if (!grant) { setTimeout(connect, 1000); return; }
      fetch(PARENT + '/api/events' + (last ? '?after=' + last : ''), { headers: { Authorization: 'Bearer ' + grant.secret }, credentials: 'omit', mode: 'cors' })
        .then(function (r) {
          if (!r.ok || !r.body) throw new Error('events: HTTP ' + r.status);
          var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
          return (function read() {
            return reader.read().then(function (x) {
              if (x.done) return;
              buf += dec.decode(x.value, { stream: true });
              var i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                var block = buf.slice(0, i); buf = buf.slice(i + 2);
                var type = 'message', data = '';
                block.split('\n').forEach(function (line) {
                  if (line.indexOf('event: ') === 0) type = line.slice(7);
                  else if (line.indexOf('data: ') === 0) data += line.slice(6);
                  else if (line.indexOf('id: ') === 0) last = +line.slice(4) || last;
                });
                var ev = null; try { ev = JSON.parse(data); } catch (e) { ev = data; }
                (handlers[type] || []).concat(handlers['*'] || []).forEach(function (h) { try { h(ev, type); } catch (e) { console.error(e); } });
              }
              return read();
            });
          })();
        })
        .catch(function (e) { console.warn('slop.tool:', e.message); })
        .then(function () { setTimeout(connect, 2000); });
    })();
  }

  var api = {
    get: function (path, params) { return call('GET', path, { params: params }); },
    post: function (path, body) { return call('POST', path, { body: body }); },
    put: function (path, body) { return call('PUT', path, { body: body }); },
    patch: function (path, body) { return call('PATCH', path, { body: body }); },
    del: function (path, params) { return call('DELETE', path, { params: params }); },
    on: function (type, h) { (handlers[type] = handlers[type] || []).push(h); stream(); return api; },
    can: function (perm) { return !!grant && grant.permissions.indexOf(perm) >= 0; },
    get permissions() { return grant ? grant.permissions.slice() : []; },
    get user() { return grant ? grant.user : null; },
    version: D.version || null,
  };

  var tool = {
    ready: function () {
      if (grant) return Promise.resolve(api);
      return new Promise(function (resolve, reject) {
        if (!PARENT || window.parent === window) { reject(new Error('slop.tool: open this tool from the Workshop (/tools/<id>)')); return; }
        waiting.push({ resolve: resolve });
        post({ type: 'tool-hello', version: D.version });
        setTimeout(function () { if (!grant) reject(new Error('slop.tool: the Workshop did not send a grant')); }, 10000);
      });
    },
  };
  window.slop = window.slop || {};
  window.slop.tool = tool;
})();
