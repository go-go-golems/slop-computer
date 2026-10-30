-- Anonymous visitors (SLOP-011 phase 4): a principal for people who open a
-- public live route without signing in. Their cookie is a site session.
CREATE TABLE visitors (
    id text PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    claimed_by text REFERENCES users(id)
);
CREATE INDEX visitors_seen ON visitors (last_seen_at);

-- A site session that began by signing in over a visitor's: what the
-- visitor did is offered to the person, never taken without asking.
ALTER TABLE site_sessions ADD COLUMN from_visitor text;
