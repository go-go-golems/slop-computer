// use('express') / require('express') (SLOP3-012 phase 2): go-go-goja's
// express route builder, compiled into the actor's route table. Routes
// register while actor.js loads; each one states who may call it
// (.public() or .allow(level)) before .handle(fn). Go merges them into
// def.http, so they are served, matched and checked exactly as http:
// routes are. There is no server here to listen on, no host directory to
// serve and no second identity system: static, listen, mount and .auth()
// throw not_supported with slop's alternative.
(function (register) {
  'use strict';

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    throw e;
  }
  function notSupported(what, instead) {
    return function () { fail('not_supported', what + ' is not available on slop: ' + instead); };
  }

  const chain = []; // app.use middleware, in order
  const app = {
    use(fn) {
      if (typeof fn !== 'function') fail('invalid_argument', 'app.use takes a function (ctx, res, next)');
      chain.push(fn);
      return app;
    },
    route(method, pattern) { return needsSecurity(String(method).toUpperCase(), pattern); },
    all(pattern) { return needsSecurity('*', pattern); },
    static: notSupported('app.static', 'an actor has no host directory; serve files from the store (a page), or return {asset} from a route'),
    staticFromAssetsModule: notSupported('app.staticFromAssetsModule', 'serve files from the store'),
    spaFromAssetsModule: notSupported('app.spaFromAssetsModule', 'the store\'s page is the app'),
    mount: notSupported('app.mount', 'one store has one route table; mount another store instead'),
    mountHandler: notSupported('app.mountHandler', 'one store has one route table; mount another store instead'),
    listen: notSupported('app.listen', 'slop owns the server; an admin mounts the store'),
  };
  for (const m of ['get', 'head', 'post', 'put', 'patch', 'delete', 'options']) {
    app[m] = function (pattern) { return needsSecurity(m.toUpperCase(), pattern); };
  }

  // needsSecurity: a route must say who may call it before it gets a handler.
  function needsSecurity(method, pattern) {
    if (typeof pattern !== 'string') fail('invalid_argument', 'app.' + method.toLowerCase() + '(pattern) takes a pattern such as "/api/items/:id"');
    const spec = { method, pattern, level: '', audience: '' };
    const handler = {
      audience(group) { spec.audience = String(group); return handler; },
      handle(fn) {
        if (typeof fn !== 'function') fail('invalid_argument', '.handle takes a function (ctx, res)');
        register(spec.method, spec.pattern, spec.level, spec.audience, compile(fn));
      },
    };
    return {
      public() { spec.level = 'public'; return handler; },
      allow(level) { spec.level = String(level); return handler; },
      auth: notSupported('.auth()', 'use .allow(level) or .audience(group); identity comes from slop'),
    };
  }

  // compile turns (ctx, res) handlers and the app.use chain into the
  // route's run(ctx, req), which returns what http: routes return.
  function compile(fn) {
    return function run(ctx, req) {
      const res = newRes();
      const c = envelope(ctx, req);
      let i = 0;
      const next = function () {
        if (i < chain.length) return chain[i++](c, res, next);
        return fn(c, res);
      };
      const v = next();
      if (v && typeof v.then === 'function') return v.then(function (out) { return res.result(out); });
      return res.result(v);
    };
  }

  // envelope: the actor's ctx plus the request (go-go-goja's handler
  // context). Fields slop does not have throw at the line that reads them.
  function envelope(ctx, req) {
    const c = Object.create(ctx);
    const headers = req.headers || {};
    let body = req.body;
    if (body && /^application\/json\b/i.test(headers['content-type'] || '')) {
      try { body = JSON.parse(body); } catch (e) { fail('invalid_argument', 'the body is not JSON: ' + e.message); }
    }
    Object.defineProperties(c, {
      request: { value: { method: req.method, path: req.path, base: req.base, query: req.query || {}, headers }, enumerable: true },
      params: { value: req.params || {}, enumerable: true },
      query: { value: req.query || {}, enumerable: true },
      body: { value: body, enumerable: true },
      rawBody: { value: req.body, enumerable: true },
    });
    const missing = {
      cookies: 'slop resolves identity: read ctx.visitor',
      session: 'slop resolves identity: read ctx.visitor',
      auth: 'slop resolves identity: read ctx.visitor',
      actor: 'read ctx.visitor',
      ip: 'routes do not see client addresses; the mount\'s rate limits do',
      resources: 'there are no planned resources; read the store',
      resource: 'there are no planned resources; read the store',
    };
    for (const name of Object.keys(missing)) {
      Object.defineProperty(c, name, { get: notSupported('ctx.' + name, missing[name]), enumerable: false });
    }
    return c;
  }

  // newRes: a buffered response. One body; the route returns it when the
  // handler returns or its promise settles.
  function newRes() {
    let status = 200, answered = false, out = null;
    const headers = {};
    const res = {
      status(code) {
        const n = Number(code);
        if (!Number.isInteger(n) || n < 100 || n > 599) fail('invalid_argument', 'res.status takes an HTTP status code');
        status = n;
        return res;
      },
      set(name, value) { headers[String(name)] = String(value); return res; },
      type(value) { headers['Content-Type'] = String(value); return res; },
      json(v) { body({ json: v === undefined ? null : v }); },
      send(v) {
        if (typeof v === 'string') body({ text: v });
        else if (v === undefined || v === null) body({});
        else body({ json: v });
      },
      html(v) { body({ html: String(v) }); },
      redirect(a, b) {
        let code = 302, url = a;
        if (b !== undefined) { code = Number(a); url = b; }
        status = code;
        headers['Location'] = String(url);
        body({});
      },
      end() { body({}); },
      result(returned) {
        if (!answered) {
          if (typeof returned === 'string') res.send(returned);
          else if (returned === undefined) fail('invalid_state', 'the handler did not answer: call res.json, res.send, res.html, res.redirect or res.end');
          else fail('not_supported', 'a handler answers through res (res.json(value)); returning a value other than a string is not supported');
        }
        const r = Object.assign({ status, headers }, out);
        return r;
      },
    };
    function body(b) {
      if (answered) fail('invalid_state', 'the response was already sent');
      answered = true;
      out = b;
    }
    return res;
  }

  return { app() { return app; } };
})
