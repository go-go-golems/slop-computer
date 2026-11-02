-- Posts: the actor writes them; pages read them through the two views below.
CREATE TABLE posts(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX posts_status ON posts(status, published_at);

-- Pages read these through the actor (actions posts and drafts).
CREATE VIEW published_posts AS
  SELECT id, title, body, author, published_at FROM posts WHERE status = 'published';

-- slop_principal() is whoever is reading, so each person sees only their own drafts.
CREATE VIEW my_drafts AS
  SELECT id, title, body, created_at FROM posts WHERE status = 'draft' AND author = slop_principal();
