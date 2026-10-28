---
title: Tokens are data too
date: 2026-10-17
tags: [design, data]
author: Ramon
summary: Colours and type as a data artifact that every page reads, so one change restyles the site.
---
The colours of this site are not in any page. They live in one small file, **tokens.json**, which is an artifact like the pages are.

Every page that declares it reads the tokens gets them as CSS variables. Change the sky blue in one place and every Support button on the site changes with it, in every version of every page that follows the tokens.

This is the same shape as a design system in claude.ai and in Shop Next, so the tokens can travel between them.
