-- Server secrets and the unguessable host labels of preview origins
-- (s<label>.<sandbox domain> serves one artifact version).
CREATE TABLE server_keys (
    name text PRIMARY KEY,
    value blob NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE sandbox_labels (
    label text PRIMARY KEY,
    artifact_id text NOT NULL REFERENCES artifacts(id),
    n integer NOT NULL,
    created_at TIMESTAMP NOT NULL,
    UNIQUE (artifact_id, n)
);
