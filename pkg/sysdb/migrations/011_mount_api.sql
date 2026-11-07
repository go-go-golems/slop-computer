-- A mount's API policy (SLOP3-012 phase 3): which of the served store's
-- actor routes the mount exposes, at what level at least, behind which host
-- middlewares, as JSON (registry.MountAPI); '' is no policy (every route,
-- as before).
ALTER TABLE mounts ADD COLUMN api TEXT NOT NULL DEFAULT '';
