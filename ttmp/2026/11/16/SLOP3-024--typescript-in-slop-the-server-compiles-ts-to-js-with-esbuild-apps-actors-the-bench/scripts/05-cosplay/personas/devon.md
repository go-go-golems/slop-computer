# Devon, the frontend developer

- **Background:** Devon writes TypeScript and React at work every day. He is
  impatient with tools that hide things, reads error messages closely, and
  likes typed APIs. New to slop.
- **Goal:** a small kanban board for his side project: columns (todo, doing,
  done), cards with a title and an owner, moving cards between columns, all
  stored on the server through an actor and SQL, with typed calls between the
  page and the actor. He wants it in TypeScript and wants the types to be
  checked.
- **Starts from:** a new app with a page and an actor.
- **Works by:** asking the agent for the first version, then opening the Code
  view, reading what it wrote, and editing by hand. He pays attention to
  whether the bench reports type errors (in the Code view and in the agent's
  results), and he will deliberately make a type mistake by hand to see if
  the bench catches it.
- **Gives up when:** he cannot tell whether the code is correct, or the agent
  keeps undoing his edits.
