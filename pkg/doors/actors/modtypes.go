package actors

import (
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// TypeScript declarations of the verb-backed modules (SLOP3-024, design
// §5.3), generated from their functions' verbs: what a function takes is
// its verb's input schema as modArgs maps it, and what it returns is a
// promise of the verb's result. The declaration is the catalog entry's
// TypeScript, so app.modules shows it and app.types puts it in an app's
// modules.d.ts.

// workshopExtraTS declares workshopModule's own functions.
const workshopExtraTS = `  /** Delete an instance that runs unpublished code (another store's app, at a ref other than main). */
  drop(id: string): Promise<{ removed: string; [key: string]: unknown }>;
  /** Open a view of store for the visitor, framed by this app's own page ({dev: true}: with the dev probe, for admins). */
  embed(store: string, opts?: { dev?: boolean }): Promise<{ src: string; view: string; secret: string; version: number; expiresAt: number; origin: string; level: string; caps: Record<string, unknown> | null; dev: boolean }>;
  /** Renew an embedded view's secret, when the framed page's runtime asks. */
  renewEmbed(view: string): Promise<{ view: string; secret: string; expiresAt: number }>;
  /** End an embedded view this app opened for the visitor. */
  closeEmbed(view: string): Promise<{ closed: string }>;
`

// systemExtraTS declares systemModule's own call.
const systemExtraTS = `  /** Call one of this module's verbs by name, with its arguments as one object. */
  call(verb: string, args?: Record<string, unknown>): Promise<unknown>;
`

// moduleTypeScript declares a verb-backed module as the interface iface:
// one member per function (grouped by the prefix of a dotted name), then
// extra, members written by hand. A function whose verb is missing is
// left out.
func moduleTypeScript(table *verbs.Table, iface, doc string, funcs []modFunc, extra string) string {
	if table == nil {
		return ""
	}
	type group struct {
		name    string
		members []string
	}
	var top []string // members and "group:<name>" placeholders, in order
	groups := map[string]*group{}
	for _, f := range funcs {
		v, ok := table.Get(f.Verb)
		if !ok {
			continue
		}
		path := strings.Split(f.JS, ".")
		name := path[len(path)-1]
		if len(path) == 1 {
			top = append(top, funcTypeScript(v, f, name, "  "))
			continue
		}
		g := groups[path[0]]
		if g == nil {
			g = &group{name: path[0]}
			groups[path[0]] = g
			top = append(top, "group:"+path[0])
		}
		g.members = append(g.members, funcTypeScript(v, f, name, "    "))
	}
	var b strings.Builder
	b.WriteString("/** " + doc + " */\ninterface " + iface + " {\n")
	for _, m := range top {
		if g, ok := strings.CutPrefix(m, "group:"); ok {
			b.WriteString("  " + g + ": {\n" + strings.Join(groups[g].members, "") + "  };\n")
			continue
		}
		b.WriteString(m)
	}
	b.WriteString(extra)
	b.WriteString("}\n")
	return b.String()
}

// funcTypeScript is one function's overloads, as modArgs calls it: its
// verb's arguments as one object, and, when it has positional parameters,
// those in order followed by an options object for the rest.
func funcTypeScript(v *verbs.Verb, f modFunc, name, ind string) string {
	in := v.InputSchema()
	ret := "Promise<" + verbs.TypeScript(v.Output, ind) + ">"
	required := map[string]bool{}
	for _, r := range in.Required {
		required[r] = true
	}
	optional := map[string]bool{}
	for k := range f.Default {
		optional[k] = true
	}
	skip := map[string]bool{}
	for k := range f.Fixed {
		skip[k] = true
	}
	needed := func(k string) bool { return required[k] && !optional[k] }

	var b strings.Builder
	doc := strings.TrimSpace(v.Doc)
	if doc != "" {
		doc += " "
	}
	doc += "(" + v.Name + ")"
	b.WriteString(ind + "/** " + strings.ReplaceAll(doc, "*/", "*\\/") + " */\n")

	// One object.
	all := verbs.TypeScriptObjectMembers(in, ind+"  ", skip, optional)
	anyNeeded := false
	if in.Properties != nil {
		for p := in.Properties.Oldest(); p != nil; p = p.Next() {
			if !skip[p.Key] && needed(p.Key) {
				anyNeeded = true
			}
		}
	}
	switch {
	case all == "":
		b.WriteString(ind + name + "(): " + ret + ";\n")
	case anyNeeded:
		b.WriteString(ind + name + "(args: {\n" + all + ind + "}): " + ret + ";\n")
	default:
		b.WriteString(ind + name + "(args?: {\n" + all + ind + "}): " + ret + ";\n")
	}
	if len(f.Pos) == 0 {
		return b.String()
	}

	// Positional, then options.
	var params []string
	optionalFromHere := false
	inPos := map[string]bool{}
	for _, p := range f.Pos {
		inPos[p] = true
		s, ok := in.Properties.Get(p)
		if !ok {
			return b.String() // a position the verb does not take: the object form only
		}
		if !needed(p) {
			optionalFromHere = true
		}
		q := ""
		if optionalFromHere {
			q = "?"
		}
		params = append(params, tsParam(p)+q+": "+verbs.TypeScript(s, ind))
	}
	rest := map[string]bool{}
	for k := range skip {
		rest[k] = true
	}
	for k := range inPos {
		rest[k] = true
	}
	if opts := verbs.TypeScriptObjectMembers(in, ind+"  ", rest, optional); opts != "" {
		restNeeded := false
		for p := in.Properties.Oldest(); p != nil; p = p.Next() {
			if !rest[p.Key] && needed(p.Key) {
				restNeeded = true
			}
		}
		switch {
		case restNeeded && optionalFromHere:
			return b.String() // a needed option after an optional position: the object form only
		case restNeeded:
			params = append(params, "opts: {\n"+opts+ind+"}")
		default:
			params = append(params, "opts?: {\n"+opts+ind+"}")
		}
	}
	b.WriteString(ind + name + "(" + strings.Join(params, ", ") + "): " + ret + ";\n")
	return b.String()
}

// tsParam is a parameter name TypeScript accepts.
func tsParam(name string) string {
	switch name {
	case "default", "delete", "new", "in", "function", "class", "var", "let", "const", "this", "typeof", "void", "with", "yield", "enum", "export", "import", "super", "switch", "case", "return", "throw", "try", "catch", "finally", "for", "while", "do", "if", "else", "break", "continue", "debugger", "instanceof", "null", "true", "false":
		return name + "_"
	}
	return name
}
