package host

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// hostTransport sends every request to the harness with the main host.
type hostTransport struct{ host string }

func (t hostTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r.Host = t.host
	return http.DefaultTransport.RoundTrip(r)
}

// sample.run (SLOP3-009 step 5) asks the model as the caller, through the
// same capability as pages and actors: charged to their budget, refused
// without LLM access, and streamed to a client that accepts it.
func TestSampleRunVerb(t *testing.T) {
	h := newHarness(t)
	h.a.SetLLM(&llm.Fake{})
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com")
	c := &client.Client{Server: h.ts.URL, Token: admin, HTTP: &http.Client{Transport: hostTransport{h.cfg.Hosts.Main}}}

	// Without streaming: the whole answer.
	out := h.call(admin, "sample.run", map[string]any{"input": "hi"}).(map[string]any)
	if out["text"] != "slop is connected." || out["usage"] == nil {
		t.Fatalf("sample.run: %v", out)
	}

	// Streaming: the parts, then the same answer.
	var deltas []string
	res, err := c.CallStream("sample.run", map[string]any{"input": "fixture:stream", "modelTier": "quick"}, func(raw json.RawMessage) {
		var p struct{ Delta string }
		_ = json.Unmarshal(raw, &p)
		deltas = append(deltas, p.Delta)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(deltas) != 3 || deltas[0] != "first " || res.(map[string]any)["text"] != "first second third" {
		t.Fatalf("streamed %q, then %v", deltas, res)
	}

	// A refusal before any part is an ordinary error, streaming or not.
	h.fail(mia, "sample.run", map[string]any{"input": "hi"}, "permission_denied")
	c.Token = mia
	if _, err := c.CallStream("sample.run", map[string]any{"input": "hi"}, nil); err == nil {
		t.Fatal("mia sampled without LLM access")
	} else if e, ok := err.(*client.APIError); !ok || e.Code != "permission_denied" || e.Status != 403 {
		t.Fatalf("mia: %#v", err)
	}
	h.fail(admin, "sample.run", map[string]any{"input": 42}, "invalid_argument")

	// It is charged to the caller.
	u := h.call(admin, "llm.usage", map[string]any{}).(map[string]any)
	if used, _ := u["llm"].(map[string]any)["used"].(float64); used <= 0 {
		t.Fatalf("usage after sample.run: %v", u)
	}
}
