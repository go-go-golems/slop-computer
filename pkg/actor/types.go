package actor

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// ModulesTypeScript is an app's modules.d.ts (SLOP3-024, design §5.3): the
// declarations of the catalog modules its actor can load now, decided as
// catalogModule decides (data and own modules always, a scoped one with a
// current grant, a trusted one also listed in slop.modules), and the
// SlopModules and SlopRequire entries that type use() and require() for
// them; actor.d.ts declares both. A module the app cannot load is not
// declared, so using it is a type error, as it is null at runtime.
func (m *Manager) ModulesTypeScript(app string, declared []string) string {
	var decls, use, req []string
	for _, mod := range m.Modules() {
		if !mod.Class.Default() {
			if mod.Class == ClassTrusted && !slices.Contains(declared, mod.Name) {
				continue
			}
			if g, ok := m.grant(app, mod.Name); !ok || !g.Current {
				continue
			}
		}
		typ := "any" // a module without a declaration
		if ts := strings.TrimSpace(mod.TypeScript); ts != "" {
			decls = append(decls, "// "+mod.Name+" ("+string(mod.Class)+"): "+firstLine(mod.Doc)+"\n"+ts)
			switch {
			case strings.Contains(ts, `declare module "`+mod.Name+`"`):
				typ = `typeof import("` + mod.Name + `")`
			default:
				if name := ifaceName.FindStringSubmatch(ts); name != nil {
					typ = name[1]
				}
			}
		}
		key := tsName(mod.Name)
		use = append(use, "  "+key+": "+typ+";")
		if reservedModules[mod.Name] {
			req = append(req, "  "+key+": "+typ+";")
		}
	}
	var b strings.Builder
	b.WriteString("// The Go modules " + app + " may use on this server, as use() and require() return them.\n\n")
	for _, d := range decls {
		b.WriteString(d + "\n\n")
	}
	b.WriteString("interface SlopModules {\n" + strings.Join(use, "\n") + "\n}\n\n")
	b.WriteString("interface SlopRequire {\n" + strings.Join(req, "\n") + "\n}\n")
	return b.String()
}

var (
	ifaceName = regexp.MustCompile(`(?m)^interface ([A-Za-z_$][A-Za-z0-9_$]*)`)
	identLike = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
)

func tsName(name string) string {
	if identLike.MatchString(name) {
		return name
	}
	return `"` + name + `"`
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	return s
}

// ActionsTypeScript is an app's actions.d.ts (SLOP3-024 phase 2, design
// §5.4): AppActions, the actions of the actor of from, declared from their
// schemas with the converter of section 5.3. An action without an args
// schema takes anything; without a result schema it returns unknown.
// page.d.ts makes AppActions what claude.use('slop') types its actions by
// when the app declares any, so a JavaScript app gets typed calls too.
func ActionsTypeScript(from string, actions []ActionDecl, broken string) string {
	var b strings.Builder
	b.WriteString("// The actions of " + from + "'s actor, from their args and result schemas.\n")
	if broken != "" {
		b.WriteString("// Its actor is broken, so none are declared: " + firstLine(broken) + "\n")
	}
	b.WriteString("interface AppActions {\n")
	for _, a := range actions {
		args, opt := "unknown", "?"
		if s := schemaOf(a.Args); s != nil {
			args = verbs.TypeScript(s, "  ")
			if needsArgs(s) {
				opt = ""
			}
			if s.Description != "" {
				b.WriteString("  /** " + strings.ReplaceAll(firstLine(s.Description), "*/", "*\\/") + " */\n")
			}
		}
		result := "unknown"
		if s := schemaOf(a.Result); s != nil {
			result = verbs.TypeScript(s, "  ")
		}
		b.WriteString("  " + tsName(a.Name) + "(args" + opt + ": " + args + "): " + result + ";\n")
	}
	b.WriteString("}\n")
	return b.String()
}

// schemaOf reads a declared schema for the converter (nil for none).
func schemaOf(raw json.RawMessage) *jsonschema.Schema {
	if raw == nil {
		return nil
	}
	s := &jsonschema.Schema{}
	if err := json.Unmarshal(raw, s); err != nil {
		return nil
	}
	return s
}

// needsArgs: a call must pass arguments, because the schema requires a
// property or is not an object (a call without them is checked as {}).
func needsArgs(s *jsonschema.Schema) bool {
	return len(s.Required) > 0 || (s.Type != "" && s.Type != "object")
}
