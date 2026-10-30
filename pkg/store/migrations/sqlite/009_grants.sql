-- Grants and members (SLOP-011 phase 2): who may open a target, at which
-- level, and a member role for people who are let in without being admins.

-- users.role gains member. SQLite cannot change a CHECK in place: the table
-- is rebuilt (Migrate runs with foreign keys off and checks them after).
CREATE TABLE users_new (
    id text PRIMARY KEY,
    issuer text NOT NULL,
    subject text NOT NULL,
    email text NOT NULL DEFAULT '',
    email_verified boolean NOT NULL DEFAULT false,
    display_name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'pending' CHECK (role IN ('admin', 'member', 'pending', 'disabled')),
    created_at TIMESTAMP NOT NULL,
    last_login_at TIMESTAMP,
    last_seen_at TIMESTAMP,
    UNIQUE (issuer, subject)
);
INSERT INTO users_new(id, issuer, subject, email, email_verified, display_name, role, created_at, last_login_at, last_seen_at)
    SELECT id, issuer, subject, email, email_verified, display_name, role, created_at, last_login_at, last_seen_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX users_email ON users (lower(email));

-- A grant gives a subject a level on a target: one person (usr_…), one
-- visitor (vis_…), everyone signed in (*signed-in) or anyone (*anyone).
CREATE TABLE rt_grants (
    target_id text NOT NULL REFERENCES artifacts(id),
    subject text NOT NULL,
    level text NOT NULL CHECK (level IN ('view', 'interact', 'admin', 'owner')),
    via text NOT NULL DEFAULT '',
    created_by text,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (target_id, subject)
);
