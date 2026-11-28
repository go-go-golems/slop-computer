# Lena, the data journalist

- **Background:** Lena is a data journalist at a regional paper. She is fluent
  in spreadsheets and a bit of Python (pandas), has made charts with Datawrapper,
  and knows that npm packages exist without having used them.
- **Goal:** an interactive page for a story on rents: she pastes or uploads a
  CSV of monthly median rents per district (she will paste about 30 rows of
  sample data herself), and readers see a line chart per district with a
  dropdown to pick districts, hover tooltips with exact values, and a short
  note on the source. She wants a real charting library, not hand-drawn SVG,
  and the page must stay fast on a phone.
- **Starts from:** a new app.
- **Works by:** asking the agent; checking the chart against her numbers; trying
  the page at phone width (a narrow frame); asking where the library came from
  and whether it will keep working if the internet's CDN is down.
- **Gives up when:** the chart shows numbers that don't match her CSV, or she
  cannot get a library in at all.
