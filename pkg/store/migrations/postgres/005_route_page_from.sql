-- Page-from routes: a template such as "{page}", filled from the path's
-- parameters, names the page to serve among the pages of the project of the
-- route's page; the route's page is served (404) when it names none.
ALTER TABLE routes ADD COLUMN page_from text NOT NULL DEFAULT '';
