// The journal's actor: one per store that runs this app. Every handler below runs as a turn,
// one SQLite transaction; an await on real I/O ends the turn and a new one continues.
const sql = use('sql'), db = use('db'), room = use('room'), time = use('time');
const sample = use('sample'); // null unless the policy allows sample for this app (P6)

defineActor({
  // Runs at activation, in the same transaction as the migrations. A throw rolls everything back.
  setup(ctx) {
    if (!db.doc('stats/main').get().exists) db.doc('stats/main').set({ published: 0, drafts: 0, words: 0 });
  },
  smoke(ctx) {
    sql.one('SELECT count(*) AS n FROM published_posts');
  },

  actions: {
    // Pages read posts through these two actions; stats/main changes on every commit to posts.
    posts: {
      requires: 'view',
      run(ctx) {
        return sql.all('SELECT id, title, body, author, published_at FROM published_posts ORDER BY published_at DESC LIMIT 50');
      },
    },
    drafts: {
      requires: 'interact',
      run(ctx) {
        return sql.all('SELECT id, title, body, created_at FROM my_drafts ORDER BY created_at DESC');
      },
    },
    draft: {
      requires: 'interact',
      run(ctx, args) {
        const title = String((args && args.title) || '').trim();
        if (!title) ctx.fail('invalid_argument', 'a draft needs a title');
        const id = 'p_' + ctx.now.toString(36) + Math.random().toString(36).slice(2, 6);
        sql.run('INSERT INTO posts(id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)',
          id, title, String(args.body || ''), ctx.principal.id, ctx.now);
        return { id };
      },
    },
    publish: {
      requires: 'interact',
      run(ctx, { id }) {
        const p = sql.one('SELECT author, status FROM posts WHERE id = ?', id);
        if (!p) ctx.fail('not_found', 'no post ' + id);
        if (p.author !== ctx.principal.id) ctx.need('admin'); // only admins publish other people's drafts
        sql.run("UPDATE posts SET status = 'published', published_at = ? WHERE id = ?", ctx.now, id);
        room.emit('published', { id });
        return { ok: true };
      },
    },
    // An await ends the turn: the title change commits now, the publish commits after the sleep.
    slowPublish: {
      requires: 'interact',
      async run(ctx, { id, delayMs }) {
        sql.run("UPDATE posts SET title = title || ' (scheduled)' WHERE id = ? AND status = 'draft'", id);
        await time.sleep(delayMs || 60000);
        sql.run("UPDATE posts SET status = 'published', published_at = ?, title = replace(title, ' (scheduled)', '') WHERE id = ?", ctx.now, id);
        room.emit('published', { id });
        return { ok: true, publishedAt: ctx.now };
      },
    },
    summarize: {
      requires: 'admin',
      async run(ctx, { id }) {
        if (!sample) ctx.fail('permission_denied', 'sample is not allowed for this app');
        const p = sql.one('SELECT title, body FROM posts WHERE id = ?', id);
        if (!p) ctx.fail('not_found', 'no post ' + id);
        const r = await sample('Summarize this blog post in one plain sentence.\n\n' + p.title + '\n\n' + p.body);
        sql.run('UPDATE posts SET body = body || ? WHERE id = ?', '\n\nIn short: ' + r.text.trim(), id);
        return r.text;
      },
    },
  },

  http: {
    'GET /feed.json': { level: 'public', run(ctx) {
      const items = sql.all("SELECT id, title, author, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 20");
      return { status: 200, json: { title: 'Journal', updated: ctx.now, items } };
    } },
  },

  // Reactors are synchronous and run exactly once per commit, in order, from a cursor.
  on: {
    'table:posts'(ctx, commit) {
      const s = sql.one(`SELECT
          coalesce(sum(status = 'published'), 0) AS published,
          coalesce(sum(status = 'draft'), 0) AS drafts,
          coalesce(sum(CASE WHEN length(trim(body)) = 0 THEN 0 ELSE length(trim(body)) - length(replace(trim(body), ' ', '')) + 1 END), 0) AS words
        FROM posts`);
      db.doc('stats/main').set({ published: s.published, drafts: s.drafts, words: s.words, asOfRev: commit.rev });
    },
  },

  // Alarms are at-least-once. ctx.event.late is true when the alarm was missed (the server was down).
  every: {
    digest: { every: '1h', run(ctx) {
      const n = sql.one("SELECT count(*) AS n FROM posts WHERE status = 'published' AND published_at > ?", ctx.now - 3600000).n;
      db.doc('digests/' + ctx.now).set({ at: ctx.now, publishedLastHour: n, late: ctx.event.late });
    } },
  },
});
