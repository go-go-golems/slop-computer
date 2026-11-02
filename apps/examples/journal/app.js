// The journal's page. It reads posts through the actor's actions and refreshes when stats/main
// changes (the reactor rewrites it on every commit to posts). It changes things only through actions.
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const say = (text, bad) => { $('msg').textContent = text; $('msg').className = 'msg' + (bad ? ' bad' : ''); };
  const when = (ms) => ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

  const [db, user, room, slop] = await Promise.all(['db', 'user', 'room', 'slop'].map((n) => claude.use(n)));
  if (!slop) { say('This page needs the slop runtime.', true); return; }
  const me = user ? await user.me() : null;
  $('who').textContent = me ? `${me.name || 'Guest'} · ${me.level}` : 'signed out';
  const canWrite = !!me && ['interact', 'admin', 'owner'].includes(me.level);
  $('compose').hidden = !canWrite;

  const names = {};
  async function nameAll(ids) {
    const missing = ids.filter((id) => !(id in names));
    if (missing.length && user) Object.entries(await user.profiles(missing)).forEach(([id, p]) => { names[id] = p.name || 'Someone'; });
  }

  async function refresh() {
    try {
      const rows = await slop.actions.posts();
      await nameAll(rows.map((r) => r.author));
      $('posts').innerHTML = rows.length ? rows.map((r) => `<li><h3>${esc(r.title)}</h3><p class="meta">${esc(names[r.author] || 'Someone')} · ${when(r.published_at)}</p>${r.body ? `<p>${esc(r.body).replace(/\n/g, '<br>')}</p>` : ''}</li>`).join('') : '<li class="dim">Nothing published yet.</li>';
      if (!canWrite) return;
      const drafts = await slop.actions.drafts();
      $('drafts').innerHTML = drafts.length ? drafts.map((r) => `<li><b>${esc(r.title)}</b> <span class="row"><button data-pub="${esc(r.id)}">Publish</button><button data-slow="${esc(r.id)}">Publish in a minute</button></span></li>`).join('') : '<li class="dim">None yet.</li>';
    } catch (e) { say(`${e.code || 'error'}: ${e.message}`, true); }
  }

  if (db) db.doc('stats/main').onSnapshot((s) => {
    const d = s.data() || {};
    $('stats').innerHTML = `<b>${d.published || 0}</b> published · <b>${d.drafts || 0}</b> drafts · <b>${d.words || 0}</b> words`;
    refresh();
  }, (e) => say(e.message, true));
  else refresh();

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-pub], button[data-slow]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.pub) { await slop.actions.publish({ id: b.dataset.pub }); say('Published.'); }
      else { say('Scheduled: the first turn committed; the rest runs after a minute.'); await slop.actions.slowPublish({ id: b.dataset.slow, delayMs: 60000 }); say('Published, a minute later.'); }
    } catch (e) { say(`${e.code || 'error'}: ${e.message}`, true); b.disabled = false; }
  });

  $('draft').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await slop.actions.draft({ title: $('title').value, body: $('body').value });
      $('title').value = ''; $('body').value = ''; say('Draft saved.');
    } catch (e) { say(`${e.code || 'error'}: ${e.message}`, true); }
  });

  if (room) {
    room.on('published', () => say('A post was just published.'));
    room.onPeers((peers) => { $('peers').textContent = peers.length > 1 ? `${peers.length} people here` : ''; });
  }
})();
