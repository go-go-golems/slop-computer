package verbs

// TypeScript from JSON Schemas (SLOP3-024, design §5.3): the declarations
// of verb-backed modules (workshop, system) are generated from their verbs'
// input and output schemas, so a module function's TypeScript says what
// the verb accepts and returns, and changes when the verb does.
//
// It covers the subset of JSON Schema that verbs reflect to: objects with
// required and optional properties, maps (additionalProperties), arrays
// and tuples, enums and consts, primitives, and oneOf/anyOf as unions.
// Descriptions become doc comments. Anything else ($ref, not, if/then) is
// unknown: a declaration may be looser than the data, never narrower.

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/invopop/jsonschema"
)

// TypeScript is the TypeScript type s describes, laid out for a
// declaration file whose current line is indented by indent: an object
// puts each property on a line of its own. nil, true and {} are unknown.
func TypeScript(s *jsonschema.Schema, indent string) string {
	return tsType(s, indent, 0)
}

// TypeScriptObjectMembers is the property list of an object schema, one
// "name?: type;" per line at indentation indent with doc comments, for
// building a parameter or interface by hand ("" for a schema without
// properties). skip names properties to leave out, and optional names
// properties to declare optional whatever the schema says.
func TypeScriptObjectMembers(s *jsonschema.Schema, indent string, skip, optional map[string]bool) string {
	if s == nil || s.Properties == nil {
		return ""
	}
	required := map[string]bool{}
	for _, r := range s.Required {
		required[r] = true
	}
	var b strings.Builder
	for p := s.Properties.Oldest(); p != nil; p = p.Next() {
		if skip[p.Key] {
			continue
		}
		writeDoc(&b, indent, p.Value.Description)
		opt := "?"
		if required[p.Key] && !optional[p.Key] {
			opt = ""
		}
		b.WriteString(indent + tsKey(p.Key) + opt + ": " + tsType(p.Value, indent, 1) + ";\n")
	}
	return b.String()
}

// tsMaxDepth bounds nesting: a schema deeper than this (a recursive type
// expanded) is unknown below it.
const tsMaxDepth = 12

func tsType(s *jsonschema.Schema, ind string, depth int) string {
	switch {
	case s == nil || s == jsonschema.TrueSchema || depth > tsMaxDepth:
		return "unknown"
	case s == jsonschema.FalseSchema:
		return "never"
	case s.Ref != "" || s.Not != nil || s.If != nil:
		return "unknown"
	case s.Const != nil:
		return tsLiteral(s.Const)
	case len(s.Enum) > 0:
		lits := make([]string, len(s.Enum))
		for i, e := range s.Enum {
			lits[i] = tsLiteral(e)
		}
		return union(lits)
	}
	if alts := append(append([]*jsonschema.Schema{}, s.OneOf...), s.AnyOf...); len(alts) > 0 {
		parts := make([]string, len(alts))
		for i, a := range alts {
			parts[i] = tsType(a, ind, depth+1)
		}
		u := union(parts)
		if s.Properties != nil && s.Properties.Len() > 0 { // properties every alternative has
			return tsObject(s, ind, depth) + " & (" + u + ")"
		}
		return u
	}
	if len(s.AllOf) > 0 {
		parts := make([]string, len(s.AllOf))
		for i, a := range s.AllOf {
			parts[i] = paren(tsType(a, ind, depth+1))
		}
		return strings.Join(parts, " & ")
	}
	switch s.Type {
	case "string":
		return "string"
	case "integer", "number":
		return "number"
	case "boolean":
		return "boolean"
	case "null":
		return "null"
	case "array":
		if len(s.PrefixItems) > 0 {
			items := make([]string, len(s.PrefixItems))
			for i, it := range s.PrefixItems {
				items[i] = tsType(it, ind, depth+1)
			}
			return "[" + strings.Join(items, ", ") + "]"
		}
		return paren(tsType(s.Items, ind, depth+1)) + "[]"
	case "object":
		return tsObject(s, ind, depth)
	case "":
		if s.Properties != nil {
			return tsObject(s, ind, depth)
		}
	}
	return "unknown"
}

// tsObject is an object type: its properties, or a Record for a map.
func tsObject(s *jsonschema.Schema, ind string, depth int) string {
	extra := s.AdditionalProperties
	if s.Properties == nil || s.Properties.Len() == 0 {
		if extra == jsonschema.FalseSchema {
			return "Record<string, never>"
		}
		return "Record<string, " + tsType(extra, ind, depth+1) + ">"
	}
	required := map[string]bool{}
	for _, r := range s.Required {
		required[r] = true
	}
	inner := ind + "  "
	var b strings.Builder
	b.WriteString("{\n")
	for p := s.Properties.Oldest(); p != nil; p = p.Next() {
		writeDoc(&b, inner, p.Value.Description)
		opt := "?"
		if required[p.Key] {
			opt = ""
		}
		b.WriteString(inner + tsKey(p.Key) + opt + ": " + tsType(p.Value, inner, depth+1) + ";\n")
	}
	if extra != nil && extra != jsonschema.FalseSchema {
		// other keys besides the named ones: their type must admit the
		// named ones' too, so it says only that they exist
		b.WriteString(inner + "[key: string]: unknown;\n")
	}
	b.WriteString(ind + "}")
	return b.String()
}

// union joins types with |, once each; unknown absorbs the rest.
func union(parts []string) string {
	var out []string
	seen := map[string]bool{}
	for _, p := range parts {
		if p == "unknown" {
			return "unknown"
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return strings.Join(out, " | ")
}

// paren wraps t in parentheses when it is a union or an intersection at
// its top level, for t[] and t & u.
func paren(t string) string {
	depth := 0
	inStr := false
	for i := 0; i < len(t); i++ {
		c := t[i]
		switch {
		case inStr:
			switch c {
			case '\\':
				i++
			case '"':
				inStr = false
			}
		case c == '"':
			inStr = true
		case c == '{' || c == '(' || c == '[' || c == '<':
			depth++
		case c == '}' || c == ')' || c == ']' || c == '>':
			depth--
		case depth == 0 && (c == '|' || c == '&'):
			return "(" + t + ")"
		}
	}
	return t
}

var tsIdent = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

// tsKey is a property name as TypeScript writes it: bare, or quoted.
func tsKey(k string) string {
	if tsIdent.MatchString(k) {
		return k
	}
	b, _ := json.Marshal(k)
	return string(b)
}

// tsLiteral is a const or enum value as a TypeScript literal type.
func tsLiteral(v any) string {
	switch v.(type) {
	case string, bool, nil, float64, int, int64, json.Number:
		b, err := json.Marshal(v)
		if err == nil {
			return string(b)
		}
	}
	return "unknown"
}

// writeDoc writes a doc comment for the line that follows.
func writeDoc(b *strings.Builder, ind, doc string) {
	doc = strings.TrimSpace(strings.ReplaceAll(doc, "*/", "*\\/"))
	if doc == "" {
		return
	}
	if !strings.Contains(doc, "\n") {
		b.WriteString(ind + "/** " + doc + " */\n")
		return
	}
	b.WriteString(ind + "/**\n")
	for _, l := range strings.Split(doc, "\n") {
		b.WriteString(strings.TrimRight(ind+" * "+l, " ") + "\n")
	}
	b.WriteString(ind + " */\n")
}
