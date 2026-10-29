/* slop tool client: injected into tools (pages with a "tool" section in
   slop.json) when the Workshop opens them at /tools/<id>. A tool never sees
   cookies or CSRF tokens: the Workshop hands it a short-lived grant (slg_…)
   over postMessage, and every call carries it as a bearer token. The grant
   only allows the permissions an admin approved for this tool.

     const api = await slop.tool.ready()        // rejects outside the Workshop
     const routes = await api.get('/routes', { host: 'site.localhost:8080' })
     await api.put('/routes', { ...routes[0], version: 3, note: 'shipped' })
     api.on('route.set', e => …)                 // needs events:read
     api.args, api.config, api.people            // ?query of /tools/<id>, site hosts, user names
     const stop = api.stream('/docs/x/events', { after: () => rev, on: (type, data, id) => … })
     await api.putRaw('/blobs/' + sha, bytes)    // a non-JSON body
     api.beacon('POST', '/presence/x', {...})    // survives the page closing
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
    grant = { secret: m.grant, expiresAt: m.expiresAt, permissions: m.permissions || [], user: m.user || null,
      args: m.args || {}, config: m.config || {}, people: m.people || {} };
    waiting.splice(0).forEach(function (w) { w.resolve(api); });
  });

  function ApiError(status, body) {
    var err = (body && body.error) || {};
    var e = new Error(err.message || ('HTTP ' + status));
    e.status = status; e.code = err.code || ''; return e;
  }

  function apiURL(path) { return PARENT + '/api' + (path.charAt(0) === '/' ? path : '/' + path); }

  function call(method, path, opts) {
    if (!grant) return Promise.reject(new Error('slop.tool: no grant yet; await slop.tool.ready() first'));
    var url = apiURL(path);
    if (opts && opts.params) {
      var q = Object.keys(opts.params).filter(function (k) { return opts.params[k] != null; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(opts.params[k]); }).join('&');
      if (q) url += (url.indexOf('?') < 0 ? '?' : '&') + q;
    }
    var init = { method: method, headers: { Authorization: 'Bearer ' + grant.secret }, credentials: 'omit', mode: 'cors' };
    if (opts && opts.raw !== undefined) { init.headers['Content-Type'] = opts.type || 'application/octet-stream'; init.body = opts.raw; }
    else if (opts && opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    if (opts && opts.keepalive) init.keepalive = true;
    return fetch(url, init).then(function (r) {
      return r.text().then(function (t) {
        var body = null; try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; }
        if (!r.ok) throw ApiError(r.status, body);
        return body;
      });
    });
  }

  // Server-sent events over fetch, so the grant can go in a header. after()
  // gives the cursor for each (re)connect; on(type, data, id) gets events.
  function sse(path, after, on) {
    var stopped = false, ctrl = null;
    (function connect() {
      if (stopped) return;
      if (!grant) { setTimeout(connect, 1000); return; }
      var cur = after(), url = apiURL(path);
      if (cur) url += (url.indexOf('?') < 0 ? '?' : '&') + 'after=' + encodeURIComponent(cur);
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      fetch(url, { headers: { Authorization: 'Bearer ' + grant.secret }, credentials: 'omit', mode: 'cors', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          if (!r.ok || !r.body) throw new Error(path + ': HTTP ' + r.status);
          var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
          return (function read() {
            return reader.read().then(function (x) {
              if (x.done) return;
              buf += dec.decode(x.value, { stream: true });
              var i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                var block = buf.slice(0, i); buf = buf.slice(i + 2);
                var type = 'message', data = '', id = null;
                block.split('\n').forEach(function (line) {
                  if (line.indexOf('event: ') === 0) type = line.slice(7);
                  else if (line.indexOf('data: ') === 0) data += line.slice(6);
                  else if (line.indexOf('id: ') === 0) id = +line.slice(4) || null;
                });
                if (!data) continue;
                var ev = null; try { ev = JSON.parse(data); } catch (e) { ev = data; }
                try { on(type, ev, id); } catch (e) { console.error(e); }
              }
              return read();
            });
          })();
        })
        .catch(function (e) { if (!stopped) console.warn('slop.tool:', e.message); })
        .then(function () { if (!stopped) setTimeout(connect, 2000); });
    })();
    return function stop() { stopped = true; if (ctrl) ctrl.abort(); };
  }

  function stream() {
    if (streaming) return;
    streaming = true;
    var last = 0;
    sse('/events', function () { return last; }, function (type, ev, id) {
      if (id) last = id;
      (handlers[type] || []).concat(handlers['*'] || []).forEach(function (h) { try { h(ev, type); } catch (e) { console.error(e); } });
    });
  }

  var api = {
    get: function (path, params) { return call('GET', path, { params: params }); },
    post: function (path, body) { return call('POST', path, { body: body }); },
    put: function (path, body) { return call('PUT', path, { body: body }); },
    patch: function (path, body) { return call('PATCH', path, { body: body }); },
    del: function (path, params) { return call('DELETE', path, { params: params }); },
    on: function (type, h) { (handlers[type] = handlers[type] || []).push(h); stream(); return api; },
    stream: function (path, o) { return sse(path, o.after || function () { return 0; }, o.on); },
    putRaw: function (path, raw, type) { return call('PUT', path, { raw: raw, type: type }); },
    beacon: function (method, path, body) { return call(method, path, { body: body, keepalive: true }).catch(function () {}); },
    can: function (perm) { return !!grant && grant.permissions.indexOf(perm) >= 0; },
    get permissions() { return grant ? grant.permissions.slice() : []; },
    get user() { return grant ? grant.user : null; },
    get args() { return grant ? grant.args : {}; },
    get config() { return grant ? grant.config : {}; },
    get people() { return grant ? grant.people : {}; },
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
