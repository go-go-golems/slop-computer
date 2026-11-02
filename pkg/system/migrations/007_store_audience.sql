-- SLOP3-007 phase 4: a store acting on its own (alarms, reactors) is in the
-- group @store, which has its own policy cells. SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt.
CREATE TABLE app_policy_new (
  app TEXT NOT NULL,
  capability TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('guest','member','subscriber','admin','store')),
  allowed INTEGER NOT NULL,
  changed_by TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (app, capability, audience));
INSERT INTO app_policy_new (app, capability, audience, allowed, changed_by, changed_at)
  SELECT app, capability, audience, allowed, changed_by, changed_at FROM app_policy;
DROP TABLE app_policy;
ALTER TABLE app_policy_new RENAME TO app_policy;
