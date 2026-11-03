package pages

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// --- audiences change over time ----------------------------------------------

// ReviewPerson re-checks the open views of one person, after their role,
// comps or subscription changed.
func (s *Door) ReviewPerson(ctx context.Context, person string) {
	seen := map[string]bool{}
	for _, v := range s.rt.views.Where(func(v *rt.View) bool { return v.User == person }) {
		if !seen[v.Target] {
			seen[v.Target] = true
			s.reviewViews(ctx, v.Target)
		}
	}
}

// ReviewAll re-checks every open view: a comp or a subscription period
// that ended demotes its person within one tick.
func (s *Door) ReviewAll(ctx context.Context) {
	seen := map[string]bool{}
	for _, v := range s.rt.views.Where(func(*rt.View) bool { return true }) {
		if !seen[v.Target] {
			seen[v.Target] = true
			s.reviewViews(ctx, v.Target)
		}
	}
}
