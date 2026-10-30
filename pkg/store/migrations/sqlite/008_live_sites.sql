-- Live sites (SLOP-011): routes that run an app against its target live on
-- a site host, sessions on site hosts, and the one-time codes that hand a
-- main-host sign-in over to a site host.

-- Routes gain live and create_policy, and access gains signed-in. SQLite
-- cannot change a CHECK in place, so the table is rebuilt; nothing refers
-- to routes, so this is safe with foreign keys on.
CREATE TABLE routes_new (
    host text NOT NULL,
    path text NOT NULL,
    page text NOT NULL REFERENCES artifacts(id),
    version integer,
    bindings text NOT NULL DEFAULT '{}',
    record text NOT NULL DEFAULT '',
    -- who sees the route on the site: a static page is served when public
    -- (admins: Workshop only); a live route's shell is served for every
    -- value, and access decides who may open its app.
    access text NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'signed-in', 'admins')),
    changed_by text REFERENCES users(id),
    changed_at TIMESTAMP NOT NULL,
    page_from text NOT NULL DEFAULT '',
    -- live: the site serves a shell that runs the app against its target.
    live boolean NOT NULL DEFAULT false,
    -- who may create an instance at a live route whose target comes from
    -- the path ('' nobody).
    create_policy text NOT NULL DEFAULT '' CHECK (create_policy IN ('', 'admins', 'signed-in', 'public')),
    PRIMARY KEY (host, path)
);
INSERT INTO routes_new(host, path, page, version, bindings, record, access, changed_by, changed_at, page_from)
    SELECT host, path, page, version, bindings, record, access, changed_by, changed_at, page_from FROM routes;
DROP TABLE routes;
ALTER TABLE routes_new RENAME TO routes;

-- A session on one site host. principal is a user (usr_…) after a handoff,
-- or an anonymous visitor (vis_…); no foreign key, so both fit.
CREATE TABLE site_sessions (
    token_hash blob PRIMARY KEY,
    host text NOT NULL,
    principal text NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP
);
CREATE INDEX site_sessions_principal ON site_sessions (principal);

-- One-time codes that hand a main-host sign-in to a site host.
CREATE TABLE site_handoffs (
    code_hash blob PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    host text NOT NULL,
    return_path text NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);
