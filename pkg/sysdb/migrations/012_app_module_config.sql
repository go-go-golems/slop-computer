-- SLOP3-012 part 2: a module grant carries the admin's configuration of the
-- module (JSON, decoded strictly into the module's config struct).
ALTER TABLE app_modules ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
