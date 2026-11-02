-- Go modules an admin has trusted an app with (SLOP3-002). Trust belongs
-- to the app store, not to a version: only admins push app code (D9).
CREATE TABLE app_modules (
  app TEXT NOT NULL,
  module TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (app, module));
