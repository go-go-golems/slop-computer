---
Title: 'Proposal: canvas frames as different people'
Ticket: SLOP3-024
Status: proposed
Topics:
    - apps
    - frontend
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Let the bench open a frame of a dev, test or proposal instance as a simulated person (a name and a role), so multi-person apps (votes, waitlists, privacy rules) can be tried on the canvas. Found by three personas in the persona reviews; needs a decision before it is built."
LastUpdated: 2026-11-17T04:00:00-05:00
WhatFor: "Deciding whether and how the bench simulates other people in its frames."
WhenToUse: "Before building multi-person testing into the bench."
---

# Proposal: canvas frames as different people

Every frame on the bench's canvas opens its view as the person using the bench. So every frame is the same visitor: the same `ctx.visitor.id` and name in the actor, and the same one vote. Three personas in the persona reviews hit this wall, from three directions:

- **Kenji** (round 2) built a live poll with one vote per person. With two frames side by side as "host" and "audience", he could not test that two people's votes both count, or that one person can't vote twice. "All frames share one voter identity."
- **Aisha** (round 2) built shift sign-ups where volunteers must not see each other's phone numbers. She could not check it herself, so she had to trust the agent's code audit: "I can't see what a browser receives."
- **Priya** (round 1) added a top-10 leaderboard; every score came from "Admin".

Scenarios have the same limit: they run in a frame of the test instance as the person.

## What changes

A frame gets an optional *simulated person*: a display name, and a role, `member` or `guest` (`admin` is the bench user themselves). The canvas shows it on the frame's label ("Fatima · member"). The bench opens that frame's view as the simulated person instead of as itself. Inside the app, `ctx.visitor` is the simulated person: a stable synthetic id per (bench user, app, name), the given name, that role's audience and the level the role gets on the instance.

The server side is one new option on the workshop's `embed`:

```js
workshop.embed(store, { dev: true, as: { name: 'Fatima', role: 'member' } })
```

`openView` is called with a principal built for the simulated person, not the visitor, under four conditions:

1. **Only an instance of unpublished code.** The rule `drop` and `exec` share (`unpublished`): another store's app, at a ref other than main. Never an app store or a production instance, so no real person's data or identity is involved.
2. **Only an admin of the bench can ask.** Today they're also the only ones who build (D9).
3. **The synthetic id is namespaced:** `sim_<hash of bench user, instance, name>`. It can't collide with a real `usr_…` or `vis_…`, and it's never written to the people table.
4. **Grants:** the instance gets the role's grant for that id on first use. A simulated member is a member there, so the app's own `requires` levels are tested for real.

The bench's side:
- a "View as…" item in the frame's ⋯ menu;
- `frames.open({…, as: {name, role}})` in the agent's API;
- `{ as: {name, role} }` on a scenario, or per step, so a scenario can play two people: "Fatima signs up; Dev is waitlisted; Fatima cancels; Dev is in".

## Why not real accounts

Personas with accounts of their own (benchdrive's `BENCHDRIVE_EMAIL`) can't build apps (D9), and an app in development isn't reachable by others until it is published and mounted. Real accounts test sharing; simulated people test the app's own multi-person logic before anyone else sees it.

## Open questions for the decision

- **Is a synthetic principal acceptable in the views layer** (`pkg/doors/pages/views.go`), or should simulated people go through the existing guest mechanism (`vis_…`) with a bench-owned marker?
- **Should `sample`, `user.email` and other capabilities follow the simulated role's policy cell, or be off for simulated people?** The safe default is off.
- **Logs and the timeline should say "as Fatima".** A simulated person's actions in the instance's data are the bench user's responsibility.

## Size

- **Server:** the `embed` option, the principal, the guard and the grant; about a day with tests.
- **Bench:** the frame menu, the label, scenario steps and the agent's API; about a day.
- **The next persona review** gets a persona whose goal needs two people.
