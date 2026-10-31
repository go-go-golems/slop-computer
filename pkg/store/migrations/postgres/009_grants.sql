-- Grants and members (SLOP-011 phase 2): who may open a target, at which
-- level, and a member role for people who are let in without being admins.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member', 'pending', 'disabled'));

-- A grant gives a subject a level on a target: one person (usr_…), one
-- visitor (vis_…), everyone signed in (*signed-in) or anyone (*anyone).
CREATE TABLE rt_grants (
    target_id text NOT NULL REFERENCES artifacts(id),
    subject text NOT NULL,
    level text NOT NULL CHECK (level IN ('view', 'interact', 'admin', 'owner')),
    via text NOT NULL DEFAULT '',
    created_by text,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (target_id, subject)
);
