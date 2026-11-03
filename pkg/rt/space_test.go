package rt

import (
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func testSpace() *Space {
	return &Space{Holder: "dash", Stores: LevelView, Aliases: map[string]Alias{
		"contacts": {Name: "contacts", Store: "crm", Prefix: "contacts", Level: LevelView},
		"cols":     {Name: "cols", Store: "ws", Prefix: "boards/b1/columns", Level: LevelInteract, Assets: true},
		"home":     {Name: "home", Store: "dash", Prefix: "notes", Level: LevelInteract},
		"people":   {Name: "people", Store: "crm", Prefix: "data", Level: LevelView, Assets: true},
	}}
}

func code(err error) string {
	var pe *PathError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

func TestSpaceResolve(t *testing.T) {
	sp := testSpace()
	cases := []struct {
		path string
		doc  bool
		want Target
		err  string
	}{
		{path: "notes/n1", doc: true, want: Target{Store: "dash", Path: "notes/n1", Own: true, Cap: LevelOwner}},
		{path: "notes", want: Target{Store: "dash", Path: "notes", Own: true, Cap: LevelOwner}},
		{path: "contacts", want: Target{Store: "crm", Path: "contacts", Cap: LevelView, Via: "contacts"}},
		{path: "contacts/c1", doc: true, want: Target{Store: "crm", Path: "contacts/c1", Cap: LevelView, Via: "contacts"}},
		{path: "contacts/c1/notes", want: Target{Store: "crm", Path: "contacts/c1/notes", Cap: LevelView, Via: "contacts"}},
		{path: "cols/c2", doc: true, want: Target{Store: "ws", Path: "boards/b1/columns/c2", Cap: LevelInteract, Via: "cols"}},
		{path: "home/x", doc: true, want: Target{Store: "dash", Path: "notes/x", Own: true, Cap: LevelInteract, Via: "home"}},
		{path: "_stores/crm/contacts/c1", doc: true, want: Target{Store: "crm", Path: "contacts/c1", Cap: LevelView, Via: StoresRoot}},
		{path: "_stores/dash/notes", want: Target{Store: "dash", Path: "notes", Own: true, Cap: LevelView, Via: StoresRoot}},
		{path: "_stores", want: Target{Via: StoresRoot, Cap: LevelView, Registry: true}},
		{path: "_stores/crm", doc: true, want: Target{Store: "crm", Via: StoresRoot, Cap: LevelView, Registry: true}},
		// parity: an alias and _stores keep a path's kind
		{path: "contacts", doc: true, err: "invalid_argument"},
		{path: "_stores/crm/contacts", doc: true, err: "invalid_argument"},
		{path: "_stores", doc: true, err: "invalid_argument"},
		{path: "_stores/crm", err: "invalid_argument"},
		// the platform's names
		{path: "_grants/x", doc: true, err: "invalid_argument"},
		{path: "_stores/crm/_other/x", doc: true, err: "invalid_argument"},
		// the registry's documents (phase 3)
		{path: "_stores/crm/_grants", want: Target{Store: "crm", Path: "_grants", Via: StoresRoot, Cap: LevelView, Registry: true}},
		{path: "_stores/crm/_grants/@member", doc: true, want: Target{Store: "crm", Path: "_grants/@member", Via: StoresRoot, Cap: LevelView, Registry: true}},
		{path: "_stores/crm/_grants/@member/x", err: "invalid_argument"},
		{path: "_people", want: Target{Path: "_people", Via: StoresRoot, Cap: LevelView, Registry: true}},
		{path: "_people/usr_1", doc: true, want: Target{Path: "_people/usr_1", Via: StoresRoot, Cap: LevelView, Registry: true}},
		// another store's private documents
		{path: "people/users/u1", err: "not_found"},
		{path: "people/users/u1/prefs", doc: true, err: "not_found"},
		{path: "_stores/crm/data/users/u1/prefs", doc: true, err: "not_found"},
		{path: "people/users", doc: true, want: Target{Store: "crm", Path: "data/users", Cap: LevelView, Via: "people"}},
		// but the holder's own, through _stores, are its own
		{path: "_stores/dash/data/users/u1/prefs", doc: true, want: Target{Store: "dash", Path: "data/users/u1/prefs", Own: true, Cap: LevelView, Via: StoresRoot}},
	}
	for _, c := range cases {
		got, err := sp.Resolve(c.path, c.doc)
		if c.err != "" {
			if code(err) != c.err {
				t.Errorf("%s (doc %v): want %s, got %+v, %v", c.path, c.doc, c.err, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s (doc %v): got %+v, %v; want %+v", c.path, c.doc, got, err, c.want)
		}
	}
}

// _stores reaches a store's documents to their full depth: two segments
// more than a page's own.
func TestSpaceDepth(t *testing.T) {
	sp := testSpace()
	deep := strings.TrimSuffix(strings.Repeat("a/1/", MaxPathSegments/2), "/") // 16 segments, a document
	if _, err := sp.Resolve(deep, true); err != nil {
		t.Fatalf("16 segments in the own store: %v", err)
	}
	if _, err := sp.Resolve("_stores/crm/"+deep, true); err != nil {
		t.Fatalf("18 segments under _stores: %v", err)
	}
	if _, err := sp.Resolve("_stores/crm/"+deep+"/x/y", true); err == nil {
		t.Fatal("20 segments under _stores resolved")
	}
}

func TestSpaceClosed(t *testing.T) {
	var none *Space
	if got, err := none.Resolve("notes/n1", true); err != nil || !got.Own || got.Path != "notes/n1" {
		t.Fatalf("nil space: %+v, %v", got, err)
	}
	for _, sp := range []*Space{none, {Holder: "dash"}} {
		if _, err := sp.Resolve("_stores/crm/contacts/c1", true); code(err) != "invalid_argument" {
			t.Fatalf("_stores without the capability: %v", err)
		}
	}
}

func TestSpacePagePaths(t *testing.T) {
	sp := testSpace()
	got := sp.PagePaths("crm", "contacts/c1")
	sort.Strings(got)
	if want := []string{"_stores/crm/contacts/c1", "contacts/c1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("crm contacts/c1 → %v, want %v", got, want)
	}
	// the holder's own contacts are hidden by the alias of that name
	if got := sp.PagePaths("dash", "contacts/c1"); !reflect.DeepEqual(got, []string{"_stores/dash/contacts/c1"}) {
		t.Fatalf("a shadowed own document appears at %v", got)
	}
	got = sp.PagePaths("dash", "notes/x")
	sort.Strings(got)
	if want := []string{"_stores/dash/notes/x", "home/x", "notes/x"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("dash notes/x → %v, want %v", got, want)
	}
	if got := sp.PagePaths("crm", "data/users/u1/prefs"); got != nil {
		t.Fatalf("another store's private document appears at %v", got)
	}
	if got := sp.PagePaths("ws", "boards/b2/columns/c1"); !reflect.DeepEqual(got, []string{"_stores/ws/boards/b2/columns/c1"}) {
		t.Fatalf("outside the alias prefix: %v", got)
	}
	// Every page path PagePaths gives resolves back to the same document.
	for _, store := range []string{"crm", "dash", "ws"} {
		for _, path := range []string{"contacts/c1", "notes/x", "boards/b1/columns/c2"} {
			for _, pp := range sp.PagePaths(store, path) {
				tg, err := sp.Resolve(pp, true)
				if err != nil || tg.Store != store || tg.Path != path {
					t.Errorf("%s %s → %s → %+v, %v", store, path, pp, tg, err)
				}
			}
		}
	}
}

func TestSpaceAssetStores(t *testing.T) {
	if got := testSpace().AssetStores(); !reflect.DeepEqual(got, []string{"ws", "crm"}) {
		t.Fatalf("asset stores %v (alias order: cols, people)", got)
	}
}

func TestValidAlias(t *testing.T) {
	for _, c := range []struct{ name, prefix string }{{"contacts", "contacts"}, {"cols", "boards/b1/columns"}} {
		if err := ValidAlias(c.name, c.prefix); err != nil {
			t.Errorf("%s → %s: %v", c.name, c.prefix, err)
		}
	}
	for _, c := range []struct{ name, prefix string }{{"_x", "contacts"}, {"a/b", "contacts"}, {"c", "boards/b1"}, {"c", "_grants"}, {"c", ""}} {
		if err := ValidAlias(c.name, c.prefix); err == nil {
			t.Errorf("%s → %s accepted", c.name, c.prefix)
		}
	}
	if ValidDocPath("_x/y") || ValidCollPath("_x") || !ValidDocPath("x/_y") {
		t.Fatal("only a top-level _ name is reserved")
	}
}
