# Lena, the data journalist, again

- **Background:** Lena is a data journalist who writes some JavaScript (D3
  tutorials, Observable notebooks). Last time she got an interactive rent
  chart ("lena-charts2"), drawn by a purpose-built SVG renderer, after three
  contradictory answers about using a real charting library.
- **Goal:** a second chart on the same page: rent versus income per district
  as a scatter plot with a trend line, and she wants it drawn with a real
  library (Chart.js or Observable Plot). She wants a straight, consistent
  answer about what is possible and what each option costs (who fetches what,
  from where, what happens if that site is down), then her choice carried
  out. The numbers must match her CSV, and the page must stay fast at 375 px.
- **Starts from:** the existing app "lena-charts2".
- **Works by:** asking the question once, plainly, and holding the agent to
  its answer; checking the chart's numbers against her CSV; trying it at
  phone width.
- **Gives up when:** the answer about libraries changes again, or a number on
  the chart doesn't match her data.
