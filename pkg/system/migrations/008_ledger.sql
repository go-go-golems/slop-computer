-- SLOP3-007 phase 5: model budgets as a ledger. A hold is taken before each
-- model round and settled with what the round used; reserved_tokens is the
-- sum of open holds, so spent + reserved never passes the limit.
ALTER TABLE llm_usage ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0;
CREATE TABLE llm_holds (
  id TEXT PRIMARY KEY,               -- idempotency key: <call id>/<round>
  account TEXT NOT NULL,             -- usr_…, vis_…, store:<id>
  period TEXT NOT NULL,              -- 'YYYY-MM' when taken; settles there
  amount INTEGER NOT NULL,           -- tokens held: input estimate + output cap
  output INTEGER NOT NULL,           -- the output cap the round was given (0: none)
  used INTEGER,
  state TEXT NOT NULL CHECK (state IN ('held', 'settled', 'released')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);
CREATE INDEX llm_holds_open ON llm_holds (expires_at) WHERE state = 'held';
