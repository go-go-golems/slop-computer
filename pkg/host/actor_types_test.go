package host

import (
	"regexp"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/apptypes"
)

// shapeActor reports the property names of ctx and of the built-in
// modules' objects, by the actor.d.ts interface that declares each.
const shapeActor = `
const names = (o) => (o == null ? null : Object.getOwnPropertyNames(o));
defineActor({ actions: { shape: { requires: 'view', run(ctx) {
  const db = use('db'), storage = use('storage');
  return {
    Ctx: names(ctx), Visitor: names(ctx.visitor),
    SqlModule: names(use('sql')), DbModule: names(db),
    DocRef: names(db.doc('notes/a')), DocSnapshot: names(db.doc('notes/a').get()), DocQuery: names(db.collection('notes')),
    FilesModule: names(use('files')), AlarmModule: names(use('alarm')), TimeModule: names(use('time')),
    LogModule: names(use('log')), StoresModule: names(use('stores')), RoomModule: names(use('room')),
    SecretsModule: names(use('secrets')),
    StorageModule: names(storage), 'StorageModule.kv': names(storage.kv), 'StorageModule.sql': names(storage.sql),
    SqlCursor: names(storage.sql.exec('SELECT 1 AS x')),
  };
} } } });
`

// actor.d.ts declares what the runtime gives an actor: every property of
// ctx and of the built-in modules' objects is a member of its interface
// there (SLOP3-024). A property the runtime gains without a declaration
// fails here.
func TestActorTypesDrift(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "shape"})
	h.call(admin, "files.push", map[string]any{"store": "shape", "files": files(map[string]string{
		"app.json": `{"title":"Shape","actor":"actor.js","slop":{"secrets":["k"]}}`,
		"actor.js": shapeActor,
	})})
	got := h.call(admin, "actor.call", map[string]any{"store": "shape", "action": "shape"}).(map[string]any)
	if len(got) < 15 {
		t.Fatalf("shape = %v", got)
	}
	for name, v := range got {
		keys, ok := v.([]any)
		if !ok {
			continue // a module that is null for this app
		}
		iface, nested, _ := strings.Cut(name, ".")
		block, members := interfaceOf(apptypes.Actor, iface)
		if block == "" {
			t.Errorf("actor.d.ts has no interface %s", iface)
			continue
		}
		for _, k := range keys {
			k := k.(string)
			if nested != "" {
				if !regexp.MustCompile(`\b` + regexp.QuoteMeta(k) + `\??[(:<]`).MatchString(block) {
					t.Errorf("%s.%s has %s, which actor.d.ts does not declare", iface, nested, k)
				}
				continue
			}
			if !members[k] {
				t.Errorf("%s has %s, which actor.d.ts does not declare", iface, k)
			}
		}
	}
}

var memberLine = regexp.MustCompile(`^  (?:readonly )?([A-Za-z_$][A-Za-z0-9_$]*)\??\s*[(:<]`)

// interfaceOf finds "interface name" in a declaration file: its text and
// its members' names.
func interfaceOf(ts, name string) (string, map[string]bool) {
	start := regexp.MustCompile(`(?m)^interface ` + regexp.QuoteMeta(name) + `\b[^{]*\{\n`).FindStringIndex(ts)
	if start == nil {
		return "", nil
	}
	rest := ts[start[1]:]
	end := strings.Index(rest, "\n}")
	if end < 0 {
		return "", nil
	}
	block := rest[:end]
	members := map[string]bool{}
	for _, l := range strings.Split(block, "\n") {
		if m := memberLine.FindStringSubmatch(l); m != nil {
			members[m[1]] = true
		}
	}
	return block, members
}
