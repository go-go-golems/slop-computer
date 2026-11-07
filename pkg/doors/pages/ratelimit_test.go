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

// A bucket is dropped only once it would be full again: with a burst much
// larger than the limit, refilling takes far longer than two windows, and
// dropping it early would hand the next request a fresh full burst.
func TestRateLimiterSweepWaitsForRefill(t *testing.T) {
	var l rateLimiter
	rule := registry.RateLimitConfig{Per: "ip", Limit: 1, Window: "1h", Burst: 100}
	t0 := time.Unix(1000, 0)
	for i := 0; i < 100; i++ {
		if ok, _ := l.take("k", rule, t0); !ok {
			t.Fatalf("take %d of the burst refused", i)
		}
	}
	// Just past two windows: two tokens are back, not a hundred.
	t2 := t0.Add(2*time.Hour + time.Minute)
	l.sweep(t2)
	if l.size() != 1 {
		t.Fatalf("a drained bucket was swept after two windows (size %d)", l.size())
	}
	got := 0
	for {
		if ok, _ := l.take("k", rule, t2); !ok {
			break
		}
		got++
	}
	if got != 2 {
		t.Fatalf("after 2h at 1/h: %d requests allowed, want 2", got)
	}
	// Once it would be full (empty again: 100 h to refill), it may go.
	l.sweep(t2.Add(99 * time.Hour))
	if l.size() != 1 {
		t.Fatalf("swept before it refilled (size %d)", l.size())
	}
	l.sweep(t2.Add(100*time.Hour + time.Second))
	if l.size() != 0 {
		t.Fatalf("a full bucket was kept (size %d)", l.size())
	}
}
