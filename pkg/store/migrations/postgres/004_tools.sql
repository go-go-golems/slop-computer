-- Tools: page artifacts with a "tool" section in their manifest that an
-- admin enabled at one version, and the short-lived grants (slg_…) a tool
-- calls the API with. A grant carries only the permissions the enabled
-- manifest asked for; users, tokens, audit and tools are never grantable.
CREATE TABLE tools (
    artifact_id text PRIMARY KEY REFERENCES artifacts(id),
    version integer NOT NULL,
    permissions text NOT NULL,
    title text NOT NULL,
    icon text NOT NULL DEFAULT '',
    enabled_by text NOT NULL REFERENCES users(id),
    enabled_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE tool_grants (
    token_hash bytea PRIMARY KEY,
    artifact_id text NOT NULL REFERENCES artifacts(id),
    version integer NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    permissions text NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX tool_grants_artifact ON tool_grants (artifact_id);
CREATE INDEX tool_grants_user ON tool_grants (user_id);
