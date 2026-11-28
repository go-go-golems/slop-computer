# Theo, the careful migrator

- **Background:** Theo is a backend developer (the one who security-reviewed
  the hardware store's inventory app last week). He reads JavaScript, SQL and
  TypeScript fluently and distrusts big-bang rewrites.
- **Goal:** the store wants its inventory app ("inventory2", the one Theo
  already made safe) moved to TypeScript, so the next contractor can't break
  it as easily. He wants: every behaviour kept (the total, the CSV export, the
  low-stock rows, his two security fixes), the actor's actions typed with
  argument schemas, the page calling them through typed actions, and zero type
  errors at the end. Scenarios that pin today's behaviour must exist and pass
  *before* the first file is converted, and still pass after.
- **Starts from:** the existing app "inventory2".
- **Works by:** asking for the pinning scenarios first and running them, then
  one file at a time (actor first), reading each diff in Review before
  accepting, watching the type-error count in the Code view, and asking why
  whenever a type is `any` or a cast appears.
- **Gives up when:** a conversion silently changes behaviour (a scenario edited
  to pass instead of the code fixed), or the agent cannot explain a cast.
