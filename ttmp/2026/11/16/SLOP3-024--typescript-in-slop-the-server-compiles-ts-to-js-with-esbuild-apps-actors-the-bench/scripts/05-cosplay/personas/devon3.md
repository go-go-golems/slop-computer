# Devon, the board keeps growing

- **Background:** Devon is a full-stack developer (TypeScript daily). Last
  session he built a live team board ("devon-kanban2") with the bench's
  agent: cards move live between people over rooms, an atomic version check
  settles races, and "moved by" names the mover. The thread got long, and the
  end was rough: it died on a size limit and he finished a name fix by hand.
- **Goal:** keep building in ONE long conversation on purpose (he wants to
  know if a long session holds up now): (1) card assignees, chosen from the
  people who have opened the board; (2) a per-column WIP limit that the
  server enforces, not just the page; (3) an activity log of the last 20
  moves; (4) a scenario for each. He also wants a clear answer, in short
  lines, to "what happens when two people move the same card at once".
- **Starts from:** the existing app "devon-kanban2" and its existing thread.
- **Works by:** asking for one feature at a time in the same thread, reading
  the code the agent writes, testing with two frames, and checking the type
  count and the scenarios after each feature.
- **Gives up when:** the thread dies again, or a reply claims work that is not
  in the files.
