package host

import (
	"strings"
	"testing"
)

// A keyed call runs once: its resend (after a network error) gets the
// first result instead of committing again.
func TestKeyedCallsRunOnce(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	s, _, _ := clubSite(t, h, "una@example.com")
	h.call(admin, "sub.grant", map[string]any{"person": "una@example.com", "until": "30d"})
	st, v := openView(s, h.cfg.Hosts.Live[0], "/club", "")
	if st != 200 {
		t.Fatalf("view: %d %v", st, v)
	}
	sbx := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	write := func(key string) float64 {
		t.Helper()
		body := map[string]any{"method": "db.write", "args": map[string]any{"path": "notes/n", "op": "set", "body": map[string]any{"n": 1}}}
		if key != "" {
			body["key"] = key
		}
		r, out := s.do("POST", sbx, "/_rt/rpc", body, map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
		res, _ := out["result"].(map[string]any)
		rev, _ := res["rev"].(float64)
		if rev == 0 {
			t.Fatalf("write: %d %v", r.StatusCode, out)
		}
		return rev
	}
	first := write("k-1")
	if again := write("k-1"); again != first {
		t.Fatalf("a resend of k-1 committed again: rev %v, then %v", first, again)
	}
	if other := write("k-2"); other == first {
		t.Fatalf("another key did not run: rev %v", other)
	}
	if a, b := write(""), write(""); a == b {
		t.Fatalf("unkeyed writes share a result: rev %v", a)
	}
}
