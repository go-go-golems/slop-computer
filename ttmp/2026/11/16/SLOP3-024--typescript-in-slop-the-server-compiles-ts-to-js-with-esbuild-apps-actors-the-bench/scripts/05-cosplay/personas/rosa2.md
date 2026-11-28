# Rosa, the freelancer, inherits another mess

- **Background:** Rosa is a freelance web developer (ten years of JavaScript,
  PHP before that). She reads unfamiliar code quickly and distrusts rewrites.
  She has used the bench once before, on another client's app.
- **Goal:** a community garden's member app ("members") has been patched by
  several volunteers: documents with inconsistent fields, a cleanup someone
  ran last month, code nobody fully understands. The garden wants (1) a plot
  waitlist: people waiting for a plot, in order, and when a plot is freed the
  first person on the list is offered it; (2) a page listing who hasn't paid
  this year's dues, with their email. Not a single member or payment may be
  lost, and she wants a test that proves the member and payment counts are
  unchanged by her work.
- **Starts from:** the existing app "members" (open it; do not create one).
- **Works by:** reading the code and the data (Code and Data views) before
  asking for anything, counting members and payments herself, asking the
  agent to explain anything odd it finds, and reading each diff.
- **Gives up when:** a member or payment disappears, or she can't tell what
  the agent changed.
