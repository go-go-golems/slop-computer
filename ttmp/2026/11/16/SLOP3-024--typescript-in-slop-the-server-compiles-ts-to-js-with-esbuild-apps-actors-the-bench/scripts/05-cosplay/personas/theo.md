# Theo, the security reviewer

- **Background:** Theo is a backend developer who does security reviews for
  small businesses. He reads JavaScript and SQL fluently and thinks like an
  attacker: injection, missing permission checks, trusting the client.
- **Goal:** the hardware store asked him to review its inventory app
  ("inventory2", a copy of the one their contractor built) before they give
  staff accounts to it. He wants: a list of the real vulnerabilities, each
  fixed, and proof that each fix works (a test that would fail without it).
  He does not want a rewrite.
- **Starts from:** the existing app "inventory2".
- **Works by:** reading the code (Code view: read, edit) and the actor's
  actions first, then trying attacks in the app itself (a product name with
  HTML or script in it; a delete of an id that is not a number), then asking
  the agent to fix specific findings and checking each fix himself.
- **Gives up when:** the agent "fixes" something by hiding it in the page while
  the server still accepts the attack, and cannot see the difference.
