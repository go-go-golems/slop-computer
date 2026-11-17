package npmvendor

import (
	"encoding/json"
	"errors"
	"strings"
)

// imports is the value of slop.imports in app.json.
type imports struct {
	Page  map[string]string `json:"page,omitempty"`
	Actor map[string]string `json:"actor,omitempty"`
}

// setImports writes slop.imports into app.json and changes nothing else:
// app.json is written by hand, so every other byte stays as it was. With
// both sides empty the member is removed.
func setImports(raw []byte, im imports) ([]byte, error) {
	if !json.Valid(raw) {
		return nil, errors.New("app.json is not valid JSON")
	}
	root := skipWS(raw, 0)
	if root >= len(raw) || raw[root] != '{' {
		return nil, errors.New("app.json is not a JSON object")
	}
	unit := indentUnit(raw, root)
	empty := len(im.Page) == 0 && len(im.Actor) == 0
	rootMembers, rootEnd := members(raw, root)
	slop := find(rootMembers, "slop")
	if slop == nil {
		if empty {
			return raw, nil
		}
		value := `{"imports": ` + format(im, "", "") + `}`
		if unit != "" {
			ind := memberIndent(raw, rootMembers, unit, "")
			value = "{\n" + ind + unit + `"imports": ` + format(im, ind+unit, unit) + "\n" + ind + "}"
		}
		return insertMember(raw, root, rootEnd, rootMembers, "slop", value, unit, ""), nil
	}
	if raw[slop.valStart] != '{' {
		return nil, errors.New("app.json: slop is not an object")
	}
	ind := memberIndent(raw, rootMembers, unit, "")
	slopMembers, slopEnd := members(raw, slop.valStart)
	cur := find(slopMembers, "imports")
	if !strings.Contains(string(raw[slop.valStart:slopEnd]), "\n") {
		unit = "" // slop is written on one line: keep it there
	}
	inner := ind + unit
	if len(slopMembers) > 0 {
		inner = lineIndent(raw, slopMembers[0].keyStart, inner)
	}
	switch {
	case cur != nil && empty:
		return removeMember(raw, slop.valStart, slopEnd, slopMembers, cur), nil
	case cur != nil:
		return splice(raw, cur.valStart, cur.valEnd, format(im, inner, unit)), nil
	case empty:
		return raw, nil
	}
	return insertMember(raw, slop.valStart, slopEnd, slopMembers, "imports", format(im, inner, unit), unit, ind), nil
}

func format(im imports, prefix, unit string) string {
	if unit == "" {
		b, _ := json.Marshal(im)
		return string(b)
	}
	b, _ := json.MarshalIndent(im, prefix, unit)
	return string(b)
}

type member struct {
	key                        string
	keyStart, valStart, valEnd int
}

func find(ms []member, key string) *member {
	for i := range ms {
		if ms[i].key == key {
			return &ms[i]
		}
	}
	return nil
}

// members lists the members of the object at raw[start] ('{') and returns
// the offset of its closing brace. raw is valid JSON.
func members(raw []byte, start int) ([]member, int) {
	var out []member
	i := skipWS(raw, start+1)
	for raw[i] != '}' {
		ks := i
		i = skipString(raw, i)
		var key string
		_ = json.Unmarshal(raw[ks:i], &key)
		i = skipWS(raw, i)
		i = skipWS(raw, i+1) // the colon
		vs := i
		i = skipValue(raw, i)
		out = append(out, member{key, ks, vs, i})
		i = skipWS(raw, i)
		if raw[i] == ',' {
			i = skipWS(raw, i+1)
		}
	}
	return out, i
}

func skipWS(raw []byte, i int) int {
	for i < len(raw) && strings.IndexByte(" \t\r\n", raw[i]) >= 0 {
		i++
	}
	return i
}

func skipString(raw []byte, i int) int {
	for i++; raw[i] != '"'; i++ {
		if raw[i] == '\\' {
			i++
		}
	}
	return i + 1
}

func skipValue(raw []byte, i int) int {
	switch raw[i] {
	case '"':
		return skipString(raw, i)
	case '{', '[':
		depth := 0
		for ; ; i++ {
			switch raw[i] {
			case '"':
				i = skipString(raw, i) - 1
			case '{', '[':
				depth++
			case '}', ']':
				if depth--; depth == 0 {
					return i + 1
				}
			}
		}
	}
	for i < len(raw) && strings.IndexByte(",}] \t\r\n", raw[i]) < 0 {
		i++
	}
	return i
}

// lineIndent is the whitespace before pos on its line, or def when pos is
// not first on its line.
func lineIndent(raw []byte, pos int, def string) string {
	start := pos
	for start > 0 && (raw[start-1] == ' ' || raw[start-1] == '\t') {
		start--
	}
	if start > 0 && raw[start-1] != '\n' {
		return def
	}
	return string(raw[start:pos])
}

// indentUnit is one level of the file's indentation ("" when the object at
// root is on one line).
func indentUnit(raw []byte, root int) string {
	ms, _ := members(raw, root)
	if len(ms) == 0 {
		return ""
	}
	if ind := lineIndent(raw, ms[0].keyStart, ""); ind != "" {
		return ind
	}
	return ""
}

func memberIndent(raw []byte, ms []member, unit, parent string) string {
	if len(ms) > 0 {
		return lineIndent(raw, ms[0].keyStart, parent+unit)
	}
	return parent + unit
}

func splice(raw []byte, from, to int, s string) []byte {
	out := append([]byte{}, raw[:from]...)
	out = append(out, s...)
	return append(out, raw[to:]...)
}

// insertMember adds "key": value as the last member of the object at
// [open, end].
func insertMember(raw []byte, open, end int, ms []member, key, value, unit, parent string) []byte {
	k, _ := json.Marshal(key)
	if len(ms) == 0 {
		if unit == "" {
			return splice(raw, open+1, end, string(k)+": "+value)
		}
		return splice(raw, open+1, end, "\n"+parent+unit+string(k)+": "+value+"\n"+parent)
	}
	last := ms[len(ms)-1]
	sep := ", "
	if unit != "" {
		sep = ",\n" + lineIndent(raw, last.keyStart, parent+unit)
	}
	return splice(raw, last.valEnd, last.valEnd, sep+string(k)+": "+value)
}

// removeMember removes m from the object at [open, end] with its comma.
func removeMember(raw []byte, open, end int, ms []member, m *member) []byte {
	idx := 0
	for i := range ms {
		if ms[i].keyStart == m.keyStart {
			idx = i
		}
	}
	switch {
	case len(ms) == 1:
		return splice(raw, open+1, end, "")
	case idx+1 < len(ms):
		return splice(raw, m.keyStart, ms[idx+1].keyStart, "")
	}
	return splice(raw, ms[idx-1].valEnd, m.valEnd, "")
}
