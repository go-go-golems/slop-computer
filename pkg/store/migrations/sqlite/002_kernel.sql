-- The artifact kernel: projects, artifacts, versions as file trees, refs,
-- routes with history, comment threads and the event log.
CREATE TABLE projects (
    id text PRIMARY KEY,
    name text NOT NULL,
    brief text NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE artifacts (
    id text PRIMARY KEY,
    title text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('page', 'data')),
    type text NOT NULL DEFAULT '',
    viewer text NOT NULL DEFAULT '',
    project_id text REFERENCES projects(id),
    created_by text REFERENCES users(id),
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX artifacts_project ON artifacts (project_id);

CREATE TABLE versions (
    artifact_id text NOT NULL REFERENCES artifacts(id),
    n integer NOT NULL,
    parent integer,
    manifest text NOT NULL DEFAULT '{}',
    message text NOT NULL DEFAULT '',
    author_id text NOT NULL REFERENCES users(id),
    token_id text,
    via text NOT NULL,
    session text NOT NULL DEFAULT '',
    reply_thread text NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (artifact_id, n)
);

CREATE TABLE version_files (
    artifact_id text NOT NULL,
    n integer NOT NULL,
    path text NOT NULL,
    sha256 text NOT NULL,
    size integer NOT NULL,
    media_type text NOT NULL,
    PRIMARY KEY (artifact_id, n, path),
    FOREIGN KEY (artifact_id, n) REFERENCES versions (artifact_id, n)
);
CREATE INDEX version_files_sha ON version_files (sha256);

CREATE TABLE refs (
    artifact_id text NOT NULL REFERENCES artifacts(id),
    name text NOT NULL,
    n integer NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (artifact_id, name)
);

CREATE TABLE routes (
    host text NOT NULL,
    path text NOT NULL,
    page text NOT NULL REFERENCES artifacts(id),
    version integer,
    bindings text NOT NULL DEFAULT '{}',
    record text NOT NULL DEFAULT '',
    access text NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'admins')),
    changed_by text REFERENCES users(id),
    changed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (host, path)
);

CREATE TABLE route_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host text NOT NULL,
    path text NOT NULL,
    from_state text,
    to_state text,
    note text NOT NULL DEFAULT '',
    by_user text,
    via text NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX route_log_route ON route_log (host, path, id);

CREATE TABLE threads (
    id text PRIMARY KEY,
    artifact_id text NOT NULL REFERENCES artifacts(id),
    version integer NOT NULL,
    anchor text NOT NULL DEFAULT '{}',
    created_by text NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP,
    resolved_by text
);
CREATE INDEX threads_artifact ON threads (artifact_id);

CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id text NOT NULL REFERENCES threads(id),
    author_id text NOT NULL REFERENCES users(id),
    token_id text,
    agent boolean NOT NULL DEFAULT false,
    version integer,
    body text NOT NULL,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX comments_thread ON comments (thread_id, id);

CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    type text NOT NULL,
    project_id text NOT NULL DEFAULT '',
    artifact_id text NOT NULL DEFAULT '',
    actor_id text NOT NULL DEFAULT '',
    payload text NOT NULL,
    created_at TIMESTAMP NOT NULL
);
