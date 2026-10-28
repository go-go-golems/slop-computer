/* api.js · a fake slop.computer API, in the browser.
   The same calls the real server will answer (artifacts, versions, refs, routes, comments, people, tokens, audit,
   events), kept in memory and seeded from seed.js. Every change is an op; ops are kept in this browser and replayed
   over the seed on load, so your comments and pushes survive a reload. reset() drops them. */
(function () {
  'use strict';
  const KEY = 'slopcomputer:a:ops:v1', CKEY = 'slopcomputer:a:console:v1';
  let S = null;
  const subs = new Map();
  const emit = (type, payload) => {
    for (const k of [type, '*']) (subs.get(k) || []).slice().forEach(fn => { try { fn(payload, type); } catch (e) { console.error(e); } });
  };
  const store = {
    read(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    drop(k) { try { localStorage.removeItem(k); } catch (e) { /* storage may be unavailable */ } },
  };

  // a short content hash, shown where the real server would show sha256
  const hash = s => { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };

  // ------------------------------------------------------------------ apply one op to the state
  function apply(op) {
    switch (op.t) {
      case 'push': {
        let a = S.artifacts[op.artifact];
        if (!a) {
          a = S.artifacts[op.artifact] = Object.assign({ id: op.artifact, refs: {}, versions: [], created: op.at }, op.create);
        }
        const base = op.base ? a.versions.find(v => v.n === op.base) : null;
        const filesOut = Object.assign({}, base ? base.files : {}, op.files);
        (op.remove || []).forEach(p => delete filesOut[p]);
        const v = { n: op.n, files: filesOut, manifest: op.manifest || (base ? base.manifest : {}), message: op.message, by: op.by, via: op.via, session: op.session || null, at: op.at, reply: op.reply || null };
        a.versions.push(v);
        if (op.moveMain !== false) a.refs.main = v.n;
        S.audit.unshift({ at: op.at, actor: op.by, via: op.via === 'claude' ? 'claude code agent' : op.via === 'browser' ? 'browser' : 'cli', action: 'version.push', subject: `${a.id} v${v.n}` });
        return { artifact: a, version: v };
      }
      case 'route.set': {
        const i = S.routes.findIndex(r => r.host === op.route.host && r.path === op.route.path);
        const prev = i >= 0 ? Object.assign({}, S.routes[i]) : null;
        if (i >= 0) S.routes[i] = op.route; else S.routes.push(op.route);
        S.routeLog.unshift({ host: op.route.host, path: op.route.path, at: op.at, by: op.by, to: { version: op.route.version, page: op.route.page }, from: prev ? { version: prev.version, page: prev.page } : null, note: op.note || '' });
        S.audit.unshift({ at: op.at, actor: op.by, via: 'browser', action: 'route.set', subject: `${op.route.host}${op.route.path} → ${op.route.page}${op.route.version ? ' v' + op.route.version : ' (main)'}` });
        return { route: op.route, prev };
      }
      case 'route.remove': {
        const i = S.routes.findIndex(r => r.host === op.host && r.path === op.path);
        if (i < 0) return null;
        const [gone] = S.routes.splice(i, 1);
        S.routeLog.unshift({ host: op.host, path: op.path, at: op.at, by: op.by, to: null, from: { version: gone.version, page: gone.page }, note: 'removed' });
        S.audit.unshift({ at: op.at, actor: op.by, via: 'browser', action: 'route.remove', subject: `${op.host}${op.path}` });
        return { route: gone };
      }
      case 'thread.create': {
        S.threads.push(op.thread);
        S.audit.unshift({ at: op.at, actor: op.thread.by, via: 'browser', action: 'comment.create', subject: `${op.thread.artifact} v${op.thread.version}` });
        return { thread: op.thread };
      }
      case 'thread.reply': {
        const th = S.threads.find(x => x.id === op.id); if (!th) return null;
        th.comments.push(op.comment);
        return { thread: th, comment: op.comment };
      }
      case 'thread.resolve': {
        const th = S.threads.find(x => x.id === op.id); if (!th) return null;
        th.resolved = op.resolved; th.resolvedBy = op.by; th.resolvedAt = op.at;
        return { thread: th };
      }
      case 'user.role': {
        const u = S.users.find(x => x.id === op.id); if (!u) return null;
        const from = u.role; u.role = op.role;
        S.audit.unshift({ at: op.at, actor: op.by, via: 'browser', action: 'user.role', subject: `${u.name}: ${from} → ${op.role}` });
        return { user: u };
      }
      case 'token.revoke': {
        const t = S.tokens.find(x => x.id === op.id); if (!t) return null;
        t.revoked = op.at;
        S.audit.unshift({ at: op.at, actor: op.by, via: 'browser', action: 'token.revoke', subject: t.name });
        return { token: t };
      }
      case 'token.create': {
        S.tokens.unshift(op.token);
        S.audit.unshift({ at: op.at, actor: op.by, via: 'browser', action: 'token.create', subject: `${op.token.name} (${op.token.scopes.join(', ')})` });
        return { token: op.token };
      }
    }
    return null;
  }
  function commit(op) {
    op.at = op.at || Date.now();
    const out = apply(op);
    const ops = store.read(KEY, []); ops.push(op); store.write(KEY, ops);
    emit(op.t, Object.assign({ op }, out || {}));
    return out;
  }

  function load() {
    S = window.SLOP_SEED(Date.now());
    for (const op of store.read(KEY, [])) { try { apply(op); } catch (e) { console.warn('skipped op', op.t, e); } }
    S.console = S.console.concat(store.read(CKEY, []));
  }

  // ------------------------------------------------------------------ routing
  function match(pattern, path) {
    if (pattern === '*') return {};
    const ps = pattern.split('/').filter(Boolean), xs = path.split('/').filter(Boolean);
    const params = {};
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === '*') { params['*'] = xs.slice(i).join('/'); return params; }
      if (i >= xs.length) return null;
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(xs[i]);
      else if (p !== xs[i]) return null;
    }
    return xs.length === ps.length ? params : null;
  }
  const specificity = r => r.path === '*' ? -1 : r.path.split('/').filter(Boolean).reduce((n, s) => n + (s === '*' ? 1 : s.startsWith(':') ? 2 : 3), 0);
  function versionOf(id, pinned) {
    const a = S.artifacts[id]; if (!a) return null;
    const n = pinned || a.refs.main;
    return a.versions.find(v => v.n === n) || null;
  }
  // which data each name means for a page version, given a route's overrides
  function bindingsFor(pageVersion, route) {
    const out = {}, reads = (pageVersion && pageVersion.manifest && pageVersion.manifest.reads) || {};
    for (const [name, artifact] of Object.entries(reads)) out[name] = { artifact, version: null };
    if (pageVersion && pageVersion.manifest && pageVersion.manifest.tokens) out.$tokens = { artifact: pageVersion.manifest.tokens, version: null };
    for (const [name, b] of Object.entries((route && route.bindings) || {})) out[name] = Object.assign({}, out[name] || {}, b);
    for (const b of Object.values(out)) { const v = versionOf(b.artifact, b.version); b.n = v ? v.n : null; }
    return out;
  }
  function resolve(host, path) {
    path = '/' + String(path || '/').replace(/^\/+/, '').replace(/[?#].*$/, '');
    const rows = S.routes.filter(r => r.host === host).sort((a, b) => specificity(b) - specificity(a));
    for (const r of rows) {
      const params = match(r.path, path);
      if (!params) continue;
      const v = versionOf(r.page, r.version);
      const record = r.record ? r.record.replace(/\{(\w+)\}/g, (_, k) => params[k] || '') : null;
      return { route: r, params, path, host, page: r.page, n: v ? v.n : null, version: v, bindings: bindingsFor(v, r), record, fallback: r.path === '*' };
    }
    return null;
  }

  // ------------------------------------------------------------------ public surface
  const api = window.slop = {
    hash,
    state: () => S,
    on(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); return () => api.off(type, fn); },
    off(type, fn) { const l = subs.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    emit,
    reset() { store.drop(KEY); store.drop(CKEY); load(); emit('reset', {}); },

    users: {
      list: () => S.users,
      get: id => S.users.find(u => u.id === id) || null,
      setRole: (id, role, by) => commit({ t: 'user.role', id, role, by }),
    },
    projects: { list: () => S.projects, get: id => S.projects.find(p => p.id === id) || null },
    agents: { list: () => S.agents },

    artifacts: {
      list: () => Object.values(S.artifacts),
      get: id => S.artifacts[id] || null,
      latest: id => { const a = S.artifacts[id]; return a ? a.versions[a.versions.length - 1] : null; },
    },
    versions: {
      list: id => (S.artifacts[id] ? S.artifacts[id].versions : []),
      get: (id, n) => versionOf(id, n),
      main: id => versionOf(id, null),
    },
    // push: { files (changed files only), base, message, by, via, session, reply, create, manifest, remove }
    push(id, o) {
      const a = S.artifacts[id];
      const n = a ? Math.max(...a.versions.map(v => v.n)) + 1 : 1;
      const base = o.base === undefined ? (a ? a.refs.main : null) : o.base;
      return commit({ t: 'push', artifact: id, n, base, files: o.files || {}, remove: o.remove, manifest: o.manifest, message: o.message, by: o.by, via: o.via || 'browser', session: o.session, reply: o.reply, create: a ? null : o.create, moveMain: o.moveMain });
    },

    routes: {
      list: host => S.routes.filter(r => !host || r.host === host),
      hosts: () => [...new Set(S.routes.map(r => r.host))],
      get: (host, path) => S.routes.find(r => r.host === host && r.path === path) || null,
      set: (route, by, note) => commit({ t: 'route.set', route: Object.assign({ bindings: {}, record: null, access: 'public', version: null }, route, { changedBy: by, changedAt: Date.now() }), by, note }),
      remove: (host, path, by) => commit({ t: 'route.remove', host, path, by }),
      log: (host, path) => S.routeLog.filter(l => l.host === host && l.path === path).sort((x, y) => y.at - x.at),
      using: id => S.routes.filter(r => r.page === id),
      readers: id => S.routes.filter(r => { const v = versionOf(r.page, r.version); const b = bindingsFor(v, r); return Object.values(b).some(x => x.artifact === id); }),
      resolve,
      bindingsFor,
      match,
    },

    comments: {
      list: id => S.threads.filter(t => !id || t.artifact === id),
      get: tid => S.threads.find(t => t.id === tid) || null,
      create(id, o) {
        const thread = { id: 'th_' + Math.random().toString(36).slice(2, 5) + Date.now().toString(36).slice(-2), artifact: id, version: o.version, anchor: o.anchor, by: o.by, at: Date.now(), resolved: false, comments: [{ by: o.by, at: Date.now(), text: o.text }] };
        return commit({ t: 'thread.create', thread });
      },
      reply: (tid, o) => commit({ t: 'thread.reply', id: tid, comment: { by: o.by, agent: !!o.agent, at: Date.now(), text: o.text, version: o.version || null } }),
      resolve: (tid, by, resolved) => commit({ t: 'thread.resolve', id: tid, by, resolved: resolved !== false }),
    },

    tokens: {
      list: () => S.tokens,
      revoke: (id, by) => commit({ t: 'token.revoke', id, by }),
      create(o) {
        const secret = 'slp_' + Array.from({ length: 28 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
        const token = { id: 'tok_' + Date.now().toString(36), owner: o.by, name: o.name, scopes: o.scopes, created: Date.now(), lastUsed: null, expires: Date.now() + o.days * 86400e3 };
        commit({ t: 'token.create', token, by: o.by });
        return { token, secret };
      },
    },
    audit: { list: () => S.audit },

    console: {
      list: () => S.console,
      add(line) {
        line.at = line.at || Date.now();
        S.console.push(line);
        const saved = store.read(CKEY, []); saved.push(line); store.write(CKEY, saved.slice(-300));
        emit('console', line);
      },
    },
  };

  load();
})();
