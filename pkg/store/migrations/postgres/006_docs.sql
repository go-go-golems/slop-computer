-- Live documents: the mutable working copy of a data artifact that a tool
-- edits as many small JSON documents (Pinup: one per layer). Writes are
-- last-writer-wins per document; rev orders every change of one artifact,
-- and a delete keeps a tombstone (data NULL) so clients that were away
-- learn of it. Versions stay the immutable, published record.
CREATE TABLE doc_heads (
    artifact_id text PRIMARY KEY REFERENCES artifacts(id),
    rev bigint NOT NULL
);

CREATE TABLE docs (
    artifact_id text NOT NULL REFERENCES artifacts(id),
    path text NOT NULL,
    data text,
    size integer NOT NULL DEFAULT 0,
    rev bigint NOT NULL,
    updated_by text REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lease_holder text,
    lease_until TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (artifact_id, path)
);
CREATE INDEX docs_rev ON docs (artifact_id, rev);
