-- Inspect previews (SLOP3-002): one sandbox origin per preview of a
-- store's snapshot, for one person and one framing tool, for an hour.
CREATE TABLE previews (
  label TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  n INTEGER NOT NULL,
  person TEXT NOT NULL,
  parent TEXT NOT NULL,
  expires_at INTEGER NOT NULL);
