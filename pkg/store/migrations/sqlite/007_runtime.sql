-- The artifact runtime (SLOP-009): slop hosts the claude.ai Artifact
-- runtime contract natively. It replaces the docs store (006), tools and
-- their grants (004) and the per-version sandbox labels (003); those tables
-- go, with their data. A data artifact can name the app (a page) that runs
-- it; a view is that app working on that target.
DROP TABLE docs;
DROP TABLE doc_heads;
DROP TABLE tool_grants;
DROP TABLE tools;
DROP TABLE sandbox_labels;

ALTER TABLE artifacts ADD COLUMN app text NOT NULL DEFAULT '';

-- Documents of a target's db. body NULL is a tombstone, kept a while so a
-- view that reconnects learns of the delete. rev orders every change of one
-- target (rt_heads is locked first by every write); version counts the
-- changes of one document.
CREATE TABLE rt_heads (
    target_id text PRIMARY KEY REFERENCES artifacts(id),
    rev bigint NOT NULL
);
CREATE TABLE rt_docs (
    target_id text NOT NULL REFERENCES artifacts(id),
    path text NOT NULL,
    coll text NOT NULL,
    body text,
    size integer NOT NULL DEFAULT 0,
    version bigint NOT NULL,
    rev bigint NOT NULL,
    updated_by text,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (target_id, path)
);
CREATE INDEX rt_docs_coll ON rt_docs (target_id, coll);
CREATE INDEX rt_docs_rev ON rt_docs (target_id, rev);

CREATE TABLE rt_leases (
    target_id text NOT NULL REFERENCES artifacts(id),
    path text NOT NULL,
    holder text NOT NULL,
    until_at TIMESTAMP NOT NULL,
    data text,
    PRIMARY KEY (target_id, path)
);

CREATE TABLE rt_assets (
    id text PRIMARY KEY,
    target_id text NOT NULL REFERENCES artifacts(id),
    sha256 text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL,
    created_by text,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX rt_assets_target ON rt_assets (target_id);

-- One origin per target: s<label>.<sandbox domain>.
CREATE TABLE rt_origins (
    label text PRIMARY KEY,
    target_id text NOT NULL UNIQUE REFERENCES artifacts(id),
    created_at TIMESTAMP NOT NULL
);

-- An admin's approval of an app version's slop permissions.
CREATE TABLE rt_approvals (
    app_id text NOT NULL REFERENCES artifacts(id),
    version integer NOT NULL,
    permissions text NOT NULL,
    approved_by text NOT NULL REFERENCES users(id),
    approved_at TIMESTAMP NOT NULL,
    PRIMARY KEY (app_id, version)
);

-- A person's answer to a capability that asks first (sample, comments).
CREATE TABLE rt_consents (
    user_id text NOT NULL REFERENCES users(id),
    app_id text NOT NULL REFERENCES artifacts(id),
    capability text NOT NULL,
    state text NOT NULL,
    at TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, app_id, capability)
);
