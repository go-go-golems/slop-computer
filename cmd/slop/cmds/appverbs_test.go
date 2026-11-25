package cmds

import (
	"strings"
	"testing"
)

// SLOP3-017 F5: cached verbs are per server URL, not per host.
func TestServerKeyKeepsSchemeAndPath(t *testing.T) {
	key := serverKey
	distinct := []string{"http://example.com", "https://example.com", "https://example.com/a", "https://example.com/b", "https://example.com:8443"}
	seen := map[string]string{}
	for _, s := range distinct {
		k := key(s)
		if other, ok := seen[k]; ok {
			t.Fatalf("%s and %s share %s", s, other, k)
		}
		seen[k] = s
	}
	if key("https://Example.com/") != key("https://example.com") || key("https://example.com/a/") != key("https://example.com/a") {
		t.Fatal("equivalent URLs differ")
	}
	if k := key("https://example.com:8443/x"); !strings.HasPrefix(k, "example.com_8443-") || strings.ContainsAny(k, "/:") {
		t.Fatalf("not a readable directory name: %s", k)
	}
}

// SLOP3-026 G9: an unknown top-level command says how aliases are learned.
func TestUnknownCommandHintsAtAliases(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir()) // no learned aliases
	root := Root()
	root.SetArgs([]string{"zzalias", "board", "describe"})
	root.SetOut(&strings.Builder{})
	root.SetErr(&strings.Builder{})
	err := root.Execute()
	if err == nil {
		t.Fatal("an unknown command succeeded")
	}
	if got := Explain(err); !strings.Contains(got, "slop on <store> --help") || !strings.Contains(got, "using-app-verbs") {
		t.Fatalf("no alias hint: %s", got)
	}
	// cobra adds suggestions after the first line when a name is close.
	root = Root()
	root.SetArgs([]string{"ap", "kitchen"}) // close to "app"
	root.SetOut(&strings.Builder{})
	root.SetErr(&strings.Builder{})
	if err := root.Execute(); err == nil || !strings.Contains(Explain(err), "slop on <store> --help") {
		t.Fatalf("no alias hint for a name with suggestions: %v", err)
	}
	if got := Explain(errFor("permission_denied: no")); got != "permission_denied: no" {
		t.Fatalf("other errors change: %s", got)
	}
}

type errFor string

func (e errFor) Error() string { return string(e) }

func TestMdEscapeKeepsHelpTextLiteral(t *testing.T) {
	got := mdEscape("Give store:<id> to @member, not `<x>`.\n\n  slop vendor add preact@10.24.3\n  slop vendor rm preact\n\nDone.")
	want := "Give store:\\<id\\> to &#64;member, not `<x>`.\n\n```\n  slop vendor add preact@10.24.3\n  slop vendor rm preact\n```\n\nDone."
	if got != want {
		t.Fatalf("mdEscape:\n%q\nwant\n%q", got, want)
	}
}
