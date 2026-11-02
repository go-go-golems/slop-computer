-- system.db: identity, configuration and the platform log. One file per server.
-- Times are milliseconds since the Unix epoch (UTC).

CREATE TABLE people (
  id TEXT PRIMARY KEY,                       -- usr_… or vis_…
  kind TEXT NOT NULL CHECK (kind IN ('user','guest')),
  email TEXT UNIQUE,
  oidc_subject TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('pending','member','admin','disabled','guest')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_ip TEXT,
  claimed_by TEXT);
CREATE INDEX people_guests ON people (kind, last_seen_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  csrf TEXT NOT NULL,
  from_guest TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,                      -- space-separated: read write admin
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER);

CREATE TABLE device_codes (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  days INTEGER NOT NULL,
  approved_by TEXT,
  denied INTEGER NOT NULL DEFAULT 0,
  token_id TEXT,
  token_plain TEXT,                          -- handed out once, then cleared
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);

CREATE TABLE handoffs (
  code_hash TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  host TEXT NOT NULL,
  return_path TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at INTEGER NOT NULL);

CREATE TABLE comps (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  until INTEGER NOT NULL,
  revoked_at INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL);

CREATE TABLE stripe_customers (
  person TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL);
CREATE TABLE stripe_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  price_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  access_until INTEGER,
  trial_until INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at INTEGER,
  livemode INTEGER NOT NULL DEFAULT 0,
  refreshed_at INTEGER NOT NULL);
CREATE INDEX stripe_subscriptions_person ON stripe_subscriptions (person);
CREATE TABLE checkout_attempts (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  price TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','open','completed','expired','failed')),
  session_id TEXT UNIQUE,
  session_url TEXT,
  expires_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX checkout_attempts_open ON checkout_attempts (person)
  WHERE state IN ('pending','open');
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  subscription_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  livemode INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processed','ignored','error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  error_code TEXT,
  stripe_created_at INTEGER,
  received_at INTEGER NOT NULL,
  processed_at INTEGER);
CREATE INDEX stripe_events_due ON stripe_events (next_attempt_at) WHERE state = 'pending';

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  app TEXT,                                  -- the app store it runs; NULL = itself
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  made_by TEXT);

CREATE TABLE grants (
  store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('view','interact','admin','owner')),
  via TEXT NOT NULL DEFAULT 'direct',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store, subject, via));
CREATE INDEX grants_subject ON grants (subject);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('view','interact')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER);

CREATE TABLE bindings (
  store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (store, alias));

CREATE TABLE mounts (
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  store TEXT,
  store_param TEXT,
  type TEXT,
  create_app TEXT,
  create_audience TEXT,
  changed_by TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (host, path));
CREATE TABLE mount_log (
  id INTEGER PRIMARY KEY,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  before TEXT,
  after TEXT,
  by TEXT,
  at INTEGER NOT NULL);

CREATE TABLE origins (
  label TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  app TEXT NOT NULL,
  UNIQUE (store, app));

CREATE TABLE app_policy (
  app TEXT NOT NULL,
  capability TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('guest','member','subscriber','admin')),
  allowed INTEGER NOT NULL,
  changed_by TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (app, capability, audience));

CREATE TABLE llm_access (
  subject TEXT PRIMARY KEY,                  -- usr_…, vis_…, or @guest/@member/@subscriber/@admin
  allowed INTEGER NOT NULL,
  budget_tokens INTEGER,                     -- per calendar month; NULL = no limit
  changed_by TEXT,
  changed_at INTEGER NOT NULL);
CREATE TABLE llm_usage (
  person TEXT NOT NULL,
  period TEXT NOT NULL,                      -- 'YYYY-MM', UTC
  used_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person, period));
INSERT INTO llm_access (subject, allowed, budget_tokens, changed_by, changed_at)
  VALUES ('@admin', 1, NULL, 'system', 0);

CREATE TABLE secrets (
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  value_enc BLOB NOT NULL,
  changed_by TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (app, name));

CREATE TABLE schedules (store TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
CREATE TABLE blob_refs (sha256 TEXT PRIMARY KEY, refs INTEGER NOT NULL, zero_since INTEGER);

-- The system log, the same shape as a store's.
CREATE TABLE _log (
  rev INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  principal TEXT NOT NULL,
  via TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '');
CREATE TABLE _changes (
  rev INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  op TEXT NOT NULL,
  before TEXT,
  after TEXT,
  PRIMARY KEY (rev, seq));
