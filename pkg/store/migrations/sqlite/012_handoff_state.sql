-- A handoff is bound to the browser that started it on the site (SLOP-011):
-- the site sets a state cookie and the code is only good with it, so a
-- code cannot sign another browser in, and a guest's identity survives a
-- cross-site return that withholds the site's SameSite=Strict cookie.
ALTER TABLE site_handoffs ADD COLUMN state text NOT NULL DEFAULT '';
