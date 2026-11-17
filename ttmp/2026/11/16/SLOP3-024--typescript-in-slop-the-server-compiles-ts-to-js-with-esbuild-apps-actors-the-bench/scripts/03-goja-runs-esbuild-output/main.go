package main

// Compiles two TypeScript files with esbuild (CommonJS, es2020, inline source
// map) and runs them in goja through the same wrapper slop's actor requirer
// uses. Questions: does goja run the output, and does an error's stack point
// at the .ts lines?
import (
	"fmt"
	"strings"

	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
	"github.com/evanw/esbuild/pkg/api"
)

var files = map[string]string{
	"rows.ts": `export enum Kind { Text = "text", Hash = "sha256" }
export interface Change { path: string; text?: string; sha256?: string }
export class Batch {
  constructor(private readonly limit: number, public items: Change[] = []) {}
  add(c: Change): this { this.items.push(c); return this }
  kindOf(c: Change): Kind { return c.sha256 ? Kind.Hash : Kind.Text }
  check(): number {
    const over = this.items.length - this.limit
    if (over > 0) throw new Error("too many changes: " + over)
    return this.items.length
  }
}
`,
	"actor.ts": `import { Batch, Kind, type Change } from "./rows"
const first = (cs: Change[]): string | undefined => cs[0]?.path ?? undefined
async function run(cs: Change[]): Promise<string> {
  const b = new Batch(1)
  for (const c of cs) b.add({ ...c })
  const kinds = cs.map(c => b.kindOf(c))
  await Promise.resolve()
  return [first(cs), kinds.join(","), kinds.includes(Kind.Hash)].join(" ")
}
exports.ok = run
exports.bad = (cs: Change[]) => new Batch(1, cs).check()
`,
}

func compile(name string) string {
	r := api.Transform(files[name], api.TransformOptions{Loader: api.LoaderTS, Format: api.FormatCommonJS, Target: api.ES2020, Sourcefile: name, Sourcemap: api.SourceMapInline})
	if len(r.Errors) > 0 {
		panic(r.Errors[0].Text)
	}
	return string(r.Code)
}

func main() {
	vm := goja.New()
	vm.SetParserOptions(parser.WithSourceMapLoader(func(p string) ([]byte, error) { return nil, fmt.Errorf("no files: %s", p) }))
	cache := map[string]goja.Value{}
	var require func(from, name string) goja.Value
	require = func(from, name string) goja.Value {
		p := strings.TrimPrefix(name, "./") + ".ts"
		if name == "actor" {
			p = "actor.ts"
		}
		if v, ok := cache[p]; ok {
			return v
		}
		fn, err := vm.RunScript(p, "(function (module, exports, require) {"+compile(p)+"\n})")
		if err != nil {
			panic(err)
		}
		call, _ := goja.AssertFunction(fn)
		module, exports := vm.NewObject(), vm.NewObject()
		_ = module.Set("exports", exports)
		if _, err := call(goja.Undefined(), module, exports, vm.ToValue(func(n string) goja.Value { return require(p, n) })); err != nil {
			panic(err)
		}
		cache[p] = module.Get("exports")
		return cache[p]
	}
	_ = vm.Set("actor", require("", "actor"))
	v, err := vm.RunString(`var out; actor.ok([{path: "a.txt", text: "x"}, {path: "img.png", sha256: "ab"}]).then(r => out = r); out`)
	_ = v
	v, err = vm.RunString(`out`)
	fmt.Println("ok:", v, err)
	_, err = vm.RunString(`actor.bad([{path: "a"}, {path: "b"}, {path: "c"}])`)
	if ex, ok := err.(*goja.Exception); ok {
		fmt.Println("bad:", ex.Value())
		for _, l := range strings.Split(strings.TrimSpace(ex.String()), "\n") {
			fmt.Println("   ", l)
		}
	} else {
		fmt.Println("bad: unexpected", err)
	}
}
