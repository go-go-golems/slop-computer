package tscompile

import (
	"container/list"
	"sync"
)

// lru is a cache of compile results bounded by bytes: the least recently
// used results go first.
type lru struct {
	mu    sync.Mutex
	max   int
	size  int
	order *list.List // front: most recently used
	items map[string]*list.Element
}

type lruItem struct {
	key  string
	r    result
	size int
}

func newLRU(max int) *lru {
	return &lru{max: max, order: list.New(), items: map[string]*list.Element{}}
}

func (c *lru) get(key string) (result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		return result{}, false
	}
	c.order.MoveToFront(e)
	return e.Value.(*lruItem).r, true
}

func (c *lru) put(key string, r result, size int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[key]; ok {
		c.size -= e.Value.(*lruItem).size
		c.order.Remove(e)
	}
	if size > c.max {
		return
	}
	c.items[key] = c.order.PushFront(&lruItem{key, r, size})
	c.size += size
	for c.size > c.max {
		e := c.order.Back()
		it := e.Value.(*lruItem)
		c.order.Remove(e)
		delete(c.items, it.key)
		c.size -= it.size
	}
}
