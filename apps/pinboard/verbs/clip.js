// Pinboard's command-line verbs for clips: slop pb <board> clip <verb>.
// Each runs as you, through the board's actor (actor.js), so the board's
// rules, your level and the shared log apply as in the page.

doc`---
verb: add
---
Adds a note (--text) or a link (--url) to the board, below everything on it.
It appears on every open board at once, and the board log says it came from
the command line.`;

function add(url, text, title, tags, note) {
  const b = require("slop").board();
  return b.call("addClip", { url, text, title, tags, note, via: b.via || "cli" });
}
__verb__("add", {
  parents: ["clip"],
  short: "Add a note or a link",
  fields: {
    url: { help: "A link" },
    text: { help: "A note's text" },
    title: { help: "Title" },
    tags: { type: "stringList", help: "Tags" },
    note: { help: "A note about the clip" },
  },
});

function ls(kind, tag, q, limit) {
  const b = require("slop").board();
  return b.call("clips", { kind, tag, q, limit });
}
__verb__("ls", {
  parents: ["clip"],
  short: "List clips, newest first",
  fields: {
    kind: { help: "Only this kind: note, link, image, doc, app, group" },
    tag: { help: "Only clips with this tag" },
    q: { help: "Only clips containing this text" },
    limit: { type: "int", default: 50, help: "At most this many" },
  },
});

function rm(id) {
  const b = require("slop").board();
  return b.call("removeClip", { id, via: b.via || "cli" });
}
__verb__("rm", {
  parents: ["clip"],
  short: "Remove a clip",
  fields: { id: { argument: true, help: "The clip's id (clip:…)" } },
});

function tag(id, add, remove) {
  const b = require("slop").board();
  return b.call("tagClip", { id, tags: add, untag: remove, via: b.via || "cli" });
}
__verb__("tag", {
  parents: ["clip"],
  short: "Add or remove a clip's tags",
  fields: {
    id: { argument: true, help: "The clip's id (clip:…)" },
    add: { type: "stringList", help: "Tags to add" },
    remove: { type: "stringList", help: "Tags to remove" },
  },
});
