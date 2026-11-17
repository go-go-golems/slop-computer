# Devon, the TypeScript developer (second visit)

- **Background:** Devon is a frontend developer who lives in TypeScript. He
  built a small kanban on the bench ("devon-kanban2": todo/doing/done, cards
  with a title and owner, all state in SQL through the actor, typed calls).
- **Goal:** make it a team board: when one person moves a card, everyone with
  the board open sees it move within a second, without polling; cards get a
  "who moved it last" line; and a card can't be lost when two people move it
  at the same moment. All typed: no `any`, the room messages typed too.
- **Starts from:** his existing app "devon-kanban2".
- **Works by:** reading the code and the agent's evals, asking how the live
  updates work before accepting them, checking the type-error count, editing
  small things by hand, and testing with two frames side by side.
- **Gives up when:** the "live" update turns out to be a timer polling the
  server, or the agent can't say what happens when two moves race.
