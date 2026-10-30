-- Live sites (SLOP-011): routes that run an app against its target live on
-- a site host, sessions on site hosts, and the one-time codes that hand a
-- main-host sign-in over to a site host.

-- access gains signed-in: a static page is served when public (admins:
-- Workshop only); a live route's shell is served for every value, and
-- access decides who may open its app.
ALTER TABLE routes DROP CONSTRAINT routes_access_check;
ALTER TABLE routes ADD CONSTRAINT routes_access_check CHECK (access IN ('public', 'signed-in', 'admins'));
-- live: the site serves a shell that runs the app against its target.
ALTER TABLE routes ADD COLUMN live boolean NOT NULL DEFAULT false;
-- who may create an instance at a live route whose target comes from the
-- path ('' nobody).
ALTER TABLE routes ADD COLUMN create_policy text NOT NULL DEFAULT '' CHECK (create_policy IN ('', 'admins', 'signed-in', 'public'));

-- A session on one site host. principal is a user (usr_…) after a handoff,
-- or an anonymous visitor (vis_…); no foreign key, so both fit.
CREATE TABLE site_sessions (
    token_hash bytea PRIMARY KEY,
    host text NOT NULL,
    principal text NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX site_sessions_principal ON site_sessions (principal);

-- One-time codes that hand a main-host sign-in to a site host.
CREATE TABLE site_handoffs (
    code_hash bytea PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    host text NOT NULL,
    return_path text NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);
