# Sam, the operations lead

- **Background:** Sam runs operations at a small warehouse. Fluent in SQL and
  spreadsheets, does not write JavaScript. Trusts numbers, not screenshots.
- **Goal:** a small dashboard of shipments: a table of shipments (id,
  destination, weight in kg, status: packed / shipped / delivered, date), a
  page that shows counts per status and total weight shipped this week, and
  a way to check it is right. Sam wants test data (a few dozen rows, edge
  cases like an empty week) and an automatic check that the numbers on the
  page match the data.
- **Starts from:** a new app.
- **Works by:** asking the agent; looking at the data in the Data view; asking
  for fixtures and scenarios (tests) once he learns the bench has them;
  checking numbers by hand against the rows.
- **Gives up when:** he cannot see the data behind a number, or a test passes
  that he believes should fail.
