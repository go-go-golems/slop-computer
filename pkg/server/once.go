package server

import (
	"sync"
	"time"
)

// onceTTL is how long the first result of a keyed call answers its
// repeats: longer than any resend after a network error.
const onceTTL = 10 * time.Minute

// onceKey names a keyed call: the store, the person (a renewal may open
// another view for them) and the runtime's random key.
type onceKey struct{ target, user, key string }

type onceResult struct {
	done chan struct{}
	out  any
	err  error
	at   time.Time
}

// onceCache runs each keyed call once. A repeat of a key (the runtime
// resends after a network error) waits for the first run if it is still
// going and gets its result. It lives in memory: a restart between a
// commit and its response can still run a call twice, but a restart also
// ends every view.
type onceCache struct {
	mu    sync.Mutex
	m     map[onceKey]*onceResult
	swept time.Time
}

func (c *onceCache) do(k onceKey, fn func() (any, error)) (any, error) {
	now := time.Now()
	c.mu.Lock()
	if c.m == nil {
		c.m = map[onceKey]*onceResult{}
	}
	if now.Sub(c.swept) > time.Minute {
		for key, r := range c.m {
			if !r.at.IsZero() && now.Sub(r.at) > onceTTL {
				delete(c.m, key)
			}
		}
		c.swept = now
	}
	if r, ok := c.m[k]; ok {
		c.mu.Unlock()
		<-r.done
		return r.out, r.err
	}
	r := &onceResult{done: make(chan struct{})}
	c.m[k] = r
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		r.at = time.Now()
		c.mu.Unlock()
		close(r.done)
	}()
	r.out, r.err = fn()
	return r.out, r.err
}
