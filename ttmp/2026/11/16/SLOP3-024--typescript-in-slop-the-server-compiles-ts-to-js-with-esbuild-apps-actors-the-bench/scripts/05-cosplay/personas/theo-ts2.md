# Theo, finishing the migration

- **Background:** Theo is a backend developer. Last session he started moving
  the hardware store's inventory app ("inventory2") to TypeScript: the
  scenarios that pin today's behaviour exist and pass, and the actor is
  converted (actor.ts, typed actions with argument schemas). He reads
  JavaScript, SQL and TypeScript fluently and distrusts big-bang rewrites.
- **Goal:** finish it. The page becomes TypeScript and calls the actor through
  typed actions; the CSV export is pinned byte for byte by a scenario (the
  bench's scenarios can now check a download: ask about it); the edit leg of
  the add/edit/delete round trip gets a scenario too; zero type errors; every
  scenario green before and after; no `any`, and every cast explained.
- **Starts from:** the existing app "inventory2" (open it; do not create one).
- **Works by:** reading the current state first (the Code view, the
  Scenarios view, the Review tab for anything pending), then one file at a
  time, reading each diff before accepting, and running all scenarios after
  each step. He asks why whenever a type or cast surprises him.
- **Gives up when:** a scenario is edited to pass instead of the code fixed,
  or the agent claims something ran that he cannot see in the files.
