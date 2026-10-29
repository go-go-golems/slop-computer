package rt

import (
	"bytes"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// Doc is one live document as queries see it.
type Doc struct {
	Path    string         `json:"path"`
	Body    map[string]any `json:"body"`
	Version int64          `json:"version"`
}

// Filter is one where(field, op, value).
type Filter struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

// Query is a collection query. The semantics follow the contract and
// francois's pkg/store/documents.go (Apply, matches, compare), except that
// range operators only match values of the same type.
type Query struct {
	Coll    string   `json:"coll"`
	Filters []Filter `json:"filters,omitempty"`
	Order   string   `json:"order,omitempty"`
	Desc    bool     `json:"desc,omitempty"`
	Limit   int      `json:"limit,omitempty"`
}

var errQuery = errors.New("invalid query")

// Validate checks a query against the contract's bounds.
func (q Query) Validate() error {
	if !ValidCollPath(q.Coll) || len(q.Filters) > MaxFilters || q.Limit < 0 || q.Limit > MaxQueryLimit || strings.Contains(q.Order, ".") {
		return errQuery
	}
	for _, f := range q.Filters {
		if f.Field == "" || strings.Contains(f.Field, ".") {
			return errQuery
		}
		switch f.Op {
		case "==", "!=", "<", "<=", ">", ">=", "array-contains":
		case "in", "not-in":
			a, ok := f.Value.([]any)
			if !ok || len(a) == 0 || len(a) > MaxInValues {
				return errQuery
			}
		default:
			return errQuery
		}
	}
	return nil
}

// Match reports whether a body passes every filter. A missing field never
// matches.
func (q Query) Match(body map[string]any) bool {
	for _, f := range q.Filters {
		v, ok := body[f.Field]
		if !ok || !matches(v, f) {
			return false
		}
	}
	return true
}

// Apply filters, orders (documents missing the order field last, then by
// id) and limits docs already scoped to the collection.
func (q Query) Apply(docs []Doc) []Doc {
	out := make([]Doc, 0, len(docs))
	for _, d := range docs {
		if q.Match(d.Body) {
			out = append(out, d)
		}
	}
	q.Sort(out)
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out
}

// Sort orders docs as the query does.
func (q Query) Sort(docs []Doc) {
	sort.SliceStable(docs, func(i, j int) bool {
		a, b := docs[i], docs[j]
		if q.Order != "" {
			av, ao := a.Body[q.Order]
			bv, bo := b.Body[q.Order]
			if ao != bo {
				return ao
			}
			if ao {
				if c := compare(av, bv); c != 0 {
					return (c < 0) != q.Desc
				}
			}
		}
		return IDOf(a.Path) < IDOf(b.Path)
	})
}

func canon(v any) []byte { b, _ := json.Marshal(v); return b }

func equal(a, b any) bool { return bytes.Equal(canon(a), canon(b)) }

// compare orders numbers, then strings, then booleans, then anything else
// by its JSON text.
func compare(a, b any) int {
	ra, rb := rank(a), rank(b)
	if ra != rb {
		return ra - rb
	}
	switch x := a.(type) {
	case float64:
		y := b.(float64)
		switch {
		case x < y:
			return -1
		case x > y:
			return 1
		}
		return 0
	case string:
		return strings.Compare(x, b.(string))
	case bool:
		y := b.(bool)
		switch {
		case x == y:
			return 0
		case !x:
			return -1
		}
		return 1
	}
	return bytes.Compare(canon(a), canon(b))
}

func rank(v any) int {
	switch v.(type) {
	case float64:
		return 0
	case string:
		return 1
	case bool:
		return 2
	}
	return 3
}

func sameKind(a, b any) bool {
	ra, rb := rank(a), rank(b)
	return ra == rb && ra < 3
}

func matches(v any, f Filter) bool {
	switch f.Op {
	case "==":
		return equal(v, f.Value)
	case "!=":
		return !equal(v, f.Value)
	case "<", "<=", ">", ">=":
		if !sameKind(v, f.Value) {
			return false
		}
		c := compare(v, f.Value)
		switch f.Op {
		case "<":
			return c < 0
		case "<=":
			return c <= 0
		case ">":
			return c > 0
		}
		return c >= 0
	case "in", "not-in":
		found := false
		for _, item := range f.Value.([]any) {
			if equal(v, item) {
				found = true
				break
			}
		}
		return found == (f.Op == "in")
	case "array-contains":
		a, _ := v.([]any)
		for _, item := range a {
			if equal(item, f.Value) {
				return true
			}
		}
	}
	return false
}
