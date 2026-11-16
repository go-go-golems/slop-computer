# Tasks

## TODO

- [ ] Write the full design (deferred on 2026-11-16: for now the ticket only remembers the idea; see reference/01-notes-typescript-through-esbuild-on-the-server.md)
- [ ] Settle the questions in section 5 of the notes (caching, content types, imports, type checking, error positions, scope)
- [ ] Decide the bench's route (build-time TS, or served by this feature) once SLOP3-023 has merged
- [ ] Declared argument types for actor actions, checked by one function before run (notes §7.1; can come before TypeScript)
- [ ] TypeScript declarations for the verb-backed modules (workshop, system), generated from the verbs' Go input structs (notes §7.2)
- [ ] A tagged change type shared by the Draft, the actor and the test stand-in; a snapshot type distinct from "ref absent" (files.commit base 0) (notes §7.3–7.4)
- [ ] "Set a ref's tree to snapshot n" as one server commit, for restore (notes §7.5)
