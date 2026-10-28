-- Accounts, sessions, tokens, device logins and the audit log.
-- Carved from francois 001_core, 004_storefront, 008_token_scopes and
-- 019_device_authorizations; roles are admin | pending | disabled.
CREATE TABLE users (
    id text PRIMARY KEY,
    issuer text NOT NULL,
    subject text NOT NULL,
    email text NOT NULL DEFAULT '',
    email_verified boolean NOT NULL DEFAULT false,
    display_name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'pending' CHECK (role IN ('admin', 'pending', 'disabled')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (issuer, subject)
);
CREATE INDEX users_email ON users (lower(email));

CREATE TABLE login_flows (
    state_hash bytea PRIMARY KEY,
    binding_hash bytea NOT NULL,
    nonce text NOT NULL,
    verifier text NOT NULL,
    return_path text NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    csrf_token text NOT NULL,
    id_token text NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    absolute_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE api_tokens (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    name text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    scopes text NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);

CREATE TABLE device_authorizations (
    device_code_hash bytea PRIMARY KEY,
    user_code_hash bytea NOT NULL UNIQUE,
    portal_origin text NOT NULL,
    client_name text NOT NULL,
    requested_scopes text NOT NULL,
    requested_days integer NOT NULL,
    requester_address text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    user_id text REFERENCES users(id),
    approved_scopes text,
    approved_days integer,
    interval_seconds integer NOT NULL,
    last_polled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX device_authorizations_expiry ON device_authorizations (expires_at);

CREATE TABLE audit (
    id bigserial PRIMARY KEY,
    actor_id text,
    token_id text,
    via text NOT NULL DEFAULT '',
    action text NOT NULL,
    subject text NOT NULL,
    summary text NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX audit_actor ON audit (actor_id, id);
CREATE INDEX audit_subject ON audit (subject, id);
