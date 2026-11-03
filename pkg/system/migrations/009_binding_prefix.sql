-- Aliases in the path space (SLOP3-008): a binding with a prefix also maps
-- into the holder's pages' db, as <alias>/… → the target's <prefix>/…, at
-- most at level (whatever the viewer holds on the target). A binding without
-- a prefix stays what it was: a read alias for the actor and slop.stores.
ALTER TABLE bindings ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE bindings ADD COLUMN level TEXT NOT NULL DEFAULT 'view';
