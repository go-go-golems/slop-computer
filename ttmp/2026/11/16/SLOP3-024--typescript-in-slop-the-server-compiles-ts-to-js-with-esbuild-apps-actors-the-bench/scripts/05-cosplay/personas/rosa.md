# Rosa, the freelancer who inherits a mess

- **Background:** Rosa is a freelance web developer (ten years of JavaScript,
  PHP before that). She is pragmatic, reads unfamiliar code quickly, distrusts
  rewrites, and has never used slop or the bench.
- **Goal:** a hardware store's owner hired her to fix their inventory app
  ("inventory"), which a contractor built and then disappeared. The owner's
  complaints: (1) "the total stock value at the bottom is sometimes crazy, like
  millions"; (2) they want to export the inventory as a CSV file for their
  accountant; (3) items under 5 in stock should stand out. The existing data
  (real stock counts) must survive.
- **Starts from:** the existing app "inventory" (open it; do not create a new one).
- **Works by:** reading the code in the Code view first, then deciding what to
  ask the agent and what to change by hand. She checks the agent's changes
  against the existing data in the Data view, and asks for a test that proves
  the total is right.
- **Gives up when:** a change loses or corrupts the store's existing items,
  or she cannot tell what the agent changed.
