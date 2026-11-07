package pages

// Token buckets for the rateLimit middleware (SLOP3-012 phase 4), in
// memory: one per (mount, rule, key), holding burst tokens (default limit)
// and refilled at limit per window. A bucket whose rule changed starts
// full; the door's minute tick drops buckets that would be full again.

import (
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/registry"
)

type bucket struct {
	rule   registry.RateLimitConfig
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

func capacity(rl registry.RateLimitConfig) float64 {
	if rl.Burst > 0 {
		return float64(rl.Burst)
	}
	return float64(rl.Limit)
}

// take spends a token of key's bucket under rule; when there is none, it
// says how long until there is.
func (l *rateLimiter) take(key string, rule registry.RateLimitConfig, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buckets == nil {
		l.buckets = map[string]*bucket{}
	}
	rate := float64(rule.Limit) / rule.WindowDuration().Seconds() // tokens per second
	b := l.buckets[key]
	if b == nil || b.rule != rule {
		b = &bucket{rule: rule, tokens: capacity(rule), last: now}
		l.buckets[key] = b
	}
	b.tokens = min(capacity(rule), b.tokens+now.Sub(b.last).Seconds()*rate)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / rate * float64(time.Second))
}

// sweep drops the buckets that would be full again by now: forgetting one
// then changes nothing, since a new bucket starts full. A bucket's refill
// time is (capacity - tokens) / rate, which with a burst well above the
// limit is many windows, so no fixed multiple of the window will do.
func (l *rateLimiter) sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		rate := float64(b.rule.Limit) / b.rule.WindowDuration().Seconds()
		if rate <= 0 {
			continue // no refill: keep it (validation forbids this rule)
		}
		refill := time.Duration((capacity(b.rule) - b.tokens) / rate * float64(time.Second))
		if now.Sub(b.last) >= refill {
			delete(l.buckets, k)
		}
	}
}

// size is the number of live buckets (tests).
func (l *rateLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
