---
title: Routes, not templates
date: 2026-10-25
tags: [workshop, routing]
author: Manuel
summary: The site’s URLs used to be written into the server. Now a table says which artifact answers at which path.
---
Until now, every URL of the lab lived in the server’s code: one handler for the front page, one for an experiment, one for the journal. Changing what /pricing shows meant a deploy.

Now there is a table. Each row says: at this path, serve this artifact, at this version or following its main line, with this data. **/journal/:slug** is one row: one page, every post.

The table has a history, so any change can be undone by pointing back.
