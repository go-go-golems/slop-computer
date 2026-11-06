package pages

import (
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/registry"
)

func TestRateLimiter(t *testing.T) {
	var l rateLimiter
	rule := registry.RateLimitConfig{Per: "ip", Limit: 2, Window: "1m"}
	t0 := time.Unix(1000, 0)
	for i := 0; i < 2; i++ {
		if ok, _ := l.take("k", rule, t0); !ok {
			t.Fatalf("take %d refused", i)
		}
	}
	ok, retry := l.take("k", rule, t0)
	if ok || retry != 30*time.Second {
		t.Fatalf("third take: %v %v (want refused, 30s: one token per 30s)", ok, retry)
	}
	if ok, _ := l.take("k", rule, t0.Add(30*time.Second)); !ok {
		t.Fatal("a token did not come back after 30s")
	}
	// Another key has its own bucket; a changed rule starts full.
	if ok, _ := l.take("other", rule, t0); !ok {
		t.Fatal("another key was limited")
	}
	wider := rule
	wider.Limit = 10
	if ok, _ := l.take("k", wider, t0.Add(30*time.Second)); !ok {
		t.Fatal("a changed rule did not start full")
	}
	// Burst caps the bucket.
	burst := registry.RateLimitConfig{Per: "ip", Limit: 60, Window: "1m", Burst: 1}
	if ok, _ := l.take("b", burst, t0); !ok {
		t.Fatal("burst first take refused")
	}
	if ok, _ := l.take("b", burst, t0); ok {
		t.Fatal("burst 1 allowed two at once")
	}
	// Idle buckets go after twice their window.
	if l.size() != 3 {
		t.Fatalf("size = %d", l.size())
	}
	l.sweep(t0.Add(3 * time.Minute))
	if l.size() != 0 {
		t.Fatalf("after sweep, size = %d", l.size())
	}
}
