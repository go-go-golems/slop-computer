package client

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// TypesDir is where slop types writes an app's declarations (SLOP3-024).
// It is a dot directory, which push and dev skip: the declarations
// describe the server, not the app, so they are never pushed.
const TypesDir = ".slop/types"

// Types fetches an app's TypeScript declarations (app.types) and writes
// them into dir/.slop/types. With tsconfigs, it also writes tsconfig.json
// (the pages) and tsconfig.actor.json (the actor) when they do not exist
// yet. It returns the paths it wrote, relative to dir.
func (c *Client) Types(app, dir string, tsconfigs bool) ([]string, error) {
	res, err := c.Call("app.types", map[string]any{"app": app})
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(res)
	if err != nil {
		return nil, err
	}
	var out struct {
		Files []struct{ Path, Text string } `json:"files"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("app.types: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, filepath.FromSlash(TypesDir)), 0o755); err != nil {
		return nil, err
	}
	var wrote []string
	for _, f := range out.Files {
		name := path.Base(f.Path)
		if name != f.Path || !strings.HasSuffix(name, ".d.ts") {
			return wrote, fmt.Errorf("app.types: unexpected file %q", f.Path)
		}
		p := TypesDir + "/" + name
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(p)), []byte(f.Text), 0o644); err != nil {
			return wrote, err
		}
		wrote = append(wrote, p)
	}
	if !tsconfigs {
		return wrote, nil
	}
	actor := ""
	if b, err := os.ReadFile(filepath.Join(dir, "app.json")); err == nil {
		var m struct {
			Actor string `json:"actor"`
		}
		_ = json.Unmarshal(b, &m)
		actor = m.Actor
	}
	_, err = os.Stat(filepath.Join(dir, "vendor", "tsconfig.vendor.json"))
	vendored := err == nil
	for name, cfg := range Tsconfigs(actor, vendored) {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			continue // the app's own: never overwritten
		}
		if err := os.WriteFile(p, cfg, 0o644); err != nil {
			return wrote, err
		}
		wrote = append(wrote, name)
	}
	return wrote, nil
}

// Tsconfigs are the two TypeScript programs of an app (design §5.5): the
// pages (the DOM and window.claude) and, when it has one, the actor (the
// actor runtime and its modules, no DOM). Files under server/ are the
// actor's alone. vendored: vendor/tsconfig.vendor.json exists, so both
// extend it for the vendored packages' declarations. The server compiles
// each file on its own and reads only the JSX options from these files.
func Tsconfigs(actor string, vendored bool) map[string][]byte {
	options := func(target string, lib []string) map[string]any {
		return map[string]any{
			// moduleDetection force: every file is a module, as pages
			// (<script type="module">) and actor files are, so top-level
			// await and file-local names work without an import.
			"target": target, "lib": lib, "module": "ESNext", "moduleResolution": "Bundler", "moduleDetection": "force",
			"strict": true, "isolatedModules": true, "allowImportingTsExtensions": true,
			"noEmit": true, "skipLibCheck": true, "types": []string{},
		}
	}
	extend := func(cfg map[string]any) map[string]any {
		if vendored {
			cfg["extends"] = "./vendor/tsconfig.vendor.json"
		}
		return cfg
	}
	exclude := []string{"server", "vendor", "node_modules"}
	if actor != "" {
		exclude = append([]string{actor}, exclude...)
	}
	out := map[string][]byte{}
	put := func(name string, cfg map[string]any) {
		b, _ := json.MarshalIndent(cfg, "", "  ")
		out[name] = append(b, '\n')
	}
	put("tsconfig.json", extend(map[string]any{
		"//":              "Written by slop types: the app's pages. The actor has tsconfig.actor.json; " + TypesDir + " holds the declarations (slop types refreshes them).",
		"compilerOptions": options("ES2022", []string{"ES2022", "DOM", "DOM.Iterable"}),
		"files":           []string{TypesDir + "/page.d.ts"},
		"include":         []string{"**/*.ts", "**/*.tsx"},
		"exclude":         exclude,
	}))
	if actor != "" {
		put("tsconfig.actor.json", extend(map[string]any{
			"//":              "Written by slop types: the app's actor (tsc -p tsconfig.actor.json). Files under server/ are the actor's alone.",
			"compilerOptions": options("ES2020", []string{"ES2020"}),
			"files":           []string{TypesDir + "/actor.d.ts", TypesDir + "/modules.d.ts", actor},
			"include":         []string{"server/**/*.ts"},
		}))
	}
	return out
}
