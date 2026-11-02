-- Tags for posts. A post has any number of tags; each is stored once per post.
-- 001_posts.sql is left untouched: this migration adds the table and its index.
CREATE TABLE post_tags(
  post_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, tag)
);

-- The tagged action looks posts up by tag.
CREATE INDEX post_tags_tag ON post_tags(tag, post_id);
