// Pinboard's command-line verbs for the board itself: slop pb <board> board <verb>.

function describe() {
  const b = require("slop").board();
  const d = b.call("describe", { max: 30 });
  const lines = [(d.title || "Untitled board") + "  (" + b.id + ")",
    d.counts.clips + " clips · " + d.counts.collections + " collections · " + d.counts.records + " records · " + d.counts.apps + " apps", ""];
  for (const c of d.clips) lines.push("  " + c.id + "  " + c.kind.padEnd(5) + "  " + (c.title || c.url || c.text || "").slice(0, 60) + (c.tags.length ? "  #" + c.tags.join(" #") : ""));
  if (d.collections.length) lines.push("", "collections:");
  for (const c of d.collections) lines.push("  " + c.name + " (" + c.count + "): " + c.fields.join(", "));
  return lines.join("\n");
}
__verb__("describe", { parents: ["board"], short: "What is on the board", output: "text" });

function log(limit) {
  return require("slop").board().call("log", { limit });
}
__verb__("log", {
  parents: ["board"],
  short: "The newest steps of the board's shared log",
  fields: { limit: { type: "int", default: 20, help: "How many" } },
});
