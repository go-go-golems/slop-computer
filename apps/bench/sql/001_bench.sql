-- SLOP3-023: what the bench keeps around an app, per person. An app's files
-- live in the app's own store (snapshots and refs); these tables hold what
-- the bench adds: the canvas and panels, agent threads, the timeline, layout
-- snapshots and proposals. Every row belongs to one app and one person (the
-- visitor's id); the actor reads and writes only the visitor's own rows.

-- One row per person and app: boards and frames, pins, panels, scenario
-- results and other small state the page keeps as one JSON value.
CREATE TABLE projects (
  app TEXT NOT NULL,
  owner TEXT NOT NULL,
  meta TEXT NOT NULL,          -- JSON
  updated INTEGER NOT NULL,
  PRIMARY KEY (app, owner)
);

-- Agent threads: their settings and summary in meta, their messages in
-- messages, numbered from 1 in the order of the conversation.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  owner TEXT NOT NULL,
  meta TEXT NOT NULL,          -- JSON: title, mode, target, tier, role, parent, summary, …
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX threads_by_app ON threads (app, owner, updated);

CREATE TABLE messages (
  thread TEXT NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,          -- JSON: one message, with its eval steps
  PRIMARY KEY (thread, seq)
);

-- The timeline: what happened, in order. A commit names the snapshot it made
-- (ref, n) and the paths it changed; the texts are in the snapshot.
CREATE TABLE events (
  app TEXT NOT NULL,
  owner TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  who TEXT NOT NULL,           -- you | agent | push | ide
  kind TEXT NOT NULL,          -- commit | msg | turn | mark | delegate | publish | accept | reject | outside | …
  thread TEXT,
  ref TEXT,
  n INTEGER,
  data TEXT NOT NULL,          -- JSON: paths, note, label, and what the kind adds
  PRIMARY KEY (app, owner, seq)
);

-- Layout snapshots of frames (frames.snapshot): a frozen page is large, so
-- it is read only when a comparison or a view needs it.
CREATE TABLE snaps (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  owner TEXT NOT NULL,
  at INTEGER NOT NULL,
  meta TEXT NOT NULL,          -- JSON: route, w, h, ws, label, note, by, hash, seq
  doc TEXT NOT NULL            -- JSON: {html, css: {file: text}, layout, scroll}
);
CREATE INDEX snaps_by_app ON snaps (app, owner, at);

-- Proposals: a ref proposal/<id> on the app store, made at draft's snapshot
-- base. Accepting commits its changes onto draft over base; either way the
-- ref is removed and the row stays, closed.
CREATE TABLE proposals (
  app TEXT NOT NULL,
  ref TEXT NOT NULL,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  thread TEXT,
  base INTEGER NOT NULL,
  status TEXT NOT NULL,        -- open | accepted | rejected
  created INTEGER NOT NULL,
  closed INTEGER,
  PRIMARY KEY (app, ref)
);
