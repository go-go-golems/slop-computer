package rt

import (
	"fmt"
	"sort"
	"strings"
)

// Level is a person's access to a target. Self is a level nobody holds: a
// rule asking for it can only be met by a {self} rule below it.
type Level int

const (
	LevelNone Level = iota
	LevelView
	LevelInteract
	LevelAdmin
	LevelOwner
	LevelSelf
)

var levelNames = map[string]Level{"view": LevelView, "interact": LevelInteract, "admin": LevelAdmin, "owner": LevelOwner, "self": LevelSelf}

func (l Level) String() string {
	for n, v := range levelNames {
		if v == l {
			return n
		}
	}
	return "none"
}

// ParseLevel reads a rule or topic level.
func ParseLevel(s string) (Level, bool) { l, ok := levelNames[s]; return l, ok }

// Rule is one db rule from a manifest: the minimum level to read and write
// at a path and everything below it. "" leaves a level inherited.
type Rule struct {
	Path  string `json:"path"`
	Read  string `json:"read,omitempty"`
	Write string `json:"write,omitempty"`
}

type rule struct {
	segs        []string // "{self}" may be the last
	read, write Level    // LevelNone: inherit
}

// Rules is a compiled rule set. The root defaults to read view, write
// interact.
type Rules struct{ rules []rule }

// CompileRules validates and compiles manifest rules.
func CompileRules(in []Rule) (Rules, error) {
	if len(in) > MaxRules {
		return Rules{}, fmt.Errorf("at most %d db rules", MaxRules)
	}
	out := Rules{}
	byPath := map[string]rule{}
	for _, r := range in {
		var segs []string
		if r.Path != "" {
			segs = strings.Split(r.Path, "/")
		}
		for i, s := range segs {
			if s == "{self}" {
				if i != len(segs)-1 {
					return Rules{}, fmt.Errorf("rule %q: {self} must be the last segment", r.Path)
				}
				continue
			}
			if len(s) > MaxSegmentBytes || !segmentRe.MatchString(s) {
				return Rules{}, fmt.Errorf("rule %q: bad segment %q", r.Path, s)
			}
		}
		c := rule{segs: segs}
		for _, lv := range []struct {
			name string
			dst  *Level
		}{{r.Read, &c.read}, {r.Write, &c.write}} {
			if lv.name == "" {
				continue
			}
			l, ok := ParseLevel(lv.name)
			if !ok {
				return Rules{}, fmt.Errorf("rule %q: unknown level %q", r.Path, lv.name)
			}
			*lv.dst = l
		}
		byPath[r.Path] = c
		out.rules = append(out.rules, c)
	}
	// A rule at the prefix of a {self} rule must set both levels.
	for p, c := range byPath {
		if n := len(c.segs); n > 0 && c.segs[n-1] == "{self}" {
			prefix := strings.Join(c.segs[:n-1], "/")
			if pr, ok := byPath[prefix]; ok && (pr.read == LevelNone || pr.write == LevelNone) {
				return Rules{}, fmt.Errorf("rule %q: the rule at %q must set both read and write", p, prefix)
			}
		}
	}
	sort.SliceStable(out.rules, func(i, j int) bool { return len(out.rules[i].segs) < len(out.rules[j].segs) })
	return out, nil
}

// Need returns the levels a user needs to read and write a document path.
// A {self} segment matches the user's own id.
func (rs Rules) Need(path, user string) (Level, Level) {
	var read, write Level
	read, write = LevelView, LevelInteract
	segs := strings.Split(path, "/")
	for _, r := range rs.rules { // shallow to deep: deeper rules override
		if len(r.segs) > len(segs) {
			continue
		}
		ok := true
		for i, s := range r.segs {
			if s == "{self}" {
				ok = user != "" && segs[i] == user
			} else if segs[i] != s {
				ok = false
			}
			if !ok {
				break
			}
		}
		if !ok {
			continue
		}
		if r.read != LevelNone {
			read = r.read
		}
		if r.write != LevelNone {
			write = r.write
		}
	}
	if write < read {
		write = read
	}
	return read, write
}

// CanRead reports whether user (holding level) may read path. A path under
// another user's data/users/<id>/ reads as missing to everyone else.
func (rs Rules) CanRead(path, user string, level Level) bool {
	if owner, ok := privateOwner(path); ok && owner != user {
		return false
	}
	need, _ := rs.Need(path, user)
	return meets(level, need)
}

// CanWrite reports whether user (holding level) may write path.
func (rs Rules) CanWrite(path, user string, level Level) bool {
	if owner, ok := privateOwner(path); ok && owner != user {
		return false
	}
	_, need := rs.Need(path, user)
	return meets(level, need)
}

// meets: the owner meets every level but self; self is never met.
func meets(have, need Level) bool { return need != LevelSelf && have >= need }
