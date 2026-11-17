package actor

import (
	"regexp"
	"slices"
	"strings"
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
