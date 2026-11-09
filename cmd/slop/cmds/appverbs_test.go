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
