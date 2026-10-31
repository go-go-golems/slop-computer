-- Share links (SLOP-011 phase 3): whoever opens a live route with a link's
-- token gets the link's level on its target, as a grant (via = the link).
CREATE TABLE rt_links (
    id text PRIMARY KEY,
    target_id text NOT NULL REFERENCES artifacts(id),
    token_hash bytea NOT NULL UNIQUE,
    level text NOT NULL CHECK (level IN ('view', 'interact')),
    created_by text,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX rt_links_target ON rt_links (target_id);
