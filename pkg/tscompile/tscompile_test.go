package tscompile

import (
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/jsrt"
)

func TestIs(t *testing.T) {
	for name, want := range map[string]bool{
		"main.ts": true, "lib/x.mts": true, "x.cts": true, "App.tsx": true,
		"types.d.ts": false, "x.d.mts": false, "x.d.cts": false,
		"main.js": false, "clip.ts.map": false, "README.md": false, "d.ts": true,
	} {
		if Is(name) != want {
			t.Errorf("Is(%q) = %v", name, !want)
		}
	}
}

const rows = `export enum Kind { Text = "text", Hash = "sha256" }
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
`

const entry = `import { Batch, Kind, type Change } from "./rows.ts"
const first = (cs: Change[]): string | undefined => cs[0]?.path ?? undefined
exports.ok = (cs: Change[]) => [first(cs), cs.map(c => new Batch(9).kindOf({ ...c })).join(","), Kind.Hash].join(" ")
exports.bad = (cs: Change[]) => new Batch(1, cs).check()
`

// The Actor profile's output runs in goja through the actor's CommonJS
// wrapper, and an error's stack points at the TypeScript lines.
func TestActorProfileRunsInGoja(t *testing.T) {
	files := map[string]string{"lib/rows.ts": rows, "actor.ts": entry}
	vm := goja.New()
	jsrt.ForAppCode(vm)
	cache := map[string]goja.Value{}
	var require func(name string) goja.Value
	require = func(name string) goja.Value {
		p := map[string]string{"./rows.ts": "lib/rows.ts", "actor": "actor.ts"}[name]
		if v, ok := cache[p]; ok {
			return v
		}
		out, err := Compile(p, []byte(files[p]), Actor, nil)
		if err != nil {
			t.Fatalf("compile %s: %v", p, err)
		}
		fn, err := vm.RunScript(p, "(function (module, exports, require) {"+string(out.Code)+"\n})")
		if err != nil {
			t.Fatalf("run %s: %v", p, err)
		}
		call, _ := goja.AssertFunction(fn)
		module, exports := vm.NewObject(), vm.NewObject()
		_ = module.Set("exports", exports)
		if _, err := call(goja.Undefined(), module, exports, vm.ToValue(require)); err != nil {
			t.Fatalf("load %s: %v", p, err)
		}
		cache[p] = module.Get("exports")
		return cache[p]
	}
	_ = vm.Set("actor", require("actor"))
	v, err := vm.RunString(`actor.ok([{path: "a.txt", text: "x"}, {path: "img.png", sha256: "ab"}])`)
	if err != nil || v.String() != "a.txt text,sha256 sha256" {
		t.Fatalf("ok = %v, %v", v, err)
	}
	_, err = vm.RunString(`actor.bad([{path: "a"}, {path: "b"}])`)
	var ex *goja.Exception
	if !errors.As(err, &ex) {
		t.Fatalf("bad: %v", err)
	}
	stack := ex.String()
	// Line 9 of rows.ts throws; line 4 of actor.ts calls it.
	if !regexp.MustCompile(`at check \(lib/rows\.ts:9:\d+`).MatchString(stack) || !strings.Contains(stack, "actor.ts:4:") {
		t.Fatalf("stack does not point at the TypeScript:\n%s", stack)
	}
}

func TestPageProfile(t *testing.T) {
	out, err := Compile("src/main.ts", []byte("import { slug } from './lib/text.ts'\nexport const title: string = slug('Hello World')\n"), Page, nil)
	if err != nil {
		t.Fatal(err)
	}
	code := string(out.Code)
	if !strings.Contains(code, `import { slug } from "./lib/text.ts"`) || strings.Contains(code, ": string") {
		t.Fatalf("code:\n%s", code)
	}
	if !strings.HasSuffix(code, "//# sourceMappingURL=main.ts.map\n") {
		t.Fatalf("no linked map comment:\n%s", code)
	}
	if !strings.Contains(string(out.Map), `"sources": ["main.ts"]`) {
		t.Fatalf("map: %s", out.Map)
	}
}

// .tsx follows the app's tsconfig: the automatic runtime imports
// <jsxImportSource>/jsx-runtime, which the import map resolves.
func TestTSXFollowsTsconfig(t *testing.T) {
	src := []byte("export const Hello = ({ name }: { name: string }) => <p class=\"hi\">Hello {name}</p>\n")
	tsconfig := []byte(`{
  // comments are allowed, as in tsc
  "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "preact", },
}`)
	out, err := Compile("hello.tsx", src, Page, tsconfig)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out.Code), `from "preact/jsx-runtime"`) {
		t.Fatalf("automatic runtime not used:\n%s", out.Code)
	}
	classic, err := Compile("hello.tsx", src, Page, nil)
	if err != nil || !strings.Contains(string(classic.Code), "React.createElement") {
		t.Fatalf("without a tsconfig: %v\n%s", err, classic.Code)
	}
}

func TestErrors(t *testing.T) {
	_, err := Compile("src/main.ts", []byte("const a = 1\nconst rows = await list(\nexport {}\n"), Page, nil)
	var e *Error
	if !errors.As(err, &e) || !regexp.MustCompile(`^src/main\.ts:3:1: `).MatchString(e.Messages[0]) {
		t.Fatalf("err = %v", err)
	}
	if _, err := Compile("x.ts", []byte{0xff, 0xfe, 0x00}, Actor, nil); !errors.As(err, &e) || !strings.Contains(err.Error(), "not UTF-8") {
		t.Fatalf("binary: %v", err)
	}
	if _, err := Compile("x.ts", make([]byte, MaxSource+1), Actor, nil); !errors.As(err, &e) || !strings.Contains(err.Error(), "more than slop compiles") {
		t.Fatalf("large: %v", err)
	}
	// What a page gets instead: a module that throws the message.
	vm := goja.New()
	_, err = vm.RunString(string(ErrorModule(errors.New("a.ts:1:2: Expected \";\" but found \"</script>\"\nnext"))))
	if err == nil || !strings.Contains(err.Error(), `SyntaxError: a.ts:1:2: Expected ";" but found "</script>"`) {
		t.Fatalf("error module: %v", err)
	}
}

func TestCache(t *testing.T) {
	src := []byte("export const x: number = 1\n")
	a, _ := Compile("c.ts", src, Actor, nil)
	b, _ := Compile("c.ts", src, Actor, nil)
	if a != b {
		t.Fatal("the same input compiled twice")
	}
	if c, _ := Compile("c.ts", src, Actor, []byte(`{"compilerOptions":{}}`)); c == a {
		t.Fatal("a different tsconfig shares the cache entry")
	}
	if d, _ := Compile("c.ts", src, Eval, nil); d == a {
		t.Fatal("a different profile shares the cache entry")
	}
	l := newLRU(10)
	l.put("a", result{}, 4)
	l.put("b", result{}, 4)
	l.get("a")
	l.put("c", result{}, 4) // evicts b, the least recently used
	if _, ok := l.get("b"); ok {
		t.Fatal("b survived")
	}
	if _, ok := l.get("a"); !ok {
		t.Fatal("a was evicted")
	}
}

// Version names the esbuild that go.mod pins.
func TestVersionMatchesGoMod(t *testing.T) {
	mod, err := os.ReadFile("../../go.mod")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`github\.com/evanw/esbuild (v\S+)`).FindSubmatch(mod)
	if m == nil || !strings.HasPrefix(Version, "esbuild-"+strings.TrimPrefix(string(m[1]), "v")+".") {
		t.Fatalf("go.mod has esbuild %s; Version is %s", m, Version)
	}
}

// Requests for the same file at once compile it once; all get that output.
func TestConcurrentCompiles(t *testing.T) {
	src := []byte("export const many: number[] = [1, 2, 3]\n")
	outs := make(chan *Output, 32)
	for range 32 {
		go func() {
			out, err := Compile("many.ts", src, Page, nil)
			if err != nil {
				t.Error(err)
			}
			outs <- out
		}()
	}
	first := <-outs
	for range 31 {
		if out := <-outs; out != first {
			t.Fatal("the same file compiled more than once")
		}
	}
}
