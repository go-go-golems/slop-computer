-- Alias templates on mounts (SLOP3-008 phase 4): a parameterised mount that
-- creates stores (create_app) binds each store it creates as listed here, a
-- JSON array of bindings without their store: [{alias, target, prefix?,
-- level?, assets?}]. The new store's owner can change them afterwards.
ALTER TABLE mounts ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
