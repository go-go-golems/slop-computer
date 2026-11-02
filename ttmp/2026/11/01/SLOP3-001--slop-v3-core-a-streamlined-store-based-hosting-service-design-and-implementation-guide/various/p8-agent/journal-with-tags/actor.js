// The journal's actor: one per store that runs this app. Every handler below runs as a turn,
// one SQLite transaction; an await on real I/O ends the turn and a new one continues.
const sql = use('sql'), db = use('db'), room = use('room'), time = use('time');
const sample = use('sample'); // null unless the policy allows sample for this app (P6)

const MAX_TAGS = 10, MAX_TAG_LEN = 40;

// A tag is lowercase, has no leading '#', and uses '-' where the writer typed spaces.
function normalizeTag(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[,\u0000-\u001f\u007f]+/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LEN);
}

// args.tags may be "a, b" or ['a', 'b']; unknown shapes mean no tags.
function tagList(raw, ctx) {
  const parts = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',');
  const seen = new Set(), out = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  if (out.length > MAX_TAGS) ctx.fail('invalid_argument', `a draft may have at most ${MAX_TAGS} tags`);
  return out;
}

// Attach a tags array to rows returned by a query, keeping the writer's order.
function withTags(rows, idKey) {
  const ids = rows.map((r) => r[idKey]);
  const byPost = {};
  if (ids.length) {
    const holes = ids.map(() => '?').join(',');
    for (const t of sql.all(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${holes}) ORDER BY position, tag`, ...ids)) {
      (byPost[t.post_id] = byPost[t.post_id] || []).push(t.tag);
    }
  }
  return rows.map((r) => Object.assign({}, r, { tags: byPost[r[idKey]] || [] }));
}

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
    posts(ctx) {
      ctx.need('view');
      const rows = sql.all('SELECT id, title, body, author, published_at FROM published_posts ORDER BY published_at DESC LIMIT 50');
      return withTags(rows, 'id');
    },
    // Published posts that carry one tag; pages use this to filter the list.
    tagged(ctx, args) {
      ctx.need('view');
      const tag = normalizeTag(args && args.tag);
      if (!tag) return [];
      const rows = sql.all(`SELECT p.id, p.title, p.body, p.author, p.published_at
          FROM posts p JOIN post_tags t ON t.post_id = p.id
          WHERE t.tag = ? AND p.status = 'published'
          ORDER BY p.published_at DESC LIMIT 50`, tag);
      return withTags(rows, 'id');
    },
    drafts(ctx) {
      ctx.need('interact');
      const rows = sql.all('SELECT id, title, body, created_at FROM my_drafts ORDER BY created_at DESC');
      return withTags(rows, 'id');
    },
    draft(ctx, args) {
      ctx.need('interact');
      const title = String((args && args.title) || '').trim();
      if (!title) ctx.fail('invalid_argument', 'a draft needs a title');
      const tags = tagList(args && args.tags, ctx);
      const id = 'p_' + ctx.now.toString(36) + Math.random().toString(36).slice(2, 6);
      sql.run('INSERT INTO posts(id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)',
        id, title, String(args.body || ''), ctx.principal.id, ctx.now);
      tags.forEach((tag, i) => {
        sql.run('INSERT INTO post_tags(post_id, tag, position) VALUES (?, ?, ?)', id, tag, i);
      });
      return { id, tags };
    },
    publish(ctx, { id }) {
      ctx.need('interact');
      const p = sql.one('SELECT author, status FROM posts WHERE id = ?', id);
      if (!p) ctx.fail('not_found', 'no post ' + id);
      if (p.author !== ctx.principal.id) ctx.need('admin'); // only admins publish other people's drafts
      sql.run("UPDATE posts SET status = 'published', published_at = ? WHERE id = ?", ctx.now, id);
      room.emit('published', { id });
      return { ok: true };
    },
    // An await ends the turn: the title change commits now, the publish commits after the sleep.
    async slowPublish(ctx, { id, delayMs }) {
      ctx.need('interact');
      sql.run("UPDATE posts SET title = title || ' (scheduled)' WHERE id = ? AND status = 'draft'", id);
      await time.sleep(delayMs || 60000);
      sql.run("UPDATE posts SET status = 'published', published_at = ?, title = replace(title, ' (scheduled)', '') WHERE id = ?", ctx.now, id);
      room.emit('published', { id });
      return { ok: true, publishedAt: ctx.now };
    },
    async summarize(ctx, { id }) {
      ctx.need('admin');
      if (!sample) ctx.fail('permission_denied', 'sample is not allowed for this app');
      const p = sql.one('SELECT title, body FROM posts WHERE id = ?', id);
      if (!p) ctx.fail('not_found', 'no post ' + id);
      const r = await sample('Summarize this blog post in one plain sentence.\n\n' + p.title + '\n\n' + p.body);
      sql.run('UPDATE posts SET body = body || ? WHERE id = ?', '\n\nIn short: ' + r.text.trim(), id);
      return r.text;
    },
  },

  http: {
    'GET /feed.json': { level: 'public', run(ctx) {
      const items = withTags(sql.all("SELECT id, title, author, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 20"), 'id');
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
