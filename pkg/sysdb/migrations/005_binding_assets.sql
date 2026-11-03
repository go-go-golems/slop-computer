-- Uploads through a binding (SLOP3-003): a binding reads the target's
-- documents and published files; with assets set, its store's actor also
-- reads the target's uploaded files. Setting it needs admin on the target,
-- so an existing view grant never starts sharing uploads on its own.
ALTER TABLE bindings ADD COLUMN assets INTEGER NOT NULL DEFAULT 0;
