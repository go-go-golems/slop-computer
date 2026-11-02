// Identity and access: level(), rules, capabilities and can() with a readable trace (section 9).
import { lv, LEVELS, maxLevel, minLevel, err, segs } from './util.js';

export const ALWAYS_ON = new Set(['sql', 'files', 'log', 'alarm', 'time', 'ui', 'actions', 'stores', 'permissions', 'user', 'slop']);
export const NEEDS_APPROVAL = new Set(['sample', 'mcp', 'fetch', 'secrets', 'spawn', 'platform']);
const KIND_CAP = { guest: 'interact', link: 'interact', anon: 'view' };

export class Access {
  constructor(kernel) { this.k = kernel; }
  sys() { return this.k.system.db; }
  principal(id) {
    if (id === 'system') return { id, kind: 'system', name: 'system', role: 'admin' };
    if (id === 'anon') return { id, kind: 'anon', name: 'Anonymous', role: 'none' };
    if (typeof id === 'string' && id.startsWith('app:')) return { id, kind: 'app', name: id, role: 'none' };
    const p = this.sys().kone('SELECT * FROM principals WHERE id = ?', [id]);
    if (!p) throw err('not_found', `no principal ${id}`);
    return p;
  }
  principals() { return this.sys().kall('SELECT * FROM principals ORDER BY CASE kind WHEN \'user\' THEN 0 WHEN \'token\' THEN 1 WHEN \'guest\' THEN 2 ELSE 3 END, id'); }
  who(p) { return (p.kind === 'token' || p.kind === 'delegate') && p.user_id ? this.principal(p.user_id) : p; }

  level(p, storeId) {
    const trace = [];
    if (p.kind === 'system') return { level: 'owner', trace: ['system acts with every level'] };
    const who = this.who(p);
    if (who !== p) trace.push(`${p.id} acts for ${who.id}`);
    const st = this.sys().kone('SELECT owner, app FROM stores WHERE id = ?', [storeId]);
    if (!st) throw err('not_found', `no store ${storeId}`);
    if (p.kind === 'app') {
      // An app's actor acts as app:<app>. It is admin in the stores that run it; elsewhere it holds
      // what grants give it: grants to app:<app>, and *anyone (public stores are readable by apps too).
      if (st.app === p.id.slice(4)) return { level: 'admin', trace: [`${p.id} is the code ${storeId} runs: admin`] };
      const gs = this.sys().kall("SELECT subject, level, via FROM grants WHERE store = ? AND subject IN (?, '*anyone')", [storeId, p.id]);
      let l = 'none'; for (const g of gs) { trace.push(`grant ${g.subject} ${g.level} (${g.via})`); l = maxLevel(l, g.level); }
      if (!gs.length) trace.push(`no grant to ${p.id} or *anyone on ${storeId}; fix: grant ${storeId} ${p.id} view`);
      return { level: l, trace };
    }
    // SLOP3-007: the level is the max over every source, then the min over
    // every ceiling, with no other branch (as pkg/access.Level in Go). A
    // pending user is guest-like: in *anyone only, at most interact.
    let level = 'none';
    const source = (l, why) => { trace.push(why); level = maxLevel(level, l); };
    if (who.kind === 'user' && who.role === 'admin') source('admin', 'platform admin: admin on every store');
    if (st.owner === who.id) source('owner', `${who.id} created ${storeId}: owner`);
    const subjects = [who.id, '*anyone'];
    if (who.kind === 'user' && (who.role === 'member' || who.role === 'admin')) subjects.push('*signed-in');
    const gs = this.sys().kall(`SELECT subject, level, via FROM grants WHERE store = ? AND subject IN (${subjects.map(() => '?').join(',')})`, [storeId, ...subjects]);
    // a grant gives at most admin: owner comes only from creating the store
    for (const g of gs) source(minLevel(g.level, 'admin'), `grant ${g.subject} ${g.level} (${g.via})`);
    if (!gs.length && level === 'none') trace.push('no grant reaches this principal');
    const ceilings = [];
    if (who.kind === 'user' && who.role === 'disabled') ceilings.push(['none', `${who.id} is disabled`]);
    if (who.kind === 'user' && who.role === 'pending') ceilings.push(['interact', `${who.id} is pending: guest-like`]);
    if (p.kind === 'token') ceilings.push([p.max_level || 'admin', 'token']);
    if (KIND_CAP[who.kind]) ceilings.push([KIND_CAP[who.kind], who.kind]);
    for (const [cap, why] of ceilings) {
      if (lv(level) > lv(cap)) { trace.push(`${why} capped at ${cap}`); level = minLevel(level, cap); }
    }
    return { level, trace };
  }

  // Document rules: contract shape, deepest matching rule wins, {self} = acting user.
  docRule(manifest, path, op, whoId) {
    const s = segs(path);
    const rules = ((manifest && manifest.capabilities && manifest.capabilities.db && manifest.capabilities.db.rules) || []).slice();
    rules.push({ path: 'data/users/{self}', read: 'interact', write: 'interact', builtin: true });
    let best = null, bestLen = -1, hiddenByOther = false;
    if (s[0] === 'data' && s[1] === 'users' && s[2] && s[2] !== whoId) hiddenByOther = true;
    for (const r of rules) {
      const rs = r.path.split('/');
      if (rs.length > s.length) continue;
      let ok = true;
      for (let i = 0; i < rs.length; i++) {
        if (rs[i] === '*') continue;
        if (rs[i] === '{self}') { if (s[i] !== whoId) { ok = false; break; } continue; }
        if (rs[i] !== s[i]) { ok = false; break; }
      }
      if (ok && rs.length > bestLen && r[op]) { best = r; bestLen = rs.length; }
    }
    if (hiddenByOther) return { need: 'self', rule: 'data/users/{self}', note: `{self} = ${whoId}, path owner = ${s[2]}`, hidden: true };
    if (best) return { need: best[op], rule: best.path + (best.builtin ? ' (built in)' : ''), note: null, hidden: best[op] === 'self' };
    return { need: op === 'read' ? 'view' : 'interact', rule: `default ${op}`, note: null };
  }

  // can(p, store, op, target): {ok, code, level, need, trace}
  can(p, storeId, op, target, { manifest, version } = {}) {
    const trace = [];
    if (p.kind === 'system') return { ok: true, trace: ['system'] };
    const { level, trace: lt } = this.level(p, storeId);
    trace.push(...lt.map(x => '· ' + x), `level ${level}`);
    const who = this.who(p);
    let need = 'view', code = 'permission_denied', hidden = false, cap = null;
    switch (op) {
      case 'doc.read': case 'doc.write': {
        const r = this.docRule(manifest, target, op === 'doc.read' ? 'read' : 'write', who.id);
        need = r.need; hidden = r.hidden && op === 'doc.read'; cap = 'db';
        trace.push(`rule ${r.rule}: ${op === 'doc.read' ? 'read' : 'write'} needs ${need}${r.note ? ' — ' + r.note : ''}`);
        break;
      }
      case 'sql.read': {
        const ex = manifest && manifest.slop && manifest.slop.sql && manifest.slop.sql.expose && manifest.slop.sql.expose[target];
        cap = 'sql';
        if (!ex || !ex.read) { trace.push(`"${target}" is not in slop.sql.expose`); return { ok: false, code: 'permission_denied', level, need: 'exposed', trace }; }
        need = ex.read; trace.push(`expose ${target}: read needs ${need}`); break;
      }
      case 'sql.admin': need = 'admin'; trace.push('raw SQL needs admin'); break;
      case 'files.read': need = 'view'; trace.push('reading the tree needs view'); break;
      case 'files.write': case 'platform': case 'refs.write': need = 'admin'; trace.push(`${op} needs admin`); break;
      case 'room.emit': need = target || 'admin'; trace.push(`topic needs ${need}`); cap = 'room'; break;
      case 'call': need = 'view'; trace.push('calling an action needs view; the action decides the rest'); break;
      default: need = target || 'view';
    }
    if (lv(level) < lv(need) || need === 'self') {
      code = hidden ? 'not_found' : 'permission_denied';
      trace.push(`✗ ${level} < ${need}` + (hidden ? ' → not_found (hidden reads look missing)' : ''));
      return { ok: false, code, level, need, trace };
    }
    trace.push(`✓ ${level} ≥ ${need}`);
    if (cap) {
      const c = this.capability(cap, manifest, version, p);
      trace.push(c.ok ? `✓ capability ${cap}: ${c.why}` : `✗ capability ${cap}: ${c.why}`);
      if (!c.ok) return { ok: false, code: c.code || 'permission_denied', level, need, trace };
    }
    return { ok: true, level, need, trace };
  }

  capability(name, manifest, version, p) {
    if (ALWAYS_ON.has(name)) return { ok: true, why: 'always on' };
    const caps = (manifest && manifest.capabilities) || {};
    const slop = (manifest && manifest.slop) || {};
    if (!(name in caps) && !(name in slop)) return { ok: false, why: 'not declared in app.json' };
    if (p && (p.kind === 'guest' || p.kind === 'anon') && (name === 'sample' || name === 'mcp' || name === 'comments' || name === 'assets')) return { ok: false, why: `not offered to ${p.kind}s` };
    if (NEEDS_APPROVAL.has(name)) {
      const a = manifest && manifest.__app ? this.sys().kone('SELECT caps FROM approvals WHERE app = ? AND version = ?', [manifest.__app, version]) : null;
      if (!a || !JSON.parse(a.caps).includes(name)) return { ok: false, why: `needs an admin's approval of this version`, code: 'permission_denied' };
      return { ok: true, why: 'declared and approved' };
    }
    return { ok: true, why: 'declared' };
  }

  levels() { return LEVELS; }
}
