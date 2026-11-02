// The starting world: principals, two apps, three data stores, grants and mounts.
import J_APP from './journal/app.json.txt';
import J_SQL from './journal/001_posts.sql.txt';
import J_ACTOR from './journal/actor.js.txt';
import J_HTML from './journal/index.html.txt';
import J_JS from './journal/app.js.txt';
import J_CSS from './journal/style.css.txt';
import J_README from './journal/README.md.txt';
import T_APP from './tracker/app.json.txt';
import T_HTML from './tracker/index.html.txt';

export const PRINCIPALS = [
  { id: 'usr_me', kind: 'user', name: 'You', role: 'admin' },
  { id: 'usr_ramon', kind: 'user', name: 'Ramon', role: 'member' },
  { id: 'usr_kim', kind: 'user', name: 'Kim', role: 'member' },
  { id: 'gst_ana', kind: 'guest', name: 'Ana (guest)', role: 'member' },
  { id: 'tok_agent', kind: 'token', name: 'agent token', role: 'none', user_id: 'usr_me', max_level: 'admin' },
  { id: 'tok_ci', kind: 'token', name: 'read-only CI token', role: 'none', user_id: 'usr_me', max_level: 'view' },
];

export async function seed(k) {
  const sys = k.system.db, now = k.clock.now;
  for (const p of PRINCIPALS) sys.krun('INSERT INTO principals(id, kind, name, role, user_id, max_level, created_at) VALUES (?,?,?,?,?,?,?)', [p.id, p.kind, p.name, p.role, p.user_id || null, p.max_level || null, now]);
  const me = k.access.principal('usr_me');
  const as = (id) => k.access.principal(id);
  const files = (store, list) => k.turn({ store, principal: me, via: 'cli', kind: 'files', label: `seed ${store} files` }, (t) => { for (const [path, text] of list) k.store(store).writeFile(t, path, text); });

  // Apps are stores whose tree has app.json.
  k.createStore(me, { id: 'journal', type: 'app' });
  files('journal', [['app.json', J_APP], ['sql/001_posts.sql', J_SQL], ['actor.js', J_ACTOR], ['index.html', J_HTML], ['app.js', J_JS], ['style.css', J_CSS], ['README.md', J_README]]);
  k.publish(me, 'journal', 'first version');
  k.createStore(me, { id: 'tracker', type: 'app' });
  files('tracker', [['app.json', T_APP], ['index.html', T_HTML]]);
  k.publish(me, 'tracker', 'first version');

  // Data stores run an app's main version.
  k.createStore(me, { id: 'blog', type: 'journal', app: 'journal' });
  k.activate('blog');
  k.createStore(me, { id: 'team-board', type: 'tracker', app: 'tracker' });
  k.activate('team-board');

  const grant = (store, subject, level) => sys.krun("INSERT INTO grants(store, subject, level, via, created_by, created_at) VALUES (?,?,?,'direct','usr_me',?)", [store, subject, level, now]);
  grant('blog', '*anyone', 'view'); grant('blog', 'usr_ramon', 'interact'); grant('blog', 'gst_ana', 'interact');
  grant('team-board', '*signed-in', 'interact'); grant('team-board', 'gst_ana', 'view');
  grant('journal', '*signed-in', 'view'); grant('tracker', '*signed-in', 'view');
  sys.krun("INSERT INTO instantiate(app, subject) VALUES ('tracker', '*signed-in')");

  k.setMount(me, { host: 'site.lab', path: '/', store: 'blog', mode: 'live' });
  k.setMount(me, { host: 'site.lab', path: '/board', store: 'team-board', mode: 'live' });
  k.setMount(me, { host: 'site.lab', path: '/t/:board', store_param: 'board', type: 'tracker', on_missing: 'create', create_app: 'tracker', mode: 'live' });

  // Some history, made through the same doors people use.
  const ramon = as('usr_ramon');
  const a = await k.callAction(me, 'blog', 'draft', { title: 'Stores are the unit', body: 'One SQLite file per store: documents, files, tables, the log and snapshots. Copy the file and you have copied the thing.' });
  await k.callAction(me, 'blog', 'publish', { id: a.id });
  const b = await k.callAction(ramon, 'blog', 'draft', { title: 'Turns, not requests', body: 'Every event is one transaction. An await on real I/O ends the turn.' });
  await k.callAction(ramon, 'blog', 'publish', { id: b.id });
  await k.callAction(ramon, 'blog', 'draft', { title: 'Half-written thoughts on mounts', body: 'Mounts name stores, never code.' });
  const card = (by, text, col, i) => k.turn({ store: 'team-board', principal: as(by), via: 'page', kind: 'write', label: `db set cards/c${i}`, app: 'tracker@1' }, (t) => k.store('team-board').setDoc(t, `cards/c${i}`, { text, col, by, at: now + i }));
  card('usr_me', 'Port the kernel to Go', 'todo', 1);
  card('usr_ramon', 'Authorizer table per caller kind', 'doing', 2);
  card('usr_kim', 'Reactor cursors survive restore', 'todo', 3);
  card('usr_me', 'Spike: sqlite-wasm + QuickJS in a worker', 'done', 4);
  k.turn({ store: 'team-board', principal: me, via: 'page', kind: 'write', label: 'db set settings/board', app: 'tracker@1' }, (t) => k.store('team-board').setDoc(t, 'settings/board', { name: 'v3 kernel' }));
  k.turn({ store: 'team-board', principal: me, via: 'page', kind: 'write', label: 'db set data/users/usr_me/notes', app: 'tracker@1' }, (t) => k.store('team-board').setDoc(t, 'data/users/usr_me/notes', { text: 'Only I can read this, even though Ramon is admin-adjacent.' }));
  k.dirty = new Set(k.stores.keys());
}
