package rt

import (
	"encoding/json"
	"errors"
)

// Patch is a structural difference between two JSON values. Documents that
// grow (an op log rewritten on every save) travel as patches instead of
// whole bodies, in both directions; pages never see them.
//
//	{"t":"set","v":…}                    replace the value
//	{"t":"obj","k":{key: Patch}}          change some keys of an object
//	{"t":"del"}                           (inside obj) remove the key
//	{"t":"arr","s":i,"d":n,"i":[…]}       splice an array: at i, drop n, insert items
//
// web/runtime/src/db/diff.ts implements the same algorithm; both run the
// vectors in testdata/diff.json.
type Patch struct {
	T string           `json:"t"`
	V any              `json:"v,omitempty"`
	K map[string]Patch `json:"k,omitempty"`
	S int              `json:"s,omitempty"`
	D int              `json:"d,omitempty"`
	I []any            `json:"i,omitempty"`
}

// Diff returns the patch from a to b, or nil when they are equal.
func Diff(a, b any) *Patch {
	if equal(a, b) {
		return nil
	}
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok {
			break
		}
		p := Patch{T: "obj", K: map[string]Patch{}}
		for k, av := range x {
			if bv, ok := y[k]; !ok {
				p.K[k] = Patch{T: "del"}
			} else if d := Diff(av, bv); d != nil {
				p.K[k] = *d
			}
		}
		for k, bv := range y {
			if _, ok := x[k]; !ok {
				p.K[k] = Patch{T: "set", V: bv}
			}
		}
		return &p
	case []any:
		y, ok := b.([]any)
		if !ok {
			break
		}
		pre := 0
		for pre < len(x) && pre < len(y) && equal(x[pre], y[pre]) {
			pre++
		}
		suf := 0
		for suf < len(x)-pre && suf < len(y)-pre && equal(x[len(x)-1-suf], y[len(y)-1-suf]) {
			suf++
		}
		items := append([]any{}, y[pre:len(y)-suf]...)
		return &Patch{T: "arr", S: pre, D: len(x) - pre - suf, I: items}
	}
	return &Patch{T: "set", V: b}
}

var errPatch = errors.New("patch does not apply")

// Apply returns a with p applied. a is not modified.
func Apply(a any, p Patch) (any, error) {
	switch p.T {
	case "set":
		return p.V, nil
	case "obj":
		x, ok := a.(map[string]any)
		if !ok {
			return nil, errPatch
		}
		out := make(map[string]any, len(x)+len(p.K))
		for k, v := range x {
			out[k] = v
		}
		for k, sub := range p.K {
			if sub.T == "del" {
				delete(out, k)
				continue
			}
			v, err := Apply(x[k], sub)
			if err != nil {
				return nil, err
			}
			out[k] = v
		}
		return out, nil
	case "arr":
		x, ok := a.([]any)
		if !ok || p.S < 0 || p.D < 0 || p.S+p.D > len(x) {
			return nil, errPatch
		}
		out := make([]any, 0, len(x)-p.D+len(p.I))
		out = append(out, x[:p.S]...)
		out = append(out, p.I...)
		return append(out, x[p.S+p.D:]...), nil
	}
	return nil, errPatch
}

// PatchSize is the size of a patch on the wire.
func PatchSize(p *Patch) int { b, _ := json.Marshal(p); return len(b) }
