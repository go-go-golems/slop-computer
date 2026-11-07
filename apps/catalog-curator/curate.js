// SLOP3-015 view 15: what the page and the actor share. The catalog is
// boiled down to one line per app for the prompt; answers are read
// leniently (a JSON object anywhere in the text) and kept only for ids
// that exist.
(function (root) {
  function lines(catalog) {
    return catalog.items.map((i) => `${i.id} | ${i.title} | ${i.description.slice(0, 160)} | tags: ${i.tags.slice(0, 5).join(", ")} | runtime: ${i.capabilities.join(", ") || "none"} | ${i.free ? "free" : "subscribers"}`).join("\n");
  }

  function prompt(catalog, ask, n) {
    return [
      "You are the curator of a catalog of single-file HTML apps. Here is the whole catalog, one app per line (id | title | description | tags | runtime | access):",
      "",
      lines(catalog),
      "",
      `Request: ${ask}`,
      "",
      `Choose at most ${n} apps from the catalog that answer the request, best first, and say in one short sentence each why. Use only ids from the list.`,
      'Answer with JSON only, in this shape: {"picks": [{"id": "<id>", "why": "<one sentence>"}], "note": "<one optional sentence for the reader>"}',
    ].join("\n");
  }

  // parse finds the first JSON object in text and keeps picks whose id
  // is in the catalog; null when nothing usable is there.
  function parse(text, catalog) {
    const ids = new Set(catalog.items.map((i) => i.id));
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    let o;
    try { o = JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
    const picks = (Array.isArray(o.picks) ? o.picks : []).filter((p) => p && ids.has(p.id))
      .map((p) => ({ id: p.id, why: String(p.why || "").slice(0, 300) }));
    return picks.length ? { picks, note: String(o.note || "").slice(0, 300) } : null;
  }

  // seeded: a stable choice of n free apps for a day, when no model is at hand.
  function seeded(catalog, day, n) {
    let h = 2166136261;
    for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const free = catalog.items.filter((i) => i.free), out = [];
    while (out.length < Math.min(n, free.length)) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
      const i = free[h % free.length];
      if (!out.includes(i)) out.push(i);
    }
    return out.map((i) => ({ id: i.id, why: "" }));
  }

  root.Curate = { lines, prompt, parse, seeded };
})(typeof module !== "undefined" ? module.exports : window);
