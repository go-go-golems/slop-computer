// Pinboard's command-line verbs for collections: slop pb <board> coll <verb>.

function ls() {
  return require("slop").board().call("collections", {});
}
__verb__("ls", { parents: ["coll"], short: "List collections with their fields and row counts" });

// "minutes<30" → ["minutes", "<", 30]
function condition(s) {
  const m = /^\s*([A-Za-z_][\w.]*)\s*(==|!=|<=|>=|<|>|=|~)\s*(.*)$/.exec(s);
  if (!m) throw new Error('a condition looks like field<op>value, with op one of == != < <= > >= ~ (contains): ' + s);
  const op = m[2] === "=" ? "==" : m[2] === "~" ? "contains" : m[2];
  return [m[1], op, value(m[3])];
}
function value(v) {
  if (v === "true" || v === "false") return v === "true";
  if (v !== "" && !isNaN(Number(v))) return Number(v);
  return v;
}

doc`---
verb: query
---
Rows of one collection. Conditions are field<op>value, for example
--where 'minutes<30' --where 'tags~easy' (~ is "contains").`;

function query(coll, where, orderBy, desc, limit) {
  return require("slop").board().call("query", { coll, where: (where || []).map(condition), orderBy, desc, limit });
}
__verb__("query", {
  parents: ["coll"],
  short: "Rows of a collection",
  fields: {
    coll: { argument: true, help: "The collection" },
    where: { type: "stringList", help: "Conditions: field<op>value" },
    orderBy: { help: "Order by this field" },
    desc: { type: "bool", help: "Descending" },
    limit: { type: "int", default: 100, help: "At most this many" },
  },
});

function insert(coll, set) {
  const data = {};
  for (const kv of set || []) {
    const i = kv.indexOf("=");
    if (i < 1) throw new Error("--set takes field=value: " + kv);
    data[kv.slice(0, i).trim()] = value(kv.slice(i + 1));
  }
  if (!Object.keys(data).length) throw new Error("nothing to insert: give --set field=value");
  const b = require("slop").board();
  return b.call("insert", { coll, data, via: b.via || "cli" });
}
__verb__("insert", {
  parents: ["coll"],
  short: "Add a row to a collection (made if it does not exist)",
  fields: {
    coll: { argument: true, help: "The collection" },
    set: { type: "stringList", help: "field=value, repeated" },
  },
});
