-- One row per voter: a later vote replaces the earlier one.
CREATE TABLE votes(
  voter TEXT PRIMARY KEY,
  option TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX votes_option ON votes(option);

-- The actor's read model. Pages never read this view directly; they get the
-- counts from the actor's actions and from the live tally document.
CREATE VIEW poll_tally AS
  SELECT option, count(*) AS votes
  FROM votes
  GROUP BY option;
