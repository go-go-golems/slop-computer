package server

import (
	"sync"
	"time"
)

// limiter is a sliding-window rate limiter keyed by string (copied from
// francois pkg/catalog/demos.go).
type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newLimiter() *limiter { return &limiter{hits: map[string][]time.Time{}} }

func (l *limiter) available(key string, limit int, window time.Duration, now time.Time) bool {
	cut := now.Add(-window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	l.hits[key] = kept
	if len(l.hits) > 10000 {
		for k, v := range l.hits {
			if len(v) == 0 || v[len(v)-1].Before(cut) {
				delete(l.hits, k)
			}
		}
	}
	return len(kept) < limit
}

// left reports whether key has a hit left in its window, without spending it.
func (l *limiter) left(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.available(key, limit, window, time.Now())
}

// take spends one of key's hits, or reports that none are left.
func (l *limiter) take(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if !l.available(key, limit, window, now) {
		return false
	}
	l.hits[key] = append(l.hits[key], now)
	return true
}
