package actors

// workshopFuncs is the workshop module: what a review or publishing tool
// needs, called as the visitor. push writes to the draft ref unless told
// otherwise: mounts serve main, and only publish moves it.
var workshopFuncs = []modFunc{
	{JS: "stores", Verb: "store.ls"}, // stores({all: true}): every store, for admins
	{JS: "snapshots", Verb: "snap.ls", Pos: []string{"store"}},
	{JS: "refs", Verb: "ref.ls", Pos: []string{"store"}},
	{JS: "files", Verb: "files.ls", Pos: []string{"store", "at"}},
	{JS: "read", Verb: "files.cat", Pos: []string{"store", "at", "path"}},
	{JS: "log", Verb: "log.show", Pos: []string{"store", "after", "limit"}},
	{JS: "push", Verb: "files.push", Pos: []string{"store", "files"}, Default: map[string]any{"ref": "draft"}},
	{JS: "moveRef", Verb: "ref.move", Pos: []string{"store", "ref", "n"}},
	{JS: "publish", Verb: "ref.move", Pos: []string{"store", "n"}, Fixed: map[string]any{"ref": "main"}},
	{JS: "follow", Verb: "app.follow", Pos: []string{"store", "ref"}},
	{JS: "status", Verb: "app.status", Pos: []string{"store"}},
	{JS: "preview", Verb: "preview.url", Pos: []string{"store", "at", "parent"}},
}
