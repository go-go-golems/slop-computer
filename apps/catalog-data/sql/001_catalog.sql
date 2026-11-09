-- SLOP3-018: the francois catalog's data, in one store. The release
-- importer writes it through the actor's admin actions (upsertApp,
-- removeApp, importCatalog); every view reads it through the actor's
-- routes (/catalog.json, /apps, the feeds, MCP) or its catalog action.
--
-- apps.facts is the item as the views read it (catalog.json's item, without
-- its releases), so /catalog.json returns what the file did. The columns
-- and side tables are there for queries: filters, sorts and search.

CREATE TABLE apps (
  id TEXT PRIMARY KEY,                 -- the release store id
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT,
  published_at TEXT,                   -- ISO 8601, UTC, or NULL
  bytes INTEGER NOT NULL DEFAULT 0,
  free INTEGER NOT NULL,               -- 1: anyone; 0: subscribers
  featured INTEGER NOT NULL DEFAULT 0,
  search TEXT NOT NULL,                -- title, description, id and tags, lower case: what a query matches
  facts TEXT NOT NULL,                 -- the item (JSON)
  updated_at INTEGER NOT NULL          -- ms, the turn that wrote it
);
CREATE INDEX apps_published ON apps (published_at DESC, id DESC);

CREATE TABLE app_tags (
  app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (app, tag)
);
CREATE INDEX app_tags_tag ON app_tags (tag);

CREATE TABLE app_caps (
  app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  cap TEXT NOT NULL,
  PRIMARY KEY (app, cap)
);

CREATE TABLE releases (
  app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  published_at TEXT,
  changelog TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (app, version)
);

-- One row each: the catalog's rev (bumped by every write; the routes'
-- ETag), when it last changed, and the origins the views link to.
CREATE TABLE catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO catalog_meta (key, value) VALUES
  ('rev', '0'), ('updated', ''), ('source', 'https://slop.boutique'),
  ('appsOrigin', ''), ('siteOrigin', ''), ('api', ''), ('mcp', '');
